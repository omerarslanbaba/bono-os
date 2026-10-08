const fs=require("fs");
const path=require("path");
const {execFile}=require("child_process");
const v04=require("./v04");

const ROOT=path.join(__dirname,"..");
const OUT_DIR=path.join(ROOT,"data","drafts");
const TMP_DIR=path.join(ROOT,"data","tmp");
fs.mkdirSync(OUT_DIR,{recursive:true});
fs.mkdirSync(TMP_DIR,{recursive:true});

function py(args){
  return new Promise((resolve,reject)=>{
    execFile("py",["-3",path.join(ROOT,"scripts","udf_engine.py"),...args],{cwd:ROOT,windowsHide:true,maxBuffer:20*1024*1024},(err,stdout,stderr)=>{
      if(err)return reject(new Error(String(stderr||err.message).trim()));
      const line=String(stdout||"").trim().split(/\r?\n/).filter(Boolean).pop()||"{}";
      try{resolve(JSON.parse(line))}catch{reject(new Error("UDF motorundan geçersiz JSON: "+line.slice(0,300)))}
    });
  });
}
function safeName(s){
  return String(s||"taslak").replace(/[<>:"/\\|?*\x00-\x1F]/g," ").replace(/\s+/g," ").trim().slice(0,80)||"taslak";
}
async function exportDraft(id){
  const d=v04.draftDetail(Number(id));
  if(!d)throw new Error("Taslak bulunamadı");
  const md=d.content_md||d.content_text||"";
  if(!md.trim())throw new Error("Taslak içeriği boş");
  const payload={markdown:md,styleProfile:d.styleProfile||{}};
  const tmp=path.join(TMP_DIR,"draft_"+id+"_"+Date.now()+".json");
  fs.writeFileSync(tmp,JSON.stringify(payload),"utf8");
  const out=path.join(OUT_DIR,String(id).padStart(4,"0")+"_"+safeName(d.title)+"_v"+d.version+".udf");
  try{
    const built=await py(["build",tmp,out]);
    const checked=await py(["validate",out]);
    if(!checked.ok||checked.rawTextLength<=0)throw new Error("UDF self-validation başarısız");
    v04.setDraftUdf(Number(id),out);
    v04.audit("validate_udf","draft",id,{paragraphCount:checked.paragraphCount,rawTextLength:checked.rawTextLength,signed:false},"system");
    return {ok:true,path:out,built,validation:checked,note:"İmzasız taslak; UYAP Doküman Editörü’nde son kontrol gerekir."};
  }finally{
    try{fs.unlinkSync(tmp)}catch{}
  }
}
module.exports={exportDraft};