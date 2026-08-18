import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getPermissionModuleLabel,
  getPermissionSubmoduleLabel,
} from './permissionDisplay.js';

test('labels the request and app-account permission modules explicitly', () => {
  assert.equal(getPermissionModuleLabel('planning'), 'تخطيط عمل الفرع');
  assert.equal(getPermissionModuleLabel('water_check'), 'طلبات فحص المياه');
  assert.equal(getPermissionModuleLabel('account_requests'), 'طلبات إنشاء الحساب');
  assert.equal(getPermissionModuleLabel('app_accounts'), 'حسابات التطبيق');
  assert.equal(getPermissionModuleLabel('name_nomination'), 'طلبات ترشيح الأسماء');
  assert.equal(getPermissionModuleLabel('agent_license'), 'طلبات ترخيص الوكلاء');
  assert.equal(getPermissionModuleLabel('complaints'), 'إدارة الشكاوى');
});

test('labels client profile and task permission groups explicitly', () => {
  assert.equal(getPermissionSubmoduleLabel('profile_contacts'), 'جهات الاتصال');
  assert.equal(getPermissionSubmoduleLabel('profile_call_log'), 'سجل الاتصالات');
  assert.equal(getPermissionSubmoduleLabel('departments'), 'أقسام الفروع');
  assert.equal(getPermissionSubmoduleLabel('delivery'), 'التسليم');
  assert.equal(getPermissionSubmoduleLabel('installation'), 'التركيب');
});

test('labels complaint permission groups with functional Arabic titles', () => {
  assert.equal(getPermissionSubmoduleLabel('complaints'), 'سجلات الشكاوى');
  assert.equal(getPermissionSubmoduleLabel('attachments'), 'مرفقات الشكاوى');
  assert.equal(getPermissionSubmoduleLabel('audit'), 'سجل تدقيق الشكاوى');
  assert.equal(getPermissionSubmoduleLabel('links'), 'ربط الشكاوى بالسجلات');
  assert.equal(getPermissionSubmoduleLabel('notes'), 'الملاحظات الداخلية');
  assert.equal(getPermissionSubmoduleLabel('reports'), 'تقارير الشكاوى');
  assert.equal(getPermissionSubmoduleLabel('settings'), 'إعدادات الشكاوى');
  assert.equal(getPermissionSubmoduleLabel('updates'), 'التحديثات الظاهرة للمشتكي');
  assert.equal(getPermissionSubmoduleLabel('workflow'), 'دورة معالجة الشكوى');
});

test('unknown identifiers keep unique, inspectable fallback labels', () => {
  assert.equal(
    getPermissionModuleLabel('future_module'),
    'قسم صلاحيات (future module)',
  );
  assert.equal(
    getPermissionSubmoduleLabel('future_group'),
    'مجموعة صلاحيات (future group)',
  );
  assert.notEqual(
    getPermissionSubmoduleLabel('future_group'),
    getPermissionSubmoduleLabel('another_group'),
  );
});
