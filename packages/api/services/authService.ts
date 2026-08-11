import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../config/env.js';
import { findUserForLogin, getRoleGrants, type RoleGrant } from '../repositories/authRepository.js';
import type { DeviceClass } from './deviceClass.js';
import { decideWebDeviceAccess, loadAllowedTeamSlots } from './webDeviceAccessPolicy.js';

export interface LoginResult {
  token: string;
  user: {
    id: number;
    name: string;
    role: string;
    roleId: number | null;
    roleDisplayName: string | null;
    isSuperAdmin: boolean;
    branchId: number | null;
    employeeId: number | null;
    teamSlotType: string | null;
  };
  permissions: string[];
  grants: RoleGrant[];
}

export interface SessionResult {
  user: LoginResult['user'];
  permissions: string[];
  grants: RoleGrant[];
}

export async function loginUser(
  username: string,
  password: string,
  deviceClass?: DeviceClass,
): Promise<LoginResult> {
  const user = await findUserForLogin(username);

  if (!user) {
    throw Object.assign(new Error('اسم المستخدم أو كلمة المرور غير صحيحة'), { status: 401 });
  }

  if (!user.is_active) {
    throw Object.assign(new Error('الحساب غير مفعّل. تواصل مع المدير.'), { status: 403 });
  }

  const match = await bcrypt.compare(password, user.password_hash);
  if (!match) {
    throw Object.assign(new Error('اسم المستخدم أو كلمة المرور غير صحيحة'), { status: 401 });
  }

  // Device policy. Necessarily AFTER the password check, because the rule keys
  // on the role and the role is unknown until the user is identified. The cost
  // is that a wrong password and a blocked device give different messages, so a
  // valid pair is implicitly confirmed; accepted deliberately — one shared,
  // vague message would tell a supervisor who mistyped their password to go
  // find a desktop.
  if (deviceClass) {
    const decision = decideWebDeviceAccess({
      deviceClass,
      teamSlotType: user.team_slot_type,
      allowedSlots: await loadAllowedTeamSlots(),
    });
    if (decision.blocked) {
      throw Object.assign(new Error(decision.blocked.message), {
        status: 403,
        details: { code: decision.blocked.code, deviceClass },
      });
    }
  }

  let grants: RoleGrant[] = [];
  if (user.role_id) {
    grants = await getRoleGrants(user.role_id);
  }

  const permissions = derivePermissionsFromGrants(grants);

  const tokenPayload = {
    id: user.id,
    name: user.name,
    role: user.role,
    roleId: user.role_id,
    roleDisplayName: user.role_display_name,
    isSuperAdmin: user.is_super_admin === true,
    branchId: user.branch_id,
    employeeId: user.employee_id,
    teamSlotType: user.team_slot_type,
  };

  const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '7d' });

  return {
    token,
    user: {
      id: user.id,
      name: user.name,
      role: user.role,
      roleId: user.role_id,
      roleDisplayName: user.role_display_name,
      isSuperAdmin: user.is_super_admin === true,
      branchId: user.branch_id,
      employeeId: user.employee_id,
      teamSlotType: user.team_slot_type,
    },
    permissions,
    grants,
  };
}

export async function getCurrentSession(user: {
  id: number;
  name: string;
  role: string;
  roleId?: number | null;
  roleDisplayName?: string | null;
  isSuperAdmin?: boolean;
  branchId?: number | null;
  employeeId?: number | null;
  teamSlotType?: string | null;
}): Promise<SessionResult> {
  let grants: RoleGrant[] = [];
  if (user.roleId) {
    grants = await getRoleGrants(user.roleId);
  }

  return {
    user: {
      id: user.id,
      name: user.name,
      role: user.role,
      roleId: user.roleId ?? null,
      roleDisplayName: user.roleDisplayName ?? null,
      isSuperAdmin: user.isSuperAdmin === true,
      branchId: user.branchId ?? null,
      employeeId: user.employeeId ?? null,
      teamSlotType: user.teamSlotType ?? null,
    },
    permissions: derivePermissionsFromGrants(grants),
    grants,
  };
}

function derivePermissionsFromGrants(grants: RoleGrant[]): string[] {
  return Array.from(new Set(grants.map(grant => grant.permission)));
}
