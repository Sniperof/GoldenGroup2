import type { AuthContext } from '@golden-crm/shared';
import type { PoolClient } from 'pg';
import { canLinkServiceRequestParty } from '../../policies/serviceRequestPartyLinkPolicy.js';
import { appendAudit } from './_shared.js';

export type WaterCheckClientParty = 'beneficiary' | 'requester' | 'referrer';

function serviceError(status: number, code: string, message?: string) {
  return Object.assign(new Error(message ?? code), { status, code });
}

export async function syncWaterCheckBeneficiaryReferrer(
  db: PoolClient,
  serviceRequestId: number,
  actorUserId: number,
): Promise<void> {
  await db.query(
    `WITH referral_link AS (
       SELECT sr.id AS service_request_id,
              sr.beneficiary_client_id,
              sr.referrer_client_id,
              COALESCE(r.name, NULLIF(CONCAT_WS(' ', r.first_name, r.father_name, r.last_name), '')) AS referrer_name,
              NOT EXISTS (
                SELECT 1 FROM client_referral_attributions existing
                 WHERE existing.beneficiary_client_id = sr.beneficiary_client_id
                   AND existing.is_primary
              )
              AND NULLIF(TRIM(COALESCE(b.referrer_name, '')), '') IS NULL
              AND NULLIF(TRIM(COALESCE(b.referrer_type, '')), '') IS NULL AS should_be_primary
         FROM service_requests sr
         JOIN clients b ON b.id = sr.beneficiary_client_id
         JOIN clients r ON r.id = sr.referrer_client_id
        WHERE sr.id = $1
          AND sr.request_type = 'water_check'
          AND sr.referrer_client_id <> sr.beneficiary_client_id
     ), inserted AS (
       INSERT INTO client_referral_attributions (
         beneficiary_client_id, referrer_type, referrer_client_id, referrer_name,
         source_type, source_service_request_id, is_primary, created_by,
         metadata
       )
       SELECT beneficiary_client_id, 'Client', referrer_client_id, referrer_name,
              'water_check', service_request_id, should_be_primary, $2,
              jsonb_build_object('party_role', 'referrer')
         FROM referral_link
       ON CONFLICT DO NOTHING
       RETURNING beneficiary_client_id, referrer_client_id, referrer_name,
                 source_service_request_id, is_primary, attributed_at
     ), attribution AS (
       SELECT * FROM inserted
       UNION ALL
       SELECT a.beneficiary_client_id, a.referrer_client_id, a.referrer_name,
              a.source_service_request_id, a.is_primary, a.attributed_at
         FROM client_referral_attributions a
        WHERE a.source_type = 'water_check'
          AND a.source_service_request_id = $1
          AND NOT EXISTS (SELECT 1 FROM inserted)
     )
     UPDATE clients b
        SET referrer_type = CASE WHEN a.is_primary THEN 'Client' ELSE b.referrer_type END,
            referrer_id = CASE WHEN a.is_primary THEN a.referrer_client_id ELSE b.referrer_id END,
            referrer_name = CASE WHEN a.is_primary THEN a.referrer_name ELSE b.referrer_name END,
            referrers = CASE
              WHEN EXISTS (
                SELECT 1
                  FROM jsonb_array_elements(COALESCE(b.referrers, '[]'::jsonb)) item
                 WHERE COALESCE(item->>'referrerType', item->>'type') = 'Client'
                   AND COALESCE(item->>'referrerId', item->>'referralEntityId', item->>'id') = a.referrer_client_id::text
              ) THEN COALESCE(b.referrers, '[]'::jsonb)
              ELSE COALESCE(b.referrers, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
                'id', a.referrer_client_id,
                'type', 'Client',
                'name', a.referrer_name,
                'referrerType', 'Client',
                'referrerId', a.referrer_client_id,
                'referralEntityId', a.referrer_client_id,
                'referrerName', a.referrer_name,
                'sourceType', 'water_check',
                'sourceServiceRequestId', a.source_service_request_id,
                'referralDate', TO_CHAR(a.attributed_at AT TIME ZONE 'Asia/Damascus', 'YYYY-MM-DD')
              ))
            END
       FROM attribution a
      WHERE b.id = a.beneficiary_client_id`,
    [serviceRequestId, actorUserId],
  );
}

/**
 * Links a client created in the caller's open transaction to one water-check
 * party. The caller owns BEGIN/COMMIT/ROLLBACK, so client creation and linkage
 * either become visible together or are both discarded.
 */
export async function linkNewClientToWaterCheckParty(input: {
  db: PoolClient;
  authContext: AuthContext;
  serviceRequestId: number;
  clientId: number;
  clientBranchId: number;
  party: WaterCheckClientParty;
}): Promise<void> {
  const { db, authContext, serviceRequestId, clientId, clientBranchId, party } = input;
  const { rows } = await db.query<{
    request_type: string;
    status: string;
    branch_id: number | null;
    reviewed_by_user_id: number | null;
    escalated_at: string | null;
    submission_type: string;
    requester_client_id: number | null;
    referrer_external: Record<string, unknown> | null;
  }>(
    `SELECT request_type, status, branch_id, reviewed_by_user_id, escalated_at,
            submission_type, requester_client_id, referrer_external
       FROM service_requests
      WHERE id = $1
      FOR UPDATE`,
    [serviceRequestId],
  );
  const request = rows[0];
  if (!request) throw serviceError(404, 'service_request_not_found');
  if (request.request_type !== 'water_check') {
    throw serviceError(400, 'wrong_request_type_for_atomic_client_link');
  }
  const access = canLinkServiceRequestParty(authContext, {
    permission: 'water_check.review',
    branchId: request.branch_id,
    reviewedByUserId: request.reviewed_by_user_id,
  });
  if (!access.allowed) throw serviceError(403, 'forbidden', access.reason);
  if (request.status !== 'in_review') {
    throw serviceError(400, 'link_requires_claim', 'تولَّ الطلب أولاً قبل إنشاء الزبون وربطه.');
  }
  if (request.escalated_at != null) {
    throw serviceError(423, 'request_is_escalated_actions_blocked');
  }
  if (request.branch_id == null || Number(request.branch_id) !== clientBranchId) {
    throw serviceError(400, 'service_request_client_branch_mismatch');
  }
  if (party === 'referrer' && !request.referrer_external) {
    throw serviceError(400, 'request_has_no_referrer');
  }

  const sameAsRequester = request.referrer_external?.same_as_requester === true;
  if (party === 'referrer'
      && sameAsRequester
      && request.requester_client_id != null
      && Number(request.requester_client_id) !== clientId) {
    throw serviceError(400, 'referrer_must_match_requester');
  }

  if (party === 'beneficiary') {
    await db.query(
      `UPDATE service_requests
          SET beneficiary_client_id = $2,
              beneficiary_candidate_id = NULL,
              requester_client_id = CASE
                WHEN submission_type = 'apply' THEN $2
                ELSE requester_client_id
              END,
              updated_at = NOW()
        WHERE id = $1`,
      [serviceRequestId, clientId],
    );
  } else if (party === 'requester') {
    await db.query(
      `UPDATE service_requests
          SET requester_client_id = $2,
              beneficiary_client_id = CASE WHEN submission_type = 'apply' THEN $2 ELSE beneficiary_client_id END,
              referrer_client_id = CASE WHEN $3::boolean THEN $2 ELSE referrer_client_id END,
              updated_at = NOW()
        WHERE id = $1`,
      [serviceRequestId, clientId, sameAsRequester],
    );
  } else {
    await db.query(
      `UPDATE service_requests
          SET referrer_client_id = $2,
              requester_client_id = CASE WHEN $3::boolean THEN $2 ELSE requester_client_id END,
              updated_at = NOW()
        WHERE id = $1`,
      [serviceRequestId, clientId, sameAsRequester],
    );
  }

  await appendAudit(db, {
    serviceRequestId,
    eventType: 'party_linked',
    actorUserId: authContext.userId,
    actorRole: 'operator',
    payload: {
      party_role: party,
      [`${party}_client_id`]: clientId,
      atomic_client_creation: true,
      ...(party === 'requester' ? {
        beneficiary_mirrored: request.submission_type === 'apply',
        referrer_mirrored: sameAsRequester,
      } : {}),
      ...(party === 'referrer' ? { requester_mirrored: sameAsRequester } : {}),
    },
  });

  if (party === 'beneficiary' || party === 'referrer' || sameAsRequester) {
    await syncWaterCheckBeneficiaryReferrer(db, serviceRequestId, authContext.userId);
  }
}
