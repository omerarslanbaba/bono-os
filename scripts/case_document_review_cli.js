"use strict";

const path=require("path");
const {DatabaseSync}=require("node:sqlite");
const review=require("../bridge/case_document_review");

function arg(name,fallback=null){
  const i=process.argv.indexOf(name);
  return i>=0&&process.argv[i+1]?process.argv[i+1]:fallback;
}
function has(name){return process.argv.includes(name)}

const caseId=Number(arg("--case",0));
if(!caseId){
  console.error(JSON.stringify({ok:false,error:"--case gerekli"},null,2));
  process.exit(2);
}
const ROOT=path.resolve(__dirname,"..");
const dbPath=path.resolve(arg("--db",path.join(ROOT,"data","bono.db")));
const db=new DatabaseSync(dbPath,{readOnly:true});
try{
  const caseReview=review.loadCaseReview(db,caseId,{
    verifyFiles:!has("--no-hash"),
    includeText:!has("--no-text")
  });
  if(!caseReview){
    console.error(JSON.stringify({ok:false,error:"case_not_found",caseId,dbPath},null,2));
    process.exitCode=3;
  }else{
    const out={
      ok:true,
      readOnly:true,
      caseReview,
      draftingCorpus:review.buildDraftingCorpus(caseReview)
    };
    console.log(JSON.stringify(out,null,2));
  }
}finally{
  db.close();
}
