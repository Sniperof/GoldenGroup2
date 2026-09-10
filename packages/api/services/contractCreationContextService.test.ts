import assert from 'node:assert/strict';
import test from 'node:test';
import type { AuthContext } from '@golden-crm/shared';
import {
  bindContractInputToExistingProvenance,
  bindContractInputToVisitContext,
  contractSourceUniquenessConflictPayload,
  ContractCreationContextError,
  loadContractCreationContext,
} from './contractCreationContextService.js';

const authContext: AuthContext = {
  userId: 7,
  roleId: 2,
  isSuperAdmin: false,
  actingBranchId: 6,
  allowedBranchIds: [6],
  grants: [{ permission: 'contracts.create', scope: 'BRANCH' }],
};

const visitRow = {
  id: 501,
  branch_id: 6,
  client_id: 901,
  status: 'completed',
  team_responsible_user_id: 7,
  team_snapshot: { supervisorEmployeeId: 31 },
  reassigned_supervisor_id: null,
  reassigned_technician_id: null,
  reassigned_trainee_id: null,
  client_name: 'زبون تجريبي',
  client_mobile: '0999000000',
  client_referrers: [],
};

const taskRow = {
  visit_task_id: 601,
  source_open_task_id: 701,
  visit_task_status: 'completed',
  final_decision: 'offer_presented',
};

function dbFixture(options: {
  visits?: any[];
  tasks?: any[];
  offers?: any[];
} = {}) {
  const calls: string[] = [];
  return {
    calls,
    async query(text: string) {
      calls.push(text);
      if (text.includes('FROM field_visits')) return { rows: options.visits ?? [visitRow] };
      if (text.includes('FROM visit_tasks')) return { rows: options.tasks ?? [taskRow] };
      if (text.includes('FROM open_task_pre_offers')) return {
        rows: options.offers ?? [{ id: 801, contractId: null, saleReferenceNumber: 'S-801' }],
      };
      throw new Error(`Unexpected query: ${text}`);
    },
  };
}

test('returns fixed visit, customer, task, and only unlinked accepted offers', async () => {
  const db = dbFixture({
    offers: [
      { id: 801, contractId: null, saleReferenceNumber: 'S-801' },
      { id: 802, contractId: 1002, contractNumber: 'C-1002', saleReferenceNumber: 'S-802' },
    ],
  });

  const result = await loadContractCreationContext(db, authContext, 31, 501);

  assert.equal(result.customer.id, 901);
  assert.equal(result.deviceDemoTask.sourceOpenTaskId, 701);
  assert.equal(result.saleOwnerId, 31);
  assert.equal(result.acceptedOfferCount, 2);
  assert.deepEqual(result.eligibleOffers.map(offer => offer.id), [801]);
});

test('binds authoritative visit provenance while keeping offer selection optional', async () => {
  const context = await loadContractCreationContext(dbFixture(), authContext, 31, 501);

  assert.deepEqual(
    bindContractInputToVisitContext({ contractNumber: 'C-1' }, context),
    {
      contractNumber: 'C-1',
      branchId: 6,
      customerId: 901,
      customerName: 'زبون تجريبي',
      sourceVisitId: 501,
      sourceOpenTaskId: 701,
      sourceTaskOfferId: null,
      saleReferenceNumber: null,
      saleOwnerId: 31,
    },
  );

  const linked = bindContractInputToVisitContext({ sourceTaskOfferId: 801 }, context);
  assert.equal(linked.sourceTaskOfferId, 801);
  assert.equal(linked.saleReferenceNumber, 'S-801');
});

test('rejects spoofed visit provenance and an ineligible offer', async () => {
  const context = await loadContractCreationContext(dbFixture(), authContext, 31, 501);

  for (const [input, code] of [
    [{ customerId: 999 }, 'CONTEXT_CUSTOMER_MISMATCH'],
    [{ branchId: 9 }, 'CONTEXT_BRANCH_MISMATCH'],
    [{ sourceOpenTaskId: 999 }, 'CONTEXT_TASK_MISMATCH'],
    [{ saleOwnerId: 99 }, 'CONTEXT_SALE_OWNER_MISMATCH'],
    [{ sourceTaskOfferId: 999 }, 'SOURCE_OFFER_NOT_ELIGIBLE'],
    [{ sourceTaskOfferId: 801, saleReferenceNumber: 'S-SPOOFED' }, 'CONTEXT_SALE_REFERENCE_MISMATCH'],
  ] as const) {
    assert.throws(
      () => bindContractInputToVisitContext(input, context),
      (error: unknown) => error instanceof ContractCreationContextError && error.code === code,
    );
  }
});

test('denies an actor who is neither assigned nor a visit manager before loading task data', async () => {
  const db = dbFixture();

  await assert.rejects(
    loadContractCreationContext(db, authContext, 99, 501),
    (error: unknown) => error instanceof ContractCreationContextError
      && error.status === 403
      && error.code === 'ASSIGNMENT_FORBIDDEN',
  );
  assert.equal(db.calls.length, 1);
});

test('requires exactly one device-demo task with an offer-presented result', async () => {
  await assert.rejects(
    loadContractCreationContext(dbFixture({ tasks: [] }), authContext, 31, 501),
    (error: unknown) => error instanceof ContractCreationContextError
      && error.code === 'DEVICE_DEMO_TASK_CARDINALITY_INVALID',
  );
  await assert.rejects(
    loadContractCreationContext(
      dbFixture({ tasks: [{ ...taskRow, final_decision: 'cancelled' }] }),
      authContext,
      31,
      501,
    ),
    (error: unknown) => error instanceof ContractCreationContextError
      && error.code === 'DEVICE_DEMO_RESULT_NOT_ELIGIBLE',
  );
});

test('requires at least one accepted offer but does not require an eligible unlinked offer', async () => {
  await assert.rejects(
    loadContractCreationContext(dbFixture({ offers: [] }), authContext, 31, 501),
    (error: unknown) => error instanceof ContractCreationContextError
      && error.code === 'ACCEPTED_OFFER_REQUIRED',
  );

  const result = await loadContractCreationContext(
    dbFixture({ offers: [{ id: 801, contractId: 1001, contractNumber: 'C-1001' }] }),
    authContext,
    31,
    501,
  );
  assert.equal(result.acceptedOfferCount, 1);
  assert.deepEqual(result.eligibleOffers, []);
});

test('freezes source provenance and visit identity on visit-bound drafts', () => {
  const existing = {
    customerId: 901,
    customerName: 'زبون الزيارة',
    sourceVisit: 'زيارة عرض',
    sourceVisitId: 501,
    sourceOpenTaskId: 701,
    sourceTaskOfferId: 801,
    saleReferenceNumber: 'S-801',
    saleOwnerId: 31,
  };

  const bound = bindContractInputToExistingProvenance({ finalPrice: 100 }, existing);
  assert.equal(bound.finalPrice, 100);
  assert.equal(bound.customerId, 901);
  assert.equal(bound.sourceVisitId, 501);
  assert.equal(bound.sourceTaskOfferId, 801);
  assert.equal(bound.saleOwnerId, 31);

  for (const input of [
    { sourceVisitId: null },
    { sourceOpenTaskId: 999 },
    { sourceTaskOfferId: 999 },
    { saleReferenceNumber: 'S-OTHER' },
    { customerId: 999 },
    { customerName: 'زبون آخر' },
    { saleOwnerId: 99 },
  ]) {
    assert.throws(
      () => bindContractInputToExistingProvenance(input, existing),
      (error: unknown) => error instanceof ContractCreationContextError
        && error.code === 'CONTRACT_PROVENANCE_IMMUTABLE',
    );
  }
});

test('preserves missing legacy provenance without freezing unrelated manual draft fields', () => {
  const existing = {
    customerId: 901,
    customerName: 'اسم قديم',
    sourceVisit: null,
    sourceVisitId: null,
    sourceOpenTaskId: null,
    sourceTaskOfferId: null,
    saleReferenceNumber: null,
    saleOwnerId: 31,
  };
  const bound = bindContractInputToExistingProvenance(
    { customerId: 902, customerName: 'اسم مصحح', saleOwnerId: 32 },
    existing,
  );

  assert.equal(bound.customerId, 902);
  assert.equal(bound.customerName, 'اسم مصحح');
  assert.equal(bound.saleOwnerId, 32);
  assert.equal(bound.sourceVisitId, null);
  assert.throws(
    () => bindContractInputToExistingProvenance({ sourceVisitId: 501 }, existing),
    (error: unknown) => error instanceof ContractCreationContextError
      && error.code === 'CONTRACT_PROVENANCE_IMMUTABLE',
  );
});

test('maps only live-source unique indexes to an offer conflict', () => {
  assert.equal(
    contractSourceUniquenessConflictPayload({ code: '23505', constraint: 'uq_contracts_live_source_task_offer' })?.code,
    'offer_already_contracted',
  );
  assert.equal(
    contractSourceUniquenessConflictPayload({ code: '23505', constraint: 'uq_contracts_live_sale_reference' })?.code,
    'offer_already_contracted',
  );
  assert.equal(contractSourceUniquenessConflictPayload({ code: '23505', constraint: 'contracts_contract_number_key' }), null);
});
