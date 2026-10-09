using BonoWebDesktop;
using System.Text.Json;

var identity = ReleaseIdentity.Load(ReleaseIdentity.PackageDirectory);
if (identity.WebSha256.Length != 64) throw new Exception("Sidecar hash not loaded");
var bundle = Path.Combine(ReleaseIdentity.PackageDirectory, WebBundleManager.BundleFileName);
if (WebBundleManager.Sha256(bundle) != identity.WebSha256) throw new Exception("Bundle hash mismatch");
// Deliberately wrong hash must still fail before extraction/cache access.
try { WebBundleManager.Prepare(identity with { WebSha256 = new string('0',64) }); throw new Exception("Hash bypassed"); }
catch (InvalidOperationException ex) when (ex.Message.Contains("bütünlüğü")) { }
try { ReleaseIdentity.Load(Path.Combine(ReleaseIdentity.PackageDirectory,"missing-sidecar")); throw new Exception("Missing manifest accepted"); }
catch (FileNotFoundException) { }
Console.WriteLine(JsonSerializer.Serialize(new { passed=true, baseDirectory=AppContext.BaseDirectory, packageDirectory=ReleaseIdentity.PackageDirectory, selfExtractionReproduced=AppContext.BaseDirectory!=ReleaseIdentity.PackageDirectory+Path.DirectorySeparatorChar, identity.WebSha256, hashRejection=true, missingManifestRejection=true }));
