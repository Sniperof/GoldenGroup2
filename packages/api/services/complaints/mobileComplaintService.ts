import crypto from 'node:crypto';
import type { PoolClient } from 'pg';
import type { AppAccountClaims } from '../appAccounts/appAuthService.js';
import type { ComplaintType } from '@golden-crm/shared';
import { COMPLAINT_TYPES } from '@golden-crm/shared';
import pool from '../../db.js';
import { getMyProfile } from '../appAccounts/appProfileService.js';
import { resolveAndValidateAddress } from '../geo/administrativeAddress.js';
import { isValidSyrianMobile, normalizePhone } from '../../utils/contactValidation.js';
import { DEVICE_COMPLAINT_CATEGORIES, TECHNICAL_COMPLAINT_CATEGORIES } from '@golden-crm/shared';

const HANDLE_TTL_MS = 10 * 60 * 1000;

type PublicComplaintRow = Record<string, any> & {
  __entryPoint?: unknown;
  __fieldVisitId?: unknown;
  __installedDeviceId?: unknown;
  __contextSnapshot?: unknown;
  __incidentDate?: unknown;
  __manualDeviceNumber?: unknown;
  __manualDeviceName?: unknown;
  __manualDeviceSerial?: unknown;
  __lastMaintenanceDate?: unknown;
};

function record(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
}

function publicText(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function publicDate(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;
}

export function buildPublicComplaintSubjectContext(row: PublicComplaintRow, includeEntityIds: boolean) {
  const snapshot = record(row.__contextSnapshot);
  const fieldVisitId = Number(row.__fieldVisitId);
  if (Number.isInteger(fieldVisitId) && fieldVisitId > 0) {
    const context: Record<string, unknown> = {
      kind: 'visit',
      visitDate: publicDate(row.__incidentDate ?? snapshot.scheduled_date ?? snapshot.scheduledDate),
      visitType: publicText(snapshot.visit_type, snapshot.visitType),
      teamName: publicText(snapshot.team_name, snapshot.teamName),
    };
    if (includeEntityIds) context.visitId = fieldVisitId;
    return context;
  }

  const installedDeviceId = Number(row.__installedDeviceId);
  if (Number.isInteger(installedDeviceId) && installedDeviceId > 0) {
    const context: Record<string, unknown> = {
      kind: 'installed_device',
      deviceName: publicText(
        snapshot.model_name_ar,
        snapshot.device_model_name,
        snapshot.external_device_name,
        snapshot.model_name_en,
        snapshot.deviceName,
      ),
      serialNumber: publicText(snapshot.serial_number, snapshot.serialNumber),
    };
    if (includeEntityIds) context.installedDeviceId = installedDeviceId;
    return context;
  }

  const manualDeviceNumber = publicText(row.__manualDeviceNumber);
  const manualDeviceName = publicText(row.__manualDeviceName);
  const manualDeviceSerial = publicText(row.__manualDeviceSerial);
  if (manualDeviceNumber || manualDeviceName || manualDeviceSerial) {
    return {
      kind: 'manual_device',
      deviceNumber: manualDeviceNumber,
      deviceName: manualDeviceName,
      serialNumber: manualDeviceSerial,
      lastMaintenanceDate: publicDate(row.__lastMaintenanceDate),
    };
  }

  return { kind: 'general' };
}

export function toPublicComplaintResponse(row: PublicComplaintRow, includeEntityIds: boolean) {
  const {
    __entryPoint: _entryPoint,
    __fieldVisitId: _fieldVisitId,
    __installedDeviceId: _installedDeviceId,
    __contextSnapshot: _contextSnapshot,
    __incidentDate: _incidentDate,
    __manualDeviceNumber: _manualDeviceNumber,
    __manualDeviceName: _manualDeviceName,
    __manualDeviceSerial: _manualDeviceSerial,
    __lastMaintenanceDate: _lastMaintenanceDate,
    ...publicRow
  } = row;
  return {
    ...publicRow,
    id: Number(publicRow.id),
    subjectContext: buildPublicComplaintSubjectContext(row, includeEntityIds),
  };
}

export type ComplaintIdentity =
  | { kind: 'app_account'; account: AppAccountClaims; key: string }
  | { kind: 'visitor_otp'; phone: string; verificationId: number; key: string }
  | { kind: 'unverified_device'; deviceId: string; ip: string | null; key: string };

function httpError(status: number, code: string, details?: unknown) {
  return Object.assign(new Error(code), { status, details: { code, details } });
}

const hash = (value: string) => crypto.createHash('sha256').update(value).digest('hex');

export async function resolveComplaintIdentity(input: {
  db: PoolClient; appAccount?: AppAccountClaims; handle?: unknown; deviceId?: unknown; ip?: string | null;
}): Promise<ComplaintIdentity> {
  if (input.appAccount) return { kind: 'app_account', account: input.appAccount, key: String(input.appAccount.appAccountId) };
  const handle = typeof input.handle === 'string' ? input.handle.trim() : '';
  if (!handle) {
    const deviceId = typeof input.deviceId === 'string' ? input.deviceId.trim() : '';
    if (!deviceId || deviceId.length > 128) throw httpError(400, 'device_identifier_required');
    return { kind: 'unverified_device', deviceId, ip: input.ip ?? null, key: hash(deviceId) };
  }
  const { rows } = await input.db.query(
    `SELECT id,phone,verified_at,consumed_at FROM otp_verifications
      WHERE handle=$1 AND purpose='complaint' FOR UPDATE`, [handle],
  );
  const row = rows[0];
  if (!row) throw httpError(400, 'unknown_complaint_verification');
  if (!row.verified_at) throw httpError(400, 'complaint_phone_not_verified');
  if (row.consumed_at) throw httpError(409, 'complaint_verification_already_used');
  if (new Date(row.verified_at).getTime() < Date.now() - HANDLE_TTL_MS) throw httpError(400, 'complaint_verification_expired');
  return { kind: 'visitor_otp', phone: row.phone, verificationId: Number(row.id), key: row.phone };
}

function txt(value: unknown, field: string, min = 1, max = 5000): string {
  const out = typeof value === 'string' ? value.trim() : '';
  if (out.length < min || out.length > max) throw httpError(400, `invalid_${field}`);
  return out;
}

function optional(value: unknown, field: string, max: number) {
  return value == null || value === '' ? null : txt(value, field, 1, max);
}

function date(value: unknown, field: string): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || new Date(`${value}T00:00:00Z`) > new Date()) {
    throw httpError(400, `invalid_${field}`);
  }
  return value;
}

function choice<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (!allowed.includes(value as T)) throw httpError(400, `invalid_${field}`);
  return value as T;
}

function rejectUnknownKeys(value: unknown, allowed: readonly string[], field: string): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw httpError(400, `invalid_${field}`);
  const unknownFields = Object.keys(value as Record<string, unknown>).filter((key) => !allowed.includes(key));
  if (unknownFields.length) throw httpError(400, 'invalid_form_payload', { field, unknownFields });
}

function optionalBoolean(value: unknown, field: string): boolean | null {
  if (value == null) return null;
  if (typeof value !== 'boolean') throw httpError(400, `invalid_${field}`);
  return value;
}

function positive(value: unknown, field: string): number {
  const n = Number(value); if (!Number.isInteger(n) || n <= 0) throw httpError(400, `invalid_${field}`); return n;
}

function category(type: ComplaintType, body: Record<string, any>) {
  if (type === 'general') return { code: null, other: null };
  const raw = type === 'technical' ? body.technicalCategory : body.deviceIssueType;
  const code = choice(raw, type === 'technical' ? TECHNICAL_COMPLAINT_CATEGORIES : DEVICE_COMPLAINT_CATEGORIES, 'category');
  return { code, other: code === 'other' ? txt(body.otherCategoryText, 'other_category_text', 1, 300) : null };
}

async function setting(db: PoolClient, key: string, fallback: number): Promise<number> {
  const { rows } = await db.query(`SELECT value FROM system_settings WHERE key=$1`, [key]);
  const n = Number(rows[0]?.value); return Number.isFinite(n) && n >= 0 ? n : fallback;
}

async function enforceRateLimit(db: PoolClient, identity: ComplaintIdentity, phone: string) {
  let predicate = ''; let value: unknown; let key = '';
  if (identity.kind === 'app_account') { predicate='requester_app_account_id=$1'; value=identity.account.appAccountId; key='complaints_account_daily_limit'; }
  else if (identity.kind === 'visitor_otp') { predicate=`EXISTS(SELECT 1 FROM complaint_requesters r WHERE r.complaint_id=complaints.id AND r.primary_phone=$1)`; value=phone; key='complaints_verified_phone_daily_limit'; }
  else { predicate='submitter_device_hash=$1'; value=hash(identity.deviceId); key='complaints_unverified_device_daily_limit'; }
  const limit = await setting(db,key,identity.kind==='unverified_device'?3:10);
  const { rows } = await db.query(`SELECT COUNT(*)::int AS n FROM complaints WHERE created_at >= NOW()-INTERVAL '24 hours' AND ${predicate}`,[value]);
  if (limit > 0 && Number(rows[0]?.n) >= limit) throw httpError(429,'complaint_rate_limit_exceeded',{limit});
  if (identity.kind === 'unverified_device' && identity.ip) {
    const ipLimit=await setting(db,'complaints_unverified_ip_daily_limit',10);
    const ipHash=hash(identity.ip);
    const ipRows=await db.query(`SELECT COUNT(*)::int AS n FROM complaints WHERE created_at>=NOW()-INTERVAL '24 hours' AND submitter_ip_hash=$1`,[ipHash]);
    if(ipLimit>0 && Number(ipRows.rows[0]?.n)>=ipLimit) throw httpError(429,'complaint_rate_limit_exceeded',{limit:ipLimit});
  }
  if(identity.kind==='unverified_device'){
    const phoneLimit=await setting(db,'complaints_unverified_phone_daily_limit',3);
    const phoneRows=await db.query(`SELECT COUNT(*)::int AS n FROM complaints c JOIN complaint_requesters r ON r.complaint_id=c.id WHERE c.created_at>=NOW()-INTERVAL '24 hours' AND r.primary_phone=$1`,[phone]);
    if(phoneLimit>0&&Number(phoneRows.rows[0]?.n)>=phoneLimit)throw httpError(429,'complaint_rate_limit_exceeded',{limit:phoneLimit});
  }
}

async function deriveContext(db:PoolClient,identity:ComplaintIdentity,body:Record<string,any>){
  const context=body.submissionContext;
  if(!context || typeof context!=='object') throw httpError(400,'complaint_context_mismatch');
  if(context.kind==='visit'){
    rejectUnknownKeys(context,['kind','fieldVisitId'],'submission_context');
    if(identity.kind!=='app_account') throw httpError(403,'complaint_context_mismatch');
    const visitId=positive(context.fieldVisitId,'field_visit_id');
    const {rows}=await db.query(`SELECT fv.id,fv.branch_id,fv.scheduled_date,fv.visit_type,fv.team_snapshot,
      fv.reassigned_supervisor_id,fv.reassigned_technician_id
      FROM field_visits fv WHERE fv.id=$1 AND fv.client_id=$2`,[visitId,identity.account.clientId]);
    if(!rows[0]) throw httpError(404,'visit_not_available');
    return{type:'technical' as const,entryPoint:'visit_detail',fieldVisitId:visitId,installedDeviceId:null,
      originBranchId:rows[0].branch_id,contextSnapshot:rows[0],incidentDate:rows[0].scheduled_date,manualDevice:null,lastMaintenance:null};
  }
  if(context.kind==='installed_device'){
    rejectUnknownKeys(context,['kind','installedDeviceId'],'submission_context');
    if(identity.kind!=='app_account') throw httpError(403,'complaint_context_mismatch');
    const deviceId=positive(context.installedDeviceId,'installed_device_id');
    const {rows}=await db.query(`SELECT d.id,d.branch_id,d.serial_number,d.device_model_name,d.external_device_name,d.status,
      dm.name_ar AS model_name_ar,dm.name_en AS model_name_en
      FROM installed_devices d LEFT JOIN device_models dm ON dm.id=d.device_model_id
      WHERE d.id=$1 AND d.customer_id=$2`,[deviceId,identity.account.clientId]);
    if(!rows[0]) throw httpError(404,'device_not_available');
    return{type:'device' as const,entryPoint:'device_detail',fieldVisitId:null,installedDeviceId:deviceId,
      originBranchId:rows[0].branch_id,contextSnapshot:rows[0],incidentDate:null,manualDevice:null,lastMaintenance:date(body.reportedLastMaintenanceDate,'last_maintenance_date')};
  }
  if(context.kind==='manual_device'){
    rejectUnknownKeys(context,['kind','deviceNumber','reportedLastMaintenanceDate'],'submission_context');
    if(identity.kind==='unverified_device') throw httpError(403,'complaint_type_not_allowed_for_identity');
    return{type:'device' as const,entryPoint:'home',fieldVisitId:null,installedDeviceId:null,originBranchId:null,
      contextSnapshot:null,incidentDate:null,manualDevice:txt(context.deviceNumber,'device_number',1,255),lastMaintenance:date(context.reportedLastMaintenanceDate,'last_maintenance_date')};
  }
  if(context.kind!=='general') throw httpError(400,'complaint_context_mismatch');
  rejectUnknownKeys(context,['kind'],'submission_context');
  const type=choice(body.complaintType,COMPLAINT_TYPES,'complaint_type');
  if(identity.kind==='unverified_device' && type==='device') throw httpError(403,'complaint_type_not_allowed_for_identity');
  return{type,entryPoint:'home',fieldVisitId:null,installedDeviceId:null,originBranchId:null,contextSnapshot:null,
    incidentDate:date(body.incidentDate,'incident_date'),manualDevice:null,lastMaintenance:null};
}

async function requester(db:PoolClient,identity:ComplaintIdentity,body:Record<string,any>){
  if(identity.kind==='app_account'){
    if(body.visitor != null) throw httpError(400,'visitor_fields_not_allowed_for_account');
    const p=await getMyProfile(identity.account);
    if(!p.firstName?.trim()||!p.lastName?.trim()||!p.address.governorateId) throw httpError(409,'customer_profile_incomplete');
    const secondary=normalizePhone(body.secondaryPhone ?? p.secondaryMobile);
    return{first:p.firstName.trim(),middle:p.fatherName?.trim()||null,last:p.lastName.trim(),phone:normalizePhone(p.primaryMobile),
      primaryWhatsapp:p.primaryMobileHasWhatsapp,secondary:secondary||null,secondaryWhatsapp:secondary?(optionalBoolean(body.secondaryPhoneHasWhatsapp,'secondary_phone_has_whatsapp') ?? p.secondaryMobileHasWhatsapp):null,
      governorate:p.address.governorateId,region:p.address.cityOrAreaId,subdistrict:p.address.subAreaId,neighborhood:p.address.neighborhoodId,
      detailedAddress:p.address.detailedAddress,addressLabels:{governorate:p.address.governorate,cityOrArea:p.address.cityOrArea,subArea:p.address.subArea,neighborhood:p.address.neighborhood},classification:p.classification};
  }
  const v=body.visitor??{}; const phone=normalizePhone(v.primaryPhone);
  rejectUnknownKeys(v,['firstName','middleName','lastName','primaryPhone','primaryPhoneHasWhatsapp','secondaryPhone','secondaryPhoneHasWhatsapp','governorate','region','subdistrict','neighborhood','detailedAddress'],'visitor');
  if(!isValidSyrianMobile(phone)) throw httpError(400,'invalid_primary_phone');
  if(identity.kind==='visitor_otp' && phone!==normalizePhone(identity.phone)) throw httpError(400,'verified_phone_mismatch');
  const secondary=normalizePhone(body.secondaryPhone ?? v.secondaryPhone);
  if(secondary&&!isValidSyrianMobile(secondary)) throw httpError(400,'invalid_secondary_phone');
  const secondaryWhatsapp=optionalBoolean(body.secondaryPhoneHasWhatsapp??v.secondaryPhoneHasWhatsapp,'secondary_phone_has_whatsapp');
  if(!secondary&&secondaryWhatsapp!=null) throw httpError(400,'secondary_whatsapp_without_phone');
  const a=await resolveAndValidateAddress({governorate:v.governorate,cityOrArea:v.region,subArea:v.subdistrict,neighborhood:v.neighborhood},db);
  return{first:txt(v.firstName,'first_name',1,60),middle:optional(v.middleName,'middle_name',60),last:txt(v.lastName,'last_name',1,60),phone,
    primaryWhatsapp:optionalBoolean(v.primaryPhoneHasWhatsapp,'primary_phone_has_whatsapp'),secondary:secondary||null,secondaryWhatsapp:secondary?secondaryWhatsapp:null,
    governorate:a.ids.governorate,region:a.ids.cityOrArea,subdistrict:a.ids.subArea,neighborhood:a.ids.neighborhood,
    detailedAddress:optional(v.detailedAddress,'detailed_address',500),addressLabels:a.labels,classification:null};
}

async function consumeAttachments(db:PoolClient,complaintId:number,identity:ComplaintIdentity,tokens:unknown){
  const list=Array.isArray(tokens)?tokens:[];
  const max=identity.kind==='unverified_device'?2:5;
  if(list.length>max) throw httpError(400,'attachment_limit_exceeded',{max});
  const values=list.map(x=>typeof x?.uploadToken==='string'?x.uploadToken:'');
  if(values.some(x=>!x)||new Set(values).size!==values.length) throw httpError(400,'attachment_token_invalid_or_expired');
  if(!values.length)return;
  const {rows}=await db.query(`SELECT ca.id,ca.upload_token,ca.media_file_id,mf.byte_size FROM complaint_attachments ca
    JOIN media_files mf ON mf.id=ca.media_file_id WHERE ca.upload_token=ANY($1::uuid[]) AND ca.identity_kind=$2 AND ca.identity_key=$3
    AND ca.complaint_id IS NULL AND ca.consumed_at IS NULL AND ca.expires_at>NOW() FOR UPDATE OF ca`,[values,identity.kind,identity.key]);
  if(rows.length!==values.length) throw httpError(400,'attachment_token_invalid_or_expired');
  const total=rows.reduce((s,r)=>s+Number(r.byte_size),0); if(total>30*1024*1024) throw httpError(400,'attachment_limit_exceeded',{maximumTotalBytes:30*1024*1024});
  for(const row of rows){
    await db.query(`UPDATE complaint_attachments SET complaint_id=$2,consumed_at=NOW() WHERE id=$1`,[row.id,complaintId]);
    await db.query(`UPDATE media_files SET owner_type='complaint_attachment',owner_id=$2,attached_at=NOW(),detached_at=NULL WHERE id=$1 AND visibility='private'`,[row.media_file_id,row.id]);
  }
}

export async function createMobileComplaint(input:{appAccount?:AppAccountClaims;handle?:unknown;deviceId?:unknown;ip?:string|null;body:Record<string,any>}){
  rejectUnknownKeys(input.body,['formVersion','complaintType','technicalCategory','deviceIssueType','otherCategoryText','description','incidentDate','reportedTargetName','reportedLastMaintenanceDate','secondaryPhone','secondaryPhoneHasWhatsapp','preferredContactMethod','attachments','submissionContext','visitor','verificationHandle'],'complaint');
  if (input.body.attachments != null) {
    if (!Array.isArray(input.body.attachments)) throw httpError(400,'invalid_attachments');
    input.body.attachments.forEach((item: unknown) => rejectUnknownKeys(item,['uploadToken'],'attachment'));
  }
  if(input.body.formVersion!=='complaint.mobile.v1') throw httpError(400,'invalid_form_payload');
  const db=await pool.connect();
  try{await db.query('BEGIN');
    const identity=await resolveComplaintIdentity({db,appAccount:input.appAccount,handle:input.handle??input.body.verificationHandle,deviceId:input.deviceId,ip:input.ip});
    const context=await deriveContext(db,identity,input.body); const person=await requester(db,identity,input.body);
    await enforceRateLimit(db,identity,person.phone); const cat=category(context.type,input.body);
    const description=txt(input.body.description,'description',20,5000);
    const duplicateEnabled=(await db.query(`SELECT value FROM system_settings WHERE key='complaints_duplicate_detection_enabled'`)).rows[0]?.value!=='false';
    const exactHours=await setting(db,'complaints_duplicate_exact_text_window_hours',24);
    const visitDays=await setting(db,'complaints_duplicate_visit_window_days',30);
    const deviceDays=await setting(db,'complaints_duplicate_device_window_days',30);
    const duplicate=duplicateEnabled?await db.query(`SELECT c.id FROM complaints c JOIN complaint_requesters r ON r.complaint_id=c.id
      WHERE (r.primary_phone=$1 AND lower(btrim(c.description))=lower(btrim($2)) AND c.created_at>=NOW()-($3::int*INTERVAL '1 hour'))
         OR ($4::bigint IS NOT NULL AND c.field_visit_id=$4 AND c.created_at>=NOW()-($5::int*INTERVAL '1 day'))
         OR ($6::int IS NOT NULL AND c.installed_device_id=$6 AND c.created_at>=NOW()-($7::int*INTERVAL '1 day'))
      ORDER BY c.created_at DESC LIMIT 1`,[person.phone,description,exactHours,context.fieldVisitId,visitDays,context.installedDeviceId,deviceDays]):{rows:[],rowCount:0};
    const seq=await db.query(`SELECT nextval('complaint_public_ref_seq') AS value`); const ref=`CMP-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${String(seq.rows[0].value).padStart(6,'0')}`;
    const inserted=await db.query(`INSERT INTO complaints(public_ref_number,complaint_type,category_code,other_category_text,description,
      entry_point,source_channel,identity_source,status,review_required,suspected_duplicate,duplicate_of_complaint_id,origin_branch_id,
      requester_app_account_id,requester_client_id,field_visit_id,installed_device_id,context_snapshot,expected_contact_method,submitter_device_hash,submitter_ip_hash)
      VALUES($1,$2,$3,$4,$5,$6,'mobile_app',$7,'new',$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING id,created_at`,
      [ref,context.type,cat.code,cat.other,description,context.entryPoint,identity.kind,identity.kind==='unverified_device',duplicate.rowCount!>0,duplicate.rows[0]?.id??null,
       context.originBranchId,identity.kind==='app_account'?identity.account.appAccountId:null,identity.kind==='app_account'?identity.account.clientId:null,
       context.fieldVisitId,context.installedDeviceId,context.contextSnapshot?JSON.stringify(context.contextSnapshot):null,choice(input.body.preferredContactMethod??'no_preference',['phone','whatsapp','sms','no_preference'] as const,'preferred_contact_method'),
       identity.kind==='unverified_device'?hash(identity.deviceId):null,identity.kind==='unverified_device'&&identity.ip?hash(identity.ip):null]);
    const complaintId=Number(inserted.rows[0].id);
    await db.query(`INSERT INTO complaint_requesters(complaint_id,first_name,middle_name,last_name,primary_phone,primary_phone_has_whatsapp,
      secondary_phone,secondary_phone_has_whatsapp,governorate_id,region_id,subdistrict_id,neighborhood_id,detailed_address,address_snapshot,
      client_classification_snapshot,link_status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [complaintId,person.first,person.middle,person.last,person.phone,person.primaryWhatsapp,person.secondary,person.secondaryWhatsapp,person.governorate,
       person.region,person.subdistrict,person.neighborhood,person.detailedAddress,JSON.stringify(person.addressLabels),person.classification,identity.kind==='app_account'?'linked':'unlinked']);
    if(context.type==='technical') await db.query(`INSERT INTO complaint_technical_details(complaint_id,incident_date,reported_target_name,visit_snapshot) VALUES($1,$2,$3,$4)`,
      [complaintId,context.incidentDate,optional(input.body.reportedTargetName,'reported_target_name',200),context.fieldVisitId?JSON.stringify(context.contextSnapshot):null]);
    if(context.type==='device') await db.query(`INSERT INTO complaint_device_details(complaint_id,manual_device_number,reported_last_maintenance_date,device_snapshot) VALUES($1,$2,$3,$4)`,
      [complaintId,context.manualDevice,context.lastMaintenance,context.installedDeviceId?JSON.stringify(context.contextSnapshot):null]);
    await consumeAttachments(db,complaintId,identity,input.body.attachments);
    await db.query(`INSERT INTO complaint_status_history(complaint_id,to_status,actor_app_account_id) VALUES($1,'new',$2)`,[complaintId,identity.kind==='app_account'?identity.account.appAccountId:null]);
    await db.query(`INSERT INTO complaint_public_updates(complaint_id,public_status,message,is_system) VALUES($1,'received','تم استلام الشكوى',TRUE)`,[complaintId]);
    await db.query(`INSERT INTO complaint_audit_log(complaint_id,event_type,actor_type,actor_app_account_id,metadata) VALUES($1,'complaint_created',$2,$3,$4)`,[complaintId,identity.kind==='app_account'?'app_account':'visitor',identity.kind==='app_account'?identity.account.appAccountId:null,JSON.stringify({identity:identity.kind})]);
    if(identity.kind==='visitor_otp') await db.query(`UPDATE otp_verifications SET consumed_at=NOW() WHERE id=$1 AND consumed_at IS NULL`,[identity.verificationId]);
    await db.query('COMMIT');
    return{id:complaintId,publicRefNumber:ref,publicStatus:'received',submittedAt:inserted.rows[0].created_at,reviewRequired:identity.kind==='unverified_device',possibleDuplicate:duplicate.rowCount!>0};
  }catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
}

const PUBLIC_DETAIL_SQL=`SELECT c.id,c.public_ref_number AS "publicRefNumber",c.complaint_type AS "complaintType",c.created_at AS "submittedAt",
  c.description,(SELECT x.public_status FROM complaint_public_updates x WHERE x.complaint_id=c.id ORDER BY x.created_at DESC LIMIT 1) AS "publicStatus",
  (SELECT COALESCE(json_agg(json_build_object('status',x.public_status,'message',x.message,'createdAt',x.created_at) ORDER BY x.created_at),'[]') FROM complaint_public_updates x WHERE x.complaint_id=c.id) AS timeline,
  (SELECT r.public_summary FROM complaint_resolutions r WHERE r.id=c.current_resolution_id) AS "publicResolutionSummary",
  (SELECT COALESCE(json_agg(json_build_object('id',a.id,'url','/api/app/complaints/'||c.id||'/attachments/'||a.id)),'[]') FROM complaint_attachments a WHERE a.complaint_id=c.id) AS attachments,
  c.entry_point AS "__entryPoint",c.field_visit_id AS "__fieldVisitId",c.installed_device_id AS "__installedDeviceId",
  c.context_snapshot AS "__contextSnapshot",td.incident_date AS "__incidentDate",
  dd.manual_device_number AS "__manualDeviceNumber",dd.manual_device_name AS "__manualDeviceName",
  dd.manual_device_serial AS "__manualDeviceSerial",dd.reported_last_maintenance_date AS "__lastMaintenanceDate"
  FROM complaints c
  LEFT JOIN complaint_technical_details td ON td.complaint_id=c.id
  LEFT JOIN complaint_device_details dd ON dd.complaint_id=c.id`;

export async function listMyComplaints(account:AppAccountClaims){const {rows}=await pool.query(`${PUBLIC_DETAIL_SQL} WHERE c.requester_app_account_id=$1 ORDER BY c.created_at DESC`,[account.appAccountId]);return{items:rows.map(row=>toPublicComplaintResponse(row,true))};}
export async function getMyComplaint(account:AppAccountClaims,id:number){const {rows}=await pool.query(`${PUBLIC_DETAIL_SQL} WHERE c.id=$1 AND c.requester_app_account_id=$2`,[id,account.appAccountId]);if(!rows[0])throw httpError(404,'complaint_not_found');return toPublicComplaintResponse(rows[0],true);}

export async function createTrackingGrant(input:{publicRefNumber:unknown;phone:unknown;verificationHandle:unknown}){
  const phone=normalizePhone(input.phone); if(!isValidSyrianMobile(phone))throw httpError(400,'invalid_phone');
  const client=await pool.connect();try{await client.query('BEGIN');
    const {rows:proof}=await client.query(`SELECT id,phone,verified_at,consumed_at FROM otp_verifications WHERE handle=$1 AND purpose='complaint_tracking' FOR UPDATE`,[input.verificationHandle]);
    if(!proof[0]||!proof[0].verified_at||proof[0].consumed_at||proof[0].phone!==phone)throw httpError(400,'invalid_tracking_verification');
    const {rows}=await client.query(`SELECT c.id FROM complaints c JOIN complaint_requesters r ON r.complaint_id=c.id WHERE c.public_ref_number=$1 AND r.primary_phone=$2`,[input.publicRefNumber,phone]);
    if(!rows[0])throw httpError(404,'complaint_not_found');
    const grant=await client.query(`INSERT INTO complaint_tracking_grants(complaint_id) VALUES($1) RETURNING handle,expires_at`,[rows[0].id]);await client.query(`UPDATE otp_verifications SET consumed_at=NOW() WHERE id=$1`,[proof[0].id]);await client.query('COMMIT');return{trackingHandle:grant.rows[0].handle,expiresAt:grant.rows[0].expires_at};}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}
export async function trackComplaint(handle:unknown){const {rows}=await pool.query(`${PUBLIC_DETAIL_SQL} JOIN complaint_tracking_grants g ON g.complaint_id=c.id WHERE g.handle=$1 AND g.expires_at>NOW()`,[handle]);if(!rows[0])throw httpError(404,'tracking_handle_invalid_or_expired');return toPublicComplaintResponse(rows[0],false);}
