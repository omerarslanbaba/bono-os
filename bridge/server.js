const http=require("http");
const fs=require("fs");
const path=require("path");
const {Worker}=require("worker_threads");
const repo=require("./repository");
const db=require("./db");
const jobs=require("./jobs");
const uyap=require("./uyap");
const v04=require("./v04");
const udfAdapter=require("./udf_adapter");
const deadlineEngine=require("./deadline_engine");
const v05=require("./v05");
const v06=require("./v06");
const v09=require("./v09");
const workflow=require("./workflow_engine");
const eventBus=require("./event_bus");

const PORT=Number(process.env.BONO_PORT||47831);
const ROOT=path.join(__dirname,"..");
const DATA_DIR=path.join(ROOT,"data");
const WEB_DIR=path.join(ROOT,"web");
const EVENTS=path.join(DATA_DIR,"events.jsonl");
fs.mkdirSync(DATA_DIR,{recursive:true});

const types={".html":"text/html; charset=utf-8",".css":"text/css; charset=utf-8",".js":"application/javascript; charset=utf-8",".json":"application/json; charset=utf-8",".svg":"image/svg+xml",".png":"image/png"};
function json(res,status,obj){res.writeHead(status,{"Content-Type":"application/json; charset=utf-8"});res.end(JSON.stringify(obj))}
function readBody(req){
  return new Promise((resolve,reject)=>{
    let body="";
    req.on("data",c=>{body+=c;if(body.length>2_000_000){reject(new Error("payload too large"));req.destroy()}});
    req.on("end",()=>{try{resolve(body?JSON.parse(body):{})}catch(e){reject(e)}});
    req.on("error",reject);
  });
}
function staticFile(urlPath,res){
  const rel=urlPath==="/"?"index.html":urlPath.replace(/^\//,"");
  const file=path.normalize(path.join(WEB_DIR,rel));
  if(!file.startsWith(WEB_DIR)||!fs.existsSync(file)||!fs.statSync(file).isFile()) return false;
  res.writeHead(200,{"Content-Type":types[path.extname(file)]||"application/octet-stream","Cache-Control":"no-store"});
  fs.createReadStream(file).pipe(res); return true;
}
function audit(actor,action,type,id,detail){
  db.prepare("INSERT INTO audit_log(occurred_at,actor,action,entity_type,entity_id,detail_json) VALUES(datetime('now'),?,?,?,?,?)")
    .run(actor,action,type,id==null?null:String(id),JSON.stringify(detail||{}));
}

const server=http.createServer(async(req,res)=>{
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Access-Control-Allow-Headers","Content-Type");
  if(req.method==="OPTIONS"){res.writeHead(204);return res.end()}
  const u=new URL(req.url,"http://127.0.0.1:"+PORT);
  const p=u.pathname;
  try{
    if(req.method==="GET"&&p==="/favicon.ico"){res.writeHead(204);return res.end()}
    if(req.method==="GET"&&p==="/health") return json(res,200,{ok:true,service:"BONO OS",port:PORT,ui:true,schema:9});
    if(req.method==="GET"&&p==="/api/summary") return json(res,200,repo.summary());
    if(req.method==="GET"&&p==="/api/brief") return json(res,200,repo.brief());
    if(req.method==="GET"&&p==="/api/search") return json(res,200,{query:u.searchParams.get("q")||"",results:repo.search(u.searchParams.get("q")||"",Number(u.searchParams.get("limit")||25))});
    if(req.method==="GET"&&p==="/api/clients") return json(res,200,repo.clients(Number(u.searchParams.get("limit")||200)));
    let m=p.match(/^\/api\/clients\/(\d+)$/);
    if(req.method==="GET"&&m){const v=repo.clientDetail(Number(m[1]));return v?json(res,200,v):json(res,404,{error:"Müvekkil bulunamadı"})}
    if(req.method==="GET"&&p==="/api/powers") return json(res,200,repo.powers(Number(u.searchParams.get("limit")||200)));
    m=p.match(/^\/api\/powers\/(\d+)\/document$/);
    if(req.method==="GET"&&m){
      const v=repo.powerDetail(Number(m[1])),src=v?.sources?.find(x=>x.local_path&&fs.existsSync(x.local_path));
      if(!src)return json(res,404,{error:"Vekâlet belgesi bulunamadı"});
      const ext=path.extname(src.local_path).toLowerCase(),ct=ext===".pdf"?"application/pdf":(types[ext]||"application/octet-stream");
      const original=path.basename(src.local_path).replace(/["\r\n]/g,"");
      const ascii=original.normalize("NFKD").replace(/[^\x20-\x7E]/g,"_").replace(/["\\]/g,"_")||"vekalet"+ext;
      const disp=`inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(original)}`;
      res.writeHead(200,{"Content-Type":ct,"Content-Disposition":disp,"Cache-Control":"no-store"});
      return fs.createReadStream(src.local_path).pipe(res);
    }
    m=p.match(/^\/api\/powers\/(\d+)$/);
    if(req.method==="GET"&&m){const v=repo.powerDetail(Number(m[1]));return v?json(res,200,v):json(res,404,{error:"Vekâlet bulunamadı"})}
    if(req.method==="GET"&&p==="/api/assets") return json(res,200,repo.assets(Number(u.searchParams.get("limit")||200)));
    m=p.match(/^\/api\/assets\/(\d+)\/content$/);
    if(req.method==="GET"&&m){
      const v=repo.assetDetail(Number(m[1]));
      const loc=v?.locations?.find(x=>x.local_path&&fs.existsSync(x.local_path));
      if(!loc)return json(res,404,{error:"Belgenin yerel dosyası bulunamadı"});
      const ext=path.extname(loc.local_path).toLowerCase(),ct=ext===".pdf"?"application/pdf":(types[ext]||"application/octet-stream");
      res.writeHead(200,{"Content-Type":ct,"Content-Disposition":"inline","Cache-Control":"no-store"});
      return fs.createReadStream(loc.local_path).pipe(res);
    }
    m=p.match(/^\/api\/assets\/(\d+)$/);
    if(req.method==="GET"&&m){const v=repo.assetDetail(Number(m[1]));return v?json(res,200,v):json(res,404,{error:"Belge bulunamadı"})}
    if(req.method==="GET"&&p==="/api/office-files") return json(res,200,repo.officeFiles(Number(u.searchParams.get("limit")||200)));
    m=p.match(/^\/api\/office-files\/(\d+)$/);
    if(req.method==="GET"&&m){const v=repo.officeFileDetail(Number(m[1]));return v?json(res,200,v):json(res,404,{error:"Föy bulunamadı"})}
    m=p.match(/^\/api\/office-files\/(\d+)\/timeline$/);
    if(req.method==="GET"&&m) return json(res,200,repo.timeline(Number(m[1])));

    if(req.method==="GET"&&p==="/api/accounting/overview") return json(res,200,v05.accountingOverview(u.searchParams.get("caseId")||null));
    if(req.method==="GET"&&p==="/api/archive/standard") return json(res,200,v05.archiveStandard());
    if(req.method==="POST"&&p==="/api/archive/scan") return json(res,200,v05.scanArchive());
    if(req.method==="GET"&&p==="/api/archive/suggestions") return json(res,200,v05.archiveSuggestions(u.searchParams.get("officeFileId")?Number(u.searchParams.get("officeFileId")):null));
    m=p.match(/^\/api\/archive\/links\/(\d+)\/verify$/);
    if(req.method==="POST"&&m) return json(res,200,v05.verifyArchiveLink(Number(m[1])));

    m=p.match(/^\/api\/cases\/(\d+)\/sync-profile$/);
    if(req.method==="GET"&&m) return json(res,200,v05.syncProfile(Number(m[1])));
    m=p.match(/^\/api\/cases\/(\d+)\/sync-baseline-status$/);
    if(req.method==="GET"&&m) return json(res,200,v05.baselineStatus(Number(m[1])));
    m=p.match(/^\/api\/cases\/(\d+)\/remote-manifest$/);
    if(req.method==="POST"&&m){
      const b=await readBody(req);
      return json(res,200,v05.ingestRemoteManifest(Number(m[1]),b.documents||[],{manifestType:b.manifestType||"delta",source:b.source||"authorized_channel"}));
    }
    m=p.match(/^\/api\/cases\/(\d+)\/complete-baseline$/);
    if(req.method==="POST"&&m) return json(res,200,v05.completeBaseline(Number(m[1])));
    m=p.match(/^\/api\/cases\/(\d+)\/remote-documents$/);
    if(req.method==="GET"&&m) return json(res,200,v05.pendingRemoteDocuments(Number(m[1]),u.searchParams.get("onlyNew")!=="0"));
    m=p.match(/^\/api\/uyap\/remote-documents\/(\d+)\/mark-downloaded$/);
    if(req.method==="POST"&&m){
      if(uyap.rateState().integration_mode!=="official_api") return json(res,423,{error:"UYAP otomatik indirme observe-only modunda kilitli"});
      const b=await readBody(req);
      return json(res,200,v05.markRemoteDownloaded(Number(m[1]),b.stagingPath,b.sha256||null));
    }
    m=p.match(/^\/api\/uyap\/remote-documents\/(\d+)\/file$/);
    if(req.method==="POST"&&m){
      if(uyap.rateState().integration_mode!=="official_api") return json(res,423,{error:"Otomatik dosyalama yalnız yetkili UYAP kanalında çalışır"});
      return json(res,200,v05.fileDownloadedRemote(Number(m[1]),await readBody(req)));
    }

    m=p.match(/^\/api\/office-files\/(\d+)\/correspondence$/);
    if(req.method==="GET"&&m) return json(res,200,v05.correspondence(Number(m[1])));
    if(req.method==="POST"&&p==="/api/correspondence") return json(res,201,v05.createCorrespondence(await readBody(req)));
    m=p.match(/^\/api\/correspondence\/(\d+)\/response$/);
    if(req.method==="POST"&&m) return json(res,200,v05.markCorrespondenceResponse(Number(m[1]),await readBody(req)));

    m=p.match(/^\/api\/office-files\/(\d+)\/evidence-matrix$/);
    if(req.method==="GET"&&m) return json(res,200,v05.evidenceMatrix(Number(m[1])));
    if(req.method==="POST"&&p==="/api/evidence/issues") return json(res,201,v05.createEvidenceIssue(await readBody(req)));
    m=p.match(/^\/api\/evidence\/issues\/(\d+)\/links$/);
    if(req.method==="POST"&&m) return json(res,201,v05.addEvidenceLink(Number(m[1]),await readBody(req)));

    m=p.match(/^\/api\/office-files\/(\d+)\/representation-radar$/);
    if(req.method==="GET"&&m) return json(res,200,v05.representationRadar(Number(m[1])));
    if(req.method==="GET"&&p==="/api/representation-radar") return json(res,200,v05.representationRadar());
    m=p.match(/^\/api\/cases\/(\d+)\/link-power$/);
    if(req.method==="POST"&&m){const b=await readBody(req);return json(res,200,v05.linkPowerToCase(Number(m[1]),Number(b.powerId)))}

    if(req.method==="GET"&&p==="/api/event-bus/status") return json(res,200,eventBus.status());
    if(req.method==="POST"&&p==="/api/uyap/delta-watch/run") return json(res,200,eventBus.scheduleDeltaChecks());
    if(req.method==="GET"&&p==="/api/workflows") return json(res,200,workflow.definitions());
    m=p.match(/^\/api\/workflows\/(\d+)$/);
    if(req.method==="GET"&&m){const x=workflow.detail(Number(m[1]));return x?json(res,200,x):json(res,404,{error:"Workflow bulunamadı"})}
    m=p.match(/^\/api\/workflows\/([^/]+)\/trigger$/);
    if(req.method==="POST"&&m){const b=await readBody(req);return json(res,201,workflow.trigger(decodeURIComponent(m[1]),b.input||b,b.ref||null,"manual"))}
    if(req.method==="GET"&&p==="/api/workflow-runs") return json(res,200,workflow.runs(Number(u.searchParams.get("limit")||100)));
    if(req.method==="GET"&&p==="/api/workflow-approvals") return json(res,200,workflow.approvals());
    m=p.match(/^\/api\/workflow-approvals\/(\d+)$/);
    if(req.method==="POST"&&m){const b=await readBody(req);return json(res,200,workflow.approve(Number(m[1]),!!b.approved,b.note||""))}

    if(req.method==="GET"&&p==="/api/v06/provider-status") return json(res,200,v06.providerStatus());
    if(req.method==="GET"&&p==="/api/tebligatlar") return json(res,200,v06.shipments({officeFileId:u.searchParams.get("officeFileId")?Number(u.searchParams.get("officeFileId")):null,status:u.searchParams.get("status")||null}));
    m=p.match(/^\/api\/tebligatlar\/(\d+)\/ptt-result$/);
    if(req.method==="POST"&&m) return json(res,200,v06.recordPttResult(Number(m[1]),await readBody(req)));
    m=p.match(/^\/api\/tebligatlar\/(\d+)\/uyap-receipt$/);
    if(req.method==="POST"&&m) return json(res,200,v06.markUyapReceipt(Number(m[1]),await readBody(req)));
    if(req.method==="GET"&&p==="/api/work-radar") return json(res,200,v06.radar({officeFileId:u.searchParams.get("officeFileId")?Number(u.searchParams.get("officeFileId")):null,status:u.searchParams.get("status")||"open"}));
    m=p.match(/^\/api\/work-radar\/(\d+)\/resolve$/);
    if(req.method==="POST"&&m) return json(res,200,v06.resolveRadar(Number(m[1])));
    m=p.match(/^\/api\/uyap\/remote-documents\/(\d+)\/process$/);
    if(req.method==="POST"&&m) return json(res,200,v06.processRemoteDocument(Number(m[1]),await readBody(req)));

    if(req.method==="GET"&&p==="/api/morning-brief") return json(res,200,v09.morningBrief());
    if(req.method==="GET"&&p==="/api/hearings/upcoming") return json(res,200,v09.upcomingHearings(Number(u.searchParams.get("limit")||30)));
    m=p.match(/^\/api\/hearings\/(\d+)\/cockpit$/);
    if(req.method==="GET"&&m){const x=v09.hearingCockpit(Number(m[1]));return x?json(res,200,x):json(res,404,{error:"Duruşma bulunamadı"})}
    if(req.method==="POST"&&p==="/api/interim-orders/scan") return json(res,200,v09.scanInterimOrders(await readBody(req)));
    if(req.method==="GET"&&p==="/api/interim-orders") return json(res,200,v09.actionItems({officeFileId:u.searchParams.get("officeFileId")?Number(u.searchParams.get("officeFileId")):null,status:u.searchParams.get("status")||"open"}));
    m=p.match(/^\/api\/interim-orders\/(\d+)\/resolve$/);
    if(req.method==="POST"&&m) return json(res,200,v09.resolveAction(Number(m[1])));
    if(req.method==="POST"&&p==="/api/correspondence-matches/scan") return json(res,200,v09.scanCorrespondenceMatches(await readBody(req)));
    if(req.method==="GET"&&p==="/api/correspondence-matches") return json(res,200,v09.correspondenceMatches(u.searchParams.get("officeFileId")?Number(u.searchParams.get("officeFileId")):null));
    m=p.match(/^\/api\/correspondence-matches\/(\d+)$/);
    if(req.method==="POST"&&m){const b=await readBody(req);return json(res,200,v09.decideCorrespondenceMatch(Number(m[1]),!!b.approved))}
    if(req.method==="POST"&&p==="/api/notification-extraction/scan") return json(res,200,v09.scanNotifications(await readBody(req)));
    if(req.method==="GET"&&p==="/api/system/backup-health") return json(res,200,v09.backupHealth());
    if(req.method==="GET"&&p==="/api/system/checkpoints") return json(res,200,v09.checkpoints());
    if(req.method==="POST"&&p==="/api/system/checkpoints"){const b=await readBody(req);return json(res,201,v09.createCheckpoint(b.label||"Manuel geri dönüş noktası"))}
    m=p.match(/^\/api\/system\/checkpoints\/(\d+)\/restore-request$/);
    if(req.method==="POST"&&m){const b=await readBody(req);return json(res,202,v09.requestRestore(Number(m[1]),b.confirmation||""))}

    if(req.method==="GET"&&p==="/api/deadlines") return json(res,200,repo.deadlines(Number(u.searchParams.get("limit")||200)));
    if(req.method==="POST"&&p==="/api/deadlines/calculate") return json(res,200,deadlineEngine.calculate(await readBody(req)));
    if(req.method==="POST"&&p==="/api/deadlines/calculate-and-save") return json(res,201,deadlineEngine.saveDraft(await readBody(req)));
    if(req.method==="GET"&&p==="/api/legal-calendar") return json(res,200,deadlineEngine.calendarDays(Number(u.searchParams.get("limit")||400)));
    if(req.method==="POST"&&p==="/api/legal-calendar") return json(res,201,deadlineEngine.upsertCalendarDay(await readBody(req)));
    if(req.method==="GET"&&p==="/api/tasks") return json(res,200,repo.tasks(Number(u.searchParams.get("limit")||200)));
    if(req.method==="GET"&&p==="/api/jobs") return json(res,200,repo.jobs(Number(u.searchParams.get("limit")||50)));
    if(req.method==="GET"&&p==="/api/scan-roots") return json(res,200,repo.scanRoots());
    if(req.method==="GET"&&p==="/api/audit") return json(res,200,repo.recentAudit(Number(u.searchParams.get("limit")||100)));

    if(req.method==="GET"&&p==="/api/intelligence/status") return json(res,200,v04.intelligenceStatus());
    if(req.method==="GET"&&p==="/api/intelligence/templates") return json(res,200,v04.templates(Number(u.searchParams.get("limit")||150)));
    m=p.match(/^\/api\/intelligence\/templates\/(\d+)$/);
    if(req.method==="GET"&&m){const x=v04.templateDetail(Number(m[1]));return x?json(res,200,x):json(res,404,{error:"Şablon bulunamadı"})}
    m=p.match(/^\/api\/intelligence\/templates\/(\d+)\/office-style$/);
    if(req.method==="POST"&&m){const b=await readBody(req);return json(res,200,v04.setTemplateOfficeStyle(Number(m[1]),!!b.enabled))}
    if(req.method==="GET"&&p==="/api/knowledge/search") return json(res,200,{query:u.searchParams.get("q")||"",results:v04.knowledgeSearch(u.searchParams.get("q")||"",{
      officeFileId:u.searchParams.get("officeFileId"),caseId:u.searchParams.get("caseId"),assetId:u.searchParams.get("assetId"),limit:Number(u.searchParams.get("limit")||20)
    })});
    m=p.match(/^\/api\/assets\/(\d+)\/analysis$/);
    if(req.method==="GET"&&m){const x=v04.documentAnalysis(Number(m[1]));return x?json(res,200,x):json(res,404,{error:"Belge analizi bulunamadı"})}

    if(req.method==="GET"&&p==="/api/drafts") return json(res,200,v04.drafts(Number(u.searchParams.get("limit")||200)));
    m=p.match(/^\/api\/drafts\/(\d+)$/);
    if(req.method==="GET"&&m){const x=v04.draftDetail(Number(m[1]));return x?json(res,200,x):json(res,404,{error:"Taslak bulunamadı"})}
    if(req.method==="POST"&&p==="/api/drafts") return json(res,201,v04.createDraft(await readBody(req)));
    if(req.method==="PUT"&&m) return json(res,200,v04.updateDraft(Number(m[1]),await readBody(req)));
    m=p.match(/^\/api\/drafts\/(\d+)\/export-udf$/);
    if(req.method==="POST"&&m) return json(res,200,await udfAdapter.exportDraft(Number(m[1])));

    if(req.method==="GET"&&p==="/api/notes") return json(res,200,v04.notes({
      clientId:u.searchParams.get("clientId"),officeFileId:u.searchParams.get("officeFileId"),caseId:u.searchParams.get("caseId"),assetId:u.searchParams.get("assetId")
    }));
    if(req.method==="POST"&&p==="/api/notes") return json(res,201,v04.createNote(await readBody(req)));

    m=p.match(/^\/api\/clients\/(\d+)\/finance$/);
    if(req.method==="GET"&&m) return json(res,200,v04.clientFinance(Number(m[1])));
    if(req.method==="GET"&&p==="/api/finance/overview") return json(res,200,v04.financeOverview());
    if(req.method==="POST"&&p==="/api/fee-contracts") return json(res,201,v04.createFeeContract(await readBody(req)));
    if(req.method==="POST"&&p==="/api/financial-entries") return json(res,201,v04.createFinancialEntry(await readBody(req)));

    if(req.method==="GET"&&p==="/api/communications") return json(res,200,v04.communications({clientId:u.searchParams.get("clientId"),officeFileId:u.searchParams.get("officeFileId")}));
    if(req.method==="POST"&&p==="/api/communications") return json(res,201,v04.createCommunication(await readBody(req)));
    if(req.method==="GET"&&p==="/api/communication-status") return json(res,200,v04.communicationStatus());

    m=p.match(/^\/api\/clients\/(\d+)\/relations$/);
    if(req.method==="GET"&&m) return json(res,200,v04.relations(Number(m[1])));
    if(req.method==="POST"&&p==="/api/relations") return json(res,201,v04.createRelation(await readBody(req)));
    if(req.method==="POST"&&p==="/api/merge-candidates/refresh") return json(res,200,v04.refreshMergeCandidates());
    if(req.method==="GET"&&p==="/api/merge-candidates") return json(res,200,v04.mergeCandidates());

    if(req.method==="GET"&&p==="/api/ai/permissions") return json(res,200,v04.aiPermissions());
    m=p.match(/^\/api\/ai\/permissions\/([^/]+)$/);
    if(req.method==="POST"&&m) return json(res,200,v04.setAiPermission(decodeURIComponent(m[1]),await readBody(req)));

    m=p.match(/^\/api\/office-files\/(\d+)\/hearing-pack$/);
    if(req.method==="POST"&&m) return json(res,201,v04.generateHearingPack(Number(m[1])));
    m=p.match(/^\/api\/office-files\/(\d+)\/hearing-packs$/);
    if(req.method==="GET"&&m) return json(res,200,v04.hearingPacks(Number(m[1])));
    m=p.match(/^\/api\/hearing-packs\/(\d+)$/);
    if(req.method==="GET"&&m){const x=v04.hearingPack(Number(m[1]));return x?json(res,200,x):json(res,404,{error:"Duruşma paketi bulunamadı"})}
    if(req.method==="GET"&&p==="/api/service-health") return json(res,200,v04.serviceHealth());

    if(req.method==="GET"&&p==="/api/uyap/status") return json(res,200,{
      globalMinIntervalMs:uyap.GLOBAL_MIN_INTERVAL_MS,
      rate:uyap.rateState(),
      session:uyap.sessionState(),
      endpointCount:uyap.endpoints().length,
      observationCount:uyap.observations(10000).length,
      queue:uyap.queue(20)
    });
    if(req.method==="GET"&&p==="/api/uyap/session") return json(res,200,{session:uyap.sessionState(),rate:uyap.rateState()});
    if(req.method==="GET"&&p==="/api/uyap/observations") return json(res,200,uyap.observations(Number(u.searchParams.get("limit")||300)));
    if(req.method==="GET"&&p==="/api/uyap/endpoints") return json(res,200,uyap.endpoints());
    if(req.method==="GET"&&p==="/api/uyap/queue") return json(res,200,uyap.queue(Number(u.searchParams.get("limit")||100)));
    if(req.method==="GET"&&p==="/api/uyap/queue-errors") return json(res,200,uyap.queue(10000).filter(x=>x.status==="failed").slice(0,20));
    if(req.method==="GET"&&p==="/api/uyap/discovery/status") return json(res,200,uyap.discoveryStatus());
    if(req.method==="GET"&&p==="/api/uyap/archive/status") return json(res,200,uyap.archiveStatus());
    if(req.method==="POST"&&p==="/api/uyap/discovery/start"){
      const b=await readBody(req);
      const out=uyap.enqueueCaseDiscovery({yargiTypes:b.yargiTypes||null,statuses:b.statuses||[0,1],syncDocuments:!!b.syncDocuments});
      const cbs=uyap.enqueueCbsDiscovery({statuses:b.statuses||[0,1],syncDocuments:!!b.syncDocuments});
      audit("lawyer","uyap_case_discovery","uyap",null,{types:out.yargiTypes,statuses:out.statuses,cbs:true,syncDocuments:!!b.syncDocuments});
      return json(res,202,{ok:true,...out,cbsCommandId:cbs.commandId});
    }
    if(req.method==="POST"&&p==="/api/uyap/archive/start"){
      const known=uyap.enqueueKnownCaseDocuments();
      const discovery=uyap.enqueueCaseDiscovery({statuses:[0,1],syncDocuments:true});
      const cbs=uyap.enqueueCbsDiscovery({statuses:[0,1],syncDocuments:true});
      audit("lawyer","uyap_full_archive_start","uyap",null,{known,discoveryCommands:discovery.commandIds.length,cbsCommandId:cbs.commandId});
      return json(res,202,{ok:true,known,discoveryCommands:discovery.commandIds.length,cbsCommandId:cbs.commandId,status:uyap.archiveStatus()});
    }
    if(req.method==="GET"&&p==="/api/uyap/cases") return json(res,200,uyap.cases());

    m=p.match(/^\/api\/uyap\/cases\/(\d+)\/remote-documents$/);
    if(req.method==="GET"&&m) return json(res,200,uyap.remoteDocuments(Number(m[1])));
    m=p.match(/^\/api\/uyap\/cases\/(\d+)\/document-sync-status$/);
    if(req.method==="GET"&&m) return json(res,200,uyap.caseDocumentSyncStatus(Number(m[1])));
    m=p.match(/^\/api\/uyap\/cases\/(\d+)\/download-summary$/);
    if(req.method==="GET"&&m) return json(res,200,uyap.caseDownloadSummary(Number(m[1])));
    m=p.match(/^\/api\/uyap\/cases\/(\d+)\/sync-documents$/);
    if(req.method==="POST"&&m){
      const caseId=Number(m[1]);
      const before=uyap.caseDocumentSyncStatus(caseId);
      if(before.sessionState==="login_required") return json(res,409,{error:"UYAP oturumu gerekli.",sync:before});
      const id=uyap.enqueueCaseDocumentSync(caseId,{priority:6,purpose:"manual_case_sync",source:"web_case_detail"});
      const sync=uyap.caseDocumentSyncStatus(caseId);
      audit("lawyer","uyap_sync_documents","case",m[1],{commandId:id,state:sync.state});
      return json(res,202,{ok:true,accepted:true,id,commandId:Number(id),sync});
    }
    m=p.match(/^\/api\/uyap\/cases\/(\d+)\/download-missing$/);
    if(req.method==="POST"&&m){
      const b=await readBody(req);
      if(b.confirmed!==true) return json(res,409,{error:"Evrak batch kuyruğu için açık kullanıcı onayı gerekli."});
      const caseId=Number(m[1]),limit=Math.max(1,Math.min(200,Number(b.limit)||200));
      const out=uyap.enqueuePendingDownloads(caseId,limit);
      audit("lawyer","uyap_download_case_batch","case",caseId,{limit,queued:out.queued,confirmed:true,manualDownloadPaused:uyap.sessionState().manualDownloadPaused});
      return json(res,202,{ok:true,...out});
    }
    if(req.method==="POST"&&p==="/api/uyap/downloads/pause"){
      const out=uyap.setManualDownloadPause(true,"manual_download_pause");
      return json(res,200,out);
    }
    if(req.method==="POST"&&p==="/api/uyap/downloads/resume"){
      const b=await readBody(req);
      if(b.confirmed!==true) return json(res,409,{error:"UYAP indirmelerini devam ettirmek için açık kullanıcı onayı gerekli."});
      const out=uyap.setManualDownloadPause(false,"");
      audit("lawyer","uyap_downloads_resume","uyap",null,{confirmed:true});
      return json(res,200,out);
    }
    m=p.match(/^\/api\/uyap\/remote-documents\/(\d+)\/download$/);
    if(req.method==="POST"&&m){
      const b=await readBody(req);
      if(b.confirmed!==true) return json(res,409,{error:"UYAP evrak indirme kuyruğu için açık kullanıcı onayı gerekli."});
      const id=uyap.enqueueRemoteDocumentDownload(Number(m[1]));
      audit("lawyer","uyap_download_document","uyap_remote_document",m[1],{commandId:id,confirmed:true,manualDownloadPaused:uyap.sessionState().manualDownloadPaused});
      return json(res,202,{ok:true,id});
    }
    if(req.method==="POST"&&p==="/api/uyap/hearings/sync-range"){
      const b=await readBody(req);
      const out=uyap.enqueueHearingRange(b.start,b.end);
      audit("lawyer","uyap_sync_hearings","hearing_range",null,{start:b.start,end:b.end,windows:out.windows});
      return json(res,202,{ok:true,...out});
    }

    if(req.method==="POST"&&p==="/api/uyap/endpoints/approve"){
      const b=await readBody(req);
      const ep=uyap.approveEndpoint(b);
      audit("lawyer","approve_uyap_endpoint","uyap_endpoint",ep.endpoint_key,{host:ep.host,path:ep.path,purpose:ep.purpose,minIntervalMs:ep.min_interval_ms});
      return json(res,200,ep);
    }
    m=p.match(/^\/api\/uyap\/endpoints\/([^/]+)\/enabled$/);
    if(req.method==="POST"&&m){
      const b=await readBody(req);
      const ep=uyap.setEndpointEnabled(decodeURIComponent(m[1]),!!b.enabled);
      audit("lawyer","set_uyap_endpoint_enabled","uyap_endpoint",ep.endpoint_key,{enabled:ep.enabled});
      return json(res,200,ep);
    }
    if(req.method==="POST"&&p==="/api/uyap/commands"){
      const b=await readBody(req);
      const id=uyap.enqueue(b);
      audit("system","enqueue_uyap_command","uyap_command",id,{commandType:b.commandType,endpointKey:b.endpointKey});
      return json(res,202,{ok:true,id});
    }
    if(req.method==="GET"&&p==="/api/uyap/commands/next"){
      const cmd=uyap.claimNext(u.searchParams.get("host")||"",u.searchParams.get("lane")||"any");
      if(!cmd || cmd.wait){res.writeHead(204);return res.end()}
      audit("bridge","dispatch_uyap_command","uyap_command",cmd.id,{endpointKey:cmd.endpointKey,commandType:cmd.commandType,hardMinIntervalMs:cmd.hardMinIntervalMs});
      return json(res,200,cmd);
    }
    m=p.match(/^\/api\/uyap\/commands\/(\d+)\/result$/);
    if(req.method==="POST"&&m){
      const b=await readBody(req),commandId=Number(m[1]);
      const result=uyap.reportResult(commandId,b);
      audit("bridge","uyap_command_result","uyap_command",m[1],{ok:result.ok,state:result.state,status:b.status||0});
      const q=db.prepare("SELECT command_type FROM uyap_command_queue WHERE id=?").get(commandId);
      if(result.ok&&q?.command_type==="download_document") jobs.enqueue("ingest_uyap_download",{commandId},"uyap-ingest:"+commandId,15);
      return json(res,200,result);
    }
    if(req.method==="POST"&&p==="/api/uyap/pause"){
      const b=await readBody(req);
      return json(res,200,uyap.pause(b.minutes||30,b.reason||"manual_pause"));
    }
    if(req.method==="POST"&&p==="/api/uyap/resume") return json(res,200,uyap.resume());

    if(req.method==="POST"&&p==="/api/office-files"){
      const b=await readBody(req);
      if(!String(b.title||"").trim()) return json(res,400,{error:"Föy başlığı gerekli"});
      const fileNo=String(b.fileNo||"").trim()||null;
      try{
        const r=db.prepare("INSERT INTO office_files(file_no,title,status,primary_client_id,opened_at,notes) VALUES(?,?,?,?,?,?)")
          .run(fileNo,String(b.title).trim(),b.status||"open",b.primaryClientId||null,b.openedAt||null,b.notes||null);
        const id=Number(r.lastInsertRowid);
        audit("lawyer","create_office_file","office_file",id,{fileNo,title:b.title});
        jobs.enqueue("rebuild_search",{},"search-after-office-file:"+id,40);
        return json(res,201,{ok:true,id});
      }catch(e){
        if(String(e.message).includes("UNIQUE")) return json(res,409,{error:"Bu föy numarası zaten kayıtlı"});
        throw e;
      }
    }
    if(req.method==="POST"&&p==="/api/jobs"){
      const b=await readBody(req);
      const allowed=new Set(["scan_documents","scan_case_archive","rebuild_search","backup_db","import_vekalet","analyze_udf_library","analyze_pdf_library","scan_interim_orders","scan_notification_documents","scan_correspondence_matches","create_checkpoint","ingest_uyap_download"]);
      if(!allowed.has(b.jobType)) return json(res,400,{error:"Desteklenmeyen job"});
      const id=jobs.enqueue(b.jobType,b.payload||{},b.fingerprint||null,Number(b.priority||100));
      return json(res,202,{ok:true,id});
    }
    if(req.method==="POST"&&p==="/api/tasks"){
      const b=await readBody(req);
      if(!String(b.title||"").trim()) return json(res,400,{error:"Görev başlığı gerekli"});
      const r=db.prepare("INSERT INTO tasks(office_file_id,case_id,title,description,due_at,priority,status,source) VALUES(?,?,?,?,?,?,?,?)")
        .run(b.officeFileId||null,b.caseId||null,String(b.title).trim(),b.description||null,b.dueAt||null,b.priority||"normal","open",b.source||"manual");
      const id=Number(r.lastInsertRowid);
      audit("lawyer","create_task","task",id,{title:b.title,dueAt:b.dueAt||null});
      jobs.enqueue("rebuild_search",{},"search-after-task:"+id,40);
      return json(res,201,{ok:true,id});
    }
    m=p.match(/^\/api\/deadlines\/(\d+)\/approve$/);
    if(req.method==="POST"&&m){
      const id=Number(m[1]);
      const before=db.prepare("SELECT * FROM deadlines WHERE id=?").get(id);
      if(!before)return json(res,404,{error:"Süre bulunamadı"});
      db.prepare("UPDATE deadlines SET lawyer_approved=1,confidence='approved',approved_at=datetime('now'),approved_by='lawyer' WHERE id=?").run(id);
      audit("lawyer","approve_deadline","deadline",id,{title:before.title,due_at:before.due_at,legal_basis:before.legal_basis});
      jobs.enqueue("rebuild_search",{},"search-after-deadline:"+id,40);
      return json(res,200,{ok:true,id});
    }
    if(req.method==="POST"&&p==="/events"){
      const event=await readBody(req);
      const kind=event?.payload?.kind||event?.kind||"unknown";
      let stored=event;
      if(kind==="page_seen"){
        const d=event?.payload?.data||{};
        const pagePath=String(d.path||"");
        if(/(^|\/)login(?:\.|\/|$)/i.test(pagePath)) uyap.setSessionLoginRequired("uyap_login_page");
      }
      if(kind==="network_observation" && event?.payload?.data?.url){
        const d=event.payload.data;
        try{
          const parsed=new URL(d.url);
          stored={
            capturedAt:event.capturedAt,
            sourceUrl:event.sourceUrl?new URL(event.sourceUrl).origin+new URL(event.sourceUrl).pathname:"",
            payload:{kind,data:{
              transport:d.transport,
              method:d.method,
              url:parsed.origin+parsed.pathname,
              status:d.status,
              contentType:d.contentType,
              durationMs:d.durationMs,
              sampleKeys:Array.isArray(d.sampleKeys)?d.sampleKeys.slice(0,50):[],
              error:d.error?String(d.error).slice(0,500):undefined
            }}
          };
          uyap.observe({...stored.payload.data,request:d.request||null,responseSummary:d.responseSummary||null});
        }catch{}
      }
      fs.appendFileSync(EVENTS,JSON.stringify(stored)+"\n");
      audit("bridge","capture_event","event",null,{kind});
      return json(res,202,{ok:true});
    }
    if(req.method==="GET"&&staticFile(p,res)) return;
    res.writeHead(404,{"Content-Type":"text/plain; charset=utf-8"});res.end("BONO: bulunamadı");
  }catch(e){
    console.error(e);
    if(!res.headersSent) return json(res,500,{ok:false,error:e.message});
    try{res.end()}catch{}
  }
});

jobs.recoverRunning();
const bucket=new Date().toISOString().slice(0,13);
jobs.enqueue("rebuild_search",{},"startup-search:"+new Date().toISOString().slice(0,10),30);
jobs.enqueue("scan_documents",{},"document-scan:"+bucket,60);

if(process.env.BONO_DISABLE_WORKER!=="1"){
  const worker=new Worker(path.join(__dirname,"worker.js"));
  worker.on("error",e=>console.error("BONO worker error",e));
  worker.on("exit",code=>{if(code!==0)console.error("BONO worker exit",code)});
}

v04.setHeartbeat("server","ok",{pid:process.pid,port:PORT});
setInterval(()=>v04.setHeartbeat("server","ok",{pid:process.pid,port:PORT}),30000);

server.listen(PORT,"127.0.0.1",()=>console.log("BONO OS http://127.0.0.1:"+PORT));
