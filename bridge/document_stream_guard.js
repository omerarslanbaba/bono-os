"use strict";

const fs=require("fs");
const path=require("path");
const crypto=require("crypto");

function asPositiveInt(value){
  const n=Number(value);
  return Number.isSafeInteger(n)&&n>0?n:null;
}
function samePath(a,b){
  if(!a||!b)return false;
  const left=path.resolve(a),right=path.resolve(b);
  return process.platform==="win32"?left.toLowerCase()===right.toLowerCase():left===right;
}
function hashFd(fd){
  const h=crypto.createHash("sha256"),buf=Buffer.allocUnsafe(1024*1024);
  let pos=0;
  while(true){
    const n=fs.readSync(fd,buf,0,buf.length,pos);
    if(!n)break;
    h.update(buf.subarray(0,n));
    pos+=n;
  }
  return h.digest("hex");
}
function hasSymlinkComponent(file){
  const resolved=path.resolve(file),parsed=path.parse(resolved);
  let current=parsed.root;
  const tail=resolved.slice(parsed.root.length).split(path.sep).filter(Boolean);
  for(const part of tail){
    current=path.join(current,part);
    const st=fs.lstatSync(current);
    if(st.isSymbolicLink())return true;
  }
  return false;
}
function canonicalCandidate(row){
  for(const value of [row.filed_path,row.archive_path]){
    if(value&&path.isAbsolute(String(value))&&fs.existsSync(String(value)))return path.resolve(String(value));
  }
  const declared=row.filed_path||row.archive_path||null;
  return declared&&path.isAbsolute(String(declared))?path.resolve(String(declared)):null;
}
function loadStreamRow(db,caseId,remoteDocumentDbId){
  return db.prepare(`SELECT
    rd.id remote_db_id,rd.case_id,rd.remote_document_id,rd.original_file_name,rd.remote_title,rd.remote_hash,rd.local_asset_id asset_id,rd.filed_path,
    a.sha256,a.archive_path,a.file_name
    FROM uyap_remote_documents rd
    JOIN cases c ON c.id=rd.case_id
    LEFT JOIN local_assets a ON a.id=rd.local_asset_id
    WHERE rd.case_id=? AND rd.id=?`).get(caseId,remoteDocumentDbId);
}
function openVerifiedDocumentContent(db,caseIdValue,remoteDocumentDbIdValue){
  const caseId=asPositiveInt(caseIdValue),remoteDocumentDbId=asPositiveInt(remoteDocumentDbIdValue);
  if(!caseId||!remoteDocumentDbId)return {ok:false,statusCode:404,error:"document_not_found_in_case"};
  const row=loadStreamRow(db,caseId,remoteDocumentDbId);
  if(!row)return {ok:false,statusCode:404,error:"document_not_found_in_case"};
  if(!row.asset_id)return {ok:false,statusCode:409,error:"canonical_asset_not_indexed"};
  const file=canonicalCandidate(row);
  if(!file)return {ok:false,statusCode:409,error:"canonical_file_missing"};
  if(!fs.existsSync(file))return {ok:false,statusCode:409,error:"canonical_file_missing"};
  const locations=db.prepare("SELECT local_path FROM asset_locations WHERE asset_id=? ORDER BY id").all(row.asset_id);
  if(!locations.some(x=>samePath(x.local_path,file))){
    return {ok:false,statusCode:409,error:"canonical_asset_location_mismatch"};
  }
  const expected=String(row.sha256||row.remote_hash||"").toLowerCase();
  if(!expected)return {ok:false,statusCode:412,error:"canonical_hash_not_verified",reason:"missing_expected_sha256"};
  let fd=null;
  try{
    if(hasSymlinkComponent(file))return {ok:false,statusCode:409,error:"canonical_symlink_rejected"};
    const flags=fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0);
    fd=fs.openSync(file,flags);
    const st=fs.fstatSync(fd);
    if(!st.isFile())throw Object.assign(new Error("canonical_not_regular_file"),{code:"BONO_NOT_FILE"});
    if(hasSymlinkComponent(file))throw Object.assign(new Error("canonical_symlink_rejected"),{code:"BONO_SYMLINK"});
    const actual=hashFd(fd);
    if(actual!==expected){
      fs.closeSync(fd);fd=null;
      return {ok:false,statusCode:412,error:"canonical_hash_not_verified",reason:"sha256_mismatch",actualSha256:actual,expectedSha256:expected};
    }
    const ext=path.extname(file).toLowerCase();
    const contentType=ext===".pdf"?"application/pdf":ext===".udf"?"application/octet-stream":({".jpg":"image/jpeg",".jpeg":"image/jpeg",".png":"image/png",".tif":"image/tiff",".tiff":"image/tiff",".txt":"text/plain; charset=utf-8",".html":"text/html; charset=utf-8",".htm":"text/html; charset=utf-8"})[ext]||"application/octet-stream";
    const disposition=ext===".pdf"||[".jpg",".jpeg",".png"].includes(ext)?"inline":"attachment";
    return {
      ok:true,statusCode:200,fd,path:file,size:Number(st.size),caseId,remoteDocumentDbId,assetId:row.asset_id,
      fileName:path.basename(file),originalFileName:row.original_file_name||row.file_name||path.basename(file),
      contentType,disposition,verifiedSha256:actual
    };
  }catch(err){
    if(fd!=null){try{fs.closeSync(fd)}catch{}}
    if(err?.code==="ELOOP"||err?.code==="BONO_SYMLINK")return {ok:false,statusCode:409,error:"canonical_symlink_rejected"};
    if(err?.code==="ENOENT")return {ok:false,statusCode:409,error:"canonical_file_missing"};
    if(err?.code==="BONO_NOT_FILE")return {ok:false,statusCode:409,error:"canonical_not_regular_file"};
    return {ok:false,statusCode:409,error:"canonical_open_failed",reason:String(err?.message||err)};
  }
}

module.exports={asPositiveInt,samePath,hashFd,hasSymlinkComponent,openVerifiedDocumentContent};
