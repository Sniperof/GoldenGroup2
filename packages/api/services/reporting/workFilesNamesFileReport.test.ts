import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildWorkFilesNamesFileQuery } from './workFilesNamesFileReport.js';
import { validateTabularReportRequest } from './tabularReportService.js';

const GLOBAL_ACCESS = { scope: 'GLOBAL' as const, grantedScope: 'GLOBAL' as const, branchIds: [], userId: 42 };

test('names file keeps candidate.id as the single row grain and merges both sources', () => {
  const { sql, params } = buildWorkFilesNamesFileQuery(GLOBAL_ACCESS, {}, { limit: 100 });
  assert.match(sql, /FROM candidates candidate/);
  assert.match(sql, /candidate\.referral_sheet_id IS NULL THEN 'اقتراح مباشر' ELSE 'لائحة أسماء'/);
  assert.match(sql, /ORDER BY candidate\.created_at DESC, candidate\.id DESC/);
  assert.doesNotMatch(sql, /GROUP BY candidate\.id/);
  assert.deepEqual(params, [100]);
});

test('one-to-many contacts and gift promises stay collapsed without OR-driven gift scans', () => {
  const { sql } = buildWorkFilesNamesFileQuery(GLOBAL_ACCESS, {}, { limit: 100 });
  assert.match(sql, /LEFT JOIN LATERAL[\s\S]*jsonb_array_elements[\s\S]*STRING_AGG/);
  assert.match(sql, /STRING_AGG\(DISTINCT CASE gift\.status[\s\S]*UNION ALL[\s\S]*source\.referral_sheet_id = candidate\.referral_sheet_id/);
  assert.doesNotMatch(sql, /\(source\.source_type = 'candidate'[\s\S]*\sOR\s/);
  assert.doesNotMatch(sql, /JOIN candidate_assignments(?! scoped_assignment)/);
});

test('mediator visit date is actual completion only and technician uses visit team truth', () => {
  const { sql } = buildWorkFilesNamesFileQuery(GLOBAL_ACCESS, {}, { limit: 100 });
  assert.match(sql, /LEFT JOIN visit_geo_logs visit_end ON visit_end\.visit_id = mediator_visit\.id/);
  assert.match(sql, /visit_end\.actual_end_time/);
  assert.doesNotMatch(sql, /SELECT MAX\(log\.actual_end_time\)/);
  assert.doesNotMatch(sql, /scheduled_date.*mediatorVisitDate/);
  assert.match(sql, /COALESCE\(mediator_visit\.reassigned_technician_id, NULLIF\(mediator_visit\.team_snapshot->>'technicianEmployeeId'/);
});

test('branch, assigned ownership and geographic hierarchy are enforced server-side', () => {
  const access = { scope: 'ASSIGNED' as const, grantedScope: 'ASSIGNED' as const, branchIds: [3], userId: 42 };
  const { sql, params } = buildWorkFilesNamesFileQuery(access, { geoIds: '7,8,8' }, { limit: 50 });
  assert.match(sql, /candidate\.branch_id = ANY\(\$1::int\[\]\)/);
  assert.match(sql, /candidate_assignments scoped_assignment/);
  assert.match(sql, /scoped_assignment\.hr_user_id = \$2/);
  for (const alias of ['location0', 'location1', 'location2', 'location3']) {
    assert.match(sql, new RegExp(`${alias}\\.id = ANY\\(\\$3::int\\[\\]\\)`));
  }
  assert.deepEqual(params, [[3], 42, [7, 8], 50]);
});

test('duplicate records stay visible and deferred follow-up data is absent', () => {
  const { sql } = buildWorkFilesNamesFileQuery(GLOBAL_ACCESS, {}, { limit: 100 });
  assert.match(sql, /candidate\.duplicate_flag/);
  assert.match(sql, /candidate\.qualification_kind/);
  assert.doesNotMatch(sql, /contact_logs|call_logs|appointment|visit_task_results/);
});

test('visible names-file fields have independent server-side filters', () => {
  const { sql, params } = buildWorkFilesNamesFileQuery(GLOBAL_ACCESS, {
    candidateNameSearch: 'سليم', candidateSourceType: 'name_list', candidateStatus: 'New',
    candidateOutcome: 'active', candidateDuplicateStatus: 'not_duplicate',
    candidateAddedFrom: '2026-01-01', candidateAddedTo: '2026-01-31',
    referralSheetNumber: 12, referralSheetFrom: '2026-01-02', referralSheetTo: '2026-01-30',
    mediatorName: 'أحمد', mediatorType: 'Client', mediatorVisitFrom: '2026-01-03', mediatorVisitTo: '2026-01-29',
    accompanyingTechnicianId: 7, giftPromiseStatus: 'promised', occupation: 'معلم',
  }, { limit: 100 });
  assert.match(sql, /candidate\.first_name[\s\S]*ILIKE \$1/);
  assert.match(sql, /candidate\.referral_sheet_id IS NOT NULL/);
  assert.match(sql, /candidate\.status = \$2/);
  assert.match(sql, /candidate\.qualification_kind='converted'[\s\S]*= \$3/);
  assert.match(sql, /candidate\.duplicate_flag IS NOT TRUE[\s\S]*= \$4/);
  assert.match(sql, /candidate\.created_at AT TIME ZONE 'Asia\/Damascus'/);
  assert.match(sql, /candidate\.referral_sheet_id = \$7/);
  assert.match(sql, /sheet\.referral_name_snapshot[\s\S]*ILIKE \$10/);
  assert.match(sql, /visit_end\.actual_end_time/);
  assert.match(sql, /record\.status=\$15/);
  assert.equal(params.at(-1), 100);
});

test('names-file filters reject unknown values and reversed dates', () => {
  assert.throws(
    () => buildWorkFilesNamesFileQuery(GLOBAL_ACCESS, { candidateSourceType: 'device_demo' }, { limit: 10 }),
    /مصدر الاسم غير صالح/,
  );
  assert.throws(
    () => buildWorkFilesNamesFileQuery(GLOBAL_ACCESS, { giftPromiseStatus: 'CLOSED' }, { limit: 10 }),
    /حالة وعد الهدية غير صالح/,
  );
  assert.throws(
    () => buildWorkFilesNamesFileQuery(GLOBAL_ACCESS, { candidateAddedFrom: '2026-02-01', candidateAddedTo: '2026-01-01' }, { limit: 10 }),
    /يجب ألا تكون بعد نهايته/,
  );
});

test('invalid names-file filters are rejected before a background run is queued', () => {
  assert.throws(
    () => validateTabularReportRequest('work_files.names_file', GLOBAL_ACCESS, { candidateStatus: 'CLOSED' }),
    /حالة الاسم غير صالح/,
  );
  const service = readFileSync('packages/api/services/reporting/tabularReportService.ts', 'utf8');
  assert.match(service, /resolveTabularReportAccess[\s\S]*validateTabularReportRequest[\s\S]*INSERT INTO report_runs/);
});

test('names-file option lists are derived inside the same branch and assignment scope', () => {
  const source = readFileSync('packages/api/services/reporting/workFilesNamesFileReport.ts', 'utf8');
  assert.match(source, /getWorkFilesNamesFileFilterOptions/);
  assert.match(source, /candidate\.branch_id=ANY/);
  assert.match(source, /candidate_assignments assignment/);
  assert.match(source, /WITH scoped_candidates/);
  assert.match(source, /gift_options AS/);
  assert.doesNotMatch(source, /JSONB_AGG[\s\S]*SELECT DISTINCT TRIM\(occupation\)/);
});

test('names-file filters are wired through the API and grouped in the report UI', () => {
  const route = readFileSync('packages/api/routes/reports.ts', 'utf8');
  const service = readFileSync('packages/api/services/reporting/tabularReportService.ts', 'utf8');
  const page = readFileSync('packages/web/src/pages/Reports.tsx', 'utf8');
  assert.match(route, /candidateNameSearch: input\.candidateNameSearch/);
  assert.match(route, /giftPromiseStatus: input\.giftPromiseStatus/);
  assert.match(service, /getWorkFilesNamesFileFilterOptions/);
  for (const label of ['اسم الشخص المقترح', 'مصدر الاسم', 'حالة الاسم', 'مآل الاسم', 'حالة التكرار', 'رقم لائحة الأسماء', 'اسم الوسيط', 'تصنيف الوسيط', 'الفني المرافق لزيارة الوسيط', 'حالة وعد الهدية', 'العمل']) {
    assert.ok(page.includes(label), label);
  }
  assert.match(page, /تغيّرت الفلاتر/);
  assert.match(page, /snapshotDirty/);
});

test('permission migration uses independent report grants and all supported scopes', () => {
  const migration = readFileSync('migrations/444_work_files_names_file_report.sql', 'utf8');
  assert.match(migration, /reports\.work_files\.names_file\.view/);
  assert.match(migration, /reports\.work_files\.names_file\.export/);
  assert.match(migration, /ARRAY\['GLOBAL','BRANCH','ASSIGNED'\]/);
  assert.match(migration, /role_permission_grants/);
  assert.doesNotMatch(migration, /role_permissions(?!_grants)/);
  assert.match(migration, /Export stays independent/);
});
