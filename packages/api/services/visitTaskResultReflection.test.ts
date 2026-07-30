import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyGoldenWarrantyCardDeliveryResult,
  normalizeDeviceDemoOfferLinkIds,
  normalizeCollectionPaymentPart,
  normalizePositiveDbId,
  persistOpenTaskPreOfferResult,
  resolveStoredDeviceDemoOfferSourceId,
} from './visitTaskResultReflection.js';

const openTaskPreOfferValues = [
  215,
  1,
  'cash',
  1,
  1_000_000,
  null,
  null,
  'SYP',
  null,
  null,
  7,
  null,
  29,
  'S260723072123CWJZ',
];

test('device-demo bigint link identifiers accept numeric strings without losing identity', () => {
  assert.equal(normalizePositiveDbId('80'), 80);
  assert.equal(normalizePositiveDbId(80), 80);
  assert.deepEqual(
    normalizeDeviceDemoOfferLinkIds({
      open_task_pre_offer_id: '80',
      source_customer_pre_offer_id: '29',
    }),
    {
      openTaskPreOfferId: 80,
      sourceCustomerPreOfferId: 29,
    },
  );
});

test('device-demo bigint link identifiers reject malformed or unsafe values', () => {
  assert.equal(normalizePositiveDbId('80.5'), null);
  assert.equal(normalizePositiveDbId('1e2'), null);
  assert.equal(normalizePositiveDbId('9007199254740993'), null);
  assert.throws(
    () => normalizeDeviceDemoOfferLinkIds({
      open_task_pre_offer_id: 'not-an-id',
      source_customer_pre_offer_id: null,
    }),
    /open_task_pre_offer_id غير صالح/,
  );
});

test('device-demo task-row identity recovers its bigint source and rejects a mismatched pair', () => {
  assert.equal(resolveStoredDeviceDemoOfferSourceId('29', null), 29);
  assert.equal(resolveStoredDeviceDemoOfferSourceId('29', 29), 29);
  assert.throws(
    () => resolveStoredDeviceDemoOfferSourceId('29', 30),
    /لا تطابق رابط عرض الزبون المحفوظ/,
  );
  assert.throws(
    () => resolveStoredDeviceDemoOfferSourceId(null, 29),
    /لا تطابق رابط عرض الزبون المحفوظ/,
  );
});

test('device-demo result updates an existing task pre-offer by its bigint id and never inserts', async () => {
  const statements: Array<{ sql: string; params: any[] | undefined }> = [];
  const db = {
    async query(sql: string, params?: any[]) {
      statements.push({ sql, params });
      return { rowCount: 1, rows: [] };
    },
  };

  const result = await persistOpenTaskPreOfferResult(db as any, {
    values: openTaskPreOfferValues,
    openTaskPreOfferId: normalizePositiveDbId('80'),
    sourceCustomerPreOfferId: null,
  });

  assert.equal(result, 'updated_by_id');
  assert.equal(statements.length, 1);
  assert.match(statements[0].sql, /UPDATE open_task_pre_offers/);
  assert.equal(statements[0].params?.[14], 80);
  assert.doesNotMatch(statements[0].sql, /INSERT INTO open_task_pre_offers/);
});

test('device-demo result updates a linked pre-offer by source id when no task-row id is supplied', async () => {
  const statements: Array<{ sql: string; params: any[] | undefined }> = [];
  const db = {
    async query(sql: string, params?: any[]) {
      statements.push({ sql, params });
      return { rowCount: 1, rows: [] };
    },
  };

  const result = await persistOpenTaskPreOfferResult(db as any, {
    values: openTaskPreOfferValues,
    openTaskPreOfferId: null,
    sourceCustomerPreOfferId: normalizePositiveDbId('29'),
  });

  assert.equal(result, 'updated_by_source');
  assert.equal(statements.length, 1);
  assert.match(statements[0].sql, /source_customer_pre_offer_id = \$15/);
  assert.equal(statements[0].params?.[14], 29);
});

test('device-demo result fails closed when a supplied pre-offer identity is stale', async () => {
  const statements: string[] = [];
  const db = {
    async query(sql: string) {
      statements.push(sql);
      return { rowCount: 0, rows: [] };
    },
  };

  await assert.rejects(
    persistOpenTaskPreOfferResult(db as any, {
      values: openTaskPreOfferValues,
      openTaskPreOfferId: 999,
      sourceCustomerPreOfferId: null,
    }),
    /غير موجود ضمن مهمة عرض الجهاز/,
  );

  assert.equal(statements.length, 1);
  assert.equal(statements.some(sql => sql.includes('INSERT INTO open_task_pre_offers')), false);
});

test('device-demo result inserts only when the offer has no prior identity', async () => {
  const statements: string[] = [];
  const db = {
    async query(sql: string) {
      statements.push(sql);
      return { rowCount: 1, rows: [] };
    },
  };

  const result = await persistOpenTaskPreOfferResult(db as any, {
    values: openTaskPreOfferValues,
    openTaskPreOfferId: null,
    sourceCustomerPreOfferId: null,
  });

  assert.equal(result, 'inserted');
  assert.equal(statements.length, 1);
  assert.match(statements[0], /INSERT INTO open_task_pre_offers/);
});

test('installment collection maps hand category to the cash instrument', () => {
  const normalized = normalizeCollectionPaymentPart({
    paymentCategory: 'hand',
    method: 'cash',
    amountValue: 25,
    currency: 'usd',
    exchangeRate: 15_000,
  });

  assert.equal(normalized.paymentCategory, 'hand');
  assert.equal(normalized.method, 'cash');
  assert.equal(normalized.currency, 'usd');
});

test('installment collection accepts an explicit transfer instrument', () => {
  const normalized = normalizeCollectionPaymentPart({
    paymentCategory: 'transfer',
    method: 'sham_cash',
    amountValue: 100_000,
    referenceNumber: 'TX-100',
  });

  assert.equal(normalized.paymentCategory, 'transfer');
  assert.equal(normalized.method, 'sham_cash');
  assert.equal(normalized.referenceNumber, 'TX-100');
});

test('installment collection keeps backward compatibility for legacy hand payloads', () => {
  const normalized = normalizeCollectionPaymentPart({ method: 'hand', amountValue: 100_000 });

  assert.equal(normalized.paymentCategory, 'hand');
  assert.equal(normalized.method, 'cash');
});

test('installment collection rejects a transfer category without a DB instrument', () => {
  assert.throws(
    () => normalizeCollectionPaymentPart({ method: 'transfer', amountValue: 100_000 }),
    /أداة الحوالة مطلوبة/,
  );
});

test('installment collection maps barter to the barter instrument', () => {
  const normalized = normalizeCollectionPaymentPart({
    paymentCategory: 'barter',
    method: 'barter',
    amountValue: 100_000,
  });

  assert.equal(normalized.paymentCategory, 'barter');
  assert.equal(normalized.method, 'barter');
});

test('golden warranty delivery does not complete a task without exact warranty links', async () => {
  const statements: string[] = [];
  const db = {
    async query(sql: string) {
      statements.push(sql);
      if (sql.includes('FROM visit_tasks vt')) {
        return {
          rows: [{
            id: 18,
            field_visit_id: 4,
            source_open_task_id: 90,
            task_type: 'golden_warranty_card_delivery',
            status: 'pending',
            visit_status: 'in_progress',
            device_id: null,
          }],
        };
      }
      if (sql.includes('INSERT INTO visit_task_results')) {
        return { rows: [{ id: 44 }] };
      }
      if (sql.includes('FROM open_task_golden_warranties link')) {
        return { rows: [] };
      }
      throw new Error(`Unexpected SQL in test: ${sql}`);
    },
  };

  await assert.rejects(
    applyGoldenWarrantyCardDeliveryResult(
      18,
      { final_decision: 'delivered', recipient_type: 'customer' },
      3,
      db as any,
    ),
    /لا ترتبط بأي كفالة محددة/,
  );

  assert.equal(statements.some(sql => sql.includes('UPDATE visit_tasks SET status')), false);
  assert.equal(statements.some(sql => sql.includes("UPDATE open_tasks SET status='completed'")), false);
});
