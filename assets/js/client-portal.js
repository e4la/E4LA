import { analyticsEvent, demoStateFromUrl, formatMoney, isSafeProductPreview, samplePortal } from './ops-model.js';

const isPreview = isSafeProductPreview();
const previewParameters = new URLSearchParams(location.search);
let csrfToken = '';
let portal = null;

async function boot() {
  try {
    if (isPreview) {
      document.querySelector('#fictional-preview').hidden = false;
      document.querySelector('#portal-access-state').textContent = 'Product preview';
      portal = structuredClone(samplePortal);
      applyDemoState(portal, demoStateFromUrl());
      if (previewParameters.get('preview') === 'admin') showAdminPreview();
    } else if (previewParameters.get('preview') === 'admin' && previewParameters.get('client')) {
      const session = await ensureSession('admin');
      csrfToken = session.csrfToken;
      portal = normalizePortal((await api(`/api/ops/admin/preview/${encodeURIComponent(previewParameters.get('client'))}`)).portal);
      showAdminPreview();
    } else {
      const session = await ensureSession('client');
      csrfToken = session.csrfToken;
      portal = normalizePortal(await api('/api/ops/portal'));
      document.querySelector('#portal-signout').hidden = false;
    }
    renderPortal(portal);
    analyticsEvent('portal_viewed', { surface: 'portal' });
  } catch (error) {
    renderFatal(error.message || 'Sign in through your E4LA access link to view this portal.');
  }
}

async function ensureSession(surface) {
  try { return await api('/api/ops/session'); }
  catch { return api(`/api/ops/auth/${surface}`, { method: 'POST', body: JSON.stringify({}) }); }
}

function renderPortal(data) {
  document.querySelector('#portal-shell').setAttribute('aria-busy', 'false');
  document.querySelector('#portal-loading').hidden = true;
  if (!data.project) {
    document.querySelector('#portal-app').hidden = false;
    document.querySelector('#portal-app').replaceChildren(emptyState('Your portal is being prepared', 'E4LA will activate your project view after the agreement, initial payment, and onboarding requirements are complete.', 'Contact E4LA', 'mailto:hello@e4la.org'));
    return;
  }
  document.querySelector('#portal-app').hidden = false;
  setText('portal-client-name', `${data.client?.name || 'client'}.`);
  setText('project-title', data.project.name);
  setText('project-summary', data.project.summary || 'E4LA will publish the engagement summary here.');
  setText('project-phase', data.project.currentPhase || 'To be confirmed');
  setText('project-start', formatDate(data.project.startDate));
  setText('project-target', formatDate(data.project.targetEndDate));
  const next = data.milestones.find((item) => ['active','in_progress','planned','waiting'].includes(item.status));
  setText('project-next', next?.title || (data.project.status === 'completed' ? 'Engagement complete' : 'To be confirmed'));
  const completed = data.project.status === 'completed';
  setText('project-status', completed ? 'Completed' : humanize(data.project.status || 'active'));
  setText('portal-engagement-status', completed ? 'Engagement completed' : 'Engagement active');
  document.querySelector('#project-status').className = `ops-status ${completed ? 'ops-status--complete' : 'ops-status--active'}`;

  const action = document.querySelector('#client-action');
  const clear = document.querySelector('#client-clear');
  action.hidden = !data.action?.required; clear.hidden = Boolean(data.action?.required);
  if (data.action?.required) { setText('client-action-title', data.action.title); setText('client-action-copy', data.action.detail); }
  renderWork('current-work', data.currentWork || []);
  renderWork('project-updates', data.currentWork || []);
  renderTimeline('portal-timeline', data.milestones || [], 4);
  renderTimeline('project-timeline-full', data.milestones || []);
  renderDocuments('completed-work', data.deliverables || [], 3);
  renderDocuments('deliverables-all', data.deliverables || []);
  renderDocuments('reports-all', data.reports || [], Infinity, true);
  renderAgreement(data.agreement);
  renderBilling(data.billing || {});
  renderProgressOverview(data.progress || {});
  renderRoadmap(data.roadmap || []);
  renderWeeklyChart(data.weeklyProgress || []);
  renderPerformanceMetrics(data.performanceMetrics || []);
  const requestedTab = location.hash.replace('#', '');
  if (portalSections.includes(requestedTab)) activateTab(requestedTab, false);
}

function renderWork(id, items) {
  const container = document.getElementById(id); container.replaceChildren();
  if (!items.length) { container.append(emptyState('No current work published', 'E4LA will publish a concise client-facing update after review.')); return; }
  items.forEach((item) => {
    const article = element('article', 'dashboard-work__item');
    const meta = element('div', 'dashboard-work__meta');
    meta.append(textElement('span', item.status || 'In progress'), textElement('span', item.owner || 'E4LA'));
    article.append(textElement('strong', item.title), textElement('p', item.detail), meta); container.append(article);
  });
}

function renderTimeline(id, items, limit = Infinity) {
  const container = document.getElementById(id); container.replaceChildren();
  if (!items.length) { container.append(emptyState('Timeline coming soon', 'Published project milestones will appear here.')); return; }
  items.slice(0, limit).forEach((item) => {
    const mapped = item.status === 'completed' ? 'done' : item.status === 'in_progress' ? 'active' : item.status;
    const li = element('li', `ops-timeline__item ops-timeline__item--${mapped}`);
    const dot = element('span', 'ops-timeline__dot'); dot.setAttribute('aria-hidden', 'true');
    const copy = document.createElement('div'); copy.append(textElement('h3', item.title), textElement('p', item.detail));
    li.append(dot, copy); container.append(li);
  });
}

function renderDocuments(id, items, limit = Infinity, reports = false) {
  const container = document.getElementById(id); container.replaceChildren();
  if (!items.length) {
    container.append(emptyState(reports ? 'No reports published yet' : 'No deliverables published yet', reports ? 'Reports will appear after E4LA completes and approves the relevant reporting period.' : 'Reviewed and approved client-facing work will appear here.'));
    return;
  }
  items.slice(0, limit).forEach((item) => {
    const article = element('article', 'dashboard-doc');
    const top = element('div', 'dashboard-doc__top');
    top.append(textElement('span', item.type || (reports ? 'Report' : 'Deliverable'), 'dashboard-doc__type'), textElement('span', item.status || 'Published', 'ops-status ops-status--complete'));
    article.append(top, textElement('h3', item.title), textElement('p', item.description || 'Published for your team by E4LA.'), textElement('span', `${item.version || 'Current version'} · ${item.date || 'Published'}`, 'dashboard-doc__date'));
    if (item.externalUrl) {
      const link = textElement('a', item.externalUrl.startsWith('#sample') ? 'Preview document' : 'Open document', 'ops-button ops-button--secondary dashboard-doc__action');
      link.href = item.externalUrl; if (!item.externalUrl.startsWith('#')) { link.target = '_blank'; link.rel = 'noopener noreferrer'; }
      link.addEventListener('click', (event) => { analyticsEvent('deliverable_viewed', { surface: 'portal' }); if (item.externalUrl.startsWith('#sample')) { event.preventDefault(); showToast('Fictional preview: no document file is attached.'); } });
      article.append(link);
    } else article.append(textElement('span', 'File access will appear when attached', 'dashboard-doc__unavailable'));
    container.append(article);
  });
}

function renderAgreement(agreement) {
  setText('portal-agreement-name', agreement?.name || 'No accepted agreement available');
  setText('portal-agreement-meta', agreement ? `Version ${agreement.version || 1} · Accepted ${agreement.acceptedAt} · ${agreement.plan}` : '—');
  setText('agreement-status', agreement?.status || 'Unavailable');
  const list = document.querySelector('#agreements-all'); list.replaceChildren();
  if (!agreement) { list.append(emptyState('No accepted agreement available', 'Accepted agreement records will appear here.')); return; }
  const li = element('li', 'ops-list__item ops-list__item--agreement');
  const copy = document.createElement('div'); copy.append(textElement('p', agreement.name, 'ops-list__title'), textElement('p', `Version ${agreement.version || 1} · Accepted ${agreement.acceptedAt} · ${agreement.plan}`, 'ops-list__meta'));
  const side = element('div', 'ops-list__actions'); side.append(textElement('span', agreement.status || 'Accepted', 'ops-status ops-status--complete'));
  if (agreement.documentUrl) { const link = textElement('a', 'Open final agreement', 'ops-link-button'); link.href = agreement.documentUrl; side.append(link); }
  else side.append(textElement('span', 'Final PDF pending', 'ops-list__meta'));
  li.append(copy, side); list.append(li);
}

function renderBilling(billing) {
  const percent = billing.total ? Math.round((billing.paid / billing.total) * 100) : 0;
  document.querySelector('#billing-progress').value = Math.min(percent, 100);
  setText('billing-paid', `${formatMoney(billing.paid || 0)} paid`); setText('billing-total', `${formatMoney(billing.total || 0)} total`);
  const nextCopy = billing.nextPayment ? `Next contractual payment: ${formatMoney(billing.nextAmount)} on ${billing.nextPayment}` : 'No upcoming contractual payment is scheduled.';
  setText('billing-next', nextCopy);
  const label = billingStatus(billing.status);
  ['billing-status','billing-full-status'].forEach((id) => { setText(id, label); document.getElementById(id).className = `ops-status ${['Needs attention','Payment failed'].includes(label) ? 'ops-status--attention' : 'ops-status--complete'}`; });
  const summary = document.querySelector('#billing-summary'); summary.replaceChildren();
  [['Program fee', formatMoney(billing.total || 0)], ['Payment schedule', billing.planName || 'See accepted agreement'], ['Payments completed', `${billing.completedPayments ?? '—'} of ${billing.installmentCount ?? '—'}`], ['Remaining balance', formatMoney(Math.max(0, (billing.total || 0) - (billing.paid || 0)))], ['Next payment', billing.nextPayment ? `${formatMoney(billing.nextAmount)} · ${billing.nextPayment}` : 'None scheduled']].forEach(([term, value]) => { const row = document.createElement('div'); row.append(textElement('dt', term), textElement('dd', value)); summary.append(row); });
}

const PROGRESS_RING_CIRCUMFERENCE = 2 * Math.PI * 52;

function renderProgressOverview(progress) {
  const hasPercent = typeof progress.percentComplete === 'number';
  const percent = hasPercent ? Math.max(0, Math.min(100, progress.percentComplete)) : 0;
  const ring = document.querySelector('#progress-ring-value');
  ring.style.strokeDashoffset = String(PROGRESS_RING_CIRCUMFERENCE * (1 - (hasPercent ? percent / 100 : 0)));
  ring.style.opacity = hasPercent ? '1' : '0.18';
  setText('progress-percent-text', hasPercent ? `${percent}%` : '—');
  setText('progress-qualitative-text', progress.qualitativeState || 'In progress');
  setText('progress-current-phase', progress.currentPhaseName || 'To be confirmed');
  setText('progress-phase-count', `${progress.completedPhaseCount ?? 0} of ${progress.totalPhaseCount ?? 0}`);
  setText('progress-next-phase', progress.nextPhaseName || (progress.statusLabel === 'Completed' ? 'None — engagement complete' : 'To be confirmed'));
  setText('progress-remaining-milestones', String(progress.remainingMilestoneCount ?? '—'));
  const statusLabel = document.querySelector('#progress-status-label');
  setText('progress-status-label', progress.statusLabel || 'On Track');
  statusLabel.className = `ops-status ${progress.statusLabel === 'Needs Attention' ? 'ops-status--attention' : 'ops-status--complete'}`;
}

function renderRoadmap(phases) {
  const list = document.querySelector('#portal-roadmap');
  list.replaceChildren();
  if (!phases.length) { list.append(emptyState('Roadmap coming soon', 'E4LA will publish the engagement roadmap here once phases are confirmed.')); return; }
  phases.slice().sort((a, b) => a.sequence - b.sequence).forEach((phase, index) => {
    const item = element('li', `portal-roadmap__phase portal-roadmap__phase--${phase.status.replace('_', '-')}`);
    item.append(textElement('span', phase.status === 'completed' ? '✓' : String(index + 1), 'portal-roadmap__index'));
    item.append(textElement('h3', phase.name, 'portal-roadmap__name'));
    const dateRange = phase.targetStartDate || phase.targetEndDate
      ? `${formatDate(phase.targetStartDate)} – ${formatDate(phase.targetEndDate)}` : 'Timing to be confirmed';
    item.append(textElement('p', `${humanize(phase.status)} · ${phase.completedMilestoneCount}/${phase.milestoneCount} milestones`, 'portal-roadmap__meta'));
    item.append(textElement('p', dateRange, 'portal-roadmap__meta'));
    if (phase.clientActionRequired) item.append(textElement('span', phase.clientActionNote || 'Client action needed', 'portal-roadmap__action'));
    list.append(item);
  });
}

function renderWeeklyChart(weeks) {
  const container = document.querySelector('#portal-weekly-chart');
  container.replaceChildren();
  if (!weeks.length) { container.append(textElement('p', 'Not enough progress history yet. E4LA will publish weekly progress once a few weeks of work are complete.', 'portal-chart__empty')); return; }
  const chart = element('div', 'portal-chart');
  const sorted = weeks.slice().sort((a, b) => a.weekNumber - b.weekNumber);
  sorted.forEach((week, index) => {
    const pct = typeof week.percentComplete === 'number' ? Math.max(0, Math.min(100, week.percentComplete)) : 0;
    const col = element('div', `portal-chart__col${index === sorted.length - 1 ? ' portal-chart__col--latest' : ''}`);
    col.append(textElement('span', `${pct}%`, 'portal-chart__pct'));
    const track = element('div', 'portal-chart__bar-track');
    const bar = element('div', 'portal-chart__bar'); bar.style.height = `${Math.max(pct, 2)}%`;
    bar.setAttribute('role', 'img'); bar.setAttribute('aria-label', `Week ${week.weekNumber}: ${pct}% complete`);
    track.append(bar); col.append(track);
    col.append(textElement('span', `Wk ${week.weekNumber}`, 'portal-chart__label'));
    chart.append(col);
  });
  container.append(chart);
}

function renderPerformanceMetrics(metrics) {
  const container = document.querySelector('#portal-performance-metrics');
  container.replaceChildren();
  if (!metrics.length) { container.append(textElement('p', 'Performance metrics will appear here once E4LA publishes results for this engagement.', 'portal-metrics__empty')); return; }
  const trendGlyph = { up: '↑', down: '↓', flat: '→' };
  metrics.forEach((metric) => {
    const tile = element('div', 'portal-metric');
    tile.append(textElement('p', metric.label, 'portal-metric__label'));
    const row = element('div', 'portal-metric__value-row');
    row.append(textElement('span', metric.currentValue, 'portal-metric__value'));
    if (metric.trend) row.append(textElement('span', `${trendGlyph[metric.trend] || ''} ${humanize(metric.trend)}`, `portal-metric__trend portal-metric__trend--${metric.trend}`));
    tile.append(row);
    if (metric.baselineValue) tile.append(textElement('p', `vs. ${metric.baselineValue}`, 'portal-metric__baseline'));
    if (metric.interpretation) tile.append(textElement('p', metric.interpretation, 'portal-metric__interpretation'));
    container.append(tile);
  });
}

const portalTabs = [...document.querySelectorAll('[data-portal-tab]')];
const portalSections = ['overview','project','deliverables','reports','agreements','billing'];
portalTabs.forEach((tab) => {
  tab.tabIndex = tab.dataset.portalTab === 'overview' ? 0 : -1;
  tab.addEventListener('click', () => activateTab(tab.dataset.portalTab));
  tab.addEventListener('keydown', (event) => {
    if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
    event.preventDefault(); const index = portalTabs.indexOf(tab);
    const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? portalTabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + portalTabs.length) % portalTabs.length;
    activateTab(portalTabs[nextIndex].dataset.portalTab);
  });
});
document.querySelectorAll('[data-open-tab]').forEach((button) => button.addEventListener('click', () => activateTab(button.dataset.openTab)));
document.querySelector('#billing-portal-full').addEventListener('click', openBilling);
document.querySelector('#portal-signout').addEventListener('click', logout);

boot();

function activateTab(name, focus = true) {
  portalTabs.forEach((tab) => { const active = tab.dataset.portalTab === name; tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1; });
  portalSections.forEach((section) => { document.getElementById(`portal-${section}`).hidden = section !== name; });
  history.replaceState(null, '', `${location.pathname}${location.search}#${name}`);
  if (focus) document.querySelector(`[data-portal-tab="${name}"]`)?.focus();
}

async function openBilling() {
  const button = document.querySelector('#billing-portal-full'); const status = document.querySelector('#billing-portal-status');
  if (isPreview) { showToast('Fictional preview: Stripe Customer Portal is intentionally inactive.'); return; }
  button.disabled = true; status.textContent = 'Opening secure Stripe billing…';
  try { location.assign((await api('/api/ops/billing/portal', { method: 'POST', headers: { 'X-CSRF-Token': csrfToken } })).portalUrl); }
  catch (error) { status.textContent = `${error.message} Try again or contact E4LA.`; button.disabled = false; }
}

async function logout() {
  try { await api('/api/ops/session/logout', { method: 'POST', headers: { 'X-CSRF-Token': csrfToken }, body: '{}' }); location.assign('/cdn-cgi/access/logout'); }
  catch (error) { showToast(error.message); }
}

function applyDemoState(data, state) {
  if (state === 'empty') { data.project = null; return; }
  if (state === 'no-deliverables') { data.deliverables = []; data.reports = []; data.action.required = false; }
  if (state === 'completed') {
    data.project.status = 'completed'; data.project.currentPhase = 'Engagement complete'; data.action.required = false;
    data.currentWork = []; data.milestones.forEach((item) => { item.status = 'completed'; });
    data.billing.paid = data.billing.total; data.billing.completedPayments = data.billing.installmentCount; data.billing.nextPayment = null;
    data.roadmap.forEach((phase) => { phase.status = 'completed'; phase.completedMilestoneCount = phase.milestoneCount; phase.clientActionRequired = false; });
    data.progress = { ...data.progress, percentComplete: 100, qualitativeState: 'Complete', currentPhaseName: null, completedPhaseCount: data.progress.totalPhaseCount, nextPhaseName: null, remainingMilestoneCount: 0, statusLabel: 'Completed' };
  }
  if (state === 'no-progress-history') data.weeklyProgress = [];
  if (state === 'no-metrics') data.performanceMetrics = [];
  if (state === 'no-roadmap') { data.roadmap = []; data.progress = { ...data.progress, percentComplete: null, currentPhaseName: null, completedPhaseCount: 0, totalPhaseCount: 0, nextPhaseName: null, qualitativeState: 'In progress' }; }
}

function showAdminPreview() {
  const banner = element('div', 'admin-preview-banner'); banner.append(textElement('span', 'ADMIN PREVIEW — CLIENT VIEW'), textElement('span', 'Only currently published information is shown.', 'admin-preview-banner__copy'));
  const exit = textElement('a', 'Exit preview'); exit.href = '/admin/?demo=1#portals'; banner.append(exit); document.body.prepend(banner);
}

function normalizePortal(data) {
  if (!data.project) return { project: null };
  const reports = data.deliverables.filter((item) => item.deliverable_type === 'report');
  const firstAgreement = data.agreements[0]; const installmentAmounts = parseJson(data.enrollment?.installment_amounts_json, []);
  return {
    client: { name: data.client?.display_name || data.client?.legal_name || 'client' },
    project: { name: data.project.name, status: data.project.status, currentPhase: data.project.current_phase, startDate: data.project.start_date, targetEndDate: data.project.target_end_date, summary: data.project.summary },
    action: data.updates.find((item) => item.update_type === 'client_request') ? { required: true, title: data.updates.find((item) => item.update_type === 'client_request').title || 'Client action required', detail: data.updates.find((item) => item.update_type === 'client_request').body } : { required: false },
    currentWork: data.updates.filter((item) => item.update_type !== 'client_request').map((item) => ({ title: item.title, detail: item.body, status: item.update_type === 'reporting' ? 'Reporting' : 'In progress', owner: 'E4LA' })),
    milestones: data.milestones.map((item) => ({ title: item.title, detail: item.description || (item.completed_at ? `Completed ${formatDate(item.completed_at)}` : item.target_date ? `Target ${formatDate(item.target_date)}` : 'Date to be confirmed'), status: item.status === 'in_progress' ? 'active' : item.status })),
    deliverables: data.deliverables.filter((item) => item.deliverable_type !== 'report').map(normalizeDocument), reports: reports.map(normalizeDocument),
    agreement: firstAgreement ? { name: firstAgreement.program_name, version: firstAgreement.version_number, acceptedAt: formatDate(firstAgreement.accepted_at), plan: data.enrollment?.payment_plan_name || 'See accepted agreement', status: humanize(firstAgreement.status), documentUrl: data.documents.find((item) => item.document_type === 'agreement')?.external_url || null } : null,
    billing: { status: data.enrollment?.status, paid: Number(data.enrollment?.paid_amount || 0), total: Number(data.enrollment?.total_contract_value || 0), completedPayments: Number(data.enrollment?.completed_payments || 0), installmentCount: installmentAmounts.length || null, planName: data.enrollment?.payment_plan_name, nextPayment: data.enrollment?.next_payment_due_at ? formatDate(data.enrollment.next_payment_due_at) : null, nextAmount: Number(data.enrollment?.next_amount || 0) },
    progress: data.progress || { percentComplete: null, qualitativeState: 'In progress', currentPhaseName: null, completedPhaseCount: 0, totalPhaseCount: 0, nextPhaseName: null, remainingMilestoneCount: 0, statusLabel: 'On Track' },
    roadmap: data.roadmap || [],
    weeklyProgress: data.weeklyProgress || [],
    performanceMetrics: data.performanceMetrics || [],
  };
}

function normalizeDocument(item) { return { title: item.title, type: humanize(item.deliverable_type), date: formatDate(item.published_at), status: 'Published', version: item.version_label || 'Current', description: item.description, externalUrl: item.external_url }; }
async function api(url, options = {}) { const { headers = {}, ...rest } = options; const response = await fetch(url, { credentials: 'same-origin', ...rest, headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...headers } }); const payload = await response.json().catch(() => ({})); if (!response.ok) throw new Error(payload.error?.message || 'The secure request could not be completed.'); return payload; }
function renderFatal(copy) { const shell = document.querySelector('#portal-main'); shell.replaceChildren(emptyState('Secure portal access is unavailable', `${copy} You can retry this page or contact E4LA for help.`, 'Retry', location.href)); }
function emptyState(title, copy, actionLabel, actionHref) { const box = element('div', 'ops-card ops-empty'); box.append(textElement('div', '◇', 'ops-empty__icon'), textElement('h3', title), textElement('p', copy)); if (actionLabel && actionHref) { const link = textElement('a', actionLabel, 'ops-button ops-button--secondary ops-mt-18'); link.href = actionHref; box.append(link); } return box; }
function showToast(message) { document.querySelector('.ops-toast')?.remove(); const toast = textElement('div', message, 'ops-toast'); toast.setAttribute('role', 'status'); document.body.append(toast); setTimeout(() => toast.remove(), 4200); }
function element(tag, className) { const node = document.createElement(tag); if (className) node.className = className; return node; }
function textElement(tag, text, className) { const node = element(tag, className); node.textContent = text; return node; }
function setText(id, value) { const node = document.getElementById(id); if (node) node.textContent = value ?? '—'; }
function humanize(value) { return String(value || '').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function billingStatus(value) { if (['payment_failed','payment_action_required','attention_required'].includes(value)) return value === 'payment_failed' ? 'Payment failed' : 'Needs attention'; if (['paid','completed'].includes(value)) return 'Paid in full'; if (['schedule_active','first_payment_confirmed','activated'].includes(value)) return 'Current'; return humanize(value || 'Pending'); }
function parseJson(value, fallback) { try { return JSON.parse(value); } catch { return fallback; } }
function formatDate(value) { if (!value) return 'To be confirmed'; const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value; return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(normalized)); }
