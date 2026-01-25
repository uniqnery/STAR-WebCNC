using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Newtonsoft.Json;
using StarWebCNC.Agent.Configuration;

namespace StarWebCNC.Agent.Template;

/// <summary>
/// 템플릿 로더 (서버에서 템플릿 로드 및 캐싱)
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
    /// 서버에서 템플릿 로드
    /// </summary>
    public async Task<MachineTemplate?> LoadTemplateAsync(CancellationToken cancellationToken = default)
    {
        // 캐시 확인
        if (_cache.TryGetValue(CacheKey, out MachineTemplate? cachedTemplate))
        {
            _logger.LogDebug("Template loaded from cache");
            CurrentTemplate = cachedTemplate;
            return cachedTemplate;
        }

        try
        {
            var url = $"{_settings.Server.BaseUrl}/api/machines/{_settings.MachineId}/template";
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

            // 캐시 저장
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
    /// 캐시 무효화 및 리로드
    /// </summary>
    public async Task<MachineTemplate?> ReloadTemplateAsync(CancellationToken cancellationToken = default)
    {
        _cache.Remove(CacheKey);
        return await LoadTemplateAsync(cancellationToken);
    }

    /// <summary>
    /// 서버 연결 불가 시 기본 템플릿 사용
    /// </summary>
    private MachineTemplate LoadFallbackTemplate()
    {
        _logger.LogWarning("Using fallback template");

        var fallback = new MachineTemplate
        {
            TemplateId = "FALLBACK_TEMPLATE",
            Version = "1.0.0",
            Name = "Fallback Template",
            CncType = "FANUC",
            SeriesName = "0i-TF",
            PmcMap = new PmcMap
            {
                Operation = new OperationSignals
                {
                    Running = new PmcAddress { Type = "R", Address = 0, Bit = 0 },
                    Alarm = new PmcAddress { Type = "R", Address = 0, Bit = 1 },
                    Emergency = new PmcAddress { Type = "R", Address = 0, Bit = 2 }
                },
                Scheduler = new SchedulerSignals
                {
                    Loadable = new PmcAddress { Type = "R", Address = 100, Bit = 0 },
                    DataReady = new PmcAddress { Type = "R", Address = 100, Bit = 1 }
                },
                Signals = new MiscSignals
                {
                    M20Complete = new PmcAddress { Type = "R", Address = 200, Bit = 0 }
                }
            },
            SchedulerConfig = new SchedulerConfig
            {
                MaxQueueSize = 15,
                CountSignal = "signals.m20Complete",
                CountMode = "M20_EDGE",
                CountDisplay = new CountDisplay { MacroNo = 500 }
            },
            Capabilities = new CapabilitiesConfig
            {
                Monitoring = true,
                Scheduler = false, // 폴백에서는 스케줄러 비활성화
                FileTransfer = false,
                AlarmHistory = true
            }
        };

        CurrentTemplate = fallback;
        return fallback;
    }

    /// <summary>
    /// PMC 신호 경로로 어드레스 찾기
    /// </summary>
    public PmcAddress? GetPmcAddress(string signalPath)
    {
        if (CurrentTemplate == null)
            return null;

        var parts = signalPath.Split('.');
        if (parts.Length != 2)
            return null;

        return parts[0].ToLower() switch
        {
            "operation" => parts[1].ToLower() switch
            {
                "running" => CurrentTemplate.PmcMap.Operation.Running,
                "alarm" => CurrentTemplate.PmcMap.Operation.Alarm,
                "emergency" => CurrentTemplate.PmcMap.Operation.Emergency,
                _ => null
            },
            "scheduler" => parts[1].ToLower() switch
            {
                "loadable" => CurrentTemplate.PmcMap.Scheduler.Loadable,
                "dataready" => CurrentTemplate.PmcMap.Scheduler.DataReady,
                _ => null
            },
            "signals" => parts[1].ToLower() switch
            {
                "m20complete" => CurrentTemplate.PmcMap.Signals.M20Complete,
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
