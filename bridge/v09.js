const fs=require("fs"),path=require("path"),crypto=require("crypto");
const db=require("./db"),v06=require("./v06"),v04=require("./v04"),repo=require("./repository");
function one(s,...a){return db.prepare(s).get(...a)} function all(s,...a){return db.prepare(s).all(...a)}
function j(s,d={}){try{return JSON.parse(s||"")}catch{return d}}
function norm(s){return String(s||"").replace(/İ/g,"I").replace(/ı/g,"i").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase()}
function audit(action,type,id,detail,actor="system"){db.prepare("INSERT INTO audit_log(occurred_at,actor,action,entity_type,entity_id,detail_json) VALUES(datetime('now'),?,?,?,?,?)").run(actor,action,type,id==null?null:String(id),JSON.stringify(detail||{}))}
function fp(...x){return crypto.createHash("sha1").update(x.map(v=>String(v||"")).join("|")).digest("hex")}
function init(){db.exec(`
CREATE TABLE IF NOT EXISTS hearing_action_items(
 id INTEGER PRIMARY KEY,office_file_id INTEGER NOT NULL,case_id INTEGER,asset_id INTEGER,
 source_kind TEXT NOT NULL DEFAULT 'document',category TEXT NOT NULL,text TEXT NOT NULL,
 candidate_date TEXT,duration_text TEXT,deadline_review_required INTEGER NOT NULL DEFAULT 0,
 status TEXT NOT NULL DEFAULT 'open',confidence REAL NOT NULL DEFAULT .5,fingerprint TEXT UNIQUE,
 created_at TEXT NOT NULL DEFAULT(datetime('now')),resolved_at TEXT,approved_by TEXT,
 FOREIGN KEY(office_file_id) REFERENCES office_files(id) ON DELETE CASCADE,
 FOREIGN KEY(case_id) REFERENCES cases(id) ON DELETE CASCADE,
 FOREIGN KEY(asset_id) REFERENCES local_assets(id) ON DELETE SET NULL);
CREATE INDEX IF NOT EXISTS ix_hearing_actions_file ON hearing_action_items(office_file_id,status,category);

CREATE TABLE IF NOT EXISTS correspondence_match_suggestions(
 id INTEGER PRIMARY KEY,correspondence_id INTEGER NOT NULL,asset_id INTEGER,remote_document_id INTEGER,
 score REAL NOT NULL,reasons_json TEXT,status TEXT NOT NULL DEFAULT 'suggested',
 created_at TEXT NOT NULL DEFAULT(datetime('now')),decided_at TEXT,decided_by TEXT,
 UNIQUE(correspondence_id,asset_id,remote_document_id),
 FOREIGN KEY(correspondence_id) REFERENCES correspondence_requests(id) ON DELETE CASCADE,
 FOREIGN KEY(asset_id) REFERENCES local_assets(id) ON DELETE CASCADE,
 FOREIGN KEY(remote_document_id) REFERENCES uyap_remote_documents(id) ON DELETE CASCADE);

CREATE TABLE IF NOT EXISTS document_extraction_log(
 id INTEGER PRIMARY KEY,asset_id INTEGER NOT NULL,extractor TEXT NOT NULL,result_json TEXT,status TEXT NOT NULL DEFAULT 'done',
 created_at TEXT NOT NULL DEFAULT(datetime('now')),UNIQUE(asset_id,extractor),
 FOREIGN KEY(asset_id) REFERENCES local_assets(id) ON DELETE CASCADE);

CREATE TABLE IF NOT EXISTS system_checkpoints(
 id INTEGER PRIMARY KEY,kind TEXT NOT NULL,label TEXT NOT NULL,db_path TEXT,source_path TEXT,status TEXT NOT NULL DEFAULT 'ready',
 created_at TEXT NOT NULL DEFAULT(datetime('now')),metadata_json TEXT);
`);repairCheckpointPaths()}
function repairCheckpointPaths(){
 const root=path.join(__dirname,"..","data","backups");if(!fs.existsSync(root))return 0;let fixed=0;
 for(const c of all("SELECT id,db_path,source_path FROM system_checkpoints")){
  let dbPath=c.db_path,sourcePath=c.source_path,changed=false;
  if(dbPath&&!fs.existsSync(dbPath)){const alt=path.join(root,path.basename(dbPath));if(fs.existsSync(alt)){dbPath=alt;changed=true}}
  if(sourcePath&&!fs.existsSync(sourcePath)){const alt=path.join(root,path.basename(sourcePath));if(fs.existsSync(alt)){sourcePath=alt;changed=true}}
  if(changed){db.prepare("UPDATE system_checkpoints SET db_path=?,source_path=? WHERE id=?").run(dbPath,sourcePath,c.id);fixed++}
 }
 return fixed;
}
function representedRoles(caseId){
 const rows=all(`SELECT p.role FROM parties p JOIN cases c ON c.id=p.case_id LEFT JOIN office_files o ON o.id=c.office_file_id
 WHERE p.case_id=? AND (p.is_client=1 OR (o.primary_client_id IS NOT NULL AND p.client_id=o.primary_client_id))`,caseId);
 return rows.map(x=>norm(x.role));
}
function classifyAction(text,caseId){
 const n=norm(text),roles=representedRoles(caseId);
 const mentionsPlaintiff=/davaci|musteki|katilan/.test(n),mentionsDefendant=/davali|sanik|supheli/.test(n);
 const oursPlaintiff=roles.some(r=>/davaci|musteki|katilan/.test(r)),oursDefendant=roles.some(r=>/davali|sanik|supheli/.test(r));
 if(/mahkemece|mahkememizce|muzekkere yazil|kurumdan|kuruma|bilirkisi|adli tip/.test(n))return "court_institution";
 if((mentionsPlaintiff&&oursPlaintiff)||(mentionsDefendant&&oursDefendant))return "our_side";
 if((mentionsPlaintiff&&oursDefendant)||(mentionsDefendant&&oursPlaintiff))return "opponent";
 if(/taraflara|vekiline|vekillere|taraf vekil/.test(n))return "party_review";
 return "court_institution";
}
function extractDate(text){const m=String(text).match(/\b(\d{1,2})[.\/-](\d{1,2})[.\/-](20\d{2})\b/);if(!m)return null;return `${m[3]}-${String(m[2]).padStart(2,"0")}-${String(m[1]).padStart(2,"0")}`}
function extractDuration(text){const m=norm(text).match(/\b(\d{1,3})\s*(gun|gün|hafta|ay)\b/);return m?m[1]+" "+m[2]:null}
function actionCandidates(raw){
 const text=String(raw||"").replace(/\r/g,"\n");
 const parts=text.split(/\n+|(?<=[.;:])\s+(?=(?:davaci|davalı|davalı|mahkeme|taraf|sanık|sanik|müşteki|kurum|müzekkere|bilirkişi))/i)
  .map(x=>x.trim().replace(/\s+/g," ")).filter(x=>x.length>=20&&x.length<=1200);
 return parts.filter(x=>{
  const n=norm(x),numbered=/^\s*\d{1,2}\s*[-.)]/.test(x);
  if(/ara karar|kesin sure/.test(n))return true;
  if(!numbered)return /\b\d{1,3}\s*(gun|hafta|ay)\s*(kesin\s*)?sure|tarihine kadar/.test(n);
  return /muzekkere|celbine|tebligine|davetiy|beklenilmes|sure veril|sunulmas|bildirilmes|istenilmes|yazilmas|cikarilmas|duruşma gun ve saat|durusma gun ve saat/.test(n);
 });
}
function scanInterimOrders({officeFileId=null,assetId=null}={}){
 let sql=`SELECT DISTINCT a.id asset_id,a.file_name,a.classification,da.raw_text,k.office_file_id,k.case_id
 FROM local_assets a LEFT JOIN document_analysis da ON da.asset_id=a.id LEFT JOIN knowledge_chunks k ON k.asset_id=a.id
 WHERE COALESCE(da.raw_text,'')!='' AND k.office_file_id IS NOT NULL`,args=[];
 if(assetId){sql+=" AND a.id=?";args.push(assetId)}
 if(officeFileId){sql+=" AND k.office_file_id=?";args.push(officeFileId)}
 sql+=" ORDER BY a.id DESC LIMIT 500";
 const docs=all(sql,...args);let added=0,seen=0;
 for(const d of docs){
  const kind=norm((d.classification||"")+" "+d.file_name),head=norm(String(d.raw_text||"").slice(0,3500));
  if(!/tensip|tutanak|karar|duruşma|durusma/.test(kind)&&!/durusma tutanagi|tensip zapti|ara karar/.test(head))continue;
  for(const t of actionCandidates(d.raw_text)){seen++;const category=classifyAction(t,d.case_id),date=extractDate(t),duration=extractDuration(t),nt=norm(t),review=(duration||/kesin sure|tarihine kadar|gun icinde|suresi icinde/.test(nt))?1:0,fingerprint=fp(d.asset_id,t);
   const r=db.prepare(`INSERT OR IGNORE INTO hearing_action_items(office_file_id,case_id,asset_id,category,text,candidate_date,duration_text,deadline_review_required,confidence,fingerprint)
    VALUES(?,?,?,?,?,?,?,?,?,?)`).run(d.office_file_id,d.case_id,d.asset_id,category,t,date,duration,review,category==="party_review"?.45:.65,fingerprint);if(r.changes){added++;const item=one("SELECT id FROM hearing_action_items WHERE fingerprint=?",fingerprint);if(item&&(category==="our_side"||review))v06.upsertRadar({officeFileId:d.office_file_id,caseId:d.case_id,itemType:"interim_order",title:review?"Ara karar — süre kontrolü gerekli":"Ara karar — bizim işlemimiz",detail:t,severity:review?"warning":"action",sourceEntityType:"hearing_action_item",sourceEntityId:item.id,fingerprint:"hearing-action:"+item.id});}
  }
 }
 audit("scan_interim_orders","hearing_action_item",null,{officeFileId,assetId,docs:docs.length,seen,added});
 return {docs:docs.length,candidates:seen,added};
}
function actionItems({officeFileId=null,status="open"}={}){
 let w=[],a=[];if(officeFileId){w.push("h.office_file_id=?");a.push(officeFileId)}if(status){w.push("h.status=?");a.push(status)}
 return all(`SELECT h.*,o.file_no,o.title office_file_title,c.court,c.court_file_no,la.file_name
 FROM hearing_action_items h JOIN office_files o ON o.id=h.office_file_id LEFT JOIN cases c ON c.id=h.case_id LEFT JOIN local_assets la ON la.id=h.asset_id
 ${w.length?"WHERE "+w.join(" AND "):""} ORDER BY h.deadline_review_required DESC,h.id DESC LIMIT 500`,...a);
}
function resolveAction(id){db.prepare("UPDATE hearing_action_items SET status='resolved',resolved_at=datetime('now'),approved_by='lawyer' WHERE id=?").run(id);db.prepare("UPDATE work_radar_items SET status='resolved',resolved_at=datetime('now') WHERE source_entity_type='hearing_action_item' AND source_entity_id=?").run(String(id));audit("resolve_hearing_action","hearing_action_item",id,{},"lawyer");return one("SELECT * FROM hearing_action_items WHERE id=?",id)}
function tokenScore(a,b){const A=new Set(norm(a).split(/[^a-z0-9çğıöşü]+/).filter(x=>x.length>3)),B=new Set(norm(b).split(/[^a-z0-9çğıöşü]+/).filter(x=>x.length>3));if(!A.size||!B.size)return 0;let hit=0;for(const x of A)if(B.has(x))hit++;return hit/Math.max(1,Math.min(A.size,B.size))}
function scanCorrespondenceMatches({officeFileId=null}={}){
 let q=`SELECT * FROM correspondence_requests WHERE status NOT IN ('answered','closed')`,args=[];if(officeFileId){q+=" AND office_file_id=?";args.push(officeFileId)}
 const corr=all(q,...args);let added=0;
 for(const c of corr){
  const docs=all(`SELECT DISTINCT a.id asset_id,a.file_name,a.classification,da.raw_text FROM knowledge_chunks k JOIN local_assets a ON a.id=k.asset_id LEFT JOIN document_analysis da ON da.asset_id=a.id
   WHERE k.office_file_id=? AND (lower(COALESCE(a.classification,'')) LIKE '%müzekkere%' OR lower(COALESCE(a.file_name,'')) LIKE '%müzekkere%' OR lower(COALESCE(da.raw_text,'')) LIKE '%müzekkere%') ORDER BY a.id DESC LIMIT 80`,c.office_file_id);
  for(const d of docs){const hay=[d.file_name,d.raw_text].filter(Boolean).join(" "),s1=tokenScore(c.institution,hay),s2=tokenScore(c.subject,hay),score=Math.min(1,.55*s1+.45*s2+(/cevap|cevabi|cevabı/i.test(hay)?.2:0));if(score<.35)continue;
   const r=db.prepare(`INSERT OR IGNORE INTO correspondence_match_suggestions(correspondence_id,asset_id,score,reasons_json) VALUES(?,?,?,?)`).run(c.id,d.asset_id,score,JSON.stringify({institution:s1,subject:s2,answerCue:/cevap|cevabi|cevabı/i.test(hay)}));if(r.changes){added++;const m=one("SELECT id FROM correspondence_match_suggestions WHERE correspondence_id=? AND asset_id=?",c.id,d.asset_id);if(m&&score>=.65)v06.upsertRadar({officeFileId:c.office_file_id,caseId:c.case_id,itemType:"correspondence_match",title:"Müzekkere cevabı eşleşme önerisi",detail:[c.institution,c.subject,d.file_name].filter(Boolean).join(" · "),severity:"action",sourceEntityType:"correspondence_match",sourceEntityId:m.id,fingerprint:"corr-match:"+m.id});}
  }
 }
 audit("scan_correspondence_matches","correspondence_match",null,{officeFileId,open: corr.length,added});return {open: corr.length,added};
}
function correspondenceMatches(officeFileId=null){return all(`SELECT m.*,r.office_file_id,r.institution,r.subject,a.file_name FROM correspondence_match_suggestions m JOIN correspondence_requests r ON r.id=m.correspondence_id LEFT JOIN local_assets a ON a.id=m.asset_id WHERE m.status='suggested' ${officeFileId?"AND r.office_file_id=?":""} ORDER BY m.score DESC,m.id DESC`,...(officeFileId?[officeFileId]:[]))}
function decideCorrespondenceMatch(id,approved){const m=one("SELECT * FROM correspondence_match_suggestions WHERE id=?",id);if(!m)throw new Error("Eşleşme bulunamadı");db.prepare("UPDATE correspondence_match_suggestions SET status=?,decided_at=datetime('now'),decided_by='lawyer' WHERE id=?").run(approved?"approved":"rejected",id);if(approved)db.prepare("UPDATE correspondence_requests SET status='answered',response_received_at=COALESCE(response_received_at,datetime('now')),updated_at=datetime('now') WHERE id=?").run(m.correspondence_id);db.prepare("UPDATE work_radar_items SET status='resolved',resolved_at=datetime('now') WHERE source_entity_type='correspondence_match' AND source_entity_id=?").run(String(id));audit("decide_correspondence_match","correspondence_match",id,{approved},"lawyer");return one("SELECT * FROM correspondence_match_suggestions WHERE id=?",id)}

function extractRecipient(text){
 const lines=String(text||"").split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
 const pats=[/^(?:muhatap|tebliğ olunacak|teblig olunacak)\s*[:\-]\s*(.{3,120})$/i,/^(?:adı soyadı|adi soyadi)\s*[:\-]\s*(.{3,120})$/i];
 for(const line of lines.slice(0,120))for(const p of pats){const m=line.match(p);if(m)return m[1].trim()}
 return null;
}
function scanNotifications({officeFileId=null,assetId=null}={}){
 let sql=`SELECT DISTINCT a.id asset_id,a.file_name,a.classification,da.raw_text,COALESCE(k.office_file_id,a.suggested_office_file_id) office_file_id,k.case_id
 FROM local_assets a LEFT JOIN document_analysis da ON da.asset_id=a.id LEFT JOIN knowledge_chunks k ON k.asset_id=a.id
 WHERE 1=1`,args=[];
 if(assetId){sql+=" AND a.id=?";args.push(assetId)}
 if(officeFileId){sql+=" AND k.office_file_id=?";args.push(officeFileId)}
 sql+=" ORDER BY a.id DESC LIMIT 700";
 const rows=all(sql,...args);let scanned=0,created=0,updated=0;
 for(const d of rows){
  if(!d.office_file_id)continue;
  const meta=norm((d.file_name||"")+" "+(d.classification||"")),head=norm(String(d.raw_text||"").slice(0,3000));
  const strongName=/mazbata|kapali.*teblig|e[ -]?teblig|tebligat evraki|teblig evraki|(^|\s)tebligat(\s|\.|$)/.test(meta);
  const strongHead=/teblig mazbatasi|tebligat mazbatasi|kapali e[ -]?teblig|tebligat barkod|teblig barkod/.test(head);
  const negative=/talep|itiraz|sikayet|dilekce|beyan|mazeret/.test(meta);
  if(!(strongHead||(strongName&&!negative)))continue;scanned++;
  if(one("SELECT id FROM document_extraction_log WHERE asset_id=? AND extractor='notification-v1'",d.asset_id))continue;
  const barcode=v06.extractBarcode(d.raw_text||""),recipient=extractRecipient(d.raw_text||""),serviceType=/e[ -]?teblig/.test(meta+" "+head)?"electronic":"physical";
  const existing=one("SELECT id FROM postal_shipments WHERE asset_id=?",d.asset_id);
  if(existing){db.prepare("UPDATE postal_shipments SET recipient=COALESCE(recipient,?),barcode=COALESCE(barcode,?),service_type=?,updated_at=datetime('now') WHERE id=?").run(recipient,barcode,serviceType,existing.id);updated++}
  else {db.prepare(`INSERT INTO postal_shipments(office_file_id,case_id,asset_id,recipient,barcode,service_type,source,status,metadata_json)
    VALUES(?,?,?,?,?,?, 'local_document', ?,?)`).run(d.office_file_id,d.case_id,d.asset_id,recipient,barcode,serviceType,barcode?"pending":"needs_review",JSON.stringify({fileName:d.file_name}));created++}
  const result={barcode,recipient,serviceType,fileName:d.file_name};
  db.prepare("INSERT OR REPLACE INTO document_extraction_log(asset_id,extractor,result_json,status) VALUES(?,'notification-v1',?,'done')").run(d.asset_id,JSON.stringify(result));
  const p=one("SELECT id FROM postal_shipments WHERE asset_id=?",d.asset_id);
  if(p)v06.upsertRadar({officeFileId:d.office_file_id,caseId:d.case_id,itemType:"tebligat",title:barcode?"Yerel tebligat belgesi — PTT kontrolü":"Tebligat belgesi — barkod kontrolü",detail:[d.file_name,recipient].filter(Boolean).join(" · "),severity:barcode?"info":"warning",sourceEntityType:"local_asset",sourceEntityId:d.asset_id,fingerprint:"local-tebligat:"+d.asset_id});
 }
 audit("scan_notification_documents","document_extraction",null,{officeFileId,assetId,scanned,created,updated});
 return {scanned,created,updated};
}
function upcomingHearings(limit=30){
 return all(`SELECT h.id,h.case_id,h.starts_at,h.location,h.hearing_type,h.notes,c.court,c.court_file_no,c.case_type,c.office_file_id,o.file_no,o.title office_file_title,cl.display_name client_name
 FROM hearings h JOIN cases c ON c.id=h.case_id LEFT JOIN office_files o ON o.id=c.office_file_id LEFT JOIN clients cl ON cl.id=o.primary_client_id
 WHERE h.starts_at IS NOT NULL AND datetime(h.starts_at)>=datetime('now','localtime','-1 day')
 ORDER BY h.starts_at LIMIT ?`,limit);
}
function hearingCockpit(hearingId){
 const h=one(`SELECT h.*,c.court,c.court_file_no,c.case_type,c.office_file_id,o.file_no,o.title office_file_title,cl.display_name client_name
 FROM hearings h JOIN cases c ON c.id=h.case_id LEFT JOIN office_files o ON o.id=c.office_file_id LEFT JOIN clients cl ON cl.id=o.primary_client_id WHERE h.id=?`,hearingId);
 if(!h)return null;const of=h.office_file_id;
 const deadlines=all(`SELECT d.* FROM deadlines d JOIN cases c ON c.id=d.case_id WHERE c.office_file_id=? AND d.status='open' ORDER BY d.due_at LIMIT 30`,of);
 const tasks=all("SELECT * FROM tasks WHERE office_file_id=? AND status='open' ORDER BY due_at LIMIT 30",of);
 const radar=v06.radar({officeFileId:of,status:"open"});
 const actions=actionItems({officeFileId:of,status:"open"});
 const correspondence=all("SELECT * FROM correspondence_requests WHERE office_file_id=? ORDER BY id DESC LIMIT 30",of);
 const matches=correspondenceMatches(of);
 const docs=all(`SELECT DISTINCT a.id,a.file_name,a.classification,da.document_kind,da.analyzed_at FROM knowledge_chunks k JOIN local_assets a ON a.id=k.asset_id LEFT JOIN document_analysis da ON da.asset_id=a.id WHERE k.office_file_id=? ORDER BY COALESCE(da.analyzed_at,a.last_seen_at) DESC LIMIT 25`,of);
 const rep=of?require("./v05").representationRadar(of):[];
 return {hearing:h,deadlines,tasks,radar,actions,correspondence,matches,documents:docs,representation:rep};
}
function morningBrief(){
 const b=repo.brief(),radar=v06.radar({status:"open"}),hearings=upcomingHearings(10).filter(x=>String(x.starts_at||"").slice(0,10)===b.date);
 const critical=radar.filter(x=>x.severity==="critical").length,action=radar.filter(x=>x.severity==="action").length;
 const openCorr=one("SELECT COUNT(*) n FROM correspondence_requests WHERE status NOT IN ('answered','closed')").n;
 const parts=[];if(hearings.length)parts.push(hearings.length+" duruşma");if(b.urgentDeadlines)parts.push(b.urgentDeadlines+" yaklaşan süre");if(critical+action)parts.push((critical+action)+" öncelikli iş");if(openCorr)parts.push(openCorr+" açık müzekkere");
 return {date:b.date,title:"BONO OS Sabah Özeti",body:parts.length?parts.join(" · "):"Bugün için öncelikli kayıt görünmüyor.",counts:{hearings:hearings.length,urgentDeadlines:b.urgentDeadlines,critical,action,openCorrespondence:openCorr},items:[...b.items.slice(0,8),...radar.slice(0,6)]};
}
function checkpointRoot(){const p=path.join(__dirname,"..","data","backups");fs.mkdirSync(p,{recursive:true});return p}
function copySourceTree(src,dst){
 const skip=new Set(["node_modules",".git","data","bin","obj"]);
 if(!fs.existsSync(src))return;fs.mkdirSync(dst,{recursive:true});
 for(const ent of fs.readdirSync(src,{withFileTypes:true})){if(skip.has(ent.name))continue;const a=path.join(src,ent.name),b=path.join(dst,ent.name);if(ent.isDirectory())copySourceTree(a,b);else if(ent.isFile())fs.copyFileSync(a,b)}
}
function createCheckpoint(label="Manuel geri dönüş noktası"){
 const root=checkpointRoot(),project=path.join(__dirname,".."),stamp=new Date().toISOString().replace(/[-:]/g,"").replace(/\..+/,"").replace("T","_");
 try{db.exec("PRAGMA wal_checkpoint(FULL)")}catch{}
 const dbSrc=path.join(project,"data","bono.db"),dbDest=path.join(root,"checkpoint_"+stamp+".db");fs.copyFileSync(dbSrc,dbDest);
 const sourceDest=path.join(root,"source_checkpoint_"+stamp);fs.mkdirSync(sourceDest,{recursive:true});
 for(const dir of ["bridge","web","extension","scripts","desktop"])copySourceTree(path.join(project,dir),path.join(sourceDest,dir));
 for(const file of ["package.json","README.md","SECURITY.md"]){const src=path.join(project,file);if(fs.existsSync(src))fs.copyFileSync(src,path.join(sourceDest,file))}
 const r=db.prepare("INSERT INTO system_checkpoints(kind,label,db_path,source_path,metadata_json) VALUES('full',?,?,?,?)").run(label,dbDest,sourceDest,JSON.stringify({schema:one("SELECT value FROM schema_meta WHERE key='version'")?.value||null}));
 audit("create_system_checkpoint","system_checkpoint",Number(r.lastInsertRowid),{label,dbDest,sourceDest},"lawyer");
 return one("SELECT * FROM system_checkpoints WHERE id=?",Number(r.lastInsertRowid));
}
function requestRestore(id,confirmation){
 if(String(confirmation||"")!=="GERI_YUKLE")throw new Error("Geri yükleme için GERI_YUKLE onayı gerekli");
 const c=one("SELECT * FROM system_checkpoints WHERE id=? AND status='ready'",id);if(!c)throw new Error("Checkpoint bulunamadı");
 if(!c.db_path||!fs.existsSync(c.db_path))throw new Error("Checkpoint DB dosyası bulunamadı");
 const safety=createCheckpoint("Geri yükleme öncesi otomatik güvenlik noktası");
 const marker=path.join(__dirname,"..","data","pending_restore.json");
 fs.writeFileSync(marker,JSON.stringify({checkpointId:id,dbPath:c.db_path,sourcePath:c.source_path||null,safetyCheckpointId:safety.id,requestedAt:new Date().toISOString()},null,2));
 audit("request_system_restore","system_checkpoint",id,{safetyCheckpointId:safety.id,restartRequired:true},"lawyer");
 return {ok:true,restartRequired:true,checkpointId:id,safetyCheckpointId:safety.id};
}
function checkpoints(){return all("SELECT * FROM system_checkpoints ORDER BY id DESC LIMIT 100")}
function backupHealth(){
 const root=checkpointRoot();const files=fs.readdirSync(root).filter(f=>f.endsWith(".db")).map(f=>{const p=path.join(root,f),s=fs.statSync(p);return {name:f,path:p,size:s.size,modified_at:s.mtime.toISOString()}}).sort((a,b)=>b.modified_at.localeCompare(a.modified_at));
 return {count:files.length,latest:files[0]||null,checkpoints:checkpoints().slice(0,10),pendingRestore:fs.existsSync(path.join(__dirname,"..","data","pending_restore.json"))};
}

init();module.exports={init,scanInterimOrders,actionItems,resolveAction,scanCorrespondenceMatches,correspondenceMatches,decideCorrespondenceMatch,scanNotifications,upcomingHearings,hearingCockpit,morningBrief,createCheckpoint,requestRestore,checkpoints,backupHealth};
