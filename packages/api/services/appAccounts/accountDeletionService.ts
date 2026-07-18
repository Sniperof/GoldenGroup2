// ============================================================
// services/appAccounts/accountDeletionService.ts
// ============================================================
// Phase 6b (DEC-013 §8) — Google Play account deletion.
//
// Deletes the ACCESS (app_account) only, NOT the clients business record
// (contracts/devices/financials are retained under legitimate-interest, with
// disclosure). Both entry points (in-app + public web) converge here and are
// gated by an OTP re-verification handle (purpose='account_deletion').
// ============================================================

import pool from '../../db.js';
import { normalizePhone } from '../../utils/contactValidation.js';
import { acquireTx, commitTx, rollbackTx } from '../serviceRequests/_shared.js';

const HANDLE_TTL_MS = 10 * 60 * 1000;

function httpError(status: number, message: string, details?: Record<string, unknown>) {
  return Object.assign(new Error(message), { status, ...(details ? { details } : {}) });
}

export async function deleteAccountByVerifiedHandle(input: {
  handle: string;
  source: 'app' | 'web';
  /** When set, the handle's phone must match (in-app: the logged-in account's phone). */
  expectedPhone?: string | null;
}): Promise<{ deleted: true; appAccountId: number }> {
  const handle = typeof input.handle === 'string' ? input.handle.trim() : '';
  if (!handle) throw httpError(400, 'مُعرّف التحقق مطلوب');

  const tx = await acquireTx();
  try {
    const { rows: hrows } = await tx.client.query<{
      id: number; phone: string; verified_at: string | null; consumed_at: string | null;
    }>(
      `SELECT id, phone, verified_at, consumed_at FROM otp_verifications
        WHERE handle = $1 AND purpose = 'account_deletion' FOR UPDATE`,
      [handle],
    );
    if (hrows.length === 0) throw httpError(400, 'مُعرّف التحقق غير معروف');
    const otp = hrows[0];
    if (!otp.verified_at) throw httpError(400, 'لم يتم التحقق من الرقم');
    if (otp.consumed_at) throw httpError(409, 'استُخدم مُعرّف التحقق مسبقاً');
    if (new Date(otp.verified_at).getTime() < Date.now() - HANDLE_TTL_MS) {
      throw httpError(400, 'انتهت صلاحية التحقق. أعد التحقق.');
    }
    if (input.expectedPhone && normalizePhone(input.expectedPhone) !== otp.phone) {
      throw httpError(400, 'الرقم لا يطابق الرقم الذي تم التحقق منه');
    }

    const { rows: acc } = await tx.client.query<{ id: number }>(
      `SELECT id FROM app_accounts
        WHERE primary_mobile = $1 AND status IN ('active', 'suspended') AND deleted_at IS NULL
        ORDER BY (status = 'active') DESC
        LIMIT 1
        FOR UPDATE`,
      [otp.phone],
    );
    if (acc.length === 0) throw httpError(404, 'لا يوجد حساب لهذا الرقم');
    const appAccountId = acc[0].id;

    await tx.client.query(`UPDATE otp_verifications SET consumed_at = NOW() WHERE id = $1`, [otp.id]);

    // Soft-delete the ACCESS only. The linked clients record is retained.
    await tx.client.query(
      `UPDATE app_accounts
          SET status = 'deleted', deleted_at = NOW(), deletion_source = $2, deletion_reason = 'user_requested'
        WHERE id = $1`,
      [appAccountId, input.source],
    );
    await tx.client.query(
      `UPDATE app_refresh_tokens SET revoked_at = NOW()
        WHERE app_account_id = $1 AND revoked_at IS NULL`,
      [appAccountId],
    );
    await tx.client.query(
      `INSERT INTO audit_logs
         (entity_type, entity_id, action_type, performed_by_role, performed_by_user_id, new_value)
       VALUES ('app_account', $1, 'account_deleted', 'customer', NULL, $2)`,
      [appAccountId, JSON.stringify({ deletion_source: input.source })],
    );

    await commitTx(tx);
    return { deleted: true, appAccountId };
  } catch (err) {
    await rollbackTx(tx);
    throw err;
  } finally {
    tx.release();
  }
}
