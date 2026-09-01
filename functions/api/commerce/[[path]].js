import {
  HttpError, audit, authenticate, errorResponse, json, randomToken, requestId,
  requireCsrf, requireFields, requireJson, requireTrustedOrigin, sanitizeText,
} from '../../_shared/ops-security.js';
import { validateEnvironmentConfiguration, verifyDatabaseEnvironment } from '../../_shared/environment.js';

// Phase G: Commerce (service catalog, quoting, flexible payments/invoicing, recurring
// service consent). Entirely independent of functions/api/ops/[[path]].js - Cloudflare
// routes /api/commerce/* to this file automatically. Reuses the exact same session/CSRF/
// audit/HttpError primitives as the ops router but owns its own route table and handlers.

export async function onRequest(context) {
  const { request, env } = context;
  try {
    validateEnvironmentConfiguration(env);
    await verifyDatabaseEnvironment(env);
    const route = new URL(request.url).pathname.replace(/^\/api\/commerce\/?/, '').replace(/\/$/, '');
    const key = `${request.method.toUpperCase()} ${route}`;
    const handlers = {
      'GET services': listServices,
      'POST services': createService,
      'GET service-categories': listServiceCategories,
      'POST service-categories': createServiceCategory,
      'POST invoices': createInvoice,
      'POST recurring-consent/offers': prepareRecurringOffer,
      'POST recurring-consent/approve': approveRecurringConsent,
    };
    const handler = handlers[key]
      || matchHandler(request.method, route, /^services\/([^/]+)$/, updateService, 'PATCH')
      || matchHandler(request.method, route, /^clients\/([^/]+)\/quotes$/, createQuote, 'POST')
      || matchHandler(request.method, route, /^clients\/([^/]+)\/quotes$/, listClientQuotes, 'GET')
      || matchHandler(request.method, route, /^quotes\/([^/]+)\/versions$/, createQuoteVersion, 'POST')
      || matchHandler(request.method, route, /^quotes\/([^/]+)\/send$/, sendQuote, 'POST')
      || matchHandler(request.method, route, /^quotes\/([^/]+)\/status$/, transitionQuoteStatus, 'POST')
      || matchHandler(request.method, route, /^quotes\/([^/]+)\/payment-options$/, createPaymentOptions, 'POST')
      || matchHandler(request.method, route, /^quotes\/([^/]+)\/payment-options$/, listPaymentOptions, 'GET')
      || matchHandler(request.method, route, /^quotes\/([^/]+)$/, getQuote, 'GET')
      || matchHandler(request.method, route, /^invoices\/([^/]+)\/send$/, sendInvoice, 'POST')
      || matchHandler(request.method, route, /^invoices\/([^/]+)$/, getInvoice, 'GET')
      || matchHandler(request.method, route, /^clients\/([^/]+)\/invoices$/, listClientInvoices, 'GET')
      || matchHandler(request.method, route, /^clients\/([^/]+)\/recurring-consents$/, listRecurringConsents, 'GET')
      || matchHandler(request.method, route, /^recurring-consents\/([^/]+)\/cancel$/, cancelRecurringConsent, 'POST');
    if (!handler) throw new HttpError(404, 'not_found', 'This Commerce endpoint is unavailable.');
    return await handler(context);
  } catch (error) {
    return errorResponse(error, request);
  }
}

function matchHandler(method, route, pattern, handler, expectedMethod = 'POST') {
  if (method.toUpperCase() !== expectedMethod) return null;
  const match = route.match(pattern);
  return match ? (context) => handler(context, decodeURIComponent(match[1])) : null;
}

const ADMIN_ROLES = ['e4la_admin', 'e4la_collaborator'];
const CLIENT_ROLES = ['client_owner', 'authorized_signer', 'client_viewer'];

function opaqueId(prefix) { return `${prefix}_${randomToken(18)}`; }
function sanitizeDate(value) { const text = sanitizeText(value, 10); return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null; }
// A 3-letter ISO 4217 / Stripe-style currency code, lowercased. No CHECK constraint exists
// on quotes.currency/invoices.currency at the schema level (see 0005/0006), so this is the
// only place a malformed value (wrong length, non-alphabetic, empty) is ever rejected.
function sanitizeCurrencyCode(value) { const text = sanitizeText(value, 10).toLowerCase(); return /^[a-z]{3}$/.test(text) ? text : null; }
function resolveCurrency(rawValue) {
  if (rawValue === undefined || rawValue === null || rawValue === '') return 'usd';
  const currency = sanitizeCurrencyCode(rawValue);
  if (!currency) throw new HttpError(422, 'currency_invalid', 'Enter a valid 3-letter currency code.');
  return currency;
}
function parseJson(value, fallback) { try { return JSON.parse(value); } catch { return fallback; } }

function auditStatementForAdmin(db, eventType, session, requestIdentifier, data) {
  return db.prepare(`INSERT INTO audit_events (
    id, event_type, actor_type, actor_id, client_id, project_id, related_entity_type, related_entity_id, request_id, event_data_json, created_at
  ) VALUES (?, ?, 'admin_user', ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), eventType, session.actor_id, data.clientId || null, data.projectId || null,
      data.entityType || null, data.entityId || null, requestIdentifier, JSON.stringify(data), new Date().toISOString());
}

// -------------------------------------------------------------------------------------
// Collaborator project scoping - same pattern as assertProjectAccess in
// functions/api/ops/[[path]].js: e4la_admin is unrestricted, e4la_collaborator must hold
// a contributor/manager admin_project_access row for the project in question.
// -------------------------------------------------------------------------------------
async function assertProjectAccess(env, session, projectId) {
  const project = await env.ENROLLMENT_DB.prepare("SELECT id, client_id FROM projects WHERE id = ? AND status != 'archived'")
    .bind(sanitizeText(projectId, 80)).first();
  if (!project) throw new HttpError(404, 'project_not_found', 'The selected project is unavailable.');
  if (session.role === 'e4la_collaborator') {
    const access = await env.ENROLLMENT_DB.prepare(`SELECT 1 AS allowed FROM admin_project_access
      WHERE admin_user_id = ? AND project_id = ? AND permission_level IN ('contributor','manager')`)
      .bind(session.actor_id, project.id).first();
    if (!access) throw new HttpError(403, 'not_authorized', 'You do not have permission to manage this project.');
  }
  return project;
}

// Collaborator scoping by client (any project belonging to the client) - used for
// client-level list/read endpoints where there is no single project_id in scope yet.
async function assertClientAccessForAdmin(env, session, clientId) {
  const client = await env.ENROLLMENT_DB.prepare('SELECT id FROM clients WHERE id = ?').bind(sanitizeText(clientId, 80)).first();
  if (!client) throw new HttpError(404, 'client_not_found', 'The client record is unavailable.');
  if (session.role === 'e4la_collaborator') {
    const access = await env.ENROLLMENT_DB.prepare(`SELECT 1 AS allowed FROM projects p
      JOIN admin_project_access apa ON apa.project_id = p.id
      WHERE p.client_id = ? AND apa.admin_user_id = ? LIMIT 1`).bind(client.id, session.actor_id).first();
    if (!access) throw new HttpError(403, 'not_authorized', 'You do not have permission to manage this client.');
  }
  return client;
}

// -------------------------------------------------------------------------------------
// Services / categories
// -------------------------------------------------------------------------------------

async function listServices({ request, env }) {
  await authenticate(request, env, ADMIN_ROLES);
  const rows = await env.ENROLLMENT_DB.prepare(`
    SELECT s.*, sc.name AS category_name FROM services s
    LEFT JOIN service_categories sc ON sc.id = s.category_id
    ORDER BY s.sort_order, s.name
  `).all();
  return json({ services: rows.results });
}

async function createService({ request, env }) {
  requireTrustedOrigin(request, env); requireJson(request);
  const session = await authenticate(request, env, ['e4la_admin']);
  await requireCsrf(request, session);
  const body = await request.json();
  requireFields(body, ['name']);
  const pricingType = sanitizeText(body.pricing_type, 20) || 'fixed';
  const billingType = sanitizeText(body.billing_type, 20) || 'fixed_scope';
  if (!['fixed', 'hourly', 'monthly_retainer', 'custom'].includes(pricingType)) {
    throw new HttpError(422, 'pricing_type_invalid', 'Select a supported pricing type.');
  }
  if (!['fixed_scope', 'recurring_service'].includes(billingType)) {
    throw new HttpError(422, 'billing_type_invalid', 'Select a supported billing type.');
  }
  let categoryId = null;
  if (body.category_id !== undefined && body.category_id !== null && body.category_id !== '') {
    const category = await env.ENROLLMENT_DB.prepare('SELECT id FROM service_categories WHERE id = ?')
      .bind(sanitizeText(body.category_id, 80)).first();
    if (!category) throw new HttpError(404, 'service_category_not_found', 'The selected service category is unavailable.');
    categoryId = category.id;
  }
  let defaultPrice = null;
  if (body.default_price !== undefined && body.default_price !== null) {
    defaultPrice = Number(body.default_price);
    if (!Number.isSafeInteger(defaultPrice) || defaultPrice < 0) throw new HttpError(422, 'default_price_invalid', 'default_price must be a non-negative integer number of cents.');
  }
  const now = new Date().toISOString();
  const id = opaqueId('svc');
  await env.ENROLLMENT_DB.batch([
    env.ENROLLMENT_DB.prepare(`INSERT INTO services (
      id, category_id, name, description, default_scope, default_price, pricing_type, billing_type,
      active, sort_order, created_by_admin_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`)
      .bind(id, categoryId, sanitizeText(body.name, 180), sanitizeText(body.description, 2000) || null,
        sanitizeText(body.default_scope, 2000) || null, defaultPrice, pricingType, billingType,
        Number.isInteger(body.sort_order) ? body.sort_order : 0, session.actor_id, now, now),
    auditStatementForAdmin(env.ENROLLMENT_DB, 'service_created', session, requestId(request), { entityType: 'service', entityId: id }),
  ]);
  return json({ id, categoryId, defaultPrice, pricingType, billingType }, 201);
}

async function updateService({ request, env }, serviceId) {
  requireTrustedOrigin(request, env); requireJson(request);
  const session = await authenticate(request, env, ['e4la_admin']);
  await requireCsrf(request, session);
  const service = await env.ENROLLMENT_DB.prepare('SELECT id FROM services WHERE id = ?').bind(sanitizeText(serviceId, 80)).first();
  if (!service) throw new HttpError(404, 'service_not_found', 'The selected service is unavailable.');
  const body = await request.json();
  const fields = {};
  if (body.name !== undefined) fields.name = sanitizeText(body.name, 180);
  if (body.description !== undefined) fields.description = sanitizeText(body.description, 2000) || null;
  if (body.default_scope !== undefined) fields.default_scope = sanitizeText(body.default_scope, 2000) || null;
  if (body.category_id !== undefined) {
    if (body.category_id === null || body.category_id === '') {
      fields.category_id = null;
    } else {
      const category = await env.ENROLLMENT_DB.prepare('SELECT id FROM service_categories WHERE id = ?')
        .bind(sanitizeText(body.category_id, 80)).first();
      if (!category) throw new HttpError(404, 'service_category_not_found', 'The selected service category is unavailable.');
      fields.category_id = category.id;
    }
  }
  if (body.default_price !== undefined) {
    if (body.default_price === null) {
      fields.default_price = null;
    } else {
      const price = Number(body.default_price);
      if (!Number.isSafeInteger(price) || price < 0) throw new HttpError(422, 'default_price_invalid', 'default_price must be a non-negative integer number of cents.');
      fields.default_price = price;
    }
  }
  if (body.pricing_type !== undefined) {
    if (!['fixed', 'hourly', 'monthly_retainer', 'custom'].includes(body.pricing_type)) throw new HttpError(422, 'pricing_type_invalid', 'Select a supported pricing type.');
    fields.pricing_type = body.pricing_type;
  }
  if (body.billing_type !== undefined) {
    if (!['fixed_scope', 'recurring_service'].includes(body.billing_type)) throw new HttpError(422, 'billing_type_invalid', 'Select a supported billing type.');
    fields.billing_type = body.billing_type;
  }
  if (body.active !== undefined) fields.active = body.active === true || body.active === 1 ? 1 : 0;
  if (body.sort_order !== undefined && Number.isInteger(body.sort_order)) fields.sort_order = body.sort_order;
  const keys = Object.keys(fields);
  if (!keys.length) throw new HttpError(422, 'service_update_empty', 'Provide at least one supported field to update.');
  const now = new Date().toISOString();
  await env.ENROLLMENT_DB.batch([
    env.ENROLLMENT_DB.prepare(`UPDATE services SET ${keys.map((key) => `${key} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
      .bind(...keys.map((key) => fields[key]), now, service.id),
    auditStatementForAdmin(env.ENROLLMENT_DB, 'service_updated', session, requestId(request), { entityType: 'service', entityId: service.id, updated: keys }),
  ]);
  return json({ id: service.id, updated: keys });
}

async function listServiceCategories({ request, env }) {
  await authenticate(request, env, ADMIN_ROLES);
  const rows = await env.ENROLLMENT_DB.prepare('SELECT * FROM service_categories ORDER BY sort_order, name').all();
  return json({ categories: rows.results });
}

async function createServiceCategory({ request, env }) {
  requireTrustedOrigin(request, env); requireJson(request);
  const session = await authenticate(request, env, ['e4la_admin']);
  await requireCsrf(request, session);
  const body = await request.json();
  requireFields(body, ['name']);
  const now = new Date().toISOString();
  const id = opaqueId('svcc');
  try {
    await env.ENROLLMENT_DB.batch([
      env.ENROLLMENT_DB.prepare(`INSERT INTO service_categories (id, name, sort_order, active, created_at, updated_at)
        VALUES (?, ?, ?, 1, ?, ?)`)
        .bind(id, sanitizeText(body.name, 120), Number.isInteger(body.sort_order) ? body.sort_order : 0, now, now),
      auditStatementForAdmin(env.ENROLLMENT_DB, 'service_category_created', session, requestId(request), { entityType: 'service_category', entityId: id }),
    ]);
  } catch (error) {
    if (String(error.message || '').includes('UNIQUE')) throw new HttpError(409, 'service_category_name_taken', 'A service category with this name already exists.');
    throw error;
  }
  return json({ id }, 201);
}

// -------------------------------------------------------------------------------------
// Quote line-item resolution (shared by quotes and invoices) - the custom-or-service-linked
// pattern. Never trusts a client-submitted amount/total: quantity*unit_price is always
// recomputed server-side, and unit_price for a service-linked item may be overridden by
// the admin but otherwise defaults to the service's current default_price.
// -------------------------------------------------------------------------------------
async function resolveLineItems(env, rawItems) {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw new HttpError(422, 'items_required', 'Provide at least one line item.');
  }
  const resolved = [];
  for (const [index, raw] of rawItems.entries()) {
    const quantity = Number.isInteger(raw?.quantity) ? raw.quantity : 1;
    if (!Number.isInteger(quantity) || quantity < 1) throw new HttpError(422, 'item_quantity_invalid', `Line item ${index + 1} has an invalid quantity.`);
    let label; let unitPrice; let serviceId = null; let description = null;
    if (raw?.service_id) {
      const service = await env.ENROLLMENT_DB.prepare('SELECT * FROM services WHERE id = ?')
        .bind(sanitizeText(raw.service_id, 80)).first();
      if (!service) throw new HttpError(404, 'service_not_found', `Line item ${index + 1} references a service that does not exist.`);
      serviceId = service.id;
      label = sanitizeText(raw.label, 180) || service.name;
      description = sanitizeText(raw.description, 2000) || service.description || null;
      if (raw.unit_price !== undefined && raw.unit_price !== null) {
        unitPrice = Number(raw.unit_price);
      } else if (service.default_price !== null && service.default_price !== undefined) {
        unitPrice = Number(service.default_price);
      } else {
        throw new HttpError(422, 'item_unit_price_required', `Line item ${index + 1} (${service.name}) has no default price and requires an explicit unit_price.`);
      }
    } else {
      label = sanitizeText(raw?.label, 180);
      if (!label) throw new HttpError(422, 'item_label_required', `Line item ${index + 1} is custom and requires a label.`);
      description = sanitizeText(raw?.description, 2000) || null;
      unitPrice = Number(raw?.unit_price);
    }
    if (!Number.isSafeInteger(unitPrice) || unitPrice < 0) throw new HttpError(422, 'item_unit_price_invalid', `Line item ${index + 1} has an invalid unit_price.`);
    resolved.push({ serviceId, label, description, quantity, unitPrice, amount: quantity * unitPrice, sortOrder: index });
  }
  return resolved;
}

function sumItems(items) { return items.reduce((sum, item) => sum + item.amount, 0); }

function computeTotal(subtotal, discountAmount, taxAmount) {
  const discount = Number.isSafeInteger(discountAmount) && discountAmount >= 0 ? discountAmount : 0;
  const tax = Number.isSafeInteger(taxAmount) && taxAmount >= 0 ? taxAmount : 0;
  return { discount, tax, total: subtotal - discount + tax };
}

// -------------------------------------------------------------------------------------
// Quotes
//
// Status state machine (quotes.status CHECK: draft, prepared, sent, viewed, approved,
// rejected, expired, converted):
//
//   draft      -> prepared        (automatic, the moment the first quote_versions row
//                                   is created via POST /quotes/:id/versions)
//   prepared   -> sent            (POST /quotes/:id/send only; requires current_version_id)
//   sent       -> viewed | approved | rejected | expired   (POST /quotes/:id/status)
//   viewed     -> approved | rejected | expired             (POST /quotes/:id/status)
//   approved   -> converted                                 (POST /quotes/:id/status)
//   rejected, expired, converted, draft, prepared -> no further POST /status transitions
//
// draft/prepared cannot reach approved/rejected/etc. directly through /status - a quote
// MUST have gone through /send first. This is deliberate: an admin cannot mark a quote
// "approved" that a client was never actually sent.
// -------------------------------------------------------------------------------------
const QUOTE_STATUS_TRANSITIONS = {
  sent: ['viewed', 'approved', 'rejected', 'expired'],
  viewed: ['approved', 'rejected', 'expired'],
  approved: ['converted'],
};

async function createQuote({ request, env }, clientId) {
  requireTrustedOrigin(request, env); requireJson(request);
  const session = await authenticate(request, env, ADMIN_ROLES);
  await requireCsrf(request, session);
  const client = await env.ENROLLMENT_DB.prepare('SELECT id FROM clients WHERE id = ?').bind(sanitizeText(clientId, 80)).first();
  if (!client) throw new HttpError(404, 'client_not_found', 'The client record is unavailable.');
  const body = await request.json();
  let projectId = null;
  if (body.project_id) {
    const project = await env.ENROLLMENT_DB.prepare('SELECT id FROM projects WHERE id = ? AND client_id = ?')
      .bind(sanitizeText(body.project_id, 80), client.id).first();
    if (!project) throw new HttpError(404, 'project_not_found', 'The selected client project is unavailable.');
    await assertProjectAccess(env, session, project.id);
    projectId = project.id;
  } else if (session.role === 'e4la_collaborator') {
    throw new HttpError(403, 'not_authorized', 'A collaborator must create quotes within a scoped project.');
  }
  const currency = resolveCurrency(body.currency);
  const now = new Date().toISOString();
  const id = opaqueId('quo');
  await env.ENROLLMENT_DB.batch([
    env.ENROLLMENT_DB.prepare(`INSERT INTO quotes (
      id, client_id, project_id, currency, status, current_version_id, valid_until, notes, created_by_admin_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'draft', NULL, ?, ?, ?, ?, ?)`)
      .bind(id, client.id, projectId, currency, sanitizeDate(body.valid_until), sanitizeText(body.notes, 2000) || null, session.actor_id, now, now),
    auditStatementForAdmin(env.ENROLLMENT_DB, 'quote_created', session, requestId(request), { clientId: client.id, projectId, entityType: 'quote', entityId: id }),
  ]);
  return json({ id, clientId: client.id, projectId, status: 'draft' }, 201);
}

async function createQuoteVersion({ request, env }, quoteId) {
  requireTrustedOrigin(request, env); requireJson(request);
  const session = await authenticate(request, env, ['e4la_admin']);
  await requireCsrf(request, session);
  const quote = await env.ENROLLMENT_DB.prepare('SELECT * FROM quotes WHERE id = ?').bind(sanitizeText(quoteId, 80)).first();
  if (!quote) throw new HttpError(404, 'quote_not_found', 'The selected quote is unavailable.');
  // Once a quote has been sent, its current_version_id is what the client was actually
  // shown (and may have already approved/viewed) - a new version must never silently
  // replace it. Only draft/prepared quotes (never sent) may receive a new version; a sent
  // quote must go through an explicit revision workflow, not a same-endpoint swap.
  if (!['draft', 'prepared'].includes(quote.status)) {
    throw new HttpError(409, 'quote_not_editable', 'This quote has already been sent, approved, rejected, expired, or converted and cannot receive a new version.');
  }
  const body = await request.json();
  const items = await resolveLineItems(env, body.items);
  const subtotal = sumItems(items);
  const { discount, tax, total } = computeTotal(subtotal, Number(body.discount_amount), Number(body.tax_amount));
  const versionRow = await env.ENROLLMENT_DB.prepare('SELECT COALESCE(MAX(version_number), 0) AS max_version FROM quote_versions WHERE quote_id = ?')
    .bind(quote.id).first();
  const versionNumber = (versionRow?.max_version || 0) + 1;
  const now = new Date().toISOString();
  const versionId = opaqueId('quov');
  const statements = [
    env.ENROLLMENT_DB.prepare(`INSERT INTO quote_versions (
      id, quote_id, version_number, scope, subtotal, discount_amount, tax_amount, total, created_by_admin_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(versionId, quote.id, versionNumber, sanitizeText(body.scope, 4000) || null, subtotal, discount, tax, total, session.actor_id, now),
  ];
  items.forEach((item) => {
    statements.push(env.ENROLLMENT_DB.prepare(`INSERT INTO quote_items (
      id, quote_version_id, service_id, label, description, quantity, unit_price, amount, sort_order, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(opaqueId('qit'), versionId, item.serviceId, item.label, item.description, item.quantity, item.unitPrice, item.amount, item.sortOrder, now));
  });
  const nextStatus = quote.status === 'draft' ? 'prepared' : quote.status;
  statements.push(env.ENROLLMENT_DB.prepare('UPDATE quotes SET current_version_id = ?, status = ?, updated_at = ? WHERE id = ?')
    .bind(versionId, nextStatus, now, quote.id));
  statements.push(auditStatementForAdmin(env.ENROLLMENT_DB, 'quote_version_created', session, requestId(request), { clientId: quote.client_id, projectId: quote.project_id, entityType: 'quote_version', entityId: versionId }));
  await env.ENROLLMENT_DB.batch(statements);
  return json({ id: versionId, quoteId: quote.id, versionNumber, subtotal, discountAmount: discount, taxAmount: tax, total, status: nextStatus }, 201);
}

async function sendQuote({ request, env }, quoteId) {
  requireTrustedOrigin(request, env); requireJson(request);
  const session = await authenticate(request, env, ['e4la_admin']);
  await requireCsrf(request, session);
  const quote = await env.ENROLLMENT_DB.prepare('SELECT * FROM quotes WHERE id = ?').bind(sanitizeText(quoteId, 80)).first();
  if (!quote) throw new HttpError(404, 'quote_not_found', 'The selected quote is unavailable.');
  if (!quote.current_version_id) throw new HttpError(409, 'quote_has_no_version', 'Create a priced quote version before sending this quote.');
  if (!['draft', 'prepared'].includes(quote.status)) throw new HttpError(409, 'quote_already_sent', 'This quote has already been sent.');
  const now = new Date().toISOString();
  await env.ENROLLMENT_DB.batch([
    env.ENROLLMENT_DB.prepare("UPDATE quotes SET status = 'sent', sent_at = COALESCE(sent_at, ?), updated_at = ? WHERE id = ?").bind(now, now, quote.id),
    auditStatementForAdmin(env.ENROLLMENT_DB, 'quote_sent', session, requestId(request), { clientId: quote.client_id, projectId: quote.project_id, entityType: 'quote', entityId: quote.id }),
  ]);
  return json({ id: quote.id, status: 'sent', sentAt: now });
}

async function transitionQuoteStatus({ request, env }, quoteId) {
  requireTrustedOrigin(request, env); requireJson(request);
  const session = await authenticate(request, env, ['e4la_admin']);
  await requireCsrf(request, session);
  const quote = await env.ENROLLMENT_DB.prepare('SELECT * FROM quotes WHERE id = ?').bind(sanitizeText(quoteId, 80)).first();
  if (!quote) throw new HttpError(404, 'quote_not_found', 'The selected quote is unavailable.');
  const body = await request.json();
  const nextStatus = sanitizeText(body.status, 20);
  const allowed = QUOTE_STATUS_TRANSITIONS[quote.status] || [];
  if (!allowed.includes(nextStatus)) {
    throw new HttpError(409, 'quote_status_transition_invalid', `A quote in status "${quote.status}" cannot transition to "${nextStatus}".`);
  }
  const now = new Date().toISOString();
  const timestampColumn = { viewed: 'viewed_at', approved: 'approved_at', rejected: 'rejected_at' }[nextStatus];
  await env.ENROLLMENT_DB.batch([
    env.ENROLLMENT_DB.prepare(`UPDATE quotes SET status = ?${timestampColumn ? `, ${timestampColumn} = COALESCE(${timestampColumn}, ?)` : ''}, updated_at = ? WHERE id = ?`)
      .bind(...(timestampColumn ? [nextStatus, now, now, quote.id] : [nextStatus, now, quote.id])),
    auditStatementForAdmin(env.ENROLLMENT_DB, 'quote_status_changed', session, requestId(request), { clientId: quote.client_id, projectId: quote.project_id, entityType: 'quote', entityId: quote.id, from: quote.status, to: nextStatus }),
  ]);
  return json({ id: quote.id, status: nextStatus });
}

// Client-role sessions must never see internal-only quote fields - admin notes, or who
// internally created the record. Whitelisting matches the same client-safe projection
// pattern used for invoices above. Admin/collaborator sessions still receive the full raw
// row. quote_items carries no internal fields at all, so it is never filtered.
const CLIENT_SAFE_QUOTE_FIELDS = [
  'id', 'client_id', 'project_id', 'currency', 'status', 'current_version_id', 'valid_until',
  'sent_at', 'viewed_at', 'approved_at', 'rejected_at', 'created_at', 'updated_at',
];
const CLIENT_SAFE_QUOTE_VERSION_FIELDS = ['id', 'quote_id', 'version_number', 'scope', 'subtotal', 'discount_amount', 'tax_amount', 'total', 'created_at'];
function toClientSafeQuote(quote) {
  const safe = {};
  CLIENT_SAFE_QUOTE_FIELDS.forEach((field) => { safe[field] = quote[field]; });
  return safe;
}
function toClientSafeQuoteVersion(version) {
  if (!version) return null;
  const safe = {};
  CLIENT_SAFE_QUOTE_VERSION_FIELDS.forEach((field) => { safe[field] = version[field]; });
  return safe;
}

async function getQuote({ request, env }, quoteId) {
  const session = await authenticate(request, env, [...ADMIN_ROLES, ...CLIENT_ROLES]);
  const quote = await env.ENROLLMENT_DB.prepare('SELECT * FROM quotes WHERE id = ?').bind(sanitizeText(quoteId, 80)).first();
  if (!quote) throw new HttpError(404, 'quote_not_found', 'The selected quote is unavailable.');
  if (CLIENT_ROLES.includes(session.role)) {
    if (quote.client_id !== session.client_id) throw new HttpError(404, 'quote_not_found', 'The selected quote is unavailable.');
  } else if (session.role === 'e4la_collaborator') {
    if (quote.project_id) await assertProjectAccess(env, session, quote.project_id);
    else throw new HttpError(403, 'not_authorized', 'You do not have permission to view this quote.');
  }
  const version = quote.current_version_id
    ? await env.ENROLLMENT_DB.prepare('SELECT * FROM quote_versions WHERE id = ?').bind(quote.current_version_id).first()
    : null;
  const items = version
    ? (await env.ENROLLMENT_DB.prepare('SELECT * FROM quote_items WHERE quote_version_id = ? ORDER BY sort_order').bind(version.id).all()).results
    : [];
  const isClient = CLIENT_ROLES.includes(session.role);
  return json({
    quote: isClient ? toClientSafeQuote(quote) : quote,
    version: isClient ? toClientSafeQuoteVersion(version) : version,
    items,
  });
}

async function listClientQuotes({ request, env }, clientId) {
  const session = await authenticate(request, env, ADMIN_ROLES);
  await assertClientAccessForAdmin(env, session, clientId);
  const rows = await env.ENROLLMENT_DB.prepare('SELECT * FROM quotes WHERE client_id = ? ORDER BY created_at DESC')
    .bind(sanitizeText(clientId, 80)).all();
  return json({ quotes: rows.results });
}

// -------------------------------------------------------------------------------------
// Payment options. NOTE: the sum-of-installments-equals-total_amount invariant is
// implemented as UNCONDITIONAL - it applies to every option_type including
// 'deposit_balance', with no separate "fee" concept anywhere in this schema. See report
// for why this differs from a "unless intentional deposit/fee logic" reading: 0006's
// schema has no fee/surcharge column at all, so there is nothing for such an exception
// to attach to, and allowing the sum to diverge from total_amount would silently create
// installment schedules that do not actually total the quoted price.
// -------------------------------------------------------------------------------------

const PAYMENT_OPTION_COUNTS = {
  pay_in_full: (count) => count === 1,
  deposit_balance: (count) => count === 2,
  installments: (count) => count >= 1,
  custom_schedule: (count) => count >= 1,
};

async function createPaymentOptions({ request, env }, quoteId) {
  requireTrustedOrigin(request, env); requireJson(request);
  const session = await authenticate(request, env, ['e4la_admin']);
  await requireCsrf(request, session);
  const quote = await env.ENROLLMENT_DB.prepare('SELECT * FROM quotes WHERE id = ?').bind(sanitizeText(quoteId, 80)).first();
  if (!quote) throw new HttpError(404, 'quote_not_found', 'The selected quote is unavailable.');
  if (!quote.current_version_id) throw new HttpError(409, 'quote_has_no_version', 'Create a priced quote version before adding payment options.');
  // total_amount is never trusted on its own - a payment option's total must match the
  // quote's actual current-version total, otherwise a $0.01 pay-in-full option could be
  // created against a real, much larger quoted price.
  const currentVersion = await env.ENROLLMENT_DB.prepare('SELECT total FROM quote_versions WHERE id = ?').bind(quote.current_version_id).first();
  const body = await request.json();
  const optionType = sanitizeText(body.option_type, 30);
  if (!PAYMENT_OPTION_COUNTS[optionType]) throw new HttpError(422, 'option_type_invalid', 'Select a supported payment option type.');
  const totalAmount = Number(body.total_amount);
  if (!Number.isSafeInteger(totalAmount) || totalAmount <= 0) throw new HttpError(422, 'total_amount_invalid', 'total_amount must be a positive integer number of cents.');
  if (totalAmount !== currentVersion.total) {
    throw new HttpError(422, 'total_amount_mismatch', `total_amount (${totalAmount}) must equal the quote's current version total (${currentVersion.total}).`);
  }
  const installments = Array.isArray(body.installments) ? body.installments : [];
  if (installments.length === 0) throw new HttpError(422, 'installments_required', 'A payment option must include at least one installment.');
  const installmentCount = Number.isInteger(body.installment_count) ? body.installment_count : installments.length;
  if (installmentCount !== installments.length) {
    throw new HttpError(422, 'installment_count_mismatch', 'installment_count must equal the number of installments provided.');
  }
  if (!PAYMENT_OPTION_COUNTS[optionType](installments.length)) {
    throw new HttpError(422, 'installment_count_invalid', `A "${optionType}" payment option does not support ${installments.length} installment(s).`);
  }
  const resolvedInstallments = installments.map((entry, index) => {
    const amount = Number(entry?.amount);
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new HttpError(422, 'installment_amount_invalid', `Installment ${index + 1} has an invalid amount.`);
    const dueDate = entry?.due_date ? sanitizeDate(entry.due_date) : null;
    const offsetUnit = entry?.offset_unit ? sanitizeText(entry.offset_unit, 10) : null;
    const offsetCount = Number.isInteger(entry?.offset_count) ? entry.offset_count : null;
    if (entry?.due_date && !dueDate) throw new HttpError(422, 'installment_due_date_invalid', `Installment ${index + 1} has an invalid due_date.`);
    if (offsetUnit && !['day', 'week', 'month'].includes(offsetUnit)) throw new HttpError(422, 'installment_offset_unit_invalid', `Installment ${index + 1} has an invalid offset_unit.`);
    if (!dueDate && !(offsetUnit && offsetCount !== null)) {
      throw new HttpError(422, 'installment_schedule_invalid', `Installment ${index + 1} needs either a due_date or an offset_unit/offset_count.`);
    }
    return { amount, dueDate, offsetUnit, offsetCount };
  });
  const sum = resolvedInstallments.reduce((total, item) => total + item.amount, 0);
  if (sum !== totalAmount) {
    throw new HttpError(422, 'installment_totals_mismatch', `Installment amounts sum to ${sum}, which does not equal total_amount (${totalAmount}).`);
  }
  const now = new Date().toISOString();
  const optionId = opaqueId('pmo');
  const statements = [
    env.ENROLLMENT_DB.prepare(`INSERT INTO payment_options (
      id, quote_id, option_type, label, total_amount, installment_count, active, sort_order, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`)
      .bind(optionId, quote.id, optionType, sanitizeText(body.label, 180) || optionType, totalAmount, installmentCount,
        Number.isInteger(body.sort_order) ? body.sort_order : 0, now),
  ];
  resolvedInstallments.forEach((installment, index) => {
    statements.push(env.ENROLLMENT_DB.prepare(`INSERT INTO payment_option_installments (
      id, payment_option_id, installment_number, amount, due_date, offset_unit, offset_count, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(opaqueId('pmi'), optionId, index + 1, installment.amount, installment.dueDate, installment.offsetUnit, installment.offsetCount, now));
  });
  statements.push(auditStatementForAdmin(env.ENROLLMENT_DB, 'payment_option_created', session, requestId(request), { clientId: quote.client_id, projectId: quote.project_id, entityType: 'payment_option', entityId: optionId }));
  await env.ENROLLMENT_DB.batch(statements);
  return json({ id: optionId, quoteId: quote.id, optionType, totalAmount, installmentCount }, 201);
}

async function listPaymentOptions({ request, env }, quoteId) {
  const session = await authenticate(request, env, [...ADMIN_ROLES, ...CLIENT_ROLES]);
  const quote = await env.ENROLLMENT_DB.prepare('SELECT * FROM quotes WHERE id = ?').bind(sanitizeText(quoteId, 80)).first();
  if (!quote) throw new HttpError(404, 'quote_not_found', 'The selected quote is unavailable.');
  if (CLIENT_ROLES.includes(session.role)) {
    if (quote.client_id !== session.client_id) throw new HttpError(404, 'quote_not_found', 'The selected quote is unavailable.');
  } else if (session.role === 'e4la_collaborator') {
    if (quote.project_id) await assertProjectAccess(env, session, quote.project_id);
    else throw new HttpError(403, 'not_authorized', 'You do not have permission to view this quote.');
  }
  const options = await env.ENROLLMENT_DB.prepare('SELECT * FROM payment_options WHERE quote_id = ? AND active = 1 ORDER BY sort_order').bind(quote.id).all();
  const withInstallments = [];
  for (const option of options.results) {
    const installments = await env.ENROLLMENT_DB.prepare('SELECT * FROM payment_option_installments WHERE payment_option_id = ? ORDER BY installment_number').bind(option.id).all();
    withInstallments.push({ ...option, installments: installments.results });
  }
  return json({ paymentOptions: withInstallments });
}

// -------------------------------------------------------------------------------------
// Invoices
// -------------------------------------------------------------------------------------

// Client-role sessions (client_owner/authorized_signer/client_viewer) must never receive
// internal-only invoice fields - who created it internally, or live Stripe object IDs.
// Whitelisting (rather than blacklisting) matches the same "client-safe projection"
// pattern used by functions/_shared/content.js's toClientSafeContentItem. Admin/collaborator
// sessions still receive the full raw row, unchanged.
const CLIENT_SAFE_INVOICE_FIELDS = [
  'id', 'client_id', 'project_id', 'quote_id', 'status', 'currency', 'subtotal', 'tax_amount',
  'total', 'amount_paid', 'due_date', 'notes', 'sent_at', 'viewed_at', 'paid_at', 'created_at', 'updated_at',
];
function toClientSafeInvoice(invoice) {
  const safe = {};
  CLIENT_SAFE_INVOICE_FIELDS.forEach((field) => { safe[field] = invoice[field]; });
  return safe;
}

async function createInvoice({ request, env }) {
  requireTrustedOrigin(request, env); requireJson(request);
  const session = await authenticate(request, env, ['e4la_admin']);
  await requireCsrf(request, session);
  const body = await request.json();
  requireFields(body, ['client_id']);
  const client = await env.ENROLLMENT_DB.prepare('SELECT id FROM clients WHERE id = ?').bind(sanitizeText(body.client_id, 80)).first();
  if (!client) throw new HttpError(404, 'client_not_found', 'The client record is unavailable.');
  let projectId = null;
  if (body.project_id) {
    const project = await env.ENROLLMENT_DB.prepare('SELECT id FROM projects WHERE id = ? AND client_id = ?')
      .bind(sanitizeText(body.project_id, 80), client.id).first();
    if (!project) throw new HttpError(404, 'project_not_found', 'The selected client project is unavailable.');
    projectId = project.id;
  }
  let quoteId = null;
  if (body.quote_id) {
    const quote = await env.ENROLLMENT_DB.prepare('SELECT id FROM quotes WHERE id = ? AND client_id = ?')
      .bind(sanitizeText(body.quote_id, 80), client.id).first();
    if (!quote) throw new HttpError(404, 'quote_not_found', 'The selected quote is unavailable for this client.');
    quoteId = quote.id;
  }
  const items = await resolveLineItems(env, body.items);
  const subtotal = sumItems(items);
  const { tax, total } = computeTotal(subtotal, 0, Number(body.tax_amount));
  const currency = resolveCurrency(body.currency);
  const now = new Date().toISOString();
  const invoiceId = opaqueId('inv');
  const statements = [
    env.ENROLLMENT_DB.prepare(`INSERT INTO invoices (
      id, client_id, project_id, quote_id, status, currency, subtotal, tax_amount, total, amount_paid,
      due_date, notes, stripe_invoice_id, stripe_payment_intent_id, created_by_admin_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, 0, ?, ?, NULL, NULL, ?, ?, ?)`)
      .bind(invoiceId, client.id, projectId, quoteId, currency, subtotal, tax, total,
        sanitizeDate(body.due_date), sanitizeText(body.notes, 2000) || null, session.actor_id, now, now),
  ];
  items.forEach((item) => {
    statements.push(env.ENROLLMENT_DB.prepare(`INSERT INTO invoice_items (
      id, invoice_id, service_id, label, description, quantity, unit_price, amount, sort_order, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(opaqueId('ivi'), invoiceId, item.serviceId, item.label, item.description, item.quantity, item.unitPrice, item.amount, item.sortOrder, now));
  });
  statements.push(auditStatementForAdmin(env.ENROLLMENT_DB, 'invoice_created', session, requestId(request), { clientId: client.id, projectId, entityType: 'invoice', entityId: invoiceId }));
  await env.ENROLLMENT_DB.batch(statements);
  return json({ id: invoiceId, clientId: client.id, projectId, quoteId, subtotal, taxAmount: tax, total, status: 'draft' }, 201);
}

async function sendInvoice({ request, env }, invoiceId) {
  requireTrustedOrigin(request, env); requireJson(request);
  const session = await authenticate(request, env, ['e4la_admin']);
  await requireCsrf(request, session);
  const invoice = await env.ENROLLMENT_DB.prepare('SELECT * FROM invoices WHERE id = ?').bind(sanitizeText(invoiceId, 80)).first();
  if (!invoice) throw new HttpError(404, 'invoice_not_found', 'The selected invoice is unavailable.');
  if (invoice.status !== 'draft') throw new HttpError(409, 'invoice_already_sent', 'This invoice has already been sent.');
  const now = new Date().toISOString();
  try {
    await env.ENROLLMENT_DB.batch([
      env.ENROLLMENT_DB.prepare("UPDATE invoices SET status = 'sent', sent_at = COALESCE(sent_at, ?), updated_at = ? WHERE id = ?").bind(now, now, invoice.id),
      auditStatementForAdmin(env.ENROLLMENT_DB, 'invoice_sent', session, requestId(request), { clientId: invoice.client_id, projectId: invoice.project_id, entityType: 'invoice', entityId: invoice.id }),
    ]);
  } catch (error) {
    // Surface the 0006 migration's own invoice_items immutability trigger as a clean error
    // rather than letting a raw SQLite constraint message leak to the client.
    if (String(error.message || '').toLowerCase().includes('immutable')) {
      throw new HttpError(409, 'invoice_items_immutable', 'This invoice could not be sent because its line items changed unexpectedly. Contact E4LA support.');
    }
    throw error;
  }
  return json({ id: invoice.id, status: 'sent', sentAt: now });
}

async function getInvoice({ request, env }, invoiceId) {
  const session = await authenticate(request, env, [...ADMIN_ROLES, ...CLIENT_ROLES]);
  const invoice = await env.ENROLLMENT_DB.prepare('SELECT * FROM invoices WHERE id = ?').bind(sanitizeText(invoiceId, 80)).first();
  if (!invoice) throw new HttpError(404, 'invoice_not_found', 'The selected invoice is unavailable.');
  if (CLIENT_ROLES.includes(session.role)) {
    if (invoice.client_id !== session.client_id) throw new HttpError(404, 'invoice_not_found', 'The selected invoice is unavailable.');
  } else if (session.role === 'e4la_collaborator') {
    if (invoice.project_id) await assertProjectAccess(env, session, invoice.project_id);
    else throw new HttpError(403, 'not_authorized', 'You do not have permission to view this invoice.');
  }
  const items = await env.ENROLLMENT_DB.prepare('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY sort_order').bind(invoice.id).all();
  const responseInvoice = CLIENT_ROLES.includes(session.role) ? toClientSafeInvoice(invoice) : invoice;
  return json({ invoice: responseInvoice, items: items.results });
}

async function listClientInvoices({ request, env }, clientId) {
  const session = await authenticate(request, env, [...ADMIN_ROLES, ...CLIENT_ROLES]);
  if (CLIENT_ROLES.includes(session.role)) {
    if (session.client_id !== sanitizeText(clientId, 80)) throw new HttpError(404, 'client_not_found', 'The client record is unavailable.');
  } else {
    await assertClientAccessForAdmin(env, session, clientId);
  }
  const rows = await env.ENROLLMENT_DB.prepare('SELECT * FROM invoices WHERE client_id = ? ORDER BY created_at DESC').bind(sanitizeText(clientId, 80)).all();
  const invoices = CLIENT_ROLES.includes(session.role) ? rows.results.map(toClientSafeInvoice) : rows.results;
  return json({ invoices });
}

// -------------------------------------------------------------------------------------
// Recurring service consent - the safety-critical piece. A recurring Stripe subscription
// may only ever be created against a consent row whose actor_type/actor_id came from the
// authenticated session, never from a request body, and only client_owner/authorized_signer
// (never client_viewer, never an admin acting alone) can create one.
// -------------------------------------------------------------------------------------

const BILLING_FREQUENCIES = ['weekly', 'biweekly', 'monthly', 'quarterly', 'annual'];
const RENEWAL_BEHAVIORS = ['auto_renew_until_cancelled', 'fixed_term_then_stop'];

async function prepareRecurringOffer({ request, env }) {
  requireTrustedOrigin(request, env); requireJson(request);
  const session = await authenticate(request, env, ['e4la_admin']);
  await requireCsrf(request, session);
  const body = await request.json();
  requireFields(body, ['service_id', 'billing_frequency', 'start_date']);
  const service = await env.ENROLLMENT_DB.prepare('SELECT * FROM services WHERE id = ?').bind(sanitizeText(body.service_id, 80)).first();
  if (!service) throw new HttpError(404, 'service_not_found', 'The selected service is unavailable.');
  const billingAmount = Number(body.billing_amount);
  if (!Number.isSafeInteger(billingAmount) || billingAmount <= 0) throw new HttpError(422, 'billing_amount_invalid', 'billing_amount must be a positive integer number of cents.');
  const billingFrequency = sanitizeText(body.billing_frequency, 20);
  if (!BILLING_FREQUENCIES.includes(billingFrequency)) throw new HttpError(422, 'billing_frequency_invalid', 'Select a supported billing frequency.');
  const startDate = sanitizeDate(body.start_date);
  if (!startDate) throw new HttpError(422, 'start_date_invalid', 'Enter a valid start date.');
  const renewalBehavior = sanitizeText(body.renewal_behavior, 30) || 'auto_renew_until_cancelled';
  if (!RENEWAL_BEHAVIORS.includes(renewalBehavior)) throw new HttpError(422, 'renewal_behavior_invalid', 'Select a supported renewal behavior.');
  // Nothing is persisted here - this is a normalized, unsaved shape for the client portal
  // to render and for /recurring-consent/approve to accept verbatim.
  return json({
    offer: {
      serviceId: service.id, serviceName: service.name, billingAmount, billingFrequency, startDate, renewalBehavior,
    },
  });
}

async function approveRecurringConsent({ request, env }) {
  requireTrustedOrigin(request, env); requireJson(request);
  // Only client_owner/authorized_signer may create a consent - a client_viewer session and
  // an e4la_admin/e4la_collaborator session are both rejected with 403 by this allowlist
  // alone, before any body field is even read.
  const session = await authenticate(request, env, ['client_owner', 'authorized_signer']);
  await requireCsrf(request, session);
  const body = await request.json();
  requireFields(body, ['client_id', 'service_id', 'billing_frequency', 'start_date', 'renewal_behavior', 'cancellation_terms_version', 'consent_text_version']);
  const clientId = sanitizeText(body.client_id, 80);
  // The session's own client_id is the only authority for "whose consent is this" - a
  // mismatched or forged client_id in the body is rejected even though the session role
  // already passed, because an authorized_signer for one client must never be able to
  // consent on behalf of a different client by simply changing the request body.
  if (clientId !== session.client_id) {
    throw new HttpError(403, 'not_authorized', 'You may only approve recurring billing for your own client account.');
  }
  const service = await env.ENROLLMENT_DB.prepare('SELECT id, billing_type FROM services WHERE id = ?').bind(sanitizeText(body.service_id, 80)).first();
  if (!service) throw new HttpError(404, 'service_not_found', 'The selected service is unavailable.');
  // A recurring consent - and eventually a live recurring Stripe subscription - may only
  // ever be created for a service whose own catalog definition is billed as recurring.
  // Without this, a client could be asked to "consent" to recurring billing for a service
  // that is structurally a one-time, fixed_scope engagement.
  if (service.billing_type !== 'recurring_service') {
    throw new HttpError(422, 'service_not_recurring', 'Recurring billing consent can only be created for a service billed as a recurring service.');
  }
  const billingAmount = Number(body.billing_amount);
  if (!Number.isSafeInteger(billingAmount) || billingAmount <= 0) throw new HttpError(422, 'billing_amount_invalid', 'billing_amount must be a positive integer number of cents.');
  const billingFrequency = sanitizeText(body.billing_frequency, 20);
  if (!BILLING_FREQUENCIES.includes(billingFrequency)) throw new HttpError(422, 'billing_frequency_invalid', 'Select a supported billing frequency.');
  const startDate = sanitizeDate(body.start_date);
  if (!startDate) throw new HttpError(422, 'start_date_invalid', 'Enter a valid start date.');
  const renewalBehavior = sanitizeText(body.renewal_behavior, 30);
  if (!RENEWAL_BEHAVIORS.includes(renewalBehavior)) throw new HttpError(422, 'renewal_behavior_invalid', 'Select a supported renewal behavior.');
  const cancellationTermsVersion = sanitizeText(body.cancellation_terms_version, 40);
  const consentTextVersion = sanitizeText(body.consent_text_version, 40);
  let quoteId = null;
  if (body.quote_id) {
    const quote = await env.ENROLLMENT_DB.prepare('SELECT id FROM quotes WHERE id = ? AND client_id = ?').bind(sanitizeText(body.quote_id, 80), clientId).first();
    if (!quote) throw new HttpError(404, 'quote_not_found', 'The selected quote is unavailable for this client.');
    quoteId = quote.id;
  }
  let agreementId = null;
  if (body.agreement_id) {
    const agreement = await env.ENROLLMENT_DB.prepare('SELECT id FROM agreements WHERE id = ? AND client_id = ?').bind(sanitizeText(body.agreement_id, 80), clientId).first();
    if (!agreement) throw new HttpError(404, 'agreement_not_found', 'The selected agreement is unavailable for this client.');
    agreementId = agreement.id;
  }
  let projectId = null;
  if (body.project_id) {
    const project = await env.ENROLLMENT_DB.prepare('SELECT id FROM projects WHERE id = ? AND client_id = ?').bind(sanitizeText(body.project_id, 80), clientId).first();
    if (!project) throw new HttpError(404, 'project_not_found', 'The selected project is unavailable for this client.');
    projectId = project.id;
  }
  const now = new Date().toISOString();
  const id = opaqueId('rsc');
  const evidence = JSON.stringify({
    requestId: requestId(request),
    userAgent: sanitizeText(request.headers.get('User-Agent') || '', 320),
    sessionId: session.id,
  });
  // Consent terms are immutable once approved (see 0007's trigger) - a changed price,
  // frequency, or renewal term can only ever be represented as a brand-new consent row,
  // never a rewrite of what was actually agreed to. That means THIS handler is the only
  // place that can retire the prior term set, and it must do so: without it, two 'active'
  // consent rows could coexist for the same client+service, which is genuinely ambiguous
  // authorization for what should actually be billed. Scoped to client_id+service_id only
  // (matching the recurring_service_consents indexes), and executed in the same batch as
  // the new INSERT so the supersede and the new approval are atomic.
  const priorActive = await env.ENROLLMENT_DB.prepare(
    "SELECT id FROM recurring_service_consents WHERE client_id = ? AND service_id = ? AND status = 'active'",
  ).bind(clientId, service.id).first();
  const statements = [];
  if (priorActive) {
    statements.push(env.ENROLLMENT_DB.prepare(
      "UPDATE recurring_service_consents SET status = 'superseded', updated_at = ? WHERE id = ?",
    ).bind(now, priorActive.id));
  }
  statements.push(env.ENROLLMENT_DB.prepare(`INSERT INTO recurring_service_consents (
      id, client_id, project_id, quote_id, agreement_id, service_id, billing_amount, billing_frequency,
      start_date, renewal_behavior, cancellation_terms_version, consent_text_version, actor_type, actor_id,
      approved_at, consent_evidence, status, cancelled_at, stripe_subscription_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', NULL, NULL, ?, ?)`)
    .bind(id, clientId, projectId, quoteId, agreementId, service.id, billingAmount, billingFrequency, startDate,
      renewalBehavior, cancellationTermsVersion, consentTextVersion, session.role, session.actor_id, now, evidence, now, now));
  await env.ENROLLMENT_DB.batch(statements);
  await audit(env.ENROLLMENT_DB, {
    type: 'recurring_consent_approved', actorType: 'client_user', actorId: session.actor_id, clientId, projectId,
    relatedType: 'recurring_service_consent', relatedId: id, requestId: requestId(request),
  });
  return json({ id, clientId, serviceId: service.id, billingAmount, billingFrequency, startDate, status: 'active' }, 201);
}

// Client-role sessions must never see the evidentiary/internal side of a consent record -
// the actor's internal user id, the raw evidence blob (request id/user agent/session id),
// or a live Stripe subscription id. Admin/collaborator sessions still receive the full row.
const CLIENT_SAFE_CONSENT_FIELDS = [
  'id', 'client_id', 'project_id', 'quote_id', 'agreement_id', 'service_id', 'billing_amount',
  'billing_frequency', 'start_date', 'renewal_behavior', 'cancellation_terms_version',
  'consent_text_version', 'actor_type', 'approved_at', 'status', 'cancelled_at', 'created_at', 'updated_at',
];
function toClientSafeConsent(consent) {
  const safe = {};
  CLIENT_SAFE_CONSENT_FIELDS.forEach((field) => { safe[field] = consent[field]; });
  return safe;
}

async function listRecurringConsents({ request, env }, clientId) {
  const session = await authenticate(request, env, [...ADMIN_ROLES, ...CLIENT_ROLES]);
  if (CLIENT_ROLES.includes(session.role)) {
    if (session.client_id !== sanitizeText(clientId, 80)) throw new HttpError(404, 'client_not_found', 'The client record is unavailable.');
  } else {
    await assertClientAccessForAdmin(env, session, clientId);
  }
  const rows = await env.ENROLLMENT_DB.prepare('SELECT * FROM recurring_service_consents WHERE client_id = ? ORDER BY created_at DESC').bind(sanitizeText(clientId, 80)).all();
  const consents = CLIENT_ROLES.includes(session.role) ? rows.results.map(toClientSafeConsent) : rows.results;
  return json({ consents });
}

async function cancelRecurringConsent({ request, env }, consentId) {
  requireTrustedOrigin(request, env); requireJson(request);
  const session = await authenticate(request, env, ['e4la_admin', 'client_owner', 'authorized_signer']);
  await requireCsrf(request, session);
  const consent = await env.ENROLLMENT_DB.prepare('SELECT * FROM recurring_service_consents WHERE id = ?').bind(sanitizeText(consentId, 80)).first();
  if (!consent) throw new HttpError(404, 'consent_not_found', 'The selected recurring consent is unavailable.');
  if (CLIENT_ROLES.includes(session.role) && consent.client_id !== session.client_id) {
    throw new HttpError(404, 'consent_not_found', 'The selected recurring consent is unavailable.');
  }
  if (consent.status !== 'active') {
    throw new HttpError(409, 'consent_not_active', 'This recurring consent is not active and cannot be cancelled.');
  }
  const now = new Date().toISOString();
  await env.ENROLLMENT_DB.prepare("UPDATE recurring_service_consents SET status = 'cancelled', cancelled_at = ?, updated_at = ? WHERE id = ?")
    .bind(now, now, consent.id).run();
  await audit(env.ENROLLMENT_DB, {
    type: 'recurring_consent_cancelled', actorType: session.actor_type, actorId: session.actor_id, clientId: consent.client_id,
    relatedType: 'recurring_service_consent', relatedId: consent.id, requestId: requestId(request),
  });
  return json({ id: consent.id, status: 'cancelled', cancelledAt: now });
}
