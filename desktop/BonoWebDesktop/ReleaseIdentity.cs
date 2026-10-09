using System.IO;
using System.Text.Json;

namespace BonoWebDesktop;

public sealed record ReleaseIdentity(
    string Version,
    string ExeCommit,
    string WebCommit,
    string ExeSha256,
    string WebSha256)
{
    // IncludeAllContentForSelfExtract relocates AppContext.BaseDirectory to .net cache.
    // Sidecar release files belong beside the launched apphost, never beside extracted DLLs.
    public static string PackageDirectory => Path.GetDirectoryName(Environment.ProcessPath)
        ?? throw new InvalidOperationException("BONO OS çalıştırılabilir dosyasının konumu belirlenemedi.");
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
            throw new FileNotFoundException("BONO OS sürüm manifesti EXE yanında bulunamadı.", path);
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
