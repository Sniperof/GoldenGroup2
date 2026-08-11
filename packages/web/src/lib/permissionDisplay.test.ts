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
});

test('labels client profile and task permission groups explicitly', () => {
  assert.equal(getPermissionSubmoduleLabel('profile_contacts'), 'جهات الاتصال');
  assert.equal(getPermissionSubmoduleLabel('profile_call_log'), 'سجل الاتصالات');
  assert.equal(getPermissionSubmoduleLabel('departments'), 'أقسام الفروع');
  assert.equal(getPermissionSubmoduleLabel('delivery'), 'التسليم');
  assert.equal(getPermissionSubmoduleLabel('installation'), 'التركيب');
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
