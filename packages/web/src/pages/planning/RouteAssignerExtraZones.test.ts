import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('./RouteAssigner.tsx', import.meta.url), 'utf8');

test('additional work-scope stations allow subareas and neighborhoods', () => {
  assert.match(source, /label="أضف ناحية أو حي"/);
  assert.match(source, /minSelectableLevel=\{3\}/);
  assert.match(source, /ابحث عن ناحية أو حي لإضافته/);
  assert.doesNotMatch(source, /unit\.level === 4 && !finalZoneIds/);
});

test('additional zone search retains parent levels for complete breadcrumbs', () => {
  assert.match(source, /unit\.level < 3/);
  assert.match(source, /geoUnits=\{extraZoneGeoUnits\}/);
});
