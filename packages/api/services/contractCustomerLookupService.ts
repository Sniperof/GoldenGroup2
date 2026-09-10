import type { AuthContext } from '@golden-crm/shared';
import { getClientListAccessPlan } from '../policies/clientPolicy.js';
import { authorize } from './authorizationService.js';
import { personalOwnershipPredicate } from './customerOwnership.js';
import { phoneNormalizationSql } from '../utils/phoneSql.js';

interface Queryable {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;
}

export class ContractCustomerLookupError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ContractCustomerLookupError';
  }
}

export interface ContractCustomerLookupItem {
  id: number;
  name: string;
  mobile: string;
  branchName: string | null;
  legalIdentityComplete: boolean;
}

function assertContractCreateAccess(authContext: AuthContext, branchId: number) {
  const access = authorize(authContext, { permission: 'contracts.create', branchId });
  if (!access.allowed) {
    throw new ContractCustomerLookupError(403, access.reason, 'لا تملك صلاحية إنشاء عقد ضمن هذا الفرع');
  }
}

function appendLookupScope(
  authContext: AuthContext,
  branchId: number,
  params: unknown[],
  requireCustomerDetails = false,
): string[] {
  assertContractCreateAccess(authContext, branchId);
  const plan = getClientListAccessPlan(authContext);
  if (plan.scope === 'NONE') {
    throw new ContractCustomerLookupError(403, 'MISSING_CLIENT_LIST_PERMISSION', 'لا تملك صلاحية البحث في الزبائن');
  }

  params.push([branchId]);
  const branchRef = `$${params.length}::int[]`;
  const conditions = [`(
    c.branch_id = ANY(${branchRef})
    OR EXISTS (
      SELECT 1 FROM installed_devices lookup_device
       WHERE lookup_device.customer_id = c.id
         AND lookup_device.branch_id = ANY(${branchRef})
    )
    OR EXISTS (
      SELECT 1 FROM contracts lookup_contract
       WHERE lookup_contract.customer_id = c.id
         AND lookup_contract.branch_id = ANY(${branchRef})
    )
  )`];

  const contractCreateScope = authContext.isSuperAdmin
    ? 'GLOBAL'
    : authContext.grants.find(grant => grant.permission === 'contracts.create')?.scope;
  // The effective result is the intersection of both permissions. If either
  // capability is ASSIGNED, only personally assigned customers are candidates.
  let detailsScope: 'GLOBAL' | 'BRANCH' | 'ASSIGNED' | null = null;
  if (requireCustomerDetails) {
    const detailsAccess = authorize(authContext, { permission: 'clients.view', branchId });
    if (!detailsAccess.allowed) {
      throw new ContractCustomerLookupError(403, detailsAccess.reason, 'لا تملك صلاحية عرض بيانات الزبون');
    }
    detailsScope = detailsAccess.grant?.scope ?? (authContext.isSuperAdmin ? 'GLOBAL' : null);
  }

  if (
    plan.scope === 'ASSIGNED'
    || contractCreateScope === 'ASSIGNED'
    || detailsScope === 'ASSIGNED'
  ) {
    params.push(authContext.userId);
    conditions.push(personalOwnershipPredicate('c.id', `$${params.length}`));
  }
  return conditions;
}

export async function searchContractCustomers(
  db: Queryable,
  authContext: AuthContext,
  branchId: number,
  rawQuery: string,
  requestedLimit = 20,
): Promise<{ items: ContractCustomerLookupItem[]; hasMore: boolean }> {
  const query = rawQuery.trim();
  if (query.length < 2) return { items: [], hasMore: false };

  const limit = Math.min(30, Math.max(1, requestedLimit));
  const params: unknown[] = [];
  const conditions = appendLookupScope(authContext, branchId, params);
  conditions.push('c.is_candidate = FALSE');

  params.push(`%${query}%`);
  const textRef = `$${params.length}`;
  params.push(`${query}%`);
  const prefixRef = `$${params.length}`;
  const numericId = /^\d+$/.test(query) ? Number(query) : null;
  params.push(Number.isSafeInteger(numericId) ? numericId : null);
  const idRef = `$${params.length}::bigint`;
  const digits = query.replace(/\D/g, '');
  params.push(digits ? `%${digits}%` : null);
  const phoneRef = `$${params.length}::text`;
  params.push(limit + 1);
  const limitRef = `$${params.length}`;

  conditions.push(`(
    c.name ILIKE ${textRef}
    OR (${idRef} IS NOT NULL AND c.id = ${idRef})
    OR (${phoneRef} IS NOT NULL AND ${phoneNormalizationSql('c.mobile')} LIKE ${phoneRef})
    OR (${phoneRef} IS NOT NULL AND EXISTS (
      SELECT 1
        FROM jsonb_array_elements(COALESCE(c.contacts, '[]'::jsonb)) contact
       WHERE ${phoneNormalizationSql(`contact->>'number'`)} LIKE ${phoneRef}
    ))
  )`);

  const { rows } = await db.query(
    `SELECT c.id,
            c.name,
            COALESCE(c.mobile, '') AS mobile,
            b.name AS "branchName",
            (NULLIF(BTRIM(c.father_name), '') IS NOT NULL
             AND NULLIF(BTRIM(c.national_id), '') IS NOT NULL) AS "legalIdentityComplete"
       FROM clients c
       LEFT JOIN branches b ON b.id = c.branch_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY
        CASE
          WHEN ${idRef} IS NOT NULL AND c.id = ${idRef} THEN 0
          WHEN ${phoneRef} IS NOT NULL AND ${phoneNormalizationSql('c.mobile')} = REPLACE(${phoneRef}, '%', '') THEN 1
          WHEN c.name ILIKE ${prefixRef} THEN 2
          ELSE 3
        END,
        c.id DESC
      LIMIT ${limitRef}`,
    params,
  );

  return {
    items: rows.slice(0, limit).map(row => ({
      id: Number(row.id),
      name: row.name,
      mobile: row.mobile ?? '',
      branchName: row.branchName ?? null,
      legalIdentityComplete: row.legalIdentityComplete === true,
    })),
    hasMore: rows.length > limit,
  };
}

export async function loadContractCustomerContext(
  db: Queryable,
  authContext: AuthContext,
  branchId: number,
  customerId: number,
) {
  const params: unknown[] = [];
  const conditions = appendLookupScope(authContext, branchId, params, true);
  params.push(customerId);
  conditions.push(`c.id = $${params.length}`);
  conditions.push('c.is_candidate = FALSE');

  const { rows } = await db.query(
    `SELECT c.id,
            c.name,
            COALESCE(c.mobile, '') AS mobile,
            c.contacts,
            c.father_name AS "fatherName",
            c.national_id AS "nationalId",
            c.mother_name AS "motherName",
            c.birth_date AS "birthDate",
            c.gender,
            c.national_id_registry AS "nationalIdRegistry",
            c.national_id_issued_by AS "nationalIdIssuedBy",
            c.national_id_issue_date AS "nationalIdIssueDate",
            c.national_id_box AS "nationalIdBox",
            c.referrers
       FROM clients c
      WHERE ${conditions.join(' AND ')}
      LIMIT 1`,
    params,
  );

  if (!rows[0]) {
    throw new ContractCustomerLookupError(403, 'CUSTOMER_OUT_OF_SCOPE', 'الزبون غير متاح لإنشاء عقد ضمن هذا الفرع');
  }
  return {
    ...rows[0],
    id: Number(rows[0].id),
    contacts: Array.isArray(rows[0].contacts) ? rows[0].contacts : [],
    referrers: Array.isArray(rows[0].referrers) ? rows[0].referrers : [],
  };
}
