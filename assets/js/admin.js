import { demoStateFromUrl, formatMoney, isSafeProductPreview, sampleAdmin } from './ops-model.js';
import { renderRoadmap } from './roadmap.js';
import {
  renderChartEmptyState, renderProgressRing, renderPhaseCompletion, renderMilestoneCompletion,
  renderFinancialStatus, renderContentLifecycle,
} from './reporting-charts.js';

const isPreview = isSafeProductPreview();
let adminData = null;
let csrfToken = '';
let currentAgreementId = '';
let allContentItems = [];
// Admin nav consolidation lookup tables (see activateView()'s own comment further down
// for full context) - declared here, not next to their usage, for the same reason
// PROJECT_AUTOFILL_TARGETS is: render()/boot() run at module load and would otherwise
// reference these before their own declaration line executes.
const STANDALONE_PANEL_ID = { dashboard: 'admin-dashboard', settings: 'admin-settings' };
const PANEL_ID_BY_TAB = {
  'projects:overview': 'admin-projects-overview',
  'projects:clients': 'admin-clients',
  'projects:services': 'admin-services',
  'projects:quotes': 'admin-quotes',
  'projects:agreements': 'admin-agreements',
  'projects:details': 'admin-projects',
  'content:content': 'admin-content',
  'content:calendar': 'admin-calendar',
  'content:approvals': 'admin-approvals',
  'content:publishing': 'admin-publishing',
  'content:analytics': 'admin-content-analytics',
  'payments:overview': 'admin-payments-overview',
  'payments:invoices': 'admin-invoices',
  'payments:recurring': 'admin-payments',
  'activity:feed': 'admin-activity',
  'activity:portals': 'admin-portals',
};
const FLAT_VIEW_ALIASES = {
  dashboard: 'dashboard', settings: 'settings',
  clients: 'projects:clients', services: 'projects:services', quotes: 'projects:quotes',
  agreements: 'projects:agreements', projects: 'projects:overview', progress: 'projects:details',
  invoices: 'payments:invoices', payments: 'payments:recurring', 'payments-overview': 'payments:overview',
  content: 'content:content', calendar: 'content:calendar', approvals: 'content:approvals',
  publishing: 'content:publishing', 'content-analytics': 'content:analytics',
  portals: 'activity:portals', activity: 'activity:feed',
};
const FLAT_VIEW_BY_COMPOSITE = Object.fromEntries(Object.entries(FLAT_VIEW_ALIASES).map(([flat, composite]) => [composite, flat]));

let servicesCache = [];
let quotePickersWired = false;
// Client-select -> auto-derived Project-display targets (see updateProjectAutofillDisplay
// below) - declared here, not next to its usage, because render() runs at module load via
// boot() and would otherwise reference this `const` before its own line executes (a real
// "Cannot access before initialization" crash found and fixed during this pass).
const PROJECT_AUTOFILL_TARGETS = [
  ['agreement-create-client', 'agreement-create-project-display', 'agreement-create-project-id'],
  ['project-item-client-select', 'project-item-project-display', 'project-item-project-id'],
  ['publication-client-select', 'publication-project-display', 'publication-project-id'],
  ['phase-client-select', 'phase-project-display', 'phase-project-id'],
  ['snapshot-client-select', 'snapshot-project-display', 'snapshot-project-id'],
  ['metric-client-select', 'metric-project-display', 'metric-project-id'],
  ['invoice-create-client', 'invoice-create-project-display', 'invoice-create-project-id'],
  ['content-plan-client', 'content-plan-project-display', 'content-plan-project-id'],
];

// Fictional preview-only service catalog and per-client quotes, used only when
// isSafeProductPreview() is true - mirrors DEMO_PROGRESS_BY_PROJECT below: no live
// database to read services/quotes from on that host, so the Quotes panel's new
// Service/Quote pickers still have something real to show while exercising this file's
// own code (loadServices()/loadClientQuotes() below fetch these real endpoints in every
// other environment).
const DEMO_SERVICES = [
  { id: 'svc_demo_seo', name: 'Technical SEO Audit', default_price: 120000, pricing_type: 'fixed' },
  { id: 'svc_demo_content', name: 'Content & Local SEO Buildout', default_price: 180000, pricing_type: 'fixed' },
  { id: 'svc_demo_gbp', name: 'Google Business Profile Optimization', default_price: 60000, pricing_type: 'fixed' },
];
const DEMO_QUOTES_BY_CLIENT = {
  client_demo_a: [{ id: 'quo_demo_a1', status: 'prepared', created_at: '2026-08-10T00:00:00Z' }],
  client_demo_b: [{ id: 'quo_demo_b1', status: 'draft', created_at: '2026-08-20T00:00:00Z' }],
};

// -------------------------------------------------------------------------------------
// Fictional preview-only roadmap data for the Progress panel and the Unified Client
// Record's Progress sub-section, used only when isSafeProductPreview() is true (there is
// no live database to read project_phases/project_milestones/deliverables from on that
// host). Kept local to admin.js rather than added to the shared assets/js/ops-model.js
// fixture - ops-model.js also backs client-portal.js, which a separate concurrent pass
// owns, and this data exists only to demonstrate this file's own Roadmap/reporting-chart
// integration in isolation. Field names match the real project_phases/project_milestones
// columns documented in assets/js/roadmap.js's own usage comment, not an invented shape.
// Two of the four sampleAdmin clients (client_demo_b, client_demo_d) intentionally have no
// entry here, so the Roadmap/chart empty states are also exercised in preview mode rather
// than only ever showing populated data.
// -------------------------------------------------------------------------------------
const DEMO_PROGRESS_BY_PROJECT = {
  prj_demo_a: {
    phases: [
      { id: 'phase_demo_a1', project_id: 'prj_demo_a', name: 'Foundation & Visibility', sequence: 1, status: 'completed', target_start_date: '2026-07-01', target_end_date: '2026-07-28', client_action_required: 0, client_action_note: null, publication_status: 'published' },
      { id: 'phase_demo_a2', project_id: 'prj_demo_a', name: 'Content & Local SEO Buildout', sequence: 2, status: 'current', target_start_date: '2026-07-29', target_end_date: '2026-08-25', client_action_required: 1, client_action_note: 'Approve the homepage messaging proof.', publication_status: 'published' },
      { id: 'phase_demo_a3', project_id: 'prj_demo_a', name: 'Reporting & Handoff', sequence: 3, status: 'upcoming', target_start_date: null, target_end_date: null, client_action_required: 0, client_action_note: null, publication_status: 'published' },
    ],
    milestones: [
      { id: 'ms_demo_a1', title: 'Technical SEO audit delivered', description: '', status: 'completed', target_date: '2026-07-20', completed_at: '2026-07-19', phase_id: 'phase_demo_a1' },
      { id: 'ms_demo_a2', title: 'Google Business Profile optimization', description: '', status: 'completed', target_date: '2026-07-26', completed_at: '2026-07-25', phase_id: 'phase_demo_a1' },
      { id: 'ms_demo_a3', title: 'Homepage messaging proof', description: '', status: 'in_progress', target_date: '2026-08-10', completed_at: null, phase_id: 'phase_demo_a2' },
      { id: 'ms_demo_a4', title: 'Local landing pages published', description: '', status: 'planned', target_date: '2026-08-20', completed_at: null, phase_id: 'phase_demo_a2' },
    ],
    deliverables: [
      { id: 'del_demo_a1', title: 'Technical SEO Audit Report', phase_id: 'phase_demo_a1' },
    ],
  },
  prj_demo_c: {
    phases: [
      { id: 'phase_demo_c1', project_id: 'prj_demo_c', name: 'Kickoff & Discovery', sequence: 1, status: 'blocked', target_start_date: '2026-08-01', target_end_date: '2026-08-15', client_action_required: 0, client_action_note: null, publication_status: 'published' },
    ],
    milestones: [
      { id: 'ms_demo_c1', title: 'Payment reconciliation', description: '', status: 'blocked', target_date: '2026-08-05', completed_at: null, phase_id: 'phase_demo_c1' },
    ],
    deliverables: [],
  },
};

boot();

async function boot() {
  try {
    if (isPreview) {
      document.querySelector('#fictional-preview').hidden = false;
      document.querySelector('#admin-data-label').textContent = 'Fictional preview data';
      adminData = structuredClone(sampleAdmin); applyDemoState(adminData, demoStateFromUrl());
    } else {
      const session = await ensureSession(); csrfToken = session.csrfToken;
      if (!['e4la_admin','e4la_collaborator'].includes(session.role)) throw new Error('Server-backed E4LA admin authentication is required.');
      adminData = normalizeAdmin(await api('/api/ops/admin/summary'));
      document.querySelector('#admin-environment').textContent = 'Preview · authenticated';
      document.querySelector('#admin-signout').hidden = false;
    }
    render(adminData); activateView(location.hash.replace('#', '') || 'dashboard', false);
    loadContentIntelligence();
  } catch (error) { renderFatal(error.message || 'Server-backed authentication must be configured before this interface can be used.'); }
}

async function ensureSession() { try { return await api('/api/ops/session'); } catch { return api('/api/ops/auth/admin', { method: 'POST', body: '{}' }); } }

document.querySelector('#admin-signout').addEventListener('click', async () => {
  try {
    await api('/api/ops/session/logout', { method: 'POST', headers: { 'X-CSRF-Token': csrfToken }, body: '{}' });
  } finally {
    location.assign('/cdn-cgi/access/logout');
  }
});

function render(data) {
  renderKpis(data.counts); renderActions(data.clients); renderMilestones(data.milestones || []);
  renderClientRows('admin-recent-clients', data.clients); renderClientRows('admin-client-table', data.clients, true);
  renderLifecycleTable('admin-agreement-table', data.clients, 'agreement'); renderLifecycleTable('admin-project-table', data.clients, 'project');
  renderPayments(data.clients); renderActivity(data.activity || []); renderPreviewClients(data.clients); renderProgressClientSelect(data.clients);
  renderQuoteClientPickers(data.clients);
  populateCalendarClientFilter();
  renderDashboardProgressSummary(data.clients);
  if (!data.clients.length) {
    document.querySelector('#admin-recent-clients').closest('.ops-card').replaceChildren(emptyState('No clients yet', 'Create the first fictional preview client to validate the operational workflow.'));
  }
}

// -------------------------------------------------------------------------------------
// Dashboard progress summary: a compact card (not the full roadmap component) showing
// real client/phase/milestone data for the same default client the global Progress tab
// itself defaults to (clients[0] - see renderProgressClientSelect/loadGlobalProgress),
// reusing the same loadProgressData() this file already uses for the Progress tab and
// the Unified Client Record. No numbers here are invented: if loadProgressData returns
// nothing (no published roadmap yet), this renders the same honest empty state pattern
// used throughout this file rather than fabricating a status.
// -------------------------------------------------------------------------------------
async function renderDashboardProgressSummary(clients) {
  const container = document.querySelector('#dashboard-progress-summary');
  const status = document.querySelector('#dashboard-progress-status');
  if (!container) return;
  const client = clients[0];
  if (!client) { container.replaceChildren(emptyState('No clients yet', 'A compact progress summary will appear here once a client and project exist.')); if (status) status.textContent = '—'; return; }
  if (status) status.textContent = client.name;
  const data = await loadProgressData(client);
  container.replaceChildren();
  if (!data || !(data.phases || []).length) { container.append(emptyState('No published progress yet', `E4LA has not published roadmap progress for ${client.name}.`)); return; }
  const currentPhases = data.phases.filter((phase) => phase.status === 'current');
  const upcomingMilestones = (data.milestones || []).filter((milestone) => ['planned', 'in_progress'].includes(milestone.status)).slice(0, 3);
  const grid = element('div', 'client-detail-grid');
  [
    ['Client', client.name],
    ['Current phase', currentPhases.length ? currentPhases.map((phase) => phase.name).join(', ') : 'No phase currently active'],
    ['Overall progress', data.percentComplete != null ? `${data.percentComplete}%` : 'Not available'],
  ].forEach(([label, value]) => { const card = element('div', 'client-detail-item'); card.append(textElement('span', label), textElement('strong', value)); grid.append(card); });
  container.append(grid);
  if (upcomingMilestones.length) {
    const list = element('ul', 'ops-list ops-mt-18');
    upcomingMilestones.forEach((milestone) => { const li = element('li', 'ops-list__item'); const copy = document.createElement('div'); copy.append(textElement('p', milestone.title, 'ops-list__title'), textElement('p', `${client.name} · upcoming milestone`, 'ops-list__meta')); li.append(copy, textElement('time', milestone.target_date ? formatDate(milestone.target_date) : 'Date pending', 'ops-status')); list.append(li); });
    container.append(list);
  }
}
document.querySelector('#dashboard-progress-link')?.addEventListener('click', () => activateView('progress'));

function renderKpis(counts) {
  const container = document.querySelector('#admin-kpis'); container.replaceChildren();
  [['Active clients', counts.activeClients, 'Current engagements', 'clients'], ['Awaiting signature', counts.awaitingSignature, 'Follow-up required', 'agreements'], ['Awaiting payment', counts.awaitingPayment, 'Webhook-authoritative', 'payments'], ['Actions required', counts.actionsRequired, 'Client + E4LA', 'dashboard']].forEach(([label, value, note, view]) => {
    const card = element('button', 'ops-card ops-kpi'); card.type = 'button'; card.setAttribute('aria-label', `${label}: ${value}. Open ${view}.`); card.append(textElement('span', label, 'ops-kpi__label'), textElement('strong', String(value), 'ops-kpi__value'), textElement('span', note, 'ops-kpi__note')); card.addEventListener('click', () => activateView(view)); container.append(card);
  });
}

function renderActions(clients) {
  const container = document.querySelector('#admin-actions'); container.replaceChildren();
  clients.filter((client) => client.action && client.action !== 'None').slice(0, 5).forEach((client) => {
    const li = element('li', 'ops-list__item'); const copy = document.createElement('div'); copy.append(textElement('p', client.action, 'ops-list__title'), textElement('p', `${client.name} · ${client.lifecycle}`, 'ops-list__meta'));
    const action = textElement('button', 'Review', 'ops-link-button'); action.type = 'button'; action.addEventListener('click', () => openClientDetail(client)); li.append(copy, action); container.append(li);
  });
  if (!container.children.length) container.append(emptyState('Nothing needs attention', 'All currently visible client operations are clear.'));
}

function renderMilestones(items) {
  const container = document.querySelector('#admin-milestones'); container.replaceChildren();
  items.forEach((item) => { const li = element('li', 'ops-list__item'); const copy = document.createElement('div'); copy.append(textElement('p', item.title, 'ops-list__title'), textElement('p', item.client, 'ops-list__meta')); li.append(copy, textElement('time', item.date, 'ops-status')); container.append(li); });
  if (!items.length) container.append(emptyState('No published milestones due', 'Upcoming client-facing milestones will appear here.'));
}

function renderClientRows(id, clients, includePortal = false) {
  const tbody = document.getElementById(id); tbody.replaceChildren();
  clients.forEach((client) => {
    const row = document.createElement('tr'); row.tabIndex = 0; row.setAttribute('role', 'button'); row.setAttribute('aria-label', `Open ${client.name}`);
    [client.name, client.lifecycle, ...(includePortal ? [client.project] : []), client.agreement, client.payment, ...(includePortal ? [client.portal || 'Not active'] : [client.action])].forEach((value) => row.append(textElement('td', value)));
    row.addEventListener('click', () => openClientDetail(client)); row.addEventListener('keydown', (event) => { if (['Enter',' '].includes(event.key)) { event.preventDefault(); openClientDetail(client); } }); tbody.append(row);
  });
  if (!clients.length) { const row = document.createElement('tr'); const cell = textElement('td', 'No clients match this view.', 'admin-table__empty'); cell.colSpan = includePortal ? 6 : 5; row.append(cell); tbody.append(row); }
}

function renderPayments(clients) {
  const tbody = document.querySelector('#admin-payment-table'); tbody.replaceChildren();
  clients.forEach((client) => { const row = document.createElement('tr'); [client.name, client.plan || 'Not selected', client.payment, formatMoney(client.paid || 0), formatMoney(client.total || 0), client.nextPayment || '—'].forEach((value) => row.append(textElement('td', value))); tbody.append(row); });
}

function renderLifecycleTable(id, clients, kind) {
  const tbody = document.getElementById(id); tbody.replaceChildren();
  clients.forEach((client) => { const row = document.createElement('tr'); const values = kind === 'agreement'
    ? [client.name, client.project, client.agreement, client.payment, client.action]
    : [client.name, client.project, client.lifecycle, client.portal || 'Not active', client.action]; values.forEach((value) => row.append(textElement('td', value || '—'))); row.tabIndex = 0; row.setAttribute('role', 'button'); row.addEventListener('click', () => openClientDetail(client)); row.addEventListener('keydown', (event) => { if (['Enter',' '].includes(event.key)) { event.preventDefault(); openClientDetail(client); } }); tbody.append(row); });
  if (!clients.length) { const row = document.createElement('tr'); const cell = textElement('td', `No ${kind} records yet.`, 'admin-table__empty'); cell.colSpan = 5; row.append(cell); tbody.append(row); }
}

function renderActivity(items) {
  const list = document.querySelector('#admin-activity-list'); list.replaceChildren();
  items.forEach((item) => { const li = element('li', 'ops-list__item'); const copy = document.createElement('div'); copy.append(textElement('p', humanize(item.type), 'ops-list__title'), textElement('p', `${item.client || 'System'} · ${item.detail || 'Operational event'}`, 'ops-list__meta')); li.append(copy, textElement('time', item.date || 'Recently', 'ops-status')); list.append(li); });
  if (!items.length) list.append(emptyState('No recent activity', 'Append-only audit events will appear here after authorized activity.'));
}

function renderPreviewClients(clients) {
  const select = document.querySelector('#preview-client-select'); select.replaceChildren();
  clients.forEach((client) => { const option = document.createElement('option'); option.value = client.id; option.textContent = client.name; select.append(option); });
  updatePreviewLink(); select.addEventListener('change', updatePreviewLink);
}

// -------------------------------------------------------------------------------------
// Progress panel + Unified Client Record: Roadmap (assets/js/roadmap.js) and the
// progress-ring/phase-completion/milestone-completion charts (assets/js/reporting-
// charts.js), fed from GET /api/ops/admin/preview/:clientId - an existing, already-
// authenticated admin/collaborator endpoint (see functions/api/ops/[[path]].js's
// adminPreview handler) that today is only ever called by client-portal.js's own
// admin-preview-as-client mode. It returns the same loadPortalData() payload the client
// portal itself receives - real, already-published-only phases/milestones/deliverables -
// so reusing it here needs no new backend route.
//
// One real gap: that payload's `roadmap` field is a pre-aggregated per-phase summary
// (camelCase: targetStartDate, clientActionRequired, milestoneCount...), not the raw
// project_phases rows renderRoadmap()'s documented contract expects (snake_case:
// target_start_date, client_action_required, publication_status...). There is no admin
// endpoint that returns raw phase rows. mapPortalToProgressData() below renames those
// fields 1:1 from the real aggregated values (nothing invented) to satisfy the contract;
// `publication_status: 'published'` is likewise a real fact, not a guess - loadPortalData's
// own phases query only ever selects rows already filtered to publication_status =
// 'published'. Deliverables come back the same way (no phase_id, no publication_status
// column selected) - since none can be linked to a phase, roadmap.js correctly renders
// them under no phase at all, exactly as its own contract comment describes.
// -------------------------------------------------------------------------------------

async function loadProgressData(client) {
  if (!client) return null;
  if (isPreview) {
    const demo = DEMO_PROGRESS_BY_PROJECT[client.projectId];
    if (!demo) return null;
    return { phases: demo.phases, milestones: demo.milestones, deliverables: demo.deliverables, percentComplete: demoPercentComplete(demo.milestones) };
  }
  try {
    const result = await api(`/api/ops/admin/preview/${encodeURIComponent(client.id)}`);
    return mapPortalToProgressData(result.portal);
  } catch { return null; }
}

function demoPercentComplete(milestones) {
  if (!milestones.length) return null;
  return Math.round((milestones.filter((item) => item.status === 'completed').length / milestones.length) * 100);
}

function mapPortalToProgressData(portal) {
  if (!portal?.project) return null;
  const projectId = portal.project.id;
  const phases = (portal.roadmap || []).map((phase) => ({
    id: phase.id, project_id: projectId, name: phase.name, sequence: phase.sequence, status: phase.status,
    target_start_date: phase.targetStartDate, target_end_date: phase.targetEndDate,
    client_action_required: phase.clientActionRequired ? 1 : 0, client_action_note: phase.clientActionNote,
    publication_status: 'published',
  }));
  return { phases, milestones: portal.milestones || [], deliverables: portal.deliverables || [], percentComplete: portal.progress?.percentComplete ?? null };
}

// Renders into whichever of the four mount points are present (the global Progress panel
// has all four; the Unified Client Record's compact Progress card omits the roadmap mount
// by choice in some layouts, so `mounts.roadmap` etc. are checked rather than assumed).
// Every renderX() call below already renders its own honest empty state when its data is
// absent/empty, so `data` being null just means every mount is handed an empty array.
function renderProgressCharts(mounts, data) {
  if (mounts.ring) renderProgressRing(mounts.ring, data ? { percentComplete: data.percentComplete, label: 'Overall progress' } : null, { emptyCopy: 'E4LA has not published progress data for this client yet.' });
  if (mounts.phase) renderPhaseCompletion(mounts.phase, data?.phases || []);
  if (mounts.milestone) renderMilestoneCompletion(mounts.milestone, data?.milestones || []);
  if (mounts.roadmap) renderRoadmap(mounts.roadmap, { phases: data?.phases || [], milestones: data?.milestones || [], deliverables: data?.deliverables || [] }, { audience: 'admin' });
}

function renderProgressClientSelect(clients) {
  const select = document.querySelector('#progress-client-select'); if (!select) return;
  const previous = select.value;
  select.replaceChildren();
  clients.forEach((client) => { const option = document.createElement('option'); option.value = client.id; option.textContent = client.name; select.append(option); });
  if (clients.some((client) => client.id === previous)) select.value = previous;
  loadGlobalProgress(clients.find((client) => client.id === select.value) || clients[0]);
}
document.querySelector('#progress-client-select')?.addEventListener('change', (event) => {
  loadGlobalProgress((adminData?.clients || []).find((client) => client.id === event.target.value));
});
async function loadGlobalProgress(client) {
  const mounts = {
    ring: document.querySelector('#progress-ring-chart'), phase: document.querySelector('#progress-phase-chart'),
    milestone: document.querySelector('#progress-milestone-chart'), roadmap: document.querySelector('#progress-roadmap-container'),
  };
  if (!mounts.roadmap) return;
  renderProgressCharts(mounts, await loadProgressData(client));
}

function updatePreviewLink() {
  const clientId = document.querySelector('#preview-client-select').value; const link = document.querySelector('#admin-preview-link');
  link.href = isPreview ? `/client-portal/?demo=1&preview=admin&client=${encodeURIComponent(clientId)}` : `/client-portal/?preview=admin&client=${encodeURIComponent(clientId)}`;
}

function openClientDetail(client) {
  activateView('clients'); const panel = document.querySelector('#admin-client-detail'); panel.hidden = false; setText('client-detail-title', client.name);
  const content = document.querySelector('#client-detail-content'); content.replaceChildren();
  [['Lifecycle', client.lifecycle], ['Current project', client.project], ['Agreement', client.agreement], ['Payment', client.payment], ['Portal', client.portal || 'Not active'], ['Next action', client.action || 'None']].forEach(([label, value]) => { const card = element('div', 'client-detail-item'); card.append(textElement('span', label), textElement('strong', value)); content.append(card); });
  const actions = element('div', 'client-detail-actions'); const preview = textElement('a', 'ADMIN PREVIEW — Client View', 'ops-button ops-button--secondary'); preview.href = isPreview ? `/client-portal/?demo=1&preview=admin&client=${encodeURIComponent(client.id)}` : `/client-portal/?preview=admin&client=${encodeURIComponent(client.id)}`;
  const edit = textElement('button', 'Edit client profile', 'ops-button ops-button--secondary'); edit.type = 'button'; edit.addEventListener('click', () => showClientEdit(client, content)); actions.append(preview, edit); content.append(actions); panel.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
  loadClientDetailSections(client);
}

// -------------------------------------------------------------------------------------
// Unified client record - the sub-sections below turn the Client Detail panel into the
// operational center for one client: everything either reuses/links to an existing
// global panel (Services, Agreement, Projects, Progress, Portal), reuses already-fetched
// data (Activity), or fetches the client-scoped commerce/content list endpoints directly.
// -------------------------------------------------------------------------------------

function sectionCard(title, note, surfaceClass) {
  const card = element('section', ['ops-card', 'ops-card__body', surfaceClass].filter(Boolean).join(' ')); const head = element('div', 'dashboard-card-title'); head.append(textElement('h3', title));
  if (note) head.append(textElement('span', note, 'ops-status'));
  const body = element('div', 'client-section-body'); card.append(head, body); return card;
}

function buildContactsSection() {
  const card = sectionCard('Contacts', 'Not yet available');
  card.querySelector('.client-section-body').append(textElement('p', 'Contact management (the client_users table — owners, authorized signers, viewers) is not exposed by any admin API endpoint yet. Adding this would require a new backend route, which is out of scope for this UX pass.', 'ops-hint'));
  return card;
}

function buildServicesSection() {
  const card = sectionCard('Services');
  const body = card.querySelector('.client-section-body'); body.append(textElement('p', 'Services are shared across every client — there is no per-client service list to maintain.', 'ops-hint'));
  const button = textElement('button', 'View service catalog', 'ops-link-button'); button.type = 'button'; button.addEventListener('click', () => activateView('services')); body.append(button);
  return card;
}

function buildAgreementSection(client) {
  const card = sectionCard('Agreement', client.agreement);
  const body = card.querySelector('.client-section-body'); body.append(textElement('p', `Status: ${client.agreement}. Client-signed evidence is immutable once sent.`, 'ops-hint'));
  const button = textElement('button', 'Open in Agreements panel', 'ops-link-button'); button.type = 'button';
  button.addEventListener('click', () => { const form = document.querySelector('#agreement-create-form'); if (form) { form.elements.clientId.value = client.id; form.elements.clientId.dispatchEvent(new Event('change')); } activateView('agreements'); });
  body.append(button); return card;
}

function buildProjectsSection(client) {
  const card = sectionCard('Projects', client.project);
  const body = card.querySelector('.client-section-body'); body.append(textElement('p', `Current project: ${client.project}.`, 'ops-hint'));
  const button = textElement('button', 'Open Projects panel', 'ops-link-button'); button.type = 'button'; button.addEventListener('click', () => activateView('projects')); body.append(button);
  return card;
}

function buildProgressSection(client) {
  const card = sectionCard('Progress', null, 'admin-surface-accent');
  const body = card.querySelector('.client-section-body'); body.append(textElement('p', 'Roadmap phases, weekly snapshots, and performance metrics for this client’s project.', 'ops-hint'));
  const chartsRow = element('div', 'ops-grid ops-grid--3 client-progress-charts');
  const ringMount = element('div', 'client-progress-ring'); const phaseMount = element('div', 'client-progress-phases'); const milestoneMount = element('div', 'client-progress-milestones');
  chartsRow.append(ringMount, phaseMount, milestoneMount); body.append(chartsRow);
  body.append(element('div', 'client-progress-roadmap ops-mt-18'));
  const button = textElement('button', 'Open Progress panel', 'ops-link-button'); button.type = 'button';
  button.addEventListener('click', () => { if (client.projectId) { ['#phase-client-select', '#snapshot-client-select', '#metric-client-select'].forEach((selector) => { const select = document.querySelector(selector); if (select) { select.value = client.id; select.dispatchEvent(new Event('change')); } }); } activateView('progress'); });
  body.append(button); return card;
}

async function loadClientProgress(client, container) {
  const mounts = {
    ring: container.querySelector('.client-progress-ring'), phase: container.querySelector('.client-progress-phases'),
    milestone: container.querySelector('.client-progress-milestones'), roadmap: container.querySelector('.client-progress-roadmap'),
  };
  if (!mounts.roadmap) return;
  renderProgressCharts(mounts, await loadProgressData(client));
}

function buildPortalSection(client) {
  const card = sectionCard('Portal', client.portal || 'Not active');
  const body = card.querySelector('.client-section-body'); body.append(textElement('p', 'Preview this client’s exact client-visible portal state, or manage its activation policy.', 'ops-hint'));
  const button = textElement('button', 'Open Portals panel', 'ops-link-button'); button.type = 'button';
  button.addEventListener('click', () => { const select = document.querySelector('#preview-client-select'); if (select) { select.value = client.id; updatePreviewLink(); } if (client.enrollmentId) { const clientSelect = document.querySelector('#activation-client-select'); if (clientSelect) { clientSelect.value = client.id; clientSelect.dispatchEvent(new Event('change')); } } activateView('portals'); });
  body.append(button); return card;
}

function buildActivitySection(client) {
  const card = sectionCard('Activity', 'From the global audit feed');
  const body = card.querySelector('.client-section-body');
  const items = (adminData?.activity || []).filter((item) => item.client === client.name).slice(0, 10);
  if (!items.length) { body.append(emptyState('No recent activity for this client', 'Append-only audit events for this client will appear here.')); return card; }
  const list = element('ul', 'ops-list');
  items.forEach((item) => { const li = element('li', 'ops-list__item'); const copy = document.createElement('div'); copy.append(textElement('p', humanize(item.type), 'ops-list__title'), textElement('p', item.detail || 'Recorded operational event', 'ops-list__meta')); li.append(copy, textElement('time', item.date, 'ops-status')); list.append(li); });
  body.append(list); return card;
}

function buildLoadingCard(title, note) {
  const card = sectionCard(title, note); card.querySelector('.client-section-body').append(textElement('p', 'Loading…', 'ops-hint')); return card;
}

function renderQuotesCard(card, quotes, client) {
  const body = card.querySelector('.client-section-body'); body.replaceChildren();
  if (!quotes.length) body.append(emptyState('No quotes yet', 'Create a quote for this client from the Quotes panel.'));
  else {
    const list = element('ul', 'ops-list');
    quotes.forEach((quote) => { const li = element('li', 'ops-list__item'); const copy = document.createElement('div'); copy.append(textElement('p', quote.id, 'ops-list__title'), textElement('p', `Created ${formatDate(quote.created_at)}`, 'ops-list__meta')); li.append(copy, textElement('span', humanize(quote.status), 'ops-status')); list.append(li); });
    body.append(list);
  }
  const button = textElement('button', 'Create / price a quote for this client', 'ops-link-button'); button.type = 'button';
  button.addEventListener('click', () => { const form = document.querySelector('#quote-create-form'); if (form?.elements.clientId) { form.elements.clientId.value = client.id; form.elements.clientId.dispatchEvent(new Event('change')); } activateView('quotes'); });
  body.append(button);
}

function renderInvoicesCard(card, invoices, client) {
  const body = card.querySelector('.client-section-body'); body.replaceChildren();
  if (!invoices.length) body.append(emptyState('No invoices yet', 'Create an invoice for this client from the Invoices panel.'));
  else {
    const list = element('ul', 'ops-list');
    invoices.forEach((invoice) => { const li = element('li', 'ops-list__item'); const copy = document.createElement('div'); copy.append(textElement('p', `${formatMoney(invoice.total)} · ${invoice.id}`, 'ops-list__title'), textElement('p', `Paid ${formatMoney(invoice.amount_paid || 0)} · due ${invoice.due_date || '—'}`, 'ops-list__meta')); li.append(copy, textElement('span', humanize(invoice.status), 'ops-status')); list.append(li); });
    body.append(list);
  }
  const button = textElement('button', 'Create an invoice for this client', 'ops-link-button'); button.type = 'button';
  button.addEventListener('click', () => { const form = document.querySelector('#invoice-create-form'); if (form?.elements.clientId) { form.elements.clientId.value = client.id; form.elements.clientId.dispatchEvent(new Event('change')); } activateView('invoices'); });
  body.append(button);
}

function renderPaymentsCard(card, consents, client) {
  const body = card.querySelector('.client-section-body'); body.replaceChildren();
  if (!consents.length) body.append(emptyState('No recurring billing yet', 'Prepare a recurring offer from the Payments panel — only the client can approve it, from their own portal session.'));
  else {
    const list = element('ul', 'ops-list');
    consents.forEach((consent) => { const li = element('li', 'ops-list__item'); const copy = document.createElement('div'); copy.append(textElement('p', `${formatMoney(consent.billing_amount)} · ${humanize(consent.billing_frequency)}`, 'ops-list__title'), textElement('p', `${consent.id} · started ${consent.start_date}`, 'ops-list__meta')); li.append(copy, textElement('span', humanize(consent.status), 'ops-status')); list.append(li); });
    body.append(list);
  }
  const button = textElement('button', 'Prepare a recurring offer', 'ops-link-button'); button.type = 'button'; button.addEventListener('click', () => activateView('payments')); body.append(button);
}

function renderContentCard(card, plans, items, client) {
  const body = card.querySelector('.client-section-body'); body.replaceChildren();
  body.append(textElement('p', `${plans.length} content plan(s) · ${items.length} content item(s)`, 'ops-hint'));
  if (plans.length) {
    const list = element('ul', 'ops-list');
    plans.slice(0, 5).forEach((plan) => { const li = element('li', 'ops-list__item'); const copy = document.createElement('div'); copy.append(textElement('p', plan.name, 'ops-list__title'), textElement('p', plan.id, 'ops-list__meta')); li.append(copy, textElement('span', humanize(plan.status), 'ops-status')); list.append(li); });
    body.append(list);
  }
  if (items.length) {
    const list = element('ul', 'ops-list');
    items.slice(0, 5).forEach((item) => { const li = element('li', 'ops-list__item'); const copy = document.createElement('div'); copy.append(textElement('p', item.topic, 'ops-list__title'), textElement('p', item.id, 'ops-list__meta')); li.append(copy, textElement('span', humanize(item.status), 'ops-status')); list.append(li); });
    body.append(list);
  }
  const button = textElement('button', 'Open Content Intelligence', 'ops-link-button'); button.type = 'button';
  button.addEventListener('click', () => {
    const planForm = document.querySelector('#content-plan-create-form'); if (planForm?.elements.clientId) { planForm.elements.clientId.value = client.id; planForm.elements.clientId.dispatchEvent(new Event('change')); }
    const sourceForm = document.querySelector('#content-source-create-form'); if (sourceForm?.elements.clientId) { sourceForm.elements.clientId.value = client.id; sourceForm.elements.clientId.dispatchEvent(new Event('change')); }
    activateView('content');
  });
  body.append(button);
}

async function loadClientDetailSections(client) {
  const container = document.querySelector('#client-detail-sections'); if (!container) return;
  container.replaceChildren(buildContactsSection(), buildServicesSection(), buildAgreementSection(client), buildProjectsSection(client), buildProgressSection(client), buildPortalSection(client));
  const quotesCard = buildLoadingCard('Quotes', 'Client-specific pricing');
  const invoicesCard = buildLoadingCard('Invoices', 'Billing');
  const financialCard = sectionCard('Financial summary', 'Quotes + invoices', 'admin-surface-raised');
  const financialMount = element('div'); financialCard.querySelector('.client-section-body').append(financialMount);
  const paymentsCard = buildLoadingCard('Recurring billing', 'Payments');
  const contentCard = buildLoadingCard('Content', 'Content Intelligence');
  container.append(quotesCard, invoicesCard, financialCard, paymentsCard, contentCard, buildActivitySection(client));
  loadClientProgress(client, container);

  if (isPreview) {
    [quotesCard, invoicesCard, paymentsCard, contentCard].forEach((card) => {
      card.querySelector('.client-section-body').replaceChildren(emptyState('Not available in fictional preview', 'This section loads from the live API and has no fictional preview fixture.'));
    });
    renderChartEmptyState(financialMount, { title: 'Not available in fictional preview', copy: 'This section loads from the live API and has no fictional preview fixture.' });
    return;
  }
  let quotesResult = []; let invoicesResult = [];
  try { const result = await api(`/api/commerce/clients/${encodeURIComponent(client.id)}/quotes`); quotesResult = result.quotes || []; renderQuotesCard(quotesCard, quotesResult, client); }
  catch (error) { quotesCard.querySelector('.client-section-body').replaceChildren(emptyState('Could not load quotes', error.message)); }
  try { const result = await api(`/api/commerce/clients/${encodeURIComponent(client.id)}/invoices`); invoicesResult = result.invoices || []; renderInvoicesCard(invoicesCard, invoicesResult, client); }
  catch (error) { invoicesCard.querySelector('.client-section-body').replaceChildren(emptyState('Could not load invoices', error.message)); }
  renderFinancialStatus(financialMount, { quotes: quotesResult, invoices: invoicesResult }, { title: null });
  try { const result = await api(`/api/commerce/clients/${encodeURIComponent(client.id)}/recurring-consents`); renderPaymentsCard(paymentsCard, result.consents || [], client); }
  catch (error) { paymentsCard.querySelector('.client-section-body').replaceChildren(emptyState('Could not load recurring billing', error.message)); }
  try {
    const [plansResult, itemsResult] = await Promise.all([
      api(`/api/content/clients/${encodeURIComponent(client.id)}/plans`),
      api(`/api/content/clients/${encodeURIComponent(client.id)}/items`),
    ]);
    renderContentCard(contentCard, plansResult.plans || [], itemsResult.items || [], client);
  } catch (error) { contentCard.querySelector('.client-section-body').replaceChildren(emptyState('Could not load content', error.message)); }
}

function showClientEdit(client, container) {
  container.querySelector('#client-edit-form')?.remove(); const form = element('form', 'ops-card ops-card__body ops-admin-form client-edit-form'); form.id = 'client-edit-form'; form.noValidate = true;
  form.innerHTML = `<div class="dashboard-card-title"><h3>Edit client profile</h3><span class="ops-status">Admin only</span></div><div class="ops-grid ops-grid--2"><label class="ops-field"><span class="ops-legend">Legal business name</span><input class="ops-input" name="legalName" required maxlength="180"></label><label class="ops-field"><span class="ops-legend">Display name</span><input class="ops-input" name="displayName" required maxlength="180"></label><label class="ops-field"><span class="ops-legend">Billing email</span><input class="ops-input" name="billingEmail" type="email" required maxlength="254"></label><label class="ops-field"><span class="ops-legend">Phone</span><input class="ops-input" name="phone" type="tel" maxlength="40"></label><label class="ops-field"><span class="ops-legend">Lifecycle</span><select class="ops-input" name="lifecycleStatus"><option value="qualified">Qualified</option><option value="agreement_prepared">Agreement prepared</option><option value="agreement_sent">Agreement sent</option><option value="agreement_viewed">Agreement viewed</option><option value="agreement_accepted">Agreement accepted</option><option value="payment_initiated">Payment initiated</option><option value="payment_confirmed">Payment confirmed</option><option value="active">Active</option><option value="project_active">Project active</option><option value="work_in_progress">Work in progress</option><option value="reporting">Reporting</option><option value="completed">Completed</option><option value="retainer">Retainer</option><option value="archived">Archived</option></select></label></div><div class="ops-form-actions"><button class="ops-button ops-button--primary" type="submit">Save client profile</button><p class="ops-form-status" role="status"></p></div>`;
  form.elements.legalName.value = client.legalName || client.name; form.elements.displayName.value = client.name; form.elements.billingEmail.value = client.billingEmail || 'fictional@example.test'; form.elements.phone.value = client.phone || ''; form.elements.lifecycleStatus.value = client.lifecycleCode || 'qualified';
  form.addEventListener('submit', async (event) => { event.preventDefault(); if (!form.reportValidity()) return; const values = Object.fromEntries(new FormData(form)); const status = form.querySelector('.ops-form-status'); if (isPreview) { client.legalName = values.legalName; client.name = values.displayName; client.billingEmail = values.billingEmail; client.phone = values.phone; client.lifecycleCode = values.lifecycleStatus; client.lifecycle = humanize(values.lifecycleStatus); render(adminData); openClientDetail(client); return setStatus(status, 'Fictional preview profile updated in memory only.'); } try { const result = await api(`/api/ops/admin/clients/${encodeURIComponent(client.id)}`, { method: 'PATCH', headers: { 'X-CSRF-Token': csrfToken }, body: JSON.stringify(values) }); client.legalName = values.legalName; client.name = values.displayName; client.billingEmail = values.billingEmail; client.phone = values.phone; client.lifecycleCode = result.lifecycleStatus; client.lifecycle = humanize(result.lifecycleStatus); render(adminData); openClientDetail(client); } catch (error) { setStatus(status, error.message, true); } });
  container.append(form); form.querySelector('input').focus();
}

document.querySelector('#close-client-detail').addEventListener('click', () => { document.querySelector('#admin-client-detail').hidden = true; });
document.querySelectorAll('[data-admin-view]').forEach((link) => link.addEventListener('click', (event) => { event.preventDefault(); activateView(link.dataset.adminView); }));
document.querySelectorAll('[data-open-admin]').forEach((button) => button.addEventListener('click', () => activateView(button.dataset.openAdmin)));
document.querySelector('#admin-client-search').addEventListener('input', (event) => { const query = event.target.value.trim().toLowerCase(); renderClientRows('admin-client-table', adminData.clients.filter((client) => [client.name, client.project, client.lifecycle].some((value) => String(value).toLowerCase().includes(query))), true); });
document.querySelector('#show-client-create').addEventListener('click', () => { const form = document.querySelector('#client-project-form'); form.hidden = !form.hidden; if (!form.hidden) form.querySelector('input').focus(); });

document.querySelector('#client-project-form').addEventListener('submit', async (event) => {
  event.preventDefault(); const form = event.currentTarget; const status = document.querySelector('#client-create-status'); if (!form.reportValidity()) return;
  const values = Object.fromEntries(new FormData(form)); setStatus(status, 'Creating client and project…');
  if (isPreview) { const client = { id: `client_preview_${Date.now()}`, name: values.displayName, lifecycle: 'Qualified Client', project: values.projectName, projectId: `prj_preview_${Date.now()}`, agreement: 'Not prepared', payment: 'Not started', portal: 'Not eligible', action: 'Prepare agreement', paid: 0, total: 0 }; adminData.clients.unshift(client); render(adminData); const clientSelect = document.querySelector('#agreement-create-client'); clientSelect.value = client.id; clientSelect.dispatchEvent(new Event('change')); setStatus(status, 'Fictional preview client created. Continue to agreement preparation.'); activateView('agreements'); return; }
  // The Agreements panel's Client select can only offer clients already in adminData.clients
  // (see populateClientSelect), so the newly created client is added to that local cache
  // (same minimal shape the preview branch above already uses) and re-rendered before the
  // select can be set to it - the admin summary itself isn't re-fetched here, matching this
  // handler's prior behavior of not doing a full reload after creation.
  try {
    const created = await api('/api/ops/admin/clients-projects', { method: 'POST', headers: { 'X-CSRF-Token': csrfToken }, body: JSON.stringify(values) });
    adminData.clients.unshift({ id: created.clientId, name: values.displayName, lifecycle: 'Qualified Client', project: values.projectName, projectId: created.projectId, agreement: 'Not prepared', payment: 'Not started', portal: 'Not eligible', action: 'Prepare agreement', paid: 0, total: 0 });
    render(adminData);
    const clientSelect = document.querySelector('#agreement-create-client'); clientSelect.value = created.clientId; clientSelect.dispatchEvent(new Event('change'));
    setStatus(status, 'Client and project created. Continue with Agreement Version 1.'); activateView('agreements'); document.querySelector('#agreement-create-form [name="programName"]').focus();
  } catch (error) { setStatus(status, error.message, true); }
});

document.querySelector('#agreement-create-form').addEventListener('submit', async (event) => {
  event.preventDefault(); const form = event.currentTarget; const status = document.querySelector('#agreement-create-status'); if (!form.reportValidity()) return;
  const data = new FormData(form); const payload = { clientId: data.get('clientId'), projectId: data.get('projectId'), programName: data.get('programName'), startDate: data.get('startDate'), expiresAt: data.get('expiresAt') ? new Date(data.get('expiresAt')).toISOString() : '', totalProgramFee: Math.round(Number(data.get('totalProgramFee')) * 100), paymentStructures: data.getAll('paymentStructures') };
  setStatus(status, 'Creating immutable agreement version…');
  if (isPreview) { currentAgreementId = `agr_preview_${Date.now()}`; document.querySelector('#invite-create-panel').hidden = false; setStatus(status, 'Fictional Version 1 prepared. The legal document remains an explicit placeholder.'); document.querySelector('#generate-invite').focus(); return; }
  try { const created = await api('/api/ops/admin/agreements', { method: 'POST', headers: { 'X-CSRF-Token': csrfToken }, body: JSON.stringify(payload) }); currentAgreementId = created.agreementId; document.querySelector('#invite-create-panel').hidden = false; setStatus(status, `Version ${created.versionNumber} prepared. Legal document remains an explicit placeholder.`); document.querySelector('#generate-invite').focus(); } catch (error) { setStatus(status, error.message, true); }
});

document.querySelector('#generate-invite').addEventListener('click', async () => {
  const status = document.querySelector('#invite-status'); if (!currentAgreementId) return setStatus(status, 'Prepare an agreement before generating an invitation.', true); setStatus(status, 'Generating single-use invitation…');
  if (isPreview) { showInvite(`https://e4la-client-operations-preview.pages.dev/client-agreement/${currentAgreementId}#invite=FICTIONAL_TOKEN_NOT_VALID`); setStatus(status, 'Fictional invitation generated for interface review. It is not valid and has not been emailed.'); return; }
  try { const created = await api(`/api/ops/admin/agreements/${encodeURIComponent(currentAgreementId)}/invites`, { method: 'POST', headers: { 'X-CSRF-Token': csrfToken }, body: JSON.stringify({ expiresInHours: 72 }) }); showInvite(created.invitationUrl); setStatus(status, 'Invitation generated for fictional preview testing. It has not been emailed.'); } catch (error) { setStatus(status, error.message, true); }
});

// applyToPublicationForm mirrors the same client (via the Projects panel's own client
// select, read at submit time) into the publication-form's client select so its
// auto-derived Project display stays correct, instead of poking its now-hidden
// projectId input directly - entityType/entityId are untouched regular fields.
function applyToPublicationForm(entityType, entityId) {
  const sourceClientId = document.querySelector('#project-item-client-select')?.value;
  const pubClientSelect = document.querySelector('#publication-client-select');
  if (pubClientSelect && sourceClientId) { pubClientSelect.value = sourceClientId; pubClientSelect.dispatchEvent(new Event('change')); }
  document.querySelector('#publication-form [name="entityType"]').value = entityType;
  document.querySelector('#publication-form [name="entityId"]').value = entityId;
}
document.querySelector('#project-item-form').addEventListener('submit', async (event) => { event.preventDefault(); const data = Object.fromEntries(new FormData(event.currentTarget)); const status = document.querySelector('#project-item-status'); if (!event.currentTarget.reportValidity()) return; if (isPreview) { const id = `${data.entityType}_preview_${Date.now()}`; applyToPublicationForm(data.entityType, id); return setStatus(status, `Fictional ${humanize(data.entityType)} saved as Internal. Continue through review and publication below.`); } try { const result = await api(`/api/ops/admin/projects/${encodeURIComponent(data.projectId)}/items`, { method: 'POST', headers: { 'X-CSRF-Token': csrfToken }, body: JSON.stringify(data) }); applyToPublicationForm(result.entityType, result.id); setStatus(status, `${humanize(result.entityType)} saved as Internal. Continue through review and publication below.`); } catch (error) { setStatus(status, error.message, true); } });
document.querySelector('#publication-form').addEventListener('submit', async (event) => { event.preventDefault(); const data = Object.fromEntries(new FormData(event.currentTarget)); const status = document.querySelector('#publication-status'); if (!event.currentTarget.reportValidity()) return; const payload = { entityType: data.entityType, entityId: data.entityId, publicationStatus: data.status }; if (isPreview) return setStatus(status, `Fictional preview: item moved to ${humanize(data.status)}. No database record changed.`); try { await api('/api/ops/admin/publication', { method: 'POST', headers: { 'X-CSRF-Token': csrfToken }, body: JSON.stringify(payload) }); setStatus(status, `Publication state updated to ${humanize(data.status)}.`); } catch (error) { setStatus(status, error.message, true); } });
document.querySelector('#activation-form').addEventListener('submit', async (event) => { event.preventDefault(); const data = new FormData(event.currentTarget); const enrollmentId = data.get('enrollmentId'); const payload = { activationMode: data.get('activationMode'), onboardingReady: data.has('onboardingReady'), activateNow: data.has('activateNow'), scheduledAt: data.get('activationScheduledAt') ? new Date(data.get('activationScheduledAt')).toISOString() : null }; const status = document.querySelector('#activation-status'); if (!event.currentTarget.reportValidity()) return; if (isPreview) return setStatus(status, `Fictional preview: ${humanize(payload.activationMode)} activation policy saved; no database record changed.`); try { const result = await api(`/api/ops/admin/enrollments/${encodeURIComponent(enrollmentId)}/activate`, { method: 'POST', headers: { 'X-CSRF-Token': csrfToken }, body: JSON.stringify(payload) }); setStatus(status, result.portalActivated ? 'Portal activated.' : 'Policy saved. Portal remains pending until eligibility requirements are met.'); } catch (error) { setStatus(status, error.message, true); } });

document.querySelector('#phase-create-form').addEventListener('submit', async (event) => {
  event.preventDefault(); const form = event.currentTarget; if (!form.reportValidity()) return;
  const data = new FormData(form); const projectId = data.get('projectId'); const status = document.querySelector('#phase-create-status');
  const payload = { name: data.get('name'), sequence: data.get('sequence'), status: data.get('status'), target_start_date: data.get('target_start_date') || undefined, target_end_date: data.get('target_end_date') || undefined, client_action_required: data.has('client_action_required'), client_action_note: data.get('client_action_note') || undefined };
  if (isPreview) return setStatus(status, `Fictional preview: phase "${payload.name}" saved as Internal. Publish it from the Projects panel.`);
  try { const result = await api(`/api/ops/admin/projects/${encodeURIComponent(projectId)}/phases`, { method: 'POST', headers: { 'X-CSRF-Token': csrfToken }, body: JSON.stringify(payload) }); setStatus(status, `Phase saved as Internal (ID ${result.id}). Publish it from the Projects panel.`); form.reset(); } catch (error) { setStatus(status, error.message, true); }
});
document.querySelector('#snapshot-create-form').addEventListener('submit', async (event) => {
  event.preventDefault(); const form = event.currentTarget; if (!form.reportValidity()) return;
  const data = new FormData(form); const projectId = data.get('projectId'); const status = document.querySelector('#snapshot-create-status');
  const payload = { week_number: data.get('week_number'), snapshot_date: data.get('snapshot_date'), completed_milestones_count: data.get('completed_milestones_count'), total_milestones_count: data.get('total_milestones_count') };
  if (isPreview) return setStatus(status, `Fictional preview: week ${payload.week_number} snapshot saved as Internal. Publish it from the Projects panel.`);
  try { const result = await api(`/api/ops/admin/projects/${encodeURIComponent(projectId)}/progress-snapshots`, { method: 'POST', headers: { 'X-CSRF-Token': csrfToken }, body: JSON.stringify(payload) }); setStatus(status, `Snapshot saved as Internal (ID ${result.id}). Values are now permanent; publish it from the Projects panel.`); form.reset(); } catch (error) { setStatus(status, error.message, true); }
});
document.querySelector('#metric-create-form').addEventListener('submit', async (event) => {
  event.preventDefault(); const form = event.currentTarget; if (!form.reportValidity()) return;
  const data = new FormData(form); const projectId = data.get('projectId'); const status = document.querySelector('#metric-create-status');
  const payload = { metric_key: data.get('metric_key'), label: data.get('label'), category: data.get('category'), trend: data.get('trend'), current_value: data.get('current_value'), baseline_value: data.get('baseline_value') || undefined, interpretation: data.get('interpretation') || undefined };
  if (isPreview) return setStatus(status, `Fictional preview: metric "${payload.label}" saved as Internal. Publish it from the Projects panel.`);
  try { const result = await api(`/api/ops/admin/projects/${encodeURIComponent(projectId)}/performance-metrics`, { method: 'POST', headers: { 'X-CSRF-Token': csrfToken }, body: JSON.stringify(payload) }); setStatus(status, `Metric saved as Internal (ID ${result.id}). Publish it from the Projects panel.`); form.reset(); } catch (error) { setStatus(status, error.message, true); }
});
document.querySelector('#metric-update-form').addEventListener('submit', async (event) => {
  event.preventDefault(); const form = event.currentTarget; if (!form.reportValidity()) return;
  const data = new FormData(form); const metricId = data.get('metricId'); const status = document.querySelector('#metric-update-status');
  const payload = {};
  if (data.get('current_value')) payload.current_value = data.get('current_value');
  if (data.get('baseline_value')) payload.baseline_value = data.get('baseline_value');
  if (data.get('trend')) payload.trend = data.get('trend');
  if (data.get('interpretation')) payload.interpretation = data.get('interpretation');
  if (!Object.keys(payload).length) return setStatus(status, 'Enter at least one field to update.', true);
  if (isPreview) return setStatus(status, `Fictional preview: metric ${metricId} updated in memory only.`);
  try { await api(`/api/ops/admin/performance-metrics/${encodeURIComponent(metricId)}`, { method: 'PATCH', headers: { 'X-CSRF-Token': csrfToken }, body: JSON.stringify(payload) }); setStatus(status, 'Metric updated.'); } catch (error) { setStatus(status, error.message, true); }
});

// --- Services / Quotes / Invoices (functions/api/commerce) ---

document.querySelector('#service-category-form')?.addEventListener('submit', async (event) => {
  event.preventDefault(); const form = event.currentTarget; if (!form.reportValidity()) return;
  const name = new FormData(form).get('name'); const status = document.querySelector('#service-category-status');
  if (isPreview) return setStatus(status, `Fictional preview: category "${name}" saved.`);
  try { await api('/api/commerce/service-categories', { method: 'POST', headers: { 'X-CSRF-Token': csrfToken }, body: JSON.stringify({ name }) }); setStatus(status, 'Category saved.'); form.reset(); await loadServices(); } catch (error) { setStatus(status, error.message, true); }
});
document.querySelector('#service-create-form')?.addEventListener('submit', async (event) => {
  event.preventDefault(); const form = event.currentTarget; if (!form.reportValidity()) return;
  const data = new FormData(form); const status = document.querySelector('#service-create-status');
  const payload = { name: data.get('name'), description: data.get('description') || undefined, category_id: data.get('category_id') || undefined, pricing_type: data.get('pricing_type'), billing_type: data.get('billing_type'), default_price: data.get('default_price') ? Math.round(Number(data.get('default_price')) * 100) : undefined };
  if (isPreview) return setStatus(status, `Fictional preview: service "${payload.name}" saved.`);
  try { const result = await api('/api/commerce/services', { method: 'POST', headers: { 'X-CSRF-Token': csrfToken }, body: JSON.stringify(payload) }); setStatus(status, `Service saved (ID ${result.id}).`); form.reset(); await loadServices(); } catch (error) { setStatus(status, error.message, true); }
});
async function loadServices() {
  const table = document.querySelector('#admin-service-table'); const select = document.querySelector('#service-category-select'); const countStatus = document.querySelector('#service-count-status');
  if (isPreview) {
    servicesCache = DEMO_SERVICES; populateServiceSelects();
    if (table) setText('service-count-status', 'Fictional preview data');
    return;
  }
  if (!table) return;
  try {
    const [services, categories] = await Promise.all([api('/api/commerce/services'), api('/api/commerce/service-categories')]);
    if (select) { select.replaceChildren(textElement('option', 'No category', '')); (categories.categories || categories || []).forEach((c) => { const opt = textElement('option', c.name); opt.value = c.id; select.append(opt); }); }
    const rows = services.services || services || [];
    servicesCache = rows.filter((s) => s.active); populateServiceSelects();
    table.replaceChildren();
    rows.forEach((s) => { const row = document.createElement('tr'); [s.name, s.category_name || s.category_id || '—', s.default_price != null ? formatMoney(s.default_price) : 'Custom', humanize(s.pricing_type), s.active ? 'Active' : 'Inactive'].forEach((v) => row.append(textElement('td', v))); const actionCell = document.createElement('td'); const toggle = textElement('button', s.active ? 'Deactivate' : 'Activate', 'ops-link-button'); toggle.type = 'button'; toggle.addEventListener('click', async () => { try { await api(`/api/commerce/services/${encodeURIComponent(s.id)}`, { method: 'PATCH', headers: { 'X-CSRF-Token': csrfToken }, body: JSON.stringify({ active: s.active ? 0 : 1 }) }); await loadServices(); } catch (error) { setStatus(countStatus, error.message, true); } }); actionCell.append(toggle); row.append(actionCell); table.append(row); });
    if (countStatus) setText('service-count-status', `${rows.length} services`);
  } catch (error) { if (countStatus) setStatus(countStatus, error.message, true); }
}

// Fills every "Service" picker on the Quotes panel (the template row plus any rows
// cloned from it) from servicesCache, keeping the option value the real service id -
// the Quotes UX fix this pass is about: Nasim picks a service by name, the id travels
// invisibly in the option value exactly like it always did as a hidden form field.
function populateServiceSelects() {
  document.querySelectorAll('.quote-service-select').forEach((select) => {
    const previous = select.value;
    // Most reuses of this select support a custom/label-only line item alongside a real
    // catalog service (Quotes, Invoices); a couple (changing a service's own default
    // price, preparing a recurring offer) require a real existing service and have no
    // label field at all - those opt out via data-placeholder so the empty option never
    // dangles a "type a label below" instruction with no label field anywhere nearby.
    const placeholderText = select.dataset.placeholder || 'Custom item (type a label below)';
    const customOption = textElement('option', placeholderText); customOption.value = '';
    select.replaceChildren(customOption);
    servicesCache.forEach((service) => {
      const opt = textElement('option', service.default_price != null ? `${service.name} — ${formatMoney(service.default_price)}` : service.name);
      opt.value = service.id; select.append(opt);
    });
    if (servicesCache.some((service) => service.id === previous)) select.value = previous;
  });
}

// -------------------------------------------------------------------------------------
// Quotes UX: Client/Project/Quote/Service are now always picked by name, never typed as
// a raw database id - the ids still travel as the real <select>/hidden <input> values the
// existing submit handlers below already read (data.get('clientId')/('projectId')/
// ('quoteId')/('qi_serviceId')), so none of that commercial/API logic changes at all.
// -------------------------------------------------------------------------------------

// One shared client-select population, reused by every "<select> of clients" across the
// whole admin UI (Quotes, Agreements, Projects, Progress, Portals, Invoices, Content
// Intelligence) - a single implementation instead of one copy per panel. The option value
// is always the real client id; the visible text is always the human-readable name.
function populateClientSelect(select) {
  if (!select) return;
  const previous = select.value;
  const clients = adminData?.clients || [];
  select.replaceChildren(emptyOption('Select a client…'));
  clients.forEach((client) => { const opt = textElement('option', client.name); opt.value = client.id; select.append(opt); });
  if (clients.some((client) => client.id === previous)) select.value = previous;
}

// Generic client-select -> auto-derived read-only Project display, the same pattern as
// Quotes' updateQuoteCreateProjectDisplay, reused by every other form that used to ask for
// a typed Project ID. normalizeAdmin()'s client.projectId is a single derived value (one
// project per client, by design - see updateQuoteCreateProjectDisplay's own usage), so this
// generic version reads the same single field every one of those forms already relies on.
// (PROJECT_AUTOFILL_TARGETS itself is declared at the top of the file - see its own comment.)
function updateProjectAutofillDisplay(clientSelectId, displayId, hiddenInputId) {
  const clientSelect = document.querySelector(`#${clientSelectId}`);
  const display = document.querySelector(`#${displayId}`);
  const hiddenInput = document.querySelector(`#${hiddenInputId}`);
  if (!clientSelect || !display || !hiddenInput) return;
  const client = (adminData?.clients || []).find((item) => item.id === clientSelect.value);
  if (!client) { display.textContent = 'Select a client to see their project'; display.dataset.filled = 'false'; hiddenInput.value = ''; return; }
  display.textContent = client.project || 'No project on file yet'; display.dataset.filled = 'true'; hiddenInput.value = client.projectId || '';
}
function refreshAllProjectAutofills() { PROJECT_AUTOFILL_TARGETS.forEach(([clientSelectId, displayId, hiddenId]) => updateProjectAutofillDisplay(clientSelectId, displayId, hiddenId)); }
function wireProjectAutofillListeners() { PROJECT_AUTOFILL_TARGETS.forEach(([clientSelectId, displayId, hiddenId]) => document.querySelector(`#${clientSelectId}`)?.addEventListener('change', () => updateProjectAutofillDisplay(clientSelectId, displayId, hiddenId))); }

// Same pattern again, for the Portals panel's Enrollment ID (client.enrollmentId is the
// single derived enrollment for that client, from the same normalizeAdmin() shape).
function updateActivationEnrollmentDisplay() {
  const clientSelect = document.querySelector('#activation-client-select');
  const display = document.querySelector('#activation-enrollment-display');
  const hiddenInput = document.querySelector('#activation-enrollment-id');
  if (!clientSelect || !display || !hiddenInput) return;
  const client = (adminData?.clients || []).find((item) => item.id === clientSelect.value);
  if (!client || !client.enrollmentId) { display.textContent = client ? 'No enrollment on file yet' : 'Select a client to see their enrollment'; display.dataset.filled = 'false'; hiddenInput.value = ''; return; }
  display.textContent = `Enrollment on file${client.plan ? ` (${client.plan})` : ''}`; display.dataset.filled = 'true'; hiddenInput.value = client.enrollmentId;
}

// Calendar panel's client filter: a plain <select> (real client ids), first option "All
// clients" (empty value) rather than Quotes' "Select a client…", since leaving it blank is
// a valid, common choice here rather than an incomplete one.
function populateCalendarClientFilter() {
  const select = document.querySelector('#calendar-client-filter'); if (!select) return;
  const previous = select.value; const clients = adminData?.clients || [];
  select.replaceChildren(emptyOption('All clients'));
  clients.forEach((client) => { const opt = textElement('option', client.name); opt.value = client.id; select.append(opt); });
  if (clients.some((client) => client.id === previous)) select.value = previous;
}

function renderQuoteClientPickers(clients) {
  const createSelect = document.querySelector('#quote-create-client');
  populateClientSelect(createSelect);
  document.querySelectorAll('.quote-picker-client, .admin-client-select').forEach((select) => populateClientSelect(select));
  updateQuoteCreateProjectDisplay();
  refreshAllProjectAutofills();
  updateActivationEnrollmentDisplay();
  populateContentItemSelects();
  if (quotePickersWired) return;
  quotePickersWired = true;

  createSelect?.addEventListener('change', updateQuoteCreateProjectDisplay);
  wireSearchableSelect(document.querySelector('[data-filter-for="quote-create-client"]'), createSelect);

  wireQuotePicker('quote-version-client', 'quote-version-quote');
  wireQuotePicker('quote-send-client', 'quote-send-quote');
  wireQuotePicker('quote-status-client', 'quote-status-quote');
  wireQuotePicker('payment-options-client', 'payment-options-quote');
  document.querySelector('#payment-options-quote')?.addEventListener('change', fetchQuoteTotal);

  wireQuotePicker('invoice-create-client', 'invoice-create-quote');
  wireInvoicePicker('invoice-send-client', 'invoice-send-invoice');

  wireProjectAutofillListeners();
  document.querySelector('#activation-client-select')?.addEventListener('change', updateActivationEnrollmentDisplay);
}

// A plain text input filters a companion <select>'s options as the user types - a
// dependency-free "searchable select" (native <select> stays the source of truth for
// the actual value, so there is no free-text-to-id matching to get wrong).
function wireSearchableSelect(filterInput, select) {
  if (!filterInput || !select || filterInput.dataset.wired) return;
  filterInput.dataset.wired = 'true';
  const allOptionsHtml = () => Array.from(select.options).map((option) => ({ value: option.value, label: option.textContent }));
  let baseOptions = allOptionsHtml();
  const refreshBase = () => { baseOptions = allOptionsHtml(); };
  select.addEventListener('focus', refreshBase);
  filterInput.addEventListener('input', () => {
    if (!filterInput.value.trim()) refreshBase();
    const query = filterInput.value.trim().toLowerCase();
    const previous = select.value;
    const matches = baseOptions.filter((option) => !option.value || option.label.toLowerCase().includes(query));
    select.replaceChildren();
    matches.forEach((option) => { const opt = textElement('option', option.label); opt.value = option.value; select.append(opt); });
    if (matches.some((option) => option.value === previous)) select.value = previous;
  });
}

function updateQuoteCreateProjectDisplay() {
  const clientId = document.querySelector('#quote-create-client')?.value;
  const display = document.querySelector('#quote-create-project-display');
  const hiddenProjectId = document.querySelector('#quote-create-project-id');
  if (!display || !hiddenProjectId) return;
  const client = (adminData?.clients || []).find((item) => item.id === clientId);
  if (!client) { display.textContent = 'Select a client to see their project'; display.dataset.filled = 'false'; hiddenProjectId.value = ''; return; }
  display.textContent = client.project || 'No project on file yet'; display.dataset.filled = 'true'; hiddenProjectId.value = client.projectId || '';
}

// One reusable client -> quote cascade, used by every quote-action form (price/send/
// status/payment structure): pick the client, then pick from that client's real quotes -
// never type a Quote ID. Options are labeled by status + date since quotes have no name.
function wireQuotePicker(clientSelectId, quoteSelectId) {
  const clientSelect = document.querySelector(`#${clientSelectId}`); const quoteSelect = document.querySelector(`#${quoteSelectId}`);
  if (!clientSelect || !quoteSelect) return;
  clientSelect.addEventListener('change', () => refreshQuoteOptions(clientSelect.value, quoteSelect));
}
async function refreshQuoteOptions(clientId, quoteSelect) {
  quoteSelect.replaceChildren(emptyOption(clientId ? 'Loading quotes…' : 'Select a client first…'));
  if (!clientId) return;
  const quotes = await loadClientQuotes(clientId);
  quoteSelect.replaceChildren(emptyOption(quotes.length ? 'Select a quote…' : 'This client has no quotes yet'));
  quotes.forEach((quote) => { const opt = textElement('option', quoteOptionLabel(quote)); opt.value = quote.id; quoteSelect.append(opt); });
  quoteSelect.dispatchEvent(new Event('change'));
}
// textElement('option', label) leaves a browser-default value equal to the label text
// (an <option> with no explicit value attribute reports its text as .value) - every
// placeholder/"no selection" option in the Quotes picker chain must be a real empty
// string instead, or a required <select> would treat that placeholder text as a valid
// selection and a submit could send the placeholder's label as if it were a real id.
function emptyOption(label) { const opt = textElement('option', label); opt.value = ''; return opt; }
function quoteOptionLabel(quote) {
  return `${humanize(quote.status)} · ${formatDate(quote.created_at)}`;
}
async function loadClientQuotes(clientId) {
  if (isPreview) return DEMO_QUOTES_BY_CLIENT[clientId] || [];
  try { const result = await api(`/api/commerce/clients/${encodeURIComponent(clientId)}/quotes`); return result.quotes || []; } catch { return []; }
}

// Same client -> list cascade as wireQuotePicker/refreshQuoteOptions/loadClientQuotes just
// above, mirrored for the Invoices panel's "Send invoice" form against the same per-client
// invoices endpoint the Unified Client Record already calls (renderInvoicesCard /
// loadClientDetailSections): GET /api/commerce/clients/:id/invoices. Options are labeled by
// status + due date + total, the same fields renderInvoicesCard already reads off each row.
function wireInvoicePicker(clientSelectId, invoiceSelectId) {
  const clientSelect = document.querySelector(`#${clientSelectId}`); const invoiceSelect = document.querySelector(`#${invoiceSelectId}`);
  if (!clientSelect || !invoiceSelect) return;
  clientSelect.addEventListener('change', () => refreshInvoiceOptions(clientSelect.value, invoiceSelect));
}
async function refreshInvoiceOptions(clientId, invoiceSelect) {
  invoiceSelect.replaceChildren(emptyOption(clientId ? 'Loading invoices…' : 'Select a client first…'));
  if (!clientId) return;
  const invoices = await loadClientInvoices(clientId);
  invoiceSelect.replaceChildren(emptyOption(invoices.length ? 'Select an invoice…' : 'This client has no invoices yet'));
  invoices.forEach((invoice) => { const opt = textElement('option', invoiceOptionLabel(invoice)); opt.value = invoice.id; invoiceSelect.append(opt); });
  invoiceSelect.dispatchEvent(new Event('change'));
}
function invoiceOptionLabel(invoice) {
  return `${humanize(invoice.status)} · due ${invoice.due_date || '—'} · ${formatMoney(invoice.total || 0)}`;
}
async function loadClientInvoices(clientId) {
  if (isPreview) return [];
  try { const result = await api(`/api/commerce/clients/${encodeURIComponent(clientId)}/invoices`); return result.invoices || []; } catch { return []; }
}
document.querySelector('#quote-create-form')?.addEventListener('submit', async (event) => {
  event.preventDefault(); const form = event.currentTarget; if (!form.reportValidity()) return;
  const data = new FormData(form); const clientId = data.get('clientId'); const status = document.querySelector('#quote-create-status');
  if (isPreview) return setStatus(status, `Fictional preview: draft quote created for ${clientId}.`);
  try { const result = await api(`/api/commerce/clients/${encodeURIComponent(clientId)}/quotes`, { method: 'POST', headers: { 'X-CSRF-Token': csrfToken }, body: JSON.stringify({ project_id: data.get('projectId') || undefined }) }); setStatus(status, `Draft quote created (ID ${result.id}).`); form.reset(); } catch (error) { setStatus(status, error.message, true); }
});
document.querySelector('#quote-add-line-item')?.addEventListener('click', () => {
  const rows = document.querySelector('#quote-items-rows'); const first = rows.querySelector('.quote-item-row');
  const clone = first.cloneNode(true);
  clone.querySelectorAll('input').forEach((input) => { input.value = input.name === 'qi_quantity' ? '1' : ''; });
  clone.querySelectorAll('select').forEach((select) => { select.value = ''; });
  rows.append(clone);
});
document.querySelector('#quote-items-rows')?.addEventListener('click', (event) => {
  if (!event.target.classList.contains('quote-item-remove')) return;
  const rows = document.querySelector('#quote-items-rows'); const row = event.target.closest('.quote-item-row');
  if (rows.querySelectorAll('.quote-item-row').length > 1) row.remove();
  else {
    row.querySelectorAll('input').forEach((input) => { input.value = input.name === 'qi_quantity' ? '1' : ''; });
    row.querySelectorAll('select').forEach((select) => { select.value = ''; });
  }
});
document.querySelector('#quote-version-form')?.addEventListener('submit', async (event) => {
  event.preventDefault(); const form = event.currentTarget; if (!form.reportValidity()) return;
  const data = new FormData(form); const quoteId = data.get('quoteId'); const status = document.querySelector('#quote-version-status');
  const serviceIds = data.getAll('qi_serviceId'); const labels = data.getAll('qi_label'); const quantities = data.getAll('qi_quantity'); const unitPrices = data.getAll('qi_unitPrice');
  const items = labels.map((label, index) => ({
    service_id: (serviceIds[index] || '').trim() || undefined,
    label: (label || '').trim() || undefined,
    quantity: Number(quantities[index]) || 1,
    unit_price: (unitPrices[index] || '').trim() !== '' ? Math.round(Number(unitPrices[index]) * 100) : undefined,
  })).filter((item) => item.service_id || item.label);
  if (!items.length) return setStatus(status, 'Add at least one line item (a Service ID or a label).', true);
  const payload = { items, scope: data.get('scope') || undefined, discount_amount: data.get('discount') ? Math.round(Number(data.get('discount')) * 100) : 0, tax_amount: data.get('tax') ? Math.round(Number(data.get('tax')) * 100) : 0 };
  if (isPreview) return setStatus(status, `Fictional preview: priced version saved for ${quoteId} with ${items.length} line item(s).`);
  try { const result = await api(`/api/commerce/quotes/${encodeURIComponent(quoteId)}/versions`, { method: 'POST', headers: { 'X-CSRF-Token': csrfToken }, body: JSON.stringify(payload) }); setStatus(status, `Version saved. Total: ${formatMoney(result.total)}.`); } catch (error) { setStatus(status, error.message, true); }
});
document.querySelector('#quote-send-form')?.addEventListener('submit', async (event) => {
  event.preventDefault(); const form = event.currentTarget; if (!form.reportValidity()) return;
  const quoteId = new FormData(form).get('quoteId'); const status = document.querySelector('#quote-send-status');
  if (isPreview) return setStatus(status, `Fictional preview: quote ${quoteId} sent.`);
  try { await api(`/api/commerce/quotes/${encodeURIComponent(quoteId)}/send`, { method: 'POST', headers: { 'X-CSRF-Token': csrfToken } }); setStatus(status, 'Quote sent.'); } catch (error) { setStatus(status, error.message, true); }
});
document.querySelector('#quote-status-form')?.addEventListener('submit', async (event) => {
  event.preventDefault(); const form = event.currentTarget; if (!form.reportValidity()) return;
  const data = new FormData(form); const quoteId = data.get('quoteId'); const status = document.querySelector('#quote-status-status');
  if (isPreview) return setStatus(status, `Fictional preview: quote ${quoteId} moved to ${data.get('status')}.`);
  try { await api(`/api/commerce/quotes/${encodeURIComponent(quoteId)}/status`, { method: 'POST', headers: { 'X-CSRF-Token': csrfToken }, body: JSON.stringify({ status: data.get('status') }) }); setStatus(status, `Quote updated to ${humanize(data.get('status'))}.`); } catch (error) { setStatus(status, error.message, true); }
});
document.querySelector('#invoice-create-form')?.addEventListener('submit', async (event) => {
  event.preventDefault(); const form = event.currentTarget; if (!form.reportValidity()) return;
  const data = new FormData(form); const status = document.querySelector('#invoice-create-status');
  const payload = { client_id: data.get('clientId'), quote_id: data.get('quoteId') || undefined, project_id: data.get('projectId') || undefined, due_date: data.get('dueDate') || undefined, items: [{ service_id: data.get('serviceId') || undefined, label: data.get('label'), quantity: Number(data.get('quantity')) || 1, unit_price: Math.round(Number(data.get('unitPrice')) * 100) }] };
  if (isPreview) return setStatus(status, `Fictional preview: invoice saved for ${payload.client_id}.`);
  try { const result = await api('/api/commerce/invoices', { method: 'POST', headers: { 'X-CSRF-Token': csrfToken }, body: JSON.stringify(payload) }); setStatus(status, `Invoice saved (ID ${result.id}).`); form.reset(); } catch (error) { setStatus(status, error.message, true); }
});
document.querySelector('#invoice-send-form')?.addEventListener('submit', async (event) => {
  event.preventDefault(); const form = event.currentTarget; if (!form.reportValidity()) return;
  const invoiceId = new FormData(form).get('invoiceId'); const status = document.querySelector('#invoice-send-status');
  if (isPreview) return setStatus(status, `Fictional preview: invoice ${invoiceId} sent.`);
  try { await api(`/api/commerce/invoices/${encodeURIComponent(invoiceId)}/send`, { method: 'POST', headers: { 'X-CSRF-Token': csrfToken } }); setStatus(status, 'Invoice sent.'); } catch (error) { setStatus(status, error.message, true); }
});
document.querySelector('#service-price-form')?.addEventListener('submit', async (event) => {
  event.preventDefault(); const form = event.currentTarget; if (!form.reportValidity()) return;
  const data = new FormData(form); const serviceId = data.get('serviceId'); const status = document.querySelector('#service-price-status');
  const raw = String(data.get('defaultPrice') || '').trim(); const payload = { default_price: raw !== '' ? Math.round(Number(raw) * 100) : null };
  if (isPreview) return setStatus(status, `Fictional preview: default price updated for ${serviceId}.`);
  try { await api(`/api/commerce/services/${encodeURIComponent(serviceId)}`, { method: 'PATCH', headers: { 'X-CSRF-Token': csrfToken }, body: JSON.stringify(payload) }); setStatus(status, 'Default price updated.'); form.reset(); await loadServices(); } catch (error) { setStatus(status, error.message, true); }
});
document.querySelector('#payment-add-installment')?.addEventListener('click', () => {
  const rows = document.querySelector('#payment-installment-rows'); const first = rows.querySelector('.payment-installment-row');
  const clone = first.cloneNode(true); clone.querySelectorAll('input, select').forEach((el) => { el.value = ''; }); rows.append(clone);
});
document.querySelector('#payment-installment-rows')?.addEventListener('click', (event) => {
  if (!event.target.classList.contains('payment-installment-remove')) return;
  const rows = document.querySelector('#payment-installment-rows'); const row = event.target.closest('.payment-installment-row');
  if (rows.querySelectorAll('.payment-installment-row').length > 1) row.remove();
  else row.querySelectorAll('input, select').forEach((el) => { el.value = ''; });
});
document.querySelector('#payment-fetch-total')?.addEventListener('click', fetchQuoteTotal);
async function fetchQuoteTotal() {
  const form = document.querySelector('#payment-options-form'); const quoteId = form.elements.quoteId.value.trim(); const status = document.querySelector('#payment-fetch-total-status');
  if (!quoteId) { form.elements.totalAmount.value = ''; return setStatus(status, 'Select a quote first.', true); }
  if (isPreview) { form.elements.totalAmount.value = '3600.00'; return setStatus(status, 'Fictional preview: total filled from a sample quote.'); }
  try { const result = await api(`/api/commerce/quotes/${encodeURIComponent(quoteId)}`); if (!result.version) { form.elements.totalAmount.value = ''; return setStatus(status, 'This quote has no priced version yet.', true); } form.elements.totalAmount.value = (result.version.total / 100).toFixed(2); setStatus(status, `Total filled from version ${result.version.version_number} (${formatMoney(result.version.total)}).`); } catch (error) { setStatus(status, error.message, true); }
}
document.querySelector('#payment-options-form')?.addEventListener('submit', async (event) => {
  event.preventDefault(); const form = event.currentTarget; if (!form.reportValidity()) return;
  const data = new FormData(form); const quoteId = data.get('quoteId'); const status = document.querySelector('#payment-options-status');
  const amounts = data.getAll('pi_amount'); const dueDates = data.getAll('pi_dueDate'); const offsetUnits = data.getAll('pi_offsetUnit'); const offsetCounts = data.getAll('pi_offsetCount');
  const installments = amounts.map((amount, index) => ({
    amount: String(amount || '').trim() !== '' ? Math.round(Number(amount) * 100) : undefined,
    due_date: dueDates[index] || undefined,
    offset_unit: offsetUnits[index] || undefined,
    offset_count: String(offsetCounts[index] || '').trim() !== '' ? Number(offsetCounts[index]) : undefined,
  })).filter((installment) => installment.amount !== undefined);
  if (!installments.length) return setStatus(status, 'Add at least one installment.', true);
  const totalAmount = Math.round(Number(data.get('totalAmount')) * 100);
  const payload = { option_type: data.get('optionType'), total_amount: totalAmount, installment_count: installments.length, label: data.get('label') || undefined, installments };
  if (isPreview) return setStatus(status, `Fictional preview: ${installments.length}-installment schedule saved for ${quoteId}.`);
  try { const result = await api(`/api/commerce/quotes/${encodeURIComponent(quoteId)}/payment-options`, { method: 'POST', headers: { 'X-CSRF-Token': csrfToken }, body: JSON.stringify(payload) }); setStatus(status, `Payment schedule saved (ID ${result.id}).`); } catch (error) { setStatus(status, error.message, true); }
});
document.querySelector('#recurring-offer-form')?.addEventListener('submit', async (event) => {
  event.preventDefault(); const form = event.currentTarget; if (!form.reportValidity()) return;
  const data = new FormData(form); const status = document.querySelector('#recurring-offer-status'); const output = document.querySelector('#recurring-offer-result');
  const payload = { service_id: data.get('serviceId'), billing_amount: Math.round(Number(data.get('billingAmount')) * 100), billing_frequency: data.get('billingFrequency'), start_date: data.get('startDate'), renewal_behavior: data.get('renewalBehavior') };
  if (isPreview) { output.hidden = false; output.textContent = JSON.stringify({ ...payload, fictionalPreview: true }, null, 2); return setStatus(status, 'Fictional preview offer generated.'); }
  try { const result = await api('/api/commerce/recurring-consent/offers', { method: 'POST', headers: { 'X-CSRF-Token': csrfToken }, body: JSON.stringify(payload) }); output.hidden = false; output.textContent = JSON.stringify(result.offer, null, 2); setStatus(status, 'Offer generated. Relay these terms to the client — nothing is saved yet.'); } catch (error) { setStatus(status, error.message, true); }
});

// --- Content Intelligence (functions/api/content) ---

document.querySelector('#content-plan-create-form')?.addEventListener('submit', async (event) => {
  event.preventDefault(); const form = event.currentTarget; if (!form.reportValidity()) return;
  const data = new FormData(form); const clientId = data.get('clientId'); const status = document.querySelector('#content-plan-create-status');
  const payload = { name: data.get('name'), project_id: data.get('projectId') || undefined, period_start: data.get('periodStart') || undefined, period_end: data.get('periodEnd') || undefined };
  if (isPreview) return setStatus(status, `Fictional preview: content plan "${payload.name}" saved for ${clientId}.`);
  try { const result = await api(`/api/content/clients/${encodeURIComponent(clientId)}/plans`, { method: 'POST', headers: { 'X-CSRF-Token': csrfToken }, body: JSON.stringify(payload) }); setStatus(status, `Plan saved (ID ${result.id}).`); form.reset(); } catch (error) { setStatus(status, error.message, true); }
});
document.querySelector('#content-plan-status-form')?.addEventListener('submit', async (event) => {
  event.preventDefault(); const form = event.currentTarget; if (!form.reportValidity()) return;
  const data = new FormData(form); const planId = data.get('planId'); const status = document.querySelector('#content-plan-status-status');
  if (isPreview) return setStatus(status, `Fictional preview: plan ${planId} moved to ${data.get('status')}.`);
  try { await api(`/api/content/plans/${encodeURIComponent(planId)}`, { method: 'PATCH', headers: { 'X-CSRF-Token': csrfToken }, body: JSON.stringify({ status: data.get('status') }) }); setStatus(status, `Plan updated to ${humanize(data.get('status'))}.`); } catch (error) { setStatus(status, error.message, true); }
});
document.querySelector('#content-source-create-form')?.addEventListener('submit', async (event) => {
  event.preventDefault(); const form = event.currentTarget; if (!form.reportValidity()) return;
  const data = new FormData(form); const clientId = data.get('clientId'); const status = document.querySelector('#content-source-create-status');
  const payload = { source_type: data.get('sourceType'), expert_name: data.get('expertName') || undefined, url: data.get('url') || undefined, insight: data.get('insight') || undefined };
  if (isPreview) return setStatus(status, `Fictional preview: source saved for ${clientId}.`);
  try { const result = await api(`/api/content/clients/${encodeURIComponent(clientId)}/sources`, { method: 'POST', headers: { 'X-CSRF-Token': csrfToken }, body: JSON.stringify(payload) }); setStatus(status, `Source saved (ID ${result.id}).`); form.reset(); } catch (error) { setStatus(status, error.message, true); }
});
document.querySelector('#content-claim-create-form')?.addEventListener('submit', async (event) => {
  event.preventDefault(); const form = event.currentTarget; if (!form.reportValidity()) return;
  const data = new FormData(form); const itemId = data.get('itemId'); const status = document.querySelector('#content-claim-create-status');
  const payload = { claim_text: data.get('claimText'), risk_level: data.get('riskLevel'), source_id: data.get('sourceId') || undefined };
  if (isPreview) return setStatus(status, `Fictional preview: claim logged for ${itemId}.`);
  try { const result = await api(`/api/content/items/${encodeURIComponent(itemId)}/claims`, { method: 'POST', headers: { 'X-CSRF-Token': csrfToken }, body: JSON.stringify(payload) }); setStatus(status, `Claim saved (ID ${result.id}).`); form.reset(); } catch (error) { setStatus(status, error.message, true); }
});
document.querySelector('#content-source-verify-form')?.addEventListener('submit', async (event) => {
  event.preventDefault(); const form = event.currentTarget; if (!form.reportValidity()) return;
  const data = new FormData(form); const sourceId = data.get('sourceId'); const status = document.querySelector('#content-source-verify-status');
  if (isPreview) return setStatus(status, `Fictional preview: source ${sourceId} moved to ${data.get('verificationStatus')}.`);
  try { await api(`/api/content/sources/${encodeURIComponent(sourceId)}/verify`, { method: 'PATCH', headers: { 'X-CSRF-Token': csrfToken }, body: JSON.stringify({ verification_status: data.get('verificationStatus') }) }); setStatus(status, `Source updated to ${humanize(data.get('verificationStatus'))}.`); } catch (error) { setStatus(status, error.message, true); }
});
document.querySelector('#content-claim-verify-form')?.addEventListener('submit', async (event) => {
  event.preventDefault(); const form = event.currentTarget; if (!form.reportValidity()) return;
  const data = new FormData(form); const claimId = data.get('claimId'); const status = document.querySelector('#content-claim-verify-status');
  const payload = { verification_status: data.get('verificationStatus'), source_id: data.get('sourceId') || undefined };
  if (isPreview) return setStatus(status, `Fictional preview: claim ${claimId} moved to ${data.get('verificationStatus')}.`);
  try { await api(`/api/content/claims/${encodeURIComponent(claimId)}/verify`, { method: 'PATCH', headers: { 'X-CSRF-Token': csrfToken }, body: JSON.stringify(payload) }); setStatus(status, `Claim updated to ${humanize(data.get('verificationStatus'))}.`); } catch (error) { setStatus(status, error.message, true); }
});
document.querySelector('#content-asset-request-form')?.addEventListener('submit', async (event) => {
  event.preventDefault(); const form = event.currentTarget; if (!form.reportValidity()) return;
  const data = new FormData(form); const itemId = data.get('itemId'); const status = document.querySelector('#content-asset-request-status');
  const payload = { provider: data.get('provider'), template_reference: data.get('templateReference') || undefined, asset_url: data.get('assetUrl') || undefined };
  if (isPreview) return setStatus(status, `Fictional preview: ${payload.provider} asset requested for ${itemId}.`);
  try { const result = await api(`/api/content/items/${encodeURIComponent(itemId)}/assets`, { method: 'POST', headers: { 'X-CSRF-Token': csrfToken }, body: JSON.stringify(payload) }); setStatus(status, `Asset request saved (ID ${result.id}, ${humanize(result.renderStatus)})${result.renderStatus === 'not_requested' ? ' — use its ID below to request a render.' : '.'}`); form.reset(); } catch (error) { setStatus(status, error.message, true); }
});
document.querySelector('#content-asset-render-form')?.addEventListener('submit', async (event) => {
  event.preventDefault(); const form = event.currentTarget; if (!form.reportValidity()) return;
  const data = new FormData(form); const assetId = data.get('assetId'); const status = document.querySelector('#content-asset-render-status');
  let fields = {}; const raw = String(data.get('fields') || '').trim();
  if (raw) { try { fields = JSON.parse(raw); } catch { return setStatus(status, 'Template fields must be valid JSON.', true); } }
  if (isPreview) return setStatus(status, `Fictional preview: render requested for asset ${assetId}.`);
  try { const result = await api(`/api/content/assets/${encodeURIComponent(assetId)}/render`, { method: 'POST', headers: { 'X-CSRF-Token': csrfToken }, body: JSON.stringify({ fields }) }); setStatus(status, `Render status: ${humanize(result.renderStatus)}${result.reason ? ` (${result.reason})` : ''}.`); } catch (error) { setStatus(status, error.message, true); }
});
document.querySelector('#content-item-create-form')?.addEventListener('submit', async (event) => {
  event.preventDefault(); const form = event.currentTarget; if (!form.reportValidity()) return;
  const data = new FormData(form); const planId = data.get('planId'); const status = document.querySelector('#content-item-create-status');
  if (isPreview) return setStatus(status, `Fictional preview: content item "${data.get('topic')}" saved.`);
  try { const result = await api(`/api/content/plans/${encodeURIComponent(planId)}/items`, { method: 'POST', headers: { 'X-CSRF-Token': csrfToken }, body: JSON.stringify({ topic: data.get('topic'), pillar: data.get('pillar') || undefined }) }); setStatus(status, `Item saved (ID ${result.id}).`); form.reset(); } catch (error) { setStatus(status, error.message, true); }
});
document.querySelector('#content-item-status-form')?.addEventListener('submit', async (event) => {
  event.preventDefault(); const form = event.currentTarget; if (!form.reportValidity()) return;
  const data = new FormData(form); const itemId = data.get('itemId'); const status = document.querySelector('#content-item-status-status');
  if (isPreview) return setStatus(status, `Fictional preview: item ${itemId} moved to ${data.get('status')}.`);
  try { await api(`/api/content/items/${encodeURIComponent(itemId)}/status`, { method: 'PATCH', headers: { 'X-CSRF-Token': csrfToken }, body: JSON.stringify({ status: data.get('status') }) }); setStatus(status, `Item updated to ${humanize(data.get('status'))}.`); } catch (error) { setStatus(status, error.message, true); }
});
document.querySelector('#content-approval-form')?.addEventListener('submit', async (event) => {
  event.preventDefault(); const form = event.currentTarget; if (!form.reportValidity()) return;
  const data = new FormData(form); const itemId = data.get('itemId'); const decision = data.get('decision'); const status = document.querySelector('#content-approval-status');
  // There is no standalone "record a decision" endpoint - a decision is recorded as a
  // side effect of PATCH /items/:id/status when the target status is approved, rejected,
  // or revision_requested (see functions/api/content/[[path]].js patchItemStatus).
  const payload = { status: decision, comment: data.get('comment') || undefined };
  if (isPreview) return setStatus(status, `Fictional preview: decision "${decision}" recorded for ${itemId}.`);
  try { await api(`/api/content/items/${encodeURIComponent(itemId)}/status`, { method: 'PATCH', headers: { 'X-CSRF-Token': csrfToken }, body: JSON.stringify(payload) }); setStatus(status, `Decision recorded — item moved to ${humanize(decision)}.`); form.reset(); } catch (error) { setStatus(status, error.message, true); }
});
document.querySelector('#platform-variant-form')?.addEventListener('submit', async (event) => {
  event.preventDefault(); const form = event.currentTarget; if (!form.reportValidity()) return;
  const data = new FormData(form); const itemId = data.get('itemId'); const status = document.querySelector('#platform-variant-status');
  const payload = { platform: data.get('platform'), caption: data.get('caption') || undefined };
  if (isPreview) return setStatus(status, `Fictional preview: ${payload.platform} variant saved for ${itemId}.`);
  try { const result = await api(`/api/content/items/${encodeURIComponent(itemId)}/platform-variants`, { method: 'POST', headers: { 'X-CSRF-Token': csrfToken }, body: JSON.stringify(payload) }); setStatus(status, `Variant saved (ID ${result.id}).`); form.reset(); } catch (error) { setStatus(status, error.message, true); }
});
document.querySelector('#publish-variant-form')?.addEventListener('submit', async (event) => {
  event.preventDefault(); const form = event.currentTarget; if (!form.reportValidity()) return;
  const variantId = new FormData(form).get('variantId'); const status = document.querySelector('#publish-variant-status'); const output = document.querySelector('#publish-variant-result');
  if (isPreview) return setStatus(status, `Fictional preview: variant ${variantId} publish attempted (no real platform call in preview).`);
  try {
    const result = await api(`/api/content/variants/${encodeURIComponent(variantId)}/publish`, { method: 'POST', headers: { 'X-CSRF-Token': csrfToken } });
    setStatus(status, result.status === 'published' ? 'Published.' : `Publishing job ${humanize(result.status || 'submitted')}${result.failureCode ? ` — ${humanize(result.failureCode)}` : ''}.`, result.status !== 'published');
    if (result.exportPackage) { output.hidden = false; output.textContent = JSON.stringify(result.exportPackage, null, 2); } else { output.hidden = true; }
  } catch (error) { setStatus(status, error.message, true); }
});
document.querySelector('#verify-job-form')?.addEventListener('submit', async (event) => {
  event.preventDefault(); const form = event.currentTarget; if (!form.reportValidity()) return;
  const data = new FormData(form); const jobId = data.get('jobId'); const status = document.querySelector('#verify-job-status');
  if (isPreview) return setStatus(status, `Fictional preview: evidence recorded for job ${jobId} (verification_pending).`);
  try { await api(`/api/content/jobs/${encodeURIComponent(jobId)}/verify`, { method: 'PATCH', headers: { 'X-CSRF-Token': csrfToken }, body: JSON.stringify({ external_post_id: data.get('externalPostId') }) }); setStatus(status, 'Evidence recorded (verification_pending) - this is not an automated live check, no provider-verification adapter exists yet.'); form.reset(); } catch (error) { setStatus(status, error.message, true); }
});

// -------------------------------------------------------------------------------------
// Content review queue / calendar / publishing jobs / analytics.
//
// There is no single "all clients' content items" endpoint - the content router only
// exposes GET /api/content/clients/:clientId/items (per client). This aggregates that
// endpoint across every client already loaded into adminData.clients, the same approach
// the Client Detail view uses. There is deliberately no attempt to build the Publishing
// jobs table or the Analytics metric lists this way: the content router has no GET route
// at all for publishing_jobs or content_metrics (only POST/PATCH to create or verify
// them), so those two panels stay honest placeholders rather than invented backend calls.
// -------------------------------------------------------------------------------------

function clientNameById(clientId) { const client = (adminData?.clients || []).find((c) => c.id === clientId); return client ? client.name : clientId; }

// Same "pick by name, id travels in the option value" pattern as populateServiceSelects,
// applied to every Item ID field that used to be typed by hand across Content
// Intelligence, Approvals, and Publishing - all backed by the one real, already-fetched
// allContentItems list (see loadContentIntelligence() below).
function populateContentItemSelects() {
  document.querySelectorAll('.content-item-select').forEach((select) => {
    const previous = select.value;
    select.replaceChildren(emptyOption(allContentItems.length ? 'Select a content item…' : 'No content items yet'));
    allContentItems.forEach((item) => { const opt = textElement('option', `${clientNameById(item.client_id)} — ${item.topic}`); opt.value = item.id; select.append(opt); });
    if (allContentItems.some((item) => item.id === previous)) select.value = previous;
  });
}

function renderContentQueueCounts(items) {
  const container = document.querySelector('#content-queue-counts'); if (!container) return; container.replaceChildren();
  [
    ['Awaiting E4LA review', items.filter((item) => item.status === 'e4la_review').length, true],
    ['Awaiting client review', items.filter((item) => item.status === 'client_review').length, true],
    ['Scheduled', items.filter((item) => ['scheduled', 'publishing'].includes(item.status)).length, false],
    ['Published', items.filter((item) => ['published', 'verified_live'].includes(item.status)).length, false],
  ].forEach(([label, value, needsAttention]) => { const card = element('div', ['ops-card', 'ops-kpi', needsAttention && value > 0 ? 'admin-kpi-glow' : ''].filter(Boolean).join(' ')); card.append(textElement('span', label, 'ops-kpi__label'), textElement('strong', String(value), 'ops-kpi__value')); container.append(card); });
}

function renderContentQueue(items) {
  const tbody = document.querySelector('#admin-content-queue-table'); if (!tbody) return;
  const queue = items.filter((item) => ['e4la_review', 'client_review'].includes(item.status));
  tbody.replaceChildren();
  queue.forEach((item) => {
    const row = document.createElement('tr');
    [clientNameById(item.client_id), item.topic, '—', humanize(item.status), humanize(item.risk_level)].forEach((value) => row.append(textElement('td', value)));
    const actionCell = document.createElement('td'); const open = textElement('button', 'Review', 'ops-link-button'); open.type = 'button';
    open.addEventListener('click', () => { const form = document.querySelector('#content-approval-form'); if (form?.elements.itemId) form.elements.itemId.value = item.id; activateView('approvals'); });
    actionCell.append(open); row.append(actionCell); tbody.append(row);
  });
  if (!queue.length) { const row = document.createElement('tr'); const cell = textElement('td', 'Nothing is currently awaiting review.', 'admin-table__empty'); cell.colSpan = 6; row.append(cell); tbody.append(row); }
  setText('content-queue-status', `${queue.length} awaiting review`);
}

function renderCalendar(items, filterText = '') {
  const list = document.querySelector('#admin-calendar-list'); if (!list) return; list.replaceChildren();
  const needle = filterText.trim().toLowerCase();
  const scheduled = items
    .filter((item) => ['scheduled', 'publishing', 'published', 'verified_live'].includes(item.status))
    .filter((item) => !needle || item.client_id.toLowerCase().includes(needle) || clientNameById(item.client_id).toLowerCase().includes(needle))
    .sort((a, b) => String(a.scheduled_date || '9999').localeCompare(String(b.scheduled_date || '9999')));
  scheduled.forEach((item) => { const li = element('li', 'ops-list__item'); const copy = document.createElement('div'); copy.append(textElement('p', item.topic, 'ops-list__title'), textElement('p', `${clientNameById(item.client_id)} · ${item.scheduled_date || 'No date set'}`, 'ops-list__meta')); li.append(copy, textElement('span', humanize(item.status), 'ops-status')); list.append(li); });
  if (!scheduled.length) list.append(emptyState('Nothing scheduled', needle ? 'No scheduled or published items match this filter.' : 'Scheduled and recently published content will appear here.'));
}

document.querySelector('#calendar-client-filter')?.addEventListener('change', (event) => renderCalendar(allContentItems, event.target.value));

function renderPublishingJobsPlaceholder() {
  const tbody = document.querySelector('#admin-publishing-jobs-table'); if (!tbody) return; tbody.replaceChildren();
  const row = document.createElement('tr'); const cell = textElement('td', "No endpoint currently lists publishing jobs. Track a job's status from the result shown right after you publish a variant above, or via a job's ID through /jobs/:id/verify.", 'admin-table__empty'); cell.colSpan = 4; row.append(cell); tbody.append(row);
}

function renderAnalyticsPlaceholder() {
  // No endpoint currently exposes content_metrics (only POST/PATCH publishing routes
  // write it - see the comment above loadContentIntelligence). These three categories
  // therefore always render reporting-charts.js's own honest empty state rather than the
  // ad hoc emptyState() used elsewhere in this file, so this genuinely-unavailable data
  // reads as part of the same chart system as the lifecycle chart beside it, not as a
  // separate kind of "nothing here."
  const copy = {
    'metrics-direct-list': 'Direct metrics (clicks, forms, calls, bookings, attributable conversions) are recorded via a publishing job, but no endpoint currently reads them back for display.',
    'metrics-assisted-list': 'Assisted metrics (profile visits, branded search, service-page visits) are recorded via a publishing job, but no endpoint currently reads them back for display.',
    'metrics-engagement-list': 'Engagement metrics (reach, impressions, saves, shares, comments) are recorded via a publishing job, but no endpoint currently reads them back for display.',
  };
  Object.entries(copy).forEach(([id, message]) => {
    const container = document.querySelector(`#${id}`); if (!container) return;
    renderChartEmptyState(container, { copy: message });
  });
}

async function loadContentIntelligence() {
  renderPublishingJobsPlaceholder(); renderAnalyticsPlaceholder();
  if (isPreview) {
    renderContentQueueCounts([]); setText('content-queue-status', 'Fictional preview data');
    const tbody = document.querySelector('#admin-content-queue-table');
    if (tbody) { tbody.replaceChildren(); const row = document.createElement('tr'); const cell = textElement('td', 'Content items are only available against a real client from the API.', 'admin-table__empty'); cell.colSpan = 6; row.append(cell); tbody.append(row); }
    document.querySelector('#admin-calendar-list')?.replaceChildren(emptyState('Fictional preview only', 'The content calendar loads from the live API.'));
    setText('content-lifecycle-status', 'Fictional preview data');
    renderContentLifecycle(document.querySelector('#content-lifecycle-chart'), []);
    populateContentItemSelects();
    return;
  }
  const clients = adminData?.clients || []; if (!clients.length) return;
  const perClient = await Promise.all(clients.map(async (client) => {
    try { const result = await api(`/api/content/clients/${encodeURIComponent(client.id)}/items`); return result.items || []; } catch { return []; }
  }));
  allContentItems = perClient.flat();
  populateContentItemSelects();
  renderContentQueueCounts(allContentItems);
  renderContentQueue(allContentItems);
  renderCalendar(allContentItems, document.querySelector('#calendar-client-filter')?.value || '');
  // Real data, aggregated the same way renderContentQueue/renderContentQueueCounts
  // already aggregate allContentItems across every client (there is no single
  // "all clients" content_items endpoint - see the note above this section).
  setText('content-lifecycle-status', `${allContentItems.length} item${allContentItems.length === 1 ? '' : 's'} across all clients`);
  renderContentLifecycle(document.querySelector('#content-lifecycle-chart'), allContentItems);
}

loadServices();

function showInvite(url) { const output = document.querySelector('#invite-output'); output.hidden = false; output.querySelector('textarea').value = url; }
// -------------------------------------------------------------------------------------
// Admin nav consolidation: the sidebar now exposes 5 top-level workspaces (Dashboard,
// Projects, Content, Payments, Activity) plus standalone Settings, each holding its
// original flat panels as sub-tabs. Every panel keeps its original `admin-X` id and
// internal markup/JS untouched - this is purely a navigation layer on top of them.
//
// PANEL_ID_BY_TAB maps a "workspace:tab" composite key to the panel id that composite
// key shows. FLAT_VIEW_ALIASES maps every ORIGINAL flat view name (the ones every
// existing activateView('quotes')/('agreements')/etc. call site throughout this file
// already passes) to its new composite key, so none of those call sites need to change -
// activateView() below resolves a flat name through this table automatically. A caller
// may also pass a composite key directly (e.g. 'projects:quotes'), which resolves without
// needing an alias entry at all, since PANEL_ID_BY_TAB is keyed by composite strings.
// (STANDALONE_PANEL_ID / PANEL_ID_BY_TAB / FLAT_VIEW_ALIASES / FLAT_VIEW_BY_COMPOSITE
// themselves are declared at the top of the file - see their own comment there.)
// -------------------------------------------------------------------------------------
function resolveView(name) {
  const key = FLAT_VIEW_ALIASES[name] || name;
  if (STANDALONE_PANEL_ID[key]) return { workspace: key, tab: null, panelId: STANDALONE_PANEL_ID[key], hashName: key };
  const [workspace, tab] = String(key).split(':');
  const panelId = PANEL_ID_BY_TAB[key];
  if (!workspace || !tab || !panelId) return resolveView('dashboard');
  return { workspace, tab, panelId, hashName: FLAT_VIEW_BY_COMPOSITE[key] || key };
}

function activateView(name, focus = true) {
  const { workspace, tab, panelId, hashName } = resolveView(name);
  document.querySelectorAll('.admin-workspace').forEach((wrap) => { wrap.hidden = wrap.dataset.workspace !== workspace; });
  document.querySelectorAll('[data-admin-panel]').forEach((panel) => { panel.hidden = panel.id !== panelId; });
  document.querySelectorAll('.admin-nav [data-admin-view]').forEach((link) => { link.toggleAttribute('aria-current', resolveView(link.dataset.adminView).workspace === workspace); });
  document.querySelectorAll('.ops-tabs [data-admin-view]').forEach((btn) => { const target = resolveView(btn.dataset.adminView); btn.setAttribute('aria-selected', String(target.workspace === workspace && target.tab === tab)); });
  history.replaceState(null, '', `#${hashName}`);
  if (focus) { const heading = document.querySelector(`#${panelId} h1`) || document.querySelector(`#${panelId} h2`); if (heading) { heading.tabIndex = -1; heading.focus(); } }
}
function applyDemoState(data, state) { if (state === 'zero') { data.clients = []; data.milestones = []; data.activity = []; data.counts = { activeClients: 0, awaitingSignature: 0, awaitingPayment: 0, actionsRequired: 0 }; } else if (state === 'single') { data.clients = data.clients.slice(0, 1); data.milestones = data.milestones.slice(0, 1); data.counts = { activeClients: 1, awaitingSignature: 0, awaitingPayment: 0, actionsRequired: 1 }; } }
function normalizeAdmin(data) { const clients = data.clients.map((client) => { const project = data.projects.find((item) => item.client_id === client.id); const agreement = data.agreements.find((item) => item.client_id === client.id); const enrollment = data.enrollments?.find((item) => item.client_id === client.id); return { id: client.id, name: client.display_name || client.legal_name, legalName: client.legal_name, billingEmail: client.billing_email, phone: client.phone, lifecycleCode: client.lifecycle_status, lifecycle: humanize(client.lifecycle_status), project: project?.name || 'Not assigned', projectId: project?.id, agreement: humanize(agreement?.status || 'not prepared'), agreementId: agreement?.id, payment: humanize(enrollment?.status || 'not started'), plan: enrollment?.payment_plan_name || 'Not selected', paid: Number(enrollment?.paid_amount || 0), total: Number(enrollment?.total_contract_value || 0), nextPayment: enrollment?.next_payment_due_at ? formatDate(enrollment.next_payment_due_at) : '—', portal: enrollment?.portal_activated_at ? 'Active' : 'Pending', enrollmentId: enrollment?.id, action: deriveAction(client, agreement, enrollment) }; }); return { counts: { activeClients: clients.filter((client) => ['Active','Project Active','Work In Progress'].includes(client.lifecycle)).length, awaitingSignature: data.agreements.filter((agreement) => ['sent','viewed'].includes(agreement.status)).length, awaitingPayment: (data.enrollments || []).filter((enrollment) => !['paid','activated','completed','schedule_active'].includes(enrollment.status)).length, actionsRequired: clients.filter((client) => client.action !== 'None').length }, clients, milestones: (data.milestones || []).map((item) => ({ title: item.title, client: item.client_name || 'Client', date: item.target_date ? formatDate(item.target_date) : 'Date pending' })), activity: (data.activity || []).map((item) => ({ type: item.event_type, client: item.client_name, date: formatDate(item.created_at), detail: 'Recorded operational event' })) }; }
function deriveAction(client, agreement, enrollment) { if (!agreement) return 'Prepare agreement'; if (['sent','viewed'].includes(agreement.status)) return 'Agreement follow-up'; if (enrollment && ['payment_failed','payment_action_required','attention_required'].includes(enrollment.status)) return 'Payment needs attention'; if (enrollment && !enrollment.portal_activated_at && ['paid','first_payment_confirmed','schedule_active'].includes(enrollment.status)) return 'Review portal activation'; return 'None'; }
async function api(url, options = {}) { const { headers = {}, ...rest } = options; const response = await fetch(url, { credentials: 'same-origin', ...rest, headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...headers } }); const payload = await response.json().catch(() => ({})); if (!response.ok) throw new Error(payload.error?.message || 'Admin access could not be verified.'); return payload; }
function renderFatal(copy) { document.querySelector('#admin-main').replaceChildren(emptyState('Admin access is not active', `${copy} Complete the preview identity configuration, then retry.`)); }
function setStatus(node, message, isError = false) { node.textContent = message; node.dataset.error = String(isError); }
function emptyState(title, copy) { const box = element('div', 'ops-card ops-empty'); box.append(textElement('div', '◇', 'ops-empty__icon'), textElement('h3', title), textElement('p', copy)); return box; }
function element(tag, className) { const node = document.createElement(tag); if (className) node.className = className; return node; }
function textElement(tag, text, className) { const node = element(tag, className); node.textContent = text; return node; }
function setText(id, value) { const node = document.getElementById(id); if (node) node.textContent = value; }
function humanize(value) { return String(value || '').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function formatDate(value) { if (!value) return '—'; return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(value)); }
function reducedMotion() { return matchMedia('(prefers-reduced-motion: reduce)').matches; }
