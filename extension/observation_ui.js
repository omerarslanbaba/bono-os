'use strict';
const statusNode=document.getElementById('status');
let statusTimer=null;
const reasons={request_identity_conflict:'İstek içindeki dosya kimlikleri çelişiyor.',dosya_id_mismatch:'Hedef dosya kimliği ile istek kimliği uyuşmuyor.',panel_request_origin_unverified:'İsteğin hedef panelden çıktığı kanıtlanamadı.',panel_context_changed:'Panel veya işlem bağlamı değişti.',incomplete_capture:'Yanıt eksik yakalandı.',authorization_or_application_error:'UYAP yetki/uygulama hatası.',expired:'Gözlem süresi doldu.'};
async function refreshStatus(){
 clearTimeout(statusTimer);
 try{const r=await chrome.runtime.sendMessage({type:'BONO_OBSERVATION_GET_STATUS'});
  if(!r.ok)throw Error();
  statusNode.textContent=(r.state==='active'?'Gözlem açık.':'Gözlem kapalı.')+(r.reason?' '+(reasons[r.reason]||'Gözlem durduruldu.'):'')+' Metadata aktarımı ve indirme kapalı.';
  if(r.state==='active')statusTimer=setTimeout(refreshStatus,1500);
 }catch{statusNode.textContent='Gözlem durumu alınamadı.';}
}
refreshStatus();
document.getElementById('start').onclick=async()=>{
 try{
  if(!document.getElementById('confirmed').checked)throw new Error('Panel doğrulaması gerekli.');
  const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
  const result=await chrome.runtime.sendMessage({type:'BONO_OBSERVATION_START',tabId:tab.id,frameId:Number(document.getElementById('frame').value),caseId:Number(document.getElementById('case').value),contextConfirmed:true});
  statusNode.textContent=result.ok?'Gözlem açık. Hedef panelde Evrak sekmesine bir kez tıklayın. Yeni istek oluşmazsa tekrar denemeyin.':result.error;
  if(result.ok)statusTimer=setTimeout(refreshStatus,1500);
 }catch{statusNode.textContent='Gözlem başlatılamadı; sayfayı otomatik yenilemeyin.';}
};
document.getElementById('stop').onclick=async()=>{await chrome.runtime.sendMessage({type:'BONO_OBSERVATION_STOP'});statusNode.textContent='Gözlem kapalı.';};
