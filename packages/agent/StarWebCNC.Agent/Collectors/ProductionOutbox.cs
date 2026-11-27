using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Newtonsoft.Json;
using StarWebCNC.Agent.Configuration;
using StarWebCNC.Agent.Mqtt;
using System.Collections.Concurrent;
namespace StarWebCNC.Agent.Collectors;

public class ProductionCompletion
{
    public string EventId { get; set; } = Guid.NewGuid().ToString();
    public string MachineId { get; set; } = "";
    public string? RunId { get; set; }
    public DateTime OccurredAt { get; set; } = DateTime.UtcNow;
    public string? ProgramNo { get; set; }
    public string? ExecutingProgramNo { get; set; }
    public string? ProgramComment { get; set; }
    public string? SchedulerRowId { get; set; }
    public string? SchedulerComment { get; set; }
    public string? ProgramSha256 { get; set; }
}

public class ProductionOutbox : BackgroundService
{
    private readonly MqttService _mqtt;
    private readonly AgentSettings _settings;
    private readonly ILogger<ProductionOutbox> _logger;
    private readonly string _directory;
    private readonly ConcurrentDictionary<string, ProductionCompletion> _pending = new();
    private string? _runSignature;
    private string _runId = Guid.NewGuid().ToString();
    private readonly object _gate = new();
    public ProductionOutbox(MqttService mqtt, IOptions<AgentSettings> settings, ILogger<ProductionOutbox> logger)
    {
        _mqtt = mqtt; _settings = settings.Value; _logger = logger;
        if (!System.Text.RegularExpressions.Regex.IsMatch(_settings.MachineId, @"^MC-\d+$")) throw new ArgumentException("Invalid machine id");
        _directory = Path.Combine(AppContext.BaseDirectory, "production-outbox", _settings.MachineId);
        Directory.CreateDirectory(_directory);
        mqtt.OnProductionAckReceived += Acknowledge;
    }
    public void Acknowledge(string id) { if (Guid.TryParseExact(id, "D", out _)) File.Delete(Path.Combine(_directory, id + ".json")); }
    public void Record(ProductionCompletion completion)
    {
        completion.MachineId = _settings.MachineId;
        var signature = JsonConvert.SerializeObject(new { completion.ProgramNo, completion.SchedulerRowId, completion.SchedulerComment, completion.ProgramComment, completion.ProgramSha256 });
        if (_runSignature != signature) { _runSignature = signature; _runId = Guid.NewGuid().ToString(); }
        completion.RunId = _runId;
        _pending[completion.EventId] = completion;
        Persist(completion);
    }
    private void Persist(ProductionCompletion completion)
    {
        lock (_gate) {
        try {
            var path = Path.Combine(_directory, completion.EventId + ".json");
            using (var file = new FileStream(path + ".tmp", FileMode.Create, FileAccess.Write, FileShare.None, 4096, FileOptions.WriteThrough))
            using (var writer = new StreamWriter(file)) { writer.Write(JsonConvert.SerializeObject(completion)); writer.Flush(); file.Flush(true); }
            File.Move(path + ".tmp", path, true); _pending.TryRemove(completion.EventId, out _);
        } catch { _logger.LogError("Production event remains in memory; journal storage needs inspection: {EventId}", completion.EventId); }
        }
    }
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        foreach (var temporary in Directory.EnumerateFiles(_directory, "*.json.tmp"))
        {
            try { var record = JsonConvert.DeserializeObject<ProductionCompletion>(await File.ReadAllTextAsync(temporary, stoppingToken));
                if (record?.MachineId == _settings.MachineId && Guid.TryParseExact(record.EventId, "D", out _)) File.Move(temporary, Path.Combine(_directory, record.EventId + ".json"), true); }
            catch { _logger.LogError("Production journal recovery needs inspection: {File}", Path.GetFileName(temporary)); }
        }
        while (!stoppingToken.IsCancellationRequested)
        {
            try {
                foreach (var completion in _pending.Values) Persist(completion);
                if (_mqtt.IsConnected) foreach (var file in new DirectoryInfo(_directory).GetFiles("*.json").OrderBy(f => f.CreationTimeUtc).Take(20))
                {
                    try {
                        var completion = JsonConvert.DeserializeObject<ProductionCompletion>(await File.ReadAllTextAsync(file.FullName, stoppingToken));
                        if (completion?.MachineId != _settings.MachineId || !Guid.TryParseExact(completion.EventId, "D", out _)) throw new JsonException("Invalid production journal");
                        await _mqtt.PublishProductionAsync(completion);
                    } catch (FileNotFoundException) { /* Acknowledged while the batch was being read. */ }
                    catch (JsonException) { File.Move(file.FullName, file.FullName + ".quarantine", true); _logger.LogError("Production journal quarantined for inspection: {File}", file.Name); }
                }
            } catch (Exception ex) when (!stoppingToken.IsCancellationRequested) { _logger.LogWarning("Production delivery pending: {Type}", ex.GetType().Name); }
            await Task.Delay(2000, stoppingToken);
        }
    }
}
