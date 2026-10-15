import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./MyVisitsPage.tsx', import.meta.url), 'utf8');

test('my visits exposes the bounded today, tomorrow, and past workflow', () => {
  for (const label of ['اليوم', 'غداً', 'السابقة']) {
    assert.ok(source.includes(`label: '${label}'`), `missing visit view: ${label}`);
  }
  assert.match(source, /const activeDate = view === 'today' \? today : view === 'tomorrow' \? tomorrow : pastDate/);
  assert.match(source, /max={yesterday}/);
  assert.match(source, /الجدولة المستقبلية متاحة حتى يوم غد فقط/);
});

test('focus mode hides only completed and cancelled visits from today or tomorrow', () => {
  assert.match(source, /const DONE_STATUSES = new Set\(\['completed', 'cancelled'\]\)/);
  assert.match(source, /focusOnly && view !== 'past'/);
  assert.match(source, /ركّز على المتبقي/);
});

test('the page prioritizes actionable visits before chronological time', () => {
  assert.match(source, /row\.status === 'in_progress'/);
  assert.match(source, /row\.hasPendingStartAlert/);
  assert.match(source, /scheduledTime \?\? '99:99'/);
});
