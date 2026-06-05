// ============================================================
// serviceRequests/createService.ts
// ============================================================
// Constitution source:
//   §٠.٣ + §٠.٦ — initial status from channel (triager-present → in_review,
//                  else → received). resolved_at_intake gated by channel later.
//   §٠.٧.أ      — public_ref_number atomic generation.
//   §٠.١٥.أ     — post-insert duplicate detection (never blocks).
//   §٠.١٧.أ     — walk-in mandatory fields enforced before INSERT.
//   §٠.١٧       — audit: request_created.
//   §٠.٤.أ      — if status starts as in_review, claimed_at + reviewed_by_user_id
//                  are populated (SR-CLAIM-01 first-claim shortcut).
// ============================================================

import type { PoolClient } from 'pg';
import {
  acquireTx,
  commitTx,
  rollbackTx,
  appendAudit,
  generatePublicRefNumber,
  isTriagerPresent,
  type ActorRole,
  type ServiceResult,
  type ServiceRequestChannel,
} from './_shared.js';
import { detectDuplicates } from './duplicateDetection.js';

export interface CreateServiceRequestInput {
  channel: ServiceRequestChannel;
  applicationSource?: string | null;

  // Three parties (٠.١٢)
  requesterUserId?: number | null;
  requesterExternal?: Record<string, unknown> | null;
  beneficiaryClientId?: number | null;
  beneficiaryCandidateId?: number | null;
  beneficiaryExternal?: Record<string, unknown> | null;
  referrerUserId?: number | null;
  referrerExternal?: Record<string, unknown> | null;
  submissionType?: 'apply' | 'refer_a_candidate';
  submitterTier?: 'visitor' | 'lead' | 'fop' | 'op' | 'staff';

  // Device
  contractId?: number | null;
  deviceSource?: 'company_device' | 'external_device' | null;
  installedDeviceId?: number | null;
  externalDeviceName?: string | null;
  externalDeviceSerial?: string | null;

  // Customer-submitted (immutable, SR-R008)
  problemDescription: string;
  requestedActionTypeId?: number | null;
  attachments?: unknown[];

  // Address (٠.١٤ + ٠.١٧.أ)
  serviceAddress?: Record<string, unknown> | null;

  // Triage
  priority?: 'Critical' | 'High' | 'Normal' | 'Low' | null;

  // Scope (tracking only, SR-08)
  branchId?: number | null;

  // Actor context
  actorUserId: number | null;
  actorRole: ActorRole;
}

export interface CreatedServiceRequest {
  id: number;
  publicRefNumber: string;
  status: 'received' | 'in_review';
  duplicateFlag: boolean;
  duplicateOfRequestId: number | null;
  reviewRequiredFlag: boolean;
}

/**
 * §٠.١٧.أ — walk-in mandatory fields:
 *   - When neither beneficiary_client_id nor beneficiary_candidate_id is set,
 *     requester_external.name + requester_external.primary_phone are required.
 *   - service_address.governorate + .detailed_address required for ALL inserts
 *     (SR-WALKIN-03).
 */
function validateMandatory(
  input: CreateServiceRequestInput,
): ServiceResult<void> {
  if (!input.problemDescription || input.problemDescription.trim().length === 0) {
    return { ok: false, code: 'missing_problem_description' };
  }

  const isWalkIn =
    input.requesterUserId == null &&
    input.beneficiaryClientId == null &&
    input.beneficiaryCandidateId == null;

  if (isWalkIn) {
    const ext = input.requesterExternal ?? {};
    if (!ext['name'] || !ext['primary_phone']) {
      return {
        ok: false,
        code: 'walkin_requester_external_required',
        message: 'SR-WALKIN-02: requester_external.name + .primary_phone required',
      };
    }
  }

  const addr = input.serviceAddress ?? {};
  if (!addr['governorate'] || !addr['detailed_address']) {
    return {
      ok: false,
      code: 'service_address_required',
      message: 'SR-WALKIN-03: service_address.governorate + .detailed_address required',
    };
  }

  return { ok: true, data: undefined };
}

const MAX_REF_RETRIES = 3;

export async function createServiceRequest(
  input: CreateServiceRequestInput,
  db?: PoolClient,
): Promise<ServiceResult<CreatedServiceRequest>> {
  const validation = validateMandatory(input);
  if (validation.ok !== true) {
    return validation as ServiceResult<CreatedServiceRequest>;
  }

  const initialStatus: 'received' | 'in_review' = isTriagerPresent(input.channel)
    ? 'in_review'
    : 'received';
  const claimedAt = initialStatus === 'in_review' ? 'NOW()' : 'NULL';

  const tx = await acquireTx(db);
  try {
    let attempts = 0;
    let inserted: { id: number; ref: string } | null = null;
    let lastErr: unknown = null;

    // Retry only on ref collision; other errors bubble immediately.
    while (attempts < MAX_REF_RETRIES) {
      attempts += 1;
      const ref = await generatePublicRefNumber(tx.client);
      try {
        const { rows } = await tx.client.query<{ id: number }>(
          `INSERT INTO service_requests (
             public_ref_number, channel, application_source,
             requester_user_id, requester_external,
             beneficiary_client_id, beneficiary_candidate_id, beneficiary_external,
             referrer_user_id, referrer_external,
             submission_type, submitter_tier,
             contract_id, device_source, installed_device_id,
             external_device_name, external_device_serial,
             problem_description, requested_action_type_id, attachments,
             service_address,
             priority, status,
             reviewed_by_user_id, claimed_at,
             branch_id
           ) VALUES (
             $1, $2, $3,
             $4, $5::jsonb,
             $6, $7, $8::jsonb,
             $9, $10::jsonb,
             $11, $12,
             $13, $14, $15,
             $16, $17,
             $18, $19, $20::jsonb,
             $21::jsonb,
             $22, $23,
             $24, ${claimedAt},
             $25
           )
           RETURNING id`,
          [
            ref,
            input.channel,
            input.applicationSource ?? null,
            input.requesterUserId ?? null,
            JSON.stringify(input.requesterExternal ?? null),
            input.beneficiaryClientId ?? null,
            input.beneficiaryCandidateId ?? null,
            JSON.stringify(input.beneficiaryExternal ?? null),
            input.referrerUserId ?? null,
            JSON.stringify(input.referrerExternal ?? null),
            input.submissionType ?? 'apply',
            input.submitterTier ?? 'staff',
            input.contractId ?? null,
            input.deviceSource ?? null,
            input.installedDeviceId ?? null,
            input.externalDeviceName ?? null,
            input.externalDeviceSerial ?? null,
            input.problemDescription,
            input.requestedActionTypeId ?? null,
            JSON.stringify(input.attachments ?? []),
            JSON.stringify(input.serviceAddress ?? null),
            input.priority ?? null,
            initialStatus,
            initialStatus === 'in_review' ? input.actorUserId : null,
            input.branchId ?? null,
          ],
        );
        inserted = { id: rows[0].id, ref };
        break;
      } catch (err: unknown) {
        // 23505 = unique_violation. Retry only on the ref UNIQUE collision.
        const pgErr = err as { code?: string; constraint?: string };
        if (
          pgErr?.code === '23505' &&
          pgErr?.constraint === 'service_requests_public_ref_unique_active'
        ) {
          lastErr = err;
          continue;
        }
        throw err;
      }
    }

    if (!inserted) {
      throw lastErr ?? new Error('failed_to_insert_service_request');
    }

    // Audit: request_created (٠.١٧)
    await appendAudit(tx.client, {
      serviceRequestId: inserted.id,
      eventType: 'request_created',
      actorUserId: input.actorUserId,
      actorRole: input.actorRole,
      payload: {
        channel: input.channel,
        public_ref_number: inserted.ref,
        initial_status: initialStatus,
      },
    });

    // If started as in_review (triager-present channel), record the implicit
    // claim event for symmetry with received → in_review claim path.
    if (initialStatus === 'in_review' && input.actorUserId != null) {
      await appendAudit(tx.client, {
        serviceRequestId: inserted.id,
        eventType: 'claimed_by_operator',
        actorUserId: input.actorUserId,
        actorRole: input.actorRole,
        payload: { auto_on_create: true },
      });
    }

    // Post-insert duplicate detection (٠.١٥.أ — never blocks legitimate inserts).
    const dup = await detectDuplicates(
      tx.client,
      inserted.id,
      input.actorUserId,
      input.actorRole,
    );

    await commitTx(tx);

    return {
      ok: true,
      data: {
        id: inserted.id,
        publicRefNumber: inserted.ref,
        status: initialStatus,
        duplicateFlag: dup.flagged,
        duplicateOfRequestId: dup.bestMatch?.candidateId ?? null,
        reviewRequiredFlag: dup.flagged,
      },
    };
  } catch (err) {
    await rollbackTx(tx);
    throw err;
  } finally {
    tx.release();
  }
}
