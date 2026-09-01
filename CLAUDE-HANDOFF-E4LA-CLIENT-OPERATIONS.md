# E4LA Client Operations — Claude Master Handoff

Last updated: 2026-08-20 (America/Los_Angeles)

Repository: `e4la-site`
Classification: **NOT READY**

This is the single starting point for continuing the project. Read it completely before changing code. Then read `CLIENT-OPERATIONS-STATE.json`, `CLIENT-OPERATIONS-PHASE-D.md`, both migrations, and the tests.

## A. Project purpose

E4LA Client Operations is one connected lifecycle product, not three unrelated sites:

1. Agreement & Enrollment
2. Authenticated Client Portal
3. Authenticated E4LA Admin Panel
4. Cloudflare Pages Functions backend
5. Cloudflare D1 relational data store
6. Cloudflare Access identity layer plus E4LA application sessions
7. Stripe-hosted payment and fixed-installment architecture
8. Resend transactional email layer

The intended journey is Admin → client/project creation → immutable agreement → secure invitation → acceptance → Stripe payment/enrollment → policy-driven portal activation → client-visible work/deliverables/reports/billing → completion/retainer/archive.

Notion remains E4LA's detailed internal operations system. This application is the client/admin visibility, contractual, billing-state, and lifecycle layer. Nothing from Notion is automatically published. The publication boundary is human-controlled.

## B. Current classification and blockers

The exact current classification is **NOT READY**.

Working now:

- Three isolated, branded frontend surfaces and the connected Pages Functions API.
- Preview-only D1 with both migrations, fictional fixtures, immutable/legal evidence controls, identity/role tables, payment ledger, publication boundary, audit trail, and idempotency tables.
- Fail-closed Cloudflare Access verifier and E4LA session/CSRF system.
- Test-safe Stripe Checkout, fixed-schedule, Customer Portal, and webhook code paths.
- Inert Resend-ready templates and outbound-message idempotency schema.
- 22/22 automated tests.

Blocking approval:

- Cloudflare Access is not enabled/configured; API currently returns `access.api.error.not_enabled`.
- Stripe Sandbox resources/secrets and real sandbox end-to-end tests are absent.
- Resend preview integration is deliberately deferred until Access and Stripe pass.
- Agreement/legal text is explicitly placeholder content pending counsel-approved language.
- Rendered browser, screenshots, responsive/cross-browser, hydration, and manual accessibility QA are blocked by the managed-browser policy.
- No production D1, Access, Stripe, Resend, identities, invitations, or deployment configuration exists.

## C. Architecture and route map

### Frontend

| Route | Purpose | Initial HTML privacy |
| --- | --- | --- |
| `/client-agreement/` | Agreement/enrollment shell and safe preview states | Contains no client-specific agreement data |
| `/client-agreement/{opaque-id}#invite={token}` | Private agreement access | Token is fragment-only, exchanged by POST, then removed with `history.replaceState()` |
| `/client-portal/` | Authenticated client portal | Static shell; private data hydrates from authorized API |
| `/admin/` | Authenticated E4LA operations UI | Static shell; operational data hydrates from authorized API |

These routes are not in public navigation or the sitemap. Client-specific names are not used in URLs.

### Backend/API

All operations routes are handled by `functions/api/ops/[[path]].js`. Function responses set their own security headers; `_headers` only covers static responses.

Authentication/session:

| Method | Endpoint | Authorization/purpose |
| --- | --- | --- |
| `POST` | `/api/ops/auth/admin` | Verify Admin Access JWT, map active admin identity, issue E4LA session |
| `POST` | `/api/ops/auth/client` | Verify Client Access JWT, map active client identity, issue E4LA session |
| `POST` | `/api/ops/invites/exchange` | Atomically consume one-time fragment token and issue signer session |
| `GET` | `/api/ops/session` | Validate and rotate application session and CSRF state |
| `POST` | `/api/ops/session/logout` | Revoke D1 session and expire application cookie; UI then calls Access logout |

Agreement/enrollment:

| Method | Endpoint | Authorization/purpose |
| --- | --- | --- |
| `GET` | `/api/ops/agreements/current` | Signer-scoped immutable agreement version and approved payment plans |
| `POST` | `/api/ops/agreements/accept` | Signer + CSRF; validate and atomically persist acceptance, enrollment, ledger, audit evidence |
| `POST` | `/api/ops/checkout` | Signer/owner/authorized signer + CSRF; server-authoritative test Checkout creation |
| `GET` | `/api/ops/enrollment/status` | Authorized, webhook-authoritative enrollment status |

Billing/portal:

| Method | Endpoint | Authorization/purpose |
| --- | --- | --- |
| `POST` | `/api/ops/billing/portal` | Client owner/authorized signer + CSRF; authenticated Stripe Customer Portal session |
| `GET` | `/api/ops/portal` | Active client session; published client-visible data only |

Admin:

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/ops/admin/summary` | Actionable operational summary, role/project scoped |
| `POST` | `/api/ops/admin/clients-projects` | Create client and initial project |
| `PATCH` | `/api/ops/admin/clients/{client-id}` | Update allowlisted client/lifecycle fields |
| `POST` | `/api/ops/admin/agreements` | Create agreement, immutable version, and approved fixed plans |
| `POST` | `/api/ops/admin/agreements/{agreement-id}/invites` | Generate hashed, expiring one-time invitation |
| `POST` | `/api/ops/admin/projects/{project-id}/items` | Create client-facing operational item in internal publication state |
| `POST` | `/api/ops/admin/publication` | Move allowlisted portal item publication state |
| `POST` | `/api/ops/admin/enrollments/{enrollment-id}/activate` | Evaluate/update policy-driven portal activation |
| `GET` | `/api/ops/admin/preview/{client-id}` | Audited **ADMIN PREVIEW — Client View**, using client-visible data without impersonation |

Stripe:

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `POST` | `/api/stripe/webhook` | Raw-body Stripe signature verification, livemode rejection, idempotent ledger/state reconciliation |

There is no active email-sending API yet. `functions/_shared/email-templates.js` only renders inert templates.

## D. Important file map

Legend: **Critical** means part of Client Operations runtime or safety. “Edit” means Claude may edit when the next gate or a demonstrated defect requires it. “Avoid” means do not refactor casually.

| Path | Purpose | Critical | Guidance |
| --- | --- | --- | --- |
| `client-agreement/index.html` | Agreement shell, semantic form, legal placeholder, all UI states | Yes | Edit for proven agreement/accessibility defects; preserve no-client-data initial HTML |
| `client-portal/index.html` | Portal shell/navigation/hydration targets | Yes | Edit for proven portal QA defects |
| `admin/index.html` | Admin shell/workflows/navigation | Yes | Edit for proven admin QA defects |
| `assets/css/operations.css` | Shared isolated design tokens/components | Yes | Edit carefully; do not merge into public CSS |
| `assets/css/client-agreement.css` | Agreement-only layout/readability states | Yes | Edit for rendered defects |
| `assets/css/operations-dashboard.css` | Portal/admin layouts, tables, timelines, responsive rules | Yes | Edit for rendered defects |
| `assets/js/client-agreement.js` | Invite exchange, fragment removal, agreement hydration/validation/acceptance/checkout/recovery | Yes | Security-sensitive; preserve fragment/token rules |
| `assets/js/client-portal.js` | Access login, portal hydration, view switching, billing, logout | Yes | Preserve role/server authority and dual logout |
| `assets/js/admin.js` | Access login, operational workflows, admin preview, logout | Yes | Preserve project scope and labeled preview |
| `assets/js/ops-model.js` | Fictional demo data, validation, analytics allowlist, safe preview-host gate | Yes | Never enable demo on `e4la.org` |
| `functions/api/ops/[[path]].js` | Main Pages Functions API router and business logic | Yes | High-risk; edit only with tests and authorization review |
| `functions/api/stripe/webhook.js` | Stripe signature/idempotency/payment ledger/schedule reconciliation | Yes | Highest risk; preserve duplicate-invoice fix |
| `functions/_shared/ops-security.js` | Headers, sessions, cookies, CSRF, Origin, hashing, rate limits, audit/logging | Yes | High-risk; avoid weakening fail-closed behavior |
| `functions/_shared/cloudflare-access.js` | Access JWT/JWKS/issuer/audience validation | Yes | Configure, then validate; do not bypass |
| `functions/_shared/environment.js` | Environment separation, required config, preview/live-key rejection | Yes | Preserve fail-safe environment checks |
| `functions/_shared/stripe.js` | Stripe request helpers, Checkout/Portal construction | Yes | Sandbox only until explicit production approval |
| `functions/_shared/portal-activation.js` | Automatic/manual/scheduled activation decision | Yes | Preserve policy-driven activation |
| `functions/_shared/email-templates.js` | Six sanitized branded transactional templates | Yes | Inert until Resend gate; no real recipients |
| `migrations/0001_client_operations.sql` | Core relational schema, checks, immutable/append-only triggers | Yes | Applied; never edit as a shortcut—add a new migration |
| `migrations/0002_phase_c_preview.sql` | Environment marker, Access identity links, activation fields, outbound messages | Yes | Applied; add future migrations rather than rewriting history |
| `fixtures/client-operations.local.sql` | Minimal fictional local fixture | No | Safe test data only |
| `fixtures/client-operations.preview.sql` | Six fictional lifecycle scenarios and publication-boundary records | Yes (preview) | Never load into production |
| `tests/phase-b.test.mjs` | Phase B schema/security/API/static assertions | Yes | Extend when behavior changes |
| `tests/phase-c.test.mjs` | Access, roles, sessions, Stripe, webhook, publication, deployment safety tests | Yes | Preserve regression coverage |
| `wrangler.preview.jsonc` | Isolated Pages project and preview D1 binding | Yes | Preview only; never reuse as production config |
| `config/client-operations.environment.example` | Non-secret required variable inventory | Yes | Documentation only; never add real values |
| `_headers` | Static private-route security/noindex headers | Yes | Do not assume it covers Function responses |
| `_redirects` | Wildcard rewrites to operations shells | Yes | Preserve public redirects and opaque agreement routing |
| `.gitignore` | Excludes env, `.dev.vars`, Wrangler state, dependencies | Yes | Never unignore secrets |
| `package.json` | Test scripts; no runtime dependency bundle | Yes | Keep lean |
| `CLIENT-OPERATIONS-PHASE-B.md` | Foundation design/schema/security/route record | Reference | Avoid rewriting history |
| `CLIENT-OPERATIONS-PHASE-C.md` | Integration checkpoint and preview evidence | Reference | Avoid rewriting history |
| `CLIENT-OPERATIONS-PHASE-D.md` | Latest gate report, defect corrections, rollback guidance | Reference | Append only if new Phase D evidence is generated |
| `CLIENT-OPERATIONS-DATA-POLICY.md` | Draft operational data policy | Reference/draft | Do not label approved without E4LA/counsel approval |
| `CLAUDE-HANDOFF-E4LA-CLIENT-OPERATIONS.md` | This master continuity document | Yes | Keep current when material state changes |
| `CLAUDE-RESUME-PROMPT.md` | Paste-ready Claude continuation prompt | Yes | Keep concise |
| `CLIENT-OPERATIONS-STATE.json` | Machine-readable current state | Yes | Update with every gate/deployment/status change; no secrets |

Legacy root files `portal.html`, `portal.js`, `portal.css`, `auth.js`, `auth.css`, and sign-in/up prototype pages predate the authenticated Client Operations surfaces. They are not the Phase C/D portal. Do not reuse their frontend-only authentication.

## E. DO NOT MODIFY WITHOUT VERIFIED REGRESSION

The production public E4LA site is approved and deliberately isolated. Do not rewrite, refactor, or restyle these without a specific, reproduced regression directly caused by Client Operations:

- `index.html`
- `services.html`
- `our-work.html`
- `about.html`
- Public navigation in those pages/components
- Public global CSS: especially `style.css`, `assets/css/nav.css`, and public page CSS
- Public global JavaScript: especially `script.js`, `motion.js`, and public page scripts
- Booking flow: `functions/api/book.js` and booking UI/assets
- `sitemap.xml`
- `robots.txt`

Do not modify production DNS, Google Workspace MX records, production Pages bindings, production D1, public routes, or the booking system. Client Operations uses isolated CSS/JS and a separate preview Pages project intentionally.

## F. Design system

- Font: Manrope, using the existing production weight hierarchy. Do not add another font or duplicate loading.
- Backgrounds: `#07060D`, `#08070E`, `#0B0A14`.
- Canonical selective gradient: `#F97316 → #DB2777 → #7C3AED`.
- Spacing scale: `4, 8, 12, 16, 20, 24, 32, 40, 56, 72, 96px`.
- Radii: `6, 10, 14, 20px`, plus pills where appropriate.
- Cards: dark translucent surfaces, fine translucent white borders, restrained gradient borders/inset highlights/shadows.
- Forms: persistent accessible labels, approximately 52px dark inputs, clear visible focus, field descriptions/errors.
- Primary CTA: approximately 58px where appropriate; selective gradient, strong hierarchy.
- Minimum interactive target: 44px.
- Respect `prefers-reduced-motion`; no information may depend on animation.
- No generic SaaS/dashboard template look, corporate blue, fake metrics, excessive glassmorphism, or 12MB robot video.

Do **not** load the huge production global CSS/JS into Client Operations. The isolated operations UI is an intentional performance and regression boundary.

## G. D1 schema and relationships

Source of truth: `migrations/0001_client_operations.sql` plus additive `0002_phase_c_preview.sql`. Foreign keys are enabled. Never modify an applied migration; create the next numbered migration.

Client/access:

- `clients`: lifecycle and minimized business/contact record.
- `client_users` → `clients`: client email identity, role, access status.
- `admin_users`: E4LA admin/collaborator identity and access status.
- `admin_project_access` → `admin_users`, `projects`: collaborator project scope and permission level.
- `access_sessions` → optional client/agreement/identity link: hashed application sessions, CSRF, expiry, rotation, revocation.
- `identity_links` (0002): immutable Cloudflare Access subject ownership mapped to one D1 user.

Projects/publication:

- `projects` → `clients`.
- `project_milestones`, `project_updates`, `deliverables` → `projects`; each has explicit publication status.
- `portal_documents` → client, optionally project/agreement; explicit publication status.

Agreements:

- `agreements` → client/project; points to current and accepted versions.
- `agreement_versions` → agreement; exact rendered/legal/commercial snapshot.
- `agreement_invites` → agreement/version; stores only token hash, expiry/consume/revoke evidence.
- `agreement_acceptances` → agreement/version/client/project/payment plan; copies immutable evidence.

Commercial:

- `payment_plans` → immutable agreement version; fixed amounts/counts/schedule and optional Stripe Price IDs.
- `enrollments` → client/project/agreement/acceptance/payment plan; payment and portal-activation state.
- `payment_installments` → enrollment; authoritative contractual ledger.
- `stripe_objects` → enrollment; operational Stripe IDs only, never card data.

Control/audit:

- `audit_events`: append-only lifecycle/actor/request evidence.
- `processed_webhook_events`: Stripe event idempotency and retry state.
- `request_rate_limits`: hashed non-IP rate buckets.
- `environment_settings` (0002): immutable database environment marker.
- `outbound_message_events` (0002): idempotent future email delivery records.

Database protections:

- `agreement_versions`: UPDATE and DELETE blocked by triggers.
- `agreement_acceptances`: UPDATE and DELETE blocked by triggers.
- `audit_events`: UPDATE and DELETE blocked by triggers.
- `identity_links`: provider subject and user ownership cannot be changed.
- `environment_settings.environment`: value cannot be changed.
- Uniqueness prevents duplicate agreement/version acceptance, duplicate provider events, duplicate installment numbers, and duplicate Stripe object IDs.

Preview state as last read on 2026-08-20:

- Environment marker: `preview`.
- 6 fictional clients, 6 projects, 6 agreements, 6 agreement versions.
- 5 acceptances and 5 enrollments.
- 0 non-fictional client records.
- 0 identity links and 0 active application sessions (Access has never authenticated successfully).
- Preview identity rows prepared: admin `nasim@e4la.org`; fictional owner alias `nasim+e4la-client-owner@e4la.org`; fictional viewer alias `nasim+e4la-client-viewer@e4la.org`; collaborator remains `example.test` fixture.

## H. State machines

### Client lifecycle

Persisted values:

`prospect → qualified → agreement_prepared → agreement_sent → agreement_viewed → agreement_accepted → payment_initiated → payment_confirmed → active → project_active → work_in_progress → reporting → completed → ongoing | retainer | archived`

The API allowlists these states. State must be written server-side and audited; never infer it only from frontend navigation. Archive is terminal for ordinary operations unless an explicit audited reactivation workflow is approved.

### Agreement lifecycle

`draft → prepared → sent → viewed → accepted → payment_pending → enrolled → completed`

Branches: `prepared|sent → expired`; pre-acceptance records may become `superseded` or `void`. Invitation generation accepts only `prepared`, `sent`, or `viewed`. Acceptance accepts only `prepared`, `sent`, or `viewed`. Accepted/payment-pending/enrolled/completed/void/superseded agreements cannot reuse an invite or be accepted again. Material edits after version creation require a new immutable version; never mutate history.

### Enrollment/payment lifecycle

`accepted → checkout_pending → payment_processing`

- Full payment: `payment_processing → paid → activated → completed` as activation/project policy allows.
- Installments: initial webhook confirmation → `first_payment_confirmed → schedule_pending → schedule_active → paid`; portal activation remains policy-driven.
- Recoverable states: `payment_failed`, `payment_action_required`, `attention_required`.
- Checkout expiration/abandonment returns to a recoverable state; redirects never confirm payment.
- Schedule creation/completion inconsistency must become `attention_required`, not paid.
- Invalid client-supplied prices/counts/plans fail validation; ledger is authoritative.

### Portal activation

`activation_mode` is `automatic | manual | scheduled`; `onboarding_ready`, first-payment state, optional scheduled time, and admin policy are evaluated in `portal-activation.js`. Do not reduce this to “payment succeeded → portal opens.” `portal_activated_at` grants access; `portal_deactivated_at` removes it.

The original `portal_activation_policy` values (`first_payment_confirmed | paid_in_full | manual`) remain in the base schema; Phase C's `activation_mode` adds the operational activation method. Treat both as contractual eligibility versus operational activation, not interchangeable flags.

### Portal publication

`internal → reviewed → approved → published → withdrawn`

Only `published` records may be returned to clients or Admin Preview. Invalid skips/backward changes must be rejected unless explicitly supported by the admin publication handler. Withdrawal removes client visibility without deleting internal history. Never automatically publish Notion/internal records.

## I. Authentication and authorization

Intended model:

1. Separate Cloudflare Access self-hosted applications protect admin and client paths.
2. The browser submits the signed `Cf-Access-Jwt-Assertion` to the correct authentication endpoint.
3. `cloudflare-access.js` verifies RS256 signature against team JWKS, issuer, route-specific audience, `exp`/`nbf`, email, and subject.
4. D1 requires an active matching `admin_users` or `client_users` row.
5. An immutable hashed subject `identity_links` row binds the provider identity to exactly one D1 user.
6. E4LA issues a separate rotating, revocable, expiring `__Host-e4la_ops` cookie (`HttpOnly; Secure; SameSite=Lax; Path=/`). Only hashes are stored.
7. Mutating operations require exact Origin, JSON, active session, role/entity scope, and `X-E4LA-CSRF` matching the server-side CSRF hash.
8. `GET /api/ops/session` rotates the session and revokes the old record. Logout revokes D1 session and clears the cookie; portal/admin JS then navigates to `/cdn-cgi/access/logout` to clear Access.

Roles:

| Capability | E4LA Admin | E4LA Collaborator | Client Owner / Authorized Signer | Client Viewer |
| --- | --- | --- | --- | --- |
| Global clients/agreements/payments | Yes | No | Own client only where relevant | No |
| Assigned project operations | Yes | Assigned projects per `admin_project_access` | Read published own-client data | Read published own-client data |
| Create/version/send agreement | Yes | Assigned/project permission only where handler permits | No (invited signer may accept own agreement) | No |
| Accept agreement | No silent impersonation | No | Yes only with signer authority/session | No |
| Billing/Customer Portal | Operational status | Scoped status only | Yes | No |
| Publish/withdraw portal content | Yes | Assigned project scope | No | No |
| Admin Preview | Yes, labeled/audited | Assigned client/project, labeled/audited | N/A | N/A |

Every API handler must continue to scope by the session's client/agreement/project. Cloudflare Access admission is not authorization by itself.

## J. Cloudflare status and exact blocker

Account: Nasim@e4la.org account, ID `d46a9c706deda22ac164ef796ea45bc7`.

Preview Pages project: `e4la-client-operations-preview`, project ID `db56b063-dcf4-4445-b1bf-88bf3dd37ab0`.

Stable URL: <https://e4la-client-operations-preview.pages.dev>

Latest known validated deployment: `56f14ffe` / <https://56f14ffe.e4la-client-operations-preview.pages.dev>

Preview D1: `e4la-client-operations-preview`, ID `2d6a0170-f8b9-496d-acd4-50adf3cf9e58`, binding `ENROLLMENT_DB`.

Current preview environment has `ENVIRONMENT=preview`, `PUBLIC_SITE_URL`, and encrypted `ENROLLMENT_SESSION_SECRET`. It lacks:

- `ACCESS_TEAM_DOMAIN`
- `ADMIN_ACCESS_AUD`
- `CLIENT_ACCESS_AUD`

Required Access design:

- Suggested preview-safe team domain: `e4la-client-ops-preview.cloudflareaccess.com` (confirm availability).
- One-Time PIN/email identity provider for controlled preview identities; Cloudflare account identity may be used for the approved admin if appropriate.
- Admin Access app on preview hostname only, protecting `/admin/*` and `/api/ops/auth/admin`, exact approved admin identity.
- Client Access app on preview hostname only, protecting `/client-portal/*` and `/api/ops/auth/client`, only controlled fictional owner/viewer identities.
- Retrieve each app AUD and set the three variables on the **preview** Pages environment, then redeploy/refresh bindings.

What has already been attempted:

- Wrangler 4.125.0 is authenticated as `nasim@e4la.org` and can manage Pages/D1, but its OAuth scope list contains no Access organization/application/policy scopes.
- Access organization GET originally returned `access.api.error.not_enabled`.
- Programmatic organization creation (`POST /accounts/{account}/access/organizations`) with preview name/domain returned API error `10000 Authentication error`, confirming the connected token lacks Access write authority.
- Official APIs for organization, One-Time PIN identity provider, self-hosted applications, and policies were identified.
- Managed Cloudflare Dashboard navigation was attempted, but administrator-enforced browser policy verification failed. No security control was bypassed.
- Preview D1 identity mappings were performed programmatically; no manual D1 work is needed.
- **Update:** Zero Trust/Access has since been enabled on the account (team domain `snowy-forest-edc8.cloudflareaccess.com`, plan Zero Trust Free, Nasim has Super Administrator — All Privileges). Re-testing the same Wrangler OAuth token against `GET /access/organizations`, `/access/identity_providers`, and `/access/apps` after enablement still returns `10000 Authentication error` on every call, confirmed against a fresh, correctly-parsed token (sanity-checked against `GET /accounts/{id}` and `/zones`, both of which succeed with the same token). Confirmed via `wrangler whoami` that the token's OAuth scope grant (fixed by Wrangler's own client registration, independent of account state) has no Access-related scope at all, and the token also lacks `user.tokens` permission so it cannot create a better-scoped token for itself. Checked for alternatives: no `CLOUDFLARE_*` env var, no other local credential file, no Cloudflare MCP connector, no `wrangler` Access/Zero Trust subcommand exists. **The remaining blocker is a token-scope problem, not an account-enablement problem.**

Smallest unresolved account boundary: Nasim must create a Cloudflare API Token via **Dashboard → My Profile → API Tokens → Create Custom Token**, with exactly `Account / Access: Apps and Policies / Edit` and `Account / Access: Organizations, Identity Providers, and Groups / Edit`, scoped to her account. The token must reach Claude only via a local file (never pasted into chat) that Claude reads directly — pasting it into a chat message is a hard stop this project treats the same as any other secret-credential entry. After a validly-scoped token is in place, Claude should retry the API before asking for any additional dashboard work, and should re-verify current state live rather than trusting this note on a future resume, since account state can change between sessions.

## K. Stripe architecture and safety

Stripe handles all card/payment credentials. E4LA stores only operational IDs, contractual ledger, and reconciled state.

Pay in full (`$3,600` fictional configuration): hosted Checkout in `payment` mode → verified webhook → ledger/payment/enrollment update. The success redirect is informational only.

Three monthly payments: installment 1 (`$1,200`) via Checkout in payment mode with Stripe-managed reusable payment method → only after webhook-confirmed payment #1 create a future-dated schedule starting at contractual installment #2 date → exactly two remaining monthly iterations → automatic termination.

Six biweekly payments: installment 1 (`$600`) via Checkout → webhook-confirmed → future schedule at installment #2 date → exactly five remaining two-week iterations → automatic termination. No seventh payment.

Required Sandbox matrix includes success, failure, abandon/expiry, return-before-webhook, delayed/duplicate/replayed events, saved payment method, correct future start dates/iterations/totals, authentication required, expired/replaced card, future failure, schedule-creation failure, and schedule completion.

Failure/recovery states are explicit: `payment_failed`, `payment_action_required`, or `attention_required`. Schedule creation failure and ledger/schedule inconsistency must fail closed to `attention_required`.

Safety invariants:

- Reject live `sk_live_` keys and `livemode=true` webhook events in preview.
- No raw card inputs, numbers, CVV, or credentials in E4LA code/D1/logs.
- Validate payment plan, price IDs, total, schedule amounts, dates, and count server-side.
- Stripe webhook raw body, signature, timestamp tolerance, and event ID are verified.
- `processed_webhook_events` provides event idempotency; invoice evidence is also deduplicated by Stripe invoice ID.
- D1 installment ledger is authoritative; success redirect is not.
- Customer Portal is authenticated and owner/signer-only; its dedicated configuration must allow payment-method update and receipts/invoices while disabling plan change/cancellation.
- The Stripe API version fallback was intentionally removed. `STRIPE_API_VERSION` must be explicitly confirmed in E4LA Stripe Workbench and configured.

Fixed defect not to reintroduce: previously the same Stripe invoice delivered under a different event ID could advance more than one installment. `functions/api/stripe/webhook.js` now resolves installment evidence by invoice ID, accepts legacy/new subscription references, prevents one invoice from paying two ledger rows, and makes `subscription_schedule.completed` become `attention_required` when unpaid ledger rows remain. Regression coverage is in `tests/phase-c.test.mjs`.

## L. Resend status

`functions/_shared/email-templates.js` contains sanitized, branded renderers for:

- Agreement Invitation
- Agreement Accepted
- Payment Confirmation
- Payment Failure
- Portal Activation
- Onboarding Instructions

They are inert. No Resend provider call, production key, or real client email has been sent. `outbound_message_events.idempotency_key` is ready to prevent duplicate sends. Do not integrate or send until Cloudflare Access and Stripe Sandbox gates pass. Use preview-only sender and approved test recipients; never paste a Resend key in chat.

## M. Legal boundary

Current agreement content is visibly labeled placeholder content. Claude must not generate, reinterpret, or finalize legal language. Required approval:

- Final service agreement
- Fixed-program fee wording
- Installment authorization
- Stored-payment authorization
- Future off-session charge authorization
- Failed-payment handling
- Cancellation/refund terms
- Signer authority
- Electronic acceptance
- Privacy/data handling
- Retention/deletion/offboarding
- Historical document access

After approval, create a new immutable agreement version and final human-readable archival artifact from that accepted snapshot/evidence. Never reconstruct an accepted contract from a newer template.

## N. Data policy draft

`CLIENT-OPERATIONS-DATA-POLICY.md` is a **draft**, not approved policy. It records:

- Storage: D1 for minimized client/project/legal/operational state; Stripe for payment credentials; Notion/internal systems for internal work; future approved R2/document storage for deliverables; Resend plus D1 delivery events for email.
- Access: admins global, collaborators assigned projects, owners/signers own legal/billing scope, viewers published portal only.
- Immutable records: agreement versions, acceptances, audit events, identity ownership, environment marker.
- Retention: no arbitrary duration encoded pending approval.
- Deletion: ordinary admin actions cannot delete immutable contractual/audit/commercial evidence.
- Offboarding: revoke sessions/access, preserve required evidence, deliberately withdraw/archive content, apply approved retention later.
- Client access: published portal content, accepted own agreements, authorized billing summaries only.

E4LA and counsel must approve retention, deletion, offboarding, and historical-access rules before production.

## O. Security controls

Implemented controls include opaque IDs; fragment-only invite tokens; SHA-256 token/session/CSRF/rate hashes; atomic single-use invite consumption; `HttpOnly`, `Secure`, `SameSite=Lax`, `__Host-` cookies; session rotation/revocation/expiry; CSRF; strict Origin and JSON checks; role, client, agreement, and project scope; collaborator project access; parameterized D1 statements; rate limiting without IP collection; `Cache-Control: no-store`; Function-level CSP, clickjacking, MIME, referrer, permissions, opener/resource, robots headers; Access JWT signature/issuer/audience/time verification; Stripe signature/livemode/idempotency; immutable agreement evidence; append-only audit events; published-only client queries; no PII analytics; no sensitive browser storage; no secret values in source.

Operational logging allows request ID, event type, environment, opaque IDs, status, timestamp, and non-sensitive error code. Never log invite tokens, cookies, CSRF values, agreement text, signatures, card data, full sensitive bodies, or email content.

## P. Analytics

`assets/js/ops-model.js` dispatches provider-neutral `e4la:analytics` custom events. Allowlisted events:

- `agreement_viewed`
- `agreement_validation_error`
- `agreement_accepted`
- `payment_plan_selected`
- `checkout_started`
- `checkout_returned`
- `enrollment_confirmed`
- `enrollment_error`
- `portal_activated`
- `portal_viewed`
- `deliverable_viewed`

Only `agreementState`, `planCode`, `surface`, `result`, and `count` with primitive values survive the adapter. Never send names, emails, addresses, agreement text, signatures, confidential project data, payment details, tokens, or provider IDs. Do not duplicate the public site's analytics loader.

## Q. Known defects already fixed

1. **Stripe duplicate invoice evidence:** one invoice could previously advance multiple installments if replayed under a distinct event ID. Fixed in `functions/api/stripe/webhook.js`; ledger reconciliation now checks invoice evidence and schedule completion cannot fabricate paid entries.
2. **Dual logout:** application logout alone left the Cloudflare Access browser session. `assets/js/admin.js` and `assets/js/client-portal.js` now revoke the E4LA session, clear its cookie through the API, then navigate to `/cdn-cgi/access/logout`. Do not remove either step.
3. **Opaque agreement wildcard:** deployed opaque agreement paths once rewrote to the public homepage. `_redirects` now rewrites `/client-agreement/*` to the agreement shell.
4. **Client portal boot-order crash (Phase D):** `assets/js/client-portal.js` called `boot()` at module top, before `const portalTabs`/`const portalSections` were declared. Since the `isPreview` path in `boot()` never hits an `await`, it ran fully synchronously and threw `ReferenceError: Cannot access 'portalSections' before initialization` on every single load on `localhost` or the preview host — the client portal was completely broken for anyone opening it outside an authenticated session. Fixed by moving the `boot();` call to after the tab/section declarations and event-listener wiring. Verified by serving the static files locally and loading `/client-portal/index.html` (and `?state=empty`, `?state=completed`) with zero console errors post-fix.
5. **Real invitations could reference placeholder legal text (Phase D):** `createAgreementInvite` in `functions/api/ops/[[path]].js` checked only `agreement.status IN ('prepared','sent','viewed')` before issuing a real client invitation — nothing read `commercial_terms_json.legalStatus` back out, so a real invite could go out referencing an agreement version whose legal text is still `'phase_c_placeholder'`. Fixed: the handler now joins the current version and rejects with `409 agreement_legal_unapproved` unless `legalStatus === 'approved'`. Every version `createAgreement` writes today is stamped `'phase_c_placeholder'`, so this correctly blocks all real invitations until Section M's legal approval lands and a future code path stamps a version `'approved'`.
6. **`payment_plans` had no immutable trigger (Phase D):** unlike `agreement_versions`/`agreement_acceptances`, `payment_plans` could be directly UPDATEd/DELETEd even after an agreement referenced it (not exploitable through the API today — nothing calls UPDATE on it — but a real schema gap). Fixed additively via `migrations/0003_payment_plans_immutable.sql`, matching the existing trigger pattern. **Not yet applied to the live preview D1** — apply it the next time preview D1 access is available (`wrangler d1 migrations apply ENROLLMENT_DB --remote` against the preview config, or however Gate 1's resolution ends up running migrations).
7. **Email templates dropped client name and text-only disclaimers (Phase D):** `functions/_shared/email-templates.js` sanitized `clientName` but never rendered it (every email greeted nobody), and the plain-text body omitted the `content.note` disclaimer/next-step line that the HTML body included. Both fixed with minimal additions to the existing template functions.

## R. QA evidence and untested gates

Latest automated evidence: **60/60 tests pass** (`npm test`, up from the prior 22/22 baseline). The Phase D pass added 38 new tests across four new files (`tests/phase-d-authz.test.mjs`, `tests/phase-d-stripe.test.mjs`, `tests/phase-d-email.test.mjs`, `tests/phase-d-agreement.test.mjs`) covering admin/collaborator/owner/viewer authorization and cross-client isolation, invite/session replay and revocation, CSRF/Origin enforcement, publication boundary and Admin Preview isolation, Stripe webhook idempotency/out-of-order events/failure-state mapping/schedule-failure recovery/server-side price enforcement/Billing Portal role gating, email template interpolation and dispatch idempotency, and agreement/payment-plan immutability — all against mocked/local D1 and constructed Stripe payloads, no live external calls. Every item on that checklist was found already correctly implemented except the six defects listed in Section Q above.

Deployed checks previously confirmed operations static routes return 200 with private/static headers; unauthorized session/admin-preview calls fail closed; auth endpoints return 503 while Access variables are absent; webhook returns 503 while Stripe is absent. Preview D1 is healthy and isolated. Production public homepage/services/work/about source is unchanged by the implementation (re-verified again in Phase D via `git diff` against every file in `protected_files`: zero changes).

**Rendered browser QA — completed as far as possible without Cloudflare Access**, using the project's own local demo mode (`isSafeProductPreview()` returns true unconditionally on `localhost`/`127.0.0.1`, and `demoStateFromUrl()` supports a `?state=` matrix — no Cloudflare Access or live backend needed). Served the static files locally and drove them with a sandboxed browser tool across two passes:

- **Client Portal**: all 6 tabs individually verified (real content, correct mutually-exclusive `aria-selected`/`hidden`, correct `#hash`); full keyboard tablist behavior (Tab/ArrowLeft/ArrowRight/Home/End roving tabindex) verified; `?state=empty` and `?state=completed` verified; Admin Preview banner verified correctly labeled and non-impersonating.
- **Agreement**: all 12 `renderState()` states individually verified with correct copy/icon/action button per state; validation verified (error-summary focus + `aria-invalid` on all 21 required fields); payment-plan selection verified as native `<input type=radio>` (keyboard-accessible for free, no custom JS needed) and confirmed to correctly update the sidebar summary on selection.
- **Admin**: all 8 panels plus Settings individually verified with real content; mobile nav and data tables correctly scroll within their own containers rather than overflowing the page.
- **Accessibility**: skip link and focus-visible outline verified via actual Tab-key focus on all three surfaces; WCAG contrast **measured programmatically** (proper alpha-compositing of translucent backgrounds against the real page background, not just reading CSS values) across 35 unique text/background pairs sampled from Admin — zero real failures; 44px touch targets confirmed via each checkbox/radio's wrapping `<label>` (111–303px effective area); reduced-motion CSS confirmed comprehensive; no dialog/modal exists anywhere in the three surfaces (N/A, not untested); no color-only status indicators (every badge pairs color with a text label). Two apparent failures surfaced mid-measurement and were both tooling artifacts, caught and corrected before being reported as real findings — worth knowing if re-running similar checks: contrast must composite the *element's own* background if it sets one (not just the parent's), and touch-target size must be measured on the wrapping `<label>`, not the raw `<input>`.
- **Responsive/zoom**: 375/430(-equivalent)/640(~200%-zoom-equivalent)/768/1440 all show zero page-level horizontal overflow on all three surfaces; the only "overflowing" elements are ones designed to scroll within their own container (nav bars, data tables, tab lists).
- **Observation, not a defect**: on mobile, the Agreement page's payment CTA sits ~86% down the page with no sticky shortcut — reachable only after scrolling the full form and legal text. Left as-is: forcing full review before a legal/payment acceptance is arguably correct for this flow, not broken. Flagging for a product decision rather than changing unilaterally.
- **Still not done**: a second browser engine for comparison (only one was available in this session's tooling); authenticated (non-demo-mode) hydration against a real session; network-level race conditions (both need the live API layer, gated behind Cloudflare Access).

A harmless finding, not fixed: all three shells set `frame-ancestors` via a `<meta http-equiv="Content-Security-Policy">` tag, which browsers ignore for that directive (Chrome logs a console warning on every load). If frame-ancestors protection matters, it needs to be set via the real HTTP header (check `_headers`) rather than the meta tag; the meta tag can stay for the other CSP directives it does enforce.

## S. Demo mode

`isSafeProductPreview()` permits fictional demo data only on:

- `localhost`
- `127.0.0.1`
- `e4la-client-operations-preview.pages.dev`
- deployment subdomains ending `.e4la-client-operations-preview.pages.dev`

The preview host additionally requires `?demo=1`. Production `e4la.org` never qualifies. State allowlist is in `assets/js/ops-model.js`; examples:

- `/client-agreement/fictional-preview?demo=1`
- `/client-agreement/fictional-preview?demo=1&state=validation|payment|invalid|expired|reused|accepted|pending|returned|processing|failed|attention|confirmed|activation-pending|portal`
- `/client-portal/?demo=1&state=active|empty|no-deliverables|completed`
- `/admin/?demo=1&state=zero|single|multiple`

All demo data is fictional. Never broaden the hostname allowlist or allow demo mode on production.

## T. Preview and production isolation

Preview URL: <https://e4la-client-operations-preview.pages.dev>

Latest known deployment: `56f14ffe`

Pages project: `e4la-client-operations-preview`

D1 binding/database: `ENROLLMENT_DB` → preview ID `2d6a0170-f8b9-496d-acd4-50adf3cf9e58`

Environment marker: `preview`

Migrations: `0001` and `0002` applied to preview only

Fixture counts: 6 fictional clients/projects/agreements/versions; 5 acceptances/enrollments.

Production is untouched: no production D1, production migration, live Stripe, real invitation, real client account, production Access app, production email, DNS/MX change, public navigation change, sitemap/robots change, or production Client Operations activation. Preserve this boundary until explicit approval.

## U. Remaining gates, in exact order

1. **Cloudflare Access:** enable/configure two preview apps and policies, audiences/vars, authenticate prepared identities, then validate roles, scope, session rotation/revocation/logout, and Admin Preview.
2. **Stripe Sandbox:** configure only test resources/secrets after Access passes; run the complete Checkout/installment/webhook/failure/Portal matrix.
3. **Resend Preview:** connect preview-only delivery and prove event/message idempotency with approved test identities.
4. **Rendered QA:** desktop/tablet/mobile screenshots, cross-browser, hydration/console/network, visual comparison, keyboard/zoom/contrast/reduced motion.
5. **Legal approval:** replace placeholders only with approved text by creating new immutable version/artifact flow.
6. **Production Candidate review:** security/config/diff/data/rollback review and prepare—do not execute—production resources.

Do not reorder these without a demonstrated technical reason. Do not configure Stripe before Access passes.

## V. Reproduction and operations commands

Run from repository root. No npm dependencies are currently declared; Node 20+ is sufficient for tests.

```bash
npm test
npm run test:phase-b
npm run test:phase-c
```

Static visual shell only (no Functions):

```bash
python3 -m http.server 4173
```

Local Pages Functions/D1 development:

```bash
npx wrangler@4.125.0 d1 migrations apply e4la-client-operations-preview --local --config wrangler.preview.jsonc
npx wrangler@4.125.0 d1 execute e4la-client-operations-preview --local --config wrangler.preview.jsonc --file fixtures/client-operations.local.sql
npx wrangler@4.125.0 pages dev . --config wrangler.preview.jsonc
```

Preview-only migration/fixture commands (remote writes; confirm target is preview before running):

```bash
npx wrangler@4.125.0 d1 migrations apply e4la-client-operations-preview --remote --config wrangler.preview.jsonc
npx wrangler@4.125.0 d1 execute e4la-client-operations-preview --remote --config wrangler.preview.jsonc --file fixtures/client-operations.preview.sql
```

Do not reload the fixture over a stateful preview without reviewing duplicates/immutability. Never use these commands against production.

Preview deployment (safe project only):

```bash
npx wrangler@4.125.0 pages deploy . --project-name e4la-client-operations-preview
```

Read-only preview D1 checks:

```bash
npx wrangler@4.125.0 d1 execute e4la-client-operations-preview --remote --config wrangler.preview.jsonc --command "SELECT setting_value FROM environment_settings WHERE setting_key='environment';"
npx wrangler@4.125.0 d1 execute e4la-client-operations-preview --remote --config wrangler.preview.jsonc --command "SELECT COUNT(*) FROM clients;"
```

Response/function checks:

```bash
curl -sS -D - -o /dev/null https://e4la-client-operations-preview.pages.dev/client-agreement/fictional-preview?demo=1
curl -sS -D - https://e4la-client-operations-preview.pages.dev/api/ops/session
curl -sS -D - -X POST https://e4la-client-operations-preview.pages.dev/api/stripe/webhook
```

Expect `no-store`, CSP, frame/MIME/referrer/permissions/noindex headers on protected routes/Function responses and fail-closed JSON without valid configuration/authentication. `_headers` does not secure Function-generated responses.

## W. External account dependencies

| System | Configured now | Remaining | Authentication/secrets rule |
| --- | --- | --- | --- |
| Cloudflare | Wrangler authenticated; isolated Pages project and preview D1 healthy; session secret set | Initial Access enablement, IdP/apps/policies/AUD vars, authenticated validation | Current Wrangler token lacks Access scopes. Never paste API tokens/cookies into chat |
| Stripe | Code/test architecture only | Sandbox API version, test secret/webhook secret, Prices, Portal configuration, webhook, full matrix | No credential currently available. Never use/paste live keys |
| Resend | Templates/schema only | Preview sender/key/test recipients/provider calls and idempotency tests after gates 1–2 | No credential currently available. Never paste API key into chat |
| GitHub | Local repo tracks `origin/main`; no production deployment action taken here | Push/review only when authorized; protect production deployment workflow | Do not rewrite history or force-push; never commit secrets |

## X. Architectural rationale

- **D1:** relational constraints, transactions/batches, immutable triggers, and Cloudflare-local deployment fit the lifecycle/evidence model.
- **Pages Functions:** integrates backend routes with the existing static site/Pages platform while allowing Function-level security headers and secrets.
- **Isolated CSS/JS:** reproduces E4LA identity without risking approved public pages or loading oversized public assets.
- **Notion remains internal:** rebuilding internal project management is out of scope; the portal exposes only reviewed, client-facing information.
- **Manual publication boundary:** prevents internal notes, research, and unfinished work from leaking to clients.
- **Fragment invitation token:** URL fragments are not sent in the initial HTTP request/referrer; the browser exchanges it securely and removes it immediately.
- **Immutable agreement records:** historical contracts must never change when templates/commercial terms change later.
- **Stripe schedule starts at installment #2:** Checkout collects installment #1; starting the remaining schedule immediately would duplicate the first payment.
- **Webhook-authoritative payment:** browser redirects can be early, abandoned, forged, or delayed; signed Stripe events reconcile actual payment state.
- **Policy-driven portal activation:** payment is necessary for some engagements but not sufficient; onboarding readiness/admin policy can also gate access.
- **Production untouched:** all legal, identity, billing, rendered-QA, and configuration gates must pass before any real client exposure.

## Y. Git handoff snapshot

Baseline before Client Operations handoff commit: branch `main`, latest prior commit `5f551e0` (`fix(seo): correct brand name...`). The working tree contained only the Client Operations implementation and three scoped infrastructure edits (`.gitignore`, `_headers`, `_redirects`); protected public page/source files were not modified. See the final handoff commit and `git status` for the durable post-handoff state.

## AA. External-gate preparation tooling (Phase F)

Every remaining external gate now has a ready-to-run script under
`scripts/gate-prep/` - full prerequisites, exact commands, expected output,
and rollback behavior per gate are documented in `scripts/gate-prep/README.md`;
this section is a pointer, not a duplicate. In short: `cloudflare-access-setup.mjs`
+ `access-smoke-test.mjs` (Gate 1), `d1-migrate.mjs` (applies 0003/0004 to
preview D1 - confirmed still unapplied as of this pass), `stripe-sandbox-provision.mjs`
+ `stripe-validation-suite.mjs` (Gate 2), `resend-preview-dispatch.mjs`
(Gate 3, defaults to a suppressed no-send mode), and `orchestrator.mjs` to
run all of them in sequence with resume support. Everything is DRY_RUN-safe,
fails closed on missing/wrong-shaped credentials, and none of it has been
run in a mode that touched a real external account this pass - `d1-migrate.mjs`
was run read-only to confirm migration status, nothing else.

`tests/phase-f-gate-prep.test.mjs` unit-tests the shared `scripts/gate-prep/lib/guardrails.mjs`
safety checks directly (production-hostname guard, test-mode-key guard,
livemode guard, database-identity guard, recipient-allowlist guard) - 87/87
across the whole suite as of this pass.

## Z. Claude's immediate next action

Do not add features. Read `CLAUDE-RESUME-PROMPT.md`, verify `npm test`, then
work through `scripts/gate-prep/README.md` gate by gate as credentials
become available - starting with **Gate 1 — Cloudflare Access**, which still
needs a dashboard-created API Token (the Wrangler OAuth session cannot be
used or self-elevated for this; re-verify live before assuming this note is
still current).
