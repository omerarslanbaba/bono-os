'use strict';
const {randomUUID}=require('node:crypto');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
module.exports=function create({available,verified,denied=()=>{},now=Date.now}){
 let current=null;
 function status(){if(current&&now()>current.expiresAt&&['pending','claimed'].includes(current.state))current.state='expired';return current?{id:current.id,state:current.state,reason:current.reason||null}:{state:'not_started'};}
 function begin(key){
  if(!available())throw Error('normal_user_controlled_mode_required');
  if(!UUID.test(key||''))throw Error('request_key_required');
  status();if(current?.requestKey===key||['pending','claimed'].includes(current?.state))return status();
  current={id:randomUUID(),requestKey:key,state:'pending',expiresAt:now()+30000};return status();
 }
 function claim(input){
  status();if(!available()||current?.state!=='pending'||input.id!==current.id)throw Error('session_check_not_pending');
  if(!Number.isSafeInteger(input.tabId)||input.tabId<1||input.frameId!==0||!UUID.test(input.documentId||'')||typeof input.buildId!=='string'||!input.buildId||input.buildId.length>80)throw Error('invalid_session_check_context');
  current.context={tabId:input.tabId,frameId:0,documentId:input.documentId,buildId:input.buildId};current.state='claimed';return {...status(),...current.context};
 }
 function result(input){
  status();if(!available()||current?.state!=='claimed'||input.id!==current.id||Object.entries(current.context).some(([k,v])=>input[k]!==v))throw Error('session_check_context_mismatch');
  if(input.status===200&&input.validJson===true&&input.applicationError===false){verified();current.state='ready';}
  else{current.state='blocked';current.reason=input.status===401||input.status===403?'login_required':input.applicationError===true?'application_denied':'session_unverified';if(current.reason==='login_required')denied();}
  return status();
 }
 return {begin,status,claim,result};
};
