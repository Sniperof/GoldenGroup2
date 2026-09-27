import assert from 'node:assert/strict';
import test from 'node:test';
import { legacyVisitOutcomeLabel, taskDecisionLabel } from './taskDecisionLabels.ts';

test('visit task result codes from the development database have Arabic labels', () => {
  const recorded: Array<[string, string]> = [
    ['device_activation', 'activated_successfully'],
    ['device_activation', 'device_issue'],
    ['device_delivery', 'delivered_successfully'],
    ['device_demo', 'cancelled'],
    ['device_demo', 'offer_presented'],
    ['device_demo', 'rescheduled'],
    ['device_disconnection', 'disconnected_successfully'],
    ['device_installation', 'installed_successfully'],
    ['device_retrieval', 'retrieved_successfully'],
    ['device_return', 'returned_successfully'],
    ['device_transfer', 'transferred_successfully'],
    ['emergency_maintenance', 'cancelled'],
    ['gift_delivery', 'delivered_successfully'],
    ['golden_warranty_card_delivery', 'delivered'],
    ['golden_warranty_offer', 'activated'],
    ['golden_warranty_offer', 'cancelled'],
    ['installment_collection', 'paid_full'],
    ['installment_collection', 'paid_partial'],
    ['periodic_maintenance', 'partially_performed'],
    ['periodic_maintenance', 'performed'],
  ];
  for (const [taskType, decision] of recorded) {
    assert.match(taskDecisionLabel(decision, taskType), /[\u0600-\u06FF]/, `${taskType}: ${decision}`);
    assert.notEqual(taskDecisionLabel(decision, taskType), 'نتيجة غير معرّفة');
  }
});

test('same code has the correct task-specific meaning', () => {
  assert.equal(taskDecisionLabel('delivered_successfully', 'device_delivery'), 'تم تسليم الجهاز بنجاح');
  assert.equal(taskDecisionLabel('delivered_successfully', 'gift_delivery'), 'تم تسليم الهدية');
  assert.equal(taskDecisionLabel('rescheduled', 'installment_collection'), 'تم تأجيل التحصيل');
  assert.equal(taskDecisionLabel('disconnected_successfully', 'device_disconnection'), 'تم فك الجهاز بنجاح');
});

test('unknown codes do not leak raw English identifiers into the UI', () => {
  assert.equal(taskDecisionLabel('future_code', 'device_demo'), 'نتيجة غير معرّفة');
  assert.equal(taskDecisionLabel(null), 'غير مسجلة بعد');
});

test('legacy visit outcomes are displayed in Arabic', () => {
  assert.equal(legacyVisitOutcomeLabel('Pending'), 'بانتظار التنفيذ');
  assert.equal(legacyVisitOutcomeLabel('Completed'), 'ناجحة');
  assert.equal(legacyVisitOutcomeLabel('Cancelled'), 'ملغاة');
});
