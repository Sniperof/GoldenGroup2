// ============================================================
// routes/serviceRequests.ts
// ============================================================
// Phase 3 — REST surface for the service_requests intake layer.
//
// All endpoints sit under /api/service-requests except the two
// open-task companion routes, which are added directly to
// routes/openTasks.ts (GET /:id/problems, GET /:id/derived-outcome).
//
// Conventions:
//   - requireTypedPermission(action) gates per-id routes with the row's
//     permission family (request-section-contract.md §5):
//     emergency_maintenance → service_requests.*, water_check → water_check.*.
//   - actorRole: decide-gated endpoints act as 'audit_admin' (decide absorbed
//     the former reject key); everything else → 'operator'.
//   - Service results { ok:false, code } are mapped to HTTP 400
//     unless the code names a recognized status code (not_found
//     → 404, wrong_role → 403, merge_or_split_required → 409).
//   - Tx orchestration lives in the services; routes are thin.
// ============================================================

import { Router, type NextFunction, type Request, type Response } from 'express';
import crypto from 'node:crypto';
import pool from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permission.js';
import { authorize, resolveListAccessScope } from '../services/authorizationService.js';
import {
  appendAudit,
  type ActorRole,
  type ServiceRequestStatus,
} from '../services/serviceRequests/_shared.js';
import { createServiceRequest } from '../services/serviceRequests/createService.js';
import { transitionStatus } from '../services/serviceRequests/stateMachine.js';
import { claimOrTakeOver } from '../services/serviceRequests/claimService.js';
import {
  addProblem,
  editProblem,
  changeProblemStatus,
  softDeleteProblem,
  restoreProblem,
  auditAdminOverride,
  type ProblemStatus,
  type AddedDuringPhase,
} from '../services/serviceRequests/problemsService.js';
import {
  promote,
  mergeIntoExistingTask,
} from '../services/serviceRequests/promoteService.js';
import { handoffWaterCheckToDeviceDemo } from '../services/serviceRequests/waterCheckHandoffService.js';
import { handoffDeviceRequestToDemo } from '../services/serviceRequests/deviceRequestHandoffService.js';
import { handoffPeriodicMaintenanceRequest } from '../services/serviceRequests/periodicMaintenanceHandoffService.js';
import { handoffGoldenWarrantyRequest } from '../services/serviceRequests/goldenWarrantyHandoffService.js';
import { createInternalDeviceRequest } from '../services/serviceRequests/internalDeviceRequestService.js';
import { createInternalPeriodicMaintenanceRequest } from '../services/serviceRequests/internalPeriodicMaintenanceRequest.js';
import { createInternalGoldenWarrantyRequest } from '../services/serviceRequests/internalGoldenWarrantyRequest.js';
import { reopen } from '../services/serviceRequests/reopenService.js';
import { suggestRecords } from '../services/serviceRequests/fuzzyMatching.js';
import { resolveBranchForServiceGeoUnit } from '../services/serviceRequests/branchResolutionService.js';
import { getSystemSettingNumber } from '../services/systemSettings.js';
import { canLinkServiceRequestParty } from '../policies/serviceRequestPartyLinkPolicy.js';
import { syncWaterCheckBeneficiaryReferrer } from '../services/serviceRequests/atomicClientLink.js';
import { hasNameNominationGlobalPermission } from '../policies/nameNominationPolicy.js';
import {
  convertNameNominationItems,
  refreshNameNominationBranches,
  skipNameNominationItems,
} from '../services/serviceRequests/nameNominationHandoffService.js';

const router = Router();
router.use(requireAuth);

// ------------------------------------------------------------
// cross-type isolation guard (request-section-contract.md §5)
// ------------------------------------------------------------
// account_creation requests live behind /api/admin/account-requests with
// their own permission family (account_requests.*). They must be invisible
// to every service_requests.* endpoint — list and per-id alike. This param
// guard runs before any '/:id' route handler and answers 404 (not 403) so
// the isolated type's existence is not leaked either. It also resolves the
// row's request type once, for the typed permission middleware below.
declare global {
  namespace Express {
    interface Request {
      serviceRequestType?: string;
    }
  }
}

router.param('id', async (req, res, next, value) => {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'invalid_id' });
  }
  try {
    const { rows } = await pool.query<{ request_type: string }>(
      `SELECT request_type FROM service_requests WHERE id = $1`,
      [id],
    );
    if (rows.length === 0 || rows[0].request_type === 'account_creation') {
      return res.status(404).json({ error: 'service_request_not_found' });
    }
    req.serviceRequestType = rows[0].request_type;
    next();
  } catch (err) {
    next(err);
  }
});

// ------------------------------------------------------------
// typed permission families (request-section-contract.md §5)
// ------------------------------------------------------------
// One 5-key family per request type; the acting key is chosen from the
// row's type. Unknown/future types fall back to the maintenance family
// until they declare their own (fail-closed at the registry layer anyway).
const PERMISSION_FAMILY_BY_TYPE: Record<string, string> = {
  emergency_maintenance: 'service_requests',
  water_check: 'water_check',
  device_request: 'service_requests',
  periodic_maintenance: 'periodic_maintenance',
  golden_warranty: 'golden_warranty',
  name_nomination: 'name_nomination',
};

type FamilyAction = 'view' | 'review' | 'decide' | 'resolve_escalation' | 'archive' | 'create';

function familyKeyFor(requestType: string, action: FamilyAction): string {
  const family = PERMISSION_FAMILY_BY_TYPE[requestType] ?? 'service_requests';
  return `${family}.${action}`;
}

/** Per-type requirePermission — resolves the key from the row loaded by the
 *  '/:id' param guard, so the same route serves every family correctly. */
function requireTypedPermission(action: FamilyAction) {
  return (req: Request, res: Response, next: NextFunction) => {
    const requestType = req.serviceRequestType;
    if (!requestType) {
      return res.status(500).json({ error: 'request_type_not_resolved' });
    }
    const permission = familyKeyFor(requestType, action);
    return requirePermission(permission)(req, res, async (error?: unknown) => {
      if (error) return next(error);
      try {
        const { rows } = await pool.query<{
          branch_id: number | null; reviewed_by_user_id: number | null;
        }>(
          `SELECT branch_id, reviewed_by_user_id FROM service_requests WHERE id = $1 LIMIT 1`,
          [Number(req.params.id)],
        );
        if (!rows[0]) return res.status(404).json({ error: 'service_request_not_found' });
        const scopePlan = resolveListAccessScope(req.authContext!, permission);
        if (rows[0].branch_id == null && scopePlan.scope !== 'GLOBAL') {
          return res.status(403).json({
            error: 'service_request_subject_forbidden',
            details: { reason: 'UNRESOLVED_BRANCH_REQUIRES_GLOBAL' },
          });
        }
        const access = authorize(req.authContext!, {
          permission,
          branchId: rows[0].branch_id,
          assignedUserId: rows[0].reviewed_by_user_id,
        });
        if (!access.allowed) {
          return res.status(403).json({ error: 'service_request_subject_forbidden', details: { reason: access.reason } });
        }
        return next();
      } catch (subjectError) {
        return next(subjectError);
      }
    });
  };
}

function hasGlobalPermission(req: Request, permission: string): boolean {
  return req.authContext ? hasNameNominationGlobalPermission(req.authContext, permission) : false;
}

// ------------------------------------------------------------
// helpers
// ------------------------------------------------------------

function getActor(req: Request): { userId: number; isSuperAdmin: boolean } {
  const ctx = req.authContext!;
  return { userId: ctx.userId, isSuperAdmin: ctx.isSuperAdmin };
}

async function authorizeCreateSubject(
  req: Request,
  res: Response,
  input: Record<string, unknown> = req.body ?? {},
  permission = 'service_requests.create',
  preferDeviceBranch = false,
): Promise<boolean> {
  const beneficiaryClientId = Number(input.beneficiaryClientId) || null;
  const installedDeviceId = Number(input.installedDeviceId) || null;
  if (beneficiaryClientId == null && installedDeviceId == null) {
    const branchId = Number(input.branchId ?? req.authContext?.actingBranchId) || null;
    const access = authorize(req.authContext!, { permission, branchId });
    if (!access.allowed) {
      res.status(403).json({ error: 'service_request_subject_forbidden', details: { reason: access.reason } });
      return false;
    }
    return true;
  }
  const { rows } = await pool.query<{
    client_id: number | null;
    client_branch_id: number | null;
    device_customer_id: number | null;
    device_branch_id: number | null;
  }>(
    `SELECT c.id AS client_id, c.branch_id AS client_branch_id,
            d.customer_id AS device_customer_id, d.branch_id AS device_branch_id
       FROM (SELECT $1::bigint AS beneficiary_client_id, $2::bigint AS installed_device_id) input
       LEFT JOIN clients c ON c.id = input.beneficiary_client_id AND c.deleted_at IS NULL
       LEFT JOIN installed_devices d ON d.id = input.installed_device_id`,
    [beneficiaryClientId, installedDeviceId],
  );
  const subject = rows[0];
  if (beneficiaryClientId != null && subject?.client_id == null) {
    res.status(404).json({ error: 'beneficiary_client_not_found' });
    return false;
  }
  if (installedDeviceId != null && subject?.device_customer_id == null) {
    res.status(404).json({ error: 'installed_device_not_found' });
    return false;
  }
  if (
    installedDeviceId != null
    && beneficiaryClientId != null
    && subject.device_customer_id !== beneficiaryClientId
  ) {
    res.status(400).json({ error: 'installed_device_beneficiary_mismatch' });
    return false;
  }
  const branchId = preferDeviceBranch
    ? subject.device_branch_id ?? subject.client_branch_id
    : subject.client_branch_id ?? subject.device_branch_id;
  const access = authorize(req.authContext!, { permission, branchId });
  if (!access.allowed) {
    res.status(403).json({ error: 'service_request_subject_forbidden', details: { reason: access.reason } });
    return false;
  }
  return true;
}

function requireInternalCallRequestCreatePermission(req: Request, res: Response, next: NextFunction) {
  const requestType = String(req.body?.request?.requestType ?? 'emergency_maintenance');
  return requirePermission(familyKeyFor(requestType, 'create'))(req, res, next);
}

/** Maps a service-result error code to an HTTP status. */
function statusFromCode(code: string): number {
  switch (code) {
    case 'not_found':
    case 'service_request_not_found':
    case 'installed_device_not_found':
    case 'existing_open_task_not_found':
      return 404;
    case 'wrong_role_for_reopen':
    case 'audit_admin_cannot_claim':
    case 'promoted_cannot_be_reopened':
    case 'open_tasks_branch_forbidden':
    case 'forbidden':
      return 403;
    case 'merge_or_split_required':
    case 'periodic_attachment_candidate_not_available':
    case 'active_device_demo_exists':
    case 'active_periodic_task_exists':
    case 'active_periodic_request_exists':
    case 'device_serial_conflict':
      return 409;
    case 'request_is_escalated_actions_blocked':
      return 423; // Locked — restricted mode (SR-ESC-01)
    default:
      return 400;
  }
}

/**
 * SR-ESC-01 — restricted mode guard. While a request is escalated
 * (escalated_at IS NOT NULL) every mutating action is blocked except the two
 * exits (resolve-escalation, reject) and non-mutating ones (view, notes).
 * Applied as route middleware after requirePermission on gated endpoints.
 */
async function blockIfEscalated(req: Request, res: Response, next: () => void) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return next();
  const { rows } = await pool.query<{ escalated_at: string | null }>(
    `SELECT escalated_at FROM service_requests WHERE id = $1`,
    [id],
  );
  if (rows.length > 0 && rows[0].escalated_at != null) {
    return res.status(423).json({
      error: 'request_is_escalated_actions_blocked',
      message: 'الطلب مُصعَّد (وضع مقيَّد): لا يُسمح بأي إجراء قبل فكّ التصعيد أو الرفض.',
      details: null,
    });
  }
  next();
}

function sendErr(res: Response, result: { code: string; message?: string; details?: unknown }) {
  res.status(statusFromCode(result.code)).json({
    error: result.code,
    message: result.message ?? null,
    details: result.details ?? null,
  });
}

function readText(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  return typeof value === 'string' ? value.trim() : '';
}

function readFirstText(body: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = readText(body, key);
    if (value) return value;
  }
  return '';
}

function readNumber(body: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = body[key];
    const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  return null;
}

function readBoolean(body: Record<string, unknown>, key: string): boolean {
  const value = body[key];
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value === 'true' || value === '1';
  return false;
}

function readMapLocation(body: Record<string, unknown>): { lat: number; lng: number } | null {
  const raw = body.mapLocation ?? body.map_location ?? body.location;
  if (!raw || typeof raw !== 'object') return null;
  const map = raw as Record<string, unknown>;
  const lat = typeof map.lat === 'number' ? map.lat : Number(map.lat);
  const lng = typeof map.lng === 'number' ? map.lng : Number(map.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat === 0 && lng === 0) return null;
  return { lat, lng };
}

const SR_SELECT = `
  sr.id,
  sr.public_ref_number AS "publicRefNumber",
  sr.request_type AS "requestType",
  CASE sr.request_type
    WHEN 'water_check' THEN 'طلب فحص المياه'
    WHEN 'emergency_maintenance' THEN 'طلب صيانة'
    WHEN 'device_request' THEN 'طلب جهاز'
    ELSE sr.request_type
  END AS "requestTypeLabel",
  sr.channel,
  CASE sr.channel
    WHEN 'phone' THEN 'هاتف'
    WHEN 'internal_button' THEN 'زر داخلي'
    WHEN 'client_detail_button' THEN 'من تفاصيل الزبون'
    WHEN 'admin_manual' THEN 'إدخال يدوي'
    WHEN 'mobile_app' THEN 'تطبيق موبايل'
    WHEN 'website' THEN 'موقع'
    WHEN 'whatsapp' THEN 'واتساب'
    ELSE sr.channel
  END AS "channelLabel",
  sr.application_source AS "applicationSource",
  sr.submitted_payload AS "submittedPayload",
  sr.requester_user_id AS "requesterUserId",
  sr.requester_app_account_id AS "requesterAppAccountId",
  sr.requester_client_id AS "requesterClientId",
  COALESCE(
    rqc.name,
    NULLIF(CONCAT_WS(' ', rqc.first_name, rqc.father_name, rqc.last_name), '')
  ) AS "requesterClientName",
  sr.requester_external AS "requesterExternal",
  sr.beneficiary_client_id AS "beneficiaryClientId",
  COALESCE(
    bc.name,
    NULLIF(CONCAT_WS(' ', bc.first_name, bc.father_name, bc.last_name), '')
  ) AS "beneficiaryClientName",
  sr.beneficiary_candidate_id AS "beneficiaryCandidateId",
  NULLIF(CONCAT_WS(' ', bcan.first_name, bcan.last_name), '') AS "beneficiaryCandidateName",
  sr.beneficiary_external AS "beneficiaryExternal",
  sr.referrer_user_id AS "referrerUserId",
  sr.referrer_external AS "referrerExternal",
  sr.referrer_client_id AS "referrerClientId",
  COALESCE(
    rc.name,
    NULLIF(CONCAT_WS(' ', rc.first_name, rc.father_name, rc.last_name), '')
  ) AS "referrerClientName",
  sr.submission_type AS "submissionType",
  sr.submitter_tier AS "submitterTier",
  sr.contract_id AS "contractId",
  sr.device_source AS "deviceSource",
  sr.installed_device_id AS "installedDeviceId",
  sr.external_device_name AS "externalDeviceName",
  sr.external_device_serial AS "externalDeviceSerial",
  sr.reported_device_selection AS "reportedDeviceSelection",
  sr.reported_device_model_id AS "reportedDeviceModelId",
  sr.reported_device_snapshot AS "reportedDeviceSnapshot",
  sr.safety_indicator_codes AS "safetyIndicatorCodes",
  sr.device_request_purpose_id AS "deviceRequestPurposeId",
  sr.device_request_purpose_snapshot AS "deviceRequestPurposeSnapshot",
  sr.periodic_maintenance_reason_id AS "periodicMaintenanceReasonId",
  sr.periodic_maintenance_reason_snapshot AS "periodicMaintenanceReasonSnapshot",
  sr.requested_warranty_months AS "requestedWarrantyMonths",
  sr.requested_warranty_period_snapshot AS "requestedWarrantyPeriodSnapshot",
  sr.beneficiary_contact_consent_confirmed AS "beneficiaryContactConsentConfirmed",
  COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', item.id, 'itemOrder', item.item_order, 'firstName', item.first_name,
      'lastName', item.last_name, 'primaryPhone', item.primary_phone,
      'primaryPhoneHasWhatsapp', item.primary_phone_has_whatsapp,
      'secondaryPhone', item.secondary_phone, 'secondaryPhoneHasWhatsapp', item.secondary_phone_has_whatsapp,
      'occupation', item.occupation, 'geoSnapshot', item.geo_snapshot,
      'branchResolutionStatus', item.branch_resolution_status,
      'branchResolutionReason', item.branch_resolution_reason, 'branchId', item.branch_id,
      'branchName', item_branch.name, 'status', item.status, 'candidateId', item.candidate_id,
      'exclusionReason', item.exclusion_reason_snapshot, 'decidedAt', item.decided_at
    ) ORDER BY item.item_order)
    FROM service_request_name_nomination_items item
    LEFT JOIN branches item_branch ON item_branch.id=item.branch_id
    WHERE item.service_request_id=sr.id
  ), '[]'::jsonb) AS "nameNominationItems",
  sr.decision_reason_id AS "decisionReasonId",
  sr.decision_reason_snapshot AS "decisionReasonSnapshot",
  COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'deviceModelId', interest.device_model_id,
      'snapshot', interest.device_snapshot,
      'selectionOrder', interest.selection_order,
      'currentActive', model.is_active
    ) ORDER BY interest.selection_order)
    FROM service_request_device_interests interest
    LEFT JOIN device_models model ON model.id = interest.device_model_id
    WHERE interest.service_request_id = sr.id
  ), '[]'::jsonb) AS "deviceInterests",
  (
    SELECT jsonb_build_object('id', active_demo.id, 'status', active_demo.status, 'createdAt', active_demo.created_at)
      FROM open_tasks active_demo
     WHERE active_demo.client_id = sr.beneficiary_client_id
       AND active_demo.task_type = 'device_demo'
       AND active_demo.status NOT IN ('completed', 'closed', 'cancelled')
     ORDER BY active_demo.created_at DESC
     LIMIT 1
  ) AS "activeDeviceDemo",
  (
    SELECT jsonb_build_object(
      'id', active_periodic.id,
      'status', active_periodic.status,
      'dueDate', active_periodic.due_date,
      'createdAt', active_periodic.created_at
    )
      FROM open_tasks active_periodic
     WHERE active_periodic.device_id = sr.installed_device_id
       AND active_periodic.task_type = 'periodic_maintenance'
       AND active_periodic.status NOT IN ('completed', 'closed', 'cancelled')
     ORDER BY active_periodic.created_at DESC, active_periodic.id DESC
     LIMIT 1
  ) AS "activePeriodicMaintenanceTask",
  (
    SELECT jsonb_build_object('id', offer.id, 'status', offer.status, 'createdAt', offer.created_at)
      FROM open_tasks offer
     WHERE offer.device_id = sr.installed_device_id
       AND offer.task_type = 'golden_warranty_offer'
       AND offer.status NOT IN ('completed', 'closed', 'cancelled')
     ORDER BY offer.created_at DESC, offer.id DESC
     LIMIT 1
  ) AS "activeGoldenWarrantyOfferTask",
  (
    SELECT jsonb_build_object('id', warranty.id, 'type', warranty.warranty_type, 'endDate', warranty.end_date)
      FROM device_warranties warranty
     WHERE warranty.device_id = sr.installed_device_id
       AND warranty.status = 'active'
       AND (warranty.end_date IS NULL OR warranty.end_date >= CURRENT_DATE)
     ORDER BY warranty.id DESC
     LIMIT 1
  ) AS "activeDeviceWarranty",
  sr.source_call_log_id AS "sourceCallLogId",
  sr.device_location_decision AS "deviceLocationDecision",
  sr.device_location_decided_by_user_id AS "deviceLocationDecidedByUserId",
  sr.device_location_decided_at AS "deviceLocationDecidedAt",
  sr.problem_description AS "problemDescription",
  sr.requested_action_type_id AS "requestedActionTypeId",
  sr.attachments,
  sr.service_address AS "serviceAddress",
  sr.priority,
  sr.status,
  -- Aligned with the one frontend lexicon (contract §7). The UI renders from
  -- REQUEST_STATUS_LABELS; this column exists only for API consumers.
  CASE sr.status
    WHEN 'received' THEN 'مُستلَم'
    WHEN 'in_review' THEN 'قيد المراجعة'
    WHEN 'awaiting_customer_info' THEN 'بانتظار الزبون (قديم)'
    WHEN 'resolved_at_intake' THEN 'محلول عند الاستلام'
    WHEN 'rejected' THEN 'مرفوض'
    WHEN 'promoted' THEN 'مُرقّى إلى مهمة'
    WHEN 'completed' THEN 'مُكتمَل'
    WHEN 'cancelled' THEN 'مُلغى'
    ELSE sr.status
  END AS "statusLabel",
  sr.reviewed_by_user_id AS "reviewedByUserId",
  reviewer.name AS "reviewedByUserName",
  sr.claimed_at AS "claimedAt",
  sr.triage_outcome AS "triageOutcome",
  sr.triage_notes AS "triageNotes",
  sr.linked_open_task_id AS "linkedOpenTaskId",
  lot.task_type AS "linkedOpenTaskType",
  lot.status AS "linkedOpenTaskStatus",
  lot.priority AS "linkedOpenTaskPriority",
  lot.created_at AS "linkedOpenTaskCreatedAt",
  sr.expected_callback_at AS "expectedCallbackAt",
  sr.duplicate_flag AS "duplicateFlag",
  sr.duplicate_of_request_id AS "duplicateOfRequestId",
  sr.review_required_flag AS "reviewRequiredFlag",
  sr.escalated_at AS "escalatedAt",
  sr.escalated_by_user_id AS "escalatedByUserId",
  escalator.name AS "escalatedByUserName",
  sr.escalation_reason AS "escalationReason",
  sr.rejected_by_user_id AS "rejectedByUserId",
  sr.rejection_reason AS "rejectionReason",
  sr.archived_at AS "archivedAt",
  sr.archived_by_user_id AS "archivedByUserId",
  archiver.name AS "archivedByUserName",
  sr.reopen_count AS "reopenCount",
  sr.last_reopened_at AS "lastReopenedAt",
  sr.branch_id AS "branchId",
  br.name AS "branchName",
  sr.branch_resolution_status AS "branchResolutionStatus",
  CASE sr.branch_resolution_status
    WHEN 'resolved' THEN 'تم ربط الفرع'
    WHEN 'ambiguous' THEN 'أكثر من فرع'
    WHEN 'no_coverage' THEN 'خارج التغطية'
    WHEN 'missing_geo' THEN 'موقع ناقص'
    WHEN 'not_applicable' THEN 'غير مطبق'
    ELSE sr.branch_resolution_status
  END AS "branchResolutionLabel",
  sr.branch_resolution_reason AS "branchResolutionReason",
  sr.branch_resolution_geo_unit_id AS "branchResolutionGeoUnitId",
  brg.name AS "branchResolutionGeoUnitName",
  sr.created_at AS "createdAt",
  sr.closed_at AS "closedAt",
  sr.updated_at AS "updatedAt"
`;

const SR_DISPLAY_JOINS = `
  LEFT JOIN branches br ON br.id = sr.branch_id
  LEFT JOIN geo_units brg ON brg.id = sr.branch_resolution_geo_unit_id
  LEFT JOIN hr_users reviewer ON reviewer.id = sr.reviewed_by_user_id
  LEFT JOIN hr_users escalator ON escalator.id = sr.escalated_by_user_id
  LEFT JOIN hr_users archiver ON archiver.id = sr.archived_by_user_id
  LEFT JOIN clients bc ON bc.id = sr.beneficiary_client_id
  LEFT JOIN clients rqc ON rqc.id = sr.requester_client_id
  LEFT JOIN clients rc ON rc.id = sr.referrer_client_id
  LEFT JOIN candidates bcan ON bcan.id = sr.beneficiary_candidate_id
  LEFT JOIN open_tasks lot ON lot.id = sr.linked_open_task_id
`;

// ------------------------------------------------------------
// CREATE (٠.٦ — channel determines initial status)
// ------------------------------------------------------------

router.post('/', requirePermission('service_requests.create'), async (req, res) => {
  if (req.body?.requestType === 'periodic_maintenance') {
    return res.status(400).json({ error: 'periodic_maintenance_requires_telemarketing_call_result' });
  }
  const allowedChannels = new Set(['phone', 'internal_button', 'client_detail_button', 'admin_manual']);
  if (!allowedChannels.has(String(req.body?.channel ?? ''))) {
    return res.status(400).json({ error: 'invalid_internal_service_request_channel' });
  }
  if (!await authorizeCreateSubject(req, res)) return;
  const actor = getActor(req);
  if (req.body?.requestType === 'device_request') {
    const beneficiaryClientId = Number(req.body.beneficiaryClientId);
    if (!Number.isInteger(beneficiaryClientId) || beneficiaryClientId <= 0) {
      return res.status(400).json({ error: 'beneficiary_client_id_required' });
    }
    const result = await createInternalDeviceRequest({
      channel: req.body.channel,
      applicationSource: req.body.applicationSource,
      requesterClientId: Number(req.body.requesterClientId) || null,
      requesterExternal: req.body.requesterExternal,
      beneficiaryClientId,
      beneficiaryExternal: req.body.beneficiaryExternal,
      referrerClientId: Number(req.body.referrerClientId) || null,
      referrerExternal: req.body.referrerExternal,
      submissionType: req.body.submissionType,
      purposeId: Number(req.body.purposeId),
      deviceModelIds: Array.isArray(req.body.deviceModelIds) ? req.body.deviceModelIds : [],
      notes: req.body.notes,
      serviceAddress: req.body.serviceAddress,
      actorUserId: actor.userId,
      actorRole: 'operator',
    });
    if (result.ok !== true) return sendErr(res, result);
    return res.status(201).json(result.data);
  }
  const result = await createServiceRequest({
    ...req.body,
    requestType: 'emergency_maintenance',
    actorUserId: actor.userId,
    actorRole: 'operator',
    branchId: req.body.branchId ?? req.authContext!.actingBranchId ?? null,
  });
  if (result.ok !== true) return sendErr(res, result);
  res.status(201).json(result.data);
});

// Convenience: same as POST / but forces channel='admin_manual' + in_review.
router.post('/internal', requirePermission('service_requests.create'), async (req, res) => {
  if (req.body?.requestType === 'periodic_maintenance') {
    return res.status(400).json({ error: 'periodic_maintenance_requires_telemarketing_call_result' });
  }
  if (!await authorizeCreateSubject(req, res)) return;
  const actor = getActor(req);
  if (req.body?.requestType === 'device_request') {
    const beneficiaryClientId = Number(req.body.beneficiaryClientId);
    if (!Number.isInteger(beneficiaryClientId) || beneficiaryClientId <= 0) {
      return res.status(400).json({ error: 'beneficiary_client_id_required' });
    }
    const result = await createInternalDeviceRequest({
      channel: 'admin_manual',
      applicationSource: req.body.applicationSource,
      requesterClientId: Number(req.body.requesterClientId) || null,
      requesterExternal: req.body.requesterExternal,
      beneficiaryClientId,
      beneficiaryExternal: req.body.beneficiaryExternal,
      referrerClientId: Number(req.body.referrerClientId) || null,
      referrerExternal: req.body.referrerExternal,
      submissionType: req.body.submissionType,
      purposeId: Number(req.body.purposeId),
      deviceModelIds: Array.isArray(req.body.deviceModelIds) ? req.body.deviceModelIds : [],
      notes: req.body.notes,
      serviceAddress: req.body.serviceAddress,
      actorUserId: actor.userId,
      actorRole: 'operator',
    });
    if (result.ok !== true) return sendErr(res, result);
    return res.status(201).json(result.data);
  }
  const result = await createServiceRequest({
    ...req.body,
    requestType: 'emergency_maintenance',
    channel: 'admin_manual',
    actorUserId: actor.userId,
    actorRole: 'operator',
    branchId: req.body.branchId ?? req.authContext!.actingBranchId ?? null,
  });
  if (result.ok !== true) return sendErr(res, result);
  res.status(201).json(result.data);
});

// Telemarketing/service-call gateway. The customer call log and the emergency
// service request either both commit or neither does.
router.post(
  '/internal-with-call',
  requirePermission('telemarketing.calls.create'),
  requireInternalCallRequestCreatePermission,
  async (req, res) => {
    const actor = getActor(req);
    const call = (req.body?.call ?? {}) as Record<string, unknown>;
    const request = (req.body?.request ?? {}) as Record<string, unknown>;
    const requesterClientId = Number(request.requesterClientId ?? call.customerId);
    const beneficiaryClientId = Number(request.beneficiaryClientId) || null;
    const requestType = String(request.requestType ?? 'emergency_maintenance');
    if (!new Set([
      'emergency_maintenance',
      'device_request',
      'periodic_maintenance',
      'golden_warranty',
    ]).has(requestType)) {
      return res.status(400).json({ error: 'unsupported_internal_call_request_type' });
    }
    const createPermission = familyKeyFor(requestType, 'create');
    if (!Number.isInteger(requesterClientId) || requesterClientId <= 0) {
      return res.status(400).json({ error: 'requester_client_id_required' });
    }
    const { rows: partyRows } = await pool.query<{
      id: number;
      branch_id: number | null;
    }>(
      `SELECT id, branch_id FROM clients WHERE id = ANY($1::bigint[]) AND deleted_at IS NULL`,
      [[requesterClientId, ...(beneficiaryClientId ? [beneficiaryClientId] : [])]],
    );
    const requester = partyRows.find((row) => Number(row.id) === requesterClientId);
    const beneficiary = beneficiaryClientId
      ? partyRows.find((row) => Number(row.id) === beneficiaryClientId)
      : null;
    if (!requester) return res.status(404).json({ error: 'requester_client_not_found' });
    if (beneficiaryClientId && !beneficiary) return res.status(404).json({ error: 'beneficiary_client_not_found' });
    const isDeviceRequest = requestType === 'device_request';
    const isPeriodicMaintenance = requestType === 'periodic_maintenance';
    const isGoldenWarranty = requestType === 'golden_warranty';
    const subjectBranchIds = isDeviceRequest
      ? [beneficiary?.branch_id ?? requester.branch_id]
      : [requester.branch_id, beneficiary?.branch_id];
    for (const branchId of new Set(subjectBranchIds.filter((id): id is number => id != null))) {
      const access = authorize(req.authContext!, { permission: createPermission, branchId });
      if (!access.allowed) {
        return res.status(403).json({ error: 'service_request_subject_forbidden', details: { branchId, reason: access.reason } });
      }
    }
    if (!await authorizeCreateSubject(req, res, request, createPermission, isPeriodicMaintenance || isGoldenWarranty)) return;

    const callLogId = crypto.randomUUID();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO customer_call_logs (
           id, customer_id, contact_id, contact_number, contact_label,
           caller_id, caller_role, call_date, outcome, source_type, source_id,
           notes, branch_id, action_log, answered_by, communication_channel, status
         ) VALUES (
           $1, $2, $3, $4, $5,
           $6, 'telemarketer', COALESCE($7::timestamptz, NOW()), 'service_request',
           'telemarketing_task', $8,
           $9, $10, '{}'::jsonb, $11, $12, 'completed'
         )`,
        [
          callLogId,
          requesterClientId,
          call.contactId ?? null,
          call.contactNumber ?? null,
          call.contactLabel ?? null,
          actor.userId,
          call.callDate ?? null,
          call.taskListItemId ?? null,
          call.notes ?? null,
          requester.branch_id,
          call.answeredBy ?? null,
          call.communicationChannel ?? null,
        ],
      );
      const result = isDeviceRequest
        ? await createInternalDeviceRequest({
          channel: 'phone',
          applicationSource: 'telemarketing_service_request',
          requesterClientId,
          beneficiaryClientId: beneficiaryClientId ?? requesterClientId,
          beneficiaryExternal: request.beneficiaryExternal as Record<string, unknown> | null | undefined,
          referrerClientId: Number(request.referrerClientId) || null,
          referrerExternal: request.referrerExternal as Record<string, unknown> | null | undefined,
          submissionType: request.submissionType === 'refer_a_candidate' ? 'refer_a_candidate' : 'apply',
          purposeId: Number(request.purposeId),
          deviceModelIds: Array.isArray(request.deviceModelIds) ? request.deviceModelIds.map(Number) : [],
          notes: typeof request.notes === 'string' ? request.notes : null,
          serviceAddress: request.serviceAddress as Record<string, unknown> | null | undefined,
          sourceCallLogId: callLogId,
          actorUserId: actor.userId,
          actorRole: 'operator',
        }, client)
        : isPeriodicMaintenance
          ? await createInternalPeriodicMaintenanceRequest({
            db: client,
            request,
            requesterClientId,
            beneficiaryClientId,
            beneficiaryExternal: request.beneficiaryExternal as Record<string, unknown> | null | undefined,
            referrerClientId: Number(request.referrerClientId) || null,
            referrerExternal: request.referrerExternal as Record<string, unknown> | null | undefined,
            sourceCallLogId: callLogId,
            actorUserId: actor.userId,
          })
          : isGoldenWarranty
            ? await createInternalGoldenWarrantyRequest({
              db: client,
              request,
              requesterClientId,
              beneficiaryClientId,
              sourceCallLogId: callLogId,
              actorUserId: actor.userId,
            })
          : await createServiceRequest({
        requestType: 'emergency_maintenance',
        channel: 'phone',
        applicationSource: 'telemarketing_service_request',
        submittedPayload: {
          formVersion: 'emergency_maintenance.internal.v1',
          capturedAt: new Date().toISOString(),
          call: { contactNumber: call.contactNumber ?? null, notes: call.notes ?? null },
        },
        requesterClientId,
        beneficiaryClientId,
        beneficiaryExternal: request.beneficiaryExternal as Record<string, unknown> | null | undefined,
        referrerClientId: Number(request.referrerClientId) || null,
        referrerExternal: request.referrerExternal as Record<string, unknown> | null | undefined,
        submissionType: request.submissionType === 'refer_a_candidate' ? 'refer_a_candidate' : 'apply',
        submitterTier: 'staff',
        contractId: Number(request.contractId) || null,
        deviceSource: request.deviceSource === 'external_device' ? 'external_device' : 'company_device',
        installedDeviceId: Number(request.installedDeviceId) || null,
        externalDeviceName: typeof request.externalDeviceName === 'string' ? request.externalDeviceName : null,
        externalDeviceSerial: typeof request.externalDeviceSerial === 'string' ? request.externalDeviceSerial : null,
        reportedDeviceSelection: request.reportedDeviceSelection === 'catalog_model'
          || request.reportedDeviceSelection === 'other'
          || request.reportedDeviceSelection === 'registered_device'
          ? request.reportedDeviceSelection
          : null,
        reportedDeviceModelId: Number(request.reportedDeviceModelId) || null,
        reportedDeviceSnapshot: request.reportedDeviceSnapshot as Record<string, unknown> | null | undefined,
        problemDescription: String(request.problemDescription ?? '').trim(),
        attachments: [],
        safetyIndicatorCodes: Array.isArray(request.safetyIndicatorCodes)
          ? request.safetyIndicatorCodes.map(String)
          : [],
        serviceAddress: request.serviceAddress as Record<string, unknown> | null | undefined,
        priority: ['Critical', 'High', 'Normal', 'Low'].includes(String(request.priority))
          ? request.priority as 'Critical' | 'High' | 'Normal' | 'Low'
          : 'Normal',
        branchId: beneficiary?.branch_id ?? requester.branch_id,
        branchResolutionStatus: 'not_applicable',
        sourceCallLogId: callLogId,
        actorUserId: actor.userId,
        actorRole: 'operator',
        }, client);
      if (result.ok !== true) {
        await client.query('ROLLBACK');
        return sendErr(res, result);
      }
      await client.query('COMMIT');
      return res.status(201).json({ ...result.data, callLogId });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },
);

// ------------------------------------------------------------
// LIST + DETAIL (٠.١٦ — view is GLOBAL only; SR-08)
// ------------------------------------------------------------

router.post('/water-check', requirePermission('water_check.create'), async (req, res) => {
  const actor = getActor(req);
  const body = (req.body ?? {}) as Record<string, unknown>;

  const firstName = readText(body, 'firstName');
  const fatherName = readText(body, 'fatherName');
  const lastName = readText(body, 'lastName');
  const phoneNumber = readFirstText(body, ['phoneNumber', 'primaryPhone', 'phone']);
  const secondaryPhone = readFirstText(body, ['secondaryPhone', 'secondary_phone']);
  const detailedAddress = readFirstText(body, ['detailedAddress', 'detailed_address']);
  const notes = readText(body, 'notes');

  const governorateId = readNumber(body, ['governorateId', 'governorate']);
  const regionId = readNumber(body, ['regionId', 'region']);
  const subdistrictId = readNumber(body, ['subdistrictId', 'subdistrict']);
  const neighborhoodId = readNumber(body, ['neighborhoodId', 'neighborhood']);
  const deepestGeoUnitId = neighborhoodId ?? subdistrictId ?? regionId ?? governorateId;

  const missing: string[] = [];
  if (!firstName) missing.push('firstName');
  if (!lastName) missing.push('lastName');
  if (!phoneNumber) missing.push('phoneNumber');
  if (!governorateId) missing.push('governorateId');
  if (!detailedAddress) missing.push('detailedAddress');
  if (missing.length > 0) {
    return res.status(400).json({ error: 'missing_required_fields', fields: missing });
  }

  if (!/^\d{10}$/.test(phoneNumber.replace(/\D/g, ''))) {
    return res.status(400).json({ error: 'invalid_phone', message: 'رقم الهاتف يجب أن يتكون من 10 أرقام.' });
  }
  if (secondaryPhone && !/^\d{10}$/.test(secondaryPhone.replace(/\D/g, ''))) {
    return res.status(400).json({ error: 'invalid_secondary_phone', message: 'الرقم الثانوي يجب أن يتكون من 10 أرقام.' });
  }

  const mapLocation = readMapLocation(body);
  const name = [firstName, fatherName, lastName].filter(Boolean).join(' ');
  const clientCompatible: Record<string, unknown> = {
    firstName,
    lastName,
    mobile: phoneNumber,
    contacts: secondaryPhone ? [{ type: 'phone', value: secondaryPhone }] : [],
    governorate: governorateId,
    district: regionId,
    neighborhood: neighborhoodId,
    detailedAddress,
    gpsCoordinates: mapLocation,
  };
  if (fatherName) clientCompatible.fatherName = fatherName;

  const externalSnapshot: Record<string, unknown> = {
    snapshotSchemaVersion: 1,
    partyRole: 'beneficiary',
    firstName,
    lastName,
    name,
    primary_phone: phoneNumber,
    primaryPhoneHasWhatsapp: readBoolean(body, 'primaryPhoneHasWhatsapp'),
    detailedAddress,
    geoUnitId: deepestGeoUnitId,
    clientCompatible,
  };
  if (fatherName) externalSnapshot.fatherName = fatherName;
  if (secondaryPhone) {
    externalSnapshot.secondary_phone = secondaryPhone;
    externalSnapshot.secondaryPhoneHasWhatsapp = readBoolean(body, 'secondaryPhoneHasWhatsapp');
  }
  if (notes) externalSnapshot.notes = notes;

  // Submission path — "for another" makes the submitter a mediator (referrer)
  // for the beneficiary. The mediator's data is captured only after opt-in.
  const submissionMode = readText(body, 'submissionMode') === 'for_another' ? 'for_another' : 'for_self';
  const shareMediatorData = readBoolean(body, 'shareMediatorData');
  let referrerExternal: Record<string, unknown> | null = null;
  if (submissionMode === 'for_another' && shareMediatorData) {
    const mFirst = readText(body, 'mediatorFirstName');
    const mLast = readText(body, 'mediatorLastName');
    const mPhone = readFirstText(body, ['mediatorPhone', 'mediator_phone']);
    const mOccupation = readText(body, 'mediatorOccupation');
    const mDetailedAddress = readFirstText(body, ['mediatorDetailedAddress', 'mediatorAddress']);
    const mNotes = readText(body, 'mediatorNotes');
    const mGovernorateId = readNumber(body, ['mediatorGovernorateId']);
    const mRegionId = readNumber(body, ['mediatorRegionId']);
    const mSubdistrictId = readNumber(body, ['mediatorSubdistrictId']);
    const mNeighborhoodId = readNumber(body, ['mediatorNeighborhoodId']);
    const mDeepestGeoUnitId = mNeighborhoodId ?? mSubdistrictId ?? mRegionId ?? mGovernorateId;
    const mName = [mFirst, mLast].filter(Boolean).join(' ');
    if (!mFirst || !mLast || !mPhone || !mGovernorateId) {
      return res.status(400).json({
        error: 'mediator_required_fields',
        message: 'حقول الوسيط الإلزامية: الاسم الأول، الكنية، رقم الهاتف، المحافظة.',
      });
    }
    if (!/^\d{10}$/.test(mPhone.replace(/\D/g, ''))) {
      return res.status(400).json({ error: 'invalid_mediator_phone', message: 'رقم هاتف الوسيط يجب أن يتكون من 10 أرقام.' });
    }
    {
      referrerExternal = {
        snapshotSchemaVersion: 1,
        partyRole: 'referrer',
        awarenessOrConsent: true,
        firstName: mFirst || null,
        lastName: mLast || null,
        name: mName || null,
        primary_phone: mPhone || null,
        primaryPhoneHasWhatsapp: readBoolean(body, 'mediatorPhoneHasWhatsapp'),
        occupation: mOccupation || null,
        governorateId: mGovernorateId,
        regionId: mRegionId,
        subdistrictId: mSubdistrictId,
        neighborhoodId: mNeighborhoodId,
        geoUnitId: mDeepestGeoUnitId,
        detailedAddress: mDetailedAddress || null,
        notes: mNotes || null,
        clientCompatible: {
          firstName: mFirst || null,
          lastName: mLast || null,
          mobile: mPhone || null,
          occupation: mOccupation || null,
          governorate: mGovernorateId,
          district: mRegionId,
          neighborhood: mNeighborhoodId,
          detailedAddress: mDetailedAddress || null,
        },
      };
    }
  }
  // Walk-in validation needs an identifiable requester. Use the mediator as the
  // requester only when they shared a name+phone; otherwise the beneficiary (who
  // always has both) stands in as the requester of record.
  const mediatorIdentifiable = !!(referrerExternal && referrerExternal.name && referrerExternal.primary_phone);
  const requesterExternal = mediatorIdentifiable ? (referrerExternal as Record<string, unknown>) : externalSnapshot;

  const serviceAddress = {
    governorate: String(governorateId),
    governorateId,
    regionId,
    subdistrictId,
    neighborhoodId,
    geo_unit_id: deepestGeoUnitId,
    detailed_address: detailedAddress,
    detailedAddress,
    mapLocation,
  };

  const branchResolution = await resolveBranchForServiceGeoUnit(deepestGeoUnitId);
  const result = await createServiceRequest({
    requestType: 'water_check',
    channel: 'mobile_app',
    applicationSource: readText(body, 'applicationSource') || 'water_check_simulator',
    submittedPayload: {
      requestType: 'water_check',
      formVersion: 'water_check.mobile.v1',
      receivedAt: new Date().toISOString(),
      data: body,
    },
    requesterExternal,
    beneficiaryExternal: externalSnapshot,
    referrerExternal,
    submissionType: submissionMode === 'for_another' ? 'refer_a_candidate' : 'apply',
    submitterTier: readText(body, 'submitterTier') === 'lead' ? 'lead' : 'visitor',
    problemDescription: notes ? `طلب فحص مياه - ${notes}` : 'طلب فحص مياه',
    attachments: [],
    serviceAddress,
    priority: 'Normal',
    branchId: branchResolution.branchId,
    branchResolutionStatus: branchResolution.status,
    branchResolutionReason: branchResolution.reason,
    branchResolutionGeoUnitId: branchResolution.geoUnitId,
    actorUserId: actor.userId,
    actorRole: 'operator',
  });

  if (result.ok !== true) return sendErr(res, result);

  const responseData = { ...result.data };
  if (branchResolution.status !== 'resolved') {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE service_requests
            SET review_required_flag = TRUE,
                updated_at = NOW()
          WHERE id = $1`,
        [result.data.id],
      );
      await appendAudit(client, {
        serviceRequestId: result.data.id,
        eventType: 'review_required_flag_set',
        actorUserId: actor.userId,
        actorRole: 'operator',
        payload: {
          reason: 'branch_resolution_required',
          auto: true,
          branch_resolution_status: branchResolution.status,
          branch_resolution_reason: branchResolution.reason,
          branch_candidates: branchResolution.candidates,
        },
      });
      await client.query('COMMIT');
      responseData.reviewRequiredFlag = true;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  res.status(201).json({
    ...responseData,
    branchResolution,
  });
});

router.get('/', requirePermission('service_requests.view', 'water_check.view', 'periodic_maintenance.view', 'golden_warranty.view', 'name_nomination.view'), async (req, res) => {
  const q = req.query;
  // Cross-type isolation (request-section-contract.md §5): the list only
  // returns the types whose <family>.view the caller holds. account_creation
  // is never listed here (it has its own router + family).
  const ctx = req.authContext!;
  const typeScopeClauses: string[] = [];

  // Contract §3 stale safety net (advisory only): in_review with no audit
  // activity for more than the admin-configured threshold. 0 disables.
  const staleDays = Math.max(0, Math.floor(
    await getSystemSettingNumber('service_request_stale_after_days', 14),
  ));
  const staleCondition = staleDays > 0
    ? `(sr.status = 'in_review' AND COALESCE(
         (SELECT MAX(a.created_at) FROM service_request_audit_log a
           WHERE a.service_request_id = sr.id),
         sr.created_at
       ) < NOW() - (${staleDays} * INTERVAL '1 day'))`
    : 'FALSE';

  const filters: string[] = [];
  const params: unknown[] = [];
  let idx = 1;
  for (const type of Object.keys(PERMISSION_FAMILY_BY_TYPE)) {
    const plan = resolveListAccessScope(ctx, familyKeyFor(type, 'view'));
    if (plan.scope === 'NONE') continue;
    const typeParam = idx++;
    params.push(type);
    if (plan.scope === 'GLOBAL') {
      typeScopeClauses.push(`sr.request_type = $${typeParam}`);
      continue;
    }
    if (plan.scope === 'BRANCH') {
      const branchesParam = idx++;
      params.push(plan.allowedBranchIds);
      typeScopeClauses.push(`(sr.request_type = $${typeParam} AND sr.branch_id = ANY($${branchesParam}::int[]))`);
      continue;
    }
    const userParam = idx++;
    params.push(plan.userId);
    typeScopeClauses.push(`(sr.request_type = $${typeParam} AND sr.reviewed_by_user_id = $${userParam})`);
  }
  filters.push(typeScopeClauses.length > 0 ? `(${typeScopeClauses.join(' OR ')})` : 'FALSE');
  if (q.staleOnly === 'true') filters.push(staleCondition);

  if (q.status) {
    filters.push(`sr.status = $${idx++}`);
    params.push(String(q.status));
  }
  if (q.channel) {
    filters.push(`sr.channel = $${idx++}`);
    params.push(String(q.channel));
  }
  if (q.requestType) {
    filters.push(`sr.request_type = $${idx++}`);
    params.push(String(q.requestType));
  }
  if (q.branchResolutionStatus) {
    filters.push(`sr.branch_resolution_status = $${idx++}`);
    params.push(String(q.branchResolutionStatus));
  }
  // Unified search (contract §6): name / phone / public ref.
  if (q.search) {
    filters.push(
      `(sr.public_ref_number ILIKE $${idx}
        OR sr.requester_external->>'name' ILIKE $${idx}
        OR sr.requester_external->>'primary_phone' ILIKE $${idx}
        OR sr.beneficiary_external->>'name' ILIKE $${idx}
        OR sr.beneficiary_external->>'primary_phone' ILIKE $${idx})`,
    );
    params.push(`%${String(q.search)}%`);
    idx += 1;
  }
  if (q.duplicateOnly === 'true') filters.push(`sr.duplicate_flag = TRUE`);
  if (q.reviewRequired === 'true') filters.push(`sr.review_required_flag = TRUE`);
  if (q.escalatedOnly === 'true') filters.push(`sr.escalated_at IS NOT NULL`);
  if (q.archived === 'true') filters.push(`sr.archived_at IS NOT NULL`);
  else if (q.archived !== 'all') filters.push(`sr.archived_at IS NULL`);
  if (q.mine === 'true') {
    filters.push(`sr.reviewed_by_user_id = $${idx++}`);
    params.push(req.authContext!.userId);
  }
  if (q.beneficiaryClientId) {
    filters.push(`sr.beneficiary_client_id = $${idx++}`);
    params.push(Number(q.beneficiaryClientId));
  }

  const limit = Math.min(Number(q.limit) || 50, 1000);
  const offset = Number(q.offset) || 0;

  const { rows } = await pool.query(
    `SELECT ${SR_SELECT}, ${staleCondition} AS "staleFlag"
       FROM service_requests sr
       ${SR_DISPLAY_JOINS}
      WHERE ${filters.join(' AND ')}
      ORDER BY sr.created_at DESC
      LIMIT ${limit} OFFSET ${offset}`,
    params,
  );

  const totalRes = await pool.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM service_requests sr WHERE ${filters.join(' AND ')}`,
    params,
  );

  res.json({ items: rows, total: Number(totalRes.rows[0].n), limit, offset });
});

router.get('/:id', requireTypedPermission('view'), async (req, res) => {
  const id = Number(req.params.id);
  const [reqRes, logRes, problemsRes] = await Promise.all([
    pool.query(`SELECT ${SR_SELECT} FROM service_requests sr ${SR_DISPLAY_JOINS} WHERE sr.id = $1`, [id]),
    pool.query(
      `SELECT al.id, al.event_type AS "eventType", al.event_payload AS "eventPayload",
              al.actor_user_id AS "actorUserId", al.actor_role AS "actorRole",
              au.name AS "actorName",
              al.note, al.created_at AS "createdAt"
         FROM service_request_audit_log al
         LEFT JOIN hr_users au ON au.id = al.actor_user_id
        WHERE al.service_request_id = $1
        ORDER BY al.created_at ASC, al.id ASC`,
      [id],
    ),
    pool.query(
      `SELECT p.id, p.service_request_id AS "serviceRequestId",
              p.open_task_id AS "openTaskId",
              p.installed_device_id AS "installedDeviceId",
              p.problem_type_id AS "problemTypeId",
              sl.value AS "problemTypeLabel",
              p.details, p.status,
              p.added_during_phase AS "addedDuringPhase",
              p.creator_role_snapshot AS "creatorRoleSnapshot",
              p.created_by_user_id AS "createdByUserId",
              p.created_at AS "createdAt",
              p.resolved_at AS "resolvedAt",
              p.resolution_recorded_by_user_id AS "resolutionRecordedByUserId",
              p.repaired_by_employee_id AS "repairedByEmployeeId",
              p.resolution_visit_task_id AS "resolutionVisitTaskId",
              p.resolution_notes AS "resolutionNotes",
              p.no_resolve_reason AS "noResolveReason",
              p.edit_count AS "editCount", p.last_edited_at AS "lastEditedAt",
              p.deleted_at AS "deletedAt"
         FROM service_request_problems p
         LEFT JOIN system_lists sl ON sl.id = p.problem_type_id
        WHERE p.service_request_id = $1
        ORDER BY p.created_at ASC`,
      [id],
    ),
  ]);

  if (reqRes.rows.length === 0) return res.status(404).json({ error: 'not_found' });
  res.json({
    request: reqRes.rows[0],
    auditLog: logRes.rows,
    problems: problemsRes.rows,
  });
});

// ------------------------------------------------------------
// CLAIM / TAKE-OVER (٠.٤.أ)
// ------------------------------------------------------------

router.post('/:id/claim', requireTypedPermission('review'), blockIfEscalated, async (req, res) => {
  const actor = getActor(req);
  const result = await claimOrTakeOver({
    serviceRequestId: Number(req.params.id),
    operatorUserId: actor.userId,
    actorRole: 'operator',
  });
  if (result.ok !== true) return sendErr(res, result);
  res.json(result.data);
});

router.post('/:id/take-over', requireTypedPermission('review'), blockIfEscalated, async (req, res) => {
  const actor = getActor(req);
  const result = await claimOrTakeOver({
    serviceRequestId: Number(req.params.id),
    operatorUserId: actor.userId,
    actorRole: 'operator',
    transferReason: req.body.reason ?? null,
  });
  if (result.ok !== true) return sendErr(res, result);
  res.json(result.data);
});

// ------------------------------------------------------------
// LINK / RELINK (٠.١٢ — beneficiary/candidate)
// Inline service: validates target, updates row, writes audit.
// ------------------------------------------------------------

async function linkBeneficiary(input: {
  serviceRequestId: number;
  beneficiaryClientId?: number | null;
  beneficiaryCandidateId?: number | null;
  installedDeviceId?: number | null;
  contractId?: number | null;
  actorUserId: number;
  actorRole: ActorRole;
  isChange: boolean;
  changeReason?: string | null;
  authContext: NonNullable<Request['authContext']>;
}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<{
      beneficiary_client_id: number | null;
      beneficiary_candidate_id: number | null;
      request_type: string;
      status: string;
      submission_type: string;
      branch_id: number | null;
      reviewed_by_user_id: number | null;
      reported_device_snapshot: Record<string, unknown> | null;
    }>(
      `SELECT beneficiary_client_id, beneficiary_candidate_id, request_type, status,
              submission_type, branch_id, reviewed_by_user_id, reported_device_snapshot
         FROM service_requests WHERE id = $1 FOR UPDATE`,
      [input.serviceRequestId],
    );
    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return { ok: false as const, code: 'not_found' };
    }
    const access = canLinkServiceRequestParty(input.authContext, {
      permission: familyKeyFor(rows[0].request_type, 'review'),
      branchId: rows[0].branch_id,
      reviewedByUserId: rows[0].reviewed_by_user_id,
    });
    if (!access.allowed) {
      await client.query('ROLLBACK');
      return { ok: false as const, code: 'forbidden', details: { reason: access.reason } };
    }
    // SR-LINK-01 — linking is a review decision; it requires the request to be
    // claimed (in_review with an assigned reviewer). No linking before claim.
    if (rows[0].status !== 'in_review') {
      await client.query('ROLLBACK');
      return {
        ok: false as const,
        code: 'link_requires_claim',
        message: 'تولَّ الطلب أولاً (in_review) قبل ربطه بزبون أو مرشح.',
        details: { status: rows[0].status },
      };
    }
    if (input.isChange && rows[0].beneficiary_client_id == null && rows[0].beneficiary_candidate_id == null) {
      await client.query('ROLLBACK');
      return { ok: false as const, code: 'nothing_to_change_use_link' };
    }
    if (
      (rows[0].request_type === 'water_check'
        || rows[0].request_type === 'device_request'
        || rows[0].request_type === 'periodic_maintenance'
        || rows[0].request_type === 'golden_warranty')
      && input.beneficiaryCandidateId != null
    ) {
      await client.query('ROLLBACK');
      return {
        ok: false as const,
        code: 'candidate_link_forbidden_for_request_type',
        message: 'This request type can only be linked to clients, not candidates.',
      };
    }
    let linkedClientBranchId: number | null = null;
    if (input.beneficiaryClientId != null) {
      const exists = await client.query<{ branch_id: number | null }>(
        `SELECT branch_id FROM clients WHERE id = $1 AND deleted_at IS NULL`,
        [input.beneficiaryClientId],
      );
      if (exists.rowCount === 0) {
        await client.query('ROLLBACK');
        return { ok: false as const, code: 'client_not_found' };
      }
      linkedClientBranchId = exists.rows[0].branch_id == null ? null : Number(exists.rows[0].branch_id);
      if (
        rows[0].request_type === 'device_request'
        || ((rows[0].request_type === 'periodic_maintenance' || rows[0].request_type === 'golden_warranty')
          && input.installedDeviceId == null)
      ) {
        if (linkedClientBranchId == null) {
          await client.query('ROLLBACK');
          return { ok: false as const, code: 'beneficiary_branch_required' };
        }
        const targetAccess = authorize(input.authContext, {
          permission: familyKeyFor(rows[0].request_type, 'review'),
          branchId: linkedClientBranchId,
        });
        if (!targetAccess.allowed) {
          await client.query('ROLLBACK');
          return { ok: false as const, code: 'forbidden', details: { reason: targetAccess.reason } };
        }
      }
    }
    if (input.beneficiaryCandidateId != null) {
      const exists = await client.query(`SELECT 1 FROM candidates WHERE id = $1`, [input.beneficiaryCandidateId]);
      if (exists.rowCount === 0) {
        await client.query('ROLLBACK');
        return { ok: false as const, code: 'candidate_not_found' };
      }
    }
    let linkedDeviceBranchId: number | null = null;
    let linkedDeviceSerial: string | null = null;
    if (input.installedDeviceId != null) {
      const beneficiaryClientId = input.beneficiaryClientId ?? rows[0].beneficiary_client_id;
      if (beneficiaryClientId == null) {
        await client.query('ROLLBACK');
        return { ok: false as const, code: 'beneficiary_client_required_for_device_link' };
      }
      const device = await client.query<{
        customer_id: number | null; contract_id: number | null;
        branch_id: number | null; serial_number: string | null;
      }>(
        `SELECT customer_id, contract_id, branch_id, serial_number
           FROM installed_devices
          WHERE id = $1`,
        [input.installedDeviceId],
      );
      if (device.rowCount === 0) {
        await client.query('ROLLBACK');
        return { ok: false as const, code: 'installed_device_not_found' };
      }
      if (device.rows[0].customer_id !== beneficiaryClientId) {
        await client.query('ROLLBACK');
        return { ok: false as const, code: 'installed_device_beneficiary_mismatch' };
      }
      if (input.contractId != null && device.rows[0].contract_id !== input.contractId) {
        await client.query('ROLLBACK');
        return { ok: false as const, code: 'installed_device_contract_mismatch' };
      }
      linkedDeviceBranchId = device.rows[0].branch_id == null ? null : Number(device.rows[0].branch_id);
      linkedDeviceSerial = device.rows[0].serial_number == null ? null : String(device.rows[0].serial_number);
      if (rows[0].request_type === 'periodic_maintenance' || rows[0].request_type === 'golden_warranty') {
        const targetAccess = authorize(input.authContext, {
          permission: familyKeyFor(rows[0].request_type, 'review'),
          branchId: linkedDeviceBranchId,
        });
        if (!targetAccess.allowed) {
          await client.query('ROLLBACK');
          return { ok: false as const, code: 'forbidden', details: { reason: targetAccess.reason } };
        }
        const existing = rows[0].request_type === 'periodic_maintenance'
          ? await client.query<{ id: number; public_ref_number: string }>(
          `SELECT id, public_ref_number
             FROM service_requests
            WHERE request_type = 'periodic_maintenance'
              AND installed_device_id = $1
              AND status IN ('received', 'in_review')
              AND id <> $2
            ORDER BY created_at ASC, id ASC
            LIMIT 1`,
            [input.installedDeviceId, input.serviceRequestId],
          )
          : { rows: [] as Array<{ id: number; public_ref_number: string }> };
        if (existing.rows[0]) {
          await client.query('ROLLBACK');
          return {
            ok: false as const,
            code: 'active_periodic_request_exists',
            details: {
              requestId: Number(existing.rows[0].id),
              publicRefNumber: existing.rows[0].public_ref_number,
            },
          };
        }
      }
    }

    await client.query(
      `UPDATE service_requests
          SET beneficiary_client_id = $2,
              beneficiary_candidate_id = $3,
              requester_client_id = CASE
                WHEN submission_type = 'apply' AND $2::bigint IS NOT NULL THEN $2
                ELSE requester_client_id
              END,
              installed_device_id = COALESCE($4, installed_device_id),
              contract_id = COALESCE($5, contract_id),
               branch_id = CASE
                 WHEN request_type IN ('periodic_maintenance', 'golden_warranty') AND $4::bigint IS NOT NULL THEN $7
                 WHEN request_type = 'device_request' AND $2::bigint IS NOT NULL THEN $6
                 ELSE branch_id
               END,
               branch_resolution_status = CASE
                 WHEN request_type IN ('periodic_maintenance', 'golden_warranty') AND $4::bigint IS NOT NULL THEN 'resolved'
                 WHEN request_type = 'device_request' AND $2::bigint IS NOT NULL THEN 'resolved'
                 ELSE branch_resolution_status
               END,
               branch_resolution_reason = CASE
                 WHEN request_type IN ('periodic_maintenance', 'golden_warranty') AND $4::bigint IS NOT NULL THEN 'installed_device_branch'
                 WHEN request_type = 'device_request' AND $2::bigint IS NOT NULL THEN 'beneficiary_client_branch'
                 ELSE branch_resolution_reason
               END,
              updated_at = NOW()
        WHERE id = $1`,
      [
        input.serviceRequestId,
        input.beneficiaryClientId ?? null,
        input.beneficiaryCandidateId ?? null,
        input.installedDeviceId ?? null,
        input.contractId ?? null,
        linkedClientBranchId,
        linkedDeviceBranchId,
      ],
    );

    await appendAudit(client, {
      serviceRequestId: input.serviceRequestId,
      eventType: input.isChange ? 'linkage_changed' : 'party_linked',
      actorUserId: input.actorUserId,
      actorRole: input.actorRole,
      payload: input.isChange
        ? {
            old_target: {
              beneficiary_client_id: rows[0].beneficiary_client_id,
              beneficiary_candidate_id: rows[0].beneficiary_candidate_id,
            },
            new_target: {
              beneficiary_client_id: input.beneficiaryClientId ?? null,
              beneficiary_candidate_id: input.beneficiaryCandidateId ?? null,
            },
            reason: input.changeReason ?? null,
          }
        : {
            beneficiary_client_id: input.beneficiaryClientId ?? null,
            beneficiary_candidate_id: input.beneficiaryCandidateId ?? null,
            installed_device_id: input.installedDeviceId ?? null,
            contract_id: input.contractId ?? null,
          },
    });

    const reportedSerial = rows[0].reported_device_snapshot?.serialNumber;
    if (
      rows[0].request_type === 'periodic_maintenance'
      && typeof reportedSerial === 'string'
      && reportedSerial.trim()
      && linkedDeviceSerial
      && reportedSerial.trim().toLocaleLowerCase() !== linkedDeviceSerial.trim().toLocaleLowerCase()
    ) {
      await appendAudit(client, {
        serviceRequestId: input.serviceRequestId,
        eventType: 'internal_note_added',
        actorUserId: input.actorUserId,
        actorRole: input.actorRole,
        note: 'device_serial_mismatch',
        payload: {
          code: 'device_serial_mismatch',
          reportedSerial: reportedSerial.trim(),
          installedDeviceId: input.installedDeviceId,
        },
      });
    }

    await syncWaterCheckBeneficiaryReferrer(client, input.serviceRequestId, input.actorUserId);

    await client.query('COMMIT');
    return { ok: true as const };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

router.post('/:id/link', requireTypedPermission('review'), blockIfEscalated, async (req, res) => {
  const actor = getActor(req);
  const result = await linkBeneficiary({
    serviceRequestId: Number(req.params.id),
    beneficiaryClientId: req.body.beneficiaryClientId ?? null,
    beneficiaryCandidateId: req.body.beneficiaryCandidateId ?? null,
    installedDeviceId: req.body.installedDeviceId ?? null,
    contractId: req.body.contractId ?? null,
    actorUserId: actor.userId,
    actorRole: 'operator',
    isChange: false,
    authContext: req.authContext!,
  });
  if (result.ok !== true) return sendErr(res, result);
  res.json({ ok: true });
});

router.post('/:id/change-linkage', requireTypedPermission('review'), blockIfEscalated, async (req, res) => {
  const actor = getActor(req);
  const result = await linkBeneficiary({
    serviceRequestId: Number(req.params.id),
    beneficiaryClientId: req.body.beneficiaryClientId ?? null,
    beneficiaryCandidateId: req.body.beneficiaryCandidateId ?? null,
    installedDeviceId: req.body.installedDeviceId ?? null,
    contractId: req.body.contractId ?? null,
    actorUserId: actor.userId,
    actorRole: 'operator',
    isChange: true,
    changeReason: req.body.reason ?? null,
    authContext: req.authContext!,
  });
  if (result.ok !== true) return sendErr(res, result);
  res.json({ ok: true });
});

router.get('/:id/suggested-matches', requireTypedPermission('review'), async (req, res) => {
  // Load name + phone for the requested party and use them as the fuzzy seed.
  // party=requester/referrer searches by that party snapshot; default is beneficiary.
  const party = req.query.party === 'referrer'
    ? 'referrer'
    : req.query.party === 'requester' ? 'requester' : 'beneficiary';
  const seedSql = party === 'referrer'
    ? `SELECT referrer_external->>'name' AS name,
              referrer_external->>'primary_phone' AS phone,
              request_type, branch_id, reviewed_by_user_id
         FROM service_requests WHERE id = $1`
    : party === 'requester'
      ? `SELECT requester_external->>'name' AS name,
                requester_external->>'primary_phone' AS phone,
                request_type, branch_id, reviewed_by_user_id
           FROM service_requests WHERE id = $1`
      : `SELECT COALESCE(
                beneficiary_external->>'name',
                requester_external->>'name',
                NULLIF(CONCAT_WS(' ',
                  submitted_payload #>> '{data,firstName}',
                  submitted_payload #>> '{data,lastName}'
                ), '')
              ) AS name,
              COALESCE(
                beneficiary_external->>'primary_phone',
                requester_external->>'primary_phone',
                submitted_payload #>> '{data,phoneNumber}'
              ) AS phone,
              request_type, branch_id, reviewed_by_user_id
         FROM service_requests WHERE id = $1`;
  const { rows } = await pool.query<{
    name: string | null;
    phone: string | null;
    request_type: string;
    branch_id: number | null;
    reviewed_by_user_id: number | null;
  }>(
    seedSql,
    [Number(req.params.id)],
  );
  if (rows.length === 0) return res.status(404).json({ error: 'not_found' });
  const access = canLinkServiceRequestParty(req.authContext!, {
    permission: familyKeyFor(rows[0].request_type, 'review'),
    branchId: rows[0].branch_id,
    reviewedByUserId: rows[0].reviewed_by_user_id,
  });
  if (!access.allowed) {
    return res.status(403).json({ error: 'forbidden', details: { reason: access.reason } });
  }
  // Mediator (referrer) is always linked to a client entity; water_check
  // beneficiaries likewise link to clients only.
  const clientsOnly = party !== 'beneficiary' || rows[0].request_type === 'water_check';
  const suggestions = await suggestRecords({
    name: rows[0].name,
    phone: rows[0].phone,
    sources: clientsOnly ? 'clients' : 'all',
    limit: 10,
  });
  if (clientsOnly) {
    return res.json({ clients: suggestions.clients, candidates: [] });
  }
  res.json(suggestions);
});

// The requester is independent from both beneficiary and mediator on
// for_another submissions. A same-as-requester mediator is mirrored atomically.
router.post('/:id/link-requester', requireTypedPermission('review'), blockIfEscalated, async (req, res) => {
  const actor = getActor(req);
  const serviceRequestId = Number(req.params.id);
  const requesterClientId = Number(req.body.requesterClientId);
  if (!Number.isInteger(requesterClientId) || requesterClientId <= 0) {
    return res.status(400).json({ error: 'requester_client_id_required' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<{
      status: string;
      request_type: string;
      submission_type: string;
      branch_id: number | null;
      reviewed_by_user_id: number | null;
      referrer_external: Record<string, unknown> | null;
    }>(
      `SELECT status, request_type, submission_type, branch_id, reviewed_by_user_id, referrer_external
         FROM service_requests WHERE id = $1 FOR UPDATE`,
      [serviceRequestId],
    );
    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'not_found' });
    }
    const access = canLinkServiceRequestParty(req.authContext!, {
      permission: familyKeyFor(rows[0].request_type, 'review'),
      branchId: rows[0].branch_id,
      reviewedByUserId: rows[0].reviewed_by_user_id,
    });
    if (!access.allowed) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'forbidden', details: { reason: access.reason } });
    }
    if (![
      'water_check',
      'device_request',
      'emergency_maintenance',
      'periodic_maintenance',
      'golden_warranty',
    ].includes(rows[0].request_type)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'wrong_request_type_for_requester_link' });
    }
    if (rows[0].status !== 'in_review') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'link_requires_claim', details: { status: rows[0].status } });
    }
    const exists = await client.query<{ branch_id: number | null }>(
      `SELECT branch_id FROM clients WHERE id = $1 AND deleted_at IS NULL`,
      [requesterClientId],
    );
    if (exists.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'client_not_found' });
    }
    const requesterBranchId = exists.rows[0].branch_id == null ? null : Number(exists.rows[0].branch_id);
    if (rows[0].request_type === 'device_request' && rows[0].submission_type === 'apply') {
      if (requesterBranchId == null) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'beneficiary_branch_required' });
      }
      const targetAccess = authorize(req.authContext!, {
        permission: familyKeyFor(rows[0].request_type, 'review'),
        branchId: requesterBranchId,
      });
      if (!targetAccess.allowed) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'forbidden', details: { reason: targetAccess.reason } });
      }
    }
    const sameAsRequester = rows[0].referrer_external?.same_as_requester === true;
    await client.query(
      `UPDATE service_requests
          SET requester_client_id = $2,
              beneficiary_client_id = CASE WHEN submission_type = 'apply' THEN $2 ELSE beneficiary_client_id END,
              referrer_client_id = CASE WHEN $3::boolean THEN $2 ELSE referrer_client_id END,
              branch_id = CASE WHEN request_type = 'device_request' AND submission_type = 'apply' THEN $4 ELSE branch_id END,
              branch_resolution_status = CASE WHEN request_type = 'device_request' AND submission_type = 'apply' THEN 'resolved' ELSE branch_resolution_status END,
              branch_resolution_reason = CASE WHEN request_type = 'device_request' AND submission_type = 'apply' THEN 'beneficiary_client_branch' ELSE branch_resolution_reason END,
              updated_at = NOW()
        WHERE id = $1`,
      [serviceRequestId, requesterClientId, sameAsRequester, requesterBranchId],
    );
    await appendAudit(client, {
      serviceRequestId,
      eventType: 'party_linked',
      actorUserId: actor.userId,
      actorRole: 'operator',
      payload: {
        party_role: 'requester', requester_client_id: requesterClientId,
        beneficiary_mirrored: rows[0].submission_type === 'apply',
        referrer_mirrored: sameAsRequester,
      },
    });
    if (sameAsRequester && rows[0].request_type === 'water_check') {
      await syncWaterCheckBeneficiaryReferrer(client, serviceRequestId, actor.userId);
    }
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// SR-LINK-01 — link the mediator (referrer) to a client, same guard as beneficiary.
router.post('/:id/link-referrer', requireTypedPermission('review'), blockIfEscalated, async (req, res) => {
  const actor = getActor(req);
  const referrerClientId = Number(req.body.referrerClientId);
  if (!Number.isInteger(referrerClientId) || referrerClientId <= 0) {
    return res.status(400).json({ error: 'referrer_client_id_required' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<{
      status: string;
      request_type: string;
      branch_id: number | null;
      reviewed_by_user_id: number | null;
      requester_client_id: number | null;
      referrer_external: Record<string, unknown> | null;
    }>(
      `SELECT status, request_type, branch_id, reviewed_by_user_id,
              requester_client_id, referrer_external
         FROM service_requests WHERE id = $1 FOR UPDATE`,
      [Number(req.params.id)],
    );
    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'not_found' });
    }
    const access = canLinkServiceRequestParty(req.authContext!, {
      permission: familyKeyFor(rows[0].request_type, 'review'),
      branchId: rows[0].branch_id,
      reviewedByUserId: rows[0].reviewed_by_user_id,
    });
    if (!access.allowed) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'forbidden', details: { reason: access.reason } });
    }
    if (rows[0].status !== 'in_review') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'link_requires_claim', details: { status: rows[0].status } });
    }
    if (rows[0].request_type === 'golden_warranty') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'golden_warranty_referrer_not_supported' });
    }
    if (!rows[0].referrer_external) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'request_has_no_referrer' });
    }
    if (rows[0].referrer_external.same_as_requester === true
        && rows[0].requester_client_id != null
        && rows[0].requester_client_id !== referrerClientId) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'referrer_must_match_requester' });
    }
    const exists = await client.query(`SELECT 1 FROM clients WHERE id = $1 AND deleted_at IS NULL`, [referrerClientId]);
    if (exists.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'client_not_found' });
    }
    const sameAsRequester = rows[0].referrer_external.same_as_requester === true;
    await client.query(
      `UPDATE service_requests
          SET referrer_client_id = $2,
              requester_client_id = CASE WHEN $3::boolean THEN $2 ELSE requester_client_id END,
              updated_at = NOW()
        WHERE id = $1`,
      [Number(req.params.id), referrerClientId, sameAsRequester],
    );
    await appendAudit(client, {
      serviceRequestId: Number(req.params.id),
      eventType: 'party_linked',
      actorUserId: actor.userId,
      actorRole: 'operator',
      payload: {
        party_role: 'referrer', referrer_client_id: referrerClientId,
        requester_mirrored: sameAsRequester,
      },
    });
    await syncWaterCheckBeneficiaryReferrer(client, Number(req.params.id), actor.userId);
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// ------------------------------------------------------------
// LIFECYCLE TRANSITIONS via stateMachine
// ------------------------------------------------------------

function transitionEndpoint(
  endpointPerm: string,
  toStatus: ServiceRequestStatus,
  options: {
    actorRoleOverride?: ActorRole;
    bodyTriageOutcome?: (body: Record<string, unknown>) => string | undefined;
    bodyTriageNotes?: (body: Record<string, unknown>) => string | undefined;
  } = {},
) {
  return async (req: Request, res: Response) => {
    const actor = getActor(req);
    const result = await transitionStatus({
      serviceRequestId: Number(req.params.id),
      toStatus,
      actorUserId: actor.userId,
      actorRole: options.actorRoleOverride ?? 'operator',
      triageOutcome:
        options.bodyTriageOutcome?.(req.body) ?? (req.body.triageOutcome as string | undefined) ?? null,
      triageNotes:
        options.bodyTriageNotes?.(req.body) ?? (req.body.triageNotes as string | undefined) ?? null,
      decisionReasonId: Number(req.body.decisionReasonId) || null,
      note: req.body.note ?? null,
    });
    if (result.ok !== true) return sendErr(res, result);
    res.json(result.data);
  };
}

// «طلب معلومات من الزبون» dropped (request-section-contract.md §3):
// request-info / resume-review endpoints removed. Migration 383 returned any
// parked rows to in_review; contacting the customer is an in_review activity
// documented via internal notes, and the stale flag is the safety net.

router.post(
  '/:id/resolve-at-intake',
  requireTypedPermission('decide'),
  blockIfEscalated,
  (req, res, next) => req.serviceRequestType === 'name_nomination'
    ? res.status(400).json({ error: 'action_not_supported_for_request_type' })
    : next(),
  transitionEndpoint('<family>.decide', 'resolved_at_intake'),
);

// SR-ESC-01 — escalate to restricted mode. Sets ONLY the dedicated escalation
// marker (freezes all actions). It does NOT touch review_required_flag — the two
// are decoupled (SR-ESC-02); escalation itself opens the reject door (SR-AUTH-01).
router.post('/:id/escalate', requireTypedPermission('review'), async (req, res) => {
  const actor = getActor(req);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<{ status: string; escalated_at: string | null; archived_at: string | null }>(
      `SELECT status, escalated_at, archived_at FROM service_requests WHERE id = $1 FOR UPDATE`,
      [Number(req.params.id)],
    );
    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'not_found' });
    }
    if (rows[0].escalated_at != null) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'already_escalated' });
    }
    const terminal = ['resolved_at_intake', 'rejected', 'promoted', 'cancelled'];
    if (terminal.includes(rows[0].status)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'cannot_escalate_terminal_request', details: { status: rows[0].status } });
    }
    await client.query(
      `UPDATE service_requests
          SET escalated_at = NOW(),
              escalated_by_user_id = $2,
              escalation_reason = $3,
              updated_at = NOW()
        WHERE id = $1`,
      [Number(req.params.id), actor.userId, req.body.reason ?? null],
    );
    await appendAudit(client, {
      serviceRequestId: Number(req.params.id),
      eventType: 'escalated_to_audit_admin',
      actorUserId: actor.userId,
      actorRole: 'operator',
      payload: { reason: req.body.reason ?? null },
    });
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// SR-ESC-02 — resolve escalation (فك التصعيد). Dedicated permission, separate
// from reject (§4.1: de-escalation reopens the workflow, reject is terminal).
// Clears the restricted-mode marker so operators can resume normal actions.
router.post('/:id/resolve-escalation', requireTypedPermission('resolve_escalation'), async (req, res) => {
  const actor = getActor(req);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<{ escalated_at: string | null }>(
      `SELECT escalated_at FROM service_requests WHERE id = $1 FOR UPDATE`,
      [Number(req.params.id)],
    );
    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'not_found' });
    }
    if (rows[0].escalated_at == null) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'not_escalated' });
    }
    await client.query(
      `UPDATE service_requests
          SET escalated_at = NULL,
              escalated_by_user_id = NULL,
              escalation_reason = NULL,
              updated_at = NOW()
        WHERE id = $1`,
      [Number(req.params.id)],
    );
    await appendAudit(client, {
      serviceRequestId: Number(req.params.id),
      eventType: 'escalation_resolved',
      actorUserId: actor.userId,
      actorRole: 'audit_admin',
      payload: { reason: req.body.reason ?? null },
    });
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

router.post(
  '/:id/reject',
  requireTypedPermission('decide'),
  transitionEndpoint('<family>.decide', 'rejected', { actorRoleOverride: 'audit_admin' }),
);

router.post(
  '/:id/cancel',
  requireTypedPermission('decide'),
  blockIfEscalated,
  (req, res, next) => req.serviceRequestType === 'periodic_maintenance'
    ? res.status(400).json({ error: 'action_not_supported_for_request_type' })
    : next(),
  transitionEndpoint('<family>.decide', 'cancelled'),
);

router.post('/:id/reopen', requireTypedPermission('decide'), async (req, res) => {
  // Contract §4: reopen is a decide-family action. The decide key absorbs the
  // former reject (audit-admin) power, so its holder passes every per-terminal
  // role gate in reopenService (audit_admin ≥ operator).
  const actor = getActor(req);
  const actorRole: ActorRole = 'audit_admin';
  const result = await reopen({
    serviceRequestId: Number(req.params.id),
    actorUserId: actor.userId,
    actorRole,
    reopenReason: req.body.reason ?? '',
    note: req.body.note ?? null,
  });
  if (result.ok !== true) return sendErr(res, result);
  res.json(result.data);
});

// ------------------------------------------------------------
// PROMOTE / MERGE
// ------------------------------------------------------------

router.post('/:id/promote', requireTypedPermission('decide'), blockIfEscalated, async (req, res) => {
  const serviceRequestId = Number(req.params.id);
  const { rows: subjectRows } = await pool.query<{
    request_type: string;
    device_source: string | null;
    target_branch_id: number | null;
  }>(
    `SELECT sr.request_type, sr.device_source,
            COALESCE(c.branch_id, d.branch_id, sr.branch_id) AS target_branch_id
       FROM service_requests sr
       LEFT JOIN clients c ON c.id = sr.beneficiary_client_id
       LEFT JOIN installed_devices d ON d.id = sr.installed_device_id
      WHERE sr.id = $1`,
    [serviceRequestId],
  );
  const subject = subjectRows[0];
  if (!subject) return res.status(404).json({ error: 'not_found' });
  if (subject.request_type !== 'emergency_maintenance') {
    return res.status(400).json({ error: 'wrong_request_type_for_emergency_handoff' });
  }
  if (subject.target_branch_id == null) {
    return res.status(400).json({ error: 'target_branch_required' });
  }
  const targetAccess = authorize(req.authContext!, {
    permission: 'open_tasks.edit',
    branchId: Number(subject.target_branch_id),
  });
  if (!targetAccess.allowed) {
    return sendErr(res, {
      code: 'open_tasks_branch_forbidden',
      details: { reason: targetAccess.reason },
    });
  }
  if (subject.device_source === 'external_device') {
    const externalAccess = authorize(req.authContext!, {
      permission: 'installed_devices.create_external',
      branchId: Number(subject.target_branch_id),
    });
    if (!externalAccess.allowed) {
      return sendErr(res, {
        code: 'external_device_create_forbidden',
        details: { reason: externalAccess.reason },
      });
    }
  }

  const splitAuthorized = req.body?.splitAuthorized === true;
  const splitReason = typeof req.body?.splitReason === 'string' ? req.body.splitReason.trim() : '';
  if (splitAuthorized) {
    const splitAccess = authorize(req.authContext!, {
      permission: 'service_requests.override_active_emergency',
    });
    if (!splitAccess.allowed) {
      return sendErr(res, { code: 'active_emergency_override_forbidden' });
    }
    if (!splitReason) return res.status(400).json({ error: 'split_reason_required' });
    const { rowCount } = await pool.query(
      `SELECT 1
         FROM system_lists
        WHERE category = 'emergency_uniqueness_override_reasons'
          AND is_active = TRUE
          AND COALESCE(metadata->>'code', value) = $1`,
      [splitReason],
    );
    if (rowCount === 0) return res.status(400).json({ error: 'invalid_split_reason' });
  }

  const actor = getActor(req);
  const result = await promote({
    serviceRequestId,
    operatorUserId: actor.userId,
    splitAuthorized,
    splitReason: splitReason || null,
    splitNote: typeof req.body?.splitNote === 'string' ? req.body.splitNote.trim() || null : null,
    deviceLocationDecision: req.body?.deviceLocationDecision === 'registered_location_confirmed'
      ? 'registered_location_confirmed'
      : null,
    externalDeviceModelId: req.body.externalDeviceModelId ?? null,
  });
  if (result.ok !== true) {
    if (result.code === 'merge_or_split_required') {
      // Pass collision context so the UI can render the merge/split modal.
      return res.status(409).json({
        error: 'merge_or_split_required',
        existingOpenTaskId: (result as { existingOpenTaskId: number }).existingOpenTaskId,
        installedDeviceId: (result as { installedDeviceId: number }).installedDeviceId,
      });
    }
    return sendErr(res, result as { code: string; message?: string });
  }
  res.json(result.data);
});

router.post('/:id/handoff-water-check', requireTypedPermission('decide'), blockIfEscalated, async (req, res) => {
  const serviceRequestId = Number(req.params.id);
  if (!Number.isInteger(serviceRequestId) || serviceRequestId <= 0) {
    return res.status(400).json({ error: 'invalid_service_request_id' });
  }

  const { rows } = await pool.query<{
    request_type: string;
    branch_id: number | null;
  }>(
    `SELECT request_type, branch_id
       FROM service_requests
      WHERE id = $1
      LIMIT 1`,
    [serviceRequestId],
  );
  if (rows.length === 0) return res.status(404).json({ error: 'not_found' });
  if (rows[0].request_type !== 'water_check') {
    return sendErr(res, { code: 'wrong_request_type_for_water_check_handoff' });
  }
  if (rows[0].branch_id == null) {
    return sendErr(res, { code: 'water_check_branch_required' });
  }

  const branchAccess = authorize(req.authContext!, {
    permission: 'open_tasks.edit',
    branchId: Number(rows[0].branch_id),
  });
  if (!branchAccess.allowed) {
    return sendErr(res, {
      code: 'open_tasks_branch_forbidden',
      message: 'ليس لديك صلاحية إنشاء مهمة عرض جهاز ضمن فرع هذا الطلب.',
      details: { reason: branchAccess.reason },
    });
  }

  const actor = getActor(req);
  const allowedPriorities = new Set(['high', 'medium', 'low']);
  const priority = typeof req.body?.priority === 'string' && allowedPriorities.has(req.body.priority)
    ? req.body.priority as 'high' | 'medium' | 'low'
    : null;
  const operatorNote = typeof req.body?.operatorNote === 'string'
    ? req.body.operatorNote.trim() || null
    : null;
  const dueDate = typeof req.body?.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.body.dueDate.trim())
    ? req.body.dueDate.trim()
    : null;
  const creationReason = typeof req.body?.creationReason === 'string' && req.body.creationReason.trim()
    ? req.body.creationReason.trim()
    : null;
  const result = await handoffWaterCheckToDeviceDemo({
    serviceRequestId,
    operatorUserId: actor.userId,
    priority,
    operatorNote,
    dueDate,
    creationReason,
  });
  if (result.ok !== true) return sendErr(res, result);
  res.json(result.data);
});

router.post(
  '/:id/handoff-periodic-maintenance',
  requireTypedPermission('decide'),
  blockIfEscalated,
  async (req, res) => {
    const id = Number(req.params.id);
    const { rows } = await pool.query<{
      request_type: string; branch_id: number | null; installed_device_id: number | null;
      device_branch_id: number | null; reviewed_by_user_id: number | null;
    }>(
      `SELECT sr.request_type, sr.branch_id, sr.installed_device_id,
              d.branch_id AS device_branch_id, sr.reviewed_by_user_id
         FROM service_requests sr
         LEFT JOIN installed_devices d ON d.id = sr.installed_device_id
        WHERE sr.id = $1
        LIMIT 1`,
      [id],
    );
    const subject = rows[0];
    if (!subject || subject.request_type !== 'periodic_maintenance') {
      return res.status(400).json({ error: 'wrong_request_type_for_periodic_handoff' });
    }
    const access = authorize(req.authContext!, {
      permission: 'periodic_maintenance.decide',
      branchId: subject.device_branch_id ?? subject.branch_id,
      assignedUserId: subject.reviewed_by_user_id,
    });
    if (!access.allowed) {
      return res.status(403).json({ error: 'forbidden', details: { reason: access.reason } });
    }
    const result = await handoffPeriodicMaintenanceRequest({
      serviceRequestId: id,
      operatorUserId: getActor(req).userId,
      deviceLocationDecision: req.body?.deviceLocationDecision === 'registered_location_confirmed'
        ? 'registered_location_confirmed'
        : null,
    });
    if (result.ok !== true) return sendErr(res, result);
    return res.json(result.data);
  },
);

router.post(
  '/:id/handoff-golden-warranty',
  requireTypedPermission('decide'),
  blockIfEscalated,
  async (req, res) => {
    const id = Number(req.params.id);
    const { rows } = await pool.query<{
      request_type: string; branch_id: number | null; device_branch_id: number | null;
      reviewed_by_user_id: number | null;
    }>(
      `SELECT sr.request_type, sr.branch_id, d.branch_id AS device_branch_id,
              sr.reviewed_by_user_id
         FROM service_requests sr
         LEFT JOIN installed_devices d ON d.id = sr.installed_device_id
        WHERE sr.id = $1
        LIMIT 1`,
      [id],
    );
    const subject = rows[0];
    if (!subject || subject.request_type !== 'golden_warranty') {
      return res.status(400).json({ error: 'wrong_request_type_for_golden_warranty_handoff' });
    }
    const requestAccess = authorize(req.authContext!, {
      permission: 'golden_warranty.decide',
      branchId: subject.device_branch_id ?? subject.branch_id,
      assignedUserId: subject.reviewed_by_user_id,
    });
    if (!requestAccess.allowed) {
      return res.status(403).json({ error: 'forbidden', details: { reason: requestAccess.reason } });
    }
    if (subject.device_branch_id == null) {
      return res.status(400).json({ error: 'installed_device_branch_required' });
    }
    const targetAccess = authorize(req.authContext!, {
      permission: 'open_tasks.edit',
      branchId: subject.device_branch_id,
    });
    if (!targetAccess.allowed) {
      return res.status(403).json({ error: 'open_tasks_branch_forbidden', details: { reason: targetAccess.reason } });
    }
    const allowedPriorities = new Set(['high', 'medium', 'low']);
    const result = await handoffGoldenWarrantyRequest({
      serviceRequestId: id,
      operatorUserId: getActor(req).userId,
      priority: allowedPriorities.has(String(req.body?.priority))
        ? req.body.priority as 'high' | 'medium' | 'low' : null,
      dueDate: typeof req.body?.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.body.dueDate)
        ? req.body.dueDate : null,
      operatorNote: typeof req.body?.operatorNote === 'string' ? req.body.operatorNote.trim() || null : null,
    });
    if (result.ok !== true) return sendErr(res, result);
    return res.json(result.data);
  },
);

router.post(
  '/:id/name-nomination/refresh-branches',
  requireTypedPermission('review'),
  blockIfEscalated,
  async (req, res) => {
    if (req.serviceRequestType !== 'name_nomination') return res.status(400).json({ error: 'wrong_request_type_for_name_nomination' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const count = await refreshNameNominationBranches(Number(req.params.id), client);
      await client.query('COMMIT');
      return res.json({ refreshedItems: count });
    } catch (error: any) {
      await client.query('ROLLBACK');
      return res.status(error.status ?? 500).json({ error: error.code ?? error.message, details: error.details });
    } finally { client.release(); }
  },
);

router.post(
  '/:id/name-nomination/convert',
  requireTypedPermission('decide'),
  requirePermission('candidates.create'),
  blockIfEscalated,
  async (req, res) => {
    if (req.serviceRequestType !== 'name_nomination') return res.status(400).json({ error: 'wrong_request_type_for_name_nomination' });
    if (!hasGlobalPermission(req, 'candidates.create')) {
      return res.status(403).json({ error: 'candidates_create_global_required' });
    }
    try {
      const result = await convertNameNominationItems({
        serviceRequestId: Number(req.params.id), itemIds: Array.isArray(req.body?.itemIds) ? req.body.itemIds : [],
        actorUserId: getActor(req).userId,
      });
      return res.json(result);
    } catch (error: any) {
      return res.status(error.status ?? 500).json({ error: error.code ?? error.message, details: error.details });
    }
  },
);

router.post(
  '/:id/name-nomination/skip',
  requireTypedPermission('decide'),
  blockIfEscalated,
  async (req, res) => {
    if (req.serviceRequestType !== 'name_nomination') return res.status(400).json({ error: 'wrong_request_type_for_name_nomination' });
    try {
      const result = await skipNameNominationItems({
        serviceRequestId: Number(req.params.id), itemIds: Array.isArray(req.body?.itemIds) ? req.body.itemIds : [],
        reasonId: Number(req.body?.reasonId), actorUserId: getActor(req).userId,
      });
      return res.json(result);
    } catch (error: any) {
      return res.status(error.status ?? 500).json({ error: error.code ?? error.message, details: error.details });
    }
  },
);

router.post('/:id/merge', requireTypedPermission('decide'), blockIfEscalated, async (req, res) => {
  const actor = getActor(req);
  if (!req.body.existingOpenTaskId) {
    return res.status(400).json({ error: 'existingOpenTaskId_required' });
  }
  const { rows: targetRows } = await pool.query<{ branch_id: number }>(
    `SELECT branch_id FROM open_tasks WHERE id = $1`,
    [Number(req.body.existingOpenTaskId)],
  );
  if (!targetRows[0]) return res.status(404).json({ error: 'existing_open_task_not_found' });
  const targetAccess = authorize(req.authContext!, {
    permission: 'open_tasks.edit',
    branchId: Number(targetRows[0].branch_id),
  });
  if (!targetAccess.allowed) {
    return sendErr(res, {
      code: 'open_tasks_branch_forbidden',
      details: { reason: targetAccess.reason },
    });
  }
  const result = await mergeIntoExistingTask({
    serviceRequestId: Number(req.params.id),
    existingOpenTaskId: Number(req.body.existingOpenTaskId),
    operatorUserId: actor.userId,
    mergeNote: req.body.note ?? null,
  });
  if (result.ok !== true) return sendErr(res, result);
  res.json(result.data);
});

router.post('/:id/handoff-device-request', requireTypedPermission('decide'), blockIfEscalated, async (req, res) => {
  const serviceRequestId = Number(req.params.id);
  const employeeId = Number(req.body?.employeeId);
  const deviceModelIds = Array.isArray(req.body?.deviceModelIds)
    ? req.body.deviceModelIds.map(Number)
    : [];
  if (!Number.isInteger(employeeId) || employeeId <= 0) {
    return res.status(400).json({ error: 'employee_id_required' });
  }
  const { rows } = await pool.query<{ request_type: string; branch_id: number | null }>(
    `SELECT request_type, branch_id FROM service_requests WHERE id = $1 LIMIT 1`,
    [serviceRequestId],
  );
  if (!rows[0]) return res.status(404).json({ error: 'not_found' });
  if (rows[0].request_type !== 'device_request') {
    return res.status(400).json({ error: 'wrong_request_type_for_device_request_handoff' });
  }
  if (rows[0].branch_id == null) return res.status(400).json({ error: 'device_request_branch_required' });
  const taskAccess = authorize(req.authContext!, {
    permission: 'open_tasks.edit',
    branchId: Number(rows[0].branch_id),
  });
  if (!taskAccess.allowed) {
    return sendErr(res, { code: 'open_tasks_branch_forbidden', details: { reason: taskAccess.reason } });
  }
  const priority = ['high', 'medium', 'low'].includes(String(req.body?.priority))
    ? req.body.priority as 'high' | 'medium' | 'low'
    : null;
  const dueDate = typeof req.body?.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.body.dueDate.trim())
    ? req.body.dueDate.trim() : null;
  const result = await handoffDeviceRequestToDemo({
    serviceRequestId,
    operatorUserId: getActor(req).userId,
    employeeId,
    deviceModelIds,
    inactiveModelsConfirmed: req.body?.inactiveModelsConfirmed === true,
    priority,
    dueDate,
    operatorNote: typeof req.body?.operatorNote === 'string' ? req.body.operatorNote.trim() || null : null,
  });
  if (result.ok !== true) return sendErr(res, result);
  return res.json(result.data);
});

// ------------------------------------------------------------
// ARCHIVE
// ------------------------------------------------------------

router.post('/:id/archive', requireTypedPermission('archive'), async (req, res) => {
  const actor = getActor(req);
  const ctx = req.authContext!;
  // decide-key holders act as audit_admin (the decide key absorbed reject).
  const hasDecide = ctx.isSuperAdmin || ctx.grants.some(
    (g) => g.permission === familyKeyFor(req.serviceRequestType ?? '', 'decide'),
  );
  const actorRole: ActorRole = hasDecide ? 'audit_admin' : 'operator';
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<{ status: string; archived_at: string | null }>(
      `SELECT status, archived_at FROM service_requests WHERE id = $1 FOR UPDATE`,
      [Number(req.params.id)],
    );
    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'not_found' });
    }
    if (rows[0].archived_at != null) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'already_archived' });
    }
    const terminal = ['resolved_at_intake', 'rejected', 'promoted', 'cancelled'];
    if (!terminal.includes(rows[0].status)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'archive_requires_terminal_status' });
    }
    await client.query(
      `UPDATE service_requests SET archived_at = NOW(), archived_by_user_id = $2 WHERE id = $1`,
      [Number(req.params.id), actor.userId],
    );
    await appendAudit(client, {
      serviceRequestId: Number(req.params.id),
      eventType: 'archived',
      actorUserId: actor.userId,
      actorRole,
      payload: { reason: req.body.reason ?? null },
    });
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

router.post('/:id/unarchive', requireTypedPermission('archive'), async (req, res) => {
  const actor = getActor(req);
  const ctx = req.authContext!;
  // decide-key holders act as audit_admin (the decide key absorbed reject).
  const hasDecide = ctx.isSuperAdmin || ctx.grants.some(
    (g) => g.permission === familyKeyFor(req.serviceRequestType ?? '', 'decide'),
  );
  const actorRole: ActorRole = hasDecide ? 'audit_admin' : 'operator';
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<{ archived_at: string | null }>(
      `SELECT archived_at FROM service_requests WHERE id = $1 FOR UPDATE`,
      [Number(req.params.id)],
    );
    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'not_found' });
    }
    if (rows[0].archived_at == null) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'not_archived' });
    }
    await client.query(
      `UPDATE service_requests SET archived_at = NULL, archived_by_user_id = NULL WHERE id = $1`,
      [Number(req.params.id)],
    );
    await appendAudit(client, {
      serviceRequestId: Number(req.params.id),
      eventType: 'unarchived',
      actorUserId: actor.userId,
      actorRole,
      payload: { reason: req.body.reason ?? null },
    });
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// ------------------------------------------------------------
// INTERNAL NOTES
// ------------------------------------------------------------

router.post('/:id/notes', requireTypedPermission('review'), async (req, res) => {
  const actor = getActor(req);
  if (!req.body.note || String(req.body.note).trim().length === 0) {
    return res.status(400).json({ error: 'note_required' });
  }
  const client = await pool.connect();
  try {
    await appendAudit(client, {
      serviceRequestId: Number(req.params.id),
      eventType: 'internal_note_added',
      actorUserId: actor.userId,
      actorRole: 'operator',
      note: String(req.body.note),
    });
    res.status(201).json({ ok: true });
  } finally {
    client.release();
  }
});

// ------------------------------------------------------------
// PROBLEMS (٠.١٩) — per-phase auth left to caller; we expose actions.
// ------------------------------------------------------------

router.post('/:id/problems', requireTypedPermission('review'), blockIfEscalated, async (req, res) => {
  const actor = getActor(req);
  const result = await addProblem({
    serviceRequestId: Number(req.params.id),
    installedDeviceId: Number(req.body.installedDeviceId),
    problemTypeId: Number(req.body.problemTypeId),
    details: req.body.details ?? null,
    addedDuringPhase: (req.body.addedDuringPhase as AddedDuringPhase) ?? 'in_review',
    createdByUserId: actor.userId,
    creatorRoleSnapshot: req.body.creatorRoleSnapshot ?? 'operator',
    resolveAtIntake: !!req.body.resolveAtIntake,
    actorRole: 'operator',
  });
  if (result.ok !== true) return sendErr(res, result);
  // Phase 6c.1 — field_discovery additions during a visit need the
  // open_task_id stamped immediately so the problem appears in the
  // wizard's problems list. Optional body param keeps the route
  // backward compatible for intake-time additions.
  if (req.body.openTaskId) {
    await pool.query(
      `UPDATE service_request_problems
          SET open_task_id = $2, updated_at = NOW()
        WHERE id = $1 AND open_task_id IS NULL`,
      [result.data.id, Number(req.body.openTaskId)],
    );
  }
  res.status(201).json(result.data);
});

router.patch('/:id/problems/:pid', requireTypedPermission('review'), blockIfEscalated, async (req, res) => {
  const actor = getActor(req);
  const result = await editProblem({
    problemId: Number(req.params.pid),
    problemTypeId: req.body.problemTypeId,
    details: req.body.details,
    editorUserId: actor.userId,
    actorRole: 'operator',
  });
  if (result.ok !== true) return sendErr(res, result);
  res.json({ ok: true });
});

router.patch('/:id/problems/:pid/status', requireTypedPermission('review'), blockIfEscalated, async (req, res) => {
  const actor = getActor(req);
  const result = await changeProblemStatus({
    problemId: Number(req.params.pid),
    toStatus: req.body.toStatus as ProblemStatus,
    actorUserId: actor.userId,
    actorRole: 'operator',
    resolutionRecordedByUserId: req.body.resolutionRecordedByUserId ?? null,
    repairedByEmployeeId: req.body.repairedByEmployeeId ?? null,
    resolutionVisitTaskId: req.body.resolutionVisitTaskId ?? null,
    repairTeamSnapshot: req.body.repairTeamSnapshot ?? null,
    resolutionNotes: req.body.resolutionNotes ?? null,
    reason: req.body.reason ?? null,
    noResolveReason: req.body.noResolveReason ?? null,
  });
  if (result.ok !== true) return sendErr(res, result);
  res.json(result.data);
});

router.post(
  '/:id/problems/:pid/record-resolution',
  requireTypedPermission('review'),
  blockIfEscalated,
  async (req, res) => {
    // Shortcut: changes status to 'resolved' and fills resolution fields.
    const actor = getActor(req);
    const result = await changeProblemStatus({
      problemId: Number(req.params.pid),
      toStatus: 'resolved',
      actorUserId: actor.userId,
      actorRole: 'operator',
      resolutionRecordedByUserId: req.body.resolutionRecordedByUserId ?? actor.userId,
      repairedByEmployeeId: req.body.repairedByEmployeeId,
      resolutionVisitTaskId: req.body.resolutionVisitTaskId ?? null,
      repairTeamSnapshot: req.body.repairTeamSnapshot ?? null,
      resolutionNotes: req.body.resolutionNotes ?? null,
    });
    if (result.ok !== true) return sendErr(res, result);
    res.json(result.data);
  },
);

router.delete('/:id/problems/:pid', requireTypedPermission('review'), blockIfEscalated, async (req, res) => {
  const actor = getActor(req);
  const result = await softDeleteProblem({
    problemId: Number(req.params.pid),
    reason: String(req.body.reason ?? ''),
    actorUserId: actor.userId,
    actorRole: 'operator',
  });
  if (result.ok !== true) return sendErr(res, result);
  res.json({ ok: true });
});

router.post(
  '/:id/problems/:pid/restore',
  requireTypedPermission('decide'), // audit-admin perm gates restore
  blockIfEscalated,
  async (req, res) => {
    const actor = getActor(req);
    const result = await restoreProblem({
      problemId: Number(req.params.pid),
      reason: String(req.body.reason ?? ''),
      actorUserId: actor.userId,
    });
    if (result.ok !== true) return sendErr(res, result);
    res.json({ ok: true });
  },
);

router.post(
  '/:id/problems/:pid/override',
  requireTypedPermission('decide'), // audit-admin perm gates override
  blockIfEscalated,
  async (req, res) => {
    const actor = getActor(req);
    const result = await auditAdminOverride({
      problemId: Number(req.params.pid),
      newStatus: req.body.newStatus as ProblemStatus,
      reason: String(req.body.reason ?? ''),
      actorUserId: actor.userId,
    });
    if (result.ok !== true) return sendErr(res, result);
    res.json(result.data);
  },
);

export default router;
