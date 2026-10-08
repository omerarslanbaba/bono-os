const db=require("./db");

function one(sql,...args){return db.prepare(sql).get(...args)}
function all(sql,...args){return db.prepare(sql).all(...args)}
function nrm(s){
  return String(s||"").replace(/İ/g,"I").replace(/ı/g,"i").normalize("NFD")
    .replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
}
function audit(action,type,id,detail,actor="lawyer"){
  db.prepare("INSERT INTO audit_log(occurred_at,actor,action,entity_type,entity_id,detail_json) VALUES(datetime('now'),?,?,?,?,?)")
    .run(actor,action,type,id==null?null:String(id),JSON.stringify(detail||{}));
}
function putSearch(type,id,title,subtitle,body){
  const normalized=nrm([title,subtitle,body].filter(Boolean).join(" "));
  db.prepare(`INSERT INTO search_index(entity_type,entity_id,title,subtitle,body,normalized_text,updated_at)
    VALUES(?,?,?,?,?,?,datetime('now'))
    ON CONFLICT(entity_type,entity_id) DO UPDATE SET title=excluded.title,subtitle=excluded.subtitle,
      body=excluded.body,normalized_text=excluded.normalized_text,updated_at=datetime('now')`)
    .run(type,String(id),title||"",subtitle||"",body||"",normalized);
}

function intelligenceStatus(){
  return {
    udfAssets:one("SELECT COUNT(*) n FROM local_assets WHERE lower(extension)='.udf'").n,
    analyzed:one("SELECT COUNT(*) n FROM document_analysis WHERE analysis_status='completed'").n,
    failed:one("SELECT COUNT(*) n FROM document_analysis WHERE analysis_status='failed'").n,
    chunks:one("SELECT COUNT(*) n FROM knowledge_chunks").n,
    templates:one("SELECT COUNT(*) n FROM petition_templates WHERE active=1").n,
    officeStyleCandidates:one("SELECT COUNT(*) n FROM petition_templates WHERE active=1 AND is_office_style=1").n,
    drafts:one("SELECT COUNT(*) n FROM drafts").n,
    hearingPacks:one("SELECT COUNT(*) n FROM hearing_packs").n
  };
}
function templates(limit=150){
  return all(`SELECT t.id,t.name,t.petition_type,t.is_office_style,t.active,t.created_at,
    a.file_name,da.template_score,da.analysis_status
    FROM petition_templates t
    LEFT JOIN local_assets a ON a.id=t.source_asset_id
    LEFT JOIN document_analysis da ON da.asset_id=t.source_asset_id
    WHERE t.active=1
    ORDER BY t.is_office_style DESC,da.template_score DESC,t.id DESC LIMIT ?`,limit);
}
function templateDetail(id){
  const t=one(`SELECT t.*,a.file_name,da.raw_text,da.extracted_json,da.sections_json,da.template_score
    FROM petition_templates t
    LEFT JOIN local_assets a ON a.id=t.source_asset_id
    LEFT JOIN document_analysis da ON da.asset_id=t.source_asset_id
    WHERE t.id=?`,id);
  if(!t)return null;
  try{t.styleProfile=JSON.parse(t.style_profile_json||"{}")}catch{t.styleProfile={}}
  try{t.structure=JSON.parse(t.structure_json||"{}")}catch{t.structure={}}
  delete t.raw_text;
  return t;
}
function setTemplateOfficeStyle(id,flag){
  const r=db.prepare("UPDATE petition_templates SET is_office_style=?,updated_at=datetime('now') WHERE id=?").run(flag?1:0,id);
  if(!r.changes) throw new Error("Şablon bulunamadı");
  audit("set_office_style","petition_template",id,{isOfficeStyle:!!flag});
  return templateDetail(id);
}
function knowledgeSearch(q,{officeFileId=null,caseId=null,assetId=null,limit=20}={}){
  const tokens=nrm(q).split(" ").filter(x=>x.length>1).slice(0,8);
  if(!tokens.length)return [];
  let where=["1=1"],args=[];
  if(officeFileId){where.push("k.office_file_id=?");args.push(Number(officeFileId))}
  if(caseId){where.push("k.case_id=?");args.push(Number(caseId))}
  if(assetId){where.push("k.asset_id=?");args.push(Number(assetId))}
  where.push("("+tokens.map(()=> "k.normalized_text LIKE ?").join(" OR ")+")");
  for(const t of tokens)args.push("%"+t+"%");
  const rows=all(`SELECT k.id,k.asset_id,k.office_file_id,k.case_id,k.chunk_no,k.heading,k.text,
    a.file_name,da.document_kind
    FROM knowledge_chunks k
    JOIN local_assets a ON a.id=k.asset_id
    LEFT JOIN document_analysis da ON da.asset_id=k.asset_id
    WHERE ${where.join(" AND ")} LIMIT 250`,...args);
  for(const r of rows){
    const text=nrm(r.text); let score=0;
    for(const t of tokens){if(text.includes(t))score+=1;if(text.startsWith(t))score+=0.5}
    r.score=score; r.preview=r.text.slice(0,900); delete r.text;
  }
  return rows.sort((a,b)=>b.score-a.score).slice(0,limit);
}
function documentAnalysis(assetId){
  const r=one(`SELECT da.*,a.file_name FROM document_analysis da JOIN local_assets a ON a.id=da.asset_id WHERE da.asset_id=?`,assetId);
  if(!r)return null;
  for(const k of ["extracted_json","sections_json","style_profile_json"]){
    try{r[k.replace("_json","")]=JSON.parse(r[k]||"{}")}catch{r[k.replace("_json","")]={}}
    delete r[k];
  }
  if(r.raw_text)r.textPreview=r.raw_text.slice(0,5000);
  delete r.raw_text;
  return r;
}

function drafts(limit=200){
  return all(`SELECT d.id,d.title,d.draft_type,d.status,d.version,d.udf_path,d.created_at,d.updated_at,
    o.file_no office_file_no,c.display_name client_name,t.name template_name
    FROM drafts d
    LEFT JOIN office_files o ON o.id=d.office_file_id
    LEFT JOIN clients c ON c.id=d.client_id
    LEFT JOIN petition_templates t ON t.id=d.template_id
    ORDER BY d.updated_at DESC LIMIT ?`,limit);
}
function draftDetail(id){
  const d=one(`SELECT d.*,o.file_no office_file_no,c.display_name client_name,t.name template_name,t.style_profile_json
    FROM drafts d
    LEFT JOIN office_files o ON o.id=d.office_file_id
    LEFT JOIN clients c ON c.id=d.client_id
    LEFT JOIN petition_templates t ON t.id=d.template_id WHERE d.id=?`,id);
  if(!d)return null;
  try{d.styleProfile=JSON.parse(d.style_profile_json||"{}")}catch{d.styleProfile={}}
  delete d.style_profile_json;
  try{d.sourceRefs=JSON.parse(d.source_refs_json||"[]")}catch{d.sourceRefs=[]}
  delete d.source_refs_json;
  return d;
}
function createDraft(b){
  if(!String(b.title||"").trim())throw new Error("Taslak başlığı gerekli");
  if(!String(b.draftType||"").trim())throw new Error("Taslak türü gerekli");
  const r=db.prepare(`INSERT INTO drafts(office_file_id,case_id,client_id,draft_type,title,content_md,content_text,status,template_id,source_refs_json,created_by)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(
      b.officeFileId||null,b.caseId||null,b.clientId||null,String(b.draftType),String(b.title).trim(),
      b.contentMd||"",b.contentText||"",b.status||"draft",b.templateId||null,JSON.stringify(b.sourceRefs||[]),b.createdBy||"lawyer");
  const id=Number(r.lastInsertRowid);
  audit("create_draft","draft",id,{title:b.title,draftType:b.draftType});
  putSearch("draft",id,String(b.title).trim(),"Taslak · "+String(b.draftType),[b.contentText,b.contentMd,b.status||"draft"].filter(Boolean).join(" "));
  return draftDetail(id);
}
function updateDraft(id,b){
  const d=one("SELECT * FROM drafts WHERE id=?",id);if(!d)throw new Error("Taslak bulunamadı");
  db.prepare(`UPDATE drafts SET title=?,content_md=?,content_text=?,status=?,template_id=?,source_refs_json=?,updated_at=datetime('now') WHERE id=?`)
    .run(b.title??d.title,b.contentMd??d.content_md,b.contentText??d.content_text,b.status??d.status,
      b.templateId===undefined?d.template_id:b.templateId,JSON.stringify(b.sourceRefs??JSON.parse(d.source_refs_json||"[]")),id);
  audit("update_draft","draft",id,{status:b.status??d.status});
  const now=one("SELECT * FROM drafts WHERE id=?",id);
  putSearch("draft",id,now.title,"Taslak · "+now.draft_type,[now.content_text,now.content_md,now.status].filter(Boolean).join(" "));
  return draftDetail(id);
}
function setDraftUdf(id,path){
  db.prepare("UPDATE drafts SET udf_path=?,updated_at=datetime('now') WHERE id=?").run(path,id);
  audit("export_udf","draft",id,{path});
  return draftDetail(id);
}

function notes(filters={}){
  const where=["1=1"],args=[];
  for(const [key,col] of [["clientId","client_id"],["officeFileId","office_file_id"],["caseId","case_id"],["assetId","asset_id"]]){
    if(filters[key]){where.push(col+"=?");args.push(Number(filters[key]))}
  }
  return all(`SELECT * FROM notes WHERE ${where.join(" AND ")} ORDER BY pinned DESC,updated_at DESC LIMIT 300`,...args);
}
function createNote(b){
  if(!String(b.body||"").trim())throw new Error("Not metni gerekli");
  const r=db.prepare(`INSERT INTO notes(client_id,office_file_id,case_id,asset_id,hearing_id,title,body,pinned)
    VALUES(?,?,?,?,?,?,?,?)`).run(b.clientId||null,b.officeFileId||null,b.caseId||null,b.assetId||null,b.hearingId||null,b.title||null,String(b.body).trim(),b.pinned?1:0);
  const id=Number(r.lastInsertRowid);
  audit("create_note","note",id,{title:b.title||null});
  putSearch("note",id,b.title||"Not","Not",String(b.body).trim());
  return one("SELECT * FROM notes WHERE id=?",id);
}

function clientFinance(clientId){
  const contracts=all(`SELECT fc.*,COUNT(DISTINCT l.office_file_id) file_count
    FROM fee_contracts fc LEFT JOIN fee_contract_file_links l ON l.contract_id=fc.id
    WHERE fc.client_id=? GROUP BY fc.id ORDER BY fc.signed_at DESC,fc.id DESC`,clientId);
  const entries=all(`SELECT fe.*,o.file_no office_file_no,fc.title contract_title
    FROM financial_entries fe LEFT JOIN office_files o ON o.id=fe.office_file_id
    LEFT JOIN fee_contracts fc ON fc.id=fe.contract_id WHERE fe.client_id=?
    ORDER BY COALESCE(fe.paid_at,fe.due_at,fe.created_at) DESC`,clientId);
  const totals={contracted:0,paid:0,open:0,expenses:0,counterFees:0};
  for(const c of contracts)totals.contracted+=Number(c.total_fee||0);
  for(const e of entries){
    const a=Number(e.amount||0);
    if(e.entry_type==="payment"||e.entry_type==="tahsilat")totals.paid+=a;
    if(e.entry_type==="expense"||e.entry_type==="masraf")totals.expenses+=a;
    if(e.entry_type==="counter_fee"||e.entry_type==="karsi_vekalet")totals.counterFees+=a;
  }
  totals.open=Math.max(0,totals.contracted-totals.paid);
  return {contracts,entries,totals};
}
function createFeeContract(b){
  if(!b.clientId||!String(b.title||"").trim())throw new Error("Müvekkil ve sözleşme başlığı gerekli");
  const r=db.prepare(`INSERT INTO fee_contracts(client_id,title,signed_at,total_fee,currency,vat_included,payment_terms,status,document_asset_id,notes)
    VALUES(?,?,?,?,?,?,?,?,?,?)`).run(b.clientId,String(b.title).trim(),b.signedAt||null,b.totalFee==null?null:Number(b.totalFee),
      b.currency||"TRY",b.vatIncluded?1:0,b.paymentTerms||null,b.status||"active",b.documentAssetId||null,b.notes||null);
  const id=Number(r.lastInsertRowid);
  for(const fid of (b.officeFileIds||[]))db.prepare("INSERT OR IGNORE INTO fee_contract_file_links(contract_id,office_file_id) VALUES(?,?)").run(id,Number(fid));
  audit("create_fee_contract","fee_contract",id,{clientId:b.clientId,totalFee:b.totalFee||null});
  const client=one("SELECT display_name FROM clients WHERE id=?",b.clientId);
  putSearch("fee_contract",id,String(b.title).trim(),"Avukatlık Sözleşmesi · "+(client?.display_name||""),[b.paymentTerms,b.notes,b.totalFee,b.currency||"TRY"].filter(Boolean).join(" "));
  return one("SELECT * FROM fee_contracts WHERE id=?",id);
}
function financeOverview(){
  const contracts=one("SELECT COUNT(*) n,COALESCE(SUM(total_fee),0) total FROM fee_contracts WHERE status='active'");
  const paid=one("SELECT COALESCE(SUM(amount),0) total FROM financial_entries WHERE entry_type IN ('payment','tahsilat') AND status IN ('paid','completed','open')");
  const expenses=one("SELECT COALESCE(SUM(amount),0) total FROM financial_entries WHERE entry_type IN ('expense','masraf')");
  const counter=one("SELECT COALESCE(SUM(amount),0) total FROM financial_entries WHERE entry_type IN ('counter_fee','karsi_vekalet')");
  const clients=all(`SELECT c.id,c.display_name,
    COALESCE((SELECT SUM(fc.total_fee) FROM fee_contracts fc WHERE fc.client_id=c.id AND fc.status='active'),0) contracted,
    COALESCE((SELECT SUM(fe.amount) FROM financial_entries fe WHERE fe.client_id=c.id AND fe.entry_type IN ('payment','tahsilat')),0) paid
    FROM clients c
    WHERE EXISTS(SELECT 1 FROM fee_contracts fc WHERE fc.client_id=c.id)
       OR EXISTS(SELECT 1 FROM financial_entries fe WHERE fe.client_id=c.id)
    ORDER BY contracted DESC,c.display_name LIMIT 200`);
  return {contracts:contracts.n,contracted:Number(contracts.total||0),paid:Number(paid.total||0),
    outstanding:Math.max(0,Number(contracts.total||0)-Number(paid.total||0)),expenses:Number(expenses.total||0),
    counterFees:Number(counter.total||0),clients};
}
function createFinancialEntry(b){
  if(!String(b.entryType||"").trim()||!Number.isFinite(Number(b.amount)))throw new Error("Finans türü ve tutar gerekli");
  const r=db.prepare(`INSERT INTO financial_entries(client_id,office_file_id,contract_id,entry_type,amount,currency,description,due_at,paid_at,status,source)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(b.clientId||null,b.officeFileId||null,b.contractId||null,b.entryType,Number(b.amount),b.currency||"TRY",
      b.description||null,b.dueAt||null,b.paidAt||null,b.status||"open",b.source||"manual");
  const id=Number(r.lastInsertRowid);audit("create_financial_entry","financial_entry",id,{entryType:b.entryType,amount:b.amount});return one("SELECT * FROM financial_entries WHERE id=?",id);
}
function communications(filters={}){
  const where=["1=1"],args=[];
  if(filters.clientId){where.push("client_id=?");args.push(Number(filters.clientId))}
  if(filters.officeFileId){where.push("office_file_id=?");args.push(Number(filters.officeFileId))}
  return all(`SELECT * FROM communications WHERE ${where.join(" AND ")} ORDER BY occurred_at DESC LIMIT 300`,...args);
}
function createCommunication(b){
  if(!String(b.channel||"").trim())throw new Error("İletişim kanalı gerekli");
  const r=db.prepare(`INSERT INTO communications(client_id,office_file_id,channel,direction,occurred_at,subject,body,external_ref,metadata_json)
    VALUES(?,?,?,?,?,?,?,?,?)`).run(b.clientId||null,b.officeFileId||null,b.channel,b.direction||null,b.occurredAt||new Date().toISOString(),
      b.subject||null,b.body||null,b.externalRef||null,JSON.stringify(b.metadata||{}));
  const id=Number(r.lastInsertRowid);
  audit("create_communication","communication",id,{channel:b.channel});
  putSearch("communication",id,b.subject||b.channel,"İletişim · "+b.channel,[b.body,b.direction,b.occurredAt].filter(Boolean).join(" "));
  return one("SELECT * FROM communications WHERE id=?",id);
}
function communicationStatus(){
  const get=k=>one("SELECT value FROM app_settings WHERE key=?",k)?.value||null;
  return {whatsapp:{mode:"official_cloud_api",status:get("whatsapp_status")||"not_connected",relay:get("whatsapp_relay_url")?"configured":"not_configured"}};
}

function relations(clientId){
  return all(`SELECT r.*,c.display_name related_client_name,o.file_no office_file_no
    FROM client_relations r LEFT JOIN clients c ON c.id=r.related_client_id
    LEFT JOIN office_files o ON o.id=r.office_file_id WHERE r.client_id=? ORDER BY r.id DESC`,clientId);
}
function createRelation(b){
  if(!b.clientId||!String(b.relationType||"").trim())throw new Error("İlişki türü gerekli");
  const r=db.prepare(`INSERT INTO client_relations(client_id,related_client_id,related_name,relation_type,office_file_id,notes)
    VALUES(?,?,?,?,?,?)`).run(b.clientId,b.relatedClientId||null,b.relatedName||null,b.relationType,b.officeFileId||null,b.notes||null);
  return one("SELECT * FROM client_relations WHERE id=?",Number(r.lastInsertRowid));
}
function refreshMergeCandidates(){
  const clients=all("SELECT id,display_name,national_id FROM clients ORDER BY id");
  let added=0;
  for(let i=0;i<clients.length;i++)for(let j=i+1;j<clients.length;j++){
    const a=clients[i],b=clients[j],na=nrm(a.display_name),nb=nrm(b.display_name);
    let score=0,reasons=[];
    if(a.national_id&&b.national_id&&a.national_id===b.national_id){score=1;reasons.push("same_national_id")}
    else{
      const ta=new Set(na.split(" ")),tb=new Set(nb.split(" "));
      const inter=[...ta].filter(x=>tb.has(x)).length,union=new Set([...ta,...tb]).size||1;
      score=inter/union;
      if(na===nb){score=1;reasons.push("same_name")} else if(score>=0.65)reasons.push("similar_name");
    }
    if(score>=0.65){
      db.prepare(`INSERT OR IGNORE INTO merge_candidates(entity_type,left_id,right_id,score,reasons_json) VALUES('client',?,?,?,?)`)
        .run(a.id,b.id,score,JSON.stringify(reasons));added++;
    }
  }
  return {added,pending:one("SELECT COUNT(*) n FROM merge_candidates WHERE entity_type='client' AND status='pending'").n};
}
function mergeCandidates(){
  return all(`SELECT m.*,a.display_name left_name,b.display_name right_name
    FROM merge_candidates m JOIN clients a ON a.id=m.left_id JOIN clients b ON b.id=m.right_id
    WHERE m.entity_type='client' AND m.status='pending' ORDER BY m.score DESC,m.id DESC`);
}

function aiPermissions(){return all("SELECT * FROM ai_permissions ORDER BY capability")}
function setAiPermission(capability,b){
  if(!one("SELECT capability FROM ai_permissions WHERE capability=?",capability))throw new Error("Yetki bulunamadı");
  const allowed=new Set(["allow","suggest","deny"]);if(!allowed.has(b.level))throw new Error("Geçersiz seviye");
  db.prepare("UPDATE ai_permissions SET level=?,requires_approval=?,updated_at=datetime('now') WHERE capability=?")
    .run(b.level,b.requiresApproval?1:0,capability);
  audit("set_ai_permission","ai_permission",capability,b);
  return one("SELECT * FROM ai_permissions WHERE capability=?",capability);
}

function generateHearingPack(officeFileId){
  const file=one(`SELECT o.*,c.display_name client_name FROM office_files o LEFT JOIN clients c ON c.id=o.primary_client_id WHERE o.id=?`,officeFileId);
  if(!file)throw new Error("Föy bulunamadı");
  const cases=all("SELECT court,court_file_no,case_type,status,last_activity_at FROM cases WHERE office_file_id=?",officeFileId);
  const notes_=notes({officeFileId});
  const tasks=all("SELECT title,due_at,priority,status FROM tasks WHERE office_file_id=? AND status='open' ORDER BY due_at",officeFileId);
  const deadlines=all(`SELECT d.title,d.due_at,d.legal_basis,d.lawyer_approved FROM deadlines d JOIN cases c ON c.id=d.case_id
    WHERE c.office_file_id=? AND d.status='open' ORDER BY d.due_at`,officeFileId);
  const docs=all(`SELECT DISTINCT a.id,a.file_name,da.document_kind,da.analyzed_at FROM knowledge_chunks k
    JOIN local_assets a ON a.id=k.asset_id LEFT JOIN document_analysis da ON da.asset_id=a.id
    WHERE k.office_file_id=? ORDER BY da.analyzed_at DESC LIMIT 15`,officeFileId);
  const lines=[`# ${file.file_no||"Föy"} · ${file.title}`,file.client_name?`Müvekkil: ${file.client_name}`:"","",
    "## Bağlı Dosyalar",...cases.map(c=>`- ${c.court||""} ${c.court_file_no||""} · ${c.case_type||""} · ${c.status||""}`),
    "","## Açık Süreler",...(deadlines.length?deadlines.map(d=>`- ${d.due_at||"?"} · ${d.title} · ${d.lawyer_approved?"Onaylı":"Taslak"}`):["- Yok"]),
    "","## Açık Görevler",...(tasks.length?tasks.map(t=>`- ${t.due_at||"?"} · ${t.title} · ${t.priority}`):["- Yok"]),
    "","## Son Notlar",...(notes_.length?notes_.slice(0,8).map(n=>`- ${n.title?n.title+": ":""}${n.body.slice(0,300)}`):["- Yok"]),
    "","## İndeksli Dosya Evrakları",...(docs.length?docs.map(d=>`- ${d.file_name} · ${d.document_kind||"belge"}`):["- Henüz föye eşleşmiş UDF yok"])
  ].filter(x=>x!==null);
  const summary=lines.join("\n");
  const checklist={items:[
    {key:"deadlines",label:"Açık hukuki süreleri kontrol et",done:deadlines.length===0},
    {key:"tasks",label:"Açık görevleri kontrol et",done:tasks.length===0},
    {key:"notes",label:"Son notları gözden geçir",done:false},
    {key:"documents",label:"Son gelen evrakları kontrol et",done:docs.length>0}
  ]};
  const r=db.prepare(`INSERT INTO hearing_packs(office_file_id,title,summary_md,checklist_json,source_refs_json)
    VALUES(?,?,?,?,?)`).run(officeFileId,`${file.file_no||"Föy"} Duruşma Hazırlık Paketi`,summary,JSON.stringify(checklist),JSON.stringify({documents:docs.map(x=>x.id)}));
  const id=Number(r.lastInsertRowid);audit("generate_hearing_pack","hearing_pack",id,{officeFileId});return hearingPack(id);
}
function hearingPack(id){const p=one("SELECT * FROM hearing_packs WHERE id=?",id);if(!p)return null;try{p.checklist=JSON.parse(p.checklist_json||"{}")}catch{p.checklist={}}delete p.checklist_json;return p}
function hearingPacks(officeFileId){return all("SELECT id,title,status,generated_at,updated_at FROM hearing_packs WHERE office_file_id=? ORDER BY id DESC",officeFileId)}

function serviceHealth(){return all("SELECT * FROM service_health ORDER BY service")}
function setHeartbeat(service,state="ok",detail={}){
  db.prepare(`INSERT INTO service_health(service,state,last_heartbeat_at,detail_json) VALUES(?,?,datetime('now'),?)
    ON CONFLICT(service) DO UPDATE SET state=excluded.state,last_heartbeat_at=datetime('now'),detail_json=excluded.detail_json`)
    .run(service,state,JSON.stringify(detail));
}
module.exports={intelligenceStatus,templates,templateDetail,setTemplateOfficeStyle,knowledgeSearch,documentAnalysis,
  drafts,draftDetail,createDraft,updateDraft,setDraftUdf,notes,createNote,clientFinance,financeOverview,createFeeContract,createFinancialEntry,
  communications,createCommunication,communicationStatus,relations,createRelation,refreshMergeCandidates,mergeCandidates,
  aiPermissions,setAiPermission,generateHearingPack,hearingPack,hearingPacks,serviceHealth,setHeartbeat,audit};
