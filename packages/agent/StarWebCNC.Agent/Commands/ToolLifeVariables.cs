namespace StarWebCNC.Agent.Commands;

// Keep tool-life reads, writes and read-back verification on the same variable API.
public static class ToolLifeVariables
{
    public static double? Read(string type, Func<double?> macro, Func<double?> pcode, Func<double?> ddata)
        => type switch { "macro" => macro(), "pcode" => pcode(), "ddata" => ddata(), _ => null };

    public static bool Write(string type, Func<bool> macro, Func<bool> pcode, Func<bool> ddata)
        => type switch { "macro" => macro(), "pcode" => pcode(), "ddata" => ddata(), _ => false };
}
