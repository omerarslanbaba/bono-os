"use strict";

const fs=require("fs");
const path=require("path");
const crypto=require("crypto");

function sha256File(file){
  const h=crypto.createHash("sha256"),fd=fs.openSync(file,"r"),buf=Buffer.allocUnsafe(1024*1024);
  try{let n=0,pos=0;do{n=fs.readSync(fd,buf,0,buf.length,pos);if(n){h.update(buf.subarray(0,n));pos+=n}}while(n)}finally{fs.closeSync(fd)}
  return h.digest("hex");
}
function statFile(file){const s=fs.statSync(file);if(!s.isFile())throw new Error("Not a regular file: "+file);return s}
function verifySameContent(source,target,expectedSha256=null){
  const ss=statFile(source),ts=statFile(target);
  const sourceSha=sha256File(source),targetSha=sha256File(target);
  const expected=expectedSha256?String(expectedSha256).toLowerCase():sourceSha;
  return {source,target,sourceSize:ss.size,targetSize:ts.size,sourceSha,targetSha,expectedSha:expected,sizeMatch:ss.size===ts.size,hashMatch:sourceSha===targetSha&&targetSha===expected,sourceExists:fs.existsSync(source),targetExists:fs.existsSync(target)};
}
function copyVerified(source,target,{expectedSha256=null}={}){
  source=path.resolve(source);target=path.resolve(target);
  statFile(source);
  const sourceSha=sha256File(source),expected=expectedSha256?String(expectedSha256).toLowerCase():sourceSha;
  if(sourceSha!==expected)throw new Error("Source SHA-256 mismatch");
  fs.mkdirSync(path.dirname(target),{recursive:true});
  if(fs.existsSync(target)){
    const check=verifySameContent(source,target,expected);
    if(!check.hashMatch||!check.sizeMatch)throw new Error("Canonical target exists with different content");
    return {...check,action:"already_verified",sourcePreserved:true};
  }
  const tmp=target+".bono-copy-"+process.pid+"-"+Date.now()+".tmp";
  try{
    fs.copyFileSync(source,tmp);
    const tmpSha=sha256File(tmp);
    if(tmpSha!==expected)throw new Error("Temporary canonical copy SHA-256 mismatch");
    if(fs.statSync(tmp).size!==fs.statSync(source).size)throw new Error("Temporary canonical copy size mismatch");
    fs.renameSync(tmp,target);
  }finally{try{if(fs.existsSync(tmp))fs.unlinkSync(tmp)}catch{}}
  const check=verifySameContent(source,target,expected);
  if(!check.hashMatch||!check.sizeMatch||!check.sourceExists)throw new Error("Canonical copy verification failed");
  return {...check,action:"copied_verified",sourcePreserved:true};
}
function sameSha(source,target){if(!fs.existsSync(source)||!fs.existsSync(target))return false;return sha256File(source)===sha256File(target)}
function isPathInside(file,root){
  const f=path.resolve(file),r=path.resolve(root);
  const rel=path.relative(r,f);
  return rel===""||(!rel.startsWith(".."+path.sep)&&rel!==".."&&!path.isAbsolute(rel));
}
function assertTargetWithinCase(target,caseArchiveDir){
  if(!caseArchiveDir)throw new Error("caseArchiveDir is required");
  if(!isPathInside(target,caseArchiveDir))throw new Error("Canonical target is outside expected case archive directory");
  return true;
}
function copyVerifiedIntoCase(source,target,{expectedSha256=null,caseArchiveDir}={}){
  assertTargetWithinCase(target,caseArchiveDir);
  return copyVerified(source,target,{expectedSha256});
}

module.exports={sha256File,verifySameContent,copyVerified,sameSha,isPathInside,assertTargetWithinCase,copyVerifiedIntoCase};
