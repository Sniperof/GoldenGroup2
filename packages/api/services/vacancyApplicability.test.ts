import assert from 'node:assert/strict';
import test from 'node:test';
import {
  findApplicableVacancyById,
  vacancyApplicabilitySql,
} from './vacancyApplicability.js';

test('uses one inclusive Open vacancy applicability predicate', () => {
  assert.equal(
    vacancyApplicabilitySql('jv'),
    "jv.status = 'Open' AND CURRENT_DATE BETWEEN jv.start_date AND jv.end_date",
  );
  assert.throws(() => vacancyApplicabilitySql('jv; DROP TABLE job_vacancies'));
});

test('loads only an applicable vacancy and can lock it for application creation', async () => {
  let sql = '';
  let params: any[] | undefined;
  const db = {
    async query(query: string, queryParams?: any[]) {
      sql = query;
      params = queryParams;
      return { rows: [{ id: 4, branchId: 6 }] };
    },
  };

  const vacancy = await findApplicableVacancyById(db, 4, { forUpdate: true });
  assert.deepEqual(vacancy, { id: 4, branchId: 6 });
  assert.match(sql, /status = 'Open'/);
  assert.match(sql, /CURRENT_DATE BETWEEN jv\.start_date AND jv\.end_date/);
  assert.match(sql, /FOR UPDATE/);
  assert.deepEqual(params, [4]);
});

test('returns null when the vacancy is outside the applicability window', async () => {
  const db = { async query() { return { rows: [] }; } };
  assert.equal(await findApplicableVacancyById(db, 99), null);
});
