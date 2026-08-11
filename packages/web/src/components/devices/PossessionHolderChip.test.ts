import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('possession surfaces pass the API-resolved holder name to the chip', () => {
  const timeline = readFileSync(
    new URL('./DevicePossessionTimeline.tsx', import.meta.url),
    'utf8',
  );
  const currentSection = readFileSync(
    new URL('../../pages/devices/sections/CurrentHolderSection.tsx', import.meta.url),
    'utf8',
  );
  const profile = readFileSync(
    new URL('../../pages/devices/DeviceProfilePage.tsx', import.meta.url),
    'utf8',
  );
  const devicesTab = readFileSync(
    new URL('../../pages/clientProfile/DevicesTab.tsx', import.meta.url),
    'utf8',
  );

  assert.match(timeline, /holderName=\{e\.holderName\}/);
  assert.match(currentSection, /holderName=\{currentPossession\.holderName\}/);
  assert.match(profile, /holderName=\{currentPossession\.holderName\}/);
  assert.match(devicesTab, /holderName=\{current\?\.holderName\}/);
  assert.match(profile, /hasPermission\('installed_devices\.possession\.view'\)/);
  assert.match(devicesTab, /hasPermission\('installed_devices\.possession\.view'\)/);
});

test('external device possession reason has a localized display label', () => {
  const chip = readFileSync(
    new URL('./PossessionHolderChip.tsx', import.meta.url),
    'utf8',
  );

  assert.match(chip, /external_registration:\s*'تسجيل جهاز خارجي'/);
});
