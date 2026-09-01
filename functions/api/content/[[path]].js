import {
  HttpError, audit, authenticate, errorResponse, json, requestId, requireCsrf,
  requireFields, requireJson, requireTrustedOrigin, sanitizeText,
} from '../../_shared/ops-security.js';
import {
  ALL_CONTENT_ITEM_STATUSES, CLIENT_ALLOWED_STATUS_TRANSITIONS, CLIENT_APPROVER_VISIBLE_STATUSES,
  CONTENT_ITEM_TRANSITIONS, CONTENT_PLAN_TRANSITIONS, assertAutomationModeAllowed, clientVisibleStatusesForRole,
  opaqueId, parseJson, requiresClientReview, sanitizeDate, toClientSafeContentItem,
} from '../../_shared/content.js';
import { requestAdobeRender } from '../../_shared/adobe-adapter.js';
import { publishToplatform } from '../../_shared/publishing-adapters.js';

// Independent Content Intelligence router. Cloudflare routes /api/content/* to
// this file automatically. This module never imports from, or writes to,
// functions/api/ops/[[path]].js, functions/api/commerce/**, or any of the
// Commercial layer's shared modules - it is a fully separate surface built on
// the same authentication/session/CSRF/audit primitives from ops-security.js.

const ADMIN_ROLES = ['e4la_admin', 'e4la_collaborator'];
const CLIENT_APPROVER_ROLES = ['client_owner', 'authorized_signer'];
const ANY_CLIENT_ROLES = ['client_owner', 'authorized_signer', 'client_viewer'];

export async function onRequest(context) {
  const { request, env } = context;
  try {
    const route = new URL(request.url).pathname.replace(/^\/api\/content\/?/, '').replace(/\/$/, '');
    const key = `${request.method.toUpperCase()} ${route}`;
    const handlers = {};
    const handler = handlers[key]
      || matchHandler(request.method, route, /^clients\/([^/]+)\/brand-brain$/, createBrandBrain, 'POST')
      || matchHandler(request.method, route, /^clients\/([^/]+)\/brand-brain$/, getBrandBrain, 'GET')
      || matchHandler(request.method, route, /^clients\/([^/]+)\/plans$/, createPlan, 'POST')
      || matchHandler(request.method, route, /^clients\/([^/]+)\/plans$/, listPlans, 'GET')
      || matchHandler(request.method, route, /^plans\/([^/]+)$/, getPlan, 'GET')
      || matchHandler(request.method, route, /^plans\/([^/]+)$/, patchPlan, 'PATCH')
      || matchHandler(request.method, route, /^plans\/([^/]+)\/items$/, createContentItem, 'POST')
      || matchHandler(request.method, route, /^items\/([^/]+)\/status$/, patchItemStatus, 'PATCH')
      || matchHandler(request.method, route, /^items\/([^/]+)$/, getItem, 'GET')
      || matchHandler(request.method, route, /^clients\/([^/]+)\/items$/, listItems, 'GET')
      || matchHandler(request.method, route, /^clients\/([^/]+)\/sources$/, createSource, 'POST')
      || matchHandler(request.method, route, /^sources\/([^/]+)\/verify$/, verifySource, 'PATCH')
      || matchHandler(request.method, route, /^items\/([^/]+)\/claims$/, createClaim, 'POST')
      || matchHandler(request.method, route, /^claims\/([^/]+)\/verify$/, verifyClaim, 'PATCH')
      || matchHandler(request.method, route, /^items\/([^/]+)\/assets$/, createAsset, 'POST')
      || matchHandler(request.method, route, /^assets\/([^/]+)\/render$/, renderAsset, 'POST')
      || matchHandler(request.method, route, /^items\/([^/]+)\/platform-variants$/, createPlatformVariant, 'POST')
      || matchHandler(request.method, route, /^variants\/([^/]+)\/publish$/, publishVariant, 'POST')
      || matchHandler(request.method, route, /^jobs\/([^/]+)\/verify$/, verifyJob, 'PATCH')
      || matchHandler(request.method, route, /^jobs\/([^/]+)\/metrics$/, recordMetrics, 'POST');
    if (!handler) throw new HttpError(404, 'not_found', 'This Content Intelligence endpoint is unavailable.');
    return await handler(context);
  } catch (error) {
    return errorResponse(error, request);
  }
}

function matchHandler(method, route, pattern, handler, expectedMethod) {
  if (method.toUpperCase() !== expectedMethod) return null;
  const match = route.match(pattern);
  return match ? (context) => handler(context, decodeURIComponent(match[1])) : null;
}

// ---------------------------------------------------------------------------
// Scoping helpers
// ---------------------------------------------------------------------------

async function loadClient(db, clientId) {
  const client = await db.prepare('SELECT id FROM clients WHERE id = ?').bind(sanitizeText(clientId, 80)).first();
  if (!client) throw new HttpError(404, 'client_not_found', 'The client record is unavailable.');
  return client;
}

// A client's "scoping project" for admin_project_access purposes - content
// tables are client-scoped directly, not project-scoped, so collaborator
// access is resolved through whatever project(s) the client has.
async function assertAdminClientScope(db, session, clientId) {
  const client = await loadClient(db, clientId);
  if (session.role === 'e4la_collaborator') {
    const access = await db.prepare(`
      SELECT 1 AS allowed FROM projects p
      JOIN admin_project_access apa ON apa.project_id = p.id
      WHERE p.client_id = ? AND apa.admin_user_id = ? AND apa.permission_level IN ('contributor','manager')
      LIMIT 1
    `).bind(client.id, session.actor_id).first();
    if (!access) throw new HttpError(403, 'not_authorized', 'You do not have permission to manage content for this client.');
  }
  return client;
}

async function assertAdminItemScope(db, session, item) {
  if (session.role === 'e4la_collaborator') {
    const access = await db.prepare(`
      SELECT 1 AS allowed FROM projects p
      JOIN admin_project_access apa ON apa.project_id = p.id
      WHERE p.client_id = ? AND apa.admin_user_id = ? AND apa.permission_level IN ('contributor','manager')
      LIMIT 1
    `).bind(item.client_id, session.actor_id).first();
    if (!access) throw new HttpError(403, 'not_authorized', 'You do not have permission to manage content for this client.');
  }
}

async function latestBrandBrain(db, clientId) {
  return db.prepare('SELECT * FROM brand_brains WHERE client_id = ? ORDER BY version_number DESC LIMIT 1').bind(clientId).first();
}

async function hasUnresolvedRedClaim(db, contentItemId) {
  const row = await db.prepare(`
    SELECT 1 AS found FROM content_claims
    WHERE content_item_id = ? AND risk_level = 'red' AND verification_status IN ('unverified','insufficient_evidence','rejected')
    LIMIT 1
  `).bind(contentItemId).first();
  return Boolean(row);
}

// ---------------------------------------------------------------------------
// Brand Brain
// ---------------------------------------------------------------------------

async function createBrandBrain({ request, env }, clientId) {
  requireTrustedOrigin(request, env); requireJson(request);
  const session = await authenticate(request, env, ADMIN_ROLES);
  await requireCsrf(request, session);
  const client = await assertAdminClientScope(env.ENROLLMENT_DB, session, clientId);
  const body = await request.json();

  const automationMode = sanitizeText(body.automation_mode, 40) || 'manual';
  if (!['manual', 'assisted', 'client_approval', 'auto_publish_approved_policy'].includes(automationMode)) {
    throw new HttpError(422, 'automation_mode_invalid', 'Select a supported automation mode.');
  }
  assertAutomationModeAllowed(automationMode, body, session, HttpError);

  const previous = await latestBrandBrain(env.ENROLLMENT_DB, client.id);
  const versionNumber = previous ? Number(previous.version_number) + 1 : 1;
  const now = new Date().toISOString();
  const id = opaqueId('bb');
  await env.ENROLLMENT_DB.prepare(`INSERT INTO brand_brains (
    id, client_id, version_number, business_description, services_summary, locations, target_audience,
    customer_problems, goals, brand_voice, preferred_language, forbidden_phrases_json, forbidden_claims_json,
    visual_direction, content_pillars_json, ctas_json, platform_rules_json, approval_rules_json,
    compliance_risk_notes, competitor_notes, publishing_cadence, kpis_json, automation_mode, active,
    created_by_admin_id, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`)
    .bind(
      id, client.id, versionNumber,
      sanitizeText(body.business_description, 4000) || null,
      sanitizeText(body.services_summary, 4000) || null,
      sanitizeText(body.locations, 1000) || null,
      sanitizeText(body.target_audience, 2000) || null,
      sanitizeText(body.customer_problems, 2000) || null,
      sanitizeText(body.goals, 2000) || null,
      sanitizeText(body.brand_voice, 2000) || null,
      sanitizeText(body.preferred_language, 10) || 'en',
      JSON.stringify(Array.isArray(body.forbidden_phrases) ? body.forbidden_phrases : []),
      JSON.stringify(Array.isArray(body.forbidden_claims) ? body.forbidden_claims : []),
      sanitizeText(body.visual_direction, 2000) || null,
      JSON.stringify(Array.isArray(body.content_pillars) ? body.content_pillars : []),
      JSON.stringify(Array.isArray(body.ctas) ? body.ctas : []),
      JSON.stringify(body.platform_rules && typeof body.platform_rules === 'object' ? body.platform_rules : {}),
      JSON.stringify(body.approval_rules && typeof body.approval_rules === 'object' ? body.approval_rules : {}),
      sanitizeText(body.compliance_risk_notes, 2000) || null,
      sanitizeText(body.competitor_notes, 2000) || null,
      sanitizeText(body.publishing_cadence, 500) || null,
      JSON.stringify(Array.isArray(body.kpis) ? body.kpis : []),
      automationMode, session.actor_id, now,
    ).run();
  await audit(env.ENROLLMENT_DB, {
    type: 'brand_brain_version_created', actorType: 'admin_user', actorId: session.actor_id,
    clientId: client.id, requestId: requestId(request), data: { brandBrainId: id, versionNumber, automationMode },
  });
  return json({ id, clientId: client.id, versionNumber, automationMode }, 201);
}

async function getBrandBrain({ request, env }, clientId) {
  const session = await authenticate(request, env, ADMIN_ROLES);
  const client = await assertAdminClientScope(env.ENROLLMENT_DB, session, clientId);
  const brainRow = await latestBrandBrain(env.ENROLLMENT_DB, client.id);
  if (!brainRow) throw new HttpError(404, 'brand_brain_not_found', 'No brand brain version exists for this client yet.');
  return json({
    ...brainRow,
    forbidden_phrases: parseJson(brainRow.forbidden_phrases_json, []),
    forbidden_claims: parseJson(brainRow.forbidden_claims_json, []),
    content_pillars: parseJson(brainRow.content_pillars_json, []),
    ctas: parseJson(brainRow.ctas_json, []),
    platform_rules: parseJson(brainRow.platform_rules_json, {}),
    approval_rules: parseJson(brainRow.approval_rules_json, {}),
    kpis: parseJson(brainRow.kpis_json, []),
  });
}

// ---------------------------------------------------------------------------
// Content Plans
// ---------------------------------------------------------------------------

async function createPlan({ request, env }, clientId) {
  requireTrustedOrigin(request, env); requireJson(request);
  const session = await authenticate(request, env, ADMIN_ROLES);
  await requireCsrf(request, session);
  const client = await assertAdminClientScope(env.ENROLLMENT_DB, session, clientId);
  const body = await request.json();
  requireFields(body, ['name']);
  const now = new Date().toISOString();
  const id = opaqueId('cip');
  await env.ENROLLMENT_DB.prepare(`INSERT INTO content_plans (
    id, client_id, project_id, brand_brain_id, name, period_start, period_end, status, created_by_admin_id, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)`)
    .bind(id, client.id, sanitizeText(body.project_id, 80) || null, sanitizeText(body.brand_brain_id, 80) || null,
      sanitizeText(body.name, 180), sanitizeDate(body.period_start, sanitizeText), sanitizeDate(body.period_end, sanitizeText),
      session.actor_id, now, now).run();
  await audit(env.ENROLLMENT_DB, { type: 'content_plan_created', actorType: 'admin_user', actorId: session.actor_id, clientId: client.id, requestId: requestId(request), data: { planId: id } });
  return json({ id, clientId: client.id, status: 'draft' }, 201);
}

function planClientView(row) {
  return {
    id: row.id, name: row.name, periodStart: row.period_start, periodEnd: row.period_end,
    status: row.status, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

async function listPlans({ request, env }, clientId) {
  const session = await authenticate(request, env, [...ADMIN_ROLES, ...ANY_CLIENT_ROLES]);
  const db = env.ENROLLMENT_DB;
  if (ADMIN_ROLES.includes(session.role)) {
    const client = await assertAdminClientScope(db, session, clientId);
    const rows = await db.prepare('SELECT * FROM content_plans WHERE client_id = ? ORDER BY created_at DESC').bind(client.id).all();
    return json({ plans: rows.results });
  }
  if (sanitizeText(clientId, 80) !== session.client_id) throw new HttpError(404, 'client_not_found', 'The client record is unavailable.');
  const rows = await db.prepare('SELECT * FROM content_plans WHERE client_id = ? ORDER BY created_at DESC').bind(session.client_id).all();
  return json({ plans: rows.results.map(planClientView) });
}

async function getPlan({ request, env }, planId) {
  const session = await authenticate(request, env, [...ADMIN_ROLES, ...ANY_CLIENT_ROLES]);
  const db = env.ENROLLMENT_DB;
  const plan = await db.prepare('SELECT * FROM content_plans WHERE id = ?').bind(sanitizeText(planId, 80)).first();
  if (!plan) throw new HttpError(404, 'plan_not_found', 'The selected content plan is unavailable.');
  if (ADMIN_ROLES.includes(session.role)) {
    await assertAdminClientScope(db, session, plan.client_id);
    return json(plan);
  }
  if (plan.client_id !== session.client_id) throw new HttpError(404, 'plan_not_found', 'The selected content plan is unavailable.');
  return json(planClientView(plan));
}

async function patchPlan({ request, env }, planId) {
  requireTrustedOrigin(request, env); requireJson(request);
  const session = await authenticate(request, env, ADMIN_ROLES);
  await requireCsrf(request, session);
  const db = env.ENROLLMENT_DB;
  const plan = await db.prepare('SELECT * FROM content_plans WHERE id = ?').bind(sanitizeText(planId, 80)).first();
  if (!plan) throw new HttpError(404, 'plan_not_found', 'The selected content plan is unavailable.');
  await assertAdminClientScope(db, session, plan.client_id);
  const body = await request.json();
  const now = new Date().toISOString();
  const fields = {};
  if (body.name !== undefined) fields.name = sanitizeText(body.name, 180);
  if (body.period_start !== undefined) fields.period_start = sanitizeDate(body.period_start, sanitizeText);
  if (body.period_end !== undefined) fields.period_end = sanitizeDate(body.period_end, sanitizeText);
  if (body.status !== undefined) {
    const target = sanitizeText(body.status, 30);
    const allowed = CONTENT_PLAN_TRANSITIONS[plan.status] || [];
    if (!allowed.includes(target)) throw new HttpError(422, 'plan_transition_invalid', `Cannot move a content plan from '${plan.status}' to '${target}'.`);
    fields.status = target;
  }
  const keys = Object.keys(fields);
  if (!keys.length) throw new HttpError(422, 'plan_update_empty', 'Provide at least one supported field to update.');
  // NOTE: this update ONLY ever touches content_plans. There is deliberately
  // no read or write of content_items anywhere in this function - approving a
  // plan must never cascade into approving the posts under it.
  await db.prepare(`UPDATE content_plans SET ${keys.map((key) => `${key} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
    .bind(...keys.map((key) => fields[key]), now, plan.id).run();
  await audit(env.ENROLLMENT_DB, { type: 'content_plan_updated', actorType: 'admin_user', actorId: session.actor_id, clientId: plan.client_id, requestId: requestId(request), data: { planId: plan.id, updated: keys } });
  return json({ id: plan.id, updated: keys });
}

// ---------------------------------------------------------------------------
// Content Items
// ---------------------------------------------------------------------------

async function createContentItem({ request, env }, planId) {
  requireTrustedOrigin(request, env); requireJson(request);
  const session = await authenticate(request, env, ADMIN_ROLES);
  await requireCsrf(request, session);
  const db = env.ENROLLMENT_DB;
  const plan = await db.prepare('SELECT * FROM content_plans WHERE id = ?').bind(sanitizeText(planId, 80)).first();
  if (!plan) throw new HttpError(404, 'plan_not_found', 'The selected content plan is unavailable.');
  await assertAdminClientScope(db, session, plan.client_id);
  const body = await request.json();
  requireFields(body, ['topic']);
  const now = new Date().toISOString();
  const id = opaqueId('ci');
  await db.prepare(`INSERT INTO content_items (
    id, client_id, content_plan_id, topic, objective, audience, pillar, master_copy, cta, scheduled_date,
    status, risk_level, internal_notes, client_visible_notes, created_by_admin_id, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'idea', ?, ?, ?, ?, ?, ?)`)
    .bind(id, plan.client_id, plan.id, sanitizeText(body.topic, 200),
      sanitizeText(body.objective, 1000) || null, sanitizeText(body.audience, 1000) || null,
      sanitizeText(body.pillar, 200) || null, sanitizeText(body.master_copy, 8000) || null,
      sanitizeText(body.cta, 500) || null, sanitizeDate(body.scheduled_date, sanitizeText),
      ['green', 'yellow', 'red'].includes(body.risk_level) ? body.risk_level : 'green',
      sanitizeText(body.internal_notes, 4000) || null, sanitizeText(body.client_visible_notes, 4000) || null,
      session.actor_id, now, now).run();
  await audit(env.ENROLLMENT_DB, { type: 'content_item_created', actorType: 'admin_user', actorId: session.actor_id, clientId: plan.client_id, requestId: requestId(request), data: { itemId: id, planId: plan.id } });
  return json({ id, clientId: plan.client_id, planId: plan.id, status: 'idea' }, 201);
}

async function loadItem(db, itemId) {
  const item = await db.prepare('SELECT * FROM content_items WHERE id = ?').bind(sanitizeText(itemId, 80)).first();
  if (!item) throw new HttpError(404, 'content_item_not_found', 'The selected content item is unavailable.');
  return item;
}

async function getItem({ request, env }, itemId) {
  const session = await authenticate(request, env, [...ADMIN_ROLES, ...ANY_CLIENT_ROLES]);
  const db = env.ENROLLMENT_DB;
  const item = await loadItem(db, itemId);
  if (ADMIN_ROLES.includes(session.role)) {
    await assertAdminItemScope(db, session, item);
    return json(item);
  }
  if (item.client_id !== session.client_id) throw new HttpError(404, 'content_item_not_found', 'The selected content item is unavailable.');
  const visible = clientVisibleStatusesForRole(session.role);
  if (!visible.includes(item.status)) throw new HttpError(404, 'content_item_not_found', 'The selected content item is unavailable.');
  return json(toClientSafeContentItem(item));
}

async function listItems({ request, env }, clientId) {
  const session = await authenticate(request, env, [...ADMIN_ROLES, ...ANY_CLIENT_ROLES]);
  const db = env.ENROLLMENT_DB;
  if (ADMIN_ROLES.includes(session.role)) {
    const client = await assertAdminClientScope(db, session, clientId);
    const rows = await db.prepare('SELECT * FROM content_items WHERE client_id = ? ORDER BY created_at DESC').bind(client.id).all();
    return json({ items: rows.results });
  }
  if (sanitizeText(clientId, 80) !== session.client_id) throw new HttpError(404, 'client_not_found', 'The client record is unavailable.');
  const visible = clientVisibleStatusesForRole(session.role);
  if (!visible.length) return json({ items: [] });
  const placeholders = visible.map(() => '?').join(',');
  const rows = await db.prepare(`SELECT * FROM content_items WHERE client_id = ? AND status IN (${placeholders}) ORDER BY created_at DESC`)
    .bind(session.client_id, ...visible).all();
  return json({ items: rows.results.map(toClientSafeContentItem) });
}

async function patchItemStatus({ request, env }, itemId) {
  requireTrustedOrigin(request, env); requireJson(request);
  const session = await authenticate(request, env, [...ADMIN_ROLES, ...CLIENT_APPROVER_ROLES]);
  await requireCsrf(request, session);
  const db = env.ENROLLMENT_DB;
  const item = await loadItem(db, itemId);
  const isAdmin = ADMIN_ROLES.includes(session.role);
  if (isAdmin) {
    await assertAdminItemScope(db, session, item);
  } else if (item.client_id !== session.client_id) {
    throw new HttpError(404, 'content_item_not_found', 'The selected content item is unavailable.');
  }

  const body = await request.json();
  const targetStatus = sanitizeText(body.status, 30);
  if (!ALL_CONTENT_ITEM_STATUSES.includes(targetStatus)) throw new HttpError(422, 'status_invalid', 'Select a supported content item status.');

  const allowedFromCurrent = CONTENT_ITEM_TRANSITIONS[item.status] || [];
  if (!allowedFromCurrent.includes(targetStatus)) {
    throw new HttpError(422, 'status_transition_invalid', `Cannot move a content item from '${item.status}' to '${targetStatus}'.`);
  }

  if (!isAdmin) {
    const clientAllowed = CLIENT_ALLOWED_STATUS_TRANSITIONS[item.status] || [];
    if (!clientAllowed.includes(targetStatus)) {
      throw new HttpError(403, 'not_authorized', 'A client session may only move content between client_review and approved/revision_requested.');
    }
  }

  const brandBrain = await latestBrandBrain(db, item.client_id);
  if (item.status === 'e4la_approved' && targetStatus === 'client_review' && !requiresClientReview(brandBrain)) {
    throw new HttpError(422, 'client_review_not_required', "This client's brand brain does not require a client-review step.");
  }
  if (item.status === 'e4la_approved' && targetStatus === 'approved' && requiresClientReview(brandBrain)) {
    throw new HttpError(422, 'client_review_required', 'This client requires a client-review step before approval.');
  }

  if (targetStatus === 'approved' && await hasUnresolvedRedClaim(db, item.id)) {
    throw new HttpError(422, 'unresolved_red_claim', 'This content item has an unresolved RED-risk claim and cannot be approved.');
  }

  const now = new Date().toISOString();
  await db.prepare('UPDATE content_items SET status = ?, updated_at = ? WHERE id = ?').bind(targetStatus, now, item.id).run();

  const decisionByTarget = { approved: 'approved', rejected: 'rejected', revision_requested: 'revision_requested' };
  if (decisionByTarget[targetStatus]) {
    await db.prepare(`INSERT INTO content_approvals (
      id, content_item_id, approval_type, decision, comment, actor_type, actor_id, decided_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(opaqueId('apv'), item.id, isAdmin ? 'e4la_internal' : 'client', decisionByTarget[targetStatus],
        sanitizeText(body.comment, 2000) || null, isAdmin ? 'admin_user' : 'client_user', session.actor_id, now, now).run();
  }

  await audit(db, {
    type: 'content_item_status_changed', actorType: isAdmin ? 'admin_user' : 'client_user', actorId: session.actor_id,
    clientId: item.client_id, requestId: requestId(request),
    data: { itemId: item.id, fromStatus: item.status, toStatus: targetStatus },
  });

  return json({ id: item.id, status: targetStatus });
}

// ---------------------------------------------------------------------------
// Sources and Claims
// ---------------------------------------------------------------------------

async function createSource({ request, env }, clientId) {
  requireTrustedOrigin(request, env); requireJson(request);
  const session = await authenticate(request, env, ADMIN_ROLES);
  await requireCsrf(request, session);
  const client = await assertAdminClientScope(env.ENROLLMENT_DB, session, clientId);
  const body = await request.json();
  requireFields(body, ['source_type']);
  const sourceType = sanitizeText(body.source_type, 40);
  if (!['internal_expert', 'search_demand', 'customer_question', 'current_verified_source', 'url_reference'].includes(sourceType)) {
    throw new HttpError(422, 'source_type_invalid', 'Select a supported source type.');
  }
  const now = new Date().toISOString();
  const id = opaqueId('src');
  await env.ENROLLMENT_DB.prepare(`INSERT INTO content_sources (
    id, client_id, source_type, expert_name, recording_reference, captured_at, insight, url,
    verification_needed, verification_status, created_by_admin_id, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'unverified', ?, ?)`)
    .bind(id, client.id, sourceType, sanitizeText(body.expert_name, 200) || null,
      sanitizeText(body.recording_reference, 500) || null, sanitizeText(body.captured_at, 40) || null,
      sanitizeText(body.insight, 4000) || null, sanitizeText(body.url, 1000) || null,
      body.verification_needed === false ? 0 : 1, session.actor_id, now).run();
  return json({ id, clientId: client.id, verificationStatus: 'unverified' }, 201);
}

async function verifySource({ request, env }, sourceId) {
  requireTrustedOrigin(request, env); requireJson(request);
  const session = await authenticate(request, env, ADMIN_ROLES);
  await requireCsrf(request, session);
  const db = env.ENROLLMENT_DB;
  const source = await db.prepare('SELECT * FROM content_sources WHERE id = ?').bind(sanitizeText(sourceId, 80)).first();
  if (!source) throw new HttpError(404, 'source_not_found', 'The selected source is unavailable.');
  await assertAdminClientScope(db, session, source.client_id);
  const body = await request.json();
  const status = sanitizeText(body.verification_status, 20);
  if (!['unverified', 'verified', 'rejected'].includes(status)) throw new HttpError(422, 'verification_status_invalid', 'Select a supported source verification status.');
  await db.prepare('UPDATE content_sources SET verification_status = ? WHERE id = ?').bind(status, source.id).run();
  return json({ id: source.id, verificationStatus: status });
}

async function createClaim({ request, env }, itemId) {
  requireTrustedOrigin(request, env); requireJson(request);
  const session = await authenticate(request, env, ADMIN_ROLES);
  await requireCsrf(request, session);
  const db = env.ENROLLMENT_DB;
  const item = await loadItem(db, itemId);
  await assertAdminItemScope(db, session, item);
  const body = await request.json();
  requireFields(body, ['claim_text']);
  const riskLevel = ['green', 'yellow', 'red'].includes(body.risk_level) ? body.risk_level : 'yellow';
  const now = new Date().toISOString();
  const id = opaqueId('clm');
  await db.prepare(`INSERT INTO content_claims (
    id, content_item_id, claim_text, source_id, risk_level, verification_status, created_at
  ) VALUES (?, ?, ?, ?, ?, 'unverified', ?)`)
    .bind(id, item.id, sanitizeText(body.claim_text, 2000), sanitizeText(body.source_id, 80) || null, riskLevel, now).run();
  return json({ id, contentItemId: item.id, riskLevel, verificationStatus: 'unverified' }, 201);
}

async function verifyClaim({ request, env }, claimId) {
  requireTrustedOrigin(request, env); requireJson(request);
  const session = await authenticate(request, env, ADMIN_ROLES);
  await requireCsrf(request, session);
  const db = env.ENROLLMENT_DB;
  const claim = await db.prepare('SELECT * FROM content_claims WHERE id = ?').bind(sanitizeText(claimId, 80)).first();
  if (!claim) throw new HttpError(404, 'claim_not_found', 'The selected claim is unavailable.');
  const item = await loadItem(db, claim.content_item_id);
  await assertAdminItemScope(db, session, item);
  const body = await request.json();
  const status = sanitizeText(body.verification_status, 30);
  if (!['unverified', 'verified', 'insufficient_evidence', 'rejected'].includes(status)) {
    throw new HttpError(422, 'verification_status_invalid', 'Select a supported claim verification status.');
  }
  const sourceId = body.source_id !== undefined ? (sanitizeText(body.source_id, 80) || null) : claim.source_id;
  // "A URL alone is not verification": a claim can only be set to 'verified'
  // when it carries an actual source_id reference (either newly supplied or
  // already on the row). insufficient_evidence/rejected/unverified never
  // require one - those are honest "we could not verify this" outcomes.
  if (status === 'verified') {
    if (!sourceId) throw new HttpError(422, 'source_required', 'A claim cannot be verified without a source_id reference.');
    const source = await db.prepare('SELECT id FROM content_sources WHERE id = ?').bind(sourceId).first();
    if (!source) throw new HttpError(422, 'source_required', 'The referenced source does not exist.');
  }
  const now = new Date().toISOString();
  await db.prepare('UPDATE content_claims SET verification_status = ?, source_id = ?, verified_by_admin_id = ?, verified_at = ? WHERE id = ?')
    .bind(status, sourceId, session.actor_id, now, claim.id).run();
  await audit(db, { type: 'content_claim_verified', actorType: 'admin_user', actorId: session.actor_id, clientId: item.client_id, requestId: requestId(request), data: { claimId: claim.id, status } });
  return json({ id: claim.id, verificationStatus: status, sourceId });
}

// ---------------------------------------------------------------------------
// Assets (Adobe adapter)
// ---------------------------------------------------------------------------

async function createAsset({ request, env }, itemId) {
  requireTrustedOrigin(request, env); requireJson(request);
  const session = await authenticate(request, env, ADMIN_ROLES);
  await requireCsrf(request, session);
  const db = env.ENROLLMENT_DB;
  const item = await loadItem(db, itemId);
  await assertAdminItemScope(db, session, item);
  const body = await request.json();
  const provider = sanitizeText(body.provider, 20) || 'adobe';
  if (!['adobe', 'manual_upload'].includes(provider)) throw new HttpError(422, 'provider_invalid', 'Select a supported asset provider.');
  const now = new Date().toISOString();
  const id = opaqueId('ast');
  await db.prepare(`INSERT INTO content_assets (
    id, client_id, content_item_id, provider, template_reference, render_status, asset_url,
    requested_by_admin_id, requested_at, rendered_at, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, 'not_requested', NULL, ?, NULL, NULL, ?, ?)`)
    .bind(id, item.client_id, item.id, provider, sanitizeText(body.template_reference, 200) || null, session.actor_id, now, now).run();
  return json({ id, contentItemId: item.id, provider, renderStatus: 'not_requested' }, 201);
}

async function renderAsset({ request, env }, assetId) {
  requireTrustedOrigin(request, env); requireJson(request);
  const session = await authenticate(request, env, ADMIN_ROLES);
  await requireCsrf(request, session);
  const db = env.ENROLLMENT_DB;
  const asset = await db.prepare('SELECT * FROM content_assets WHERE id = ?').bind(sanitizeText(assetId, 80)).first();
  if (!asset) throw new HttpError(404, 'asset_not_found', 'The selected asset is unavailable.');
  if (asset.content_item_id) {
    const item = await loadItem(db, asset.content_item_id);
    await assertAdminItemScope(db, session, item);
  }
  const body = await request.json();
  const now = new Date().toISOString();
  if (asset.provider !== 'adobe') {
    throw new HttpError(422, 'render_not_applicable', 'Only adobe-provider assets can be rendered through this endpoint.');
  }
  const result = await requestAdobeRender(env, { templateReference: asset.template_reference, fields: body.fields || {} });
  const renderStatus = ['unavailable', 'rendering', 'failed'].includes(result.status) ? result.status : 'failed';
  await db.prepare('UPDATE content_assets SET render_status = ?, asset_url = ?, requested_at = COALESCE(requested_at, ?), updated_at = ? WHERE id = ?')
    .bind(renderStatus, result.assetUrl || null, now, now, asset.id).run();
  await audit(db, { type: 'content_asset_render_requested', actorType: 'admin_user', actorId: session.actor_id, clientId: asset.client_id, requestId: requestId(request), data: { assetId: asset.id, renderStatus, reason: result.reason || null } });
  return json({ id: asset.id, renderStatus, reason: result.reason || null });
}

// ---------------------------------------------------------------------------
// Platform variants and Publishing
// ---------------------------------------------------------------------------

async function createPlatformVariant({ request, env }, itemId) {
  requireTrustedOrigin(request, env); requireJson(request);
  const session = await authenticate(request, env, ADMIN_ROLES);
  await requireCsrf(request, session);
  const db = env.ENROLLMENT_DB;
  const item = await loadItem(db, itemId);
  await assertAdminItemScope(db, session, item);
  const body = await request.json();
  const platform = sanitizeText(body.platform, 40);
  if (!['instagram', 'facebook', 'google_business_profile', 'tiktok', 'manual_export'].includes(platform)) {
    throw new HttpError(422, 'platform_invalid', 'Select a supported publishing platform.');
  }
  if (body.asset_id) {
    const asset = await db.prepare('SELECT id FROM content_assets WHERE id = ? AND content_item_id = ?').bind(sanitizeText(body.asset_id, 80), item.id).first();
    if (!asset) throw new HttpError(422, 'asset_invalid', 'The referenced asset does not belong to this content item.');
  }
  const now = new Date().toISOString();
  const id = opaqueId('var');
  // Variants are created 'ready' rather than 'draft' - there is no separate
  // per-variant approval workflow in this data model; the real go/no-go gate
  // for publishing lives on the parent content_item's own status (checked in
  // publishVariant below), not on the variant row itself.
  try {
    await db.prepare(`INSERT INTO content_platform_variants (
      id, content_item_id, platform, caption, hashtags_json, asset_id, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'ready', ?, ?)`)
      .bind(id, item.id, platform, sanitizeText(body.caption, 4000) || null,
        JSON.stringify(Array.isArray(body.hashtags) ? body.hashtags : []), sanitizeText(body.asset_id, 80) || null, now, now).run();
  } catch (error) {
    if (String(error.message || '').includes('UNIQUE')) throw new HttpError(409, 'variant_platform_taken', 'A variant for this platform already exists on this content item.');
    throw error;
  }
  return json({ id, contentItemId: item.id, platform, status: 'ready' }, 201);
}

async function publishVariant({ request, env }, variantId) {
  requireTrustedOrigin(request, env); requireJson(request);
  const session = await authenticate(request, env, ADMIN_ROLES);
  await requireCsrf(request, session);
  const db = env.ENROLLMENT_DB;
  const variant = await db.prepare('SELECT * FROM content_platform_variants WHERE id = ?').bind(sanitizeText(variantId, 80)).first();
  if (!variant) throw new HttpError(404, 'variant_not_found', 'The selected platform variant is unavailable.');
  const item = await loadItem(db, variant.content_item_id);
  await assertAdminItemScope(db, session, item);

  // Defensive double gate: the parent content item must be approved/scheduled,
  // AND the variant itself must already be ready/scheduled - never draft,
  // blocked, rejected, failed, or already published/publishing.
  if (!['approved', 'scheduled'].includes(item.status)) {
    throw new HttpError(422, 'content_item_not_approved', 'This content item is not yet approved or scheduled for publishing.');
  }
  if (!['ready', 'scheduled'].includes(variant.status)) {
    throw new HttpError(422, 'variant_not_ready', 'This platform variant is not ready to publish.');
  }

  const now = new Date().toISOString();
  let account = null;
  if (variant.platform !== 'manual_export') {
    account = await db.prepare(`
      SELECT * FROM publishing_accounts WHERE client_id = ? AND platform = ? ORDER BY created_at DESC LIMIT 1
    `).bind(item.client_id, variant.platform).first();
  }
  const result = await publishToplatform(variant.platform, env, {
    account,
    variant: { caption: variant.caption, hashtags: JSON.parse(variant.hashtags_json || '[]'), assetUrl: null },
  });

  const jobId = opaqueId('pjb');
  if (variant.platform === 'manual_export') {
    await db.prepare(`INSERT INTO publishing_jobs (
      id, content_platform_variant_id, publishing_account_id, status, external_post_id,
      submitted_at, published_at, verified_at, failure_code, failure_message, created_at, updated_at
    ) VALUES (?, ?, NULL, 'published', NULL, ?, ?, NULL, NULL, NULL, ?, ?)`)
      .bind(jobId, variant.id, now, now, now, now).run();
    await db.prepare("UPDATE content_platform_variants SET status = 'published', updated_at = ? WHERE id = ?").bind(now, variant.id).run();
  } else {
    // Honest failure, never a fabricated success: no real platform credential
    // exists in this environment, so this always resolves 'failed' with
    // failure_code 'platform_not_connected' (or another honest failure code).
    await db.prepare(`INSERT INTO publishing_jobs (
      id, content_platform_variant_id, publishing_account_id, status, external_post_id,
      submitted_at, published_at, verified_at, failure_code, failure_message, created_at, updated_at
    ) VALUES (?, ?, ?, 'failed', NULL, ?, NULL, NULL, ?, ?, ?, ?)`)
      .bind(jobId, variant.id, account ? account.id : null, now, result.failureCode || 'platform_not_connected',
        result.failureMessage || 'Publishing platform is not connected.', now, now).run();
    await db.prepare("UPDATE content_platform_variants SET status = 'failed', updated_at = ? WHERE id = ?").bind(now, variant.id).run();
  }

  await audit(db, {
    type: 'content_variant_publish_attempted', actorType: 'admin_user', actorId: session.actor_id, clientId: item.client_id,
    requestId: requestId(request), data: { variantId: variant.id, platform: variant.platform, jobId, status: result.status },
  });

  const job = await db.prepare('SELECT * FROM publishing_jobs WHERE id = ?').bind(jobId).first();
  return json({ jobId, status: job.status, failureCode: job.failure_code, exportPackage: result.exportPackage || null }, 201);
}

async function verifyJob({ request, env }, jobId) {
  requireTrustedOrigin(request, env); requireJson(request);
  const session = await authenticate(request, env, ADMIN_ROLES);
  await requireCsrf(request, session);
  const db = env.ENROLLMENT_DB;
  const job = await db.prepare('SELECT * FROM publishing_jobs WHERE id = ?').bind(sanitizeText(jobId, 80)).first();
  if (!job) throw new HttpError(404, 'job_not_found', 'The selected publishing job is unavailable.');
  const variant = await db.prepare('SELECT * FROM content_platform_variants WHERE id = ?').bind(job.content_platform_variant_id).first();
  const item = await loadItem(db, variant.content_item_id);
  await assertAdminItemScope(db, session, item);
  if (job.status !== 'published') {
    throw new HttpError(409, 'job_not_published', "Only a job already in status 'published' can be moved to 'verified_live'.");
  }
  const now = new Date().toISOString();
  await db.prepare("UPDATE publishing_jobs SET status = 'verified_live', verified_at = ?, updated_at = ? WHERE id = ?").bind(now, now, job.id).run();
  await audit(db, { type: 'content_job_verified_live', actorType: 'admin_user', actorId: session.actor_id, clientId: item.client_id, requestId: requestId(request), data: { jobId: job.id } });
  return json({ id: job.id, status: 'verified_live' });
}

async function recordMetrics({ request, env }, jobId) {
  requireTrustedOrigin(request, env); requireJson(request);
  const session = await authenticate(request, env, ADMIN_ROLES);
  await requireCsrf(request, session);
  const db = env.ENROLLMENT_DB;
  const job = await db.prepare('SELECT * FROM publishing_jobs WHERE id = ?').bind(sanitizeText(jobId, 80)).first();
  if (!job) throw new HttpError(404, 'job_not_found', 'The selected publishing job is unavailable.');
  const variant = await db.prepare('SELECT * FROM content_platform_variants WHERE id = ?').bind(job.content_platform_variant_id).first();
  const item = await loadItem(db, variant.content_item_id);
  await assertAdminItemScope(db, session, item);
  const body = await request.json();
  const metrics = Array.isArray(body.metrics) ? body.metrics : [body];
  if (!metrics.length) throw new HttpError(422, 'metrics_required', 'Provide at least one metric to record.');
  const now = new Date().toISOString();
  const inserted = [];
  for (const metric of metrics) {
    const metricClass = sanitizeText(metric.metric_class, 20);
    if (!['direct', 'assisted', 'engagement'].includes(metricClass)) {
      throw new HttpError(422, 'metric_class_invalid', "metric_class must be exactly one of 'direct', 'assisted', or 'engagement'.");
    }
    const metricKey = sanitizeText(metric.metric_key, 100);
    if (!metricKey) throw new HttpError(422, 'metric_key_required', 'metric_key is required.');
    const id = opaqueId('cme');
    await db.prepare(`INSERT INTO content_metrics (
      id, publishing_job_id, metric_class, metric_key, metric_value, captured_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, job.id, metricClass, metricKey, sanitizeText(String(metric.metric_value ?? ''), 200), sanitizeText(metric.captured_at, 40) || now, now).run();
    inserted.push(id);
  }
  return json({ jobId: job.id, metricIds: inserted }, 201);
}
