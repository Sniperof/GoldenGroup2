import test from 'node:test';
import assert from 'node:assert/strict';
import type { PoolClient } from 'pg';
import type { AuthContext } from '@golden-crm/shared';
import {
  changeDeviceDeliverySuspension,
  DeviceDeliverySuspensionError,
} from './deviceDeliverySuspension.js';

type Statement = { sql: string; params: unknown[] };

const context: AuthContext = {
  userId: 91,
  roleId: 6,
  isSuperAdmin: false,
  grants: [{ permission: 'installed_devices.delivery_suspension.manage', scope: 'BRANCH' }],
  allowedBranchIds: [7],
  actingBranchId: 7,
};

function mockClient(options: {
  status?: string;
  branchId?: number | null;
  tasks?: Array<{ id: number; status: string }>;
  visits?: Array<{ id: number; status: string }>;
} = {}) {
  const statements: Statement[] = [];
  const client = {
    async query(sql: string, params: unknown[] = []) {
      statements.push({ sql, params });
      if (sql.includes('FROM installed_devices') && sql.includes('FOR UPDATE')) {
        return {
          rows: [{
            id: 12,
            branchId: options.branchId === undefined ? 7 : options.branchId,
            contractId: 44,
            deviceSource: 'company_contract',
            status: options.status ?? 'pending_delivery',
          }],
        };
      }
      if (sql.includes('FROM open_tasks') && sql.includes('FOR UPDATE')) {
        return { rows: options.tasks ?? [{ id: 501, status: 'scheduled' }] };
      }
      if (sql.includes('FROM visit_tasks') && sql.includes('FOR UPDATE OF fv')) {
        return { rows: options.visits ?? [{ id: 601, status: 'scheduled' }] };
      }
      if (sql.includes('FROM system_lists')) {
        return { rows: [{ id: params[0] === 'visit_cancellation_reasons' ? 702 : 701 }] };
      }
      return { rows: [], rowCount: 1 };
    },
  } as unknown as PoolClient;
  return { client, statements };
}

test('suspend atomically cancels pending delivery work and audits the device transition', async () => {
  const { client, statements } = mockClient();
  const result = await changeDeviceDeliverySuspension(client, {
    deviceId: 12,
    action: 'suspend',
    notes: 'انقطع التواصل منذ مدة طويلة',
    authContext: context,
    actorRole: 'BRANCH_MANAGER',
  });

  assert.equal(result.status, 'delivery_suspended');
  assert.deepEqual(result.cancelledTaskIds, [501]);
  assert.deepEqual(result.cancelledVisitIds, [601]);
  assert.ok(statements.some(({ sql }) => sql.includes('UPDATE field_visits')));
  assert.ok(statements.some(({ sql }) => sql.includes('UPDATE visit_tasks')));
  assert.ok(statements.some(({ sql }) => sql.includes('UPDATE open_tasks')));
  assert.ok(statements.some(({ sql }) => sql.includes('INSERT INTO task_activity_log')));
  assert.ok(statements.some(({ sql, params }) => sql.includes('UPDATE installed_devices') && params[1] === 'delivery_suspended'));
  assert.ok(statements.some(({ sql }) => sql.includes('INSERT INTO audit_logs')));
  assert.equal(statements.some(({ sql }) => /contract_payment_entries|contract_installments|installment_collection/.test(sql)), false);
  assert.equal(statements.some(({ sql }) => /UPDATE contracts/i.test(sql)), false);
});

test('resume returns to pending delivery without creating or reopening a task', async () => {
  const { client, statements } = mockClient({ status: 'delivery_suspended', tasks: [], visits: [] });
  const result = await changeDeviceDeliverySuspension(client, {
    deviceId: 12,
    action: 'resume',
    notes: 'عاد التواصل وسيحدد الموعد لاحقاً',
    authContext: context,
    actorRole: 'BRANCH_MANAGER',
  });

  assert.equal(result.status, 'pending_delivery');
  assert.deepEqual(result.cancelledTaskIds, []);
  assert.equal(statements.some(({ sql }) => /INSERT INTO open_tasks/i.test(sql)), false);
  assert.equal(statements.some(({ sql }) => /UPDATE open_tasks/i.test(sql)), false);
});

test('suspend is blocked after the field visit starts', async () => {
  const { client } = mockClient({ visits: [{ id: 601, status: 'in_progress' }] });
  await assert.rejects(
    () => changeDeviceDeliverySuspension(client, {
      deviceId: 12,
      action: 'suspend',
      notes: 'غياب الزبون',
      authContext: context,
      actorRole: null,
    }),
    (error: unknown) => error instanceof DeviceDeliverySuspensionError
      && error.status === 409
      && error.code === 'delivery_visit_in_execution',
  );
});

test('wrong branch is denied by the device subject policy', async () => {
  const { client } = mockClient({ branchId: 8, tasks: [], visits: [] });
  await assert.rejects(
    () => changeDeviceDeliverySuspension(client, {
      deviceId: 12,
      action: 'suspend',
      notes: 'غياب الزبون',
      authContext: context,
      actorRole: null,
    }),
    (error: unknown) => error instanceof DeviceDeliverySuspensionError
      && error.status === 403
      && error.code === 'device_scope_forbidden',
  );
});

test('a branch-scoped grant is denied when the device has no branch subject', async () => {
  const { client } = mockClient({ branchId: null, tasks: [], visits: [] });
  await assert.rejects(
    () => changeDeviceDeliverySuspension(client, {
      deviceId: 12,
      action: 'suspend',
      notes: 'غياب الزبون',
      authContext: context,
      actorRole: null,
    }),
    (error: unknown) => error instanceof DeviceDeliverySuspensionError
      && error.status === 403
      && error.code === 'device_scope_forbidden',
  );
});

test('missing independent permission is denied', async () => {
  const { client } = mockClient({ tasks: [], visits: [] });
  await assert.rejects(
    () => changeDeviceDeliverySuspension(client, {
      deviceId: 12,
      action: 'suspend',
      notes: 'غياب الزبون',
      authContext: { ...context, grants: [] },
      actorRole: null,
    }),
    (error: unknown) => error instanceof DeviceDeliverySuspensionError
      && error.status === 403,
  );
});

test('super admin follows the explicit bypass path', async () => {
  const { client } = mockClient({ tasks: [], visits: [] });
  const result = await changeDeviceDeliverySuspension(client, {
    deviceId: 12,
    action: 'suspend',
    notes: 'غياب الزبون',
    authContext: { ...context, isSuperAdmin: true, grants: [], allowedBranchIds: [] },
    actorRole: 'SUPER_ADMIN',
  });
  assert.equal(result.status, 'delivery_suspended');
});

test('a global grant can manage a device in any branch', async () => {
  const { client } = mockClient({ branchId: 99, tasks: [], visits: [] });
  const result = await changeDeviceDeliverySuspension(client, {
    deviceId: 12,
    action: 'suspend',
    notes: 'غياب الزبون',
    authContext: {
      ...context,
      grants: [{ permission: 'installed_devices.delivery_suspension.manage', scope: 'GLOBAL' }],
      allowedBranchIds: [],
    },
    actorRole: 'OPERATIONS_MANAGER',
  });
  assert.equal(result.status, 'delivery_suspended');
});
