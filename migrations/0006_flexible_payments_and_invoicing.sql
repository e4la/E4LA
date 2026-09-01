PRAGMA foreign_keys = ON;

-- Additive only. payment_options/payment_option_installments are a NEW, quote-scoped
-- payment-plan model, independent of the existing agreement_versions -> payment_plans
-- flow from 0001 (which remains exactly as-is for the original fixed-program-fee path).
-- A payment_option here is, by construction, a FINITE, enumerated list of installments -
-- there is no "renew" or "recurring" concept anywhere in this table pair. That is
-- deliberate: fixed-scope billing must be structurally incapable of auto-renewing.
-- Recurring billing is an entirely separate concept, gated by 0007's consent table.

CREATE TABLE payment_options (
  id TEXT PRIMARY KEY,
  quote_id TEXT NOT NULL REFERENCES quotes(id),
  option_type TEXT NOT NULL CHECK (option_type IN ('pay_in_full','deposit_balance','installments','custom_schedule')),
  label TEXT NOT NULL,
  total_amount INTEGER NOT NULL,
  installment_count INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

-- Each row is one concrete, dated-or-offset installment. SQLite cannot express
-- "SUM(amount) over installments == total_amount" as a table CHECK constraint (no
-- cross-row CHECK support) - the application layer MUST verify this at creation time
-- (see the required regression test: "installment totals reconcile"). due_date is an
-- explicit calendar date for a custom schedule; offset_unit/offset_count is used instead
-- for a relative schedule resolved at acceptance time, mirroring the existing
-- payment_plans.installment_schedule_json offset pattern from 0001.
CREATE TABLE payment_option_installments (
  id TEXT PRIMARY KEY,
  payment_option_id TEXT NOT NULL REFERENCES payment_options(id),
  installment_number INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  due_date TEXT,
  offset_unit TEXT CHECK (offset_unit IN ('day','week','month')),
  offset_count INTEGER,
  created_at TEXT NOT NULL,
  UNIQUE (payment_option_id, installment_number)
);

CREATE TABLE invoices (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id),
  project_id TEXT REFERENCES projects(id),
  quote_id TEXT REFERENCES quotes(id), -- NULL for a standalone invoice not tied to any quote
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','viewed','paid','overdue','void')),
  currency TEXT NOT NULL DEFAULT 'usd',
  subtotal INTEGER NOT NULL,
  tax_amount INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL,
  amount_paid INTEGER NOT NULL DEFAULT 0,
  due_date TEXT,
  notes TEXT,
  stripe_invoice_id TEXT,
  stripe_payment_intent_id TEXT,
  created_by_admin_id TEXT REFERENCES admin_users(id),
  sent_at TEXT,
  viewed_at TEXT,
  paid_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE invoice_items (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id),
  service_id TEXT REFERENCES services(id),
  label TEXT NOT NULL,
  description TEXT,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_payment_options_quote ON payment_options(quote_id, active);
CREATE INDEX idx_payment_option_installments_option ON payment_option_installments(payment_option_id, installment_number);
CREATE INDEX idx_invoices_client ON invoices(client_id, status);
CREATE INDEX idx_invoices_quote ON invoices(quote_id);
CREATE INDEX idx_invoice_items_invoice ON invoice_items(invoice_id);

-- invoice_items are only immutable once the parent invoice has left 'draft' - a draft
-- invoice is meant to be edited freely before it's ever sent. Enforced via a trigger
-- that checks the parent's current status rather than a blanket lock, since (unlike
-- quote_items) an invoice's edit window genuinely needs to stay open pre-send.
CREATE TRIGGER invoice_items_immutable_once_sent
BEFORE UPDATE ON invoice_items
WHEN (SELECT status FROM invoices WHERE id = OLD.invoice_id) != 'draft'
BEGIN
  SELECT RAISE(ABORT, 'invoice items are immutable once the invoice has been sent');
END;

CREATE TRIGGER invoice_items_no_delete_once_sent
BEFORE DELETE ON invoice_items
WHEN (SELECT status FROM invoices WHERE id = OLD.invoice_id) != 'draft'
BEGIN
  SELECT RAISE(ABORT, 'invoice items are immutable once the invoice has been sent');
END;
