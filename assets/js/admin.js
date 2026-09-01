import { demoStateFromUrl, formatMoney, isSafeProductPreview, sampleAdmin } from './ops-model.js';

const isPreview = isSafeProductPreview();
let adminData = null;
let csrfToken = '';
let currentAgreementId = '';

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
  renderPayments(data.clients); renderActivity(data.activity || []); renderPreviewClients(data.clients);
  if (!data.clients.length) {
    document.querySelector('#admin-recent-clients').closest('.ops-card').replaceChildren(emptyState('No clients yet', 'Create the first fictional preview client to validate the operational workflow.'));
  }
}

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
  if (isPreview) { const client = { id: `client_preview_${Date.now()}`, name: values.displayName, lifecycle: 'Qualified Client', project: values.projectName, projectId: `prj_preview_${Date.now()}`, agreement: 'Not prepared', payment: 'Not started', portal: 'Not eligible', action: 'Prepare agreement', paid: 0, total: 0 }; adminData.clients.unshift(client); render(adminData); document.querySelector('#agreement-create-form [name="clientId"]').value = client.id; document.querySelector('#agreement-create-form [name="projectId"]').value = client.projectId; setStatus(status, 'Fictional preview client created. Continue to agreement preparation.'); activateView('agreements'); return; }
  try { const created = await api('/api/ops/admin/clients-projects', { method: 'POST', headers: { 'X-CSRF-Token': csrfToken }, body: JSON.stringify(values) }); document.querySelector('#agreement-create-form [name="clientId"]').value = created.clientId; document.querySelector('#agreement-create-form [name="projectId"]').value = created.projectId; setStatus(status, 'Client and project created. Continue with Agreement Version 1.'); activateView('agreements'); document.querySelector('#agreement-create-form [name="programName"]').focus(); } catch (error) { setStatus(status, error.message, true); }
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

document.querySelector('#project-item-form').addEventListener('submit', async (event) => { event.preventDefault(); const data = Object.fromEntries(new FormData(event.currentTarget)); const status = document.querySelector('#project-item-status'); if (!event.currentTarget.reportValidity()) return; if (isPreview) { const id = `${data.entityType}_preview_${Date.now()}`; document.querySelector('#publication-form [name="projectId"]').value = data.projectId; document.querySelector('#publication-form [name="entityType"]').value = data.entityType; document.querySelector('#publication-form [name="entityId"]').value = id; return setStatus(status, `Fictional ${humanize(data.entityType)} saved as Internal. Continue through review and publication below.`); } try { const result = await api(`/api/ops/admin/projects/${encodeURIComponent(data.projectId)}/items`, { method: 'POST', headers: { 'X-CSRF-Token': csrfToken }, body: JSON.stringify(data) }); document.querySelector('#publication-form [name="projectId"]').value = result.projectId; document.querySelector('#publication-form [name="entityType"]').value = result.entityType; document.querySelector('#publication-form [name="entityId"]').value = result.id; setStatus(status, `${humanize(result.entityType)} saved as Internal. Continue through review and publication below.`); } catch (error) { setStatus(status, error.message, true); } });
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

function showInvite(url) { const output = document.querySelector('#invite-output'); output.hidden = false; output.querySelector('textarea').value = url; }
function activateView(name, focus = true) { if (!document.querySelector(`#admin-${name}`)) name = 'dashboard'; document.querySelectorAll('[data-admin-panel]').forEach((panel) => { panel.hidden = panel.id !== `admin-${name}`; }); document.querySelectorAll('[data-admin-view]').forEach((link) => link.toggleAttribute('aria-current', link.dataset.adminView === name)); history.replaceState(null, '', `#${name}`); if (focus) { const heading = document.querySelector(`#admin-${name} h1`); if (heading) { heading.tabIndex = -1; heading.focus(); } } }
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
