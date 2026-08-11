import assert from 'node:assert/strict';
import test from 'node:test';
import { deepestAdministrativeArea, reviewRequiredReasons } from './serviceRequestDisplay.js';

test('request table address uses one deepest administrative area', () => {
  assert.equal(deepestAdministrativeArea({
    branchResolutionGeoUnitName: 'باب شرقي',
    serviceAddress: {
      labels: { governorate: 'دمشق', city_or_area: 'دمشق القديمة' },
      detailedAddress: 'جانب المدرسة',
    },
  }), 'باب شرقي');

  assert.equal(deepestAdministrativeArea({
    serviceAddress: { labels: { governorate: 'ريف دمشق', city_or_area: 'دوما' } },
  }), 'دوما');
});

test('review reasons preserve all distinct persisted causes in Arabic', () => {
  assert.deepEqual(reviewRequiredReasons([
    { eventType: 'review_required_flag_set', eventPayload: { reason: 'submitter_unverified' } },
    { eventType: 'review_required_flag_set', eventPayload: { reason: 'branch_resolution_required', branch_resolution_status: 'ambiguous' } },
    { eventType: 'review_required_flag_set', eventPayload: { reason: 'submitter_unverified' } },
  ]), [
    'أُرسل الطلب من مستخدم أو جهاز غير موثّق ويحتاج تحققاً بشرياً.',
    'الموقع الإداري يطابق تغطية أكثر من فرع ويحتاج حسم الفرع يدوياً.',
  ]);
});
