import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const smartTableSource = readFileSync(new URL('./SmartTable.tsx', import.meta.url), 'utf8');
const clientProfileSource = readFileSync(new URL('../pages/ClientProfile.tsx', import.meta.url), 'utf8');

test('horizontal SmartTable keeps its sticky header at zero so it cannot cover the first row', () => {
  assert.match(smartTableSource, /<thead className="sticky top-0 z-20/);
  assert.doesNotMatch(smartTableSource, /--st-sticky-top/);
});

test('client profile does not inject a tab-height offset into nested tables', () => {
  assert.doesNotMatch(clientProfileSource, /--st-sticky-top/);
  assert.doesNotMatch(clientProfileSource, /tabsBarH|tabsBarRef/);
});
