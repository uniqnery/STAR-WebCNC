using Newtonsoft.Json;

namespace StarWebCNC.Agent.Template;

/// <summary>
/// 장비 템플릿 모델
/// </summary>
public class MachineTemplate
{
    public string Id { get; set; } = "";
    public string TemplateId { get; set; } = "";
    public string Version { get; set; } = "";
    public string Name { get; set; } = "";
    public string? Description { get; set; }
    public string CncType { get; set; } = "";
    public string SeriesName { get; set; } = "";

    public PmcMap PmcMap { get; set; } = new();
    public InterlockConfig InterlockConfig { get; set; } = new();
    public SchedulerConfig SchedulerConfig { get; set; } = new();
    public CapabilitiesConfig Capabilities { get; set; } = new();
}

/// <summary>
/// PMC 어드레스 매핑
/// </summary>
public class PmcMap
{
    public OperationSignals Operation { get; set; } = new();
    public SchedulerSignals Scheduler { get; set; } = new();
    public MiscSignals Signals { get; set; } = new();
}

public class OperationSignals
{
    public PmcAddress? Running { get; set; }
    public PmcAddress? Alarm { get; set; }
    public PmcAddress? Emergency { get; set; }
}

public class SchedulerSignals
{
    public PmcAddress? Loadable { get; set; }
    public PmcAddress? DataReady { get; set; }
}

public class MiscSignals
{
    public PmcAddress? M20Complete { get; set; }
}

/// <summary>
/// PMC 어드레스 정의
/// </summary>
public class PmcAddress
{
    /// <summary>
    /// PMC 타입 (R, D, E, G, Y, X 등)
    /// </summary>
    public string Type { get; set; } = "R";

    /// <summary>
    /// 바이트 어드레스
    /// </summary>
    public int Address { get; set; }

    /// <summary>
    /// 비트 위치 (0-7)
    /// </summary>
    public int Bit { get; set; }
}

/// <summary>
/// 인터락 설정
/// </summary>
public class InterlockConfig
{
    public InterlockCondition ControlAllowed { get; set; } = new();
    public InterlockCondition ScheduleAllowed { get; set; } = new();
}

public class InterlockCondition
{
    public List<SignalCondition> Conditions { get; set; } = new();
}

public class SignalCondition
{
    /// <summary>
    /// 신호 경로 (예: "operation.running")
    /// </summary>
    public string Signal { get; set; } = "";

    /// <summary>
    /// 기대 값
    /// </summary>
    public bool Expected { get; set; }
}

/// <summary>
/// 스케줄러 설정
/// </summary>
public class SchedulerConfig
{
    public int MaxQueueSize { get; set; } = 15;
    public string CountSignal { get; set; } = "signals.m20Complete";
    public string CountMode { get; set; } = "M20_EDGE";
    public CountDisplay CountDisplay { get; set; } = new();
}

public class CountDisplay
{
    /// <summary>
    /// CNC 표시용 매크로 변수 번호
    /// </summary>
    public int MacroNo { get; set; } = 500;
}

/// <summary>
/// 기능 지원 여부
/// </summary>
public class CapabilitiesConfig
{
    public bool Monitoring { get; set; } = true;
    public bool Scheduler { get; set; } = true;
    public bool FileTransfer { get; set; } = true;
    public bool AlarmHistory { get; set; } = true;
}
