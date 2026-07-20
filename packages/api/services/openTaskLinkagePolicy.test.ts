import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getGoldenWarrantyDeliveryResultIssue,
  getOpenTaskLinkageIssue,
  isTelemarketingServiceRequestTaskType,
} from './openTaskLinkagePolicy.js';

test('telemarketing service requests only expose task types that do not need a direct link', () => {
  assert.equal(isTelemarketingServiceRequestTaskType('periodic_maintenance'), true);
  assert.equal(isTelemarketingServiceRequestTaskType('device_demo'), true);
  assert.equal(isTelemarketingServiceRequestTaskType('device_installation'), false);
  assert.equal(isTelemarketingServiceRequestTaskType('installment_collection'), false);
  assert.equal(isTelemarketingServiceRequestTaskType('golden_warranty_card_delivery'), false);
});

test('rejects a device task without its installed device', () => {
  assert.deepEqual(
    getOpenTaskLinkageIssue({ taskType: 'device_transfer', deviceId: null }),
    {
      code: 'DEVICE_REQUIRED',
      message: 'لا يمكن سحب المهمة لأنها غير مرتبطة بجهاز مثبت',
    },
  );
  assert.equal(getOpenTaskLinkageIssue({ taskType: 'device_transfer', deviceId: 7 }), null);
});

test('rejects installment, gift and warranty delivery tasks without their domain links', () => {
  assert.equal(
    getOpenTaskLinkageIssue({ taskType: 'installment_collection', installmentId: null })?.code,
    'INSTALLMENT_REQUIRED',
  );
  assert.equal(
    getOpenTaskLinkageIssue({ taskType: 'gift_delivery', hasGiftDeliveryLink: false })?.code,
    'GIFT_RECORD_REQUIRED',
  );
  assert.equal(
    getOpenTaskLinkageIssue({ taskType: 'golden_warranty_card_delivery', hasGoldenWarrantyLink: false })?.code,
    'GOLDEN_WARRANTY_REQUIRED',
  );
});

test('allows task types that have no mandatory operational link', () => {
  assert.equal(getOpenTaskLinkageIssue({ taskType: 'periodic_maintenance' }), null);
  assert.equal(getOpenTaskLinkageIssue({ taskType: 'emergency_maintenance' }), null);
});

test('prevents a false successful golden warranty card delivery', () => {
  assert.equal(
    getGoldenWarrantyDeliveryResultIssue('delivered', 0),
    'لا توجد كفالة ذهبية نشطة قابلة للتسليم - لم يتم تحديث أي بطاقة ضمان',
  );
  assert.equal(getGoldenWarrantyDeliveryResultIssue('delivered', 1), null);
  assert.equal(getGoldenWarrantyDeliveryResultIssue('rescheduled', 0), null);
});
