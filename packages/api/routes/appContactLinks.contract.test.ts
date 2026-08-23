import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const adminRoute = readFileSync(new URL('./appContactLinks.ts', import.meta.url), 'utf8');
const publicRoute = readFileSync(new URL('./appHome.ts', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../../../migrations/424_app_contact_links.sql', import.meta.url), 'utf8');

test('admin contact-links endpoints enforce separate GLOBAL view and manage capabilities', () => {
  assert.match(adminRoute, /router\.get\('\/', requirePermission\(VIEW\)/);
  assert.match(adminRoute, /router\.put\('\/', requirePermission\(MANAGE\)/);
  assert.match(migration, /admin\.app_contact_links\.view[\s\S]*ARRAY\['GLOBAL'\]/);
  assert.match(migration, /admin\.app_contact_links\.manage[\s\S]*ARRAY\['GLOBAL'\]/);
});

test('mobile contact-links endpoint is optional-auth and uses the public projection', () => {
  assert.match(publicRoute, /router\.get\('\/home\/contact-links', optionalAppAuth/);
  assert.match(publicRoute, /readPublicAppContactLinks\(\)/);
});

test('admin update is transactional, audited and invalidates public cache after commit', () => {
  assert.match(adminRoute, /client\.query\('BEGIN'\)/);
  assert.match(adminRoute, /readAppContactLinks\(client, true\)/);
  assert.match(adminRoute, /insertAuditLog\(client/);
  assert.match(adminRoute, /client\.query\('COMMIT'\)[\s\S]*clearAppContactLinksCache\(\)/);
  assert.match(adminRoute, /client\.query\('ROLLBACK'\)/);
});
