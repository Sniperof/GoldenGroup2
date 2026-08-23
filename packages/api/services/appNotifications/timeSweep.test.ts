import assert from 'node:assert/strict';
import test from 'node:test';
import { runNotificationSweep } from './timeSweep.js';
import type { Queryable } from './notificationService.js';

interface Fixtures {
  visits?: Record<string, unknown>[];
  maintenance?: Record<string, unknown>[];
  warranties?: Record<string, unknown>[];
  settings?: Record<string, string>;
  /** Types whose kill switch is off. */
  disabled?: string[];
  /** Simulate the dedup index refusing every insert. */
  allDeduped?: boolean;
}

function mockDb(f: Fixtures = {}) {
  const inserts: unknown[][] = [];
  const warrantyParams: unknown[][] = [];
  const db: Queryable = {
    async query(sql: string, params?: unknown[]) {
      if (sql.includes('system_settings')) {
        const key = String((params ?? [])[0] ?? '');
        if (key.startsWith('notif_') && key.endsWith('_enabled')) {
          const type = key.slice('notif_'.length, -'_enabled'.length);
          return (f.disabled ?? []).includes(type)
            ? { rows: [{ value: 'false' }], rowCount: 1 }
            : { rows: [], rowCount: 0 };
        }
        const value = (f.settings ?? {})[key];
        return value === undefined
          ? { rows: [], rowCount: 0 }
          : { rows: [{ value }], rowCount: 1 };
      }
      if (sql.includes('FROM field_visits')) return { rows: f.visits ?? [], rowCount: (f.visits ?? []).length };
      if (sql.includes('FROM open_tasks')) return { rows: f.maintenance ?? [], rowCount: (f.maintenance ?? []).length };
      if (sql.includes('FROM device_warranties')) {
        warrantyParams.push(params ?? []);
        return { rows: f.warranties ?? [], rowCount: (f.warranties ?? []).length };
      }
      if (sql.includes('FROM app_accounts')) {
        return { rows: [{ app_account_id: '7', locale: 'ar', tokens: [] }], rowCount: 1 };
      }
      if (sql.includes('INSERT INTO app_notifications')) {
        inserts.push(params ?? []);
        return f.allDeduped ? { rows: [], rowCount: 0 } : { rows: [{ id: '500' }], rowCount: 1 };
      }
      throw new Error(`unexpected query: ${sql}`);
    },
  };
  return { db, inserts, warrantyParams };
}

const VISIT = { id: 55, client_id: 8, scheduled_date: '2026-08-18', scheduled_time: '09:30' };
const TASK = {
  id: 900, client_id: 8, device_id: 42, due_date: '2026-08-10',
  days_overdue: 8, device_label: 'فلتر المطبخ',
};
const WARRANTY = { id: 12, device_id: 42, customer_id: 8, end_date: '2026-09-17', days_left: 30 };

test('a visit today is reminded once, keyed on the visit and its date', async () => {
  const { db, inserts } = mockDb({ visits: [VISIT] });
  const out = await runNotificationSweep({ db });
  assert.equal(out.visitReminders, 1);
  assert.equal(inserts[0][1], 'visit_reminder');
  assert.equal(inserts[0][6], 55, 'entity_id is the visit');
  assert.equal(inserts[0][7], '2026-08-18', 'window_key is the visit date');
  assert.match(String(inserts[0][3]), /زيارة اليوم الساعة 09:30/);
});

test('the maintenance nudge is capped at one repeat', async () => {
  // 8 days overdue with a 14-day repeat is still the first cycle.
  const first = mockDb({ maintenance: [TASK] });
  await runNotificationSweep({ db: first.db });
  assert.equal(first.inserts[0][7], '2026-08-10#0');

  // Past the repeat interval it moves to cycle 1...
  const second = mockDb({ maintenance: [{ ...TASK, days_overdue: 20 }] });
  await runNotificationSweep({ db: second.db });
  assert.equal(second.inserts[0][7], '2026-08-10#1');

  // ...and stays there however long it has been ignored, so enabling the
  // feature cannot machine-gun a year-old backlog.
  const stale = mockDb({ maintenance: [{ ...TASK, days_overdue: 400 }] });
  await runNotificationSweep({ db: stale.db });
  assert.equal(stale.inserts[0][7], '2026-08-10#1');
});

test('maintenance dedupes on the task but navigates to the device', async () => {
  const { db, inserts } = mockDb({ maintenance: [TASK] });
  await runNotificationSweep({ db });
  assert.equal(inserts[0][6], 900, 'entity_id is the task');
  assert.equal(JSON.parse(String(inserts[0][5])).destination_id, '42', 'destination is the device');
});

test('each warranty threshold is its own window, and both are queried', async () => {
  const { db, inserts, warrantyParams } = mockDb({ warranties: [WARRANTY] });
  const out = await runNotificationSweep({ db });
  assert.equal(out.warrantyExpiring, 2, 'one per configured threshold');
  assert.deepEqual(warrantyParams.map((p) => p[0]), [30, 7]);
  assert.equal(inserts[0][7], '2026-09-17#30');
  assert.equal(inserts[1][7], '2026-09-17#7');
});

test('a warranty inside the grace window keys on the threshold, not the real count', async () => {
  const { db, inserts, warrantyParams } = mockDb({
    warranties: [{ ...WARRANTY, days_left: 28 }],
    settings: { notif_warranty_expiry_days: '30' },
  });
  await runNotificationSweep({ db });
  assert.equal(warrantyParams[0][1], 3, 'the grace is passed to SQL');
  assert.equal(inserts[0][7], '2026-09-17#30', 'the 30-day mark is announced once');
  assert.match(String(inserts[0][3]), /خلال 28 يوماً/, 'but the text says the true remaining days');
});

test('admin thresholds override the defaults, and rubbish falls back', async () => {
  const custom = mockDb({ warranties: [WARRANTY], settings: { notif_warranty_expiry_days: '60, 14 ,3' } });
  await runNotificationSweep({ db: custom.db });
  assert.deepEqual(custom.warrantyParams.map((p) => p[0]), [60, 14, 3]);

  const broken = mockDb({ warranties: [WARRANTY], settings: { notif_warranty_expiry_days: 'soon, later' } });
  await runNotificationSweep({ db: broken.db });
  assert.deepEqual(broken.warrantyParams.map((p) => p[0]), [30, 7], 'never sweeps with an empty threshold list');
});

test('a disabled type is not swept at all', async () => {
  const { db, inserts } = mockDb({
    visits: [VISIT], maintenance: [TASK], warranties: [WARRANTY],
    disabled: ['visit_reminder', 'warranty_expiring'],
  });
  const out = await runNotificationSweep({ db });
  assert.equal(out.visitReminders, 0);
  assert.equal(out.warrantyExpiring, 0);
  assert.equal(out.maintenanceDue, 1);
  assert.equal(inserts.length, 1);
});

test('a second run of the same day reports everything as already sent', async () => {
  const { db } = mockDb({ visits: [VISIT], maintenance: [TASK], allDeduped: true });
  const out = await runNotificationSweep({ db });
  assert.equal(out.visitReminders, 0);
  assert.equal(out.maintenanceDue, 0);
  assert.equal(out.skipped, 2, 'the dedup index absorbed both, so catch-up is safe');
});

test('an empty day writes nothing', async () => {
  const { db, inserts } = mockDb();
  const out = await runNotificationSweep({ db });
  assert.deepEqual(out, {
    visitReminders: 0, maintenanceDue: 0, warrantyExpiring: 0, skipped: 0,
  });
  assert.equal(inserts.length, 0);
});
