// Shared, non-router helpers for the Content Intelligence surface
// (functions/api/content/[[path]].js). Deliberately kept separate from
// functions/_shared/ops-security.js (whose exports are imported and reused as-is,
// never reimplemented) and from the Commercial layer's functions/_shared/services.js
// etc. Nothing here touches functions/api/ops/[[path]].js or the commerce paths.

import { randomToken } from './ops-security.js';

// Same opaque-id shape used throughout functions/api/ops/[[path]].js
// (`${prefix}_${randomToken(18)}`). That helper is not exported from
// ops-security.js today, so it is reproduced here identically rather than
// forking its behavior.
export function opaqueId(prefix) {
  return `${prefix}_${randomToken(18)}`;
}

// Same YYYY-MM-DD validation used by functions/api/ops/[[path]].js's sanitizeDate.
export function sanitizeDate(value, sanitizeText) {
  const text = sanitizeText(value, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

export function parseJson(value, fallback) {
  try {
    const parsed = JSON.parse(value);
    return parsed === undefined ? fallback : parsed;
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// Brand Brain automation-mode gate.
//
// auto_publish_approved_policy must never be reachable by accident. Per the
// migration comment in 0008_content_intelligence.sql, the application layer
// (here) is solely responsible for refusing to set it unless BOTH an explicit
// client-agreement authorization flag AND an explicit E4LA internal policy
// confirmation flag are present on the same request, and only for an
// e4la_admin actor (never e4la_collaborator). There is no endpoint anywhere
// that can set this value any other way.
// ---------------------------------------------------------------------------
export function assertAutomationModeAllowed(automationMode, body, session, HttpError) {
  if (automationMode !== 'auto_publish_approved_policy') return;
  if (session.role !== 'e4la_admin') {
    throw new HttpError(422, 'automation_mode_not_authorized', 'Only an E4LA admin may enable the auto-publish approved policy.');
  }
  if (body.client_agreement_authorizes_auto_publish !== true || body.e4la_policy_confirmed !== true) {
    throw new HttpError(422, 'automation_mode_not_authorized', 'Enabling auto-publish requires both client_agreement_authorizes_auto_publish and e4la_policy_confirmed to be explicitly true.');
  }
}

// A content item's lifecycle requires a client-review step only when the
// client's brand brain automation_mode is 'client_approval'. 'manual' and
// 'assisted' leave the go/no-go decision with E4LA internally at e4la_approved.
// 'auto_publish_approved_policy' means the client has already blanket-authorized
// publishing under E4LA's internal policy (see assertAutomationModeAllowed above)
// so no per-item client_review step is required either.
export function requiresClientReview(brandBrain) {
  return Boolean(brandBrain) && brandBrain.automation_mode === 'client_approval';
}

// ---------------------------------------------------------------------------
// content_items status lifecycle.
//
// Documented transition graph (source status -> allowed target statuses).
// This is the ONLY place that decides whether a transition is structurally
// legal; every additional business rule (client-review gating, the RED-claim
// approval block, role/scope checks) is layered on top of this map, never in
// place of it.
//
//   idea               -> researched, blocked, archived
//   researched         -> verified, blocked, archived
//   verified           -> drafting, blocked, archived
//   drafting           -> design_ready, blocked
//   design_ready       -> e4la_review, blocked
//   e4la_review        -> e4la_approved, rejected, revision_requested, blocked
//   e4la_approved      -> client_review, approved, blocked
//     (client_review is only legal when the brand brain requires it;
//      approved directly from e4la_approved is only legal when it does not -
//      enforced in the handler, not in this map)
//   client_review      -> approved, revision_requested, rejected, blocked
//   approved           -> scheduled, blocked, withdrawn
//   scheduled          -> publishing, blocked, withdrawn
//   publishing         -> published, publishing_failed
//   published          -> verified_live, withdrawn
//   verified_live      -> withdrawn
//   rejected           -> archived
//   revision_requested -> drafting, archived
//   blocked            -> drafting, archived
//   publishing_failed  -> scheduled, blocked, archived
//   withdrawn          -> archived
//   archived           -> (terminal)
//
// Notably: 'rejected' and 'blocked' have no path to 'scheduled', so a rejected
// or blocked item can never be scheduled without first re-entering the normal
// drafting flow and being re-approved.
// ---------------------------------------------------------------------------
export const CONTENT_ITEM_TRANSITIONS = {
  idea: ['researched', 'blocked', 'archived'],
  researched: ['verified', 'blocked', 'archived'],
  verified: ['drafting', 'blocked', 'archived'],
  drafting: ['design_ready', 'blocked'],
  design_ready: ['e4la_review', 'blocked'],
  e4la_review: ['e4la_approved', 'rejected', 'revision_requested', 'blocked'],
  e4la_approved: ['client_review', 'approved', 'blocked'],
  client_review: ['approved', 'revision_requested', 'rejected', 'blocked'],
  approved: ['scheduled', 'blocked', 'withdrawn'],
  scheduled: ['publishing', 'blocked', 'withdrawn'],
  publishing: ['published', 'publishing_failed'],
  published: ['verified_live', 'withdrawn'],
  verified_live: ['withdrawn'],
  rejected: ['archived'],
  revision_requested: ['drafting', 'archived'],
  blocked: ['drafting', 'archived'],
  publishing_failed: ['scheduled', 'blocked', 'archived'],
  withdrawn: ['archived'],
  archived: [],
};

export const ALL_CONTENT_ITEM_STATUSES = Object.keys(CONTENT_ITEM_TRANSITIONS);

// A client session (client_owner/authorized_signer only - client_viewer never
// reaches this check because it is excluded from the authenticate() allowlist
// entirely) may ONLY move an item between 'client_review' and one of
// 'approved'/'revision_requested'. No other source status, no other target
// status, ever, for a client actor.
export const CLIENT_ALLOWED_STATUS_TRANSITIONS = {
  client_review: ['approved', 'revision_requested'],
};

// content_plans lifecycle. Approving a plan (status -> 'client_approved') is a
// planning-cadence decision only. There is no code path anywhere in this
// module, or in functions/api/content/[[path]].js, that reads a content_plan
// status change and writes to content_items.status - plan approval and post
// approval are entirely independent state machines.
export const CONTENT_PLAN_TRANSITIONS = {
  draft: ['internal_approved', 'archived'],
  internal_approved: ['sent_to_client', 'archived'],
  sent_to_client: ['client_approved', 'archived'],
  client_approved: ['active', 'archived'],
  active: ['archived'],
  archived: [],
};

// Client-facing visibility bands for content_items.status. A client_viewer may
// only ever see already-published/scheduled material, read-only. A client
// with approval rights (client_owner/authorized_signer) additionally sees
// items sitting at or past the point they might need to act on them.
// Nothing at idea/researched/verified/drafting/design_ready/e4la_review/
// e4la_approved is ever visible to any client role.
export const CLIENT_VIEWER_VISIBLE_STATUSES = ['scheduled', 'publishing', 'published', 'verified_live'];
export const CLIENT_APPROVER_VISIBLE_STATUSES = ['client_review', 'approved', ...CLIENT_VIEWER_VISIBLE_STATUSES];

export function clientVisibleStatusesForRole(role) {
  if (role === 'client_viewer') return CLIENT_VIEWER_VISIBLE_STATUSES;
  if (role === 'client_owner' || role === 'authorized_signer') return CLIENT_APPROVER_VISIBLE_STATUSES;
  return [];
}

// content_plans client-visible statuses. A plan is an internal planning
// artifact until E4LA deliberately shares it - 'draft' and 'internal_approved'
// are purely internal cadence/shape decisions (mirrors the content_items band
// above: idea..e4la_approved are never client-visible either). A client
// session must never see a plan sitting at 'draft' or 'internal_approved',
// whether via the list endpoint or by requesting it directly by id.
export const CLIENT_VISIBLE_PLAN_STATUSES = ['sent_to_client', 'client_approved', 'active', 'archived'];

// Explicit whitelist projection for a client-facing content_items response -
// safer than blacklisting, since any future column added to the table is
// hidden from clients by default rather than leaked by default. In
// particular this always omits internal_notes, created_by_admin_id, and
// content_plan_id (an internal grouping key). content_sources/content_claims
// are never joined into a client-facing content_items payload at all.
export function toClientSafeContentItem(row) {
  return {
    id: row.id,
    topic: row.topic,
    pillar: row.pillar,
    masterCopy: row.master_copy,
    cta: row.cta,
    scheduledDate: row.scheduled_date,
    status: row.status,
    clientVisibleNotes: row.client_visible_notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
