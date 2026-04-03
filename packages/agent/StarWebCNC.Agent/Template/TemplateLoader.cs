using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Newtonsoft.Json;
using StarWebCNC.Agent.Configuration;

namespace StarWebCNC.Agent.Template;

/// <summary>
/// 템플릿 로더 - 서버 API /api/templates/{templateId}에서 로드 및 캐싱
/// </summary>
public class TemplateLoader
{
    private readonly ILogger<TemplateLoader> _logger;
    private readonly AgentSettings _settings;
    private readonly HttpClient _httpClient;
    private readonly IMemoryCache _cache;
    private const string CacheKey = "machine_template";
    private static readonly TimeSpan CacheDuration = TimeSpan.FromMinutes(30);

    public MachineTemplate? CurrentTemplate { get; private set; }

    public TemplateLoader(
        ILogger<TemplateLoader> logger,
        IOptions<AgentSettings> options,
        IHttpClientFactory httpClientFactory,
        IMemoryCache cache)
    {
        _logger = logger;
        _settings = options.Value;
        _httpClient = httpClientFactory.CreateClient("ServerApi");
        _cache = cache;
    }

    /// <summary>
    /// 서버에서 템플릿 로드 (캐시 우선)
    /// URL: /api/templates/{templateId}
    /// </summary>
    public async Task<MachineTemplate?> LoadTemplateAsync(CancellationToken cancellationToken = default)
    {
        if (_cache.TryGetValue(CacheKey, out MachineTemplate? cachedTemplate))
        {
            _logger.LogDebug("Template loaded from cache");
            CurrentTemplate = cachedTemplate;
            return cachedTemplate;
        }

        try
        {
            var templateId = _settings.TemplateId;
            var url = $"{_settings.Server.BaseUrl}/api/templates/{templateId}";
            _logger.LogInformation("Loading template from {Url}", url);

            var response = await _httpClient.GetAsync(url, cancellationToken);

            if (!response.IsSuccessStatusCode)
            {
                _logger.LogWarning("Failed to load template. Status: {StatusCode}", response.StatusCode);
                return LoadFallbackTemplate();
            }

            var json = await response.Content.ReadAsStringAsync(cancellationToken);
            var apiResponse = JsonConvert.DeserializeObject<ApiResponse<MachineTemplate>>(json);

            if (apiResponse?.Success != true || apiResponse.Data == null)
            {
                _logger.LogWarning("Invalid template response from server");
                return LoadFallbackTemplate();
            }

            var template = apiResponse.Data;
            _cache.Set(CacheKey, template, CacheDuration);
            CurrentTemplate = template;

            _logger.LogInformation("Template loaded: {TemplateId} v{Version}",
                template.TemplateId, template.Version);

            return template;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error loading template from server");
            return LoadFallbackTemplate();
        }
    }

    /// <summary>
    /// 캐시 무효화 후 서버에서 재로드
    /// MQTT RELOAD_TEMPLATE 명령 수신 시 호출
    /// </summary>
    public async Task<MachineTemplate?> ReloadTemplateAsync(CancellationToken cancellationToken = default)
    {
        _cache.Remove(CacheKey);
        _logger.LogInformation("Template cache cleared. Reloading...");
        return await LoadTemplateAsync(cancellationToken);
    }

    /// <summary>
    /// 서버 연결 불가 시 기본 템플릿 (최소 동작 보장)
    /// </summary>
    private MachineTemplate LoadFallbackTemplate()
    {
        _logger.LogWarning("Using fallback template - server unavailable");

        var fallback = new MachineTemplate
        {
            TemplateId = "FALLBACK_TEMPLATE",
            Version = "1.0.0",
            Name = "Fallback Template",
            CncType = "FANUC",
            SeriesName = "0i-TF",
            PmcMap = new PmcMap
            {
                Status = new PmcStatusSignals
                {
                    CycleRunning  = new PmcAddress { Type = "R", Address = 6003, Bit = 0 },
                    AlarmActive   = new PmcAddress { Type = "R", Address = 6001, Bit = 1 },
                    EmergencyStop = new PmcAddress { Type = "R", Address = 6001, Bit = 2 }
                },
                Scheduler = new PmcSchedulerSignals
                {
                    Loadable    = new PmcAddress { Type = "R", Address = 100, Bit = 0 },
                    DataReady   = new PmcAddress { Type = "R", Address = 100, Bit = 1 },
                    M20Complete = new PmcAddress { Type = "R", Address = 6002, Bit = 4 }
                },
            },
            SchedulerConfig = new SchedulerConfig
            {
                MaxQueueSize = 15,
                M20Addr      = "",   // 폴백 템플릿: M20 주소 미설정 (스케줄러 비활성화)
                CountDisplay = new CountDisplay { CountMacroNo = 900, CountVarType = "macro", PresetMacroNo = 10000, PresetVarType = "pcode", CycleTimeAddr = "D96", CycleTimeMultiplier = 4 }
            },
            Capabilities = new CapabilitiesConfig
            {
                Monitoring    = true,
                Scheduler     = false, // 폴백에서는 스케줄러 비활성화
                FileTransfer  = false,
                AlarmHistory  = true
            }
        };

        CurrentTemplate = fallback;
        return fallback;
    }

    /// <summary>
    /// 신호 경로 문자열로 PMC 어드레스 조회
    /// 형식: "section.signalName" (예: "scheduler.m20Complete", "status.cycleRunning")
    /// </summary>
    public PmcAddress? GetPmcAddress(string signalPath)
    {
        if (CurrentTemplate == null) return null;

        var parts = signalPath.Split('.');
        if (parts.Length != 2) return null;

        var map = CurrentTemplate.PmcMap;

        return parts[0].ToLower() switch
        {
            "status" => parts[1].ToLower() switch
            {
                "cyclerunning"  => map.Status.CycleRunning,
                "alarmactive"   => map.Status.AlarmActive,
                "emergencystop" => map.Status.EmergencyStop,
                "operationmode" => map.Status.OperationMode,
                "programend"    => map.Status.ProgramEnd,
                _ => null
            },
            "control" => parts[1].ToLower() switch
            {
                "cyclestart"  => map.Control.CycleStart,
                "feedhold"    => map.Control.FeedHold,
                "singleblock" => map.Control.SingleBlock,
                "reset"       => map.Control.Reset,
                _ => null
            },
            "interlock" => parts[1].ToLower() switch
            {
                "doorclosed"    => map.Interlock.DoorClosed,
                "chuckclamped"  => map.Interlock.ChuckClamped,
                "spindlestopped"=> map.Interlock.SpindleStopped,
                "coolantlevel"  => map.Interlock.CoolantLevel,
                _ => null
            },
            "scheduler" => parts[1].ToLower() switch
            {
                "loadable"    => map.Scheduler.Loadable,
                "dataready"   => map.Scheduler.DataReady,
                "m20complete" => map.Scheduler.M20Complete,
                _ => null
            },
            "counters" => parts[1].ToLower() switch
            {
                "partcount"   => map.Counters.PartCount,
                "targetcount" => map.Counters.TargetCount,
                "cycletime"   => map.Counters.CycleTime,
                _ => null
            },
            _ => null
        };
    }
}

internal class ApiResponse<T>
{
    public bool Success { get; set; }
    public T? Data { get; set; }
}
