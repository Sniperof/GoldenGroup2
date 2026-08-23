import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mapPublicBanners,
  normalizeBannerInput,
  type PublicBannerRow,
} from './appHomeBanners.js';

function row(overrides: Partial<PublicBannerRow> = {}): PublicBannerRow {
  return {
    id: '1',
    titleAr: 'عرض',
    imageUrl: '/uploads/a.webp',
    displaySeconds: 5,
    targetKind: 'none',
    targetDeviceModelId: null,
    targetRequestType: null,
    targetUrl: null,
    audience: 'all',
    ...overrides,
  };
}

// ── normalizeBannerInput ────────────────────────────────────────────────────

test('accepts a minimal untargeted banner', () => {
  const input = normalizeBannerInput({ imageUrl: '/uploads/a.webp' });
  assert.equal(input.targetKind, 'none');
  assert.equal(input.displaySeconds, 5);
  assert.equal(input.audience, 'all');
  assert.equal(input.isActive, true);
  assert.equal(input.titleAr, null);
});

test('rejects an image URL that is not a server-hosted upload', () => {
  for (const imageUrl of [
    'https://evil.example/banner.png',
    '/uploads/../../etc/passwd',
    '/uploads/a b.png',
    '',
  ]) {
    assert.throws(() => normalizeBannerInput({ imageUrl }), /./, `accepted ${imageUrl}`);
  }
});

test('keeps only the target columns matching the target kind', () => {
  const device = normalizeBannerInput({
    imageUrl: '/uploads/a.webp',
    targetKind: 'device',
    targetDeviceModelId: 7,
    // Stale values from a previous selection in the admin form must not persist.
    targetRequestType: 'emergency_maintenance',
    targetUrl: 'https://example.com',
  });
  assert.equal(device.targetDeviceModelId, 7);
  assert.equal(device.targetRequestType, null);
  assert.equal(device.targetUrl, null);

  const request = normalizeBannerInput({
    imageUrl: '/uploads/a.webp',
    targetKind: 'service_request',
    targetRequestType: 'emergency_maintenance',
    targetDeviceModelId: 7,
  });
  assert.equal(request.targetRequestType, 'emergency_maintenance');
  assert.equal(request.targetDeviceModelId, null);
});

test('requires the value that matches the declared target kind', () => {
  const image = '/uploads/a.webp';
  assert.throws(() => normalizeBannerInput({ imageUrl: image, targetKind: 'device' }));
  assert.throws(() => normalizeBannerInput({ imageUrl: image, targetKind: 'service_request' }));
  assert.throws(() => normalizeBannerInput({ imageUrl: image, targetKind: 'external_url' }));
  assert.throws(() => normalizeBannerInput({ imageUrl: image, targetKind: 'installed_device' }));
});

test('external targets must be https', () => {
  const image = '/uploads/a.webp';
  assert.throws(() => normalizeBannerInput({
    imageUrl: image, targetKind: 'external_url', targetUrl: 'http://example.com',
  }));
  assert.equal(
    normalizeBannerInput({
      imageUrl: image, targetKind: 'external_url', targetUrl: 'https://example.com/x',
    }).targetUrl,
    'https://example.com/x',
  );
});

test('bounds display seconds', () => {
  const image = '/uploads/a.webp';
  assert.throws(() => normalizeBannerInput({ imageUrl: image, displaySeconds: 1 }));
  assert.throws(() => normalizeBannerInput({ imageUrl: image, displaySeconds: 61 }));
  assert.throws(() => normalizeBannerInput({ imageUrl: image, displaySeconds: 4.5 }));
  assert.equal(normalizeBannerInput({ imageUrl: image, displaySeconds: 12 }).displaySeconds, 12);
});

test('pins audience to "all" and rejects any other value', () => {
  const image = '/uploads/a.webp';
  assert.equal(normalizeBannerInput({ imageUrl: image }).audience, 'all');
  assert.equal(normalizeBannerInput({ imageUrl: image, audience: 'all' }).audience, 'all');
  // 'customers' / 'guests' are still valid DB values, but the admin surface is
  // locked to 'all', so a caller sending them is on a stale contract.
  assert.throws(() => normalizeBannerInput({ imageUrl: image, audience: 'customers' }));
  assert.throws(() => normalizeBannerInput({ imageUrl: image, audience: 'guests' }));
});

test('rejects a publish window that ends before it starts', () => {
  assert.throws(() => normalizeBannerInput({
    imageUrl: '/uploads/a.webp',
    startsAt: '2026-09-01T00:00:00Z',
    endsAt: '2026-08-01T00:00:00Z',
  }));
  assert.throws(() => normalizeBannerInput({ imageUrl: '/uploads/a.webp', startsAt: 'soon' }));
});

// ── mapPublicBanners ────────────────────────────────────────────────────────

test('audience filter splits guests from authenticated customers', () => {
  const rows = [
    row({ id: '1', audience: 'all' }),
    row({ id: '2', audience: 'guests' }),
    row({ id: '3', audience: 'customers' }),
  ];
  assert.deepEqual(mapPublicBanners(rows, false, new Map()).map((b) => b.id), [1, 2]);
  assert.deepEqual(mapPublicBanners(rows, true, new Map()).map((b) => b.id), [1, 3]);
});

test('drops a banner whose request type is no longer executable', () => {
  const rows = [
    row({ id: '1', targetKind: 'service_request', targetRequestType: 'emergency_maintenance' }),
    row({ id: '2', targetKind: 'service_request', targetRequestType: 'retired_type' }),
  ];
  const labels = new Map([['emergency_maintenance', 'صيانة طارئة']]);
  const result = mapPublicBanners(rows, true, labels);
  assert.deepEqual(result.map((b) => b.id), [1]);
  assert.deepEqual(result[0].target, {
    kind: 'service_request',
    requestType: 'emergency_maintenance',
    labelAr: 'صيانة طارئة',
  });
});

test('device target carries the catalog id the app can open', () => {
  const [banner] = mapPublicBanners(
    [row({ targetKind: 'device', targetDeviceModelId: 42 })],
    true,
    new Map(),
  );
  assert.deepEqual(banner.target, { kind: 'device', deviceId: 42 });
});

test('projects ids as numbers regardless of driver bigint strings', () => {
  const [banner] = mapPublicBanners([row({ id: '900719925474' })], true, new Map());
  assert.equal(banner.id, 900719925474);
});
