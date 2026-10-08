"use strict";

const fs=require("fs");
const {URL}=require("url");
const viewService=require("./document_view_service");
const streamGuard=require("./document_stream_guard");

function json(res,status,obj){
  res.writeHead(status,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"});
  res.end(JSON.stringify(obj));
}
function safeAsciiName(name){
  const s=String(name||"document").normalize("NFKD")
    .replace(/[^\x20-\x7E]/g,"_")
    .replace(/[\x00-\x1F\x7F"\\/;]+/g,"_")
    .replace(/\s+/g," ").trim();
  return s||"document";
}
function rfc5987(name){
  return encodeURIComponent(String(name||"document")).replace(/['()*]/g,c=>"%"+c.charCodeAt(0).toString(16).toUpperCase());
}
function contentDisposition(kind,fileName){
  const mode=kind==="inline"?"inline":"attachment";
  const clean=String(fileName||"document").replace(/[\r\n]/g," ").trim()||"document";
  return mode+'; filename="'+safeAsciiName(clean)+'"; filename*=UTF-8\'\''+rfc5987(clean);
}
function matchRoute(method,requestUrl){
  if(String(method||"GET").toUpperCase()!=="GET")return null;
  let pathname;
  try{pathname=new URL(requestUrl,"http://127.0.0.1").pathname}catch{return null}
  let m=pathname.match(/^\/api\/cases\/(\d+)\/documents\/(\d+)\/view$/);
  if(m)return {kind:"view",caseId:Number(m[1]),remoteDocumentDbId:Number(m[2])};
  m=pathname.match(/^\/api\/cases\/(\d+)\/documents\/(\d+)\/content$/);
  if(m)return {kind:"content",caseId:Number(m[1]),remoteDocumentDbId:Number(m[2])};
  return null;
}
function handleDocumentViewRequest(req,res,db){
  const route=matchRoute(req.method,req.url);
  if(!route)return false;
  if(route.kind==="view"){
    const result=viewService.getDocumentView(db,route.caseId,route.remoteDocumentDbId,{verifyFiles:true,includeText:true});
    if(!result.ok){json(res,result.statusCode||404,{ok:false,error:result.error,reason:result.reason||null});return true}
    json(res,200,result);
    return true;
  }
  const opened=streamGuard.openVerifiedDocumentContent(db,route.caseId,route.remoteDocumentDbId);
  if(!opened.ok){json(res,opened.statusCode||409,{ok:false,error:opened.error,reason:opened.reason||null});return true}
  const headers={
    "Content-Type":opened.contentType,
    "Content-Disposition":contentDisposition(opened.disposition,opened.originalFileName||opened.fileName),
    "Content-Length":String(opened.size),
    "Cache-Control":"no-store",
    "X-Content-Type-Options":"nosniff",
    "X-BONO-Verified-SHA256":opened.verifiedSha256
  };
  res.writeHead(200,headers);
  const stream=fs.createReadStream(opened.path,{fd:opened.fd,autoClose:true,start:0});
  stream.on("error",()=>{try{res.destroy()}catch{}});
  stream.pipe(res);
  return true;
}

module.exports={handleDocumentViewRequest,matchRoute,contentDisposition,safeAsciiName};
