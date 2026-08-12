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
  requestType?: string | null;
  channel: ServiceRequestChannel;
  applicationSource?: string | null;
  submittedPayload?: Record<string, unknown> | null;

  // Three parties (٠.١٢)
  requesterUserId?: number | null;
  requesterAppAccountId?: number | null;
  requesterClientId?: number | null;
  requesterExternal?: Record<string, unknown> | null;
  beneficiaryClientId?: number | null;
  beneficiaryCandidateId?: number | null;
  beneficiaryExternal?: Record<string, unknown> | null;
  referrerUserId?: number | null;
  referrerClientId?: number | null;
  referrerExternal?: Record<string, unknown> | null;
  submissionType?: 'apply' | 'refer_a_candidate';
  // `unverified` mirrors migration 404: a submitter who proved nothing, kept
  // distinct from `visitor` so an OTP-proven row stays distinguishable.
  submitterTier?: 'visitor' | 'unverified' | 'customer' | 'lead' | 'fop' | 'op' | 'staff';

  // Device
  contractId?: number | null;
  deviceSource?: 'company_device' | 'external_device' | null;
  installedDeviceId?: number | null;
  externalDeviceName?: string | null;
  externalDeviceSerial?: string | null;
  reportedDeviceSelection?: 'registered_device' | 'catalog_model' | 'other' | null;
  reportedDeviceModelId?: number | null;
  reportedDeviceSnapshot?: Record<string, unknown> | null;

  // Customer-submitted (immutable, SR-R008)
  problemDescription: string;
  requestedActionTypeId?: number | null;
  attachments?: unknown[];
  safetyIndicatorCodes?: string[];

  // Address (٠.١٤ + ٠.١٧.أ)
  serviceAddress?: Record<string, unknown> | null;

  // Triage
  priority?: 'Critical' | 'High' | 'Normal' | 'Low' | null;

  // Scope (tracking only, SR-08)
  branchId?: number | null;
  branchResolutionStatus?: 'not_applicable' | 'resolved' | 'ambiguous' | 'no_coverage' | 'missing_geo' | null;
  branchResolutionReason?: string | null;
  branchResolutionGeoUnitId?: number | null;
  sourceCallLogId?: string | null;

  // Actor context
  actorUserId: number | null;
  actorRole: ActorRole;
}

export interface CreatedServiceRequest {
  id: number;
  publicRefNumber: string;
  requestType: string;
  status: 'received' | 'in_review';
  duplicateFlag: boolean;
  duplicateOfRequestId: number | null;
  reviewRequiredFlag: boolean;
}

/**
 * §٠.١٧.أ — walk-in mandatory fields:
 *   - When neither beneficiary_client_id nor beneficiary_candidate_id is set,
 *     requester_external.primary_phone is required. The requester name may be
 *     absent only for an identified mobile for_another request with no referrer.
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
    input.requesterAppAccountId == null &&
    input.requesterClientId == null &&
    input.beneficiaryClientId == null &&
    input.beneficiaryCandidateId == null;

  if (isWalkIn) {
    const ext = input.requesterExternal ?? {};
    const isOtpVerifiedVisitor = ext['identity_verification'] === 'otp';
    const isNamelessMobileForAnotherWithoutReferrer =
      input.channel === 'mobile_app' &&
      input.submissionType === 'refer_a_candidate' &&
      input.referrerUserId == null &&
      input.referrerClientId == null &&
      input.referrerExternal == null &&
      ext['name_source'] === 'not_provided' &&
      (ext['identity_source'] === 'visitor_otp' || ext['identity_source'] === 'unverified_device');
    if (!ext['primary_phone'] || (!ext['name'] && !isOtpVerifiedVisitor && !isNamelessMobileForAnotherWithoutReferrer)) {
      return {
        ok: false,
        code: 'walkin_requester_external_required',
        message: 'SR-WALKIN-02: requester_external primary phone is required; name may be omitted only for an identified mobile for_another request without a referrer',
      };
    }
  }

  // V1.0 (maintenance-v1.md §٣): when an installed_device is provided, the
  // service_address is derivable from the device at promote time — we relax
  // the SR-WALKIN-03 enforcement at intake. Walk-in (no client + no device)
  // is rejected by V1.0 anyway via the modal; this branch keeps the API
  // robust for future channels that may still send the address explicitly.
  const addr = input.serviceAddress ?? {};
  const hasAddr = !!(addr['governorate'] && addr['detailed_address']);
  if (
    !hasAddr
    && !input.installedDeviceId
    && input.requestType !== 'device_request'
    && input.requestType !== 'name_nomination'
  ) {
    return {
      ok: false,
      code: 'service_address_required',
      message: 'SR-WALKIN-03: service_address.governorate + .detailed_address required (or pass installedDeviceId)',
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
             public_ref_number, request_type, channel, application_source, submitted_payload,
             requester_user_id, requester_app_account_id, requester_client_id, requester_external,
             beneficiary_client_id, beneficiary_candidate_id, beneficiary_external,
             referrer_user_id, referrer_client_id, referrer_external,
             submission_type, submitter_tier,
             contract_id, device_source, installed_device_id,
             external_device_name, external_device_serial,
             problem_description, requested_action_type_id, attachments,
             service_address,
             priority, status,
             reviewed_by_user_id, claimed_at,
             branch_id, branch_resolution_status, branch_resolution_reason,
             branch_resolution_geo_unit_id,
             source_call_log_id, reported_device_selection,
             reported_device_model_id, reported_device_snapshot,
             safety_indicator_codes
           ) VALUES (
             $1, $2, $3, $4, $5::jsonb,
             $6, $7, $8, $9::jsonb,
             $10, $11, $12::jsonb,
             $13, $14, $15::jsonb,
             $16, $17,
             $18, $19, $20,
             $21, $22,
             $23, $24, $25::jsonb,
             $26::jsonb,
             $27, $28,
             $29, ${claimedAt},
             $30, $31, $32,
             $33,
             $34, $35,
             $36, $37::jsonb,
             $38::jsonb
           )
           RETURNING id`,
          [
            ref,
            input.requestType ?? 'emergency_maintenance',
            input.channel,
            input.applicationSource ?? null,
            JSON.stringify(input.submittedPayload ?? null),
            input.requesterUserId ?? null,
            input.requesterAppAccountId ?? null,
            input.requesterClientId ?? null,
            JSON.stringify(input.requesterExternal ?? null),
            input.beneficiaryClientId ?? null,
            input.beneficiaryCandidateId ?? null,
            JSON.stringify(input.beneficiaryExternal ?? null),
            input.referrerUserId ?? null,
            input.referrerClientId ?? null,
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
            input.branchResolutionStatus ?? 'not_applicable',
            input.branchResolutionReason ?? null,
            input.branchResolutionGeoUnitId ?? null,
            input.sourceCallLogId ?? null,
            input.reportedDeviceSelection ?? null,
            input.reportedDeviceModelId ?? null,
            JSON.stringify(input.reportedDeviceSnapshot ?? null),
            JSON.stringify(input.safetyIndicatorCodes ?? []),
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
        request_type: input.requestType ?? 'emergency_maintenance',
        public_ref_number: inserted.ref,
        initial_status: initialStatus,
        branch_id: input.branchId ?? null,
        branch_resolution_status: input.branchResolutionStatus ?? 'not_applicable',
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
        requestType: input.requestType ?? 'emergency_maintenance',
        status: initialStatus,
        duplicateFlag: dup.flagged,
        // service_requests.id is BIGINT — node-pg returns it as a string, so
        // without this the field contradicts its own declared `number | null`
        // and reaches JSON clients quoted. Same boundary coercion as `id`.
        duplicateOfRequestId: dup.bestMatch ? Number(dup.bestMatch.candidateId) : null,
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
