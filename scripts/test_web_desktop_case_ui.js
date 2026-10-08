const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const src=fs.readFileSync('web/js/views/active/uyap.js','utf8');
const api=fs.readFileSync('web/js/api.js','utf8');
new vm.Script(src.replace(/^import .*;\s*$/gm,'').replace(/export async function renderUyap/,'async function renderUyap'),{filename:'uyap.js'});

assert.match(src,/UYAP'tan Evrak Listesini Getir/);
assert.match(src,/api\.syncUyapDocuments\(id\)/);
assert.match(src,/api\.uyapDocumentSyncStatus\(id\)/);
assert.match(api,/uyapDocumentSyncStatus/);
assert.match(src,/\['queued','running'\]\.includes\(syncStatus\.state\)/);
assert.match(src,/setTimeout/);
assert.match(src,/UYAP evrak listesi henüz sorgulanmadı/);
assert.match(src,/Evrak listesi sorgusu kuyrukta bekliyor/);
assert.match(src,/UYAP’tan evrak listesi sorgulanıyor/);
assert.match(src,/UYAP sorgusu tamamlandı; bu dosyada evrak bulunamadı/);
assert.match(src,/Evrak listesi sorgusu başarısız/);
assert.match(src,/Bu işlem PDF\/UDF dosyalarını indirmez/);
assert.match(src,/r\.party_names/);
assert.match(src,/file\.party_names/);
assert.match(src,/file\.client_name/);
assert.match(src,/case-document-summary/);
assert.match(src,/case-document-guidance/);
assert.match(src,/case-download-controls/);
assert.match(src,/Entegrasyon bekleniyor/);
assert.doesNotMatch(src,/queueMissingUyapDocuments/);

const css=fs.readFileSync('web/styles-active.css','utf8');
assert.match(css,/\.case-sync-panel/);
assert.match(css,/\.case-parties/);
assert.match(css,/\.case-document-summary/);
assert.match(css,/\.case-download-controls/);

console.log('PASS case UI: lifecycle polling, single-case list inquiry, no automatic download, party fields and empty/error states');
