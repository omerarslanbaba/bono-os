using System.IO.Compression;
using System.Security.Cryptography;
using System.Text.Json;

namespace BonoWebDesktop;

internal static class WebBundleManager
{
    public const string BundleFileName = "web-bundle.zip";

    public static string Prepare(ReleaseIdentity identity)
    {
        if (string.IsNullOrWhiteSpace(identity.WebSha256))
            throw new InvalidOperationException("Web bundle SHA-256 bilgisi manifestte bulunamadı.");

        var bundlePath = Path.Combine(AppContext.BaseDirectory, BundleFileName);
        if (!File.Exists(bundlePath))
            throw new FileNotFoundException("Paketlenmiş BONO OS web kaynakları bulunamadı.", bundlePath);

        var actual = Sha256(bundlePath);
        if (!actual.Equals(identity.WebSha256, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException($"Web kaynak bütünlüğü doğrulanamadı. expected={identity.WebSha256} actual={actual}");

        var cacheRoot = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "BONO OS Web Preview", "web-cache");
        Directory.CreateDirectory(cacheRoot);

        var finalDir = Path.Combine(cacheRoot, actual[..16]);
        var marker = Path.Combine(finalDir, ".bundle-sha256");
        if (File.Exists(Path.Combine(finalDir, "index.html")) &&
            File.Exists(marker) &&
            string.Equals(File.ReadAllText(marker).Trim(), actual, StringComparison.OrdinalIgnoreCase))
            return finalDir;

        var tempDir = finalDir + ".tmp-" + Guid.NewGuid().ToString("N");
        Directory.CreateDirectory(tempDir);
        try
        {
            using var zip = ZipFile.OpenRead(bundlePath);
            var fullRoot = Path.GetFullPath(tempDir) + Path.DirectorySeparatorChar;
            foreach (var entry in zip.Entries)
            {
                if (string.IsNullOrEmpty(entry.Name)) continue;
                var destination = Path.GetFullPath(Path.Combine(tempDir, entry.FullName));
                if (!destination.StartsWith(fullRoot, StringComparison.OrdinalIgnoreCase))
                    throw new InvalidOperationException("Web bundle geçersiz bir dosya yolu içeriyor.");

                Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
                entry.ExtractToFile(destination, overwrite: true);
            }

            if (!File.Exists(Path.Combine(tempDir, "index.html")))
                throw new InvalidOperationException("Web bundle index.html içermiyor.");

            var versionPath = Path.Combine(tempDir, "__bono_web_version.json");
            if (!File.Exists(versionPath))
                throw new InvalidOperationException("Web bundle sürüm tanılama dosyasını içermiyor.");

            using (var versionDoc = JsonDocument.Parse(File.ReadAllText(versionPath)))
            {
                var bundledCommit = versionDoc.RootElement.TryGetProperty("commit", out var commitNode)
                    ? commitNode.GetString()
                    : null;
                if (!string.Equals(bundledCommit, identity.WebCommit, StringComparison.OrdinalIgnoreCase))
                    throw new InvalidOperationException(
                        $"Web bundle commit uyuşmuyor. manifest={identity.WebCommit} bundle={bundledCommit ?? "missing"}");
            }

            File.WriteAllText(Path.Combine(tempDir, ".bundle-sha256"), actual);
            if (Directory.Exists(finalDir)) Directory.Delete(finalDir, recursive: true);
            Directory.Move(tempDir, finalDir);
            return finalDir;
        }
        finally
        {
            if (Directory.Exists(tempDir)) Directory.Delete(tempDir, recursive: true);
        }
    }

    public static string Sha256(string path)
    {
        using var stream = File.OpenRead(path);
        return Convert.ToHexString(SHA256.HashData(stream)).ToLowerInvariant();
    }
}
