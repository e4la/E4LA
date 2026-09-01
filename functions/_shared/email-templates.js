const TEMPLATE_TYPES = Object.freeze([
  'agreement_invitation', 'agreement_accepted', 'payment_confirmation',
  'payment_failure', 'portal_activation', 'onboarding_instructions',
]);

export function renderOperationsEmail(type, input) {
  if (!TEMPLATE_TYPES.includes(type)) throw new Error('Unsupported Client Operations email type.');
  const values = {
    clientName: text(input.clientName, 160) || 'there',
    programName: text(input.programName, 180) || 'your E4LA engagement',
    actionUrl: safeUrl(input.actionUrl),
    supportEmail: text(input.supportEmail, 254) || 'hello@e4la.org',
    paymentSummary: text(input.paymentSummary, 240),
    nextStep: text(input.nextStep, 300),
  };
  const content = contentFor(type, values);
  return {
    subject: content.subject,
    text: `Hi ${values.clientName},\n\n${content.heading}\n\n${content.body}\n\n${content.actionLabel && values.actionUrl ? `${content.actionLabel}: ${values.actionUrl}\n\n` : ''}${content.note ? `${content.note}\n\n` : ''}Questions? Contact ${values.supportEmail}.\n\nE4LA`,
    html: htmlDocument(content, values),
  };
}

function contentFor(type, values) {
  const map = {
    agreement_invitation: {
      subject: `Review your E4LA agreement — ${values.programName}`,
      eyebrow: 'Agreement ready', heading: `Your E4LA agreement is ready to review`,
      body: `Review the program details, commercial terms, required acknowledgments, and approved payment schedules using your private one-time link.`,
      actionLabel: 'Review agreement', note: 'This invitation is intended only for the authorized recipient and expires for your protection.',
    },
    agreement_accepted: {
      subject: `E4LA agreement accepted — ${values.programName}`,
      eyebrow: 'Agreement recorded', heading: 'Your agreement has been accepted',
      body: `E4LA recorded the accepted agreement version and signer evidence. Payment confirmation and portal activation remain separate server-authoritative steps.`,
      actionLabel: null, note: values.nextStep || 'E4LA will send the next onboarding step when it is ready.',
    },
    payment_confirmation: {
      subject: `E4LA payment confirmed — ${values.programName}`,
      eyebrow: 'Payment confirmed', heading: 'Your required payment is confirmed',
      body: values.paymentSummary || 'Stripe confirmed the required program payment. Card details were handled by Stripe and are not stored by E4LA.',
      actionLabel: values.actionUrl ? 'View client portal' : null, note: values.nextStep || 'E4LA will continue with the activation policy for your engagement.',
    },
    payment_failure: {
      subject: `Action needed: E4LA payment could not be confirmed`,
      eyebrow: 'Payment needs attention', heading: 'A payment step needs your attention',
      body: `Stripe could not confirm the required payment. Your accepted agreement remains recorded. Use the secure action below to update the Stripe-managed payment method or contact E4LA.`,
      actionLabel: 'Resolve payment securely', note: 'Do not send card numbers or payment credentials by email.',
    },
    portal_activation: {
      subject: `Your E4LA client portal is ready`, eyebrow: 'Portal activated',
      heading: 'Your E4LA client portal is ready', body: `See current work, milestones, published deliverables, reports, agreement status, and server-authoritative billing information in one place.`,
      actionLabel: 'Open client portal', note: 'Only information reviewed and published by E4LA appears in the portal.',
    },
    onboarding_instructions: {
      subject: `Next steps for ${values.programName}`, eyebrow: 'Let’s get started',
      heading: 'Your E4LA onboarding steps', body: values.nextStep || 'E4LA will confirm the initial access, information, and coordination needed to begin the engagement.',
      actionLabel: values.actionUrl ? 'View onboarding steps' : null, note: 'Reply to the approved onboarding message if you need help with a requested item.',
    },
  };
  return map[type];
}

function htmlDocument(content, values) {
  const action = content.actionLabel && values.actionUrl
    ? `<p style="margin:28px 0"><a href="${escapeHtml(values.actionUrl)}" style="display:inline-block;border-radius:999px;background:linear-gradient(100deg,#F97316,#DB2777 52%,#7C3AED);padding:16px 24px;color:#fff;font-weight:800;text-decoration:none">${escapeHtml(content.actionLabel)}</a></p>` : '';
  return `<!doctype html><html><body style="margin:0;background:#07060D;color:#fff;font-family:Manrope,Arial,sans-serif"><div style="max-width:640px;margin:auto;padding:40px 22px"><div style="border:1px solid rgba(255,255,255,.12);border-radius:20px;background:#0B0A14;padding:32px"><p style="margin:0 0 16px;color:rgba(255,255,255,.68);font-size:14px">Hi ${escapeHtml(values.clientName)},</p><p style="margin:0 0 12px;color:#F9A8D4;font-size:12px;font-weight:800;letter-spacing:.12em;text-transform:uppercase">${escapeHtml(content.eyebrow)}</p><h1 style="margin:0;font-size:30px;line-height:1.15">${escapeHtml(content.heading)}</h1><p style="margin:18px 0 0;color:rgba(255,255,255,.68);font-size:16px;line-height:1.65">${escapeHtml(content.body)}</p>${action}<p style="margin:22px 0 0;border-top:1px solid rgba(255,255,255,.1);padding-top:18px;color:rgba(255,255,255,.48);font-size:13px;line-height:1.55">${escapeHtml(content.note)}</p></div><p style="margin:20px 0 0;color:rgba(255,255,255,.42);font-size:12px">Questions? Contact ${escapeHtml(values.supportEmail)} · E4LA</p></div></body></html>`;
}

function text(value, max) { return String(value || '').trim().slice(0, max); }
function safeUrl(value) { const candidate = text(value, 1200); if (!candidate) return ''; try { const parsed = new URL(candidate); return parsed.protocol === 'https:' ? parsed.toString() : ''; } catch { return ''; } }
function escapeHtml(value) { return String(value || '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character])); }
