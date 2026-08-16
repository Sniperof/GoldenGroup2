import assert from 'node:assert/strict';
import test from 'node:test';
import { DAILY_IDENTITY_SETTING_BY_REQUEST_TYPE } from '../services/serviceRequests/mobileRequestQuotaSettings';
import { isEditableKey, normalizeSettingValue } from './systemSettingsValidation';

test('every mobile request identity ceiling is editable as a non-negative integer', () => {
  for (const key of Object.values(DAILY_IDENTITY_SETTING_BY_REQUEST_TYPE)) {
    assert.equal(isEditableKey(key), true, `${key} must be exposed by the settings API`);
    assert.equal(normalizeSettingValue(key, 0), '0');
    assert.equal(normalizeSettingValue(key, 7), '7');
    assert.throws(() => normalizeSettingValue(key, -1));
    assert.throws(() => normalizeSettingValue(key, 1.5));
  }
});

test('web login slots accept an explicit empty list to disable the policy', () => {
  assert.equal(normalizeSettingValue('web_login_allowed_team_slots', []), '');
  assert.equal(normalizeSettingValue('web_login_allowed_team_slots', ''), '');
});

test('web login slots are normalized, deduplicated, and stored in canonical order', () => {
  assert.equal(
    normalizeSettingValue('web_login_allowed_team_slots', ['technician', 'SUPERVISOR', 'technician']),
    'SUPERVISOR,TECHNICIAN',
  );
  assert.equal(
    normalizeSettingValue('web_login_allowed_team_slots', 'telemarketer, trainee'),
    'TRAINEE,TELEMARKETER',
  );
});

test('web login slots reject unknown, missing, and non-text values instead of disabling silently', () => {
  assert.throws(
    () => normalizeSettingValue('web_login_allowed_team_slots', ['SUPERVISOR', 'ADMIN']),
    /خانة فريق غير معروفة/,
  );
  assert.throws(
    () => normalizeSettingValue('web_login_allowed_team_slots', undefined),
    /قائمة خانات الفريق/,
  );
  assert.throws(
    () => normalizeSettingValue('web_login_allowed_team_slots', ['SUPERVISOR', 3]),
    /قيماً نصية فقط/,
  );
});
