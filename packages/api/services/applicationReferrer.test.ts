import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { insertReferrer } from '../repositories/applicationRepository.js';
import {
  APPLICATION_SUBMISSION_FAILED_MESSAGE,
  applicationSubmissionErrorResponse,
} from './applicationSubmissionError.js';

test('the schema migration makes referrer mobile_number nullable', () => {
  const migrationUrl = new URL('../../../migrations/377_referrer_mobile_optional.sql', import.meta.url);
  const migration = readFileSync(migrationUrl, 'utf8');

  assert.match(
    migration,
    /ALTER\s+COLUMN\s+mobile_number\s+DROP\s+NOT\s+NULL/i,
  );
});

test('shared referrer writer stores null when mobileNumber is omitted', async () => {
  let sql = '';
  let params: unknown[] = [];
  const client = {
    async query(query: string, values?: unknown[]) {
      sql = query;
      params = values ?? [];
      return { rows: [{ id: 71 }] };
    },
  };

  const id = await insertReferrer(client as any, {
    type: 'Personal',
    fullName: '  وسيط شخصي  ',
  });

  assert.equal(id, 71);
  assert.match(sql, /INSERT INTO referrers/);
  assert.equal(params[0], 'Personal');
  assert.equal(params[3], 'وسيط شخصي');
  assert.equal(params[5], null);
});

test('shared referrer writer preserves entity links and an optional supplied phone', async () => {
  const writes: unknown[][] = [];
  const client = {
    async query(query: string, values?: unknown[]) {
      if (/FROM employees/i.test(query)) {
        return {
          rows: [{
            id: 12,
            name: 'الاسم القانوني للموظف',
            employeeNumber: 102,
          }],
        };
      }
      writes.push(values ?? []);
      return { rows: [{ id: writes.length }] };
    },
  };

  await insertReferrer(client as any, {
    type: 'Employee',
    employeeId: 12,
    referralEntityId: 12,
    fullName: 'موظف وسيط',
    mobileNumber: '0999999999',
  });
  await insertReferrer(client as any, {
    type: 'Customer',
    referralEntityId: 34,
    fullName: 'عميل وسيط',
  });

  assert.deepEqual(writes[0].slice(0, 6), [
    'Employee', 12, 12, 'الاسم القانوني للموظف', null, '0999999999',
  ]);
  assert.deepEqual(writes[1].slice(0, 6), [
    'Client', null, 34, 'عميل وسيط', null, null,
  ]);
});

test('shared referrer writer rejects a display employee number used as the foreign key', async () => {
  let insertAttempted = false;
  const client = {
    async query(query: string) {
      if (/FROM employees/i.test(query)) {
        return { rows: [{ id: 21, name: 'موظف وسيط', employeeNumber: 102 }] };
      }
      insertAttempted = true;
      return { rows: [{ id: 1 }] };
    },
  };

  await assert.rejects(
    insertReferrer(client as any, {
      type: 'Employee',
      employeeId: 21,
      referralEntityId: 102,
      fullName: 'اسم قادم من العميل',
    }),
    (error: any) => {
      assert.equal(error.status, 400);
      assert.equal(error.payload?.code, 'INVALID_EMPLOYEE_REFERRER');
      return true;
    },
  );
  assert.equal(insertAttempted, false);
});

test('shared referrer writer rejects an employee id that does not exist', async () => {
  let insertAttempted = false;
  const client = {
    async query(query: string) {
      if (/FROM employees/i.test(query)) return { rows: [] };
      insertAttempted = true;
      return { rows: [{ id: 1 }] };
    },
  };

  await assert.rejects(
    insertReferrer(client as any, {
      type: 'Employee',
      employeeId: 9999,
      referralEntityId: 9999,
    }),
    (error: any) => {
      assert.equal(error.status, 400);
      assert.equal(error.payload?.code, 'INVALID_EMPLOYEE_REFERRER');
      return true;
    },
  );
  assert.equal(insertAttempted, false);
});

test('application submission errors preserve known validation and hide database details', () => {
  assert.deepEqual(
    applicationSubmissionErrorResponse({
      status: 409,
      payload: { error: 'الشاغر غير متاح', code: 'VACANCY_NOT_APPLICABLE' },
    }),
    {
      status: 409,
      payload: { error: 'الشاغر غير متاح', code: 'VACANCY_NOT_APPLICABLE' },
    },
  );

  const rawDatabaseMessage = 'null value in column "mobile_number" violates not-null constraint';
  const response = applicationSubmissionErrorResponse(new Error(rawDatabaseMessage));
  assert.deepEqual(response, {
    status: 500,
    payload: { error: APPLICATION_SUBMISSION_FAILED_MESSAGE },
  });
  assert.doesNotMatch(JSON.stringify(response), /mobile_number|not-null/i);
});
