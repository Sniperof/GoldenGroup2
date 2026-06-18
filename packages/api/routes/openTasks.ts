import { Router } from 'express';
import pool from '../db.js';
import { getTaskPhase, type OpenTaskStatus, type AuthContext } from '@golden-crm/shared';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission, getOrBuildAuthContext } from '../middleware/permission.js';
import { authorize, resolveListAccessScope } from '../services/authorizationService.js';
import { canViewOpenTask, canEditOpenTask, getOpenTaskListAccessPlan } from '../policies/openTaskPolicy.js';
import { bookVisit, BookingError } from '../services/visitBooking.js';
import {
  buildCustomerOwnershipSelectColumns,
  buildCustomerOwnershipSql,
  buildClientLifecycleStatusSql,
  mapCustomerOwnership,
} from '../services/customerOwnership.js';
import { claimContactTarget, ContactTargetLockError } from '../services/contactTargetLocks.js';

const router = Router();
router.use(requireAuth);

const VALID_TASK_STATUSES = [
  'open', 'needs_follow_up',
  'assigned', 'in_scheduling', 'scheduled',
  'waiting_execution', 'in_execution', 'ended',
  'completed', 'closed', 'cancelled',
] as const;

// Default planning window per task type (in days). Tasks with due_date > today + N are excluded from load.
// TODO: move to task_type_config table when implemented (G04/T04).
const PLANNING_WINDOW_DAYS: Record<string, number> = {
  device_demo: 7,
  emergency_maintenance: 0, // always urgent — no future-tasks expected
  device_delivery: 3,
  device_installation: 3,
  device_activation: 3,
  device_transfer: 3,
};
const DEFAULT_PLANNING_WINDOW = 7;

// Each operations task table is a filtered open_tasks view by task_type set,
// gated by its own `permission` (migration 288) so a role can be granted some
// tables and denied others. Editing stays on the unified open_tasks.edit.
const TASK_GROUP_CONFIG: Record<string, { taskTypes: string[]; emptyLabel: string; permission: string }> = {
  'device-demo': {
    taskTypes: ['device_demo', 'device_checkup'],
    emptyLabel: 'مهام عروض الأجهزة',
    permission: 'tasks.demo.view',
  },
  // Phase 6 follow-up — surface emergency tasks via the unified group page.
  // periodic_maintenance is included per the constitution but is cron-generated
  // (V2 scope), so it just appears here when present.
  'maintenance': {
    taskTypes: ['emergency_maintenance', 'periodic_maintenance'],
    emptyLabel: 'مهام الصيانة',
    permission: 'tasks.maintenance.view',
  },
  'collection': {
    taskTypes: ['installment_collection', 'maintenance_collection'],
    emptyLabel: 'مهام تحصيل الأقساط',
    permission: 'tasks.collection.view',
  },
  // After-sales = post-delivery service tasks. Device delivery/installation/
  // activation are their own tables below (product decision 2026-06-15).
  'after-sale-services': {
    taskTypes: ['device_repair', 'device_retrieval', 'device_return', 'device_transfer', 'device_disconnection', 'parts_sale'],
    emptyLabel: 'مهام خدمات ما بعد البيع',
    permission: 'tasks.after_sales.view',
  },
  'gift-delivery': {
    taskTypes: ['gift_delivery'],
    emptyLabel: 'مهام تسليم الهدايا',
    permission: 'tasks.gifts.view',
  },
  'warranty-services': {
    taskTypes: ['golden_warranty', 'warranty_cancellation', 'warranty_reactivation'],
    emptyLabel: 'مهام خدمات الكفالة',
    permission: 'tasks.warranty.view',
  },
  'device-delivery': {
    taskTypes: ['device_delivery'],
    emptyLabel: 'مهام تسليم الجهاز',
    permission: 'tasks.delivery.view',
  },
  'device-installation': {
    taskTypes: ['device_installation'],
    emptyLabel: 'مهام تركيب الجهاز',
    permission: 'tasks.installation.view',
  },
  'device-activation': {
    taskTypes: ['device_activation'],
    emptyLabel: 'مهام تشغيل الجهاز',
    permission: 'tasks.activation.view',
  },
};

async function hasOpenTaskColumn(columnName: string): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT EXISTS (
       SELECT 1
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'open_tasks'
          AND column_name = $1
     ) AS present`,
    [columnName],
  );
  return rows[0]?.present === true;
}

function shouldUseDeviceBranch(taskFamily: string, taskType: string): boolean {
  if (['installment_collection', 'maintenance_collection', 'dues_collection'].includes(taskType)) {
    return false;
  }
  return ['delivery', 'service', 'maintenance', 'emergency', 'warranty'].includes(taskFamily);
}

const OPEN_TASK_SELECT = `
  SELECT
    ot.*, 
    ot.client_snapshot AS "clientSnapshot",
    ot.contract_snapshot AS "contractSnapshot",
    ot.device_snapshot AS "deviceSnapshot",
    ot.team_snapshot AS "teamSnapshot",
    c.name AS "clientName",
    c.first_name AS "clientFirstName",
    c.father_name AS "clientFatherName",
    c.last_name AS "clientLastName",
    c.nickname AS "clientNickname",
    c.mobile AS "clientMobile",
    c.contacts AS "clientContacts",
    c.neighborhood AS "clientNeighborhood",
    c.governorate AS "clientGovernorate",
    c.district AS "clientDistrict",
    c.detailed_address AS "clientDetailedAddress",
    c.gps_coordinates AS "clientGps",
    c.occupation AS "clientOccupation",
    c.spouse_occupation AS "clientSpouseOccupation",
    c.water_source AS "clientWaterSource",
    c.rating AS "clientRating",
    c.referrers AS "clientReferrers",
    c.referrer_type AS "clientReferrerType",
    c.referrer_id AS "clientReferrerId",
    c.referrer_name AS "clientReferrerName",
    c.referral_notes AS "clientReferralNotes",
    c.notes AS "clientNotes",
    c.source_channel AS "clientSourceChannel",
    -- Level 2 §أ — lifecycle classification: LEAD / FOP / OP (computed live).
    ${buildClientLifecycleStatusSql('c')} AS "clientClassification",
    b.name AS "branchName",
    creator.name AS "createdByName",
    -- Active visit: a booked visit not yet resulted (story is "live"). Null otherwise.
    CASE WHEN active_visit.id IS NOT NULL THEN json_build_object(
      'id',            active_visit.id,
      'status',        active_visit.status,
      'scheduledDate', active_visit.scheduled_date,
      'scheduledTime', active_visit.scheduled_time,
      'visitTaskId',   active_visit.visit_task_id
    ) END AS "activeVisit",
    -- Last completed attempt (final_decision recorded). Null if no attempts have results yet.
    CASE WHEN last_attempt.visit_task_id IS NOT NULL THEN json_build_object(
      'visitId',       last_attempt.visit_id,
      'visitTaskId',   last_attempt.visit_task_id,
      'scheduledDate', last_attempt.scheduled_date,
      'scheduledTime', last_attempt.scheduled_time,
      'finalDecision', last_attempt.final_decision,
      'closedAt',      last_attempt.closed_at
    ) END AS "lastAttempt",
    COALESCE(attempts_agg.count, 0) AS "attemptsCount",
    COALESCE(
      (SELECT json_agg(json_build_object(
         'userId', u2.id,
         'userName', u2.name,
         'roleDisplayName', COALESCE(r2.display_name, u2.role)
       ) ORDER BY ca.assigned_at)
       FROM client_assignments ca
       JOIN hr_users u2 ON u2.id = ca.hr_user_id
       LEFT JOIN roles r2 ON r2.id = u2.role_id
       WHERE ca.client_id = c.id),
      '[]'::json
    ) AS "assignments",
    ${buildCustomerOwnershipSelectColumns()}
  FROM open_tasks ot
  JOIN clients c ON c.id = ot.client_id
  LEFT JOIN branches b ON b.id = ot.branch_id
  LEFT JOIN branches cb ON cb.id = c.branch_id
  LEFT JOIN hr_users creator ON creator.id = ot.created_by
  -- Active visit: at most one booking that hasn't been resulted yet.
  -- A booking is "scheduled" before start, "in_progress" during the field, "ended" after end
  -- but before result is saved. Once final_decision lands, the booking is no longer "active".
  LEFT JOIN LATERAL (
    SELECT
      fv.id,
      fv.status,
      fv.scheduled_date,
      fv.scheduled_time,
      vt.id AS visit_task_id
    FROM visit_tasks vt
    JOIN field_visits fv ON fv.id = vt.field_visit_id
    LEFT JOIN visit_task_results vtr ON vtr.visit_task_id = vt.id
    WHERE vt.source_open_task_id = ot.id
      AND fv.status IN ('scheduled', 'in_progress', 'ended')
      AND vtr.final_decision IS NULL
    ORDER BY fv.scheduled_date ASC, fv.scheduled_time ASC, vt.id ASC
    LIMIT 1
  ) active_visit ON true
  -- Last attempt: most recent recorded result across all attempts for this open_task.
  LEFT JOIN LATERAL (
    SELECT
      fv.id           AS visit_id,
      vt.id           AS visit_task_id,
      fv.scheduled_date,
      fv.scheduled_time,
      vtr.final_decision,
      vtr.closed_at
    FROM visit_tasks vt
    JOIN field_visits fv ON fv.id = vt.field_visit_id
    JOIN visit_task_results vtr ON vtr.visit_task_id = vt.id
    WHERE vt.source_open_task_id = ot.id
    ORDER BY vtr.closed_at DESC NULLS LAST, vt.id DESC
    LIMIT 1
  ) last_attempt ON true
  LEFT JOIN LATERAL (
    SELECT COUNT(*)::int AS count
    FROM visit_tasks vt
    WHERE vt.source_open_task_id = ot.id
  ) attempts_agg ON true
  ${buildCustomerOwnershipSql({ clientAlias: 'c', branchNameExpression: 'cb.name' })}
`;

type Queryable = {
  query: (text: string, params?: any[]) => Promise<{ rows: any[] }>;
};

function getAuthContext(req: any) {
  if (!req.authContext) {
    throw new Error('AuthContext is required');
  }
  return req.authContext as AuthContext;
}

function mapOpenTaskRow(row: any) {
  return {
    id: row.id,
    clientId: row.client_id,
    branchId: row.branch_id,
    contractId: row.contract_id ?? null,
    deviceId: row.device_id ?? null,
    installmentId: row.installment_id ?? null, // DEC-CT-07
    branchName: row.branchName ?? null,
    displayBranchName: row.branchName ?? row.clientBranchName ?? row.taskBranchName ?? null,
    displayCreatedByName: row.createdByName ?? row.createdBy?.name ?? row.createdBy?.username ?? null,
    taskType: row.task_type,
    taskFamily: row.task_family,
    reason: row.reason,
    status: row.status,
    phase: getTaskPhase(row.status as OpenTaskStatus),
    dueDate: row.due_date,
    expectedDate: row.expected_date ?? null,
    lastWaitingStatus: row.last_waiting_status ?? null,
    waitingReasonId: row.waiting_reason_id ?? null,
    waitingReasonText: row.waiting_reason_text ?? null,
    attemptCount: row.attempt_count ?? 0,
    lastAttemptAt: row.last_attempt_at ?? null,
    priority: row.priority,
    source: row.source,
    creationOrigin: row.creation_origin ?? null,
    assignedBy: row.assigned_by ?? null,
    assignedVia: row.assigned_via ?? null,
    expectedTime: row.expected_time ?? null,
    marketingVisitTaskId: row.marketing_visit_task_id,
    contactTargetId: row.contact_target_id,
    notes: row.notes,
    deliveryAddress: row.delivery_address ?? null,
    sourceContextType: row.source_context_type ?? null,
    sourceContextId: row.source_context_id ?? null,
    dispatchOriginType: row.dispatch_origin_type ?? null,
    dispatchOriginLabel: row.dispatch_origin_label ?? null,
    cancellationReason: row.cancellation_reason ?? null,
    sourceServiceRequestId: row.source_service_request_id ?? null,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    clientSnapshot: row.clientSnapshot ?? null,
    contractSnapshot: row.contractSnapshot ?? null,
    deviceSnapshot: row.deviceSnapshot ?? null,
    teamSnapshot: row.teamSnapshot ?? null,
    clientName: row.clientName ?? null,
    clientFirstName: row.clientFirstName ?? null,
    clientFatherName: row.clientFatherName ?? null,
    clientLastName: row.clientLastName ?? null,
    clientNickname: row.clientNickname ?? null,
    clientMobile: row.clientMobile ?? null,
    clientContacts: row.clientContacts ?? [],
    clientNeighborhood: row.clientNeighborhood ?? null,
    clientGovernorate: row.clientGovernorate ?? null,
    clientDistrict: row.clientDistrict ?? null,
    clientDetailedAddress: row.clientDetailedAddress ?? null,
    clientGps: row.clientGps ?? null,
    clientOccupation: row.clientOccupation ?? null,
    clientSpouseOccupation: row.clientSpouseOccupation ?? null,
    clientWaterSource: row.clientWaterSource ?? null,
    clientRating: row.clientRating ?? null,
    clientReferrers: row.clientReferrers ?? [],
    clientReferrerType: row.clientReferrerType ?? null,
    clientReferrerId: row.clientReferrerId ?? null,
    clientReferrerName: row.clientReferrerName ?? null,
    clientReferralNotes: row.clientReferralNotes ?? null,
    clientNotes: row.clientNotes ?? null,
    clientSourceChannel: row.clientSourceChannel ?? null,
    clientClassification: row.clientClassification ?? null,
    taskBranchName: row.taskBranchName ?? null,
    clientBranchName: row.clientBranchName ?? null,
    createdByName: row.createdByName ?? null,
    // New shape (post-diagnosis): activeVisit reflects a live booking only;
    // lastAttempt reflects the most recent attempt that has a result; attemptsCount
    // is the total number of visit_tasks under this open_task's story.
    activeVisit: row.activeVisit ?? null,
    lastAttempt: row.lastAttempt ?? null,
    attemptsCount: row.attemptsCount ?? 0,
    // Legacy aliases — kept so existing consumers keep working during the
    // gradual migration. Visit identifiers come from the active booking only;
    // an attempt-only past visit no longer surfaces here. latestFinalDecision
    // / latestVisitTaskId mirror lastAttempt for read-back of historical rows.
    marketingVisitId: row.activeVisit?.id ?? null,
    visitStatus: row.activeVisit?.status ?? null,
    scheduledDate: row.activeVisit?.scheduledDate ?? null,
    scheduledTime: row.activeVisit?.scheduledTime ?? null,
    latestVisitTaskId: row.lastAttempt?.visitTaskId ?? null,
    latestFinalDecision: row.lastAttempt?.finalDecision ?? null,
    assignments: row.assignments ?? [],
    ownership: mapCustomerOwnership(row),
  };
}

async function loadOpenTaskById(db: Queryable, id: number) {
  const { rows } = await db.query(`${OPEN_TASK_SELECT} WHERE ot.id = $1`, [id]);
  return rows[0] ? mapOpenTaskRow(rows[0]) : null;
}

function resolveGeoName(value: unknown, geoMap: Map<number, { name: string; level: number; parentId: number | null }>) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  if (Number.isNaN(parsed)) {
    return String(value);
  }

  return geoMap.get(parsed)?.name ?? String(value);
}

/**
 * Build a DeviceSnapshot for a specific installed device.
 * Constitution: docs/constitution/components/device-snapshot.md §3.2
 */
export async function buildDeviceSnapshot(db: Queryable, installedDeviceId: number | null | undefined) {
  if (!installedDeviceId) return null;
  const { rows } = await db.query(
    `SELECT
      d.id, d.contract_id, c.contract_number, c.customer_name,
      d.customer_id, d.branch_id, b.name AS branch_name,
      d.device_model_id, d.device_model_name, d.serial_number,
      d.status, d.delivery_date, d.installation_date, d.activated_at,
      d.installation_geo_unit_id, gu.name AS installation_geo_unit_name,
      d.installation_address_text, d.installation_lat, d.installation_lng,
      d.contract_warranty_end_date, d.golden_warranty_end_date,
      d.warranty_months, d.warranty_visits
     FROM installed_devices d
     LEFT JOIN contracts c   ON c.id  = d.contract_id
     LEFT JOIN branches  b   ON b.id  = d.branch_id
     LEFT JOIN geo_units gu  ON gu.id = d.installation_geo_unit_id
     WHERE d.id = $1`,
    [installedDeviceId],
  );
  const r = rows[0];
  if (!r) return null;

  // Resolve the full geo hierarchy (governorate → district → neighborhood)
  // via recursive CTE so we can display the full address per geo-units.md BR-4.
  let geoPath: Array<{ id: number; name: string; level: number }> = [];
  if (r.installation_geo_unit_id) {
    const { rows: pathRows } = await db.query(
      `WITH RECURSIVE chain AS (
         SELECT id, name, level, parent_id, 0 AS depth
           FROM geo_units WHERE id = $1
         UNION ALL
         SELECT g.id, g.name, g.level, g.parent_id, c.depth + 1
           FROM geo_units g JOIN chain c ON g.id = c.parent_id
       )
       SELECT id, name, level FROM chain ORDER BY depth DESC`,
      [r.installation_geo_unit_id],
    );
    geoPath = pathRows.map((p: any) => ({ id: p.id, name: p.name, level: p.level }));
  }

  return {
    id: r.id,
    contractId: r.contract_id,
    contractNumber: r.contract_number ?? null,
    customerId: r.customer_id,
    customerName: r.customer_name ?? null,
    branchId: r.branch_id ?? null,
    branchName: r.branch_name ?? null,
    identity: {
      modelId: r.device_model_id ?? null,
      modelName: r.device_model_name ?? '',
      serialNumber: r.serial_number ?? null,
    },
    lifecycle: {
      status: r.status ?? null,
      deliveryDate: r.delivery_date ?? null,
      installationDate: r.installation_date ?? null,
      activatedAt: r.activated_at ?? null,
    },
    location: {
      geoUnitId: r.installation_geo_unit_id ?? null,
      geoUnitName: r.installation_geo_unit_name ?? null,
      geoPath, // [{id,name,level}] root → leaf
      addressText: r.installation_address_text ?? null,
      lat: r.installation_lat ? Number(r.installation_lat) : null,
      lng: r.installation_lng ? Number(r.installation_lng) : null,
    },
    warranty: {
      contractWarrantyEndDate: r.contract_warranty_end_date ?? null,
      goldenWarrantyEndDate: r.golden_warranty_end_date ?? null,
      warrantyMonths: r.warranty_months ? Number(r.warranty_months) : null,
      warrantyVisits: r.warranty_visits ? Number(r.warranty_visits) : null,
    },
  };
}

export async function buildOpenTaskSnapshots(db: Queryable, clientId: number, contractId?: number | null, installedDeviceId?: number | null) {
  const { rows: clientRows } = await db.query(
    `SELECT
      c.name,
      c.mobile,
      c.contacts,
      c.detailed_address,
      c.governorate,
      c.district,
      c.neighborhood,
      c.rating,
      c.is_candidate
     FROM clients c
     WHERE c.id = $1`,
    [clientId],
  );

  const clientRow = clientRows[0];
  if (!clientRow) {
    return { clientSnapshot: null, contractSnapshot: null, deviceSnapshot: null };
  }

  const geoIds = [
    clientRow.governorate,
    clientRow.district,
    clientRow.neighborhood,
  ].filter(Boolean);

  const { rows: baseGeoRows } = geoIds.length > 0
    ? await db.query(
      `SELECT id, name, level, parent_id
       FROM geo_units
       WHERE id = ANY($1::int[])`,
      [geoIds],
    )
    : { rows: [] as any[] };

  const geoMap = new Map<number, { name: string; level: number; parentId: number | null }>(
    baseGeoRows.map((geo: any) => [geo.id, { name: geo.name, level: geo.level, parentId: geo.parent_id }]),
  );

  const missingParentIds = Array.from(
    new Set(
      baseGeoRows
        .map((geo: any) => geo.parent_id)
        .filter((parentId: number | null) => parentId && !geoMap.has(parentId)),
    ),
  );

  if (missingParentIds.length > 0) {
    const { rows: parentGeoRows } = await db.query(
      `SELECT id, name, level, parent_id
       FROM geo_units
       WHERE id = ANY($1::int[])`,
      [missingParentIds],
    );

    for (const geo of parentGeoRows) {
      geoMap.set(geo.id, { name: geo.name, level: geo.level, parentId: geo.parent_id });
    }
  }

  const neighborhoodId = typeof clientRow.neighborhood === 'number'
    ? clientRow.neighborhood
    : Number.parseInt(String(clientRow.neighborhood), 10);
  const neighborhoodUnit = Number.isNaN(neighborhoodId) ? null : geoMap.get(neighborhoodId);

  const clientSnapshot = {
    name: clientRow.name ?? '',
    mobile: clientRow.mobile ?? '',
    contacts: clientRow.contacts || [],
    address: {
      governorate: resolveGeoName(clientRow.governorate, geoMap) ?? '',
      district: resolveGeoName(clientRow.district, geoMap) ?? '',
      subArea: neighborhoodUnit?.parentId ? (geoMap.get(neighborhoodUnit.parentId)?.name ?? '') : '',
      neighborhood: resolveGeoName(clientRow.neighborhood, geoMap) ?? '',
      detailed: clientRow.detailed_address ?? '',
    },
    rating: clientRow.rating || 'Undefined',
    clientType: clientRow.is_candidate ? 'Candidate' : 'Client',
  };

  let contractSnapshot = null;
  if (contractId) {
    const { rows: contractRows } = await db.query(
      `SELECT
        c.id, c.contract_number, c.contract_date,
        c.device_model_id, c.device_model_name, c.maintenance_plan,
        c.payment_type, c.final_price, c.down_payment, c.installments_count,
        c.status,
        d.serial_number, d.warranty_months, d.warranty_visits,
        d.installation_geo_unit_id, d.installation_address_text,
        d.installation_lat, d.installation_lng,
        gu.name AS installation_geo_unit_name
       FROM contracts c
       LEFT JOIN installed_devices d ON d.contract_id = c.id
       LEFT JOIN geo_units gu ON gu.id = d.installation_geo_unit_id
       WHERE c.id = $1`,
      [contractId],
    );

    if (contractRows[0]) {
      const cr = contractRows[0];
      contractSnapshot = {
        contractId: cr.id,
        contractNumber: cr.contract_number ?? '',
        contractDate: cr.contract_date ?? '',
        device: {
          modelId: cr.device_model_id ?? null,
          modelName: cr.device_model_name ?? '',
          serialNumber: cr.serial_number ?? '',
          maintenancePlan: cr.maintenance_plan ?? '',
          warrantyMonths: cr.warranty_months ? Number(cr.warranty_months) : null,
          warrantyVisits: cr.warranty_visits ? Number(cr.warranty_visits) : null,
        },
        installationAddress: {
          geoUnitId: cr.installation_geo_unit_id ?? null,
          geoUnitName: cr.installation_geo_unit_name ?? null,
          addressText: cr.installation_address_text ?? null,
          lat: cr.installation_lat ? Number(cr.installation_lat) : null,
          lng: cr.installation_lng ? Number(cr.installation_lng) : null,
        },
        financials: {
          paymentType: cr.payment_type ?? '',
          finalPrice: Number(cr.final_price) || 0,
          downPayment: Number(cr.down_payment) || 0,
          installmentsCount: cr.installments_count || 0,
          currency: 'SYP',
        },
        status: cr.status ?? '',
      };
    }
  }

  const deviceSnapshot = await buildDeviceSnapshot(db, installedDeviceId ?? null);
  return { clientSnapshot, contractSnapshot, deviceSnapshot };
}

export async function persistOpenTaskSnapshots(db: Queryable, openTaskId: number, clientId: number, contractId?: number | null, installedDeviceId?: number | null) {
  // Auto-resolve device from the task row if not provided (so legacy callers
  // still get the snapshot written without changing their signatures).
  let resolvedDeviceId = installedDeviceId ?? null;
  if (resolvedDeviceId == null) {
    const { rows } = await db.query(
      `SELECT device_id FROM open_tasks WHERE id = $1`,
      [openTaskId],
    );
    resolvedDeviceId = rows[0]?.device_id ?? null;
  }

  // If we have a device but no contract_id, derive contract_id from the device.
  // Every installed_device has a contract_id (NOT NULL FK). Also stamp it onto
  // open_tasks so the row stays internally consistent.
  let resolvedContractId = contractId ?? null;
  if (resolvedContractId == null && resolvedDeviceId != null) {
    const { rows } = await db.query(
      `SELECT contract_id FROM installed_devices WHERE id = $1`,
      [resolvedDeviceId],
    );
    resolvedContractId = rows[0]?.contract_id ?? null;
    if (resolvedContractId != null) {
      await db.query(
        `UPDATE open_tasks SET contract_id = $1 WHERE id = $2 AND contract_id IS NULL`,
        [resolvedContractId, openTaskId],
      );
    }
  }

  const { clientSnapshot, contractSnapshot, deviceSnapshot } =
    await buildOpenTaskSnapshots(db, clientId, resolvedContractId, resolvedDeviceId);

  await db.query(
    `UPDATE open_tasks
     SET client_snapshot = $1::jsonb,
         contract_snapshot = $2::jsonb,
         device_snapshot = $4::jsonb
     WHERE id = $3`,
    [
      clientSnapshot ? JSON.stringify(clientSnapshot) : null,
      contractSnapshot ? JSON.stringify(contractSnapshot) : null,
      openTaskId,
      deviceSnapshot ? JSON.stringify(deviceSnapshot) : null,
    ],
  );
}

/**
 * @swagger
 * components:
 *   schemas:
 *     OpenTask:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *         taskType:
 *           type: string
 *         taskFamily:
 *           type: string
 *         reason:
 *           type: string
 *         status:
 *           type: string
 *         dueDate:
 *           type: string
 *         notes:
 *           type: string
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 *         clientSnapshot:
 *           type: object
 *         assignedScopeId:
 *           type: integer
 *         assignedTeamKey:
 *           type: string
 *         marketingVisitId:
 *           type: integer
 *         visitStatus:
 *           type: string
 *         scheduledDate:
 *           type: string
 *         scheduledTime:
 *           type: string
 *         devices:
 *           type: array
 *           items:
 *             type: object
 *         preOffers:
 *           type: array
 *           items:
 *             type: object
 */

/**
 * @swagger
 * /api/open-tasks:
 *   get:
 *     tags: [Open Tasks]
 *     summary: List open tasks
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: true
 *         description: Branch context ID
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *         required: false
 *         description: Filter by status
 *       - in: query
 *         name: taskType
 *         schema:
 *           type: string
 *         required: false
 *         description: Filter by task type
 *       - in: query
 *         name: branchId
 *         schema:
 *           type: integer
 *         required: false
 *         description: Filter by branch ID
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         required: false
 *         description: Search term
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *         required: false
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         required: false
 *         description: Number of items per page
 *     responses:
 *       200:
 *         description: Success
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/OpenTask'
 *       400:
 *         description: Bad Request
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal Server Error
 */
router.get('/', requirePermission('open_tasks.view'), async (req, res) => {
  try {
    const authContext = getAuthContext(req);

    const plan = getOpenTaskListAccessPlan(authContext);
    if (plan.scope === 'NONE') {
      return res.status(403).json({ error: 'ليس لديك صلاحية عرض المهام' });
    }

    const params: any[] = [];
    const conditions: string[] = [];

    // Branch predicate from grant scope (engineering standard §3-5/§3-6):
    // GLOBAL sees every branch (optionally narrowed by ?branchId); BRANCH and
    // ASSIGNED are confined to the union of the actor's effective assignments.
    const requestedBranchId = Number(req.query.branchId);
    const hasRequestedBranch = Number.isFinite(requestedBranchId) && requestedBranchId > 0;
    if (plan.scope === 'GLOBAL') {
      if (hasRequestedBranch) {
        params.push(requestedBranchId);
        conditions.push(`ot.branch_id = $${params.length}`);
      }
    } else {
      if (plan.allowedBranchIds.length === 0) {
        return res.status(403).json({ error: 'لا يوجد فرع متاح' });
      }
      if (hasRequestedBranch && !plan.allowedBranchIds.includes(requestedBranchId)) {
        return res.status(403).json({ error: 'ليس لديك صلاحية الوصول لهذا الفرع' });
      }
      params.push(hasRequestedBranch ? [requestedBranchId] : plan.allowedBranchIds);
      conditions.push(`ot.branch_id = ANY($${params.length}::int[])`);
    }

    const statusFilter = req.query.status as string | undefined;
    if (statusFilter) {
      params.push(statusFilter);
      conditions.push(`ot.status = $${params.length}`);
    }

    const taskTypeFilter = req.query.taskType as string | undefined;
    if (taskTypeFilter) {
      params.push(taskTypeFilter);
      conditions.push(`ot.task_type = $${params.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join('\n        AND ')}` : '';
    const query = `
      ${OPEN_TASK_SELECT}
      ${whereClause}
      ORDER BY ot.created_at DESC
    `;

    const { rows } = await pool.query(query, params);
    res.json(rows.map(mapOpenTaskRow));
  } catch (err: any) {
    console.error('[open-tasks] GET / error:', err);
    res.status(500).json({ error: 'فشل في تحميل المهام' });
  }
});

/**
 * @swagger
 * /api/open-tasks:
 *   post:
 *     tags: [Open Tasks]
 *     summary: Create an open task
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: true
 *         description: Branch context ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [clientId]
 *             properties:
 *               clientId:
 *                 type: integer
 *               branchId:
 *                 type: integer
 *               dueDate:
 *                 type: string
 *               expectedDate:
 *                 type: string
 *               reason:
 *                 type: string
 *               notes:
 *                 type: string
 *               priority:
 *                 type: string
 *                 enum: [high, medium, low]
 *               devices:
 *                 type: array
 *                 items:
 *                   type: object
 *               preOffers:
 *                 type: array
 *                 items:
 *                   type: object
 *               taskType:
 *                 type: string
 *               taskFamily:
 *                 type: string
 *               contractId:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Success
 *       400:
 *         description: Bad Request
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal Server Error
 */
router.post('/', requirePermission('open_tasks.edit'), async (req, res) => {
  const authContext = req.authContext!;
  const clientId = Number(req.body?.clientId);
  let branchId = Number(req.body?.branchId ?? authContext.actingBranchId);
  const dueDate = req.body?.dueDate ?? null;
  const expectedDate = req.body?.expectedDate ?? null;
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
  const notes = typeof req.body?.notes === 'string' ? req.body.notes.trim() || null : null;
  const priority = ['high', 'medium', 'low'].includes(req.body?.priority) ? req.body.priority : null;
  const devices = req.body?.devices as any[] | undefined;
  const preOffers = req.body?.preOffers as any[] | undefined;
  const taskType = typeof req.body?.taskType === 'string' ? req.body.taskType.trim() : 'device_demo';
  const taskFamily = typeof req.body?.taskFamily === 'string' ? req.body.taskFamily.trim() : 'marketing';
  const contractId = Number(req.body?.contractId) || null;
  const installedDeviceId = Number(req.body?.installedDeviceId ?? req.body?.deviceId) || null;
  const deliveryAddressInput = typeof req.body?.deliveryAddress === 'string' ? req.body.deliveryAddress.trim() : '';
  const plannedInstallationGeoUnitId = Number(req.body?.installationGeoUnitId ?? req.body?.plannedInstallationGeoUnitId) || null;
  const plannedInstallationAddressText = typeof (req.body?.installationAddressText ?? req.body?.plannedInstallationAddressText) === 'string'
    ? String(req.body?.installationAddressText ?? req.body?.plannedInstallationAddressText).trim() || null
    : null;
  const plannedInstallationLat = req.body?.installationLat ?? req.body?.plannedInstallationLat;
  const plannedInstallationLng = req.body?.installationLng ?? req.body?.plannedInstallationLng;
  const sourceContextType = typeof req.body?.sourceContextType === 'string' ? req.body.sourceContextType.trim() || null : null;
  const sourceContextId = Number(req.body?.sourceContextId) || null;
  const dispatchOriginType = typeof req.body?.dispatchOriginType === 'string' ? req.body.dispatchOriginType.trim() || null : null;
  const dispatchOriginLabel = typeof req.body?.dispatchOriginLabel === 'string' ? req.body.dispatchOriginLabel.trim() || null : null;
  const creationOriginInput = typeof req.body?.creationOrigin === 'string' ? req.body.creationOrigin.trim() : '';
  const allowedCreationOrigins = new Set([
    'branch_plan',
    'service_request_call',
    'telemarketing_inline_booking',
    'cascading_during_visit',
    'manual_creation',
    'emergency_request',
    'system_trigger',
  ]);
  const creationOrigin = allowedCreationOrigins.has(creationOriginInput) ? creationOriginInput : 'manual_creation';

  const VALID_TASK_FAMILIES = new Set(['marketing', 'service', 'maintenance', 'emergency', 'delivery', 'sales', 'collection', 'warranty']);

  if (!clientId || !Number.isInteger(clientId)) {
    return res.status(400).json({ error: 'معرف الزبون مطلوب' });
  }
  const canDeriveBranchFromDevice = Boolean((contractId || installedDeviceId) && shouldUseDeviceBranch(taskFamily, taskType));
  if ((!branchId || !Number.isInteger(branchId)) && !canDeriveBranchFromDevice) {
    return res.status(400).json({ error: 'معرف الفرع مطلوب' });
  }
  if (!VALID_TASK_FAMILIES.has(taskFamily)) {
    return res.status(400).json({ error: `عائلة المهمة "${taskFamily}" غير مدعومة — المسموح: marketing, service, maintenance, emergency, delivery, sales, collection, warranty` });
  }

  const { rows: taskTypeRows } = await pool.query(
    `SELECT
       task_type,
       allow_multiple AS "allowMultiple",
       is_active AS "isActive"
     FROM task_type_config
     WHERE task_type = $1
     LIMIT 1`,
    [taskType],
  );
  if (taskTypeRows.length === 0) {
    return res.status(400).json({ error: `نوع المهمة "${taskType}" غير مدعوم — يجب أن يكون من أنواع المهام المعتمدة في النظام` });
  }

  const taskTypeConfig = taskTypeRows[0];
  if (!taskTypeConfig.isActive) {
    return res.status(400).json({ error: `نوع المهمة "${taskType}" غير مفعل حاليا` });
  }
  if (!taskTypeConfig.allowMultiple && !['device_delivery', 'device_installation'].includes(taskType)) {
    const { rows: activeDuplicateRows } = await pool.query(
      `SELECT id, status
       FROM open_tasks
       WHERE client_id = $1
         AND task_type = $2
         AND status NOT IN ('completed', 'closed', 'cancelled')
       ORDER BY created_at DESC
       LIMIT 1`,
      [clientId, taskType],
    );
    if (activeDuplicateRows.length > 0) {
      return res.status(409).json({
        error: 'لا يمكن إنشاء مهمة ثانية من نفس النوع لهذا الزبون قبل إغلاق المهمة النشطة',
        existingTaskId: activeDuplicateRows[0].id,
        existingTaskStatus: activeDuplicateRows[0].status,
      });
    }
  }

  let deviceIdFromContract: number | null = null;
  let deviceBranchIdFromContract: number | null = null;
  let deviceAddressFromCurrentDevice: string | null = null;
  let deviceStatusFromCurrentDevice: string | null = null;
  if (installedDeviceId) {
    const { rows: devRows } = await pool.query(
      `SELECT id, branch_id AS "branchId", customer_id, contract_id,
              status, installation_address_text
         FROM installed_devices
        WHERE id = $1
        LIMIT 1`,
      [installedDeviceId],
    );
    const dev = devRows[0];
    if (!dev) {
      return res.status(400).json({ error: 'installedDeviceId ط؛ظٹط± ظ…ظˆط¬ظˆط¯' });
    }
    if (Number(dev.customer_id) !== clientId) {
      return res.status(400).json({ error: 'ط§ظ„ط¬ظ‡ط§ط² ط§ظ„ظ…ط­ط¯ط¯ ظ„ط§ ظٹط®طµ ظ‡ط°ط§ ط§ظ„ط²ط¨ظˆظ†' });
    }
    if (contractId && dev.contract_id && Number(dev.contract_id) !== contractId) {
      return res.status(400).json({ error: 'ط§ظ„ط¬ظ‡ط§ط² ط§ظ„ظ…ط­ط¯ط¯ ظ„ط§ ظٹط·ط§ط¨ظ‚ ط§ظ„ط¹ظ‚ط¯' });
    }
    deviceIdFromContract = Number(dev.id);
    deviceBranchIdFromContract = dev.branchId ?? null;
    deviceAddressFromCurrentDevice = dev.installation_address_text ?? null;
    deviceStatusFromCurrentDevice = dev.status ?? null;
  } else if (contractId) {
    const { rows: devRows } = await pool.query(
      'SELECT id, branch_id AS "branchId", status, installation_address_text FROM installed_devices WHERE contract_id = $1 LIMIT 1',
      [contractId],
    );
    deviceIdFromContract = devRows[0]?.id ?? null;
    deviceBranchIdFromContract = devRows[0]?.branchId ?? null;
    deviceAddressFromCurrentDevice = devRows[0]?.installation_address_text ?? null;
    deviceStatusFromCurrentDevice = devRows[0]?.status ?? null;
  }

  if (taskType === 'device_delivery') {
    if (!deviceIdFromContract) {
      return res.status(400).json({ error: 'device_delivery ظٹطھط·ظ„ط¨ installedDeviceId ط£ظˆ ط¹ظ‚ط¯ط§ظ‹ ظ…ط±ط¨ظˆط·ط§ظ‹ ط¨ط¬ظ‡ط§ط²' });
    }
    const { rows: activeDuplicateRows } = await pool.query(
      `SELECT id, status
         FROM open_tasks
        WHERE device_id = $1
          AND task_type = 'device_delivery'
          AND status NOT IN ('completed', 'closed', 'cancelled')
        ORDER BY created_at DESC
        LIMIT 1`,
      [deviceIdFromContract],
    );
    if (activeDuplicateRows.length > 0) {
      return res.status(409).json({
        error: 'ظ„ط§ ظٹظ…ظƒظ† ط¥ظ†ط´ط§ط، ط£ظƒط«ط± ظ…ظ† ظ…ظ‡ظ…ط© طھط³ظ„ظٹظ… ظ†ط´ط·ط© ظ„ظ†ظپط³ ط§ظ„ط¬ظ‡ط§ط²',
        existingTaskId: activeDuplicateRows[0].id,
        existingTaskStatus: activeDuplicateRows[0].status,
      });
    }
  }

  if (taskType === 'device_installation') {
    if (!deviceIdFromContract) {
      return res.status(400).json({ error: 'device_installation يتطلب installedDeviceId أو عقدا مرتبطا بجهاز' });
    }
    if (deviceStatusFromCurrentDevice !== 'delivered') {
      return res.status(400).json({ error: 'لا يمكن إنشاء مهمة تركيب إلا لجهاز حالته delivered' });
    }
    if (!dueDate) {
      return res.status(400).json({ error: 'dueDate مطلوب عند إنشاء مهمة تركيب' });
    }
    if (!plannedInstallationGeoUnitId || !plannedInstallationAddressText) {
      return res.status(400).json({ error: 'موقع التركيب المخطط يتطلب منطقة وعنوانا تفصيليا' });
    }
    const { rows: activeDuplicateRows } = await pool.query(
      `SELECT id, status
         FROM open_tasks
        WHERE device_id = $1
          AND task_type = 'device_installation'
          AND status NOT IN ('completed', 'closed', 'cancelled')
        ORDER BY created_at DESC
        LIMIT 1`,
      [deviceIdFromContract],
    );
    if (activeDuplicateRows.length > 0) {
      return res.status(409).json({
        error: 'لا يمكن إنشاء أكثر من مهمة تركيب نشطة لنفس الجهاز',
        existingTaskId: activeDuplicateRows[0].id,
        existingTaskStatus: activeDuplicateRows[0].status,
      });
    }
  }

  if (deviceBranchIdFromContract && shouldUseDeviceBranch(taskFamily, taskType)) {
    branchId = deviceBranchIdFromContract;
  }
  if (!branchId || !Number.isInteger(branchId)) {
    return res.status(400).json({ error: 'تعذر تحديد فرع تنفيذ المهمة' });
  }

  const branchAccess = authorize(authContext, { permission: 'open_tasks.edit', branchId });
  if (!branchAccess.allowed) {
    return res.status(403).json({ error: 'ليس لديك صلاحية إنشاء مهمة ضمن هذا الفرع' });
  }

  const { rows: branchStatus } = await pool.query(
    'SELECT status FROM branches WHERE id = $1',
    [branchId],
  );
  if (branchStatus[0]?.status === 'inactive') {
    return res.status(400).json({ error: 'لا يمكن إنشاء مهمة جديدة — الفرع المحدد موقوف عن العمل' });
  }

  const { rows: reasonRows } = await pool.query(
    `SELECT value
     FROM system_lists
     WHERE category = $1 AND is_active = TRUE
     ORDER BY display_order ASC, id ASC`,
    ['open_task_reasons'],
  );
  const allowedReasons = new Set(
    reasonRows.length > 0
      ? reasonRows.map((row: any) => String(row.value).trim()).filter((value: string) => value.length > 0)
      : ['new_lead', 'follow_up', 'renewal', 'service_request', 'other'],
  );
  if (taskType === 'device_delivery') {
    ['sale_delivery', 'post_maintenance_return', 'temporary_swap_delivery', 'replacement_delivery', 'manual_delivery']
      .forEach((value) => allowedReasons.add(value));
  }
  if (!reason || !allowedReasons.has(reason)) {
    return res.status(400).json({ error: 'سبب المهمة مطلوب ويجب اختياره من القوائم المعتمدة في النظام' });
  }
  if (taskType === 'device_delivery') {
    if (reason === 'sale_delivery' && !contractId) {
      return res.status(400).json({ error: 'contractId مطلوب عند سبب sale_delivery' });
    }
    if (reason === 'post_maintenance_return' && (!dispatchOriginType || !dispatchOriginLabel)) {
      return res.status(400).json({ error: 'dispatchOriginType و dispatchOriginLabel مطلوبان عند سبب post_maintenance_return' });
    }
    if (['temporary_swap_delivery', 'replacement_delivery'].includes(reason) && (!sourceContextType || !sourceContextId)) {
      return res.status(400).json({ error: 'sourceContextType و sourceContextId مطلوبان لهذا السبب' });
    }
  }

  const pgClient = await pool.connect();
  try {
    await pgClient.query('BEGIN');

    // Phase 3: resolve device_id from installed_devices when contract_id is known
    const deviceId: number | null = deviceIdFromContract;
    const deliveryAddress = taskType === 'device_delivery' || taskType === 'device_installation'
      ? (deliveryAddressInput || deviceAddressFromCurrentDevice)
      : null;
    if (taskType === 'device_delivery' && !deliveryAddress) {
      await pgClient.query('ROLLBACK');
      return res.status(400).json({ error: 'deliveryAddress ظ…ط·ظ„ظˆط¨ ط¹ظ†ط¯ ط¹ط¯ظ… طھظˆظپط± ط¹ظ†ظˆط§ظ† ط­ط§ظ„ظٹ ظ„ظ„ط¬ظ‡ط§ط²' });
    }

    if (taskType === 'device_installation') {
      await pgClient.query(
        `UPDATE installed_devices
            SET installation_geo_unit_id = $2,
                installation_address_text = $3,
                installation_lat = $4,
                installation_lng = $5,
                updated_at = NOW()
          WHERE id = $1`,
        [
          deviceIdFromContract,
          plannedInstallationGeoUnitId,
          plannedInstallationAddressText,
          plannedInstallationLat === '' || plannedInstallationLat == null ? null : Number(plannedInstallationLat),
          plannedInstallationLng === '' || plannedInstallationLng == null ? null : Number(plannedInstallationLng),
        ],
      );
    }

    // DEC-CT-07: collection tasks must target a specific installment.
    // The DB CHECK (migration 205) enforces this for new rows.
    const installmentId = Number(req.body?.installmentId) || null;
    if (['installment_collection', 'maintenance_collection'].includes(taskType) && !installmentId) {
      await pgClient.query('ROLLBACK');
      return res.status(400).json({
        error: 'installmentId مطلوب لمهام التحصيل (DEC-CT-07)',
      });
    }

    const { rows: taskRows } = await pgClient.query(
      `INSERT INTO open_tasks (
         client_id, branch_id, task_type, task_family, reason, status,
         due_date, expected_date, priority, source, notes, created_by, origin,
         contract_id, device_id, installment_id,
         delivery_address, source_context_type, source_context_id,
         dispatch_origin_type, dispatch_origin_label, creation_origin
       ) VALUES ($1, $2, $3, $4, $5, 'open',
         $6::date, $7::date, $8, 'manual', $9, $10, 'manual_entry',
         $11, $12, $13,
         $14, $15, $16, $17, $18, $19)
       RETURNING id`,
      [clientId, branchId, taskType, taskFamily, reason, dueDate, expectedDate, priority, notes,
       authContext.userId ?? null, contractId, deviceId, installmentId,
       deliveryAddress, sourceContextType, sourceContextId, dispatchOriginType, dispatchOriginLabel,
       creationOrigin],
    );
    const openTaskId = taskRows[0].id;

    if (Array.isArray(devices) && devices.length > 0) {
      for (const device of devices) {
        const deviceModelId = Number(device.deviceModelId);
        if (!Number.isInteger(deviceModelId) || deviceModelId <= 0) continue;
        const quantity = Number(device.quantity) || 1;
        const { rows: dmRows } = await pgClient.query(
          'SELECT name_ar, name FROM device_models WHERE id = $1',
          [deviceModelId],
        );
        const deviceName = dmRows[0]?.name_ar || dmRows[0]?.name || `جهاز #${deviceModelId}`;
        await pgClient.query(
          `INSERT INTO open_task_devices (task_id, device_model_id, device_name_snapshot, quantity)
           VALUES ($1, $2, $3, $4)`,
          [openTaskId, deviceModelId, deviceName, quantity > 0 ? quantity : 1],
        );
      }
    }

    if (Array.isArray(preOffers) && preOffers.length > 0) {
      for (const offer of preOffers) {
        const closedByEmployeeId = Number.isInteger(Number(offer.closedByEmployeeId)) && Number(offer.closedByEmployeeId) > 0
          ? Number(offer.closedByEmployeeId)
          : null;
        const noClosingReason = typeof offer.noClosingReason === 'string'
          ? offer.noClosingReason.trim() || null
          : null;
        if ((closedByEmployeeId == null && noClosingReason == null) || (closedByEmployeeId != null && noClosingReason != null)) {
          await pgClient.query('ROLLBACK');
          return res.status(400).json({ error: 'كل عرض يجب أن يحتوي إما على موظف تسكير أو سبب عدم التسكير فقط' });
        }
        await pgClient.query(
          `INSERT INTO open_task_pre_offers (
             open_task_id, device_model_id, offer_type, quantity, total_amount,
             first_payment_amount, installment_months, currency,
             discount_percentage, applied_device_discount_id, closed_by_employee_id, no_closing_reason,
             source_customer_pre_offer_id
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
          [
            openTaskId,
            offer.deviceModelId,
            offer.offerType,
            offer.quantity ?? 1,
            offer.totalAmount,
            offer.firstPaymentAmount ?? null,
            offer.installmentMonths ?? null,
            offer.currency,
            offer.discountPercentage ?? null,
            offer.appliedDeviceDiscountId ?? null,
            closedByEmployeeId,
            noClosingReason,
            offer.sourceCustomerPreOfferId ?? null,
          ],
        );
      }
    }

    await persistOpenTaskSnapshots(pgClient, openTaskId, clientId, contractId);
    await pgClient.query('COMMIT');
    return res.json({ id: openTaskId, success: true });
  } catch (err: any) {
    await pgClient.query('ROLLBACK');
    if (err?.code === '23505' && String(err?.constraint ?? '').includes('idx_open_tasks_unique_active')) {
      return res.status(409).json({ error: 'لا يمكن إنشاء مهمة ثانية من نفس النوع لهذا الزبون قبل إغلاق المهمة النشطة' });
    }
    return res.status(500).json({ error: err.message });
  } finally {
    pgClient.release();
  }
});

/**
 * @swagger
 * /api/open-tasks/client/{clientId}:
 *   get:
 *     tags: [Open Tasks]
 *     summary: Retrieve open tasks for a client
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: true
 *         description: Branch context ID
 *       - in: path
 *         name: clientId
 *         schema:
 *           type: integer
 *         required: true
 *         description: Client ID
 *       - in: query
 *         name: branchId
 *         schema:
 *           type: integer
 *         required: false
 *         description: Filter by branch ID
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         required: false
 *         description: Search term
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *         required: false
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         required: false
 *         description: Number of items per page
 *     responses:
 *       200:
 *         description: Success
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/OpenTask'
 *       400:
 *         description: Bad Request
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal Server Error
 */
router.get('/client/:clientId', requirePermission('clients.visits.view', 'open_tasks.view'), async (req, res) => {
  const authContext = getAuthContext(req);
  const clientId = Number(req.params.clientId);
  if (!Number.isInteger(clientId) || clientId <= 0) {
    return res.status(400).json({ error: 'clientId is invalid' });
  }

  const plan = getOpenTaskListAccessPlan(authContext);
  let whereClause = 'WHERE ot.client_id = $1';
  const params: any[] = [clientId];

  // GLOBAL (or super-admin) sees the client's tasks across all branches; any
  // narrower grant is confined to the union of the actor's effective branches.
  if (plan.scope !== 'GLOBAL') {
    if (plan.allowedBranchIds.length === 0) {
      return res.json([]);
    }
    params.push(plan.allowedBranchIds);
    whereClause += ` AND ot.branch_id = ANY($${params.length}::int[])`;
  }

  const { rows } = await pool.query(
    `SELECT
       ot.id,
       ot.contract_id AS "contractId",
       ot.device_id AS "deviceId",
       ot.task_type AS "taskType",
       ot.task_family AS "taskFamily",
       ot.reason,
       ot.status,
       ot.due_date AS "dueDate",
       ot.delivery_address AS "deliveryAddress",
       ot.notes,
       ot.created_at AS "createdAt",
       ot.updated_at AS "updatedAt",
       ot.client_snapshot AS "clientSnapshot",
       ot.assigned_scope_id AS "assignedScopeId",
       ot.assigned_team_key AS "assignedTeamKey",
       CASE WHEN active_visit.id IS NOT NULL THEN json_build_object(
         'id',            active_visit.id,
         'status',        active_visit.status,
         'scheduledDate', active_visit.scheduled_date,
         'scheduledTime', active_visit.scheduled_time,
         'visitTaskId',   active_visit.visit_task_id
       ) END AS "activeVisit",
       CASE WHEN last_attempt.visit_task_id IS NOT NULL THEN json_build_object(
         'visitId',       last_attempt.visit_id,
         'visitTaskId',   last_attempt.visit_task_id,
         'scheduledDate', last_attempt.scheduled_date,
         'scheduledTime', last_attempt.scheduled_time,
         'finalDecision', last_attempt.final_decision,
         'closedAt',      last_attempt.closed_at
       ) END AS "lastAttempt",
       COALESCE(attempts_agg.count, 0) AS "attemptsCount",
       -- Legacy aliases (degraded to active_visit only — never an unrelated past row).
       active_visit.id AS "marketingVisitId",
       active_visit.status AS "visitStatus",
       active_visit.scheduled_date AS "scheduledDate",
       active_visit.scheduled_time AS "scheduledTime",
       COALESCE(
         (SELECT json_agg(json_build_object(
           'id', otd.id,
           'deviceModelId', otd.device_model_id,
           'deviceName', otd.device_name_snapshot,
           'quantity', otd.quantity
         )) FROM open_task_devices otd WHERE otd.task_id = ot.id),
         '[]'::json
       ) AS "devices",
       COALESCE(
         (SELECT json_agg(json_build_object(
           'id', otpo.id,
           'deviceModelId', otpo.device_model_id,
           'offerType', otpo.offer_type,
           'quantity', otpo.quantity,
           'totalAmount', otpo.total_amount,
           'firstPaymentAmount', otpo.first_payment_amount,
           'installmentMonths', otpo.installment_months,
           'currency', otpo.currency,
           'discountPercentage', otpo.discount_percentage,
           'appliedDeviceDiscountId', otpo.applied_device_discount_id
         )) FROM open_task_pre_offers otpo WHERE otpo.open_task_id = ot.id),
         '[]'::json
       ) AS "preOffers"
     FROM open_tasks ot
     LEFT JOIN LATERAL (
       SELECT
         fv.id,
         fv.status,
         fv.scheduled_date,
         fv.scheduled_time,
         vt.id AS visit_task_id
       FROM visit_tasks vt
       JOIN field_visits fv ON fv.id = vt.field_visit_id
       LEFT JOIN visit_task_results vtr ON vtr.visit_task_id = vt.id
       WHERE vt.source_open_task_id = ot.id
         AND fv.status IN ('scheduled', 'in_progress', 'ended')
         AND vtr.final_decision IS NULL
       ORDER BY fv.scheduled_date ASC, fv.scheduled_time ASC, vt.id ASC
       LIMIT 1
     ) active_visit ON true
     LEFT JOIN LATERAL (
       SELECT
         fv.id           AS visit_id,
         vt.id           AS visit_task_id,
         fv.scheduled_date,
         fv.scheduled_time,
         vtr.final_decision,
         vtr.closed_at
       FROM visit_tasks vt
       JOIN field_visits fv ON fv.id = vt.field_visit_id
       JOIN visit_task_results vtr ON vtr.visit_task_id = vt.id
       WHERE vt.source_open_task_id = ot.id
       ORDER BY vtr.closed_at DESC NULLS LAST, vt.id DESC
       LIMIT 1
     ) last_attempt ON true
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::int AS count
       FROM visit_tasks vt
       WHERE vt.source_open_task_id = ot.id
     ) attempts_agg ON true
     ${whereClause}
     ORDER BY ot.created_at DESC`,
    params,
  );

  return res.json(rows);
});

/**
 * @swagger
 * /api/open-tasks/device-demo:
 *   get:
 *     tags: [Open Tasks]
 *     summary: Get device demo open tasks workspace
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: true
 *         description: Branch context ID
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *         required: false
 *       - in: query
 *         name: visitStatus
 *         schema:
 *           type: string
 *         required: false
 *       - in: query
 *         name: scheduledDate
 *         schema:
 *           type: string
 *         required: false
 *       - in: query
 *         name: scheduled
 *         schema:
 *           type: string
 *           enum: [yes, no]
 *         required: false
 *       - in: query
 *         name: hideSnoozed
 *         schema:
 *           type: string
 *         required: false
 *       - in: query
 *         name: hideFutureTasks
 *         schema:
 *           type: string
 *         required: false
 *       - in: query
 *         name: branchId
 *         schema:
 *           type: integer
 *         required: false
 *         description: Filter by branch ID
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         required: false
 *         description: Search term
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *         required: false
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         required: false
 *         description: Number of items per page
 *     responses:
 *       200:
 *         description: Success
 *       400:
 *         description: Bad Request
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal Server Error
 */
async function listTaskGroupRows(req: any, res: any, taskTypes: string[], emptyLabel: string, permission: string) {
  try {
    const authContext = getAuthContext(req);
    const hasDeliveryAddressColumn = await hasOpenTaskColumn('delivery_address');

    // Branch scope comes from THIS table's grant, not the umbrella open_tasks.view,
    // so a role can hold tasks.demo.view=GLOBAL but tasks.maintenance.view=BRANCH.
    const plan = resolveListAccessScope(authContext, permission);
    if (plan.scope === 'NONE') {
      return res.status(403).json({ error: 'ليس لديك صلاحية عرض هذا الجدول' });
    }
    const requestedBranchId = Number(req.query.branchId);
    const hasRequestedBranch = Number.isFinite(requestedBranchId) && requestedBranchId > 0;
    if (plan.scope !== 'GLOBAL' && plan.allowedBranchIds.length === 0) {
      return res.status(403).json({ error: 'لا يوجد فرع متاح' });
    }
    if (plan.scope !== 'GLOBAL' && hasRequestedBranch && !plan.allowedBranchIds.includes(requestedBranchId)) {
      return res.status(403).json({ error: 'ليس لديك صلاحية الوصول لهذا الفرع' });
    }

    const statusFilter = req.query.status as string | undefined;
    const visitStatusFilter = req.query.visitStatus as string | undefined;
    const scheduledDateFilter = req.query.scheduledDate as string | undefined;
    const scheduledFilter = req.query.scheduled as string | undefined; // 'yes' | 'no'
    // 'true' = hide tasks whose expected_date is in the future (snoozed by telemarketer)
    const hideSnoozed = req.query.hideSnoozed === 'true';
    // 'true' = exclude "لاحقة" tasks (due_date > today + N) from workload — D13
    const hideFutureTasks = req.query.hideFutureTasks === 'true';

    const params: any[] = [];
    let branchClause = '';
    if (plan.scope === 'GLOBAL') {
      if (hasRequestedBranch) {
        params.push(requestedBranchId);
        branchClause = `AND ot.branch_id = $${params.length}`;
      }
    } else {
      params.push(hasRequestedBranch ? [requestedBranchId] : plan.allowedBranchIds);
      branchClause = `AND ot.branch_id = ANY($${params.length}::int[])`;
    }
    let paramIdx = params.length + 1;
    const conditions: string[] = [];

    if (statusFilter) {
      conditions.push(`ot.status = $${paramIdx}`);
      params.push(statusFilter);
      paramIdx++;
    }

    // Visit-related filters reference the active booking only — never a past attempt.
    // A task whose only visits are completed/cancelled counts as "not scheduled".
    if (visitStatusFilter) {
      conditions.push(`active_visit_fv.status = $${paramIdx}`);
      params.push(visitStatusFilter);
      paramIdx++;
    }

    if (scheduledDateFilter) {
      conditions.push(`active_visit_fv.scheduled_date = $${paramIdx}`);
      params.push(scheduledDateFilter);
      paramIdx++;
    }

    if (scheduledFilter === 'yes') {
      conditions.push(`active_visit_fv.id IS NOT NULL`);
    } else if (scheduledFilter === 'no') {
      conditions.push(`active_visit_fv.id IS NULL`);
    }

    // Hide snoozed: only relevant for waiting tasks (open/needs_follow_up) with a future expected_date
    if (hideSnoozed) {
      conditions.push(`(ot.expected_date IS NULL OR ot.expected_date <= CURRENT_DATE OR ot.status NOT IN ('open', 'needs_follow_up'))`);
    }

    // Exclude "لاحقة" — tasks whose due_date is beyond the planning window (D13)
    if (hideFutureTasks) {
      const windowDays = Math.max(...taskTypes.map((taskType) => PLANNING_WINDOW_DAYS[taskType] ?? DEFAULT_PLANNING_WINDOW));
      conditions.push(`(ot.due_date IS NULL OR ot.due_date <= CURRENT_DATE + INTERVAL '${windowDays} days' OR ot.status NOT IN ('open', 'needs_follow_up'))`);
    }

    const whereExtra = conditions.length > 0 ? `AND ${conditions.join(' AND ')}` : '';
    params.push(taskTypes);
    const taskTypesParamIdx = paramIdx;

    const query = `
      SELECT
        ot.id,
        ot.status AS "taskStatus",
        ot.task_type AS "taskType",
        ${hasDeliveryAddressColumn
          ? 'ot.delivery_address'
          : 'idev.installation_address_text'} AS "deliveryAddress",
        ot.device_id AS "deviceId",
        idev.installation_address_text AS "currentDeviceAddress",
        idev.installation_geo_unit_id AS "currentDeviceGeoUnitId",
        ot.reason,
        ot.task_family AS "taskFamily",
        ot.created_at AS "createdAt",
        ot.updated_at AS "updatedAt",
        ot.client_id AS "clientId",
        ot.due_date AS "dueDate",
        ot.expected_date AS "expectedDate",
        ot.priority AS "priority",
        ot.waiting_reason_id AS "waitingReasonId",
        ot.waiting_reason_text AS "waitingReasonText",
        ot.attempt_count AS "attemptCount",
        ot.last_attempt_at AS "lastAttemptAt",
        ot.last_waiting_status AS "lastWaitingStatus",
        ot.team_snapshot AS "teamSnapshot",
        ot.client_snapshot AS "clientSnapshot",
        c.name AS "clientName",
        c.first_name AS "clientFirstName",
        c.father_name AS "clientFatherName",
        c.last_name AS "clientLastName",
        c.mobile AS "clientMobile",
        c.neighborhood AS "clientNeighborhood",
        -- Lifecycle classification: LEAD (candidate or no activity) / FOP (has visits, no contract) / OP (has a contract).
        ${buildClientLifecycleStatusSql('c')} AS "clientClassification",
        c.governorate AS "clientGovernorate",
        c.district AS "clientDistrict",
        c.detailed_address AS "clientDetailedAddress",
        b.name AS "taskBranchName",
        cb.name AS "clientBranchName",
        b.name AS "branchName",
        COALESCE(creator.name, creator.username, '') AS "createdByName",
        ${buildCustomerOwnershipSelectColumns()},
        -- Active visit fields (legacy aliases — sourced from the live booking only).
        active_visit_fv.id AS "marketingVisitId",
        active_visit_fv.status AS "visitStatus",
        active_visit_fv.scheduled_date AS "scheduledDate",
        active_visit_fv.scheduled_time AS "scheduledTime",
        (active_visit_fv.customer_snapshot->>'requestedDeviceName') AS "requestedDeviceName",
        (active_visit_fv.customer_snapshot->>'requestedDeviceModelId')::integer AS "requestedDeviceModelId",
        active_visit_fv.team_snapshot AS "visitTeamSnapshot",
        (active_visit_fv.customer_snapshot->>'name') AS "customerName",
        (active_visit_fv.customer_snapshot->>'mobile') AS "customerMobile",
        (active_visit_fv.customer_snapshot->>'address') AS "customerAddress",
        active_visit_fv.id IS NOT NULL AS "hasActiveVisit",
        -- Phase 6/7 marker: NULL = legacy, non-NULL = new service_requests path
        ot.source_service_request_id AS "sourceServiceRequestId",
        -- Last completed attempt (read-back only).
        last_attempt.final_decision AS "latestFinalDecision",
        last_attempt.scheduled_date AS "lastAttemptDate",
        last_attempt.scheduled_time AS "lastAttemptTime",
        last_attempt.closed_at      AS "lastAttemptClosedAt",
        COALESCE(attempts_agg.count, 0) AS "attemptsCount"
      FROM open_tasks ot
      JOIN clients c ON c.id = ot.client_id
      LEFT JOIN branches b ON b.id = ot.branch_id
      LEFT JOIN branches cb ON cb.id = c.branch_id
      LEFT JOIN hr_users creator ON creator.id = ot.created_by
      ${buildCustomerOwnershipSql({ clientAlias: 'c', branchNameExpression: 'cb.name' })}
      LEFT JOIN installed_devices idev ON idev.id = ot.device_id
      LEFT JOIN LATERAL (
        SELECT fv.id, fv.status, fv.scheduled_date, fv.scheduled_time,
               fv.customer_snapshot, fv.team_snapshot
        FROM visit_tasks vt
        JOIN field_visits fv ON fv.id = vt.field_visit_id
        LEFT JOIN visit_task_results vtr ON vtr.visit_task_id = vt.id
        WHERE vt.source_open_task_id = ot.id
          AND fv.status IN ('scheduled', 'in_progress', 'ended')
          AND vtr.final_decision IS NULL
        ORDER BY fv.scheduled_date ASC, fv.scheduled_time ASC, vt.id ASC
        LIMIT 1
      ) active_visit_fv ON true
      LEFT JOIN LATERAL (
        SELECT vtr.final_decision, fv.scheduled_date, fv.scheduled_time, vtr.closed_at
        FROM visit_tasks vt
        JOIN field_visits fv ON fv.id = vt.field_visit_id
        JOIN visit_task_results vtr ON vtr.visit_task_id = vt.id
        WHERE vt.source_open_task_id = ot.id
        ORDER BY vtr.closed_at DESC NULLS LAST, vt.id DESC
        LIMIT 1
      ) last_attempt ON true
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS count
        FROM visit_tasks vt
        WHERE vt.source_open_task_id = ot.id
      ) attempts_agg ON true
      WHERE TRUE
        ${branchClause}
        AND ot.task_type = ANY($${taskTypesParamIdx}::text[])
        ${whereExtra}
      ORDER BY ot.created_at DESC
    `;

    const { rows } = await pool.query(query, params);
    res.json(rows.map((row: any) => ({
      ...row,
      phase: getTaskPhase(row.taskStatus as OpenTaskStatus),
      ownership: mapCustomerOwnership(row),
    })));
  } catch (err: any) {
    console.error('[open-tasks] GET /task-group error:', err);
    res.status(500).json({
      error: `فشل في تحميل ${emptyLabel}`,
      ...(process.env.NODE_ENV !== 'production' ? { detail: err?.message } : {}),
    });
  }
}

router.get('/device-demo', requirePermission('tasks.demo.view'), async (req, res) => {
  const config = TASK_GROUP_CONFIG['device-demo'];
  await listTaskGroupRows(req, res, config.taskTypes, config.emptyLabel, config.permission);
});

// Per-table gate is resolved from the dynamic groupKey, so capability is checked
// inside (after building AuthContext) rather than by a fixed requirePermission.
router.get('/group/:groupKey', async (req, res) => {
  await getOrBuildAuthContext(req as any);
  const groupKey = String(req.params.groupKey ?? '');
  const config = TASK_GROUP_CONFIG[groupKey];
  if (!config) {
    return res.status(404).json({ error: 'مجموعة المهام غير معروفة' });
  }
  await listTaskGroupRows(req, res, config.taskTypes, config.emptyLabel, config.permission);
});

/**
 * @swagger
 * /api/open-tasks/{id}/assign-team:
 *   post:
 *     tags: [Open Tasks]
 *     summary: Assign team to task and schedule
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: true
 *         description: Branch context ID
 *       - in: path
 *         name: id
 *         schema:
 *           type: integer
 *         required: true
 *         description: Task ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               supervisorId:
 *                 type: integer
 *               technicianId:
 *                 type: integer
 *               traineeId:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Success
 *       400:
 *         description: Bad Request
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Not Found
 *       500:
 *         description: Internal Server Error
 */
router.post('/:id/assign-team', requirePermission('open_tasks.edit'), async (req, res) => {
  try {
    const authContext = getAuthContext(req);
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: 'معرف المهمة غير صالح' });
    }

    const { rows: existing } = await pool.query('SELECT branch_id, status FROM open_tasks WHERE id = $1', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ error: 'المهمة غير موجودة' });
    }
    if (!canEditOpenTask(authContext, existing[0].branch_id).allowed) {
      return res.status(403).json({ error: 'ليس لديك صلاحية الوصول لهذه المهمة' });
    }
    const oldStatus = existing[0].status;

    const employeeIds = [req.body.supervisorId, req.body.technicianId, req.body.traineeId]
      .filter((value): value is number => Number.isFinite(Number(value)))
      .map(Number);

    const { rows: employeeRows } = employeeIds.length > 0
      ? await pool.query(
        'SELECT id, name FROM employees WHERE id = ANY($1::int[])',
        [employeeIds],
      )
      : { rows: [] as any[] };

    const employeeMap = new Map<number, string>(employeeRows.map((employee: any) => [employee.id, employee.name]));

    const teamSnapshot = {
      supervisor: req.body.supervisorId
        ? { id: Number(req.body.supervisorId), name: employeeMap.get(Number(req.body.supervisorId)) || '' }
        : undefined,
      technician: req.body.technicianId
        ? { id: Number(req.body.technicianId), name: employeeMap.get(Number(req.body.technicianId)) || '' }
        : undefined,
      trainee: req.body.traineeId
        ? { id: Number(req.body.traineeId), name: employeeMap.get(Number(req.body.traineeId)) || '' }
        : undefined,
      assignedAt: new Date().toISOString(),
    };

    await pool.query(
      `UPDATE open_tasks
       SET team_snapshot = $1::jsonb,
           status = 'scheduled',
           updated_at = NOW()
       WHERE id = $2`,
      [JSON.stringify(teamSnapshot), id],
    );

    // Log status change to activity log
    if (oldStatus !== 'scheduled') {
      const userRole = (req as any).user?.role ?? null;
      await pool.query(
        `INSERT INTO task_activity_log (task_id, event_type, performed_by, role, old_value, new_value)
         VALUES ($1, 'status_change', $2, $3, $4, 'scheduled')`,
        [id, authContext.userId, userRole, oldStatus],
      );
    }

    // Log team assignment
    const userRole = (req as any).user?.role ?? null;
    await pool.query(
      `INSERT INTO task_activity_log (task_id, event_type, performed_by, role, new_value)
       VALUES ($1, 'team_assigned', $2, $3, $4)`,
      [id, authContext.userId, userRole, JSON.stringify(teamSnapshot)],
    );

    const task = await loadOpenTaskById(pool, id);
    res.json(task);
  } catch (err: any) {
    console.error('[open-tasks] POST /:id/assign-team error:', err);
    res.status(500).json({ error: 'فشل في تعيين الفريق' });
  }
});

/**
 * @swagger
 * /api/open-tasks/{id}:
 *   get:
 *     tags: [Open Tasks]
 *     summary: Retrieve details of a single open task
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: true
 *         description: Branch context ID
 *       - in: path
 *         name: id
 *         schema:
 *           type: integer
 *         required: true
 *         description: Task ID
 *     responses:
 *       200:
 *         description: Success
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/OpenTask'
 *       400:
 *         description: Bad Request
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Not Found
 *       500:
 *         description: Internal Server Error
 */

// ============================================================================
// GET /open-tasks/attempt-alerts — DEC-006 D37
// ============================================================================
// MUST be declared BEFORE /:id so Express does not match "attempt-alerts"
// as a numeric id parameter (which previously caused HTTP 400).
//
// Returns open tasks whose attempt_count has crossed the configurable threshold
// stored in system_settings.attempt_alert_threshold (default 5). The alert is
// informational only — DEC-006 D37 explicitly says NO forced close.
router.get('/attempt-alerts', requirePermission('tasks.supervisor_alerts.view'), async (req, res) => {
  try {
    const authContext = getAuthContext(req);
    const { getSystemSettingNumber } = await import('../services/systemSettings.js');
    const threshold = await getSystemSettingNumber('attempt_alert_threshold', 5);

    const plan = resolveListAccessScope(authContext, 'tasks.supervisor_alerts.view');
    if (plan.scope === 'NONE') {
      return res.status(403).json({ error: 'ليس لديك صلاحية عرض المهام' });
    }
    const params: any[] = [threshold];
    let branchClause = '';
    if (plan.scope !== 'GLOBAL') {
      if (plan.allowedBranchIds.length === 0) {
        return res.json([]);
      }
      params.push(plan.allowedBranchIds);
      branchClause = `AND ot.branch_id = ANY($${params.length}::int[])`;
    }

    const { rows } = await pool.query(
      `SELECT ot.id                  AS "openTaskId",
              ot.client_id           AS "clientId",
              c.name                 AS "clientName",
              c.mobile               AS "clientMobile",
              ot.task_type           AS "taskType",
              ot.task_family         AS "taskFamily",
              ot.status,
              ot.attempt_count       AS "attemptCount",
              ot.last_attempt_at     AS "lastAttemptAt",
              ot.creation_origin     AS "creationOrigin",
              ot.assigned_team_key   AS "assignedTeamKey",
              ot.assigned_for_date   AS "assignedForDate"
         FROM open_tasks ot
         JOIN clients c ON c.id = ot.client_id
        WHERE ot.attempt_count >= $1
          AND ot.status NOT IN ('completed', 'closed', 'cancelled')
          ${branchClause}
        ORDER BY ot.attempt_count DESC, ot.last_attempt_at DESC NULLS LAST
        LIMIT 200`,
      params,
    );
    return res.json({
      threshold,
      count: rows.length,
      items: rows,
    });
  } catch (err: any) {
    console.error('[open-tasks] attempt-alerts failed', err);
    return res.status(500).json({ error: 'فشل تحميل تنبيهات المحاولات' });
  }
});

router.get('/:id', requirePermission('open_tasks.view'), async (req, res) => {
  try {
    const authContext = getAuthContext(req);
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: 'معرف المهمة غير صالح' });
    }

    const { rows } = await pool.query(`${OPEN_TASK_SELECT} WHERE ot.id = $1`, [id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'المهمة غير موجودة' });
    }

    const row = rows[0];
    if (!canViewOpenTask(authContext, row.branch_id).allowed) {
      return res.status(403).json({ error: 'ليس لديك صلاحية الوصول لهذه المهمة' });
    }

    const taskData = mapOpenTaskRow(row);
    const ts = taskData.teamSnapshot;
    if (ts && typeof ts === 'object' && (ts.supervisorEmployeeId !== undefined || ts.technicianEmployeeId !== undefined)) {
      const idList = [ts.supervisorEmployeeId, ts.technicianEmployeeId, ts.traineeEmployeeId]
        .filter((eid: any): eid is number => eid != null && Number.isFinite(Number(eid)))
        .map(Number);
      const { rows: empRows } = idList.length > 0
        ? await pool.query('SELECT id, name FROM employees WHERE id = ANY($1::int[])', [idList])
        : { rows: [] as any[] };
      const empMap = new Map<number, string>(empRows.map((e: any) => [e.id, e.name]));
      taskData.teamSnapshot = {
        supervisor: ts.supervisorEmployeeId != null ? { id: Number(ts.supervisorEmployeeId), name: empMap.get(Number(ts.supervisorEmployeeId)) ?? '' } : null,
        technician: ts.technicianEmployeeId != null ? { id: Number(ts.technicianEmployeeId), name: empMap.get(Number(ts.technicianEmployeeId)) ?? '' } : null,
        trainee: ts.traineeEmployeeId != null ? { id: Number(ts.traineeEmployeeId), name: empMap.get(Number(ts.traineeEmployeeId)) ?? '' } : null,
        assignedAt: ts.assignedAt ?? null,
      };
    }

    // Load last-attempt detail (device-demo-specific result fields) into
    // taskData.lastAttemptDetail. The base lastAttempt object from the
    // OPEN_TASK_SELECT LATERAL already carries final_decision / closed_at /
    // scheduled dates — this query enriches it with the device-demo side
    // table (offer_type, contract_id, closing employee name, etc.).
    async function loadLastAttemptDetail(openTaskId: number) {
      const { rows } = await pool.query(
        `SELECT
          vt.id              AS "visitTaskId",
          vt.status          AS "visitTaskStatus",
          fv.id              AS "visitId",
          fv.scheduled_date  AS "scheduledDate",
          fv.scheduled_time  AS "scheduledTime",
          vtr.id             AS "visitTaskResultId",
          vtr.final_decision AS "finalDecision",
          vtr.reason_code    AS "reasonCode",
          vtr.closing_notes  AS "closingNotes",
          vtr.closed_at      AS "closedAt",
          vtdr.offer_type           AS "offerType",
          vtdr.offer_amount         AS "cashOfferAmount",
          vtdr.installment_months   AS "installmentMonths",
          vtdr.closed_by_employee_id AS "closedByEmployeeId",
          closer.name               AS "closedByEmployeeName",
          vtdr.contract_id          AS "contractId"
        FROM visit_tasks vt
        JOIN field_visits fv ON fv.id = vt.field_visit_id
        JOIN visit_task_results vtr ON vtr.visit_task_id = vt.id
        LEFT JOIN visit_task_device_demo_results vtdr ON vtdr.visit_task_result_id = vtr.id
        LEFT JOIN employees closer ON closer.id = vtdr.closed_by_employee_id
        WHERE vt.source_open_task_id = $1
        ORDER BY vtr.closed_at DESC NULLS LAST, vt.id DESC
        LIMIT 1`,
        [openTaskId],
      );
      (taskData as any).lastAttemptDetail = rows[0] ?? null;
    }

    await loadLastAttemptDetail(id);

    // Load pre-offers defined at task creation
    const { rows: preOfferRows } = await pool.query(
      `SELECT
        otpo.id AS id,
        otpo.device_model_id AS "deviceModelId",
        COALESCE(dm.name_ar, dm.name) AS "deviceName",
        otpo.offer_type AS "offerType",
        otpo.quantity,
        otpo.total_amount::float AS "totalAmount",
        otpo.first_payment_amount::float AS "firstPaymentAmount",
        otpo.installment_months AS "installmentMonths",
        otpo.currency,
        otpo.discount_percentage::float AS "discountPercentage",
        otpo.applied_device_discount_id AS "appliedDeviceDiscountId",
        otpo.closed_by_employee_id AS "closedByEmployeeId",
        prep.name AS "closedByEmployeeName",
        otpo.no_closing_reason AS "noClosingReason",
        otpo.source_customer_pre_offer_id AS "sourceCustomerPreOfferId",
        otpo.sale_reference_number AS "saleReferenceNumber",
        linked_spo.response_state AS "customerResponse",
        (
          -- An offer is "already converted" when a live contract links to it by
          -- source_task_offer_id OR by matching sale_reference_number (the latter
          -- catches contracts created from the linked standalone pre-offer). This
          -- mirrors customerPreOffers.ts so the contract form's accepted-unlinked
          -- filter cannot re-sell an already-sold offer. Discarded/cancelled
          -- contracts free the offer again.
          SELECT cx.id
          FROM contracts cx
          WHERE cx.status NOT IN ('discarded', 'cancelled')
            AND (
              cx.source_task_offer_id = otpo.id
              OR (
                COALESCE(otpo.sale_reference_number, linked_spo.sale_reference_number) IS NOT NULL
                AND cx.sale_reference_number = COALESCE(otpo.sale_reference_number, linked_spo.sale_reference_number)
              )
            )
          ORDER BY cx.id DESC
          LIMIT 1
        ) AS "contractId"
      FROM open_task_pre_offers otpo
      LEFT JOIN device_models dm ON dm.id = otpo.device_model_id
      LEFT JOIN employees prep ON prep.id = otpo.closed_by_employee_id
      LEFT JOIN customer_device_pre_offers linked_spo ON linked_spo.id = otpo.source_customer_pre_offer_id
      WHERE otpo.open_task_id = $1
      ORDER BY otpo.id`,
      [id],
    );
    (taskData as any).preOffers = preOfferRows;
    // Surface offers only when the last attempt actually presented one
    // (final_decision === 'offer_presented'). Other terminal decisions
    // (rescheduled / cancelled) leave offers untouched — they have a
    // dedicated "تفاصيل العرض" tab regardless.
    if ((taskData as any).lastAttempt?.finalDecision === 'offer_presented') {
      (taskData as any).offers = preOfferRows;
    }

    res.json(taskData);
  } catch (err: any) {
    console.error('[open-tasks] GET /:id error:', err);
    res.status(500).json({ error: 'فشل في تحميل المهمة' });
  }
});

/**
 * @swagger
 * /api/open-tasks/{id}:
 *   patch:
 *     tags: [Open Tasks]
 *     summary: Update an open task
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: true
 *         description: Branch context ID
 *       - in: path
 *         name: id
 *         schema:
 *           type: integer
 *         required: true
 *         description: Task ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               status:
 *                 type: string
 *               notes:
 *                 type: string
 *               dueDate:
 *                 type: string
 *               expectedDate:
 *                 type: string
 *               priority:
 *                 type: string
 *               assignedScopeId:
 *                 type: integer
 *               assignedTeamKey:
 *                 type: string
 *               reason:
 *                 type: string
 *     responses:
 *       200:
 *         description: Success
 *       400:
 *         description: Bad Request
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Not Found
 *       500:
 *         description: Internal Server Error
 */
router.patch('/:id', requirePermission('open_tasks.edit'), async (req, res) => {
  try {
    const authContext = getAuthContext(req);
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: 'معرف المهمة غير صالح' });
    }

    if (req.body.status !== undefined && !(VALID_TASK_STATUSES as readonly string[]).includes(req.body.status)) {
      return res.status(400).json({ error: 'حالة المهمة غير صالحة' });
    }

    if (req.body.dueDate !== undefined && req.body.dueDate !== null) {
      if (!/^\d{4}-\d{2}-\d{2}/.test(String(req.body.dueDate)) || isNaN(Date.parse(req.body.dueDate))) {
        return res.status(400).json({ error: 'التاريخ المطلوب غير صالح' });
      }
    }

    if (req.body.expectedDate !== undefined && req.body.expectedDate !== null) {
      if (!/^\d{4}-\d{2}-\d{2}/.test(String(req.body.expectedDate)) || isNaN(Date.parse(req.body.expectedDate))) {
        return res.status(400).json({ error: 'الموعد المتوقع غير صالح' });
      }
    }

    const VALID_PRIORITIES = ['high', 'medium', 'low'];
    if (req.body.priority !== undefined && req.body.priority !== null && !VALID_PRIORITIES.includes(req.body.priority)) {
      return res.status(400).json({ error: 'قيمة الأولوية غير صالحة' });
    }

    const { rows: existing } = await pool.query('SELECT branch_id, task_type, status, priority, delivery_address FROM open_tasks WHERE id = $1', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ error: 'المهمة غير موجودة' });
    }
    if (!canEditOpenTask(authContext, existing[0].branch_id).allowed) {
      return res.status(403).json({ error: 'ليس لديك صلاحية الوصول لهذه المهمة' });
    }
    const oldStatus = existing[0].status;
    if (
      existing[0].task_type === 'device_delivery'
      && req.body.status === 'completed'
      && req.body.status !== oldStatus
    ) {
      return res.status(409).json({ error: 'device_delivery طھظڈط؛ظ„ظ‚ ظپظ‚ط· ط¹ط¨ط± ظ†طھظٹط¬ط© visit_task_device_delivery_results' });
    }

    const fieldMap: Record<string, string> = {
      status: 'status',
      notes: 'notes',
      dueDate: 'due_date',
      expectedDate: 'expected_date',
      deliveryAddress: 'delivery_address',
      priority: 'priority',
      waitingReasonId: 'waiting_reason_id',
      waitingReasonText: 'waiting_reason_text',
    };
    const allowedFields = ['status', 'notes', 'dueDate', 'expectedDate', 'deliveryAddress', 'priority', 'waitingReasonId', 'waitingReasonText'];

    const WAITING_STATES = ['open', 'needs_follow_up'];

    // If client sent waitingReasonText but no waitingReasonId, try to resolve the ID from system_lists
    if (req.body.waitingReasonText && req.body.waitingReasonId === undefined) {
      const { rows: reasonRows } = await pool.query(
        `SELECT id FROM system_lists WHERE category = 'telemarketing_reschedule_reason' AND value = $1 AND is_active = TRUE LIMIT 1`,
        [req.body.waitingReasonText],
      );
      if (reasonRows.length > 0) {
        req.body.waitingReasonId = reasonRows[0].id;
      }
    }

    const updates: string[] = [];
    const values: any[] = [];
    let paramIdx = 1;

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates.push(`${fieldMap[field]} = $${paramIdx}`);
        values.push(req.body[field]);
        paramIdx++;
      }
    }

    // Auto-write last_waiting_status: when leaving a waiting state for an active state
    if (req.body.status !== undefined && req.body.status !== oldStatus) {
      const wasWaiting = WAITING_STATES.includes(oldStatus);
      const becomingActive = !WAITING_STATES.includes(req.body.status) && !['completed', 'cancelled'].includes(req.body.status);
      if (wasWaiting && becomingActive) {
        updates.push(`last_waiting_status = $${paramIdx}`);
        values.push(oldStatus);
        paramIdx++;
      }
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'لا توجد حقول للتحديث' });
    }

    updates.push('updated_at = NOW()');
    values.push(id);

    const updateQuery = `UPDATE open_tasks SET ${updates.join(', ')} WHERE id = $${paramIdx} RETURNING id`;
    const { rows: [updated] } = await pool.query(updateQuery, values);

    if (!updated) {
      return res.status(404).json({ error: 'المهمة غير موجودة' });
    }

    const performedBy = authContext.userId;
    const userRole = (req as any).user?.role ?? null;
    const activityPromises: Promise<any>[] = [];

    if (req.body.status !== undefined && req.body.status !== oldStatus) {
      activityPromises.push(pool.query(
        `INSERT INTO task_activity_log (task_id, event_type, performed_by, role, old_value, new_value)
         VALUES ($1, 'status_change', $2, $3, $4, $5)`,
        [id, performedBy, userRole, oldStatus, req.body.status],
      ));
    }

    if (req.body.notes !== undefined) {
      activityPromises.push(pool.query(
        `INSERT INTO task_activity_log (task_id, event_type, performed_by, role, new_value)
         VALUES ($1, 'note_added', $2, $3, $4)`,
        [id, performedBy, userRole, req.body.notes],
      ));
    }

    if (req.body.priority !== undefined && req.body.priority !== (existing[0].priority ?? null)) {
      activityPromises.push(pool.query(
        `INSERT INTO task_activity_log (task_id, event_type, performed_by, role, old_value, new_value)
         VALUES ($1, 'priority_changed', $2, $3, $4, $5)`,
        [id, performedBy, userRole, existing[0].priority ?? null, req.body.priority],
      ));
    }

    if (req.body.deliveryAddress !== undefined && req.body.deliveryAddress !== (existing[0].delivery_address ?? null)) {
      activityPromises.push(pool.query(
        `INSERT INTO task_activity_log (task_id, event_type, performed_by, role, old_value, new_value, reason)
         VALUES ($1, 'note_added', $2, $3, $4, $5, $6)`,
        [
          id,
          performedBy,
          userRole,
          existing[0].delivery_address ?? null,
          req.body.deliveryAddress ?? null,
          'delivery_address_updated',
        ],
      ));
    }

    if (activityPromises.length > 0) {
      await Promise.all(activityPromises);
    }

    if (req.body.status === 'completed') {
      await updateContractDeviceStatusOnTaskCompletion(pool, updated.id);
    }

    const task = await loadOpenTaskById(pool, updated.id);
    res.json(task);
  } catch (err: any) {
    console.error('[open-tasks] PATCH /:id error:', err);
    res.status(500).json({ error: 'فشل في تحديث المهمة' });
  }
});

// ── Finalization rule helper ───────────────────────────────────────────────────
// After a visit_task_result is written, set field_visit.status = 'completed'
// only when every visit_task belonging to that field_visit has a result.
async function maybeCompleteFieldVisit(db: Queryable, fieldVisitId: bigint | string) {
  await db.query(
    `UPDATE field_visits fv
     SET status = 'completed', updated_at = NOW()
     WHERE fv.id = $1
       AND fv.status != 'completed'
       AND NOT EXISTS (
         SELECT 1 FROM visit_tasks vt
         LEFT JOIN visit_task_results vtr ON vtr.visit_task_id = vt.id
         WHERE vt.field_visit_id = fv.id
           AND vtr.id IS NULL
       )`,
    [fieldVisitId],
  );
}

async function updateContractDeviceStatusOnTaskCompletion(db: Queryable, taskId: number) {
  const { rows: tasks } = await db.query(
    'SELECT contract_id, device_id, task_type, status FROM open_tasks WHERE id = $1',
    [taskId]
  );
  if (!tasks[0] || !tasks[0].contract_id || tasks[0].status !== 'completed') return;
  const contractId = tasks[0].contract_id;
  const deviceId = tasks[0].device_id;
  const taskType = tasks[0].task_type;

  let newDeviceStatus: string | null = null;
  let newContractStatus: string | null = null;

  if (taskType === 'device_delivery') {
    newDeviceStatus = 'delivered';
  } else if (taskType === 'device_installation') {
    newDeviceStatus = 'installed';
  } else if (taskType === 'device_activation') {
    newDeviceStatus = 'active';
    newContractStatus = 'active';
  }

  // Phase 6: device_status lives on installed_devices, not contracts.
  //
  // DEC-CT-04: the UPDATE of status='active' triggers DB-side cascade
  // (installed_devices.activated_at stamping + device_warranties snapshot)
  // installed by migration 203 — no app-side warranty bookkeeping is needed.
  let resolvedDeviceId: number | null = deviceId ?? null;
  if (newDeviceStatus && deviceId) {
    await db.query(
      'UPDATE installed_devices SET status = $1 WHERE id = $2',
      [newDeviceStatus, deviceId]
    );
  } else if (newDeviceStatus && contractId) {
    // fallback via contract_id for tasks that predate Phase 3 backfill
    const r = await db.query(
      'UPDATE installed_devices SET status = $1 WHERE contract_id = $2 RETURNING id',
      [newDeviceStatus, contractId]
    );
    resolvedDeviceId = r.rows[0]?.id ?? null;
  }

  // DEC-CT-09: keep the possession ledger in sync with the task flow.
  // Delivery hands the device to the customer; activation does not move it.
  // We only open a new possession row when the holder genuinely changes.
  if (resolvedDeviceId && taskType === 'device_delivery') {
    const { rows: customerRow } = await db.query(
      'SELECT customer_id FROM installed_devices WHERE id = $1',
      [resolvedDeviceId]
    );
    const customerId = customerRow[0]?.customer_id ?? null;
    if (customerId) {
      // Close any open warehouse row and open a customer row atomically.
      await db.query(
        `UPDATE device_possession_log
            SET end_at = NOW()
          WHERE device_id = $1 AND end_at IS NULL`,
        [resolvedDeviceId]
      );
      await db.query(
        `INSERT INTO device_possession_log
           (device_id, holder_type, holder_id, reason, notes)
         VALUES ($1, 'customer', $2, 'sale_delivery',
                 'Logged automatically on device_delivery task completion')`,
        [resolvedDeviceId, customerId]
      );
    }
  }

  if (newContractStatus) {
    await db.query(
      'UPDATE contracts SET status = $1 WHERE id = $2',
      [newContractStatus, contractId]
    );
  }
}

function mapDecisionToOpenTaskStatus(finalDecision: string): string {
  if (finalDecision === 'resolved') return 'completed';
  if (finalDecision === 'cancelled') return 'cancelled';
  return 'needs_follow_up'; // partially_resolved | unresolved | needs_followup
}

/**
 * @swagger
 * /api/open-tasks/{id}/emergency-result:
 *   get:
 *     tags: [Open Tasks]
 *     summary: Get emergency result for a task
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: true
 *         description: Branch context ID
 *       - in: path
 *         name: id
 *         schema:
 *           type: integer
 *         required: true
 *         description: Task ID
 *     responses:
 *       200:
 *         description: Success
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Not Found
 *       500:
 *         description: Internal Server Error
 */
router.get('/:id/emergency-result', requirePermission('open_tasks.view'), async (req, res) => {
  try {
    const authContext = getAuthContext(req);
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'معرف المهمة غير صالح' });

    const { rows: taskRows } = await pool.query(
      'SELECT branch_id, task_type FROM open_tasks WHERE id = $1',
      [id],
    );
    if (taskRows.length === 0) return res.status(404).json({ error: 'المهمة غير موجودة' });
    if (taskRows[0].task_type !== 'emergency_maintenance') {
      return res.status(400).json({ error: 'هذا المسار مخصص لمهام الصيانة الطارئة فقط' });
    }
    if (!canViewOpenTask(authContext, taskRows[0].branch_id).allowed) {
      return res.status(403).json({ error: 'ليس لديك صلاحية الوصول' });
    }

    const { rows } = await pool.query(
      `SELECT
         fv.id              AS "fieldVisitId",
         vt.id              AS "visitTaskId",
         vtr.id             AS "resultId",
         vtr.final_decision AS "finalDecision",
         vtr.reason_code    AS "reasonCode",
         vtr.closing_notes  AS "closingNotes",
         vtr.closed_at      AS "closedAt",
         ts.problem_confirmed     AS "problemConfirmed",
         ts.technical_notes       AS "technicalNotes",
         ts.water_tds_before      AS "waterTdsBefore",
         ts.water_tds_after       AS "waterTdsAfter",
         ts.pump_pressure         AS "pumpPressure",
         ts.membrane_output       AS "membraneOutput",
         ts.tank_pressure         AS "tankPressure",
         ts.low_pressure_switch   AS "lowPressureSwitch",
         ts.high_pressure_switch  AS "highPressureSwitch",
         ts.solenoid_valve        AS "solenoidValve",
         ts.uv_status             AS "uvStatus",
         ef.labor_cost            AS "laborCost",
         ef.parts_cost            AS "partsCost",
         ef.total_cost            AS "totalCost",
         ef.payment_method        AS "paymentMethod",
         ef.collected_amount      AS "collectedAmount",
         ef.invoice_notes         AS "invoiceNotes"
       FROM field_visits fv
       JOIN visit_tasks vt
         ON vt.field_visit_id = fv.id
         AND vt.source_legacy_type = 'open_task'
         AND vt.source_legacy_id = $1::text
       LEFT JOIN visit_task_results vtr ON vtr.visit_task_id = vt.id
       LEFT JOIN visit_task_emergency_technical_states ts ON ts.visit_task_result_id = vtr.id
       LEFT JOIN visit_task_emergency_financials ef ON ef.visit_task_result_id = vtr.id
       WHERE fv.source_legacy_type = 'open_task'
         AND fv.source_legacy_id = $1::text`,
      [id],
    );

    if (rows.length === 0) {
      return res.json({ fieldVisitId: null, visitTaskId: null, visitTaskResult: null, technicalState: null, partsUsed: [], financials: null });
    }

    const row = rows[0];

    const { rows: partsRows } = row.resultId ? await pool.query(
      `SELECT
         id,
         spare_part_id      AS "sparePartId",
         part_name_snapshot AS "partNameSnapshot",
         quantity,
         unit_price         AS "unitPrice"
       FROM visit_task_emergency_parts_used
       WHERE visit_task_result_id = $1
       ORDER BY id`,
      [row.resultId],
    ) : { rows: [] };

    return res.json({
      fieldVisitId: row.fieldVisitId,
      visitTaskId: row.visitTaskId,
      visitTaskResult: row.resultId ? {
        id: row.resultId,
        finalDecision: row.finalDecision,
        reasonCode: row.reasonCode,
        closingNotes: row.closingNotes,
        closedAt: row.closedAt,
      } : null,
      technicalState: row.problemConfirmed !== null || row.technicalNotes !== null ? {
        problemConfirmed: row.problemConfirmed,
        technicalNotes: row.technicalNotes,
        waterTdsBefore: row.waterTdsBefore != null ? Number(row.waterTdsBefore) : null,
        waterTdsAfter: row.waterTdsAfter != null ? Number(row.waterTdsAfter) : null,
        pumpPressure: row.pumpPressure != null ? Number(row.pumpPressure) : null,
        membraneOutput: row.membraneOutput,
        tankPressure: row.tankPressure != null ? Number(row.tankPressure) : null,
        lowPressureSwitch: row.lowPressureSwitch,
        highPressureSwitch: row.highPressureSwitch,
        solenoidValve: row.solenoidValve,
        uvStatus: row.uvStatus,
      } : null,
      partsUsed: partsRows.map((p: any) => ({
        id: p.id,
        sparePartId: p.sparePartId,
        partNameSnapshot: p.partNameSnapshot,
        quantity: p.quantity,
        unitPrice: p.unitPrice != null ? Number(p.unitPrice) : null,
      })),
      financials: row.laborCost !== null || row.partsCost !== null || row.totalCost !== null ? {
        laborCost: row.laborCost != null ? Number(row.laborCost) : null,
        partsCost: row.partsCost != null ? Number(row.partsCost) : null,
        totalCost: row.totalCost != null ? Number(row.totalCost) : null,
        paymentMethod: row.paymentMethod,
        collectedAmount: row.collectedAmount != null ? Number(row.collectedAmount) : null,
        invoiceNotes: row.invoiceNotes,
      } : null,
    });
  } catch (err: any) {
    console.error('[open-tasks] GET /:id/emergency-result error:', err);
    res.status(500).json({ error: 'فشل في تحميل نتيجة المهمة' });
  }
});

/**
 * @swagger
 * /api/open-tasks/{id}/emergency-result:
 *   post:
 *     tags: [Open Tasks]
 *     summary: Create emergency result for a task
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: true
 *         description: Branch context ID
 *       - in: path
 *         name: id
 *         schema:
 *           type: integer
 *         required: true
 *         description: Task ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               decision:
 *                 type: string
 *               notes:
 *                 type: string
 *               reasonCode:
 *                 type: string
 *               closedByEmployeeId:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Success
 *       400:
 *         description: Bad Request
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Not Found
 *       500:
 *         description: Internal Server Error
 */
router.post('/:id/emergency-result', requirePermission('tasks.results.record'), async (req, res) => {
  try {
    const authContext = getAuthContext(req);
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'معرف المهمة غير صالح' });

    const VALID_DECISIONS = ['resolved', 'partially_resolved', 'unresolved', 'needs_followup', 'cancelled'] as const;
    const finalDecision: string = req.body?.finalDecision;
    if (!finalDecision || !(VALID_DECISIONS as readonly string[]).includes(finalDecision)) {
      return res.status(400).json({ error: `finalDecision مطلوب ويجب أن يكون أحد: ${VALID_DECISIONS.join(', ')}` });
    }
    const closingNotes: string | null = typeof req.body?.closingNotes === 'string' ? req.body.closingNotes.trim() || null : null;

    const { rows: taskRows } = await pool.query(
      'SELECT id, branch_id, task_type, client_id FROM open_tasks WHERE id = $1',
      [id],
    );
    if (taskRows.length === 0) return res.status(404).json({ error: 'المهمة غير موجودة' });
    if (taskRows[0].task_type !== 'emergency_maintenance') {
      return res.status(400).json({ error: 'هذا المسار مخصص لمهام الصيانة الطارئة فقط' });
    }
    // Unified result gate: one permission records results for every task type.
    if (!authorize(authContext, { permission: 'tasks.results.record', branchId: taskRows[0].branch_id }).allowed) {
      return res.status(403).json({ error: 'ليس لديك صلاحية الوصول' });
    }

    const taskRow = taskRows[0];
    const closedBy: number | null = authContext.userId ?? null;
    const technicalState = req.body?.technicalState ?? null;
    const partsUsed: any[] = Array.isArray(req.body?.partsUsed) ? req.body.partsUsed : [];
    const financials = req.body?.financials ?? null;

    const db = await pool.connect();
    try {
      await db.query('BEGIN');

      // 1. Upsert field_visit — set to 'ended' (field work done, result being recorded).
      // maybeCompleteFieldVisit() (step 7) will promote to 'completed' once all
      // visit_tasks have results. For single-task visits this happens immediately.
      const { rows: fvRows } = await db.query(
        `INSERT INTO field_visits (
           visit_type, visit_family, status,
           client_id, branch_id,
           source_legacy_type, source_legacy_id,
           closed_by, closed_at,
           created_at, updated_at
         ) VALUES (
           'emergency', 'service', 'ended',
           $1, $2,
           'open_task', $3::text,
           $4, NOW(),
           NOW(), NOW()
         )
         ON CONFLICT (source_legacy_type, source_legacy_id) DO UPDATE SET
           status     = 'ended',
           closed_by  = EXCLUDED.closed_by,
           closed_at  = NOW(),
           updated_at = NOW()
         RETURNING id`,
        [taskRow.client_id, taskRow.branch_id, id, closedBy],
      );
      const fieldVisitId = fvRows[0].id;

      // 2. Upsert visit_task
      const { rows: vtRows } = await db.query(
        `INSERT INTO visit_tasks (
           field_visit_id, source_open_task_id,
           task_type, task_family, sequence_no,
           status, execution_notes,
           source_legacy_type, source_legacy_id,
           created_at, updated_at
         ) VALUES (
           $1, $2,
           'emergency_maintenance', 'service', 1,
           'completed', $3,
           'open_task', $4::text,
           NOW(), NOW()
         )
         ON CONFLICT (source_legacy_type, source_legacy_id) DO UPDATE SET
           status          = 'completed',
           execution_notes = EXCLUDED.execution_notes,
           updated_at      = NOW()
         RETURNING id`,
        [fieldVisitId, id, closingNotes, id],
      );
      const visitTaskId = vtRows[0].id;

      // 3. Upsert visit_task_result (Phase 4 rule: this is the moment of finalization)
      const { rows: vtrRows } = await db.query(
        `INSERT INTO visit_task_results (
           visit_task_id, final_decision, reason_code, closing_notes,
           closed_by, closed_at, created_at, updated_at
         ) VALUES (
           $1, $2, NULL, $3,
           $4, NOW(), NOW(), NOW()
         )
         ON CONFLICT (visit_task_id) DO UPDATE SET
           final_decision = EXCLUDED.final_decision,
           closing_notes  = EXCLUDED.closing_notes,
           closed_by      = EXCLUDED.closed_by,
           closed_at      = NOW(),
           updated_at     = NOW()
         RETURNING id`,
        [visitTaskId, finalDecision, closingNotes, closedBy],
      );
      const visitTaskResultId = vtrRows[0].id;

      // 4. Technical state — linked to visit_task_result (not visit_task)
      if (technicalState && typeof technicalState === 'object') {
        await db.query(
          `INSERT INTO visit_task_emergency_technical_states (
             visit_task_result_id,
             problem_confirmed, technical_notes,
             water_tds_before, water_tds_after,
             pump_pressure, membrane_output, tank_pressure,
             low_pressure_switch, high_pressure_switch,
             solenoid_valve, uv_status,
             created_at, updated_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW(),NOW())
           ON CONFLICT (visit_task_result_id) DO UPDATE SET
             problem_confirmed    = EXCLUDED.problem_confirmed,
             technical_notes      = EXCLUDED.technical_notes,
             water_tds_before     = EXCLUDED.water_tds_before,
             water_tds_after      = EXCLUDED.water_tds_after,
             pump_pressure        = EXCLUDED.pump_pressure,
             membrane_output      = EXCLUDED.membrane_output,
             tank_pressure        = EXCLUDED.tank_pressure,
             low_pressure_switch  = EXCLUDED.low_pressure_switch,
             high_pressure_switch = EXCLUDED.high_pressure_switch,
             solenoid_valve       = EXCLUDED.solenoid_valve,
             uv_status            = EXCLUDED.uv_status,
             updated_at           = NOW()`,
          [
            visitTaskResultId,
            technicalState.problemConfirmed ?? null,
            technicalState.technicalNotes ?? null,
            technicalState.waterTdsBefore ?? null,
            technicalState.waterTdsAfter ?? null,
            technicalState.pumpPressure ?? null,
            technicalState.membraneOutput ?? null,
            technicalState.tankPressure ?? null,
            technicalState.lowPressureSwitch ?? null,
            technicalState.highPressureSwitch ?? null,
            technicalState.solenoidValve ?? null,
            technicalState.uvStatus ?? null,
          ],
        );
      }

      // 5. Parts used — linked to visit_task_result; replace entirely on each submission
      if (partsUsed.length > 0) {
        await db.query(
          'DELETE FROM visit_task_emergency_parts_used WHERE visit_task_result_id = $1',
          [visitTaskResultId],
        );
        for (const part of partsUsed) {
          if (!part.partNameSnapshot) continue;
          await db.query(
            `INSERT INTO visit_task_emergency_parts_used
               (visit_task_result_id, spare_part_id, part_name_snapshot, quantity, unit_price, created_at)
             VALUES ($1,$2,$3,$4,$5,NOW())`,
            [
              visitTaskResultId,
              part.sparePartId ?? null,
              String(part.partNameSnapshot),
              Number.isInteger(Number(part.quantity)) && Number(part.quantity) > 0 ? Number(part.quantity) : 1,
              part.unitPrice != null ? Number(part.unitPrice) : null,
            ],
          );
        }
      }

      // 6. Financials — linked to visit_task_result (not visit_task)
      if (financials && typeof financials === 'object') {
        await db.query(
          `INSERT INTO visit_task_emergency_financials (
             visit_task_result_id,
             labor_cost, parts_cost, total_cost,
             payment_method, collected_amount, invoice_notes,
             created_at, updated_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),NOW())
           ON CONFLICT (visit_task_result_id) DO UPDATE SET
             labor_cost       = EXCLUDED.labor_cost,
             parts_cost       = EXCLUDED.parts_cost,
             total_cost       = EXCLUDED.total_cost,
             payment_method   = EXCLUDED.payment_method,
             collected_amount = EXCLUDED.collected_amount,
             invoice_notes    = EXCLUDED.invoice_notes,
             updated_at       = NOW()`,
          [
            visitTaskResultId,
            financials.laborCost ?? null,
            financials.partsCost ?? null,
            financials.totalCost ?? null,
            financials.paymentMethod ?? null,
            financials.collectedAmount ?? null,
            financials.invoiceNotes ?? null,
          ],
        );
      }
      
      // NOTE: Device/contract snapshot is now captured at open_task creation
      // time via persistOpenTaskSnapshots() (see open_tasks.device_snapshot
      // column added in migration 259 + buildDeviceSnapshot). The previously
      // referenced persistContractDeviceSnapshot() was never defined; the
      // snapshot need is fully covered upstream.

      // 7. Phase 4 finalization rule: complete the field visit when all tasks resolved
      await maybeCompleteFieldVisit(db, fieldVisitId);

      // 8. Phase 4 finalization rule: update open_task status based on final decision
      const newOpenTaskStatus = mapDecisionToOpenTaskStatus(finalDecision);
      const { rows: preStatusRows } = await db.query(
        'SELECT status FROM open_tasks WHERE id = $1',
        [id],
      );
      const oldOpenTaskStatus = preStatusRows[0]?.status;
      const updateResult = await db.query(
        `UPDATE open_tasks
         SET status = $1, updated_at = NOW()
         WHERE id = $2
           AND status NOT IN ('completed', 'cancelled')`,
        [newOpenTaskStatus, id],
      );
      if ((updateResult as any).rowCount > 0 && oldOpenTaskStatus && oldOpenTaskStatus !== newOpenTaskStatus) {
        await db.query(
          `INSERT INTO task_activity_log (task_id, event_type, performed_by, role, old_value, new_value)
           VALUES ($1, 'status_change', $2, NULL, $3, $4)`,
          [id, closedBy, oldOpenTaskStatus, newOpenTaskStatus],
        );
      }

      if (newOpenTaskStatus === 'completed') {
        await updateContractDeviceStatusOnTaskCompletion(db, id);
      }

      await db.query('COMMIT');
    } catch (err) {
      await db.query('ROLLBACK');
      throw err;
    } finally {
      db.release();
    }

    const task = await loadOpenTaskById(pool, id);
    res.json(task);
  } catch (err: any) {
    console.error('[open-tasks] POST /:id/emergency-result error:', err);
    res.status(500).json({ error: 'فشل في تسجيل نتيجة المهمة' });
  }
});

/**
 * @swagger
 * /api/open-tasks/scope/{scopeId}:
 *   get:
 *     tags: [Open Tasks]
 *     summary: Retrieve open tasks in a scope
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: true
 *         description: Branch context ID
 *       - in: path
 *         name: scopeId
 *         schema:
 *           type: integer
 *         required: true
 *         description: Scope ID
 *       - in: query
 *         name: branchId
 *         schema:
 *           type: integer
 *         required: false
 *         description: Filter by branch ID
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         required: false
 *         description: Search term
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *         required: false
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         required: false
 *         description: Number of items per page
 *     responses:
 *       200:
 *         description: Success
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal Server Error
 */
router.get('/scope/:scopeId', requirePermission('open_tasks.view'), async (req, res) => {
  try {
    const scopeId = Number(req.params.scopeId);
    if (!Number.isFinite(scopeId)) {
      return res.status(400).json({ error: 'معرف النطاق غير صالح' });
    }

    const { rows } = await pool.query(
      `${OPEN_TASK_SELECT}
       JOIN scope_tasks st ON st.open_task_id = ot.id
       WHERE st.scope_id = $1
       ORDER BY ot.created_at DESC`,
      [scopeId],
    );

    res.json(rows.map(mapOpenTaskRow));
  } catch (err: any) {
    console.error('[open-tasks] GET /scope/:scopeId error:', err);
    res.status(500).json({ error: 'فشل في تحميل مهام النطاق' });
  }
});

/**
 * @swagger
 * /api/open-tasks/{id}/assign-scope:
 *   post:
 *     tags: [Open Tasks]
 *     summary: Assign scope to a task
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: true
 *         description: Branch context ID
 *       - in: path
 *         name: id
 *         schema:
 *           type: integer
 *         required: true
 *         description: Task ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               scopeId:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Success
 *       400:
 *         description: Bad Request
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Not Found
 *       500:
 *         description: Internal Server Error
 */
router.post('/:id/assign-scope', requirePermission('open_tasks.edit'), async (req, res) => {
  try {
    const authContext = getAuthContext(req);
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: 'معرف المهمة غير صالح' });
    }

    const scopeId = Number(req.body?.scopeId);
    const teamKey = String(req.body?.teamKey ?? '');
    if (!Number.isFinite(scopeId) || !teamKey) {
      return res.status(400).json({ error: 'scopeId و teamKey مطلوبان' });
    }

    const { rows: existing } = await pool.query(
      'SELECT branch_id FROM open_tasks WHERE id = $1',
      [id],
    );
    if (existing.length === 0) {
      return res.status(404).json({ error: 'المهمة غير موجودة' });
    }
    if (!canEditOpenTask(authContext, existing[0].branch_id).allowed) {
      return res.status(403).json({ error: 'ليس لديك صلاحية الوصول لهذه المهمة' });
    }

    await pool.query(
      `UPDATE open_tasks SET assigned_scope_id = $1, assigned_team_key = $2, updated_at = NOW()
       WHERE id = $3`,
      [scopeId, teamKey, id],
    );
    await pool.query(
      `INSERT INTO scope_tasks (scope_id, open_task_id, team_key, branch_id, added_by)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (scope_id, open_task_id) DO NOTHING`,
      [scopeId, id, teamKey, existing[0].branch_id, authContext.userId],
    );

    const task = await loadOpenTaskById(pool, id);
    res.json(task);
  } catch (err: any) {
    console.error('[open-tasks] POST /:id/assign-scope error:', err);
    res.status(500).json({ error: 'فشل في إسناد المهمة للنطاق' });
  }
});

/**
 * @swagger
 * /api/open-tasks/{id}/exclude:
 *   post:
 *     tags: [Open Tasks]
 *     summary: Exclude task from list for a date
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: true
 *         description: Branch context ID
 *       - in: path
 *         name: id
 *         schema:
 *           type: integer
 *         required: true
 *         description: Task ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               date:
 *                 type: string
 *               reason:
 *                 type: string
 *     responses:
 *       200:
 *         description: Success
 *       400:
 *         description: Bad Request
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Not Found
 *       500:
 *         description: Internal Server Error
 */
router.post('/:id/exclude', requirePermission('open_tasks.edit'), async (req, res) => {
  try {
    const authContext = getAuthContext(req);
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'معرف المهمة غير صالح' });

    const { rows: taskRows } = await pool.query(
      'SELECT id, branch_id, status, last_waiting_status, assigned_scope_id FROM open_tasks WHERE id = $1',
      [id],
    );
    if (taskRows.length === 0) return res.status(404).json({ error: 'المهمة غير موجودة' });
    if (!canEditOpenTask(authContext, taskRows[0].branch_id).allowed) {
      return res.status(403).json({ error: 'ليس لديك صلاحية الوصول لهذه المهمة' });
    }

    // DEC-009 لبنة 8 / R-5 — exclusion is a PRE-generation curation tool only.
    // Once the list is generated the task moves to in_scheduling (committed) and
    // is frozen; it may only change through the visit layer, never via exclude.
    const EXCLUDABLE_STATES = ['open', 'needs_follow_up', 'assigned'];
    if (!EXCLUDABLE_STATES.includes(taskRows[0].status)) {
      return res.status(409).json({
        error: 'لا يمكن استثناء المهمة بعد اعتماد القائمة (قيد الجدولة أو ما بعدها).',
        code: 'task_committed',
      });
    }

    const reason = typeof req.body?.reason === 'string' && req.body.reason.trim().length > 0
      ? req.body.reason.trim()
      : null;
    // Local calendar date (NOT UTC) — toISOString() is a day behind before the UTC offset.
    const today = (() => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    })();
    const oldStatus = taskRows[0].status;
    const newStatus = oldStatus === 'assigned'
      ? (taskRows[0].last_waiting_status || 'open')
      : oldStatus;

    await pool.query(
      `UPDATE open_tasks
       SET excluded_for_date = $1,
           excluded_reason = $2,
           status = CASE WHEN status = 'assigned' THEN COALESCE(last_waiting_status, 'open') ELSE status END,
           assigned_scope_id = CASE WHEN status = 'assigned' THEN NULL ELSE assigned_scope_id END,
           -- DEC-009 multi-team — KEEP assigned_team_key on exclusion so the excluded
           -- contact stays attributed to the team that excluded it (dashboard isolation).
           -- Safe: syncAssignedTasks only reads team_key on status='assigned' rows.
           assigned_for_date = CASE WHEN status = 'assigned' THEN NULL ELSE assigned_for_date END,
           assigned_at = CASE WHEN status = 'assigned' THEN NULL ELSE assigned_at END,
           updated_at = NOW()
       WHERE id = $3`,
      [today, reason, id],
    );

    if (oldStatus === 'assigned') {
      await pool.query(
        `INSERT INTO task_activity_log (task_id, event_type, performed_by, role, old_value, new_value, reason)
         VALUES ($1, 'status_change', $2, NULL, $3, $4, $5)`,
        [id, authContext.userId, oldStatus, newStatus, reason],
      );
    }

    const task = await loadOpenTaskById(pool, id);
    res.json(task);
  } catch (err: any) {
    console.error('[open-tasks] POST /:id/exclude error:', err);
    res.status(500).json({ error: 'فشل في استثناء المهمة' });
  }
});

/**
 * @swagger
 * /api/open-tasks/{id}/restore:
 *   post:
 *     tags: [Open Tasks]
 *     summary: Restore an excluded task
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: true
 *         description: Branch context ID
 *       - in: path
 *         name: id
 *         schema:
 *           type: integer
 *         required: true
 *         description: Task ID
 *     responses:
 *       200:
 *         description: Success
 *       400:
 *         description: Bad Request
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Not Found
 *       500:
 *         description: Internal Server Error
 */
router.post('/:id/restore', requirePermission('open_tasks.edit'), async (req, res) => {
  try {
    const authContext = getAuthContext(req);
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'معرف المهمة غير صالح' });

    const { rows: taskRows } = await pool.query(
      'SELECT id, branch_id FROM open_tasks WHERE id = $1',
      [id],
    );
    if (taskRows.length === 0) return res.status(404).json({ error: 'المهمة غير موجودة' });
    if (!canEditOpenTask(authContext, taskRows[0].branch_id).allowed) {
      return res.status(403).json({ error: 'ليس لديك صلاحية الوصول لهذه المهمة' });
    }

    await pool.query(
      `UPDATE open_tasks
       SET excluded_for_date = NULL,
           excluded_reason = NULL,
           updated_at = NOW()
       WHERE id = $1`,
      [id],
    );

    const task = await loadOpenTaskById(pool, id);
    res.json(task);
  } catch (err: any) {
    console.error('[open-tasks] POST /:id/restore error:', err);
    res.status(500).json({ error: 'فشل في استرجاع المهمة' });
  }
});

/**
 * @swagger
 * /api/open-tasks/bulk-exclude:
 *   post:
 *     tags: [Open Tasks]
 *     summary: Bulk exclude tasks
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: true
 *         description: Branch context ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               taskIds:
 *                 type: array
 *                 items:
 *                   type: integer
 *               date:
 *                 type: string
 *               reason:
 *                 type: string
 *     responses:
 *       200:
 *         description: Success
 *       400:
 *         description: Bad Request
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal Server Error
 */
router.post('/bulk-exclude', requirePermission('open_tasks.edit'), async (req, res) => {
  try {
    const authContext = getAuthContext(req);
    const taskIds = Array.isArray(req.body?.taskIds) ? req.body.taskIds.map((id: any) => Number(id)).filter((id: number) => Number.isFinite(id)) : [];
    if (taskIds.length === 0) return res.status(400).json({ error: 'taskIds مطلوبة' });

    const { rows: taskRows } = await pool.query(
      'SELECT id, branch_id, status, last_waiting_status FROM open_tasks WHERE id = ANY($1::int[])',
      [taskIds],
    );
    if (taskRows.length !== taskIds.length) return res.status(404).json({ error: 'بعض المهام غير موجود' });
    if (taskRows.some(row => !canEditOpenTask(authContext, row.branch_id).allowed)) {
      return res.status(403).json({ error: 'ليس لديك صلاحية الوصول لبعض هذه المهام' });
    }

    // DEC-009 لبنة 8 / R-5 — reject the batch if any task is already committed
    // (in_scheduling or beyond); exclusion is a pre-generation curation tool only.
    const EXCLUDABLE_STATES = ['open', 'needs_follow_up', 'assigned'];
    const committed = taskRows.filter(row => !EXCLUDABLE_STATES.includes(row.status));
    if (committed.length > 0) {
      return res.status(409).json({
        error: `لا يمكن استثناء ${committed.length} مهمة بعد اعتماد القائمة (قيد الجدولة أو ما بعدها).`,
        code: 'task_committed',
        committedIds: committed.map(row => row.id),
      });
    }

    const reason = typeof req.body?.reason === 'string' && req.body.reason.trim().length > 0
      ? req.body.reason.trim()
      : null;
    // Local calendar date (NOT UTC) — toISOString() is a day behind before the UTC offset.
    const today = (() => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    })();

    await pool.query(
      `UPDATE open_tasks
       SET excluded_for_date = $1,
           excluded_reason = $2,
           status = CASE WHEN status = 'assigned' THEN COALESCE(last_waiting_status, 'open') ELSE status END,
           assigned_scope_id = CASE WHEN status = 'assigned' THEN NULL ELSE assigned_scope_id END,
           -- DEC-009 multi-team — KEEP assigned_team_key on exclusion (dashboard isolation).
           assigned_for_date = CASE WHEN status = 'assigned' THEN NULL ELSE assigned_for_date END,
           assigned_at = CASE WHEN status = 'assigned' THEN NULL ELSE assigned_at END,
           updated_at = NOW()
       WHERE id = ANY($3::int[])`,
      [today, reason, taskIds],
    );

    for (const row of taskRows.filter(row => row.status === 'assigned')) {
      await pool.query(
        `INSERT INTO task_activity_log (task_id, event_type, performed_by, role, old_value, new_value, reason)
         VALUES ($1, 'status_change', $2, NULL, 'assigned', $3, $4)`,
        [row.id, authContext.userId, row.last_waiting_status || 'open', reason],
      );
    }

    res.json({ updated: taskIds.length });
  } catch (err: any) {
    console.error('[open-tasks] POST /bulk-exclude error:', err);
    res.status(500).json({ error: 'فشل في استثناء المهام' });
  }
});

/**
 * @swagger
 * /api/open-tasks/bulk-restore:
 *   post:
 *     tags: [Open Tasks]
 *     summary: Bulk restore tasks
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: true
 *         description: Branch context ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               taskIds:
 *                 type: array
 *                 items:
 *                   type: integer
 *     responses:
 *       200:
 *         description: Success
 *       400:
 *         description: Bad Request
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal Server Error
 */
router.post('/bulk-restore', requirePermission('open_tasks.edit'), async (req, res) => {
  try {
    const authContext = getAuthContext(req);
    const taskIds = Array.isArray(req.body?.taskIds) ? req.body.taskIds.map((id: any) => Number(id)).filter((id: number) => Number.isFinite(id)) : [];
    if (taskIds.length === 0) return res.status(400).json({ error: 'taskIds مطلوبة' });

    const { rows: taskRows } = await pool.query(
      'SELECT id, branch_id FROM open_tasks WHERE id = ANY($1::int[])',
      [taskIds],
    );
    if (taskRows.length !== taskIds.length) return res.status(404).json({ error: 'بعض المهام غير موجود' });
    if (taskRows.some(row => !canEditOpenTask(authContext, row.branch_id).allowed)) {
      return res.status(403).json({ error: 'ليس لديك صلاحية الوصول لبعض هذه المهام' });
    }

    await pool.query(
      `UPDATE open_tasks
       SET excluded_for_date = NULL,
           excluded_reason = NULL,
           updated_at = NOW()
       WHERE id = ANY($1::int[])`,
      [taskIds],
    );

    res.json({ updated: taskIds.length });
  } catch (err: any) {
    console.error('[open-tasks] POST /bulk-restore error:', err);
    res.status(500).json({ error: 'فشل في استرجاع المهام' });
  }
});

/**
 * @swagger
 * /api/open-tasks/{id}/activity:
 *   get:
 *     tags: [Open Tasks]
 *     summary: Get task activity log
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: true
 *         description: Branch context ID
 *       - in: path
 *         name: id
 *         schema:
 *           type: integer
 *         required: true
 *         description: Task ID
 *       - in: query
 *         name: branchId
 *         schema:
 *           type: integer
 *         required: false
 *         description: Filter by branch ID
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         required: false
 *         description: Search term
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *         required: false
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         required: false
 *         description: Number of items per page
 *     responses:
 *       200:
 *         description: Success
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Not Found
 *       500:
 *         description: Internal Server Error
 */
router.get('/:id/activity', requirePermission('open_tasks.view'), async (req, res) => {
  try {
    const authContext = getAuthContext(req);
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'معرف المهمة غير صالح' });

    const { rows: taskRows } = await pool.query('SELECT branch_id FROM open_tasks WHERE id = $1', [id]);
    if (taskRows.length === 0) return res.status(404).json({ error: 'المهمة غير موجودة' });
    if (!canViewOpenTask(authContext, taskRows[0].branch_id).allowed) {
      return res.status(403).json({ error: 'ليس لديك صلاحية الوصول لهذه المهمة' });
    }

    const { rows } = await pool.query(
      `SELECT
        tal.id,
        CASE WHEN tal.event_type IN ('rescheduled', 'needs_reschedule') THEN 'needs_follow_up' ELSE tal.event_type END AS "eventType",
        tal.performed_by AS "performedBy",
        tal.role,
        tal.old_value AS "oldValue",
        tal.new_value AS "newValue",
        tal.reason,
        tal.reference_id AS "referenceId",
        tal.created_at AS "createdAt",
        hu.name AS "performedByName"
      FROM task_activity_log tal
      LEFT JOIN hr_users hu ON hu.id = tal.performed_by
      WHERE tal.task_id = $1
      ORDER BY tal.created_at DESC`,
      [id],
    );
    res.json(rows);
  } catch (err: any) {
    console.error('[open-tasks] GET /:id/activity error:', err);
    res.status(500).json({ error: 'فشل في تحميل سجل النشاط' });
  }
});

/**
 * @swagger
 * /api/open-tasks/{id}/activity:
 *   post:
 *     tags: [Open Tasks]
 *     summary: Add activity log entry to task
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: true
 *         description: Branch context ID
 *       - in: path
 *         name: id
 *         schema:
 *           type: integer
 *         required: true
 *         description: Task ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               eventType:
 *                 type: string
 *               oldValue:
 *                 type: string
 *               newValue:
 *                 type: string
 *               notes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Success
 *       400:
 *         description: Bad Request
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Not Found
 *       500:
 *         description: Internal Server Error
 */
router.post('/:id/activity', requirePermission('open_tasks.edit'), async (req, res) => {
  try {
    const authContext = getAuthContext(req);
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'معرف المهمة غير صالح' });

    const { rows: taskRows } = await pool.query('SELECT branch_id FROM open_tasks WHERE id = $1', [id]);
    if (taskRows.length === 0) return res.status(404).json({ error: 'المهمة غير موجودة' });
    if (!canEditOpenTask(authContext, taskRows[0].branch_id).allowed) {
      return res.status(403).json({ error: 'ليس لديك صلاحية الوصول لهذه المهمة' });
    }

    const { eventType, oldValue, newValue, reason, referenceId } = req.body ?? {};
    const VALID_EVENT_TYPES = ['status_change', 'note_added', 'needs_follow_up', 'rescheduled', 'assigned', 'reassigned', 'call_made', 'priority_changed', 'team_assigned', 'offer_presented', 'customer_response'];
    if (!eventType || !VALID_EVENT_TYPES.includes(eventType)) {
      return res.status(400).json({ error: 'نوع الحدث غير صالح' });
    }

    // Normalize incoming event type to what the DB CHECK constraint allows
    const normalizedEventType = (eventType === 'needs_follow_up' || eventType === 'needs_reschedule') ? 'rescheduled' : eventType;

    const performedBy = authContext.userId;
    const userRole = (req as any).user?.role ?? null;

    const { rows } = await pool.query(
      `INSERT INTO task_activity_log (task_id, event_type, performed_by, role, old_value, new_value, reason, reference_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING
         id,
         event_type AS "eventType",
         performed_by AS "performedBy",
         role,
         old_value AS "oldValue",
         new_value AS "newValue",
         reason,
         reference_id AS "referenceId",
         created_at AS "createdAt"`,
      [id, normalizedEventType, performedBy, userRole, oldValue ?? null, newValue ?? null, reason ?? null, referenceId ?? null],
    );

    // Bump attempt_count + last_attempt_at on every call_made event (denormalized for fast ordering/filtering)
    if (normalizedEventType === 'call_made') {
      await pool.query(
        `UPDATE open_tasks
         SET attempt_count = attempt_count + 1,
             last_attempt_at = NOW(),
             updated_at = NOW()
         WHERE id = $1`,
        [id],
      );
    }

    res.json(rows[0]);
  } catch (err: any) {
    console.error('[open-tasks] POST /:id/activity error:', err);
    res.status(500).json({ error: 'فشل في إضافة الحدث' });
  }
});

/**
 * @swagger
 * /api/open-tasks/{id}/devices:
 *   get:
 *     tags: [Open Tasks]
 *     summary: Get devices assigned to a task
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: true
 *         description: Branch context ID
 *       - in: path
 *         name: id
 *         schema:
 *           type: integer
 *         required: true
 *         description: Task ID
 *       - in: query
 *         name: branchId
 *         schema:
 *           type: integer
 *         required: false
 *         description: Filter by branch ID
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         required: false
 *         description: Search term
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *         required: false
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         required: false
 *         description: Number of items per page
 *     responses:
 *       200:
 *         description: Success
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Not Found
 *       500:
 *         description: Internal Server Error
 */
// ── سياق المهمة: سلسلة محاولات التنفيذ (visit_tasks تحت نفس المهمة) ──────────
// Each visit_task is one execution attempt ("chapter") of this task. Returns the
// chain ordered chronologically, each with its visit + general result.
router.get('/:id/attempts', requirePermission('open_tasks.view'), async (req, res) => {
  try {
    const authContext = getAuthContext(req);
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'معرف المهمة غير صالح' });

    const { rows: taskRows } = await pool.query(
      'SELECT branch_id, status FROM open_tasks WHERE id = $1', [id],
    );
    if (taskRows.length === 0) return res.status(404).json({ error: 'المهمة غير موجودة' });
    if (!canViewOpenTask(authContext, taskRows[0].branch_id).allowed) {
      return res.status(403).json({ error: 'ليس لديك صلاحية الوصول لهذه المهمة' });
    }

    const { rows } = await pool.query(
      `SELECT
         vt.id           AS "visitTaskId",
         vt.status       AS "taskStatus",
         vt.sequence_no  AS "sequenceNo",
         vt.created_at   AS "createdAt",
         fv.id           AS "visitId",
         fv.scheduled_date AS "scheduledDate",
         fv.scheduled_time AS "scheduledTime",
         fv.status       AS "visitStatus",
         ttc.arabic_label AS "arabicLabel",
         vtr.final_decision AS "finalDecision",
         vtr.reason_code    AS "reasonCode",
         vtr.closing_notes  AS "closingNotes",
         vtr.closed_at      AS "closedAt"
       FROM visit_tasks vt
       JOIN field_visits fv ON fv.id = vt.field_visit_id
       LEFT JOIN visit_task_results vtr ON vtr.visit_task_id = vt.id
       LEFT JOIN task_type_config ttc ON ttc.task_type = vt.task_type
       WHERE vt.source_open_task_id = $1
       ORDER BY fv.scheduled_date ASC NULLS LAST, vt.created_at ASC`,
      [id],
    );

    res.json({ taskStatus: taskRows[0].status, attempts: rows });
  } catch (err: any) {
    console.error('[open-tasks] GET /:id/attempts error:', err);
    res.status(500).json({ error: 'فشل في تحميل سياق المهمة' });
  }
});

router.get('/:id/devices', requirePermission('open_tasks.view'), async (req, res) => {
  try {
    const authContext = getAuthContext(req);
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'معرف المهمة غير صالح' });

    const { rows: taskRows } = await pool.query('SELECT branch_id FROM open_tasks WHERE id = $1', [id]);
    if (taskRows.length === 0) return res.status(404).json({ error: 'المهمة غير موجودة' });
    if (!canViewOpenTask(authContext, taskRows[0].branch_id).allowed) {
      return res.status(403).json({ error: 'ليس لديك صلاحية الوصول لهذه المهمة' });
    }

    const { rows } = await pool.query(
      `SELECT
        otd.id,
        otd.device_model_id AS "deviceModelId",
        otd.device_name_snapshot AS "deviceName",
        otd.quantity
      FROM open_task_devices otd
      WHERE otd.task_id = $1
      ORDER BY otd.created_at`,
      [id],
    );
    if (rows.length > 0) return res.json(rows);

    // Plan 2026-06-10 Phase 2.3 — telemarketing_appointments fallback removed.
    // open_task_devices is 100% reliable (verified 2026-06-10: 24/24 device_demo
    // tasks have device rows, 0 orphans). The remaining fallback below covers
    // the field_visits.customer_snapshot path for legacy snapshots.

    // Fallback: field_visits device name via visit_tasks link
    const { rows: mvRows } = await pool.query(
      `SELECT
        fv.id,
        (fv.customer_snapshot->>'requestedDeviceModelId')::integer AS "deviceModelId",
        (fv.customer_snapshot->>'requestedDeviceName') AS "deviceName",
        1 AS quantity
      FROM field_visits fv
      JOIN visit_tasks vt ON vt.field_visit_id = fv.id
      WHERE vt.source_open_task_id = $1
        AND fv.customer_snapshot->>'requestedDeviceName' IS NOT NULL
      ORDER BY fv.created_at
      LIMIT 1`,
      [id],
    );
    return res.json(mvRows);
  } catch (err: any) {
    console.error('[open-tasks] GET /:id/devices error:', err);
    res.status(500).json({ error: 'فشل في تحميل الأجهزة' });
  }
});

/**
 * @swagger
 * /api/open-tasks/{id}/devices:
 *   post:
 *     tags: [Open Tasks]
 *     summary: Update devices for a task
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: true
 *         description: Branch context ID
 *       - in: path
 *         name: id
 *         schema:
 *           type: integer
 *         required: true
 *         description: Task ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               devices:
 *                 type: array
 *                 items:
 *                   type: object
 *     responses:
 *       200:
 *         description: Success
 *       400:
 *         description: Bad Request
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Not Found
 *       500:
 *         description: Internal Server Error
 */
router.post('/:id/devices', requirePermission('open_tasks.edit'), async (req, res) => {
  try {
    const authContext = getAuthContext(req);
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'معرف المهمة غير صالح' });

    const { rows: taskRows } = await pool.query('SELECT branch_id FROM open_tasks WHERE id = $1', [id]);
    if (taskRows.length === 0) return res.status(404).json({ error: 'المهمة غير موجودة' });
    if (!canEditOpenTask(authContext, taskRows[0].branch_id).allowed) {
      return res.status(403).json({ error: 'ليس لديك صلاحية الوصول لهذه المهمة' });
    }

    const devices: any[] = Array.isArray(req.body?.devices) ? req.body.devices : [];
    if (devices.length === 0) return res.status(400).json({ error: 'لا توجد أجهزة للإضافة' });

    const inserted: any[] = [];
    for (const device of devices) {
      if (!device.deviceName) continue;
      const qty = Number.isInteger(Number(device.quantity)) && Number(device.quantity) > 0 ? Number(device.quantity) : 1;
      const { rows } = await pool.query(
        `INSERT INTO open_task_devices (task_id, device_model_id, device_name_snapshot, quantity)
         VALUES ($1, $2, $3, $4)
         RETURNING id, device_model_id AS "deviceModelId", device_name_snapshot AS "deviceName", quantity`,
        [id, device.deviceModelId ?? null, String(device.deviceName), qty],
      );
      if (rows[0]) inserted.push(rows[0]);
    }
    res.json(inserted);
  } catch (err: any) {
    console.error('[open-tasks] POST /:id/devices error:', err);
    res.status(500).json({ error: 'فشل في إضافة الأجهزة' });
  }
});

/**
 * @swagger
 * /api/open-tasks/{id}/calls:
 *   get:
 *     tags: [Open Tasks]
 *     summary: Get calls associated with a task
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: true
 *         description: Branch context ID
 *       - in: path
 *         name: id
 *         schema:
 *           type: integer
 *         required: true
 *         description: Task ID
 *       - in: query
 *         name: branchId
 *         schema:
 *           type: integer
 *         required: false
 *         description: Filter by branch ID
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         required: false
 *         description: Search term
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *         required: false
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         required: false
 *         description: Number of items per page
 *     responses:
 *       200:
 *         description: Success
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Not Found
 *       500:
 *         description: Internal Server Error
 */
router.get('/:id/calls', requirePermission('open_tasks.view'), async (req, res) => {
  try {
    const authContext = getAuthContext(req);
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'معرف المهمة غير صالح' });

    const { rows: taskRows } = await pool.query('SELECT branch_id, client_id FROM open_tasks WHERE id = $1', [id]);
    if (taskRows.length === 0) return res.status(404).json({ error: 'المهمة غير موجودة' });
    if (!canViewOpenTask(authContext, taskRows[0].branch_id).allowed) {
      return res.status(403).json({ error: 'ليس لديك صلاحية الوصول لهذه المهمة' });
    }

    const { rows } = await pool.query(
      `SELECT
        ccl.id,
        ccl.caller_id              AS "userId",
        ccl.source_type            AS "callType",
        ccl.outcome,
        ccl.notes,
        ccl.call_date              AS "callDate",
        ccl.communication_channel  AS "communicationChannel",
        ccl.contact_label          AS "contactLabel",
        ccl.status,
        ccl.created_at             AS "createdAt",
        hu.name                    AS "telemarketerName",
        COALESCE(
          (SELECT json_agg(jsonb_build_object(
                   'taskId',      ot2.id,
                   'taskType',    ot2.task_type,
                   'arabicLabel', COALESCE(ttc2.arabic_label, ot2.task_type)
                 ) ORDER BY ot2.id)
             FROM call_task_links ctl2
             JOIN open_tasks ot2 ON ot2.id = ctl2.task_id
             LEFT JOIN task_type_config ttc2 ON ttc2.task_type = ot2.task_type
            WHERE ctl2.call_id = ccl.id
              AND ctl2.task_id != $1),
          '[]'::json
        ) AS "siblingTasks"
      FROM customer_call_logs ccl
      JOIN call_task_links ctl ON ctl.call_id = ccl.id
      LEFT JOIN hr_users hu ON hu.id = ccl.caller_id
      WHERE ctl.task_id = $1
      ORDER BY ccl.call_date DESC`,
      [id],
    );
    if (rows.length > 0) return res.json(rows);

    // Legacy fallback: calls linked via task_list_items before call_task_links was populated
    const { rows: legacyRows } = await pool.query(
      `SELECT
        ccl.id,
        ccl.caller_id              AS "userId",
        ccl.source_type            AS "callType",
        ccl.outcome,
        ccl.notes,
        ccl.call_date              AS "callDate",
        ccl.communication_channel  AS "communicationChannel",
        ccl.contact_label          AS "contactLabel",
        ccl.status,
        ccl.created_at             AS "createdAt",
        hu.name                    AS "telemarketerName",
        '[]'::json                 AS "siblingTasks"
      FROM telemarketing_task_list_items tli
      JOIN customer_call_logs ccl ON ccl.source_type = 'telemarketing_task' AND ccl.source_id = tli.id
      LEFT JOIN hr_users hu ON hu.id = ccl.caller_id
      WHERE tli.open_task_id = $1
      ORDER BY ccl.call_date DESC`,
      [id],
    );
    return res.json(legacyRows);
  } catch (err: any) {
    console.error('[open-tasks] GET /:id/calls error:', err);
    res.status(500).json({ error: 'فشل في تحميل المكالمات' });
  }
});

// ============================================================================
// POST /open-tasks/:id/schedule-from-expected — DEC-004 D22
// ============================================================================
// Books a field_visit from a needs_follow_up task whose expected_date is in
// hand, without going through a fresh call. The customer's commitment was
// captured in a previous call (customer_requested_followup outcome).
router.post('/:id/schedule-from-expected', requirePermission('telemarketing.appointments.book'), async (req, res) => {
  try {
    const taskId = Number(req.params.id);
    if (!Number.isInteger(taskId) || taskId <= 0) {
      return res.status(400).json({ error: 'taskId غير صالح' });
    }
    const performedByUserId = (req as any).authContext?.userId ?? null;
    const body = req.body ?? {};

    // 1. Load the open_task and confirm it's eligible
    const { rows: taskRows } = await pool.query(
      `SELECT id, client_id, branch_id, task_type, status, expected_date, expected_time
         FROM open_tasks
        WHERE id = $1
        LIMIT 1`,
      [taskId],
    );
    if (taskRows.length === 0) {
      return res.status(404).json({ error: 'المهمة غير موجودة' });
    }
    const task = taskRows[0];
    const liveStatuses = new Set(['needs_follow_up', 'assigned', 'in_scheduling']);
    if (!liveStatuses.has(task.status)) {
      return res.status(409).json({
        error: `الحجز المباشر غير متاح للمهام بحالة ${task.status}`,
      });
    }
    if (!task.expected_date) {
      return res.status(400).json({
        error: 'expected_date غير محدد على هذه المهمة — لا يمكن الجدولة من موعد متوقع.',
      });
    }

    const scheduledDate = String(body.date ?? task.expected_date).slice(0, 10);
    const scheduledTime = String(body.timeSlot ?? task.expected_time ?? '');
    const teamKey = String(body.teamKey ?? '');
    if (!teamKey) {
      return res.status(400).json({ error: 'teamKey مطلوب' });
    }

    const rawSelectedTasks = Array.isArray(body.selectedOpenTasks) ? body.selectedOpenTasks : [];
    const selectedTaskIds = Array.from(new Set(
      rawSelectedTasks
        .map((item: any) => Number(item?.openTaskId))
        .filter((id: number) => Number.isInteger(id) && id > 0),
    ));
    if (!selectedTaskIds.includes(taskId)) {
      selectedTaskIds.unshift(taskId);
    }

    const { rows: selectedTaskRows } = await pool.query(
      `SELECT id, client_id, branch_id, task_type, status
         FROM open_tasks
        WHERE id = ANY($1::int[])
        ORDER BY array_position($1::int[], id)`,
      [selectedTaskIds],
    );

    if (selectedTaskRows.length !== selectedTaskIds.length) {
      return res.status(404).json({ error: 'توجد مهمة مختارة غير موجودة' });
    }

    for (const selectedTask of selectedTaskRows) {
      if (Number(selectedTask.client_id) !== Number(task.client_id) || Number(selectedTask.branch_id) !== Number(task.branch_id)) {
        return res.status(400).json({ error: 'لا يمكن حجز مهام من زبائن أو فروع مختلفة ضمن نفس الحجز المباشر' });
      }
      if (!liveStatuses.has(selectedTask.status)) {
        return res.status(409).json({ error: `لا يمكن حجز المهمة #${selectedTask.id} مباشرة لأنها بحالة ${selectedTask.status}` });
      }
    }

    const contactTargetId = Number(body.contactTargetId);
    try {
      await claimContactTarget(
        pool,
        Number.isInteger(contactTargetId) && contactTargetId > 0 ? contactTargetId : null,
        performedByUserId,
      );
    } catch (err: any) {
      if (err instanceof ContactTargetLockError) {
        return res.status(err.statusCode).json({ error: err.message, ownerName: err.ownerName });
      }
      throw err;
    }

    const result = await bookVisit({
      branchId: Number(task.branch_id),
      clientId: Number(task.client_id),
      scheduledDate,
      scheduledTime,
      teamKey,
      // DEC-004 D22: origin_type = 'expected_followup'; origin_id = source open_task id
      originType: 'expected_followup',
      originId: taskId,
      selectedTasks: selectedTaskRows.map((selectedTask: any) => ({
        openTaskId: Number(selectedTask.id),
        taskType: String(selectedTask.task_type ?? 'device_demo'),
      })),
      performedByUserId,
      customerSnapshot: body.customerSnapshot ?? null,
      telemarketerNotes: body.notes ?? null,
    });

    if (Number.isInteger(contactTargetId) && contactTargetId > 0) {
      await pool.query(
        `UPDATE contact_targets
            SET status = 'closed',
                closing_reason = 'booked',
                latest_visit_id = $1,
                latest_call_outcome = COALESCE(latest_call_outcome, 'booked_marketing_appointment'),
                closed_at = NOW(),
                updated_at = NOW()
          WHERE id = $2`,
        [result.fieldVisitId, contactTargetId],
      );
    }

    if (body.taskListId) {
      const taskListId = String(body.taskListId);
      const rawItemIds = Array.isArray(body.taskListItemIds)
        ? body.taskListItemIds
        : body.taskListItemId
          ? [body.taskListItemId]
          : [];
      const itemIds = rawItemIds.map((itemId: any) => String(itemId)).filter(Boolean);
      if (itemIds.length > 0) {
        await pool.query(
          `UPDATE telemarketing_task_list_items
              SET status = 'booked',
                  call_outcome = 'booked_marketing_appointment'
            WHERE task_list_id = $1
              AND id = ANY($2::text[])`,
          [taskListId, itemIds],
        );
      }
    }

    return res.json({
      fieldVisitId: result.fieldVisitId,
      visitTaskIds: result.visitTaskIds,
      contactTargetId: Number.isInteger(contactTargetId) && contactTargetId > 0 ? contactTargetId : null,
    });
  } catch (err: any) {
    if (err instanceof BookingError) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    console.error('[schedule-from-expected] failed', err);
    return res.status(500).json({ error: err?.message ?? 'فشل الجدولة من الموعد المتوقع' });
  }
});

// ============================================================
// Service Requests companions (Phase 3 — maintenance.md §٠.١٩.ح)
// ============================================================
//   GET /:id/problems         — fetch the diagnosed problems list
//   GET /:id/derived-outcome  — computed outcome label

import { computeDerivedOutcome } from '../services/serviceRequests/derivedOutcomeCalc.js';

router.get('/:id/problems', requirePermission('open_tasks.view'), async (req, res) => {
  const id = Number(req.params.id);
  const { rows } = await pool.query(
    `SELECT id,
            service_request_id AS "serviceRequestId",
            open_task_id AS "openTaskId",
            installed_device_id AS "installedDeviceId",
            problem_type_id AS "problemTypeId",
            details,
            status,
            added_during_phase AS "addedDuringPhase",
            creator_role_snapshot AS "creatorRoleSnapshot",
            created_by_user_id AS "createdByUserId",
            created_at AS "createdAt",
            resolved_at AS "resolvedAt",
            resolution_recorded_by_user_id AS "resolutionRecordedByUserId",
            repaired_by_employee_id AS "repairedByEmployeeId",
            resolution_visit_task_id AS "resolutionVisitTaskId",
            resolution_notes AS "resolutionNotes",
            edit_count AS "editCount",
            last_edited_at AS "lastEditedAt"
       FROM service_request_problems
      WHERE open_task_id = $1 AND deleted_at IS NULL
      ORDER BY created_at ASC`,
    [id],
  );
  res.json({ items: rows, total: rows.length });
});

router.get('/:id/derived-outcome', requirePermission('open_tasks.view'), async (req, res) => {
  const breakdown = await computeDerivedOutcome(Number(req.params.id));
  res.json(breakdown);
});

export default router;
