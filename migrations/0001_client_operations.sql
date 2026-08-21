PRAGMA foreign_keys = ON;

CREATE TABLE clients (
  id TEXT PRIMARY KEY,
  lifecycle_status TEXT NOT NULL DEFAULT 'prospect' CHECK (lifecycle_status IN (
    'prospect','qualified','agreement_prepared','agreement_sent','agreement_viewed',
    'agreement_accepted','payment_initiated','payment_confirmed','active','project_active',
    'work_in_progress','reporting','completed','ongoing','retainer','archived'
  )),
  legal_name TEXT NOT NULL,
  display_name TEXT,
  billing_email TEXT,
  phone TEXT,
  billing_address_json TEXT,
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE client_users (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id),
  email_normalized TEXT NOT NULL,
  full_name TEXT NOT NULL,
  title TEXT,
  role TEXT NOT NULL CHECK (role IN ('client_owner','authorized_signer','client_viewer')),
  access_status TEXT NOT NULL DEFAULT 'invited' CHECK (access_status IN ('invited','active','disabled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (client_id, email_normalized)
);

CREATE TABLE admin_users (
  id TEXT PRIMARY KEY,
  email_normalized TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('e4la_admin','e4la_collaborator')),
  access_status TEXT NOT NULL DEFAULT 'invited' CHECK (access_status IN ('invited','active','disabled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE admin_project_access (
  admin_user_id TEXT NOT NULL REFERENCES admin_users(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  permission_level TEXT NOT NULL DEFAULT 'contributor' CHECK (permission_level IN ('viewer','contributor','manager')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (admin_user_id, project_id)
);

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id),
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN (
    'planned','active','client_action_required','paused','completed','retainer','archived'
  )),
  current_phase TEXT,
  start_date TEXT,
  target_end_date TEXT,
  summary TEXT,
  client_visible INTEGER NOT NULL DEFAULT 0 CHECK (client_visible IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE project_milestones (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','in_progress','blocked','completed','cancelled')),
  target_date TEXT,
  completed_at TEXT,
  publication_status TEXT NOT NULL DEFAULT 'internal' CHECK (publication_status IN ('internal','reviewed','approved','published','withdrawn')),
  published_at TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE project_updates (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  update_type TEXT NOT NULL DEFAULT 'progress' CHECK (update_type IN ('progress','decision','client_request','reporting')),
  publication_status TEXT NOT NULL DEFAULT 'internal' CHECK (publication_status IN ('internal','reviewed','approved','published','withdrawn')),
  published_at TEXT,
  created_by_admin_id TEXT REFERENCES admin_users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE deliverables (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  title TEXT NOT NULL,
  description TEXT,
  deliverable_type TEXT NOT NULL DEFAULT 'asset' CHECK (deliverable_type IN ('asset','report','analysis','document','link')),
  storage_key TEXT,
  external_url TEXT,
  publication_status TEXT NOT NULL DEFAULT 'internal' CHECK (publication_status IN ('internal','reviewed','approved','published','withdrawn')),
  published_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE agreements (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  status TEXT NOT NULL DEFAULT 'prepared' CHECK (status IN (
    'draft','prepared','sent','viewed','accepted','payment_pending','enrolled','completed','expired','superseded','void'
  )),
  program_name TEXT NOT NULL,
  current_version_id TEXT,
  accepted_version_id TEXT,
  expires_at TEXT,
  sent_at TEXT,
  viewed_at TEXT,
  accepted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE agreement_versions (
  id TEXT PRIMARY KEY,
  agreement_id TEXT NOT NULL REFERENCES agreements(id),
  version_number INTEGER NOT NULL,
  legal_document_hash TEXT NOT NULL,
  rendered_agreement_snapshot TEXT NOT NULL,
  agreement_summary_json TEXT NOT NULL,
  commercial_terms_json TEXT NOT NULL,
  acknowledgement_clauses_json TEXT NOT NULL,
  created_by_admin_id TEXT REFERENCES admin_users(id),
  created_at TEXT NOT NULL,
  UNIQUE (agreement_id, version_number),
  UNIQUE (agreement_id, legal_document_hash)
);

CREATE TABLE payment_plans (
  id TEXT PRIMARY KEY,
  agreement_version_id TEXT NOT NULL REFERENCES agreement_versions(id),
  plan_code TEXT NOT NULL,
  display_name TEXT NOT NULL,
  total_contract_value INTEGER NOT NULL CHECK (total_contract_value >= 0),
  currency TEXT NOT NULL DEFAULT 'usd',
  installment_count INTEGER NOT NULL CHECK (installment_count > 0),
  interval_unit TEXT CHECK (interval_unit IN ('one_time','week','month')),
  interval_count INTEGER,
  installment_schedule_json TEXT NOT NULL,
  stripe_initial_price_id TEXT,
  stripe_remaining_price_id TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL,
  UNIQUE (agreement_version_id, plan_code)
);

CREATE TABLE agreement_invites (
  id TEXT PRIMARY KEY,
  agreement_id TEXT NOT NULL REFERENCES agreements(id),
  agreement_version_id TEXT NOT NULL REFERENCES agreement_versions(id),
  intended_email_normalized TEXT,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  revoked_at TEXT,
  created_by_admin_id TEXT REFERENCES admin_users(id),
  created_at TEXT NOT NULL
);

CREATE TABLE access_sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  csrf_hash TEXT NOT NULL,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('agreement_signer','client_user','admin_user')),
  actor_id TEXT,
  client_id TEXT REFERENCES clients(id),
  agreement_id TEXT REFERENCES agreements(id),
  role TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  rotated_from_session_id TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE TABLE agreement_acceptances (
  id TEXT PRIMARY KEY,
  agreement_id TEXT NOT NULL REFERENCES agreements(id),
  agreement_version_id TEXT NOT NULL REFERENCES agreement_versions(id),
  client_id TEXT NOT NULL REFERENCES clients(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  payment_plan_id TEXT NOT NULL REFERENCES payment_plans(id),
  legal_document_hash TEXT NOT NULL,
  rendered_agreement_snapshot TEXT NOT NULL,
  total_contract_value INTEGER NOT NULL,
  installment_amounts_json TEXT NOT NULL,
  installment_dates_json TEXT NOT NULL,
  acknowledged_clause_ids_json TEXT NOT NULL,
  authorized_signer_name TEXT NOT NULL,
  authorized_signer_role TEXT NOT NULL,
  signer_company TEXT NOT NULL,
  typed_acceptance TEXT NOT NULL,
  authority_confirmed INTEGER NOT NULL CHECK (authority_confirmed = 1),
  accepted_at_utc TEXT NOT NULL,
  request_id TEXT NOT NULL,
  user_agent TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (agreement_id, agreement_version_id)
);

CREATE TABLE enrollments (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  agreement_id TEXT NOT NULL REFERENCES agreements(id),
  acceptance_id TEXT NOT NULL REFERENCES agreement_acceptances(id),
  payment_plan_id TEXT NOT NULL REFERENCES payment_plans(id),
  status TEXT NOT NULL DEFAULT 'accepted' CHECK (status IN (
    'accepted','checkout_pending','payment_processing','first_payment_confirmed','schedule_pending',
    'schedule_active','payment_failed','payment_action_required','paid','activated','completed','cancelled','attention_required'
  )),
  portal_activation_policy TEXT NOT NULL DEFAULT 'first_payment_confirmed' CHECK (portal_activation_policy IN ('first_payment_confirmed','paid_in_full','manual')),
  next_payment_due_at TEXT,
  activated_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (agreement_id)
);

CREATE TABLE payment_installments (
  id TEXT PRIMARY KEY,
  enrollment_id TEXT NOT NULL REFERENCES enrollments(id),
  installment_number INTEGER NOT NULL CHECK (installment_number > 0),
  amount INTEGER NOT NULL CHECK (amount >= 0),
  currency TEXT NOT NULL DEFAULT 'usd',
  due_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','checkout_pending','processing','paid','failed','action_required','waived')),
  stripe_payment_intent_id TEXT,
  stripe_invoice_id TEXT,
  paid_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (enrollment_id, installment_number)
);

CREATE TABLE stripe_objects (
  id TEXT PRIMARY KEY,
  enrollment_id TEXT NOT NULL REFERENCES enrollments(id),
  stripe_object_type TEXT NOT NULL CHECK (stripe_object_type IN ('customer','checkout_session','payment_intent','invoice','subscription_schedule','subscription','portal_session')),
  stripe_object_id TEXT NOT NULL,
  livemode INTEGER NOT NULL DEFAULT 0 CHECK (livemode IN (0,1)),
  status TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (stripe_object_type, stripe_object_id)
);

CREATE TABLE portal_documents (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id),
  project_id TEXT REFERENCES projects(id),
  agreement_id TEXT REFERENCES agreements(id),
  title TEXT NOT NULL,
  document_type TEXT NOT NULL CHECK (document_type IN ('agreement','report','invoice','receipt','deliverable','other')),
  storage_key TEXT,
  external_url TEXT,
  publication_status TEXT NOT NULL DEFAULT 'internal' CHECK (publication_status IN ('internal','reviewed','approved','published','withdrawn')),
  published_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('system','agreement_signer','client_user','admin_user','stripe')),
  actor_id TEXT,
  client_id TEXT REFERENCES clients(id),
  project_id TEXT REFERENCES projects(id),
  agreement_id TEXT REFERENCES agreements(id),
  enrollment_id TEXT REFERENCES enrollments(id),
  related_entity_type TEXT,
  related_entity_id TEXT,
  request_id TEXT,
  event_data_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE processed_webhook_events (
  provider TEXT NOT NULL,
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  livemode INTEGER NOT NULL DEFAULT 0 CHECK (livemode IN (0,1)),
  status TEXT NOT NULL CHECK (status IN ('processing','processed','failed')),
  attempts INTEGER NOT NULL DEFAULT 1,
  last_error TEXT,
  received_at TEXT NOT NULL,
  processed_at TEXT,
  PRIMARY KEY (provider, event_id)
);

CREATE TABLE request_rate_limits (
  bucket_key TEXT PRIMARY KEY,
  window_started_at INTEGER NOT NULL,
  request_count INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX idx_clients_lifecycle ON clients(lifecycle_status);
CREATE INDEX idx_projects_client ON projects(client_id, status);
CREATE INDEX idx_admin_project_access_project ON admin_project_access(project_id, admin_user_id);
CREATE INDEX idx_agreements_client_status ON agreements(client_id, status);
CREATE INDEX idx_agreement_invites_agreement ON agreement_invites(agreement_id, expires_at);
CREATE INDEX idx_sessions_token_expiry ON access_sessions(token_hash, expires_at);
CREATE INDEX idx_enrollments_client_status ON enrollments(client_id, status);
CREATE INDEX idx_payment_installments_enrollment_due ON payment_installments(enrollment_id, due_at, status);
CREATE INDEX idx_milestones_project_publication ON project_milestones(project_id, publication_status, sort_order);
CREATE INDEX idx_updates_project_publication ON project_updates(project_id, publication_status, published_at);
CREATE INDEX idx_deliverables_project_publication ON deliverables(project_id, publication_status, published_at);
CREATE INDEX idx_audit_events_client_time ON audit_events(client_id, created_at);
CREATE INDEX idx_audit_events_agreement_time ON audit_events(agreement_id, created_at);

CREATE TRIGGER agreement_acceptances_immutable_update
BEFORE UPDATE ON agreement_acceptances
BEGIN
  SELECT RAISE(ABORT, 'agreement acceptances are immutable');
END;

CREATE TRIGGER agreement_acceptances_immutable_delete
BEFORE DELETE ON agreement_acceptances
BEGIN
  SELECT RAISE(ABORT, 'agreement acceptances are immutable');
END;

CREATE TRIGGER agreement_versions_immutable_update
BEFORE UPDATE ON agreement_versions
BEGIN
  SELECT RAISE(ABORT, 'agreement versions are immutable');
END;

CREATE TRIGGER agreement_versions_immutable_delete
BEFORE DELETE ON agreement_versions
BEGIN
  SELECT RAISE(ABORT, 'agreement versions are immutable');
END;

CREATE TRIGGER audit_events_append_only_update
BEFORE UPDATE ON audit_events
BEGIN
  SELECT RAISE(ABORT, 'audit events are append-only');
END;

CREATE TRIGGER audit_events_append_only_delete
BEFORE DELETE ON audit_events
BEGIN
  SELECT RAISE(ABORT, 'audit events are append-only');
END;
