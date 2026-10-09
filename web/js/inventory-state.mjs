// UI-only interpretation: absence of proof never means an empty or complete UYAP list.
export function inventoryState(row = {}, documents) {
  const docs = Array.isArray(documents) ? documents : null;
  const known = Number.isFinite(Number(row.remote_count)) && row.remote_count != null ? Number(row.remote_count) : null;
  const listed = row.document_list_status ?? row.list_status ?? null;
  const success = row.last_successful_document_query_at ?? row.last_successful_query_at ?? null;
  const verified = row.uyap_dosya_id != null && String(row.uyap_dosya_id).trim() !== '';
  const total = docs ? docs.length : known;
  const downloaded = docs ? docs.filter(d => Boolean(d.local_asset_id)).length : null;
  const verifiedFiles = docs ? docs.filter(d => d.integrity_status === 'verified' || d.hash_verified === true).length : null;
  let list = 'Bilinmiyor';
  if (listed === 'never' || listed === 'not_queried') list = 'Hiç sorgulanmadı';
  else if (listed === 'failed') list = 'Sorgu başarısız';
  else if (listed === 'partial') list = 'Kısmi liste';
  else if (listed === 'complete' && success) list = 'Başarılı liste sorgusu';
  else if (total > 0) list = 'Kayıt var · kapsam bilinmiyor';
  const download = total === null ? 'Bilinmiyor' : total === 0 ? 'İndirilecek evrak bilinmiyor' : downloaded === null ? 'İndirme kapsamı bilinmiyor' : downloaded === 0 ? 'Yerel belge yok' : downloaded < total ? 'Kısmen indirildi' : 'Yerel kopyalar mevcut';
  const integrity = docs === null || !docs.length ? 'Doğrulanmadı' : verifiedFiles === docs.length ? 'Tümü doğrulandı' : verifiedFiles > 0 ? 'Kısmen doğrulandı' : 'Bütünlük kanıtı yok';
  return { identity: verified ? 'UYAP kimliği kayıtlı · taraf/aidiyet teyidi ayrı' : 'UYAP kimliği doğrulanmadı', list, total, downloaded, integrity, download, lastSuccess: success || 'Bilinmiyor' };
}
export function inventoryTotals(rows = []) {
  const records = rows.map(r => inventoryState(r));
  return {
    known: rows.length,
    never: records.filter(s => s.list === 'Hiç sorgulanmadı').length,
    partial: records.filter(s => s.list === 'Kısmi liste').length,
    unknown: records.filter(s => s.list === 'Bilinmiyor' || s.list.includes('kapsam bilinmiyor')).length,
    partialDownloads: records.filter(s => s.download === 'Kısmen indirildi').length
  };
}
export const notificationContract = Object.freeze({
  version: 1, available: false,
  fields: ['id','caseId','documentId','kind','createdAt','readAt','source','dedupeKey'],
  message: 'Bildirim servisi henüz bağlı değil; canlı bildirim gösterilmiyor.'
});

