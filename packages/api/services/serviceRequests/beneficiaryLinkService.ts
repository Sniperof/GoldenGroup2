import type { AuthContext } from '@golden-crm/shared';
import type { PoolClient } from 'pg';
import { authorize } from '../authorizationService.js';
import { canLinkServiceRequestParty } from '../../policies/serviceRequestPartyLinkPolicy.js';
import {
  acquireTx,
  appendAudit,
  commitTx,
  rollbackTx,
  type ActorRole,
  type ServiceResult,
} from './_shared.js';
import { syncWaterCheckBeneficiaryReferrer } from './atomicClientLink.js';

interface BeneficiaryLinkInput {
  serviceRequestId: number;
  beneficiaryClientId?: number | string | null;
  beneficiaryCandidateId?: number | string | null;
  installedDeviceId?: number | string | null;
  contractId?: number | string | null;
  actorUserId: number;
  actorRole: ActorRole;
  isChange: boolean;
  changeReason?: string | null;
  authContext: AuthContext;
}

interface BeneficiaryLinkOutput {
  alreadyLinked?: boolean;
  beneficiaryClientId: number | null;
  beneficiaryCandidateId: number | null;
  installedDeviceId: number | null;
}

interface RequestRow {
  beneficiary_client_id: number | null;
  beneficiary_candidate_id: number | null;
  installed_device_id: number | null;
  contract_id: number | null;
  request_type: string;
  status: string;
  submission_type: string;
  branch_id: number | null;
  reviewed_by_user_id: number | null;
  reported_device_snapshot: Record<string, unknown> | null;
}

interface DeviceRow {
  customer_id: number | null;
  contract_id: number | null;
  branch_id: number | null;
  serial_number: string | null;
}

const REVIEW_PERMISSION_BY_TYPE: Record<string, string> = {
  emergency_maintenance: 'service_requests.review',
  water_check: 'water_check.review',
  device_request: 'service_requests.review',
  periodic_maintenance: 'periodic_maintenance.review',
  golden_warranty: 'golden_warranty.review',
  name_nomination: 'name_nomination.review',
  agent_license: 'agent_license.review',
};

function reviewPermissionFor(requestType: string): string {
  return REVIEW_PERMISSION_BY_TYPE[requestType] ?? 'service_requests.review';
}

function optionalPositiveId(value: number | string | null | undefined): number | null | 'invalid' {
  if (value == null || value === '') return null;
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : 'invalid';
}

function sameTarget(
  row: Pick<RequestRow, 'beneficiary_client_id' | 'beneficiary_candidate_id'>,
  clientId: number | null,
  candidateId: number | null,
): boolean {
  return row.beneficiary_client_id === clientId
    && row.beneficiary_candidate_id === candidateId;
}

/**
 * Shared beneficiary linkage operation for every generic service-request type.
 * It distinguishes party selection, device attachment, and explicit relink so
 * a partial device payload can never erase the already linked beneficiary.
 */
export async function linkBeneficiary(
  input: BeneficiaryLinkInput,
  db?: PoolClient,
): Promise<ServiceResult<BeneficiaryLinkOutput>> {
  const clientId = optionalPositiveId(input.beneficiaryClientId);
  const candidateId = optionalPositiveId(input.beneficiaryCandidateId);
  const selectedDeviceId = optionalPositiveId(input.installedDeviceId);
  const selectedContractId = optionalPositiveId(input.contractId);
  if (clientId === 'invalid') return { ok: false, code: 'invalid_beneficiary_client_id' };
  if (candidateId === 'invalid') return { ok: false, code: 'invalid_beneficiary_candidate_id' };
  if (selectedDeviceId === 'invalid') return { ok: false, code: 'invalid_installed_device_id' };
  if (selectedContractId === 'invalid') return { ok: false, code: 'invalid_contract_id' };

  const hasPartySelection = clientId != null || candidateId != null;
  const hasDeviceSelection = selectedDeviceId != null;
  if (clientId != null && candidateId != null) {
    return { ok: false, code: 'beneficiary_target_must_be_exclusive' };
  }
  if (input.isChange && !hasPartySelection) {
    return { ok: false, code: 'change_linkage_target_required' };
  }
  if (!hasPartySelection && !hasDeviceSelection) {
    return { ok: false, code: 'beneficiary_or_device_link_required' };
  }
  if (selectedContractId != null && !hasDeviceSelection) {
    return { ok: false, code: 'contract_requires_installed_device' };
  }

  const tx = await acquireTx(db);
  const fail = async (code: string, message?: string, details?: Record<string, unknown>) => {
    await rollbackTx(tx);
    return { ok: false as const, code, message, details };
  };

  try {
    const { rows } = await tx.client.query<RequestRow>(
      `SELECT beneficiary_client_id, beneficiary_candidate_id,
              installed_device_id, contract_id, request_type, status,
              submission_type, branch_id, reviewed_by_user_id,
              reported_device_snapshot
         FROM service_requests
        WHERE id = $1
        FOR UPDATE`,
      [input.serviceRequestId],
    );
    const request = rows[0];
    if (!request) return await fail('not_found');

    const permission = reviewPermissionFor(request.request_type);
    const access = canLinkServiceRequestParty(input.authContext, {
      permission,
      branchId: request.branch_id,
      reviewedByUserId: request.reviewed_by_user_id,
    });
    if (!access.allowed) return await fail('forbidden', undefined, { reason: access.reason });
    if (request.status !== 'in_review') {
      return await fail(
        'link_requires_claim',
        'تولَّ الطلب أولاً (in_review) قبل ربطه بزبون أو مرشح.',
        { status: request.status },
      );
    }

    const hadPartyLink = request.beneficiary_client_id != null
      || request.beneficiary_candidate_id != null;
    if (input.isChange && !hadPartyLink) return await fail('nothing_to_change_use_link');

    if (input.isChange && sameTarget(request, clientId, candidateId) && !hasDeviceSelection) {
      await commitTx(tx);
      return {
        ok: true,
        data: {
          alreadyLinked: true,
          beneficiaryClientId: request.beneficiary_client_id,
          beneficiaryCandidateId: request.beneficiary_candidate_id,
          installedDeviceId: request.installed_device_id,
        },
      };
    }

    if (!input.isChange && hasPartySelection && hadPartyLink) {
      if (!sameTarget(request, clientId, candidateId)) {
        return await fail(
          'beneficiary_already_linked_use_change',
          'المستفيد مربوط بالفعل؛ استخدم عملية تغيير الربط مع سبب واضح.',
        );
      }
      if (!hasDeviceSelection) {
        await commitTx(tx);
        return {
          ok: true,
          data: {
            alreadyLinked: true,
            beneficiaryClientId: request.beneficiary_client_id,
            beneficiaryCandidateId: request.beneficiary_candidate_id,
            installedDeviceId: request.installed_device_id,
          },
        };
      }
    }

    if (
      ['water_check', 'device_request', 'periodic_maintenance', 'golden_warranty'].includes(request.request_type)
      && candidateId != null
    ) {
      return await fail(
        'candidate_link_forbidden_for_request_type',
        'This request type can only be linked to clients, not candidates.',
      );
    }

    let effectiveClientId = hasPartySelection ? clientId : request.beneficiary_client_id;
    let effectiveCandidateId = hasPartySelection ? candidateId : request.beneficiary_candidate_id;
    let linkedClientBranchId: number | null = null;

    if (effectiveClientId != null) {
      const existingClient = await tx.client.query<{ branch_id: number | null }>(
        `SELECT branch_id FROM clients WHERE id = $1 AND deleted_at IS NULL`,
        [effectiveClientId],
      );
      if (!existingClient.rows[0]) return await fail('client_not_found');
      linkedClientBranchId = existingClient.rows[0].branch_id == null
        ? null
        : Number(existingClient.rows[0].branch_id);

      if (request.request_type === 'water_check') {
        if (request.branch_id == null || linkedClientBranchId !== Number(request.branch_id)) {
          return await fail('service_request_client_branch_mismatch');
        }
      }
      if (
        request.request_type === 'device_request'
        || request.request_type === 'periodic_maintenance'
        || request.request_type === 'golden_warranty'
      ) {
        if (linkedClientBranchId == null) return await fail('beneficiary_branch_required');
        const targetAccess = authorize(input.authContext, {
          permission,
          branchId: linkedClientBranchId,
          assignedUserId: request.reviewed_by_user_id,
        });
        if (!targetAccess.allowed) return await fail('forbidden', undefined, { reason: targetAccess.reason });
      }
    }

    if (effectiveCandidateId != null) {
      const existingCandidate = await tx.client.query(
        `SELECT 1 FROM candidates WHERE id = $1`,
        [effectiveCandidateId],
      );
      if (!existingCandidate.rows[0]) return await fail('candidate_not_found');
    }

    let effectiveDeviceId = selectedDeviceId ?? request.installed_device_id;
    let effectiveContractId = selectedContractId ?? request.contract_id;
    let linkedDeviceBranchId: number | null = null;
    let linkedDeviceSerial: string | null = null;
    let selectedDevice: DeviceRow | null = null;

    const deviceToValidate = selectedDeviceId ?? (
      hasPartySelection && request.installed_device_id != null
        ? Number(request.installed_device_id)
        : null
    );
    if (deviceToValidate != null) {
      const deviceResult = await tx.client.query<DeviceRow>(
        `SELECT customer_id, contract_id, branch_id, serial_number
           FROM installed_devices
          WHERE id = $1
          FOR UPDATE`,
        [deviceToValidate],
      );
      selectedDevice = deviceResult.rows[0] ?? null;
      if (!selectedDevice) return await fail('installed_device_not_found');

      const deviceOwnerId = selectedDevice.customer_id == null
        ? null
        : Number(selectedDevice.customer_id);
      const deviceMatchesBeneficiary = effectiveClientId != null
        && deviceOwnerId === effectiveClientId;
      if (!deviceMatchesBeneficiary) {
        if (input.isChange && selectedDeviceId == null) {
          // The explicit relink selected a different person. Remove the old
          // person's device/contract atomically instead of leaving a corrupt
          // cross-customer request behind.
          effectiveDeviceId = null;
          effectiveContractId = null;
          selectedDevice = null;
        } else if (effectiveClientId == null) {
          return await fail('beneficiary_client_required_for_device_link');
        } else {
          return await fail('installed_device_beneficiary_mismatch');
        }
      }
    }

    if (selectedDevice) {
      linkedDeviceBranchId = selectedDevice.branch_id == null ? null : Number(selectedDevice.branch_id);
      linkedDeviceSerial = selectedDevice.serial_number == null ? null : String(selectedDevice.serial_number);
      if (selectedContractId != null && Number(selectedDevice.contract_id) !== selectedContractId) {
        return await fail('installed_device_contract_mismatch');
      }
      effectiveContractId = selectedContractId ?? (
        selectedDevice.contract_id == null ? null : Number(selectedDevice.contract_id)
      );

      if (request.request_type === 'periodic_maintenance' || request.request_type === 'golden_warranty') {
        const targetAccess = authorize(input.authContext, {
          permission,
          branchId: linkedDeviceBranchId,
          assignedUserId: request.reviewed_by_user_id,
        });
        if (!targetAccess.allowed) return await fail('forbidden', undefined, { reason: targetAccess.reason });
      }
      if (request.request_type === 'periodic_maintenance') {
        const activeRequest = await tx.client.query<{ id: number; public_ref_number: string }>(
          `SELECT id, public_ref_number
             FROM service_requests
            WHERE request_type = 'periodic_maintenance'
              AND installed_device_id = $1
              AND status IN ('received', 'in_review')
              AND id <> $2
            ORDER BY created_at ASC, id ASC
            LIMIT 1`,
          [effectiveDeviceId, input.serviceRequestId],
        );
        if (activeRequest.rows[0]) {
          return await fail('active_periodic_request_exists', undefined, {
            requestId: Number(activeRequest.rows[0].id),
            publicRefNumber: activeRequest.rows[0].public_ref_number,
          });
        }
      }
    }

    if (effectiveClientId == null && effectiveCandidateId == null) {
      return await fail('beneficiary_link_required');
    }

    await tx.client.query(
      `UPDATE service_requests
          SET beneficiary_client_id = $2,
              beneficiary_candidate_id = $3,
              requester_client_id = CASE
                WHEN submission_type = 'apply' AND $2::bigint IS NOT NULL THEN $2
                ELSE requester_client_id
              END,
              installed_device_id = $4,
              contract_id = $5,
              branch_id = CASE
                WHEN request_type IN ('periodic_maintenance', 'golden_warranty') AND $4::bigint IS NOT NULL THEN $7
                WHEN request_type IN ('device_request', 'periodic_maintenance', 'golden_warranty') AND $2::bigint IS NOT NULL THEN $6
                ELSE branch_id
              END,
              branch_resolution_status = CASE
                WHEN request_type IN ('device_request', 'periodic_maintenance', 'golden_warranty') AND $2::bigint IS NOT NULL THEN 'resolved'
                ELSE branch_resolution_status
              END,
              branch_resolution_reason = CASE
                WHEN request_type IN ('periodic_maintenance', 'golden_warranty') AND $4::bigint IS NOT NULL THEN 'installed_device_branch'
                WHEN request_type IN ('device_request', 'periodic_maintenance', 'golden_warranty') AND $2::bigint IS NOT NULL THEN 'beneficiary_client_branch'
                ELSE branch_resolution_reason
              END,
              updated_at = NOW()
        WHERE id = $1`,
      [
        input.serviceRequestId,
        effectiveClientId,
        effectiveCandidateId,
        effectiveDeviceId,
        effectiveContractId,
        linkedClientBranchId,
        linkedDeviceBranchId,
      ],
    );

    const partyChanged = hasPartySelection && !sameTarget(request, effectiveClientId, effectiveCandidateId);
    const eventType = input.isChange || !hasPartySelection ? 'linkage_changed' : 'party_linked';
    await appendAudit(tx.client, {
      serviceRequestId: input.serviceRequestId,
      eventType,
      actorUserId: input.actorUserId,
      actorRole: input.actorRole,
      payload: eventType === 'linkage_changed'
        ? {
            old_target: {
              beneficiary_client_id: request.beneficiary_client_id,
              beneficiary_candidate_id: request.beneficiary_candidate_id,
              installed_device_id: request.installed_device_id,
              contract_id: request.contract_id,
            },
            new_target: {
              beneficiary_client_id: effectiveClientId,
              beneficiary_candidate_id: effectiveCandidateId,
              installed_device_id: effectiveDeviceId,
              contract_id: effectiveContractId,
            },
            reason: input.changeReason ?? (!hasPartySelection ? 'installed_device_linked' : null),
            party_changed: partyChanged,
          }
        : {
            beneficiary_client_id: effectiveClientId,
            beneficiary_candidate_id: effectiveCandidateId,
            installed_device_id: effectiveDeviceId,
            contract_id: effectiveContractId,
          },
    });

    const reportedSerial = request.reported_device_snapshot?.serialNumber;
    if (
      request.request_type === 'periodic_maintenance'
      && typeof reportedSerial === 'string'
      && reportedSerial.trim()
      && linkedDeviceSerial
      && reportedSerial.trim().toLocaleLowerCase() !== linkedDeviceSerial.trim().toLocaleLowerCase()
    ) {
      await appendAudit(tx.client, {
        serviceRequestId: input.serviceRequestId,
        eventType: 'internal_note_added',
        actorUserId: input.actorUserId,
        actorRole: input.actorRole,
        note: 'device_serial_mismatch',
        payload: {
          code: 'device_serial_mismatch',
          reportedSerial: reportedSerial.trim(),
          installedDeviceId: effectiveDeviceId,
        },
      });
    }

    if (request.request_type === 'water_check') {
      await syncWaterCheckBeneficiaryReferrer(tx.client, input.serviceRequestId, input.actorUserId);
    }
    await commitTx(tx);
    return {
      ok: true,
      data: {
        beneficiaryClientId: effectiveClientId,
        beneficiaryCandidateId: effectiveCandidateId,
        installedDeviceId: effectiveDeviceId,
      },
    };
  } catch (error) {
    await rollbackTx(tx);
    throw error;
  } finally {
    tx.release();
  }
}
