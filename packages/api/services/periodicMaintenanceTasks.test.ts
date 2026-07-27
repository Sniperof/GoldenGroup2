import assert from 'node:assert/strict';
import test from 'node:test';
import {
  generateFirstPeriodicMaintenanceTask,
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
