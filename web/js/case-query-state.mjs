// Presentation only. History does not grant identity, ownership or execution permission.
export const queryLabels={queued:'Sırada',running:'Çalışıyor',completed:'Tamamlandı',failed:'Başarısız',login_required:'Oturum engeli',permission_denied:'İzin engeli',execution_unknown:'Sonuç belirsiz',not_found:'Dosya bulunamadı',ambiguous:'Eşleşme belirsiz',identity_mismatch:'Dosya kimliği uyuşmuyor',archived_never_executed:'Arşivlendi · hiç yürütülmedi',never_executed:'Henüz yürütülmedi',legacy_attempted_unverified:'Eski sonuç · doğrulanmadı'};
export function queryOverview(rows=[],docCount=0){
 const history=rows.filter(r=>!r.legacy&&['cbs.search','document.list','case.search'].includes(r.operation)&&r.state!=='archived_never_executed').slice().sort((a,b)=>Number(b.command_id)-Number(a.command_id));
 const latest=history[0]||null,success=history.find(r=>r.state==='completed'&&r.result_ref)||null;
 const documentQuery=history.find(r=>r.operation==='document.list')||null;
 const documentSuccess=history.find(r=>r.operation==='document.list'&&r.state==='completed'&&r.result_ref)||null;
 let documents=docCount>0?`${docCount} evrak kaydı · liste kapsamı ayrıca doğrulanır`:'Evrak listesi henüz alınmadı';
 if(documentQuery?.state==='running'||documentQuery?.state==='queued')documents='Evrak listesi sorgusu '+queryLabels[documentQuery.state].toLocaleLowerCase('tr-TR');
 else if(documentQuery?.state==='completed'&&documentSuccess)documents=docCount?`${docCount} evrak kaydı mevcut`:'Evrak listesi alındı, sonuç boş';
 else if(documentQuery?.state==='failed')documents='Evrak listesi sorgusu başarısız';
 else if(!docCount&&success)documents='Dosya sorgulandı fakat evrak listesi alınmadı';
 return {latest,success,documents,label:latest?(queryLabels[latest.state]||'Sonuç belirsiz'):'Henüz sorgulanmadı'};
}
export function queryWaitReason(row,sessionInfo={}){
 if(!row||!['queued','running'].includes(row.state))return '';
 const session=sessionInfo.session||{},rate=sessionInfo.rate||{};
 if(session.state&&session.state!=='ready')return 'Oturum/bağlantı engeli: '+session.state;
 if(rate.state&&rate.state!=='ready')return 'Sorgu devresi: '+rate.state;
 return row.state==='queued'?'Core’da sırada; yürütücünün alma nedeni API’de bildirilmedi.':'Core yürütülüyor olarak bildiriyor.';
}
export function partyText(row={}){
 return [row.client_name?'Müvekkil (kayıtlı): '+row.client_name:'',row.party_names?'Taraflar (kayıtlı): '+row.party_names:'',row.representative_names?'Vekiller (kayıtlı): '+row.representative_names:''].filter(Boolean).join(' · ')||'Taraf bilgisi kaydedilmemiş';
}
export function openingDate(row={}){
 const value=row.opened_at||row.dosyaAcilisTarihi;
 if(typeof value==='string')return value;
 const d=value?.date||value;
 return Number.isInteger(d?.year)&&Number.isInteger(d?.month)&&Number.isInteger(d?.day)?`${d.year}-${String(d.month).padStart(2,'0')}-${String(d.day).padStart(2,'0')}`:'';
}
export function queryTime(value){
 if(!value)return 'Zaman bilinmiyor';
 const date=new Date(/^\d{4}-\d\d-\d\d \d\d:/.test(value)?value.replace(' ','T')+'Z':value);
 return Number.isNaN(date.getTime())?'Zaman bilinmiyor':date.toLocaleString('tr-TR',{timeZone:'Europe/Istanbul',dateStyle:'short',timeStyle:'short'});
}
