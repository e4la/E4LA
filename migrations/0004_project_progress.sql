PRAGMA foreign_keys = ON;

-- Additive only. Existing tables (agreements, agreement_versions, agreement_acceptances,
-- audit_events) remain untouched. This introduces a client-visible progress layer for
-- the client portal Overview: named phases, weekly progress snapshots, and published
-- performance metrics - all following the existing internal/reviewed/approved/published/
-- withdrawn publication_status pattern already used by project_milestones/project_updates/
-- deliverables, so the existing publication-boundary rules extend to it unchanged.

CREATE TABLE project_phases (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  name TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'upcoming' CHECK (status IN (
    'completed','current','upcoming','blocked','on_hold'
  )),
  target_start_date TEXT,
  target_end_date TEXT,
  client_action_required INTEGER NOT NULL DEFAULT 0 CHECK (client_action_required IN (0,1)),
  client_action_note TEXT,
  publication_status TEXT NOT NULL DEFAULT 'internal' CHECK (publication_status IN (
    'internal','reviewed','approved','published','withdrawn'
  )),
  published_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (project_id, sequence)
);

ALTER TABLE project_milestones ADD COLUMN phase_id TEXT REFERENCES project_phases(id);

CREATE TABLE project_progress_snapshots (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  snapshot_date TEXT NOT NULL,
  week_number INTEGER NOT NULL,
  completed_milestones_count INTEGER NOT NULL,
  total_milestones_count INTEGER NOT NULL,
  publication_status TEXT NOT NULL DEFAULT 'internal' CHECK (publication_status IN (
    'internal','reviewed','approved','published','withdrawn'
  )),
  published_at TEXT,
  created_by_admin_id TEXT REFERENCES admin_users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (project_id, week_number)
);

CREATE TABLE project_performance_metrics (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  metric_key TEXT NOT NULL,
  label TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general' CHECK (category IN (
    'visibility','website_ux','content','business_growth','general'
  )),
  current_value TEXT NOT NULL,
  baseline_value TEXT,
  trend TEXT NOT NULL DEFAULT 'flat' CHECK (trend IN ('up','down','flat')),
  interpretation TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  publication_status TEXT NOT NULL DEFAULT 'internal' CHECK (publication_status IN (
    'internal','reviewed','approved','published','withdrawn'
  )),
  published_at TEXT,
  created_by_admin_id TEXT REFERENCES admin_users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (project_id, metric_key)
);

CREATE INDEX idx_project_phases_project ON project_phases(project_id, sequence);
CREATE INDEX idx_project_milestones_phase ON project_milestones(phase_id);
CREATE INDEX idx_progress_snapshots_project ON project_progress_snapshots(project_id, week_number);
CREATE INDEX idx_performance_metrics_project ON project_performance_metrics(project_id, sort_order);

-- Publication evidence for this new layer never disappears once published, matching the
-- append-only spirit of audit_events - snapshots and metrics can move to 'withdrawn' but
-- their historical values are never edited or deleted, so the weekly chart can never be
-- quietly rewritten after a client has seen it.
CREATE TRIGGER project_progress_snapshots_no_delete
BEFORE DELETE ON project_progress_snapshots
BEGIN
  SELECT RAISE(ABORT, 'progress snapshots are append-only; withdraw via publication_status instead');
END;

CREATE TRIGGER project_progress_snapshots_immutable_values
BEFORE UPDATE OF snapshot_date, week_number, completed_milestones_count, total_milestones_count, project_id ON project_progress_snapshots
BEGIN
  SELECT RAISE(ABORT, 'progress snapshot values are immutable once recorded; publication_status may still change');
END;
