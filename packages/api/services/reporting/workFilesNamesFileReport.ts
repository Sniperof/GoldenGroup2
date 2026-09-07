import pool from '../../db.js';
import type { TabularReportAccess, TabularReportRequestParams } from './tabularReportAccess.js';
import { positiveInt } from './tabularReportAccess.js';
import { buildTabularReportOrderBy } from './tabularReportSorting.js';
import { ReportingError } from './reportingError.js';
import type { TabularReportFilterOptions } from './tabularReportFilterOptions.js';

interface QueryOptions { offset?: number; limit: number; includeTotalRows?: boolean }

export interface WorkFilesNamesFileRow {
  branchId: number;
  branchName: string;
  sourceType: string;
  referralSheetNumber: number | null;
  candidateAddedDate: string;
  referralSheetDate: string | null;
  mediatorVisitDate: string | null;
  accompanyingTechnician: string | null;
  mediatorName: string | null;
  mediatorType: string;
  mediatorAddress: string | null;
  mediatorContactNumber: string | null;
  giftPromiseStatus: string;
  candidateName: string;
  candidateStatus: string;
  candidateOutcome: string;
  duplicateStatus: string;
  governorateName: string;
  regionName: string;
  subareaName: string;
  neighborhoodName: string;
  detailedAddress: string | null;
  primaryContactNumber: string;
  additionalContactNumbers: string | null;
  occupation: string | null;
  candidateNotes: string | null;
}

function parseGeoIds(request: TabularReportRequestParams): number[] {
  return Array.from(new Set(String(request.geoIds ?? request.geoUnitId ?? '')
    .split(',').map(value => positiveInt(value)).filter((value): value is number => value != null)));
}

const CANDIDATE_STATUSES = new Set(['New', 'Suggested', 'Contacted', 'FollowUp', 'Qualified', 'Junk']);
const CANDIDATE_OUTCOMES = new Set(['active', 'converted', 'linked', 'junk']);
const DUPLICATE_STATUSES = new Set(['not_duplicate', 'client', 'candidate', 'both', 'duplicate']);
const MEDIATOR_TYPES = new Set(['Client', 'Employee', 'Personal', 'unknown']);
const GIFT_STATUSES = new Set(['none', 'promised', 'approved_for_delivery', 'delivery_task_created', 'delivered', 'delivered_manually', 'cancelled', 'refused']);

function textFilter(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function enumFilter(value: unknown, allowed: Set<string>, label: string): string | null {
  const normalized = textFilter(value);
  if (normalized == null) return null;
  if (!allowed.has(normalized)) throw new ReportingError(400, `${label} غير صالح`);
  return normalized;
}

function dateFilter(value: unknown, label: string): string | null {
  const normalized = textFilter(value);
  if (normalized == null) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized) || Number.isNaN(new Date(`${normalized}T00:00:00Z`).getTime())) {
    throw new ReportingError(400, `${label} غير صالح`);
  }
  return normalized;
}

function appendDateRange(
  filters: string[], params: unknown[], from: unknown, to: unknown,
  expression: string, label: string,
) {
  const normalizedFrom = dateFilter(from, `بداية ${label}`);
  const normalizedTo = dateFilter(to, `نهاية ${label}`);
  if (normalizedFrom && normalizedTo && normalizedFrom > normalizedTo) {
    throw new ReportingError(400, `بداية ${label} يجب ألا تكون بعد نهايته`);
  }
  if (normalizedFrom) { params.push(normalizedFrom); filters.push(`${expression} >= $${params.length}::date`); }
  if (normalizedTo) { params.push(normalizedTo); filters.push(`${expression} <= $${params.length}::date`); }
}

export function buildWorkFilesNamesFileQuery(
  access: TabularReportAccess,
  request: TabularReportRequestParams,
  options: QueryOptions,
): { sql: string; params: unknown[] } {
  const params: unknown[] = [];
  const filters: string[] = [];

  if (access.branchIds.length > 0) {
    params.push(access.branchIds);
    filters.push(`candidate.branch_id = ANY($${params.length}::int[])`);
  }
  if (access.scope === 'ASSIGNED') {
    params.push(access.userId);
    filters.push(`EXISTS (
      SELECT 1 FROM candidate_assignments scoped_assignment
       WHERE scoped_assignment.candidate_id = candidate.id
         AND scoped_assignment.hr_user_id = $${params.length}
    )`);
  }
  const geoIds = parseGeoIds(request);
  if (geoIds.length > 0) {
    params.push(geoIds);
    filters.push(`(
      location0.id = ANY($${params.length}::int[])
      OR location1.id = ANY($${params.length}::int[])
      OR location2.id = ANY($${params.length}::int[])
      OR location3.id = ANY($${params.length}::int[])
    )`);
  }

  const nameSearch = textFilter(request.candidateNameSearch);
  if (nameSearch) {
    params.push(`%${nameSearch}%`);
    filters.push(`COALESCE(NULLIF(TRIM(CONCAT_WS(' ', candidate.first_name, candidate.last_name)), ''), NULLIF(candidate.nickname, ''), '') ILIKE $${params.length}`);
  }
  const sourceType = enumFilter(request.candidateSourceType, new Set(['direct', 'name_list']), 'مصدر الاسم');
  if (sourceType === 'direct') filters.push('candidate.referral_sheet_id IS NULL');
  if (sourceType === 'name_list') filters.push('candidate.referral_sheet_id IS NOT NULL');
  const candidateStatus = enumFilter(request.candidateStatus, CANDIDATE_STATUSES, 'حالة الاسم');
  if (candidateStatus) { params.push(candidateStatus); filters.push(`candidate.status = $${params.length}`); }
  const candidateOutcome = enumFilter(request.candidateOutcome, CANDIDATE_OUTCOMES, 'مآل الاسم');
  if (candidateOutcome) {
    const outcomeSql = `CASE WHEN candidate.qualification_kind='converted' THEN 'converted'
      WHEN candidate.qualification_kind='linked' THEN 'linked'
      WHEN candidate.status='Junk' THEN 'junk' ELSE 'active' END`;
    params.push(candidateOutcome); filters.push(`(${outcomeSql}) = $${params.length}`);
  }
  const duplicateStatus = enumFilter(request.candidateDuplicateStatus, DUPLICATE_STATUSES, 'حالة التكرار');
  if (duplicateStatus) {
    const duplicateSql = `CASE WHEN candidate.duplicate_flag IS NOT TRUE THEN 'not_duplicate'
      WHEN candidate.duplicate_type='Client' THEN 'client' WHEN candidate.duplicate_type='Candidate' THEN 'candidate'
      WHEN candidate.duplicate_type='Both' THEN 'both' ELSE 'duplicate' END`;
    params.push(duplicateStatus); filters.push(`(${duplicateSql}) = $${params.length}`);
  }
  appendDateRange(filters, params, request.candidateAddedFrom, request.candidateAddedTo,
    `(candidate.created_at AT TIME ZONE 'Asia/Damascus')::date`, 'نطاق تاريخ إضافة الاسم');

  if (request.referralSheetNumber != null && request.referralSheetNumber !== '') {
    const sheetNumber = positiveInt(request.referralSheetNumber);
    if (sheetNumber == null) throw new ReportingError(400, 'رقم لائحة الأسماء غير صالح');
    params.push(sheetNumber); filters.push(`candidate.referral_sheet_id = $${params.length}`);
  }
  const referralDateSql = `CASE WHEN COALESCE(sheet.referral_date,candidate.referral_date) ~ '^\\d{4}-\\d{2}-\\d{2}'
    THEN SUBSTRING(COALESCE(sheet.referral_date,candidate.referral_date) FROM 1 FOR 10)::date END`;
  appendDateRange(filters, params, request.referralSheetFrom, request.referralSheetTo, referralDateSql, 'نطاق تاريخ لائحة الأسماء');
  const mediatorName = textFilter(request.mediatorName);
  if (mediatorName) {
    params.push(`%${mediatorName}%`);
    filters.push(`COALESCE(NULLIF(sheet.referral_name_snapshot,''),NULLIF(candidate.referral_name_snapshot,''),'') ILIKE $${params.length}`);
  }
  const mediatorType = enumFilter(request.mediatorType, MEDIATOR_TYPES, 'تصنيف الوسيط');
  if (mediatorType === 'unknown') filters.push(`COALESCE(sheet.referral_type,candidate.referral_type) IS NULL`);
  else if (mediatorType) { params.push(mediatorType); filters.push(`COALESCE(sheet.referral_type,candidate.referral_type) = $${params.length}`); }
  appendDateRange(filters, params, request.mediatorVisitFrom, request.mediatorVisitTo,
    `(visit_end.actual_end_time)::date`, 'نطاق تاريخ زيارة الوسيط');
  if (request.accompanyingTechnicianId != null && request.accompanyingTechnicianId !== '') {
    const technicianId = positiveInt(request.accompanyingTechnicianId);
    if (technicianId == null) throw new ReportingError(400, 'الفني المرافق غير صالح');
    params.push(technicianId);
    filters.push(`COALESCE(mediator_visit.reassigned_technician_id,NULLIF(mediator_visit.team_snapshot->>'technicianEmployeeId','')::int) = $${params.length}`);
  }
  const giftStatus = enumFilter(request.giftPromiseStatus, GIFT_STATUSES, 'حالة وعد الهدية');
  if (giftStatus === 'none') {
    filters.push(`NOT EXISTS (SELECT 1 FROM gift_record_sources source JOIN gift_records record ON record.id=source.gift_record_id
      WHERE source.source_type='candidate' AND source.candidate_id=candidate.id)
      AND NOT EXISTS (SELECT 1 FROM gift_record_sources source JOIN gift_records record ON record.id=source.gift_record_id
      WHERE candidate.referral_sheet_id IS NOT NULL AND source.source_type='name_list' AND source.referral_sheet_id=candidate.referral_sheet_id)`);
  } else if (giftStatus) {
    params.push(giftStatus);
    const giftRef = `$${params.length}`;
    filters.push(`(EXISTS (SELECT 1 FROM gift_record_sources source JOIN gift_records record ON record.id=source.gift_record_id
      WHERE source.source_type='candidate' AND source.candidate_id=candidate.id AND record.status=${giftRef})
      OR EXISTS (SELECT 1 FROM gift_record_sources source JOIN gift_records record ON record.id=source.gift_record_id
      WHERE candidate.referral_sheet_id IS NOT NULL AND source.source_type='name_list'
        AND source.referral_sheet_id=candidate.referral_sheet_id AND record.status=${giftRef}))`);
  }
  const occupation = textFilter(request.occupation);
  if (occupation) { params.push(`%${occupation}%`); filters.push(`COALESCE(candidate.occupation,'') ILIKE $${params.length}`); }

  params.push(options.limit);
  const limitRef = `$${params.length}`;
  let offsetSql = '';
  if (options.offset != null) {
    params.push(options.offset);
    offsetSql = ` OFFSET $${params.length}`;
  }

  const sql = `
    SELECT candidate.branch_id AS "branchId",
           COALESCE(branch.name, 'غير محدد') AS "branchName",
           CASE WHEN candidate.referral_sheet_id IS NULL THEN 'اقتراح مباشر' ELSE 'لائحة أسماء' END AS "sourceType",
           candidate.referral_sheet_id AS "referralSheetNumber",
           (candidate.created_at AT TIME ZONE 'Asia/Damascus')::date AS "candidateAddedDate",
           CASE
             WHEN COALESCE(sheet.referral_date, candidate.referral_date) ~ '^\\d{4}-\\d{2}-\\d{2}'
             THEN SUBSTRING(COALESCE(sheet.referral_date, candidate.referral_date) FROM 1 FOR 10)::date
           END AS "referralSheetDate",
           (visit_end.actual_end_time)::date AS "mediatorVisitDate",
           technician.name AS "accompanyingTechnician",
           COALESCE(NULLIF(sheet.referral_name_snapshot, ''), NULLIF(candidate.referral_name_snapshot, '')) AS "mediatorName",
           CASE COALESCE(sheet.referral_type, candidate.referral_type)
             WHEN 'Client' THEN 'زبون'
             WHEN 'Employee' THEN 'موظف'
             WHEN 'Personal' THEN 'شخصي'
             ELSE 'غير محدد'
           END AS "mediatorType",
           NULLIF(sheet.referral_address_text, '') AS "mediatorAddress",
           CASE COALESCE(sheet.referral_type, candidate.referral_type)
             WHEN 'Client' THEN mediator_client.mobile
             WHEN 'Employee' THEN mediator_employee.mobile
           END AS "mediatorContactNumber",
           COALESCE(gift_status.summary, 'لا يوجد وعد') AS "giftPromiseStatus",
           COALESCE(NULLIF(TRIM(CONCAT_WS(' ', candidate.first_name, candidate.last_name)), ''), NULLIF(candidate.nickname, ''), 'غير محدد') AS "candidateName",
           CASE candidate.status
             WHEN 'New' THEN 'جديد' WHEN 'Suggested' THEN 'مقترح' WHEN 'Contacted' THEN 'تم الاتصال'
             WHEN 'FollowUp' THEN 'متابعة' WHEN 'Qualified' THEN 'محوّل' WHEN 'Junk' THEN 'مرفوض'
             ELSE COALESCE(candidate.status, 'غير محدد')
           END AS "candidateStatus",
           CASE
             WHEN candidate.qualification_kind = 'converted' THEN 'تحول إلى زبون جديد'
             WHEN candidate.qualification_kind = 'linked' THEN 'رُبط بزبون موجود'
             WHEN candidate.status = 'Junk' THEN 'استُبعد'
             ELSE 'ما زال اسماً مقترحاً'
           END AS "candidateOutcome",
           CASE
             WHEN candidate.duplicate_flag IS NOT TRUE THEN 'غير مكرر'
             WHEN candidate.duplicate_type = 'Client' THEN 'مكرر مع زبون'
             WHEN candidate.duplicate_type = 'Candidate' THEN 'مكرر مع اسم مقترح'
             WHEN candidate.duplicate_type = 'Both' THEN 'مكرر مع زبون واسم مقترح'
             ELSE 'مكرر'
           END AS "duplicateStatus",
           COALESCE(CASE WHEN location0.level=1 THEN location0.name WHEN location1.level=1 THEN location1.name WHEN location2.level=1 THEN location2.name WHEN location3.level=1 THEN location3.name END, 'غير محدد') AS "governorateName",
           COALESCE(CASE WHEN location0.level=2 THEN location0.name WHEN location1.level=2 THEN location1.name WHEN location2.level=2 THEN location2.name WHEN location3.level=2 THEN location3.name END, 'غير محدد') AS "regionName",
           COALESCE(CASE WHEN location0.level=3 THEN location0.name WHEN location1.level=3 THEN location1.name WHEN location2.level=3 THEN location2.name WHEN location3.level=3 THEN location3.name END, 'غير محدد') AS "subareaName",
           COALESCE(CASE WHEN location0.level=4 THEN location0.name WHEN location1.level=4 THEN location1.name WHEN location2.level=4 THEN location2.name WHEN location3.level=4 THEN location3.name END, 'غير محدد') AS "neighborhoodName",
           NULLIF(candidate.address_text, '') AS "detailedAddress",
           candidate.mobile AS "primaryContactNumber",
           additional_contacts.numbers AS "additionalContactNumbers",
           NULLIF(candidate.occupation, '') AS "occupation",
           NULLIF(candidate.candidate_notes, '') AS "candidateNotes"
      FROM candidates candidate
      JOIN branches branch ON branch.id = candidate.branch_id
      LEFT JOIN referral_sheets sheet ON sheet.id = candidate.referral_sheet_id
      LEFT JOIN field_visits mediator_visit ON mediator_visit.id = sheet.field_visit_id
      LEFT JOIN visit_geo_logs visit_end ON visit_end.visit_id = mediator_visit.id
      LEFT JOIN employees technician
        ON technician.id = COALESCE(mediator_visit.reassigned_technician_id, NULLIF(mediator_visit.team_snapshot->>'technicianEmployeeId', '')::int)
      LEFT JOIN clients mediator_client
        ON COALESCE(sheet.referral_type, candidate.referral_type) = 'Client'
       AND mediator_client.id = COALESCE(sheet.referral_entity_id, candidate.referral_entity_id)
       AND mediator_client.deleted_at IS NULL
      LEFT JOIN employees mediator_employee
        ON COALESCE(sheet.referral_type, candidate.referral_type) = 'Employee'
       AND mediator_employee.id = COALESCE(sheet.referral_entity_id, candidate.referral_entity_id)
      LEFT JOIN geo_units location0 ON location0.id = candidate.geo_unit_id
      LEFT JOIN geo_units location1 ON location1.id = location0.parent_id
      LEFT JOIN geo_units location2 ON location2.id = location1.parent_id
      LEFT JOIN geo_units location3 ON location3.id = location2.parent_id
      LEFT JOIN LATERAL (
        SELECT STRING_AGG(DISTINCT NULLIF(contact->>'number', ''), '، ' ORDER BY NULLIF(contact->>'number', '')) AS numbers
          FROM jsonb_array_elements(COALESCE(candidate.contacts, '[]'::jsonb)) contact
         WHERE NULLIF(contact->>'number', '') IS NOT NULL
           AND NULLIF(contact->>'number', '') IS DISTINCT FROM candidate.mobile
      ) additional_contacts ON TRUE
      LEFT JOIN LATERAL (
        SELECT STRING_AGG(DISTINCT CASE gift.status
                 WHEN 'promised' THEN 'موعود'
                 WHEN 'approved_for_delivery' THEN 'معتمد للتسليم'
                 WHEN 'delivery_task_created' THEN 'تم إنشاء مهمة التسليم'
                 WHEN 'delivered' THEN 'تم التسليم'
                 WHEN 'delivered_manually' THEN 'تم التسليم يدوياً'
                 WHEN 'cancelled' THEN 'ملغى'
                 WHEN 'refused' THEN 'مرفوض'
                 ELSE gift.status END, '، ') AS summary
          FROM (
            SELECT record.status
              FROM gift_record_sources source
              JOIN gift_records record ON record.id = source.gift_record_id
             WHERE source.source_type = 'candidate' AND source.candidate_id = candidate.id
            UNION ALL
            SELECT record.status
              FROM gift_record_sources source
              JOIN gift_records record ON record.id = source.gift_record_id
             WHERE candidate.referral_sheet_id IS NOT NULL
               AND source.source_type = 'name_list'
               AND source.referral_sheet_id = candidate.referral_sheet_id
          ) gift
      ) gift_status ON TRUE
     ${filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : ''}
     ORDER BY ${buildTabularReportOrderBy(
       'work_files.names_file', access, request, 'candidate.created_at DESC, candidate.id DESC',
     )}
     LIMIT ${limitRef}${offsetSql}
  `;
  return { sql, params };
}

export async function getWorkFilesNamesFileReport(
  access: TabularReportAccess,
  request: TabularReportRequestParams,
  options: QueryOptions,
) {
  const query = buildWorkFilesNamesFileQuery(access, request, options);
  const { rows } = await pool.query<WorkFilesNamesFileRow>(query.sql, query.params);
  return { rows, total: rows.length };
}

export async function getWorkFilesNamesFileFilterOptions(
  access: TabularReportAccess,
): Promise<Partial<TabularReportFilterOptions>> {
  const params: unknown[] = [];
  const scope: string[] = [];
  if (access.branchIds.length > 0) { params.push(access.branchIds); scope.push(`candidate.branch_id=ANY($${params.length}::int[])`); }
  if (access.scope === 'ASSIGNED') {
    params.push(access.userId);
    scope.push(`EXISTS (SELECT 1 FROM candidate_assignments assignment
      WHERE assignment.candidate_id=candidate.id AND assignment.hr_user_id=$${params.length})`);
  }
  const where = scope.length ? `WHERE ${scope.join(' AND ')}` : '';
  const { rows } = await pool.query(`
    WITH scoped_candidates AS (
      SELECT candidate.* FROM candidates candidate ${where}
    ), gift_options AS (
      SELECT record.status
        FROM scoped_candidates candidate
        JOIN gift_record_sources source ON source.source_type='candidate' AND source.candidate_id=candidate.id
        JOIN gift_records record ON record.id=source.gift_record_id
      UNION ALL
      SELECT record.status
        FROM scoped_candidates candidate
        JOIN gift_record_sources source ON source.source_type='name_list' AND source.referral_sheet_id=candidate.referral_sheet_id
        JOIN gift_records record ON record.id=source.gift_record_id
       WHERE candidate.referral_sheet_id IS NOT NULL
    )
    SELECT
      COALESCE((SELECT JSONB_AGG(item ORDER BY item->>'label') FROM (
        SELECT JSONB_BUILD_OBJECT('value',status,'label',CASE status
          WHEN 'New' THEN 'جديد' WHEN 'Suggested' THEN 'مقترح' WHEN 'Contacted' THEN 'تم الاتصال'
          WHEN 'FollowUp' THEN 'متابعة' WHEN 'Qualified' THEN 'محوّل' WHEN 'Junk' THEN 'مرفوض' ELSE status END) item
        FROM (SELECT DISTINCT status FROM scoped_candidates WHERE status IS NOT NULL) values
      ) statuses), '[]'::jsonb) AS "candidateStatuses",
      COALESCE((SELECT JSONB_AGG(item ORDER BY item->>'label') FROM (
        SELECT DISTINCT JSONB_BUILD_OBJECT('value',employee.id::text,'label',employee.name) item
        FROM scoped_candidates candidate JOIN referral_sheets sheet ON sheet.id=candidate.referral_sheet_id
        JOIN field_visits visit ON visit.id=sheet.field_visit_id
        JOIN employees employee ON employee.id=COALESCE(visit.reassigned_technician_id,NULLIF(visit.team_snapshot->>'technicianEmployeeId','')::int)
      ) technicians), '[]'::jsonb) AS "accompanyingTechnicians",
      COALESCE((SELECT JSONB_AGG(item ORDER BY item->>'label') FROM (
        SELECT JSONB_BUILD_OBJECT('value',status,'label',CASE status
          WHEN 'promised' THEN 'موعود' WHEN 'approved_for_delivery' THEN 'معتمد للتسليم'
          WHEN 'delivery_task_created' THEN 'تم إنشاء مهمة التسليم' WHEN 'delivered' THEN 'تم التسليم'
          WHEN 'delivered_manually' THEN 'تم التسليم يدوياً' WHEN 'cancelled' THEN 'ملغى'
          WHEN 'refused' THEN 'مرفوض' ELSE status END) item
        FROM (SELECT DISTINCT status FROM gift_options WHERE status IS NOT NULL) values
      ) gifts), '[]'::jsonb) AS "giftPromiseStatuses"
  `, params);
  const row = rows[0] ?? {};
  return {
    candidateStatuses: row.candidateStatuses ?? [],
    accompanyingTechnicians: row.accompanyingTechnicians ?? [],
    giftPromiseStatuses: [{ value: 'none', label: 'لا يوجد وعد' }, ...(row.giftPromiseStatuses ?? [])],
  };
}
