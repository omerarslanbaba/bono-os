'use strict';
const fs=require('node:fs'),crypto=require('node:crypto');
function acquire(source){
 const file=fs.realpathSync(source)+'.bono-observer.lock',token=crypto.randomUUID();
 const fd=fs.openSync(file,'wx');fs.writeFileSync(fd,JSON.stringify({pid:process.pid,token}));fs.closeSync(fd);
 let closed=false;
 const release=()=>{if(closed)return;closed=true;try{if(JSON.parse(fs.readFileSync(file)).token===token)fs.unlinkSync(file);}catch{}};
 process.once('exit',release);return {file,release};
}
// Explicit maintenance recovery only. An alive/unknown PID is never removed.
function recover(source){
 const file=fs.realpathSync(source)+'.bono-observer.lock',bytes=fs.readFileSync(file),owner=JSON.parse(bytes);
 if(!Number.isInteger(owner.pid)||!owner.token)throw Error('invalid_lease');
 try{process.kill(owner.pid,0);throw Error('lease_owner_alive');}catch(e){if(e.code!=='ESRCH')throw e;}
 if(!fs.readFileSync(file).equals(bytes))throw Error('lease_changed');fs.unlinkSync(file);
}
module.exports={acquire,recover};
