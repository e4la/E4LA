PRAGMA foreign_keys = ON;

-- Additive only. Publishing accounts/jobs and performance metrics, all keyed back to
-- content_platform_variants from 0008. No publishing-platform OAuth credential is required
-- for this schema to exist - publishing_accounts.connection_status defaults to
-- 'not_connected' and every job created against a disconnected account must fail closed
-- with an honest status, never a fabricated success.

CREATE TABLE publishing_accounts (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id),
  platform TEXT NOT NULL CHECK (platform IN ('instagram','facebook','google_business_profile','tiktok')),
  account_label TEXT NOT NULL,
  connection_status TEXT NOT NULL DEFAULT 'not_connected' CHECK (connection_status IN ('not_connected','connected','expired','revoked','error')),
  external_account_id TEXT,
  connected_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (client_id, platform, account_label)
);

-- "API request sent" and "published" are deliberately different states here - status
-- moves to 'submitted' when the adapter call is made, and only to 'published' once the
-- platform actually confirms it, with 'verified_live' reserved for an explicit follow-up
-- check. A publishing_jobs row must never be created for a content_platform_variant whose
-- own status isn't already 'ready'/'scheduled' - enforced at the application layer,
-- checked by the required "publishing before approval rejected" regression test.
CREATE TABLE publishing_jobs (
  id TEXT PRIMARY KEY,
  content_platform_variant_id TEXT NOT NULL REFERENCES content_platform_variants(id),
  publishing_account_id TEXT REFERENCES publishing_accounts(id),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','submitted','published','verification_pending','verified_live','failed')),
  external_post_id TEXT,
  submitted_at TEXT,
  published_at TEXT,
  verified_at TEXT,
  failure_code TEXT,
  failure_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- metric_class deliberately keeps direct/assisted/engagement separate rows rather than one
-- blended "performance" number - see functions/_shared/content-metrics.js and the
-- Performance Overview's own category separation already established in the client portal.
CREATE TABLE content_metrics (
  id TEXT PRIMARY KEY,
  publishing_job_id TEXT NOT NULL REFERENCES publishing_jobs(id),
  metric_class TEXT NOT NULL CHECK (metric_class IN ('direct','assisted','engagement')),
  metric_key TEXT NOT NULL,
  metric_value TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_publishing_accounts_client ON publishing_accounts(client_id, platform);
CREATE INDEX idx_publishing_jobs_variant ON publishing_jobs(content_platform_variant_id);
CREATE INDEX idx_publishing_jobs_account ON publishing_jobs(publishing_account_id, status);
CREATE INDEX idx_content_metrics_job ON content_metrics(publishing_job_id, metric_class);
