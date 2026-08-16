import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const page = readFileSync(new URL('./AppContactLinks.tsx', import.meta.url), 'utf8');
const app = readFileSync(new URL('../../App.tsx', import.meta.url), 'utf8');
const layout = readFileSync(new URL('../../layout/MainLayout.tsx', import.meta.url), 'utf8');

test('contact-links page separates view and manage capabilities', () => {
  assert.match(page, /admin\.app_contact_links\.view/);
  assert.match(page, /admin\.app_contact_links\.manage/);
  assert.match(page, /if \(!canView\) return <Navigate/);
  assert.match(page, /disabled=\{!canManage \|\| saving\}/);
});

test('contact-links page uses one full replacement save and null for blank fields', () => {
  assert.match(page, /api\.admin\.appContactLinks\.get\(\)/);
  assert.match(page, /api\.admin\.appContactLinks\.update\(payload\(values\)\)/);
  for (const key of ['facebookUrl', 'websiteUrl', 'instagramUrl', 'whatsappNumber', 'telegramNumber']) {
    assert.match(page, new RegExp(`${key}: value\\.${key}\\.trim\\(\\) \\|\\| null`));
  }
  assert.doesNotMatch(page, /Object\.entries\(value\)/);
});

test('clear action empties all editable contact-link fields', () => {
  assert.match(page, />مسح<\/Button>/);
  assert.match(page, /onClick=\{\(\) => setValues\(editable\(EMPTY\)\)\}/);
});

test('admin route and navigation entry are wired to the view capability', () => {
  assert.match(app, /path="\/admin\/app-contact-links" element=\{<AppContactLinks \/>\}/);
  assert.match(layout, /canAccessAdminSurface\('admin\.app_contact_links\.view'\)/);
  assert.match(layout, /to="\/admin\/app-contact-links"/);
});
