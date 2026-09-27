import type { AuthContext } from '@golden-crm/shared';
import { authorize, resolveListAccessScope } from '../services/authorizationService.js';

// ASSIGNED on contracts = the actor is the contract's SALE OWNER.
// contracts.sale_owner_id references employees, so the actor's hr_users row is
// bridged through hr_users.employee_id. One definition for the list, the record
// checks and the reporting layer — they must never disagree (SH-1).

export interface ContractSubject {
  branchId: number | null;
  saleOwnerId: number | null;
}

/** SQL predicate: contract `alias` is sale-owned by the hr_user bound to `userParam`. */
export function contractSaleOwnerSql(alias: string, userParam: string): string {
  return `EXISTS (
    SELECT 1 FROM hr_users contract_scope_owner
     WHERE contract_scope_owner.id = ${userParam}
       AND contract_scope_owner.employee_id IS NOT NULL
       AND contract_scope_owner.employee_id = ${alias}.sale_owner_id
  )`;
}

/** Pure record check; `currentEmployeeId` is the actor's hr_users.employee_id. */
export function canAccessContract(
  context: AuthContext,
  permission: string,
  subject: ContractSubject,
  currentEmployeeId: number | null,
) {
  const scope = resolveListAccessScope(context, permission).scope;
  if (scope !== 'ASSIGNED') return authorize(context, { permission, branchId: subject.branchId });
  const owned = currentEmployeeId != null
    && subject.saleOwnerId != null
    && Number(subject.saleOwnerId) === Number(currentEmployeeId);
  return authorize(context, {
    permission,
    branchId: subject.branchId,
    assignedUserId: owned ? context.userId : null,
  });
}

export async function loadCurrentEmployeeId(userId: number): Promise<number | null> {
  // Lazy: keeps this module pure for the reporting layer and unit tests.
  const { default: pool } = await import('../db.js');
  const { rows } = await pool.query('SELECT employee_id FROM hr_users WHERE id = $1', [userId]);
  const id = Number(rows[0]?.employee_id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** Record check for routes; hits the DB only when the grant is ASSIGNED. */
export async function authorizeContract(context: AuthContext, permission: string, subject: ContractSubject) {
  const scope = resolveListAccessScope(context, permission).scope;
  const employeeId = scope === 'ASSIGNED' ? await loadCurrentEmployeeId(context.userId) : null;
  return canAccessContract(context, permission, subject, employeeId);
}
