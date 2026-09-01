# PR #8 Parallel QA, Security, and Integration Verification

Scope: core implementation commit `a16ae42dc868e4cb3bf8d3c611090ae5f8e90db6`, plus the D1 verification-helper extension that landed on PR #8 while this audit was running. The QA branch is based on the resulting latest PR head. This pass did not merge main, touch production, use Stripe live mode, publish content, or send invoices.

## TESTS ADDED

- 13 adversarial checks were added to the Phase G/H suites.
- 3 new checks pass: quote-version/line-item database immutability, redirect/query parameters cannot mark a new invoice paid, and draft content cannot schedule directly.
- 10 executable TODO regressions reproduce confirmed PR #8 defects without making the baseline suite exit non-zero:
  - sent quote current-version replacement;
  - payment-option total detached from quote total;
  - recurring-consent replay;
  - client commerce response leakage;
  - unverified YELLOW approval;
  - URL-only/unverified source verification;
  - RED auto-policy approval;
  - retroactive brand-brain policy bypass;
  - draft/internal plan visibility;
  - proofless `verified_live`.
- Result: 154 total; 144 passed, 0 failed, 10 known-defect TODOs.

## SECURITY FINDINGS

### P1

1. **Sent quote immutability bypass.** `createQuoteVersion` accepts `sent` and `viewed`, then replaces `quotes.current_version_id` without resetting `status`/`sent_at` or requiring a new send. A client can be shown version 1 and later read/approve an unsent version 2. See `functions/api/commerce/[[path]].js:339-374`.
2. **Payment amount authority bypass.** `createPaymentOptions` reconciles installments only to request-body `total_amount`; it never compares that value with the current immutable quote version. A $6,247 quote accepted a $0.01 pay-in-full option. See `functions/api/commerce/[[path]].js:459-513`.
3. **Recurring consent forgery/replay.** The client posts service, amount, frequency, dates, renewal behavior, and version labels directly. No persisted admin offer, terms hash, idempotency key, uniqueness constraint, active/recurring-service check, or replay defense binds the consent. Identical submissions create multiple active rows. See `functions/api/commerce/[[path]].js:644-735` and migration `0007`.
4. **Content evidence gate bypass.** Approval blocks only unresolved RED claims. Unverified or insufficient-evidence YELLOW claims approve, while a RED manually marked verified can auto-approve. See `functions/api/content/[[path]].js:106-113,382-384`.
5. **URL-only/cross-tenant claim verification.** Claim verification checks only whether a `source_id` exists; it does not require a verified source, substantive evidence, or matching client. See `functions/api/content/[[path]].js:411-497`.
6. **Approval policy is mutable retroactively.** Item approval reads the latest brand brain instead of the plan's `brand_brain_id`. Creating a new `manual` version bypasses client review for older items. See `functions/api/content/[[path]].js:374-379`.
7. **Forgeable auto-publish authorization.** Two booleans in an admin request stand in for durable client consent; no acceptance/terms evidence is queried. See `functions/_shared/content.js:43-50`.
8. **Fake live verification.** Any `published` job can become `verified_live` through a status PATCH with no provider lookup or evidence. Manual export is incorrectly stored as published and can self-verify. See `functions/api/content/[[path]].js:620-665`.
9. **Project assignment isolation failure.** Collaborator checks authorize every content record for a client after access to any one client project, rather than the item's exact project. See `functions/api/content/[[path]].js:73-100`. Commerce client-level list endpoints use the same any-project pattern at `functions/api/commerce/[[path]].js:89-100`.
10. **Client API data leakage.** Client quote/invoice/consent reads return `SELECT *`, exposing internal notes, creator IDs, Stripe object IDs, consent actor IDs, and session/request evidence. See `functions/api/commerce/[[path]].js:415-431,609-631,738-746`.

### P2

- Client plan endpoints expose draft/internal plans (`functions/api/content/[[path]].js:220-243`).
- Admin/collaborator can assert `client_approved` plan status without a client actor or append-only approval evidence (`functions/api/content/[[path]].js:246-274`).
- Status and publish flows use read-then-unconditional-write sequences, enabling stale-state races and duplicate publishing jobs (`functions/api/content/[[path]].js:345-402,587-638`).
- Claims can change after approval and publishing does not re-run the evidence gate.
- Metrics insertion is not atomic/idempotent and accepts jobs that are not verified live (`functions/api/content/[[path]].js:668-698`).
- `brand_brains` relies on API convention rather than UPDATE/DELETE immutability triggers.
- CSRF/origin enforcement and role allowlists are consistently present on the reviewed mutation handlers. No hardcoded Adobe/platform/Stripe secret was found.

## DEFECTS FOUND

In addition to the security findings:

- Admin quote/invoice payloads use camelCase while the APIs require snake_case. Quote project scoping is dropped, quote service/price/discount/tax values do not reach the server, and invoice creation lacks required `client_id`/`unit_price`. See `assets/js/admin.js:218-249` versus `functions/api/commerce/[[path]].js:310-374,539-582`.
- Admin approval UI posts to nonexistent `POST /api/content/items/:id/approvals`. See `assets/js/admin.js:272-278` and router table `functions/api/content/[[path]].js:29-49`.
- Admin content queue, calendar, detail/history, and analytics containers are never populated. `render()` does not call content renderers (`assets/js/admin.js:37-44`); the empty shells are in `admin/index.html:269-336`.
- Client portal Content markup exists, but the portal normalizer/render path drops all content and exposes no approval/comment actions (`assets/js/client-portal.js:39-79,284-301`; `client-portal/index.html:82`).
- There is no flexible-payment/installment editor in Admin despite the API schema.
- Real platform adapters are not implemented; the external branch is hard-coded to persist `failed` even if a future adapter returns success.

## DEFECTS FIXED

No core implementation defect was changed to avoid conflicting with Claude's active PR work. Narrow QA-only changes added passing controls and executable TODO regressions. Claude's concurrent `scripts/gate-prep/d1-migrate.mjs` extension was used for live verification and is inherited from the PR head; it was not authored by this pass.

## PREVIEW D1

- Target guard confirmed only `e4la-client-operations-preview` (`2d6a0170-f8b9-496d-acd4-50adf3cf9e58`) with `PREVIEW_ONLY=1`.
- Wrangler 4.128.0 reported no pending migrations.
- Live schema/journal reconciliation:
  - 0001: FULLY_APPLIED, 27/27 objects, recorded.
  - 0002: FULLY_APPLIED, 5/5 objects, recorded.
  - 0003: FULLY_APPLIED, 2/2 objects, recorded.
  - 0004: FULLY_APPLIED, 5/5 objects, recorded.
  - 0005: FULLY_APPLIED, 9/9 objects, recorded.
  - 0006: FULLY_APPLIED, 6/6 objects, recorded.
  - 0007: FULLY_APPLIED, 3/3 objects, recorded.
  - 0008: FULLY_APPLIED, 10/10 objects, recorded.
  - 0009: FULLY_APPLIED, 3/3 objects, recorded.
- Full verification reported all expected tables, immutability/append-only triggers, and legacy publication fields present. Smoke SELECTs succeeded across all 24 checked commerce/content/progress tables.
- The apply step was a no-op (`No migrations to apply`). Production was not addressed.

## CONTENT AUTOMATION REALITY

| Capability | Classification | Evidence |
|---|---|---|
| Research | FIXTURE/DEMO ONLY | Manual source capture and seeded claims; no retrieval/research process. |
| Opportunity scoring | NOT IMPLEMENTED | No scoring schema or runtime. |
| Claim extraction | FIXTURE/DEMO ONLY | Manual claim POST/fixtures; no extractor. |
| Claim verification | REAL IMPLEMENTATION | Manual authenticated state change exists, but evidence and tenant checks are defective. |
| Draft generation | NOT IMPLEMENTED | Caller supplies `master_copy`. |
| Platform adaptation | FIXTURE/DEMO ONLY | Caller supplies captions/hashtags. |
| Adobe rendering | ADAPTER ONLY | Placeholder request adapter; contract/auth/completion are not verified. |
| Publishing | ADAPTER ONLY | Manual export package works; real platforms are unavailable/unimplemented. |
| Live publication verification | NOT IMPLEMENTED | Current endpoint is only a status flip. |
| Analytics ingestion | REAL IMPLEMENTATION | Manual authenticated metric POST only; not provider ingestion and not idempotent/atomic. |
| Learning loop | NOT IMPLEMENTED | No feedback/training/optimization loop. |

No capability is classified solely as EXTERNAL AUTH BLOCKED: the real adapter contracts and completion flows are unfinished even if credentials were supplied.

## RESPONSIVE QA

Interactive width verification at 375, 430, 768, 1024, and 1440 was attempted against both localhost and the configured HTTPS preview. The mandated browser surface refused both targets because its admin-enforced browser security policy could not be verified. No bypass or alternate browser automation was used.

Source-level review only:

- Navigation changes from sidebar to horizontal scrolling at 980px; nav targets are at least 44px high (`assets/css/operations-dashboard.css:44-50,98-106`).
- Two/four-column grids collapse at 720/980px; Admin padding compresses at 720px (`assets/css/operations.css:352-370`; `assets/css/operations-dashboard.css:98-127`).
- Inputs/buttons are 52px high and global `:focus-visible` is present (`assets/css/operations.css:218-280,351`).
- Tables use an overflow wrapper and a 760px mobile minimum (`assets/css/operations-dashboard.css:51,126`).
- Body-level `overflow-x:hidden` can conceal unintended overflow, so screenshots/layout measurements are still required (`assets/css/operations.css:39-42`).
- Quote and invoice forms exist, but the flexible installment editor is absent. Content queue/calendar/portal-content shells are unpopulated, so those experiences cannot pass functional responsive QA at any width.

## FILES CHANGED

- `tests/phase-g-commerce.test.mjs`
- `tests/phase-h-content.test.mjs`
- `PR8-PARALLEL-VERIFICATION.md`

Not owned by this pass: `scripts/gate-prep/d1-migrate.mjs` (Claude's concurrent PR-head commit, inherited as branch base rather than included in the QA commit).

## BRANCH

`codex/pr8-parallel-verification`

## COMMIT

See the commit identified in the final handoff; this file cannot safely contain its own commit hash.

## RECOMMENDATIONS FOR CLAUDE

1. Block new quote versions after send/view; require an explicit revise-and-resend state, and record the exact approved version/actor/evidence.
2. Derive payment-option total from `quotes.current_version_id` server-side; never accept it as authority from the body.
3. Persist a single-use recurring offer/terms hash and make approval idempotent; validate active `recurring_service`, supersede prior consent on changed terms, and define fixed-term end/iteration data before Stripe work.
4. Replace `SELECT *` on every client commerce response with explicit safe projections and visibility filters.
5. Gate approval and publishing on policy-aware RED/YELLOW evidence; require verified, substantive, same-client sources and re-check immediately before publish.
6. Resolve approval rules from the plan's snapshotted brand brain; disable auto-publish until durable client authorization evidence exists.
7. Use exact-project collaborator checks, same-client cross-reference validation, conditional atomic status updates, and publish idempotency.
8. Separate `exported` from `published`; require provider evidence before `verified_live`.
9. Fix Admin snake_case payloads and the nonexistent approval route, then wire queue/calendar/content detail/analytics and Client Portal content before presenting these surfaces as implemented.
10. Re-run real responsive QA at all five widths after the browser policy is available, including long strings, very large currency values, keyboard focus order, 44px touch targets, and measured overflow.
