'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const naming = require('../bridge/desktop_archive_paths');

test('Windows-invalid and reserved segments are safe', () => {
  assert.equal(naming.segment('CON'), '_CON');
  assert.equal(naming.segment('Murat:Ali / Dava?'), 'Murat-Ali - Dava-');
  assert.equal(naming.segment('   '), 'Belirtilmemiş');
  assert.equal(naming.segment('Test.  '), 'Test');
});
test('same display metadata from different cases cannot collide', () => {
  const base = { foyNo: 17, clientName: 'Örnek', caseType: 'Dava', unitName: '2. Aile', fileNumber: '2026/1' };
  assert.notEqual(naming.caseFolder({...base, caseId: 93}), naming.caseFolder({...base, caseId: 94}));
});
test('folder path follows Mahkemeler/category/case and is relative', () => {
  const target = naming.relativeCaseDirectory({caseId: 93, category: 'cbs', foyNo: 93, clientName: 'Efe', caseType: 'Soruşturma', unitName: 'Eskişehir CBS', fileNumber: '2026/51832'});
  assert.equal(target.split(path.sep)[0], 'Mahkemeler');
  assert.equal(target.split(path.sep)[1], 'Cumhuriyet Başsavcılıkları');
  assert.match(target, /BONO-93$/);
  assert.ok(!path.isAbsolute(target));
});
test('reject invalid IDs and avoid filesystem side effects', () => {
  assert.throws(()=>naming.caseFolder({caseId:'../escape'}), TypeError);
  assert.throws(()=>naming.caseFolder({}), TypeError);
});
