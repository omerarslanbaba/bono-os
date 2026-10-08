"use strict";

const fs=require("fs");
const os=require("os");
const path=require("path");
const crypto=require("crypto");
const {
  planCaseCanonical,
  executeCaseCanonicalPlan,
  selectReusableCanonicalPath
}=require("../bridge/archive_case_guard");
const {sha256File}=require("../bridge/archive_safety");

const tmp=fs.mkdtempSync(path.join(os.tmpdir(),"bono-archive-case-guard-"));
const stage=path.join(tmp,"stage");
const archiveRoot=path.join(tmp,"archive");
const caseA=path.join(archiveRoot,"Case-A");
const caseB=path.join(archiveRoot,"Case-B");
for(const p of [stage,caseA,caseB])fs.mkdirSync(p,{recursive:true});

const results=[];
const pass=(name,detail={})=>results.push({name,status:"pass",...detail});
const fail=(name,error,detail={})=>results.push({name,status:"fail",error:String(error),...detail});
function assert(name,cond,detail={}){cond?pass(name,detail):fail(name,"assertion failed",detail)}
function sha(b){return crypto.createHash("sha256").update(b).digest("hex")}
function files(dir){return fs.existsSync(dir)?fs.readdirSync(dir).sort():[]}

try{
  const bytes=Buffer.from("%PDF-1.4\ncase scoped fixture\n");
  const source=path.join(stage,"doc.pdf");
  fs.writeFileSync(source,bytes);
  const expected=sha(bytes);

  const wrongCase=path.join(caseB,"doc.pdf");
  fs.writeFileSync(wrongCase,bytes);
  const planWrong=planCaseCanonical({
    source,
    caseArchiveDir:caseA,
    preferredName:"doc.pdf",
    assetLocations:[wrongCase],
    expectedSha256:expected
  });
  assert("wrong_case_same_hash_is_not_reused",
    planWrong.action==="copy_new_target"&&path.dirname(planWrong.target)===caseA,
    planWrong);
  const copied=executeCaseCanonicalPlan(planWrong);
  assert("wrong_case_same_hash_is_copied_into_current_case",
    copied.archived&&fs.existsSync(path.join(caseA,"doc.pdf"))&&sha256File(path.join(caseA,"doc.pdf"))===expected&&fs.existsSync(wrongCase),
    {copied,caseAFiles:files(caseA),caseBFiles:files(caseB)});

  const source2=path.join(stage,"doc-second.pdf");
  fs.writeFileSync(source2,bytes);
  const planSameCase=planCaseCanonical({
    source:source2,
    caseArchiveDir:caseA,
    preferredName:"doc.pdf",
    assetLocations:[wrongCase,path.join(caseA,"doc.pdf")],
    expectedSha256:expected
  });
  assert("same_case_existing_hash_is_reused",
    planSameCase.action==="reuse_case_location"&&path.resolve(planSameCase.target)===path.resolve(path.join(caseA,"doc.pdf")),
    planSameCase);
  const reused=executeCaseCanonicalPlan(planSameCase);
  assert("same_case_reuse_is_idempotent",
    reused.dedup===true&&files(caseA).filter(x=>x==="doc.pdf").length===1&&fs.existsSync(source2),
    {reused,files:files(caseA)});

  const conflictCanonical=path.join(caseA,"conflict.pdf");
  const oldBytes=Buffer.from("%PDF-1.4\nOLD CONTENT\n");
  fs.writeFileSync(conflictCanonical,oldBytes);
  const newBytes=Buffer.from("%PDF-1.4\nNEW CONTENT\n");
  const conflictSource=path.join(stage,"conflict.pdf");
  fs.writeFileSync(conflictSource,newBytes);
  const conflictPlan=planCaseCanonical({
    source:conflictSource,
    caseArchiveDir:caseA,
    preferredName:"conflict.pdf",
    assetLocations:[],
    expectedSha256:sha(newBytes)
  });
  assert("same_name_different_content_gets_unique_target",
    conflictPlan.action==="copy_new_target"&&path.basename(conflictPlan.target)==="conflict (2).pdf",
    conflictPlan);
  executeCaseCanonicalPlan(conflictPlan);
  assert("same_name_different_content_does_not_overwrite",
    sha256File(conflictCanonical)===sha(oldBytes)&&sha256File(path.join(caseA,"conflict (2).pdf"))===sha(newBytes),
    {caseAFiles:files(caseA)});

  const protected=path.join(caseA,"protected.pdf");
  fs.writeFileSync(protected,bytes);
  const partial=path.join(stage,"partial.pdf");
  fs.writeFileSync(partial,Buffer.from("%PDF-1.4\nTRUNCATED"));
  const protectedBefore=sha256File(protected);
  let partialRejected=false;
  try{
    planCaseCanonical({
      source:partial,
      caseArchiveDir:caseA,
      preferredName:"protected.pdf",
      assetLocations:[protected],
      expectedSha256:expected
    });
  }catch{partialRejected=true}
  assert("partial_download_cannot_damage_existing_canonical",
    partialRejected&&sha256File(protected)===protectedBefore,
    {partialRejected,protectedBefore,protectedAfter:sha256File(protected)});

  const source3=path.join(stage,"repeat.pdf");
  fs.writeFileSync(source3,bytes);
  const repeat1=planCaseCanonical({source:source3,caseArchiveDir:caseA,preferredName:"repeat.pdf",assetLocations:[],expectedSha256:expected});
  executeCaseCanonicalPlan(repeat1);
  const source4=path.join(stage,"repeat-again.pdf");
  fs.writeFileSync(source4,bytes);
  const repeat2=planCaseCanonical({
    source:source4,
    caseArchiveDir:caseA,
    preferredName:"repeat.pdf",
    assetLocations:[path.join(caseA,"repeat.pdf")],
    expectedSha256:expected
  });
  const repeatResult=executeCaseCanonicalPlan(repeat2);
  assert("same_document_processed_twice_creates_no_duplicate",
    repeatResult.dedup===true&&files(caseA).filter(x=>x.startsWith("repeat")).length===1,
    {repeatResult,caseAFiles:files(caseA)});

  const corruptCasePath=path.join(caseA,"corrupt.pdf");
  fs.writeFileSync(corruptCasePath,Buffer.from("CORRUPT"));
  let corruptRejected=false;
  try{
    selectReusableCanonicalPath([corruptCasePath],caseA,{expectedSha256:expected});
  }catch{corruptRejected=true}
  assert("same_case_location_with_wrong_hash_is_rejected",corruptRejected);

  assert("sources_are_preserved_until_caller_cleanup",
    [source,source2,conflictSource,partial,source3,source4].every(fs.existsSync),
    {sources:[source,source2,conflictSource,partial,source3,source4].map(p=>({path:p,exists:fs.existsSync(p)}))});

}catch(e){
  fail("selftest_unhandled",e.stack||e.message||e);
}

const failed=results.filter(x=>x.status==="fail").length;
try{fs.rmSync(tmp,{recursive:true,force:true})}catch{}
console.log(JSON.stringify({ok:failed===0,failed,tempCleaned:!fs.existsSync(tmp),results},null,2));
if(failed)process.exitCode=1;
