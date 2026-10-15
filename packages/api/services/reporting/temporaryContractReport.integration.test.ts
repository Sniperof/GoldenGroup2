import assert from 'node:assert/strict';
import test from 'node:test';
import pool from '../../db.js';
import { buildTemporaryContractQuery, getTemporaryContractFilterOptions } from './temporaryContractReport.js';
import type { TabularReportRequestParams } from './tabularReportAccess.js';

// Real PostgreSQL evaluation with CTE fixtures: no rows are written or changed.
test('trial report evaluates the approved 19 columns and purchase results on PostgreSQL', {
  skip: process.env.TRIAL_REPORT_DB_TESTS !== '1',
}, async () => {
  const db = await pool.connect();
  try {
    await db.query('BEGIN READ ONLY');
    const access = { scope: 'GLOBAL' as const, grantedScope: 'GLOBAL' as const, branchIds: [], userId: 21 };
    const member = (await db.query('SELECT id,employee_id FROM hr_users WHERE employee_id IS NOT NULL ORDER BY id LIMIT 1')).rows[0];
    assert.ok(member, 'fixture needs an existing employee-backed user');
    async function run(overrides: Record<string, unknown>, request: TabularReportRequestParams = {}, visitOverrides: Record<string, unknown> = {}) {
      const query = buildTemporaryContractQuery(access, request, { limit: 10 });
      const fixture = {
        started_as_temporary: true, temporary_settled_at: null,
        source_open_task_id: null, source_task_offer_id: null, source_visit_id: null, sale_source: null,
        cancellation_reason: null, status: 'active', ...overrides,
      };
      const fixtureRef = `$${query.params.length + 1}::jsonb`;
      const visitRef = `$${query.params.length + 2}::jsonb`;
      const cte = `WITH contracts AS (
        SELECT (jsonb_populate_record(NULL::public.contracts, to_jsonb(base) || ${fixtureRef})).*
          FROM (SELECT * FROM public.contracts WHERE started_as_temporary IS TRUE ORDER BY id LIMIT 1) base
      ), field_visits AS (
        SELECT (jsonb_populate_record(NULL::public.field_visits, to_jsonb(base) || ${visitRef})).*
          FROM (SELECT * FROM public.field_visits ORDER BY id LIMIT 1) base
      ), clients AS (
        SELECT (jsonb_populate_record(NULL::public.clients, to_jsonb(base) ||
          jsonb_build_object('detailed_address','عنوان صاحب العقد'))).*
          FROM public.clients base WHERE base.id = (SELECT customer_id FROM contracts)
      ) `;
      return (await db.query(cte + query.sql, [...query.params, JSON.stringify(fixture), JSON.stringify({id:-987654,team_responsible_user_id:member.id,reassigned_technician_id:member.employee_id,...visitOverrides})])).rows;
    }
    for (const fixture of [
      { status: 'active', expected: 'لم تتم بعد', code: 'open' },
      { status: 'draft', expected: 'لم تتم بعد', code: 'open' },
      { status: 'discarded', expected: 'غير مسجلة', code: 'unknown' },
      { status: 'cancelled', cancellation_reason: 'device_upgrade_replacement', expected: 'غير مسجلة', code: 'unknown' },
      { status: 'cancelled', cancellation_reason: 'trial_not_settled', expected: 'غير مسجلة', code: 'unknown' },
      { status: 'cancelled', cancellation_reason: 'trial_purchase_refused', expected: 'تم الرفض', code: 'refused' },
      { status: 'active', temporary_settled_at: '2026-09-30T09:00:00Z', expected: 'تم تثبيت البيعة', code: 'settled' },
      { status: 'cancelled', temporary_settled_at: '2026-09-30T09:00:00Z', expected: 'تم تثبيت البيعة', code: 'settled' },
    ]) {
      const { expected, code, ...overrides } = fixture;
      const rows = await run(overrides, { trialOutcome: code });
      assert.equal(rows.length, 1, `matching filter: ${JSON.stringify(fixture)}`);
      assert.equal(rows[0].trialOutcome, expected);
      assert.equal(rows[0].appointmentSource, 'غير مسجل');
      assert.equal(rows[0].installationAddress, 'عنوان صاحب العقد');
      assert.equal(Object.keys(rows[0]).filter(key => key !== 'totalRows').length, 19);
      const mismatched = await run(overrides, { trialOutcome: code === 'open' ? 'refused' : 'open' });
      assert.equal(mismatched.length, 0, 'filter must agree with the displayed result');

    }
    for (const [sale_source, expected] of [['device_demo_task','مهمة عرض جهاز'],['تطبيق غولدن غروب','تطبيق غولدن غروب'],['إحالة','إحالة']]) {
      assert.equal((await run({sale_source}))[0].appointmentSource, expected);
    }
    const led = await run({source_visit_id:-987654});
    assert.ok(led[0].saleVisitTechnicianName, 'source technician is responsible for the team');
    const accompanying = await run({source_visit_id:-987654}, {}, {team_responsible_user_id:null});
    assert.equal(accompanying[0].saleVisitTechnicianName, null, 'an accompanying technician is not the team seller');
    const unknown = {contract_referrers:[{referrerType:'Unknown',referrerName:'وسيط'}]};
    assert.equal((await run(unknown,{mediatorType:'unknown'})).length, 1);
    for(const referrerType of ['client','Customer']) {
      assert.equal((await run({contract_referrers:[{referrerType,referrerName:'وسيط'}]},{mediatorType:'Client'}))[0].mediatorType, 'زبون');
    }
    const options = await getTemporaryContractFilterOptions(access);
    assert.ok(Array.isArray(options.deviceModels));
    assert.ok(Array.isArray(options.supervisors));
    await db.query('ROLLBACK');
  } finally {
    db.release();
    await pool.end();
  }
});
