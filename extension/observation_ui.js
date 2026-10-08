'use strict';
const statusNode=document.getElementById('status');
chrome.runtime.sendMessage({type:'BONO_OBSERVATION_GET_STATUS'}).then(r=>{statusNode.textContent=r.state==='active'?'Gözlem açık.':'Gözlem kapalı.';}).catch(()=>{statusNode.textContent='Gözlem durumu alınamadı.';});
document.getElementById('start').onclick=async()=>{
 try{
  if(!document.getElementById('confirmed').checked)throw new Error('Panel doğrulaması gerekli.');
  const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
  const result=await chrome.runtime.sendMessage({type:'BONO_OBSERVATION_START',tabId:tab.id,frameId:Number(document.getElementById('frame').value),caseId:Number(document.getElementById('case').value),contextConfirmed:true});
  statusNode.textContent=result.ok?'Gözlem açık. Yalnız hedef soruşturma grubunu bir kez genişletin.':result.error;
 }catch{statusNode.textContent='Gözlem başlatılamadı; sayfayı otomatik yenilemeyin.';}
};
document.getElementById('stop').onclick=async()=>{await chrome.runtime.sendMessage({type:'BONO_OBSERVATION_STOP'});statusNode.textContent='Gözlem kapalı.';};
