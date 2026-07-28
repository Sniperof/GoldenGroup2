import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GoldenWarrantyCardDeliveryError,
  cancelGoldenWarrantyCardLinks,
  deliverGoldenWarrantyCardLinks,
  lockEligibleGoldenWarrantyCards,
  parseGoldenWarrantyIds,
} from './goldenWarrantyCardDelivery.js';

test('golden warranty ids are normalized and deduplicated', () => {
  assert.deepEqual(parseGoldenWarrantyIds(['12', 12, 4, 0, 'bad']), [12, 4]);
});

test('creation rejects a warranty that already has an active delivery attempt', async () => {
  const db = {
    async query() {
      return {
        rows: [{
          warrantyId: 12,
          installedDeviceId: 8,
          warrantyType: 'golden',
          status: 'active',
          endDate: '2099-01-01',
          isCurrent: true,
          cardDeliveryTaskId: null,
          customerId: 5,
          branchId: 2,
          currentTaskId: 77,
          currentLinkStatus: 'active',
        }],
      };
    },
  };

  await assert.rejects(
    () => lockEligibleGoldenWarrantyCards(db as any, [12], 5, 2),
    (error: any) => (
      error instanceof GoldenWarrantyCardDeliveryError
      && error.status === 409
      && error.code === 'GOLDEN_WARRANTY_CARD_TASK_ACTIVE'
    ),
  );
});

test('delivery stamps the exact linked warranties then marks their links delivered', async () => {
  const statements: Array<{ sql: string; params: any[] }> = [];
  const db = {
    async query(sql: string, params: any[] = []) {
      statements.push({ sql, params });
      if (sql.includes('FROM open_task_golden_warranties link')) {
        return {
          rows: [
            { warrantyId: 12, linkStatus: 'active', cardDeliveryTaskId: null },
            { warrantyId: 13, linkStatus: 'active', cardDeliveryTaskId: null },
          ],
        };
      }
      if (sql.includes('UPDATE device_warranties')) return { rows: [], rowCount: 2 };
      if (sql.includes('UPDATE open_task_golden_warranties')) return { rows: [], rowCount: 2 };
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };

  const deliveredCount = await deliverGoldenWarrantyCardLinks(db as any, 91);
  assert.equal(deliveredCount, 2);
  const warrantyUpdate = statements.find(({ sql }) => sql.includes('UPDATE device_warranties'));
  assert.ok(warrantyUpdate);
  assert.deepEqual(warrantyUpdate.params, [91, [12, 13]]);
  assert.equal(statements.at(-1)?.sql.includes("link_status = 'delivered'"), true);
});

test('cancelled attempt releases the warranty for a later manual task', async () => {
  let capturedSql = '';
  const db = {
    async query(sql: string) {
      capturedSql = sql;
      return { rows: [], rowCount: 1 };
    },
  };

  assert.equal(await cancelGoldenWarrantyCardLinks(db as any, 91), 1);
  assert.match(capturedSql, /link_status = 'cancelled'/);
  assert.match(capturedSql, /link_status = 'active'/);
});
