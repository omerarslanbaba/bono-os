'use strict';
const numeric=new Set(['pageNumber','pageSize','dosyaDurumKod','ilKodu','birimId','birimTuru2','birimTuru3','dosyaTurKod','yargiTuru']);
function request(input){
 const result={query:{},body:{},headers:{}};
 for(const section of ['query','body'])for(const [key,value] of Object.entries(input?.[section]||{})){
  if(numeric.has(key)&&/^[0-9]{1,12}$/.test(String(value)))result[section][key]=value;
  if(['dosyaId','evrakId'].includes(key)&&typeof value==='string'&&/^[a-zA-Z0-9+/_=.\-"']{16,128}$/.test(value))result[section][key]=value;
 }
 for(const [key,value] of Object.entries(input?.headers||{})){
  if(key.toLowerCase()==='accept'&&['application/json','application/json, text/plain, */*'].includes(value))result.headers[key]=value;
  if(key.toLowerCase()==='content-type'&&['application/json','application/x-www-form-urlencoded'].includes(value))result.headers[key]=value;
 }
 return result;
}
function response(input){
 const result={};
 for(const key of ['length','pageTotal','status','son20Evrak','tumEvraklar']){
  const value=input?.[key];if(Number.isSafeInteger(value)||['array','object'].includes(value))result[key]=value;
 }
 if(['array','object'].includes(input?.type))result.type=input.type;
 if(input?.applicationError?.code)result.applicationError={code:input.applicationError.code==='PRTL_GNL_1-1'?'PRTL_GNL_1-1':'unknown'};
 return result;
}
module.exports={request,response};
