import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertTeamSlotAvailable,
  BookingError,
  buildInstantVisitInsertParams,
  FIELD_VISIT_SLOT_CONSTRAINT,
  FIELD_VISIT_SLOT_OCCUPIED_SQL,
  INSTANT_VISIT_INSERT_SQL,
  mapVisitSlotConflict,
} from './visitBooking.js';

test('instant visit uses distinct parameters for bigint origin_id and integer created_by', () => {
  assert.match(INSTANT_VISIT_INSERT_SQL, /'field_initiated', \$5/);
  assert.match(INSTANT_VISIT_INSERT_SQL, /NOW\(\), \$9/);
  assert.doesNotMatch(INSTANT_VISIT_INSERT_SQL, /NOW\(\), \$5/);

  const params = buildInstantVisitInsertParams({
    branchId: 6,
    clientId: 48,
    scheduledDate: '2026-07-23',
    scheduledTime: '10:19',
    performedByUserId: 4,
    teamSnapshotJson: '{"teamKey":"team_0"}',
    responsibleHrUserId: 4,
    customerSnapshotJson: '{"name":"زبون اختبار"}',
  });

  assert.equal(params.length, 9);
  assert.equal(params[4], 4, 'origin_id must contain the creating hr_user id');
  assert.equal(params[8], 4, 'created_by must contain the same hr_user id via its own placeholder');
});

test('team slot guard treats every non-cancelled visit as occupying the slot', async () => {
  const db = {
    async query(sql: string, params: unknown[]) {
      assert.match(sql, /fv\.status <> 'cancelled'/);
      assert.deepEqual(params, [6, '2026-07-20', 'team_2', '09:00']);
      return { rows: [{ id: 3 }] };
    },
  };

  await assert.rejects(
    assertTeamSlotAvailable(db as any, {
      branchId: 6,
      scheduledDate: '2026-07-20',
      scheduledTime: '09:00',
      teamKey: 'team_2',
    }),
    (error: unknown) => error instanceof BookingError
      && error.statusCode === 409
      && /محجوز مسبقاً/.test(error.message),
  );
});

test('team slot guard allows a slot with no non-cancelled visit', async () => {
  const db = { async query() { return { rows: [] }; } };

  await assert.doesNotReject(assertTeamSlotAvailable(db as any, {
    branchId: 6,
    scheduledDate: '2026-07-20',
    scheduledTime: '09:00',
    teamKey: 'team_2',
  }));
});

test('database slot violation maps to the public booking conflict', () => {
  const mapped = mapVisitSlotConflict({ code: '23505', constraint: FIELD_VISIT_SLOT_CONSTRAINT });

  assert.ok(mapped instanceof BookingError);
  assert.equal(mapped.statusCode, 409);
  assert.match(mapped.message, /محجوز مسبقاً/);
});

test('unrelated database errors are not translated', () => {
  const original = { code: '23505', constraint: 'another_constraint' };
  assert.equal(mapVisitSlotConflict(original), original);
  assert.equal(FIELD_VISIT_SLOT_OCCUPIED_SQL, "fv.status <> 'cancelled'");
});
