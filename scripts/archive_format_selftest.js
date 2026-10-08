"use strict";

const fs=require("fs");
const os=require("os");
const path=require("path");
const crypto=require("crypto");
const {spawnSync}=require("child_process");

const ROOT=path.resolve(__dirname,"..");
const EXTRACTOR=path.join(ROOT,"scripts","extract_container.py");
const CONVERTER=path.join(ROOT,"scripts","convert_archive_file.py");
const WORKER=path.join(ROOT,"bridge","worker.js");
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),"bono-archive-selftest-"));
const results=[];
const pass=(name,detail={})=>results.push({name,status:"pass",...detail});
const fail=(name,error)=>results.push({name,status:"fail",error:String(error)});
const skip=(name,reason)=>results.push({name,status:"skip",reason:String(reason)});
const hash=(b)=>crypto.createHash("sha256").update(b).digest("hex");
function runPy(script,args=[]){return spawnSync("py",["-3",script,...args],{cwd:ROOT,encoding:"utf8",windowsHide:true,timeout:120000})}
function lastJson(stdout){const lines=String(stdout||"").trim().split(/\r?\n/).filter(Boolean);return JSON.parse(lines[lines.length-1]||"{}")}
function inside(file,dir){const a=path.resolve(file).toLowerCase(),b=path.resolve(dir).toLowerCase();return a===b||a.startsWith(b+path.sep.toLowerCase())}

try{
  const worker=fs.readFileSync(WORKER,"utf8");
  const requiredContracts=[
    ['udf_preserved',worker.includes('if(ext===".udf")return true;')],
    ['xlsx_original_preserved',worker.includes('if([".xls",".xlsx",".xlsm"].includes(ext))return true;')],
    ['tiff_html_conversion_policy',worker.includes('[".tif",".tiff",".html",".htm"].includes(ext)')],
    ['container_members_use_format_policy',worker.includes('archiveWithFormatPolicy(member,caseId')],
    ['container_source_removed_only_after_handled',worker.includes('if(out.handled>0&&out.unresolved===0&&out.errors.length===0)')],
  ];
  for(const [name,ok] of requiredContracts){if(ok)pass("worker_contract:"+name);else fail("worker_contract:"+name,"expected invariant not found in worker.js")}

  const fixtureDir=path.join(tmp,"fixtures"),outZip=path.join(tmp,"out-zip"),outEyp=path.join(tmp,"out-eyp");
  fs.mkdirSync(fixtureDir,{recursive:true});
  const udf=Buffer.from([0x55,0x44,0x46,0x2d,0x46,0x49,0x58,0x54,0x55,0x52,0x45,0x00,0x01,0x02,0x03]);
  const udf2=Buffer.from([0x55,0x44,0x46,0x2d,0x53,0x45,0x43,0x4f,0x4e,0x44,0x00,0x04,0x05]);
  const xlsx=Buffer.from("PK\\u0003\\u0004BONO-XLSX-FIXTURE","binary");
  const pdf=Buffer.from("%PDF-1.4\n% BONO fixture\n");
  const zipPath=path.join(tmp,"fixture.zip"),eypPath=path.join(tmp,"fixture.eyp");
  const pyZip=path.join(tmp,"make_zip.py");
  fs.writeFileSync(pyZip,[
    "import sys,zipfile",
    "z=zipfile.ZipFile(sys.argv[1],\'w\',zipfile.ZIP_DEFLATED)",
    "z.writestr(\'folderA/sample.udf\',bytes.fromhex(sys.argv[2]))",
    "z.writestr(\'folderB/sample.udf\',bytes.fromhex(sys.argv[3]))",
    "z.writestr(\'docs/sample.xlsx\',bytes.fromhex(sys.argv[4]))",
    "z.writestr(\'docs/sample.pdf\',bytes.fromhex(sys.argv[5]))",
    "z.writestr(\'../escape.udf\',bytes.fromhex(sys.argv[2]))",
    "z.writestr(\'meta.xml\',b\'<metadata/>\')",
    "z.close()",
  ].join("\n"));
  const mk=runPy(pyZip,[zipPath,udf.toString("hex"),udf2.toString("hex"),xlsx.toString("hex"),pdf.toString("hex")]);
  if(mk.status!==0)throw new Error("fixture zip creation failed: "+(mk.stderr||mk.stdout));
  fs.copyFileSync(zipPath,eypPath);

  for(const [kind,src,dest] of [["zip",zipPath,outZip],["eyp",eypPath,outEyp]]){
    const cp=runPy(EXTRACTOR,[src,dest]);
    if(cp.status!==0){fail(kind+"_extractor_process",cp.stderr||cp.stdout);continue}
    let data;try{data=lastJson(cp.stdout)}catch(e){fail(kind+"_extractor_json",e);continue}
    if(data.error){fail(kind+"_extractor",data.error);continue}
    const extracted=(data.extracted||[]);
    if(extracted.length!==5)fail(kind+"_member_count","expected 5 extracted members, got "+extracted.length);else pass(kind+"_member_count",{count:extracted.length});
    if(extracted.every(p=>inside(p,dest)))pass(kind+"_path_traversal_guard");else fail(kind+"_path_traversal_guard","member escaped destination");
    if((data.skipped||[]).includes("meta.xml"))pass(kind+"_unsupported_metadata_skipped");else fail(kind+"_unsupported_metadata_skipped","meta.xml was not skipped");
    const udfFiles=extracted.filter(p=>path.extname(p).toLowerCase()===".udf");
    const hashes=udfFiles.map(p=>hash(fs.readFileSync(p)));
    if(hashes.includes(hash(udf))&&hashes.includes(hash(udf2)))pass(kind+"_udf_bytes_preserved");else fail(kind+"_udf_bytes_preserved","UDF fixture hash mismatch");
    const xlsxFile=extracted.find(p=>path.extname(p).toLowerCase()===".xlsx");
    if(xlsxFile&&hash(fs.readFileSync(xlsxFile))===hash(xlsx))pass(kind+"_xlsx_bytes_preserved");else fail(kind+"_xlsx_bytes_preserved","XLSX fixture hash mismatch");
  }

  const udfInput=path.join(tmp,"never-convert.udf"),udfOutput=path.join(tmp,"never-convert.pdf");
  fs.writeFileSync(udfInput,udf);
  const udfConv=runPy(CONVERTER,[udfInput,udfOutput]);
  let udfConvJson={};try{udfConvJson=lastJson(udfConv.stdout)}catch{}
  if(udfConv.status===0&&udfConvJson.ok===false&&!fs.existsSync(udfOutput))pass("udf_converter_rejects_conversion");
  else fail("udf_converter_rejects_conversion","UDF converter unexpectedly produced output or reported success");

  const htmlInput=path.join(tmp,"sample.html"),htmlOutput=path.join(tmp,"sample-html.pdf");
  fs.writeFileSync(htmlInput,"<!doctype html><meta charset=utf-8><title>BONO</title><p>Archive self-test</p>","utf8");
  const htmlConv=runPy(CONVERTER,[htmlInput,htmlOutput]);
  let htmlJson={};try{htmlJson=lastJson(htmlConv.stdout)}catch{}
  if(htmlJson.ok&&fs.existsSync(htmlOutput)&&fs.readFileSync(htmlOutput).subarray(0,4).toString("ascii")==="%PDF")pass("html_to_pdf");
  else skip("html_to_pdf",htmlJson.error||htmlConv.stderr||"converter unavailable");

  const tifInput=path.join(tmp,"sample.tif"),tifOutput=path.join(tmp,"sample-tif.pdf");
  const makeTif=spawnSync("py",["-3","-c","from PIL import Image; import sys; Image.new(\'RGB\',(8,8),(255,255,255)).save(sys.argv[1],\'TIFF\')",tifInput],{encoding:"utf8",windowsHide:true,timeout:30000});
  if(makeTif.status===0){
    const tifConv=runPy(CONVERTER,[tifInput,tifOutput]);let tifJson={};try{tifJson=lastJson(tifConv.stdout)}catch{}
    if(tifJson.ok&&fs.existsSync(tifOutput)&&fs.readFileSync(tifOutput).subarray(0,4).toString("ascii")==="%PDF")pass("tiff_to_pdf");else fail("tiff_to_pdf",tifJson.error||tifConv.stderr||"conversion failed");
  }else skip("tiff_to_pdf","Pillow unavailable for fixture creation");
}catch(e){fail("selftest_setup",e.stack||e.message||e)}finally{try{fs.rmSync(tmp,{recursive:true,force:true})}catch{}}

const failed=results.filter(x=>x.status==="fail").length;
const skipped=results.filter(x=>x.status==="skip").length;
console.log(JSON.stringify({ok:failed===0,generatedAt:new Date().toISOString(),tempCleaned:!fs.existsSync(tmp),failed,skipped,results},null,2));
if(failed)process.exitCode=1;
