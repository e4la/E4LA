import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

// Every repo-internal root file must be routed through functions/_middleware.js (404),
// otherwise Cloudflare Pages serves it publicly.
test('internal root files are covered by _routes.json', async () => {
  const routes = JSON.parse(await readFile(new URL('../_routes.json', import.meta.url), 'utf8')).include;
  const entries = await readdir(new URL('..', import.meta.url), { withFileTypes: true });
  const internal = entries.filter((e) => e.isFile() && /\.(md|json|jsonc|sql|mjs|toml|example)$/i.test(e.name) && e.name !== '_routes.json');
  for (const file of internal) assert.ok(routes.includes(`/${file.name}`), `${file.name} must be listed in _routes.json`);
  assert.ok(routes.includes('/api/*'));
});

test('middleware blocks internal paths and passes public ones', async () => {
  const { onRequest } = await import('../functions/_middleware.js');
  const run = (p) => onRequest({ request: new Request('https://www.e4la.org' + p), next: async () => new Response('ok') });
  for (const p of ['/CLAUDE.md', '/package.json', '/.mcp.json', '/tests/x.mjs', '/migrations/0001_client_operations.sql', '/fixtures/a.sql', '/.claude/launch.json']) {
    assert.equal((await run(p)).status, 404, p);
  }
  for (const p of ['/', '/services', '/sitemap.xml', '/robots.txt', '/assets/x.json', '/api/book', '/client-portal/']) {
    assert.equal(await (await run(p)).text(), 'ok', p);
  }
});
