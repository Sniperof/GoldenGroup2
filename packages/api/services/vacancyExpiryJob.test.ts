import assert from 'node:assert/strict';
import test from 'node:test';
import { runVacancyExpiryOnce } from './vacancyExpiryJob.js';

test('auto-closes only expired Open vacancies and writes a system audit row', async () => {
  let sql = '';
  const db = {
    async query(query: string) {
      sql = query;
      return { rows: [{ closed: 3 }] };
    },
  };

  assert.deepEqual(await runVacancyExpiryOnce(db), { closed: 3 });
  assert.match(sql, /status = 'Open'/);
  assert.match(sql, /end_date < CURRENT_DATE/);
  assert.match(sql, /SET status = 'Closed'/);
  assert.match(sql, /Vacancy Auto-Closed/);
  assert.match(sql, /performed_by_role/);
});
