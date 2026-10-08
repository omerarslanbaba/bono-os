"use strict";

const fs=require("fs");
const path=require("path");
const {sha256File,copyVerifiedIntoCase}=require("./archive_safety");

function cleanArchiveName(value){
  return String(value||"Belge").replace(/[<>:"/\\|?*\x00-\x1F]/g," ").replace(/\s+/g," ").trim()||"Belge";
}
function locationPath(row){return typeof row==="string"?row:row?.local_path||null}
function samePath(a,b){try{return path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase()}catch{return false}}
function isPathInside(file,root){
  if(!file||!root)return false;
  const rel=path.relative(path.resolve(root),path.resolve(file));
  return rel===""||(!path.isAbsolute(rel)&&rel!==".."&&!rel.startsWith(".."+path.sep));
}
function sourceState(source,expectedSha256=null){
  source=path.resolve(source);
  const st=fs.statSync(source);
  if(!st.isFile())throw new Error("Archive source is not a regular file: "+source);
  const sha256=sha256File(source);
  const expected=expectedSha256?String(expectedSha256).toLowerCase():sha256;
  if(sha256!==expected)throw new Error("Archive source SHA-256 mismatch");
  return {path:source,size:st.size,sha256,expectedSha256:expected};
}
function selectReusableCanonicalPath(locations,caseArchiveDir,{expectedSha256=null}={}){
  const expected=expectedSha256?String(expectedSha256).toLowerCase():null;
  for(const row of locations||[]){
    const raw=locationPath(row);
    if(!raw)continue;
    const candidate=path.resolve(raw);
    if(!isPathInside(candidate,caseArchiveDir))continue;
    if(!fs.existsSync(candidate))continue;
    const st=fs.statSync(candidate);
    if(!st.isFile())continue;
    if(expected){
      const got=sha256File(candidate);
      if(got!==expected)throw new Error("Existing case canonical path SHA-256 mismatch: "+candidate);
    }
    return candidate;
  }
  return null;
}
function chooseCaseTarget(caseArchiveDir,preferredName,sourceSha256){
  caseArchiveDir=path.resolve(caseArchiveDir);
  const clean=cleanArchiveName(preferredName);
  const ext=path.extname(clean),stem=path.basename(clean,ext);
  let n=1;
  while(true){
    const name=n===1?clean:stem+" ("+n+")"+ext;
    const candidate=path.join(caseArchiveDir,name);
    if(!isPathInside(candidate,caseArchiveDir))throw new Error("Canonical target escaped case archive directory");
    if(!fs.existsSync(candidate))return {target:candidate,action:"copy_new_target"};
    const st=fs.statSync(candidate);
    if(st.isFile()&&sourceSha256&&sha256File(candidate)===String(sourceSha256).toLowerCase()){
      return {target:candidate,action:"reuse_same_name_or_suffix"};
    }
    n++;
  }
}
function planCaseCanonical({source,caseArchiveDir,preferredName,assetLocations=[],expectedSha256=null}={}){
  if(!source)throw new Error("source is required");
  if(!caseArchiveDir)throw new Error("caseArchiveDir is required");
  caseArchiveDir=path.resolve(caseArchiveDir);
  const src=sourceState(source,expectedSha256);
  const reusable=selectReusableCanonicalPath(assetLocations,caseArchiveDir,{expectedSha256:src.expectedSha256});
  if(reusable){
    return {action:"reuse_case_location",source:src.path,sourceSha256:src.sha256,sourceSize:src.size,caseArchiveDir,target:reusable,expectedSha256:src.expectedSha256};
  }
  const chosen=chooseCaseTarget(caseArchiveDir,preferredName||path.basename(src.path),src.sha256);
  return {action:chosen.action,source:src.path,sourceSha256:src.sha256,sourceSize:src.size,caseArchiveDir,target:chosen.target,expectedSha256:src.expectedSha256};
}
function executeCaseCanonicalPlan(plan){
  if(!plan||!plan.source||!plan.target||!plan.caseArchiveDir)throw new Error("Invalid canonical plan");
  if(!isPathInside(plan.target,plan.caseArchiveDir))throw new Error("Canonical target is outside expected case archive directory");
  if(plan.action==="reuse_case_location"||plan.action==="reuse_same_name_or_suffix"){
    const current=sourceState(plan.source,plan.expectedSha256);
    const targetSha=sha256File(plan.target);
    if(targetSha!==current.sha256)throw new Error("Reusable canonical target SHA-256 mismatch");
    return {archived:true,dedup:true,action:"already_verified",path:plan.target,sourcePreserved:fs.existsSync(plan.source),sourceSha256:current.sha256,targetSha256:targetSha};
  }
  const copied=copyVerifiedIntoCase(plan.source,plan.target,{expectedSha256:plan.expectedSha256,caseArchiveDir:plan.caseArchiveDir});
  return {archived:true,dedup:false,...copied,path:plan.target};
}

module.exports={
  cleanArchiveName,
  isPathInside,
  selectReusableCanonicalPath,
  chooseCaseTarget,
  planCaseCanonical,
  executeCaseCanonicalPlan,
  samePath
};
