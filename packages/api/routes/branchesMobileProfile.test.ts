import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  normalizeMapLocation,
  validateBranchImages,
  validateMobileProfile,
} from './branches.js';

test('branch image validation requires complete unique images and an in-gallery primary image', () => {
  const images = [{ id: 'main', name: 'واجهة الفرع', url: '/uploads/main.jpg' }];
  assert.equal(validateBranchImages(images, 'main'), null);
  assert.match(validateBranchImages(images, 'missing') ?? '', /الصورة الرئيسية/);
  assert.match(validateBranchImages([{ id: 'x', name: '', url: '/x' }], 'x') ?? '', /id و name و url/);
  assert.match(validateBranchImages([...images, ...images], 'main') ?? '', /فريدة/);
  assert.match(validateBranchImages(Array.from({ length: 21 }, (_, id) => ({ id: String(id), name: 'x', url: '/x' })), null) ?? '', /20/);
});

test('branch map validation is paired and bounded', () => {
  assert.deepEqual(normalizeMapLocation('', ''), { latitude: null, longitude: null, error: null });
  assert.equal(normalizeMapLocation('33.5', '36.2').error, null);
  assert.match(normalizeMapLocation('33.5', '').error ?? '', /معاً/);
  assert.match(normalizeMapLocation('91', '36.2').error ?? '', /-90 و 90/);
  assert.match(normalizeMapLocation('33.5', '181').error ?? '', /-180 و 180/);
});

test('mobile profile validation protects ordering, description, and atomic media updates', () => {
  assert.equal(validateMobileProfile({ images: [], primaryImageId: null, latitude: null, longitude: null }), null);
  assert.match(validateMobileProfile({ mobileDisplayOrder: -1 }, true) ?? '', /غير سالب/);
  assert.match(validateMobileProfile({ mobileVisible: 'true' }, true) ?? '', /قيمة منطقية/);
  assert.match(validateMobileProfile({ publicDescription: 'x'.repeat(2001) }, true) ?? '', /2000/);
  assert.match(validateMobileProfile({ images: [] }, true) ?? '', /معاً/);
});

test('branch publication and mobile ordering remain branches.manage-sensitive', () => {
  const source = readFileSync(new URL('./branches.ts', import.meta.url), 'utf8');
  const updateRoute = source.slice(source.indexOf("router.put('/:id'"));
  assert.match(updateRoute, /requirePermission\('branches\.edit', 'branches\.manage'\)/);
  assert.match(updateRoute, /req\.body\.mobileVisible !== undefined/);
  assert.match(updateRoute, /req\.body\.mobileDisplayOrder !== undefined/);
  assert.match(updateRoute, /hasBranchPermission\(req\.authContext!, 'branches\.manage', branchId\)/);
});
