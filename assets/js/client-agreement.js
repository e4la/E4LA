import { analyticsEvent, demoStateFromUrl, formatMoney, isSafeProductPreview, requiredClauseIds, sampleAgreement, validateAgreement } from './ops-model.js';

const loading = document.querySelector('#agreement-loading');
const stateView = document.querySelector('#agreement-state');
const app = document.querySelector('#agreement-app');
const form = document.querySelector('#agreement-form');
const submitButton = document.querySelector('#agreement-submit');
const formAlert = document.querySelector('#form-alert');
const formAlertCopy = document.querySelector('#form-alert-copy');
const stateAction = document.querySelector('#agreement-state-action');
const isPreview = isSafeProductPreview();
const pathParts = location.pathname.split('/').filter(Boolean);
const agreementId = pathParts[0] === 'client-agreement' ? pathParts[1] || '' : '';
const fragment = new URLSearchParams(location.hash.replace(/^#/, ''));
const inviteToken = fragment.get('invite');
const checkoutReturned = location.hash === '#checkout-returned';
const checkoutCancelled = location.hash === '#checkout-cancelled';
if (location.hash) history.replaceState(null, '', location.pathname + location.search);

let csrfToken = '';
let agreementData = null;
let selectedPlan = null;
let stateActionKind = '';

boot();

async function boot() {
  const demoState = demoStateFromUrl();
  if (isPreview) {
    if (['invalid','expired','reused','accepted','pending','returned','processing','failed','attention','confirmed','activation-pending','portal'].includes(demoState)) {
      renderState(demoState);
      return;
    }
    agreementData = structuredClone(sampleAgreement);
    renderAgreement(agreementData);
    if (demoState === 'payment') document.querySelector('#payment-plan-title').scrollIntoView();
    if (demoState === 'validation') queueMicrotask(() => { submitButton.click(); });
    if (checkoutCancelled) showInlineAlert('Stripe Checkout was canceled. Your agreement acceptance is saved, and you can return to payment when ready.');
    return;
  }
  try {
    if (inviteToken && agreementId) {
      const exchange = await api('/api/ops/invites/exchange', {
        method: 'POST', body: JSON.stringify({ agreementId, inviteToken }),
      }, false);
      csrfToken = exchange.csrfToken;
    } else {
      const session = await api('/api/ops/session');
      csrfToken = session.csrfToken;
    }
    agreementData = await api('/api/ops/agreements/current');
    renderAgreement(agreementData);
    analyticsEvent('agreement_viewed', { agreementState: agreementData.agreement.status, surface: 'agreement' });
    if (checkoutReturned) {
      analyticsEvent('checkout_returned', { result: 'returned', surface: 'agreement' });
      await watchEnrollment();
    } else if (checkoutCancelled) {
      showInlineAlert('Stripe Checkout was canceled. Your agreement acceptance is saved, and you can return to payment when ready.');
    }
  } catch (error) {
    renderApiError(error);
  }
}

function renderAgreement(data) {
  loading.hidden = true;
  stateView.hidden = true;
  app.hidden = false;
  const { agreement, client, paymentPlans } = data;
  const clientName = client?.dba || client?.legalBusinessName || '';
  document.querySelector('#agreement-title').replaceChildren(
    document.createTextNode('E4LA '), Object.assign(document.createElement('span'), { className: 'ops-gradient-text', textContent: agreement.programName || 'Growth Program' }), document.createTextNode(' Agreement'),
  );
  setText('agreement-eyebrow', clientName ? `A committed partnership with ${clientName}` : 'A committed partnership');
  setText('agreement-lede', agreement.summary?.scopeSummary || agreement.summary?.description || 'Strategic growth. Measurable progress. A committed partnership.');
  setText('summary-program', agreement.programName);
  setText('summary-term', agreement.summary.initialTerm || '90 Days');
  setText('summary-total', formatMoney(agreement.summary.totalInvestment || paymentPlans[0]?.total || 0));
  setText('summary-start', agreement.startDate ? formatDate(agreement.startDate) : 'To be confirmed');
  setText('sidebar-program', agreement.programName);
  setText('sidebar-total', formatMoney(agreement.summary.totalInvestment || paymentPlans[0]?.total || 0));
  setText('sidebar-term', agreement.summary.initialTerm || '90 days');
  document.querySelector('#legal-agreement').textContent = agreement.legalText;
  prefill(client);
  renderPlans(paymentPlans);
  renderClauses(agreement.clauses);
}

function prefill(client) {
  const values = {
    'legal-business-name': client.legalBusinessName,
    dba: client.dba,
    email: client.email,
    phone: client.phone,
    'billing-address': client.billingAddress?.line1,
    city: client.billingAddress?.city,
    state: client.billingAddress?.state,
    zip: client.billingAddress?.zip,
  };
  Object.entries(values).forEach(([id, value]) => { if (value) document.getElementById(id).value = value; });
}

function renderPlans(plans) {
  const container = document.querySelector('#payment-plans');
  container.replaceChildren();
  plans.forEach((plan) => {
    const label = document.createElement('label');
    label.className = 'payment-plan';
    const input = document.createElement('input');
    input.type = 'radio'; input.name = 'paymentPlanId'; input.value = plan.id; input.required = true;
    const card = document.createElement('span'); card.className = 'payment-plan__card';
    const mark = document.createElement('span'); mark.className = 'payment-plan__mark'; mark.setAttribute('aria-hidden', 'true');
    const name = document.createElement('span'); name.className = 'payment-plan__name'; name.textContent = plan.name;
    const price = document.createElement('span'); price.className = 'payment-plan__price';
    const installment = plan.schedule[0]?.amount || Math.round(plan.total / plan.installmentCount);
    price.textContent = formatMoney(installment, plan.currency);
    const cadence = document.createElement('span'); cadence.className = 'payment-plan__cadence'; cadence.textContent = cadenceText(plan);
    const total = document.createElement('span'); total.className = 'payment-plan__total'; total.textContent = `Total Investment: ${formatMoney(plan.total, plan.currency)}`;
    card.append(mark, name, price, cadence, total); label.append(input, card); container.append(label);
    input.addEventListener('change', () => selectPlan(plan));
  });
}

function renderClauses(clauses) {
  const container = document.querySelector('#agreement-clauses');
  container.replaceChildren();
  clauses.forEach((clause) => {
    const label = document.createElement('label'); label.className = 'ops-check';
    const input = document.createElement('input'); input.type = 'checkbox'; input.value = clause.id; input.dataset.clause = ''; input.required = clause.required !== false; input.setAttribute('aria-describedby', 'agreement-clauses-error');
    const text = document.createElement('span'); text.textContent = clause.text;
    label.append(input, text); container.append(label);
  });
}

function selectPlan(plan) {
  selectedPlan = plan;
  setText('sidebar-schedule', plan.name);
  setText('sidebar-total', formatMoney(plan.total, plan.currency));
  document.querySelector('#payment-plan-error').hidden = true;
  analyticsEvent('payment_plan_selected', { planCode: plan.code, surface: 'agreement' });
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearErrors();
  const data = new FormData(form);
  const values = Object.fromEntries(data.entries());
  values.clientAuthority = document.querySelector('#client-authority').checked;
  values.signerAuthority = document.querySelector('#signer-authority').checked;
  values.paymentPlanId = data.get('paymentPlanId') || '';
  values.acknowledgedClauseIds = [...document.querySelectorAll('[data-clause]:checked')].map((input) => input.value);
  const clauseIds = agreementData.agreement.clauses.filter((clause) => clause.required !== false).map((clause) => clause.id);
  const errors = validateAgreement(values, clauseIds.length ? clauseIds : requiredClauseIds);
  if (Object.keys(errors).length) {
    showErrors(errors);
    analyticsEvent('agreement_validation_error', { count: Object.keys(errors).length, surface: 'agreement' });
    return;
  }
  submitButton.disabled = true;
  submitButton.textContent = 'Recording acceptance…';
  try {
    if (isPreview) {
      await new Promise((resolve) => setTimeout(resolve, 450));
      renderState('pending');
      return;
    }
    const acceptance = await api('/api/ops/agreements/accept', {
      method: 'POST',
      headers: { 'X-CSRF-Token': csrfToken },
      body: JSON.stringify({
        paymentPlanId: values.paymentPlanId,
        acknowledgedClauseIds: values.acknowledgedClauseIds,
        signerName: values.signerName, signerRole: values.signerRole,
        signerCompany: values.signerCompany, typedAcceptance: values.typedAcceptance,
        authorityConfirmed: values.clientAuthority && values.signerAuthority,
        client: {
          legalBusinessName: values.legalBusinessName, dba: values.dba || '',
          contactName: values.contactName, email: values.email, phone: values.phone,
          title: values.title, billingAddress: values.billingAddress, city: values.city,
          state: values.state, zip: values.zip,
        },
      }),
    });
    analyticsEvent('agreement_accepted', { agreementState: 'accepted', surface: 'agreement' });
    if (!acceptance.accepted) throw new Error('The agreement could not be accepted.');
    submitButton.textContent = 'Opening secure payment…';
    const checkout = await api('/api/ops/checkout', { method: 'POST', headers: { 'X-CSRF-Token': csrfToken } });
    analyticsEvent('checkout_started', { planCode: selectedPlan.code, surface: 'agreement' });
    location.assign(checkout.checkoutUrl);
  } catch (error) {
    analyticsEvent('enrollment_error', { result: error.code || 'request_failed', surface: 'agreement' });
    submitButton.disabled = false;
    submitButton.textContent = 'I Agree & Continue to Secure Payment →';
    showInlineAlert(error.message || 'We could not continue to payment. Your information has not been charged. Try again or contact E4LA.');
  }
});

function showErrors(errors) {
  for (const [field, message] of Object.entries(errors)) {
    const id = camelToId(field);
    const input = document.getElementById(id);
    const error = document.getElementById(`${id}-error`);
    if (input) input.setAttribute('aria-invalid', 'true');
    if (error) { error.textContent = message; error.hidden = false; }
  }
  if (errors.paymentPlanId) document.querySelector('#payment-plan-error').hidden = false;
  if (errors.acknowledgements) {
    const clauseError = document.querySelector('#agreement-clauses-error');
    clauseError.textContent = errors.acknowledgements;
    clauseError.hidden = false;
    document.querySelectorAll('[data-clause]').forEach((input) => input.setAttribute('aria-invalid', 'true'));
  }
  formAlertCopy.textContent = errors.acknowledgements || 'Complete the required fields before continuing.';
  formAlert.hidden = false;
  formAlert.focus();
}

function clearErrors() {
  formAlert.hidden = true;
  document.querySelectorAll('[aria-invalid="true"]').forEach((input) => input.removeAttribute('aria-invalid'));
  document.querySelectorAll('.ops-error').forEach((error) => { error.hidden = true; error.textContent = ''; });
}

function showInlineAlert(message) {
  formAlertCopy.textContent = message;
  formAlert.hidden = false;
  formAlert.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
  formAlert.focus();
}

async function watchEnrollment() {
  renderState('pending');
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const data = await api('/api/ops/enrollment/status');
    const status = data.enrollment.status;
    if (['paid','activated','schedule_active','first_payment_confirmed'].includes(status)) { renderState('confirmed'); return; }
    if (['payment_failed','payment_action_required','attention_required'].includes(status)) { renderState('failed'); return; }
    await new Promise((resolve) => setTimeout(resolve, 1800));
  }
  renderState('pending');
}

function renderState(kind) {
  const states = {
    invalid: ['Agreement unavailable', 'This secure agreement link is invalid. Request a new link from E4LA. No agreement information was disclosed.', '!'],
    expired: ['This invitation has expired', 'For your protection, secure agreement invitations expire. Contact E4LA for a new link.', '⌛'],
    reused: ['This invitation has already been used', 'One-time agreement invitations cannot be used twice. If you previously opened this agreement, return through the same browser session or request a new invitation.', '↻'],
    accepted: ['Agreement already accepted', 'This agreement has already been accepted. Contact E4LA if you need a copy or payment assistance.', '✓'],
    pending: ['Payment confirmation pending', 'Your agreement is recorded. Payment setup has not been confirmed yet. If you just returned from Stripe, this page will update after secure confirmation.', '…'],
    returned: ['Welcome back from Stripe', 'Your return to E4LA is not payment proof. We are waiting for Stripe’s signed webhook before confirming enrollment.', '↻'],
    processing: ['Payment is processing', 'Stripe is processing the payment. Your agreement is safely recorded and no additional submission is needed.', '…'],
    failed: ['Payment needs attention', 'Stripe could not confirm the payment. Your agreement remains saved. Contact E4LA or return through your secure link to try again.', '!'],
    attention: ['Payment method action required', 'Your agreement remains active, but Stripe requires an additional payment step. Use the secure payment action or contact E4LA for help.', '!'],
    confirmed: ['Enrollment confirmed', 'Your agreement and required initial payment are confirmed. E4LA will send onboarding instructions according to your activation policy.', '✓'],
    'activation-pending': ['Portal activation pending', 'Enrollment is confirmed. E4LA is completing onboarding readiness before portal access is activated.', '◇'],
    portal: ['Your client portal is available', 'Enrollment is confirmed and your E4LA portal is active.', '✓'],
  };
  const [title, copy, icon] = states[kind] || states.invalid;
  loading.hidden = true; app.hidden = true; stateView.hidden = false;
  setText('agreement-state-title', title); setText('agreement-state-copy', copy); setText('agreement-state-icon', icon);
  stateActionKind = ['accepted','failed','attention'].includes(kind) ? 'checkout' : ['pending','returned','processing'].includes(kind) ? 'status' : kind === 'portal' ? 'portal' : '';
  stateAction.hidden = !stateActionKind;
  stateAction.textContent = stateActionKind === 'checkout' ? 'Continue to secure payment'
    : stateActionKind === 'status' ? 'Check payment status'
      : stateActionKind === 'portal' ? 'Open client portal'
      : 'Continue';
  if (kind === 'confirmed') analyticsEvent('enrollment_confirmed', { result: 'confirmed', surface: 'agreement' });
}

stateAction.addEventListener('click', async () => {
  if (isPreview) { if (stateActionKind === 'portal') location.assign('/client-portal/?demo=1'); else renderState(stateActionKind === 'status' ? 'confirmed' : 'pending'); return; }
  stateAction.disabled = true;
  try {
    if (stateActionKind === 'status') { await watchEnrollment(); return; }
    if (stateActionKind === 'portal') { location.assign('/client-portal/'); return; }
    const checkout = await api('/api/ops/checkout', { method: 'POST', headers: { 'X-CSRF-Token': csrfToken } });
    analyticsEvent('checkout_started', { surface: 'agreement' });
    location.assign(checkout.checkoutUrl);
  } catch (error) {
    setText('agreement-state-copy', error.message || 'Payment setup is not available yet. Contact E4LA for assistance.');
  } finally {
    stateAction.disabled = false;
  }
});

function renderApiError(error) {
  const map = { invalid_invite: 'invalid', agreement_unavailable: 'invalid', session_expired: 'expired', authentication_required: 'expired', agreement_already_completed: 'accepted', payment_pending: 'pending', enrollment_confirmed: 'confirmed' };
  renderState(map[error.code] || 'invalid');
}

async function api(url, options = {}, includeCredentials = true) {
  const { headers = {}, ...rest } = options;
  const response = await fetch(url, {
    credentials: includeCredentials ? 'same-origin' : 'same-origin',
    ...rest,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error?.message || 'The secure request could not be completed.');
    error.code = payload.error?.code; error.requestId = payload.error?.requestId;
    throw error;
  }
  return payload;
}

function cadenceText(plan) {
  if (plan.installmentCount === 1) return 'One-time payment';
  if (plan.intervalUnit === 'month') return `${plan.installmentCount} automatic payments · monthly`;
  return `${plan.installmentCount} automatic payments · every ${plan.intervalCount} weeks`;
}
function formatDate(value) { return new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`)); }
function setText(id, value) { const node = document.getElementById(id); if (node) node.textContent = value; }
function camelToId(value) { return value.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`); }
