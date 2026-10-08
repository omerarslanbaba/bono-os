const fs=require("node:fs");
const path=require("node:path");
function must(ok,msg){if(!ok)throw new Error(msg)}
const root=path.resolve(__dirname,"..");
const server=fs.readFileSync(path.join(root,"bridge","server.js"),"utf8");
const uyap=fs.readFileSync(path.join(root,"bridge","uyap.js"),"utf8");
const api=fs.readFileSync(path.join(root,"web","js","api.js"),"utf8");
const view=fs.readFileSync(path.join(root,"web","js","views","active","uyap.js"),"utf8");

must(!api.includes("startUyapArchive"),"Active web API still exposes legacy global archive starter");
must(view.includes("api.startUyapDiscovery({statuses:[0,1],syncDocuments:true})"),"Global button is not metadata-only discovery");
must(view.includes("PDF/UDF indirme başlatmaz"),"Global query action lacks no-download disclosure");
must(api.includes("uyapDownloadSummary"),"Per-case download summary API missing");
must(api.includes("queueMissingUyapDocuments"),"Per-case batch API missing");
must(api.includes("confirmed:true"),"Explicit confirmation marker missing from download APIs");

const batchStart=server.indexOf("download-missing");
const batchEnd=server.indexOf('/api/uyap/downloads/pause',batchStart);
const batchBlock=server.slice(batchStart,batchEnd);
must(batchBlock.includes("b.confirmed!==true"),"Batch endpoint does not require confirmation");
must(!batchBlock.includes("setManualDownloadPause(false"),"Batch endpoint clears manual pause");

const resumeStart=server.indexOf('/api/uyap/downloads/resume');
const resumeEnd=server.indexOf('/api/uyap/remote-documents',resumeStart);
const resumeBlock=server.slice(resumeStart,resumeEnd);
must(resumeBlock.includes("b.confirmed!==true"),"Resume endpoint lacks confirmation");

const singleStart=server.indexOf('/api/uyap/remote-documents',resumeEnd);
const singleEnd=server.indexOf('/api/uyap/hearings/sync-range',singleStart);
const singleBlock=server.slice(singleStart,singleEnd);
must(singleBlock.includes("b.confirmed!==true"),"Single-document endpoint lacks confirmation");

must(view.includes("Eksik Evrakları Kuyruğa Ekle"),"Per-case batch button missing");
must(view.includes("İndirmeleri Devam Ettir"),"Explicit resume control missing");
must(view.includes("UYAP indirme kuyruğundaki evraklar indirilmeye başlayacak"),"Resume confirmation missing");

const enqueueRefs=[...uyap.matchAll(/enqueuePendingDownloads\(/g)].length;
must(enqueueRefs===1,"Automatic enqueuePendingDownloads caller exists; refs="+enqueueRefs);
must(uyap.includes("capacity:Math.max(0,200-activeCommands)"),"Summary lacks 200 active capacity");
must(uyap.includes("manualDownloadPaused:session.manualDownloadPaused"),"Summary lacks manual pause state");

console.log(JSON.stringify({
  ok:true,
  globalDiscoveryDoesNotQueueDownloads:true,
  batchRequiresConfirmation:true,
  batchPreservesManualPause:true,
  resumeRequiresConfirmation:true,
  singleDownloadRequiresConfirmation:true,
  automaticBatchCallers:enqueueRefs-1,
  perCaseCap:200
}));
