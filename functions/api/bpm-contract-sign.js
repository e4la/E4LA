const AGREEMENT_VERSION = 'BPM-2026-10-08';
const CLIENT_NAME = 'BPM Real Estate';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

function clean(value, max = 254) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
}

function normalizedName(value) {
  return clean(value, 120).replace(/\s+/g, ' ').toLowerCase();
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

async function sendResend(env, payload, idempotencyKey) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey
    },
    body: JSON.stringify(payload)
  });
  let body = {};
  try { body = await response.json(); } catch (error) {}
  if (!response.ok) throw new Error(`Resend failed (${response.status}): ${body.message || 'Unknown error'}`);
  return body;
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.RESEND_API_KEY || !env.CONSULTANT_EMAIL || !env.EMAIL_FROM) {
    return json({ error: 'Agreement acceptance service is not configured.' }, 503);
  }

  const contentType = request.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    return json({ error: 'Content-Type must be application/json.' }, 415);
  }

  let input;
  try { input = await request.json(); } catch (error) {
    return json({ error: 'Invalid request body.' }, 400);
  }

  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return json({ error: 'Invalid agreement information.' }, 400);
  }

  const fullName = clean(input.fullName, 120);
  const email = clean(input.email, 254).toLowerCase();
  const typedSignature = clean(input.typedSignature, 120);
  const company = clean(input.company, 120);
  const agreementVersion = clean(input.agreementVersion, 40);
  const accepted = input.accepted === true;
  const honeypot = clean(input.website, 200);

  if (honeypot) return json({ ok: true });
  if (company !== CLIENT_NAME) return json({ error: 'Client name does not match this agreement.' }, 400);
  if (agreementVersion !== AGREEMENT_VERSION) return json({ error: 'Agreement version mismatch. Refresh the page and try again.' }, 409);
  if (fullName.length < 2) return json({ error: 'Full legal name is required.' }, 400);
  if (!validEmail(email)) return json({ error: 'A valid email is required.' }, 400);
  if (!accepted) return json({ error: 'You must confirm that you agree to the agreement.' }, 400);
  if (normalizedName(fullName) !== normalizedName(typedSignature)) {
    return json({ error: 'Your electronic signature must match your full legal name.' }, 422);
  }

  const acceptedAt = new Date().toISOString();
  const acceptanceId = crypto.randomUUID();
  const safeName = escapeHtml(fullName);
  const safeEmail = escapeHtml(email);

  const terms = [
    'Weeks 1–3: $2,400 — UX, SEO preservation planning, website redesign strategy and growth architecture.',
    'Weeks 3–6: $2,400 — website redesign implementation, three growth pathways, launch and tracking.',
    'From Week 6: $2,000/month — ongoing growth, SEO/GEO/AI visibility, content, Instagram distribution, conversion and attribution.',
    'Performance fee: $200 for each attributable new rental owner who signs a BPM management agreement.',
    'Performance fee: $300 for each attributable owner who switches management to BPM and signs a BPM management agreement.',
    'Investment opportunities: 20% of Omid/BPM actual commission received on attributable closed transactions.',
    'No Stripe payment or recurring billing authorization is created by this electronic signature.'
  ];

  const textTerms = terms.map((item) => `- ${item}`).join('\n');
  const htmlTerms = terms.map((item) => `<li style="margin:0 0 8px">${escapeHtml(item)}</li>`).join('');

  const internalHtml = `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#171428;max-width:680px;margin:0 auto">
      <h1 style="font-size:24px;margin:0 0 12px">BPM Real Estate agreement accepted</h1>
      <p><strong>Signer:</strong> ${safeName}</p>
      <p><strong>Email:</strong> ${safeEmail}</p>
      <p><strong>Agreement version:</strong> ${AGREEMENT_VERSION}</p>
      <p><strong>Accepted at:</strong> ${acceptedAt}</p>
      <p><strong>Acceptance ID:</strong> ${acceptanceId}</p>
      <h2 style="font-size:18px;margin-top:24px">Commercial summary</h2>
      <ul>${htmlTerms}</ul>
      <p style="font-size:13px;color:#6e6979">The signer typed their full legal name as the electronic signature and explicitly confirmed acceptance on the agreement page. No payment credentials or IP address are collected by this endpoint.</p>
    </div>`;

  const confirmationHtml = `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#171428;max-width:680px;margin:0 auto">
      <h1 style="font-size:24px;margin:0 0 12px">BPM Real Estate × E4LA agreement confirmation</h1>
      <p>Hello ${safeName},</p>
      <p>Your electronic acceptance of the BPM Real Estate Growth Partnership Agreement has been recorded.</p>
      <p><strong>Agreement version:</strong> ${AGREEMENT_VERSION}<br>
      <strong>Accepted at:</strong> ${acceptedAt}<br>
      <strong>Acceptance ID:</strong> ${acceptanceId}</p>
      <h2 style="font-size:18px;margin-top:24px">Commercial summary</h2>
      <ul>${htmlTerms}</ul>
      <p>This confirmation records agreement acceptance only. Payment arrangements are handled separately.</p>
      <p>E4LA — Evolve for Los Angeles</p>
    </div>`;

  try {
    await sendResend(env, {
      from: env.EMAIL_FROM,
      to: [env.CONSULTANT_EMAIL],
      subject: `BPM agreement accepted — ${fullName}`,
      html: internalHtml,
      text: [
        'BPM Real Estate agreement accepted',
        `Signer: ${fullName}`,
        `Email: ${email}`,
        `Agreement version: ${AGREEMENT_VERSION}`,
        `Accepted at: ${acceptedAt}`,
        `Acceptance ID: ${acceptanceId}`,
        '',
        'Commercial summary',
        textTerms,
        '',
        'No payment authorization was created by this signature.'
      ].join('\n')
    }, `bpm-contract-internal-${acceptanceId}`);

    await sendResend(env, {
      from: env.EMAIL_FROM,
      to: [email],
      subject: 'BPM Real Estate × E4LA agreement confirmation',
      html: confirmationHtml,
      text: [
        `Hello ${fullName},`,
        '',
        'Your electronic acceptance of the BPM Real Estate Growth Partnership Agreement has been recorded.',
        `Agreement version: ${AGREEMENT_VERSION}`,
        `Accepted at: ${acceptedAt}`,
        `Acceptance ID: ${acceptanceId}`,
        '',
        'Commercial summary',
        textTerms,
        '',
        'This confirmation records agreement acceptance only. Payment arrangements are handled separately.',
        '',
        'E4LA — Evolve for Los Angeles'
      ].join('\n')
    }, `bpm-contract-client-${acceptanceId}`);

    return json({ ok: true, acceptanceId, acceptedAt });
  } catch (error) {
    console.error('BPM agreement acceptance failed:', error?.message || error);
    return json({ error: 'We could not record the acceptance. Please try again.' }, 502);
  }
}
