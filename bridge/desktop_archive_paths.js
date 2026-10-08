'use strict';

// Pure naming contract: never reads, creates, moves or deletes user files.
const path = require('node:path');
const INVALID = /[<>:"?*|\\\x00-\x1F]/g;
const RESERVED = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/i;
const GROUPS = Object.freeze({
  asliye_hukuk: 'Asliye Hukuk Mahkemeleri',
  aile: 'Aile Mahkemeleri',
  asliye_ceza: 'Asliye Ceza Mahkemeleri',
  cbs: 'Cumhuriyet Başsavcılıkları',
  icra: 'İcra Daireleri',
  sigorta_tahkim: 'Sigorta Tahkim'
});

function segment(value, { maxLength = 72 } = {}) {
  const text = String(value ?? '').normalize('NFC').replace(INVALID, '-').replace(/\//g, '-')
    .replace(/\s+/g, ' ').replace(/[. ]+$/g, '').trim();
  let safe = text || 'Belirtilmemiş';
  if (RESERVED.test(safe)) safe = '_' + safe;
  safe = safe.slice(0, maxLength).replace(/[. ]+$/g, '');
  return safe || 'Belirtilmemiş';
}

function stableId(value) {
  const id = String(value ?? '').trim();
  if (!/^[A-Za-z0-9_-]{1,48}$/.test(id)) {
    throw new TypeError('Stable case identifier is required (letters, digits, underscore or dash)');
  }
  return id;
}

function caseFolder(record) {
  if (!record || typeof record !== 'object') throw new TypeError('Case metadata required');
  const id = stableId(record.caseId);
  const fields = [
    record.foyNo, record.clientName, record.caseType,
    record.unitName, record.fileNumber
  ].map(v => segment(v, { maxLength: 50 }));
  // The immutable ID prevents collisions even if human-readable names repeat.
  const suffix = '--BONO-' + id;
  const maxBase = Math.max(40, 180 - suffix.length);
  const name = fields.join(' - ').slice(0, maxBase).replace(/[. -]+$/g, '');
  return name + suffix;
}

function categoryFolder(type) {
  const key = String(type ?? '').trim().toLowerCase();
  return GROUPS[key] || segment(type || 'Diğer Birimler');
}

function relativeCaseDirectory(record) {
  return path.join('Mahkemeler', categoryFolder(record.category), caseFolder(record));
}

module.exports = { segment, stableId, caseFolder, categoryFolder, relativeCaseDirectory, GROUPS };
