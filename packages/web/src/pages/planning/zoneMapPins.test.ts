import assert from 'node:assert/strict';
import test from 'node:test';
import { fitPoints, pinHtml, type MapLine, type MapPin } from './zoneMapPins.js';

const pin = (id: number, lat: number, lng: number, extra: Partial<MapPin> = {}): MapPin =>
  ({ id, lat, lng, count: 1, title: '', accent: false, ...extra });
const line = (id: number, points: [number, number][], active: boolean): MapLine =>
  ({ id, points, label: '', active });

test('with a route picked, the view fits that route only, not every faint line', () => {
  const pts = fitPoints(
    [pin(1, 35.0, 36.0)],
    [line(1, [[35.0, 36.0], [35.1, 36.1]], true), line(2, [[33.5, 36.3], [33.6, 36.4]], false)],
  );
  assert.deepEqual(pts, [[35.0, 36.0], [35.1, 36.1]]);
});

test('without a picked route, every line counts', () => {
  const pts = fitPoints([], [line(1, [[35, 36]], false), line(2, [[33, 36]], false)]);
  assert.equal(pts.length, 2);
});

test('a pin on a station is one point, not two (two identical points fit to max zoom)', () => {
  assert.equal(fitPoints([pin(1, 35, 36)], [line(1, [[35, 36]], true)]).length, 1);
});

test('station pins show their route order; ghost pins carry no number', () => {
  assert.match(pinHtml(pin(1, 0, 0, { variant: 'station', label: '7' }), false), />7<\/div>$/);
  assert.match(pinHtml(pin(1, 0, 0, { variant: 'ghost' }), false), /dashed/);
  assert.match(pinHtml(pin(1, 0, 0, { count: 12 }), false), />12<\/div>$/);
});
