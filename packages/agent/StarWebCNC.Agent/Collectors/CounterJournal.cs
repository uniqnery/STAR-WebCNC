using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Newtonsoft.Json;
using StarWebCNC.Agent.Configuration;
using StarWebCNC.Agent.Mqtt;

namespace StarWebCNC.Agent.Collectors;

public record CounterSample
{
    public DateTime At { get; init; } = DateTime.UtcNow;
    public string SessionId { get; init; } = "";
    public string? ProgramNo { get; init; }
    public string? ExecutingProgramNo { get; init; }
    public string? ProgramComment { get; init; }
    public string? SchedulerRowId { get; init; }
    public string? SchedulerComment { get; init; }
    public string? ProgramSha256 { get; init; }
    public string? OperatorMessages { get; init; }
    public string CounterSource { get; init; } = "";
    public int? Count { get; init; }
    public int? Preset { get; init; }
    public string State { get; init; } = "unknown";
    public bool? Green { get; init; }
    public bool? Red { get; init; }
}
public record CounterEvent
{
    public string EventId { get; init; } = Guid.NewGuid().ToString();
    public string MachineId { get; init; } = "";
    public string RunId { get; init; } = "";
    public long Sequence { get; init; }
    public CounterSample? Previous { get; init; }
    public CounterSample? CounterBefore { get; init; }
    public CounterSample Current { get; init; } = new();
    public bool Gap { get; init; }
    public string? AdjustmentId { get; init; }
    public string? AdjustmentField { get; init; }
}
public record CounterJournalState
{
    public CounterSample? Last { get; init; }
    public CounterSample? LastCounter { get; init; }
    public bool Gap { get; init; }
    public string? AdjustmentId { get; init; }
    public string? AdjustmentField { get; init; }
    public string RunId { get; init; } = Guid.NewGuid().ToString();
    public long Sequence { get; init; }
    public List<CounterEvent> Pending { get; init; } = new();
}

// A single atomic document holds the baseline AND unsent events. A restart cannot
// advance the baseline without retaining the corresponding event for replay.
public class CounterJournal : BackgroundService
{
    private readonly string _file, _machineId;
    private readonly string _session = Guid.NewGuid().ToString();
    private readonly MqttService _mqtt;
    private readonly ILogger<CounterJournal> _logger;
    private readonly object _gate = new();
    private CounterJournalState _state;
    public CounterJournal(MqttService mqtt, IOptions<AgentSettings> settings, ILogger<CounterJournal> logger)
    {
        _mqtt = mqtt; _logger = logger; _machineId = settings.Value.MachineId;
        if (!System.Text.RegularExpressions.Regex.IsMatch(_machineId, @"^MC-\d+$")) throw new ArgumentException("Invalid machine id");
        _file = Path.Combine(AppContext.BaseDirectory, "counter-journal", _machineId, "state.json");
        Directory.CreateDirectory(Path.GetDirectoryName(_file)!);
        // Corruption is never silently converted into a fresh baseline.
        _state = File.Exists(_file) ? JsonConvert.DeserializeObject<CounterJournalState>(File.ReadAllText(_file)) ?? throw new IOException("Invalid counter journal") : new();
        mqtt.OnCounterAckReceived += Acknowledge;
    }
    public static string MachineState(bool? green, bool? red) => green == true ? "running" : green == false && red == true ? "alarm_stop" : green == false && red == false ? "idle" : "unknown";
    public void Observe(CounterSample sample, bool force = false)
    {
        bool configured = sample.CounterSource.Length > 0 && !sample.CounterSource.StartsWith("FALLBACK_TEMPLATE:", StringComparison.Ordinal);
        lock (_gate) Capture(sample with { SessionId = _session, Count = configured && sample.Count >= 0 ? sample.Count : null, Preset = configured && sample.Preset >= 0 ? sample.Preset : null }, force);
    }
    private void Capture(CounterSample sample, bool force, string? adjustmentId = null, string? adjustmentField = null, bool beginAdjustment = false)
    {
        var last = _state.Last;
        if (!force && last != null && sample with { At = last.At, ExecutingProgramNo = last.ExecutingProgramNo } == last && sample.At - last.At < TimeSpan.FromSeconds(15)) return;
        if (last != null && sample.At < last.At) { _logger.LogError("Counter clock moved backwards; observation held"); return; }
        bool contextChanged = last != null && (last.ProgramNo != sample.ProgramNo || last.ProgramComment != sample.ProgramComment || last.SchedulerRowId != sample.SchedulerRowId || last.SchedulerComment != sample.SchedulerComment || last.CounterSource != sample.CounterSource);
        var runId = contextChanged ? Guid.NewGuid().ToString() : _state.RunId;
        var record = new CounterEvent { MachineId = _machineId, RunId = runId, Sequence = _state.Sequence + 1, Previous = last, CounterBefore = _state.LastCounter, Current = sample,
            Gap = _state.Gap || (_state.LastCounter != null && (_state.LastCounter.SessionId != sample.SessionId || sample.At - _state.LastCounter.At > TimeSpan.FromSeconds(30))),
            AdjustmentId = _state.AdjustmentId, AdjustmentField = _state.AdjustmentField };
        bool valid = sample.Count.HasValue && sample.Count >= 0 && sample.CounterSource.Length > 0;
        var pending = new List<CounterEvent>(_state.Pending) { record };
        var next = _state with { Last = sample, LastCounter = valid ? sample : _state.LastCounter, Gap = !valid || sample.State == "unknown", RunId = runId, Sequence = record.Sequence, Pending = pending,
            AdjustmentId = beginAdjustment ? adjustmentId : valid && sample.Preset.HasValue ? null : _state.AdjustmentId,
            AdjustmentField = beginAdjustment ? adjustmentField : valid && sample.Preset.HasValue ? null : _state.AdjustmentField };
        Save(next);
    }
    public void Disconnected()
    {
        lock (_gate) if (_state.Last is { } last && (last.State != "unknown" || last.Count.HasValue)) Capture(last with { At = DateTime.UtcNow, SessionId = _session, State = "unknown", Green = null, Red = null, Count = null, Preset = null }, true);
    }
    public void BeginAdjustment(string field, double before, string correlationId)
    {
        lock (_gate) if (_state.Last is { } last && double.IsFinite(before) && before >= 0 && before <= int.MaxValue && before == Math.Truncate(before))
            Capture(last with { At = DateTime.UtcNow, SessionId = _session, Count = field == "count" ? (int)before : last.Count, Preset = field == "preset" ? (int)before : last.Preset }, true, correlationId, field, true);
    }
    public void CompleteAdjustment(string field, double? after)
    {
        lock (_gate) if (_state.Last is { } last && after.HasValue && double.IsFinite(after.Value) && after >= 0 && after <= int.MaxValue && after == Math.Truncate(after.Value))
            Capture(last with { At = DateTime.UtcNow, SessionId = _session, Count = field == "count" ? (int)after.Value : last.Count, Preset = field == "preset" ? (int)after.Value : last.Preset }, true);
    }
    private void Save(CounterJournalState next)
    {
        using (var file = new FileStream(_file + ".tmp", FileMode.Create, FileAccess.Write, FileShare.None, 4096, FileOptions.WriteThrough))
        using (var writer = new StreamWriter(file)) { writer.Write(JsonConvert.SerializeObject(next)); writer.Flush(); file.Flush(true); }
        File.Move(_file + ".tmp", _file, true); _state = next;
    }
    public void Acknowledge(string id)
    {
        lock (_gate) if (_state.Pending.Any(p => p.EventId == id)) Save(_state with { Pending = _state.Pending.Where(p => p.EventId != id).ToList() });
    }
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try {
                CounterEvent[] batch; lock (_gate) batch = _state.Pending.Take(20).ToArray();
                if (_mqtt.IsConnected) foreach (var entry in batch) await _mqtt.PublishCounterAsync(entry);
            } catch (Exception ex) when (!stoppingToken.IsCancellationRequested) { _logger.LogWarning("Counter delivery pending: {Type}", ex.GetType().Name); }
            await Task.Delay(2000, stoppingToken);
        }
    }
}
