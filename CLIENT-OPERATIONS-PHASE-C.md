# E4LA Client Operations System — Phase C Integration Checkpoint

Status: integrated product preview deployed; authentication, Stripe Sandbox, legal, and rendered-browser acceptance gates remain. Do not approve production activation from this checkpoint.

## Preview resources

- Stable URL: `https://e4la-client-operations-preview.pages.dev`
- Latest deployment: `https://2c92db6f.e4la-client-operations-preview.pages.dev`
- Separate Pages project: `e4la-client-operations-preview`
- Separate D1 database: `e4la-client-operations-preview`
- D1 ID: `2d6a0170-f8b9-496d-acd4-50adf3cf9e58`
- D1 environment marker: `preview`
- Production E4LA Pages project, domains, database, and routes were not changed.

The preview hostname is noindexed sitewide. Private static routes and all Function responses add their own restrictive caching, CSP, referrer, frame, MIME, permissions, and robots headers.

## Files changed since Phase B

Added:

- `migrations/0002_phase_c_preview.sql`
- `fixtures/client-operations.preview.sql`
- `functions/_shared/environment.js`
- `functions/_shared/cloudflare-access.js`
- `functions/_shared/portal-activation.js`
- `tests/phase-c.test.mjs`
- `config/client-operations.environment.example`
- `wrangler.preview.jsonc`
- `CLIENT-OPERATIONS-DATA-POLICY.md`
- `CLIENT-OPERATIONS-PHASE-C.md`

Changed:

- `functions/_shared/ops-security.js`
- `functions/api/ops/[[path]].js`
- `functions/api/stripe/webhook.js`
- `admin/index.html`
- `assets/css/operations-dashboard.css`
- `assets/js/admin.js`
- `assets/js/client-portal.js`
- `_headers`
- `package.json`

No Phase C changes were made to the homepage, services, work, about, public navigation, global stylesheet, global JavaScript, booking flow, sitemap, or robots file.

## Authentication architecture

Selected provider: Cloudflare Access email identity, mapped into the existing D1 role model.

1. Cloudflare Access authenticates the email identity separately for admin and client surfaces.
2. The Function verifies the signed `Cf-Access-Jwt-Assertion` against the team JWKS, issuer, route-specific audience, expiry/not-before time, email, and subject.
3. D1 maps the normalized email to an active `admin_users` or `client_users` row.
4. An immutable identity link binds the hashed provider subject to exactly one D1 user.
5. E4LA issues its own rotating, expiring, revocable `HttpOnly`, `Secure`, `SameSite=Lax` session and CSRF state.
6. Every API action rechecks the D1 role and entity scope. Authorization is never stored in browser storage.

Cloudflare Access is not enabled on the account yet. `POST /api/ops/auth/admin` and `/client` therefore return a generic fail-closed `503 identity_provider_not_configured` until E4LA completes Access onboarding and supplies the team domain and two audiences.

### Roles and permissions

| Capability | Admin | Collaborator | Client Owner / Signer | Client Viewer |
| --- | --- | --- | --- | --- |
| Create client/project/agreement/invite | Yes | No | No | No |
| View all operational clients | Yes | Assigned projects only | Own client only | Own client only |
| Publish portal item | Yes | Assigned contributor/manager projects | No | No |
| Admin Preview | Yes | Assigned clients only | No | No |
| Accept agreement | No implicit signer authority | No | Authorized signer only | No |
| Open billing portal | No client impersonation | No | Yes | No |
| View published portal data | Through labeled Admin Preview | Through labeled scoped preview | Yes | Yes |

## Phase C API additions

- `POST /api/ops/auth/admin`
- `POST /api/ops/auth/client`
- `POST /api/ops/admin/clients-projects`
- `PATCH /api/ops/admin/clients/{opaque-client-id}`
- `POST /api/ops/admin/agreements`
- `POST /api/ops/admin/agreements/{opaque-id}/invites`
- `POST /api/ops/admin/enrollments/{opaque-id}/activate`
- `POST /api/ops/admin/publication`
- `POST /api/ops/admin/projects/{opaque-project-id}/items`
- `GET /api/ops/admin/preview/{opaque-client-id}`

The existing Phase B agreement, checkout, portal, billing, and webhook endpoints remain in place.

## D1 preview evidence

- Both migrations applied to preview only.
- 24 tables after Phase C migration.
- 6 fictional clients across waiting-for-signature, accepted/payment-pending, payment-confirmed/onboarding-required, active, action-required, and completed states.
- 6 immutable agreement versions.
- 5 fictional acceptances and enrollments.
- 3 activated fictional portal states.
- Remote mutation of an agreement version failed with `SQLITE_CONSTRAINT_TRIGGER: agreement versions are immutable`.
- Remote mutation of an acceptance failed with `SQLITE_CONSTRAINT_TRIGGER: agreement acceptances are immutable`.

## Automated QA

`npm test`: 20/20 passing.

Covered:

- Fixed $3,600 plan totals and acceptance validation.
- Security headers, strict Origin, JSON-only mutations, CSRF rejection, and session cookie attributes.
- Stripe webhook HMAC/timestamp verification.
- Live Stripe key rejection in the Phase C code path.
- No browser storage of auth/private form data and no repository secrets.
- Preview environment/database mismatch rejection.
- Cloudflare Access RS256 signature, issuer, audience, expiry, and email validation.
- D1 immutable agreement/version and append-only audit triggers.
- Policy-driven portal activation prerequisites.
- Client publication boundary across internal, reviewed, approved, published, and withdrawn states.
- Three-payment schedule creates exactly 2 future iterations; six-payment schedule creates exactly 5; both use installment-two date and `end_behavior=cancel`.
- Fictional product-preview data is restricted to localhost or the isolated preview hostname with explicit `demo=1`.
- Transactional email templates cover the six approved lifecycle messages without sending mail or embedding credentials.
- Admin-created portal items start `internal`; client APIs remain `published`-only.

## Integrated product surfaces

- Agreement: guided client/business confirmation, three fixed-program payment schedules, required clause acknowledgments, readable legal placeholder, typed acceptance, recovery states, webhook-authoritative payment states, activation-pending and portal-available states.
- Client Portal: Overview, Project, Deliverables, Reports, Agreements, and Billing; prominent client-action state; published milestone/update/document boundary; historical agreement record; server-authoritative payment summary and authenticated Stripe Portal entry.
- Admin: actionable dashboard, client list and unified client record, agreement/invitation workflow, project-item creation, explicit publication controls, policy-driven portal activation, payments, append-only activity, environment settings, and labeled Admin Preview.
- Email: inert templates for invitation, acceptance, payment confirmation, payment failure, portal activation, and onboarding. No provider is called.

Fictional UI review URLs:

- `https://e4la-client-operations-preview.pages.dev/client-agreement/fictional-preview?demo=1`
- `https://e4la-client-operations-preview.pages.dev/client-portal/?demo=1`
- `https://e4la-client-operations-preview.pages.dev/admin/?demo=1`

The wildcard agreement-route regression discovered during deployed QA was fixed: opaque agreement paths now rewrite to the agreement application instead of the public homepage.

## Deployed response checks

- Agreement, portal, and admin static routes: `200`, `Cache-Control: no-store`, private-route CSP, clickjacking protection, `nosniff`, restrictive referrer/permissions policy, and `noindex`.
- Function session endpoint: `401 authentication_required` with direct Function security headers.
- Admin authentication endpoint: `503 identity_provider_not_configured` until Access onboarding.
- Stripe webhook endpoint: `503 stripe_not_configured` until Sandbox variables are supplied.
- Preview root: sitewide `X-Robots-Tag: noindex, nofollow, noarchive`.

## Publication QA

Remote preview D1 contains one published Drift Hotel update and one record in each hidden state: internal, reviewed, approved, and withdrawn. Local API/source tests confirm each portal table is queried with `publication_status = 'published'`.

The deployed client API cannot be exercised until client authentication is enabled, so this criterion remains pending end-to-end proof even though the server query boundary is implemented and tested locally.

## Stripe status

Architecture and tests are ready, but no Stripe Sandbox secret, webhook secret, Prices, Customer Portal configuration, or Workbench API-version confirmation was available. No Checkout Session, Customer, schedule, invoice, portal session, charge, or live Stripe object was created.

Consequently these remain unpassed: hosted Checkout return-before-webhook, payment failure, duplicate/delayed/replayed webhook in Stripe, saved payment method, three-month and six-biweekly live Sandbox schedules, portal payment-method update, and schedule completion.

## Portal activation

Payment confirmation no longer directly exposes a portal. Activation uses:

- `automatic`: initial payment confirmed + onboarding ready.
- `manual`: admin explicitly activates after prerequisites.
- `scheduled`: prerequisites + scheduled time reached.

Client portal APIs reject inactive/deactivated enrollments. The preview fixtures include payment-complete/onboarding-required and active portal states; local activation tests pass. Authenticated deployed proof remains pending Access.

## Rendered, browser, and accessibility QA

Not accepted. The managed browser refused both localhost and the preview page because its admin-enforced policy could not be verified. No bypass was used.

Still required:

- Agreement, portal, and admin screenshots at desktop/mobile states.
- Chromium/Safari/iPhone/tablet rendered inspection.
- Browser console, network, and CSP inspection.
- Manual keyboard-only completion, focus order, skip links, validation-summary focus, checkbox/payment-card touch targets, long legal text, reduced motion, and contrast review.

## Public-site regression check

Read-only HTTP checks returned `200` for the production homepage, services, our work, and about routes. The repository diff contains no Phase C change to protected public pages, global CSS/JS, booking, sitemap, or robots. A full rendered public-site comparison remains part of the browser blocker above.

## Outstanding legal decisions

- Final service agreement.
- Installment, stored-payment-method, future-charge, and failed-payment authorization.
- Refund/cancellation language.
- Signer authority and electronic acceptance language.
- Privacy/data handling.
- Retention, deletion, offboarding, and historical client document access.

All generated agreement records are visibly marked `PHASE C LEGAL DOCUMENT PLACEHOLDER — NOT APPROVED FOR CLIENT USE`.

## Outstanding configuration and known risks

1. Enable Cloudflare Access and choose the team domain.
2. Create separate admin and client Access applications/policies; set `ACCESS_TEAM_DOMAIN`, `ADMIN_ACCESS_AUD`, and `CLIENT_ACCESS_AUD`.
3. Deliberately authorize preview admin/client test emails in D1; current identities are `example.test` fixtures.
4. Configure Stripe Sandbox secrets/resources and confirm the API version in Workbench.
5. Configure a restricted Customer Portal (payment-method update + invoice/receipt access; no plan change/cancel).
6. Add the test webhook endpoint and replay/failure tests.
7. Add Resend test credentials and a single approved test recipient before sending preview messages.
8. Resolve managed-browser policy access and complete rendered QA/screenshots.
9. The preview project currently mirrors the full static E4LA site to preserve shared assets; it is isolated and noindexed but not Access-protected until Access onboarding.
10. `wrangler.preview.jsonc` is intentionally not the production project configuration. Deployment used a temporary isolated copy so the production Git/Pages project cannot pick up the preview D1 binding.

## Recommended rollout sequence

1. Review this checkpoint and enable Cloudflare Access.
2. Authorize test identities and complete role/security tests.
3. Configure Stripe Sandbox and complete full-payment/installment/webhook failure tests.
4. Configure Resend preview-only delivery and idempotency tests.
5. Complete rendered/mobile/keyboard/Safari/Chromium QA and attach screenshots.
6. Obtain legal and data-policy approval.
7. Run a production-readiness review of diffs, secrets, Access policies, Stripe objects, logging, retention, and rollback.
8. Create production D1/configuration only after explicit E4LA approval.
9. Perform a controlled fictional/synthetic production smoke test before any real invitation.
