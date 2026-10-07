import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { isInternalPath, onRequest } from '../functions/_middleware.js';

test('routes run the middleware for everything except /assets/*', async () => {
  const routes = JSON.parse(await readFile(new URL('../_routes.json', import.meta.url), 'utf8'));
  assert.deepEqual(routes.include, ['/*']);
  assert.deepEqual(routes.exclude, ['/assets/*']);
});

test('internal paths and common bypass variants are blocked', () => {
  for (const p of [
    '/CLAUDE.md', '/claude.md', '/CLAUDE.MD', '/%43LAUDE.md', '/%2543LAUDE.md', '//CLAUDE.md', '/./CLAUDE.md', '/x/../CLAUDE.md',
    '/CLAUDE.md/', '/package.json', '/PACKAGE.JSON', '/.mcp.json', '/.git/config', '/%2egit/config', '/.claude/launch.json', '/.env',
    '/tests/x.mjs', '/TESTS/x.mjs', '/migrations/0001_client_operations.sql', '/migrations%2f0001_client_operations.sql', '/Migrations/a.sql',
    '/fixtures/a.sql', '/functions/api/book.js', '/scripts/image-tools/x.py', '/config/client-operations.environment.example',
    '/%63onfig/client-operations.environment.example', '/_routes.json', '/_headers', '/wrangler.preview.jsonc', '/CLIENT-OPERATIONS-STATE.json',
    '/bad%ZZ', '\\CLAUDE.md', '/MEASUREMENT.md',
  ]) assert.equal(isInternalPath(p), true, p);
});

test('public paths pass through', async () => {
  for (const p of ['/', '/services', '/our-work', '/about', '/privacy', '/terms', '/sitemap.xml', '/robots.txt', '/style.css', '/script.js',
    '/measurement.js', '/client-portal/', '/admin/', '/client-agreement/abc123', '/api/book', '/api/ops/health', '/E4LA-logo.jpg', '/.well-known/security.txt']) {
    assert.equal(isInternalPath(p), false, p);
    const res = await onRequest({ request: new Request('https://www.e4la.org' + p), next: async () => new Response('ok') });
    assert.equal(await res.text(), 'ok', p);
  }
});
