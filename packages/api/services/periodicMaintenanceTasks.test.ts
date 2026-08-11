import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cancelUpcomingPeriodicMaintenanceForTransfer,
  createPeriodicMaintenanceTaskFromServiceRequest,
  generateFirstPeriodicMaintenanceTask,
  PeriodicMaintenanceTransferError,
  type PeriodicMaintenanceGenerationResult,
} from './periodicMaintenanceTasks.js';
import { activateDeviceAndBootstrapPeriodicMaintenance } from './visitTaskResultReflection.js';
import type { PeriodicMaintenanceSettings } from './systemSettings.js';

const enabledSettings: PeriodicMaintenanceSettings = {
  autoGenerateEnabled: true,
  manualCreationEnabled: true,
  defaultIntervalMonths: 6,
  attachWarningDays: 14,
  attachAllowedStatuses: ['open'],
};

test('service-request periodic creation preserves each approved schedule anchor', async () => {
  const scenarios = [
    {
      name: 'first task uses activation',
      history: null,
      expectedAnchor: '2026-01-10T09:00:00.000Z',
    },
    {
      name: 'closed task uses its close time',
      history: { status: 'closed', dueDate: '2026-06-01', closedAt: '2026-06-15T09:00:00.000Z', supersededByOpenTaskId: null, supersedingClosedAt: null },
      expectedAnchor: '2026-06-15T09:00:00.000Z',
    },
    {
      name: 'superseded task uses the emergency close time',
      history: { status: 'closed', dueDate: '2026-06-01', closedAt: '2026-06-02T09:00:00.000Z', supersededByOpenTaskId: 88, supersedingClosedAt: '2026-06-20T09:00:00.000Z' },
      expectedAnchor: '2026-06-20T09:00:00.000Z',
    },
  ];

  for (const scenario of scenarios) {
    const dateParams: any[][] = [];
    const db = {
      async query(sql: string, params?: any[]) {
        if (sql.includes('FROM installed_devices d')) return { rows: [{
          id: 38, clientId: 4, branchId: 2, contractId: 77, status: 'active',
          activatedAt: '2026-01-10T09:00:00.000Z', warrantyMonths: 12, warrantyVisits: 2,
          maintenancePlan: null, serviceAgreementId: null,
        }] };
        if (sql.includes("status NOT IN ('completed', 'closed', 'cancelled')") && sql.includes('FOR UPDATE')) {
          return { rows: [] };
        }
        if (sql.includes('LEFT JOIN open_task_periodic_payload')) return { rows: scenario.history ? [scenario.history] : [] };
        if (sql.includes('SELECT ($1::timestamptz')) {
          dateParams.push(params ?? []);
          return { rows: [{ dueDate: '2026-12-12' }] };
        }
        if (sql.includes('INSERT INTO open_tasks')) return { rows: [{ id: 901 }] };
        return { rows: [] };
      },
    };
    const result = await createPeriodicMaintenanceTaskFromServiceRequest(db, {
      serviceRequestId: 700,
      installedDeviceId: 38,
      requestReasonId: 5,
      requestReasonSnapshot: { id: 5, code: 'scheduled', label: scenario.name },
      createdByUserId: 12,
      settings: enabledSettings,
    });
    assert.equal(result.outcome, 'created', scenario.name);
    assert.deepEqual(dateParams[0], [scenario.expectedAnchor, 180], scenario.name);
  }
});

test('service-request periodic creation inherits an unexecuted cancelled due date without clipping it', async () => {
  let arithmeticQueries = 0;
  let insertedDueDate: unknown;
  const db = {
    async query(sql: string, params?: any[]) {
      if (sql.includes('FROM installed_devices d')) return { rows: [{
        id: 38, clientId: 4, branchId: 2, contractId: 77, status: 'active',
        activatedAt: '2026-01-10T09:00:00.000Z', warrantyMonths: 12, warrantyVisits: 2,
        maintenancePlan: null, serviceAgreementId: null,
      }] };
      if (sql.includes("status NOT IN ('completed', 'closed', 'cancelled')") && sql.includes('FOR UPDATE')) return { rows: [] };
      if (sql.includes('LEFT JOIN open_task_periodic_payload')) return { rows: [{
        status: 'cancelled', dueDate: '2026-02-01', closedAt: null,
        supersededByOpenTaskId: null, supersedingClosedAt: null,
      }] };
      if (sql.includes('SELECT ($1::timestamptz')) {
        arithmeticQueries += 1;
        return { rows: [] };
      }
      if (sql.includes('INSERT INTO open_tasks')) {
        insertedDueDate = params?.[4];
        return { rows: [{ id: 902 }] };
      }
      return { rows: [] };
    },
  };
  const result = await createPeriodicMaintenanceTaskFromServiceRequest(db, {
    serviceRequestId: 701,
    installedDeviceId: 38,
    requestReasonId: 5,
    requestReasonSnapshot: { id: 5, code: 'scheduled', label: 'مستحقة' },
    createdByUserId: 12,
    settings: enabledSettings,
  });
  assert.equal(result.outcome, 'created');
  assert.equal(arithmeticQueries, 0);
  assert.equal(insertedDueDate, '2026-02-01');
});

test('successful activation updates device and contract before bootstrapping periodic maintenance', async () => {
  const statements: string[] = [];
  const db = {
    async query(sql: string) {
      statements.push(sql);
      return { rows: [] };
    },
  };
  const generated: PeriodicMaintenanceGenerationResult = {
    createdTaskId: 901,
    skippedReason: null,
    dueDate: '2027-01-20',
    intervalDays: 180,
  };

  const result = await activateDeviceAndBootstrapPeriodicMaintenance(
    db as any,
    {
      installedDeviceId: 38,
      contractId: 77,
      performedByUserId: 12,
    },
    async (receivedDb, installedDeviceId, createdByUserId) => {
      assert.equal(receivedDb, db);
      assert.equal(installedDeviceId, 38);
      assert.equal(createdByUserId, 12);
      assert.equal(statements.length, 2);
      assert.match(statements[0], /UPDATE installed_devices/);
      assert.match(statements[1], /UPDATE contracts/);
      return generated;
    },
  );

  assert.deepEqual(result, generated);
});

test('successful activation rolls back through the caller on an invalid periodic bootstrap state', async () => {
  const db = {
    async query() {
      return { rows: [] };
    },
  };

  await assert.rejects(
    activateDeviceAndBootstrapPeriodicMaintenance(
      db as any,
      {
        installedDeviceId: 38,
        contractId: 77,
        performedByUserId: 12,
      },
      async () => ({
        createdTaskId: null,
        skippedReason: 'missing_activation_timestamp',
        dueDate: null,
        intervalDays: 180,
      }),
    ),
    /Periodic maintenance bootstrap failed after device activation: missing_activation_timestamp/,
  );
});

test('first periodic generation is a no-op when automatic generation is disabled', async () => {
  let queried = false;
  const db = {
    async query() {
      queried = true;
      return { rows: [] };
    },
  };

  const result = await generateFirstPeriodicMaintenanceTask(
    db,
    38,
    12,
    { settings: { ...enabledSettings, autoGenerateEnabled: false } },
  );

  assert.equal(queried, false);
  assert.deepEqual(result, {
    createdTaskId: null,
    skippedReason: 'auto_generation_disabled',
    dueDate: null,
    intervalDays: null,
  });
});

test('first periodic generation skips an inactive device', async () => {
  const db = {
    async query(sql: string) {
      assert.match(sql, /FROM installed_devices d/);
      return {
        rows: [{
          id: 38,
          clientId: 4,
          branchId: 2,
          contractId: 77,
          status: 'installed',
        }],
      };
    },
  };

  const result = await generateFirstPeriodicMaintenanceTask(
    db,
    38,
    12,
    { settings: enabledSettings },
  );

  assert.equal(result.skippedReason, 'device_not_active');
  assert.equal(result.createdTaskId, null);
});

test('first periodic generation does not guess a due date without an activation timestamp', async () => {
  const db = {
    async query(sql: string) {
      assert.match(sql, /FROM installed_devices d/);
      return {
        rows: [{
          id: 38,
          clientId: 4,
          branchId: 2,
          contractId: 77,
          status: 'active',
          activatedAt: null,
          warrantyMonths: 12,
          warrantyVisits: 2,
          maintenancePlan: null,
        }],
      };
    },
  };

  const result = await generateFirstPeriodicMaintenanceTask(
    db,
    38,
    12,
    { settings: enabledSettings },
  );

  assert.deepEqual(result, {
    createdTaskId: null,
    skippedReason: 'missing_activation_timestamp',
    dueDate: null,
    intervalDays: 180,
  });
});

test('first periodic generation does not duplicate an active task', async () => {
  const statements: string[] = [];
  const db = {
    async query(sql: string, params?: any[]) {
      statements.push(sql);
      if (sql.includes('FROM installed_devices d')) {
        return {
          rows: [{
            id: 38,
            clientId: 4,
            branchId: 2,
            contractId: 77,
            status: 'active',
            activatedAt: '2026-07-20T08:00:00.000Z',
            warrantyMonths: 12,
            warrantyVisits: 2,
            maintenancePlan: null,
          }],
        };
      }
      if (sql.includes('SELECT ($1::timestamptz')) {
        assert.deepEqual(params, ['2026-07-20T08:00:00.000Z', 180]);
        return { rows: [{ dueDate: '2027-01-16' }] };
      }
      if (sql.includes('FROM open_tasks')) {
        return { rows: [{ id: 500 }] };
      }
      throw new Error(`Unexpected SQL in test: ${sql}`);
    },
  };

  const result = await generateFirstPeriodicMaintenanceTask(
    db,
    38,
    12,
    { settings: enabledSettings },
  );

  assert.equal(result.skippedReason, 'active_periodic_exists');
  assert.equal(result.createdTaskId, null);
  assert.equal(statements.some(sql => sql.includes('INSERT INTO open_tasks')), false);
});

test('first periodic dry-run calculates the plan without inserting rows', async () => {
  const statements: string[] = [];
  const db = {
    async query(sql: string) {
      statements.push(sql);
      if (sql.includes('FROM installed_devices d')) {
        return {
          rows: [{
            id: 38,
            clientId: 4,
            branchId: 2,
            contractId: 77,
            status: 'active',
            activatedAt: '2026-07-20T08:00:00.000Z',
            warrantyMonths: 12,
            warrantyVisits: 2,
            maintenancePlan: null,
          }],
        };
      }
      if (sql.includes('SELECT ($1::timestamptz')) {
        return { rows: [{ dueDate: '2027-01-16' }] };
      }
      if (sql.includes('FROM open_tasks')) {
        return { rows: [] };
      }
      throw new Error(`Unexpected SQL in test: ${sql}`);
    },
  };

  const result = await generateFirstPeriodicMaintenanceTask(
    db,
    38,
    null,
    { settings: enabledSettings, dryRun: true },
  );

  assert.deepEqual(result, {
    createdTaskId: null,
    skippedReason: 'dry_run_would_create',
    dueDate: '2027-01-16',
    intervalDays: 180,
  });
  assert.equal(statements.some(sql => sql.includes('INSERT INTO')), false);
});

test('first periodic generation creates task, payload, and snapshots from activation date', async () => {
  const statements: Array<{ sql: string; params?: any[] }> = [];
  const db = {
    async query(sql: string, params?: any[]) {
      statements.push({ sql, params });
      if (sql.includes('FROM installed_devices d')) {
        return {
          rows: [{
            id: 38,
            clientId: 4,
            branchId: 2,
            contractId: 77,
            status: 'active',
            activatedAt: '2026-07-20T08:00:00.000Z',
            warrantyMonths: 12,
            warrantyVisits: 2,
            maintenancePlan: null,
          }],
        };
      }
      if (sql.includes('SELECT ($1::timestamptz')) {
        assert.deepEqual(params, ['2026-07-20T08:00:00.000Z', 180]);
        return { rows: [{ dueDate: '2027-01-16' }] };
      }
      if (sql.includes('FROM open_tasks')) {
        return { rows: [] };
      }
      if (sql.includes('INSERT INTO open_tasks')) {
        return { rows: [{ id: 901 }] };
      }
      if (sql.includes('INSERT INTO open_task_periodic_payload')) {
        assert.deepEqual(params, [901, 180, null, 12]);
        return { rows: [] };
      }
      if (sql.includes('FROM clients c')) {
        return { rows: [] };
      }
      if (sql.includes('UPDATE open_tasks') && sql.includes('client_snapshot')) {
        return { rows: [] };
      }
      throw new Error(`Unexpected SQL in test: ${sql}`);
    },
  };

  const result = await generateFirstPeriodicMaintenanceTask(
    db,
    38,
    12,
    { settings: enabledSettings },
  );

  assert.deepEqual(result, {
    createdTaskId: 901,
    skippedReason: null,
    dueDate: '2027-01-16',
    intervalDays: 180,
  });
  assert.equal(
    statements.some(({ sql }) => sql.includes('INSERT INTO open_task_periodic_payload')),
    true,
  );
  assert.equal(
    statements.some(({ sql }) => sql.includes('client_snapshot')),
    true,
  );
});

test('ownership transfer cancels upcoming periodic tasks for the previous customer and their visit tasks', async () => {
  const statements: Array<{ sql: string; params: any[] }> = [];
  const db = {
    async query(sql: string, params: any[] = []) {
      statements.push({ sql, params });
      if (sql.includes('FROM open_tasks ot') && sql.includes('FOR UPDATE OF ot')) {
        return {
          rows: [
            { id: 501, status: 'scheduled', hasExecutionAttempt: false },
            { id: 502, status: 'open', hasExecutionAttempt: false },
          ],
        };
      }
      if (sql.includes('UPDATE open_tasks')) {
        return { rows: [{ id: 501 }, { id: 502 }] };
      }
      return { rows: [] };
    },
  };

  const cancelledTaskIds = await cancelUpcomingPeriodicMaintenanceForTransfer(db, {
    installedDeviceId: 38,
    fromClientId: 4,
    toClientId: 9,
    performedByUserId: 12,
  });

  assert.deepEqual(cancelledTaskIds, [501, 502]);
  const lock = statements.find(({ sql }) => sql.includes('FOR UPDATE OF ot'));
  assert.ok(lock);
  assert.match(lock.sql, /ot\.device_id = \$1/);
  assert.match(lock.sql, /ot\.client_id = \$2/);
  assert.deepEqual(lock.params, [38, 4]);

  const taskUpdate = statements.find(({ sql }) => sql.includes('UPDATE open_tasks'));
  assert.ok(taskUpdate);
  assert.match(taskUpdate.sql, /status = 'cancelled'/);
  assert.deepEqual(taskUpdate.params[0], [501, 502]);
  assert.equal(taskUpdate.params[1], 'نقل حيازة الجهاز إلى زبون آخر');

  const visitTaskUpdate = statements.find(({ sql }) => sql.includes('UPDATE visit_tasks'));
  assert.ok(visitTaskUpdate);
  assert.deepEqual(visitTaskUpdate.params, [[501, 502]]);

  const audit = statements.find(({ sql }) => sql.includes('INSERT INTO task_activity_log'));
  assert.ok(audit);
  assert.deepEqual(audit.params, [
    [501, 502],
    ['scheduled', 'open'],
    12,
    'device_possession_transferred_to_client:9',
  ]);
});

test('ownership transfer is blocked while periodic maintenance is already executing', async () => {
  const statements: string[] = [];
  const db = {
    async query(sql: string) {
      statements.push(sql);
      return {
        rows: [{ id: 503, status: 'in_execution', hasExecutionAttempt: true }],
      };
    },
  };

  await assert.rejects(
    cancelUpcomingPeriodicMaintenanceForTransfer(db, {
      installedDeviceId: 38,
      fromClientId: 4,
      toClientId: 9,
      performedByUserId: 12,
    }),
    (error: any) =>
      error instanceof PeriodicMaintenanceTransferError
      && /#503/.test(error.message),
  );
  assert.equal(statements.length, 1);
});
