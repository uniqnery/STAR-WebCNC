using Newtonsoft.Json;

namespace StarWebCNC.Agent.Template;

// ─── Top-Level Template ─────────────────────────────────

/// <summary>
/// CNC 장비 템플릿 - 서버 API /api/templates에서 로드
/// </summary>
public class MachineTemplate
{
    public string Id { get; set; } = "";
    public string TemplateId { get; set; } = "";
    public string Version { get; set; } = "";
    public string Name { get; set; } = "";
    public string? Description { get; set; }

    // 빠른 조회용 단순 필드
    public string CncType { get; set; } = "";
    public string SeriesName { get; set; } = "";

    // 전체 시스템 정보
    public SystemInfo SystemInfo { get; set; } = new();

    // 축 구성 (path1/path2/path3)
    public AxisConfig AxisConfig { get; set; } = new();

    // PMC 어드레스 매핑 (신형 구조)
    public PmcMap PmcMap { get; set; } = new();

    // 페이지별 인터락 (탑바 pills = 인터락 조건 통합)
    public TopBarInterlockConfig TopBarInterlock { get; set; } = new();

    // 스케줄러 설정
    public SchedulerConfig SchedulerConfig { get; set; } = new();

    // 기능 지원 여부
    public CapabilitiesConfig Capabilities { get; set; } = new();

    // NC 데이터 설정 (Offset / Counter / Tool-Life)
    public OffsetConfig OffsetConfig { get; set; } = new();
    public CounterConfig CounterConfig { get; set; } = new();
    public ToolLifeConfig ToolLifeConfig { get; set; } = new();

    // PMC 비트 기반 메시지 정의
    public List<PmcMessageEntry> PmcMessages { get; set; } = new();

    // 조작반 패널 레이아웃 (램프 어드레스 수집용, 최소 파싱)
    public List<PanelGroupMinimal> PanelLayout { get; set; } = new();

    /// <summary>
    /// 패널에서 hasLamp=true이고 lampAddr이 있는 모든 주소 목록
    /// </summary>
    [JsonIgnore]
    public IEnumerable<string> PanelLampAddrs =>
        PanelLayout
            .SelectMany(g => g.Keys)
            .Where(k => k.HasLamp && !string.IsNullOrWhiteSpace(k.LampAddr))
            .Select(k => k.LampAddr!)
            .Distinct(StringComparer.OrdinalIgnoreCase);
}

// ─── Panel Layout (최소 파싱 — 램프 어드레스 수집용) ────────────

public class PanelGroupMinimal
{
    public List<PanelKeyMinimal> Keys { get; set; } = new();
}

public class PanelKeyMinimal
{
    public bool HasLamp { get; set; }
    [JsonProperty("lampAddr")]
    public string? LampAddr { get; set; }
}

// ─── System Info ────────────────────────────────────────

public class SystemInfo
{
    public string CncType { get; set; } = "FANUC";
    public string SeriesName { get; set; } = "";
    public string ModelName { get; set; } = "";
    public int MaxPaths { get; set; } = 1;
    /// <summary>
    /// 경로별 최대 표시 축수 (0 = 자동감지). 2-Path 기계에서 전체 축수가 감지될 때 캡핑용.
    /// 예) SB-20R2 Path1은 5축(X,Z,Y,C,B) 표시 → MaxAxes=5
    /// </summary>
    public int MaxAxes { get; set; } = 0;
    public List<string> SupportedOptions { get; set; } = new();
    /// <summary>
    /// 좌표 소수점 자릿수: IS-B=3(0.001mm), IS-C=4(0.0001mm). 기본값 3.
    /// 프론트엔드에서 raw 좌표값 / 10^CoordinateDecimalPlaces = mm 변환
    /// </summary>
    public int CoordinateDecimalPlaces { get; set; } = 3;
}

// ─── Axis Config ────────────────────────────────────────

public class PathAxisConfig
{
    public List<string>? Axes { get; set; }
    public string? SpindleName { get; set; }
    public string? ToolPrefix { get; set; }
}

public class AxisConfig
{
    public PathAxisConfig Path1 { get; set; } = new();
    public PathAxisConfig Path2 { get; set; } = new();
    public PathAxisConfig? Path3 { get; set; }
}

// ─── PMC Address ────────────────────────────────────────

/// <summary>
/// PMC 어드레스 정의 (구조화 형식)
/// </summary>
public class PmcAddress
{
    /// <summary>PMC 타입 (R, D, E, G, Y, X, F, K 등)</summary>
    public string Type { get; set; } = "R";

    /// <summary>바이트 어드레스</summary>
    public int Address { get; set; }

    /// <summary>비트 위치 (0-7)</summary>
    public int Bit { get; set; }

    /// <summary>데이터 타입 (bit, byte, word, dword)</summary>
    public string DataType { get; set; } = "bit";

    /// <summary>
    /// "R6001.3" 형식의 문자열을 PmcAddress로 파싱
    /// 형식: {Type}{Address}.{Bit}
    /// </summary>
    public static PmcAddress? ParseString(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;

        try
        {
            // 예: "R6001.3"
            var dotIdx = raw.IndexOf('.');
            if (dotIdx < 0) return null;

            var addrPart = raw[..dotIdx];    // "R6001"
            var bitPart  = raw[(dotIdx + 1)..]; // "3"

            var type    = addrPart[0].ToString().ToUpper();
            var address = int.Parse(addrPart[1..]);
            var bit     = int.Parse(bitPart);

            return new PmcAddress { Type = type, Address = address, Bit = bit };
        }
        catch
        {
            return null;
        }
    }
}

// ─── PMC Map (신형) ─────────────────────────────────────

public class PmcInterlockSignals
{
    public PmcAddress? DoorClosed { get; set; }
    public PmcAddress? ChuckClamped { get; set; }
    public PmcAddress? SpindleStopped { get; set; }
    public PmcAddress? CoolantLevel { get; set; }
}

public class PmcStatusSignals
{
    public PmcAddress? OperationMode { get; set; }
    public PmcAddress? CycleRunning { get; set; }
    public PmcAddress? AlarmActive { get; set; }
    public PmcAddress? EmergencyStop { get; set; }
    public PmcAddress? ProgramEnd { get; set; }
}

public class PmcControlSignals
{
    public PmcAddress? CycleStart { get; set; }
    public PmcAddress? FeedHold { get; set; }
    public PmcAddress? SingleBlock { get; set; }
    public PmcAddress? Reset { get; set; }
}

public class PmcCounterSignals
{
    public PmcAddress? PartCount { get; set; }
    public PmcAddress? TargetCount { get; set; }
    public PmcAddress? CycleTime { get; set; }
}

public class PmcSchedulerSignals
{
    public PmcAddress? Loadable { get; set; }
    public PmcAddress? DataReady { get; set; }
    public PmcAddress? M20Complete { get; set; }
}

/// <summary>
/// PMC 어드레스 맵 (신형 - 섹션별 분류)
/// </summary>
public class PmcMap
{
    public PmcInterlockSignals Interlock { get; set; } = new();
    public PmcStatusSignals Status { get; set; } = new();
    public PmcControlSignals Control { get; set; } = new();
    public PmcCounterSignals Counters { get; set; } = new();
    public PmcSchedulerSignals Scheduler { get; set; } = new();
}

// ─── Scheduler Config ────────────────────────────────────

public class SchedulerConfig
{
    public int MaxQueueSize { get; set; } = 15;
    public string CountSignal { get; set; } = "scheduler.m20Complete";
    public string CountMode { get; set; } = "M20_EDGE";
    public bool OneCycleStopSupported { get; set; } = false;
    public PmcAddress? OneCycleStopPmcAddress { get; set; }
    public CountDisplay CountDisplay { get; set; } = new();
    /// <summary>서브 스핀들 M20 신호 주소 (SB-20R2: R6002.5). null이면 서브 M20 미사용.</summary>
    public PmcAddress? SubM20Signal { get; set; }
}

public class CountDisplay
{
    /// <summary>CNC 표시용 매크로 변수 번호</summary>
    public int MacroNo { get; set; } = 500;
}

// ─── Capabilities ────────────────────────────────────────

public class CapabilitiesConfig
{
    public bool Monitoring { get; set; } = true;
    public bool Scheduler { get; set; } = true;
    public bool FileTransfer { get; set; } = true;
    public bool AlarmHistory { get; set; } = true;
    public bool RemoteControl { get; set; } = false;
    public bool HasSubSpindle { get; set; } = false;
    public bool HasCAxis { get; set; } = false;
    public bool HasYAxis { get; set; } = false;
}

// ─── TopBar Interlock Config ─────────────────────────────

/// <summary>
/// MachineTopBar 인터락 pill 하나의 정의 (PMC 주소 기반)
/// </summary>
public class TopBarInterlockField
{
    /// <summary>고유 식별자</summary>
    public string Id { get; set; } = "";

    /// <summary>탑바 pill 표시명</summary>
    public string Label { get; set; } = "";

    /// <summary>PMC 주소 (예: R6001.3)</summary>
    public string PmcAddr { get; set; } = "";

    /// <summary>접점 타입: "A" = 신호1이면 정상(녹색), "B" = 신호0이면 정상(녹색)</summary>
    public string Contact { get; set; } = "A";

    /// <summary>이 항목 표시 여부</summary>
    public bool Enabled { get; set; } = true;

    /// <summary>파싱된 PMC 어드레스 (런타임 캐시)</summary>
    [JsonIgnore]
    public PmcAddress? ParsedAddress => PmcAddress.ParseString(PmcAddr);
}

/// <summary>
/// 페이지별 인터락 설정 (전체 활성화 토글 + 필드 목록)
/// </summary>
public class TopBarInterlockPageConfig
{
    /// <summary>이 페이지 전체 인터락 활성화 여부 (false면 "인터락 OFF" 표시)</summary>
    public bool InterlockEnabled { get; set; } = true;

    /// <summary>인터락 항목 목록 (탑바 pills = 인터락 조건)</summary>
    public List<TopBarInterlockField> Fields { get; set; } = new();

    /// <summary>
    /// 모든 활성 조건이 충족되는지 AND 평가
    /// A접: 신호1=정상, B접: 신호0=정상
    /// pmcReader: (PmcAddress) => bool? (null=읽기 실패)
    /// </summary>
    public bool Evaluate(Func<PmcAddress, bool?> pmcReader)
    {
        if (!InterlockEnabled) return true;

        foreach (var field in Fields)
        {
            if (!field.Enabled) continue;

            var addr = field.ParsedAddress;
            if (addr == null) return false;

            var raw = pmcReader(addr);
            if (raw == null) return false;

            // A접: 신호1=OK(true), B접: 신호0=OK(true→반전)
            var ok = field.Contact == "A" ? raw.Value : !raw.Value;
            if (!ok) return false;
        }
        return true;
    }
}

public class TopBarInterlockConfig
{
    public TopBarInterlockPageConfig Remote    { get; set; } = new();
    public TopBarInterlockPageConfig Scheduler { get; set; } = new();
    public TopBarInterlockPageConfig Transfer  { get; set; } = new();
    public TopBarInterlockPageConfig Backup    { get; set; } = new();
}

// ─── Offset / Counter / Tool-Life Config ────────────────

public class OffsetConfig
{
    /// <summary>총 공구 수 (기본 64)</summary>
    public int ToolCount { get; set; } = 64;
    /// <summary>페이지당 표시 수 (기본 16)</summary>
    public int PageSize { get; set; } = 16;
}

public class CounterField
{
    public string Key { get; set; } = "";
    public string Label { get; set; } = "";
    /// <summary>"macro" | "pcode"</summary>
    public string VarType { get; set; } = "macro";
    public int VarNo { get; set; }
    public bool Readonly { get; set; }
    public string? Unit { get; set; }
}

public class CounterConfig
{
    public List<CounterField> Fields { get; set; } = new();
}

public class ToolLifeColumn
{
    public string Key { get; set; } = "";
    public string Label { get; set; } = "";
    /// <summary>"macro"(#) | "pcode"(P) | "ddata"(D)</summary>
    public string VarType { get; set; } = "macro";
    /// <summary>pcode/ddata일 때 PMC 데이터 폭: "byte" | "word" | "dword". macro는 null(항상 실수).</summary>
    public string? DataType { get; set; }
    public bool Readonly { get; set; }
    public string? Unit { get; set; }
}

public class ToolLifeEntry
{
    public string Id { get; set; } = "";
    /// <summary>공구 번호 표시 (예: "T0101"), 구분선일 때 ""</summary>
    public string ToolNo { get; set; } = "";
    /// <summary>true = 시각적 구분선 행 (VarNos 무시)</summary>
    public bool IsSeparator { get; set; }
    /// <summary>컬럼 키 → 변수 번호 (예: { "preset": 12001, "count": 12101 })</summary>
    public Dictionary<string, int> VarNos { get; set; } = new();
}

public class ToolLifePathConfig
{
    public int PathNo { get; set; } = 1;
    public List<ToolLifeColumn> Columns { get; set; } = new();
    public List<ToolLifeEntry> Entries { get; set; } = new();
}

public class ToolLifeConfig
{
    public List<ToolLifePathConfig> Paths { get; set; } = new();
}

/// <summary>
/// PMC 비트 기반 메시지 정의 — 해당 비트가 1(ON)이면 Web UI에 메시지 표시
/// </summary>
public class PmcMessageEntry
{
    public string Id { get; set; } = "";
    /// <summary>PMC 주소/비트 (예: "A209.5", "R6001.3")</summary>
    public string PmcAddr { get; set; } = "";
    /// <summary>표시할 메시지 내용</summary>
    public string Message { get; set; } = "";
}

// ─── EOF ─────────────────────────────────────────────────
