-- PREVIEW ONLY. Every identity and company below is fictional.
PRAGMA foreign_keys = ON;

INSERT INTO environment_settings (setting_key, setting_value, created_at, updated_at)
VALUES ('environment', 'preview', '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z');

INSERT INTO admin_users (id, email_normalized, full_name, role, access_status, created_at, updated_at) VALUES
  ('adm_preview_owner', 'phase-c-admin@example.test', 'Phase C Preview Admin', 'e4la_admin', 'active', '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z'),
  ('adm_preview_collab', 'phase-c-collaborator@example.test', 'Phase C Preview Collaborator', 'e4la_collaborator', 'active', '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z');

INSERT INTO clients (id, lifecycle_status, legal_name, display_name, billing_email, created_at, updated_at) VALUES
  ('clt_preview_a', 'agreement_sent', 'Fictional Alder Studio LLC', 'Alder Studio', 'owner+a@example.test', '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z'),
  ('clt_preview_b', 'agreement_accepted', 'Fictional Beacon Foods LLC', 'Beacon Foods', 'owner+b@example.test', '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z'),
  ('clt_preview_c', 'payment_confirmed', 'Fictional Cedar Health LLC', 'Cedar Health', 'owner+c@example.test', '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z'),
  ('clt_preview_d', 'active', 'Fictional Drift Hotel LLC', 'Drift Hotel', 'owner+d@example.test', '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z'),
  ('clt_preview_e', 'work_in_progress', 'Fictional Ember Market LLC', 'Ember Market', 'owner+e@example.test', '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z'),
  ('clt_preview_f', 'completed', 'Fictional Field House LLC', 'Field House', 'owner+f@example.test', '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z');

INSERT INTO client_users (id, client_id, email_normalized, full_name, title, role, access_status, created_at, updated_at) VALUES
  ('usr_preview_a', 'clt_preview_a', 'owner+a@example.test', 'Fictional Owner A', 'Owner', 'client_owner', 'invited', '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z'),
  ('usr_preview_b', 'clt_preview_b', 'owner+b@example.test', 'Fictional Owner B', 'Owner', 'client_owner', 'invited', '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z'),
  ('usr_preview_c', 'clt_preview_c', 'owner+c@example.test', 'Fictional Owner C', 'Owner', 'client_owner', 'invited', '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z'),
  ('usr_preview_d', 'clt_preview_d', 'owner+d@example.test', 'Fictional Owner D', 'Owner', 'client_owner', 'active', '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z'),
  ('usr_preview_e', 'clt_preview_e', 'owner+e@example.test', 'Fictional Owner E', 'Owner', 'client_owner', 'active', '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z'),
  ('usr_preview_f', 'clt_preview_f', 'owner+f@example.test', 'Fictional Owner F', 'Owner', 'client_owner', 'active', '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z');

INSERT INTO projects (id, client_id, name, status, current_phase, start_date, target_end_date, summary, client_visible, created_at, updated_at) VALUES
  ('prj_preview_a', 'clt_preview_a', 'Alder Growth Program', 'planned', 'Agreement', '2026-09-01', '2026-11-30', 'Fictional preview engagement awaiting signature.', 0, '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z'),
  ('prj_preview_b', 'clt_preview_b', 'Beacon Growth Program', 'planned', 'Payment setup', '2026-09-01', '2026-11-30', 'Fictional preview engagement awaiting payment.', 0, '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z'),
  ('prj_preview_c', 'clt_preview_c', 'Cedar Growth Program', 'planned', 'Onboarding', '2026-09-01', '2026-11-30', 'Payment complete; onboarding readiness is still required.', 0, '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z'),
  ('prj_preview_d', 'clt_preview_d', 'Drift Growth Program', 'active', 'Visibility foundation', '2026-07-15', '2026-10-13', 'E4LA is building the visibility foundation and measurement baseline.', 1, '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z'),
  ('prj_preview_e', 'clt_preview_e', 'Ember Growth Program', 'client_action_required', 'Content approvals', '2026-07-20', '2026-10-18', 'Work is active and one fictional client approval is required.', 1, '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z'),
  ('prj_preview_f', 'clt_preview_f', 'Field Growth Program', 'completed', 'Completed', '2026-04-01', '2026-06-30', 'The fictional engagement is complete and historical deliverables remain visible.', 1, '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z');

INSERT INTO admin_project_access (admin_user_id, project_id, permission_level, created_at) VALUES
  ('adm_preview_collab', 'prj_preview_d', 'contributor', '2026-08-20T00:00:00.000Z'),
  ('adm_preview_collab', 'prj_preview_e', 'manager', '2026-08-20T00:00:00.000Z');

INSERT INTO agreements (id, client_id, project_id, status, program_name, current_version_id, accepted_version_id, expires_at, sent_at, viewed_at, accepted_at, created_at, updated_at) VALUES
  ('agr_preview_a', 'clt_preview_a', 'prj_preview_a', 'sent', '90-Day Growth Program', 'agrv_preview_a', NULL, '2026-09-15T00:00:00.000Z', '2026-08-20T00:00:00.000Z', NULL, NULL, '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z'),
  ('agr_preview_b', 'clt_preview_b', 'prj_preview_b', 'accepted', '90-Day Growth Program', 'agrv_preview_b', 'agrv_preview_b', NULL, '2026-08-15T00:00:00.000Z', '2026-08-16T00:00:00.000Z', '2026-08-16T01:00:00.000Z', '2026-08-15T00:00:00.000Z', '2026-08-16T01:00:00.000Z'),
  ('agr_preview_c', 'clt_preview_c', 'prj_preview_c', 'enrolled', '90-Day Growth Program', 'agrv_preview_c', 'agrv_preview_c', NULL, '2026-08-10T00:00:00.000Z', '2026-08-11T00:00:00.000Z', '2026-08-11T01:00:00.000Z', '2026-08-10T00:00:00.000Z', '2026-08-12T00:00:00.000Z'),
  ('agr_preview_d', 'clt_preview_d', 'prj_preview_d', 'enrolled', '90-Day Growth Program', 'agrv_preview_d', 'agrv_preview_d', NULL, '2026-07-10T00:00:00.000Z', '2026-07-11T00:00:00.000Z', '2026-07-11T01:00:00.000Z', '2026-07-10T00:00:00.000Z', '2026-07-15T00:00:00.000Z'),
  ('agr_preview_e', 'clt_preview_e', 'prj_preview_e', 'enrolled', '90-Day Growth Program', 'agrv_preview_e', 'agrv_preview_e', NULL, '2026-07-15T00:00:00.000Z', '2026-07-16T00:00:00.000Z', '2026-07-16T01:00:00.000Z', '2026-07-15T00:00:00.000Z', '2026-07-20T00:00:00.000Z'),
  ('agr_preview_f', 'clt_preview_f', 'prj_preview_f', 'completed', '90-Day Growth Program', 'agrv_preview_f', 'agrv_preview_f', NULL, '2026-03-25T00:00:00.000Z', '2026-03-26T00:00:00.000Z', '2026-03-26T01:00:00.000Z', '2026-03-25T00:00:00.000Z', '2026-06-30T00:00:00.000Z');

INSERT INTO agreement_versions (id, agreement_id, version_number, legal_document_hash, rendered_agreement_snapshot, agreement_summary_json, commercial_terms_json, acknowledgement_clauses_json, created_by_admin_id, created_at)
VALUES
  ('agrv_preview_a','agr_preview_a',1,'phase-c-fixture-hash-a','PHASE C LEGAL PLACEHOLDER — FICTIONAL PREVIEW RECORD A','{"initialTerm":"90 Days","totalInvestment":360000}','{"currency":"usd","programType":"fixed_program","legalStatus":"phase_c_placeholder"}','[{"id":"fixed_term","required":true,"text":"Fixed 90-day engagement acknowledgment."},{"id":"fee_commitment","required":true,"text":"Fixed program fee acknowledgment."}]','adm_preview_owner','2026-08-20T00:00:00.000Z'),
  ('agrv_preview_b','agr_preview_b',1,'phase-c-fixture-hash-b','PHASE C LEGAL PLACEHOLDER — FICTIONAL PREVIEW RECORD B','{"initialTerm":"90 Days","totalInvestment":360000}','{"currency":"usd","programType":"fixed_program","legalStatus":"phase_c_placeholder"}','[{"id":"fixed_term","required":true,"text":"Fixed 90-day engagement acknowledgment."},{"id":"fee_commitment","required":true,"text":"Fixed program fee acknowledgment."}]','adm_preview_owner','2026-08-20T00:00:00.000Z'),
  ('agrv_preview_c','agr_preview_c',1,'phase-c-fixture-hash-c','PHASE C LEGAL PLACEHOLDER — FICTIONAL PREVIEW RECORD C','{"initialTerm":"90 Days","totalInvestment":360000}','{"currency":"usd","programType":"fixed_program","legalStatus":"phase_c_placeholder"}','[{"id":"fixed_term","required":true,"text":"Fixed 90-day engagement acknowledgment."},{"id":"fee_commitment","required":true,"text":"Fixed program fee acknowledgment."}]','adm_preview_owner','2026-08-20T00:00:00.000Z'),
  ('agrv_preview_d','agr_preview_d',1,'phase-c-fixture-hash-d','PHASE C LEGAL PLACEHOLDER — FICTIONAL PREVIEW RECORD D','{"initialTerm":"90 Days","totalInvestment":360000}','{"currency":"usd","programType":"fixed_program","legalStatus":"phase_c_placeholder"}','[{"id":"fixed_term","required":true,"text":"Fixed 90-day engagement acknowledgment."},{"id":"fee_commitment","required":true,"text":"Fixed program fee acknowledgment."}]','adm_preview_owner','2026-08-20T00:00:00.000Z'),
  ('agrv_preview_e','agr_preview_e',1,'phase-c-fixture-hash-e','PHASE C LEGAL PLACEHOLDER — FICTIONAL PREVIEW RECORD E','{"initialTerm":"90 Days","totalInvestment":360000}','{"currency":"usd","programType":"fixed_program","legalStatus":"phase_c_placeholder"}','[{"id":"fixed_term","required":true,"text":"Fixed 90-day engagement acknowledgment."},{"id":"fee_commitment","required":true,"text":"Fixed program fee acknowledgment."}]','adm_preview_owner','2026-08-20T00:00:00.000Z'),
  ('agrv_preview_f','agr_preview_f',1,'phase-c-fixture-hash-f','PHASE C LEGAL PLACEHOLDER — FICTIONAL PREVIEW RECORD F','{"initialTerm":"90 Days","totalInvestment":360000}','{"currency":"usd","programType":"fixed_program","legalStatus":"phase_c_placeholder"}','[{"id":"fixed_term","required":true,"text":"Fixed 90-day engagement acknowledgment."},{"id":"fee_commitment","required":true,"text":"Fixed program fee acknowledgment."}]','adm_preview_owner','2026-08-20T00:00:00.000Z');

INSERT INTO payment_plans (id, agreement_version_id, plan_code, display_name, total_contract_value, currency, installment_count, interval_unit, interval_count, installment_schedule_json, active, created_at)
VALUES
  ('plan_preview_a','agrv_preview_a','pay_full','Pay in Full',360000,'usd',1,'one_time',0,'[{"amount":360000,"offsetUnit":"month","offset":0}]',1,'2026-08-20T00:00:00.000Z'),
  ('plan_preview_b','agrv_preview_b','pay_full','Pay in Full',360000,'usd',1,'one_time',0,'[{"amount":360000,"offsetUnit":"month","offset":0}]',1,'2026-08-20T00:00:00.000Z'),
  ('plan_preview_c','agrv_preview_c','pay_full','Pay in Full',360000,'usd',1,'one_time',0,'[{"amount":360000,"offsetUnit":"month","offset":0}]',1,'2026-08-20T00:00:00.000Z'),
  ('plan_preview_d','agrv_preview_d','pay_full','Pay in Full',360000,'usd',1,'one_time',0,'[{"amount":360000,"offsetUnit":"month","offset":0}]',1,'2026-08-20T00:00:00.000Z'),
  ('plan_preview_e','agrv_preview_e','pay_full','Pay in Full',360000,'usd',1,'one_time',0,'[{"amount":360000,"offsetUnit":"month","offset":0}]',1,'2026-08-20T00:00:00.000Z'),
  ('plan_preview_f','agrv_preview_f','pay_full','Pay in Full',360000,'usd',1,'one_time',0,'[{"amount":360000,"offsetUnit":"month","offset":0}]',1,'2026-08-20T00:00:00.000Z');

INSERT INTO agreement_acceptances (id, agreement_id, agreement_version_id, client_id, project_id, payment_plan_id, legal_document_hash, rendered_agreement_snapshot, total_contract_value, installment_amounts_json, installment_dates_json, acknowledged_clause_ids_json, authorized_signer_name, authorized_signer_role, signer_company, typed_acceptance, authority_confirmed, accepted_at_utc, request_id, user_agent, created_at)
VALUES
  ('acc_preview_b','agr_preview_b','agrv_preview_b','clt_preview_b','prj_preview_b','plan_preview_b','phase-c-fixture-hash-b','PHASE C LEGAL PLACEHOLDER — FICTIONAL PREVIEW RECORD B',360000,'[360000]','["2026-08-20T00:00:00.000Z"]','["fixed_term","fee_commitment"]','Fictional Owner B','Owner','Fictional Company B','Fictional Owner B',1,'2026-08-16T01:00:00.000Z','preview-fixture-b','Phase C fixture','2026-08-16T01:00:00.000Z'),
  ('acc_preview_c','agr_preview_c','agrv_preview_c','clt_preview_c','prj_preview_c','plan_preview_c','phase-c-fixture-hash-c','PHASE C LEGAL PLACEHOLDER — FICTIONAL PREVIEW RECORD C',360000,'[360000]','["2026-08-20T00:00:00.000Z"]','["fixed_term","fee_commitment"]','Fictional Owner C','Owner','Fictional Company C','Fictional Owner C',1,'2026-08-16T01:00:00.000Z','preview-fixture-c','Phase C fixture','2026-08-16T01:00:00.000Z'),
  ('acc_preview_d','agr_preview_d','agrv_preview_d','clt_preview_d','prj_preview_d','plan_preview_d','phase-c-fixture-hash-d','PHASE C LEGAL PLACEHOLDER — FICTIONAL PREVIEW RECORD D',360000,'[360000]','["2026-08-20T00:00:00.000Z"]','["fixed_term","fee_commitment"]','Fictional Owner D','Owner','Fictional Company D','Fictional Owner D',1,'2026-08-16T01:00:00.000Z','preview-fixture-d','Phase C fixture','2026-08-16T01:00:00.000Z'),
  ('acc_preview_e','agr_preview_e','agrv_preview_e','clt_preview_e','prj_preview_e','plan_preview_e','phase-c-fixture-hash-e','PHASE C LEGAL PLACEHOLDER — FICTIONAL PREVIEW RECORD E',360000,'[360000]','["2026-08-20T00:00:00.000Z"]','["fixed_term","fee_commitment"]','Fictional Owner E','Owner','Fictional Company E','Fictional Owner E',1,'2026-08-16T01:00:00.000Z','preview-fixture-e','Phase C fixture','2026-08-16T01:00:00.000Z'),
  ('acc_preview_f','agr_preview_f','agrv_preview_f','clt_preview_f','prj_preview_f','plan_preview_f','phase-c-fixture-hash-f','PHASE C LEGAL PLACEHOLDER — FICTIONAL PREVIEW RECORD F',360000,'[360000]','["2026-08-20T00:00:00.000Z"]','["fixed_term","fee_commitment"]','Fictional Owner F','Owner','Fictional Company F','Fictional Owner F',1,'2026-08-16T01:00:00.000Z','preview-fixture-f','Phase C fixture','2026-08-16T01:00:00.000Z');

INSERT INTO enrollments (id, client_id, project_id, agreement_id, acceptance_id, payment_plan_id, status, portal_activation_policy, next_payment_due_at, activated_at, completed_at, created_at, updated_at, activation_mode, onboarding_ready, portal_activated_at)
VALUES
  ('enr_preview_b', 'clt_preview_b', 'prj_preview_b', 'agr_preview_b', 'acc_preview_b', 'plan_preview_b', 'accepted', 'manual', '2026-08-20T00:00:00.000Z', NULL, NULL, '2026-08-16T01:00:00.000Z', '2026-08-16T01:00:00.000Z', 'manual', 0, NULL),
  ('enr_preview_c', 'clt_preview_c', 'prj_preview_c', 'agr_preview_c', 'acc_preview_c', 'plan_preview_c', 'paid', 'manual', NULL, NULL, '2026-08-12T00:00:00.000Z', '2026-08-11T01:00:00.000Z', '2026-08-12T00:00:00.000Z', 'manual', 0, NULL),
  ('enr_preview_d', 'clt_preview_d', 'prj_preview_d', 'agr_preview_d', 'acc_preview_d', 'plan_preview_d', 'activated', 'manual', NULL, '2026-07-15T00:00:00.000Z', '2026-07-15T00:00:00.000Z', '2026-07-11T01:00:00.000Z', '2026-07-15T00:00:00.000Z', 'manual', 1, '2026-07-15T00:00:00.000Z'),
  ('enr_preview_e', 'clt_preview_e', 'prj_preview_e', 'agr_preview_e', 'acc_preview_e', 'plan_preview_e', 'activated', 'manual', NULL, '2026-07-20T00:00:00.000Z', '2026-07-20T00:00:00.000Z', '2026-07-16T01:00:00.000Z', '2026-07-20T00:00:00.000Z', 'manual', 1, '2026-07-20T00:00:00.000Z'),
  ('enr_preview_f', 'clt_preview_f', 'prj_preview_f', 'agr_preview_f', 'acc_preview_f', 'plan_preview_f', 'completed', 'manual', NULL, '2026-04-01T00:00:00.000Z', '2026-06-30T00:00:00.000Z', '2026-03-26T01:00:00.000Z', '2026-06-30T00:00:00.000Z', 'manual', 1, '2026-04-01T00:00:00.000Z');

INSERT INTO payment_installments (id, enrollment_id, installment_number, amount, currency, due_at, status, paid_at, created_at, updated_at) VALUES
  ('pay_preview_b', 'enr_preview_b', 1, 360000, 'usd', '2026-08-20T00:00:00.000Z', 'planned', NULL, '2026-08-16T01:00:00.000Z', '2026-08-16T01:00:00.000Z'),
  ('pay_preview_c', 'enr_preview_c', 1, 360000, 'usd', '2026-08-12T00:00:00.000Z', 'paid', '2026-08-12T00:00:00.000Z', '2026-08-11T01:00:00.000Z', '2026-08-12T00:00:00.000Z'),
  ('pay_preview_d', 'enr_preview_d', 1, 360000, 'usd', '2026-07-15T00:00:00.000Z', 'paid', '2026-07-15T00:00:00.000Z', '2026-07-11T01:00:00.000Z', '2026-07-15T00:00:00.000Z'),
  ('pay_preview_e', 'enr_preview_e', 1, 360000, 'usd', '2026-07-20T00:00:00.000Z', 'paid', '2026-07-20T00:00:00.000Z', '2026-07-16T01:00:00.000Z', '2026-07-20T00:00:00.000Z'),
  ('pay_preview_f', 'enr_preview_f', 1, 360000, 'usd', '2026-04-01T00:00:00.000Z', 'paid', '2026-04-01T00:00:00.000Z', '2026-03-26T01:00:00.000Z', '2026-04-01T00:00:00.000Z');

INSERT INTO project_updates (id, project_id, title, body, update_type, publication_status, published_at, created_by_admin_id, created_at, updated_at) VALUES
  ('upd_d_internal', 'prj_preview_d', 'Internal research', 'Must never appear in client output.', 'progress', 'internal', NULL, 'adm_preview_owner', '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z'),
  ('upd_d_reviewed', 'prj_preview_d', 'Reviewed draft', 'Must never appear in client output.', 'progress', 'reviewed', NULL, 'adm_preview_owner', '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z'),
  ('upd_d_approved', 'prj_preview_d', 'Approved draft', 'Must never appear until published.', 'progress', 'approved', NULL, 'adm_preview_owner', '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z'),
  ('upd_d_published', 'prj_preview_d', 'Visibility foundation', 'Technical discovery and measurement setup are underway.', 'progress', 'published', '2026-08-20T00:00:00.000Z', 'adm_preview_owner', '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z'),
  ('upd_d_withdrawn', 'prj_preview_d', 'Withdrawn update', 'Must never appear in client output.', 'progress', 'withdrawn', '2026-08-18T00:00:00.000Z', 'adm_preview_owner', '2026-08-18T00:00:00.000Z', '2026-08-20T00:00:00.000Z'),
  ('upd_e_action', 'prj_preview_e', 'Approve fictional homepage direction', 'Review the fictional direction and send approval.', 'client_request', 'published', '2026-08-20T00:00:00.000Z', 'adm_preview_owner', '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z');

INSERT INTO project_milestones (id, project_id, title, description, status, target_date, publication_status, published_at, sort_order, created_at, updated_at) VALUES
  ('mil_d_1', 'prj_preview_d', 'Discovery + baseline', 'Initial audit and measurement baseline.', 'completed', '2026-07-31', 'published', '2026-08-01T00:00:00.000Z', 1, '2026-07-15T00:00:00.000Z', '2026-08-01T00:00:00.000Z'),
  ('mil_d_2', 'prj_preview_d', 'Visibility foundation', 'Current implementation stage.', 'in_progress', '2026-08-31', 'published', '2026-08-01T00:00:00.000Z', 2, '2026-07-15T00:00:00.000Z', '2026-08-01T00:00:00.000Z');

INSERT INTO deliverables (id, project_id, title, description, deliverable_type, external_url, publication_status, published_at, completed_at, created_at, updated_at) VALUES
  ('del_d_pub', 'prj_preview_d', 'Discovery summary', 'Fictional preview deliverable.', 'report', 'https://example.test/fictional-report', 'published', '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z'),
  ('del_d_private', 'prj_preview_d', 'Internal working file', 'Must never appear in client output.', 'document', NULL, 'internal', NULL, NULL, '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z'),
  ('del_f_pub', 'prj_preview_f', 'Final engagement report', 'Fictional completed engagement report.', 'report', 'https://example.test/fictional-final-report', 'published', '2026-06-30T00:00:00.000Z', '2026-06-30T00:00:00.000Z', '2026-06-30T00:00:00.000Z', '2026-06-30T00:00:00.000Z');

INSERT INTO project_phases (id, project_id, name, sequence, status, target_start_date, target_end_date, client_action_required, client_action_note, publication_status, published_at, created_at, updated_at) VALUES
  ('phs_d_1', 'prj_preview_d', 'Discovery & measurement baseline', 1, 'completed', '2026-07-15', '2026-07-31', 0, NULL, 'published', '2026-08-01T00:00:00.000Z', '2026-07-15T00:00:00.000Z', '2026-08-01T00:00:00.000Z'),
  ('phs_d_2', 'prj_preview_d', 'Visibility foundation', 2, 'current', '2026-08-01', '2026-08-31', 1, 'Approve the homepage messaging proof.', 'published', '2026-08-01T00:00:00.000Z', '2026-07-15T00:00:00.000Z', '2026-08-20T00:00:00.000Z'),
  ('phs_d_3', 'prj_preview_d', 'Content and experience rollout', 3, 'upcoming', '2026-09-01', '2026-09-20', 0, NULL, 'published', '2026-08-01T00:00:00.000Z', '2026-07-15T00:00:00.000Z', '2026-08-01T00:00:00.000Z'),
  ('phs_d_internal', 'prj_preview_d', 'Internal-only future phase', 4, 'upcoming', NULL, NULL, 0, NULL, 'internal', NULL, '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z');

UPDATE project_milestones SET phase_id = 'phs_d_1' WHERE id = 'mil_d_1';
UPDATE project_milestones SET phase_id = 'phs_d_2' WHERE id = 'mil_d_2';

INSERT INTO project_progress_snapshots (id, project_id, snapshot_date, week_number, completed_milestones_count, total_milestones_count, publication_status, published_at, created_by_admin_id, created_at, updated_at) VALUES
  ('pgs_d_1', 'prj_preview_d', '2026-07-19', 1, 0, 5, 'published', '2026-07-19T00:00:00.000Z', 'adm_preview_owner', '2026-07-19T00:00:00.000Z', '2026-07-19T00:00:00.000Z'),
  ('pgs_d_2', 'prj_preview_d', '2026-07-26', 2, 1, 5, 'published', '2026-07-26T00:00:00.000Z', 'adm_preview_owner', '2026-07-26T00:00:00.000Z', '2026-07-26T00:00:00.000Z'),
  ('pgs_d_3', 'prj_preview_d', '2026-08-02', 3, 2, 5, 'published', '2026-08-02T00:00:00.000Z', 'adm_preview_owner', '2026-08-02T00:00:00.000Z', '2026-08-02T00:00:00.000Z'),
  ('pgs_d_internal', 'prj_preview_d', '2026-08-09', 4, 3, 5, 'internal', NULL, 'adm_preview_owner', '2026-08-09T00:00:00.000Z', '2026-08-09T00:00:00.000Z');

INSERT INTO project_performance_metrics (id, project_id, metric_key, label, category, current_value, baseline_value, trend, interpretation, sort_order, publication_status, published_at, created_by_admin_id, created_at, updated_at) VALUES
  ('met_d_visibility', 'prj_preview_d', 'local_visibility', 'Local visibility', 'visibility', '+18%', 'Aug 1 baseline', 'up', 'Local pack appearances trending up since the visibility phase began.', 1, 'published', '2026-08-20T00:00:00.000Z', 'adm_preview_owner', '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z'),
  ('met_d_tech', 'prj_preview_d', 'technical_issues_resolved', 'Technical issues resolved', 'website_ux', '9 of 12', NULL, 'up', NULL, 2, 'published', '2026-08-20T00:00:00.000Z', 'adm_preview_owner', '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z'),
  ('met_d_internal', 'prj_preview_d', 'internal_only_metric', 'Must never appear in client output', 'general', '0', NULL, 'flat', NULL, 3, 'internal', NULL, 'adm_preview_owner', '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z');
