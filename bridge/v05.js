const fs=require("fs");
const path=require("path");
const crypto=require("crypto");
const db=require("./db");

const DESKTOP=process.env.USERPROFILE?path.join(process.env.USERPROFILE,"OneDrive","Masaüstü"):null;
const ARCHIVE_ROOT=DESKTOP?path.join(DESKTOP,"Dava Dosyaları"):null;
const STAGING=path.join(__dirname,"..","data","staging","uyap");
fs.mkdirSync(STAGING,{recursive:true});

function one(sql,...args){return db.prepare(sql).get(...args)}
function all(sql,...args){return db.prepare(sql).all(...args)}
function nrm(s){
  return String(s||"").replace(/İ/g,"I").replace(/ı/g,"i").normalize("NFD")
    .replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
}
function audit(action,type,id,detail,actor="system"){
  db.prepare("INSERT INTO audit_log(occurred_at,actor,action,entity_type,entity_id,detail_json) VALUES(datetime('now'),?,?,?,?,?)")
    .run(actor,action,type,id==null?null:String(id),JSON.stringify(detail||{}));
}
function json(x,fallback={}){try{return JSON.parse(x||"")}catch{return fallback}}
function safeFileName(s){
  return String(s||"Evrak").replace(/[<>:"/\\|?*\x00-\x1F]/g," ").replace(/\s+/g," ").trim().replace(/[. ]+$/,"").slice(0,140)||"Evrak";
}
function normalizeCaseNo(s){
  const m=String(s||"").match(/(20\d{2})\s*[-_/]\s*(\d+)/);
  return m?m[1]+"/"+m[2]:nrm(s);
}
function courtCategory(court){
  const x=nrm(court);
  const map=[
    ["aile","Aile Mahkemesi"],["agir ceza","Ağır Ceza Mahkemesi"],["asliye ceza","Asliye Ceza Mahkemesi"],
    ["asliye hukuk","Asliye Hukuk Mahkemesi"],["asliye ticaret","Asliye Ticaret Mahkemesi"],
    ["sulh hukuk","Sulh Hukuk Mahkemesi"],["sulh ceza","Sulh Ceza Hakimliği"],["icra hukuk","İcra Hukuk Mahkemesi"],
    ["idare","İdare Mahkemesi"],["infaz","İnfaz Hakimliği"],["is mahkem","İş Mahkemeleri"],["cumhuriyet","CBS"],["cbs","CBS"]
  ];
  return map.find(([k])=>x.includes(k))?.[1]||null;
}
function countFilesRecursive(dir,depth=2){
  let n=0;
  try{
    for(const e of fs.readdirSync(dir,{withFileTypes:true})){
      if(e.isFile())n++;
      else if(e.isDirectory()&&depth>0)n+=countFilesRecursive(path.join(dir,e.name),depth-1);
    }
  }catch{}
  return n;
}
function inferCaseNoFromFiles(dir,depth=2){
  const counts=new Map();
  function walk(p,d){
    let entries=[];try{entries=fs.readdirSync(p,{withFileTypes:true})}catch{return}
    for(const e of entries){
      const hits=String(e.name||"").matchAll(/(20\d{2})\s*[-_/]\s*(\d+)/g);
      for(const m of hits){const key=m[1]+"/"+m[2];counts.set(key,(counts.get(key)||0)+1)}
      if(e.isDirectory()&&d>0)walk(path.join(p,e.name),d-1);
    }
  }
  walk(dir,depth);
  const ranked=[...counts.entries()].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]));
  if(!ranked.length)return null;
  if(ranked.length===1)return ranked[0][0];
  if(ranked[0][1]>=Math.max(2,ranked[1][1]*2))return ranked[0][0];
  return null;
}
function scanArchive(root=ARCHIVE_ROOT){
  if(!root||!fs.existsSync(root))throw new Error("Dava Dosyaları kökü bulunamadı");
  const seen=[];
  const generic=new Set(["evraklar","kararlar","ekler","gorseller","görseller","tutanaklar","belgeler","tum banka hareketleri","tüm banka hareketleri"]);
  const categories=fs.readdirSync(root,{withFileTypes:true}).filter(x=>x.isDirectory());
  const candidates=[];
  function collect(dir,catName,depth){
    if(depth>2)return;
    let entries=[];try{entries=fs.readdirSync(dir,{withFileTypes:true})}catch{return}
    for(const ent of entries){
      if(!ent.isDirectory())continue;
      const full=path.join(dir,ent.name),nn=nrm(ent.name);
      if(!generic.has(nn)){
        const directFiles=(()=>{try{return fs.readdirSync(full,{withFileTypes:true}).filter(x=>x.isFile()).length}catch{return 0}})();
        if(directFiles>0||depth===0||/(20\d{2})\s*[-_/]\s*\d+/.test(ent.name)||/dava|sorusturma|soruşturma|itiraz|tahkim/i.test(ent.name))
          candidates.push({full,name:ent.name,catName});
      }
      collect(full,catName,depth+1);
    }
  }
  for(const cat of categories)collect(path.join(root,cat.name),cat.name,0);
  db.exec("BEGIN IMMEDIATE");
  try{
    for(const item of candidates){
      const rel=path.relative(root,item.full);
      const folderCase=(item.name.match(/(20\d{2})\s*[-_/]\s*\d+/)||[])[0]||null;
      const caseNo=folderCase?normalizeCaseNo(folderCase):inferCaseNoFromFiles(item.full,2);
      const fileCount=countFilesRecursive(item.full,2);
      db.prepare(`INSERT INTO archive_folders(root_path,relative_path,court_category,folder_name,inferred_client,inferred_case_no,file_count,last_scanned_at)
        VALUES(?,?,?,?,?,?,?,datetime('now'))
        ON CONFLICT(root_path,relative_path) DO UPDATE SET court_category=excluded.court_category,folder_name=excluded.folder_name,
          inferred_client=excluded.inferred_client,inferred_case_no=excluded.inferred_case_no,file_count=excluded.file_count,last_scanned_at=datetime('now')`)
        .run(root,rel,item.catName,item.name,item.name.split(" - ")[0].trim(),caseNo,fileCount);
      seen.push(rel);
    }
    db.exec("COMMIT");
  }catch(e){db.exec("ROLLBACK");throw e}
  const match=refreshArchiveMatches();
  audit("scan_case_archive","archive",null,{root,folders:seen.length,suggestions:match.suggestions});
  return {root,folders:seen.length,...match};
}
function refreshArchiveMatches(){
  const folders=all("SELECT * FROM archive_folders");
  const cases=all(`SELECT ca.id,ca.office_file_id,ca.court,ca.court_file_no,ca.case_type,ca.client_name,
    o.file_no,o.title,
    (SELECT GROUP_CONCAT(p.name,' | ') FROM parties p WHERE p.case_id=ca.id AND p.is_client=0) opponents
    FROM cases ca LEFT JOIN office_files o ON o.id=ca.office_file_id`);
  let suggestions=0;
  db.prepare("DELETE FROM archive_case_links WHERE status='suggested'").run();
  for(const c of cases){
    const nc=nrm(c.client_name), ncase=normalizeCaseNo(c.court_file_no), cat=nrm(courtCategory(c.court)||"");
    const scored=[];
    for(const f of folders){
      let score=0; const reasons=[];
      const nf=nrm(f.folder_name), ncat=nrm(f.court_category);
      if(nc&&nf.includes(nc)){score+=0.55;reasons.push("müvekkil adı")}
      else if(nc){
        const parts=nc.split(" ").filter(x=>x.length>2),hits=parts.filter(x=>nf.includes(x)).length;
        if(parts.length&&hits/parts.length>=0.66){score+=0.35;reasons.push("isim benzerliği")}
      }
      if(ncase&&normalizeCaseNo(f.inferred_case_no)===normalizeCaseNo(ncase)){score+=0.6;reasons.push("dosya no")}
      if(cat&&ncat===cat){score+=0.2;reasons.push("mahkeme türü")}
      const titleTokens=nrm(c.title||"").split(" ").filter(x=>x.length>3&&!nc.includes(x));
      if(titleTokens.length){
        const hits=titleTokens.filter(x=>nf.includes(x)).length;
        if(hits>=1){score+=Math.min(0.2,hits*0.07);reasons.push("uyuşmazlık başlığı")}
      }
      const oppTokens=nrm(c.opponents||"").split(" ").filter(x=>x.length>3);
      if(oppTokens.length&&oppTokens.some(x=>nf.includes(x))){score+=0.15;reasons.push("karşı taraf")}
      if(score>=0.45)scored.push({f,score:Math.min(1,score),reasons});
    }
    scored.sort((a,b)=>b.score-a.score);
    for(const x of scored.slice(0,3)){
      db.prepare(`INSERT OR IGNORE INTO archive_case_links(office_file_id,case_id,archive_folder_id,confidence,status,reasons_json)
        VALUES(?,?,?,?,'suggested',?)`).run(c.office_file_id,c.id,x.f.id,x.score,JSON.stringify(x.reasons));
      suggestions++;
    }
  }
  return {suggestions};
}
function archiveSuggestions(officeFileId=null){
  const where=officeFileId?"WHERE l.office_file_id=?":"";
  return all(`SELECT l.id,l.office_file_id,l.case_id,l.confidence,l.status,l.reasons_json,
    f.court_category,f.folder_name,f.relative_path,f.file_count,c.court,c.court_file_no,c.client_name,o.file_no
    FROM archive_case_links l JOIN archive_folders f ON f.id=l.archive_folder_id
    LEFT JOIN cases c ON c.id=l.case_id LEFT JOIN office_files o ON o.id=l.office_file_id
    ${where} ORDER BY l.status='verified' DESC,l.confidence DESC,l.id DESC`,...(officeFileId?[officeFileId]:[]))
    .map(r=>({...r,reasons:json(r.reasons_json,[])}));
}
function verifyArchiveLink(id){
  const l=one("SELECT * FROM archive_case_links WHERE id=?",id);if(!l)throw new Error("Arşiv eşleşmesi bulunamadı");
  db.prepare("UPDATE archive_case_links SET status='verified',verified_at=datetime('now'),verified_by='lawyer' WHERE id=?").run(id);
  db.prepare("UPDATE archive_case_links SET status='rejected' WHERE case_id=? AND id<>? AND status='suggested'").run(l.case_id,id);
  const link=one(`SELECT l.*,f.root_path,f.relative_path FROM archive_case_links l JOIN archive_folders f ON f.id=l.archive_folder_id WHERE l.id=?`,id);
  const abs=path.join(link.root_path,link.relative_path).toLowerCase();
  const locs=all("SELECT id,asset_id,local_path FROM asset_locations");
  let attached=0;
  for(const loc of locs){
    const lp=String(loc.local_path||"").toLowerCase();
    if(lp===abs||lp.startsWith(abs+path.sep.toLowerCase())){
      db.prepare("UPDATE local_assets SET suggested_office_file_id=? WHERE id=?").run(l.office_file_id,loc.asset_id);
      db.prepare("UPDATE knowledge_chunks SET office_file_id=?,case_id=COALESCE(case_id,?) WHERE asset_id=?").run(l.office_file_id,l.case_id,loc.asset_id);
      attached++;
    }
  }
  audit("verify_archive_link","archive_case_link",id,{caseId:l.case_id,attachedAssets:attached},"lawyer");
  return {...link,attachedAssets:attached};
}
function archivePathForCase(caseId){
  const x=one(`SELECT f.root_path,f.relative_path,l.id FROM archive_case_links l JOIN archive_folders f ON f.id=l.archive_folder_id
    WHERE l.case_id=? AND l.status='verified' ORDER BY l.id DESC LIMIT 1`,caseId);
  return x?path.join(x.root_path,x.relative_path):null;
}

function ensureSyncProfile(caseId){
  db.prepare("INSERT OR IGNORE INTO uyap_sync_profiles(case_id) VALUES(?)").run(caseId);
  return one("SELECT * FROM uyap_sync_profiles WHERE case_id=?",caseId);
}
function syncProfile(caseId){return ensureSyncProfile(caseId)}
function ingestRemoteManifest(caseId,docs,{manifestType="delta",source="authorized_channel"}={}){
  const ca=one("SELECT * FROM cases WHERE id=?",caseId);if(!ca)throw new Error("Dosya bulunamadı");
  const profile=ensureSyncProfile(caseId);
  const baseline=manifestType==="baseline"||profile.sync_mode==="baseline_pending";
  let newCount=0,seen=0,already=0;
  db.exec("BEGIN IMMEDIATE");
  try{
    for(const d of docs||[]){
      if(!d.remoteDocumentId)continue; seen++;
      const ex=one("SELECT id,status FROM uyap_remote_documents WHERE case_id=? AND remote_document_id=?",caseId,String(d.remoteDocumentId));
      if(ex){
        already++;
        db.prepare(`UPDATE uyap_remote_documents SET remote_title=?,document_type=?,document_date=?,original_file_name=?,
          remote_hash=COALESCE(?,remote_hash),last_seen_at=datetime('now'),metadata_json=? WHERE id=?`)
          .run(d.title||null,d.documentType||null,d.documentDate||null,d.fileName||null,d.remoteHash||null,JSON.stringify(d.metadata||{}),ex.id);
      }else{
        newCount++;
        db.prepare(`INSERT INTO uyap_remote_documents(case_id,remote_document_id,remote_title,document_type,document_date,original_file_name,
          remote_hash,status,is_baseline,metadata_json) VALUES(?,?,?,?,?,?,?,'discovered',?,?)`)
          .run(caseId,String(d.remoteDocumentId),d.title||null,d.documentType||null,d.documentDate||null,d.fileName||null,d.remoteHash||null,baseline?1:0,JSON.stringify(d.metadata||{}));
      }
    }
    db.prepare(`UPDATE uyap_sync_profiles SET last_manifest_checked_at=datetime('now'),last_delta_at=CASE WHEN ?=0 THEN datetime('now') ELSE last_delta_at END,
      remote_document_count=(SELECT COUNT(*) FROM uyap_remote_documents WHERE case_id=?),updated_at=datetime('now') WHERE case_id=?`)
      .run(baseline?1:0,caseId,caseId);
    db.exec("COMMIT");
  }catch(e){db.exec("ROLLBACK");throw e}
  const newRows=newCount?all(`SELECT rd.*,c.office_file_id FROM uyap_remote_documents rd JOIN cases c ON c.id=rd.case_id WHERE rd.case_id=? AND rd.status='discovered' ORDER BY rd.id DESC LIMIT ?`,caseId,newCount).reverse():[];
  if(!baseline&&newRows.length){const bus=require("./event_bus");bus.onManifest(caseId,newRows,{baseline:false});
    const uyap=require("./uyap");
    for(const rd of newRows){
      if(profile.auto_download_new===1&&uyap.rateState().integration_mode==="official_api"){
        try{uyap.enqueue({commandType:"download_document",endpointKey:"document_download",payload:{caseId,remoteDocumentDbId:rd.id,remoteDocumentId:rd.remote_document_id},priority:40})}
        catch(e){bus.emit("uyap.document.download_waiting",{key:"uyap.document.download_waiting:"+rd.id,entityType:"uyap_remote_document",entityId:rd.id,officeFileId:rd.office_file_id,caseId,payload:{reason:String(e.message||e)}})}
      }else bus.emit("uyap.document.download_waiting",{key:"uyap.document.download_waiting:"+rd.id,entityType:"uyap_remote_document",entityId:rd.id,officeFileId:rd.office_file_id,caseId,payload:{reason:"download channel not active"}});
    }
  }
  audit("ingest_remote_manifest","case",caseId,{manifestType:baseline?"baseline":"delta",source,seen,newCount,already});
  return {caseId,manifestType:baseline?"baseline":"delta",seen,newCount,already,eventsEmitted:baseline?0:newRows.length,autoDownloadEligible:profile.auto_download_new===1&&!baseline};
}
function baselineStatus(caseId){
  const p=ensureSyncProfile(caseId);
  const counts=one(`SELECT COUNT(*) total,
    SUM(CASE WHEN status IN ('downloaded','indexed','filed','summarized','skipped','review','duplicate') THEN 1 ELSE 0 END) downloaded,
    SUM(CASE WHEN status IN ('filed','summarized','skipped','review','duplicate') THEN 1 ELSE 0 END) filed
    FROM uyap_remote_documents WHERE case_id=?`,caseId);
  return {...p,total:Number(counts.total||0),downloaded:Number(counts.downloaded||0),filed:Number(counts.filed||0)};
}
function completeBaseline(caseId){
  const s=baselineStatus(caseId);
  if(s.total>0&&s.downloaded<s.total)throw new Error("Baseline tamamlanamaz: indirilmeyen evraklar var");
  db.prepare(`UPDATE uyap_sync_profiles SET sync_mode='delta',baseline_completed_at=datetime('now'),updated_at=datetime('now') WHERE case_id=?`).run(caseId);
  audit("complete_uyap_baseline","case",caseId,{documents:s.total},"lawyer");
  return baselineStatus(caseId);
}
function pendingRemoteDocuments(caseId,onlyNew=true){
  const p=ensureSyncProfile(caseId);
  const baseline=p.sync_mode==="baseline_pending";
  const sql=`SELECT * FROM uyap_remote_documents WHERE case_id=? AND status='discovered' ${onlyNew&&!baseline?"AND is_baseline=0":""} ORDER BY COALESCE(document_date,first_seen_at),id`;
  return all(sql,caseId).map(r=>({...r,metadata:json(r.metadata_json,{})}));
}
function buildArchiveFileName(doc){
  const original=String(doc.original_file_name||"");
  const ext=(path.extname(original)||".udf").toLowerCase();
  const base=path.parse(original).name.trim();
  const generic=/^(evrak|document|dosya|file|download)[ _-]*\d+$/i.test(base)||/^\d+$/.test(base)||base.length<3;
  if(base&&!generic)return safeFileName(base)+ext;
  const title=safeFileName(doc.remote_title||doc.document_type||"Evrak");
  return title+ext;
}
function markRemoteDownloaded(remoteId,stagingPath,sha256=null){
  const d=one("SELECT * FROM uyap_remote_documents WHERE id=?",remoteId);if(!d)throw new Error("Remote evrak bulunamadı");
  db.prepare("UPDATE uyap_remote_documents SET staging_path=?,remote_hash=COALESCE(?,remote_hash),status='downloaded',downloaded_at=datetime('now') WHERE id=?")
    .run(stagingPath,sha256,remoteId);
  db.prepare(`UPDATE uyap_sync_profiles SET downloaded_count=(SELECT COUNT(*) FROM uyap_remote_documents WHERE case_id=? AND status IN ('downloaded','filed')),updated_at=datetime('now') WHERE case_id=?`)
    .run(d.case_id,d.case_id);
  return one("SELECT * FROM uyap_remote_documents WHERE id=?",remoteId);
}
function fileDownloadedRemote(remoteId,{copy=true}={}){
  const d=one("SELECT * FROM uyap_remote_documents WHERE id=?",remoteId);if(!d)throw new Error("Remote evrak bulunamadı");
  if(d.status!=="downloaded"||!d.staging_path||!fs.existsSync(d.staging_path))throw new Error("Staging dosyası hazır değil");
  const destDir=archivePathForCase(d.case_id);if(!destDir)throw new Error("Bu UYAP dosyası için doğrulanmış Dava Dosyaları klasörü yok");
  fs.mkdirSync(destDir,{recursive:true});
  const base=buildArchiveFileName(d); let dest=path.join(destDir,base),i=2;
  while(fs.existsSync(dest)){const ext=path.extname(base),stem=path.basename(base,ext);dest=path.join(destDir,stem+" ("+i+")"+ext);i++}
  if(copy)fs.copyFileSync(d.staging_path,dest);else fs.renameSync(d.staging_path,dest);
  const buf=fs.readFileSync(dest),hash=crypto.createHash("sha256").update(buf).digest("hex");
  db.prepare("UPDATE uyap_remote_documents SET filed_path=?,remote_hash=COALESCE(remote_hash,?),status='filed',filed_at=datetime('now') WHERE id=?").run(dest,hash,remoteId);
  db.prepare(`UPDATE uyap_sync_profiles SET filed_count=(SELECT COUNT(*) FROM uyap_remote_documents WHERE case_id=? AND status='filed'),updated_at=datetime('now') WHERE case_id=?`).run(d.case_id,d.case_id);
  audit("file_uyap_document","uyap_remote_document",remoteId,{dest,hash});
  return {id:remoteId,destination:dest,sha256:hash};
}

function correspondence(officeFileId){
  return all(`SELECT cr.*,c.court_file_no,
    CAST(julianday('now','localtime')-julianday(cr.sent_at) AS INTEGER) open_days
    FROM correspondence_requests cr LEFT JOIN cases c ON c.id=cr.case_id
    WHERE cr.office_file_id=? ORDER BY CASE cr.status WHEN 'sent' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END,COALESCE(cr.sent_at,cr.requested_at) DESC`,officeFileId);
}
function createCorrespondence(b){
  if(!b.officeFileId||!b.institution||!b.subject)throw new Error("Föy, kurum ve konu gerekli");
  const r=db.prepare(`INSERT INTO correspondence_requests(office_file_id,case_id,institution,subject,request_kind,requested_at,sent_at,status,notes)
    VALUES(?,?,?,?,?,?,?,?,?)`).run(b.officeFileId,b.caseId||null,b.institution,b.subject,b.requestKind||"müzekkere",
      b.requestedAt||new Date().toISOString(),b.sentAt||null,b.status||"draft",b.notes||null);
  const id=Number(r.lastInsertRowid);
  if(b.sentAt)db.prepare(`INSERT OR IGNORE INTO timeline_events(office_file_id,case_id,event_type,title,occurred_at,source,source_entity_type,source_entity_id,detail_json)
    VALUES(?,?, 'correspondence_sent', ?,?,'manual','correspondence',?,?)`).run(b.officeFileId,b.caseId||null,"Müzekkere: "+b.institution,b.sentAt,String(id),JSON.stringify({subject:b.subject}));
  audit("create_correspondence","correspondence",id,b,"lawyer");
  return one("SELECT * FROM correspondence_requests WHERE id=?",id);
}
function markCorrespondenceResponse(id,b={}){
  const cr=one("SELECT * FROM correspondence_requests WHERE id=?",id);if(!cr)throw new Error("Müzekkere bulunamadı");
  const when=b.responseReceivedAt||new Date().toISOString();
  db.prepare("UPDATE correspondence_requests SET response_received_at=?,response_document_id=?,status='answered',notes=COALESCE(?,notes),updated_at=datetime('now') WHERE id=?")
    .run(when,b.responseDocumentId||null,b.notes||null,id);
  db.prepare(`INSERT OR IGNORE INTO timeline_events(office_file_id,case_id,event_type,title,occurred_at,source,source_entity_type,source_entity_id,detail_json)
    VALUES(?,?, 'correspondence_response', ?,?,'manual','correspondence',?,?)`).run(cr.office_file_id,cr.case_id,"Müzekkere cevabı: "+cr.institution,when,String(id),JSON.stringify({subject:cr.subject}));
  audit("answer_correspondence","correspondence",id,{when},"lawyer");
  return one("SELECT * FROM correspondence_requests WHERE id=?",id);
}

function evidenceMatrix(officeFileId){
  const issues=all("SELECT * FROM evidence_issues WHERE office_file_id=? ORDER BY sort_order,id",officeFileId);
  for(const i of issues){
    i.links=all(`SELECT l.*,a.file_name,rd.remote_title,cr.institution correspondence_institution,cr.subject correspondence_subject
      FROM evidence_links l LEFT JOIN local_assets a ON a.id=l.asset_id
      LEFT JOIN uyap_remote_documents rd ON rd.id=l.remote_document_id
      LEFT JOIN correspondence_requests cr ON cr.id=l.correspondence_id
      WHERE l.evidence_issue_id=? ORDER BY l.evidence_role,l.id`,i.id);
  }
  return issues;
}
function createEvidenceIssue(b){
  if(!b.officeFileId||!b.title)throw new Error("Föy ve vakıa/isnat başlığı gerekli");
  const r=db.prepare(`INSERT INTO evidence_issues(office_file_id,case_id,issue_type,title,allegation_side,burden_side,status,notes,sort_order)
    VALUES(?,?,?,?,?,?,?,?,?)`).run(b.officeFileId,b.caseId||null,b.issueType||"vakıa",b.title,b.allegationSide||null,b.burdenSide||null,b.status||"open",b.notes||null,b.sortOrder||100);
  const id=Number(r.lastInsertRowid);audit("create_evidence_issue","evidence_issue",id,b,"lawyer");return one("SELECT * FROM evidence_issues WHERE id=?",id);
}
function addEvidenceLink(issueId,b){
  if(!one("SELECT id FROM evidence_issues WHERE id=?",issueId))throw new Error("Delil matrisi satırı bulunamadı");
  if(!b.linkType)throw new Error("Delil türü gerekli");
  const r=db.prepare(`INSERT INTO evidence_links(evidence_issue_id,link_type,evidence_role,asset_id,remote_document_id,correspondence_id,title,detail,status)
    VALUES(?,?,?,?,?,?,?,?,?)`).run(issueId,b.linkType,b.evidenceRole||"neutral",b.assetId||null,b.remoteDocumentId||null,b.correspondenceId||null,b.title||null,b.detail||null,b.status||"available");
  const id=Number(r.lastInsertRowid);audit("add_evidence_link","evidence_link",id,b,"lawyer");return one("SELECT * FROM evidence_links WHERE id=?",id);
}
function representationRadar(officeFileId=null){
  const where=officeFileId?"WHERE o.id=?":"";
  const rows=all(`SELECT o.id office_file_id,o.file_no,o.title,o.primary_client_id,c.display_name client_name,
    ca.id case_id,ca.court,ca.court_file_no,
    (SELECT COUNT(*) FROM powers_of_attorney p WHERE p.client_id=o.primary_client_id AND p.status='active') client_power_count,
    (SELECT p.id FROM powers_of_attorney p WHERE p.client_id=o.primary_client_id AND p.status='active' ORDER BY COALESCE(p.issued_at,'') DESC,p.id DESC LIMIT 1) candidate_power_id,
    (SELECT COUNT(*) FROM power_case_links pcl JOIN powers_of_attorney p ON p.id=pcl.power_id WHERE pcl.case_id=ca.id AND p.client_id=o.primary_client_id) linked_power_count,
    (SELECT COUNT(*) FROM power_sources ps JOIN powers_of_attorney p ON p.id=ps.power_id WHERE p.client_id=o.primary_client_id AND COALESCE(ps.local_path,'')<>'') local_power_source_count
    FROM office_files o LEFT JOIN clients c ON c.id=o.primary_client_id
    LEFT JOIN cases ca ON ca.office_file_id=o.id ${where} ORDER BY o.file_no,ca.id`,...(officeFileId?[officeFileId]:[]));
  return rows.map(r=>{
    let status="ok",problems=[];
    if(!r.primary_client_id){status="missing_client";problems.push("Müvekkil bağlı değil")}
    else if(!r.client_power_count){status="missing_power";problems.push("Aktif vekâlet kaydı yok")}
    else if(r.case_id&&!r.linked_power_count){status="unlinked_power";problems.push("Vekâlet UYAP dosyasına bağlanmamış")}
    if(r.client_power_count&&!r.local_power_source_count){if(status==="ok")status="missing_source";problems.push("Yerel vekâlet belgesi yok")}
    return {...r,status,problems};
  });
}
function linkPowerToCase(caseId,powerId){
  const ca=one(`SELECT ca.id,ca.office_file_id,o.primary_client_id FROM cases ca
    LEFT JOIN office_files o ON o.id=ca.office_file_id WHERE ca.id=?`,caseId);
  const p=one("SELECT id,client_id,status FROM powers_of_attorney WHERE id=?",powerId);
  if(!ca||!p)throw new Error("Dosya veya vekâlet bulunamadı");
  if(p.status!=="active")throw new Error("Yalnız aktif vekâlet bağlanabilir");
  if(!ca.primary_client_id||Number(ca.primary_client_id)!==Number(p.client_id))throw new Error("Bu vekâlet föyün ana müvekkiline ait değil");
  db.prepare("INSERT OR IGNORE INTO power_case_links(power_id,case_id) VALUES(?,?)").run(powerId,caseId);
  audit("link_power_to_case","case",caseId,{powerId},"lawyer");
  return {ok:true,caseId,powerId};
}
function accountingOverview(caseId=null){
  let converted=all(`SELECT n.id,n.office_file_id,n.case_id,n.title,n.body,n.created_at,
    c.court,c.court_file_no,o.file_no office_file_no
    FROM notes n
    LEFT JOIN cases c ON c.id=n.case_id
    LEFT JOIN office_files o ON o.id=n.office_file_id
    WHERE n.title IN ('Reddiyat Özeti','Tahsilat Özeti')
      AND n.body LIKE '%Kaynak UYAP evrakı:%'
    ORDER BY n.created_at DESC LIMIT 300`);
  let pending=all(`SELECT rd.id,rd.case_id,rd.remote_title,rd.document_type,rd.document_date,rd.original_file_name,
      rd.status,rd.local_asset_id,c.court,c.court_file_no,o.file_no office_file_no,
      CASE
        WHEN rd.status IN ('discovered','download_queued','downloaded') THEN 'Belge henüz analize hazır değil'
        WHEN rd.status='indexed' THEN 'Otomatik özet için güvenli tutar tespit edilemedi'
        ELSE 'İnceleme bekliyor'
      END reason
    FROM uyap_remote_documents rd
    JOIN cases c ON c.id=rd.case_id
    LEFT JOIN office_files o ON o.id=c.office_file_id
    WHERE rd.status<>'summarized'
      AND lower(COALESCE(rd.remote_title,'')||' '||COALESCE(rd.document_type,'')||' '||COALESCE(rd.original_file_name,'')) GLOB '*reddiyat*'
       OR (rd.status<>'summarized' AND lower(COALESCE(rd.remote_title,'')||' '||COALESCE(rd.document_type,'')||' '||COALESCE(rd.original_file_name,'')) GLOB '*tahsil*')
    ORDER BY COALESCE(rd.document_date,rd.first_seen_at) DESC,rd.id DESC LIMIT 300`);
  if(caseId!=null){
    const cid=Number(caseId);
    converted=converted.filter(x=>Number(x.case_id)===cid);
    pending=pending.filter(x=>Number(x.case_id)===cid);
  }
  return {converted,pending,counts:{converted:converted.length,pending:pending.length}};
}
function archiveStandard(){
  const cats=all("SELECT court_category,COUNT(*) folder_count,SUM(file_count) file_count FROM archive_folders GROUP BY court_category ORDER BY court_category");
  return {root:ARCHIVE_ROOT,categories:cats,naming:{downloaded:"Anlamlı UYAP dosya adı korunur; generic adlarda evrak başlığı/türü.ext",collisionSuffix:" (2)",preserveOriginalMetadata:true,staging:STAGING}};
}
module.exports={scanArchive,refreshArchiveMatches,archiveSuggestions,verifyArchiveLink,archivePathForCase,archiveStandard,
  syncProfile,ingestRemoteManifest,baselineStatus,completeBaseline,pendingRemoteDocuments,buildArchiveFileName,markRemoteDownloaded,fileDownloadedRemote,
  correspondence,createCorrespondence,markCorrespondenceResponse,evidenceMatrix,createEvidenceIssue,addEvidenceLink,representationRadar,linkPowerToCase,accountingOverview};