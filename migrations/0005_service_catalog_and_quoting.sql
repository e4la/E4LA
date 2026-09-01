PRAGMA foreign_keys = ON;

-- Additive only. No existing table (clients, projects, agreements, agreement_versions,
-- payment_plans, ...) is modified. This introduces an extensible service catalog and a
-- client-specific quoting model, replacing "one fixed program fee" as a code assumption
-- with admin-configurable services and per-quote pricing. Existing $3,600/$1,200/$600
-- test fixtures remain exactly as they are (agreement/payment_plans rows) - this migration
-- does not touch them and does not require any client to have a quote to have an agreement.

CREATE TABLE service_categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE services (
  id TEXT PRIMARY KEY,
  category_id TEXT REFERENCES service_categories(id),
  name TEXT NOT NULL,
  description TEXT,
  default_scope TEXT,
  default_price INTEGER, -- cents; NULL is valid and means "always custom-priced per quote"
  pricing_type TEXT NOT NULL DEFAULT 'fixed' CHECK (pricing_type IN ('fixed','hourly','monthly_retainer','custom')),
  billing_type TEXT NOT NULL DEFAULT 'fixed_scope' CHECK (billing_type IN ('fixed_scope','recurring_service')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by_admin_id TEXT REFERENCES admin_users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE quotes (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id),
  project_id TEXT REFERENCES projects(id),
  currency TEXT NOT NULL DEFAULT 'usd',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft','prepared','sent','viewed','approved','rejected','expired','converted'
  )),
  current_version_id TEXT, -- set after the first quote_versions row is written; no FK cycle at create time
  valid_until TEXT,
  notes TEXT,
  created_by_admin_id TEXT REFERENCES admin_users(id),
  sent_at TEXT,
  viewed_at TEXT,
  approved_at TEXT,
  rejected_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- A quote_versions row is the priced, presented snapshot at a point in time - once a quote
-- moves past 'draft', a change in scope/price must create a new version, exactly like
-- agreement_versions, so what a client actually saw and approved is never silently rewritten.
CREATE TABLE quote_versions (
  id TEXT PRIMARY KEY,
  quote_id TEXT NOT NULL REFERENCES quotes(id),
  version_number INTEGER NOT NULL,
  scope TEXT,
  subtotal INTEGER NOT NULL,
  discount_amount INTEGER NOT NULL DEFAULT 0,
  tax_amount INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL,
  created_by_admin_id TEXT REFERENCES admin_users(id),
  created_at TEXT NOT NULL,
  UNIQUE (quote_id, version_number)
);

CREATE TABLE quote_items (
  id TEXT PRIMARY KEY,
  quote_version_id TEXT NOT NULL REFERENCES quote_versions(id),
  service_id TEXT REFERENCES services(id), -- NULL for a fully custom line item
  label TEXT NOT NULL, -- always populated (even for a catalog service) so a quote reads standalone
  description TEXT,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price INTEGER NOT NULL,
  amount INTEGER NOT NULL, -- quantity * unit_price, stored rather than computed - see note below
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_services_category ON services(category_id, active);
CREATE INDEX idx_quotes_client ON quotes(client_id, status);
CREATE INDEX idx_quote_versions_quote ON quote_versions(quote_id, version_number);
CREATE INDEX idx_quote_items_version ON quote_items(quote_version_id);

-- Immutable once written, matching agreement_versions/agreement_acceptances: a quote_versions
-- row (and its quote_items) is a priced snapshot the client may have already seen or approved.
-- amount is stored (not recomputed from unit_price*quantity at read time) specifically so that
-- if services.default_price changes later, every historical quote still shows the number the
-- client actually agreed to - the same "acceptance keeps its own copy" pattern already proven
-- for agreement_acceptances vs. payment_plans.
CREATE TRIGGER quote_versions_immutable_update
BEFORE UPDATE ON quote_versions
BEGIN
  SELECT RAISE(ABORT, 'quote versions are immutable once created; create a new version instead');
END;

CREATE TRIGGER quote_versions_immutable_delete
BEFORE DELETE ON quote_versions
BEGIN
  SELECT RAISE(ABORT, 'quote versions are immutable once created; create a new version instead');
END;

CREATE TRIGGER quote_items_immutable_update
BEFORE UPDATE ON quote_items
BEGIN
  SELECT RAISE(ABORT, 'quote items are immutable once created; create a new quote version instead');
END;

CREATE TRIGGER quote_items_immutable_delete
BEFORE DELETE ON quote_items
BEGIN
  SELECT RAISE(ABORT, 'quote items are immutable once created; create a new quote version instead');
END;
