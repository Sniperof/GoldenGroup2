import assert from 'node:assert/strict';
import test from 'node:test';
import type { PoolClient } from 'pg';
import { decideVisitEvent, processOutboxRow, type OutboxRow } from './outboxConsumer.js';

function row(over: Partial<OutboxRow> = {}): OutboxRow {
  return {
    id: '1',
    entity_type: 'field_visit',
    entity_id: '55',
    from_status: null,
    to_status: 'scheduled',
    ...over,
  };
}

function mockDb(opts: {
  request?: { beneficiary_client_id: number | null; request_type: string } | null;
  visit?: { client_id: number | null; scheduled_date: string | null } | null;
} = {}) {
  const inserts: unknown[][] = [];
  const db = {
    async query(sql: string, params?: unknown[]) {
      if (sql.includes('system_settings')) return { rows: [], rowCount: 0 };
      if (sql.includes('FROM service_requests')) {
        return opts.request === null || opts.request === undefined
          ? { rows: [], rowCount: 0 }
          : { rows: [opts.request], rowCount: 1 };
      }
      if (sql.includes('FROM field_visits')) {
        return opts.visit == null ? { rows: [], rowCount: 0 } : { rows: [opts.visit], rowCount: 1 };
      }
      if (sql.includes('FROM app_accounts')) {
        return { rows: [{ app_account_id: '7', locale: 'ar', tokens: ['tok'] }], rowCount: 1 };
      }
      if (sql.includes('INSERT INTO app_notifications')) {
        inserts.push(params ?? []);
        return { rows: [{ id: '900' }], rowCount: 1 };
      }
      throw new Error(`unexpected query: ${sql}`);
    },
  };
  return { db: db as unknown as PoolClient, inserts };
}

test('a visit is announced when it is born scheduled (INSERT capture)', async () => {
  const { db, inserts } = mockDb({ visit: { client_id: 8, scheduled_date: '2026-08-23' } });
  const out = await processOutboxRow(db, row({ from_status: null, to_status: 'scheduled' }));
  assert.equal(out.prepared.length, 1);
  assert.equal(inserts[0][1], 'visit_scheduled');
  assert.match(String(inserts[0][3]), /الأحد 23\/08\/2026/);
});

test('cancelling a visit notifies with the date it was going to happen', async () => {
  const { db, inserts } = mockDb({ visit: { client_id: 8, scheduled_date: '2026-08-23' } });
  await processOutboxRow(db, row({ from_status: 'scheduled', to_status: 'cancelled' }));
  assert.equal(inserts[0][1], 'visit_cancelled');
  assert.match(String(inserts[0][3]), /تم إلغاء/);
});

test('completed then closed thanks the customer exactly once', () => {
  assert.equal(decideVisitEvent('ended', 'completed'), 'completed');
  assert.equal(decideVisitEvent('completed', 'closed'), null, 'the second step is silent');
  assert.equal(decideVisitEvent('ended', 'closed'), 'completed', 'a direct jump still notifies');
});

test('internal visit progress stays silent', () => {
  for (const s of ['in_progress', 'ended', 'not_completed', 'planned']) {
    assert.equal(decideVisitEvent('scheduled', s), null, `${s} must be silent`);
  }
});

test('a visit with no client produces nothing and says why', async () => {
  const { db, inserts } = mockDb({ visit: { client_id: null, scheduled_date: '2026-08-23' } });
  const out = await processOutboxRow(db, row());
  assert.deepEqual(out.prepared, []);
  assert.equal(out.skipReason, 'no_recipient');
  assert.equal(inserts.length, 0);
});

test('a service-request terminal notifies through the outbox', async () => {
  const { db, inserts } = mockDb({
    request: { beneficiary_client_id: 8, request_type: 'emergency_maintenance' },
  });
  const out = await processOutboxRow(db, row({
    entity_type: 'service_request', entity_id: '96', from_status: 'in_review', to_status: 'cancelled',
  }));
  assert.equal(out.prepared.length, 1);
  assert.equal(inserts[0][1], 'service_request_status_changed');
  assert.equal(out.skipReason, null);
});

test('an internal request transition is recorded as considered, then skipped', async () => {
  const { db, inserts } = mockDb({
    request: { beneficiary_client_id: 8, request_type: 'water_check' },
  });
  const out = await processOutboxRow(db, row({
    entity_type: 'service_request', entity_id: '96', from_status: 'received', to_status: 'in_review',
  }));
  assert.deepEqual(out.prepared, []);
  assert.equal(out.skipReason, 'no_notification_for_status');
  assert.equal(inserts.length, 0);
});

test('a deleted source row is a normal skip, not a failure', async () => {
  const { db } = mockDb({ request: null });
  const out = await processOutboxRow(db, row({
    entity_type: 'service_request', entity_id: '404', to_status: 'completed',
  }));
  assert.deepEqual(out.prepared, []);
  assert.equal(out.skipReason, 'entity_missing');
});

test('a visit with no scheduled date still gets a sentence that reads', async () => {
  const { db, inserts } = mockDb({ visit: { client_id: 8, scheduled_date: null } });
  await processOutboxRow(db, row());
  assert.equal(String(inserts[0][3]), 'تم تحديد موعد زيارتك');
});

// ── complaints (D-N16) ──────────────────────────────────────
function mockComplaintDb(update: Record<string, unknown> | null, accounts = 1) {
  const inserts: unknown[][] = [];
  const seen: string[] = [];
  const db = {
    async query(sql: string, params?: unknown[]) {
      seen.push(sql);
      if (sql.includes('system_settings')) return { rows: [], rowCount: 0 };
      if (sql.includes('FROM complaint_public_updates')) {
        return update == null ? { rows: [], rowCount: 0 } : { rows: [update], rowCount: 1 };
      }
      if (sql.includes('FROM app_accounts')) {
        const rows = Array.from({ length: accounts }, (_, i) => ({
          app_account_id: String(7 + i), locale: 'ar', tokens: ['tok'],
        }));
        return { rows, rowCount: rows.length };
      }
      if (sql.includes('INSERT INTO app_notifications')) {
        inserts.push(params ?? []);
        return { rows: [{ id: '901' }], rowCount: 1 };
      }
      throw new Error(`unexpected query: ${sql}`);
    },
  };
  return { db: db as unknown as PoolClient, inserts, seen };
}

const UPDATE_ROW = {
  public_status: 'information_required',
  message: 'نحتاج صورة إضافية للجهاز لاستكمال دراسة الشكوى',
  is_system: true,
  complaint_id: 12,
  public_ref_number: 'CMP-2026-0012',
  requester_app_account_id: 7,
};

test('a published complaint update carries the authored text verbatim', async () => {
  const { db, inserts } = mockComplaintDb(UPDATE_ROW);
  const out = await processOutboxRow(db, row({
    entity_type: 'complaint_public_update', entity_id: '55', to_status: 'information_required',
  }));
  assert.equal(out.prepared.length, 1);
  assert.equal(inserts[0][1], 'complaint_update');
  assert.equal(String(inserts[0][3]), UPDATE_ROW.message, 'the staff text is not paraphrased');
  assert.equal(String(inserts[0][2]), 'الشكوى CMP-2026-0012', 'the title carries the reference');
});

test('a complaint update reaches only the filer, not the whole household', async () => {
  const { db, seen } = mockComplaintDb(UPDATE_ROW, 3);
  await processOutboxRow(db, row({ entity_type: 'complaint_public_update', entity_id: '55' }));
  const lookup = seen.find((q) => q.includes('FROM app_accounts'))!;
  assert.match(lookup, /a\.id = \$1/, 'targets one account');
  assert.doesNotMatch(lookup, /linked_client_record_id/, 'never fans out by client');
});

test('the intake confirmation does not notify — the filer is on the success screen', async () => {
  const { db, inserts } = mockComplaintDb({
    ...UPDATE_ROW, public_status: 'received', is_system: true,
  });
  const out = await processOutboxRow(db, row({
    entity_type: 'complaint_public_update', entity_id: '55', to_status: 'received',
  }));
  assert.deepEqual(out.prepared, []);
  assert.equal(out.skipReason, 'no_recipient_or_intake_row');
  assert.equal(inserts.length, 0);
});

test('a staff-authored "received" message still notifies — only the system row is silent', async () => {
  const { db, inserts } = mockComplaintDb({
    ...UPDATE_ROW, public_status: 'received', is_system: false, message: 'أعدنا فتح شكواك',
  });
  const out = await processOutboxRow(db, row({
    entity_type: 'complaint_public_update', entity_id: '55', to_status: 'received',
  }));
  assert.equal(out.prepared.length, 1);
  assert.equal(String(inserts[0][3]), 'أعدنا فتح شكواك');
});

test('a complaint filed by a visitor has no inbox to reach', async () => {
  const { db, inserts } = mockComplaintDb({ ...UPDATE_ROW, requester_app_account_id: null });
  const out = await processOutboxRow(db, row({
    entity_type: 'complaint_public_update', entity_id: '55',
  }));
  assert.deepEqual(out.prepared, []);
  assert.equal(inserts.length, 0);
});

test('the public status travels in the payload for the app to render', async () => {
  const { db, inserts } = mockComplaintDb(UPDATE_ROW);
  await processOutboxRow(db, row({ entity_type: 'complaint_public_update', entity_id: '55' }));
  const data = JSON.parse(String(inserts[0][5]));
  assert.equal(data.public_status, 'information_required');
  assert.equal(data.destination, 'complaint');
  assert.equal(data.destination_id, '12', 'points at the complaint, not the update');
});
