import assert from 'node:assert/strict';
import {inventoryState,inventoryTotals,notificationContract} from '../web/js/inventory-state.mjs';
assert.equal(inventoryState({}).list,'Bilinmiyor');
assert.equal(inventoryState({remote_count:0}).list,'Bilinmiyor');
assert.equal(inventoryState({document_list_status:'complete'}).list,'Bilinmiyor');
assert.equal(inventoryState({document_list_status:'complete',last_successful_query_at:'2026-01-01'}).list,'Başarılı liste sorgusu');
assert.equal(inventoryState({document_list_status:'partial'}).list,'Kısmi liste');
assert.equal(inventoryState({document_list_status:'failed'}).list,'Sorgu başarısız');
assert.equal(inventoryState({uyap_dosya_id:5}).identity.includes('taraf/aidiyet teyidi ayrı'),true);
assert.equal(inventoryState({},[{local_asset_id:1},{local_asset_id:null}]).download,'Kısmen indirildi');
assert.equal(inventoryState({},[{local_asset_id:1}]).integrity,'Bütünlük kanıtı yok');
assert.equal(inventoryState({},[{local_asset_id:1,hash_verified:true}]).integrity,'Tümü doğrulandı');
assert.equal(inventoryTotals([{},{document_list_status:'partial'}]).unknown,1);
assert.equal(notificationContract.available,false);
console.log('PASS: 12 inventory status and notification contract assertions');

