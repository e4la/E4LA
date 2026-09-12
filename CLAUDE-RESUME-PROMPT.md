# Claude Resume Prompt — E4LA Client Operations

Continue the E4LA Client Operations project from the repository, assuming no conversation history.

1. Read `CLAUDE-HANDOFF-E4LA-CLIENT-OPERATIONS.md` completely first.
2. Then inspect `CLIENT-OPERATIONS-STATE.json`, `CLIENT-OPERATIONS-PHASE-D.md`, `migrations/0001_client_operations.sql` through `0003_payment_plans_immutable.sql`, `functions/api/ops/[[path]].js`, `functions/api/stripe/webhook.js`, and all five test files.
3. Run `npm test` and confirm the expected 87/87 baseline before making changes. Also read `scripts/gate-prep/README.md` - every remaining external gate has a ready-to-run script there.

Current classification: **NOT READY**.

**2026-09-12 update — production activation started, partially complete.** Nasim explicitly authorized production activation this session. Verified live: a real `e4la-client-operations-production` D1 database exists (created 2026-09-11, all 9 migrations genuinely applied, environment marker `production`, zero client/financial/identity rows), and `ENROLLMENT_SESSION_SECRET` is set on the real `e4la` Pages project (the one serving www.e4la.org — production activation is NOT a separate Pages project; confirm this against `CLIENT-OPERATIONS-STATE.json`'s `production.verified_live_2026-09-12` block before assuming otherwise). Still missing on the `e4la` project's Production environment: the `ENVIRONMENT=production` / `PUBLIC_SITE_URL=https://www.e4la.org` vars and the `ENROLLMENT_DB` D1 binding — adding these was blocked by Claude Code's own auto-mode safety classifier as a consequential live-production-config change, not a Cloudflare permission issue. See `CLIENT-OPERATIONS-STATE.json`'s `production.blocked_this_session` for the exact owner action. Until that's done, `https://www.e4la.org/api/ops/*` and `/api/stripe/webhook` correctly fail closed with `environment_not_configured` (verified live) — this is the code's own designed fail-safe, not a bug.

Current blocker/next gate after that: **Cloudflare Zero Trust/Access is now enabled** (team domain `snowy-forest-edc8.cloudflareaccess.com`), but the Wrangler OAuth token has zero Access scope and cannot self-elevate. A dashboard-created API Token (Access: Apps and Policies + Organizations/Identity Providers, both Edit) is required before any Access API call can succeed. Exhaust authenticated Cloudflare API/Wrangler capabilities first on every fresh attempt — re-verify live rather than trusting this note, since account state can change between sessions. Do not configure Stripe until Access passes. The stable isolated preview is `https://e4la-client-operations-preview.pages.dev`; the production activation above is in progress, gated on the owner action noted.

You may autonomously perform read-only audits, preview-only Cloudflare/D1 configuration, tests, defect corrections demonstrated by validation, documentation updates, and safe preview redeployment. Do not add product features or redesign the architecture.

Do not modify the approved public E4LA site (`index.html`, `services.html`, `our-work.html`, `about.html`, public navigation/global CSS/global JS, booking flow, `sitemap.xml`, `robots.txt`) without a reproduced Client Operations regression. Do not touch production DNS/MX, production Pages bindings, production D1, live Stripe, real invitations/users, or production email.

Hard stops: genuine account authentication/permission boundary, secret credential entry, financial/live billing action, final legal approval, destructive production action, or explicit production activation. Never ask for routine work that available tooling can perform, and never ask anyone to paste secrets into chat.

After any material change, update `CLIENT-OPERATIONS-STATE.json` and the master handoff so the repository remains the source of truth.
