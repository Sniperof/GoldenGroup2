// ============================================================
// services/appAccounts/appAuthService.ts
// ============================================================
// Phase 6 (DEC-013 §6) — customer session tokens (separate from staff auth).
//
//   exchangeLoginHandle(handle) → verify a one-time login handle → issue
//                                 access (JWT, 60m) + refresh (rotating, 60d)
//   refreshTokens(refreshToken) → rotate; reuse of a revoked token ⇒ revoke the
//                                 whole family (theft detection)
//   logout(refreshToken)        → revoke the token's family
//   verifyAccessToken(token)    → decode + ENFORCE app_accounts.status (suspend
//                                 takes effect immediately, not at token expiry)
//
// Refresh tokens are stored HMAC-hashed (never raw). Access tokens carry
// typ:'app_access' so they can't be confused with staff JWTs.
// ============================================================

import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import type { PoolClient } from 'pg';
import pool from '../../db.js';
import { JWT_SECRET, APP_ACCESS_TTL, APP_REFRESH_TTL_DAYS } from '../../config/env.js';
import { acquireTx, commitTx, rollbackTx } from '../serviceRequests/_shared.js';

const HANDLE_TTL_MS = 10 * 60 * 1000;

function httpError(status: number, message: string, details?: Record<string, unknown>) {
  return Object.assign(new Error(message), { status, ...(details ? { details } : {}) });
}

export interface AppAccountClaims {
  appAccountId: number;
  clientId: number;
  phone: string;
}
export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: number; // access token seconds
  account: AppAccountClaims;
}

function hashRefresh(token: string): string {
  return crypto.createHmac('sha256', JWT_SECRET).update(token).digest('hex');
}

function signAccessToken(claims: AppAccountClaims): string {
  return jwt.sign(
    { typ: 'app_access', appAccountId: claims.appAccountId, clientId: claims.clientId, phone: claims.phone },
    JWT_SECRET,
    { expiresIn: APP_ACCESS_TTL as any },
  );
}

/** Insert a fresh refresh-token row (optionally continuing an existing family). */
async function insertRefreshToken(
  db: PoolClient,
  appAccountId: number,
  familyId: string | null,
  deviceLabel: string | null,
): Promise<{ raw: string; id: number }> {
  const raw = crypto.randomBytes(32).toString('hex');
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO app_refresh_tokens
       (app_account_id, token_hash, family_id, expires_at, device_label)
     VALUES ($1, $2, COALESCE($3::uuid, gen_random_uuid()),
             NOW() + make_interval(days => $4), $5)
     RETURNING id`,
    [appAccountId, hashRefresh(raw), familyId, APP_REFRESH_TTL_DAYS, deviceLabel],
  );
  return { raw, id: rows[0].id };
}

function accessSeconds(): number {
  // Best-effort numeric for the response; supports "60m"/"3600"/"1h".
  const t = String(APP_ACCESS_TTL).trim();
  if (/^\d+$/.test(t)) return parseInt(t);
  const m = t.match(/^(\d+)\s*([smhd])$/i);
  if (!m) return 3600;
  const n = parseInt(m[1]);
  return n * ({ s: 1, m: 60, h: 3600, d: 86400 } as Record<string, number>)[m[2].toLowerCase()];
}

async function loadAccountForClaims(
  db: PoolClient,
  appAccountId: number,
): Promise<{ id: number; status: string; linked_client_record_id: number; primary_mobile: string } | null> {
  const { rows } = await db.query(
    `SELECT id, status, linked_client_record_id, primary_mobile
       FROM app_accounts WHERE id = $1 AND deleted_at IS NULL`,
    [appAccountId],
  );
  return rows[0] ?? null;
}

export async function exchangeLoginHandle(handle: string, deviceLabel?: string | null): Promise<IssuedTokens> {
  const h = typeof handle === 'string' ? handle.trim() : '';
  if (!h) throw httpError(400, 'مُعرّف التحقق مطلوب');

  const tx = await acquireTx();
  try {
    const { rows: hrows } = await tx.client.query<{
      id: number; phone: string; verified_at: string | null; consumed_at: string | null;
    }>(
      `SELECT id, phone, verified_at, consumed_at FROM otp_verifications
        WHERE handle = $1 AND purpose = 'login' FOR UPDATE`,
      [h],
    );
    if (hrows.length === 0) throw httpError(400, 'مُعرّف التحقق غير معروف');
    const otp = hrows[0];
    if (!otp.verified_at) throw httpError(400, 'لم يتم التحقق من الرقم');
    if (otp.consumed_at) throw httpError(409, 'استُخدم مُعرّف التحقق مسبقاً');
    if (new Date(otp.verified_at).getTime() < Date.now() - HANDLE_TTL_MS) {
      throw httpError(400, 'انتهت صلاحية التحقق. أعد التحقق.');
    }

    const { rows: accRows } = await tx.client.query<{
      id: number; linked_client_record_id: number; primary_mobile: string;
    }>(
      `SELECT id, linked_client_record_id, primary_mobile FROM app_accounts
        WHERE primary_mobile = $1 AND status = 'active' AND deleted_at IS NULL LIMIT 1`,
      [otp.phone],
    );
    if (accRows.length === 0) throw httpError(404, 'لا يوجد حساب مفعّل لهذا الرقم', { code: 'no_active_account' });
    const acc = accRows[0];

    await tx.client.query(`UPDATE otp_verifications SET consumed_at = NOW() WHERE id = $1`, [otp.id]);
    const refresh = await insertRefreshToken(tx.client, acc.id, null, deviceLabel ?? null);

    await commitTx(tx);
    const claims: AppAccountClaims = {
      appAccountId: Number(acc.id), clientId: acc.linked_client_record_id, phone: acc.primary_mobile,
    };
    return { accessToken: signAccessToken(claims), refreshToken: refresh.raw, tokenType: 'Bearer', expiresIn: accessSeconds(), account: claims };
  } catch (err) {
    await rollbackTx(tx);
    throw err;
  } finally {
    tx.release();
  }
}

export async function refreshTokens(refreshToken: string): Promise<IssuedTokens> {
  const raw = typeof refreshToken === 'string' ? refreshToken.trim() : '';
  if (!raw) throw httpError(400, 'رمز التجديد مطلوب');
  const tokenHash = hashRefresh(raw);

  const tx = await acquireTx();
  try {
    const { rows } = await tx.client.query<{
      id: number; app_account_id: number; family_id: string; expires_at: string;
      revoked_at: string | null; replaced_by_id: number | null;
    }>(
      `SELECT id, app_account_id, family_id, expires_at, revoked_at, replaced_by_id
         FROM app_refresh_tokens WHERE token_hash = $1 FOR UPDATE`,
      [tokenHash],
    );
    if (rows.length === 0) {
      await rollbackTx(tx);
      throw httpError(401, 'رمز تجديد غير صالح');
    }
    const row = rows[0];

    if (row.revoked_at != null) {
      // Replaying a token that was ROTATED away (replaced_by_id set) is a theft
      // signal → revoke the whole family. Revoked by logout/suspend (no
      // replacement) is just an ended session.
      if (row.replaced_by_id != null) {
        await tx.client.query(
          `UPDATE app_refresh_tokens SET revoked_at = NOW()
            WHERE family_id = $1 AND revoked_at IS NULL`,
          [row.family_id],
        );
        await commitTx(tx);
        throw httpError(401, 'أُعيد استخدام رمز تجديد مُبطَل — أُلغيت الجلسة', { code: 'token_reused' });
      }
      await rollbackTx(tx);
      throw httpError(401, 'انتهت الجلسة. سجّل الدخول من جديد.', { code: 'session_ended' });
    }
    if (new Date(row.expires_at).getTime() < Date.now()) {
      await rollbackTx(tx);
      throw httpError(401, 'انتهت صلاحية رمز التجديد');
    }

    const account = await loadAccountForClaims(tx.client, row.app_account_id);
    if (!account) {
      await rollbackTx(tx);
      throw httpError(401, 'الحساب غير موجود');
    }
    if (account.status !== 'active') {
      await rollbackTx(tx);
      throw httpError(403, 'الحساب موقوف', { code: 'suspended' });
    }

    // Rotate: issue a new token in the same family, revoke the old one.
    const next = await insertRefreshToken(tx.client, account.id, row.family_id, null);
    await tx.client.query(
      `UPDATE app_refresh_tokens SET revoked_at = NOW(), replaced_by_id = $2 WHERE id = $1`,
      [row.id, next.id],
    );

    await commitTx(tx);
    const claims: AppAccountClaims = {
      appAccountId: Number(account.id), clientId: account.linked_client_record_id, phone: account.primary_mobile,
    };
    return { accessToken: signAccessToken(claims), refreshToken: next.raw, tokenType: 'Bearer', expiresIn: accessSeconds(), account: claims };
  } catch (err) {
    await rollbackTx(tx);
    throw err;
  } finally {
    tx.release();
  }
}

export async function logout(refreshToken: string): Promise<{ loggedOut: true }> {
  const raw = typeof refreshToken === 'string' ? refreshToken.trim() : '';
  if (raw) {
    const { rows } = await pool.query<{ family_id: string }>(
      `SELECT family_id FROM app_refresh_tokens WHERE token_hash = $1`,
      [hashRefresh(raw)],
    );
    if (rows.length > 0) {
      await pool.query(
        `UPDATE app_refresh_tokens SET revoked_at = NOW()
          WHERE family_id = $1 AND revoked_at IS NULL`,
        [rows[0].family_id],
      );
    }
  }
  return { loggedOut: true };
}

/** Decode + ENFORCE account status. Throws {status:401} invalid, {status:403} suspended. */
export async function verifyAccessToken(token: string): Promise<AppAccountClaims> {
  let decoded: any;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch {
    throw httpError(401, 'رمز الدخول غير صالح أو منتهٍ');
  }
  if (decoded?.typ !== 'app_access' || !decoded?.appAccountId) {
    throw httpError(401, 'رمز الدخول غير صالح');
  }
  const { rows } = await pool.query<{
    id: number; status: string; linked_client_record_id: number; primary_mobile: string;
  }>(
    `SELECT id, status, linked_client_record_id, primary_mobile
       FROM app_accounts WHERE id = $1 AND deleted_at IS NULL`,
    [decoded.appAccountId],
  );
  if (rows.length === 0) throw httpError(401, 'الحساب غير موجود');
  const acc = rows[0];
  if (acc.status !== 'active') throw httpError(403, 'الحساب موقوف', { code: 'suspended' });
  // `app_accounts.id` is BIGINT — node-pg returns it as a string, which would
  // reach the mobile client as a JSON string next to a numeric `clientId`.
  // Coerce at the boundary so the contract stays `integer` everywhere.
  return { appAccountId: Number(acc.id), clientId: acc.linked_client_record_id, phone: acc.primary_mobile };
}
