using System.Diagnostics;
using System.Linq;
using System.Threading.Channels;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using StarWebCNC.Agent.Commands;
using StarWebCNC.Agent.Configuration;
using StarWebCNC.Agent.Focas;
using StarWebCNC.Agent.Mqtt;
using StarWebCNC.Agent.Template;

namespace StarWebCNC.Agent.Collectors;

/// <summary>
/// 데이터 수집 백그라운드 서비스
/// </summary>
public class DataCollectorService : BackgroundService
{
    private readonly ILogger<DataCollectorService> _logger;
    private readonly AgentSettings _settings;
    private readonly FocasConnection _connection;
    private readonly FocasDataReader _dataReader;
    private readonly MqttService _mqttService;
    private readonly TemplateLoader _templateLoader;
    private readonly CommandHandler _commandHandler;
    private readonly SchedulerManager _schedulerManager;

    // FOCAS 스레드에서만 처리하도록 명령 큐
    private readonly Channel<CommandMessage> _commandChannel =
        Channel.CreateBounded<CommandMessage>(new BoundedChannelOptions(32)
        {
            FullMode = BoundedChannelFullMode.DropOldest,
            SingleReader = true,
        });

    private readonly DateTime _startTime = DateTime.UtcNow;
    private bool _lastM20State = false;
    // alarmNo → AlarmInfo: raise 시 전체 정보를 보존, clear 시 category/typeCode 로그에 사용
    private readonly Dictionary<int, AlarmInfo> _activeAlarms = new();
    private bool _alarmStateInitialized;
    private DateTime _lastAlarmSnapshot = DateTime.MinValue;
    private static readonly TimeSpan AlarmSnapshotInterval = TimeSpan.FromSeconds(10);

    // rdopmsg2 안전성 플래그 — ProbeOpMsg2() 결과로 설정
    // false = 아직 미검증 또는 블로킹 의심 → 수집 루프 호출 금지
    // true  = 실기기에서 < 500ms 응답 확인 → 수집 루프 사용 가능
    private bool _opMsgSafe = false;

    // 마지막 수집된 오퍼레이터 메시지 캐시 — 다음 텔레메트리 발행 시 포함
    private List<OperatorMsgData> _cachedOpMessages = new();

    private int _coordinateDecimalPlaces = 3; // CNC 파라미터 1013 bit1(ISC)로 자동 감지
    private long _lastMainPathDetails;
    private long _lastSubPathDetails;
    private long _lastTelemetryCounts;
    private (int Parts, int Preset, double CycleTime) _telemetryCounts;
    private MachineTemplate? _telemetryCountsTemplate;

    public DataCollectorService(
        ILogger<DataCollectorService> logger,
        IOptions<AgentSettings> options,
        FocasConnection connection,
        FocasDataReader dataReader,
        MqttService mqttService,
        TemplateLoader templateLoader,
        CommandHandler commandHandler,
        SchedulerManager schedulerManager)
    {
        _logger = logger;
        _settings = options.Value;
        _connection = connection;
        _dataReader = dataReader;
        _mqttService = mqttService;
        _templateLoader = templateLoader;
        _commandHandler = commandHandler;
        _schedulerManager = schedulerManager;

        // MQTT 명령을 FOCAS 스레드 큐로 전달 (스레드 친화성 보장)
        _mqttService.OnCommandReceived += cmd =>
        {
            bool written = _commandChannel.Writer.TryWrite(cmd);
            _logger.LogInformation("Command queued to FOCAS thread: {Cmd} (written={Written})", cmd.Command, written);
            return Task.CompletedTask;
        };

        // 스케줄러 명령을 SchedulerManager에 전달
        _mqttService.OnSchedulerCommandReceived += cmd =>
        {
            _schedulerManager.EnqueueCommand(cmd);
            return Task.CompletedTask;
        };
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("Data collector service starting...");

        // MQTT 연결 — 브로커 미준비(Docker 시작 순서) 등으로 실패해도 재시도
        // .NET 8 BackgroundService는 throw 시 StopHost → 프로세스 종료하므로 반드시 내부 처리
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await _mqttService.ConnectAsync(stoppingToken);
                break;
            }
            catch (OperationCanceledException)
            {
                return;
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "MQTT connection failed. Retrying in 5 seconds...");
                try { await Task.Delay(5_000, stoppingToken); }
                catch (OperationCanceledException) { return; }
            }
        }

        if (stoppingToken.IsCancellationRequested) return;

        // 템플릿 로드 (실패 시 fallback 템플릿 사용, 예외 전파 없음)
        await _templateLoader.LoadTemplateAsync(stoppingToken);

        // ── FOCAS2 전용 스레드 실행 ─────────────────────────────────────
        // FOCAS2 DLL은 스레드 친화적(thread-affine): cnc_allclibhndl3를 호출한
        // 스레드에서만 이후 API가 동작함. LongRunning 전용 스레드를 사용하여
        // async await에 의한 스레드 전환을 완전히 차단.
        // ────────────────────────────────────────────────────────────────
        await Task.Factory.StartNew(
            () => RunFocasWorker(stoppingToken),
            stoppingToken,
            TaskCreationOptions.LongRunning,
            TaskScheduler.Default);
    }

    /// <summary>
    /// FOCAS 전용 스레드 진입점 — 모든 FOCAS API 호출이 이 스레드에서만 실행
    /// CNC 연결 실패 시 30초 간격으로 무한 재시도 (장비 전원 ON 대기)
    /// </summary>
    private void RunFocasWorker(CancellationToken stoppingToken)
    {
        _logger.LogInformation("FOCAS worker thread started.");

        // CNC 연결 — 실패해도 포기하지 않고 재시도
        while (!stoppingToken.IsCancellationRequested)
        {
            bool connected = _connection.ConnectAsync(stoppingToken).GetAwaiter().GetResult();
            if (connected) break;

            _logger.LogWarning("CNC connection failed. Retrying in 30 seconds...");
            stoppingToken.WaitHandle.WaitOne(30_000);
        }

        if (stoppingToken.IsCancellationRequested) return;

        // CNC 파라미터 1013 bit1(ISC)로 소수점 자리수 자동 감지
        _coordinateDecimalPlaces = _dataReader.ReadCoordinateDecimalPlaces();
        _logger.LogInformation("Coordinate decimal places detected: {Dp} (IS-{Is})",
            _coordinateDecimalPlaces, _coordinateDecimalPlaces == 4 ? "C" : "B");

        // cnc_rdopmsg2 블로킹 여부 1회 프로브 — 수집 루프 진입 전 안전성 확인
        // 블록 시 이 지점에서 지연되나 수집 루프 자체는 영향 없음
        ProbeOpMsg2();

        // 초기 상태 발행
        PublishAgentStatus("online").GetAwaiter().GetResult();

        var collector = _settings.Collector;
        var telemetryInterval = TimeSpan.FromMilliseconds(collector.TelemetryIntervalMs);
        var alarmInterval = TimeSpan.FromMilliseconds(collector.AlarmIntervalMs);
        var pmcInterval = TimeSpan.FromMilliseconds(collector.PmcIntervalMs);
        var pmcMonitorInterval = TimeSpan.FromMilliseconds(collector.PmcMonitorIntervalMs ?? collector.PmcIntervalMs);

        long lastTelemetry = 0;
        long lastAlarm = 0;
        long lastPmcMonitor = 0;
        long lastPmcControl = 0;

        static TimeSpan Remaining(long last, TimeSpan interval, long now) =>
            last == 0 ? TimeSpan.Zero : interval - Stopwatch.GetElapsedTime(last, now);

        void PollPmcControlIfDue()
        {
            var started = Stopwatch.GetTimestamp();
            if (Remaining(lastPmcControl, pmcInterval, started) > TimeSpan.Zero) return;

            if (lastPmcControl != 0)
                _logger.LogDebug("PMC control gap={Gap:F1}ms", Stopwatch.GetElapsedTime(lastPmcControl, started).TotalMilliseconds);
            lastPmcControl = started;
            try { DetectM20EdgeSync(); }
            catch (Exception ex) { _logger.LogError(ex, "Error in M20 edge detection"); }
            try { _schedulerManager.Tick(stoppingToken); }
            catch (Exception ex) { _logger.LogError(ex, "Error in scheduler tick"); }
        }

        while (!stoppingToken.IsCancellationRequested)
        {
            // 연결 끊김 감지 시 재연결 시도
            if (!_connection.IsConnected)
            {
                _logger.LogWarning("CNC connection lost. Attempting reconnect...");
                PublishAgentStatus("reconnecting").GetAwaiter().GetResult();
                bool reconnected = _connection.ConnectAsync(stoppingToken).GetAwaiter().GetResult();
                if (!reconnected)
                {
                    _logger.LogWarning("Reconnect failed. Retrying in 30 seconds...");
                    stoppingToken.WaitHandle.WaitOne(30_000);
                    continue;
                }
                // 재연결 후 소수점 자리수 재감지
                _coordinateDecimalPlaces = _dataReader.ReadCoordinateDecimalPlaces();
                _logger.LogInformation("Coordinate decimal places re-detected: {Dp}", _coordinateDecimalPlaces);
                // 재연결 시 rdopmsg2 안전성 재프로브 (핸들이 바뀌므로)
                _opMsgSafe = false;
                _cachedOpMessages.Clear();
                _dataReader.ResetPathTelemetry();
                _lastMainPathDetails = _lastSubPathDetails = _lastTelemetryCounts = 0;
                _telemetryCounts = default;
                ProbeOpMsg2();
                PublishAgentStatus("online").GetAwaiter().GetResult();
            }

            // ── FOCAS 스레드에서 큐 명령 처리 (스레드 친화성 보장) ──
            while (_commandChannel.Reader.TryRead(out var cmd))
            {
                _logger.LogInformation("Executing command on FOCAS thread: {Cmd}", cmd.Command);
                try { _commandHandler.ExecuteOnFocasThread(cmd).GetAwaiter().GetResult(); }
                catch (Exception ex) { _logger.LogError(ex, "Error executing command: {Cmd}", cmd.Command); }
                _logger.LogInformation("Command completed on FOCAS thread: {Cmd}", cmd.Command);
            }

            PollPmcControlIfDue();

            // ── 전체 텔레메트리 발행 (설정 주기) ──
            var now = Stopwatch.GetTimestamp();
            if (Remaining(lastTelemetry, telemetryInterval, now) <= TimeSpan.Zero)
            {
                lastTelemetry = now;
                try { CollectAndPublishTelemetrySync(PollPmcControlIfDue); }
                catch (Exception ex) { _logger.LogError(ex, "Error in telemetry collection"); }
                PollPmcControlIfDue();
            }

            // ── 알람 체크 (1000ms 주기) ──
            now = Stopwatch.GetTimestamp();
            if (Remaining(lastAlarm, alarmInterval, now) <= TimeSpan.Zero)
            {
                lastAlarm = now;
                try { CollectAndPublishAlarmsSync(); }
                catch (Exception ex) { _logger.LogError(ex, "Error in alarm collection"); }
                _logger.LogDebug("Alarm collection={Alarm:F1}ms", Stopwatch.GetElapsedTime(now).TotalMilliseconds);
                PollPmcControlIfDue();
            }

            now = Stopwatch.GetTimestamp();
            if (Remaining(lastPmcMonitor, pmcMonitorInterval, now) <= TimeSpan.Zero)
            {
                lastPmcMonitor = now;
                try { CollectAndPublishPmcBitsSync(); }
                catch (Exception ex) { _logger.LogError(ex, "Error in PMC bits collection"); }
                _logger.LogDebug("PMC monitor reads={Pmc:F1}ms", Stopwatch.GetElapsedTime(now).TotalMilliseconds);
            }

            now = Stopwatch.GetTimestamp();
            double remainingMs = Math.Min(
                Math.Min(Remaining(lastPmcControl, pmcInterval, now).TotalMilliseconds,
                    Remaining(lastPmcMonitor, pmcMonitorInterval, now).TotalMilliseconds),
                Math.Min(Remaining(lastTelemetry, telemetryInterval, now).TotalMilliseconds,
                    Remaining(lastAlarm, alarmInterval, now).TotalMilliseconds));
            if (remainingMs > 0)
                stoppingToken.WaitHandle.WaitOne((int)Math.Ceiling(remainingMs));
        }

        _logger.LogInformation("FOCAS worker thread exiting.");
    }

    // ── 동기 수집 메서드들 ─────────────────────────────────────────────

    /// <summary>
    /// 화면용 PMC 비트 수집 및 발행
    /// 인터락 어드레스 + 패널 램프 어드레스를 읽어 pmc_bits 토픽으로 발행.
    /// </summary>
    private void CollectAndPublishPmcBitsSync()
    {
        if (!_connection.IsConnected) return;

        var tpl = _templateLoader.CurrentTemplate;
        if (tpl == null) return;

        // 인터락 어드레스 + 패널 램프 어드레스 통합 수집
        var interlockAddrs = new[]
        {
            tpl.TopBarInterlock.Remote.Fields,
            tpl.TopBarInterlock.Scheduler.Fields,
            tpl.TopBarInterlock.Transfer.Fields,
            tpl.TopBarInterlock.Backup.Fields,
        }
        .SelectMany(fields => fields)
        .Where(f => f.Enabled && !string.IsNullOrWhiteSpace(f.PmcAddr))
        .Select(f => f.PmcAddr!);

        // PMC 메시지 어드레스 (PmcMessages 정의 항목)
        var pmcMessageAddrs = tpl.PmcMessages
            .Where(m => !string.IsNullOrWhiteSpace(m.PmcAddr))
            .Select(m => m.PmcAddr);

        // G63.0: CNC 현재 표시 계통 (0=PATH1, 1=PATH2) — HEAD SELECT 키 결과
        var standardAddrs = new[] { "G63.0" };

        var uniqueAddrs = interlockAddrs
            .Concat(tpl.PanelLampAddrs)
            .Concat(pmcMessageAddrs)
            .Concat(tpl.ExtraPmcAddrs)
            .Concat(standardAddrs)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        if (uniqueAddrs.Count == 0) return;

        var pmcBits = _dataReader.ReadPmcBits(uniqueAddrs);

        if (pmcBits.Count == 0) return;

        var msg = new PmcBitsMessage
        {
            MachineId = _settings.MachineId,
            PmcBits   = pmcBits,
        };
        _mqttService.PublishPmcBitsAsync(msg).GetAwaiter().GetResult();
    }

    private void CollectAndPublishTelemetrySync(Action pollPmcControl)
    {
        if (!_connection.IsConnected) return;

        var started = Stopwatch.GetTimestamp();
        var status = _dataReader.ReadStatus();

        var template = _templateLoader.CurrentTemplate;
        if (!ReferenceEquals(_telemetryCountsTemplate, template))
        {
            _telemetryCountsTemplate = template;
            _lastTelemetryCounts = 0;
            _telemetryCounts = default;
        }
        bool hasSubPath = (template?.SystemInfo?.MaxPaths ?? 1) >= 2;
        var maxAxes = template?.SystemInfo?.MaxAxes ?? 0;
        int detailIntervalMs = _settings.Collector.TelemetryDetailIntervalMs.GetValueOrDefault();
        bool cacheDetails = detailIntervalMs > 0;
        // When throttled, refresh only the oldest detail group in each frame.
        long oldest = Math.Min(_lastMainPathDetails,
            Math.Min(hasSubPath ? _lastSubPathDetails : long.MaxValue,
                template != null ? _lastTelemetryCounts : long.MaxValue));
        bool detailsDue = oldest == 0 || Stopwatch.GetElapsedTime(oldest, started).TotalMilliseconds >= detailIntervalMs;
        bool refreshMain = !cacheDetails || (detailsDue && oldest == _lastMainPathDetails);
        bool refreshSub = !cacheDetails || (detailsDue && !refreshMain && oldest == _lastSubPathDetails);
        bool refreshCounts = !cacheDetails || (detailsDue && !refreshMain && !refreshSub);

        var pathsStarted = Stopwatch.GetTimestamp();
        var path1 = _dataReader.ReadPathData(1, _coordinateDecimalPlaces, maxAxes, out var mainPositions,
            cacheDetails, refreshMain, status);
        if (refreshMain) _lastMainPathDetails = pathsStarted;
        PathData? path2 = null;
        if (hasSubPath)
        {
            if (cacheDetails) pollPmcControl();
            var subStarted = Stopwatch.GetTimestamp();
            path2 = _dataReader.ReadPathData(2, _coordinateDecimalPlaces, maxAxes, out _, cacheDetails, refreshSub);
            if (refreshSub) _lastSubPathDetails = subStarted;
        }
        var pathsFinished = Stopwatch.GetTimestamp();

        if (refreshCounts && template != null)
        {
            _lastTelemetryCounts = pathsFinished;
            var cd = template.SchedulerConfig.CountDisplay;
            int parts = _dataReader.ReadPartsCount(cd.CountMacroNo, cd.CountVarType) ?? 0;
            double? preset = string.Equals(cd.PresetVarType, "pcode", StringComparison.OrdinalIgnoreCase)
                ? _dataReader.ReadPcodeMacroVariable(cd.PresetMacroNo)
                : _dataReader.ReadMacroVariable(cd.PresetMacroNo);
            bool useHms = !string.IsNullOrWhiteSpace(cd.CycleTimeHmsStartAddr);
            double cycleMs = _dataReader.ReadCycleTimeMs(
                useHms ? cd.CycleTimeHmsStartAddr! : cd.CycleTimeAddr, cd.CycleTimeMultiplier, useHms) ?? 0.0;
            _telemetryCounts = (parts, (int)(preset ?? 0), cycleMs / 1000.0);
        }

        string? programNo = path1?.ProgramNo;
        if (programNo == null && _dataReader.ReadProgramInfo() is { } program)
            programNo = $"O{program.CurrentProgram:D4}";
        var feedrate = path1?.Modal.FeedActual ?? _dataReader.ReadFeedrate();
        var spindleSpeed = path1?.Modal.SpindleActual ?? _dataReader.ReadSpindleSpeed();
        var absolutePos = mainPositions == null
            ? _dataReader.ReadAbsolutePosition()?.Values
            : mainPositions.Absolute.Take(4).Concat(new int[4]).Take(4).ToArray();
        var machinePos = mainPositions == null
            ? _dataReader.ReadMachinePosition()?.Values
            : mainPositions.Machine.Take(4).Concat(new int[4]).Take(4).ToArray();

        var telemetry = new TelemetryMessage
        {
            MachineId = _settings.MachineId,
            Data = new TelemetryData
            {
                RunState = status?.Run ?? 0,
                Mode = status?.ModeString ?? "UNKNOWN",
                ProgramNo = programNo,
                Feedrate = feedrate ?? 0,
                SpindleSpeed = spindleSpeed ?? 0,
                PartsCount = _telemetryCounts.Parts,
                PresetCount = _telemetryCounts.Preset,
                CycleTime = _telemetryCounts.CycleTime,
                AlarmActive = status?.HasAlarm ?? false,
                AbsolutePosition = absolutePos,
                MachinePosition = machinePos,
                Path1 = path1,
                Path2 = path2,
                // pmcBits는 pmc_bits 토픽(100ms)으로 별도 발행 — 텔레메트리에서 제외
                // OperatorMessages: rdopmsg2로 수집 (1000ms alarm loop) → 캐시에서 포함
                // _opMsgSafe=false 구간에는 null → 프론트엔드 기존 값 유지
                OperatorMessages = _opMsgSafe && _cachedOpMessages.Count > 0
                    ? _cachedOpMessages
                    : null,
            }
        };

        // MQTT 발행: 전용 스레드에서 블로킹으로 호출 (스레드 전환 방지)
        var publishStarted = Stopwatch.GetTimestamp();
        _mqttService.PublishTelemetryAsync(telemetry).GetAwaiter().GetResult();
        _logger.LogDebug("Telemetry cycle: base={Base:F1}ms paths={Paths:F1}ms mqtt={Mqtt:F1}ms total={Total:F1}ms",
            (Stopwatch.GetElapsedTime(started, pathsStarted) + Stopwatch.GetElapsedTime(pathsFinished, publishStarted)).TotalMilliseconds,
            Stopwatch.GetElapsedTime(pathsStarted, pathsFinished).TotalMilliseconds,
            Stopwatch.GetElapsedTime(publishStarted).TotalMilliseconds,
            Stopwatch.GetElapsedTime(started).TotalMilliseconds);
    }

    private void CollectAndPublishAlarmsSync()
    {
        if (!_connection.IsConnected) return;

        if (!_dataReader.TryReadAlarms(out var currentAlarms)) return;

        var currentAlarmNos = currentAlarms.Select(a => a.AlarmNo).ToHashSet();
        var stateChanged = false;

        if (!_alarmStateInitialized)
        {
            _activeAlarms.Clear();
            foreach (var alarm in currentAlarms)
                _activeAlarms[alarm.AlarmNo] = alarm;

            PublishAlarmSnapshot(currentAlarms);
            _alarmStateInitialized = true;
            _lastAlarmSnapshot = DateTime.UtcNow;
            _logger.LogInformation("[ALARM-SNAPSHOT] initialized count={Count}", currentAlarms.Count);
        }

        // ── RAISE: 새로 발생한 알람 ──────────────────────────────────────
        foreach (var alarm in currentAlarms)
        {
            if (_activeAlarms.ContainsKey(alarm.AlarmNo)) continue;

            _activeAlarms[alarm.AlarmNo] = alarm; // 전체 AlarmInfo 보존 (clear 시 로그용)
            stateChanged = true;

            var alarmEvent = new AlarmEventMessage
            {
                MachineId     = _settings.MachineId,
                EventId       = Guid.NewGuid().ToString(),
                Type          = "occurred",
                AlarmNo       = alarm.AlarmNo,
                AlarmMsg      = alarm.Message,
                Category      = alarm.Category,
                AlarmTypeCode = alarm.Type,
            };
            _mqttService.PublishAlarmAsync(alarmEvent).GetAwaiter().GetResult();

            _logger.LogWarning(
                "[ALARM-RAISED] no={No} cat={Cat}(typeCode={TypeCode}) axis={Ax} msg={Msg}",
                alarm.AlarmNo, alarm.Category, alarm.Type, alarm.Axis, alarm.Message);

            // PS 타입(typeCode=3) 추가 관찰 로그 — #3006 매크로 오퍼레이터 메시지 후보
            if (alarm.Type == 3)
            {
                _logger.LogWarning(
                    "[ALARM-PS-CANDIDATE] no={No} cat={Cat}(typeCode={TypeCode}) msg={Msg} ts={Ts} " +
                    "→ #3006 매크로 오퍼레이터 메시지 후보 (실기기 확인 필요)",
                    alarm.AlarmNo, alarm.Category, alarm.Type, alarm.Message,
                    DateTime.UtcNow.ToString("HH:mm:ss.fff"));

                // 현재 활성 알람 전체 덤프 (PS 후보 발생 시 1회)
                var snapshot = _activeAlarms.Values.Select(a =>
                    $"no={a.AlarmNo} cat={a.Category}(typeCode={a.Type}) msg={a.Message}");
                _logger.LogWarning("[ALARM-ACTIVE-DUMP] count={Count} | {List}",
                    _activeAlarms.Count, string.Join(" / ", snapshot));
            }
        }

        // ── CLEAR: 사라진 알람 ───────────────────────────────────────────
        var clearedAlarmNos = _activeAlarms.Keys.Except(currentAlarmNos).ToList();
        foreach (var alarmNo in clearedAlarmNos)
        {
            _activeAlarms.TryGetValue(alarmNo, out var savedAlarm);
            _activeAlarms.Remove(alarmNo);
            stateChanged = true;

            var alarmEvent = new AlarmEventMessage
            {
                MachineId     = _settings.MachineId,
                EventId       = Guid.NewGuid().ToString(),
                Type          = "cleared",
                AlarmNo       = alarmNo,
                AlarmMsg      = "",
                Category      = savedAlarm?.Category,
                AlarmTypeCode = savedAlarm?.Type ?? 0,
            };
            _mqttService.PublishAlarmAsync(alarmEvent).GetAwaiter().GetResult();

            _logger.LogInformation(
                "[ALARM-CLEARED] no={No} cat={Cat}(typeCode={TypeCode})",
                alarmNo, savedAlarm?.Category ?? "?", savedAlarm?.Type ?? -1);
        }

        if (!stateChanged && DateTime.UtcNow - _lastAlarmSnapshot >= AlarmSnapshotInterval)
        {
            PublishAlarmSnapshot(currentAlarms);
            _lastAlarmSnapshot = DateTime.UtcNow;
        }

        // ── 오퍼레이터 메시지 수집 (rdopmsg2 / 1000ms 주기) ─────────────
        // ProbeOpMsg2()에서 NON-BLOCKING 확인된 경우에만 실행
        if (_opMsgSafe)
        {
            var sw = System.Diagnostics.Stopwatch.StartNew();
            var msgs = _dataReader.ReadOperatorMessages2();
            sw.Stop();

            // 응답 지연 경고 — 200ms 초과 시 잠재적 블로킹 의심
            if (sw.ElapsedMilliseconds > 200)
                _logger.LogWarning("[OPMSG2] 응답 지연 {Ms}ms — 블로킹 가능성 주의", sw.ElapsedMilliseconds);

            // 변화 감지 로그 (추가/제거된 메시지만)
            var prevTexts = _cachedOpMessages.Select(m => m.Message).ToHashSet();
            var newTexts  = msgs.Select(m => m.Message).ToHashSet();
            foreach (var m in msgs.Where(m => !prevTexts.Contains(m.Message)))
                _logger.LogInformation("[OPMSG2-NEW] type={T} no={No} msg={Msg}", m.MsgType, m.Number, m.Message);
            foreach (var prev in _cachedOpMessages.Where(m => !newTexts.Contains(m.Message)))
                _logger.LogInformation("[OPMSG2-GONE] msg={Msg}", prev.Message);

            // 캐시 업데이트 — 다음 텔레메트리 발행 시 포함
            _cachedOpMessages = msgs.Select(m => new OperatorMsgData
            {
                Number  = m.Number,
                MsgType = m.MsgType,
                Message = m.Message,
            }).ToList();
        }
    }

    private void PublishAlarmSnapshot(IEnumerable<AlarmInfo> alarms)
    {
        var snapshot = new AlarmSnapshotMessage
        {
            MachineId = _settings.MachineId,
            Alarms = alarms.Select(alarm => new AlarmSnapshotItem
            {
                AlarmNo = alarm.AlarmNo,
                AlarmMsg = alarm.Message,
                Category = alarm.Category,
                AlarmTypeCode = alarm.Type,
            }).ToList(),
        };

        _mqttService.PublishAlarmSnapshotAsync(snapshot).GetAwaiter().GetResult();
    }

    /// <summary>
    /// cnc_rdopmsg2 블로킹 여부 1회 프로브.
    /// FOCAS 스레드에서 호출. 응답 시간 기준으로 _opMsgSafe 플래그 설정.
    /// 500ms 초과 시 BLOCKING으로 판정 — 수집 루프에서 호출 금지.
    /// </summary>
    private void ProbeOpMsg2()
    {
        _logger.LogInformation("[OPMSG2-PROBE] cnc_rdopmsg2 블로킹 여부 프로브 시작...");
        var sw = System.Diagnostics.Stopwatch.StartNew();
        try
        {
            // ── 체계적 진단 프로브: 모든 (API버전 × type × n) 조합 시도 ──
            // EW_OK를 반환하는 조합을 찾기 위한 1회성 탐색
            short maxElapsed = 0;
            var sw0 = System.Diagnostics.Stopwatch.StartNew();

            // cnc_rdopmsg2 (64자 버퍼): type=-1/0/1, n=1/5
            foreach (short tp in new short[] { -1, 0, 1 })
            {
                foreach (short nn in new short[] { 1, 5 })
                {
                    var b2 = new Focas1.OPMSG2();
                    var t2 = System.Diagnostics.Stopwatch.StartNew();
                    short r2 = Focas1.cnc_rdopmsg2(_connection.Handle, tp, nn, b2);
                    t2.Stop();
                    if (t2.ElapsedMilliseconds > maxElapsed) maxElapsed = (short)t2.ElapsedMilliseconds;
                    _logger.LogInformation("[OPMSG-PROBE] rdopmsg2 type={T} n={N} → ret={R} {Ms}ms" +
                        (r2 == 0 ? " ★EW_OK★" : ""),
                        tp, nn, r2, t2.ElapsedMilliseconds);
                    if (r2 == Focas1.EW_OK)
                    {
                        foreach (var mx in new[] { b2.msg1, b2.msg2, b2.msg3, b2.msg4, b2.msg5 })
                            if (mx.char_num > 0)
                                _logger.LogInformation("[OPMSG-PROBE] ★ msg: type={T} no={No} text={Txt}",
                                    mx.type, mx.datano, mx.data?.TrimEnd('\0', ' '));
                    }
                }
            }

            // cnc_rdopmsg v1 (129자 버퍼): type=-1/0/1, n=1/5
            foreach (short tp in new short[] { -1, 0, 1 })
            {
                foreach (short nn in new short[] { 1, 5 })
                {
                    var b1 = new Focas1.OPMSG();
                    var t1 = System.Diagnostics.Stopwatch.StartNew();
                    short r1 = Focas1.cnc_rdopmsg(_connection.Handle, tp, nn, b1);
                    t1.Stop();
                    if (t1.ElapsedMilliseconds > maxElapsed) maxElapsed = (short)t1.ElapsedMilliseconds;
                    _logger.LogInformation("[OPMSG-PROBE] rdopmsg(v1) type={T} n={N} → ret={R} {Ms}ms" +
                        (r1 == 0 ? " ★EW_OK★" : ""),
                        tp, nn, r1, t1.ElapsedMilliseconds);
                    if (r1 == Focas1.EW_OK)
                    {
                        foreach (var mx in new[] { b1.msg1, b1.msg2, b1.msg3, b1.msg4, b1.msg5 })
                            if (mx.char_num > 0)
                                _logger.LogInformation("[OPMSG-PROBE] ★ msg: type={T} no={No} text={Txt}",
                                    mx.type, mx.datano, mx.data?.TrimEnd('\0', ' '));
                    }
                }
            }

            sw0.Stop();
            _logger.LogWarning("[OPMSG-PROBE] 전체 진단 완료. maxSingleMs={Max} totalMs={Total}",
                maxElapsed, sw0.ElapsedMilliseconds);

            if (maxElapsed < 500)
            {
                _opMsgSafe = true;
                _logger.LogInformation("[OPMSG-PROBE] NON-BLOCKING ✓ — 수집 루프 활성화");
            }
            else
            {
                _opMsgSafe = false;
                _logger.LogError("[OPMSG-PROBE] BLOCKING 판정 maxMs={Max} — 수집 루프 비활성화", maxElapsed);
            }
        }
        catch (Exception ex)
        {
            sw.Stop();
            _opMsgSafe = false;
            _logger.LogError(ex, "[OPMSG2-PROBE] 예외 발생 elapsed={Ms}ms — 수집 루프 비활성화", sw.ElapsedMilliseconds);
        }
    }

    private void DetectM20EdgeSync()
    {
        if (!_connection.IsConnected) return;

        var schedulerCfg = _templateLoader.CurrentTemplate?.SchedulerConfig;

        // ── 메인 M20 엣지 검출 ──
        // M20 주소는 SchedulerConfig.M20Addr에서 읽음 (하드코딩 금지)
        var m20AddrStr = schedulerCfg?.M20Addr;
        var m20Address = PmcAddress.ParseString(m20AddrStr);

        if (m20Address != null)
        {
            // ReadPmcR는 R영역만 읽으므로 M20Addr가 R타입이 아니면 항상 틀린 값을 읽는다.
            // 타입별 영역을 구분하는 ReadPmcBit를 사용한다.
            var m20Bit = _dataReader.ReadPmcBit(m20Address);
            if (m20Bit != null)
            {
                bool currentM20State = m20Bit == 1;

                if (currentM20State && !_lastM20State)
                {
                    _logger.LogInformation("M20 edge detected");

                    var program = _dataReader.ReadProgramInfo();
                    string? programNo = program != null ? $"O{program.CurrentProgram:D4}" : null;

                    // 스케줄러 실행 중이면 SchedulerManager에서 처리 (count authority = Agent)
                    bool schedulerConsumed = _schedulerManager.OnM20Edge(programNo);

                    if (!schedulerConsumed)
                    {
                        // 스케줄러 미실행 시 — 원시 M20_COMPLETE 이벤트 발행 (레거시 모니터링용)
                        int count = schedulerCfg != null
                            ? (_dataReader.ReadPartsCount(schedulerCfg.CountDisplay.CountMacroNo, schedulerCfg.CountDisplay.CountVarType) ?? 0)
                            : 0;

                        var eventMsg = new EventMessage
                        {
                            MachineId = _settings.MachineId,
                            EventType = "M20_COMPLETE",
                            ProgramNo = programNo,
                            Count     = count,
                        };
                        _mqttService.PublishEventAsync(eventMsg).GetAwaiter().GetResult();
                    }
                }

                _lastM20State = currentM20State;
            }
        }
    }

    private async Task PublishAgentStatus(string status)
    {
        var uptime = (long)(DateTime.UtcNow - _startTime).TotalSeconds;

        var statusMsg = new AgentStatusMessage
        {
            MachineId = _settings.MachineId,
            Status = status,
            Version = "1.0.0",
            Uptime = uptime,
            CncConnected = _connection.IsConnected
        };

        await _mqttService.PublishStatusAsync(statusMsg);
    }

    public override async Task StopAsync(CancellationToken cancellationToken)
    {
        _logger.LogInformation("Data collector service stopping...");

        await PublishAgentStatus("offline");
        _connection.Disconnect();
        await _mqttService.DisconnectAsync();

        await base.StopAsync(cancellationToken);
    }
}
