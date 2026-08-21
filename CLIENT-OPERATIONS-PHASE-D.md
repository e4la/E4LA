# E4LA Client Operations System — Phase D Gate Report

Date: 2026-08-20 (America/Los_Angeles)

Classification: **NOT READY**

Stable preview: <https://e4la-client-operations-preview.pages.dev>

Latest validated deployment: <https://56f14ffe.e4la-client-operations-preview.pages.dev>

Phase D remained limited to configuration discovery, integration QA, security/accessibility inspection, demonstrated defect correction, and production-readiness documentation. No production database, live Stripe object, real invitation, or real client account was created.

## Gate summary

| Gate | Status | Evidence / blocker |
| --- | --- | --- |
| Preview deployment | Pass | Wrangler 4.125.0 compiled and deployed the Functions bundle successfully. |
| Preview D1 | Pass | Dedicated database `e4la-client-operations-preview`, binding `ENROLLMENT_DB`, immutable environment marker `preview`; 6 fictional clients, 6 projects, 6 agreements, 6 versions, 5 acceptances. |
| Automated validation | Pass | 22/22 tests pass, including immutable records, publication boundary, roles, cross-client isolation, CSRF, session revocation, fixed schedules, webhook replay, and fail-closed environment checks. |
| Cloudflare Access | Blocked | Cloudflare API returns `access.api.error.not_enabled`. The account has not completed Zero Trust / Access enablement. |
| Stripe Sandbox | Blocked | Preview contains no Stripe variables or secrets; no sandbox Checkout, webhook, schedule, failure, or Customer Portal run can be authoritative yet. |
| Resend preview | Not reached | Phase D requires Access and Stripe Sandbox to pass first. Templates remain inert. |
| Rendered browser acceptance | Blocked | The managed browser denied both the stable and deployment-specific preview because its administrator-enforced security policy could not be verified. No bypass was attempted. |
| Legal approval | Blocked | Contract and authorization language remains explicitly labeled as placeholder content. |
| Public-site isolation | Pass | Phase D changed no homepage, service, work, about, booking, navigation, sitemap, robots, global CSS, or global JavaScript source. The preview is a separate Pages project and production zone `e4la.org` is active and unpaused. |

## Phase D defect corrections

1. Stripe invoice replay hardening:
   - The same Stripe invoice can no longer advance more than one installment even if delivered under another event ID.
   - Invoice-to-enrollment conflicts fail closed.
   - Waived installments are never silently converted to paid.
   - Both legacy and newer Stripe invoice subscription references are accepted.
   - A completed Stripe schedule with unpaid ledger entries now produces `attention_required`; it does not manufacture paid installments.
2. Logout completion:
   - Client and admin logout revoke the E4LA application session.
   - Authenticated surfaces then use Cloudflare's documented `/cdn-cgi/access/logout` endpoint to clear/revoke the Access session.
   - The admin surface now exposes a server-backed Sign out control when authenticated.

Files changed since the accepted Phase C checkpoint:

- `functions/api/stripe/webhook.js`
- `tests/phase-c.test.mjs`
- `admin/index.html`
- `assets/js/admin.js`
- `assets/js/client-portal.js`
- `CLIENT-OPERATIONS-PHASE-D.md`

## Cloudflare status

- Account: Nasim@e4la.org Cloudflare account.
- Pages project: `e4la-client-operations-preview`.
- Pages project ID: `db56b063-dcf4-4445-b1bf-88bf3dd37ab0`.
- D1 database ID: `2d6a0170-f8b9-496d-acd4-50adf3cf9e58`.
- Current preview variables: `ENVIRONMENT`, `PUBLIC_SITE_URL`, encrypted `ENROLLMENT_SESSION_SECRET`.
- Current binding: `ENROLLMENT_DB` only.
- Missing: `ACCESS_TEAM_DOMAIN`, `ADMIN_ACCESS_AUD`, `CLIENT_ACCESS_AUD`, all Stripe configuration, and any Resend configuration.
- API and private page responses return `Cache-Control: no-store`, CSP, `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `nosniff`, restrictive referrer/permissions policies, and `noindex`.

## Consolidated account action — Cloudflare Access first

Only the initial account enablement and identity choices require Nasim. Everything after those choices can be completed with the available Cloudflare tooling.

1. Open Cloudflare Dashboard → **Zero Trust** and complete **Enable Access** for the E4LA account.
2. Choose/confirm the E4LA team domain (for example, an available `e4la.cloudflareaccess.com` team name) and an email-based login method.
3. Confirm the exact approved E4LA preview-admin email address and two safe fictional-client test inboxes: one Client Owner and one Client Viewer. These must be controlled test inboxes, not real client identities. The current `example.test` fixtures cannot receive authentication messages.
4. Return to this task and say Access is enabled with those three test identities. Do not paste secrets.

After that confirmation, the implementation operator can complete through the API:

1. Create **E4LA Operations Admin — Preview** as a self-hosted Access application covering:
   - `e4la-client-operations-preview.pages.dev/admin/*`
   - `e4la-client-operations-preview.pages.dev/api/ops/auth/admin`
2. Add an Allow policy containing only approved E4LA administrative test identities; use an eight-hour or shorter session consistent with the application session.
3. Create **E4LA Client Portal — Preview** covering:
   - `e4la-client-operations-preview.pages.dev/client-portal/*`
   - `e4la-client-operations-preview.pages.dev/api/ops/auth/client`
4. Add only the fictional owner/viewer inboxes plus the approved admin identity needed to enter clearly labeled Admin Preview. Server-side D1 role checks remain authoritative, so Access admission alone cannot create client authority.
5. Read the team domain and both application Audience (AUD) tags from Cloudflare, then set `ACCESS_TEAM_DOMAIN`, `ADMIN_ACCESS_AUD`, and `CLIENT_ACCESS_AUD` on the isolated Pages project.
6. Replace only the fictional preview `client_users`/`admin_users` test email values needed for authentication. Do not load production identities or client data.
7. Validate admin, unauthorized identity, owner, viewer, collaborator scope, cross-client access, expiration, revocation, logout, and Admin Preview in the deployed preview.

Cloudflare reference: <https://developers.cloudflare.com/workers/configuration/cloudflare-access/> and <https://developers.cloudflare.com/cloudflare-one/access-controls/access-settings/session-management/>.

## Consolidated account action — Stripe Sandbox second

Do this only after Cloudflare Access passes. Work entirely in Stripe Sandbox/Test mode.

1. In Stripe Workbench, confirm the actual sandbox API version. That exact value becomes `STRIPE_API_VERSION`; do not use the repository test placeholder.
2. Create sandbox Prices:
   - Pay in Full: USD 3,600 one-time.
   - Three Monthly: USD 1,200 one-time initial Price and USD 1,200 monthly recurring Price.
   - Six Biweekly: USD 600 one-time initial Price and USD 600 every two weeks recurring Price.
3. Create a sandbox Customer Portal configuration that permits payment-method updates and invoice/receipt access, and disables cancellation and plan changes.
4. Create a sandbox webhook endpoint at `https://e4la-client-operations-preview.pages.dev/api/stripe/webhook` for:
   - `checkout.session.completed`
   - `checkout.session.async_payment_succeeded`
   - `checkout.session.expired`
   - `invoice.paid`
   - `invoice.payment_failed`
   - `invoice.payment_action_required`
   - `subscription_schedule.updated`
   - `subscription_schedule.completed`
   - `subscription_schedule.canceled`
   - `subscription_schedule.aborted`
5. Store `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` directly as encrypted Cloudflare preview secrets. Do not paste either into chat, source, or a local committed file.
6. Set the confirmed `STRIPE_API_VERSION` and sandbox `STRIPE_PORTAL_CONFIGURATION_ID` on the preview project.
7. Supply the non-secret sandbox Price IDs so the existing fictional preview payment-plan rows can be mapped to `stripe_initial_price_id` and `stripe_remaining_price_id`.
8. Run the full Pay in Full, three-month, six-biweekly, failure/recovery, delayed/duplicate webhook, and Customer Portal matrices. Verify installment #1 is not duplicated and that schedules contain exactly two or five remaining iterations starting at contractual installment #2.

Stripe references: <https://docs.stripe.com/api/versioning>, <https://docs.stripe.com/payments/save-during-payment>, <https://docs.stripe.com/billing/subscriptions/subscription-schedules>, <https://docs.stripe.com/customer-management/configure-portal>, and <https://docs.stripe.com/webhooks>.

## Resend status

The six branded templates exist and are tested for lifecycle coverage and unsafe-content filtering:

- Agreement invitation
- Agreement accepted
- Payment confirmation
- Payment failure
- Portal activation
- Onboarding instructions

Provider delivery remains intentionally absent until Access and Stripe pass. At that point configure a preview-only sender, encrypted Resend API key, approved test recipients, and idempotent `outbound_message_events` handling. No production recipient may be used during preview validation.

## UX, hydration, accessibility, and browser status

Static and automated checks passed for:

- skip links and semantic landmarks;
- persistent labels, fieldsets/legends, error associations, `aria-invalid`, and alert/status regions;
- visible `:focus-visible` styling;
- native keyboard-selectable payment radios;
- reduced-motion rules;
- no browser storage authorization state;
- no raw card fields;
- no operation surface references to the large robot video;
- 156,330 bytes total across the three operation HTML pages and their isolated CSS/JS source files listed in the size audit.

The following mandatory acceptance items remain unverified because the managed browser policy denied access:

- screenshots;
- actual Chromium/WebKit layout at 375, 430, 768, 1024, and 1440 px;
- manual keyboard completion and focus movement;
- 200% zoom;
- rendered contrast;
- hydration timing, placeholder replacement, console, Network panel, and CSP console inspection.

This is the only correct status: blocked, not passed.

## Deployed security results

- Unauthorized portal: 401.
- Unauthorized admin: 401.
- Forged admin preview client ID without authentication: 401.
- Invalid invite from trusted origin: generic 404.
- Cross-origin invite exchange: 403.
- Non-JSON invite exchange: 415.
- Admin/client authentication without Access configuration: fail-closed 503.
- Stripe webhook without complete sandbox configuration: fail-closed 503.
- Function responses include direct no-store and security headers; they do not rely only on `_headers`.
- Local integration tests pass client isolation, Client Viewer signer/billing denial, collaborator assignment scope, forged client ID, CSRF rejection, inactive-portal denial, session revocation, and published-only data.

Tests that require real Access identities or Stripe-signed sandbox events remain blocked by their respective configuration gates.

## Legal gate

Pending attorney/E4LA approval:

- service agreement;
- fixed-program fee;
- installment authorization;
- stored/future off-session charge authorization;
- failed-payment handling;
- cancellation/refund terms;
- signer authority;
- electronic acceptance;
- privacy/data handling;
- retention, deletion, and offboarding.

The final accepted-agreement archival artifact must be generated only after this language is approved. It must use the immutable accepted version and evidence, never a later template.

## Production preparation and rollback

Do not create production D1, production Access apps, live Stripe objects, production Resend configuration, or real invitations yet.

Recommended order after all preview gates pass:

1. Approve legal text and regenerate reviewed immutable agreement version fixtures.
2. Complete rendered, keyboard, zoom, cross-browser, hydration, and screenshot acceptance.
3. Review preview security evidence and reconcile every Stripe ledger entry.
4. Prepare production D1/bindings/secrets and migration commands without executing them.
5. Prepare production Access applications and exact identity policies.
6. Prepare live Stripe objects/webhook and Resend sender without charging or sending.
7. Obtain explicit production authorization.
8. Apply production migration, configure bindings, and run one fictional production smoke test.
9. Roll out to one controlled real client only after smoke-test review.

Rollback plan:

- Pages: roll the isolated preview project back from `56f14ffe` to the prior known deployment `b0f480fd` (or the Phase C baseline `2c92db6f`).
- D1: Phase D applied no migration and changed no remote D1 rows, so no database rollback is required for these corrections.
- Access: disable the two preview applications or revoke their tokens; application sessions remain revocable in D1.
- Stripe: use sandbox-only object deactivation; no live object or charge exists.
- Resend: no provider integration exists to roll back.

## Exit decision

The system cannot be classified `PREVIEW READY` or `PRODUCTION CANDIDATE` while Cloudflare Access, Stripe Sandbox end-to-end validation, rendered/manual accessibility acceptance, and legal approval are incomplete.

**NOT READY**
