import type { AuthContext, AppAccountListResult } from '@golden-crm/shared';
import { APP_ACCOUNT_SOURCES } from '@golden-crm/shared';
import pool from '../../db.js';
import { resolveListAccessScope } from '../authorizationService.js';

function fail(status: number, message: string): never {
  throw Object.assign(new Error(message), { status });
}

/** DEC-013 defines app_accounts.view as GLOBAL only; unsupported grants fail closed. */
export function buildAppAccountListQuery(context: AuthContext, input: Record<string, unknown>) {
  if (resolveListAccessScope(context, 'app_accounts.view').scope !== 'GLOBAL') {
    fail(403, 'عرض حسابات التطبيق يتطلب صلاحية عامة');
  }
  function integer(key: string, fallback: number, min: number, max: number) {
    const raw = input[key];
    if (raw == null || raw === '') return fallback;
    if (typeof raw !== 'string' && typeof raw !== 'number') fail(400, 'قيمة التقسيم غير صالحة');
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < min || value > max) fail(400, 'قيمة التقسيم غير صالحة');
    return value;
  }
  const limit = integer('limit', 25, 1, 100);
  const offset = integer('offset', 0, 0, 1_000_000);
  const where = ["a.deleted_at IS NULL", "a.status IN ('active', 'suspended')", 'c.deleted_at IS NULL'];
  const values: unknown[] = [];
  const bind = (value: unknown) => { values.push(value); return `$${values.length}`; };
  if (input.status != null && input.status !== '') {
    if (input.status !== 'active' && input.status !== 'suspended') fail(400, 'حالة الحساب غير صالحة');
    where.push(`a.status = ${bind(input.status)}`);
  }
  if (input.source != null && input.source !== '') {
    if (typeof input.source !== 'string' || !Object.hasOwn(APP_ACCOUNT_SOURCES, input.source)) {
      fail(400, 'مصدر الإنشاء غير صالح');
    }
    where.push(`a.created_source = ${bind(input.source)}`);
  }
  if (input.search != null && input.search !== '') {
    if (typeof input.search !== 'string' || input.search.length > 150) fail(400, 'قيمة البحث غير صالحة');
    const search = input.search.trim();
    if (search) {
      const ref = bind(`%${search.replace(/[\\%_]/g, '\\$&')}%`);
      where.push(`(c.name ILIKE ${ref} OR a.primary_mobile ILIKE ${ref})`);
    }
  }
  const sortColumns: Record<string, string> = {
    clientName: '"clientName"', primaryMobile: '"primaryMobile"', branchName: '"branchName"',
    status: 'status', createdSource: '"createdSource"', createdAt: '"createdAt"',
  };
  const sortKey = input.sortKey ?? 'createdAt';
  const sortDir = input.sortDir ?? 'desc';
  if (typeof sortKey !== 'string' || !Object.hasOwn(sortColumns, sortKey)
      || (sortDir !== 'asc' && sortDir !== 'desc')) fail(400, 'ترتيب غير صالح');
  const limitRef = bind(limit);
  const offsetRef = bind(offset);
  // One statement keeps page and count consistent, including an empty last page.
  const text = `WITH filtered AS (
    SELECT a.id::text AS id, c.id AS "clientId", c.name AS "clientName",
           a.primary_mobile AS "primaryMobile", b.name AS "branchName", a.status,
           a.created_source AS "createdSource", a.created_at AS "createdAt",
           a.suspended_reason AS "suspendedReason"
      FROM app_accounts a
      JOIN clients c ON c.id = a.linked_client_record_id
      LEFT JOIN branches b ON b.id = c.branch_id
     WHERE ${where.join(' AND ')}
  ), page AS (
    SELECT * FROM filtered ORDER BY ${sortColumns[sortKey]} ${sortDir}, id::bigint DESC
     LIMIT ${limitRef} OFFSET ${offsetRef}
  )
  SELECT (SELECT COUNT(*)::integer FROM filtered) AS "totalCount",
         COALESCE((SELECT json_agg(page) FROM page), '[]'::json) AS items`;
  return { text, values, limit, offset };
}

export async function listAppAccounts(context: AuthContext, input: Record<string, unknown>): Promise<AppAccountListResult> {
  const query = buildAppAccountListQuery(context, input);
  const { rows } = await pool.query<Pick<AppAccountListResult, 'items' | 'totalCount'>>(query.text, query.values);
  return { ...rows[0], limit: query.limit, offset: query.offset };
}
