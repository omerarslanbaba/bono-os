"use strict";

const fs=require("fs");
const os=require("os");
const path=require("path");
const crypto=require("crypto");
const {
  sha256File,
  copyVerified,
  copyVerifiedIntoCase
}=require("../bridge/archive_safety");

const tmp=fs.mkdtempSync(path.join(os.tmpdir(),"bono-archive-final-safety-"));
const stage=path.join(tmp,"stage");
const archiveRoot=path.join(tmp,"archive");
const caseA=path.join(archiveRoot,"Case-A");
const caseB=path.join(archiveRoot,"Case-B");
fs.mkdirSync(stage,{recursive:true});
fs.mkdirSync(caseA,{recursive:true});
fs.mkdirSync(caseB,{recursive:true});

const results=[];
const pass=(name,detail={})=>results.push({name,status:"pass",...detail});
const fail=(name,error,detail={})=>results.push({name,status:"fail",error:String(error),...detail});
function assert(name,cond,detail={}){cond?pass(name,detail):fail(name,"assertion failed",detail)}
function shaBuffer(b){return crypto.createHash("sha256").update(b).digest("hex")}
function listFiles(dir){return fs.existsSync(dir)?fs.readdirSync(dir,{withFileTypes:true}).filter(x=>x.isFile()).map(x=>x.name).sort():[]}

try{
  const original=Buffer.from("%PDF-1.4\nBONO canonical safety fixture\n");
  const src=path.join(stage,"doc.pdf");
  const dst=path.join(caseA,"doc.pdf");
  fs.writeFileSync(src,original);
  const expected=shaBuffer(original);

  const first=copyVerifiedIntoCase(src,dst,{expectedSha256:expected,caseArchiveDir:caseA});
  const beforeStat=fs.statSync(dst);
  const beforeHash=sha256File(dst);
  const second=copyVerifiedIntoCase(src,dst,{expectedSha256:expected,caseArchiveDir:caseA});
  const afterStat=fs.statSync(dst);
  const afterHash=sha256File(dst);
  assert("canonical_existing_same_hash_not_recopied",
    first.action==="copied_verified"&&second.action==="already_verified"&&beforeHash===afterHash&&beforeStat.size===afterStat.size,
    {firstAction:first.action,secondAction:second.action,beforeHash,afterHash});
  assert("double_processing_is_idempotent",
    listFiles(caseA).filter(x=>x==="doc.pdf").length===1&&second.action==="already_verified",
    {files:listFiles(caseA),action:second.action});

  let wrongCaseRejected=false;
  try{
    copyVerifiedIntoCase(src,path.join(caseB,"doc.pdf"),{expectedSha256:expected,caseArchiveDir:caseA});
  }catch(e){wrongCaseRejected=/outside expected case archive directory/i.test(String(e.message||e))}
  assert("same_hash_cannot_bind_to_wrong_case_directory",wrongCaseRejected,{caseA,caseB});

  const conflictSrc=path.join(stage,"same-name-different-content.pdf");
  fs.writeFileSync(conflictSrc,Buffer.from("%PDF-1.4\nDIFFERENT CONTENT\n"));
  const canonicalBefore=fs.readFileSync(dst);
  let conflictRejected=false;
  try{copyVerifiedIntoCase(conflictSrc,dst,{caseArchiveDir:caseA})}catch(e){conflictRejected=true}
  const canonicalAfter=fs.readFileSync(dst);
  assert("same_name_different_content_never_overwrites",
    conflictRejected&&shaBuffer(canonicalBefore)===shaBuffer(canonicalAfter)&&shaBuffer(canonicalAfter)===expected,
    {conflictRejected,canonicalHash:shaBuffer(canonicalAfter)});

  const partial=path.join(stage,"partial-download.pdf");
  fs.writeFileSync(partial,Buffer.from("%PDF-1.4\nTRUNCATED"));
  const protectedBefore=sha256File(dst);
  let partialRejected=false;
  try{
    copyVerifiedIntoCase(partial,dst,{expectedSha256:expected,caseArchiveDir:caseA});
  }catch(e){partialRejected=true}
  const protectedAfter=sha256File(dst);
  assert("interrupted_download_preserves_existing_canonical",
    partialRejected&&protectedBefore===protectedAfter&&protectedAfter===expected,
    {partialRejected,protectedBefore,protectedAfter});

  const sourceBefore=sha256File(src);
  const preserved=copyVerifiedIntoCase(src,dst,{expectedSha256:expected,caseArchiveDir:caseA});
  assert("source_not_deleted_before_or_after_verification",
    fs.existsSync(src)&&sha256File(src)===sourceBefore&&preserved.sourcePreserved===true,
    {sourceExists:fs.existsSync(src),sourceHash:sha256File(src),action:preserved.action});

  const nestedTarget=path.join(caseA,"nested","doc2.pdf");
  const nested=copyVerified(src,nestedTarget,{expectedSha256:expected});
  assert("temporary_copy_cleanup_after_verified_rename",
    nested.hashMatch&&nested.sizeMatch&&!listFiles(path.dirname(nestedTarget)).some(x=>x.includes(".bono-copy-")),
    {files:listFiles(path.dirname(nestedTarget)),action:nested.action});

}catch(e){
  fail("selftest_unhandled",e.stack||e.message||e);
}

const failed=results.filter(x=>x.status==="fail").length;
try{fs.rmSync(tmp,{recursive:true,force:true})}catch{}
console.log(JSON.stringify({ok:failed===0,failed,tempCleaned:!fs.existsSync(tmp),results},null,2));
if(failed)process.exitCode=1;
