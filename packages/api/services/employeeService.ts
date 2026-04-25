import bcrypt from 'bcryptjs';
import type { ContactEntry, ContactStatus, ContactType } from '@golden-crm/shared';
import pool from '../db.js';
import { clearPermissionCache } from '../middleware/permission.js';
import { TEMPLATE_ROLE_ASSIGNMENT_ERROR, validateTemplateRoleAssignment } from './roleAssignmentGuard.js';
import { deriveEmployeeRoleFromVacancyTitle, getEmployeeAvatar } from '../utils/recruitmentPolicy.js';
import { sanitizeText } from '../utils/sanitize.js';
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
  status: 'active' | 'leave' | 'inactive';
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
    throw createServiceError(400, { error: error || 'Ø§Ù„ØªØ§Ø±ÙŠØ® ØºÙŠØ± ØµØ§Ù„Ø­' });
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
    throw createServiceError(400, { error: error || 'Ø§Ù„Ù‚ÙŠÙ…Ø© Ø§Ù„Ø±Ù‚Ù…ÙŠØ© ØºÙŠØ± ØµØ§Ù„Ø­Ø©' });
  }
  return num;
}

function asGender(value: unknown): 'male' | 'female' {
  const raw = String(value ?? '').trim().toLowerCase();
  if (raw === 'male' || raw === 'Ø°ÙƒØ±') return 'male';
  if (raw === 'female' || raw === 'Ø£Ù†Ø«Ù‰' || raw === 'Ø§Ù†Ø«Ù‰') return 'female';
  throw createServiceError(400, { error: 'Ø§Ù„Ø¬Ù†Ø³ Ù…Ø·Ù„ÙˆØ¨' });
}

function asEmployeeStatus(value: unknown): 'active' | 'leave' | 'inactive' {
  const raw = String(value ?? 'active').trim();
  if (raw === 'leave' || raw === 'inactive') return raw;
  return 'active';
}

function asOptionalBoolean(value: unknown): boolean | null {
  if (value == null || value === '') return null;
  if (typeof value === 'boolean') return value;
  const raw = String(value).trim().toLowerCase();
  if (['yes', 'true', '1', 'Ù†Ø¹Ù…'].includes(raw)) return true;
  if (['no', 'false', '0', 'Ù„Ø§'].includes(raw)) return false;
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

function normalizeContactType(value: unknown): ContactType {
  const raw = String(value ?? 'mobile').trim();
  if (raw === 'landline' || raw === 'other') return raw;
  return 'mobile';
}

function normalizeContactStatus(value: unknown): ContactStatus {
  const raw = String(value ?? 'active').trim();
  if (raw === 'preferred' || raw === 'out-of-coverage' || raw === 'unused') return raw;
  return 'active';
}

function normalizeMobileDigits(value: unknown): string {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (digits.length === 9) return `0${digits}`;
  return digits;
}

function normalizeContacts(rawContacts: unknown, fallbackMobile?: unknown): ContactEntry[] {
  const source = Array.isArray(rawContacts) ? rawContacts : [];
  const prepared = source
    .map((item, index): ContactEntry | null => {
      const record = item && typeof item === 'object' ? item as Record<string, unknown> : {};
      const type = normalizeContactType(record.type);
      const digits = type === 'mobile'
        ? normalizeMobileDigits(record.number)
        : String(record.number ?? '').replace(/\D/g, '');
      if (!digits) return null;

      if (type === 'mobile' && digits.length !== 10) {
        throw createServiceError(400, { error: 'Ø±Ù‚Ù… Ø§Ù„Ù…ÙˆØ¨Ø§ÙŠÙ„ ÙŠØ¬Ø¨ Ø£Ù† ÙŠØªÙƒÙˆÙ† Ù…Ù† 10 Ø£Ø±Ù‚Ø§Ù…' });
      }
      if (type === 'landline' && digits.length !== 7) {
        throw createServiceError(400, { error: 'Ø±Ù‚Ù… Ø§Ù„Ù‡Ø§ØªÙ Ø§Ù„Ø£Ø±Ø¶ÙŠ ÙŠØ¬Ø¨ Ø£Ù† ÙŠØªÙƒÙˆÙ† Ù…Ù† 7 Ø£Ø±Ù‚Ø§Ù…' });
      }

      const areaCode = type === 'landline'
        ? String(record.areaCode ?? '').replace(/\D/g, '').slice(0, 3)
        : undefined;

      if (type === 'landline' && !areaCode) {
        throw createServiceError(400, { error: 'Ù„Ø§Ø­Ù‚Ø© Ø§Ù„Ù‡Ø§ØªÙ Ø§Ù„Ø£Ø±Ø¶ÙŠ Ù…Ø·Ù„ÙˆØ¨Ø©' });
      }

      return {
        id: sanitizeText(String(record.id ?? `emp-contact-${index + 1}`)) || `emp-contact-${index + 1}`,
        type,
        number: digits,
        areaCode,
        label: sanitizeText(String(record.label ?? '')) || '',
        hasWhatsApp: Boolean(record.hasWhatsApp),
        isPrimary: false,
        status: normalizeContactStatus(record.status),
      };
    })
    .filter((item): item is ContactEntry => Boolean(item));

  if (prepared.length === 0) {
    const fallback = normalizeMobileDigits(fallbackMobile);
    if (fallback) {
      prepared.push({
        id: 'emp-contact-1',
        type: 'mobile',
        number: fallback,
        label: '',
        hasWhatsApp: false,
        isPrimary: true,
        status: 'active',
      });
    }
  }

  if (prepared.length === 0) {
    throw createServiceError(400, { error: 'ÙŠØ¬Ø¨ Ø¥Ø¶Ø§ÙØ© ÙˆØ³ÙŠÙ„Ø© ØªÙˆØ§ØµÙ„ ÙˆØ§Ø­Ø¯Ø© Ø¹Ù„Ù‰ Ø§Ù„Ø£Ù‚Ù„' });
  }

  const primaryIndex = prepared.findIndex((contact) => contact.type === 'mobile');
  const effectivePrimary = primaryIndex >= 0 ? primaryIndex : 0;
  return prepared.map((contact, index) => ({ ...contact, isPrimary: index === effectivePrimary }));
}

function getCanonicalMobile(contacts: ContactEntry[]): string {
  const primary = contacts.find((contact) => contact.isPrimary) || contacts[0];
  if (!primary) {
    throw createServiceError(400, { error: 'ÙŠØ¬Ø¨ Ø¥Ø¶Ø§ÙØ© ÙˆØ³ÙŠÙ„Ø© ØªÙˆØ§ØµÙ„ ØµØ§Ù„Ø­Ø©' });
  }
  return primary.type === 'landline' && primary.areaCode
    ? `${primary.areaCode}${primary.number}`
    : primary.number;
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
  const firstName = asRequiredText(body.firstName, 'Ø§Ù„Ø§Ø³Ù… Ø§Ù„Ø£ÙˆÙ„ Ù…Ø·Ù„ÙˆØ¨');
  const lastName = asRequiredText(body.lastName, 'Ø§Ù„ÙƒÙ†ÙŠØ© Ù…Ø·Ù„ÙˆØ¨Ø©');
  const fatherName = asOptionalText(body.fatherName);
  const birthDate = asRequiredDate(body.birthDate, 'ØªØ§Ø±ÙŠØ® Ø§Ù„Ù…ÙŠÙ„Ø§Ø¯ Ù…Ø·Ù„ÙˆØ¨');
  const gender = asGender(body.gender);
  const maritalStatus = asRequiredText(body.maritalStatus, 'Ø§Ù„Ø­Ø§Ù„Ø© Ø§Ù„Ø§Ø¬ØªÙ…Ø§Ø¹ÙŠØ© Ù…Ø·Ù„ÙˆØ¨Ø©');
  const militaryService = asRequiredText(body.militaryService, 'Ø§Ù„Ø®Ø¯Ù…Ø© Ø§Ù„Ø¹Ø³ÙƒØ±ÙŠØ© Ù…Ø·Ù„ÙˆØ¨Ø©');
  const jobTitle = asRequiredText(body.jobTitle, 'Ø§Ù„Ù…Ø³Ù…Ù‰ Ø§Ù„ÙˆØ¸ÙŠÙÙŠ Ù…Ø·Ù„ÙˆØ¨');
  const contractType = asRequiredText(body.contractType, 'Ù†ÙˆØ¹ Ø§Ù„Ø¹Ù‚Ø¯ Ù…Ø·Ù„ÙˆØ¨');
  const workType = asRequiredText(body.workType, 'Ù†ÙˆØ¹ Ø§Ù„Ø¹Ù…Ù„ Ù…Ø·Ù„ÙˆØ¨');
  const departmentId = asOptionalNumber(body.departmentId, 'Ø§Ù„Ù‚Ø³Ù… ØºÙŠØ± ØµØ§Ù„Ø­');
  if (!departmentId) {
    throw createServiceError(400, { error: 'Ø§Ù„Ù‚Ø³Ù… Ù…Ø·Ù„ÙˆØ¨' });
  }

  const geoSelection = body.geoSelection || {};
  const residenceGovernorateId = asOptionalNumber(geoSelection.govId ?? body.residenceGovernorateId, 'Ø§Ù„Ù…Ø­Ø§ÙØ¸Ø© ØºÙŠØ± ØµØ§Ù„Ø­Ø©');
  const residenceRegionId = asOptionalNumber(geoSelection.regionId ?? body.residenceRegionId, 'Ø§Ù„Ù…Ù†Ø·Ù‚Ø© ØºÙŠØ± ØµØ§Ù„Ø­Ø©');
  const residenceSubAreaId = asOptionalNumber(geoSelection.subId ?? body.residenceSubAreaId, 'Ø§Ù„Ù†Ø§Ø­ÙŠØ© ØºÙŠØ± ØµØ§Ù„Ø­Ø©');
  const residenceNeighborhoodId = asOptionalNumber(
    geoSelection.neighborhoodId ?? body.residenceNeighborhoodId,
    'Ø§Ù„Ø­ÙŠ ØºÙŠØ± ØµØ§Ù„Ø­',
  );

  if (!residenceGovernorateId) {
    throw createServiceError(400, { error: 'Ø§Ù„Ù…Ø­Ø§ÙØ¸Ø© Ù…Ø·Ù„ÙˆØ¨Ø©' });
  }
  if (!residenceRegionId) {
    throw createServiceError(400, { error: 'Ø§Ù„Ù…Ù†Ø·Ù‚Ø© Ù…Ø·Ù„ÙˆØ¨Ø©' });
  }
  if (!residenceSubAreaId) {
    throw createServiceError(400, { error: 'Ø§Ù„Ù†Ø§Ø­ÙŠØ© Ù…Ø·Ù„ÙˆØ¨Ø©' });
  }

  const branch = await findBranchById(branchId);
  if (!branch) {
    throw createServiceError(400, { error: 'Ø§Ù„ÙØ±Ø¹ Ø§Ù„Ù…Ø­Ø¯Ø¯ ØºÙŠØ± Ù…ÙˆØ¬ÙˆØ¯' });
  }

  const department = await findDepartmentInBranch(departmentId, branchId);
  if (!department) {
    throw createServiceError(400, { error: 'Ø§Ù„Ù‚Ø³Ù… Ø§Ù„Ù…Ø­Ø¯Ø¯ Ù„Ø§ ÙŠÙ†ØªÙ…ÙŠ Ø¥Ù„Ù‰ Ø§Ù„ÙØ±Ø¹ Ø§Ù„Ù…Ø®ØªØ§Ø±' });
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
    throw createServiceError(400, { error: 'ØªØ¹Ø°Ø± Ù‚Ø±Ø§Ø¡Ø© Ø§Ù„Ø¹Ù†ÙˆØ§Ù† Ø§Ù„Ø¬ØºØ±Ø§ÙÙŠ Ø§Ù„Ù…Ø­Ø¯Ø¯' });
  }

  const contacts = normalizeContacts(body.contacts, body.mobile);
  const mobile = getCanonicalMobile(contacts);

  const duplicate = await findEmployeeDuplicateByContactNumbers(
    Array.from(new Set(contacts.map((contact) => contact.number))),
    options?.excludeEmployeeId ?? null,
  );
  if (duplicate) {
    throw createServiceError(409, {
      error: `ÙŠÙˆØ¬Ø¯ Ø³Ø¬Ù„ Ù…ÙˆØ¸Ù Ù…Ø·Ø§Ø¨Ù‚ Ù„Ø£Ø­Ø¯ Ø£Ø±Ù‚Ø§Ù… Ø§Ù„ØªÙˆØ§ØµÙ„ Ù…Ø³Ø¨Ù‚Ø§Ù‹ (#${duplicate.employeeNumber ?? duplicate.id})`,
      duplicateEmployeeId: duplicate.id,
    });
  }

  const directManagerId = asOptionalNumber(body.directManagerId, 'Ø§Ù„Ù…Ø¯ÙŠØ± Ø§Ù„Ù…Ø¨Ø§Ø´Ø± ØºÙŠØ± ØµØ§Ù„Ø­');
  if (directManagerId != null) {
    if (options?.excludeEmployeeId != null && Number(options.excludeEmployeeId) === directManagerId) {
      throw createServiceError(400, { error: 'Ù„Ø§ ÙŠÙ…ÙƒÙ† Ø£Ù† ÙŠÙƒÙˆÙ† Ø§Ù„Ù…ÙˆØ¸Ù Ù…Ø¯ÙŠØ±Ø§Ù‹ Ù…Ø¨Ø§Ø´Ø±Ø§Ù‹ Ù„Ù†ÙØ³Ù‡' });
    }
    const managerCandidates = await listScopedEmployeeManagerCandidates(branchId, departmentId);
    if (!managerCandidates.some((candidate) => candidate.id === directManagerId)) {
      throw createServiceError(400, {
        error: 'ÙŠØ¬Ø¨ Ø§Ø®ØªÙŠØ§Ø± Ø§Ù„Ù…Ø¯ÙŠØ± Ø§Ù„Ù…Ø¨Ø§Ø´Ø± Ù…Ù† Ù…Ø¯Ø±Ø§Ø¡ Ø§Ù„Ù‚Ø³Ù… Ø§Ù„Ù…Ø¹ØªÙ…Ø¯ÙŠÙ† ÙÙŠ Ù†ÙØ³ Ø§Ù„ÙØ±Ø¹',
      });
    }
    const managerBranchId = await findEmployeeBranchId(directManagerId);
    if (managerBranchId !== branchId) {
      throw createServiceError(400, { error: 'ÙŠØ¬Ø¨ Ø£Ù† ÙŠÙƒÙˆÙ† Ø§Ù„Ù…Ø¯ÙŠØ± Ø§Ù„Ù…Ø¨Ø§Ø´Ø± Ù…Ù† Ù†ÙØ³ Ø§Ù„ÙØ±Ø¹' });
    }
  }

  const yearsOfExperience = asOptionalNumber(body.yearsOfExperience, 'Ø³Ù†ÙˆØ§Øª Ø§Ù„Ø®Ø¨Ø±Ø© ØºÙŠØ± ØµØ§Ù„Ø­Ø©');
  if (yearsOfExperience != null && yearsOfExperience < 0) {
    throw createServiceError(400, { error: 'Ø³Ù†ÙˆØ§Øª Ø§Ù„Ø®Ø¨Ø±Ø© ÙŠØ¬Ø¨ Ø£Ù† ØªÙƒÙˆÙ† 0 Ø£Ùˆ Ø£ÙƒØ«Ø±' });
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
    hireDate: asOptionalDate(body.hireDate, 'ØªØ§Ø±ÙŠØ® Ø§Ù„ØªÙˆØ¸ÙŠÙ ØºÙŠØ± ØµØ§Ù„Ø­'),
    startWorkDate: asOptionalDate(body.startWorkDate, 'ØªØ§Ø±ÙŠØ® Ø¨Ø¯Ø¡ Ø§Ù„Ø¹Ù…Ù„ ØºÙŠØ± ØµØ§Ù„Ø­'),
    departmentId,
    contractType,
    workType,
    previousEmployment: asOptionalText(body.previousEmployment),
    directManagerId,
    referrerType: asOptionalText(body.referrerType),
    sourceChannel: asOptionalText(body.sourceChannel),
    referrerName: asOptionalText(body.referrerName),
    referralNotes: asOptionalText(body.referralNotes),
  };
}

export async function insertPreparedEmployeeProfile(db: Queryable, input: EmployeeWriteInput) {
  const { rows } = await db.query(
    `INSERT INTO employees (
      name, first_name, father_name, last_name, role, mobile, branch, branch_id,
      residence, residence_governorate_id, residence_region_id, residence_sub_area_id,
      residence_neighborhood_id, detailed_address, status, avatar, job_title, contacts,
      birth_date, gender, marital_status, military_service, academic_qualification,
      specialization, years_of_experience, driving_license, job_skills, foreign_languages,
      hire_date, start_work_date, department_id, contract_type, work_type,
      previous_employment, direct_manager_id, referrer_type, source_channel,
      referrer_name, referral_notes
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,
      $9,$10,$11,$12,
      $13,$14,$15,$16,$17,$18,
      $19,$20,$21,$22,$23,
      $24,$25,$26,$27,$28,
      $29,$30,$31,$32,$33,
      $34,$35,$36,$37,
      $38,$39
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
      input.residence,
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
       residence = $9,
       residence_governorate_id = $10,
       residence_region_id = $11,
       residence_sub_area_id = $12,
       residence_neighborhood_id = $13,
       detailed_address = $14,
       status = $15,
       avatar = $16,
       job_title = $17,
       contacts = $18,
       birth_date = $19,
       gender = $20,
       marital_status = $21,
       military_service = $22,
       academic_qualification = $23,
       specialization = $24,
       years_of_experience = $25,
       driving_license = $26,
       job_skills = $27,
       foreign_languages = $28,
       hire_date = $29,
       start_work_date = $30,
       department_id = $31,
       contract_type = $32,
       work_type = $33,
       previous_employment = $34,
       direct_manager_id = $35,
       referrer_type = $36,
       source_channel = $37,
       referrer_name = $38,
       referral_notes = $39
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
      input.residence,
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
      label: 'Ø£Ø³Ø§Ø³ÙŠ',
      hasWhatsApp: Boolean(applicant?.hasWhatsappPrimary),
      isPrimary: true,
      status: 'active',
    });
  }

  if (secondary) {
    contacts.push({
      id: 'applicant-secondary',
      type: 'mobile',
      number: secondary,
      label: 'Ø¨Ø¯ÙŠÙ„',
      hasWhatsApp: Boolean(applicant?.hasWhatsappSecondary),
      isPrimary: !primary,
      status: 'active',
    });
  }

  return contacts;
}

export async function getEmployees(scope?: { isSuperAdmin: boolean; branchId: number | null }) {
  if (scope && !scope.isSuperAdmin) {
    return listEmployees({ branchId: scope.branchId });
  }
  if (scope?.isSuperAdmin && (scope as any).filterBranchId) {
    return listEmployees({ branchId: (scope as any).filterBranchId });
  }
  return listEmployees();
}

export async function getEmployeeById(employeeId: number | string) {
  const row = await fetchEmployeeDetailRow(employeeId);
  if (!row) {
    throw createServiceError(404, { error: 'Ø§Ù„Ù…ÙˆØ¸Ù ØºÙŠØ± Ù…ÙˆØ¬ÙˆØ¯' });
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
    throw createServiceError(404, { error: 'Ø§Ù„Ù…ÙˆØ¸Ù ØºÙŠØ± Ù…ÙˆØ¬ÙˆØ¯' });
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
    throw createServiceError(404, { error: 'Ø§Ù„Ù…ÙˆØ¸Ù ØºÙŠØ± Ù…ÙˆØ¬ÙˆØ¯' });
  }
  if (!roleId) {
    throw createServiceError(400, { error: 'Ø§Ù„Ø¯ÙˆØ± Ù…Ø·Ù„ÙˆØ¨' });
  }

  const normalizedUsername = username?.trim?.();
  const roleCheck = await validateTemplateRoleAssignment(roleId);
  if (roleCheck.ok === false) {
    if (roleCheck.reason === 'NOT_FOUND') {
      throw createServiceError(400, { error: 'الدور غير موجود' });
    }
    throw createServiceError(400, { error: TEMPLATE_ROLE_ASSIGNMENT_ERROR });
  }
  const role = roleCheck.role;
  if (!role.isActive) {
    throw createServiceError(400, { error: 'لا يمكن إسناد دور معطل' });
  }

  const account = await findEmployeeSystemAccount(employeeId);
  let savedRow;

  if (!account) {
    if (!normalizedUsername) {
      throw createServiceError(400, { error: 'Ø§Ø³Ù… Ø§Ù„Ø¯Ø®ÙˆÙ„ Ù…Ø·Ù„ÙˆØ¨ Ù„Ø¥Ù†Ø´Ø§Ø¡ Ø­Ø³Ø§Ø¨ Ø§Ù„Ù…ÙˆØ¸Ù' });
    }
    if (!password?.trim?.()) {
      throw createServiceError(400, { error: 'ÙƒÙ„Ù…Ø© Ø§Ù„Ù…Ø±ÙˆØ± Ù…Ø·Ù„ÙˆØ¨Ø© Ù„Ø¥Ù†Ø´Ø§Ø¡ Ø­Ø³Ø§Ø¨ Ø§Ù„Ù…ÙˆØ¸Ù' });
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

