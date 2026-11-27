namespace StarWebCNC.Agent.Collectors;
public class M20EdgeDetector
{
    private bool _initialized, _previous;
    public void Reset() => _initialized = false;
    public bool Observe(bool current)
    {
        if (!_initialized) { _initialized = true; _previous = current; return false; }
        var rising = current && !_previous; _previous = current; return rising;
    }
}
