import assert from 'node:assert/strict';
import test from 'node:test';
import { ReferenceValueError, resolveReferenceValueForWrite } from './referenceValueService.js';

function dbWith(rows: any[]) {
  return {
    queries: [] as Array<{ text: string; params?: any[] }>,
    async query(text: string, params?: any[]) {
      this.queries.push({ text, params });
      return { rows };
    },
  };
}

test('empty occupation resolves to null and an active catalog value is returned unchanged', async () => {
  const emptyDb = dbWith([]);
  assert.equal(await resolveReferenceValueForWrite(emptyDb, 'occupation', '   '), null);
  assert.equal(emptyDb.queries.length, 0);

  const activeDb = dbWith([{ value: 'مهندس' }]);
  assert.equal(await resolveReferenceValueForWrite(activeDb, 'occupation', ' مهندس '), 'مهندس');
  assert.deepEqual(activeDb.queries[0]?.params, ['occupation', 'مهندس']);
});

test('unknown or inactive new occupation is rejected', async () => {
  const db = dbWith([]);
  await assert.rejects(
    () => resolveReferenceValueForWrite(db, 'occupation', 'قيمة ملفقة'),
    (error: unknown) => error instanceof ReferenceValueError && error.status === 400,
  );
});

test('an unchanged historical occupation remains readable and writable without reactivation', async () => {
  const db = dbWith([]);
  assert.equal(
    await resolveReferenceValueForWrite(db, 'occupation', 'مهنة تاريخية', {
      currentValue: 'مهنة تاريخية',
    }),
    'مهنة تاريخية',
  );
  assert.equal(db.queries.length, 0);
});
