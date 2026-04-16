import bcrypt from 'bcryptjs';
import { clearPermissionCache } from '../middleware/permission.js';
import { deriveEmployeeRoleFromVacancyTitle, getEmployeeAvatar } from '../utils/recruitmentPolicy.js';
import { sanitizeText } from '../utils/sanitize.js';
import {
  createEmployee,
  deleteEmployee,
  fetchApplicantById,
  fetchApplicationInterviews,
  fetchApplicationTrainings,
  fetchEmployeeDetailRow,
  fetchEmployeeListItem,
  fetchLatestHiringApplication,
  fetchReferrerById,
  fetchVacancyById,
  findEmployeeAvatarRecord,
  findEmployeeBasic,
  findEmployeeSystemAccount,
  findRoleById,
  findRoleDisplayName,
  insertEmployeeSystemAccount,
  listEmployees,
  unlinkEmployeeSystemAccounts,
  updateEmployee,
  updateEmployeeSystemAccount,
  updateHrUserNameByEmployeeId,
} from '../repositories/employeeRepository.js';

type ServiceError = Error & {
  status?: number;
  payload?: Record<string, unknown>;
};

function createServiceError(status: number, payload: Record<string, unknown>): ServiceError {
  const err = new Error(String(payload.error ?? 'Service error')) as ServiceError;
  err.status = status;
  err.payload = payload;
  return err;
}

function getEmployeeRoleOrError(jobTitle: string | null | undefined) {
  const role = deriveEmployeeRoleFromVacancyTitle(jobTitle);
  if (!role) {
    return {
      role: null,
      error: 'Ø§Ù„Ù…Ø³Ù…Ù‰ Ø§Ù„ÙˆØ¸ÙŠÙÙŠ ÙŠØ¬Ø¨ Ø£Ù† ÙŠØ·Ø§Ø¨Ù‚ Ø£Ø­Ø¯ Ø§Ù„Ø£Ø¯ÙˆØ§Ø± Ø§Ù„Ù…Ø¹ØªÙ…Ø¯Ø©: Ù…Ø´Ø±ÙØ©ØŒ ÙÙ†ÙŠØŒ ØªÙŠÙ„Ù…Ø§Ø±ÙƒØªØ±.',
    };
  }
  return { role, error: null };
}

export async function getEmployees(opts?: { page?: number; limit?: number; search?: string }) {
  return listEmployees(opts);
}

export async function getEmployeeById(employeeId: number | string) {
  const row = await fetchEmployeeDetailRow(employeeId);
  if (!row) {
    throw createServiceError(404, { error: 'Ø§Ù„Ù…ÙˆØ¸Ù ØºÙŠØ± Ù…ÙˆØ¬ÙˆØ¯' });
  }

  const app = await fetchLatestHiringApplication(employeeId);
  let hiringApplication = null;

  if (app) {
    const applicant = app.applicantId ? await fetchApplicantById(app.applicantId) : null;
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

  return {
    id: row.id,
    name: row.name,
    role: row.role,
    mobile: row.mobile,
    branch: row.branch,
    residence: row.residence,
    residenceShort: row.residenceShort,
    status: row.status,
    avatar: row.avatar,
    jobTitle: row.jobTitle,
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

export async function createEmployeeRecord(body: any) {
  const { name, mobile, branch, residence, status, avatar, jobTitle } = body;
  const cleanName = sanitizeText(name);
  const cleanJobTitle = jobTitle ? sanitizeText(jobTitle) : null;
  const { role, error } = getEmployeeRoleOrError(cleanJobTitle);
  if (error || !role) {
    throw createServiceError(400, { error });
  }

  const avatarUrl = getEmployeeAvatar(cleanName, avatar || null);
  const employeeId = await createEmployee({
    name: cleanName,
    role,
    mobile,
    branch: branch ? sanitizeText(branch) : null,
    residence: residence ? sanitizeText(residence) : null,
    status: status || 'active',
    avatar: avatarUrl,
    jobTitle: cleanJobTitle,
  });

  return fetchEmployeeListItem(employeeId);
}

export async function updateEmployeeRecord(employeeId: number | string, body: any) {
  const { name, mobile, branch, residence, status, avatar, jobTitle } = body;
  const cleanName = sanitizeText(name);
  const cleanJobTitle = jobTitle ? sanitizeText(jobTitle) : null;
  const { role, error } = getEmployeeRoleOrError(cleanJobTitle);
  if (error || !role) {
    throw createServiceError(400, { error });
  }

  const existing = await findEmployeeAvatarRecord(employeeId);
  if (!existing) {
    throw createServiceError(404, { error: 'Ø§Ù„Ù…ÙˆØ¸Ù ØºÙŠØ± Ù…ÙˆØ¬ÙˆØ¯' });
  }

  const nextAvatar = avatar === undefined ? existing.avatar : getEmployeeAvatar(cleanName, avatar || null);

  await updateEmployee({
    employeeId,
    name: cleanName,
    role,
    mobile,
    branch: branch ? sanitizeText(branch) : null,
    residence: residence ? sanitizeText(residence) : null,
    status,
    avatar: nextAvatar,
    jobTitle: cleanJobTitle,
  });

  const employee = await fetchEmployeeListItem(employeeId);
  if (employee) {
    await updateHrUserNameByEmployeeId(employee.name, employeeId);
  }
  return employee;
}

export async function saveEmployeeSystemAccount(employeeId: number, body: any) {
  const { username, password, roleId, isActive } = body;
  const employee = await findEmployeeBasic(employeeId);
  if (!employee) {
    throw createServiceError(404, { error: 'Ø§Ù„Ù…ÙˆØ¸Ù ØºÙŠØ± Ù…ÙˆØ¬ÙˆØ¯' });
  }
  if (!roleId) {
    throw createServiceError(400, { error: 'Ø§Ù„Ø¯ÙˆØ± Ù…Ø·Ù„ÙˆØ¨' });
  }

  const normalizedUsername = username?.trim?.();
  const role = await findRoleById(roleId);
  if (!role) {
    throw createServiceError(400, { error: 'Ø§Ù„Ø¯ÙˆØ± ØºÙŠØ± Ù…ÙˆØ¬ÙˆØ¯' });
  }
  if (!role.is_active) {
    throw createServiceError(400, { error: 'Ù„Ø§ ÙŠÙ…ÙƒÙ† Ø¥Ø³Ù†Ø§Ø¯ Ø¯ÙˆØ± Ù…Ø¹Ø·Ù„' });
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
