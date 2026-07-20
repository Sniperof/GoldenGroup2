import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyGoldenWarrantyCardDeliveryResult,
  normalizeCollectionPaymentPart,
} from './visitTaskResultReflection.js';

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

test('golden warranty delivery does not complete a task when no warranty is updated', async () => {
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
      if (sql.includes('SELECT installed_device_id FROM open_task_installed_devices')) {
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
    /لم يتم تحديث أي بطاقة ضمان/,
  );

  assert.equal(statements.some(sql => sql.includes('UPDATE visit_tasks SET status')), false);
  assert.equal(statements.some(sql => sql.includes("UPDATE open_tasks SET status='completed'")), false);
});
