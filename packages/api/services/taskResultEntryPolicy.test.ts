import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('emergency result mutations require the exact visit result context', () => {
  const route = readFileSync(
    new URL('../routes/emergencyResult.ts', import.meta.url),
    'utf8',
  );
  const guardedMutations = route.match(
    /router\.(?:put|post)\('[^']+', requirePermission\('[^']+'\), requireVisitResultContext/g,
  ) ?? [];

  assert.equal(guardedMutations.length, 8);
  assert.match(route, /const visitId = Number\(req\.query\.visitId\)/);
  assert.match(route, /const visitTaskId = Number\(req\.query\.visitTaskId\)/);
  assert.match(route, /AND vt\.id = \$2/);
  assert.match(route, /AND fv\.id = \$3/);
});

test('legacy direct emergency result submission is explicitly closed', () => {
  const route = readFileSync(
    new URL('../routes/openTasks.ts', import.meta.url),
    'utf8',
  );

  assert.match(route, /router\.post\('\/:id\/emergency-result'/);
  assert.match(route, /تُسجّل نتيجة الصيانة من داخل الزيارة المرتبطة فقط/);
});
