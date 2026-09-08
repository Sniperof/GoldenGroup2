import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('./Dashboard.tsx', import.meta.url), 'utf8');

test('existing dashboard loads and saves the current employee layout', () => {
  assert.match(source, /api\.dashboardLayout\.get\(\)/);
  assert.match(source, /api\.dashboardLayout\.save\(next\)/);
  assert.match(source, /<DashboardCustomizer/);
});

test('dashboard renders the saved order instead of fixed department sections', () => {
  assert.match(source, /layout\.flatMap\(saved/);
  assert.match(source, /selectedWidgets\.map/);
  assert.doesNotMatch(source, /widgetsForSection|availableSections|useSearchParams/);
});

test('first-time layout is deliberately bounded', () => {
  assert.match(source, /MAX_DEFAULT_WIDGETS = 8/);
  assert.match(source, /slice\(0, MAX_DEFAULT_WIDGETS\)/);
});
