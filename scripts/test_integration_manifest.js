const fs=require("node:fs");
const path=require("node:path");
const {spawnSync}=require("node:child_process");

function must(value,message){if(!value)throw new Error(message)}
const root=path.resolve(__dirname,"..");
function gitBlobSha(file){
  const rel=path.relative(root,file).replace(/\\/g,"/");
  const r=spawnSync("git",["ls-files","-s","--",rel],{cwd:root,encoding:"utf8"});
  if(r.status!==0)throw new Error("git ls-files failed for "+rel+": "+r.stderr);
  const m=String(r.stdout||"").trim().match(/^\d+\s+([0-9a-f]{40})\s+/i);
  if(!m)throw new Error("tracked blob SHA missing for "+rel);
  return m[1].toLowerCase();
}
const manifest=JSON.parse(fs.readFileSync(path.join(root,"integration","manifest.json"),"utf8"));
must(manifest.schemaVersion===2,"integration manifest schema mismatch");
must(manifest.reality==="isolated-tested-not-live-installed","live status must remain explicit");
for(const n of [13,19,17,18,15,16,14])must(manifest.deliveries?.["pr"+n]?.codeIntegrated===true,"PR #"+n+" not recorded integrated");
must(manifest.deliveries.pr14.mergedToMain===false,"PR #14 must not be claimed merged to main");
must(manifest.migration?.implementationIntegrated===true&&manifest.migration.liveApplied===false,"query migration implementation/live distinction lost");
must(manifest.migration.requiresFreshQueueInventory===true&&manifest.migration.historicalSnapshotIsCurrentInvariant===false,"old 270 snapshot must not be a current invariant");
for(const item of manifest.sourceProof||[]){
  const full=path.join(root,item.path);must(fs.existsSync(full),"manifest source missing: "+item.path);
  const actual=gitBlobSha(full);must(actual===item.blobSha,"source drift for "+item.path+": expected "+item.blobSha+" got "+actual);
}
const pkg=JSON.parse(fs.readFileSync(path.join(root,"package.json"),"utf8"));
must(pkg.version===manifest.components.core.packageVersion,"Core package version drift");
const ext=JSON.parse(fs.readFileSync(path.join(root,"extension","manifest.json"),"utf8"));
must(ext.version===manifest.components.uyap.extension.sourceManifestVersion,"extension source version drift");
must(manifest.components.uyap.extension.releaseBundleVersion==="0.4.0","release extension version must follow PR13 package contract");
const runtimeMode=fs.readFileSync(path.join(root,"extension","runtime_mode.js"),"utf8");
must(/mode:'normal'/.test(runtimeMode)&&/buildId:'development'/.test(runtimeMode)&&/probeVersion:2/.test(runtimeMode),"extension source runtime mode drift");
const csproj=fs.readFileSync(path.join(root,"desktop","BonoWebDesktop","BonoWebDesktop.csproj"),"utf8");
const sdk=(csproj.match(/Microsoft\.Web\.WebView2\" Version=\"([^\"]+)/)||[])[1];
must(sdk===manifest.components.webview2.sdk,"WebView2 SDK version drift");
const server=fs.readFileSync(path.join(root,"bridge","server.js"),"utf8");
const userPolicy=fs.readFileSync(path.join(root,"bridge","uyap_user_queries.js"),"utf8");
const uyap=fs.readFileSync(path.join(root,"bridge","uyap.js"),"utf8");
const mainWindow=fs.readFileSync(path.join(root,"desktop","BonoWebDesktop","MainWindow.xaml.cs"),"utf8");
for(const needle of ["uyap_user_query_http","handleDocumentViewRequest(req,res,db)"])must(server.includes(needle),"Core route integration missing: "+needle);
for(const needle of ["cbs_case_list","cbs_unit_status_exact_v1","fresh_queue_count_required","unit_status_list_local_exact_match"])must(userPolicy.includes(needle),"user query integration missing: "+needle);
must(uyap.includes("explicitCbsCaseLookup"),"scoped CBS side-effect guard missing");
must(fs.existsSync(path.join(root,"bridge","observation_controller.js")),"PR13 observation controller missing");
must(fs.existsSync(path.join(root,"VISION.md"))&&fs.existsSync(path.join(root,"AGENTS.md")),"vision/agent guidance missing");
must(!mainWindow.includes("Browser.Source = CoreUri"),"WebView2 regressed to live Core UI");
must(mainWindow.includes("LocalPreviewServer.StartAsync"),"WebView2 same-origin preview server missing");
console.log(JSON.stringify({ok:true,manifest:"integration/manifest.json",schemaVersion:manifest.schemaVersion,sourceProofCount:manifest.sourceProof.length,queryMigrationCodeIntegrated:true,queryMigrationLiveApplied:false,historicalQueueSnapshot:manifest.migration.historicalSnapshotOnly,historicalSnapshotCurrent:false,extensionSourceVersion:ext.version,extensionReleaseVersion:manifest.components.uyap.extension.releaseBundleVersion,webView2Sdk:sdk}));
