const fs=require("fs");
const path=require("path");
const crypto=require("crypto");
const {execFile}=require("child_process");
const db=require("./db");
const jobs=require("./jobs");
const v04=require("./v04");
const v05=require("./v05");
const workflow=require("./workflow_engine");
const eventBus=require("./event_bus");
const v09=require("./v09");
const uyap=require("./uyap");

const ROOT=path.join(__dirname,"..");
const DATA=path.join(ROOT,"data");
const BACKUPS=path.join(DATA,"backups");
const UYAP_STAGING=path.join(DATA,"staging","uyap");
const CONTAINER_STAGING=path.join(DATA,"staging","containers");
const USER=process.env.USERPROFILE||"C:\\Users\\omera";
const DESKTOP=path.join(USER,"OneDrive","Masaüstü");
const DAVA_ROOT=path.join(DESKTOP,"Dava Dosyaları");
const EXT=new Set([".pdf",".doc",".docx",".udf",".txt",".rtf",".xls",".xlsx",".zip",".eyp",".tif",".tiff",".html",".htm",".jpg",".jpeg",".png"]);
const SKIP=["\\BONO_OS\\","\\etsy_ai_ops_v1\\","\\node_modules\\","\\.git\\","\\AppData\\","\\Pictures\\","\\Videos\\"];

function nrm(s){
  return String(s||"").replace(/İ/g,"I").replace(/ı/g,"i").normalize("NFD")
    .replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
}
function classify(name){
  const x=nrm(name);
  if(x.includes("vekalet")) return "vekalet";
  if(x.includes("muzekkere")) return x.includes("cevap")?"müzekkere_cevabı":"müzekkere";
  if(x.includes("teblig")||x.includes("mazbata")) return "tebligat";
  if(x.includes("bilirkisi")||x.includes("rapor")) return "rapor";
  if(x.includes("iddianame")) return "iddianame";
  if(x.includes("tensip")) return "tensip";
  if(x.includes("delil")) return "delil";
  if(x.includes("karar")) return "karar";
  if(x.includes("dilekce")||x.includes("beyan")||x.includes("savunma")) return "dilekce";
  if(x.includes("ihtar")) return "ihtar";
  return "belge";
}
function hashFile(file){
  return new Promise((resolve,reject)=>{
    const h=crypto.createHash("sha256"),s=fs.createReadStream(file);
    s.on("data",d=>h.update(d)); s.on("error",reject); s.on("end",()=>resolve(h.digest("hex")));
  });
}
function isUyapPortalLoginFile(file){
  try{
    const fd=fs.openSync(file,"r"),buf=Buffer.alloc(4096),n=fs.readSync(fd,buf,0,buf.length,0);fs.closeSync(fd);
    const s=buf.subarray(0,n).toString("utf8").toLowerCase();
    return s.includes("uyap avukat bilgi sistemi")&&(s.includes("avukat portal giriş sayfası")||s.includes("<div id=\"root\"></div>"));
  }catch{return false}
}
function walk(dir,out){
  out=out||[];
  let list=[]; try{list=fs.readdirSync(dir,{withFileTypes:true})}catch{return out}
  for(const ent of list){
    const full=path.join(dir,ent.name),cmp=full.replace(/\//g,"\\").toLowerCase();
    const stagingCmp=UYAP_STAGING.replace(/\//g,"\\").toLowerCase();
    if(!cmp.startsWith(stagingCmp) && SKIP.some(s=>cmp.includes(s.toLowerCase()))) continue;
    if(ent.isDirectory()) walk(full,out);
    else if(ent.isFile()&&EXT.has(path.extname(ent.name).toLowerCase())) out.push(full);
  }
  return out;
}
function courtKey(v){
  return nrm(v).replace(/\b(mahkemesi|mahkeme|hakimligi|hakimlik|dairesi|daire)\b/g," ").replace(/\s+/g," ").trim();
}
function caseNoKey(v){
  const m=String(v||"").match(/(20\d{2})\s*\/\s*(\d+)/);
  return m?m[1]+"/"+String(Number(m[2])):nrm(v);
}
function archiveCategoryForCourt(court){
  const x=nrm(court);
  if(/cbs|savcilik|bassavcilik/.test(x))return "CBS";
  if(/agir ceza/.test(x))return "Ağır Ceza Mahkemesi";
  if(/asliye ceza/.test(x))return "Asliye Ceza Mahkemesi";
  if(/sulh ceza/.test(x))return "Sulh Ceza Hakimliği";
  if(/infaz/.test(x))return "İnfaz Hakimliği";
  if(/aile/.test(x))return "Aile Mahkemesi";
  if(/is mahkem/.test(x))return "İş Mahkemeleri";
  if(/icra hukuk/.test(x))return "İcra Hukuk Mahkemesi";
  if(/sulh hukuk/.test(x))return "Sulh Hukuk Mahkemesi";
  if(/idare|vergi/.test(x))return "İdare Mahkemesi";
  if(/asliye hukuk|ticaret|tuketici|kadastro|fikri/.test(x))return "Asliye Hukuk Mahkemesi";
  return "Diğer Dava Dosyaları";
}
function createFallbackArchiveFolder(caseId){
  const c=db.prepare(`SELECT id,office_file_id,court,court_file_no,client_name,
    (SELECT GROUP_CONCAT(name,' - ') FROM parties p WHERE p.case_id=cases.id AND p.is_client=1) client_parties
    FROM cases WHERE id=?`).get(caseId);
  if(!c?.court||!c?.court_file_no)return null;
  const cat=archiveCategoryForCourt(c.court);
  const caseNo=String(c.court_file_no).replace(/[\\/:*?"<>|]/g,"-");
  const who=String(c.client_name||c.client_parties||"").trim();
  const folderName=(who?who+" - ":"")+String(c.court).trim()+" - "+caseNo;
  const relative=path.join(cat,folderName);
  const abs=path.join(DAVA_ROOT,relative);
  fs.mkdirSync(abs,{recursive:true});
  db.prepare(`INSERT INTO archive_folders(root_path,relative_path,court_category,folder_name,inferred_client,inferred_case_no,file_count,last_scanned_at)
    VALUES(?,?,?,?,?,?,0,datetime('now'))
    ON CONFLICT(root_path,relative_path) DO UPDATE SET last_scanned_at=datetime('now')`)
    .run(DAVA_ROOT,relative,cat,folderName,who||null,c.court_file_no);
  const f=db.prepare("SELECT id FROM archive_folders WHERE root_path=? AND relative_path=?").get(DAVA_ROOT,relative);
  if(f)db.prepare(`INSERT INTO archive_case_links(office_file_id,case_id,archive_folder_id,confidence,status,reasons_json,created_at)
    VALUES(?,?,?,1,'auto',?,datetime('now'))
    ON CONFLICT(case_id,archive_folder_id) DO UPDATE SET confidence=1,status='auto',reasons_json=excluded.reasons_json`)
    .run(c.office_file_id||null,caseId,f.id,JSON.stringify(["BONO tarafından esas no ve mahkeme ile oluşturulan klasör"]));
  return abs;
}
function archiveFolderForCase(caseId){
  let rows=db.prepare(`SELECT l.status,l.confidence,f.root_path,f.relative_path,f.folder_name
    FROM archive_case_links l JOIN archive_folders f ON f.id=l.archive_folder_id
    WHERE l.case_id=? ORDER BY l.status='verified' DESC,l.confidence DESC,l.id DESC`).all(caseId);
  if(!rows.length){
    const current=db.prepare("SELECT court,court_file_no FROM cases WHERE id=?").get(caseId);
    if(current?.court_file_no){
      const targetCaseNo=caseNoKey(current.court_file_no),targetCourt=courtKey(current.court);
      const siblings=db.prepare("SELECT id,court,court_file_no FROM cases WHERE id<>?").all(caseId)
        .filter(x=>caseNoKey(x.court_file_no)===targetCaseNo&&courtKey(x.court)===targetCourt);
      for(const s of siblings){
        const linked=db.prepare(`SELECT l.status,l.confidence,f.root_path,f.relative_path,f.folder_name
          FROM archive_case_links l JOIN archive_folders f ON f.id=l.archive_folder_id
          WHERE l.case_id=? ORDER BY l.status='verified' DESC,l.confidence DESC,l.id DESC`).all(s.id);
        rows.push(...linked);
      }
    }
  }
  if(!rows.length)return createFallbackArchiveFolder(caseId);
  const verified=rows.find(x=>x.status==='verified');
  if(verified)return path.join(verified.root_path,verified.relative_path);
  const top=rows[0],ties=rows.filter(x=>Math.abs((x.confidence||0)-(top.confidence||0))<0.0001);
  if((top.confidence||0)>=0.74&&ties.length===1)return path.join(top.root_path,top.relative_path);
  // Belirsiz eşleşmede staging'de bırakma; mahkeme + esas no ile güvenli fallback klasörü kullan.
  return createFallbackArchiveFolder(caseId);
}
function uniqueArchiveName(dir,baseName){
  const clean=String(baseName||"Belge").replace(/[<>:"/\\|?*\x00-\x1F]/g," ").replace(/\s+/g," ").trim()||"Belge";
  let out=path.join(dir,clean);
  if(!fs.existsSync(out))return out;
  const ext=path.extname(clean),stem=path.basename(clean,ext);let n=2;
  while(fs.existsSync(out)){out=path.join(dir,stem+" ("+n+")"+ext);n++}
  return out;
}
function removeIndexedPath(localPath){
  const row=db.prepare("SELECT asset_id FROM asset_locations WHERE local_path=?").get(localPath);
  if(!row)return;
  db.prepare("DELETE FROM asset_locations WHERE local_path=?").run(localPath);
  const left=db.prepare("SELECT COUNT(*) n FROM asset_locations WHERE asset_id=?").get(row.asset_id).n;
  const refs=db.prepare("SELECT COUNT(*) n FROM uyap_remote_documents WHERE local_asset_id=?").get(row.asset_id).n;
  if(left===0&&refs===0){
    db.prepare("DELETE FROM search_index WHERE entity_type='asset' AND entity_id=?").run(String(row.asset_id));
    db.prepare("DELETE FROM local_assets WHERE id=?").run(row.asset_id);
  }
}
function cleanupTransientAssetLocations(assetId,keepPath=null){
  if(!assetId)return 0;
  const rows=db.prepare("SELECT id,local_path FROM asset_locations WHERE asset_id=?").all(assetId);let removed=0;
  for(const row of rows){
    const abs=path.resolve(row.local_path),low=abs.toLowerCase(),keep=keepPath&&path.resolve(keepPath).toLowerCase();
    if(keep&&low===keep)continue;
    const isStaging=low.startsWith(path.resolve(UYAP_STAGING).toLowerCase()+path.sep.toLowerCase());
    const isTempDownload=low.startsWith(path.resolve(path.join(USER,"Downloads")).toLowerCase()+path.sep.toLowerCase())&&/^BONO_UYAP_evrak_/i.test(path.basename(abs));
    if(!isStaging&&!isTempDownload)continue;
    try{if(fs.existsSync(abs))fs.unlinkSync(abs)}catch{}
    db.prepare("DELETE FROM asset_locations WHERE id=?").run(row.id);removed++;
  }
  return removed;
}
function reusableAssetPath(assetId){
  if(!assetId)return null;
  const stagingRoot=path.resolve(UYAP_STAGING).toLowerCase()+path.sep.toLowerCase();
  const downloadsRoot=path.resolve(path.join(USER,"Downloads")).toLowerCase()+path.sep.toLowerCase();
  const rows=db.prepare("SELECT local_path FROM asset_locations WHERE asset_id=? ORDER BY id").all(assetId);
  for(const row of rows){
    const p=path.resolve(String(row.local_path||"")),low=p.toLowerCase();
    if(!fs.existsSync(p))continue;
    if(low.startsWith(stagingRoot))continue;
    if(low.startsWith(downloadsRoot)&&/^BONO_UYAP_/i.test(path.basename(p)))continue;
    return p;
  }
  return null;
}
async function archiveOneFile(file,caseId,preferredName=null){
  const destDir=archiveFolderForCase(caseId);
  if(!destDir||!fs.existsSync(file))return {archived:false,reason:"archive_unmatched"};
  if(isUyapPortalLoginFile(file)){
    try{fs.unlinkSync(file)}catch{}
    db.prepare("DELETE FROM asset_locations WHERE local_path=?").run(file);
    return {archived:false,reason:"uyap_portal_login_html"};
  }
  fs.mkdirSync(destDir,{recursive:true});
  const sha=await hashFile(file);
  const asset=db.prepare("SELECT id FROM local_assets WHERE sha256=?").get(sha);
  if(asset){
    const existingPath=reusableAssetPath(asset.id);
    if(existingPath){
      try{if(path.resolve(file)!==path.resolve(existingPath)&&fs.existsSync(file))fs.unlinkSync(file)}catch{}
      cleanupTransientAssetLocations(asset.id,existingPath);
      return {archived:true,dedup:true,path:existingPath,assetId:asset.id};
    }
  }
  const finalPath=uniqueArchiveName(destDir,preferredName||path.basename(file));
  fs.copyFileSync(file,finalPath);
  await scanDocuments({roots:[destDir]});
  const loc=db.prepare("SELECT asset_id FROM asset_locations WHERE local_path=?").get(finalPath);
  const assetId=loc?.asset_id||asset?.id||null;
  try{if(path.resolve(file)!==path.resolve(finalPath)&&fs.existsSync(file))fs.unlinkSync(file)}catch{}
  cleanupTransientAssetLocations(assetId,finalPath);
  return {archived:true,dedup:false,path:finalPath,assetId};
}
async function extractContainer(file,commandId){
  const token=String(commandId||Date.now())+"-"+crypto.randomBytes(4).toString("hex");
  const dest=path.join(CONTAINER_STAGING,token);
  fs.mkdirSync(dest,{recursive:true});
  const result=await runPython("extract_container.py",[file,dest]);
  if(result?.error)throw new Error(result.error);
  return {dest,files:Array.isArray(result?.extracted)?result.extracted:[]};
}
function usefulArchiveLabel(value){
  const x=nrm(value);
  if(!x)return false;
  if(/reddiyat|tahsilat|tahsil makbuz|harc tahsil|posta reddiyat/.test(x))return false;
  return /(dava dilekce|cevap dilekce|beyan|savunma|talep|delil|bilirkisi|uzman rapor|rapor|ifade tutanak|ifade zapt|tutanak|durusma zapt|gerekceli karar|karar evraki|karar|tensip|iddianame|vekalet|itiraz|istinaf|temyiz|feragat|tavzih|sikayet|suc duyurusu|nufus kayit|banka hareket|epikriz|saglik rapor|sozlesme|protokol|arabuluculuk|muzekkere cevab|kurum cevab|ekspertiz|adli tip)/.test(x);
}
function shouldArchiveFile(file){
  const ext=path.extname(file).toLowerCase(),x=nrm(path.basename(file));
  if(ext===".zip"||ext===".eyp")return false;
  if(/reddiyat|tahsilat|tahsil makbuz|harc tahsil|posta reddiyat/.test(x))return false;
  if(ext===".udf")return true;
  if([".xls",".xlsx",".xlsm"].includes(ext))return true;
  return usefulArchiveLabel(x);
}
function shouldArchiveRemote(remote,file){
  const ext=path.extname(file||remote?.original_file_name||"").toLowerCase();
  const label=[remote?.remote_title,remote?.document_type,remote?.original_file_name,remote?.document_kind,path.basename(file||"")].filter(Boolean).join(" ");
  const x=nrm(label);
  if(/reddiyat|tahsilat|tahsil makbuz|harc tahsil|posta reddiyat/.test(x))return false;
  if(ext===".udf")return true;
  if([".xls",".xlsx",".xlsm"].includes(ext))return true;
  return usefulArchiveLabel(label);
}
function usefulContainerMember(file){
  const ext=path.extname(file).toLowerCase(),x=nrm(path.basename(file));
  if(!EXT.has(ext)||ext===".zip"||ext===".eyp")return false;
  if(/^(manifest|metadata|signature|signatures|mimetype|thumbnail|preview|index)$/.test(x))return false;
  if(/sertifika|certificate|imza bilgisi|paket bilgisi/.test(x)&&ext!==".pdf")return false;
  if(ext===".udf"||[".xls",".xlsx",".xlsm"].includes(ext))return true;
  return usefulArchiveLabel(x);
}
function preferredArchiveName(remote,file){
  const ext=path.extname(file).toLowerCase();
  if(ext===".udf")return path.basename(file); // UDF birinci sınıf çalışma formatı
  const raw=String(remote?.remote_title||remote?.document_type||remote?.original_file_name||path.basename(file)).trim();
  const base=raw.replace(/\.[a-z0-9]{2,5}$/i,"").replace(/[<>:"/\\|?*\x00-\x1F]/g," ").replace(/\s+/g," ").trim()||path.basename(file,ext);
  const date=String(remote?.document_date||"").slice(0,10);
  return base+(date?" - "+date:"")+ext;
}
function setArchiveMeta(assetId,{originalExt=null,archiveExt=null,policy=null,archivePath=null,sourceContainer=null}={}){
  if(!assetId)return;
  db.prepare(`UPDATE local_assets SET
    original_extension=COALESCE(?,original_extension),
    archive_extension=COALESCE(?,archive_extension),
    archive_policy=COALESCE(?,archive_policy),
    archive_path=COALESCE(?,archive_path),
    source_container=COALESCE(?,source_container)
    WHERE id=?`).run(originalExt,archiveExt,policy,archivePath,sourceContainer,assetId);
}
async function convertArchiveFile(file){
  const ext=path.extname(file).toLowerCase();
  if(![".tif",".tiff",".html",".htm",".jpg",".jpeg",".png",".xls",".xlsx",".xlsm"].includes(ext))return null;
  const dir=path.join(DATA,"staging","converted");fs.mkdirSync(dir,{recursive:true});
  const out=path.join(dir,crypto.randomBytes(10).toString("hex")+".pdf");
  const result=await runPython("convert_archive_file.py",[file,out]);
  if(!result?.ok||!fs.existsSync(out))return {ok:false,error:result?.error||"Dönüşüm başarısız"};
  return {ok:true,path:out};
}
function pdfNameFrom(name){
  const ext=path.extname(name),stem=path.basename(name,ext);
  return stem+" - PDF.pdf";
}
async function archiveWithFormatPolicy(file,caseId,preferredName=null,sourceContainer=null){
  const ext=path.extname(file).toLowerCase();
  if([".tif",".tiff",".html",".htm"].includes(ext)){
    const converted=await convertArchiveFile(file);
    if(!converted?.ok)return {archived:false,reason:"conversion_failed",error:converted?.error};
    const targetName=pdfNameFrom(preferredName||path.basename(file));
    const saved=await archiveOneFile(converted.path,caseId,targetName);
    if(saved.archived){
      try{if(fs.existsSync(file))fs.unlinkSync(file)}catch{}
      setArchiveMeta(saved.assetId,{originalExt:ext,archiveExt:".pdf",policy:"convert_to_pdf",archivePath:saved.path,sourceContainer});
    }else try{if(fs.existsSync(converted.path))fs.unlinkSync(converted.path)}catch{}
    return saved;
  }
  if([".xls",".xlsx",".xlsm"].includes(ext)){
    const saved=await archiveOneFile(file,caseId,preferredName||path.basename(file));
    if(saved.archived){
      setArchiveMeta(saved.assetId,{originalExt:ext,archiveExt:ext,policy:"keep_original_with_pdf",archivePath:saved.path,sourceContainer});
      const converted=await convertArchiveFile(saved.path);
      if(converted?.ok){
        const previewName=pdfNameFrom(path.basename(saved.path));
        const preview=await archiveOneFile(converted.path,caseId,previewName);
        if(preview.archived)setArchiveMeta(preview.assetId,{originalExt:ext,archiveExt:".pdf",policy:"preview_pdf",archivePath:preview.path,sourceContainer});
      }
    }
    return saved;
  }
  const saved=await archiveOneFile(file,caseId,preferredName||path.basename(file));
  if(saved.archived)setArchiveMeta(saved.assetId,{originalExt:ext,archiveExt:ext,policy:ext===".udf"?"keep_udf":"keep_original",archivePath:saved.path,sourceContainer});
  return saved;
}
async function copyIntoArchiveDir(file,destDir,preferredName=null,{originalExt=null,policy="keep_original",sourceContainer=null}={}){
  if(!fs.existsSync(file))return {archived:false,reason:"source_missing"};
  fs.mkdirSync(destDir,{recursive:true});
  const sha=await hashFile(file);
  const asset=db.prepare("SELECT id FROM local_assets WHERE sha256=?").get(sha);
  if(asset){
    const existingPath=reusableAssetPath(asset.id);
    if(existingPath){
      try{if(path.resolve(file)!==path.resolve(existingPath)&&fs.existsSync(file))fs.unlinkSync(file)}catch{}
      cleanupTransientAssetLocations(asset.id,existingPath);
      setArchiveMeta(asset.id,{originalExt:originalExt||path.extname(file).toLowerCase(),archiveExt:path.extname(existingPath).toLowerCase(),policy,archivePath:existingPath,sourceContainer});
      return {archived:true,dedup:true,path:existingPath,assetId:asset.id};
    }
  }
  const finalPath=uniqueArchiveName(destDir,preferredName||path.basename(file));
  fs.copyFileSync(file,finalPath);
  await scanDocuments({roots:[destDir]});
  const loc=db.prepare("SELECT asset_id FROM asset_locations WHERE local_path=?").get(finalPath);
  const assetId=loc?.asset_id||asset?.id||null;
  try{if(path.resolve(file)!==path.resolve(finalPath)&&fs.existsSync(file))fs.unlinkSync(file)}catch{}
  setArchiveMeta(assetId,{originalExt:originalExt||path.extname(finalPath).toLowerCase(),archiveExt:path.extname(finalPath).toLowerCase(),policy,archivePath:finalPath,sourceContainer});
  return {archived:true,dedup:false,path:finalPath,assetId};
}
async function archiveMemberIntoDir(file,destDir,sourceContainer=null){
  const ext=path.extname(file).toLowerCase(),name=path.basename(file);
  if([".tif",".tiff",".html",".htm"].includes(ext)){
    const converted=await convertArchiveFile(file);
    if(!converted?.ok)return {archived:false,reason:"conversion_failed",error:converted?.error};
    const saved=await copyIntoArchiveDir(converted.path,destDir,pdfNameFrom(name),{originalExt:ext,policy:"convert_to_pdf",sourceContainer});
    if(saved.archived){try{if(fs.existsSync(file))fs.unlinkSync(file)}catch{}}
    return saved;
  }
  if([".xls",".xlsx",".xlsm"].includes(ext)){
    const saved=await copyIntoArchiveDir(file,destDir,name,{originalExt:ext,policy:"keep_original_with_pdf",sourceContainer});
    if(saved.archived){
      const converted=await convertArchiveFile(saved.path);
      if(converted?.ok)await copyIntoArchiveDir(converted.path,destDir,pdfNameFrom(path.basename(saved.path)),{originalExt:ext,policy:"preview_pdf",sourceContainer});
    }
    return saved;
  }
  return await copyIntoArchiveDir(file,destDir,name,{originalExt:ext,policy:ext===".udf"?"keep_udf":"keep_original",sourceContainer});
}
async function archiveContainerMembers(file,caseId,commandId,depth=0){
  if(depth>3)return {archived:[],duplicates:0,skipped:[],unresolved:1,errors:["max_depth"]};
  const pack=await extractContainer(file,String(commandId)+"-"+depth);
  const out={archived:[],duplicates:0,skipped:[],unresolved:0,errors:[]};
  for(const member of pack.files){
    const ext=path.extname(member).toLowerCase();
    try{
      if(ext===".zip"||ext===".eyp"){
        const nested=await archiveContainerMembers(member,caseId,commandId,depth+1);
        out.archived.push(...nested.archived);out.duplicates+=nested.duplicates;out.skipped.push(...nested.skipped);out.unresolved+=nested.unresolved||0;out.errors.push(...nested.errors);
        continue;
      }
      if(!usefulContainerMember(member)){out.skipped.push(member);try{fs.unlinkSync(member)}catch{};continue}
      const saved=await archiveWithFormatPolicy(member,caseId,path.basename(member),path.basename(file));
      if(saved.archived){out.archived.push(saved);if(saved.dedup)out.duplicates++}
      else {out.skipped.push(member);out.unresolved++;if(saved.error)out.errors.push(saved.error);}
    }catch(e){out.errors.push(String(e.message||e))}
  }
  try{fs.rmSync(pack.dest,{recursive:true,force:true})}catch{}
  return out;
}
async function archiveExistingUyapDocuments(limit=100){
  const rows=db.prepare(`SELECT rd.*,a.file_name,a.extension,da.document_kind
    FROM uyap_remote_documents rd JOIN local_assets a ON a.id=rd.local_asset_id
    LEFT JOIN document_analysis da ON da.asset_id=a.id
    WHERE rd.local_asset_id IS NOT NULL AND rd.status IN ('indexed','downloaded','filed')
      AND COALESCE(rd.remote_document_id,'') NOT LIKE 'container:%'
    ORDER BY COALESCE(rd.downloaded_at,rd.last_seen_at) DESC LIMIT ?`).all(limit);
  const out={checked:0,archived:0,duplicates:0,unmatched:0,skipped:0,errors:[]};
  for(const r of rows){
    out.checked++;
    try{
      const locs=db.prepare("SELECT local_path FROM asset_locations WHERE asset_id=?").all(r.local_asset_id);
      const expectedDir=archiveFolderForCase(r.case_id),expectedKey=expectedDir?path.resolve(expectedDir).toLowerCase():null;
      const archivedLoc=expectedKey?locs.find(x=>{const loc=path.resolve(String(x.local_path||"")).toLowerCase();return loc===expectedKey||loc.startsWith(expectedKey+path.sep.toLowerCase())}):null;
      if(archivedLoc){
        cleanupTransientAssetLocations(r.local_asset_id,archivedLoc.local_path);
        db.prepare("UPDATE uyap_remote_documents SET filed_path=?,staging_path=NULL,status='filed',filed_at=COALESCE(filed_at,datetime('now')),last_seen_at=datetime('now') WHERE id=?")
          .run(archivedLoc.local_path,r.id);
        continue;
      }
      const source=[r.staging_path,...locs.map(x=>x.local_path)].find(x=>x&&fs.existsSync(x));
      if(!source){out.skipped++;continue}
      const ext=path.extname(source).toLowerCase();
      if(ext===".zip"||ext===".eyp"){
        const packed=await archiveContainerMembers(source,r.case_id,"existing-"+r.id);
        const fullyHandled=(packed.unresolved||0)===0&&packed.errors.length===0;
        if(!fullyHandled){out.unmatched++;continue}
        try{if(fs.existsSync(source))fs.unlinkSync(source)}catch{}
        db.prepare("UPDATE uyap_remote_documents SET local_asset_id=NULL,status=?,staging_path=NULL,filed_path=NULL,filed_at=datetime('now'),metadata_json=?,last_seen_at=datetime('now') WHERE id=?")
          .run(packed.archived.length?'filed':'skipped',JSON.stringify({container:true,members:packed.archived.length,duplicates:packed.duplicates,unresolved:0,migrated:true}),r.id);
        out.archived+=packed.archived.length;out.duplicates+=packed.duplicates;continue;
      }
      if(!shouldArchiveRemote(r,source)){out.skipped++;continue}
      const saved=await archiveWithFormatPolicy(source,r.case_id,preferredArchiveName(r,source),r.original_file_name||r.remote_title||null);
      if(!saved.archived){out.unmatched++;if(saved.error)out.errors.push({id:r.id,error:saved.error});continue}
      db.prepare("UPDATE uyap_remote_documents SET local_asset_id=?,filed_path=?,staging_path=NULL,status='filed',filed_at=COALESCE(filed_at,datetime('now')),last_seen_at=datetime('now') WHERE id=?")
        .run(saved.assetId||r.local_asset_id,saved.path||null,r.id);
      out.archived++;if(saved.dedup)out.duplicates++;
    }catch(e){out.errors.push({id:r.id,error:String(e.message||e)})}
  }
  return out;
}
async function expandArchiveContainers(){
  if(!fs.existsSync(DAVA_ROOT))return {packages:0,extracted:0,duplicates:0,skipped:0,preserved:0,errors:[]};
  await scanDocuments({roots:[DAVA_ROOT]});
  const packages=[];
  (function find(dir){
    let entries=[];try{entries=fs.readdirSync(dir,{withFileTypes:true})}catch{return}
    for(const e of entries){
      const full=path.join(dir,e.name);
      if(e.isDirectory())find(full);
      else if(e.isFile()&&[".zip",".eyp"].includes(path.extname(e.name).toLowerCase()))packages.push(full);
    }
  })(DAVA_ROOT);
  const result={packages:packages.length,extracted:0,duplicates:0,skipped:0,preserved:0,errors:[]};
  async function processPack(packFile,destDir,depth=0){
    if(depth>3)return {handled:0,unresolved:1,errors:["max_depth"]};
    const unpack=await extractContainer(packFile,"archive-"+depth);
    let handled=0,unresolved=0;const errors=[];
    for(const member of unpack.files){
      try{
        const ext=path.extname(member).toLowerCase();
        if(ext===".zip"||ext===".eyp"){
          const nested=await processPack(member,destDir,depth+1);
          handled+=nested.handled;unresolved+=nested.unresolved;errors.push(...nested.errors);continue;
        }
        if(!usefulContainerMember(member)){result.skipped++;handled++;continue}
        const saved=await archiveMemberIntoDir(member,destDir,path.basename(packFile));
        if(!saved.archived){unresolved++;if(saved.error)errors.push(saved.error);continue}
        if(saved.dedup)result.duplicates++;else result.extracted++;
        handled++;
      }catch(e){unresolved++;errors.push(String(e.message||e))}
    }
    try{fs.rmSync(unpack.dest,{recursive:true,force:true})}catch{}
    return {handled,unresolved,errors};
  }
  for(const packFile of packages){
    try{
      const out=await processPack(packFile,path.dirname(packFile),0);
      result.errors.push(...out.errors.map(e=>path.basename(packFile)+": "+e));
      if(out.handled>0&&out.unresolved===0&&out.errors.length===0){
        removeIndexedPath(packFile);
        try{fs.unlinkSync(packFile)}catch{}
      }else result.preserved++;
    }catch(e){result.preserved++;result.errors.push(path.basename(packFile)+": "+String(e.message||e))}
  }
  if(result.extracted||result.duplicates)await scanDocuments({roots:[DAVA_ROOT]});
  return result;
}
function enqueueArchiveConversion(file){
  const ext=path.extname(file).toLowerCase();
  if(![".tif",".tiff",".html",".htm",".xls",".xlsx"].includes(ext))return null;
  const abs=path.resolve(file);
  if(!abs.toLowerCase().startsWith(path.resolve(DAVA_ROOT).toLowerCase()+path.sep.toLowerCase()))return null;
  const out=path.join(path.dirname(abs),path.basename(abs,ext)+".pdf");
  if(fs.existsSync(out))return null;
  return jobs.enqueue("convert_archive_format",{source:abs,output:out},"archive-convert:"+crypto.createHash("sha1").update(abs.toLowerCase()).digest("hex"),85);
}
async function convertArchiveFormat(payload={}){
  const source=path.resolve(String(payload.source||"")),output=path.resolve(String(payload.output||""));
  if(!source||!output||!fs.existsSync(source))return {ok:false,skipped:true,reason:"source_missing"};
  if(!source.toLowerCase().startsWith(path.resolve(DAVA_ROOT).toLowerCase()+path.sep.toLowerCase()))return {ok:false,skipped:true,reason:"outside_archive"};
  const result=await runPython("convert_archive_format.py",[source,output]);
  if(result?.ok&&fs.existsSync(output))await scanDocuments({roots:[path.dirname(output)]});
  return result;
}
function ensureRoots(){
  const roots=[
    [path.join(DESKTOP,"Dava Dosyaları"),"Dava Dosyaları"],
    [path.join(DESKTOP,"Vekaletnameler"),"Vekâletnameler"],
    [path.join(USER,"Documents"),"Belgeler"],
    [path.join(USER,"Downloads"),"İndirilenler"]
  ];
  const q=db.prepare("INSERT OR IGNORE INTO scan_roots(path,label,enabled) VALUES(?,?,1)");
  for(const r of roots) if(fs.existsSync(r[0])) q.run(r[0],r[1]);
}
function suggestClient(file,clients){
  const f=nrm(path.basename(file)); let best=null,score=0;
  for(const c of clients){
    const nm=nrm(c.display_name),tokens=nm.split(" ").filter(t=>t.length>2);
    let s=nm&&f.includes(nm)?100:(tokens.length?tokens.filter(t=>f.includes(t)).length/tokens.length*80:0);
    if(s>score&&s>=55){best=c;score=s}
  }
  return best;
}
function verifiedArchiveLinks(){
  return db.prepare(`SELECT l.office_file_id,f.root_path,f.relative_path FROM archive_case_links l
    JOIN archive_folders f ON f.id=l.archive_folder_id WHERE l.status='verified'`).all()
    .map(x=>({...x,abs:path.join(x.root_path,x.relative_path).toLowerCase()}));
}
function suggestedOfficeFile(file,links){
  const f=String(file||"").toLowerCase();
  const hits=links.filter(x=>f===x.abs||f.startsWith(x.abs+path.sep)).sort((a,b)=>b.abs.length-a.abs.length);
  return hits[0]?.office_file_id||null;
}
async function scanDocuments(payload){
  ensureRoots(); payload=payload||{};
  let roots=payload.roots;
  if(!roots||!roots.length) roots=db.prepare("SELECT path FROM scan_roots WHERE enabled=1").all().map(r=>r.path);
  const clients=db.prepare("SELECT id,display_name FROM clients").all();
  const archiveLinks=verifiedArchiveLinks();
  const assetUp=db.prepare("INSERT INTO local_assets(sha256,file_name,extension,size_bytes,mime_hint,suggested_client_id,suggested_office_file_id,classification,last_seen_at) VALUES(?,?,?,?,?,?,?,?,datetime('now')) ON CONFLICT(sha256) DO UPDATE SET last_seen_at=datetime('now'),file_name=excluded.file_name,size_bytes=excluded.size_bytes,suggested_client_id=COALESCE(local_assets.suggested_client_id,excluded.suggested_client_id),suggested_office_file_id=COALESCE(local_assets.suggested_office_file_id,excluded.suggested_office_file_id),classification=COALESCE(local_assets.classification,excluded.classification)");
  const locUp=db.prepare("INSERT INTO asset_locations(asset_id,local_path,source_root,last_seen_at) VALUES(?,?,?,datetime('now')) ON CONFLICT(local_path) DO UPDATE SET asset_id=excluded.asset_id,last_seen_at=datetime('now'),source_root=excluded.source_root");
  const idxUp=db.prepare("INSERT INTO search_index(entity_type,entity_id,title,subtitle,body,normalized_text,updated_at) VALUES('asset',?,?,?,?,?,datetime('now')) ON CONFLICT(entity_type,entity_id) DO UPDATE SET title=excluded.title,subtitle=excluded.subtitle,body=excluded.body,normalized_text=excluded.normalized_text,updated_at=datetime('now')");
  let filesSeen=0,newAssets=0,newLocations=0,duplicates=0;
  for(const root of roots){
    for(const file of walk(root,[])){
      filesSeen++;
      let st; try{st=fs.statSync(file)}catch{continue}
      if(isUyapPortalLoginFile(file)){
        try{fs.unlinkSync(file)}catch{}
        db.prepare("DELETE FROM asset_locations WHERE local_path=?").run(file);
        continue;
      }
      const sha=await hashFile(file);
      const before=db.prepare("SELECT id FROM local_assets WHERE sha256=?").get(sha);
      const client=suggestClient(file,clients);
      const officeFileId=suggestedOfficeFile(file,archiveLinks);
      assetUp.run(sha,path.basename(file),path.extname(file).toLowerCase(),st.size,null,client?client.id:null,officeFileId,classify(file));
      const asset=db.prepare("SELECT id FROM local_assets WHERE sha256=?").get(sha);
      if(before)duplicates++; else {newAssets++;enqueueArchiveConversion(file);}
      const oldLoc=db.prepare("SELECT id FROM asset_locations WHERE local_path=?").get(file);
      locUp.run(asset.id,file,root); if(!oldLoc)newLocations++;
      const subtitle=[classify(file),client?client.display_name:null].filter(Boolean).join(" · ");
      idxUp.run(String(asset.id),path.basename(file),subtitle,file,nrm(path.basename(file)+" "+subtitle+" "+file));
    }
    db.prepare("UPDATE scan_roots SET last_scanned_at=datetime('now') WHERE path=?").run(root);
  }
  return {roots:roots.length,filesSeen,newAssets,newLocations,duplicates};
}
function rebuildSearch(){
  db.prepare("DELETE FROM search_index").run();
  const ins=db.prepare("INSERT OR REPLACE INTO search_index(entity_type,entity_id,title,subtitle,body,normalized_text,updated_at) VALUES(?,?,?,?,?,?,datetime('now'))");
  const put=(type,id,title,subtitle,body)=>ins.run(type,String(id),title||"",subtitle||"",body||"",nrm([title,subtitle,body].filter(Boolean).join(" ")));
  for(const r of db.prepare("SELECT * FROM clients").all()) put("client",r.id,r.display_name,"Müvekkil",[r.phone,r.email,r.notes].filter(Boolean).join(" "));
  for(const r of db.prepare("SELECT p.*,c.display_name client_name FROM powers_of_attorney p JOIN clients c ON c.id=p.client_id").all()) put("power",r.id,r.client_name+" vekâlet","Vekâlet",[r.notary,r.journal_no,r.issued_at,r.status].filter(Boolean).join(" "));
  for(const r of db.prepare("SELECT * FROM office_files").all()) put("office_file",r.id,(r.file_no?r.file_no+" · ":"")+r.title,"Föy",[r.status,r.notes].filter(Boolean).join(" "));
  for(const r of db.prepare("SELECT * FROM cases").all()) put("case",r.id,[r.court,r.court_file_no].filter(Boolean).join(" · "),"UYAP Dosyası",[r.case_type,r.client_name,r.office_file_no].filter(Boolean).join(" "));
  for(const r of db.prepare("SELECT * FROM tasks").all()) put("task",r.id,r.title,"Görev",[r.description,r.due_at,r.status].filter(Boolean).join(" "));
  for(const r of db.prepare("SELECT * FROM deadlines").all()) put("deadline",r.id,r.title,"Süre",[r.legal_basis,r.due_at,r.status,r.confidence].filter(Boolean).join(" "));
  for(const r of db.prepare("SELECT a.*,GROUP_CONCAT(l.local_path,' | ') paths,MAX(da.raw_text) raw_text FROM local_assets a LEFT JOIN asset_locations l ON l.asset_id=a.id LEFT JOIN document_analysis da ON da.asset_id=a.id GROUP BY a.id").all())
    put("asset",r.id,r.file_name,r.classification||"Belge",[r.paths,r.raw_text?String(r.raw_text).slice(0,20000):null].filter(Boolean).join(" "));
  for(const r of db.prepare("SELECT * FROM drafts").all())
    put("draft",r.id,r.title,"Taslak · "+r.draft_type,[r.content_text,r.content_md,r.status].filter(Boolean).join(" "));
  for(const r of db.prepare("SELECT * FROM notes").all())
    put("note",r.id,r.title||"Not","Not",r.body||"");
  for(const r of db.prepare("SELECT fc.*,c.display_name client_name FROM fee_contracts fc JOIN clients c ON c.id=fc.client_id").all())
    put("fee_contract",r.id,r.title,"Avukatlık Sözleşmesi · "+r.client_name,[r.payment_terms,r.notes,r.total_fee,r.currency].filter(Boolean).join(" "));
  for(const r of db.prepare("SELECT * FROM communications").all())
    put("communication",r.id,r.subject||r.channel,"İletişim · "+r.channel,[r.body,r.direction,r.occurred_at].filter(Boolean).join(" "));
  return {indexed:db.prepare("SELECT COUNT(*) n FROM search_index").get().n};
}
function backupDb(){
  fs.mkdirSync(BACKUPS,{recursive:true});
  try{db.exec("PRAGMA wal_checkpoint(FULL)")}catch{}
  const stamp=new Date().toISOString().replace(/[-:]/g,"").replace(/\..+/,"").replace("T","_");
  const dest=path.join(BACKUPS,"bono_"+stamp+".db");
  fs.copyFileSync(path.join(DATA,"bono.db"),dest);
  const list=fs.readdirSync(BACKUPS).filter(f=>/^bono_\d/.test(f)&&f.endsWith(".db")).map(f=>({f,t:fs.statSync(path.join(BACKUPS,f)).mtimeMs})).sort((a,b)=>b.t-a.t);
  for(const old of list.slice(30)){try{fs.unlinkSync(path.join(BACKUPS,old.f))}catch{}}
  return {file:dest,kept:Math.min(list.length,30)};
}
function runPython(script,args=[]){
  return new Promise((resolve,reject)=>{
    execFile("py",["-3",path.join(ROOT,"scripts",script),...args],{cwd:ROOT,windowsHide:true,maxBuffer:50*1024*1024},(err,stdout,stderr)=>{
      if(err)return reject(new Error(stderr||err.message));
      const line=String(stdout||"").trim().split(/\r?\n/).filter(Boolean).pop()||"{}";
      try{resolve(JSON.parse(line))}catch{resolve({output:String(stdout||"").trim()})}
    });
  });
}
function parseTryAmount(text,label=""){
  const lines=String(text||"").replace(/\r/g,"").split("\n").map(x=>x.replace(/\s+/g," ").trim()).filter(Boolean);
  const candidates=[];
  for(const line of lines){
    const hits=[...line.matchAll(/(?:₺|TL\s*)?((?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d{2})?)(?:\s*(?:TL|₺))?/gi)];
    for(const m of hits){
      const raw=m[1],hasMoney=/TL|₺/i.test(m[0]),ctx=nrm(line);
      if(!hasMoney&&!/(tutar|toplam|tahsil|reddiyat|odeme|ödenen|oden(en)?)/.test(ctx))continue;
      if(!hasMoney&&!/[.,]/.test(raw))continue;
      const value=Number(raw.replace(/\./g,"").replace(",","."));
      if(!Number.isFinite(value)||value<=0||value>1000000000)continue;
      const explicit=/\b(tutari|tutar|toplam|toplam tutar)\b/.test(ctx);
      let score=hasMoney?3:0;
      if(explicit)score+=6;
      if(/tahsil|reddiyat|odeme|ödenen|odenen/.test(ctx))score+=2;
      candidates.push({value,raw,line,score,explicit});
    }
  }
  const explicit=candidates.filter(x=>x.explicit).sort((a,b)=>b.score-a.score||b.value-a.value);
  if(explicit.length)return explicit[0];
  const unique=[...new Map(candidates.map(x=>[x.value,x])).values()];
  if(unique.length===1)return unique[0];
  if(/\bfis\b/.test(nrm(label)))return null;
  return null;
}
function parseDocDate(text,fallback=null){
  if(fallback)return String(fallback).slice(0,10);
  const m=String(text||"").match(/\b([0-3]?\d)[.\/-]([01]?\d)[.\/-]((?:19|20)\d{2})\b/);
  if(!m)return null;
  const dd=String(m[1]).padStart(2,"0"),mm=String(m[2]).padStart(2,"0");
  return m[3]+"-"+mm+"-"+dd;
}
function processUyapAccountingDocuments(){
  const rows=db.prepare(`SELECT rd.id remote_id,rd.case_id,rd.remote_title,rd.document_type,rd.document_date,rd.original_file_name,
      rd.staging_path,rd.local_asset_id,c.office_file_id,a.file_name,da.raw_text
    FROM uyap_remote_documents rd
    JOIN cases c ON c.id=rd.case_id
    JOIN local_assets a ON a.id=rd.local_asset_id
    JOIN document_analysis da ON da.asset_id=a.id
    WHERE rd.status='indexed' AND COALESCE(da.raw_text,'')!=''`).all();
  let matched=0,noted=0,purged=0,skipped=0;
  for(const r of rows){
    const label=nrm([r.remote_title,r.document_type,r.original_file_name,r.file_name].filter(Boolean).join(" "));
    const kind=label.includes("reddiyat")?"reddiyat":
      (label.includes("tahsilat")||label.includes("tahsil makbuz")||label.includes("tahsil makbuzu"))?"tahsilat":null;
    if(!kind)continue;
    matched++;
    const amount=parseTryAmount(r.raw_text,label);
    if(!amount){skipped++;continue}
    const date=parseDocDate(r.raw_text,r.document_date);
    const title=kind==="reddiyat"?"Reddiyat Özeti":"Tahsilat Özeti";
    const sourceName=r.original_file_name||r.remote_title||r.file_name||"UYAP evrakı";
    const marker="Kaynak UYAP evrakı: #"+r.remote_id;
    const exists=db.prepare("SELECT id FROM notes WHERE case_id=? AND body LIKE ? LIMIT 1").get(r.case_id,"%"+marker+"%");
    if(!exists){
      const body=[
        "Tür: "+(kind==="reddiyat"?"Reddiyat":"Tahsilat"),
        "Tarih: "+(date||"Tespit edilemedi"),
        "Tutar: "+amount.value.toLocaleString("tr-TR",{minimumFractionDigits:2,maximumFractionDigits:2})+" TL",
        "Kaynak belge: "+sourceName,
        marker,
        "Bu not UYAP evrakından otomatik oluşturuldu; gereksiz kaynak belge işlem sonrası temizlendi."
      ].join("\n");
      db.prepare(`INSERT INTO notes(office_file_id,case_id,title,body,pinned,created_at,updated_at)
        VALUES(?,?,?,?,0,datetime('now'),datetime('now'))`).run(r.office_file_id||null,r.case_id,title,body);
      db.prepare(`INSERT OR IGNORE INTO timeline_events(office_file_id,case_id,event_type,title,occurred_at,source,source_entity_type,source_entity_id,detail_json)
        VALUES(?,?, 'financial_note', ?,COALESCE(?,datetime('now')),'UYAP','uyap_remote_document',?,?)`)
        .run(r.office_file_id||null,r.case_id,title,date?date+" 12:00:00":null,String(r.remote_id),JSON.stringify({kind,amount:amount.value,source:sourceName}));
      noted++;
    }
    const locs=db.prepare("SELECT id,local_path FROM asset_locations WHERE asset_id=?").all(r.local_asset_id);
    let removedLocation=false;
    for(const loc of locs){
      const abs=path.resolve(loc.local_path);
      const sameStaging=r.staging_path&&abs===path.resolve(r.staging_path);
      const tempUyapDownload=abs.toLowerCase().startsWith(path.join(USER,"Downloads").toLowerCase()+path.sep.toLowerCase())
        && /^BONO_UYAP_evrak_/i.test(path.basename(abs));
      if(!sameStaging&&!tempUyapDownload)continue;
      try{if(fs.existsSync(abs))fs.unlinkSync(abs)}catch{}
      db.prepare("DELETE FROM asset_locations WHERE id=?").run(loc.id);
      removedLocation=true;
    }
    try{if(r.staging_path&&fs.existsSync(r.staging_path))fs.unlinkSync(r.staging_path)}catch{}
    const remaining=db.prepare("SELECT COUNT(*) n FROM asset_locations WHERE asset_id=?").get(r.local_asset_id).n;
    db.prepare("UPDATE uyap_remote_documents SET status='summarized',local_asset_id=NULL,staging_path=NULL,last_seen_at=datetime('now') WHERE id=?").run(r.remote_id);
    if(remaining===0){
      db.prepare("DELETE FROM search_index WHERE entity_type='asset' AND entity_id=?").run(String(r.local_asset_id));
      db.prepare("DELETE FROM local_assets WHERE id=?").run(r.local_asset_id);
      purged++;
    }else if(removedLocation)purged++;
    db.prepare(`UPDATE uyap_sync_profiles SET downloaded_count=(
      SELECT COUNT(*) FROM uyap_remote_documents WHERE case_id=? AND status IN ('downloaded','indexed','filed','summarized','skipped','review','duplicate')
    ),updated_at=datetime('now') WHERE case_id=?`).run(r.case_id,r.case_id);
  }
  return {matched,noted,purged,skipped};
}
function importVekalet(){return runPython("import_vekalet.py")}
function analyzeUdfLibrary(payload={}){return runPython("index_udf_library.py",payload.limit?[String(payload.limit)]:[])}
function analyzePdfLibrary(payload={}){return runPython("index_pdf_library.py",payload.limit?[String(payload.limit)]:[])}
async function processJob(job){
  if(job.job_type==="scan_documents"){
    const result=await scanDocuments(job.payload);
    if(result.newAssets>0){
      const hour=new Date().toISOString().slice(0,13);
      jobs.enqueue("analyze_udf_library",{},"udf-after-scan:"+hour,75);
      jobs.enqueue("analyze_pdf_library",{},"pdf-after-scan:"+hour,75);
      jobs.enqueue("rebuild_search",{},"search-after-scan:"+hour,76);
    }
    return result;
  }
  if(job.job_type==="ingest_uyap_download"){
    const x=uyap.ingestDownloadedDocument(Number(job.payload.commandId));
    if(x?.invalidDownload)return x;
    if(x?.stagingPath&&isUyapPortalLoginFile(x.stagingPath)){
      try{if(fs.existsSync(x.stagingPath))fs.unlinkSync(x.stagingPath)}catch{}
      db.prepare("DELETE FROM asset_locations WHERE local_path=?").run(x.stagingPath);
      const existing=db.prepare("SELECT local_asset_id FROM uyap_remote_documents WHERE id=?").get(x.remoteDocumentId);
      if(existing?.local_asset_id){
        db.prepare("UPDATE uyap_remote_documents SET staging_path=NULL,last_seen_at=datetime('now') WHERE id=?").run(x.remoteDocumentId);
      }else{
        db.prepare("UPDATE uyap_remote_documents SET staging_path=NULL,remote_hash=NULL,status='discovered',last_seen_at=datetime('now') WHERE id=?").run(x.remoteDocumentId);
      }
      uyap.setDocumentDownloadState("paused_viewer_html","uyap_portal_login_html_worker_guard");
      return {...x,invalidDownload:true,reason:"uyap_portal_login_html_worker_guard"};
    }
    const remote=db.prepare("SELECT * FROM uyap_remote_documents WHERE id=?").get(x.remoteDocumentId)||{};
    const ext=path.extname(x.stagingPath||"").toLowerCase();

    if(ext===".zip"||ext===".eyp"){
      const packed=await archiveContainerMembers(x.stagingPath,x.caseId,job.payload.commandId);
      const fullyHandled=(packed.unresolved||0)===0&&packed.errors.length===0;
      if(!fullyHandled){
        const scan=await scanDocuments({roots:[path.dirname(x.stagingPath)]});
        const loc=db.prepare("SELECT asset_id FROM asset_locations WHERE local_path=?").get(x.stagingPath);
        if(loc)db.prepare("UPDATE uyap_remote_documents SET local_asset_id=?,status='indexed',last_seen_at=datetime('now'),metadata_json=? WHERE id=?")
          .run(loc.asset_id,JSON.stringify({container:true,pendingArchive:true,members:packed.archived.length,duplicates:packed.duplicates,unresolved:packed.unresolved||0,errors:packed.errors}),x.remoteDocumentId);
        uyap.enqueuePendingDownloads(x.caseId);
        return {...x,...scan,container:true,preserved:true,archivedMembers:packed.archived.length,duplicates:packed.duplicates,unresolved:packed.unresolved||0,errors:packed.errors};
      }
      try{if(fs.existsSync(x.stagingPath))fs.unlinkSync(x.stagingPath)}catch{}
      const childUp=db.prepare(`INSERT INTO uyap_remote_documents(
        case_id,remote_document_id,remote_title,document_type,document_date,original_file_name,remote_hash,
        local_asset_id,filed_path,status,first_seen_at,last_seen_at,downloaded_at,filed_at,is_baseline,metadata_json
      ) VALUES(?,?,?,?,?,?,?,?,?,'filed',datetime('now'),datetime('now'),datetime('now'),datetime('now'),0,?)
      ON CONFLICT(case_id,remote_document_id) DO UPDATE SET
        remote_title=excluded.remote_title,document_type=excluded.document_type,remote_hash=excluded.remote_hash,
        local_asset_id=excluded.local_asset_id,filed_path=excluded.filed_path,status='filed',last_seen_at=datetime('now'),filed_at=datetime('now')`);
      for(const saved of packed.archived){
        if(!saved.assetId)continue;
        const a=db.prepare("SELECT sha256,file_name,classification FROM local_assets WHERE id=?").get(saved.assetId);
        if(!a)continue;
        const childKey="container:"+x.remoteDocumentId+":"+String(a.sha256||saved.assetId).slice(0,24);
        childUp.run(x.caseId,childKey,path.basename(saved.path||a.file_name),a.classification||classify(a.file_name),remote.document_date||null,
          a.file_name,a.sha256||null,saved.assetId,saved.path||null,JSON.stringify({derivedFrom:x.remoteDocumentId,containerType:ext,dedup:!!saved.dedup}));
      }
      db.prepare("UPDATE uyap_remote_documents SET local_asset_id=NULL,status=?,staging_path=NULL,filed_path=NULL,metadata_json=?,last_seen_at=datetime('now'),filed_at=datetime('now') WHERE id=?")
        .run(packed.archived.length?'filed':'skipped',JSON.stringify({container:true,members:packed.archived.length,duplicates:packed.duplicates,skipped:packed.skipped.length,unresolved:0,errors:[]}),x.remoteDocumentId);
      if(packed.archived.some(a=>path.extname(a.path||"").toLowerCase()===".udf"))jobs.enqueue("analyze_udf_library",{},"uyap-pack-udf:"+job.payload.commandId,25);
      if(packed.archived.some(a=>path.extname(a.path||"").toLowerCase()===".pdf"))jobs.enqueue("analyze_pdf_library",{},"uyap-pack-pdf:"+job.payload.commandId,25);
      jobs.enqueue("rebuild_search",{},"uyap-pack-search:"+job.payload.commandId,30);
      uyap.enqueuePendingDownloads(x.caseId);
      return {...x,container:true,archivedMembers:packed.archived.length,duplicates:packed.duplicates,skipped:packed.skipped.length,errors:[]};
    }

    let archived=null;
    if(shouldArchiveRemote(remote,x.stagingPath)){
      archived=await archiveWithFormatPolicy(x.stagingPath,x.caseId,preferredArchiveName(remote,x.stagingPath),remote.original_file_name||remote.remote_title||null);
    }
    let scan={roots:0,filesSeen:0,newAssets:0,newLocations:0,duplicates:0},loc=null;
    if(archived?.archived&&archived.assetId){
      loc={asset_id:archived.assetId};
      db.prepare("UPDATE uyap_remote_documents SET local_asset_id=?,filed_path=?,status='filed',staging_path=NULL,filed_at=datetime('now'),last_seen_at=datetime('now') WHERE id=?")
        .run(loc.asset_id,archived.path||null,x.remoteDocumentId);
    }else{
      scan=await scanDocuments({roots:[path.dirname(x.stagingPath)]});
      loc=db.prepare("SELECT asset_id FROM asset_locations WHERE local_path=?").get(x.stagingPath);
      if(loc)db.prepare("UPDATE uyap_remote_documents SET local_asset_id=?,status='indexed',last_seen_at=datetime('now') WHERE id=?").run(loc.asset_id,x.remoteDocumentId);
    }
    if(loc){
      if(remote?.stable_key) db.prepare("UPDATE uyap_remote_documents SET local_asset_id=?,remote_hash=?,status='indexed',last_seen_at=datetime('now') WHERE case_id=? AND stable_key=? AND local_asset_id IS NULL")
        .run(loc.asset_id,x.sha256||null,remote.case_id,remote.stable_key);
      const actualPath=archived?.path||x.stagingPath;
      const actualExt=path.extname(actualPath||"").toLowerCase();
      if(actualExt===".udf")jobs.enqueue("analyze_udf_library",{},"uyap-udf:"+job.payload.commandId,25);
      else if(actualExt===".pdf")jobs.enqueue("analyze_pdf_library",{},"uyap-pdf:"+job.payload.commandId,25);
      jobs.enqueue("process_uyap_accounting_documents",{},"uyap-accounting:"+job.payload.commandId,28);
      jobs.enqueue("rebuild_search",{},"uyap-search:"+job.payload.commandId,30);
      if(x.sourcePath&&/^BONO_UYAP_/i.test(path.basename(x.sourcePath))){
        try{if(fs.existsSync(x.sourcePath))fs.unlinkSync(x.sourcePath)}catch{}
      }
      uyap.enqueuePendingDownloads(x.caseId);
    }
    return {...x,...scan,localAssetId:loc?.asset_id||null,archived:!!archived?.archived,dedup:!!archived?.dedup,archivePath:archived?.path||null};
  }
  if(job.job_type==="process_uyap_accounting_documents") return processUyapAccountingDocuments();
  if(job.job_type==="rebuild_search") return rebuildSearch();
  if(job.job_type==="backup_db") return backupDb();
  if(job.job_type==="import_vekalet") return await importVekalet();
  if(job.job_type==="analyze_udf_library"){const result=await analyzeUdfLibrary(job.payload||{});const hour=new Date().toISOString().slice(0,13);jobs.enqueue("scan_interim_orders",{},"orders-after-analysis:"+hour,78);jobs.enqueue("scan_notification_documents",{},"notices-after-analysis:"+hour,79);jobs.enqueue("scan_correspondence_matches",{},"corr-match-after-analysis:"+hour,80);return result;}
  if(job.job_type==="analyze_pdf_library"){const result=await analyzePdfLibrary(job.payload||{});const hour=new Date().toISOString().slice(0,13);jobs.enqueue("scan_interim_orders",{},"orders-after-pdf:"+hour,78);jobs.enqueue("scan_notification_documents",{},"notices-after-pdf:"+hour,79);jobs.enqueue("scan_correspondence_matches",{},"corr-match-after-pdf:"+hour,80);return result;}
  if(job.job_type==="scan_case_archive") return v05.scanArchive();
  if(job.job_type==="expand_archive_containers") return await expandArchiveContainers();
  if(job.job_type==="archive_existing_uyap") return await archiveExistingUyapDocuments(Number(job.payload?.limit||100));
  if(job.job_type==="convert_archive_format") return await convertArchiveFormat(job.payload||{});
  if(job.job_type==="run_workflow") return workflow.run(Number(job.payload.runId));
  if(job.job_type==="dispatch_domain_event") return eventBus.dispatch(Number(job.payload.eventId));
  if(job.job_type==="uyap_delta_watch") return eventBus.scheduleDeltaChecks();
  if(job.job_type==="scan_interim_orders") return v09.scanInterimOrders(job.payload||{});
  if(job.job_type==="scan_correspondence_matches") return v09.scanCorrespondenceMatches(job.payload||{});
  if(job.job_type==="scan_notification_documents") return v09.scanNotifications(job.payload||{});
  if(job.job_type==="create_checkpoint") return v09.createCheckpoint(job.payload?.label||"Otomatik geri dönüş noktası");
  throw new Error("Bilinmeyen job: "+job.job_type);
}
function maintenance(){
  const now=new Date().toISOString();
  jobs.enqueue("backup_db",{},"daily-backup:"+now.slice(0,10),20);
  jobs.enqueue("scan_documents",{},"auto-scan:"+now.slice(0,13),70);
  jobs.enqueue("scan_case_archive",{},"archive-scan:"+now.slice(0,10),80);
  jobs.enqueue("expand_archive_containers",{},"archive-containers:"+now.slice(0,13),81);
  jobs.enqueue("archive_existing_uyap",{limit:100},"archive-existing-uyap:"+now.slice(0,13),81);
  jobs.enqueue("scan_interim_orders",{},"daily-order-scan:"+now.slice(0,10),82);
  jobs.enqueue("scan_notification_documents",{},"daily-notice-scan:"+now.slice(0,10),83);
  jobs.enqueue("scan_correspondence_matches",{},"daily-corr-match:"+now.slice(0,10),84);
  jobs.enqueue("process_uyap_accounting_documents",{},"accounting-scan:"+now.slice(0,13),77);
  const uyapCases=db.prepare("SELECT DISTINCT case_id FROM uyap_remote_documents WHERE local_asset_id IS NULL AND status='discovered' LIMIT 100").all();
  for(const r of uyapCases){try{uyap.enqueuePendingDownloads(r.case_id)}catch{}}
  workflow.dueSchedules(new Date());
  jobs.enqueue("uyap_delta_watch",{},"uyap-delta-watch:"+now.slice(0,16),30);
}
async function loop(){
  maintenance();
  v04.setHeartbeat("worker","ok",{pid:process.pid});
  setInterval(()=>v04.setHeartbeat("worker","ok",{pid:process.pid}),30000);
  setInterval(maintenance,15*60*1000);
  while(true){
    const job=jobs.claim();
    if(!job){await new Promise(r=>setTimeout(r,1200));continue}
    try{jobs.complete(job.id,await processJob(job))}catch(e){jobs.fail(job.id,e)}
  }
}
process.on("uncaughtException",e=>console.error("worker uncaught",e));
process.on("unhandledRejection",e=>console.error("worker rejection",e));
loop();
