import type { PoolClient } from 'pg';
import type {
  AuthContext, ComplaintOutcome, ComplaintPriority, ComplaintStatus, ComplaintType,
} from '@golden-crm/shared';
import {
  COMPLAINT_OUTCOMES, COMPLAINT_PRIORITIES, COMPLAINT_STATUSES, COMPLAINT_TYPES,
  DEVICE_COMPLAINT_CATEGORIES, TECHNICAL_COMPLAINT_CATEGORIES,
  isComplaintTransitionAllowed,
} from '@golden-crm/shared';
import pool from '../../db.js';
import { resolveAndValidateAddress } from '../geo/administrativeAddress.js';
import { isValidSyrianMobile, normalizePhone } from '../../utils/contactValidation.js';
import { getComplaintListAccessPlan, canAccessComplaint } from '../../policies/complaintPolicy.js';
import { getClientListAccessPlan } from '../../policies/clientPolicy.js';
import { buildClientSnapshot } from '../../lib/clientSnapshot.js';
import { authorize, resolveListAccessScope } from '../authorizationService.js';
import { insertAuditLog } from '../../utils/auditLog.js';
import { assertGeoUnitInScope } from '../geoScopeService.js';

type Queryable = Pick<PoolClient, 'query'>;

function httpError(status: number, code: string, details?: unknown) {
  return Object.assign(new Error(code), { status, details: { code, details } });
}

function text(value: unknown, field: string, min = 1, max = 5000): string {
  const result = typeof value === 'string' ? value.trim() : '';
  if (result.length < min || result.length > max) throw httpError(400, `invalid_${field}`);
  return result;
}

function optionalText(value: unknown, field: string, max: number): string | null {
  if (value == null || value === '') return null;
  return text(value, field, 1, max);
}

function positiveInt(value: unknown, field: string, required = false): number | null {
  if (value == null || value === '') {
    if (required) throw httpError(400, `${field}_required`);
    return null;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw httpError(400, `invalid_${field}`);
  return parsed;
}

function enumValue<T extends string>(value: unknown, values: readonly T[], field: string): T {
  if (!values.includes(value as T)) throw httpError(400, `invalid_${field}`);
  return value as T;
}

function optionalBoolean(value:unknown,field:string):boolean|null{
  if(value==null)return null;if(typeof value!=='boolean')throw httpError(400,`invalid_${field}`);return value;
}

export function getComplaintSecondaryContact(contacts: unknown, primaryMobile: unknown): any | null {
  if (!Array.isArray(contacts)) return null;
  const primary = normalizePhone(primaryMobile);
  return contacts.find((contact: any) => {
    if (contact?.type === 'landline') return false;
    if (contact?.status && !['active', 'preferred'].includes(contact.status)) return false;
    const phone = normalizePhone(contact?.number ?? contact?.value ?? contact?.mobile);
    return isValidSyrianMobile(phone) && phone !== primary;
  }) ?? null;
}

function rejectUnknownKeys(value: unknown, allowed: readonly string[], field: string): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw httpError(400, `invalid_${field}`);
  const unknownFields = Object.keys(value as Record<string, unknown>).filter((key) => !allowed.includes(key));
  if (unknownFields.length) throw httpError(400, 'invalid_form_payload', { field, unknownFields });
}

function nullableDate(value: unknown, field: string): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw httpError(400, `invalid_${field}`);
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed > new Date()) throw httpError(400, `invalid_${field}`);
  return value;
}

function validateCategory(type: ComplaintType, value: unknown, other: unknown): { category: string | null; other: string | null } {
  if (type === 'general') return { category: null, other: null };
  const allowed = type === 'technical' ? TECHNICAL_COMPLAINT_CATEGORIES : DEVICE_COMPLAINT_CATEGORIES;
  const category = enumValue(value, allowed, 'category');
  return { category, other: category === 'other' ? text(other, 'other_category_text', 1, 300) : null };
}

export async function listComplaints(context: AuthContext, raw: Record<string, unknown>) {
  const plan = getComplaintListAccessPlan(context);
  if (plan.scope === 'NONE') throw httpError(403, 'complaint_list_forbidden');
  const page = Math.max(1, Number(raw.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(raw.pageSize) || 25));
  const params: unknown[] = [];
  const where: string[] = [];
  if (plan.scope === 'BRANCH') {
    params.push(plan.allowedBranchIds); where.push(`c.handling_branch_id = ANY($${params.length}::int[])`);
  } else if (plan.scope === 'ASSIGNED') {
    params.push(plan.userId); where.push(`c.assigned_user_id = $${params.length}`);
    params.push(plan.allowedBranchIds); where.push(`c.handling_branch_id = ANY($${params.length}::int[])`);
  }
  if (raw.status) { params.push(enumValue(raw.status, COMPLAINT_STATUSES, 'status')); where.push(`c.status = $${params.length}`); }
  if (raw.type) { params.push(enumValue(raw.type, COMPLAINT_TYPES, 'type')); where.push(`c.complaint_type = $${params.length}`); }
  if (raw.category) { params.push(enumValue(raw.category,[...TECHNICAL_COMPLAINT_CATEGORIES,...DEVICE_COMPLAINT_CATEGORIES] as const,'category')); where.push(`c.category_code = $${params.length}`); }
  if (raw.priority) { params.push(enumValue(raw.priority,COMPLAINT_PRIORITIES,'priority')); where.push(`c.priority = $${params.length}`); }
  if (raw.source) { params.push(enumValue(raw.source,['mobile_app','phone','website','whatsapp','in_person'] as const,'source')); where.push(`c.source_channel = $${params.length}`); }
  if (raw.entryPoint) { params.push(enumValue(raw.entryPoint,['home','visit_detail','device_detail','crm_general','crm_client','crm_visit','crm_device'] as const,'entry_point')); where.push(`c.entry_point = $${params.length}`); }
  if (raw.identitySource) { params.push(enumValue(raw.identitySource,['app_account','visitor_otp','unverified_device','staff_recorded'] as const,'identity_source')); where.push(`c.identity_source = $${params.length}`); }
  for (const [key,column] of [['handlingBranchId','handling_branch_id'],['assigneeId','assigned_user_id'],['fieldVisitId','field_visit_id'],['installedDeviceId','installed_device_id']] as const) {
    if (raw[key] != null && raw[key] !== '') { params.push(positiveInt(raw[key],key,true)); where.push(`c.${column} = $${params.length}`); }
  }
  for (const [key,column] of [['suspectedDuplicate','suspected_duplicate'],['reviewRequired','review_required']] as const) {
    if (raw[key] != null && raw[key] !== '') {
      if (raw[key] !== true && raw[key] !== false && raw[key] !== 'true' && raw[key] !== 'false') throw httpError(400,`invalid_${key}`);
      params.push(raw[key] === true || raw[key] === 'true'); where.push(`c.${column} = $${params.length}`);
    }
  }
  for (const [key,operator] of [['dateFrom','>='],['dateTo','<']] as const) {
    if (raw[key]) {
      const value=String(raw[key]); if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||Number.isNaN(new Date(`${value}T00:00:00Z`).getTime()))throw httpError(400,`invalid_${key}`);
      params.push(value); where.push(`c.created_at ${operator} $${params.length}::date${key==='dateTo'?` + INTERVAL '1 day'`:''}`);
    }
  }
  if (raw.search) {
    params.push(`%${String(raw.search).trim()}%`);
    where.push(`(c.public_ref_number ILIKE $${params.length} OR cr.primary_phone ILIKE $${params.length} OR CONCAT_WS(' ',cr.first_name,cr.middle_name,cr.last_name) ILIKE $${params.length})`);
  }
  const predicate = where.length ? `WHERE ${where.join(' AND ')}` : '';
  params.push(pageSize, (page - 1) * pageSize);
  const result = await pool.query(
    `SELECT c.id, c.public_ref_number AS "complaintId", c.complaint_type AS "complaintType",
            c.source_channel AS "sourceChannel", c.status, c.priority,
            c.suspected_duplicate AS "suspectedDuplicate", c.created_at AS "complaintDate",
            CONCAT_WS(' ',cr.first_name,cr.middle_name,cr.last_name) AS "requesterName",
            b.name AS "handlingBranchName", u.name AS "assignedUserName",
            COUNT(*) OVER()::int AS "totalCount"
       FROM complaints c JOIN complaint_requesters cr ON cr.complaint_id=c.id
       LEFT JOIN branches b ON b.id=c.handling_branch_id
       LEFT JOIN hr_users u ON u.id=c.assigned_user_id
       ${predicate}
      ORDER BY CASE c.priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'normal' THEN 3 ELSE 4 END,
               c.created_at ASC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return { items: result.rows, page, pageSize, total: result.rows[0]?.totalCount ?? 0 };
}

function assertComplaintCreateBranch(context: AuthContext, branchId: number): void {
  if (!canAccessComplaint(context,'complaints.create_internal',{handlingBranchId:branchId,assignedUserId:null}).allowed) {
    throw httpError(403,'complaint_create_forbidden');
  }
}

async function loadComplaintClientSubject(db: Queryable, clientId: number) {
  const {rows}=await db.query(`SELECT c.id,c.branch_id AS "branchId",COALESCE(array_agg(ca.hr_user_id) FILTER(WHERE ca.hr_user_id IS NOT NULL),'{}')::int[] AS "assignedUserIds"
    FROM clients c LEFT JOIN client_assignments ca ON ca.client_id=c.id
    WHERE c.id=$1 AND c.deleted_at IS NULL GROUP BY c.id`,[clientId]);
  if(!rows[0])throw httpError(404,'client_not_available');
  return{...rows[0],branchId:Number(rows[0].branchId),assignedUserIds:(rows[0].assignedUserIds??[]).map(Number)};
}

export function canUseComplaintClientOption(context:AuthContext,subject:{branchId:number;assignedUserIds:number[]}){
  if(!canAccessComplaint(context,'complaints.create_internal',{handlingBranchId:subject.branchId,assignedUserId:null}).allowed)return false;
  const plan=getClientListAccessPlan(context);
  return plan.scope==='GLOBAL'
    || (plan.scope==='BRANCH'&&plan.allowedBranchIds.includes(subject.branchId))
    || (plan.scope==='ASSIGNED'&&plan.allowedBranchIds.includes(subject.branchId)&&subject.assignedUserIds.includes(context.userId));
}

async function assertComplaintClientLookup(context:AuthContext,db:Queryable,clientId:number,branchId:number){
  assertComplaintCreateBranch(context,branchId);
  const subject=await loadComplaintClientSubject(db,clientId);
  if(subject.branchId!==branchId)throw httpError(409,'client_branch_mismatch');
  if(!canUseComplaintClientOption(context,subject))throw httpError(403,'complaint_client_lookup_forbidden');
  return subject;
}

export async function listComplaintCreateBranches(context:AuthContext){
  const plan=resolveListAccessScope(context,'complaints.create_internal');
  if(plan.scope==='NONE'||plan.scope==='ASSIGNED')throw httpError(403,'complaint_create_forbidden');
  const params:unknown[]=[];const where=plan.scope==='GLOBAL'?'':(params.push(plan.allowedBranchIds),`AND b.id=ANY($1::int[])`);
  const {rows}=await pool.query(`SELECT b.id,b.name FROM branches b WHERE b.status='active' ${where} ORDER BY b.name`,params);
  return{items:rows};
}

export async function listComplaintClientOptions(context:AuthContext,branchValue:unknown,searchValue:unknown){
  const branchId=positiveInt(branchValue,'branch_id',true)!;assertComplaintCreateBranch(context,branchId);
  const plan=getClientListAccessPlan(context);if(plan.scope==='NONE')throw httpError(403,'complaint_client_lookup_forbidden');
  if(plan.scope!=='GLOBAL'&&!plan.allowedBranchIds.includes(branchId))throw httpError(403,'complaint_client_lookup_forbidden');
  const params:unknown[]=[branchId];const where=[`c.branch_id=$1`,`c.deleted_at IS NULL`];
  if(plan.scope==='ASSIGNED'){params.push(context.userId);where.push(`EXISTS(SELECT 1 FROM client_assignments ca WHERE ca.client_id=c.id AND ca.hr_user_id=$${params.length})`);}
  const search=typeof searchValue==='string'?searchValue.trim():'';if(search){params.push(`%${search.slice(0,100)}%`);where.push(`(c.name ILIKE $${params.length} OR c.mobile ILIKE $${params.length} OR CONCAT_WS(' ',c.first_name,c.father_name,c.last_name) ILIKE $${params.length})`);}
  const {rows}=await pool.query(`SELECT c.id,COALESCE(NULLIF(c.name,''),CONCAT_WS(' ',c.first_name,c.father_name,c.last_name)) AS name,c.mobile,c.candidate_status AS "candidateStatus" FROM clients c WHERE ${where.join(' AND ')} ORDER BY name LIMIT 200`,params);
  return{items:rows};
}

export async function getComplaintClientOption(context:AuthContext,clientValue:unknown,branchValue:unknown){
  const clientId=positiveInt(clientValue,'client_id',true)!,branchId=positiveInt(branchValue,'branch_id',true)!;
  await assertComplaintClientLookup(context,pool,clientId,branchId);const snapshot=await buildClientSnapshot(pool,clientId);if(!snapshot)throw httpError(404,'client_not_available');
  return{clientId,branchId,snapshot};
}

function assertRelatedLookup(context:AuthContext,permission:string,branchId:number){
  if(!authorize(context,{permission,branchId}).allowed)throw httpError(403,'complaint_related_lookup_forbidden');
}

export async function listComplaintClientDevices(context:AuthContext,clientValue:unknown,branchValue:unknown){
  const clientId=positiveInt(clientValue,'client_id',true)!,branchId=positiveInt(branchValue,'branch_id',true)!;
  await assertComplaintClientLookup(context,pool,clientId,branchId);assertRelatedLookup(context,'clients.devices.view',branchId);
  const {rows}=await pool.query(`SELECT d.id,COALESCE(dm.name_ar,dm.name_en,d.device_model_name,d.external_device_name,'جهاز غير مسمى') AS name,COALESCE(d.serial_number,d.external_device_serial) AS "serialNumber",d.status
    FROM installed_devices d LEFT JOIN device_models dm ON dm.id=d.device_model_id WHERE d.customer_id=$1 AND d.branch_id=$2 ORDER BY d.created_at DESC`,[clientId,branchId]);
  return{items:rows};
}

export async function listComplaintClientVisits(context:AuthContext,clientValue:unknown,branchValue:unknown){
  const clientId=positiveInt(clientValue,'client_id',true)!,branchId=positiveInt(branchValue,'branch_id',true)!;
  await assertComplaintClientLookup(context,pool,clientId,branchId);assertRelatedLookup(context,'clients.visits.view',branchId);
  const {rows}=await pool.query(`SELECT fv.id,fv.scheduled_date AS "scheduledDate",fv.status,fv.visit_type AS "visitType",
      jsonb_strip_nulls(jsonb_build_object('supervisor',COALESCE(sup.name,fv.team_snapshot->>'supervisorName'),'technician',COALESCE(tech.name,fv.team_snapshot->>'technicianName'),'trainee',COALESCE(train.name,fv.team_snapshot->>'traineeName'))) AS team
    FROM field_visits fv
    LEFT JOIN employees sup ON sup.id=COALESCE(fv.reassigned_supervisor_id,NULLIF(fv.team_snapshot->>'supervisorEmployeeId','')::int)
    LEFT JOIN employees tech ON tech.id=COALESCE(fv.reassigned_technician_id,NULLIF(fv.team_snapshot->>'technicianEmployeeId','')::int)
    LEFT JOIN employees train ON train.id=COALESCE(fv.reassigned_trainee_id,NULLIF(fv.team_snapshot->>'traineeEmployeeId','')::int)
    WHERE fv.client_id=$1 AND fv.branch_id=$2 ORDER BY fv.scheduled_date DESC,fv.id DESC`,[clientId,branchId]);
  return{items:rows};
}

export async function getInternalComplaintContext(context: AuthContext, kind: 'visit'|'device', recordId: number) {
  const source = kind === 'visit'
    ? await pool.query(`SELECT id,client_id AS "clientId",branch_id AS "branchId",scheduled_date AS "incidentDate" FROM field_visits WHERE id=$1`,[recordId])
    : await pool.query(`SELECT id,customer_id AS "clientId",branch_id AS "branchId",serial_number AS "deviceNumber" FROM installed_devices WHERE id=$1`,[recordId]);
  const row=source.rows[0]; if(!row)throw httpError(404,kind==='visit'?'visit_not_available':'device_not_available');
  assertComplaintCreateBranch(context,Number(row.branchId));
  await assertComplaintClientLookup(context,pool,Number(row.clientId),Number(row.branchId));
  const sourceAllowed=kind==='visit'
    ? authorize(context,{permission:'clients.visits.view',branchId:Number(row.branchId)}).allowed||authorize(context,{permission:'field_visits.view',branchId:Number(row.branchId)}).allowed
    : authorize(context,{permission:'clients.devices.view',branchId:Number(row.branchId)}).allowed||authorize(context,{permission:'installed_devices.view',branchId:Number(row.branchId)}).allowed;
  if(!sourceAllowed)throw httpError(403,'complaint_related_lookup_forbidden');
  const snapshot=await buildClientSnapshot(pool,Number(row.clientId)); if(!snapshot)throw httpError(404,'linked_client_record_not_found');
  const primary=snapshot.contacts.find((x:any)=>normalizePhone(x?.number??x?.value??x?.mobile)===normalizePhone(snapshot.primaryMobile));
  const secondary=getComplaintSecondaryContact(snapshot.contacts,snapshot.primaryMobile);
  const level=(n:number)=>snapshot.address.geoPath.find(x=>x.level===n)?.id??null;
  return {kind,record:{...row},clientSnapshot:snapshot,requester:{firstName:snapshot.firstName,fatherName:snapshot.fatherName,lastName:snapshot.lastName,
    primaryPhone:normalizePhone(snapshot.primaryMobile),primaryPhoneHasWhatsapp:primary?.hasWhatsApp??null,
    secondaryPhone:secondary?normalizePhone(secondary.number??secondary.value??secondary.mobile):null,secondaryPhoneHasWhatsapp:secondary?.hasWhatsApp??null,
    governorateId:level(1),regionId:level(2),subdistrictId:level(3),neighborhoodId:level(4),detailedAddress:snapshot.address.detailedAddress}};
}

async function loadComplaintSubject(db: Queryable, id: number) {
  const { rows } = await db.query(
    `SELECT id, status, complaint_type AS "complaintType", handling_branch_id AS "handlingBranchId",
            assigned_user_id AS "assignedUserId", current_resolution_id AS "currentResolutionId",
            duplicate_of_complaint_id AS "duplicateOfComplaintId"
       FROM complaints WHERE id=$1`, [id],
  );
  if (!rows[0]) throw httpError(404, 'complaint_not_found');
  return rows[0] as { id: number; status: ComplaintStatus; complaintType: ComplaintType; handlingBranchId: number | null; assignedUserId: number | null; currentResolutionId: number | null; duplicateOfComplaintId: number | null };
}

export async function getComplaint(context: AuthContext, id: number) {
  const subject = await loadComplaintSubject(pool, id);
  if (!canAccessComplaint(context, 'complaints.view_details', subject).allowed) throw httpError(403, 'complaint_forbidden');
  const { rows } = await pool.query(
    `SELECT c.*, b.name AS handling_branch_name, u.name AS assigned_user_name,
            row_to_json(cr) AS requester,
            row_to_json(td) AS "technicalDetails", row_to_json(dd) AS "deviceDetails",
            (SELECT COALESCE(json_agg(x ORDER BY x.created_at), '[]') FROM complaint_public_updates x WHERE x.complaint_id=c.id) AS "publicUpdates",
            (SELECT COALESCE(json_agg(x ORDER BY x.created_at), '[]') FROM complaint_status_history x WHERE x.complaint_id=c.id) AS "statusHistory",
            (SELECT COALESCE(json_agg(x ORDER BY x.created_at), '[]') FROM complaint_internal_notes x WHERE x.complaint_id=c.id) AS "internalNotes",
            (SELECT COALESCE(json_agg(x ORDER BY x.created_at), '[]') FROM complaint_resolutions x WHERE x.complaint_id=c.id) AS resolutions,
            (SELECT COALESCE(json_agg(json_build_object('id',ca.id,'mediaFileId',ca.media_file_id,'createdAt',ca.created_at) ORDER BY ca.created_at), '[]') FROM complaint_attachments ca WHERE ca.complaint_id=c.id) AS attachments
       FROM complaints c JOIN complaint_requesters cr ON cr.complaint_id=c.id
       LEFT JOIN branches b ON b.id=c.handling_branch_id
       LEFT JOIN hr_users u ON u.id=c.assigned_user_id
       LEFT JOIN complaint_technical_details td ON td.complaint_id=c.id
       LEFT JOIN complaint_device_details dd ON dd.complaint_id=c.id
      WHERE c.id=$1`, [id],
  );
  const detail=rows[0];
  if (!canAccessComplaint(context,'complaints.view_attachments',subject).allowed) detail.attachments=[];
  return detail;
}

export async function createInternalComplaint(context: AuthContext, input: Record<string, any>) {
  rejectUnknownKeys(input, ['complaintType','categoryCode','otherCategoryText','description','sourceChannel','entryPoint','fieldVisitId','installedDeviceId','incidentDate','reportedTargetName','deviceName','deviceSerialNumber','lastMaintenanceDate','requester','originBranchId','targetBranchId','requesterClientId','expectedContactMethod'], 'complaint');
  if(input.requester!=null)rejectUnknownKeys(input.requester, ['firstName','fatherName','lastName','primaryPhone','primaryPhoneHasWhatsapp','secondaryPhone','secondaryPhoneHasWhatsapp','governorateId','regionId','subdistrictId','neighborhoodId','detailedAddress'], 'requester');
  const sourceChannel = enumValue(input.sourceChannel, ['phone', 'website', 'whatsapp', 'in_person'] as const, 'source_channel');
  const entryPoint = enumValue(input.entryPoint, ['crm_general', 'crm_client', 'crm_visit', 'crm_device'] as const, 'entry_point');
  const expectedContactMethod = enumValue(input.expectedContactMethod ?? 'no_preference', ['phone', 'whatsapp', 'sms', 'no_preference'] as const, 'expected_contact_method');
  let contextual: { type: ComplaintType; originBranchId: number | null; clientId: number | null; fieldVisitId: number | null; installedDeviceId: number | null; snapshot: any; incidentDate?: string | null } | null = null;
  if (entryPoint === 'crm_visit') {
    const visitId = positiveInt(input.fieldVisitId, 'field_visit_id', true)!;
    const { rows } = await pool.query(`SELECT fv.id,fv.client_id,fv.branch_id,fv.scheduled_date,fv.visit_type,fv.team_snapshot,fv.reassigned_supervisor_id,fv.reassigned_technician_id,
      jsonb_strip_nulls(jsonb_build_object('supervisor',COALESCE(sup.name,fv.team_snapshot->>'supervisorName'),'technician',COALESCE(tech.name,fv.team_snapshot->>'technicianName'),'trainee',COALESCE(train.name,fv.team_snapshot->>'traineeName'))) AS effective_team
      FROM field_visits fv
      LEFT JOIN employees sup ON sup.id=COALESCE(fv.reassigned_supervisor_id,NULLIF(fv.team_snapshot->>'supervisorEmployeeId','')::int)
      LEFT JOIN employees tech ON tech.id=COALESCE(fv.reassigned_technician_id,NULLIF(fv.team_snapshot->>'technicianEmployeeId','')::int)
      LEFT JOIN employees train ON train.id=COALESCE(fv.reassigned_trainee_id,NULLIF(fv.team_snapshot->>'traineeEmployeeId','')::int)
      WHERE fv.id=$1`, [visitId]);
    if (!rows[0]) throw httpError(404, 'visit_not_available');
    if(!authorize(context,{permission:'clients.visits.view',branchId:Number(rows[0].branch_id)}).allowed&&!authorize(context,{permission:'field_visits.view',branchId:Number(rows[0].branch_id)}).allowed)throw httpError(403,'complaint_related_lookup_forbidden');
    contextual = { type:'technical', originBranchId:rows[0].branch_id, clientId:rows[0].client_id, fieldVisitId:visitId, installedDeviceId:null, snapshot:rows[0], incidentDate:rows[0].scheduled_date };
  } else if (entryPoint === 'crm_device') {
    const deviceId = positiveInt(input.installedDeviceId, 'installed_device_id', true)!;
    const { rows } = await pool.query(`SELECT d.id,d.customer_id,d.branch_id,d.serial_number,d.device_model_name,d.external_device_name,d.status,dm.name_ar AS model_name_ar,dm.name_en AS model_name_en FROM installed_devices d LEFT JOIN device_models dm ON dm.id=d.device_model_id WHERE d.id=$1`, [deviceId]);
    if (!rows[0]) throw httpError(404, 'device_not_available');
    if(!authorize(context,{permission:'clients.devices.view',branchId:Number(rows[0].branch_id)}).allowed&&!authorize(context,{permission:'installed_devices.view',branchId:Number(rows[0].branch_id)}).allowed)throw httpError(403,'complaint_related_lookup_forbidden');
    contextual = { type:'device', originBranchId:rows[0].branch_id, clientId:rows[0].customer_id, fieldVisitId:null, installedDeviceId:deviceId, snapshot:rows[0] };
  }
  const originBranchId = positiveInt(contextual?.originBranchId ?? input.originBranchId, 'origin_branch_id', true)!;
  assertComplaintCreateBranch(context,originBranchId);
  const requestedClientId=positiveInt(input.requesterClientId,'requester_client_id');
  const linkedClientId=contextual?.clientId??requestedClientId;
  if(contextual?.clientId&&requestedClientId&&contextual.clientId!==requestedClientId)throw httpError(409,'complaint_context_mismatch');
  let clientSnapshot:any=null;
  if(linkedClientId){await assertComplaintClientLookup(context,pool,linkedClientId,originBranchId);clientSnapshot=await buildClientSnapshot(pool,linkedClientId);if(!clientSnapshot)throw httpError(404,'client_not_available');}
  const type = contextual?.type ?? enumValue(input.complaintType, COMPLAINT_TYPES, 'complaint_type');
  const { category, other } = validateCategory(type, input.categoryCode, input.otherCategoryText);
  const primaryContact=clientSnapshot?.contacts?.find((x:any)=>normalizePhone(x?.number??x?.value??x?.mobile)===normalizePhone(clientSnapshot.primaryMobile));
  const secondaryContact=getComplaintSecondaryContact(clientSnapshot?.contacts,clientSnapshot?.primaryMobile);
  const level=(n:number)=>clientSnapshot?.address?.geoPath?.find((x:any)=>x.level===n)?.id??null;
  const requester=clientSnapshot?{
    firstName:clientSnapshot.firstName,fatherName:clientSnapshot.fatherName,lastName:clientSnapshot.lastName,primaryPhone:clientSnapshot.primaryMobile,
    primaryPhoneHasWhatsapp:primaryContact?.hasWhatsApp??null,secondaryPhone:secondaryContact?.number??secondaryContact?.value??secondaryContact?.mobile??null,secondaryPhoneHasWhatsapp:secondaryContact?.hasWhatsApp??null,
    governorateId:level(1),regionId:level(2),subdistrictId:level(3),neighborhoodId:level(4),detailedAddress:clientSnapshot.address.detailedAddress,
  }:input.requester;
  if(!requester)throw httpError(400,'requester_required');
  const primaryPhone = normalizePhone(requester.primaryPhone);
  const secondaryPhone = normalizePhone(requester.secondaryPhone);
  if (!isValidSyrianMobile(primaryPhone)) throw httpError(400, 'invalid_primary_phone');
  if (secondaryPhone && !isValidSyrianMobile(secondaryPhone)) throw httpError(400, 'invalid_secondary_phone');
  if (!secondaryPhone && requester.secondaryPhoneHasWhatsapp != null) throw httpError(400, 'secondary_whatsapp_without_phone');
  const address = clientSnapshot?{
    ids:{governorate:requester.governorateId,cityOrArea:requester.regionId,subArea:requester.subdistrictId,neighborhood:requester.neighborhoodId},
    labels:{governorate:clientSnapshot.address.governorate,cityOrArea:clientSnapshot.address.district,subArea:clientSnapshot.address.subArea,neighborhood:clientSnapshot.address.neighborhood},
  }:await resolveAndValidateAddress({governorate:requester.governorateId,cityOrArea:requester.regionId,subArea:requester.subdistrictId,neighborhood:requester.neighborhoodId});
  if(!address.ids.governorate)throw httpError(409,'client_profile_incomplete');
  if(!clientSnapshot){
    if(!authorize(context,{permission:'geo_units.lookup',branchId:originBranchId}).allowed)throw httpError(403,'complaint_geo_lookup_forbidden');
    const deepest=address.ids.neighborhood??address.ids.subArea??address.ids.cityOrArea??address.ids.governorate;
    const geoCheck=await assertGeoUnitInScope(context,deepest,'geo_units.lookup',originBranchId);if(!geoCheck.allowed)throw httpError(403,geoCheck.reason??'complaint_geo_out_of_scope');
  }
  const description = text(input.description, 'description', 20, 5000);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const seq = await client.query(`SELECT nextval('complaint_public_ref_seq') AS value`);
    const ref = `CMP-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${String(seq.rows[0].value).padStart(6,'0')}`;
    const inserted = await client.query(
      `INSERT INTO complaints(public_ref_number,complaint_type,category_code,other_category_text,description,
        entry_point,source_channel,identity_source,origin_branch_id,target_branch_id,requester_client_id,
        expected_contact_method,entered_by_user_id,field_visit_id,installed_device_id,context_snapshot)
       VALUES($1,$2,$3,$4,$5,$6,$7,'staff_recorded',$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
      [ref,type,category,other,description,entryPoint,sourceChannel,originBranchId,
       positiveInt(input.targetBranchId,'target_branch_id'),linkedClientId,
       expectedContactMethod,context.userId,contextual?.fieldVisitId ?? null,contextual?.installedDeviceId ?? null,
       contextual ? JSON.stringify(contextual.snapshot) : null],
    );
    const complaintId = Number(inserted.rows[0].id);
    await client.query(
      `INSERT INTO complaint_requesters(complaint_id,first_name,middle_name,last_name,primary_phone,
        primary_phone_has_whatsapp,secondary_phone,secondary_phone_has_whatsapp,governorate_id,region_id,
        subdistrict_id,neighborhood_id,detailed_address,address_snapshot,link_status)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [complaintId,text(requester.firstName,'first_name',1,60),optionalText(requester.fatherName,'father_name',60),
       text(requester.lastName,'last_name',1,60),primaryPhone,optionalBoolean(requester.primaryPhoneHasWhatsapp,'primary_phone_has_whatsapp'),
       secondaryPhone || null,secondaryPhone ? optionalBoolean(requester.secondaryPhoneHasWhatsapp,'secondary_phone_has_whatsapp') : null,
       address.ids.governorate,address.ids.cityOrArea,address.ids.subArea,address.ids.neighborhood,
       optionalText(requester.detailedAddress,'detailed_address',500),JSON.stringify(address.labels),linkedClientId ? 'linked':'unlinked'],
    );
    if (type === 'technical') await client.query(
      `INSERT INTO complaint_technical_details(complaint_id,incident_date,reported_target_name,visit_snapshot) VALUES($1,$2,$3,$4)`,
      [complaintId,contextual?.incidentDate ?? nullableDate(input.incidentDate,'incident_date'),contextual?.fieldVisitId?Object.values(contextual.snapshot.effective_team??{}).filter(Boolean).join('، ')||null:optionalText(input.reportedTargetName,'reported_target_name',200),contextual?.fieldVisitId ? JSON.stringify(contextual.snapshot) : null],
    );
    if (type === 'device') await client.query(
      `INSERT INTO complaint_device_details(complaint_id,manual_device_name,manual_device_serial,reported_last_maintenance_date,device_snapshot) VALUES($1,$2,$3,$4,$5)`,
      [complaintId,contextual?.installedDeviceId ? null : text(input.deviceName,'device_name',1,255),contextual?.installedDeviceId ? null : text(input.deviceSerialNumber,'device_serial_number',1,255),nullableDate(input.lastMaintenanceDate,'last_maintenance_date'),contextual?.installedDeviceId ? JSON.stringify(contextual.snapshot) : null],
    );
    await client.query(`INSERT INTO complaint_status_history(complaint_id,to_status,actor_user_id) VALUES($1,'new',$2)`,[complaintId,context.userId]);
    await client.query(`INSERT INTO complaint_public_updates(complaint_id,public_status,message,is_system,published_by_user_id) VALUES($1,'received','تم استلام الشكوى',TRUE,$2)`,[complaintId,context.userId]);
    await client.query(`INSERT INTO complaint_audit_log(complaint_id,event_type,actor_type,actor_user_id,metadata) VALUES($1,'complaint_created','staff',$2,$3)`,[complaintId,context.userId,JSON.stringify({ source: sourceChannel })]);
    await client.query('COMMIT');
    return { id: complaintId, complaintId: ref, status: 'new' as const };
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}

const PUBLIC_STATUS: Record<ComplaintStatus, string> = {
  new:'received',triaged:'under_review',assigned:'under_review',in_progress:'in_progress',
  awaiting_complainant:'information_required',resolved:'resolved',closed:'closed',
  rejected:'closed',withdrawn:'closed',
};

export const COMPLAINT_STATUS_UPDATE_SQL = `UPDATE complaints
  SET status=$2::varchar(30),
      current_resolution_id=COALESCE($3::bigint,current_resolution_id),
      closed_at=CASE WHEN $2::varchar(30)='closed' THEN NOW() ELSE NULL END
  WHERE id=$1`;

export async function transitionComplaint(context: AuthContext, id: number, input: {
  to: ComplaintStatus; permission: string; reason?: unknown; outcome?: unknown; internalNotes?: unknown; publicSummary?: unknown;
}) {
  const to = enumValue(input.to, COMPLAINT_STATUSES, 'status');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const subject = await loadComplaintSubject(client, id);
    if (!canAccessComplaint(context,input.permission,subject).allowed) throw httpError(403,'complaint_action_forbidden');
    if (!isComplaintTransitionAllowed(subject.status,to)) throw httpError(409,'invalid_status_transition',{ from:subject.status,to });
    let resolutionId: number | null = null;
    if (to === 'resolved') {
      const outcome = enumValue(input.outcome, COMPLAINT_OUTCOMES, 'outcome') as ComplaintOutcome;
      if(outcome==='duplicate_confirmed'&&!subject.duplicateOfComplaintId)throw httpError(409,'duplicate_target_required');
      const resolution = await client.query(
        `INSERT INTO complaint_resolutions(complaint_id,outcome,internal_notes,public_summary,resolved_by_user_id) VALUES($1,$2,$3,$4,$5) RETURNING id`,
        [id,outcome,text(input.internalNotes,'internal_notes',3,5000),text(input.publicSummary,'public_summary',3,2000),context.userId],
      );
      resolutionId = Number(resolution.rows[0].id);
    }
    await client.query(COMPLAINT_STATUS_UPDATE_SQL,[id,to,resolutionId]);
    const reason = optionalText(input.reason,'reason',2000);
    await client.query(`INSERT INTO complaint_status_history(complaint_id,from_status,to_status,reason,actor_user_id) VALUES($1,$2,$3,$4,$5)`,[id,subject.status,to,reason,context.userId]);
    const publicMessage = to === 'resolved' ? text(input.publicSummary,'public_summary',3,2000) : `تم تحديث حالة الشكوى إلى ${PUBLIC_STATUS[to]}`;
    await client.query(`INSERT INTO complaint_public_updates(complaint_id,public_status,message,is_system,published_by_user_id) VALUES($1,$2,$3,TRUE,$4)`,[id,PUBLIC_STATUS[to],publicMessage,context.userId]);
    await client.query(`INSERT INTO complaint_audit_log(complaint_id,event_type,actor_type,actor_user_id,metadata) VALUES($1,'status_changed','staff',$2,$3)`,[id,context.userId,JSON.stringify({ from:subject.status,to })]);
    await client.query('COMMIT');
    return { id, status: to };
  } catch(error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}

export async function assignComplaintBranch(context: AuthContext,id:number,branchId:number,reason?:unknown,mode?:'assign'|'transfer') {
  const subject=await loadComplaintSubject(pool,id);
  const permission=subject.handlingBranchId == null?'complaints.assign_branch':'complaints.transfer_branch';
  if ((mode === 'assign' && subject.handlingBranchId != null) || (mode === 'transfer' && subject.handlingBranchId == null)) throw httpError(409,'complaint_assignment_mode_mismatch');
  if (!canAccessComplaint(context,permission,subject).allowed) throw httpError(403,'complaint_action_forbidden');
  const client=await pool.connect();
  try { await client.query('BEGIN');
    await client.query(`UPDATE complaints SET handling_branch_id=$2,assigned_user_id=NULL WHERE id=$1`,[id,branchId]);
    await client.query(`INSERT INTO complaint_assignments(complaint_id,assignment_type,from_branch_id,to_branch_id,reason,assigned_by_user_id) VALUES($1,'branch',$2,$3,$4,$5)`,[id,subject.handlingBranchId,branchId,optionalText(reason,'reason',2000),context.userId]);
    await client.query(`INSERT INTO complaint_audit_log(complaint_id,event_type,actor_type,actor_user_id,metadata) VALUES($1,'handling_branch_assigned','staff',$2,$3)`,[id,context.userId,JSON.stringify({ from:subject.handlingBranchId,to:branchId })]);
    await client.query('COMMIT'); return {id,handlingBranchId:branchId};
  } catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}

export async function assignComplaintHandler(context:AuthContext,id:number,userId:number,reason?:unknown,mode?:'assign'|'reassign'){
  const subject=await loadComplaintSubject(pool,id);
  if (!subject.handlingBranchId) throw httpError(409,'handling_branch_required');
  const permission=subject.assignedUserId==null?'complaints.assign_handler':'complaints.reassign_handler';
  if((mode==='assign'&&subject.assignedUserId!=null)||(mode==='reassign'&&subject.assignedUserId==null))throw httpError(409,'complaint_assignment_mode_mismatch');
  if(!canAccessComplaint(context,permission,subject).allowed) throw httpError(403,'complaint_action_forbidden');
  const eligible=await pool.query(`SELECT 1 FROM hr_users u WHERE u.id=$1 AND u.is_active=TRUE AND EXISTS(SELECT 1 FROM user_branch_assignments uba WHERE uba.user_id=u.id AND uba.branch_id=$2 AND uba.status='active')`,[userId,subject.handlingBranchId]);
  if(!eligible.rowCount) throw httpError(400,'handler_not_in_handling_branch');
  const client=await pool.connect();
  try{await client.query('BEGIN');
    await client.query(`UPDATE complaints SET assigned_user_id=$2,status=CASE WHEN status='triaged' THEN 'assigned' ELSE status END WHERE id=$1`,[id,userId]);
    await client.query(`INSERT INTO complaint_assignments(complaint_id,assignment_type,from_user_id,to_user_id,assigned_by_user_id,reason) VALUES($1,'handler',$2,$3,$4,$5)`,[id,subject.assignedUserId,userId,context.userId,optionalText(reason,'reason',2000)]);
    if(subject.status==='triaged') await client.query(`INSERT INTO complaint_status_history(complaint_id,from_status,to_status,actor_user_id) VALUES($1,'triaged','assigned',$2)`,[id,context.userId]);
    if(subject.status==='triaged') await client.query(`INSERT INTO complaint_public_updates(complaint_id,public_status,message,is_system,published_by_user_id) VALUES($1,'under_review','الشكوى قيد المراجعة',TRUE,$2)`,[id,context.userId]);
    await client.query(`INSERT INTO complaint_audit_log(complaint_id,event_type,actor_type,actor_user_id,metadata) VALUES($1,'handler_assigned','staff',$2,$3)`,[id,context.userId,JSON.stringify({from:subject.assignedUserId,to:userId})]);
    await client.query('COMMIT');return{id,assignedUserId:userId,status:subject.status==='triaged'?'assigned':subject.status};
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}

export async function listComplaintAssignmentBranches(context:AuthContext,id:number){
  const subject=await loadComplaintSubject(pool,id);
  const permission=subject.handlingBranchId==null?'complaints.assign_branch':'complaints.transfer_branch';
  if(!canAccessComplaint(context,permission,subject).allowed)throw httpError(403,'complaint_action_forbidden');
  const {rows}=await pool.query(`SELECT id,name FROM branches WHERE status='active' ORDER BY name`);
  return{items:rows};
}

export async function listComplaintAssignmentHandlers(context:AuthContext,id:number){
  const subject=await loadComplaintSubject(pool,id);
  if(!subject.handlingBranchId)throw httpError(409,'handling_branch_required');
  const permission=subject.assignedUserId==null?'complaints.assign_handler':'complaints.reassign_handler';
  if(!canAccessComplaint(context,permission,subject).allowed)throw httpError(403,'complaint_action_forbidden');
  const {rows}=await pool.query(`SELECT DISTINCT u.id,u.name,u.username
    FROM hr_users u JOIN user_branch_assignments uba ON uba.user_id=u.id
    WHERE u.is_active=TRUE AND uba.branch_id=$1 AND uba.status='active'
    ORDER BY u.name,u.username`,[subject.handlingBranchId]);
  return{items:rows,handlingBranchId:subject.handlingBranchId};
}

export async function addComplaintText(context:AuthContext,id:number,kind:'note'|'update',value:unknown){
  const subject=await loadComplaintSubject(pool,id);
  const permission=kind==='note'?'complaints.add_internal_note':'complaints.publish_update';
  if(!canAccessComplaint(context,permission,subject).allowed) throw httpError(403,'complaint_action_forbidden');
  const message=text(value,kind==='note'?'note':'message',2,5000);
  const client=await pool.connect();try{await client.query('BEGIN');
    if(kind==='note') await client.query(`INSERT INTO complaint_internal_notes(complaint_id,note,created_by_user_id) VALUES($1,$2,$3)`,[id,message,context.userId]);
    else await client.query(`INSERT INTO complaint_public_updates(complaint_id,public_status,message,published_by_user_id) VALUES($1,$2,$3,$4)`,[id,PUBLIC_STATUS[subject.status],message,context.userId]);
    await client.query(`INSERT INTO complaint_audit_log(complaint_id,event_type,actor_type,actor_user_id,metadata) VALUES($1,$2,'staff',$3,$4)`,[id,kind==='note'?'internal_note_added':'public_update_published',context.userId,JSON.stringify({length:message.length})]);
    await client.query('COMMIT');return{ok:true};
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}

export async function changeComplaintPriority(context:AuthContext,id:number,value:unknown){
  const subject=await loadComplaintSubject(pool,id);
  if(!canAccessComplaint(context,'complaints.change_priority',subject).allowed) throw httpError(403,'complaint_action_forbidden');
  const priority=enumValue(value,COMPLAINT_PRIORITIES,'priority') as ComplaintPriority;
  const client=await pool.connect();try{await client.query('BEGIN');await client.query(`UPDATE complaints SET priority=$2 WHERE id=$1`,[id,priority]);await client.query(`INSERT INTO complaint_audit_log(complaint_id,event_type,actor_type,actor_user_id,metadata) VALUES($1,'priority_changed','staff',$2,$3)`,[id,context.userId,JSON.stringify({to:priority})]);await client.query('COMMIT');return{id,priority};}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}

export async function changeComplaintType(context:AuthContext,id:number,input:Record<string,unknown>){
  const client=await pool.connect();try{await client.query('BEGIN');const subject=await loadComplaintSubject(client,id);
    if(!canAccessComplaint(context,'complaints.change_type',subject).allowed)throw httpError(403,'complaint_action_forbidden');
    if(!['new','triaged'].includes(subject.status))throw httpError(409,'complaint_type_locked');
    const {rows}=await client.query(`SELECT field_visit_id,installed_device_id FROM complaints WHERE id=$1 FOR UPDATE`,[id]);
    const type=enumValue(input.complaintType,COMPLAINT_TYPES,'complaint_type');
    if((rows[0].field_visit_id&&type!=='technical')||(rows[0].installed_device_id&&type!=='device'))throw httpError(409,'complaint_context_mismatch');
    const cat=validateCategory(type,input.categoryCode,input.otherCategoryText);
    await client.query(`UPDATE complaints SET complaint_type=$2,category_code=$3,other_category_text=$4 WHERE id=$1`,[id,type,cat.category,cat.other]);
    await client.query(`DELETE FROM complaint_technical_details WHERE complaint_id=$1`,[id]);await client.query(`DELETE FROM complaint_device_details WHERE complaint_id=$1`,[id]);
    if(type==='technical')await client.query(`INSERT INTO complaint_technical_details(complaint_id,incident_date,reported_target_name) VALUES($1,$2,$3)`,[id,nullableDate(input.incidentDate,'incident_date'),optionalText(input.reportedTargetName,'reported_target_name',200)]);
    if(type==='device')await client.query(`INSERT INTO complaint_device_details(complaint_id,manual_device_name,manual_device_serial,reported_last_maintenance_date) VALUES($1,$2,$3,$4)`,[id,rows[0].installed_device_id?null:text(input.deviceName,'device_name',1,255),rows[0].installed_device_id?null:text(input.deviceSerialNumber,'device_serial_number',1,255),nullableDate(input.lastMaintenanceDate,'last_maintenance_date')]);
    await client.query(`INSERT INTO complaint_audit_log(complaint_id,event_type,actor_type,actor_user_id,metadata) VALUES($1,'complaint_type_changed','staff',$2,$3)`,[id,context.userId,JSON.stringify({from:subject.complaintType,to:type})]);await client.query('COMMIT');return{id,complaintType:type};
  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}

export async function linkComplaintEntity(context:AuthContext,id:number,kind:'requester'|'visit'|'device'|'target'|'operational',input:Record<string,unknown>){
  const permission={requester:'complaints.link_requester',visit:'complaints.link_visit',device:'complaints.link_device',target:'complaints.link_target',operational:'complaints.link_operational_work'}[kind];
  const client=await pool.connect();try{await client.query('BEGIN');const subject=await loadComplaintSubject(client,id);if(!canAccessComplaint(context,permission,subject).allowed)throw httpError(403,'complaint_action_forbidden');
    let metadata:Record<string,unknown>={kind};
    if(kind==='requester'){const clientId=positiveInt(input.clientId,'client_id',true)!;const exists=await client.query(`SELECT 1 FROM clients WHERE id=$1 AND deleted_at IS NULL`,[clientId]);if(!exists.rowCount)throw httpError(404,'client_not_found');await client.query(`UPDATE complaints SET requester_client_id=$2 WHERE id=$1`,[id,clientId]);await client.query(`UPDATE complaint_requesters SET link_status='linked' WHERE complaint_id=$1`,[id]);metadata.clientId=clientId;}
    if(kind==='visit'){if(subject.complaintType!=='technical')throw httpError(409,'complaint_context_mismatch');const visitId=positiveInt(input.fieldVisitId,'field_visit_id',true)!;const {rows}=await client.query(`SELECT id,branch_id,scheduled_date,visit_type,team_snapshot FROM field_visits WHERE id=$1`,[visitId]);if(!rows[0])throw httpError(404,'visit_not_available');await client.query(`UPDATE complaints SET field_visit_id=$2,context_snapshot=$3 WHERE id=$1`,[id,visitId,JSON.stringify(rows[0])]);await client.query(`UPDATE complaint_technical_details SET visit_snapshot=$2,incident_date=COALESCE(incident_date,$3) WHERE complaint_id=$1`,[id,JSON.stringify(rows[0]),rows[0].scheduled_date]);metadata.fieldVisitId=visitId;}
    if(kind==='device'){if(subject.complaintType!=='device')throw httpError(409,'complaint_context_mismatch');const deviceId=positiveInt(input.installedDeviceId,'installed_device_id',true)!;const {rows}=await client.query(`SELECT id,branch_id,serial_number,device_model_name,external_device_name,status FROM installed_devices WHERE id=$1`,[deviceId]);if(!rows[0])throw httpError(404,'device_not_available');await client.query(`UPDATE complaints SET installed_device_id=$2,context_snapshot=$3 WHERE id=$1`,[id,deviceId,JSON.stringify(rows[0])]);await client.query(`UPDATE complaint_device_details SET device_snapshot=$2 WHERE complaint_id=$1`,[id,JSON.stringify(rows[0])]);metadata.installedDeviceId=deviceId;}
    if(kind==='target'){const targetType=choiceTarget(input.targetType);const entityId=positiveInt(input.targetEntityId,'target_entity_id');const snapshot=input.targetSnapshot&&typeof input.targetSnapshot==='object'?input.targetSnapshot:{};const inserted=await client.query(`INSERT INTO complaint_targets(complaint_id,target_type,target_entity_id,target_snapshot,linked_by_user_id) VALUES($1,$2,$3,$4,$5) RETURNING id`,[id,targetType,entityId,JSON.stringify(snapshot),context.userId]);metadata.targetId=inserted.rows[0].id;}
    if(kind==='operational'){const entityType=text(input.entityType,'entity_type',1,40),entityId=positiveInt(input.entityId,'entity_id',true)!,relationType=text(input.relationType,'relation_type',1,40);await client.query(`INSERT INTO complaint_operational_links(complaint_id,entity_type,entity_id,relation_type,created_by_user_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,[id,entityType,entityId,relationType,context.userId]);metadata={kind,entityType,entityId,relationType};}
    await client.query(`INSERT INTO complaint_audit_log(complaint_id,event_type,actor_type,actor_user_id,metadata) VALUES($1,'entity_linked','staff',$2,$3)`,[id,context.userId,JSON.stringify(metadata)]);await client.query('COMMIT');return{ok:true,...metadata};
  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}

function choiceTarget(value:unknown){return enumValue(value,['employee','field_team','branch','field_visit','service_execution','unknown'] as const,'target_type');}

export async function reviewComplaintDuplicate(context:AuthContext,id:number,input:{confirmed?:unknown;duplicateOfComplaintId?:unknown}){
  const client=await pool.connect();try{await client.query('BEGIN');const subject=await loadComplaintSubject(client,id);
    if(!canAccessComplaint(context,'complaints.review_duplicates',subject).allowed)throw httpError(403,'complaint_action_forbidden');
    const confirmed=input.confirmed===true;const targetId=confirmed?positiveInt(input.duplicateOfComplaintId,'duplicate_of_complaint_id',true):null;
    if(targetId===id)throw httpError(400,'duplicate_target_invalid');
    if(targetId){const target=await client.query(`SELECT 1 FROM complaints WHERE id=$1`,[targetId]);if(!target.rowCount)throw httpError(404,'duplicate_target_not_found');}
    await client.query(`UPDATE complaints SET suspected_duplicate=FALSE,duplicate_of_complaint_id=$2 WHERE id=$1`,[id,targetId]);
    await client.query(`INSERT INTO complaint_audit_log(complaint_id,event_type,actor_type,actor_user_id,metadata) VALUES($1,'duplicate_reviewed','staff',$2,$3)`,[id,context.userId,JSON.stringify({confirmed,duplicateOfComplaintId:targetId})]);
    await client.query('COMMIT');return{id,confirmed,duplicateOfComplaintId:targetId};
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}

const SETTINGS={
  duplicates:{permission:'complaints.manage_duplicate_settings',keys:['complaints_duplicate_detection_enabled','complaints_duplicate_visit_window_days','complaints_duplicate_device_window_days','complaints_duplicate_exact_text_window_hours']},
  abuse:{permission:'complaints.manage_abuse_settings',keys:['complaints_unverified_device_daily_limit','complaints_unverified_ip_daily_limit','complaints_unverified_phone_daily_limit','complaints_verified_phone_daily_limit','complaints_account_daily_limit','complaints_upload_daily_byte_limit']},
} as const;

export async function getComplaintSettings(context:AuthContext,kind:keyof typeof SETTINGS){
  const cfg=SETTINGS[kind];if(!canAccessComplaint(context,cfg.permission,{handlingBranchId:null,assignedUserId:null}).allowed)throw httpError(403,'complaint_settings_forbidden');
  const {rows}=await pool.query(`SELECT key,value,value_type,description FROM system_settings WHERE key=ANY($1::text[]) ORDER BY key`,[[...cfg.keys]]);return{items:rows};
}

export async function updateComplaintSettings(context:AuthContext,kind:keyof typeof SETTINGS,input:Record<string,unknown>){
  const cfg=SETTINGS[kind];if(!canAccessComplaint(context,cfg.permission,{handlingBranchId:null,assignedUserId:null}).allowed)throw httpError(403,'complaint_settings_forbidden');
  const client=await pool.connect();try{await client.query('BEGIN');for(const key of cfg.keys){if(!(key in input))continue;const raw=input[key];const value=key.endsWith('_enabled')?(raw===true?'true':raw===false?'false':null):(Number.isInteger(Number(raw))&&Number(raw)>=0?String(Number(raw)):null);if(value==null)throw httpError(400,'invalid_complaint_setting',{key});const old=await client.query(`SELECT value FROM system_settings WHERE key=$1 FOR UPDATE`,[key]);await client.query(`UPDATE system_settings SET value=$2,updated_by=$3,updated_at=NOW() WHERE key=$1`,[key,value,context.userId]);await insertAuditLog(client,{entityType:'complaint_setting',entityId:0,actionType:'complaint_setting_updated',performedByUserId:context.userId,oldValue:JSON.stringify({key,value:old.rows[0]?.value??null}),newValue:JSON.stringify({key,value})});}await client.query('COMMIT');return getComplaintSettings(context,kind);}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}

export async function getComplaintReport(context:AuthContext){
  const plan=resolveListAccessScope(context,'complaints.view_reports');if(plan.scope==='NONE'||plan.scope==='ASSIGNED')throw httpError(403,'complaint_reports_forbidden');
  const params:unknown[]=[];const where=plan.scope==='BRANCH'?(params.push(plan.allowedBranchIds),`WHERE c.handling_branch_id=ANY($1::int[])`):'';
  const {rows}=await pool.query(`SELECT COUNT(*)::int AS total,
    COALESCE(jsonb_object_agg(status,status_count),'{}') AS "byStatus",
    COALESCE(jsonb_object_agg(complaint_type,type_count),'{}') AS "byType",
    AVG(EXTRACT(EPOCH FROM (resolved_at-created_at))/3600) FILTER(WHERE resolved_at IS NOT NULL) AS "averageResolutionHours"
    FROM (SELECT c.*,COUNT(*) OVER(PARTITION BY status)::int status_count,COUNT(*) OVER(PARTITION BY complaint_type)::int type_count,
      (SELECT MIN(h.created_at) FROM complaint_status_history h WHERE h.complaint_id=c.id AND h.to_status='resolved') resolved_at
      FROM complaints c ${where}) c`,params);
  return rows[0];
}
