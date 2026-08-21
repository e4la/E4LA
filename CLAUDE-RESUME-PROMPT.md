# Claude Resume Prompt — E4LA Client Operations

Continue the E4LA Client Operations project from the repository, assuming no conversation history.

1. Read `CLAUDE-HANDOFF-E4LA-CLIENT-OPERATIONS.md` completely first.
2. Then inspect `CLIENT-OPERATIONS-STATE.json`, `CLIENT-OPERATIONS-PHASE-D.md`, `migrations/0001_client_operations.sql`, `migrations/0002_phase_c_preview.sql`, `functions/api/ops/[[path]].js`, `functions/api/stripe/webhook.js`, and both test files.
3. Run `npm test` and confirm the expected 22/22 baseline before making changes.

Current classification: **NOT READY**.

Current blocker/next gate: **Cloudflare Access is not enabled/configured** (`access.api.error.not_enabled`). Exhaust authenticated Cloudflare API/Wrangler capabilities first. Do not configure Stripe until Access passes. The stable isolated preview is `https://e4la-client-operations-preview.pages.dev`; production is untouched.

You may autonomously perform read-only audits, preview-only Cloudflare/D1 configuration, tests, defect corrections demonstrated by validation, documentation updates, and safe preview redeployment. Do not add product features or redesign the architecture.

Do not modify the approved public E4LA site (`index.html`, `services.html`, `our-work.html`, `about.html`, public navigation/global CSS/global JS, booking flow, `sitemap.xml`, `robots.txt`) without a reproduced Client Operations regression. Do not touch production DNS/MX, production Pages bindings, production D1, live Stripe, real invitations/users, or production email.

Hard stops: genuine account authentication/permission boundary, secret credential entry, financial/live billing action, final legal approval, destructive production action, or explicit production activation. Never ask for routine work that available tooling can perform, and never ask anyone to paste secrets into chat.

After any material change, update `CLIENT-OPERATIONS-STATE.json` and the master handoff so the repository remains the source of truth.
