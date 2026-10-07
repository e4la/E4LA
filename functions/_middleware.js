// Fail-closed 404 for repository-internal files that live in the Pages deploy root
// (docs, tests, migrations, fixtures, tooling, config). Only paths listed in
// /_routes.json invoke this middleware, so normal pages/assets never touch a Function.
// Everything else (including /api/*) passes straight through.
const INTERNAL_DIRS = ['/tests/', '/scripts/', '/migrations/', '/fixtures/', '/functions/', '/config/', '/_cta_debug_frames/', '/.claude/', '/.git/'];
const INTERNAL_FILE = /^\/(?:\.[^/]+|[^/]+\.(?:md|json|jsonc|sql|mjs|toml|example))$/i;

export async function onRequest({ request, next }) {
  const { pathname } = new URL(request.url);
  const blocked = INTERNAL_FILE.test(pathname) || INTERNAL_DIRS.some((dir) => (pathname + '/').startsWith(dir));
  if (!blocked) return next();
  return new Response('Not found', {
    status: 404,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' },
  });
}
