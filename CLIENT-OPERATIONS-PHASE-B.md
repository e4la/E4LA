# E4LA Client Operations System — Phase B

This is a local/test foundation for one connected client lifecycle: agreement, acceptance, payment, enrollment, portal activation, project visibility, deliverables, reporting, and ongoing client operations.

It does not authorize production use. Live Stripe keys/events are rejected in code, no production database has been created, admin/client authentication is not active, no emails are sent, and the legal document is an explicit placeholder.

## Route map

| Surface | Route | Phase B behavior |
| --- | --- | --- |
| Agreement shell | `/client-agreement/` | Safe local sample only; no client data in initial HTML |
| Secure agreement | `/client-agreement/{opaque-id}#invite={one-time-token}` | Fragment exchanged for a secure server session |
| Client portal | `/client-portal/` | Safe local sample; production route requires an authorized client session |
| Admin | `/admin/` | Safe local sample; production route requires an E4LA admin/collaborator session |
| Operations API | `/api/ops/*` | Cloudflare Pages Function router |
| Stripe webhook | `/api/stripe/webhook` | Test-mode, signature-verified, idempotent webhook receiver |

None of these routes is added to public navigation or the XML sitemap.

## API map

| Method and endpoint | Authorization | Purpose |
| --- | --- | --- |
| `POST /api/ops/invites/exchange` | One-time token + strict Origin | Atomically consume invitation token and create agreement session |
| `GET /api/ops/session` | Existing session cookie | Rotate session and CSRF state |
| `POST /api/ops/session/logout` | Session + CSRF | Revoke current session |
| `GET /api/ops/agreements/current` | Agreement signer | Load current immutable agreement version and approved plans |
| `POST /api/ops/agreements/accept` | Agreement signer + CSRF | Validate and record immutable acceptance/enrollment |
| `POST /api/ops/checkout` | Signer/authorized billing role + CSRF | Create test-mode hosted Checkout Session |
| `GET /api/ops/enrollment/status` | Authorized session | Read webhook-authoritative enrollment state |
| `POST /api/ops/billing/portal` | Client owner/authorized signer + CSRF | Create authenticated Stripe Customer Portal session |
| `GET /api/ops/portal` | Authorized client role | Return published client-facing project data only |
| `GET /api/ops/admin/summary` | E4LA admin/collaborator | Return an operations summary within role scope |
| `POST /api/stripe/webhook` | Stripe signature | Reconcile Checkout, invoice, and fixed schedule state |

## Entity relationships

```text
client
├── client_users
├── projects
│   ├── project_milestones
│   ├── project_updates
│   └── deliverables
├── agreements
│   ├── agreement_versions (immutable)
│   │   └── payment_plans
│   ├── agreement_invites
│   └── agreement_acceptances (immutable)
├── enrollments
│   └── stripe_objects
└── portal_documents

admin_users ── administrative actors
└── admin_project_access ── collaborator project scope
access_sessions ── signer/client/admin authentication state
audit_events ── append-only lifecycle evidence
processed_webhook_events ── Stripe webhook idempotency
payment_installments ── authoritative planned/paid/failed installment ledger
```

The SQL source of truth is `migrations/0001_client_operations.sql`. Agreement versions, acceptances, and audit events have database triggers preventing mutation/deletion.

## State models

### Client lifecycle

```text
prospect → qualified → agreement_prepared → agreement_sent → agreement_viewed
→ agreement_accepted → payment_initiated → payment_confirmed → active
→ project_active → work_in_progress → reporting → completed
→ ongoing | retainer | archived
```

State is persisted on the server and written to the audit trail. It is never inferred only from which screen the client viewed.

### Agreement

```text
draft → prepared → sent → viewed → accepted → payment_pending → enrolled → completed
                  ↘ expired
draft/prepared/sent → superseded | void
```

An already-sent material revision creates a new `agreement_versions` row and supersedes the prior agreement/version. An accepted version is never reconstructed from a current template.

### Payment/enrollment

```text
accepted → checkout_pending → payment_processing
  ├─ full payment → paid → activated
  └─ installment 1 confirmed → schedule_pending → schedule_active → paid

recoverable branches:
checkout_pending → accepted (expired/canceled Checkout)
payment_processing/schedule_active → payment_failed | payment_action_required
schedule_pending → attention_required (fail-closed schedule creation)
```

The browser return from Checkout is informational. Only a verified Stripe webhook advances payment to a confirmed state.

### Portal publication

```text
internal → reviewed → approved → published → withdrawn
```

Milestones, updates, deliverables, and portal documents use this explicit state. The client API returns only `published` records. Nothing in Notion or internal E4LA operations is automatically exposed.

## Agreement invitation and session model

1. Admin will generate a cryptographically random opaque agreement ID and invitation token server-side.
2. Only the SHA-256 token hash is stored.
3. The invitation uses `/client-agreement/{opaque-id}#invite={token}`.
4. The fragment is captured in memory and immediately removed with `history.replaceState()`.
5. The token is exchanged through a JSON POST with an exact Origin check.
6. A conditional D1 `UPDATE ... RETURNING` consumes the unexpired, unrevoked token once.
7. An `HttpOnly`, `Secure`, `SameSite=Lax`, `__Host-` cookie carries the session token.
8. The server stores only the session-token hash and CSRF-token hash.
9. `GET /api/ops/session` rotates both session and CSRF state and revokes the prior session.
10. Mutating protected requests require the session, a matching CSRF header, JSON content type, correct role, and correct client/agreement scope.

No private agreement, signer, or client data is written to `localStorage`, `sessionStorage`, URL query parameters, frontend source, or analytics.

## Authorization model

| Role | Intended access |
| --- | --- |
| `agreement_signer` | One agreement/version, acceptance, and its enrollment checkout/status |
| `client_owner` | Portal, agreements, billing, and authorized client access management |
| `authorized_signer` | Portal, agreements, and billing within the assigned client |
| `client_viewer` | Published portal content only; no contractual/billing authority |
| `e4la_collaborator` | Future project-level admin access; Phase B defaults to no broad client listing |
| `e4la_admin` | Full E4LA operations access |

Admin Preview is a labeled read-only client presentation. Production Preview must be issued by an authenticated admin endpoint with an audit event; the Phase B sample is localhost-only and cannot grant client authority.

## Immutable acceptance

Acceptance copies the exact stored agreement snapshot and retains:

- Agreement, version, client, project, and payment-plan identifiers.
- Legal document hash and rendered agreement snapshot.
- Total value, installment amounts, and server-computed due dates.
- Accepted clause identifiers.
- Signer legal name, role, company, typed acceptance, and authority confirmation.
- Server UTC timestamp, request ID, and user agent.

No IP address is collected. Legal enforceability and retention duration remain subject to E4LA policy and California attorney review.

## Stripe object lifecycle

### Pay in full

```text
Stripe Customer → hosted Checkout Session (payment mode)
→ PaymentIntent → webhook-confirmed payment → invoice/receipt → enrollment paid
```

### Fixed installment schedule

```text
Stripe Customer → hosted Checkout Session (payment mode, installment 1)
→ save Stripe-managed payment method for off-session use
→ verified checkout.session.completed webhook
→ future-dated Subscription Schedule for installments 2..N
→ automatic invoice payments → schedule completed → enrollment paid
```

The future schedule starts on the contractual due date for installment 2. The schedule uses the remaining recurring Price, a fixed iteration count, and `end_behavior=cancel`. Creation fails closed to `attention_required`; no indefinite subscription is created.

The dedicated Customer Portal configuration must allow invoice/receipt access and payment-method updates while disabling plan changes and cancellation. Portal sessions are created only for authenticated client owners/authorized signers.

## Security controls

- Live Stripe secret keys and live webhook events are rejected during Phase B.
- Raw Stripe webhook body signature verification with timestamp tolerance.
- Unique processed event IDs and safe retries.
- D1 parameter binding and server-authoritative pricing/plan lookup.
- Strict Origin checks and JSON content-type validation.
- CSRF token bound to rotating server sessions.
- Hashed invitation/session/CSRF/rate-limit keys.
- Role and client/agreement scope checks on every protected endpoint.
- `Cache-Control: no-store` on Function responses and private static shells.
- Route-specific CSP, `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, restrictive Permissions Policy, and noindex headers.
- No card inputs or card storage in E4LA code.
- No IP collection.
- No secrets committed; `.dev.vars*` is ignored.

Rate limiting is keyed to a hash of the invitation or authenticated session—not an IP address. A production Cloudflare WAF/Turnstile policy can provide additional abuse controls after privacy and access decisions.

## Data visibility and storage

| Information | Storage | Visibility |
| --- | --- | --- |
| Client profile/contact | D1 | Assigned E4LA roles; authorized client users as needed |
| Internal project work | Notion/internal systems | E4LA only |
| Published milestones/updates | D1 publication records | Authorized client users + E4LA |
| Agreement versions/acceptance | D1 immutable records | Signer/authorized client roles + E4LA |
| Payment credentials | Stripe only | Stripe-hosted surfaces |
| Stripe object IDs/status | D1 | Authorized billing/admin roles |
| Deliverable files | Future R2/approved storage; D1 metadata | Published client scope + E4LA |
| Audit events | D1 append-only | Authorized E4LA admin/audit access |

No arbitrary retention duration is encoded. Rows have timestamps and archive/status fields so an approved retention/offboarding policy can later be implemented without changing the relational boundaries.

## Provider-neutral analytics

The frontend dispatches `e4la:analytics` custom events through an allowlist:

- `agreement_viewed`
- `agreement_validation_error`
- `agreement_accepted`
- `payment_plan_selected`
- `checkout_started`
- `checkout_returned`
- `enrollment_confirmed`
- `portal_activated`
- `portal_viewed`
- `deliverable_viewed`

Only generic state, plan code, surface, result, and counts are accepted. Names, emails, addresses, signatures, agreement text, project information, and payment data are discarded.

## Local preview

A static server is sufficient for visual/interface preview:

```text
python3 -m http.server 4173
```

Open:

- `/client-agreement/`
- `/client-agreement/?state=invalid|expired|accepted|pending|failed|confirmed`
- `/client-portal/`
- `/client-portal/?state=empty|no-deliverables|completed`
- `/admin/`
- `/admin/?state=zero|single|multiple`
- `/client-portal/?preview=admin` for the labeled local Admin Preview

The local D1 fixture is intentionally fictional: `fixtures/client-operations.local.sql`.

Run the migration/fixture through Wrangler after a local D1 binding exists. Do not apply the fixture to a production database.

## Remaining Cloudflare configuration

1. Create separate preview and production D1 databases.
2. Bind the preview database as `ENROLLMENT_DB` to Pages Functions.
3. Apply the migration to preview only and test rollback/recovery.
4. Configure `PUBLIC_SITE_URL`, `STRIPE_API_VERSION`, `STRIPE_PORTAL_CONFIGURATION_ID`, and `ENVIRONMENT` as environment variables.
5. Configure `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` as encrypted secrets.
6. Configure route-specific Cloudflare access/WAF/rate controls after the authentication decision.
7. Verify Function-generated security headers because `_headers` does not apply to Function responses.

## Remaining Stripe configuration

1. Use a Stripe Sandbox/test account only.
2. Confirm API version `2026-02-25.clover` in Workbench before enabling the endpoint.
3. Create one-time Prices for initial/full payments and recurring Prices for remaining monthly/biweekly installments.
4. Store Price IDs in server-side payment-plan configuration.
5. Create the restricted Customer Portal configuration.
6. Create a test webhook endpoint for `/api/stripe/webhook` and subscribe to:
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
7. Test every plan with Stripe test clocks, including month-end dates, retries, required customer action, and schedule completion.
8. Explicitly review Stripe Billing recovery settings; do not let failed-payment automation silently cancel the contractual schedule.

## Remaining Resend configuration

No email is sent in Phase B. Before activation:

1. Approve exact invitation, acceptance, payment, failure, and onboarding templates.
2. Reuse the existing verified Resend sender/domain where appropriate.
3. Add invitation and lifecycle email jobs only after idempotency and retry behavior are defined.
4. Never include invitation fragments, agreement text, signatures, or confidential portal content in analytics/logging.

## Production gates

- Attorney-approved agreement text, consent flow, acceptance evidence, and retention policy.
- Server-backed client and E4LA admin authentication decision and implementation.
- Cloudflare preview D1 binding and recovery test.
- Stripe Sandbox Products/Prices, restricted Portal configuration, webhook secret, test clocks, and full test matrix.
- Approved invitation/onboarding email templates.
- Browser/device QA and accessibility review.
- Explicit review and approval before any production deployment or live billing configuration.
