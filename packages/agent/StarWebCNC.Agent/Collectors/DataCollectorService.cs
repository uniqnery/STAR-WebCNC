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

    // rdopmsg2 안전성 플래그 — ProbeOpMsg2() 결과로 설정
    // false = 아직 미검증 또는 블로킹 의심 → 수집 루프 호출 금지
    // true  = 실기기에서 < 500ms 응답 확인 → 수집 루프 사용 가능
    private bool _opMsgSafe = false;

    // 마지막 수집된 오퍼레이터 메시지 캐시 — 다음 텔레메트리 발행 시 포함
    private List<OperatorMsgData> _cachedOpMessages = new();

    private int _coordinateDecimalPlaces = 3; // CNC 파라미터 1013 bit1(ISC)로 자동 감지

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

        // 수집 루프
        // 루프 슬립은 가장 짧은 주기(pmcInterval=100ms) 기준으로 실행
        // 각 작업은 elapsed 체크로 독립적인 주기로 실행됨
        var telemetryIntervalMs = _settings.Collector.TelemetryIntervalMs;
        var alarmIntervalMs     = _settings.Collector.AlarmIntervalMs;
        var pmcIntervalMs       = _settings.Collector.PmcIntervalMs;

        var telemetryInterval = TimeSpan.FromMilliseconds(telemetryIntervalMs);
        var alarmInterval     = TimeSpan.FromMilliseconds(alarmIntervalMs);
        var pmcInterval       = TimeSpan.FromMilliseconds(pmcIntervalMs);

        var lastTelemetry = DateTime.MinValue;
        var lastAlarm     = DateTime.MinValue;
        var lastPmc       = DateTime.MinValue;

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
                ProbeOpMsg2();
                PublishAgentStatus("online").GetAwaiter().GetResult();
            }

            var now = DateTime.UtcNow;

            // ── FOCAS 스레드에서 큐 명령 처리 (스레드 친화성 보장) ──
            while (_commandChannel.Reader.TryRead(out var cmd))
            {
                _logger.LogInformation("Executing command on FOCAS thread: {Cmd}", cmd.Command);
                try { _commandHandler.ExecuteOnFocasThread(cmd).GetAwaiter().GetResult(); }
                catch (Exception ex) { _logger.LogError(ex, "Error executing command: {Cmd}", cmd.Command); }
                _logger.LogInformation("Command completed on FOCAS thread: {Cmd}", cmd.Command);
            }

            // ── PMC 비트 빠른 발행 (100ms 주기 — 램프 응답속도) ──
            if (now - lastPmc >= pmcInterval)
            {
                lastPmc = now;
                try { CollectAndPublishPmcBitsSync(); }
                catch (Exception ex) { _logger.LogError(ex, "Error in PMC bits collection"); }
                try { DetectM20EdgeSync(); }
                catch (Exception ex) { _logger.LogError(ex, "Error in M20 edge detection"); }
                try { _schedulerManager.Tick(stoppingToken); }
                catch (Exception ex) { _logger.LogError(ex, "Error in scheduler tick"); }
            }

            // ── 전체 텔레메트리 발행 (1000ms 주기) ──
            if (now - lastTelemetry >= telemetryInterval)
            {
                lastTelemetry = now;
                try { CollectAndPublishTelemetrySync(); }
                catch (Exception ex) { _logger.LogError(ex, "Error in telemetry collection"); }
            }

            // ── 알람 체크 (1000ms 주기) ──
            if (now - lastAlarm >= alarmInterval)
            {
                lastAlarm = now;
                try { CollectAndPublishAlarmsSync(); }
                catch (Exception ex) { _logger.LogError(ex, "Error in alarm collection"); }
            }

            // pmcInterval(100ms) 단위 대기 — WaitOne으로 취소 가능 (스레드 전환 없음)
            stoppingToken.WaitHandle.WaitOne(pmcIntervalMs);
        }

        _logger.LogInformation("FOCAS worker thread exiting.");
    }

    // ── 동기 수집 메서드들 ─────────────────────────────────────────────

    /// <summary>
    /// PMC 비트 수집 + 빠른 발행 (100ms 주기)
    /// 인터락 어드레스 + 패널 램프 어드레스를 읽어 pmc_bits 토픽으로 발행.
    /// 텔레메트리 1000ms 주기와 독립적으로 동작하여 램프 응답 지연을 ~100ms로 단축.
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

        var uniqueAddrs = interlockAddrs
            .Concat(tpl.PanelLampAddrs)
            .Concat(pmcMessageAddrs)
            .Concat(tpl.ExtraPmcAddrs)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        if (uniqueAddrs.Count == 0) return;

        var pmcBits = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        foreach (var pmcAddrStr in uniqueAddrs)
        {
            var addr = PmcAddress.ParseString(pmcAddrStr);
            if (addr == null) continue;
            var bit = _dataReader.ReadPmcBit(addr);
            if (bit.HasValue)
                pmcBits[pmcAddrStr] = bit.Value;
        }

        if (pmcBits.Count == 0) return;

        var msg = new PmcBitsMessage
        {
            MachineId = _settings.MachineId,
            PmcBits   = pmcBits,
        };
        _mqttService.PublishPmcBitsAsync(msg).GetAwaiter().GetResult();
    }

    private void CollectAndPublishTelemetrySync()
    {
        if (!_connection.IsConnected) return;

        var status = _dataReader.ReadStatus();
        var program = _dataReader.ReadProgramInfo();
        var feedrate = _dataReader.ReadFeedrate();
        var spindleSpeed = _dataReader.ReadSpindleSpeed();
        var absolutePos = _dataReader.ReadAbsolutePosition();
        var machinePos = _dataReader.ReadMachinePosition();

        int partsCount = 0;
        int presetCount = 0;
        double cycleTime = 0.0;
        if (_templateLoader.CurrentTemplate != null)
        {
            var cd = _templateLoader.CurrentTemplate.SchedulerConfig.CountDisplay;
            partsCount  = _dataReader.ReadPartsCount(cd.CountMacroNo, cd.CountVarType) ?? 0;

            // Preset: CNC에서 직접 읽기 (스케줄러가 쓴 값을 확인)
            double? presetVal = string.Equals(cd.PresetVarType, "pcode", StringComparison.OrdinalIgnoreCase)
                ? _dataReader.ReadPcodeMacroVariable(cd.PresetMacroNo)
                : _dataReader.ReadMacroVariable(cd.PresetMacroNo);
            presetCount = presetVal.HasValue ? (int)presetVal.Value : 0;

            // 사이클타임: PMC D 어드레스 (래더 실행 주기 횟수 × multiplier = ms)
            double? ctMs = _dataReader.ReadCycleTimeMs(cd.CycleTimeAddr, cd.CycleTimeMultiplier);
            cycleTime = ctMs.HasValue ? ctMs.Value / 1000.0 : 0.0;
        }

        // 경로별 상세 데이터 (2-Path 자동선반용)
        var pathCount = _templateLoader.CurrentTemplate?.SystemInfo?.MaxPaths ?? 1;
        var maxAxes   = _templateLoader.CurrentTemplate?.SystemInfo?.MaxAxes ?? 0;
        var path1 = _dataReader.ReadPathData(1, _coordinateDecimalPlaces, maxAxes);
        var path2 = pathCount >= 2 ? _dataReader.ReadPathData(2, _coordinateDecimalPlaces, maxAxes) : null;

        var telemetry = new TelemetryMessage
        {
            MachineId = _settings.MachineId,
            Data = new TelemetryData
            {
                RunState = status?.Run ?? 0,
                Mode = status?.ModeString ?? "UNKNOWN",
                ProgramNo = program != null ? $"O{program.CurrentProgram:D4}" : null,
                Feedrate = feedrate ?? 0,
                SpindleSpeed = spindleSpeed ?? 0,
                PartsCount = partsCount,
                PresetCount = presetCount,
                CycleTime = cycleTime,
                AlarmActive = status?.HasAlarm ?? false,
                AbsolutePosition = absolutePos?.Values,
                MachinePosition = machinePos?.Values,
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
        _mqttService.PublishTelemetryAsync(telemetry).GetAwaiter().GetResult();
    }

    private void CollectAndPublishAlarmsSync()
    {
        if (!_connection.IsConnected) return;

        var currentAlarms = _dataReader.ReadAlarms();
        var currentAlarmNos = currentAlarms.Select(a => a.AlarmNo).ToHashSet();

        // ── RAISE: 새로 발생한 알람 ──────────────────────────────────────
        foreach (var alarm in currentAlarms)
        {
            if (_activeAlarms.ContainsKey(alarm.AlarmNo)) continue;

            _activeAlarms[alarm.AlarmNo] = alarm; // 전체 AlarmInfo 보존 (clear 시 로그용)

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
            var pmcData = _dataReader.ReadPmcR(m20Address.Address, 1);
            if (pmcData != null && pmcData.Length > 0)
            {
                bool currentM20State = (pmcData[0] & (1 << m20Address.Bit)) != 0;

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
