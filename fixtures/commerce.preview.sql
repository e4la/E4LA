-- Phase G: Service catalog / quoting / flexible payments / recurring consent preview fixtures.
-- Loaded ADDITIONALLY after fixtures/client-operations.preview.sql (never edited). All rows are
-- fictional. Reuses clt_preview_d / prj_preview_d / usr_preview_d / adm_preview_owner from that
-- fixture, which already has an active enrollment/session-testable client.

INSERT INTO service_categories (id, name, sort_order, active, created_at, updated_at) VALUES
  ('svc_cat_preview_1', 'Website & SEO', 1, 1, '2026-08-25T00:00:00.000Z', '2026-08-25T00:00:00.000Z'),
  ('svc_cat_preview_2', 'Content & Marketing', 2, 1, '2026-08-25T00:00:00.000Z', '2026-08-25T00:00:00.000Z'),
  ('svc_cat_preview_3', 'Consulting', 3, 1, '2026-08-25T00:00:00.000Z', '2026-08-25T00:00:00.000Z');

INSERT INTO services (id, category_id, name, description, default_scope, default_price, pricing_type, billing_type, active, sort_order, created_by_admin_id, created_at, updated_at) VALUES
  ('svc_preview_1', 'svc_cat_preview_1', 'SEO Audit', 'Fictional preview service.', 'Full-site technical and content SEO audit.', 284700, 'fixed', 'fixed_scope', 1, 1, 'adm_preview_owner', '2026-08-25T00:00:00.000Z', '2026-08-25T00:00:00.000Z'),
  ('svc_preview_2', 'svc_cat_preview_1', 'Monthly SEO Retainer', 'Fictional preview service.', 'Ongoing monthly SEO management.', 150000, 'monthly_retainer', 'recurring_service', 1, 2, 'adm_preview_owner', '2026-08-25T00:00:00.000Z', '2026-08-25T00:00:00.000Z'),
  ('svc_preview_3', 'svc_cat_preview_2', 'Content Package', 'Fictional preview service.', 'Quarterly content production package.', 90000, 'fixed', 'fixed_scope', 1, 1, 'adm_preview_owner', '2026-08-25T00:00:00.000Z', '2026-08-25T00:00:00.000Z'),
  ('svc_preview_4', 'svc_cat_preview_2', 'Hourly Consulting', 'Fictional preview service.', 'Ad hoc marketing consulting, billed hourly.', NULL, 'hourly', 'fixed_scope', 1, 2, 'adm_preview_owner', '2026-08-25T00:00:00.000Z', '2026-08-25T00:00:00.000Z'),
  ('svc_preview_5', 'svc_cat_preview_3', 'Strategy Session', 'Fictional preview service.', 'Half-day strategy workshop.', 50000, 'fixed', 'fixed_scope', 1, 1, 'adm_preview_owner', '2026-08-25T00:00:00.000Z', '2026-08-25T00:00:00.000Z');

INSERT INTO quotes (id, client_id, project_id, currency, status, current_version_id, valid_until, notes, created_by_admin_id, sent_at, viewed_at, approved_at, rejected_at, created_at, updated_at) VALUES
  ('quo_preview_a', 'clt_preview_d', 'prj_preview_d', 'usd', 'sent', 'quov_preview_a', '2026-10-01', 'Fictional preview quote.', 'adm_preview_owner', '2026-08-26T00:00:00.000Z', NULL, NULL, NULL, '2026-08-25T00:00:00.000Z', '2026-08-26T00:00:00.000Z');

INSERT INTO quote_versions (id, quote_id, version_number, scope, subtotal, discount_amount, tax_amount, total, created_by_admin_id, created_at) VALUES
  ('quov_preview_a', 'quo_preview_a', 1, 'Fictional preview engagement scope.', 624700, 0, 0, 624700, 'adm_preview_owner', '2026-08-25T00:00:00.000Z');

INSERT INTO quote_items (id, quote_version_id, service_id, label, description, quantity, unit_price, amount, sort_order, created_at) VALUES
  ('qit_preview_a1', 'quov_preview_a', 'svc_preview_1', 'SEO Audit', 'Full-site technical and content SEO audit.', 1, 284700, 284700, 0, '2026-08-25T00:00:00.000Z'),
  ('qit_preview_a2', 'quov_preview_a', NULL, 'Custom consulting — $3,400', 'Fictional hand-typed custom line item.', 1, 340000, 340000, 1, '2026-08-25T00:00:00.000Z');

INSERT INTO payment_options (id, quote_id, option_type, label, total_amount, installment_count, active, sort_order, created_at) VALUES
  ('pmo_preview_a', 'quo_preview_a', 'deposit_balance', 'Deposit + Balance', 624700, 2, 1, 0, '2026-08-25T00:00:00.000Z');

INSERT INTO payment_option_installments (id, payment_option_id, installment_number, amount, due_date, offset_unit, offset_count, created_at) VALUES
  ('pmi_preview_a1', 'pmo_preview_a', 1, 300000, '2026-08-26', NULL, NULL, '2026-08-25T00:00:00.000Z'),
  ('pmi_preview_a2', 'pmo_preview_a', 2, 324700, '2026-09-26', NULL, NULL, '2026-08-25T00:00:00.000Z');

INSERT INTO recurring_service_consents (id, client_id, project_id, quote_id, agreement_id, service_id, billing_amount, billing_frequency, start_date, renewal_behavior, cancellation_terms_version, consent_text_version, actor_type, actor_id, approved_at, consent_evidence, status, cancelled_at, stripe_subscription_id, created_at, updated_at) VALUES
  ('rsc_preview_a', 'clt_preview_d', 'prj_preview_d', NULL, NULL, 'svc_preview_2', 150000, 'monthly', '2026-09-01', 'auto_renew_until_cancelled', 'v1', 'v1', 'client_owner', 'usr_preview_d', '2026-08-25T00:00:00.000Z', '{"requestId":"preview-fixture","userAgent":"preview-fixture","sessionId":"preview-fixture"}', 'active', NULL, NULL, '2026-08-25T00:00:00.000Z', '2026-08-25T00:00:00.000Z');
