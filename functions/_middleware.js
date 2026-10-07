// Fail-closed 404 for repository-internal files that live in the Pages deploy root
// (docs, tests, migrations, fixtures, tooling, config, dotfiles). Runs for every request
// except /assets/* (see /_routes.json), and normalizes the path first so percent-encoded,
// mixed-case, double-slash and backslash variants cannot slip past the match.
const INTERNAL_DIRS = ['/tests/', '/scripts/', '/migrations/', '/fixtures/', '/functions/', '/config/', '/_cta_debug_frames/', '/node_modules/'];
const INTERNAL_FILE = /\.(?:md|json|jsonc|sql|mjs|toml|example|py|pb|map|env|yml|yaml)$/;

function normalize(pathname) {
  let p = pathname;
  for (let i = 0; i < 3; i += 1) {
    try { const d = decodeURIComponent(p); if (d === p) break; p = d; } catch { return null; }
  }
  const flat = ('/' + p.replace(/\\/g, '/').toLowerCase()).replace(/\/+/g, '/').replace(/(^|\/)\.(?=\/|$)/g, '$1');
  return flat.length > 1 ? flat.replace(/\/+$/, '') : flat;
}

export function isInternalPath(pathname) {
  const p = normalize(pathname);
  if (p === null || p.includes('/../')) return true;
  if (p.split('/').some((seg) => seg.startsWith('.') && seg !== '.well-known' && seg !== '')) return true;
  const root = p.split('/')[1] || '';
  if (!p.slice(1).includes('/') && INTERNAL_FILE.test(p) && !['robots.txt'].includes(root)) return true;
  if (INTERNAL_DIRS.some((dir) => (p + '/').startsWith(dir))) return true;
  if (/^\/(?:_routes|_headers|_redirects|_worker)(?:\.|$)/.test(p)) return true;
  return INTERNAL_FILE.test(p) && !p.startsWith('/api/');
}

export async function onRequest({ request, next }) {
  if (isInternalPath(new URL(request.url).pathname)) {
    return new Response('Not found', {
      status: 404,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' },
    });
  }
  return next();
}
