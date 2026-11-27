namespace StarWebCNC.Agent.Commands;

public static class CounterWriteRules
{
    public static bool IsQuantity(double value) => double.IsFinite(value) && value >= 0 && value <= int.MaxValue && value == Math.Truncate(value);
    public record PresetResult(bool Written, double? Count, string? ErrorCode);
    // Read the actual CNC count on the FOCAS thread immediately before writing.
    public static PresetResult WritePreset(double target, Func<double?> readCount, Func<double, bool> write)
    {
        if (!IsQuantity(target)) return new(false, null, "INVALID_COUNTER_VALUE");
        var count = readCount();
        if (!count.HasValue || !double.IsFinite(count.Value) || count < 0) return new(false, count, "COUNT_READ_FAILED");
        var nearest = Math.Round(count.Value);
        var normalized = Math.Abs(count.Value - nearest) < 0.000001 ? nearest : count.Value;
        if (target < normalized + 2) return new(false, normalized, "PRESET_BELOW_COUNT_PLUS_TWO");
        return new(write(target), normalized, null);
    }
}
