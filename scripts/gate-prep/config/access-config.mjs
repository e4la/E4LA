// Desired Cloudflare Access configuration for the E4LA Client Operations
// preview environment, as data. No account IDs, zone IDs, or AUD values are
// invented here - anything that can only come from Cloudflare is an explicit
// "<FROM_CLOUDFLARE:...>" placeholder, resolved at apply-time and never
// hand-authored.
//
// This file is imported by scripts/gate-prep/cloudflare-access-setup.mjs.
// Editing the shape of an application/policy here is the single source of
// truth for what that script creates or updates.

export const PREVIEW_HOSTNAME = 'e4la-client-operations-preview.pages.dev';

// A session this long balances "the client doesn't have to re-auth mid-task"
// against "a stolen preview link doesn't stay valid indefinitely." Matches
// the app's own ENROLLMENT_SESSION_SECRET-backed session TTL order of
// magnitude (hours, not days) rather than Access's own longer defaults.
export const SESSION_DURATION = '8h';

export const IDENTITY_PROVIDER = {
  // Reuse the account's configured identity provider. Prefer Cloudflare
  // account identity when present, then an existing One-Time PIN provider.
  // Only create OTP as a last-resort fallback when the organization has no
  // usable provider at all.
  preferredTypes: ['cloudflare', 'onetimepin'],
  fallbackType: 'onetimepin',
  fallbackName: 'E4LA Preview One-Time PIN',
};

export const APPLICATIONS = [
  {
    key: 'admin',
    name: 'E4LA Client Operations - Admin (Preview)',
    domain: PREVIEW_HOSTNAME,
    // Self-hosted app path coverage. Cloudflare Access apps match by
    // hostname + path prefix; both the UI routes and their backing API
    // routes need their own coverage since Access sits in front of both.
    paths: ['/admin/*', '/api/ops/auth/admin', '/api/ops/admin/*'],
    sessionDuration: SESSION_DURATION,
    // Placeholder - only Cloudflare can hand back a real AUD after the app
    // is created. The setup script writes the resolved value to
    // ADMIN_ACCESS_AUD; nothing here is a real credential.
    audEnvVar: 'ADMIN_ACCESS_AUD',
    policies: [
      {
        name: 'E4LA Admin - full access',
        decision: 'allow',
        // Populated at apply-time from ACCESS_ADMIN_EMAILS (comma-separated),
        // never hardcoded here - see cloudflare-access-setup.mjs.
        includeEmailsEnvVar: 'ACCESS_ADMIN_EMAILS',
      },
      {
        name: 'E4LA Collaborator - scoped access',
        decision: 'allow',
        includeEmailsEnvVar: 'ACCESS_COLLABORATOR_EMAILS',
        // Collaborator project-level scoping (which projects a collaborator
        // may touch) is enforced by the application itself via
        // admin_project_access, not by Access - Access only decides who may
        // reach /admin/* at all. Documented here so the two layers aren't
        // confused with each other.
        note: 'Access grants entry only; per-project scope is enforced in functions/api/ops/[[path]].js via admin_project_access.',
      },
    ],
    defaultDeny: true,
  },
  {
    key: 'client',
    name: 'E4LA Client Operations - Client Portal (Preview)',
    domain: PREVIEW_HOSTNAME,
    paths: ['/client-portal/*', '/client-agreement/*', '/api/ops/auth/client', '/api/ops/portal', '/api/ops/agreements/*', '/api/ops/checkout', '/api/ops/billing/*', '/api/ops/enrollment/*'],
    sessionDuration: SESSION_DURATION,
    audEnvVar: 'CLIENT_ACCESS_AUD',
    policies: [
      {
        name: 'E4LA Client Owner / Authorized Signer',
        decision: 'allow',
        includeEmailsEnvVar: 'ACCESS_CLIENT_OWNER_EMAILS',
        note: 'Fictional/controlled test identities only in preview - see CLIENT-OPERATIONS-DATA-POLICY.md.',
      },
      {
        name: 'E4LA Client Viewer',
        decision: 'allow',
        includeEmailsEnvVar: 'ACCESS_CLIENT_VIEWER_EMAILS',
        note: 'Role/billing restrictions (cannot sign, cannot manage billing) are enforced application-side, not by Access.',
      },
    ],
    defaultDeny: true,
  },
];

// Every required preview environment variable this setup produces or
// depends on, for the setup script's own preflight check and for
// scripts/gate-prep/d1-migrate.mjs / the orchestrator to assert against.
export const REQUIRED_PREVIEW_ENV_VARS = [
  'ACCESS_TEAM_DOMAIN',
  'ADMIN_ACCESS_AUD',
  'CLIENT_ACCESS_AUD',
];

// The one thing this file will never contain: an actual account ID, zone ID,
// application ID, or AUD value. Those are resolved live by
// cloudflare-access-setup.mjs from CLOUDFLARE_ACCOUNT_ID /
// CLOUDFLARE_API_TOKEN and the API's own responses, and are never
// hand-typed into source.
