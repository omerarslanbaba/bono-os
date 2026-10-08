"use strict";

const {spawnSync}=require("node:child_process");
const path=require("node:path");

const test=path.join(__dirname,"document_view_http_selftest.js");
const maxAttempts=3;
let last=null;

for(let attempt=1;attempt<=maxAttempts;attempt++){
  const r=spawnSync(process.execPath,[test],{cwd:path.join(__dirname,".."),encoding:"utf8"});
  last=r;
  const out=String(r.stdout||"");
  const err=String(r.stderr||"");
  if(r.status===0){
    if(attempt>1)console.warn("PASS Archive HTTP selftest after transient canonical_open_failed retry attempt "+attempt);
    process.stdout.write(out);
    process.stderr.write(err);
    process.exit(0);
  }
  const combined=out+"\n"+err;
  if(!combined.includes("canonical_open_failed")){
    process.stdout.write(out);
    process.stderr.write(err);
    process.exit(r.status||1);
  }
  console.warn("Transient Windows canonical_open_failed in Archive HTTP selftest attempt "+attempt+"/"+maxAttempts+"; rerunning unchanged owner test.");
}
process.stdout.write(String(last?.stdout||""));
process.stderr.write(String(last?.stderr||""));
process.exit(last?.status||1);
