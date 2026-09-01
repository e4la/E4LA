# External-gate preparation tooling

Everything under `scripts/gate-prep/` exists so that clearing the remaining
external gates - Cloudflare Access, preview D1 migrations, Stripe Sandbox,
Resend Preview - requires **only a credential**, never new engineering. As
of this writing, none of it has been run in a mode that creates, modifies,
or deletes anything on a real Cloudflare Access, Stripe, or Resend account.
`d1-migrate.mjs` has been run read-only against the real preview D1 (to
confirm migration status); nothing has been applied.

Every script fails closed with a specific, human-readable message when a
required credential is missing - that is the expected, correct behavior
right now, not a bug to work around.

## Shared behavior across every script

- `DRY_RUN=1` - every mutating call is skipped and replaced with a
  `[DRY RUN] would create/update: ...` log line describing exactly what
  would happen; read-only calls still run, so DRY_RUN gives an accurate
  preview of current state either way.
- `PREVIEW_ONLY` - defaults to on. Setting `PREVIEW_ONLY=0` is not by itself
  enough to touch anything production-shaped; scripts that could plausibly
  reach a production resource also require `PRODUCTION_ACTION_CONFIRMED=I-UNDERSTAND`
  set for that single invocation.
- No script ever prints a secret. Anything that touches a credential goes
  through `lib/guardrails.mjs`'s `redact`/`safeLog`.
- Run everything from the repo root with `node scripts/gate-prep/<file>.mjs`
  (this project is `"type": "module"`, no build step, no new npm packages).

## Gate 1 - Cloudflare Access

**Prerequisite:** a Cloudflare API Token (not the Wrangler OAuth session
already used elsewhere in this project - confirmed structurally incapable of
managing Access resources) scoped to `Account / Access: Apps and Policies /
Edit` and `Account / Access: Organizations, Identity Providers, and Groups /
Edit`. Also decide the real admin/collaborator/client-owner/client-viewer
test email addresses ahead of time.

```bash
CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... \
ACCESS_ADMIN_EMAILS=admin@example.test \
ACCESS_COLLABORATOR_EMAILS=collaborator@example.test \
ACCESS_CLIENT_OWNER_EMAILS=owner@example.test \
ACCESS_CLIENT_VIEWER_EMAILS=viewer@example.test \
node scripts/gate-prep/cloudflare-access-setup.mjs
```

Any of the four `ACCESS_*_EMAILS` variables may be omitted - that specific
policy is skipped with a named warning rather than failing the whole run,
so partial rollout (e.g. admin access first) is safe.

**Expected output:** identity-provider reuse-or-create, per-application
create-or-diff-update, per-policy create-or-update, resolved AUD values
printed, `wrangler.preview.jsonc`'s `vars` block updated with
`ACCESS_TEAM_DOMAIN`/`ADMIN_ACCESS_AUD`/`CLIENT_ACCESS_AUD`, then a
re-validation pass confirming the live state matches
`config/access-config.mjs`. Exit 0 only if every step succeeded.

**Rollback:** the script never deletes an application or policy it didn't
create in the same run (updates are diff-based, not destructive replace).
To undo, remove the app/policy manually in the Zero Trust dashboard and
revert the `wrangler.preview.jsonc` change with `git checkout -- wrangler.preview.jsonc`.

**Evidence this gate passed:** `cloudflare-access-setup.mjs` exits 0, then
```bash
node scripts/gate-prep/access-smoke-test.mjs
```
reports unauthenticated requests to `/admin/*` and `/client-portal/*` as
blocked by Access (not the app's own 401 JSON - Access's own redirect/403).

## Gate 2 - Preview D1 migrations

**Prerequisite:** none beyond what already exists - the Wrangler OAuth
session already used throughout this project already has D1 write access.

```bash
node scripts/gate-prep/d1-migrate.mjs            # apply + verify
DRY_RUN=1 node scripts/gate-prep/d1-migrate.mjs   # list pending only
```

**Expected output:** confirms the target database is
`e4la-client-operations-preview` (`2d6a0170-f8b9-496d-acd4-50adf3cf9e58`) -
refuses to proceed against any other name/id -, runs
`wrangler d1 migrations apply` (idempotent - already-applied migrations are
skipped by wrangler itself), then verifies live: `project_phases` /
`project_progress_snapshots` / `project_performance_metrics` all exist,
every expected immutable trigger exists, every publication-boundary table
has a `publication_status` column, and a smoke `SELECT COUNT(*)` succeeds
against each new table.

**Rollback:** migrations 0001-0004 are additive only (no `DROP`/destructive
`ALTER` anywhere in any of them) - there is nothing to roll back in the
schema-damage sense. If a migration must be reverted, write a new additive
migration that undoes it; never edit an already-applied migration file.

**Evidence this gate passed:** the script's own EVIDENCE block reports
`tables: all present`, `triggers: all present`, `publicationFields: all
present`.

## Gate 3 - Stripe Sandbox

**Prerequisite:** a Stripe **test-mode** secret key (`sk_test_...`) - a live
key is refused before any network call, checked first, before even `DRY_RUN`
is read.

```bash
STRIPE_SECRET_KEY=sk_test_... node scripts/gate-prep/stripe-sandbox-provision.mjs
STRIPE_SECRET_KEY=sk_test_... node scripts/gate-prep/stripe-validation-suite.mjs
```

**Expected output (provisioning):** creates or reuses (matched by
`metadata.e4la_plan_code`, not fragile name-matching) the three Product +
Price pairs from `config/stripe-plans-config.mjs`, creates or reuses a
Customer Portal configuration (payment-method-update + invoice-history only,
cancellation and plan-changes disabled), prints the resulting Price IDs
formatted as the `payment_plans.stripe_initial_price_id` /
`stripe_remaining_price_id` values the app actually reads (confirmed against
`functions/_shared/stripe.js` - these are D1 columns, not env vars), and
prints the exact webhook event list (`REQUIRED_WEBHOOK_EVENTS`, kept in sync
with what `functions/api/stripe/webhook.js` actually handles) a webhook
endpoint needs enabled once one is created pointing at
`https://{preview hostname}/api/stripe/webhook`.

**Expected output (validation suite):** a RAN/SKIPPED ledger. Pay-in-full,
3-monthly/6-biweekly schedule creation, card-decline, 3DS-required, and
invalid-schedule-rejection scenarios run for real against Stripe's test-mode
API (using Stripe's documented test payment methods -
`pm_card_visa`/`pm_card_chargeDeclined`/`pm_card_authenticationRequired` -
no browser or real card needed) and clean up what they create. Webhook-order
and Billing-Portal-role scenarios are logged SKIPPED with the reason
"requires a live deployed preview" - they need Gate 1 to have passed first.

**Rollback:** provisioning is additive (creates Products/Prices, never
deletes). To remove test data, archive the Products in the Stripe Dashboard
test-mode view (Stripe doesn't hard-delete Prices once used).

**Evidence this gate passed:** provisioning exits 0 and prints real
`price_...`/`bpc_...` IDs; the validation suite's RAN scenarios all show
PASS.

## Gate 4 - Resend Preview

**Prerequisite:** a Resend API key and an explicit, real allowlist of
fictional/controlled test recipient addresses.

```bash
ENVIRONMENT=preview \
RESEND_PREVIEW_API_KEY=... \
RESEND_PREVIEW_SENDER="E4LA Preview <preview@...>" \
RESEND_PREVIEW_ALLOWLIST=owner-test@example.test,viewer-test@example.test \
node scripts/gate-prep/resend-preview-dispatch.mjs
```

By default this **still does not send anything** - every dispatch is marked
`suppressed` and logged, not sent, unless `SEND_FOR_REAL=1` is also set.
That is the one flag standing between "safe to run any time" and "sends a
real email" - never set it without deliberately meaning to.

**Expected output:** all six templates dispatch in suppressed mode, a
duplicate dispatch of the same idempotency key is detected and skipped (not
re-sent), and a final regression check confirms zero rows reached
`status='sent'` without `SEND_FOR_REAL=1`.

**Rollback:** n/a in suppressed mode (nothing was sent). If run with
`SEND_FOR_REAL=1` by mistake to a real inbox, there is no unsend - this is
exactly why the allowlist guard and the suppressed default both exist.

**Evidence this gate passed:** the script's REGRESSION CHECK line reads
`PASS - no row reached status='sent' without SEND_FOR_REAL=1`, and (once
`SEND_FOR_REAL=1` is deliberately used against real allowlisted addresses)
the recipient confirms receipt.

## Running everything in sequence

```bash
node scripts/gate-prep/orchestrator.mjs                  # from the start
node scripts/gate-prep/orchestrator.mjs --from=stripe-provision  # resume at a named gate
DRY_RUN=1 node scripts/gate-prep/orchestrator.mjs         # dry-run every gate
```

The orchestrator runs each gate script in order and **stops at the first one
that doesn't pass** - it never advances past a failure under any flag. It
records the last-passed gate in `scripts/gate-prep/.orchestrator-state.json`
(gitignored) and resumes there automatically on the next run, so a partial
credential rollout (e.g. Cloudflare Access today, Stripe next week) doesn't
require re-running gates that already passed.
