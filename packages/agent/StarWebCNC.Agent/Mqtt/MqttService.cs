using System.Text;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using MQTTnet;
using MQTTnet.Client;
using MQTTnet.Protocol;
using Newtonsoft.Json;
using StarWebCNC.Agent.Configuration;

namespace StarWebCNC.Agent.Mqtt;

/// <summary>
/// MQTT 클라이언트 서비스
/// </summary>
public class MqttService : IAsyncDisposable
{
    private readonly ILogger<MqttService> _logger;
    private readonly AgentSettings _settings;
    private readonly IMqttClient _client;
    private readonly MqttClientOptions _clientOptions;

    // 토픽 정의
    public static class Topics
    {
        // Agent → Server
        public static string AgentStatus(string machineId) => $"star-webcnc/agent/{machineId}/status";
        public static string Telemetry(string machineId) => $"star-webcnc/agent/{machineId}/telemetry";
        public static string PmcBits(string machineId)   => $"star-webcnc/agent/{machineId}/pmc_bits";
        public static string Alarm(string machineId) => $"star-webcnc/agent/{machineId}/alarm";
        public static string CommandResult(string machineId) => $"star-webcnc/agent/{machineId}/command/result";
        public static string Event(string machineId) => $"star-webcnc/agent/{machineId}/event";

        // Server → Agent
        public static string Command(string machineId) => $"star-webcnc/server/command/{machineId}";
        public const string CommandBroadcast = "star-webcnc/server/command";
        public static string ServerScheduler(string machineId) => $"star-webcnc/server/scheduler/{machineId}";
    }

    public bool IsConnected => _client.IsConnected;

    // 이벤트
    public event Func<CommandMessage, Task>? OnCommandReceived;
    public event Func<SchedulerMessage, Task>? OnSchedulerCommandReceived;
    public event Func<Task>? OnConnected;
    public event Func<Task>? OnDisconnected;

    public MqttService(
        ILogger<MqttService> logger,
        IOptions<AgentSettings> options)
    {
        _logger = logger;
        _settings = options.Value;

        var factory = new MqttFactory();
        _client = factory.CreateMqttClient();

        var clientId = string.IsNullOrEmpty(_settings.Mqtt.ClientId)
            ? $"star-webcnc-agent-{_settings.MachineId}-{Guid.NewGuid():N}"
            : _settings.Mqtt.ClientId;

        _clientOptions = new MqttClientOptionsBuilder()
            .WithTcpServer(_settings.Mqtt.Host, _settings.Mqtt.Port)
            .WithClientId(clientId)
            .WithKeepAlivePeriod(TimeSpan.FromSeconds(_settings.Mqtt.KeepAliveSeconds))
            .WithCleanSession(true)
            .Build();

        // 이벤트 핸들러 설정
        _client.ConnectedAsync += HandleConnectedAsync;
        _client.DisconnectedAsync += HandleDisconnectedAsync;
        _client.ApplicationMessageReceivedAsync += HandleMessageReceivedAsync;
    }

    /// <summary>
    /// MQTT 브로커에 연결
    /// </summary>
    public async Task ConnectAsync(CancellationToken cancellationToken = default)
    {
        try
        {
            _logger.LogInformation("Connecting to MQTT broker at {Host}:{Port}...",
                _settings.Mqtt.Host, _settings.Mqtt.Port);

            await _client.ConnectAsync(_clientOptions, cancellationToken);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to connect to MQTT broker");
            throw;
        }
    }

    /// <summary>
    /// MQTT 브로커 연결 해제
    /// </summary>
    public async Task DisconnectAsync()
    {
        if (_client.IsConnected)
        {
            await _client.DisconnectAsync();
            _logger.LogInformation("Disconnected from MQTT broker");
        }
    }

    /// <summary>
    /// Agent 상태 발행
    /// </summary>
    public async Task PublishStatusAsync(AgentStatusMessage status)
    {
        await PublishAsync(Topics.AgentStatus(_settings.MachineId), status);
    }

    /// <summary>
    /// 텔레메트리 데이터 발행
    /// </summary>
    public async Task PublishTelemetryAsync(TelemetryMessage telemetry)
    {
        await PublishAsync(Topics.Telemetry(_settings.MachineId), telemetry);
    }

    /// <summary>
    /// PMC 비트 빠른 발행 (100ms 주기 — 램프 응답속도용)
    /// </summary>
    public async Task PublishPmcBitsAsync(PmcBitsMessage pmcBits)
    {
        await PublishAsync(Topics.PmcBits(_settings.MachineId), pmcBits);
    }

    /// <summary>
    /// 알람 이벤트 발행
    /// </summary>
    public async Task PublishAlarmAsync(AlarmEventMessage alarm)
    {
        await PublishAsync(Topics.Alarm(_settings.MachineId), alarm);
    }

    /// <summary>
    /// 명령 실행 결과 발행
    /// </summary>
    public async Task PublishCommandResultAsync(CommandResultMessage result)
    {
        await PublishAsync(Topics.CommandResult(_settings.MachineId), result);
    }

    /// <summary>
    /// 이벤트 발행 (M20 등)
    /// </summary>
    public async Task PublishEventAsync(EventMessage eventMsg)
    {
        await PublishAsync(Topics.Event(_settings.MachineId), eventMsg);
    }

    /// <summary>
    /// 메시지 발행
    /// </summary>
    private async Task PublishAsync<T>(string topic, T message, MqttQualityOfServiceLevel qos = MqttQualityOfServiceLevel.AtLeastOnce)
    {
        if (!_client.IsConnected)
        {
            _logger.LogWarning("Cannot publish to {Topic}: Not connected to MQTT broker", topic);
            return;
        }

        try
        {
            var payload = JsonConvert.SerializeObject(message, new JsonSerializerSettings
            {
                NullValueHandling = NullValueHandling.Ignore,
                DateTimeZoneHandling = DateTimeZoneHandling.Utc,
                ContractResolver = new Newtonsoft.Json.Serialization.DefaultContractResolver
                {
                    NamingStrategy = new Newtonsoft.Json.Serialization.CamelCaseNamingStrategy
                    {
                        ProcessDictionaryKeys = false,  // Dictionary 키("R6001.3")는 대소문자 유지
                        OverrideSpecifiedNames = true
                    }
                }
            });

            var mqttMessage = new MqttApplicationMessageBuilder()
                .WithTopic(topic)
                .WithPayload(payload)
                .WithQualityOfServiceLevel(qos)
                .Build();

            await _client.PublishAsync(mqttMessage);
            _logger.LogDebug("Published message to {Topic}", topic);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to publish message to {Topic}", topic);
        }
    }

    private async Task HandleConnectedAsync(MqttClientConnectedEventArgs args)
    {
        _logger.LogInformation("Connected to MQTT broker");

        // 명령 토픽 구독
        var commandTopic = Topics.Command(_settings.MachineId);
        await _client.SubscribeAsync(new MqttTopicFilterBuilder()
            .WithTopic(commandTopic)
            .WithQualityOfServiceLevel(MqttQualityOfServiceLevel.AtLeastOnce)
            .Build());

        _logger.LogInformation("Subscribed to command topic: {Topic}", commandTopic);

        // 브로드캐스트 명령 토픽 구독
        await _client.SubscribeAsync(new MqttTopicFilterBuilder()
            .WithTopic(Topics.CommandBroadcast)
            .WithQualityOfServiceLevel(MqttQualityOfServiceLevel.AtLeastOnce)
            .Build());

        _logger.LogInformation("Subscribed to broadcast command topic");

        // 스케줄러 명령 토픽 구독
        var schedulerTopic = Topics.ServerScheduler(_settings.MachineId);
        await _client.SubscribeAsync(new MqttTopicFilterBuilder()
            .WithTopic(schedulerTopic)
            .WithQualityOfServiceLevel(MqttQualityOfServiceLevel.AtLeastOnce)
            .Build());

        _logger.LogInformation("Subscribed to scheduler topic: {Topic}", schedulerTopic);

        if (OnConnected != null)
            await OnConnected.Invoke();
    }

    private async Task HandleDisconnectedAsync(MqttClientDisconnectedEventArgs args)
    {
        _logger.LogWarning("Disconnected from MQTT broker. Reason: {Reason}",
            args.Reason);

        if (OnDisconnected != null)
            await OnDisconnected.Invoke();

        // 자동 재연결
        if (_settings.Mqtt.AutoReconnect)
        {
            _logger.LogInformation("Attempting to reconnect in 5 seconds...");
            await Task.Delay(5000);

            try
            {
                await _client.ConnectAsync(_clientOptions);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Reconnection failed");
            }
        }
    }

    private async Task HandleMessageReceivedAsync(MqttApplicationMessageReceivedEventArgs args)
    {
        var topic = args.ApplicationMessage.Topic;
        var payload = Encoding.UTF8.GetString(args.ApplicationMessage.PayloadSegment);

        _logger.LogInformation("Received message on {Topic} ({Bytes} bytes)", topic, payload.Length);

        try
        {
            // 명령 메시지 처리
            if (topic.Contains("/command"))
            {
                var command = JsonConvert.DeserializeObject<CommandMessage>(payload);
                if (command != null && OnCommandReceived != null)
                {
                    await OnCommandReceived.Invoke(command);
                }
            }
            // 스케줄러 명령 처리
            else if (topic.Contains("/scheduler/"))
            {
                var schedMsg = JsonConvert.DeserializeObject<SchedulerMessage>(payload);
                if (schedMsg != null && OnSchedulerCommandReceived != null)
                {
                    await OnSchedulerCommandReceived.Invoke(schedMsg);
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error processing message from {Topic}", topic);
        }
    }

    public async ValueTask DisposeAsync()
    {
        await DisconnectAsync();
        _client.Dispose();
    }
}

#region Message Models

public abstract class MqttMessage
{
    public string Timestamp { get; set; } = DateTime.UtcNow.ToString("o");
    public string? MachineId { get; set; }
}

public class AgentStatusMessage : MqttMessage
{
    public string Status { get; set; } = "online"; // online, offline, error
    public string Version { get; set; } = "1.0.0";
    public long Uptime { get; set; } // seconds
    public bool CncConnected { get; set; }
}

public class TelemetryMessage : MqttMessage
{
    public TelemetryData? Data { get; set; }
}

public class PathCoordinates
{
    [JsonProperty("absolute")]
    public int[] Absolute { get; set; } = new int[4];
    [JsonProperty("distanceToGo")]
    public int[] DistanceToGo { get; set; } = new int[4];
    /// <summary>
    /// 축별 소수점 자릿수 (ODBAXIS.type): IS-B=3(0.001mm), IS-C=4(0.0001mm)
    /// 프론트엔드에서 Math.pow(10, decimalPlaces[i])로 나눠서 mm 변환
    /// </summary>
    [JsonProperty("decimalPlaces")]
    public int[] DecimalPlaces { get; set; } = new int[4];
}

/// <summary>
/// 모달 G코드 + 실제 F/S 값 (프론트엔드 ModalGCodeInfo와 매핑)
/// </summary>
public class PathModal
{
    [JsonProperty("gCodeGrid")]
    public string[][] GCodeGrid { get; set; } = new[]
    {
        new[]{"","","",""}, new[]{"","","",""},
        new[]{"","","",""}, new[]{"","","",""},
        new[]{"","","",""}
    };
    [JsonProperty("feedActual")]
    public int FeedActual { get; set; }
    [JsonProperty("spindleActual")]
    public int SpindleActual { get; set; }
    [JsonProperty("repeatCurrent")]
    public int RepeatCurrent { get; set; }
    [JsonProperty("repeatTotal")]
    public int RepeatTotal { get; set; }
}

public class PathData
{
    [JsonProperty("programNo")]
    public string ProgramNo { get; set; } = string.Empty;
    [JsonProperty("blockNo")]
    public string BlockNo { get; set; } = string.Empty;
    [JsonProperty("programContent")]
    public string[] ProgramContent { get; set; } = Array.Empty<string>();
    [JsonProperty("currentLine")]
    public int CurrentLine { get; set; }
    [JsonProperty("axisNames")]
    public string[] AxisNames { get; set; } = Array.Empty<string>();
    [JsonProperty("coordinates")]
    public PathCoordinates Coordinates { get; set; } = new();
    [JsonProperty("modal")]
    public PathModal Modal { get; set; } = new();
    [JsonProperty("pathStatus")]
    public string PathStatus { get; set; } = "---- ---- ---- ---";
}

public class TelemetryData
{
    public int RunState { get; set; }
    public string? Mode { get; set; }
    public string? ProgramNo { get; set; }
    public int Feedrate { get; set; }
    public int SpindleSpeed { get; set; }
    public int PartsCount { get; set; }
    public bool AlarmActive { get; set; }
    public int[]? AbsolutePosition { get; set; }
    public int[]? MachinePosition { get; set; }

    /// <summary>Path1 (주축) 상세 데이터</summary>
    [JsonProperty("path1")]
    public PathData? Path1 { get; set; }

    /// <summary>Path2 (부축) 상세 데이터</summary>
    [JsonProperty("path2")]
    public PathData? Path2 { get; set; }

    /// <summary>
    /// PMC 비트 실시간 값 맵 — 탑바 인터락 pills 렌더링에 사용
    /// Key: "R6001.3" 형식, Value: 0 또는 1
    /// </summary>
    public Dictionary<string, int>? PmcBits { get; set; }

    /// <summary>
    /// 오퍼레이터 메시지 목록 (NC프로그램 #3006, 외부 신호 등)
    /// null이면 메시지 없음
    /// </summary>
    public List<OperatorMsgData>? OperatorMessages { get; set; }
}

public class OperatorMsgData
{
    public int    Number  { get; set; }
    public short  MsgType { get; set; }
    public string Message { get; set; } = "";
}

public class AlarmEventMessage : MqttMessage
{
    public string? EventId { get; set; }
    public string Type { get; set; } = "occurred"; // occurred, cleared
    public int AlarmNo { get; set; }
    public string? AlarmMsg { get; set; }
    public string? Category { get; set; }
    /// <summary>FOCAS cnc_rdalmmsg2 type 코드 (0=SW,1=PW,2=IO,3=PS,4=OT,5=OH,6=SV,7=SR,8=MC,9=SP,10=DS,11=IE,12=BG,13=SN)</summary>
    public short AlarmTypeCode { get; set; }
}

public class CommandMessage : MqttMessage
{
    public string? CorrelationId { get; set; }
    public string? Command { get; set; }
    public Dictionary<string, object>? Params { get; set; }
}

public class CommandResultMessage : MqttMessage
{
    public string? CorrelationId { get; set; }
    public string Status { get; set; } = "success"; // success, failure
    public string? ErrorCode { get; set; }
    public string? ErrorMessage { get; set; }
    public object? Result { get; set; }
}

public class EventMessage : MqttMessage
{
    public string EventType { get; set; } = "M20_COMPLETE";
    public string? ProgramNo { get; set; }
    /// <summary>스케줄러 행 ID (M20_COMPLETE, SCHEDULER_ROW_COMPLETED, SCHEDULER_PAUSED, SCHEDULER_ERROR)</summary>
    public string? RowId { get; set; }
    /// <summary>M20 카운트 값 (Agent authority)</summary>
    public int? Count { get; set; }
    /// <summary>에러/상태 코드 (SCHEDULER_ERROR, SCHEDULER_PAUSED)</summary>
    public string? Code { get; set; }
    /// <summary>에러 메시지 (SCHEDULER_ERROR, SCHEDULER_PAUSED)</summary>
    public string? Message { get; set; }
    public Dictionary<string, object>? Data { get; set; }
}

/// <summary>
/// 서버 → Agent 스케줄러 제어 메시지 (star-webcnc/server/scheduler/{machineId})
/// </summary>
public class SchedulerMessage : MqttMessage
{
    /// <summary>START | RESUME | PAUSE | CANCEL</summary>
    public string Type { get; set; } = "";
    /// <summary>START 시 큐 행 목록</summary>
    public List<SchedulerRowPayload>? Rows { get; set; }
    /// <summary>메인(Path1) 실행 모드 — "memory" | "dnc"</summary>
    public string MainMode { get; set; } = "memory";
    /// <summary>서브(Path2) 실행 모드 — "memory" | "dnc"</summary>
    public string SubMode { get; set; } = "memory";
    /// <summary>DNC 경로 설정 (mainMode 또는 subMode == "dnc" 시 사용)</summary>
    public DncPathsPayload? DncPaths { get; set; }
}

public class DncPathsPayload
{
    public string Path1 { get; set; } = "";
    public string Path2 { get; set; } = "";
    public string? Path3 { get; set; }
}

public class SchedulerRowPayload
{
    public string Id { get; set; } = "";
    public int Order { get; set; }
    public string MainProgramNo { get; set; } = "";
    public string? SubProgramNo { get; set; }
    public int Preset { get; set; }
    public int Count { get; set; }
    public string Status { get; set; } = "PENDING";
}

/// <summary>
/// PMC 비트 빠른 발행용 메시지 (pmc_bits 토픽, 100ms 주기)
/// 텔레메트리 전체를 발행하지 않고 pmcBits만 빠르게 전달하여 램프 응답 지연을 최소화
/// </summary>
public class PmcBitsMessage : MqttMessage
{
    /// <summary>PMC 비트 값 맵 — Key: "R6001.3", Value: 0|1</summary>
    public Dictionary<string, int>? PmcBits { get; set; }
}

#endregion
