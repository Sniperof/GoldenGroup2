import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertTeamSlotAvailable,
  BookingError,
  FIELD_VISIT_SLOT_CONSTRAINT,
  FIELD_VISIT_SLOT_OCCUPIED_SQL,
  mapVisitSlotConflict,
} from './visitBooking.js';

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
