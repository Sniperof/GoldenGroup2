import test from 'node:test';
import assert from 'node:assert/strict';
import { materializeContractGiftPromises, resolveDraftGiftBeneficiary } from './giftPromises.js';

test('customer referrer identity is read from the persisted referrerId field', () => {
  const beneficiary = resolveDraftGiftBeneficiary(
    {
      customer_id: 1,
      customer_name: 'زبون العقد',
      contract_referrers: [
        {
          id: 'contract-referrer-row-1',
          referrerType: 'Client',
          referrerId: 33,
          referrerName: 'خالد العبدالله',
        },
      ],
    },
    {
      beneficiaryKind: 'customer_referrer',
      referrerId: 'contract-referrer-row-1',
    },
  );

  assert.deepEqual(beneficiary, {
    beneficiaryType: 'customer_referrer',
    beneficiaryClientId: 33,
    beneficiaryEmployeeId: null,
    beneficiaryName: 'خالد العبدالله',
  });
});

test('resolver never falls back to the first contract referrer when selection is stale', () => {
  assert.throws(
    () => resolveDraftGiftBeneficiary(
      {
        customer_id: 1,
        contract_referrers: [
          { id: 'known', referrerType: 'Client', referrerId: 33, referrerName: 'معروف' },
        ],
      },
      {
        beneficiaryKind: 'customer_referrer',
        referrerId: 'missing',
      },
    ),
    /غير موجود/,
  );
});

test('employee and personal contract referrers keep distinct beneficiary identities', () => {
  const contract = {
    customer_id: 1,
    contract_referrers: [
      { id: 'employee-row', referrerType: 'Employee', referrerId: 7, referrerName: 'موظف' },
      { id: 'personal-row', referrerType: 'Personal', referrerId: 901, referrerName: 'شخصي' },
    ],
  };

  assert.deepEqual(
    resolveDraftGiftBeneficiary(contract, {
      beneficiaryKind: 'employee_referrer',
      referrerId: 'employee-row',
    }),
    {
      beneficiaryType: 'employee_referrer',
      beneficiaryClientId: null,
      beneficiaryEmployeeId: 7,
      beneficiaryName: 'موظف',
    },
  );
  assert.deepEqual(
    resolveDraftGiftBeneficiary(contract, {
      beneficiaryKind: 'personal_referrer',
      referrerId: 'personal-row',
    }),
    {
      beneficiaryType: 'personal_referrer',
      beneficiaryClientId: null,
      beneficiaryEmployeeId: null,
      beneficiaryName: 'شخصي',
    },
  );
});

test('materialization is fail-fast and does not clear contract drafts after any promise fails', async () => {
  const statements: string[] = [];
  let insertCount = 0;
  const db = {
    async query(sql: string) {
      statements.push(sql);
      if (sql.includes('FROM contracts c')) {
        return {
          rows: [{
            customer_id: 11,
            customer_name: 'زبون',
            contract_number: 'C-9',
            branch_id: 2,
            service_branch_id: 2,
            contract_referrers: [],
            draft_gift_promises: [
              { giftDefinitionId: 1, beneficiaryKind: 'contract_customer', conditionLabel: 'الأول' },
              { giftDefinitionId: 2, beneficiaryKind: 'contract_customer', conditionLabel: 'الثاني' },
            ],
          }],
        };
      }
      if (sql.includes('FROM system_lists')) {
        return { rows: [{ id: 8, value: 'cash_contract', metadata: {} }] };
      }
      if (sql.includes('FROM gift_records')) return { rows: [] };
      if (sql.includes('INSERT INTO gift_records')) {
        insertCount += 1;
        if (insertCount === 2) throw new Error('second promise failed');
        return { rows: [{ id: 101 }] };
      }
      return { rows: [], rowCount: 1 };
    },
  };

  await assert.rejects(
    materializeContractGiftPromises(db as any, 9, 5),
    /second promise failed/,
  );
  assert.equal(
    statements.some(sql => sql.includes("draft_gift_promises = '[]'")),
    false,
  );
});
