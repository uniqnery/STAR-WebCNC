namespace StarWebCNC.Agent.Commands;

// Called only on the FOCAS thread: read -> calculate -> write -> read back.
public static class VerifiedDataWrite
{
    public record Outcome(double? BeforeValue, double? Value, double RequestedValue, double? AdditiveDelta, bool Written, string? ErrorCode);
    public static Outcome Execute(Func<double?> read, Func<double, bool> write, double input, double? delta = null)
    {
        if (!double.IsFinite(input) || (delta.HasValue && !double.IsFinite(delta.Value)))
            return new(null, null, input, delta, false, "INVALID_PARAMS");
        var before = read();
        if (!before.HasValue || !double.IsFinite(before.Value)) return new(before, null, input, delta, false, "READ_BEFORE_FAILED");
        var target = delta.HasValue ? before.Value + delta.Value : input;
        if (!double.IsFinite(target)) return new(before, null, target, delta, false, "INVALID_PARAMS");
        if (!write(target)) return new(before, null, target, delta, false, "WRITE_UNCONFIRMED");
        var after = read();
        if (!after.HasValue || !double.IsFinite(after.Value) || Math.Abs(after.Value - target) > 0.00005)
            return new(before, after, target, delta, true, "WRITE_UNCONFIRMED");
        return new(before, after, target, delta, true, null);
    }
}
