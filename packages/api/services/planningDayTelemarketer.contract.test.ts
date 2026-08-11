import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const route = readFileSync(new URL('../routes/telemarketing.ts', import.meta.url), 'utf8');
const workspace = readFileSync(
  new URL('../../web/src/pages/TelemarketerWorkspace.tsx', import.meta.url),
  'utf8',
);
const queueCard = readFileSync(
  new URL('../../web/src/components/telemarketing/CustomerQueueCard.tsx', import.meta.url),
  'utf8',
);

test('telemarketing snapshot exposes closed plan and contact target state', () => {
  assert.match(route, /tl\.status AS "listStatus"/);
  assert.match(route, /tl\.close_reason AS "listCloseReason"/);
  assert.match(route, /ct\.status AS "contactTargetStatus"/);
  assert.match(route, /ct\.closing_reason AS "contactTargetClosingReason"/);
  assert.match(route, /status: row\.listStatus \?\? 'open'/);
  assert.match(route, /contactTargetStatus: row\.contactTargetStatus \?\? null/);
});

test('telemarketer workspace refreshes and becomes read-only when the plan ends', () => {
  assert.match(workspace, /window\.setInterval\(refreshSnapshot, 30_000\)/);
  assert.match(workspace, /activeTaskList\?\.status === 'closed'/);
  assert.match(workspace, /cg\.contactTargetStatus === 'closed'/);
  assert.match(workspace, /انتهت خطة هذا الفريق/);
  assert.match(workspace, /القائمة للقراءة فقط/);
  assert.match(workspace, /!isCtClosedForSelected/);
});

test('each queued contact shows an explicit ended-plan label', () => {
  assert.match(workspace, /planEnded: activeTaskList\?\.status === 'closed'/);
  assert.match(queueCard, /planEnded\?: boolean/);
  assert.match(queueCard, /انتهت الخطة/);
});
