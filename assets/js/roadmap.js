// assets/js/roadmap.js
//
// Shared "Roadmap / Client Journey" visualization. Pure rendering only - it
// never calls an API. Both the Admin dashboard (assets/js/admin.js) and the
// Client Portal (assets/js/client-portal.js) fetch their own data and pass
// it in. Pair with assets/css/roadmap.css (load it after operations.css -
// every color used here is one of the --ops-* tokens defined there).
//
// -----------------------------------------------------------------------
// CONTRACT / USAGE EXAMPLE (fictional data - shows the exact shape callers
// must provide, matching the real columns in migrations/0004_project_progress.sql
// and project_milestones in migrations/0001_client_operations.sql):
//
//   import { renderRoadmap } from './roadmap.js';
//
//   const data = {
//     phases: [
//       {
//         id: 'phase_1', project_id: 'proj_demo', name: 'Foundation & Visibility',
//         sequence: 1, status: 'completed',
//         target_start_date: '2026-08-12', target_end_date: '2026-09-02',
//         client_action_required: 0, client_action_note: null,
//         publication_status: 'published',
//       },
//       {
//         id: 'phase_2', project_id: 'proj_demo', name: 'Content & Local SEO Buildout',
//         sequence: 2, status: 'current',
//         target_start_date: '2026-09-03', target_end_date: '2026-10-01',
//         client_action_required: 1, client_action_note: 'Approve the homepage copy draft so publishing can start.',
//         publication_status: 'published',
//       },
//       {
//         id: 'phase_3', project_id: 'proj_demo', name: 'Reporting & Handoff',
//         sequence: 3, status: 'upcoming',
//         target_start_date: null, target_end_date: null,
//         client_action_required: 0, client_action_note: null,
//         publication_status: 'published',
//       },
//     ],
//     milestones: [
//       { id: 'ms_1', project_id: 'proj_demo', title: 'Technical SEO audit delivered', description: '', status: 'completed', target_date: '2026-08-20', completed_at: '2026-08-19', phase_id: 'phase_1' },
//       { id: 'ms_2', project_id: 'proj_demo', title: 'Homepage copy draft', description: '', status: 'in_progress', target_date: '2026-09-10', completed_at: null, phase_id: 'phase_2' },
//       { id: 'ms_3', project_id: 'proj_demo', title: 'Google Business Profile optimization', description: '', status: 'planned', target_date: '2026-09-20', completed_at: null, phase_id: 'phase_2' },
//       // phase_3 intentionally has zero milestones yet - the component omits
//       // its progress fraction and milestone list entirely, honestly.
//     ],
//     // Optional. Deliverables have no phase_id column in the real schema
//     // (see migrations/0001_client_operations.sql) - if a caller has done
//     // its own work to associate one with a phase (e.g. via a join through
//     // milestones, or manual curation), it may attach a `phase_id` here.
//     // Entries without a matching phase_id are simply not rendered by this
//     // component (never guessed, never shown in a generic catch-all list -
//     // that duplicates the portal's existing dedicated deliverables UI).
//     deliverables: [
//       { id: 'del_1', project_id: 'proj_demo', title: 'Technical SEO Audit Report', publication_status: 'published', phase_id: 'phase_1' },
//     ],
//   };
//
//   renderRoadmap(document.querySelector('#portal-roadmap'), data, { audience: 'client' });
//   // Admin call site would typically do: { audience: 'admin' }
//
// -----------------------------------------------------------------------

const PHASE_STATUSES = ['completed', 'current', 'upcoming', 'blocked', 'on_hold'];

/**
 * Render the roadmap into `container` (an Element, or a selector string
 * resolved with document.querySelector). Clears and replaces its children.
 * Returns the root element that was inserted, or null if `container`
 * couldn't be resolved.
 *
 * @param {Element|string} container
 * @param {{ phases?: object[], milestones?: object[], deliverables?: object[] }} data
 * @param {{ audience?: 'admin'|'client' }} [options]
 */
export function renderRoadmap(container, data, options = {}) {
  const target = typeof container === 'string' ? document.querySelector(container) : container;
  if (!target) return null;
  const root = buildRoadmap(data, options);
  target.replaceChildren(root);
  return root;
}

/**
 * Pure builder: takes the same data/options as renderRoadmap and returns a
 * detached DOM node, without touching the page. Use this when the caller
 * wants to compose the roadmap into a larger tree itself rather than handing
 * over a container.
 *
 * @param {{ phases?: object[], milestones?: object[], deliverables?: object[] }} data
 * @param {{ audience?: 'admin'|'client' }} [options]
 * @returns {HTMLElement}
 */
export function buildRoadmap(data = {}, options = {}) {
  const audience = options.audience === 'admin' ? 'admin' : 'client';
  const phases = Array.isArray(data.phases)
    ? data.phases.slice().sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0))
    : [];
  const milestones = Array.isArray(data.milestones) ? data.milestones : [];
  const deliverables = Array.isArray(data.deliverables) ? data.deliverables : [];

  const root = el('div', 'e4la-roadmap');
  root.dataset.audience = audience;

  if (!phases.length) {
    root.append(buildEmptyState());
    return root;
  }

  // If more than one phase is legitimately 'current' at once, say so plainly
  // instead of letting two equally-badged "In Progress" cards look like a
  // data error. This is a real, supported state - not an edge case to hide.
  const currentCount = phases.filter((item) => item.status === 'current').length;
  if (currentCount > 1) {
    root.append(text('p', `${currentCount} phases are in progress at the same time.`, 'e4la-roadmap__multi-current-note'));
  }

  const stages = el('div', 'e4la-roadmap__stages');
  stages.setAttribute('role', 'list');
  stages.append(buildConnector(phases));

  phases.forEach((phase, index) => {
    const phaseMilestones = phase.id == null ? [] : milestones.filter((item) => item.phase_id === phase.id);
    const phaseDeliverables = phase.id == null ? [] : deliverables.filter((item) => item.phase_id === phase.id);
    stages.append(buildStage(phase, phaseMilestones, phaseDeliverables, index, audience));
  });

  root.append(buildViewport(stages));
  return root;
}

// A horizontally-scrollable track (8 real phases are too dense to squeeze
// into equal-width columns on one screen without becoming illegible) with a
// visible, discoverable affordance: prev/next buttons plus a background
// panel that reads as "there's a track here, scroll it" rather than relying
// on an undiscoverable swipe gesture alone. Mobile switches to the existing
// vertical stack (see the 720px breakpoint in roadmap.css) where none of
// this applies, so the buttons are simply hidden there.
function buildViewport(stages) {
  const viewport = el('div', 'e4la-roadmap__viewport');
  const prevBtn = el('button', 'e4la-roadmap__nav e4la-roadmap__nav--prev');
  prevBtn.type = 'button';
  prevBtn.setAttribute('aria-label', 'Scroll to earlier phases');
  prevBtn.innerHTML = '&#8249;';
  const nextBtn = el('button', 'e4la-roadmap__nav e4la-roadmap__nav--next');
  nextBtn.type = 'button';
  nextBtn.setAttribute('aria-label', 'Scroll to later phases');
  nextBtn.innerHTML = '&#8250;';

  viewport.append(prevBtn, stages, nextBtn);

  const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const step = () => Math.max(240, stages.clientWidth * 0.8);
  prevBtn.addEventListener('click', () => stages.scrollBy({ left: -step(), behavior: reducedMotion ? 'auto' : 'smooth' }));
  nextBtn.addEventListener('click', () => stages.scrollBy({ left: step(), behavior: reducedMotion ? 'auto' : 'smooth' }));

  const updateNav = () => {
    const max = stages.scrollWidth - stages.clientWidth;
    const overflows = max > 4;
    viewport.classList.toggle('e4la-roadmap__viewport--scrollable', overflows);
    prevBtn.disabled = !overflows || stages.scrollLeft <= 4;
    nextBtn.disabled = !overflows || stages.scrollLeft >= max - 4;
  };
  stages.addEventListener('scroll', updateNav, { passive: true });
  // Layout isn't settled yet on the same tick the nodes are created; defer
  // one frame so scrollWidth/clientWidth reflect the just-inserted content.
  requestAnimationFrame(updateNav);

  return viewport;
}

// ---------------------------------------------------------------------
// Stage / status derivation
// ---------------------------------------------------------------------

// Status-mapping rules (see the final report for the plain-English version):
//   - base visual state == project_phases.status, one of the 5 real CHECK values.
//   - "not started" is a visual-only sub-variant of 'upcoming' (zero completed
//     milestones in that phase) - not a new status the schema doesn't have.
//   - "awaiting client" is an overlay badge on top of a 'current' or 'upcoming'
//     phase when client_action_required = 1. It never replaces the base badge.
//   - 'on_hold' gets its own muted/desaturated treatment, distinct from 'blocked'.
function derivePhaseState(phase, phaseMilestones) {
  const status = PHASE_STATUSES.includes(phase.status) ? phase.status : 'upcoming';
  const completedCount = phaseMilestones.filter((item) => item.status === 'completed').length;
  const notStarted = status === 'upcoming' && completedCount === 0;
  const awaitingClient = (status === 'current' || status === 'upcoming') && Boolean(phase.client_action_required);
  return { status, notStarted, awaitingClient };
}

function badgeLabel(status, notStarted) {
  if (status === 'current') return 'In Progress';
  if (status === 'upcoming') return notStarted ? 'Not Started' : 'Upcoming';
  return humanize(status); // Completed / Blocked / On Hold
}

// Progress fraction: only computed when the phase has >=1 milestone. A phase
// with zero milestones gets no progress indicator at all (no fabricated 0%).
function computeProgress(phaseMilestones) {
  const total = phaseMilestones.length;
  if (total === 0) return null;
  const completed = phaseMilestones.filter((item) => item.status === 'completed').length;
  return { completed, total, pct: Math.round((completed / total) * 100) };
}

// Overall roadmap-fill formula for the connecting line: completed phases count
// fully; the current phase (if any) counts as half-filled, to visually read
// as "partway through this one, not done yet". This is a display heuristic
// derived only from real phase statuses - it does not borrow milestone-level
// precision that the connector itself doesn't need.
function computeOverallFill(phases) {
  const total = phases.length;
  if (!total) return 0;
  const completedCount = phases.filter((item) => item.status === 'completed').length;
  const hasCurrent = phases.some((item) => item.status === 'current');
  const raw = hasCurrent ? completedCount + 0.5 : completedCount;
  return Math.max(0, Math.min(100, Math.round((raw / total) * 100)));
}

// ---------------------------------------------------------------------
// DOM builders
// ---------------------------------------------------------------------

function buildEmptyState() {
  const box = el('div', 'e4la-roadmap__empty');
  box.append(text('p', 'Roadmap coming soon', 'e4la-roadmap__empty-title'));
  box.append(text('p', 'Phases will appear here once the project roadmap is published.', 'e4la-roadmap__empty-copy'));
  return box;
}

function buildConnector(phases) {
  const wrap = el('div', 'e4la-roadmap__connector');
  wrap.setAttribute('aria-hidden', 'true');
  const track = el('div', 'e4la-roadmap__connector-track');
  const fill = el('div', 'e4la-roadmap__connector-fill');
  fill.style.setProperty('--e4la-roadmap-progress', `${computeOverallFill(phases)}%`);
  track.append(fill);
  wrap.append(track);
  return wrap;
}

function buildStage(phase, phaseMilestones, phaseDeliverables, index, audience) {
  const { status, notStarted, awaitingClient } = derivePhaseState(phase, phaseMilestones);
  const base = kebab(status);

  const stage = el('div', ['e4la-roadmap__stage', `e4la-roadmap__stage--${base}`].join(' '));
  stage.setAttribute('role', 'listitem');
  if (notStarted) stage.classList.add('e4la-roadmap__stage--not-started');
  if (awaitingClient) stage.classList.add('e4la-roadmap__stage--awaiting-client');
  if (status === 'current') stage.setAttribute('aria-current', 'step');

  const marker = el('span', 'e4la-roadmap__marker');
  marker.setAttribute('aria-hidden', 'true');
  marker.textContent = status === 'completed' ? '✓'
    : status === 'blocked' ? '!'
    : status === 'on_hold' ? '❚❚'
    : String(index + 1);
  stage.append(marker);

  const card = el('div', 'e4la-roadmap__card');

  const head = el('div', 'e4la-roadmap__card-head');
  head.append(text('span', badgeLabel(status, notStarted), ['e4la-roadmap__badge', `e4la-roadmap__badge--${base}`, notStarted ? 'e4la-roadmap__badge--not-started' : ''].filter(Boolean).join(' ')));
  if (awaitingClient) head.append(text('span', 'Awaiting Client', 'e4la-roadmap__badge e4la-roadmap__badge--awaiting-client'));
  // Admin-only: surface publication_status when a phase isn't published yet
  // (i.e. the client can't actually see it). This is deliberately never
  // shown to the client audience - publication_status is an internal
  // staging field, not something the client-facing view should leak.
  if (audience === 'admin' && phase.publication_status && phase.publication_status !== 'published') {
    head.append(text('span', humanize(phase.publication_status), 'e4la-roadmap__badge e4la-roadmap__badge--internal'));
  }
  card.append(head);

  card.append(text('h3', phase.name || 'Untitled phase', 'e4la-roadmap__name'));
  card.append(text('p', formatDateRange(phase.target_start_date, phase.target_end_date), 'e4la-roadmap__dates'));

  const progress = computeProgress(phaseMilestones);
  if (progress) {
    const progressWrap = el('div', 'e4la-roadmap__progress');
    const track = el('div', 'e4la-roadmap__progress-track');
    const fill = el('div', 'e4la-roadmap__progress-fill');
    fill.style.width = `${progress.pct}%`;
    track.append(fill);
    progressWrap.append(track);
    progressWrap.append(text('span', `${progress.completed} of ${progress.total} milestones`, 'e4la-roadmap__progress-label'));
    card.append(progressWrap);
  }

  // Summary-first: the card above this point is everything shown by default
  // (status, name, dates, progress). Milestones, deliverables and the next-
  // action note are real detail a client needs, but not at a glance across
  // 8 phases at once - they live behind a native <details> disclosure so the
  // default view stays scannable and the full picture is one click away.
  // "Awaiting Client" already surfaced as a badge above, so urgency is still
  // visible before anyone expands anything.

  // Audience density difference #1: the client view hides cancelled
  // milestones (dead ends aren't meaningful to a client reading their
  // journey); admin sees everything, including what got cancelled.
  const visibleMilestones = audience === 'client'
    ? phaseMilestones.filter((item) => item.status !== 'cancelled')
    : phaseMilestones;
  // Audience density difference #2: the client view caps the milestone list
  // to keep the card clean/simple per the product brief; admin sees the
  // full operational list uncapped.
  const cap = audience === 'admin' ? Infinity : 4;
  const shownDeliverables = visibleDeliverables(phaseDeliverables, audience);
  const action = buildNextAction(phase);

  if (visibleMilestones.length || shownDeliverables.length || action) {
    const details = el('details', 'e4la-roadmap__details');
    // The current phase is the one a client is most likely to want open
    // immediately; everything else starts collapsed to keep the track scannable.
    if (status === 'current') details.open = true;
    const summaryLabel = visibleMilestones.length
      ? `${visibleMilestones.length} milestone${visibleMilestones.length === 1 ? '' : 's'}`
      : 'Details';
    details.append(text('summary', summaryLabel, 'e4la-roadmap__details-summary'));

    if (visibleMilestones.length) {
      const list = el('ul', 'e4la-roadmap__milestones');
      visibleMilestones.slice(0, cap).forEach((item) => list.append(buildMilestoneItem(item)));
      details.append(list);
      const remaining = visibleMilestones.length - cap;
      if (remaining > 0) details.append(text('p', `+${remaining} more milestone${remaining === 1 ? '' : 's'}`, 'e4la-roadmap__milestones-more'));
    }

    if (shownDeliverables.length) details.append(buildDeliverablesList(shownDeliverables));
    if (action) details.append(action);

    card.append(details);
  }

  stage.append(card);
  return stage;
}

function buildMilestoneItem(milestone) {
  const li = el('li', `e4la-roadmap__milestone e4la-roadmap__milestone--${kebab(milestone.status)}`);
  li.append(el('span', 'e4la-roadmap__milestone-dot'));
  const copy = el('span', 'e4la-roadmap__milestone-copy');
  copy.append(text('span', milestone.title || 'Untitled milestone', 'e4la-roadmap__milestone-title'));
  copy.append(text('span', humanize(milestone.status), 'e4la-roadmap__milestone-status'));
  li.append(copy);
  return li;
}

// Audience density difference #3: publication_status on a deliverable is an
// internal staging field. The client audience defensively filters to only
// publication_status === 'published' (or missing, meaning the caller already
// filtered upstream); admin sees whatever it's given.
function visibleDeliverables(items, audience) {
  if (audience !== 'client') return items;
  return items.filter((item) => !item.publication_status || item.publication_status === 'published');
}

function buildDeliverablesList(items) {
  const wrap = el('div', 'e4la-roadmap__deliverables');
  wrap.append(text('span', 'Key Deliverables', 'e4la-roadmap__deliverables-label'));
  const list = el('ul', 'e4la-roadmap__deliverables-list');
  items.forEach((item) => list.append(text('li', item.title || 'Untitled deliverable', 'e4la-roadmap__deliverables-item')));
  wrap.append(list);
  return wrap;
}

function buildNextAction(phase) {
  if (!phase.client_action_required) return null;
  const note = phase.client_action_note && String(phase.client_action_note).trim()
    ? phase.client_action_note
    : 'Client action needed to keep this phase moving.';
  const p = el('p', 'e4la-roadmap__action');
  p.append(text('strong', 'Next action: '));
  p.append(document.createTextNode(note));
  return p;
}

// ---------------------------------------------------------------------
// Small local helpers (deliberately not imported from admin.js /
// client-portal.js - this module has zero dependency on either caller so it
// stays genuinely reusable and stays a pure function of its inputs).
// ---------------------------------------------------------------------

function el(tag, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function text(tag, value, className) {
  const node = el(tag, className);
  node.textContent = value;
  return node;
}

function humanize(value) {
  return String(value || '').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function kebab(value) {
  return String(value || '').replaceAll('_', '-');
}

function formatDate(value) {
  if (!value) return null;
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(date);
}

// "date or date range ... or 'Dates to be confirmed' if both are null" - plus
// the reasonable in-between cases the brief implies (only one side set).
function formatDateRange(startValue, endValue) {
  const start = formatDate(startValue);
  const end = formatDate(endValue);
  if (start && end) return `${start} – ${end}`;
  if (start) return `Starts ${start}`;
  if (end) return `Target: ${end}`;
  return 'Dates to be confirmed';
}
