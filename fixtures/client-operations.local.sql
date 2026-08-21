-- LOCAL DEVELOPMENT ONLY. All identities and commercial records below are fictional.
PRAGMA foreign_keys = ON;

INSERT INTO clients (id, lifecycle_status, legal_name, display_name, billing_email, created_at, updated_at)
VALUES ('clt_demo_01', 'agreement_sent', 'Phase B Sample Client LLC', 'Sample Client', 'signer@example.test', '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z');

INSERT INTO projects (id, client_id, name, status, current_phase, start_date, target_end_date, summary, client_visible, created_at, updated_at)
VALUES ('prj_demo_01', 'clt_demo_01', '90-Day Brand Visibility & Growth Program', 'planned', 'Enrollment', '2026-09-08', '2026-12-07', 'Local Phase B project record.', 0, '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z');

INSERT INTO agreements (id, client_id, project_id, status, program_name, current_version_id, expires_at, sent_at, created_at, updated_at)
VALUES ('agr_7f84c1e9d2b64a28', 'clt_demo_01', 'prj_demo_01', 'sent', '90-Day Brand Visibility & Growth Program', 'agrv_demo_01', '2027-01-01T00:00:00.000Z', '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z');

INSERT INTO agreement_versions (
  id, agreement_id, version_number, legal_document_hash, rendered_agreement_snapshot,
  agreement_summary_json, commercial_terms_json, acknowledgement_clauses_json, created_at
) VALUES (
  'agrv_demo_01', 'agr_7f84c1e9d2b64a28', 1, 'phase-b-placeholder-not-for-execution',
  'PHASE B LEGAL DOCUMENT PLACEHOLDER\n\nReplace with attorney-approved agreement text before any production use.',
  '{"initialTerm":"90 Days","totalInvestment":360000}',
  '{"currency":"usd","programType":"fixed_program"}',
  '[{"id":"fixed_term","required":true,"text":"I understand that this is a fixed 90-day engagement and not a month-to-month subscription."},{"id":"fee_commitment","required":true,"text":"I understand that the Total Program Fee is committed and installments are a payment schedule only."},{"id":"automatic_charges","required":true,"text":"I authorize E4LA to automatically charge the payment method provided according to the selected Payment Schedule."},{"id":"no_guarantees","required":true,"text":"I understand that specific rankings, revenue, leads, sales, advertising results, or other business outcomes are not guaranteed."},{"id":"client_responsibilities","required":true,"text":"I understand my responsibilities regarding approvals, access, content, information, and coordination with other marketing activities."},{"id":"full_agreement","required":true,"text":"I have reviewed, understood, and agree to the E4LA Client Services Agreement."}]',
  '2026-08-20T00:00:00.000Z'
);

INSERT INTO payment_plans (id, agreement_version_id, plan_code, display_name, total_contract_value, installment_count, interval_unit, interval_count, installment_schedule_json, created_at)
VALUES
  ('plan_demo_full', 'agrv_demo_01', 'pay_full', 'Pay in Full', 360000, 1, 'one_time', 0, '[{"amount":360000,"offsetUnit":"month","offset":0}]', '2026-08-20T00:00:00.000Z'),
  ('plan_demo_monthly', 'agrv_demo_01', 'three_monthly', 'Three Monthly Installments', 360000, 3, 'month', 1, '[{"amount":120000,"offsetUnit":"month","offset":0},{"amount":120000,"offsetUnit":"month","offset":1},{"amount":120000,"offsetUnit":"month","offset":2}]', '2026-08-20T00:00:00.000Z'),
  ('plan_demo_biweekly', 'agrv_demo_01', 'six_biweekly', 'Six Biweekly Installments', 360000, 6, 'week', 2, '[{"amount":60000,"offsetUnit":"week","offset":0},{"amount":60000,"offsetUnit":"week","offset":2},{"amount":60000,"offsetUnit":"week","offset":4},{"amount":60000,"offsetUnit":"week","offset":6},{"amount":60000,"offsetUnit":"week","offset":8},{"amount":60000,"offsetUnit":"week","offset":10}]', '2026-08-20T00:00:00.000Z');

-- Token value for local testing: phase-b-demo-invite-token
INSERT INTO agreement_invites (id, agreement_id, agreement_version_id, intended_email_normalized, token_hash, expires_at, created_at)
VALUES ('invite_demo_01', 'agr_7f84c1e9d2b64a28', 'agrv_demo_01', 'signer@example.test', '8c2c46dcb5ee1d2eef8b7be13cc4dc234fcccb5e7a3e8f32d9f9774e4448ba8a', '2027-01-01T00:00:00.000Z', '2026-08-20T00:00:00.000Z');
