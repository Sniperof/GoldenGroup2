// ============================================================
// serviceRequests/claimService.ts
// ============================================================
// Constitution source: §٠.٤.أ — Non-Exclusive Soft Ownership
//
//   SR-CLAIM-01  received → in_review: reviewed_by_user_id := operator,
//                claimed_at := NOW(). Use transitionStatus for the status
//                edge; this service only handles the ownership field.
//   SR-CLAIM-02  Take-over: any operator with review perm can replace
//                reviewed_by_user_id. No DB lock, no consent.
//   SR-CLAIM-03  Every replacement → audit `claim_transferred` with
//                previous_owner_id + new_owner_id + optional reason.
//   SR-CLAIM-04  Notify previous owner — out of scope here (Phase 4 UI).
//                We surface previousOwnerId in the return so the caller
//                can dispatch a notification.
//   SR-CLAIM-05  Sub-transitions (in_review ⇄ awaiting_customer_info)
//                do NOT touch reviewed_by_user_id — handled in stateMachine.
//   SR-CLAIM-06  Audit Admin actions DO NOT replace reviewed_by_user_id.
//   SR-CLAIM-07  On terminal close, reviewed_by_user_id stays as snapshot
//                of the last operator owner. Handled by leaving the field
//                untouched in stateMachine.
// ============================================================

import type { PoolClient } from 'pg';
import {
  acquireTx,
  commitTx,
  rollbackTx,
  appendAudit,
  type ActorRole,
  type ServiceResult,
} from './_shared.js';

export interface ClaimInput {
  serviceRequestId: number;
  operatorUserId: number;
  actorRole: ActorRole; // expected 'operator' (audit admins must not claim)
  /** Only meaningful on take-over; ignored on first claim. */
  transferReason?: string | null;
}

export interface ClaimOutput {
  previousOwnerId: number | null;
  newOwnerId: number;
  wasTakeOver: boolean;
}

export async function claimOrTakeOver(
  input: ClaimInput,
  db?: PoolClient,
): Promise<ServiceResult<ClaimOutput>> {
  if (input.actorRole !== 'operator') {
    return {
      ok: false,
      code: 'audit_admin_cannot_claim',
      message: 'SR-CLAIM-06: audit_admin actions do not replace ownership',
    };
  }

  const tx = await acquireTx(db);
  try {
    const { rows } = await tx.client.query<{
      id: number;
      status: string;
      reviewed_by_user_id: number | null;
    }>(
      `SELECT id, status, reviewed_by_user_id
         FROM service_requests
        WHERE id = $1
        FOR UPDATE`,
      [input.serviceRequestId],
    );
    if (rows.length === 0) {
      await rollbackTx(tx);
      return { ok: false, code: 'not_found' };
    }
    const row = rows[0];

    // Claim only meaningful in non-terminal states. Terminal claim retention
    // (SR-CLAIM-07) is enforced by simply leaving the column untouched there.
    if (
      row.status !== 'received' &&
      row.status !== 'in_review' &&
      row.status !== 'awaiting_customer_info'
    ) {
      await rollbackTx(tx);
      return {
        ok: false,
        code: 'cannot_claim_in_terminal',
        details: { status: row.status },
      };
    }

    const previousOwnerId = row.reviewed_by_user_id;
    const wasTakeOver = previousOwnerId != null && previousOwnerId !== input.operatorUserId;
    const sameOwner = previousOwnerId === input.operatorUserId;

    if (sameOwner) {
      await commitTx(tx);
      return {
        ok: true,
        data: {
          previousOwnerId,
          newOwnerId: input.operatorUserId,
          wasTakeOver: false,
        },
      };
    }

    // Update ownership. For first claim from 'received', also flip status
    // and stamp claimed_at — SR-CLAIM-01 first-claim shortcut.
    if (row.status === 'received') {
      await tx.client.query(
        `UPDATE service_requests
            SET reviewed_by_user_id = $2,
                claimed_at = NOW(),
                status = 'in_review',
                updated_at = NOW()
          WHERE id = $1`,
        [input.serviceRequestId, input.operatorUserId],
      );
      // Status edge audit: status_changed + claimed_by_operator.
      await appendAudit(tx.client, {
        serviceRequestId: input.serviceRequestId,
        eventType: 'status_changed',
        actorUserId: input.operatorUserId,
        actorRole: 'operator',
        payload: { from: 'received', to: 'in_review', via: 'claim' },
      });
      await appendAudit(tx.client, {
        serviceRequestId: input.serviceRequestId,
        eventType: 'claimed_by_operator',
        actorUserId: input.operatorUserId,
        actorRole: 'operator',
        payload: { first_claim: true },
      });
    } else {
      // Take-over — keep status, swap owner only.
      await tx.client.query(
        `UPDATE service_requests
            SET reviewed_by_user_id = $2,
                updated_at = NOW()
          WHERE id = $1`,
        [input.serviceRequestId, input.operatorUserId],
      );
      await appendAudit(tx.client, {
        serviceRequestId: input.serviceRequestId,
        eventType: 'claim_transferred',
        actorUserId: input.operatorUserId,
        actorRole: 'operator',
        payload: {
          previous_owner_id: previousOwnerId,
          new_owner_id: input.operatorUserId,
          transfer_reason: input.transferReason ?? null,
        },
      });
    }

    await commitTx(tx);
    return {
      ok: true,
      data: {
        previousOwnerId,
        newOwnerId: input.operatorUserId,
        wasTakeOver,
      },
    };
  } catch (err) {
    await rollbackTx(tx);
    throw err;
  } finally {
    tx.release();
  }
}
