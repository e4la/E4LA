// E4LA Client Operations — reusable reporting / visualization component library.
//
// Pure, dependency-free render functions: renderX(container, data, options). No fetch/API
// calls live in this file — callers fetch data (admin.js / client-portal.js in a later
// integration pass) and pass it in. Every function follows one hard rule: if `data` is
// empty/null/undefined, it renders an honest "no data yet" empty state via
// renderChartEmptyState() — never invented numbers, never a chart populated with fake
// values "so it doesn't look empty."
//
// Color rule: every data-encoding color below comes from --ops-orange/--ops-pink/
// --ops-purple/--ops-amber or a muted neutral (--ops-muted/--ops-subtle). --ops-green/
// --ops-red are used only for genuinely-semantic "needs attention" badges (a blocked/
// failed/overdue callout, or a reused .ops-status--complete/--error pill) — never as one
// slice of an otherwise-neutral multi-category chart. See TONE_HUE below for the full
// category→color contract shared by every chart in this file. No new hues are introduced.
//
// Pair with assets/css/reporting-charts.css (see that file's header for why it's separate
// from operations.css).
//
// ---------------------------------------------------------------------------------------
// USAGE EXAMPLES (all data below is fictional, for integrator reference only)
// ---------------------------------------------------------------------------------------
//
// import {
//   renderProgressRing, renderPhaseCompletion, renderMilestoneCompletion,
//   renderDeliverablesStatus, renderFinancialStatus, renderContentLifecycle,
//   renderPublishingTrend, renderChartEmptyState,
// } from './reporting-charts.js';
//
// renderProgressRing(document.querySelector('#chart-progress'), {
//   percentComplete: 62, label: 'Overall progress',
// });
//
// renderPhaseCompletion(document.querySelector('#chart-phases'), [
//   { id: 'ph_fictional_1', name: 'Discovery', status: 'completed' },
//   { id: 'ph_fictional_2', name: 'Build', status: 'current' },
//   { id: 'ph_fictional_3', name: 'Launch', status: 'upcoming' },
//   { id: 'ph_fictional_4', name: 'Handoff', status: 'blocked' },
// ]);
//
// renderMilestoneCompletion(document.querySelector('#chart-milestones'), [
//   { id: 'ms_fictional_1', status: 'completed' },
//   { id: 'ms_fictional_2', status: 'in_progress' },
//   { id: 'ms_fictional_3', status: 'planned' },
//   { id: 'ms_fictional_4', status: 'blocked' },
//   { id: 'ms_fictional_5', status: 'cancelled' },
// ]);
//
// renderDeliverablesStatus(document.querySelector('#chart-deliverables'), [
//   { id: 'dl_fictional_1', publication_status: 'published' },
//   { id: 'dl_fictional_2', publication_status: 'approved' },
//   { id: 'dl_fictional_3', publication_status: 'internal' },
// ]);
//
// renderFinancialStatus(document.querySelector('#chart-financial'), {
//   quotes: [
//     { id: 'qt_fictional_1', status: 'approved' },
//     { id: 'qt_fictional_2', status: 'sent' },
//   ],
//   invoices: [
//     { id: 'inv_fictional_1', status: 'paid', total: 360000, amount_paid: 360000 },
//     { id: 'inv_fictional_2', status: 'overdue', total: 120000, amount_paid: 0 },
//   ],
// });
//
// renderContentLifecycle(document.querySelector('#chart-content'), [
//   { id: 'ci_fictional_1', status: 'drafting' },
//   { id: 'ci_fictional_2', status: 'client_review' },
//   { id: 'ci_fictional_3', status: 'published' },
//   { id: 'ci_fictional_4', status: 'archived' },
// ]);
//
// renderPublishingTrend(document.querySelector('#chart-publishing'), {
//   jobs: [
//     { id: 'pj_fictional_1', status: 'published' },
//     { id: 'pj_fictional_2', status: 'failed' },
//   ],
//   series: [
//     { label: 'Wk 1', value: 3 },
//     { label: 'Wk 2', value: 5 },
//     { label: 'Wk 3', value: 4 },
//   ],
// });
//
// renderChartEmptyState(document.querySelector('#chart-fallback'), {
//   title: 'No verified data yet',
//   copy: 'Custom fallback copy for a specific chart slot, if the default wording does not fit.',
// });
// ---------------------------------------------------------------------------------------

// Shared category→color contract. Every categorical/sequential chart in this file picks
// its per-group color from this table only — no raw hex, no hue invented outside the
// existing --ops-* token set. The five tones read, left to right, as a rough pipeline:
// not-started → actively-in-progress → awaiting a decision → caution/on hold → done, with
// a sixth "closed" tone for cancelled/withdrawn/archived/terminal states. --ops-green and
// --ops-red never appear here — they are reserved for the `attention` badges (rendered via
// the existing .ops-status--error/--attention/--complete classes) that call out a genuinely
// binary state (e.g. "N blocked", "N failed") *next to* a chart, never as a bar segment.
const TONE_HUE = {
  neutral: 'var(--ops-muted)', // not started / queued / planned / internal
  progress: 'var(--ops-purple)', // actively in progress / current
  review: 'var(--ops-pink)', // awaiting a decision or review
  caution: 'var(--ops-amber)', // on hold / pending verification
  done: 'var(--ops-orange)', // completed / approved / published / live
  closed: 'var(--ops-subtle)', // cancelled / withdrawn / archived / blocked / failed (de-emphasized)
};

/**
 * Generic "this chart has no verified data yet" empty state. Visually matches the existing
 * emptyState(title, copy, actionLabel, actionHref) pattern used in admin.js/client-portal.js
 * (ops-card.ops-empty > diamond icon + h3 + p [+ optional action link]) so it reads as part
 * of the same design system, but defaults to chart-specific wording so it's never confused
 * with a generic "nothing here" empty state — this one always frames it as "not yet
 * recorded/published", never as an error.
 *
 * Every other renderX() in this file calls this internally when its data is empty; it is
 * also exported directly so an integrator can use it as a fallback for a chart slot whose
 * data hasn't loaded yet, or failed to load.
 *
 * @param {HTMLElement} container
 * @param {{title?: string, copy?: string, actionLabel?: string, actionHref?: string}} [options]
 */
export function renderChartEmptyState(container, options = {}) {
  const {
    title = 'No verified data yet',
    copy = 'E4LA has not recorded and published data for this chart yet. Nothing shown here is estimated or a placeholder.',
    actionLabel,
    actionHref,
  } = options;
  container.replaceChildren();
  const box = element('div', 'ops-card ops-empty rpt-empty');
  box.append(textElement('div', '◇', 'ops-empty__icon'), textElement('h3', title), textElement('p', copy));
  if (actionLabel && actionHref) {
    const link = textElement('a', actionLabel, 'ops-button ops-button--secondary ops-mt-18');
    link.href = actionHref;
    box.append(link);
  }
  container.append(box);
  return box;
}

const RING_RADIUS_DEFAULT = 52;
let ringSeq = 0;

/**
 * Project progress ring. Circle math matches client-portal.js's existing
 * PROGRESS_RING_CIRCUMFERENCE exactly (circumference = 2 * Math.PI * radius, radius 52 by
 * default) so a default-options ring is visually identical to the one already on the
 * client portal; radius/strokeWidth are configurable via options for other contexts.
 *
 * DB source: no raw column is read directly here — percentComplete is the same computed
 * value client-portal.js already receives as `progress.percentComplete`
 * (functions/api/ops/[[path]].js derives it from completed vs. total project_milestones.status
 * rows, scoped to the phases in project_phases). This stays a pure render function: pass in
 * the already-computed percentage, don't recompute it here.
 *
 * `data: null/undefined` (no progress record exists at all for this project) renders the
 * full chart empty state. `data.percentComplete: null` (a progress record exists but there
 * are zero milestones to compute a percentage from yet) is NOT treated as "no data" — it
 * renders the ring dimmed with an honest "—", matching the exact existing convention in
 * client-portal.js's renderProgressOverview(). This is a deliberate distinction: showing a
 * dimmed ring with no number is not fabricating a value, it is honestly representing
 * "not yet calculable."
 *
 * @param {HTMLElement} container
 * @param {{percentComplete: number|null, label?: string}|null} data
 * @param {{radius?: number, strokeWidth?: number, size?: number, label?: string, title?: string|null, emptyTitle?: string, emptyCopy?: string}} [options]
 */
export function renderProgressRing(container, data, options = {}) {
  container.replaceChildren();
  if (!data) {
    renderChartEmptyState(container, {
      title: options.emptyTitle || 'No verified data yet',
      copy: options.emptyCopy || 'E4LA has not published progress data for this engagement yet.',
    });
    return;
  }
  const hasPercent = typeof data.percentComplete === 'number' && Number.isFinite(data.percentComplete);
  const percent = hasPercent ? Math.max(0, Math.min(100, data.percentComplete)) : 0;
  const radius = Number(options.radius) || RING_RADIUS_DEFAULT;
  const strokeWidth = Number(options.strokeWidth) || 10;
  const size = Number(options.size) || (radius + strokeWidth) * 2;
  const circumference = 2 * Math.PI * radius;
  ringSeq += 1;
  const gradientId = `rpt-ring-gradient-${ringSeq}`;

  const wrap = element('div', 'rpt-ring');
  wrap.style.width = `${size}px`;
  wrap.style.height = `${size}px`;

  const svg = svgEl('svg', { viewBox: `0 0 ${size} ${size}`, width: size, height: size });
  const defs = svgEl('defs');
  const gradient = svgEl('linearGradient', { id: gradientId, x1: '0%', y1: '0%', x2: '100%', y2: '0%' });
  gradient.append(
    svgEl('stop', { offset: '0%', 'stop-color': 'var(--ops-orange)' }),
    svgEl('stop', { offset: '52%', 'stop-color': 'var(--ops-pink)' }),
    svgEl('stop', { offset: '100%', 'stop-color': 'var(--ops-purple)' }),
  );
  defs.append(gradient);
  const track = svgEl('circle', { class: 'rpt-ring__track', cx: size / 2, cy: size / 2, r: radius, 'stroke-width': strokeWidth });
  const value = svgEl('circle', {
    class: 'rpt-ring__value', cx: size / 2, cy: size / 2, r: radius, 'stroke-width': strokeWidth,
    stroke: `url(#${gradientId})`,
    'stroke-dasharray': circumference,
    'stroke-dashoffset': circumference * (1 - (hasPercent ? percent / 100 : 0)),
  });
  value.style.opacity = hasPercent ? '1' : '0.18';
  svg.append(defs, track, value);
  wrap.append(svg);

  const copy = element('div', 'rpt-ring__copy');
  copy.append(textElement('strong', hasPercent ? `${percent}%` : '—'));
  const caption = data.label || options.label;
  if (caption) copy.append(textElement('span', caption));
  wrap.append(copy);
  container.append(wrap);
}

function resolveTitle(defaultTitle, options) {
  if (options.title === null) return null;
  return options.title || defaultTitle;
}

function countBy(rows, key) {
  return rows.reduce((acc, row) => {
    const value = row && row[key];
    if (value) acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

// Shared "N of M" categorical breakdown: a single proportional stacked bar plus a legend
// (swatch + label + count). Used by every count-based chart below. Colors always come from
// TONE_HUE; `attention` renders separate .ops-status badges (using the existing green/red
// semantic classes) next to the title for a genuinely binary callout (e.g. "2 blocked"),
// never as a bar segment color.
function buildSegmentedBreakdown({ title, groups, attention = [], note, ariaLabel }) {
  const wrap = element('div', 'rpt-chart');
  if (title || attention.length) {
    const head = element('div', 'rpt-chart__head');
    if (title) head.append(textElement('h3', title, 'rpt-chart__title'));
    if (attention.length) {
      const badges = element('div', 'rpt-badges');
      attention.forEach((item) => badges.append(textElement('span', item.label, `ops-status ops-status--${item.tone}`)));
      head.append(badges);
    }
    wrap.append(head);
  }
  const total = groups.reduce((sum, group) => sum + (group.count || 0), 0);
  const bar = element('div', 'rpt-bar');
  bar.setAttribute('role', 'img');
  bar.setAttribute('aria-label', ariaLabel || groups.map((group) => `${group.count} ${group.label}`).join(', '));
  groups.filter((group) => group.count > 0).forEach((group) => {
    const segment = element('span', 'rpt-bar__segment');
    segment.style.width = `${(group.count / total) * 100}%`;
    segment.style.background = TONE_HUE[group.tone] || TONE_HUE.neutral;
    bar.append(segment);
  });
  wrap.append(bar);
  const legend = element('dl', 'rpt-legend');
  groups.forEach((group) => {
    const item = element('div', 'rpt-legend__item');
    const swatch = element('span', 'rpt-legend__swatch');
    swatch.style.background = TONE_HUE[group.tone] || TONE_HUE.neutral;
    item.append(swatch, textElement('dt', group.label, 'rpt-legend__label'), textElement('dd', String(group.count), 'rpt-legend__count'));
    legend.append(item);
  });
  wrap.append(legend);
  if (note) wrap.append(textElement('p', note, 'rpt-chart__note'));
  return wrap;
}

function renderSegmentedBreakdown(container, config) {
  const total = config.groups.reduce((sum, group) => sum + (group.count || 0), 0);
  container.replaceChildren();
  if (total === 0) {
    renderChartEmptyState(container, { title: config.emptyTitle, copy: config.emptyCopy });
    return;
  }
  container.append(buildSegmentedBreakdown(config));
}

/**
 * Phase completion. Reads project_phases.status for every phase row passed in (values:
 * 'completed' | 'current' | 'upcoming' | 'blocked' | 'on_hold' — see
 * migrations/0004_project_progress.sql). Grouped into the three buckets the product owner
 * asked for — Completed / Current / Remaining — where "Remaining" folds together upcoming,
 * on_hold, and blocked phases (none of them are the active phase, and none are done yet).
 * A phase specifically 'blocked' still gets pulled out as a separate red attention badge
 * ("N blocked") next to the title, since that is a genuinely binary "needs attention" fact
 * the Remaining bucket's neutral color would otherwise hide.
 *
 * @param {HTMLElement} container
 * @param {Array<{status: string}>|null|undefined} phases - raw project_phases rows (only `.status` is read; `.name` is not required by this component)
 * @param {{title?: string|null, emptyTitle?: string, emptyCopy?: string}} [options]
 */
export function renderPhaseCompletion(container, phases, options = {}) {
  const rows = Array.isArray(phases) ? phases : [];
  const completed = rows.filter((row) => row.status === 'completed').length;
  const current = rows.filter((row) => row.status === 'current').length;
  const blocked = rows.filter((row) => row.status === 'blocked').length;
  const remaining = rows.length - completed - current;
  renderSegmentedBreakdown(container, {
    title: resolveTitle('Phase completion', options),
    groups: [
      { label: 'Completed', count: completed, tone: 'done' },
      { label: 'Current', count: current, tone: 'progress' },
      { label: 'Remaining', count: remaining, tone: 'neutral' },
    ],
    attention: blocked > 0 ? [{ label: `${blocked} blocked`, tone: 'error' }] : [],
    ariaLabel: `${completed} of ${rows.length} phases completed, ${current} current, ${remaining} remaining`,
    emptyTitle: options.emptyTitle || 'No verified data yet',
    emptyCopy: options.emptyCopy || 'E4LA has not published any project phases for this engagement yet.',
  });
}

/**
 * Milestone completion. Reads project_milestones.status for every milestone row passed in
 * (values: 'planned' | 'in_progress' | 'blocked' | 'completed' | 'cancelled' — see
 * migrations/0001_client_operations.sql). Renders all five states distinctly (per the
 * product owner's explicit ask), with 'blocked' additionally pulled into its own red
 * attention badge since it shares a bar color with 'cancelled' (both are de-emphasized
 * "closed"-tone segments) — the badge keeps it visible as a genuinely different, actionable
 * fact rather than relying on color alone.
 *
 * @param {HTMLElement} container
 * @param {Array<{status: string}>|null|undefined} milestones - raw project_milestones rows
 * @param {{title?: string|null, emptyTitle?: string, emptyCopy?: string}} [options]
 */
export function renderMilestoneCompletion(container, milestones, options = {}) {
  const rows = Array.isArray(milestones) ? milestones : [];
  const counts = countBy(rows, 'status');
  renderSegmentedBreakdown(container, {
    title: resolveTitle('Milestone completion', options),
    groups: [
      { label: 'Completed', count: counts.completed || 0, tone: 'done' },
      { label: 'In progress', count: counts.in_progress || 0, tone: 'progress' },
      { label: 'Planned', count: counts.planned || 0, tone: 'neutral' },
      { label: 'Cancelled', count: counts.cancelled || 0, tone: 'closed' },
      { label: 'Blocked', count: counts.blocked || 0, tone: 'closed' },
    ],
    attention: counts.blocked ? [{ label: `${counts.blocked} blocked`, tone: 'error' }] : [],
    emptyTitle: options.emptyTitle || 'No verified data yet',
    emptyCopy: options.emptyCopy || 'E4LA has not published any milestones for this engagement yet.',
  });
}

/**
 * Deliverables status. Reads deliverables.publication_status for every deliverable row
 * passed in (values: 'internal' | 'reviewed' | 'approved' | 'published' | 'withdrawn' — see
 * migrations/0001_client_operations.sql). No "blocked"-equivalent state exists on this
 * table, so no attention badge applies here.
 *
 * @param {HTMLElement} container
 * @param {Array<{publication_status: string}>|null|undefined} deliverables - raw deliverables rows
 * @param {{title?: string|null, emptyTitle?: string, emptyCopy?: string}} [options]
 */
export function renderDeliverablesStatus(container, deliverables, options = {}) {
  const rows = Array.isArray(deliverables) ? deliverables : [];
  const counts = countBy(rows, 'publication_status');
  renderSegmentedBreakdown(container, {
    title: resolveTitle('Deliverables status', options),
    groups: [
      { label: 'Published', count: counts.published || 0, tone: 'done' },
      { label: 'Approved', count: counts.approved || 0, tone: 'progress' },
      { label: 'Reviewed', count: counts.reviewed || 0, tone: 'review' },
      { label: 'Internal', count: counts.internal || 0, tone: 'neutral' },
      { label: 'Withdrawn', count: counts.withdrawn || 0, tone: 'closed' },
    ],
    emptyTitle: options.emptyTitle || 'No verified data yet',
    emptyCopy: options.emptyCopy || 'E4LA has not published any deliverables for this engagement yet.',
  });
}

function humanizeStatus(value) {
  return String(value || '').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatCents(cents, currency = 'usd') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase(), maximumFractionDigits: 0 }).format(Number(cents || 0) / 100);
}

// Quote/invoice status → existing .ops-status modifier class (or `null` for the unmodified
// neutral pill). This deliberately reuses the *existing* status-badge system already
// established in operations.css (ops-status--active/--complete = green "succeeded",
// ops-status--attention/--pending = amber "awaiting action", ops-status--error = red
// "needs attention") rather than inventing a new chart-coloring scheme for finance data -
// each row below renders as one individual status badge (the sanctioned use of green/red),
// never as a slice of a shared multi-category chart.
const QUOTE_STATUS_TONE = {
  sent: 'attention', viewed: 'attention',
  approved: 'complete', converted: 'complete',
  rejected: 'error', expired: 'error',
};
const INVOICE_STATUS_TONE = {
  sent: 'attention', viewed: 'attention',
  paid: 'complete',
  overdue: 'error',
};

function buildStatusBadgeList(rows, key, toneMap) {
  const counts = countBy(rows, key);
  const statuses = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
  const list = element('ul', 'ops-list');
  statuses.forEach((status) => {
    const li = element('li', 'ops-list__item');
    const tone = toneMap[status];
    li.append(
      textElement('span', humanizeStatus(status), `ops-status${tone ? ` ops-status--${tone}` : ''}`),
      textElement('span', String(counts[status]), 'rpt-legend__count'),
    );
    list.append(li);
  });
  return list;
}

function buildMoneyBar(paidCents, totalCents) {
  const wrap = element('div', 'rpt-money');
  const pct = totalCents > 0 ? Math.max(0, Math.min(100, (paidCents / totalCents) * 100)) : 0;
  const bar = element('div', 'rpt-money-bar');
  bar.setAttribute('role', 'img');
  bar.setAttribute('aria-label', `${formatCents(paidCents)} paid of ${formatCents(totalCents)} total`);
  const fill = element('span', 'rpt-money-bar__fill');
  fill.style.width = `${pct}%`;
  bar.append(fill);
  wrap.append(bar);
  const row = element('div', 'rpt-money-row');
  row.append(textElement('span', `${formatCents(paidCents)} paid`), textElement('span', `${formatCents(totalCents)} total`));
  wrap.append(row);
  return wrap;
}

/**
 * Financial status. Reporting/visualization only — this never mutates a quote or invoice;
 * it only summarizes rows the caller already fetched.
 *
 * DB source:
 *  - quotes.status (values: 'draft'|'prepared'|'sent'|'viewed'|'approved'|'rejected'|
 *    'expired'|'converted' — migrations/0005_service_catalog_and_quoting.sql)
 *  - invoices.status (values: 'draft'|'sent'|'viewed'|'paid'|'overdue'|'void'),
 *    invoices.total, invoices.amount_paid (migrations/0006_flexible_payments_and_invoicing.sql)
 *
 * Quote/invoice status counts render as individual reused .ops-status badges (see
 * QUOTE_STATUS_TONE/INVOICE_STATUS_TONE above) rather than a shared multi-category chart,
 * so 'overdue'/'paid' can honestly use the existing red/green semantic classes. The
 * amount_paid-vs-total bar is a single two-stop fill (paid vs. remaining), which is why it
 * uses --ops-gradient rather than TONE_HUE — it is not a categorical chart.
 *
 * @param {HTMLElement} container
 * @param {{quotes?: Array<{status: string}>, invoices?: Array<{status: string, total: number, amount_paid: number}>}|null|undefined} data
 * @param {{title?: string|null, emptyTitle?: string, emptyCopy?: string}} [options]
 */
export function renderFinancialStatus(container, data, options = {}) {
  const quotes = Array.isArray(data?.quotes) ? data.quotes : [];
  const invoices = Array.isArray(data?.invoices) ? data.invoices : [];
  container.replaceChildren();
  if (!quotes.length && !invoices.length) {
    renderChartEmptyState(container, {
      title: options.emptyTitle || 'No verified data yet',
      copy: options.emptyCopy || 'No quotes or invoices have been recorded for this client yet.',
    });
    return;
  }
  const wrap = element('div', 'rpt-chart');
  const title = resolveTitle('Financial status', options);
  if (title) wrap.append(textElement('h3', title, 'rpt-chart__title'));
  wrap.append(textElement('p', 'Reporting view only — figures reflect recorded quote and invoice data and cannot be changed from this view.', 'rpt-chart__note'));
  if (quotes.length) {
    wrap.append(textElement('h4', 'Quotes', 'rpt-chart__subtitle'));
    wrap.append(buildStatusBadgeList(quotes, 'status', QUOTE_STATUS_TONE));
  }
  if (invoices.length) {
    wrap.append(textElement('h4', 'Invoices', 'rpt-chart__subtitle'));
    wrap.append(buildStatusBadgeList(invoices, 'status', INVOICE_STATUS_TONE));
    const totalCents = invoices.reduce((sum, invoice) => sum + (Number(invoice.total) || 0), 0);
    const paidCents = invoices.reduce((sum, invoice) => sum + (Number(invoice.amount_paid) || 0), 0);
    wrap.append(buildMoneyBar(paidCents, totalCents));
  }
  container.append(wrap);
}

// content_items.status grouping (functions/_shared/content.js ALL_CONTENT_ITEM_STATUSES
// lists all 19 states). Rendering all 19 as equally-weighted slices would bury the handful
// that matter behind a wall of narrow, hard-to-read slivers - several are terminal or rare
// in practice (rejected, publishing_failed, withdrawn, archived). Grouped instead into the
// five stages a client or account lead actually thinks in, in pipeline order:
//   1. Drafting            - idea, researched, verified, drafting, design_ready
//                            (pre-review creation/ideation; nothing client-facing yet)
//   2. In review           - e4la_review, client_review, revision_requested
//                            (awaiting a decision from someone, internal or client)
//   3. Approved & scheduled - e4la_approved, approved, scheduled
//                            (cleared to go, not live yet)
//   4. Live                - publishing, published, verified_live
//                            (in flight or already live)
//   5. Closed out          - rejected, blocked, publishing_failed, withdrawn, archived
//                            (terminal or stalled - deliberately not part of the four-stage
//                            funnel's forward flow, and de-emphasized with the same
//                            "closed" tone used everywhere else in this file)
// 'blocked' is still called out separately as a red attention badge (see below) even
// though it lives in the Closed out bucket, since it is the one state in that bucket that
// is actionable/temporary rather than genuinely finished.
const CONTENT_LIFECYCLE_GROUPS = [
  { label: 'Drafting', tone: 'neutral', statuses: ['idea', 'researched', 'verified', 'drafting', 'design_ready'] },
  { label: 'In review', tone: 'review', statuses: ['e4la_review', 'client_review', 'revision_requested'] },
  { label: 'Approved & scheduled', tone: 'progress', statuses: ['e4la_approved', 'approved', 'scheduled'] },
  { label: 'Live', tone: 'done', statuses: ['publishing', 'published', 'verified_live'] },
  { label: 'Closed out', tone: 'closed', statuses: ['rejected', 'blocked', 'publishing_failed', 'withdrawn', 'archived'] },
];

/**
 * Content lifecycle. Reads content_items.status for every content item row passed in — see
 * functions/_shared/content.js's ALL_CONTENT_ITEM_STATUSES for the authoritative 19-state
 * list. Grouped into five pipeline stages; see CONTENT_LIFECYCLE_GROUPS above for the exact
 * mapping and reasoning.
 *
 * @param {HTMLElement} container
 * @param {Array<{status: string}>|null|undefined} items - raw content_items rows
 * @param {{title?: string|null, emptyTitle?: string, emptyCopy?: string}} [options]
 */
export function renderContentLifecycle(container, items, options = {}) {
  const rows = Array.isArray(items) ? items : [];
  const groups = CONTENT_LIFECYCLE_GROUPS.map((group) => ({
    label: group.label,
    tone: group.tone,
    count: rows.filter((row) => group.statuses.includes(row.status)).length,
  }));
  const blocked = rows.filter((row) => row.status === 'blocked').length;
  renderSegmentedBreakdown(container, {
    title: resolveTitle('Content lifecycle', options),
    groups,
    attention: blocked > 0 ? [{ label: `${blocked} blocked`, tone: 'error' }] : [],
    note: 'Grouped from the full 19-state content status field into five pipeline stages.',
    emptyTitle: options.emptyTitle || 'No verified data yet',
    emptyCopy: options.emptyCopy || 'E4LA has not recorded any content items for this client yet.',
  });
}

function svgEl(name, attrs = {}) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', name);
  Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, String(value)));
  return node;
}

let sparkSeq = 0;

// Straight-segment sparkline (no curve-fitting library - plain SVG, matching the rest of
// this codebase). Baseline is pinned to zero (min(0, ...values)) rather than the series'
// own minimum, so bar-like counts (jobs per period) read proportionally from a true zero
// rather than being visually exaggerated by an arbitrary axis start.
function buildSparkline(points, options = {}) {
  const width = Number(options.width) || 300;
  const height = Number(options.height) || 64;
  const padding = 6;
  const values = points.map((point) => Number(point.value));
  const min = Math.min(0, ...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const stepX = points.length > 1 ? (width - padding * 2) / (points.length - 1) : 0;
  const coords = points.map((point, index) => ({
    x: points.length > 1 ? padding + index * stepX : width / 2,
    y: height - padding - ((Number(point.value) - min) / span) * (height - padding * 2),
    label: point.label,
    value: point.value,
  }));

  sparkSeq += 1;
  const fillId = `rpt-spark-fill-${sparkSeq}`;
  const svg = svgEl('svg', {
    viewBox: `0 0 ${width} ${height}`, class: 'rpt-sparkline', preserveAspectRatio: 'none',
    role: 'img', 'aria-label': `Trend across ${points.length} recorded data point${points.length === 1 ? '' : 's'}`,
  });
  const defs = svgEl('defs');
  const gradient = svgEl('linearGradient', { id: fillId, x1: '0', y1: '0', x2: '0', y2: '1' });
  gradient.append(
    svgEl('stop', { offset: '0%', 'stop-color': 'var(--ops-purple)', 'stop-opacity': '0.35' }),
    svgEl('stop', { offset: '100%', 'stop-color': 'var(--ops-purple)', 'stop-opacity': '0' }),
  );
  defs.append(gradient);
  svg.append(defs);

  const lineStr = coords.map((coord) => `${coord.x},${coord.y}`).join(' ');
  if (coords.length > 1) {
    const areaStr = `${coords[0].x},${height - padding} ${lineStr} ${coords[coords.length - 1].x},${height - padding}`;
    svg.append(svgEl('polygon', { points: areaStr, class: 'rpt-sparkline__area', fill: `url(#${fillId})` }));
    svg.append(svgEl('polyline', { points: lineStr, class: 'rpt-sparkline__line' }));
  }
  coords.forEach((coord) => {
    const dot = svgEl('circle', { cx: coord.x, cy: coord.y, r: coords.length > 1 ? 2.5 : 4, class: 'rpt-sparkline__dot' });
    const title = svgEl('title');
    title.textContent = `${coord.label ?? ''}: ${coord.value}`;
    dot.append(title);
    svg.append(dot);
  });
  return svg;
}

// publishing_jobs.status → TONE_HUE mapping. 'failed' shares the 'closed' (muted) bar tone
// with nothing else here, but is additionally called out as a red attention badge (see
// renderPublishingTrend) since a failed publish is a genuinely binary "needs attention" fact.
const PUBLISHING_JOB_GROUPS = [
  { key: 'queued', label: 'Queued', tone: 'neutral' },
  { key: 'submitted', label: 'Submitted', tone: 'review' },
  { key: 'verification_pending', label: 'Verification pending', tone: 'caution' },
  { key: 'published', label: 'Published', tone: 'done' },
  { key: 'verified_live', label: 'Verified live', tone: 'done' },
  { key: 'failed', label: 'Failed', tone: 'closed' },
];

/**
 * Publishing / activity trend. Renders up to two independent sections, each only if its
 * own data is present:
 *  - a status-mix breakdown from publishing_jobs.status (values: 'queued'|'submitted'|
 *    'published'|'verification_pending'|'verified_live'|'failed' —
 *    migrations/0009_publishing_and_metrics.sql)
 *  - a sparkline from a caller-supplied, already-aggregated time series (`data.series`),
 *    meant to be built by the caller from publishing_jobs grouped by submitted_at/
 *    published_at, and/or from content_metrics.metric_value (captured_at) - metric_value is
 *    stored as free-form TEXT keyed by metric_key, so parsing/aggregating it into a numeric
 *    {label, value} point is caller responsibility, not this pure render function's.
 *
 * The sparkline is always captioned with exactly how many real data points it reflects, so
 * it can never be mistaken for a projected or estimated trend line.
 *
 * @param {HTMLElement} container
 * @param {{jobs?: Array<{status: string}>, series?: Array<{label: string, value: number}>}|null|undefined} data
 * @param {{title?: string|null, emptyTitle?: string, emptyCopy?: string, sparkline?: {width?: number, height?: number}}} [options]
 */
export function renderPublishingTrend(container, data, options = {}) {
  const jobs = Array.isArray(data?.jobs) ? data.jobs : [];
  const series = Array.isArray(data?.series)
    ? data.series.filter((point) => point && typeof point.value === 'number' && Number.isFinite(point.value))
    : [];
  container.replaceChildren();
  if (!jobs.length && !series.length) {
    renderChartEmptyState(container, {
      title: options.emptyTitle || 'No verified data yet',
      copy: options.emptyCopy || 'No publishing jobs or performance metrics have been recorded for this client yet.',
    });
    return;
  }
  const wrap = element('div', 'rpt-chart');
  const title = resolveTitle('Publishing activity', options);
  if (title) wrap.append(textElement('h3', title, 'rpt-chart__title'));

  if (jobs.length) {
    const counts = countBy(jobs, 'status');
    const groups = PUBLISHING_JOB_GROUPS.map((group) => ({ label: group.label, tone: group.tone, count: counts[group.key] || 0 }));
    const failed = counts.failed || 0;
    wrap.append(buildSegmentedBreakdown({
      groups,
      attention: failed > 0 ? [{ label: `${failed} failed`, tone: 'error' }] : [],
      ariaLabel: groups.map((group) => `${group.count} ${group.label}`).join(', '),
    }));
  }

  if (series.length) {
    const sparkWrap = element('div', 'rpt-sparkline-wrap');
    sparkWrap.append(buildSparkline(series, options.sparkline));
    const axis = element('div', 'rpt-sparkline__axis');
    axis.append(textElement('span', series[0].label ?? ''), textElement('span', series[series.length - 1].label ?? ''));
    sparkWrap.append(axis);
    sparkWrap.append(textElement(
      'p',
      `Reflects ${series.length} recorded data point${series.length === 1 ? '' : 's'} only — no projected or estimated values.`,
      'rpt-chart__note',
    ));
    wrap.append(sparkWrap);
  }

  container.append(wrap);
}

// --- Shared DOM helpers (private) ---------------------------------------------------
// Deliberately match the element()/textElement() convention already used identically in
// both admin.js and client-portal.js, so this file reads as the same codebase rather than
// a foreign style. Kept private/unexported - this file's public surface is exactly the
// eight renderX()/renderChartEmptyState() functions documented above.
function element(tag, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function textElement(tag, text, className) {
  const node = element(tag, className);
  node.textContent = text;
  return node;
}
