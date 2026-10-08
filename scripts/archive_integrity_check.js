"use strict";

const fs=require("fs");
const path=require("path");
const crypto=require("crypto");
const {DatabaseSync}=require("node:sqlite");

function argValue(name,fallback=null){const i=process.argv.indexOf(name);return i>=0&&process.argv[i+1]?process.argv[i+1]:fallback}
const has=(name)=>process.argv.includes(name);
const USER=process.env.USERPROFILE||process.env.HOME||"";
const ROOT=path.resolve(__dirname,"..");
const DB_PATH=path.resolve(argValue("--db",process.env.BONO_DB_PATH||path.join(ROOT,"data","bono.db")));
const ARCHIVE_ROOT=path.resolve(argValue("--archive-root",process.env.BONO_ARCHIVE_ROOT||path.join(USER,"OneDrive","Masaüstü","Dava Dosyaları")));
const VEKALET_ROOT=path.resolve(argValue("--vekalet-root",process.env.BONO_VEKALET_ROOT||path.join(USER,"OneDrive","Masaüstü","Vekaletnameler")));
const DOWNLOADS_ROOT=path.resolve(argValue("--downloads-root",process.env.BONO_DOWNLOADS_ROOT||path.join(USER,"Downloads")));
const CHECK_HASHES=has("--hash");

function exists(p){try{return !!p&&fs.existsSync(p)}catch{return false}}
function inside(p,root){if(!p||!root)return false;try{const a=path.resolve(p).toLowerCase(),b=path.resolve(root).toLowerCase();return a===b||a.startsWith(b+path.sep.toLowerCase())}catch{return false}}
function walk(dir,out=[]){let entries=[];try{entries=fs.readdirSync(dir,{withFileTypes:true})}catch{return out}for(const e of entries){const p=path.join(dir,e.name);if(e.isDirectory())walk(p,out);else if(e.isFile())out.push(p)}return out}
function sha256(file){const h=crypto.createHash("sha256"),fd=fs.openSync(file,"r"),buf=Buffer.allocUnsafe(1024*1024);try{let n=0,pos=0;do{n=fs.readSync(fd,buf,0,buf.length,pos);if(n){h.update(buf.subarray(0,n));pos+=n}}while(n)}finally{fs.closeSync(fd)}return h.digest("hex")}
function portalLoginFile(file){try{const fd=fs.openSync(file,"r"),buf=Buffer.alloc(4096),n=fs.readSync(fd,buf,0,buf.length,0);fs.closeSync(fd);const s=buf.subarray(0,n).toString("utf8").toLowerCase();return s.includes("uyap avukat bilgi sistemi")&&(s.includes("avukat portal giriş sayfası")||s.includes('<div id="root"></div>'))}catch{return false}}
function safeAll(db,sql,...args){try{return db.prepare(sql).all(...args)}catch{return []}}
function safeGet(db,sql,...args){try{return db.prepare(sql).get(...args)}catch{return null}}

if(!exists(DB_PATH)){console.error(JSON.stringify({ok:false,error:"db_missing",dbPath:DB_PATH},null,2));process.exit(2)}
const db=new DatabaseSync(DB_PATH,{readOnly:true});
const findings=[];
const add=(severity,type,detail)=>findings.push({severity,type,...detail});
const archiveFiles=exists(ARCHIVE_ROOT)?walk(ARCHIVE_ROOT,[]):[];
const extCounts={};for(const p of archiveFiles){const e=path.extname(p).toLowerCase()||"(none)";extCounts[e]=(extCounts[e]||0)+1}

const filedRows=safeAll(db,"SELECT rd.id,rd.case_id,rd.remote_title,rd.status,rd.filed_path,rd.staging_path,rd.local_asset_id,c.office_file_id,c.court,c.court_file_no,c.client_name FROM uyap_remote_documents rd LEFT JOIN cases c ON c.id=rd.case_id WHERE rd.filed_path IS NOT NULL");
for(const r of filedRows){
  if(!exists(r.filed_path)){add("critical","filed_path_missing",{remoteDocumentId:r.id,caseId:r.case_id,path:r.filed_path,title:r.remote_title});continue}
  if(!inside(r.filed_path,ARCHIVE_ROOT)){
    if(inside(r.filed_path,VEKALET_ROOT))add("info","filed_path_central_vekalet",{remoteDocumentId:r.id,caseId:r.case_id,path:r.filed_path});
    else if(inside(r.filed_path,DOWNLOADS_ROOT))add("warning","filed_path_in_downloads",{remoteDocumentId:r.id,caseId:r.case_id,path:r.filed_path,title:r.remote_title});
    else add("warning","filed_path_outside_archive",{remoteDocumentId:r.id,caseId:r.case_id,path:r.filed_path,title:r.remote_title});
  }
  if(portalLoginFile(r.filed_path))add("critical","portal_login_html_filed",{remoteDocumentId:r.id,caseId:r.case_id,path:r.filed_path});
}

const stagingRows=safeAll(db,"SELECT id,case_id,remote_title,status,staging_path,local_asset_id FROM uyap_remote_documents WHERE staging_path IS NOT NULL");
for(const r of stagingRows){if(!exists(r.staging_path))add("critical","staging_path_missing",{remoteDocumentId:r.id,caseId:r.case_id,path:r.staging_path,title:r.remote_title});else if(portalLoginFile(r.staging_path))add("critical","portal_login_html_staging",{remoteDocumentId:r.id,caseId:r.case_id,path:r.staging_path})}

const assetRefs=safeAll(db,"SELECT DISTINCT local_asset_id asset_id FROM uyap_remote_documents WHERE local_asset_id IS NOT NULL");
for(const r of assetRefs){
  const locs=safeAll(db,"SELECT local_path,source_root FROM asset_locations WHERE asset_id=?",r.asset_id);
  const physical=locs.filter(x=>exists(x.local_path));
  if(!physical.length){add("critical","asset_reference_without_physical_location",{assetId:r.asset_id,locations:locs.map(x=>x.local_path)});continue}
  if(physical.length===1&&inside(physical[0].local_path,DOWNLOADS_ROOT)){const ref=safeGet(db,"SELECT COUNT(*) n FROM uyap_remote_documents WHERE local_asset_id=?",r.asset_id);add("warning","single_copy_asset_in_downloads",{assetId:r.asset_id,remoteReferences:Number(ref?.n||0),path:physical[0].local_path})}
  if(CHECK_HASHES){const asset=safeGet(db,"SELECT sha256 FROM local_assets WHERE id=?",r.asset_id);if(asset?.sha256){for(const loc of physical){const got=sha256(loc.local_path);if(got!==String(asset.sha256).toLowerCase())add("critical","asset_hash_mismatch",{assetId:r.asset_id,path:loc.local_path,expected:asset.sha256,actual:got})}}}
}

const suspicious=safeAll(db,"SELECT id,case_id,remote_title,status FROM uyap_remote_documents WHERE status IN (\'downloaded\',\'indexed\',\'filed\') AND local_asset_id IS NULL AND filed_path IS NULL AND staging_path IS NULL");
for(const r of suspicious)add("critical","remote_status_without_physical_reference",{remoteDocumentId:r.id,caseId:r.case_id,status:r.status,title:r.remote_title});

const ambiguous=safeAll(db,"SELECT case_id,COUNT(*) n,MAX(confidence) max_confidence FROM archive_case_links WHERE status!=\'verified\' GROUP BY case_id HAVING COUNT(*)>1 ORDER BY n DESC");
for(const r of ambiguous){const links=safeAll(db,"SELECT l.status,l.confidence,f.relative_path,f.folder_name FROM archive_case_links l JOIN archive_folders f ON f.id=l.archive_folder_id WHERE l.case_id=? ORDER BY l.confidence DESC,l.id",r.case_id);add("warning","ambiguous_archive_links",{caseId:r.case_id,candidates:links})}

const containers=archiveFiles.filter(p=>[".zip",".eyp"].includes(path.extname(p).toLowerCase()));
for(const p of containers)add("warning","container_left_in_archive",{path:p});
for(const p of archiveFiles){if(portalLoginFile(p))add("critical","portal_login_html_in_archive",{path:p})}

const remoteStatus=safeAll(db,"SELECT status,COUNT(*) n FROM uyap_remote_documents GROUP BY status ORDER BY n DESC");
const critical=findings.filter(x=>x.severity==="critical").length;
const warnings=findings.filter(x=>x.severity==="warning").length;
const info=findings.filter(x=>x.severity==="info").length;
const result={ok:critical===0,readOnly:true,generatedAt:new Date().toISOString(),paths:{db:DB_PATH,archiveRoot:ARCHIVE_ROOT,vekaletRoot:VEKALET_ROOT,downloadsRoot:DOWNLOADS_ROOT},summary:{archiveFiles:archiveFiles.length,extensionCounts:extCounts,filedRows:filedRows.length,stagingRows:stagingRows.length,assetRefs:assetRefs.length,containersInArchive:containers.length,critical,warnings,info,hashCheck:CHECK_HASHES},remoteStatus,findings};
console.log(JSON.stringify(result,null,2));
if(has("--strict")&&(critical||warnings))process.exitCode=1;else if(critical)process.exitCode=2;
