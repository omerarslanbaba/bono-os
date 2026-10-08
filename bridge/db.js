const { DatabaseSync } = require("node:sqlite");
const path = require("path");
const fs = require("fs");

const DB_PATH = path.join(__dirname, "..", "data", "bono.db");
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);

db.exec(`
PRAGMA journal_mode=WAL;
PRAGMA busy_timeout=5000;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS schema_meta (
  key TEXT PRIMARY KEY, value TEXT
);

CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY,
  display_name TEXT NOT NULL,
  client_type TEXT DEFAULT 'person',
  national_id TEXT,
  phone TEXT,
  email TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_clients_name_nid
  ON clients(display_name, COALESCE(national_id,''));

CREATE TABLE IF NOT EXISTS office_files (
  id INTEGER PRIMARY KEY,
  file_no TEXT UNIQUE,
  title TEXT NOT NULL,
  status TEXT DEFAULT 'open',
  primary_client_id INTEGER,
  opened_at TEXT,
  closed_at TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(primary_client_id) REFERENCES clients(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS office_file_import_sources (
  id INTEGER PRIMARY KEY,
  office_file_id INTEGER NOT NULL,
  source_type TEXT NOT NULL,
  source_name TEXT NOT NULL,
  source_ref TEXT,
  source_row INTEGER,
  imported_at TEXT NOT NULL DEFAULT (datetime('now')),
  payload_json TEXT,
  UNIQUE(office_file_id,source_type,source_name,source_row),
  FOREIGN KEY(office_file_id) REFERENCES office_files(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS cases (
  id INTEGER PRIMARY KEY, external_id TEXT UNIQUE, office_file_no TEXT,
  court TEXT, court_file_no TEXT, case_type TEXT, status TEXT DEFAULT 'open',
  client_name TEXT, last_activity_at TEXT, synced_at TEXT,
  office_file_id INTEGER,
  FOREIGN KEY(office_file_id) REFERENCES office_files(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS parties (
  id INTEGER PRIMARY KEY, case_id INTEGER NOT NULL, external_id TEXT,
  name TEXT NOT NULL, role TEXT, is_client INTEGER DEFAULT 0,
  client_id INTEGER,
  FOREIGN KEY(case_id) REFERENCES cases(id) ON DELETE CASCADE,
  FOREIGN KEY(client_id) REFERENCES clients(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY, case_id INTEGER NOT NULL, external_id TEXT UNIQUE,
  document_type TEXT, title TEXT, document_date TEXT, local_path TEXT,
  sha256 TEXT, downloaded_at TEXT,
  FOREIGN KEY(case_id) REFERENCES cases(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS ix_documents_sha256 ON documents(sha256);

CREATE TABLE IF NOT EXISTS hearings (
  id INTEGER PRIMARY KEY, case_id INTEGER NOT NULL, external_id TEXT UNIQUE,
  starts_at TEXT, location TEXT, hearing_type TEXT, notes TEXT,
  FOREIGN KEY(case_id) REFERENCES cases(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY, case_id INTEGER, external_id TEXT UNIQUE,
  channel TEXT, barcode TEXT, recipient TEXT, document_title TEXT,
  issued_at TEXT, delivered_at TEXT, status TEXT, last_checked_at TEXT,
  FOREIGN KEY(case_id) REFERENCES cases(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS deadlines (
  id INTEGER PRIMARY KEY, case_id INTEGER, notification_id INTEGER,
  title TEXT NOT NULL, legal_basis TEXT, starts_at TEXT, due_at TEXT,
  calculation_json TEXT, confidence TEXT DEFAULT 'draft', lawyer_approved INTEGER DEFAULT 0,
  status TEXT DEFAULT 'open', source TEXT, approved_at TEXT, approved_by TEXT,
  FOREIGN KEY(case_id) REFERENCES cases(id) ON DELETE CASCADE,
  FOREIGN KEY(notification_id) REFERENCES notifications(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY,
  office_file_id INTEGER,
  case_id INTEGER,
  title TEXT NOT NULL,
  description TEXT,
  due_at TEXT,
  priority TEXT DEFAULT 'normal',
  status TEXT DEFAULT 'open',
  source TEXT DEFAULT 'manual',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  FOREIGN KEY(office_file_id) REFERENCES office_files(id) ON DELETE CASCADE,
  FOREIGN KEY(case_id) REFERENCES cases(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS powers_of_attorney (
  id INTEGER PRIMARY KEY,
  client_id INTEGER NOT NULL,
  notary TEXT,
  journal_no TEXT,
  issued_at TEXT,
  status TEXT DEFAULT 'active',
  fingerprint TEXT UNIQUE,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(client_id) REFERENCES clients(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS power_sources (
  id INTEGER PRIMARY KEY,
  power_id INTEGER NOT NULL,
  source_type TEXT NOT NULL,
  source_ref TEXT,
  local_path TEXT,
  observed_at TEXT NOT NULL DEFAULT (datetime('now')),
  metadata_json TEXT,
  FOREIGN KEY(power_id) REFERENCES powers_of_attorney(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_power_sources_identity
ON power_sources(power_id, source_type, COALESCE(source_ref,''), COALESCE(local_path,''));

CREATE TABLE IF NOT EXISTS power_case_links (
  power_id INTEGER NOT NULL,
  case_id INTEGER NOT NULL,
  linked_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(power_id, case_id),
  FOREIGN KEY(power_id) REFERENCES powers_of_attorney(id) ON DELETE CASCADE,
  FOREIGN KEY(case_id) REFERENCES cases(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS local_assets (
  id INTEGER PRIMARY KEY,
  sha256 TEXT UNIQUE,
  file_name TEXT NOT NULL,
  extension TEXT,
  size_bytes INTEGER,
  mime_hint TEXT,
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  suggested_client_id INTEGER,
  suggested_office_file_id INTEGER,
  classification TEXT,
  indexed_text TEXT,
  FOREIGN KEY(suggested_client_id) REFERENCES clients(id) ON DELETE SET NULL,
  FOREIGN KEY(suggested_office_file_id) REFERENCES office_files(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS asset_locations (
  id INTEGER PRIMARY KEY,
  asset_id INTEGER NOT NULL,
  local_path TEXT NOT NULL UNIQUE,
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  source_root TEXT,
  FOREIGN KEY(asset_id) REFERENCES local_assets(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS timeline_events (
  id INTEGER PRIMARY KEY,
  office_file_id INTEGER,
  case_id INTEGER,
  event_type TEXT NOT NULL,
  title TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  source TEXT,
  source_entity_type TEXT,
  source_entity_id TEXT,
  detail_json TEXT,
  UNIQUE(source_entity_type, source_entity_id, event_type),
  FOREIGN KEY(office_file_id) REFERENCES office_files(id) ON DELETE CASCADE,
  FOREIGN KEY(case_id) REFERENCES cases(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS archive_folders (
  id INTEGER PRIMARY KEY,
  root_path TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  court_category TEXT,
  folder_name TEXT NOT NULL,
  inferred_client TEXT,
  inferred_case_no TEXT,
  inferred_case_type TEXT,
  file_count INTEGER NOT NULL DEFAULT 0,
  last_scanned_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(root_path, relative_path)
);

CREATE TABLE IF NOT EXISTS archive_case_links (
  id INTEGER PRIMARY KEY,
  office_file_id INTEGER,
  case_id INTEGER,
  archive_folder_id INTEGER NOT NULL,
  confidence REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'suggested',
  reasons_json TEXT,
  verified_at TEXT,
  verified_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(case_id, archive_folder_id),
  FOREIGN KEY(office_file_id) REFERENCES office_files(id) ON DELETE CASCADE,
  FOREIGN KEY(case_id) REFERENCES cases(id) ON DELETE CASCADE,
  FOREIGN KEY(archive_folder_id) REFERENCES archive_folders(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS uyap_sync_profiles (
  case_id INTEGER PRIMARY KEY,
  sync_mode TEXT NOT NULL DEFAULT 'baseline_pending',
  baseline_completed_at TEXT,
  last_manifest_checked_at TEXT,
  last_delta_at TEXT,
  remote_document_count INTEGER NOT NULL DEFAULT 0,
  downloaded_count INTEGER NOT NULL DEFAULT 0,
  filed_count INTEGER NOT NULL DEFAULT 0,
  poll_interval_minutes INTEGER NOT NULL DEFAULT 30,
  auto_download_new INTEGER NOT NULL DEFAULT 1,
  archive_link_required INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(case_id) REFERENCES cases(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS uyap_remote_documents (
  id INTEGER PRIMARY KEY,
  case_id INTEGER NOT NULL,
  remote_document_id TEXT NOT NULL,
  remote_title TEXT,
  document_type TEXT,
  document_date TEXT,
  original_file_name TEXT,
  remote_hash TEXT,
  local_asset_id INTEGER,
  staging_path TEXT,
  filed_path TEXT,
  status TEXT NOT NULL DEFAULT 'discovered',
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  downloaded_at TEXT,
  filed_at TEXT,
  is_baseline INTEGER NOT NULL DEFAULT 0,
  metadata_json TEXT,
  UNIQUE(case_id, remote_document_id),
  FOREIGN KEY(case_id) REFERENCES cases(id) ON DELETE CASCADE,
  FOREIGN KEY(local_asset_id) REFERENCES local_assets(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS ix_uyap_remote_case_status ON uyap_remote_documents(case_id,status);

CREATE TABLE IF NOT EXISTS correspondence_requests (
  id INTEGER PRIMARY KEY,
  office_file_id INTEGER,
  case_id INTEGER,
  institution TEXT NOT NULL,
  subject TEXT NOT NULL,
  request_kind TEXT NOT NULL DEFAULT 'müzekkere',
  requested_at TEXT,
  sent_at TEXT,
  response_received_at TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  request_document_id INTEGER,
  response_document_id INTEGER,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(office_file_id) REFERENCES office_files(id) ON DELETE CASCADE,
  FOREIGN KEY(case_id) REFERENCES cases(id) ON DELETE CASCADE,
  FOREIGN KEY(request_document_id) REFERENCES uyap_remote_documents(id) ON DELETE SET NULL,
  FOREIGN KEY(response_document_id) REFERENCES uyap_remote_documents(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS ix_correspondence_open ON correspondence_requests(status,sent_at);

CREATE TABLE IF NOT EXISTS evidence_issues (
  id INTEGER PRIMARY KEY,
  office_file_id INTEGER NOT NULL,
  case_id INTEGER,
  issue_type TEXT NOT NULL DEFAULT 'vakıa',
  title TEXT NOT NULL,
  allegation_side TEXT,
  burden_side TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  notes TEXT,
  sort_order INTEGER NOT NULL DEFAULT 100,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(office_file_id) REFERENCES office_files(id) ON DELETE CASCADE,
  FOREIGN KEY(case_id) REFERENCES cases(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS evidence_links (
  id INTEGER PRIMARY KEY,
  evidence_issue_id INTEGER NOT NULL,
  link_type TEXT NOT NULL,
  evidence_role TEXT NOT NULL DEFAULT 'neutral',
  asset_id INTEGER,
  remote_document_id INTEGER,
  correspondence_id INTEGER,
  title TEXT,
  detail TEXT,
  status TEXT NOT NULL DEFAULT 'available',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(evidence_issue_id) REFERENCES evidence_issues(id) ON DELETE CASCADE,
  FOREIGN KEY(asset_id) REFERENCES local_assets(id) ON DELETE SET NULL,
  FOREIGN KEY(remote_document_id) REFERENCES uyap_remote_documents(id) ON DELETE SET NULL,
  FOREIGN KEY(correspondence_id) REFERENCES correspondence_requests(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS ix_evidence_issue ON evidence_links(evidence_issue_id,evidence_role);

CREATE TABLE IF NOT EXISTS scan_roots (
  id INTEGER PRIMARY KEY,
  path TEXT UNIQUE NOT NULL,
  enabled INTEGER DEFAULT 1,
  label TEXT,
  last_scanned_at TEXT
);

CREATE TABLE IF NOT EXISTS job_queue (
  id INTEGER PRIMARY KEY,
  job_type TEXT NOT NULL,
  fingerprint TEXT,
  payload_json TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  priority INTEGER NOT NULL DEFAULT 100,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  started_at TEXT,
  finished_at TEXT,
  error TEXT,
  result_json TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_job_active_fingerprint
ON job_queue(job_type, fingerprint)
WHERE fingerprint IS NOT NULL AND status IN ('queued','running');

CREATE TABLE IF NOT EXISTS sync_runs (
  id INTEGER PRIMARY KEY, source TEXT NOT NULL, started_at TEXT NOT NULL,
  finished_at TEXT, status TEXT, items_seen INTEGER DEFAULT 0,
  items_changed INTEGER DEFAULT 0, error TEXT
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY, occurred_at TEXT NOT NULL, actor TEXT NOT NULL,
  action TEXT NOT NULL, entity_type TEXT, entity_id TEXT, detail_json TEXT
);

CREATE TABLE IF NOT EXISTS uyap_endpoint_observations (
  id INTEGER PRIMARY KEY,
  method TEXT NOT NULL,
  host TEXT NOT NULL,
  path TEXT NOT NULL,
  status INTEGER,
  content_type TEXT,
  sample_keys_json TEXT,
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  hit_count INTEGER NOT NULL DEFAULT 1,
  UNIQUE(method,host,path)
);

CREATE TABLE IF NOT EXISTS uyap_endpoints (
  endpoint_key TEXT PRIMARY KEY,
  method TEXT NOT NULL,
  host TEXT NOT NULL,
  path TEXT NOT NULL,
  purpose TEXT,
  enabled INTEGER NOT NULL DEFAULT 0,
  min_interval_ms INTEGER NOT NULL DEFAULT 2200,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_verified_at TEXT
);

CREATE TABLE IF NOT EXISTS uyap_command_queue (
  id INTEGER PRIMARY KEY,
  command_type TEXT NOT NULL,
  endpoint_key TEXT,
  payload_json TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  priority INTEGER NOT NULL DEFAULT 100,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  not_before_ms INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  dispatched_at TEXT,
  finished_at TEXT,
  error TEXT,
  result_meta_json TEXT,
  FOREIGN KEY(endpoint_key) REFERENCES uyap_endpoints(endpoint_key) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS ix_uyap_queue_status ON uyap_command_queue(status,priority,id);

CREATE TABLE IF NOT EXISTS uyap_rate_state (
  id INTEGER PRIMARY KEY CHECK(id=1),
  last_dispatch_ms INTEGER NOT NULL DEFAULT 0,
  next_allowed_ms INTEGER NOT NULL DEFAULT 0,
  circuit_open_until_ms INTEGER NOT NULL DEFAULT 0,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  last_status INTEGER,
  state TEXT NOT NULL DEFAULT 'ready',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO uyap_rate_state(id) VALUES(1);

CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY,
  client_id INTEGER,
  office_file_id INTEGER,
  case_id INTEGER,
  asset_id INTEGER,
  hearing_id INTEGER,
  title TEXT,
  body TEXT NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(client_id) REFERENCES clients(id) ON DELETE CASCADE,
  FOREIGN KEY(office_file_id) REFERENCES office_files(id) ON DELETE CASCADE,
  FOREIGN KEY(case_id) REFERENCES cases(id) ON DELETE CASCADE,
  FOREIGN KEY(asset_id) REFERENCES local_assets(id) ON DELETE CASCADE,
  FOREIGN KEY(hearing_id) REFERENCES hearings(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS document_analysis (
  asset_id INTEGER PRIMARY KEY,
  document_kind TEXT,
  raw_text TEXT,
  extracted_json TEXT,
  sections_json TEXT,
  style_profile_json TEXT,
  template_score REAL DEFAULT 0,
  analysis_status TEXT NOT NULL DEFAULT 'pending',
  engine_version TEXT,
  analyzed_at TEXT,
  error TEXT,
  FOREIGN KEY(asset_id) REFERENCES local_assets(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id INTEGER PRIMARY KEY,
  asset_id INTEGER NOT NULL,
  office_file_id INTEGER,
  case_id INTEGER,
  chunk_no INTEGER NOT NULL,
  heading TEXT,
  text TEXT NOT NULL,
  normalized_text TEXT NOT NULL,
  metadata_json TEXT,
  UNIQUE(asset_id,chunk_no),
  FOREIGN KEY(asset_id) REFERENCES local_assets(id) ON DELETE CASCADE,
  FOREIGN KEY(office_file_id) REFERENCES office_files(id) ON DELETE CASCADE,
  FOREIGN KEY(case_id) REFERENCES cases(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS ix_knowledge_office_file ON knowledge_chunks(office_file_id,case_id);

CREATE TABLE IF NOT EXISTS petition_templates (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  petition_type TEXT,
  source_asset_id INTEGER,
  is_office_style INTEGER NOT NULL DEFAULT 0,
  style_profile_json TEXT,
  structure_json TEXT,
  header_text TEXT,
  footer_text TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(source_asset_id) REFERENCES local_assets(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS drafts (
  id INTEGER PRIMARY KEY,
  office_file_id INTEGER,
  case_id INTEGER,
  client_id INTEGER,
  draft_type TEXT NOT NULL,
  title TEXT NOT NULL,
  content_md TEXT,
  content_text TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  template_id INTEGER,
  source_refs_json TEXT,
  udf_path TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  parent_draft_id INTEGER,
  created_by TEXT NOT NULL DEFAULT 'lawyer',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(office_file_id) REFERENCES office_files(id) ON DELETE CASCADE,
  FOREIGN KEY(case_id) REFERENCES cases(id) ON DELETE CASCADE,
  FOREIGN KEY(client_id) REFERENCES clients(id) ON DELETE SET NULL,
  FOREIGN KEY(template_id) REFERENCES petition_templates(id) ON DELETE SET NULL,
  FOREIGN KEY(parent_draft_id) REFERENCES drafts(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS hearing_packs (
  id INTEGER PRIMARY KEY,
  office_file_id INTEGER,
  case_id INTEGER,
  hearing_id INTEGER,
  title TEXT NOT NULL,
  summary_md TEXT,
  checklist_json TEXT,
  source_refs_json TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  generated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(office_file_id) REFERENCES office_files(id) ON DELETE CASCADE,
  FOREIGN KEY(case_id) REFERENCES cases(id) ON DELETE CASCADE,
  FOREIGN KEY(hearing_id) REFERENCES hearings(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS communications (
  id INTEGER PRIMARY KEY,
  client_id INTEGER,
  office_file_id INTEGER,
  channel TEXT NOT NULL,
  direction TEXT,
  occurred_at TEXT NOT NULL,
  subject TEXT,
  body TEXT,
  external_ref TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(client_id) REFERENCES clients(id) ON DELETE SET NULL,
  FOREIGN KEY(office_file_id) REFERENCES office_files(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS ix_communications_client ON communications(client_id,occurred_at);

CREATE TABLE IF NOT EXISTS fee_contracts (
  id INTEGER PRIMARY KEY,
  client_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  signed_at TEXT,
  total_fee REAL,
  currency TEXT NOT NULL DEFAULT 'TRY',
  vat_included INTEGER NOT NULL DEFAULT 0,
  payment_terms TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  document_asset_id INTEGER,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(client_id) REFERENCES clients(id) ON DELETE CASCADE,
  FOREIGN KEY(document_asset_id) REFERENCES local_assets(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS fee_contract_file_links (
  contract_id INTEGER NOT NULL,
  office_file_id INTEGER NOT NULL,
  PRIMARY KEY(contract_id,office_file_id),
  FOREIGN KEY(contract_id) REFERENCES fee_contracts(id) ON DELETE CASCADE,
  FOREIGN KEY(office_file_id) REFERENCES office_files(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS financial_entries (
  id INTEGER PRIMARY KEY,
  client_id INTEGER,
  office_file_id INTEGER,
  contract_id INTEGER,
  entry_type TEXT NOT NULL,
  amount REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'TRY',
  description TEXT,
  due_at TEXT,
  paid_at TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  source TEXT DEFAULT 'manual',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(client_id) REFERENCES clients(id) ON DELETE SET NULL,
  FOREIGN KEY(office_file_id) REFERENCES office_files(id) ON DELETE SET NULL,
  FOREIGN KEY(contract_id) REFERENCES fee_contracts(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS ix_financial_client ON financial_entries(client_id,office_file_id,status);

CREATE TABLE IF NOT EXISTS client_aliases (
  id INTEGER PRIMARY KEY,
  client_id INTEGER NOT NULL,
  alias TEXT NOT NULL,
  normalized_alias TEXT NOT NULL,
  source TEXT,
  UNIQUE(client_id,normalized_alias),
  FOREIGN KEY(client_id) REFERENCES clients(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS merge_candidates (
  id INTEGER PRIMARY KEY,
  entity_type TEXT NOT NULL,
  left_id INTEGER NOT NULL,
  right_id INTEGER NOT NULL,
  score REAL NOT NULL,
  reasons_json TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_at TEXT,
  UNIQUE(entity_type,left_id,right_id)
);

CREATE TABLE IF NOT EXISTS client_relations (
  id INTEGER PRIMARY KEY,
  client_id INTEGER NOT NULL,
  related_client_id INTEGER,
  related_name TEXT,
  relation_type TEXT NOT NULL,
  office_file_id INTEGER,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(client_id) REFERENCES clients(id) ON DELETE CASCADE,
  FOREIGN KEY(related_client_id) REFERENCES clients(id) ON DELETE SET NULL,
  FOREIGN KEY(office_file_id) REFERENCES office_files(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS ai_permissions (
  capability TEXT PRIMARY KEY,
  level TEXT NOT NULL DEFAULT 'suggest',
  requires_approval INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO ai_permissions(capability,level,requires_approval) VALUES
  ('read_local_data','allow',0),
  ('draft_document','allow',0),
  ('suggest_data_change','allow',1),
  ('write_data','suggest',1),
  ('approve_deadline','deny',1),
  ('send_uyap','deny',1),
  ('sign_document','deny',1),
  ('send_message','suggest',1);

CREATE TABLE IF NOT EXISTS ai_action_log (
  id INTEGER PRIMARY KEY,
  capability TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  status TEXT NOT NULL,
  detail_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  approved_at TEXT,
  approved_by TEXT
);

CREATE TABLE IF NOT EXISTS service_health (
  service TEXT PRIMARY KEY,
  state TEXT NOT NULL,
  last_heartbeat_at TEXT,
  restart_count INTEGER NOT NULL DEFAULT 0,
  detail_json TEXT
);

CREATE TABLE IF NOT EXISTS legal_calendar_days (
  date TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  day_type TEXT NOT NULL DEFAULT 'holiday',
  source TEXT,
  verified_at TEXT
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY, value TEXT, updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS search_index (
  id INTEGER PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  title TEXT NOT NULL,
  subtitle TEXT,
  body TEXT,
  normalized_text TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(entity_type, entity_id)
);
CREATE INDEX IF NOT EXISTS ix_search_entity ON search_index(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS ix_search_title ON search_index(title);

CREATE TABLE IF NOT EXISTS case_relations (
  id INTEGER PRIMARY KEY,
  source_case_id INTEGER NOT NULL,
  target_case_id INTEGER,
  relation_type TEXT NOT NULL,
  relation_status TEXT NOT NULL DEFAULT 'unresolved',
  source TEXT NOT NULL DEFAULT 'system',
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(source_case_id, relation_type),
  FOREIGN KEY(source_case_id) REFERENCES cases(id) ON DELETE CASCADE,
  FOREIGN KEY(target_case_id) REFERENCES cases(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS ix_case_relations_target ON case_relations(target_case_id,relation_type);
`);

function columns(table) {
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(r => r.name));
}
function ensureColumn(table, name, ddl) {
  if (!columns(table).has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${ddl}`);
}
ensureColumn("cases","office_file_id","INTEGER REFERENCES office_files(id) ON DELETE SET NULL");
ensureColumn("cases","uyap_dosya_id","TEXT");
ensureColumn("cases","uyap_birim_id","TEXT");
ensureColumn("cases","uyap_metadata_json","TEXT");
ensureColumn("clients","birth_date","TEXT");
ensureColumn("clients","address","TEXT");
ensureColumn("parties","client_id","INTEGER REFERENCES clients(id) ON DELETE SET NULL");
ensureColumn("deadlines","status","TEXT DEFAULT 'open'");
ensureColumn("deadlines","source","TEXT");
ensureColumn("deadlines","approved_at","TEXT");
ensureColumn("deadlines","approved_by","TEXT");
ensureColumn("uyap_endpoint_observations","sample_request_json","TEXT");
ensureColumn("uyap_endpoint_observations","sample_response_json","TEXT");
ensureColumn("uyap_command_queue","result_json","TEXT");
ensureColumn("uyap_remote_documents","stable_key","TEXT");
ensureColumn("local_assets","original_extension","TEXT");
ensureColumn("local_assets","archive_extension","TEXT");
ensureColumn("local_assets","archive_policy","TEXT");
ensureColumn("local_assets","archive_path","TEXT");
ensureColumn("local_assets","source_container","TEXT");
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS ux_uyap_remote_case_stable ON uyap_remote_documents(case_id,stable_key)");

db.prepare("INSERT OR REPLACE INTO schema_meta(key,value) VALUES('version',?)").run("9");
module.exports = db;
