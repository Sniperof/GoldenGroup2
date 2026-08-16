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

test('team agenda resolves address from modern snapshot, legacy snapshot, task device, then client', () => {
  assert.match(agendaQuery, /customer_snapshot->>'addressText'/);
  assert.match(agendaQuery, /customer_snapshot->'address'->>'detailedAddress'/);
  assert.match(agendaQuery, /inst_source\.installation_address_text/);
  assert.match(agendaQuery, /c\.detailed_address/);
});

test('team agenda projects the structured work location for geographic grouping', () => {
  assert.match(agendaQuery, /workLocationGeoUnitId/);
  assert.match(agendaQuery, /ct\.work_location_geo_unit_id/);
  assert.match(agendaQuery, /inst_source\.installation_geo_unit_id/);
});
