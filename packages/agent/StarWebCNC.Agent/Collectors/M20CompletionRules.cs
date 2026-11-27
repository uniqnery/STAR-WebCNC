namespace StarWebCNC.Agent.Collectors;
public enum M20CompletionKind { Production, SkipFirst, Path2Only }
public static class M20CompletionRules
{
    public static M20CompletionKind Classify(bool skipFirst, bool path2Only) =>
        skipFirst ? M20CompletionKind.SkipFirst : path2Only ? M20CompletionKind.Path2Only : M20CompletionKind.Production;
}
