using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
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

    private readonly DateTime _startTime = DateTime.UtcNow;
    private bool _lastM20State = false;
    private readonly HashSet<int> _activeAlarms = new();

    public DataCollectorService(
        ILogger<DataCollectorService> logger,
        IOptions<AgentSettings> options,
        FocasConnection connection,
        FocasDataReader dataReader,
        MqttService mqttService,
        TemplateLoader templateLoader)
    {
        _logger = logger;
        _settings = options.Value;
        _connection = connection;
        _dataReader = dataReader;
        _mqttService = mqttService;
        _templateLoader = templateLoader;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("Data collector service starting...");

        // MQTT 연결
        await _mqttService.ConnectAsync(stoppingToken);

        // 템플릿 로드
        await _templateLoader.LoadTemplateAsync(stoppingToken);

        // CNC 연결
        await _connection.ConnectAsync(stoppingToken);

        // 초기 상태 발행
        await PublishAgentStatus("online");

        // 수집 타이머들 시작
        var telemetryTask = TelemetryLoopAsync(stoppingToken);
        var alarmTask = AlarmLoopAsync(stoppingToken);
        var pmcTask = PmcLoopAsync(stoppingToken);

        await Task.WhenAll(telemetryTask, alarmTask, pmcTask);
    }

    /// <summary>
    /// 텔레메트리 수집 루프
    /// </summary>
    private async Task TelemetryLoopAsync(CancellationToken stoppingToken)
    {
        var interval = TimeSpan.FromMilliseconds(_settings.Collector.TelemetryIntervalMs);

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await CollectAndPublishTelemetryAsync();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error in telemetry loop");
            }

            await Task.Delay(interval, stoppingToken);
        }
    }

    /// <summary>
    /// 알람 수집 루프
    /// </summary>
    private async Task AlarmLoopAsync(CancellationToken stoppingToken)
    {
        var interval = TimeSpan.FromMilliseconds(_settings.Collector.AlarmIntervalMs);

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await CollectAndPublishAlarmsAsync();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error in alarm loop");
            }

            await Task.Delay(interval, stoppingToken);
        }
    }

    /// <summary>
    /// PMC 신호 수집 루프 (M20 에지 감지 등)
    /// </summary>
    private async Task PmcLoopAsync(CancellationToken stoppingToken)
    {
        var interval = TimeSpan.FromMilliseconds(_settings.Collector.PmcIntervalMs);

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await DetectM20EdgeAsync();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error in PMC loop");
            }

            await Task.Delay(interval, stoppingToken);
        }
    }

    /// <summary>
    /// 텔레메트리 수집 및 발행
    /// </summary>
    private async Task CollectAndPublishTelemetryAsync()
    {
        if (!await _connection.EnsureConnectedAsync())
            return;

        var status = _dataReader.ReadStatus();
        var program = _dataReader.ReadProgramInfo();
        var feedrate = _dataReader.ReadFeedrate();
        var spindleSpeed = _dataReader.ReadSpindleSpeed();
        var absolutePos = _dataReader.ReadAbsolutePosition();
        var machinePos = _dataReader.ReadMachinePosition();

        // 파츠 카운트 (템플릿에서 매크로 변수 번호 가져오기)
        int partsCount = 0;
        if (_templateLoader.CurrentTemplate != null)
        {
            var macroNo = _templateLoader.CurrentTemplate.SchedulerConfig.CountDisplay.MacroNo;
            partsCount = _dataReader.ReadPartsCount(macroNo) ?? 0;
        }

        var telemetry = new TelemetryMessage
        {
            MachineId = _settings.MachineId,
            Data = new TelemetryData
            {
                RunState = status?.Run ?? 0,
                Mode = status?.ModeString ?? "UNKNOWN",
                ProgramNo = program != null ? $"O{program.CurrentProgram}" : null,
                Feedrate = feedrate ?? 0,
                SpindleSpeed = spindleSpeed ?? 0,
                PartsCount = partsCount,
                AlarmActive = status?.HasAlarm ?? false,
                AbsolutePosition = absolutePos?.Values,
                MachinePosition = machinePos?.Values
            }
        };

        await _mqttService.PublishTelemetryAsync(telemetry);
    }

    /// <summary>
    /// 알람 수집 및 발행
    /// </summary>
    private async Task CollectAndPublishAlarmsAsync()
    {
        if (!await _connection.EnsureConnectedAsync())
            return;

        var currentAlarms = _dataReader.ReadAlarms();
        var currentAlarmNos = currentAlarms.Select(a => a.AlarmNo).ToHashSet();

        // 새로 발생한 알람
        foreach (var alarm in currentAlarms)
        {
            if (!_activeAlarms.Contains(alarm.AlarmNo))
            {
                _activeAlarms.Add(alarm.AlarmNo);

                var alarmEvent = new AlarmEventMessage
                {
                    MachineId = _settings.MachineId,
                    EventId = Guid.NewGuid().ToString(),
                    Type = "occurred",
                    AlarmNo = alarm.AlarmNo,
                    AlarmMsg = alarm.Message,
                    Category = alarm.Category
                };

                await _mqttService.PublishAlarmAsync(alarmEvent);
                _logger.LogWarning("Alarm occurred: {AlarmNo} - {AlarmMsg}", alarm.AlarmNo, alarm.Message);
            }
        }

        // 해제된 알람
        var clearedAlarms = _activeAlarms.Except(currentAlarmNos).ToList();
        foreach (var alarmNo in clearedAlarms)
        {
            _activeAlarms.Remove(alarmNo);

            var alarmEvent = new AlarmEventMessage
            {
                MachineId = _settings.MachineId,
                EventId = Guid.NewGuid().ToString(),
                Type = "cleared",
                AlarmNo = alarmNo,
                AlarmMsg = ""
            };

            await _mqttService.PublishAlarmAsync(alarmEvent);
            _logger.LogInformation("Alarm cleared: {AlarmNo}", alarmNo);
        }
    }

    /// <summary>
    /// M20 신호 에지 감지
    /// </summary>
    private async Task DetectM20EdgeAsync()
    {
        if (!await _connection.EnsureConnectedAsync())
            return;

        var m20Address = _templateLoader.GetPmcAddress("signals.m20Complete");
        if (m20Address == null)
            return;

        // PMC R 영역 읽기
        var pmcData = _dataReader.ReadPmcR(m20Address.Address, 1);
        if (pmcData == null || pmcData.Length == 0)
            return;

        // 비트 추출
        bool currentM20State = (pmcData[0] & (1 << m20Address.Bit)) != 0;

        // 상승 에지 감지 (false → true)
        if (currentM20State && !_lastM20State)
        {
            _logger.LogInformation("M20 edge detected - Cycle complete");

            var program = _dataReader.ReadProgramInfo();

            // 파츠 카운트 읽기
            int count = 0;
            if (_templateLoader.CurrentTemplate != null)
            {
                var macroNo = _templateLoader.CurrentTemplate.SchedulerConfig.CountDisplay.MacroNo;
                count = _dataReader.ReadPartsCount(macroNo) ?? 0;
            }

            var eventMsg = new EventMessage
            {
                MachineId = _settings.MachineId,
                EventType = "M20_COMPLETE",
                ProgramNo = program != null ? $"O{program.CurrentProgram}" : null,
                Data = new Dictionary<string, object>
                {
                    { "count", count }
                }
            };

            await _mqttService.PublishEventAsync(eventMsg);
        }

        _lastM20State = currentM20State;
    }

    /// <summary>
    /// Agent 상태 발행
    /// </summary>
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
