using System.Reflection;
using System.Text.Json;

namespace BonoWebDesktop;

public sealed record ReleaseIdentity(
    string Version,
    string ExeCommit,
    string WebCommit,
    string ExeSha256,
    string WebSha256)
{
    public bool CommitsMatch =>
        !string.IsNullOrWhiteSpace(ExeCommit) &&
        !string.IsNullOrWhiteSpace(WebCommit) &&
        string.Equals(ExeCommit, WebCommit, StringComparison.OrdinalIgnoreCase);

    public string ExeShort => Short(ExeCommit);
    public string WebShort => Short(WebCommit);

    public static ReleaseIdentity Load(string baseDirectory)
    {
        var path = Path.Combine(baseDirectory, "release-manifest.json");
        if (!File.Exists(path))
        {
            var info = Assembly.GetExecutingAssembly()
                .GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion ?? "unpackaged";
            var shortCommit = info.Contains('+') ? info[(info.LastIndexOf('+') + 1)..] : "unpackaged";
            return new(info, shortCommit, "unpackaged", "", "");
        }

        using var doc = JsonDocument.Parse(File.ReadAllText(path));
        var root = doc.RootElement;
        return new(
            Get(root, "version", "unknown"),
            Get(root, "commit", "unknown"),
            Get(root, "webCommit", "unknown"),
            Get(root, "sha256", ""),
            Get(root, "webSha256", ""));
    }

    private static string Get(JsonElement root, string name, string fallback) =>
        root.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String
            ? v.GetString() ?? fallback
            : fallback;

    private static string Short(string value) =>
        string.IsNullOrWhiteSpace(value) ? "unknown" : value[..Math.Min(8, value.Length)];
}
