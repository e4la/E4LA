import {
  HttpError, audit, authenticate, errorResponse, json, requestId, requireCsrf,
  requireFields, requireJson, requireTrustedOrigin, sanitizeText,
} from '../../_shared/ops-security.js';
import {
  ALL_CONTENT_ITEM_STATUSES, CLIENT_ALLOWED_STATUS_TRANSITIONS, CLIENT_APPROVER_VISIBLE_STATUSES,
  CLIENT_VISIBLE_PLAN_STATUSES, CONTENT_ITEM_TRANSITIONS, CONTENT_PLAN_TRANSITIONS, assertAutomationModeAllowed,
  clientVisibleStatusesForRole, opaqueId, parseJson, requiresClientReview, sanitizeDate, toClientSafeContentItem,
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

// Exact-project collaborator access, matching the commerce router's own
// pattern for a resource that actually has a known project_id: a collaborator
// must hold contributor/manager admin_project_access on THAT SPECIFIC
// project. Having contributor/manager access to some OTHER project belonging
// to the same client must never be enough - a client can have more than one
// project, and a collaborator staffed on Project A must not thereby gain
// access to Project B's content just because both share a client_id.
async function collaboratorHasProjectAccess(db, adminUserId, projectId) {
  const access = await db.prepare(`
    SELECT 1 AS allowed FROM admin_project_access
    WHERE admin_user_id = ? AND project_id = ? AND permission_level IN ('contributor','manager')
  `).bind(adminUserId, projectId).first();
  return Boolean(access);
}

// Client-wide fallback, used only for genuinely client-level actions where no
// specific project is knowable for the resource (brand brain, sources, and
// the "list everything this client has" endpoints) - mirrors the commerce
// router's own client-level list-endpoint pattern, which is documented as
// intentionally client-wide rather than a scoping bug.
async function collaboratorHasClientAccess(db, adminUserId, clientId) {
  const access = await db.prepare(`
    SELECT 1 AS allowed FROM projects p
    JOIN admin_project_access apa ON apa.project_id = p.id
    WHERE p.client_id = ? AND apa.admin_user_id = ? AND apa.permission_level IN ('contributor','manager')
    LIMIT 1
  `).bind(clientId, adminUserId).first();
  return Boolean(access);
}

// A client's "scoping project" for admin_project_access purposes. When the
// caller can supply the SPECIFIC project a resource belongs to (e.g. an
// existing content_plan's own project_id), that exact project is what gets
// checked. Only when no specific project is knowable (or the resource is
// genuinely client-wide, e.g. brand brain/sources, or this is a
// list-everything endpoint) does this fall back to "any project under this
// client."
async function assertAdminClientScope(db, session, clientId, projectId = null) {
  const client = await loadClient(db, clientId);
  if (session.role === 'e4la_collaborator') {
    const allowed = projectId
      ? await collaboratorHasProjectAccess(db, session.actor_id, projectId)
      : await collaboratorHasClientAccess(db, session.actor_id, client.id);
    if (!allowed) throw new HttpError(403, 'not_authorized', 'You do not have permission to manage content for this client.');
  }
  return client;
}

async function assertAdminItemScope(db, session, item) {
  if (session.role === 'e4la_collaborator') {
    // content_items has no project_id of its own - resolve it one hop
    // through the item's content_plan, which does carry a project_id
    // (nullable: a plan not tied to any specific project falls back to the
    // client-wide check below, since there is nothing more specific to check).
    let projectId = null;
    if (item.content_plan_id) {
      const plan = await db.prepare('SELECT project_id FROM content_plans WHERE id = ?').bind(item.content_plan_id).first();
      projectId = plan ? plan.project_id : null;
    }
    const allowed = projectId
      ? await collaboratorHasProjectAccess(db, session.actor_id, projectId)
      : await collaboratorHasClientAccess(db, session.actor_id, item.client_id);
    if (!allowed) throw new HttpError(403, 'not_authorized', 'You do not have permission to manage content for this client.');
  }
}

async function latestBrandBrain(db, clientId) {
  return db.prepare('SELECT * FROM brand_brains WHERE client_id = ? ORDER BY version_number DESC LIMIT 1').bind(clientId).first();
}

// The brand brain that actually governs an existing content item's approval
// policy is the one snapshotted on its content_plan at plan-creation time
// (content_plans.brand_brain_id), never whatever the "latest" brand brain
// happens to be at the moment of a later status-transition call. Without
// this, an admin could create a brand-new brand_brain version with a looser
// automation_mode (e.g. 'manual') and that would retroactively strip the
// client_review requirement off every already-in-flight item under an older,
// stricter ('client_approval') policy - a real approval-integrity bypass.
// Only when a plan has no snapshotted brand_brain_id (or the item has no
// plan) do we fall back to the client's latest brand brain.
async function effectiveBrandBrainForItem(db, item) {
  if (item.content_plan_id) {
    const plan = await db.prepare('SELECT brand_brain_id FROM content_plans WHERE id = ?').bind(item.content_plan_id).first();
    if (plan && plan.brand_brain_id) {
      const brain = await db.prepare('SELECT * FROM brand_brains WHERE id = ?').bind(plan.brand_brain_id).first();
      if (brain) return brain;
    }
  }
  return latestBrandBrain(db, item.client_id);
}

// "A URL alone does not satisfy evidence" extends to YELLOW, not just RED: any
// claim carrying meaningful risk (yellow or red) that has not been explicitly
// marked verification_status='verified' by an admin still blocks approval.
// GREEN never blocks, and a yellow/red claim that HAS been explicitly
// verified never blocks either - this is a risk-scoped gate, not a blanket
// claims block.
async function hasUnresolvedRiskyClaim(db, contentItemId) {
  const row = await db.prepare(`
    SELECT 1 AS found FROM content_claims
    WHERE content_item_id = ? AND risk_level IN ('red','yellow') AND verification_status IN ('unverified','insufficient_evidence','rejected')
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
  const placeholders = CLIENT_VISIBLE_PLAN_STATUSES.map(() => '?').join(',');
  const rows = await db.prepare(`SELECT * FROM content_plans WHERE client_id = ? AND status IN (${placeholders}) ORDER BY created_at DESC`)
    .bind(session.client_id, ...CLIENT_VISIBLE_PLAN_STATUSES).all();
  return json({ plans: rows.results.map(planClientView) });
}

async function getPlan({ request, env }, planId) {
  const session = await authenticate(request, env, [...ADMIN_ROLES, ...ANY_CLIENT_ROLES]);
  const db = env.ENROLLMENT_DB;
  const plan = await db.prepare('SELECT * FROM content_plans WHERE id = ?').bind(sanitizeText(planId, 80)).first();
  if (!plan) throw new HttpError(404, 'plan_not_found', 'The selected content plan is unavailable.');
  if (ADMIN_ROLES.includes(session.role)) {
    await assertAdminClientScope(db, session, plan.client_id, plan.project_id);
    return json(plan);
  }
  if (plan.client_id !== session.client_id) throw new HttpError(404, 'plan_not_found', 'The selected content plan is unavailable.');
  // A draft/internal_approved plan is an internal planning artifact - a client
  // requesting it directly by id must get the same 404 as a genuinely missing
  // plan (never a 403, which would confirm the plan's existence).
  if (!CLIENT_VISIBLE_PLAN_STATUSES.includes(plan.status)) throw new HttpError(404, 'plan_not_found', 'The selected content plan is unavailable.');
  return json(planClientView(plan));
}

async function patchPlan({ request, env }, planId) {
  requireTrustedOrigin(request, env); requireJson(request);
  const session = await authenticate(request, env, ADMIN_ROLES);
  await requireCsrf(request, session);
  const db = env.ENROLLMENT_DB;
  const plan = await db.prepare('SELECT * FROM content_plans WHERE id = ?').bind(sanitizeText(planId, 80)).first();
  if (!plan) throw new HttpError(404, 'plan_not_found', 'The selected content plan is unavailable.');
  await assertAdminClientScope(db, session, plan.client_id, plan.project_id);
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
  await assertAdminClientScope(db, session, plan.client_id, plan.project_id);
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

  const brandBrain = await effectiveBrandBrainForItem(db, item);
  if (item.status === 'e4la_approved' && targetStatus === 'client_review' && !requiresClientReview(brandBrain)) {
    throw new HttpError(422, 'client_review_not_required', "This client's brand brain does not require a client-review step.");
  }
  if (item.status === 'e4la_approved' && targetStatus === 'approved' && requiresClientReview(brandBrain)) {
    throw new HttpError(422, 'client_review_required', 'This client requires a client-review step before approval.');
  }

  if (targetStatus === 'approved' && await hasUnresolvedRiskyClaim(db, item.id)) {
    throw new HttpError(422, 'unresolved_risky_claim', 'This content item has an unresolved RED- or YELLOW-risk claim and cannot be approved.');
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
  // when it carries a source_id reference AND that source (a) belongs to the
  // SAME client as the claim's own content item - a source can never lend
  // evidence across a tenant boundary, no matter how well-verified it is for
  // its own client - and (b) has itself already been through the explicit
  // admin verify action (PATCH /sources/:id/verify) and come back
  // verification_status='verified'. Merely pointing at a source row that
  // happens to have a `url` field populated - unverified, or even rejected -
  // must never be enough; that would make "a URL alone" satisfy evidence by
  // the back door. insufficient_evidence/rejected/unverified never require a
  // verified (or same-client) source - those are honest "we could not verify
  // this" outcomes and must always remain reachable regardless of source state.
  if (status === 'verified') {
    if (!sourceId) throw new HttpError(422, 'source_required', 'A claim cannot be verified without a source_id reference.');
    const source = await db.prepare('SELECT id, client_id, verification_status FROM content_sources WHERE id = ?').bind(sourceId).first();
    if (!source) throw new HttpError(422, 'source_required', 'The referenced source does not exist.');
    if (source.client_id !== item.client_id) {
      throw new HttpError(422, 'source_client_mismatch', "The referenced source does not belong to this claim's client and cannot be used as evidence.");
    }
    if (source.verification_status !== 'verified') {
      throw new HttpError(422, 'source_not_verified', 'The referenced source must itself be marked verified (via PATCH /sources/:id/verify) before a claim can be verified against it.');
    }
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
  // manual_upload has no external dependency and no async render step - it is
  // a real, complete, always-available path: when the admin already has the
  // uploaded file's URL in hand, the asset is genuinely 'rendered' the moment
  // this row is created, with no Adobe (or any other) credential involved.
  // Without accepting asset_url here, manual_upload would be a structural dead
  // end (no endpoint ever sets asset_url/render_status for a non-adobe asset).
  // If no URL is supplied yet, it stays 'not_requested' until a follow-up
  // POST supplies one.
  const manualAssetUrl = provider === 'manual_upload' ? (sanitizeText(body.asset_url, 1000) || null) : null;
  const renderStatus = manualAssetUrl ? 'rendered' : 'not_requested';
  await db.prepare(`INSERT INTO content_assets (
    id, client_id, content_item_id, provider, template_reference, render_status, asset_url,
    requested_by_admin_id, requested_at, rendered_at, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, item.client_id, item.id, provider, sanitizeText(body.template_reference, 200) || null, renderStatus, manualAssetUrl,
      session.actor_id, manualAssetUrl ? now : null, manualAssetUrl ? now : null, now, now).run();
  return json({ id, contentItemId: item.id, provider, renderStatus, assetUrl: manualAssetUrl }, 201);
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
  const body = await request.json();
  // "A successful request sent to a platform adapter must not automatically
  // set status to verified_live" - this endpoint is the separate, explicit
  // follow-up step, and it must never be a bare authenticated status flip. It
  // requires genuine external evidence: the real post id/reference the admin
  // observed live on the platform (or, for a manual_export job, the id/URL of
  // the post the human actually made by hand after using the export package).
  // No adapter call, credential, or claim of success from publishVariant ever
  // satisfies this by itself - it must be supplied here, explicitly, per job.
  const externalPostId = sanitizeText(body.external_post_id, 300);
  if (!externalPostId) {
    throw new HttpError(422, 'external_post_id_required', 'Verifying a publishing job as live requires the real external_post_id observed on the platform.');
  }
  const now = new Date().toISOString();
  await db.prepare("UPDATE publishing_jobs SET status = 'verified_live', external_post_id = ?, verified_at = ?, updated_at = ? WHERE id = ?")
    .bind(externalPostId, now, now, job.id).run();
  await audit(db, { type: 'content_job_verified_live', actorType: 'admin_user', actorId: session.actor_id, clientId: item.client_id, requestId: requestId(request), data: { jobId: job.id, externalPostId } });
  return json({ id: job.id, status: 'verified_live', externalPostId });
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
  // Performance metrics describe something that actually happened on a real,
  // confirmed-live post - recording them against a job that has only reached
  // 'published' (adapter request sent / export package generated, but never
  // independently confirmed live) would let unverified activity masquerade as
  // real performance data. Metrics may only be attached once the job has
  // reached 'verified_live' via the same evidenced PATCH /jobs/:id/verify step
  // required everywhere else in this router.
  if (job.status !== 'verified_live') {
    throw new HttpError(422, 'job_not_verified_live', 'Metrics can only be recorded once this publishing job has been verified live.');
  }
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
