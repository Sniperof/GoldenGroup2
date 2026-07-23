import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { classifyVisitTaskFamilies } from './visitClassification.js';

const routeSource = readFileSync(
  new URL('../routes/telemarketing.ts', import.meta.url),
  'utf8',
);
const agendaQuery = routeSource.match(
  /const fieldVisitAppointmentsRes = await pool\.query\(([\s\S]*?)fieldVisitAppointmentParams,\s*\);/,
)?.[1] ?? '';

test('telemarketing team agenda is scoped by booking source, not visit content', () => {
  assert.ok(agendaQuery);
  assert.match(agendaQuery, /fv\.origin_type = 'telemarketing'/);
  assert.doesNotMatch(agendaQuery, /fv\.visit_type\s*=/);
  assert.match(agendaQuery, /FIELD_VISIT_SLOT_OCCUPIED_SQL/);
});

test('service and mixed are valid classifications for telemarketing-booked visits', () => {
  assert.equal(classifyVisitTaskFamilies(['marketing']), 'marketing');
  assert.equal(classifyVisitTaskFamilies(['service']), 'service');
  assert.equal(classifyVisitTaskFamilies(['marketing', 'service']), 'mixed');
});
