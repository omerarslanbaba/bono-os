"use strict";

const path=require("path");
const {spawnSync}=require("child_process");

const ROOT=path.resolve(__dirname,"..");
const SELFTEST=path.join(ROOT,"scripts","archive_download_integration_selftest.js");
function argValue(name,fallback=null){const i=process.argv.indexOf(name);return i>=0&&process.argv[i+1]?process.argv[i+1]:fallback}
const uyapModule=argValue("--uyap-module",process.env.BONO_UYAP_MODULE||null);
const childArgs=[SELFTEST];
if(uyapModule)childArgs.push("--uyap-module",uyapModule);

const cp=spawnSync(process.execPath,childArgs,{
  cwd:ROOT,
  encoding:"utf8",
  windowsHide:true,
  timeout:120000
});

let report=null;
try{report=JSON.parse(String(cp.stdout||"").trim())}catch{}

const requiredPasses=[
  "batch1_reports_remaining_downloadable",
  "batch1_completion_fixture",
  "next_batch_remains_available_after_previous_completion",
  "staging_to_canonical_hash_preserved",
  "udf_byte_integrity_preserved",
  "sha_duplicate_reuses_verified_target",
  "sha_duplicate_rejects_conflicting_target"
];

const blockingRisks=[
  "batch1_underfilled_by_command_identity_match",
  "active_batch_cap_is_per_invocation",
  "failed_command_ingest_guard_missing",
  "cancelled_command_ingest_guard_missing"
];

const resultMap=new Map((report?.results||[]).map(x=>[x.name,x]));
const missingPasses=requiredPasses.filter(name=>resultMap.get(name)?.status!=="pass");
const presentBlockingRisks=blockingRisks.filter(name=>resultMap.get(name)?.status==="risk");
const childFailed=Number(report?.failed||0)>0||cp.status!==0;

const result={
  ok:!childFailed&&missingPasses.length===0&&presentBlockingRisks.length===0,
  fixtureOnly:true,
  uyapModule:report?.uyapModule||uyapModule||null,
  childStatus:cp.status,
  childFailed,
  requiredPasses,
  missingPasses,
  blockingRisks:presentBlockingRisks,
  note:"Bu gate archive branch üzerinde upstream Chat-UYAP download sözleşmesini salt fixture ile doğrular; runtime dosyalarını değiştirmez.",
  selftest:report
};

console.log(JSON.stringify(result,null,2));
if(!result.ok)process.exitCode=1;
