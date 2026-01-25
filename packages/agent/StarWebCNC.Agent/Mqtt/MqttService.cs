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
        public static string Alarm(string machineId) => $"star-webcnc/agent/{machineId}/alarm";
        public static string CommandResult(string machineId) => $"star-webcnc/agent/{machineId}/command/result";
        public static string Event(string machineId) => $"star-webcnc/agent/{machineId}/event";

        // Server → Agent
        public static string Command(string machineId) => $"star-webcnc/server/command/{machineId}";
        public const string CommandBroadcast = "star-webcnc/server/command";
    }

    public bool IsConnected => _client.IsConnected;

    // 이벤트
    public event Func<CommandMessage, Task>? OnCommandReceived;
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
                DateTimeZoneHandling = DateTimeZoneHandling.Utc
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

        _logger.LogDebug("Received message on {Topic}", topic);

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
}

public class AlarmEventMessage : MqttMessage
{
    public string? EventId { get; set; }
    public string Type { get; set; } = "occurred"; // occurred, cleared
    public int AlarmNo { get; set; }
    public string? AlarmMsg { get; set; }
    public string? Category { get; set; }
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
    public Dictionary<string, object>? Data { get; set; }
}

#endregion
