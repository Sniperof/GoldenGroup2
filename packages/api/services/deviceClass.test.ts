import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyDevice, classifyUserAgent } from './deviceClass.js';

const UA = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  androidPhone: 'Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Mobile Safari/537.36',
  androidTablet: 'Mozilla/5.0 (Linux; Android 13; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36',
  oldIpad: 'Mozilla/5.0 (iPad; CPU OS 12_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1 Mobile/15E148 Safari/604.1',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36',
};

test('phones are recognised from the User-Agent alone', () => {
  assert.equal(classifyUserAgent(UA.iphone), 'mobile');
  assert.equal(classifyUserAgent(UA.androidPhone), 'mobile');
});

test('Android tablets are the Android UAs without the Mobile token', () => {
  assert.equal(classifyUserAgent(UA.androidTablet), 'tablet');
});

test('an iPad that still says "iPad" is recognised server-side', () => {
  assert.equal(classifyUserAgent(UA.oldIpad), 'tablet');
});

test('desktops other than Mac are unambiguous', () => {
  assert.equal(classifyUserAgent(UA.windows), 'desktop');
});

test('a Mac UA is ambiguous — it may be an iPadOS 13+ iPad', () => {
  // The whole reason the client hint exists.
  assert.equal(classifyUserAgent(UA.mac), null);
});

test('the client hint resolves the Mac-or-iPad case in both directions', () => {
  assert.deepEqual(
    classifyDevice({ userAgent: UA.mac, deviceClassHint: 'tablet' }),
    { deviceClass: 'tablet', source: 'client_hint' },
  );
  assert.deepEqual(
    classifyDevice({ userAgent: UA.mac, deviceClassHint: 'desktop' }),
    { deviceClass: 'desktop', source: 'client_hint' },
  );
});

test('the hint can never override an unambiguous User-Agent', () => {
  // Otherwise the header would be a way to GAIN access, not just disambiguate.
  for (const ua of [UA.iphone, UA.androidPhone, UA.androidTablet, UA.oldIpad]) {
    const result = classifyDevice({ userAgent: ua, deviceClassHint: 'desktop' });
    assert.equal(result.source, 'user_agent');
    assert.notEqual(result.deviceClass, 'desktop');
  }
});

test('a missing or junk hint on an ambiguous UA falls back to desktop', () => {
  // The known, accepted bypass: fail-open beats locking everyone out at rollout.
  for (const hint of [null, '', 'phone', 'TRUE', undefined as unknown as string]) {
    assert.deepEqual(
      classifyDevice({ userAgent: UA.mac, deviceClassHint: hint }),
      { deviceClass: 'desktop', source: 'fallback' },
    );
  }
});

test('an absent User-Agent falls back to desktop', () => {
  assert.equal(classifyDevice({ userAgent: null, deviceClassHint: null }).deviceClass, 'desktop');
  assert.equal(classifyDevice({ userAgent: '', deviceClassHint: 'mobile' }).deviceClass, 'mobile');
});
