export const requiredClauseIds = [
  'fixed_term', 'fee_commitment', 'automatic_charges', 'no_guarantees',
  'client_responsibilities', 'full_agreement',
];

export const sampleAgreement = Object.freeze({
  agreement: {
    id: 'agr_demo_01',
    status: 'viewed',
    programName: '90-Day Brand Visibility & Growth Program',
    versionId: 'agrv_demo_01',
    versionNumber: 1,
    legalDocumentHash: 'phase-b-placeholder-not-for-execution',
    summary: { initialTerm: '90 Days', totalInvestment: 360000 },
    startDate: '2026-09-08',
    clauses: [
      { id: 'fixed_term', required: true, text: 'I understand that this is a fixed 90-day engagement and not a month-to-month subscription.' },
      { id: 'fee_commitment', required: true, text: 'I understand that the Total Program Fee is committed and installments are a payment schedule only.' },
      { id: 'automatic_charges', required: true, text: 'I authorize E4LA to automatically charge the payment method provided according to the selected Payment Schedule.' },
      { id: 'no_guarantees', required: true, text: 'I understand that specific rankings, revenue, leads, sales, advertising results, or other business outcomes are not guaranteed.' },
      { id: 'client_responsibilities', required: true, text: 'I understand my responsibilities regarding approvals, access, content, information, and coordination with other marketing activities.' },
      { id: 'full_agreement', required: true, text: 'I have reviewed, understood, and agree to the E4LA Client Services Agreement.' },
    ],
    legalText: `PHASE B LEGAL DOCUMENT PLACEHOLDER\n\nThe final E4LA Client Services Agreement will be supplied and reviewed separately. This local preview demonstrates document layout, scrolling, acknowledgment structure, versioning, and acceptance evidence only.\n\nNo placeholder language on this page should be treated as final legal language or used to execute a client contract. Before production activation, E4LA will provide the approved agreement text and a California contracts attorney can review the consent flow, commercial terms, payment authorization, and evidence retained at acceptance.`,
  },
  client: {
    legalBusinessName: '', dba: '', email: '', phone: '', billingAddress: {}, projectName: 'Growth Program',
  },
  paymentPlans: [
    { id: 'plan_full', code: 'pay_full', name: 'Pay in Full', total: 360000, currency: 'usd', installmentCount: 1, intervalUnit: 'one_time', intervalCount: 0, schedule: [{ amount: 360000, offsetUnit: 'month', offset: 0 }] },
    { id: 'plan_monthly', code: 'three_monthly', name: 'Three Monthly Installments', total: 360000, currency: 'usd', installmentCount: 3, intervalUnit: 'month', intervalCount: 1, schedule: [0, 1, 2].map((offset) => ({ amount: 120000, offsetUnit: 'month', offset })) },
    { id: 'plan_biweekly', code: 'six_biweekly', name: 'Six Biweekly Installments', total: 360000, currency: 'usd', installmentCount: 6, intervalUnit: 'week', intervalCount: 2, schedule: [0, 2, 4, 6, 8, 10].map((offset) => ({ amount: 60000, offsetUnit: 'week', offset })) },
  ],
});

export const samplePortal = Object.freeze({
  client: { name: 'Sample Hospitality Client' },
  project: {
    name: '90-Day Brand Visibility & Growth Program', status: 'active', currentPhase: 'Foundation & visibility',
    startDate: '2026-08-12', targetEndDate: '2026-11-10',
    summary: 'The strategic foundation is approved. E4LA is implementing visibility improvements and preparing the first reporting package.',
  },
  action: { required: true, title: 'Homepage proof approval', detail: 'Please review the final homepage messaging proof by August 24.' },
  currentWork: [
    { title: 'Local visibility implementation', detail: 'Business listings, technical signals, and location-page structure.', status: 'In progress', owner: 'Visibility team' },
    { title: 'GEO content framework', detail: 'Preparing source-backed answer structures for high-intent questions.', status: 'In progress', owner: 'Strategy team' },
  ],
  milestones: [
    { title: 'Discovery & measurement baseline', detail: 'Completed August 16', status: 'completed' },
    { title: 'Visibility foundation', detail: 'Current phase · target August 30', status: 'active' },
    { title: 'Content and experience rollout', detail: 'Planned for September', status: 'planned' },
    { title: 'Optimization and final report', detail: 'Planned for November', status: 'planned' },
  ],
  deliverables: [
    { title: 'Growth baseline report', type: 'Report', date: 'August 16, 2026', status: 'Published', version: 'v1.0', description: 'Baseline findings across search visibility, GEO, analytics, and experience.', externalUrl: '#sample-document' },
    { title: 'Homepage messaging brief', type: 'Document', date: 'August 20, 2026', status: 'Published', version: 'v1.1', description: 'Approved positioning and messaging direction for the homepage.', externalUrl: '#sample-document' },
  ],
  reports: [{ title: 'Visibility baseline', type: 'SEO + GEO report', date: 'August 16, 2026', status: 'Published', version: 'v1.0', description: 'Search, GEO, analytics, and experience baseline.', externalUrl: '#sample-report' }],
  agreement: { name: '90-Day Growth Program Agreement', version: 1, acceptedAt: 'August 12, 2026', plan: 'Three Monthly Installments', status: 'Accepted', documentUrl: null },
  billing: { status: 'current', paid: 120000, total: 360000, completedPayments: 1, installmentCount: 3, planName: 'Three Monthly Installments', nextPayment: 'September 12, 2026', nextAmount: 120000 },
});

export const sampleAdmin = Object.freeze({
  counts: { activeClients: 1, awaitingSignature: 1, awaitingPayment: 1, actionsRequired: 3 },
  clients: [
    { id: 'client_demo_a', name: 'Sample Hospitality Client', lifecycle: 'Project Active', project: '90-Day Growth Program', projectId: 'prj_demo_a', agreement: 'Accepted', agreementId: 'agr_demo_a', payment: 'Current', plan: 'Three Monthly', paid: 120000, total: 360000, nextPayment: 'Sep 12, 2026', portal: 'Active', enrollmentId: 'enr_demo_a', action: 'Homepage proof approval' },
    { id: 'client_demo_b', name: 'Sample Wellness Client', lifecycle: 'Agreement Sent', project: 'Visibility Program', projectId: 'prj_demo_b', agreement: 'Awaiting signature', agreementId: 'agr_demo_b', payment: 'Not started', plan: 'Not selected', paid: 0, total: 360000, nextPayment: '—', portal: 'Not eligible', action: 'Agreement follow-up' },
    { id: 'client_demo_c', name: 'Sample Retail Client', lifecycle: 'Payment Initiated', project: 'Growth Program', projectId: 'prj_demo_c', agreement: 'Accepted', agreementId: 'agr_demo_c', payment: 'Awaiting confirmation', plan: 'Pay in Full', paid: 0, total: 360000, nextPayment: 'Webhook pending', portal: 'Pending', enrollmentId: 'enr_demo_c', action: 'Review payment reconciliation' },
    { id: 'client_demo_d', name: 'Sample Creative Client', lifecycle: 'Completed', project: 'Experience Program', projectId: 'prj_demo_d', agreement: 'Completed', agreementId: 'agr_demo_d', payment: 'Paid', plan: 'Pay in Full', paid: 360000, total: 360000, nextPayment: 'None', portal: 'Active', enrollmentId: 'enr_demo_d', action: 'None' },
  ],
  milestones: [
    { title: 'Visibility foundation review', client: 'Sample Hospitality Client', date: 'Aug 24' },
    { title: 'Discovery kickoff', client: 'Sample Wellness Client', date: 'Aug 28' },
  ],
  activity: [
    { type: 'portal_update_published', client: 'Sample Hospitality Client', date: 'Today · 10:42 AM', detail: 'Homepage messaging brief published' },
    { type: 'payment_confirmed', client: 'Sample Creative Client', date: 'Yesterday · 3:18 PM', detail: 'Program payment confirmed by webhook' },
    { type: 'agreement_viewed', client: 'Sample Wellness Client', date: 'Yesterday · 11:07 AM', detail: 'Agreement Version 1 viewed' },
  ],
});

export function formatMoney(cents, currency = 'usd') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase(), maximumFractionDigits: 0 }).format(Number(cents) / 100);
}

export function validateAgreement(values, clauses = requiredClauseIds) {
  const errors = {};
  const required = ['legalBusinessName','contactName','email','phone','title','billingAddress','city','state','zip','signerName','signerRole','signerCompany','typedAcceptance'];
  required.forEach((field) => { if (!String(values[field] || '').trim()) errors[field] = 'This field is required.'; });
  if (values.email && !/^\S+@\S+\.\S+$/.test(String(values.email))) errors.email = 'Enter a valid email address.';
  if (!values.paymentPlanId) errors.paymentPlanId = 'Select a payment schedule.';
  if (!values.clientAuthority) errors.clientAuthority = 'Authority confirmation is required.';
  if (!values.signerAuthority) errors.signerAuthority = 'Signer authority confirmation is required.';
  const accepted = new Set(values.acknowledgedClauseIds || []);
  if (clauses.some((id) => !accepted.has(id))) errors.acknowledgements = 'Review and accept every required acknowledgment.';
  if (values.signerName && values.typedAcceptance && normalizeName(values.signerName) !== normalizeName(values.typedAcceptance)) {
    errors.typedAcceptance = 'Your electronic signature must match your full legal name.';
  }
  return errors;
}

export function normalizeName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
}

export function analyticsEvent(name, properties = {}) {
  const allowed = new Set([
    'agreement_viewed','agreement_validation_error','agreement_accepted','payment_plan_selected',
    'checkout_started','checkout_returned','enrollment_confirmed','enrollment_error','portal_activated','portal_viewed','deliverable_viewed',
  ]);
  if (!allowed.has(name)) return;
  const safe = {};
  for (const [key, value] of Object.entries(properties)) {
    if (['agreementState','planCode','surface','result','count'].includes(key) && ['string','number','boolean'].includes(typeof value)) safe[key] = value;
  }
  window.dispatchEvent(new CustomEvent('e4la:analytics', { detail: { name, properties: safe } }));
}

export function demoStateFromUrl() {
  const state = new URLSearchParams(location.search).get('state');
  const allowed = new Set(['active','invalid','expired','reused','accepted','pending','returned','processing','failed','attention','confirmed','activation-pending','portal','validation','payment','empty','no-deliverables','completed','multiple','single','zero']);
  return allowed.has(state) ? state : 'active';
}

export function isSafeProductPreview() {
  const previewHost = location.hostname === 'e4la-client-operations-preview.pages.dev'
    || location.hostname.endsWith('.e4la-client-operations-preview.pages.dev');
  return ['localhost', '127.0.0.1'].includes(location.hostname)
    || (previewHost && new URLSearchParams(location.search).get('demo') === '1');
}
