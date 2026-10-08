const fs=require("node:fs");
const path=require("node:path");
const crypto=require("node:crypto");

function must(value,message){if(!value)throw new Error(message)}
function gitBlobSha(file){
  const buf=fs.readFileSync(file);
  return crypto.createHash("sha1")
    .update(Buffer.concat([Buffer.from("blob "+buf.length+"\0"),buf]))
    .digest("hex");
}
const root=path.resolve(__dirname,"..");
const manifest=JSON.parse(fs.readFileSync(path.join(root,"integration","manifest.json"),"utf8"));

must(manifest.schemaVersion===1,"integration manifest schema mismatch");
must(manifest.reality==="isolated-tested-not-live-installed","manifest reality status must stay explicit");
must(manifest.pendingDependencies?.queueMigration?.pr===13&&manifest.pendingDependencies.queueMigration.integrated===false,
  "PR #13 queue migration must remain explicitly pending");
must(manifest.pendingDependencies?.visionDocs?.pr===14&&manifest.pendingDependencies.visionDocs.mergedToMain===false,
  "PR #14 vision docs status must remain explicit");

for(const item of manifest.sourceProof||[]){
  const full=path.join(root,item.path);
  must(fs.existsSync(full),"manifest source missing: "+item.path);
  const actual=gitBlobSha(full);
  must(actual===item.blobSha,"source drift for "+item.path+": expected "+item.blobSha+" got "+actual);
}

const pkg=JSON.parse(fs.readFileSync(path.join(root,"package.json"),"utf8"));
must(pkg.version===manifest.components.core.packageVersion,"Core package version drift");

const ext=JSON.parse(fs.readFileSync(path.join(root,"extension","manifest.json"),"utf8"));
must(ext.version===manifest.components.uyap.extensionVersion,"Chrome extension version drift");

const csproj=fs.readFileSync(path.join(root,"desktop","BonoWebDesktop","BonoWebDesktop.csproj"),"utf8");
const sdk=(csproj.match(/Microsoft\.Web\.WebView2\" Version=\"([^\"]+)/)||[])[1];
must(sdk===manifest.components.webview2.sdk,"WebView2 SDK version drift");

const server=fs.readFileSync(path.join(root,"bridge","server.js"),"utf8");
const api=fs.readFileSync(path.join(root,"web","js","api.js"),"utf8");
const mainWindow=fs.readFileSync(path.join(root,"desktop","BonoWebDesktop","MainWindow.xaml.cs"),"utf8");

for(const needle of [
  "/api/uyap/cases/",
  "document-sync-status",
  "/api/uyap/case-search",
  "/api/uyap/cbs-party-search",
  "handleDocumentViewRequest(req,res,db)"
]) must(server.includes(needle),"Core integration route missing: "+needle);

for(const needle of [
  "uyapDocumentSyncStatus",
  "uyapCaseSearch",
  "uyapCbsPartySearch",
  "fetch(path"
]) must(api.includes(needle),"Web API contract missing: "+needle);

must(!mainWindow.includes("Browser.Source = CoreUri"),"WebView2 regressed to live Core UI");
must(mainWindow.includes("LocalPreviewServer.StartAsync"),"WebView2 same-origin preview server missing");
must(!fs.existsSync(path.join(root,"bridge","observation_controller.js")),
  "PR #13 observation/queue work was partially merged before queue migration sign-off");

console.log(JSON.stringify({
  ok:true,
  manifest:"integration/manifest.json",
  sourceProofCount:manifest.sourceProof.length,
  queueMigrationIntegrated:false,
  visionDocsMerged:false,
  extensionVersion:ext.version,
  webView2Sdk:sdk
}));
