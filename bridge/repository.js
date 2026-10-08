const db=require("./db");

function one(sql,...args){return db.prepare(sql).get(...args)}
function all(sql,...args){return db.prepare(sql).all(...args)}
function nrm(s){
  return String(s||"").replace(/İ/g,"I").replace(/ı/g,"i").normalize("NFD")
    .replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
}
function summary(){
  const count=t=>one("SELECT COUNT(*) n FROM "+t).n;
  return {
    officeFiles:count("office_files"),
    clients:count("clients"),
    powers:count("powers_of_attorney"),
    cases:count("cases"),
    documents:count("documents"),
    localAssets:count("local_assets"),
    hearings:count("hearings"),
    notifications:count("notifications"),
    deadlines:count("deadlines"),
    tasks:count("tasks"),
    unapprovedDeadlines:one("SELECT COUNT(*) n FROM deadlines WHERE lawyer_approved=0").n,
    queuedJobs:one("SELECT COUNT(*) n FROM job_queue WHERE status IN ('queued','running')").n,
    failedJobs:one("SELECT COUNT(*) n FROM job_queue WHERE status='failed'").n,
    openCorrespondence:one("SELECT COUNT(*) n FROM correspondence_requests WHERE status IN ('draft','sent')").n,
    unansweredCorrespondence:one("SELECT COUNT(*) n FROM correspondence_requests WHERE status='sent' AND response_received_at IS NULL").n,
    representationWarnings:one(`SELECT COUNT(*) n FROM office_files o
      LEFT JOIN cases ca ON ca.office_file_id=o.id
      WHERE o.primary_client_id IS NOT NULL AND (
        NOT EXISTS(SELECT 1 FROM powers_of_attorney p WHERE p.client_id=o.primary_client_id AND p.status='active')
        OR (ca.id IS NOT NULL AND NOT EXISTS(
          SELECT 1 FROM power_case_links pcl JOIN powers_of_attorney p ON p.id=pcl.power_id
          WHERE pcl.case_id=ca.id AND p.client_id=o.primary_client_id
        ))
      )`).n
  };
}
function brief(){
  const today=one("SELECT date('now','localtime') d").d;
  const next7=one("SELECT date('now','localtime','+7 day') d").d;
  const data={
    date:today,
    todayHearings:one("SELECT COUNT(*) n FROM hearings WHERE date(starts_at)=?",today).n,
    urgentDeadlines:one("SELECT COUNT(*) n FROM deadlines WHERE status='open' AND due_at IS NOT NULL AND date(due_at) BETWEEN ? AND ?",today,next7).n,
    todayTasks:one("SELECT COUNT(*) n FROM tasks WHERE status='open' AND due_at IS NOT NULL AND date(due_at)<=?",today).n,
    newAssets:one("SELECT COUNT(*) n FROM local_assets WHERE date(first_seen_at)=?",today).n,
    newNotifications:one("SELECT COUNT(*) n FROM notifications WHERE lower(COALESCE(status,'')) IN ('new','yeni','unread')").n,
    unapprovedDeadlines:one("SELECT COUNT(*) n FROM deadlines WHERE lawyer_approved=0 AND status='open'").n,
    failedJobs:one("SELECT COUNT(*) n FROM job_queue WHERE status='failed'").n
  };
  data.items=[];
  for(const r of all("SELECT h.id,h.starts_at,h.hearing_type,c.court,c.court_file_no,c.client_name FROM hearings h JOIN cases c ON c.id=h.case_id WHERE date(h.starts_at)=? ORDER BY h.starts_at LIMIT 8",today))
    data.items.push({kind:"hearing",when:r.starts_at,title:r.court||"Duruşma",subtitle:[r.court_file_no,r.client_name].filter(Boolean).join(" · ")});
  for(const r of all("SELECT id,title,due_at,confidence,lawyer_approved FROM deadlines WHERE status='open' AND due_at IS NOT NULL AND date(due_at) BETWEEN ? AND ? ORDER BY due_at LIMIT 8",today,next7))
    data.items.push({kind:"deadline",when:r.due_at,title:r.title,subtitle:r.lawyer_approved?"Onaylı":"Taslak · Avukat onayı gerekli"});
  for(const r of all("SELECT id,title,due_at,priority FROM tasks WHERE status='open' AND due_at IS NOT NULL AND date(due_at)<=? ORDER BY due_at LIMIT 8",today))
    data.items.push({kind:"task",when:r.due_at,title:r.title,subtitle:"Görev · "+(r.priority||"normal")});
  data.items.sort((a,b)=>String(a.when||"").localeCompare(String(b.when||"")));
  return data;
}
function search(q,limit=25){
  const s=nrm(q); if(!s)return [];
  const like="%"+s+"%";
  return all("SELECT entity_type,entity_id,title,subtitle,body FROM search_index WHERE normalized_text LIKE ? ORDER BY CASE WHEN normalized_text LIKE ? THEN 0 ELSE 1 END,title LIMIT ?",like,s+"%",limit);
}
function clients(limit=200){
  return all(`SELECT c.id,c.display_name,c.client_type,c.phone,c.email,
    COUNT(DISTINCT p.id) power_count,COUNT(DISTINCT pa.case_id) case_count
    FROM clients c
    LEFT JOIN powers_of_attorney p ON p.client_id=c.id
    LEFT JOIN parties pa ON pa.client_id=c.id
    GROUP BY c.id ORDER BY c.display_name LIMIT ?`,limit);
}
function clientDetail(id){
  const c=one("SELECT id,display_name,client_type,phone,email,notes,created_at,updated_at FROM clients WHERE id=?",id);
  if(!c)return null;
  c.powers=all(`SELECT p.id,p.notary,p.journal_no,p.issued_at,p.status,p.notes,
    COUNT(DISTINCT ps.id) source_count,COUNT(DISTINCT pcl.case_id) case_count
    FROM powers_of_attorney p
    LEFT JOIN power_sources ps ON ps.power_id=p.id
    LEFT JOIN power_case_links pcl ON pcl.power_id=p.id
    WHERE p.client_id=? GROUP BY p.id ORDER BY p.issued_at DESC`,id);
  c.cases=all(`SELECT DISTINCT ca.id,ca.court,ca.court_file_no,ca.case_type,ca.status,ofl.file_no office_file_no
    FROM parties pa JOIN cases ca ON ca.id=pa.case_id
    LEFT JOIN office_files ofl ON ofl.id=ca.office_file_id
    WHERE pa.client_id=? ORDER BY ca.last_activity_at DESC`,id);
  c.assets=all("SELECT id,file_name,classification,last_seen_at FROM local_assets WHERE suggested_client_id=? ORDER BY last_seen_at DESC LIMIT 50",id);
  return c;
}
function powers(limit=200){
  return all(`SELECT p.id,c.display_name client_name,p.notary,p.journal_no,p.issued_at,p.status,
    COUNT(DISTINCT ps.id) source_count,COUNT(DISTINCT pcl.case_id) case_count
    FROM powers_of_attorney p JOIN clients c ON c.id=p.client_id
    LEFT JOIN power_sources ps ON ps.power_id=p.id
    LEFT JOIN power_case_links pcl ON pcl.power_id=p.id
    GROUP BY p.id ORDER BY p.issued_at DESC,c.display_name LIMIT ?`,limit);
}
function officeFiles(limit=200){
  return all(`SELECT o.id,o.file_no,o.title,o.status,o.opened_at,c.display_name client_name,
    COUNT(DISTINCT ca.id) case_count,MAX(ca.last_activity_at) last_activity_at
    FROM office_files o LEFT JOIN clients c ON c.id=o.primary_client_id
    LEFT JOIN cases ca ON ca.office_file_id=o.id
    GROUP BY o.id ORDER BY COALESCE(o.updated_at,o.created_at) DESC LIMIT ?`,limit);
}
function officeFileDetail(id){
  const o=one(`SELECT o.*,c.display_name client_name FROM office_files o
    LEFT JOIN clients c ON c.id=o.primary_client_id WHERE o.id=?`,id);
  if(!o)return null;
  o.cases=all("SELECT id,court,court_file_no,case_type,status,last_activity_at FROM cases WHERE office_file_id=? ORDER BY last_activity_at DESC",id);
  o.tasks=all("SELECT id,title,due_at,priority,status FROM tasks WHERE office_file_id=? ORDER BY due_at",id);
  o.deadlines=all(`SELECT d.id,d.title,d.due_at,d.legal_basis,d.confidence,d.lawyer_approved,d.status
    FROM deadlines d JOIN cases c ON c.id=d.case_id WHERE c.office_file_id=? ORDER BY d.due_at`,id);
  return o;
}
function timeline(officeFileId){
  const out=[];
  const push=(kind,id,title,occurredAt,subtitle,source)=>out.push({kind,id,title,occurredAt,subtitle,source});
  for(const r of all("SELECT * FROM timeline_events WHERE office_file_id=?",officeFileId)) push(r.event_type,r.id,r.title,r.occurred_at,null,r.source);
  for(const r of all("SELECT h.*,c.court,c.court_file_no FROM hearings h JOIN cases c ON c.id=h.case_id WHERE c.office_file_id=?",officeFileId)) push("hearing",r.id,r.hearing_type||"Duruşma",r.starts_at,[r.court,r.court_file_no].filter(Boolean).join(" · "),"UYAP");
  for(const r of all("SELECT d.*,c.court_file_no FROM documents d JOIN cases c ON c.id=d.case_id WHERE c.office_file_id=?",officeFileId)) push("document",r.id,r.title||r.document_type||"Evrak",r.document_date,r.court_file_no,"UYAP");
  for(const r of all("SELECT n.* FROM notifications n JOIN cases c ON c.id=n.case_id WHERE c.office_file_id=?",officeFileId)) push("notification",r.id,r.document_title||"Tebligat",r.issued_at,r.status,r.channel);
  for(const r of all("SELECT d.* FROM deadlines d JOIN cases c ON c.id=d.case_id WHERE c.office_file_id=?",officeFileId)) push("deadline",r.id,r.title,r.due_at,r.lawyer_approved?"Onaylı":"Taslak",r.source);
  for(const r of all("SELECT * FROM tasks WHERE office_file_id=?",officeFileId)) push("task",r.id,r.title,r.due_at,r.status,r.source);
  for(const r of all(`SELECT rd.*,c.court_file_no FROM uyap_remote_documents rd
    JOIN cases c ON c.id=rd.case_id WHERE c.office_file_id=?`,officeFileId))
    push("uyap_document",r.id,r.remote_title||r.document_type||r.original_file_name||"UYAP Evrakı",
      r.document_date||r.first_seen_at,[r.document_type,r.court_file_no,r.status].filter(Boolean).join(" · "),"UYAP Delta");
  for(const r of all("SELECT * FROM correspondence_requests WHERE office_file_id=?",officeFileId)){
    if(r.sent_at) push("correspondence_sent",r.id,"Müzekkere: "+r.institution,r.sent_at,r.subject,"Müzekkere");
    if(r.response_received_at) push("correspondence_response",r.id,"Müzekkere cevabı: "+r.institution,r.response_received_at,r.subject,"Müzekkere");
  }
  return out.sort((a,b)=>String(b.occurredAt||"").localeCompare(String(a.occurredAt||"")));
}
function assets(limit=200){
  return all(`SELECT a.id,a.file_name,a.extension,a.size_bytes,a.classification,a.first_seen_at,a.last_seen_at,
    c.display_name suggested_client,
    COUNT(l.id) location_count
    FROM local_assets a
    LEFT JOIN clients c ON c.id=a.suggested_client_id
    LEFT JOIN asset_locations l ON l.asset_id=a.id
    WHERE lower(COALESCE(a.extension,'')) NOT IN ('.jpg','.jpeg','.png','.webp')
       OR a.suggested_client_id IS NOT NULL OR a.classification='vekalet'
    GROUP BY a.id ORDER BY a.last_seen_at DESC LIMIT ?`,limit);
}
function assetDetail(id){
  const a=one(`SELECT a.*,c.display_name suggested_client FROM local_assets a
    LEFT JOIN clients c ON c.id=a.suggested_client_id WHERE a.id=?`,id);
  if(!a)return null;
  a.locations=all("SELECT local_path,source_root,last_seen_at FROM asset_locations WHERE asset_id=? ORDER BY last_seen_at DESC",id);
  return a;
}
function validTckn(v){
  const s=String(v||"").replace(/\D/g,"");
  if(!/^\d{11}$/.test(s)||s[0]==="0")return null;
  const d=[...s].map(Number);
  if(((d[0]+d[2]+d[4]+d[6]+d[8])*7-(d[1]+d[3]+d[5]+d[7]))%10!==d[9])return null;
  if(d.slice(0,10).reduce((a,b)=>a+b,0)%10!==d[10])return null;
  return s;
}
function cleanPhone(v){
  const digits=String(v||"").replace(/\D/g,"");
  const core=digits.startsWith("90")?digits.slice(2):(digits.startsWith("0")?digits.slice(1):digits);
  return core.length===10&&core.startsWith("5")?"+90 "+core.replace(/(\d{3})(\d{3})(\d{2})(\d{2})/,"$1 $2 $3 $4"):null;
}
function validAddress(v){
  const x=String(v||"").replace(/\s+/g," ").trim();
  if(x.length<12)return null;
  if(/tespiti\s+gerekmektedir|bilinmiyor|mevcut\s+değil|araştırılacaktır|güncellenecek/i.test(x))return null;
  if(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(x))return null;
  if(/(?:\+90\s*)?(?:0\s*)?5\d{2}[\s().-]*\d{3}[\s.-]*\d{2}[\s.-]*\d{2}/.test(x))return null;
  if(!/(?:\bmah\.?\b|\bmahalle\b|\bsok\.?\b|\bsk\.?\b|\bcad\.?\b|\bcd\.?\b|\bbulvar\b|\bno\s*[:.]|\bdaire\b|\bapt\.?\b|\bköy\b|\bmevkii\b)/i.test(x))return null;
  return x;
}
function inferClientFieldsFromText(text,{strictContact=false}={}){
  const raw=String(text||"").replace(/\r/g,""),lines=raw.split("\n").map(x=>x.replace(/\s+/g," ").trim()).filter(Boolean);
  const birth=raw.match(/(?:doğum\s*tarihi|doğum)\s*[:\-]?\s*([0-3]?\d[.\/-][01]?\d[.\/-](?:19|20)\d{2})/i);
  let national_id=null,address=null,phone=null,email=null;
  const marker=lines.findIndex(x=>/\bVEK[İI]L\s+EDEN\b/i.test(x));
  const block=marker>=0?lines.slice(marker,Math.min(lines.length,marker+7)):[];
  for(const line of block){
    if(!national_id){for(const m of line.match(/\d{11}/g)||[]){const v=validTckn(m);if(v){national_id=v;break;}}}
    if(!address&&/(mah\.?|mahalle|sok\.?|sk\.?|cad\.?|cd\.?|bulvar|no\s*[:.]|daire|apt\.?)/i.test(line))address=validAddress(line.replace(/^adres(?:i)?\s*[:\-]?\s*/i,""));
    if(!phone&&/(telefon|gsm|cep)\s*[:\-]/i.test(line)){const m=line.match(/(?:\+90\s*)?(?:0\s*)?5\d{2}[\s().-]*\d{3}[\s.-]*\d{2}[\s.-]*\d{2}/);phone=cleanPhone(m?.[0]);}
    if(!email&&/(e-?posta|email)\s*[:\-]/i.test(line)){const m=line.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);email=m?.[0]||null;}
  }
  if(!address){
    const m=raw.match(/(?:adres(?:i)?|ikametg[aâ]h(?:\s*adresi)?|yerleşim\s*yeri)\s*[:\-]?\s*([^\n]{10,180})/i);
    address=validAddress(m?.[1]);
  }
  if(!strictContact){phone=null;email=null;}
  return {national_id,birth_date:birth?.[1]?.trim()||null,address,phone,email};
}
function inferRelatedClientFields(text,clientName,currentTckn=null){
  const raw=String(text||"").replace(/\r/g,""),lines=raw.split("\n").map(x=>x.replace(/\s+/g," ").trim()).filter(Boolean);
  const target=nrm(clientName);
  const hit=lines.findIndex(x=>target&&nrm(x).includes(target));
  if(hit<0)return {national_id:null,birth_date:null,address:null};
  const local=lines.slice(hit,Math.min(lines.length,hit+3));
  let national_id=null;
  for(const line of local.slice(0,2)){
    for(const m of line.match(/\d{11}/g)||[]){const v=validTckn(m);if(v&&( !currentTckn || v===currentTckn)){national_id=v;break;}}
    if(national_id)break;
  }
  const nearby=local.join("\n");
  const birth=nearby.match(/(?:doğum\s*tarihi|doğum)\s*[:\-]?\s*([0-3]?\d[.\/-][01]?\d[.\/-](?:19|20)\d{2})/i);
  let address=null;
  for(let i=0;i<local.length;i++){
    const line=local[i],startsAddress=/^adres(?:i)?\s*[:\-]/i.test(line);
    if(i===0&&!startsAddress)continue;
    const ids=(line.match(/\d{11}/g)||[]).map(validTckn).filter(Boolean);
    if(ids.some(v=>currentTckn&&v!==currentTckn))continue;
    if(/\b(davacı|davalı|müşteki|sanık|vekil)\b/i.test(line)&&!startsAddress)continue;
    if(startsAddress||/(mah\.?|mahalle|sok\.?|sk\.?|cad\.?|cd\.?|bulvar|daire|apt\.?|köy|mevkii)/i.test(line)){
      address=validAddress(line.replace(/^adres(?:i)?\s*[:\-]?\s*/i,""));
      if(address)break;
    }
  }
  return {national_id,birth_date:birth?.[1]?.trim()||null,address};
}
function powerDetail(id){
  const p=one(`SELECT p.*,c.display_name client_name,c.client_type,c.national_id,c.phone,c.email,c.birth_date,c.address
    FROM powers_of_attorney p JOIN clients c ON c.id=p.client_id WHERE p.id=?`,id);
  if(!p)return null;
  p.sources=all("SELECT id,source_type,source_ref,local_path,observed_at,metadata_json FROM power_sources WHERE power_id=? ORDER BY observed_at DESC",id);
  p.cases=all(`SELECT c.id,c.court,c.court_file_no,c.case_type,c.status,o.file_no office_file_no
    FROM power_case_links l JOIN cases c ON c.id=l.case_id
    LEFT JOIN office_files o ON o.id=c.office_file_id WHERE l.power_id=?`,id);
  p.field_sources={};
  if(p.national_id&&validTckn(p.national_id)){p.national_id=validTckn(p.national_id);p.field_sources.national_id="Müvekkil kaydı";}else p.national_id=null;
  if(p.birth_date)p.field_sources.birth_date="Müvekkil kaydı";
  if(p.address&&validAddress(p.address)){p.address=validAddress(p.address);p.field_sources.address="Müvekkil kaydı";}else p.address=null;
  const phoneShared=p.phone?one("SELECT COUNT(*) n FROM clients WHERE phone=?",p.phone).n:0;
  const emailShared=p.email?one("SELECT COUNT(*) n FROM clients WHERE lower(email)=lower(?)",p.email).n:0;
  if(p.phone&&phoneShared<=1){p.phone=cleanPhone(p.phone);if(p.phone)p.field_sources.phone="Müvekkil kaydı";}else p.phone=null;
  if(p.email&&emailShared<=1&&!/(bono|hukuk|avukat)/i.test(p.email)){p.field_sources.email="Müvekkil kaydı";}else p.email=null;
  const linked=all(`SELECT DISTINCT a.file_name,da.raw_text
    FROM power_sources ps JOIN asset_locations al ON al.local_path=ps.local_path
    JOIN local_assets a ON a.id=al.asset_id LEFT JOIN document_analysis da ON da.asset_id=a.id
    WHERE ps.power_id=? AND COALESCE(da.raw_text,'')!=''`,id);
  for(const doc of linked){
    const inferred=inferClientFieldsFromText(doc.raw_text,{strictContact:true});
    for(const k of ["national_id","birth_date","address","phone","email"])if(!p[k]&&inferred[k]){p[k]=inferred[k];p.field_sources[k]=doc.file_name||"Vekâlet belgesi";}
  }
  if(!p.national_id||!p.birth_date||!p.address){
    const related=all(`SELECT DISTINCT a.file_name,da.raw_text
      FROM local_assets a JOIN document_analysis da ON da.asset_id=a.id
      WHERE COALESCE(da.raw_text,'')!=''
        AND (a.suggested_client_id=? OR lower(da.raw_text) LIKE lower(?))
      ORDER BY CASE WHEN a.suggested_client_id=? THEN 0 ELSE 1 END,a.id DESC LIMIT 80`,
      p.client_id,"%"+p.client_name+"%",p.client_id);
    for(const doc of related){
      const inferred=inferRelatedClientFields(doc.raw_text,p.client_name,p.national_id);
      for(const k of ["national_id","birth_date","address"])if(!p[k]&&inferred[k]){p[k]=inferred[k];p.field_sources[k]=doc.file_name||"İlişkili belge";}
      if(p.national_id&&p.birth_date&&p.address)break;
    }
  }
  return p;
}
function deadlines(limit=200){
  return all(`SELECT d.id,d.title,d.legal_basis,d.starts_at,d.due_at,d.confidence,d.lawyer_approved,d.status,
    c.court,c.court_file_no,o.file_no office_file_no
    FROM deadlines d
    LEFT JOIN cases c ON c.id=d.case_id
    LEFT JOIN office_files o ON o.id=c.office_file_id
    ORDER BY CASE WHEN d.status='open' THEN 0 ELSE 1 END,d.due_at LIMIT ?`,limit);
}
function tasks(limit=200){
  return all(`SELECT t.id,t.title,t.description,t.due_at,t.priority,t.status,t.source,
    o.file_no office_file_no,c.court,c.court_file_no
    FROM tasks t
    LEFT JOIN office_files o ON o.id=t.office_file_id
    LEFT JOIN cases c ON c.id=t.case_id
    ORDER BY CASE WHEN t.status='open' THEN 0 ELSE 1 END,t.due_at LIMIT ?`,limit);
}
function jobs(limit=50){return all("SELECT id,job_type,status,attempts,max_attempts,created_at,started_at,finished_at,error,result_json FROM job_queue ORDER BY id DESC LIMIT ?",limit)}
function scanRoots(){return all("SELECT * FROM scan_roots ORDER BY label,path")}
function recentAudit(limit=100){return all("SELECT * FROM audit_log ORDER BY id DESC LIMIT ?",limit)}
module.exports={summary,brief,search,clients,clientDetail,powers,powerDetail,officeFiles,officeFileDetail,timeline,assets,assetDetail,deadlines,tasks,jobs,scanRoots,recentAudit};
