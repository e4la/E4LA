PRAGMA foreign_keys = ON;

-- Additive only. This table is the architectural safeguard requested after a real prior
-- incident: E4LA previously had to cancel a membership/subscription because a client said
-- they never approved recurring billing. Its existence is what makes "recurring Stripe
-- billing may only be created after a real, matching consent record exists" enforceable
-- in code rather than a policy someone has to remember.

CREATE TABLE recurring_service_consents (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id),
  project_id TEXT REFERENCES projects(id),
  quote_id TEXT REFERENCES quotes(id),
  agreement_id TEXT REFERENCES agreements(id),
  service_id TEXT NOT NULL REFERENCES services(id),
  billing_amount INTEGER NOT NULL,
  billing_frequency TEXT NOT NULL CHECK (billing_frequency IN ('weekly','biweekly','monthly','quarterly','annual')),
  start_date TEXT NOT NULL,
  renewal_behavior TEXT NOT NULL DEFAULT 'auto_renew_until_cancelled' CHECK (renewal_behavior IN ('auto_renew_until_cancelled','fixed_term_then_stop')),
  cancellation_terms_version TEXT NOT NULL,
  consent_text_version TEXT NOT NULL,
  -- Deliberately excludes 'client_viewer' and 'e4la_admin'/'e4la_collaborator' from this
  -- CHECK - a viewer or an admin acting alone can never be the actor on a valid consent row.
  actor_type TEXT NOT NULL CHECK (actor_type IN ('client_owner','authorized_signer')),
  actor_id TEXT NOT NULL,
  approved_at TEXT NOT NULL,
  consent_evidence TEXT NOT NULL, -- JSON: request id, user agent, session id - same evidentiary spirit as agreement_acceptances
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled','superseded')),
  cancelled_at TEXT,
  stripe_subscription_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_recurring_consents_client ON recurring_service_consents(client_id, status);
CREATE INDEX idx_recurring_consents_service ON recurring_service_consents(service_id, status);

-- The accepted terms (amount, frequency, service, whose consent it was, what they agreed
-- to) are immutable for the exact same reason agreement_acceptances is immutable: this is
-- the evidence that a real client actually approved these specific terms. A price or
-- frequency change is a NEW consent (a new row, status='superseded' on the old one), never
-- a rewrite of what was actually agreed to. Only `status`/`cancelled_at`/`stripe_subscription_id`/
-- `updated_at` may still change after creation.
CREATE TRIGGER recurring_consents_immutable_terms
BEFORE UPDATE OF client_id, project_id, quote_id, agreement_id, service_id, billing_amount,
  billing_frequency, start_date, renewal_behavior, cancellation_terms_version,
  consent_text_version, actor_type, actor_id, approved_at, consent_evidence, created_at
ON recurring_service_consents
BEGIN
  SELECT RAISE(ABORT, 'recurring consent terms are immutable once approved; only status/cancellation/subscription linkage may change - a changed price or frequency requires a new consent record');
END;

CREATE TRIGGER recurring_consents_no_delete
BEFORE DELETE ON recurring_service_consents
BEGIN
  SELECT RAISE(ABORT, 'recurring consent records are append-only evidence and cannot be deleted');
END;
