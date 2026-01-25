namespace StarWebCNC.Agent.Configuration;

/// <summary>
/// Agent 전체 설정
/// </summary>
public class AgentSettings
{
    public const string SectionName = "Agent";

    /// <summary>
    /// Agent 식별자 (예: AGENT-001)
    /// </summary>
    public string AgentId { get; set; } = "AGENT-001";

    /// <summary>
    /// 담당 장비 ID (예: MC-001)
    /// </summary>
    public string MachineId { get; set; } = "MC-001";

    /// <summary>
    /// CNC 연결 설정
    /// </summary>
    public CncConnectionSettings Cnc { get; set; } = new();

    /// <summary>
    /// MQTT 브로커 설정
    /// </summary>
    public MqttSettings Mqtt { get; set; } = new();

    /// <summary>
    /// Server API 설정
    /// </summary>
    public ServerSettings Server { get; set; } = new();

    /// <summary>
    /// 데이터 수집 설정
    /// </summary>
    public CollectorSettings Collector { get; set; } = new();
}

/// <summary>
/// CNC 연결 설정
/// </summary>
public class CncConnectionSettings
{
    /// <summary>
    /// CNC IP 주소
    /// </summary>
    public string IpAddress { get; set; } = "192.168.1.101";

    /// <summary>
    /// CNC 포트 (FOCAS2 기본: 8193)
    /// </summary>
    public int Port { get; set; } = 8193;

    /// <summary>
    /// 연결 타임아웃 (초)
    /// </summary>
    public int TimeoutSeconds { get; set; } = 10;

    /// <summary>
    /// 재연결 시도 횟수
    /// </summary>
    public int RetryCount { get; set; } = 3;

    /// <summary>
    /// 재연결 대기 시간 (초)
    /// </summary>
    public int RetryDelaySeconds { get; set; } = 5;
}

/// <summary>
/// MQTT 브로커 설정
/// </summary>
public class MqttSettings
{
    /// <summary>
    /// MQTT 브로커 호스트
    /// </summary>
    public string Host { get; set; } = "localhost";

    /// <summary>
    /// MQTT 브로커 포트
    /// </summary>
    public int Port { get; set; } = 1883;

    /// <summary>
    /// 클라이언트 ID (자동 생성 시 빈 문자열)
    /// </summary>
    public string ClientId { get; set; } = "";

    /// <summary>
    /// Keep Alive 간격 (초)
    /// </summary>
    public int KeepAliveSeconds { get; set; } = 60;

    /// <summary>
    /// 자동 재연결 여부
    /// </summary>
    public bool AutoReconnect { get; set; } = true;
}

/// <summary>
/// Server API 설정
/// </summary>
public class ServerSettings
{
    /// <summary>
    /// Server API 기본 URL
    /// </summary>
    public string BaseUrl { get; set; } = "http://localhost:3000";

    /// <summary>
    /// API 타임아웃 (초)
    /// </summary>
    public int TimeoutSeconds { get; set; } = 30;
}

/// <summary>
/// 데이터 수집 설정
/// </summary>
public class CollectorSettings
{
    /// <summary>
    /// 상태 수집 주기 (밀리초)
    /// </summary>
    public int StatusIntervalMs { get; set; } = 500;

    /// <summary>
    /// 텔레메트리 발행 주기 (밀리초)
    /// </summary>
    public int TelemetryIntervalMs { get; set; } = 1000;

    /// <summary>
    /// 알람 체크 주기 (밀리초)
    /// </summary>
    public int AlarmIntervalMs { get; set; } = 1000;

    /// <summary>
    /// PMC 신호 체크 주기 (밀리초)
    /// </summary>
    public int PmcIntervalMs { get; set; } = 100;
}
