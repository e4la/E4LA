// Adobe render adapter - a real boundary, not a fake one.
//
// Expected credential env var: ADOBE_API_KEY. This name is documented here and
// nowhere else has authority over it. No such credential exists anywhere in
// this project's environments today.
//
// Contract: if ADOBE_API_KEY is absent, this function returns
// {status:'unavailable', ...} immediately and makes NO network call and NO
// fabricated asset_url, ever. Callers (functions/api/content/[[path]].js) must
// persist that honest status rather than inventing a 'rendered' state.
//
// If a credential is ever configured, the request below is a best-effort,
// CLEARLY LABELED PLACEHOLDER shaped loosely on how Adobe's Firefly/Express
// "render from template + field substitution" APIs generally work (template
// reference + field map in, an async job or direct asset URL out). It has NOT
// been verified against Adobe's actual, current API documentation and MUST be
// checked/corrected against the real docs before it is ever used with a real
// credential. Do not treat the endpoint path, payload shape, or response
// fields below as confirmed.
export async function requestAdobeRender(env, { templateReference, fields } = {}) {
  const apiKey = env && env.ADOBE_API_KEY;
  if (!apiKey) {
    return { status: 'unavailable', reason: 'Adobe credential not configured (expected env var ADOBE_API_KEY)' };
  }

  // --- UNVERIFIED PLACEHOLDER BELOW - confirm against real Adobe API docs first ---
  try {
    const response = await fetch('https://firefly-api.adobe.io/v3/render-template', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        templateReference: templateReference || null,
        fields: fields || {},
      }),
    });
    if (!response.ok) {
      return { status: 'failed', reason: `Adobe render request failed with HTTP ${response.status}` };
    }
    const data = await response.json().catch(() => null);
    if (!data || (!data.outputUrl && !data.jobId)) {
      return { status: 'failed', reason: 'Adobe render response was missing an expected job/output field' };
    }
    // A submitted job is 'rendering', never 'rendered' - completion must come
    // from a real, separate confirmation this adapter does not fabricate.
    return { status: 'rendering', jobId: data.jobId || null, assetUrl: data.outputUrl || null };
  } catch (error) {
    return { status: 'failed', reason: 'Adobe render request threw before a response was received' };
  }
}
