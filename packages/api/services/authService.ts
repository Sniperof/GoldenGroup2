import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../config/env.js';
import { findUserForLogin, getRolePermissions } from '../repositories/authRepository.js';

export interface LoginResult {
  token: string;
  user: {
    id: number;
    name: string;
    role: string;
    roleId: number | null;
  };
  permissions: string[];
}

export async function loginUser(username: string, password: string): Promise<LoginResult> {
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

  let permissions: string[] = [];
  if (user.role_id) {
    permissions = await getRolePermissions(user.role_id);
  }

  const token = jwt.sign(
    { id: user.id, name: user.name, role: user.role, roleId: user.role_id },
    JWT_SECRET,
    { expiresIn: '7d' }
  );

  return {
    token,
    user: { id: user.id, name: user.name, role: user.role, roleId: user.role_id },
    permissions,
  };
}
