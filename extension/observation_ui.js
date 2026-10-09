'use strict';
const statusNode=document.getElementById('status');
let statusTimer=null;
let reviewSession=null;
const selectedGroups=new Set();
function showSources(result){
 const host=document.getElementById('sourceGroups'),section=document.getElementById('sources');
 if(reviewSession!==result.id){selectedGroups.clear();reviewSession=result.id;}
 host.replaceChildren();section.hidden=!result.sourceReview?.groups?.length;
 for(const group of result.sourceReview?.groups||[]){
  const label=document.createElement('label'),box=document.createElement('input');box.type='checkbox';
  box.checked=selectedGroups.has(group.reference);box.onchange=()=>{if(box.checked)selectedGroups.add(group.reference);else selectedGroups.delete(group.reference);};
  label.append(box,document.createTextNode(group.caseNo+' · '+(group.type==='instruction'?'Talimat':group.type==='cbs_investigation'?'Soruşturma':'Tür bilinmiyor')+' · '+group.documentCount+' evrak kimliği · kaynak aidiyeti doğrulanmadı'));
  host.append(label,document.createElement('br'));
 }
}
const reasons={anchor_detached:'Tıklanan öğe portal tarafından DOM’dan kaldırıldı.',row_identity_mismatch:'Liste satırının birimi veya dosya numarası hedefle uyuşmadı.',row_context_changed:'Liste satırı bağlamı değişti.',unrecognized_click:'Tıklama hedef satır veya Evrak eylemi olarak tanınmadı.',keyboard_context_change:'Klavye girdisi bağlamı kapattı.',page_context_change:'Sayfa gezinmesi bağlamı kapattı.',panel_replaced:'Panel değiştirildi.',panel_context_changed:'Panel başlığı veya öğeleri değişti.',unclassified_context_stop:'Durma dalı sınıflandırılamadı.',context_click:'Eski genel durma nedeni; kesin dal kaydedilmemiş.',request_identity_conflict:'İstek içindeki dosya kimlikleri çelişiyor.',dosya_id_mismatch:'Hedef dosya kimliği ile istek kimliği uyuşmuyor.',panel_request_origin_unverified:'İsteğin hedef panelden çıktığı kanıtlanamadı.',panel_context_changed:'Panel veya işlem bağlamı değişti.',incomplete_capture:'Yanıt eksik yakalandı.',authorization_or_application_error:'UYAP yetki/uygulama hatası.',expired:'Gözlem süresi doldu.'};
async function refreshStatus(){
 clearTimeout(statusTimer);
 try{const r=await chrome.runtime.sendMessage({type:'BONO_OBSERVATION_GET_STATUS'});
  if(!r.ok)throw Error();
  showSources(r);
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
  statusNode.textContent=result.ok?'Gözlem açık. Panel kapalıysa doğruladığınız satırın Pencere Görünümü düğmesine yalnız bir kez basın; açıksa Evrak sekmesine bir kez tıklayın. Yeni istek oluşmazsa tekrar denemeyin.':result.error;
  if(result.ok)statusTimer=setTimeout(refreshStatus,1500);
 }catch{statusNode.textContent='Gözlem başlatılamadı; sayfayı otomatik yenilemeyin.';}
};
document.getElementById('stop').onclick=async()=>{await chrome.runtime.sendMessage({type:'BONO_OBSERVATION_STOP'});statusNode.textContent='Gözlem kapalı.';};
