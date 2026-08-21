PRAGMA foreign_keys = ON;

-- Phase C is additive. Phase B agreement versions, acceptances, and audit events
-- remain immutable and are not reconstructed or rewritten.
CREATE TABLE environment_settings (
  setting_key TEXT PRIMARY KEY,
  setting_value TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE identity_links (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('cloudflare_access')),
  provider_subject_hash TEXT NOT NULL,
  user_type TEXT NOT NULL CHECK (user_type IN ('admin_user','client_user')),
  user_id TEXT NOT NULL,
  email_normalized TEXT NOT NULL,
  last_authenticated_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (provider, provider_subject_hash),
  UNIQUE (provider, user_type, user_id)
);

ALTER TABLE access_sessions ADD COLUMN identity_link_id TEXT REFERENCES identity_links(id);
ALTER TABLE access_sessions ADD COLUMN authentication_method TEXT;

ALTER TABLE enrollments ADD COLUMN activation_mode TEXT NOT NULL DEFAULT 'manual'
  CHECK (activation_mode IN ('automatic','manual','scheduled'));
ALTER TABLE enrollments ADD COLUMN onboarding_ready INTEGER NOT NULL DEFAULT 0
  CHECK (onboarding_ready IN (0,1));
ALTER TABLE enrollments ADD COLUMN activation_scheduled_at TEXT;
ALTER TABLE enrollments ADD COLUMN portal_activated_at TEXT;
ALTER TABLE enrollments ADD COLUMN portal_deactivated_at TEXT;

CREATE TABLE outbound_message_events (
  id TEXT PRIMARY KEY,
  message_type TEXT NOT NULL CHECK (message_type IN (
    'agreement_invitation','agreement_accepted','payment_confirmation',
    'payment_failure','portal_activation','onboarding_instructions'
  )),
  idempotency_key TEXT NOT NULL UNIQUE,
  client_id TEXT REFERENCES clients(id),
  agreement_id TEXT REFERENCES agreements(id),
  enrollment_id TEXT REFERENCES enrollments(id),
  recipient_email_normalized TEXT NOT NULL,
  provider_message_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending','sent','failed','suppressed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error_code TEXT,
  created_at TEXT NOT NULL,
  sent_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_identity_links_user ON identity_links(user_type, user_id, revoked_at);
CREATE INDEX idx_outbound_messages_status ON outbound_message_events(status, created_at);
CREATE INDEX idx_enrollments_portal_activation ON enrollments(activation_mode, portal_activated_at, activation_scheduled_at);

CREATE TRIGGER identity_links_subject_immutable
BEFORE UPDATE OF provider, provider_subject_hash, user_type, user_id ON identity_links
BEGIN
  SELECT RAISE(ABORT, 'identity link subject and owner are immutable');
END;

CREATE TRIGGER environment_name_immutable
BEFORE UPDATE OF setting_value ON environment_settings
WHEN OLD.setting_key = 'environment'
BEGIN
  SELECT RAISE(ABORT, 'database environment marker is immutable');
END;
