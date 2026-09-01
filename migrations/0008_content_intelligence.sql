PRAGMA foreign_keys = ON;

-- Additive only. Introduces the Content Intelligence data model: a versioned, per-client
-- "brand brain" (AI context is always client-scoped by construction - every table here
-- carries client_id directly, not just transitively through a join, specifically so every
-- query can filter on it without a multi-hop join that a bug could get wrong), content
-- plans/items with an explicit lifecycle, source/claim verification, and approval history.
-- No AI provider, Adobe, or publishing-platform credential is required for this schema to
-- exist and be useful - manual/assisted content operation works entirely on this data model.

CREATE TABLE brand_brains (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id),
  version_number INTEGER NOT NULL,
  business_description TEXT,
  services_summary TEXT,
  locations TEXT,
  target_audience TEXT,
  customer_problems TEXT,
  goals TEXT,
  brand_voice TEXT,
  preferred_language TEXT NOT NULL DEFAULT 'en',
  forbidden_phrases_json TEXT NOT NULL DEFAULT '[]',
  forbidden_claims_json TEXT NOT NULL DEFAULT '[]',
  visual_direction TEXT,
  content_pillars_json TEXT NOT NULL DEFAULT '[]',
  ctas_json TEXT NOT NULL DEFAULT '[]',
  platform_rules_json TEXT NOT NULL DEFAULT '{}',
  approval_rules_json TEXT NOT NULL DEFAULT '{}',
  compliance_risk_notes TEXT,
  competitor_notes TEXT,
  publishing_cadence TEXT,
  kpis_json TEXT NOT NULL DEFAULT '[]',
  -- Per-client automation policy. auto_publish_approved_policy must never be the default
  -- for a newly created brand brain - the application layer, not this schema, is
  -- responsible for refusing to set it without both an E4LA policy flag and client
  -- agreement language actually authorizing it (see functions/_shared/content.js).
  automation_mode TEXT NOT NULL DEFAULT 'manual' CHECK (automation_mode IN ('manual','assisted','client_approval','auto_publish_approved_policy')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_by_admin_id TEXT REFERENCES admin_users(id),
  created_at TEXT NOT NULL,
  UNIQUE (client_id, version_number)
);

CREATE TABLE content_plans (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id),
  project_id TEXT REFERENCES projects(id),
  brand_brain_id TEXT REFERENCES brand_brains(id),
  name TEXT NOT NULL,
  period_start TEXT,
  period_end TEXT,
  -- 'client_approved' on the PLAN is deliberately distinct from an individual content
  -- item's own 'approved' status (see content_items.status) - approving a plan's shape
  -- and cadence is not the same as pre-approving every post in it. Enforced at the
  -- application layer: publishing a content item never reads content_plans.status.
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','internal_approved','sent_to_client','client_approved','active','archived')),
  created_by_admin_id TEXT REFERENCES admin_users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE content_sources (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id),
  source_type TEXT NOT NULL CHECK (source_type IN ('internal_expert','search_demand','customer_question','current_verified_source','url_reference')),
  expert_name TEXT,
  recording_reference TEXT,
  captured_at TEXT,
  insight TEXT,
  url TEXT,
  verification_needed INTEGER NOT NULL DEFAULT 1 CHECK (verification_needed IN (0,1)),
  verification_status TEXT NOT NULL DEFAULT 'unverified' CHECK (verification_status IN ('unverified','verified','rejected')),
  created_by_admin_id TEXT REFERENCES admin_users(id),
  created_at TEXT NOT NULL
);

CREATE TABLE content_items (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id),
  content_plan_id TEXT REFERENCES content_plans(id),
  topic TEXT NOT NULL,
  objective TEXT,
  audience TEXT,
  pillar TEXT,
  master_copy TEXT,
  cta TEXT,
  scheduled_date TEXT,
  status TEXT NOT NULL DEFAULT 'idea' CHECK (status IN (
    'idea','researched','verified','drafting','design_ready','e4la_review','e4la_approved',
    'client_review','approved','scheduled','publishing','published','verified_live',
    'rejected','revision_requested','blocked','publishing_failed','withdrawn','archived'
  )),
  risk_level TEXT NOT NULL DEFAULT 'green' CHECK (risk_level IN ('green','yellow','red')),
  internal_notes TEXT,
  client_visible_notes TEXT,
  created_by_admin_id TEXT REFERENCES admin_users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE content_claims (
  id TEXT PRIMARY KEY,
  content_item_id TEXT NOT NULL REFERENCES content_items(id),
  claim_text TEXT NOT NULL,
  source_id TEXT REFERENCES content_sources(id),
  risk_level TEXT NOT NULL DEFAULT 'yellow' CHECK (risk_level IN ('green','yellow','red')),
  -- A RED claim can reach 'verified' here, but the application layer must never let a
  -- content_item with an unresolved/unverified RED claim reach status='approved' - a URL
  -- alone is not verification (verification_status must be set by a human/process
  -- decision referencing an actual source_id, not merely having a url field populated).
  verification_status TEXT NOT NULL DEFAULT 'unverified' CHECK (verification_status IN ('unverified','verified','insufficient_evidence','rejected')),
  verified_by_admin_id TEXT REFERENCES admin_users(id),
  verified_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE content_assets (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id),
  content_item_id TEXT REFERENCES content_items(id),
  provider TEXT NOT NULL CHECK (provider IN ('adobe','manual_upload')),
  template_reference TEXT,
  -- 'unavailable' is a real, honest terminal state for when the Adobe boundary has no
  -- credential - the application layer must set this rather than fabricating a render.
  render_status TEXT NOT NULL DEFAULT 'not_requested' CHECK (render_status IN ('not_requested','requested','rendering','rendered','failed','unavailable')),
  asset_url TEXT,
  requested_by_admin_id TEXT REFERENCES admin_users(id),
  requested_at TEXT,
  rendered_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE content_platform_variants (
  id TEXT PRIMARY KEY,
  content_item_id TEXT NOT NULL REFERENCES content_items(id),
  platform TEXT NOT NULL CHECK (platform IN ('instagram','facebook','google_business_profile','tiktok','manual_export')),
  caption TEXT,
  hashtags_json TEXT NOT NULL DEFAULT '[]',
  asset_id TEXT REFERENCES content_assets(id),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','ready','scheduled','publishing','published','failed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (content_item_id, platform)
);

-- Append-only approval/decision history per content item - the record of who approved,
-- rejected, or requested changes, and when, must never be edited after the fact (same
-- audit posture as audit_events).
CREATE TABLE content_approvals (
  id TEXT PRIMARY KEY,
  content_item_id TEXT NOT NULL REFERENCES content_items(id),
  approval_type TEXT NOT NULL CHECK (approval_type IN ('e4la_internal','client')),
  decision TEXT NOT NULL CHECK (decision IN ('approved','rejected','revision_requested','commented')),
  comment TEXT,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('admin_user','client_user')),
  actor_id TEXT NOT NULL,
  decided_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_brand_brains_client ON brand_brains(client_id, active);
CREATE INDEX idx_content_plans_client ON content_plans(client_id, status);
CREATE INDEX idx_content_items_client ON content_items(client_id, status);
CREATE INDEX idx_content_items_plan ON content_items(content_plan_id);
CREATE INDEX idx_content_claims_item ON content_claims(content_item_id);
CREATE INDEX idx_content_sources_client ON content_sources(client_id, verification_status);
CREATE INDEX idx_content_assets_item ON content_assets(content_item_id);
CREATE INDEX idx_content_platform_variants_item ON content_platform_variants(content_item_id);
CREATE INDEX idx_content_approvals_item ON content_approvals(content_item_id, decided_at);

CREATE TRIGGER content_approvals_append_only_update
BEFORE UPDATE ON content_approvals
BEGIN
  SELECT RAISE(ABORT, 'content approval history is append-only');
END;

CREATE TRIGGER content_approvals_append_only_delete
BEFORE DELETE ON content_approvals
BEGIN
  SELECT RAISE(ABORT, 'content approval history is append-only');
END;
