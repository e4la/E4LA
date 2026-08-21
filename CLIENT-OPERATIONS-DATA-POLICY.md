# E4LA Client Operations — Draft Operational Data Policy

Status: Phase C draft for E4LA and counsel review. This document defines operational boundaries; it does not set final legal retention periods or make compliance claims.

## Storage

| Information class | System of record | Notes |
| --- | --- | --- |
| Client identity, contact profile, project identity, lifecycle status | Cloudflare D1 | Minimized operational fields only. No card credentials or IP-address evidence. |
| Agreement versions and acceptance evidence | Cloudflare D1 | Immutable snapshots; never reconstructed from a later template. |
| Portal publication metadata | Cloudflare D1 | Only explicitly published records are client-visible. |
| Detailed internal tasks, research, and discussion | Notion/internal E4LA systems | Never automatically synchronized to the client portal. |
| Card/payment credentials | Stripe | E4LA stores operational Stripe IDs and reconciled payment state only. |
| Deliverable files | Future approved R2/document storage | D1 stores publication metadata and authorized references. |
| Authentication sessions and identity links | Cloudflare Access + D1 | Access proves email identity; D1 maps that identity to an E4LA role and revocable session. |
| Operational email delivery state | Resend + D1 event record | Message content must exclude unnecessary private data; event records provide idempotency. |

## Access

- E4LA Admin: full operational access, including contractual and billing status.
- E4LA Collaborator: assigned-project scope only; no implicit access to unrelated clients.
- Client Owner / Authorized Signer: own client, agreement, portal, and permitted billing context.
- Client Viewer: published portal information only; no agreement acceptance or billing authority.
- Stripe: payment credentials and payment processing data.
- Notion/internal staff: internal work according to E4LA operating permissions; internal content is not client-visible by default.

Every protected request is authorized server-side. Browser storage is not an authorization source.

## Immutable records

The following are append-only or immutable at the database level:

- Agreement versions after creation.
- Agreement acceptances and copied legal/commercial evidence.
- Audit events.
- External identity subject-to-user ownership after linkage.
- The database environment marker.

Corrections to contractual records require a new version or a separate corrective event; they must not overwrite historical evidence.

## Client-visible versus internal-only

Client APIs may return only portal records with `publication_status = published`, accepted client-owned agreements, and authorized billing summaries. `internal`, `reviewed`, `approved`, and `withdrawn` records remain unavailable to client APIs. Admin Preview renders this same client-visible dataset without creating or impersonating a client session.

Internal-only information includes research notes, sensitive E4LA discussion, unpublished work, credentials, raw logs, audit administration, provider secrets, and internal project permissions.

## Retention

No fixed duration is encoded before E4LA approves a legal and operational retention schedule. Records contain lifecycle, archive, revocation, and timestamp fields so an approved schedule can later be enforced.

Agreement versions, acceptances, payment reconciliation evidence, and audit events must not be deleted merely because portal access ends. Their retention duration and lawful deletion conditions require counsel approval.

## Offboarding

When an engagement ends:

1. Mark the project completed, retained, or archived.
2. Revoke active sessions and unnecessary user access.
3. Withdraw unpublished or no-longer-client-visible portal items where appropriate.
4. Preserve accepted agreements, required payment records, and audit evidence.
5. Decide whether historical client document access remains available under the approved engagement/offboarding policy.
6. Remove or archive nonessential working data only under the approved retention schedule.

## Deletion

Potentially deletable after policy approval: duplicate contact data, expired/revoked session records, obsolete unpublished portal drafts, and nonessential operational logs.

Not deletable through ordinary admin actions: accepted agreement evidence, immutable agreement versions, append-only audit events, and reconciled commercial/payment evidence. Exceptional deletion requires documented legal authority and a controlled procedure.

## Logging and analytics

Operational logs may contain request ID, event type, environment, opaque entity IDs, status, timestamp, and non-sensitive error code. They must not contain invite tokens, cookies, CSRF values, signatures, agreement text, full request bodies, addresses, card data, or payment credentials.

Product analytics must remain provider-neutral and exclude names, emails, signatures, addresses, agreement content, payment data, and confidential project information.
