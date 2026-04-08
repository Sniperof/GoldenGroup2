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
    throw Object.assign(new Error('Ã˜Â§Ã˜Â³Ã™â€¦ Ã˜Â§Ã™â€žÃ™â€¦Ã˜Â³Ã˜ÂªÃ˜Â®Ã˜Â¯Ã™â€¦ Ã˜Â£Ã™Ë† Ã™Æ’Ã™â€žÃ™â€¦Ã˜Â© Ã˜Â§Ã™â€žÃ™â€¦Ã˜Â±Ã™Ë†Ã˜Â± Ã˜ÂºÃ™Å Ã˜Â± Ã˜ÂµÃ˜Â­Ã™Å Ã˜Â­Ã˜Â©'), { status: 401 });
  }

  if (!user.is_active) {
    throw Object.assign(new Error('Ã˜Â§Ã™â€žÃ˜Â­Ã˜Â³Ã˜Â§Ã˜Â¨ Ã˜ÂºÃ™Å Ã˜Â± Ã™â€¦Ã™ÂÃ˜Â¹Ã™â€˜Ã™â€ž. Ã˜ÂªÃ™Ë†Ã˜Â§Ã˜ÂµÃ™â€ž Ã™â€¦Ã˜Â¹ Ã˜Â§Ã™â€žÃ™â€¦Ã˜Â¯Ã™Å Ã˜Â±.'), { status: 403 });
  }

  const match = await bcrypt.compare(password, user.password_hash);
  if (!match) {
    throw Object.assign(new Error('Ã˜Â§Ã˜Â³Ã™â€¦ Ã˜Â§Ã™â€žÃ™â€¦Ã˜Â³Ã˜ÂªÃ˜Â®Ã˜Â¯Ã™â€¦ Ã˜Â£Ã™Ë† Ã™Æ’Ã™â€žÃ™â€¦Ã˜Â© Ã˜Â§Ã™â€žÃ™â€¦Ã˜Â±Ã™Ë†Ã˜Â± Ã˜ÂºÃ™Å Ã˜Â± Ã˜ÂµÃ˜Â­Ã™Å Ã˜Â­Ã˜Â©'), { status: 401 });
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
