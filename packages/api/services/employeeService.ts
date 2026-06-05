import bcrypt from 'bcryptjs';
import type { ContactEntry } from '@golden-crm/shared';
import pool from '../db.js';
import { clearPermissionCache } from '../middleware/permission.js';
import { TEMPLATE_ROLE_ASSIGNMENT_ERROR, validateTemplateRoleAssignment } from './roleAssignmentGuard.js';
import { upsertUserBranchAssignment } from './userBranchAssignmentService.js';
import { deriveEmployeeRoleFromVacancyTitle, getEmployeeAvatar } from '../utils/recruitmentPolicy.js';
import { sanitizeText } from '../utils/sanitize.js';
import {
  getCanonicalContactNumber,
  normalizeContactsForWrite,
} from '../utils/contactValidation.js';
import {
  deleteEmployee,
  fetchApplicantById,
  fetchApplicationInterviews,
  fetchApplicationTrainings,
  fetchEmployeeDetailRow,
  fetchEmployeeListItem,
  fetchLatestHiringApplication,
  fetchReferrerById,
  fetchVacancyById,
  findBranchById,
  findDepartmentInBranch,
  findEmployeeAvatarRecord,
  findEmployeeBasic,
  findEmployeeBranchId,
  findEmployeeDuplicateByContactNumbers,
  findEmployeeSystemAccount,
  findGeoUnitsByIds,
  findRoleDisplayName,
  insertEmployeeSystemAccount,
  listScopedEmployeeManagerCandidates,
  listEmployees,
  unlinkEmployeeSystemAccounts,
  updateEmployeeSystemAccount,
  updateHrUserNameByEmployeeId,
} from '../repositories/employeeRepository.js';

type ServiceError = Error & {
  status?: number;
  payload?: Record<string, unknown>;
};

type Queryable = {
  query: typeof pool.query;
};

type EmployeeWriteInput = {
  branchId: number;
  branchName: string;
  name: string;
  firstName: string;
  fatherName: string | null;
  lastName: string;
  role: string | null;
  mobile: string;
  contacts: ContactEntry[];
  birthDate: string;
  gender: 'male' | 'female';
  maritalStatus: string;
  militaryService: string;
  residenceGovernorateId: number;
  residenceGovernorate: string;
  residenceRegionId: number;
  residenceRegion: string;
  residenceSubAreaId: number;
  residenceSubArea: string;
  residenceNeighborhoodId: number | null;
  residenceNeighborhood: string | null;
  detailedAddress: string | null;
  residence: string;
  status: 'active' | 'vacation' | 'suspended' | 'terminated';
  avatar: string;
  jobTitle: string;
  academicQualification: string | null;
  specialization: string | null;
  yearsOfExperience: number | null;
  drivingLicense: boolean | null;
  jobSkills: string | null;
  foreignLanguages: string[];
  hireDate: string | null;
  startWorkDate: string | null;
  departmentId: number;
  contractType: string;
  workType: string;
  previousEmployment: string | null;
  directManagerId: number | null;
  referrerType: string | null;
  sourceChannel: string | null;
  referrerName: string | null;
  referralNotes: string | null;
  referralEntityId: number | null;
};

function createServiceError(status: number, payload: Record<string, unknown>): ServiceError {
  const err = new Error(String(payload.error ?? 'Service error')) as ServiceError;
  err.status = status;
  err.payload = payload;
  return err;
}

function asRequiredText(value: unknown, error: string): string {
  const text = sanitizeText(String(value ?? ''));
  if (!text) throw createServiceError(400, { error });
  return text;
}

function asOptionalText(value: unknown): string | null {
  const text = sanitizeText(String(value ?? ''));
  return text || null;
}

function asOptionalDate(value: unknown, error?: string): string | null {
  if (value == null || value === '') return null;
  const raw = String(value);
  if (Number.isNaN(Date.parse(raw))) {
    throw createServiceError(400, { error: error || 'التاريخ غير صالح' });
  }
  return raw;
}

function asRequiredDate(value: unknown, error: string): string {
  const raw = asOptionalDate(value, error);
  if (!raw) throw createServiceError(400, { error });
  return raw;
}

function asOptionalNumber(value: unknown, error?: string): number | null {
  if (value == null || value === '') return null;
  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw createServiceError(400, { error: error || 'القيمة الرقمية غير صالحة' });
  }
  return num;
}

function asGender(value: unknown): 'male' | 'female' {
  const raw = String(value ?? '').trim().toLowerCase();
  if (raw === 'male' || raw === 'ذكر') return 'male';
  if (raw === 'female' || raw === 'أنثى' || raw === 'انثى') return 'female';
  throw createServiceError(400, { error: 'الجنس مطلوب' });
}

function asEmployeeStatus(value: unknown): 'active' | 'vacation' | 'suspended' | 'terminated' {
  const raw = String(value ?? 'active').trim().toLowerCase();
  if (raw === 'vacation') return 'vacation';
  if (raw === 'leave') return 'vacation';
  if (raw === 'suspended' || raw === 'terminated') return raw;
  if (raw === 'inactive') return 'terminated';
  return 'active';
}

function asOptionalBoolean(value: unknown): boolean | null {
  if (value == null || value === '') return null;
  if (typeof value === 'boolean') return value;
  const raw = String(value).trim().toLowerCase();
  if (['yes', 'true', '1', 'نعم'].includes(raw)) return true;
  if (['no', 'false', '0', 'لا'].includes(raw)) return false;
  return null;
}

function normalizeStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => sanitizeText(String(item ?? '')))
      .filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => sanitizeText(item))
      .filter(Boolean);
  }
  return [];
}

function normalizeContacts(rawContacts: unknown, fallbackMobile?: unknown): ContactEntry[] {
  const prepared = normalizeContactsForWrite(rawContacts, { forceNonPrimary: true });

  if (prepared.length === 0) {
    const fallbackContacts = normalizeContactsForWrite([
      {
        id: 'emp-contact-1',
        type: 'mobile',
        number: fallbackMobile,
        label: '',
        hasWhatsApp: false,
        isPrimary: false,
        status: 'active',
      },
    ], { forceNonPrimary: true });
    prepared.push(...fallbackContacts);
  }

  if (prepared.length === 0) {
    throw createServiceError(400, { error: 'يجب إضافة وسيلة تواصل واحدة على الأقل' });
  }

  return prepared.map((contact) => ({ ...contact, isPrimary: false }));
}

function getCanonicalMobile(contacts: ContactEntry[]): string {
  const mobile = getCanonicalContactNumber(contacts);
  if (!mobile) {
    throw createServiceError(400, { error: 'يجب إضافة وسيلة تواصل صالحة' });
  }
  return mobile;
}

function buildResidenceText(input: {
  governorate: string;
  region: string;
  subArea: string;
  neighborhood?: string | null;
  detailedAddress?: string | null;
}) {
  return [
    input.governorate,
    input.region,
    input.subArea,
    input.neighborhood,
    input.detailedAddress,
  ].filter(Boolean).join(' - ');
}

export async function prepareEmployeeWriteInput(
  body: any,
  branchId: number,
  options?: { excludeEmployeeId?: number | string | null },
): Promise<EmployeeWriteInput> {
  const firstName = asRequiredText(body.firstName, 'الاسم الأول مطلوب');
  const lastName = asRequiredText(body.lastName, 'الكنية مطلوبة');
  const fatherName = asOptionalText(body.fatherName);
  const birthDate = asRequiredDate(body.birthDate, 'تاريخ الميلاد مطلوب');
  const gender = asGender(body.gender);
  const maritalStatus = asRequiredText(body.maritalStatus, 'الحالة الاجتماعية مطلوبة');
  const militaryService = asRequiredText(body.militaryService, 'الخدمة العسكرية مطلوبة');
  const jobTitle = asRequiredText(body.jobTitle, 'المسمى الوظيفي مطلوب');
  const contractType = asRequiredText(body.contractType, 'نوع العقد مطلوب');
  const workType = asRequiredText(body.workType, 'نوع العمل مطلوب');
  const departmentId = asOptionalNumber(body.departmentId, 'القسم غير صالح');
  if (!departmentId) {
    throw createServiceError(400, { error: 'القسم مطلوب' });
  }

  const geoSelection = body.geoSelection || {};
  const residenceGovernorateId = asOptionalNumber(geoSelection.govId ?? body.residenceGovernorateId, 'المحافظة غير صالحة');
  const residenceRegionId = asOptionalNumber(geoSelection.regionId ?? body.residenceRegionId, 'المنطقة غير صالحة');
  const residenceSubAreaId = asOptionalNumber(geoSelection.subId ?? body.residenceSubAreaId, 'الناحية غير صالحة');
  const residenceNeighborhoodId = asOptionalNumber(
    geoSelection.neighborhoodId ?? body.residenceNeighborhoodId,
    'الحي غير صالح',
  );

  if (!residenceGovernorateId) {
    throw createServiceError(400, { error: 'المحافظة مطلوبة' });
  }
  if (!residenceRegionId) {
    throw createServiceError(400, { error: 'المنطقة مطلوبة' });
  }
  if (!residenceSubAreaId) {
    throw createServiceError(400, { error: 'الناحية مطلوبة' });
  }

  const branch = await findBranchById(branchId);
  if (!branch) {
    throw createServiceError(400, { error: 'الفرع المحدد غير موجود' });
  }

  const department = await findDepartmentInBranch(departmentId, branchId);
  if (!department) {
    throw createServiceError(400, { error: 'القسم المحدد لا ينتمي إلى الفرع المختار' });
  }

  const geoRows = await findGeoUnitsByIds([
    residenceGovernorateId,
    residenceRegionId,
    residenceSubAreaId,
    ...(residenceNeighborhoodId ? [residenceNeighborhoodId] : []),
  ]);
  const geoMap = new Map<number, string>(geoRows.map((row: any) => [row.id as number, row.name as string]));

  const residenceGovernorate = geoMap.get(residenceGovernorateId);
  const residenceRegion = geoMap.get(residenceRegionId);
  const residenceSubArea = geoMap.get(residenceSubAreaId);
  const residenceNeighborhood = residenceNeighborhoodId ? geoMap.get(residenceNeighborhoodId) ?? null : null;

  if (!residenceGovernorate || !residenceRegion || !residenceSubArea) {
    throw createServiceError(400, { error: 'تعذر قراءة العنوان الجغرافي المحدد' });
  }

  const contacts = normalizeContacts(body.contacts, body.mobile);
  const mobile = getCanonicalMobile(contacts);

  const duplicate = await findEmployeeDuplicateByContactNumbers(
    Array.from(new Set(contacts.map((contact) => contact.number))),
    options?.excludeEmployeeId ?? null,
  );
  if (duplicate) {
    throw createServiceError(409, {
      error: `يوجد سجل موظف مطابق لأحد أرقام التواصل مسبقاً (#${duplicate.employeeNumber ?? duplicate.id})`,
      duplicateEmployeeId: duplicate.id,
    });
  }

  const directManagerId = asOptionalNumber(body.directManagerId, 'المدير المباشر غير صالح');
  if (directManagerId != null) {
    if (options?.excludeEmployeeId != null && Number(options.excludeEmployeeId) === directManagerId) {
      throw createServiceError(400, { error: 'لا يمكن أن يكون الموظف مديراً مباشراً لنفسه' });
    }
    const managerCandidates = await listScopedEmployeeManagerCandidates(branchId, departmentId);
    if (!managerCandidates.some((candidate) => candidate.id === directManagerId)) {
      throw createServiceError(400, {
        error: 'يجب اختيار المدير المباشر من مدراء القسم المعتمدين في نفس الفرع',
      });
    }
    const managerBranchId = await findEmployeeBranchId(directManagerId);
    if (managerBranchId !== branchId) {
      throw createServiceError(400, { error: 'يجب أن يكون المدير المباشر من نفس الفرع' });
    }
  }

  const yearsOfExperience = asOptionalNumber(body.yearsOfExperience, 'سنوات الخبرة غير صالحة');
  if (yearsOfExperience != null && yearsOfExperience < 0) {
    throw createServiceError(400, { error: 'سنوات الخبرة يجب أن تكون 0 أو أكثر' });
  }

  const fullName = [firstName, fatherName, lastName].filter(Boolean).join(' ');
  const role = deriveEmployeeRoleFromVacancyTitle(jobTitle);
  const detailedAddress = asOptionalText(body.detailedAddress);

  return {
    branchId,
    branchName: branch.name as string,
    name: fullName,
    firstName,
    fatherName,
    lastName,
    role,
    mobile,
    contacts,
    birthDate,
    gender,
    maritalStatus,
    militaryService,
    residenceGovernorateId,
    residenceGovernorate,
    residenceRegionId,
    residenceRegion,
    residenceSubAreaId,
    residenceSubArea,
    residenceNeighborhoodId,
    residenceNeighborhood,
    detailedAddress,
    residence: buildResidenceText({
      governorate: residenceGovernorate,
      region: residenceRegion,
      subArea: residenceSubArea,
      neighborhood: residenceNeighborhood,
      detailedAddress,
    }),
    status: asEmployeeStatus(body.status),
    avatar: getEmployeeAvatar(fullName, body.avatar || null),
    jobTitle,
    academicQualification: asOptionalText(body.academicQualification),
    specialization: asOptionalText(body.specialization),
    yearsOfExperience,
    drivingLicense: asOptionalBoolean(body.drivingLicense),
    jobSkills: asOptionalText(body.jobSkills),
    foreignLanguages: normalizeStringArray(body.foreignLanguages),
    hireDate: asOptionalDate(body.hireDate, 'تاريخ التوظيف غير صالح'),
    startWorkDate: asOptionalDate(body.startWorkDate, 'تاريخ بدء العمل غير صالح'),
    departmentId,
    contractType,
    workType,
    previousEmployment: asOptionalText(body.previousEmployment),
    directManagerId,
    referrerType: asOptionalText(body.referrerType),
    sourceChannel: asOptionalText(body.sourceChannel),
    referrerName: asOptionalText(body.referrerName),
    referralNotes: asOptionalText(body.referralNotes),
    referralEntityId: asOptionalNumber(body.referralEntityId),
  };
}

export async function insertPreparedEmployeeProfile(db: Queryable, input: EmployeeWriteInput) {
  const { rows } = await db.query(
    `INSERT INTO employees (
      name, first_name, father_name, last_name, role, mobile, branch, branch_id,
      residence_governorate_id, residence_region_id, residence_sub_area_id,
      residence_neighborhood_id, detailed_address, status, avatar, job_title, contacts,
      birth_date, gender, marital_status, military_service, academic_qualification,
      specialization, years_of_experience, driving_license, job_skills, foreign_languages,
      hire_date, start_work_date, department_id, contract_type, work_type,
      previous_employment, direct_manager_id, referrer_type, source_channel,
      referrer_name, referral_notes, referral_entity_id
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,
      $9,$10,$11,
      $12,$13,$14,$15,$16,$17,
      $18,$19,$20,$21,$22,
      $23,$24,$25,$26,$27,
      $28,$29,$30,$31,$32,
      $33,$34,$35,$36,
      $37,$38,$39
    )
    RETURNING id`,
    [
      input.name,
      input.firstName,
      input.fatherName,
      input.lastName,
      input.role,
      input.mobile,
      input.branchName,
      input.branchId,
      input.residenceGovernorateId,
      input.residenceRegionId,
      input.residenceSubAreaId,
      input.residenceNeighborhoodId,
      input.detailedAddress,
      input.status,
      input.avatar,
      input.jobTitle,
      JSON.stringify(input.contacts),
      input.birthDate,
      input.gender,
      input.maritalStatus,
      input.militaryService,
      input.academicQualification,
      input.specialization,
      input.yearsOfExperience,
      input.drivingLicense,
      input.jobSkills,
      JSON.stringify(input.foreignLanguages),
      input.hireDate,
      input.startWorkDate,
      input.departmentId,
      input.contractType,
      input.workType,
      input.previousEmployment,
      input.directManagerId,
      input.referrerType,
      input.sourceChannel,
      input.referrerName,
      input.referralNotes,
      input.referralEntityId,
    ],
  );

  return rows[0].id as number;
}

async function updateEmployeeProfile(employeeId: number | string, input: EmployeeWriteInput) {
  await insertOrUpdatePreparedEmployeeProfile(pool, employeeId, input);
}

async function insertOrUpdatePreparedEmployeeProfile(
  db: Queryable,
  employeeId: number | string,
  input: EmployeeWriteInput,
) {
  await db.query(
    `UPDATE employees
     SET
       name = $1,
       first_name = $2,
       father_name = $3,
       last_name = $4,
       role = $5,
       mobile = $6,
       branch = $7,
       branch_id = $8,
       residence_governorate_id = $9,
       residence_region_id = $10,
       residence_sub_area_id = $11,
       residence_neighborhood_id = $12,
       detailed_address = $13,
       status = $14,
       avatar = $15,
       job_title = $16,
       contacts = $17,
       birth_date = $18,
       gender = $19,
       marital_status = $20,
       military_service = $21,
       academic_qualification = $22,
       specialization = $23,
       years_of_experience = $24,
       driving_license = $25,
       job_skills = $26,
       foreign_languages = $27,
       hire_date = $28,
       start_work_date = $29,
       department_id = $30,
       contract_type = $31,
       work_type = $32,
       previous_employment = $33,
       direct_manager_id = $34,
       referrer_type = $35,
       source_channel = $36,
       referrer_name = $37,
       referral_notes = $38,
       referral_entity_id = $39
     WHERE id = $40`,
    [
      input.name,
      input.firstName,
      input.fatherName,
      input.lastName,
      input.role,
      input.mobile,
      input.branchName,
      input.branchId,
      input.residenceGovernorateId,
      input.residenceRegionId,
      input.residenceSubAreaId,
      input.residenceNeighborhoodId,
      input.detailedAddress,
      input.status,
      input.avatar,
      input.jobTitle,
      JSON.stringify(input.contacts),
      input.birthDate,
      input.gender,
      input.maritalStatus,
      input.militaryService,
      input.academicQualification,
      input.specialization,
      input.yearsOfExperience,
      input.drivingLicense,
      input.jobSkills,
      JSON.stringify(input.foreignLanguages),
      input.hireDate,
      input.startWorkDate,
      input.departmentId,
      input.contractType,
      input.workType,
      input.previousEmployment,
      input.directManagerId,
      input.referrerType,
      input.sourceChannel,
      input.referrerName,
      input.referralNotes,
      input.referralEntityId,
      employeeId,
    ],
  );
}

function splitApplicantLanguages(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  return value.split(',').map((item) => sanitizeText(item)).filter(Boolean);
}

function buildFallbackApplicantContacts(applicant: any): ContactEntry[] {
  const contacts: ContactEntry[] = [];
  const primary = String(applicant?.mobileNumber ?? '').replace(/\D/g, '');
  const secondary = String(applicant?.secondaryMobile ?? '').replace(/\D/g, '');

  if (primary) {
    contacts.push({
      id: 'applicant-primary',
      type: 'mobile',
      number: primary,
      label: 'أساسي',
      hasWhatsApp: Boolean(applicant?.hasWhatsappPrimary),
      isPrimary: false,
      status: 'active',
    });
  }

  if (secondary) {
    contacts.push({
      id: 'applicant-secondary',
      type: 'mobile',
      number: secondary,
      label: 'بديل',
      hasWhatsApp: Boolean(applicant?.hasWhatsappSecondary),
      isPrimary: false,
      status: 'active',
    });
  }

  return contacts;
}

export async function getEmployees(scope?: {
  isSuperAdmin: boolean;
  branchId: number | null;
  includeScheduleAppearanceFlag?: boolean;
}) {
  if (scope && !scope.isSuperAdmin) {
    return listEmployees({
      branchId: scope.branchId,
      includeScheduleAppearanceFlag: scope.includeScheduleAppearanceFlag,
    });
  }
  if (scope?.isSuperAdmin && (scope as any).filterBranchId) {
    return listEmployees({
      branchId: (scope as any).filterBranchId,
      includeScheduleAppearanceFlag: scope.includeScheduleAppearanceFlag,
    });
  }
  return listEmployees({ includeScheduleAppearanceFlag: scope?.includeScheduleAppearanceFlag });
}

export async function getEmployeeById(employeeId: number | string) {
  const row = await fetchEmployeeDetailRow(employeeId);
  if (!row) {
    throw createServiceError(404, { error: 'الموظف غير موجود' });
  }

  const app = await fetchLatestHiringApplication(employeeId);
  let hiringApplication = null;
  let applicant = null;

  if (app) {
    applicant = app.applicantId ? await fetchApplicantById(app.applicantId) : null;
    const vacancy = app.jobVacancyId ? await fetchVacancyById(app.jobVacancyId) : null;
    const referrer = app.referrerId ? await fetchReferrerById(app.referrerId) : null;
    const interviews = await fetchApplicationInterviews(app.id);
    const trainings = await fetchApplicationTrainings(app.id);

    hiringApplication = {
      ...app,
      applicant,
      vacancy,
      referrer,
      interviews,
      trainings,
    };
  }

  const contacts = Array.isArray(row.contacts) && row.contacts.length > 0
    ? row.contacts
    : (applicant ? buildFallbackApplicantContacts(applicant) : []);

  const foreignLanguages = Array.isArray(row.foreignLanguages)
    ? row.foreignLanguages
    : (applicant ? splitApplicantLanguages(applicant.foreignLanguages) : []);

  const jobTasks = row.systemRoleId
    ? (await pool.query(
        `SELECT id, role_id AS "roleId", title, description,
                display_order AS "displayOrder", is_active AS "isActive"
           FROM role_job_tasks
          WHERE role_id = $1 AND is_active = TRUE
          ORDER BY display_order ASC, id ASC`,
        [row.systemRoleId],
      )).rows
    : [];

  return {
    id: row.id,
    employeeNumber: row.employeeNumber,
    name: row.name,
    firstName: row.firstName ?? applicant?.firstName ?? null,
    fatherName: row.fatherName ?? null,
    lastName: row.lastName ?? applicant?.lastName ?? null,
    role: row.role,
    mobile: row.mobile,
    contacts,
    birthDate: row.birthDate,
    gender: row.gender,
    maritalStatus: row.maritalStatus,
    militaryService: row.militaryService,
    branchId: row.branchId,
    branch: row.branch,
    departmentId: row.departmentId,
    departmentName: row.departmentName,
    residence: row.residence,
    residenceShort: row.residenceShort,
    residenceGovernorateId: row.residenceGovernorateId,
    residenceGovernorate: row.residenceGovernorate,
    residenceRegionId: row.residenceRegionId,
    residenceRegion: row.residenceRegion,
    residenceSubAreaId: row.residenceSubAreaId,
    residenceSubArea: row.residenceSubArea,
    residenceNeighborhoodId: row.residenceNeighborhoodId,
    residenceNeighborhood: row.residenceNeighborhood,
    detailedAddress: row.detailedAddress,
    status: row.status,
    avatar: row.avatar,
    jobTitle: row.jobTitle,
    academicQualification: row.academicQualification,
    specialization: row.specialization,
    yearsOfExperience: row.yearsOfExperience,
    drivingLicense: row.drivingLicense,
    jobSkills: row.jobSkills,
    foreignLanguages,
    hireDate: row.hireDate,
    startWorkDate: row.startWorkDate,
    contractType: row.contractType,
    workType: row.workType,
    previousEmployment: row.previousEmployment,
    directManagerId: row.directManagerId,
    directManagerName: row.directManagerName,
    referrerType: row.referrerType,
    sourceChannel: row.sourceChannel,
    referrerName: row.referrerName,
    referralNotes: row.referralNotes,
    createdAt: row.createdAt,
    systemAccount: row.systemUserId ? {
      id: row.systemUserId,
      username: row.systemUsername,
      isActive: row.systemIsActive,
      roleId: row.systemRoleId,
      roleDisplayName: row.systemRoleDisplayName,
    } : null,
    jobTasks,
    hiringApplication,
  };
}

export async function createEmployeeRecord(body: any, branchId: number) {
  const prepared = await prepareEmployeeWriteInput(body, branchId);
  const employeeId = await insertPreparedEmployeeProfile(pool, prepared);
  return fetchEmployeeListItem(employeeId);
}

export async function updateEmployeeRecord(employeeId: number | string, body: any, branchId: number) {
  const existing = await findEmployeeAvatarRecord(employeeId);
  if (!existing) {
    throw createServiceError(404, { error: 'الموظف غير موجود' });
  }

  const prepared = await prepareEmployeeWriteInput(
    {
      ...body,
      avatar: body.avatar === undefined ? existing.avatar : body.avatar,
    },
    branchId,
    { excludeEmployeeId: employeeId },
  );

  await updateEmployeeProfile(employeeId, prepared);

  const employee = await fetchEmployeeListItem(employeeId);
  if (employee) {
    await updateHrUserNameByEmployeeId(prepared.name, employeeId);
  }
  return employee;
}

export async function getEmployeeManagerCandidates(branchId: number, departmentId?: number | null) {
  return listScopedEmployeeManagerCandidates(branchId, departmentId);
}

export async function saveEmployeeSystemAccount(
  employeeId: number,
  body: any,
  scope?: { isSuperAdmin: boolean; branchId: number | null },
) {
  const { username, password, roleId, isActive } = body;
  const employee = await findEmployeeBasic(employeeId);
  if (!employee) {
    throw createServiceError(404, { error: 'الموظف غير موجود' });
  }
  if (!roleId) {
    throw createServiceError(400, { error: 'الدور مطلوب' });
  }

  const normalizedUsername = username?.trim?.();
  const roleCheck = await validateTemplateRoleAssignment(roleId);
  if (roleCheck.ok === false) {
    if (roleCheck.reason === 'NOT_FOUND') {
      throw createServiceError(400, { error: '????? ??? ?????' });
    }
    throw createServiceError(400, { error: TEMPLATE_ROLE_ASSIGNMENT_ERROR });
  }
  const role = roleCheck.role;
  if (!role.isActive) {
    throw createServiceError(400, { error: '?? ???? ????? ??? ????' });
  }

  const account = await findEmployeeSystemAccount(employeeId);
  let savedRow;

  if (!account) {
    if (!normalizedUsername) {
      throw createServiceError(400, { error: 'اسم الدخول مطلوب لإنشاء حساب الموظف' });
    }
    if (!password?.trim?.()) {
      throw createServiceError(400, { error: 'كلمة المرور مطلوبة لإنشاء حساب الموظف' });
    }

    const passwordHash = await bcrypt.hash(password.trim(), 10);
    savedRow = await insertEmployeeSystemAccount({
      employeeName: employee.name,
      username: normalizedUsername,
      passwordHash,
      roleName: role.name,
      roleId: role.id,
      employeeId,
      isActive: isActive ?? true,
    });
  } else {
    let passwordHash: string | undefined;
    if (password?.trim?.()) {
      passwordHash = await bcrypt.hash(password.trim(), 10);
    }

    savedRow = await updateEmployeeSystemAccount({
      accountId: account.id,
      username: normalizedUsername,
      passwordHash,
      roleId: role.id,
      roleName: role.name,
      employeeName: employee.name,
      isActive: typeof isActive === 'boolean' ? isActive : undefined,
    });
    clearPermissionCache(account.id);
  }

  // Auto-assign employee's branch to the hr_user account (best-effort).
  // For new accounts the branch becomes primary; for existing accounts it
  // is added only if not already present (upsert handles duplicates).
  if (employee.branchId != null) {
    try {
      await upsertUserBranchAssignment({
        userId: savedRow.id,
        branchId: employee.branchId,
        isPrimary: !account, // primary for new accounts; let existing logic decide for updates
        status: 'active',
      });
      clearPermissionCache(savedRow.id);
    } catch {
      // Non-fatal � branch assignment failure should not block account save
    }
  }

  const roleDisplayName = await findRoleDisplayName(savedRow.roleId);
  return {
    id: savedRow.id,
    username: savedRow.username,
    isActive: savedRow.isActive,
    roleId: savedRow.roleId,
    roleDisplayName,
  };
}

export async function deleteEmployeeRecord(employeeId: number | string) {
  await unlinkEmployeeSystemAccounts(employeeId);
  await deleteEmployee(employeeId);
  return { success: true };
}

