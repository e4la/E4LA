-- Fictional Content Intelligence preview fixture. Loaded ADDITIONALLY alongside
-- fixtures/client-operations.preview.sql (never standalone - it reuses clt_preview_d,
-- clt_preview_a, adm_preview_owner, adm_preview_collab, prj_preview_d/prj_preview_a
-- from that base fixture). All data is fictional preview-only content.

INSERT INTO brand_brains (
  id, client_id, version_number, business_description, services_summary, locations, target_audience,
  customer_problems, goals, brand_voice, preferred_language, forbidden_phrases_json, forbidden_claims_json,
  visual_direction, content_pillars_json, ctas_json, platform_rules_json, approval_rules_json,
  compliance_risk_notes, competitor_notes, publishing_cadence, kpis_json, automation_mode, active,
  created_by_admin_id, created_at
) VALUES (
  'bb_preview_1', 'clt_preview_d', 1,
  'Fictional boutique hotel focused on local visibility and direct bookings.',
  'Rooms, events, and local experience packages.',
  'Fictional coastal town, USA', 'Leisure travelers researching boutique stays',
  'Low direct-booking visibility versus OTAs', 'Grow direct bookings and local search presence',
  'Warm, confident, never gimmicky', 'en', '[]', '[]',
  'Natural light, warm tones, no stock-photo look', '["local_visibility","guest_experience"]', '["Book direct","Check availability"]',
  '{}', '{}', 'No unverified health/safety claims', 'Two nearby fictional competitors track similar local packages',
  '3x per week', '[]', 'client_approval', 1, 'adm_preview_owner', '2026-08-21T00:00:00.000Z'
);

INSERT INTO content_plans (
  id, client_id, project_id, brand_brain_id, name, period_start, period_end, status, created_by_admin_id, created_at, updated_at
) VALUES
  ('cip_preview_a', 'clt_preview_d', 'prj_preview_d', 'bb_preview_1', 'September content plan', '2026-09-01', '2026-09-30', 'draft', 'adm_preview_owner', '2026-08-21T00:00:00.000Z', '2026-08-21T00:00:00.000Z'),
  ('cip_preview_b', 'clt_preview_d', 'prj_preview_d', 'bb_preview_1', 'August content plan', '2026-08-01', '2026-08-31', 'sent_to_client', 'adm_preview_owner', '2026-08-15T00:00:00.000Z', '2026-08-18T00:00:00.000Z'),
  ('cip_preview_c', 'clt_preview_d', 'prj_preview_d', 'bb_preview_1', 'July content plan', '2026-07-01', '2026-07-31', 'client_approved', 'adm_preview_owner', '2026-07-05T00:00:00.000Z', '2026-07-20T00:00:00.000Z');

INSERT INTO content_items (
  id, client_id, content_plan_id, topic, objective, audience, pillar, master_copy, cta, scheduled_date,
  status, risk_level, internal_notes, client_visible_notes, created_by_admin_id, created_at, updated_at
) VALUES
  ('ci_preview_idea', 'clt_preview_d', 'cip_preview_a', 'Fictional fall packages teaser', 'Awareness', 'Leisure travelers', 'guest_experience', NULL, NULL, NULL, 'idea', 'green', 'Waiting on photography.', NULL, 'adm_preview_owner', '2026-08-21T00:00:00.000Z', '2026-08-21T00:00:00.000Z'),
  ('ci_preview_researched', 'clt_preview_d', 'cip_preview_a', 'Local weekend getaway guide', 'Local visibility', 'Nearby leisure travelers', 'local_visibility', NULL, NULL, NULL, 'researched', 'green', 'Confirmed local search demand via keyword tool.', NULL, 'adm_preview_owner', '2026-08-21T00:00:00.000Z', '2026-08-21T00:00:00.000Z'),
  ('ci_preview_drafting', 'clt_preview_d', 'cip_preview_b', 'Fictional guest story highlight', 'Trust building', 'Prospective guests', 'guest_experience', 'Draft copy in progress.', 'Book direct', NULL, 'drafting', 'green', 'Needs guest quote approval from front desk.', NULL, 'adm_preview_owner', '2026-08-18T00:00:00.000Z', '2026-08-20T00:00:00.000Z'),
  ('ci_preview_review', 'clt_preview_d', 'cip_preview_b', 'Fictional local event partnership', 'Local visibility', 'Local community', 'local_visibility', 'Copy ready for internal review.', 'Check availability', '2026-09-05', 'e4la_review', 'yellow', 'Confirm partner name spelling before send.', NULL, 'adm_preview_owner', '2026-08-19T00:00:00.000Z', '2026-08-22T00:00:00.000Z'),
  ('ci_preview_approved_e4la', 'clt_preview_d', 'cip_preview_b', 'Fictional wellness weekend claim', 'Conversion', 'Wellness travelers', 'guest_experience', 'Copy references a wellness statistic.', 'Book direct', '2026-09-10', 'e4la_approved', 'red', 'Statistic needs a real cited source before this can ever be approved.', NULL, 'adm_preview_owner', '2026-08-20T00:00:00.000Z', '2026-08-23T00:00:00.000Z'),
  ('ci_preview_published', 'clt_preview_d', 'cip_preview_c', 'Fictional July highlights recap', 'Engagement', 'Past and prospective guests', 'guest_experience', 'Published recap copy.', 'Book direct', '2026-07-25', 'published', 'green', 'Performed well internally, no follow-up needed.', 'A look back at a great July at the fictional property.', 'adm_preview_owner', '2026-07-20T00:00:00.000Z', '2026-07-25T00:00:00.000Z');

INSERT INTO content_sources (
  id, client_id, source_type, expert_name, recording_reference, captured_at, insight, url,
  verification_needed, verification_status, created_by_admin_id, created_at
) VALUES (
  'src_preview_a', 'clt_preview_d', 'internal_expert', 'Fictional General Manager', 'call-2026-08-15', '2026-08-15T00:00:00.000Z',
  'Direct bookings rise when local guides are highlighted.', 'https://example.test/fictional-source', 1, 'verified', 'adm_preview_owner', '2026-08-15T00:00:00.000Z'
);

INSERT INTO content_claims (
  id, content_item_id, claim_text, source_id, risk_level, verification_status, verified_by_admin_id, verified_at, created_at
) VALUES
  ('clm_preview_green', 'ci_preview_approved_e4la', 'Guests who book direct save on average versus OTA pricing (fictional figure).', 'src_preview_a', 'green', 'verified', 'adm_preview_owner', '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z'),
  ('clm_preview_red', 'ci_preview_approved_e4la', 'This wellness package improves sleep quality by a specific fictional percentage.', NULL, 'red', 'unverified', NULL, NULL, '2026-08-20T00:00:00.000Z');

INSERT INTO content_assets (
  id, client_id, content_item_id, provider, template_reference, render_status, asset_url,
  requested_by_admin_id, requested_at, rendered_at, created_at, updated_at
) VALUES (
  'ast_preview_a', 'clt_preview_d', 'ci_preview_published', 'manual_upload', NULL, 'rendered', 'https://example.test/fictional-asset.jpg',
  'adm_preview_owner', '2026-07-21T00:00:00.000Z', '2026-07-21T00:00:00.000Z', '2026-07-21T00:00:00.000Z', '2026-07-21T00:00:00.000Z'
);

INSERT INTO content_platform_variants (
  id, content_item_id, platform, caption, hashtags_json, asset_id, status, created_at, updated_at
) VALUES (
  'var_preview_a', 'ci_preview_published', 'manual_export', 'A look back at a fictional great July.', '["#fictionalgetaway"]', 'ast_preview_a', 'published', '2026-07-24T00:00:00.000Z', '2026-07-25T00:00:00.000Z'
);

INSERT INTO publishing_accounts (
  id, client_id, platform, account_label, connection_status, external_account_id, connected_at, created_at, updated_at
) VALUES (
  'pacc_preview_a', 'clt_preview_d', 'instagram', 'Fictional Drift Hotel Instagram', 'not_connected', NULL, NULL, '2026-08-15T00:00:00.000Z', '2026-08-15T00:00:00.000Z'
);

INSERT INTO publishing_jobs (
  id, content_platform_variant_id, publishing_account_id, status, external_post_id,
  submitted_at, published_at, verified_at, failure_code, failure_message, created_at, updated_at
) VALUES (
  'pjb_preview_a', 'var_preview_a', NULL, 'published', NULL, '2026-07-25T00:00:00.000Z', '2026-07-25T00:00:00.000Z', NULL, NULL, NULL, '2026-07-25T00:00:00.000Z', '2026-07-25T00:00:00.000Z'
);

INSERT INTO content_metrics (
  id, publishing_job_id, metric_class, metric_key, metric_value, captured_at, created_at
) VALUES (
  'cme_preview_a', 'pjb_preview_a', 'engagement', 'likes', '42', '2026-07-26T00:00:00.000Z', '2026-07-26T00:00:00.000Z'
);
