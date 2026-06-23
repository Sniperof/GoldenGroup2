import { Router } from 'express';
import pool from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permission.js';
import { authorize } from '../services/authorizationService.js';
import type { AuthContext } from '@golden-crm/shared';
import { canViewFieldVisit, canEditFieldVisit, getFieldVisitListAccessPlan } from '../policies/fieldVisitPolicy.js';
import { checkAndCompleteVisit } from '../services/visitCompletion.js';
import { hasBlockingUndocumentedVisit } from '../services/visitEscalationJob.js';
import { applyDeviceActivationResult, applyDeviceDeliveryResult, applyDeviceDemoResult, applyDeviceDisconnectionResult, applyDeviceInstallationResult, applyEmergencyMaintenanceLifecycleResult, applyGoldenWarrantyOfferResult, applyGoldenWarrantyCardDeliveryResult, applyInstallmentCollectionResult, ResultValidationError } from '../services/visitTaskResultReflection.js';
import {
  buildClientLifecycleStatusSql,
  buildCustomerOwnershipSql,
  mapCustomerOwnership,
} from '../services/customerOwnership.js';
import { createInstantVisit, BookingError } from '../services/visitBooking.js';

const router = Router();
router.use(requireAuth);

function getAuthContext(req: any) {
  if (!req.authContext) throw new Error('AuthContext is required');
  return req.authContext as AuthContext;
}

// Haversine distance in metres between two lat/lng points
function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

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

// Resolve visit source from client ownership + team_snapshot stored on field_visit
async function resolveVisitSource(visitId: number): Promise<{
  source_type: string;
  source_label: string;
  actor_employee_ids: number[];
} | null> {
  const { rows: fvRows } = await pool.query(
    `SELECT fv.client_id, fv.branch_id, fv.team_snapshot,
            c.candidate_status,
            b.name AS branch_name
     FROM field_visits fv
     JOIN clients c ON c.id = fv.client_id
     LEFT JOIN branches b ON b.id = fv.branch_id
     WHERE fv.id = $1`,
    [visitId],
  );
  if (!fvRows[0]) return null;

  const fv = fvRows[0];
  const teamSnap = fv.team_snapshot as any;
  const isOpFop = ['OP', 'FOP'].includes(fv.candidate_status ?? '');

  // Check personal assignments
  const { rows: assignRows } = await pool.query(
    `SELECT u.id AS hr_user_id, u.name, u.employee_id, r.team_slot_type
     FROM client_assignments ca
     JOIN hr_users u ON u.id = ca.hr_user_id
     LEFT JOIN roles r ON r.id = u.role_id
     WHERE ca.client_id = $1
       AND u.is_active = TRUE
       AND u.employee_id IS NOT NULL
       AND r.team_slot_type IN ('SUPERVISOR', 'TECHNICIAN')`,
    [fv.client_id],
  );

  if (isOpFop || assignRows.length === 0) {
    return {
      source_type: fv.branch_id ? 'company_branch' : 'company_global',
      source_label: fv.branch_id
        ? `فرع: ${fv.branch_name ?? fv.branch_id}`
        : 'الشركة',
      actor_employee_ids: [],
    };
  }

  // Match assignments to team snapshot
  let hasSup = false;
  let hasTech = false;
  const actorIds: number[] = [];
  const labels: string[] = [];

  for (const a of assignRows) {
    if (a.team_slot_type === 'SUPERVISOR') {
      hasSup = true;
      actorIds.push(a.employee_id);
      labels.push(`مشرف: ${a.name}`);
    } else if (a.team_slot_type === 'TECHNICIAN') {
      hasTech = true;
      actorIds.push(a.employee_id);
      labels.push(`فني: ${a.name}`);
    }
  }

  // Fall back to team_snapshot names if assignment list is empty
  if (labels.length === 0 && teamSnap) {
    if (teamSnap.supervisor?.name) labels.push(`مشرف: ${teamSnap.supervisor.name}`);
    if (teamSnap.technician?.name) labels.push(`فني: ${teamSnap.technician.name}`);
  }

  const sourceType = hasSup && hasTech ? 'both' : hasSup ? 'supervisor' : 'technician';
  return {
    source_type: sourceType,
    source_label: labels.join(' + ') || 'غير محدد',
    actor_employee_ids: actorIds,
  };
}

// ─── GEO TRACKING ────────────────────────────────────────────────────────────

// POST /api/field-visits/:id/start
/**
 * @swagger
 * components:
 *   schemas:
 *     FieldVisit:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *         visitType:
 *           type: string
 *         visitFamily:
 *           type: string
 *         status:
 *           type: string
 *         scheduledDate:
 *           type: string
 *         scheduledTime:
 *           type: string
 *         clientId:
 *           type: integer
 *         branchId:
 *           type: integer
 *         teamSnapshot:
 *           type: object
 *         customerSnapshot:
 *           type: object
 *         fieldNotes:
 *           type: string
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 *     VisitGeoLog:
 *       type: object
 *       properties:
 *         visit_id:
 *           type: integer
 *         actual_start_time:
 *           type: string
 *           format: date-time
 *         actual_start_lat:
 *           type: number
 *         actual_start_lng:
 *           type: number
 *         actual_start_accuracy:
 *           type: number
 *         actual_end_time:
 *           type: string
 *           format: date-time
 *         actual_end_lat:
 *           type: number
 *         actual_end_lng:
 *           type: number
 *         actual_end_accuracy:
 *           type: number
 *         duration_minutes:
 *           type: integer
 *         distance_meters:
 *           type: number
 *         location_missing:
 *           type: boolean
 *     VisitSource:
 *       type: object
 *       properties:
 *         visit_id:
 *           type: integer
 *         source_type:
 *           type: string
 *         source_label:
 *           type: string
 *         actor_employee_ids:
 *           type: array
 *           items:
 *             type: integer
 *     VisitNameCollection:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *         visit_task_id:
 *           type: integer
 *         client_id:
 *           type: integer
 *         proposed_count:
 *           type: integer
 *         actual_count:
 *           type: integer
 *         referral_sheet_id:
 *           type: integer
 *         status:
 *           type: string
 *         notes:
 *           type: string
 *     DirectSuggestion:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *         visit_task_id:
 *           type: integer
 *         client_id:
 *           type: integer
 *         name:
 *           type: string
 *         phone:
 *           type: string
 *         is_direct:
 *           type: boolean
 *         notes:
 *           type: string
 */

/**
 * @swagger
 * /api/field-visits/{id}/start:
 *   post:
 *     tags: [Field Visits]
 *     summary: Start a field visit
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Branch ID
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Field Visit ID
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               lat:
 *                 type: number
 *               lng:
 *                 type: number
 *               accuracy:
 *                 type: number
 *     responses:
 *       200:
 *         description: Start recorded successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 geo:
 *                   $ref: '#/components/schemas/VisitGeoLog'
 *       400:
 *         description: Invalid visit ID
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Visit not found
 *       500:
 *         description: Server error
 */
// DEC-011: field-initiated instant visit — created already in_progress for a
// customer in the team's branch + today's route zones. Starts empty (tasks via
// the pull flow, DEC-010). Guards (branch/zone/cooldown/D18) live in the service.
router.post('/instant', requirePermission('field_visits.create_instant'), async (req, res) => {
  try {
    const authContext = getAuthContext(req);
    const clientId = Number(req.body?.clientId);
    if (!Number.isInteger(clientId) || clientId <= 0) {
      return res.status(400).json({ error: 'clientId مطلوب' });
    }
    if (authContext.userId == null) {
      return res.status(401).json({ error: 'مستخدم غير معروف' });
    }
    const result = await createInstantVisit({
      performedByUserId: authContext.userId,
      clientId,
      lat: req.body?.lat != null ? Number(req.body.lat) : null,
      lng: req.body?.lng != null ? Number(req.body.lng) : null,
      accuracy: req.body?.accuracy != null ? Number(req.body.accuracy) : null,
      locationMissingReasonId: Number(req.body?.locationMissingReasonId) || null,
    });
    return res.json({ success: true, ...result });
  } catch (err: any) {
    if (err instanceof BookingError) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    console.error('[field-visits] POST /instant error:', err);
    return res.status(500).json({ error: err?.message ?? 'فشل إنشاء الزيارة الفورية' });
  }
});

router.post('/:id/start', requirePermission('field_visits.edit'), async (req, res) => {
  try {
    const authContext = getAuthContext(req);
    const visitId = Number(req.params.id);
    if (!Number.isFinite(visitId)) return res.status(400).json({ error: 'معرف الزيارة غير صالح' });

    const { rows: fvRows } = await pool.query(
      'SELECT id, branch_id, status FROM field_visits WHERE id = $1',
      [visitId],
    );
    if (!fvRows[0]) return res.status(404).json({ error: 'الزيارة غير موجودة' });
    if (!canEditFieldVisit(authContext, fvRows[0].branch_id).allowed) {
      return res.status(403).json({ error: 'ليس لديك صلاحية الوصول' });
    }

    // DEC-006 D38 L2: a technician with an undocumented visit older than L2 hours
    // is barred from starting new visits. They must close out the previous one first.
    if (authContext.userId != null) {
      const block = await hasBlockingUndocumentedVisit(authContext.userId);
      if (block.blocked) {
        return res.status(409).json({
          error: `لا يمكن بدء زيارة جديدة — لديك زيارة #${block.visitId} منذ ${block.hoursSinceUpdate} ساعة بدون توثيق (DEC-006 D38 L2). أغلقها أولاً.`,
          blockingVisitId: block.visitId,
        });
      }
    }

    const lat = req.body?.lat != null ? Number(req.body.lat) : null;
    const lng = req.body?.lng != null ? Number(req.body.lng) : null;
    const accuracy = req.body?.accuracy != null ? Number(req.body.accuracy) : null;
    const locationMissingReasonId = Number(req.body?.locationMissingReasonId) || null;
    const locationMissing = lat === null || lng === null || !Number.isFinite(lat) || !Number.isFinite(lng);

    // DEC-004 D17: when location_missing, a reason from system_lists is required.
    if (locationMissing && (!locationMissingReasonId || locationMissingReasonId <= 0)) {
      return res.status(400).json({
        error: 'GPS غير متاح — يجب اختيار سبب من القائمة (locationMissingReasonId).',
      });
    }

    const now = new Date();

    await pool.query(
      `INSERT INTO visit_geo_logs (visit_id, actual_start_time, actual_start_lat, actual_start_lng,
         actual_start_accuracy, location_missing, location_missing_reason, started_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
       ON CONFLICT (visit_id) DO UPDATE SET
         actual_start_time       = EXCLUDED.actual_start_time,
         actual_start_lat        = EXCLUDED.actual_start_lat,
         actual_start_lng        = EXCLUDED.actual_start_lng,
         actual_start_accuracy   = EXCLUDED.actual_start_accuracy,
         location_missing        = EXCLUDED.location_missing,
         location_missing_reason = COALESCE(EXCLUDED.location_missing_reason, visit_geo_logs.location_missing_reason),
         started_by              = COALESCE(EXCLUDED.started_by, visit_geo_logs.started_by),
         updated_at              = NOW()`,
      [
        visitId,
        now,
        locationMissing ? null : lat,
        locationMissing ? null : lng,
        accuracy && Number.isFinite(accuracy) ? Math.round(accuracy) : null,
        locationMissing,
        locationMissing ? locationMissingReasonId : null,
        authContext.userId ?? null,
      ],
    );

    await pool.query(
      `UPDATE field_visits SET status = 'in_progress', updated_at = NOW()
       WHERE id = $1 AND status NOT IN ('ended','completed','cancelled','closed')`,
      [visitId],
    );

    // Propagate to linked open_tasks: scheduled → in_execution so the
    // group page derives the correct phase (execution, not planning).
    await pool.query(
      `UPDATE open_tasks SET status = 'in_execution', updated_at = NOW()
         WHERE id IN (
           SELECT source_open_task_id FROM visit_tasks
            WHERE field_visit_id = $1 AND source_open_task_id IS NOT NULL
         )
           AND status IN ('scheduled', 'waiting_execution')`,
      [visitId],
    );

    // Auto-create visit_source if not yet present
    const src = await resolveVisitSource(visitId);
    if (src) {
      await pool.query(
        `INSERT INTO visit_sources (visit_id, source_type, source_label, actor_employee_ids)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (visit_id) DO NOTHING`,
        [visitId, src.source_type, src.source_label, src.actor_employee_ids],
      );
    }

    const { rows: geoRows } = await pool.query(
      'SELECT * FROM visit_geo_logs WHERE visit_id = $1',
      [visitId],
    );
    res.json({ success: true, geo: geoRows[0] ?? null });
  } catch (err: any) {
    console.error('[field-visits] POST /:id/start error:', err);
    res.status(500).json({ error: 'فشل في تسجيل بداية الزيارة' });
  }
});

// POST /api/field-visits/:id/end
/**
 * @swagger
 * /api/field-visits/{id}/end:
 *   post:
 *     tags: [Field Visits]
 *     summary: End a field visit
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Branch ID
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Field Visit ID
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               lat:
 *                 type: number
 *               lng:
 *                 type: number
 *               accuracy:
 *                 type: number
 *     responses:
 *       200:
 *         description: End recorded successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 geo:
 *                   $ref: '#/components/schemas/VisitGeoLog'
 *       400:
 *         description: Invalid visit ID
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Visit not found
 *       500:
 *         description: Server error
 */
router.post('/:id/end', requirePermission('field_visits.edit'), async (req, res) => {
  try {
    const authContext = getAuthContext(req);
    const visitId = Number(req.params.id);
    if (!Number.isFinite(visitId)) return res.status(400).json({ error: 'معرف الزيارة غير صالح' });

    const { rows: fvRows } = await pool.query(
      'SELECT id, branch_id, status FROM field_visits WHERE id = $1',
      [visitId],
    );
    if (!fvRows[0]) return res.status(404).json({ error: 'الزيارة غير موجودة' });
    if (!canEditFieldVisit(authContext, fvRows[0].branch_id).allowed) {
      return res.status(403).json({ error: 'ليس لديك صلاحية الوصول' });
    }

    const lat = req.body?.lat != null ? Number(req.body.lat) : null;
    const lng = req.body?.lng != null ? Number(req.body.lng) : null;
    const accuracy = req.body?.accuracy != null ? Number(req.body.accuracy) : null;
    const locationMissingReasonId = Number(req.body?.locationMissingReasonId) || null;
    const locationMissing = lat === null || lng === null || !Number.isFinite(lat) || !Number.isFinite(lng);

    if (locationMissing && (!locationMissingReasonId || locationMissingReasonId <= 0)) {
      return res.status(400).json({
        error: 'GPS غير متاح — يجب اختيار سبب من القائمة (locationMissingReasonId).',
      });
    }

    const now = new Date();

    // Fetch existing geo log for duration/distance computation
    const { rows: geoRows } = await pool.query(
      'SELECT actual_start_time, actual_start_lat, actual_start_lng FROM visit_geo_logs WHERE visit_id = $1',
      [visitId],
    );
    const existing = geoRows[0];

    let durationMinutes: number | null = null;
    let distanceMeters: number | null = null;

    if (existing?.actual_start_time) {
      const startMs = new Date(existing.actual_start_time).getTime();
      durationMinutes = Math.round((now.getTime() - startMs) / 60000);
    }

    if (!locationMissing && existing?.actual_start_lat != null && existing?.actual_start_lng != null) {
      distanceMeters = haversineMeters(
        Number(existing.actual_start_lat), Number(existing.actual_start_lng),
        lat!, lng!,
      );
    }

    await pool.query(
      `INSERT INTO visit_geo_logs (visit_id, actual_end_time, actual_end_lat, actual_end_lng,
         actual_end_accuracy, duration_minutes, distance_meters, location_missing, location_missing_reason, ended_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
       ON CONFLICT (visit_id) DO UPDATE SET
         actual_end_time         = EXCLUDED.actual_end_time,
         actual_end_lat          = EXCLUDED.actual_end_lat,
         actual_end_lng          = EXCLUDED.actual_end_lng,
         actual_end_accuracy     = EXCLUDED.actual_end_accuracy,
         duration_minutes        = EXCLUDED.duration_minutes,
         distance_meters         = EXCLUDED.distance_meters,
         location_missing        = visit_geo_logs.location_missing OR EXCLUDED.location_missing,
         location_missing_reason = COALESCE(EXCLUDED.location_missing_reason, visit_geo_logs.location_missing_reason),
         ended_by                = COALESCE(EXCLUDED.ended_by, visit_geo_logs.ended_by),
         updated_at              = NOW()`,
      [
        visitId,
        now,
        locationMissing ? null : lat,
        locationMissing ? null : lng,
        accuracy && Number.isFinite(accuracy) ? Math.round(accuracy) : null,
        durationMinutes,
        distanceMeters,
        locationMissing,
        locationMissing ? locationMissingReasonId : null,
        authContext.userId ?? null,
      ],
    );

    await pool.query(
      `UPDATE field_visits SET status = 'ended', updated_at = NOW()
       WHERE id = $1 AND status NOT IN ('completed','cancelled','closed')`,
      [visitId],
    );

    // Propagate to linked open_tasks: in_execution → ended.
    // (completed/closed/cancelled are reached only after result is recorded.)
    await pool.query(
      `UPDATE open_tasks SET status = 'ended', updated_at = NOW()
         WHERE id IN (
           SELECT source_open_task_id FROM visit_tasks
            WHERE field_visit_id = $1 AND source_open_task_id IS NOT NULL
         )
           AND status = 'in_execution'`,
      [visitId],
    );

    const { rows: updatedGeoRows } = await pool.query(
      'SELECT * FROM visit_geo_logs WHERE visit_id = $1',
      [visitId],
    );
    res.json({ success: true, geo: updatedGeoRows[0] ?? null });
  } catch (err: any) {
    console.error('[field-visits] POST /:id/end error:', err);
    res.status(500).json({ error: 'فشل في تسجيل نهاية الزيارة' });
  }
});

// GET /api/field-visits/:id/geo
/**
 * @swagger
 * /api/field-visits/{id}/geo:
 *   get:
 *     tags: [Field Visits]
 *     summary: Get geo log for a field visit
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Branch ID
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Field Visit ID
 *     responses:
 *       200:
 *         description: Geo log retrieved
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/VisitGeoLog'
 *       400:
 *         description: Invalid visit ID
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get('/:id/geo', requirePermission('field_visits.view'), async (req, res) => {
  try {
    const visitId = Number(req.params.id);
    if (!Number.isFinite(visitId)) return res.status(400).json({ error: 'معرف الزيارة غير صالح' });

    const { rows } = await pool.query(
      'SELECT * FROM visit_geo_logs WHERE visit_id = $1',
      [visitId],
    );
    res.json(rows[0] ?? null);
  } catch (err: any) {
    console.error('[field-visits] GET /:id/geo error:', err);
    res.status(500).json({ error: 'فشل في تحميل بيانات الموقع' });
  }
});

// ─── VISIT SOURCE ─────────────────────────────────────────────────────────────

// GET /api/field-visits/:id/source
/**
 * @swagger
 * /api/field-visits/{id}/source:
 *   get:
 *     tags: [Field Visits]
 *     summary: Get source info for a field visit
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Branch ID
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Field Visit ID
 *     responses:
 *       200:
 *         description: Visit source retrieved
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/VisitSource'
 *       400:
 *         description: Invalid visit ID
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Visit not found
 *       500:
 *         description: Server error
 */
router.get('/:id/source', requirePermission('field_visits.view'), async (req, res) => {
  try {
    const visitId = Number(req.params.id);
    if (!Number.isFinite(visitId)) return res.status(400).json({ error: 'معرف الزيارة غير صالح' });

    // Return cached record if exists
    const { rows: cached } = await pool.query(
      'SELECT * FROM visit_sources WHERE visit_id = $1',
      [visitId],
    );
    if (cached[0]) return res.json(cached[0]);

    // Lazily create
    const src = await resolveVisitSource(visitId);
    if (!src) return res.status(404).json({ error: 'الزيارة غير موجودة' });

    const { rows: inserted } = await pool.query(
      `INSERT INTO visit_sources (visit_id, source_type, source_label, actor_employee_ids)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (visit_id) DO UPDATE SET
         source_type = EXCLUDED.source_type,
         source_label = EXCLUDED.source_label,
         actor_employee_ids = EXCLUDED.actor_employee_ids
       RETURNING *`,
      [visitId, src.source_type, src.source_label, src.actor_employee_ids],
    );
    res.json(inserted[0]);
  } catch (err: any) {
    console.error('[field-visits] GET /:id/source error:', err);
    res.status(500).json({ error: 'فشل في تحميل مصدر الزيارة' });
  }
});

// ─── LIST ─────────────────────────────────────────────────────────────────────

// GET /api/field-visits/?clientId=X  — visits for a specific client
// GET /api/field-visits/?date=YYYY-MM-DD  — visits for a specific date
/**
 * @swagger
 * /api/field-visits:
 *   get:
 *     tags: [Field Visits]
 *     summary: Retrieve a list of field visits
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Branch ID
 *       - in: query
 *         name: clientId
 *         schema:
 *           type: integer
 *         description: Filter by client ID
 *       - in: query
 *         name: date
 *         schema:
 *           type: string
 *         description: Filter by date (YYYY-MM-DD)
 *       - in: query
 *         name: branchId
 *         schema:
 *           type: integer
 *         description: Optional branch ID filter
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Optional search query
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *         description: Optional page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         description: Optional page size limit
 *     responses:
 *       200:
 *         description: List of field visits retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/FieldVisit'
 *       400:
 *         description: Must specify clientId or date
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get('/', requirePermission('clients.visits.view', 'field_visits.view'), async (req, res) => {
  try {
    const authContext = getAuthContext(req);
    const clientId = req.query.clientId ? Number(req.query.clientId) : null;
    const date = typeof req.query.date === 'string' ? req.query.date : null;
    const branchId = req.query.branchId ? Number(req.query.branchId) : null;
    const status = typeof req.query.status === 'string' ? req.query.status : null;
    const visitType = typeof req.query.visitType === 'string' ? req.query.visitType : null;
    const taskType = typeof req.query.taskType === 'string' ? req.query.taskType : null;
    const mineOnly = req.query.mineOnly === 'true';

    if (clientId === null && date === null) {
      return res.status(400).json({ error: 'يجب تحديد clientId أو date' });
    }

    if (clientId === null && !authorize(authContext as any, { permission: 'field_visits.view' }).allowed) {
      return res.status(403).json({ error: 'ط؛ظٹط± ظ…ط³ظ…ظˆط­' });
    }

    let employeeId: number | null = null;
    if (mineOnly) {
      const { rows: userRows } = await pool.query(
        `SELECT employee_id FROM hr_users WHERE id = $1 AND is_active = TRUE`,
        [authContext.userId],
      );
      const rawId = userRows[0]?.employee_id;
      employeeId = Number.isInteger(rawId) && rawId > 0 ? rawId : null;
    }

    const conditions: string[] = [];
    const params: any[] = [];
    let idx = 1;

    if (clientId !== null) {
      conditions.push(`fv.client_id = $${idx++}`);
      params.push(clientId);
    }
    if (date !== null) {
      conditions.push(`fv.scheduled_date = $${idx++}`);
      params.push(date);
    }
    if (status !== null) {
      conditions.push(`fv.status = $${idx++}`);
      params.push(status);
    }
    if (visitType !== null) {
      conditions.push(`fv.visit_type = $${idx++}`);
      params.push(visitType);
    }
    if (taskType !== null) {
      conditions.push(`EXISTS (
        SELECT 1 FROM visit_tasks vt_filter
        WHERE vt_filter.field_visit_id = fv.id
          AND vt_filter.task_type = $${idx++}
      )`);
      params.push(taskType);
    }
    // Branch predicate from grant scope: GLOBAL (or super-admin) sees every
    // branch, optionally narrowed by ?branchId; any narrower grant is confined
    // to the union of the actor's effective branch assignments.
    const fvPlan = getFieldVisitListAccessPlan(authContext);
    if (fvPlan.scope === 'GLOBAL') {
      if (branchId !== null) {
        conditions.push(`fv.branch_id = $${idx++}`);
        params.push(branchId);
      }
    } else if (fvPlan.allowedBranchIds.length > 0) {
      const branchFilter = branchId !== null && fvPlan.allowedBranchIds.includes(branchId)
        ? [branchId]
        : fvPlan.allowedBranchIds;
      conditions.push(`fv.branch_id = ANY($${idx++}::int[])`);
      params.push(branchFilter);
    } else {
      return res.json([]);
    }
    if (mineOnly && employeeId != null) {
      conditions.push(`(
        COALESCE(fv.reassigned_supervisor_id, NULLIF((fv.team_snapshot->>'supervisorEmployeeId')::text, '')::int) = $${idx++}
        OR COALESCE(fv.reassigned_technician_id, NULLIF((fv.team_snapshot->>'technicianEmployeeId')::text, '')::int) = $${idx++}
        OR COALESCE(fv.reassigned_trainee_id, NULLIF((fv.team_snapshot->>'traineeEmployeeId')::text, '')::int) = $${idx++}
      )`);
      params.push(employeeId, employeeId, employeeId);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await pool.query(
      `SELECT
         fv.id,
         fv.visit_type AS "visitType",
         fv.visit_family AS "visitFamily",
         fv.status,
         fv.scheduled_date AS "scheduledDate",
         fv.scheduled_time AS "scheduledTime",
         fv.client_id AS "clientId",
         fv.branch_id AS "branchId",
         fv.team_snapshot AS "teamSnapshot",
         -- Resolved team (DEC-007 D47): combines names from team_snapshot IDs
         -- with reassignment overrides. teamName is "فريق + اسم المسؤول" -
         -- supervisor for standard teams, technician for emergency.
         jsonb_build_object(
           'supervisor', CASE
             WHEN COALESCE(fv.reassigned_supervisor_id, NULLIF((fv.team_snapshot->>'supervisorEmployeeId')::text, '')::int) IS NOT NULL
               THEN jsonb_build_object(
                 'id',   COALESCE(fv.reassigned_supervisor_id, NULLIF((fv.team_snapshot->>'supervisorEmployeeId')::text, '')::int),
                 'name', team_lookup.supervisor_name
               )
             ELSE NULL
           END,
           'technician', CASE
             WHEN COALESCE(fv.reassigned_technician_id, NULLIF((fv.team_snapshot->>'technicianEmployeeId')::text, '')::int) IS NOT NULL
               THEN jsonb_build_object(
                 'id',   COALESCE(fv.reassigned_technician_id, NULLIF((fv.team_snapshot->>'technicianEmployeeId')::text, '')::int),
                 'name', team_lookup.technician_name
               )
             ELSE NULL
           END,
           'trainee', CASE
             WHEN COALESCE(fv.reassigned_trainee_id, NULLIF((fv.team_snapshot->>'traineeEmployeeId')::text, '')::int) IS NOT NULL
               THEN jsonb_build_object(
                 'id',   COALESCE(fv.reassigned_trainee_id, NULLIF((fv.team_snapshot->>'traineeEmployeeId')::text, '')::int),
                 'name', team_lookup.trainee_name
               )
             ELSE NULL
           END,
           'teamName', CASE
             WHEN team_lookup.supervisor_name IS NOT NULL THEN 'فريق ' || team_lookup.supervisor_name
             WHEN team_lookup.technician_name IS NOT NULL THEN 'فريق ' || team_lookup.technician_name
             ELSE NULL
           END,
           'reassigned', (fv.reassigned_supervisor_id IS NOT NULL OR fv.reassigned_technician_id IS NOT NULL OR fv.reassigned_trainee_id IS NOT NULL)
         ) AS "team",
         fv.customer_snapshot AS "customerSnapshot",
         fv.field_notes AS "fieldNotes",
         fv.origin_type AS "originType",
         fv.origin_id AS "originId",
         fv.created_at AS "createdAt",
         fv.updated_at AS "updatedAt",
         c.name AS "clientName",
         c.mobile AS "clientMobile",
         c.gender AS "clientGender",
         c.data_quality AS "clientDataQuality",
         ${buildClientLifecycleStatusSql('c')} AS "clientClassification",
         b.name AS "branchName",
         CASE
           WHEN neigh.id IS NOT NULL AND neigh.level = 4 AND neigh_parent.id IS NOT NULL
             THEN neigh_parent.name || ' — ' || neigh.name
           WHEN neigh.id IS NOT NULL AND neigh.level = 3 AND district.id IS NOT NULL
             THEN district.name || ' — ' || neigh.name
           WHEN neigh.id IS NOT NULL
             THEN neigh.name
           WHEN district.id IS NOT NULL
             THEN district.name
           ELSE NULL
         END AS "addressShort",
         ownership."ownerType" AS "ownershipOwnerType",
         ownership."ownerLabel" AS "ownershipOwnerLabel",
         '[]'::json AS "ownershipPersonalAssignments",
         ownership."companyOwnershipScope" AS "ownershipCompanyOwnershipScope",
         ownership."effectiveOwnershipReason" AS "ownershipEffectiveOwnershipReason",
         COUNT(DISTINCT vt.id)::int AS "taskCount",
         COUNT(DISTINCT vtr.id) FILTER (WHERE vtr.final_decision IS NOT NULL)::int AS "documentedTaskCount",
         COALESCE(
           json_agg(DISTINCT jsonb_build_object('taskType', vt.task_type, 'taskFamily', vt.task_family, 'status', vt.status))
             FILTER (WHERE vt.id IS NOT NULL),
           '[]'::json
         ) AS "tasksSummary",
         (vs.id IS NOT NULL) AS "hasSurvey",
         COALESCE(vs.is_skipped, FALSE) AS "surveySkipped",
         (rs.id IS NOT NULL) AS "hasReferralSheet",
         vgl.actual_start_time AS "actualStartTime",
         vgl.actual_end_time AS "actualEndTime",
         vgl.location_missing AS "locationMissing",
         COALESCE(
           ARRAY_AGG(DISTINCT vea.tier) FILTER (WHERE vea.tier IS NOT NULL),
           ARRAY[]::int[]
         ) AS "escalationTiers"
       FROM field_visits fv
       JOIN clients c ON c.id = fv.client_id
       LEFT JOIN branches b ON b.id = fv.branch_id
       LEFT JOIN geo_units neigh ON neigh.id = CASE
         WHEN NULLIF(c.neighborhood::text, '') ~ '^[0-9]+$' THEN c.neighborhood::int
         ELSE NULL
       END
       LEFT JOIN geo_units neigh_parent ON neigh_parent.id = neigh.parent_id
       LEFT JOIN geo_units district ON district.id = CASE
         WHEN NULLIF(c.district::text, '') ~ '^[0-9]+$' THEN c.district::int
         ELSE NULL
       END
       ${buildCustomerOwnershipSql({ clientAlias: 'c', branchNameExpression: 'b.name' })}
       LEFT JOIN visit_tasks vt ON vt.field_visit_id = fv.id
       LEFT JOIN visit_task_results vtr ON vtr.visit_task_id = vt.id
       LEFT JOIN visit_surveys vs ON vs.field_visit_id = fv.id
       LEFT JOIN referral_sheets rs ON rs.field_visit_id = fv.id
       LEFT JOIN visit_geo_logs vgl ON vgl.visit_id = fv.id
       LEFT JOIN visit_escalation_alerts vea ON vea.visit_id = fv.id
       LEFT JOIN LATERAL (
         SELECT
           sup.name   AS supervisor_name,
           tech.name  AS technician_name,
           train.name AS trainee_name
         FROM (SELECT 1) _
         LEFT JOIN employees sup   ON sup.id   = COALESCE(fv.reassigned_supervisor_id, NULLIF((fv.team_snapshot->>'supervisorEmployeeId')::text, '')::int)
         LEFT JOIN employees tech  ON tech.id  = COALESCE(fv.reassigned_technician_id, NULLIF((fv.team_snapshot->>'technicianEmployeeId')::text, '')::int)
         LEFT JOIN employees train ON train.id = COALESCE(fv.reassigned_trainee_id, NULLIF((fv.team_snapshot->>'traineeEmployeeId')::text, '')::int)
       ) team_lookup ON TRUE
       ${where}
       GROUP BY fv.id, c.id, b.name, neigh.id, neigh.name, neigh.level, neigh_parent.id, neigh_parent.name,
                district.id, district.name, ownership."ownerType", ownership."ownerLabel",
                ownership."companyOwnershipScope", ownership."effectiveOwnershipReason", vs.id, vs.is_skipped, rs.id,
                vgl.actual_start_time, vgl.actual_end_time, vgl.location_missing,
                team_lookup.supervisor_name, team_lookup.technician_name, team_lookup.trainee_name
       ORDER BY fv.scheduled_date DESC, fv.scheduled_time ASC, fv.created_at DESC`,
      params,
    );
    return res.json(rows.map((row: any) => ({ ...row, ownership: mapCustomerOwnership(row) })));
  } catch (err: any) {
    console.error('[field-visits] GET / error:', err);
    res.status(500).json({ error: 'فشل في تحميل الزيارات' });
  }
});

/**
 * Standalone "زياراتي" — the field member's OWN visits, i.e. visits whose assigned
 * team includes them (reassignment override OR team_snapshot). Gated by the dedicated
 * `field_visits.my_visits.view` permission (ASSIGNED-only, migration 302); on top of
 * that the team-membership predicate (employee = the holder) is the row boundary, so
 * there is no management branch plan here. See branch-scope-and-visibility-standard.md §6.
 *
 * @swagger
 * /api/field-visits/my-visits:
 *   get:
 *     tags: [Field Visits]
 *     summary: The requester's own (team-assigned) visits for a date
 *     security: [ { bearerAuth: [] } ]
 *     parameters:
 *       - in: query
 *         name: date
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Success }
 *       401: { description: Unauthorized }
 *       500: { description: Internal Server Error }
 */
router.get('/my-visits', requirePermission('field_visits.my_visits.view'), async (req, res) => {
  try {
    const authContext = getAuthContext(req);
    const date = typeof req.query.date === 'string' ? req.query.date : null;
    const status = typeof req.query.status === 'string' ? req.query.status : null;
    if (!date) {
      return res.status(400).json({ error: 'يجب تحديد التاريخ (date)' });
    }

    // Resolve the holder's employee id — the team-membership key. No employee
    // record ⇒ no team visits.
    const { rows: userRows } = await pool.query(
      `SELECT employee_id FROM hr_users WHERE id = $1 AND is_active = TRUE`,
      [authContext.userId],
    );
    const rawId = userRows[0]?.employee_id;
    const employeeId = Number.isInteger(rawId) && rawId > 0 ? rawId : null;
    if (employeeId == null) {
      return res.json([]);
    }

    const params: any[] = [date, employeeId, employeeId, employeeId];
    let statusClause = '';
    if (status !== null) {
      params.push(status);
      statusClause = `AND fv.status = $${params.length}`;
    }

    const { rows } = await pool.query(
      `SELECT
         fv.id,
         fv.visit_type   AS "visitType",
         fv.visit_family AS "visitFamily",
         fv.status,
         fv.scheduled_date AS "scheduledDate",
         fv.scheduled_time AS "scheduledTime",
         fv.client_id    AS "clientId",
         c.name          AS "clientName",
         c.mobile        AS "clientMobile",
         CASE
           WHEN neigh.id IS NOT NULL AND neigh.level = 4 AND neigh_parent.id IS NOT NULL
             THEN neigh_parent.name || ' — ' || neigh.name
           WHEN neigh.id IS NOT NULL THEN neigh.name
           WHEN district.id IS NOT NULL THEN district.name
           ELSE NULL
         END AS "addressShort",
         sup.name   AS "supervisorName",
         tech.name  AS "technicianName",
         train.name AS "traineeName",
         COUNT(DISTINCT vt.id)::int AS "taskCount",
         COALESCE(
           json_agg(DISTINCT jsonb_build_object('taskType', vt.task_type, 'taskFamily', vt.task_family, 'status', vt.status))
             FILTER (WHERE vt.id IS NOT NULL),
           '[]'::json
         ) AS "tasksSummary"
       FROM field_visits fv
       JOIN clients c ON c.id = fv.client_id
       LEFT JOIN geo_units neigh ON neigh.id = CASE
         WHEN NULLIF(c.neighborhood::text, '') ~ '^[0-9]+$' THEN c.neighborhood::int ELSE NULL END
       LEFT JOIN geo_units neigh_parent ON neigh_parent.id = neigh.parent_id
       LEFT JOIN geo_units district ON district.id = CASE
         WHEN NULLIF(c.district::text, '') ~ '^[0-9]+$' THEN c.district::int ELSE NULL END
       LEFT JOIN employees sup   ON sup.id   = COALESCE(fv.reassigned_supervisor_id, NULLIF((fv.team_snapshot->>'supervisorEmployeeId')::text, '')::int)
       LEFT JOIN employees tech  ON tech.id  = COALESCE(fv.reassigned_technician_id, NULLIF((fv.team_snapshot->>'technicianEmployeeId')::text, '')::int)
       LEFT JOIN employees train ON train.id = COALESCE(fv.reassigned_trainee_id, NULLIF((fv.team_snapshot->>'traineeEmployeeId')::text, '')::int)
       LEFT JOIN visit_tasks vt ON vt.field_visit_id = fv.id
       WHERE fv.scheduled_date = $1
         AND (
           COALESCE(fv.reassigned_supervisor_id, NULLIF((fv.team_snapshot->>'supervisorEmployeeId')::text, '')::int) = $2
           OR COALESCE(fv.reassigned_technician_id, NULLIF((fv.team_snapshot->>'technicianEmployeeId')::text, '')::int) = $3
           OR COALESCE(fv.reassigned_trainee_id, NULLIF((fv.team_snapshot->>'traineeEmployeeId')::text, '')::int) = $4
         )
         ${statusClause}
       GROUP BY fv.id, c.id, neigh.id, neigh.name, neigh.level, neigh_parent.id, neigh_parent.name,
                district.id, district.name, sup.name, tech.name, train.name
       ORDER BY fv.scheduled_date DESC, fv.scheduled_time ASC, fv.created_at DESC`,
      params,
    );
    return res.json(rows);
  } catch (err: any) {
    console.error('[field-visits] GET /my-visits error:', err);
    return res.status(500).json({ error: 'فشل في تحميل زياراتي' });
  }
});

// ─── FULL VISIT DETAILS ───────────────────────────────────────────────────────

// GET /api/field-visits/:id — full visit with tasks, geo, source
/**
 * @swagger
 * /api/field-visits/{id}:
 *   get:
 *     tags: [Field Visits]
 *     summary: Get full field visit details
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Branch ID
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Field Visit ID
 *     responses:
 *       200:
 *         description: Full visit details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       400:
 *         description: Invalid visit ID
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Visit not found
 *       500:
 *         description: Server error
 */

// ============================================================================
// GET /field-visits/escalation-alerts — DEC-006 D38
// ============================================================================
// MUST be declared BEFORE /:id so Express does not match "escalation-alerts"
// as the visit id parameter (which previously caused HTTP 400).
router.get('/escalation-alerts', requirePermission('field_visits.view'), async (req, res) => {
  try {
    const authContext = getAuthContext(req);
    const plan = getFieldVisitListAccessPlan(authContext);
    const params: any[] = [];
    let branchClause = '';
    if (plan.scope !== 'GLOBAL') {
      if (plan.allowedBranchIds.length === 0) {
        return res.json({ count: 0, items: [] });
      }
      params.push(plan.allowedBranchIds);
      branchClause = `AND fv.branch_id = ANY($${params.length}::int[])`;
    }

    const { rows } = await pool.query(
      `SELECT fv.id            AS "visitId",
              fv.status,
              fv.branch_id     AS "branchId",
              fv.client_id     AS "clientId",
              c.name           AS "clientName",
              fv.team_responsible_user_id AS "teamResponsibleUserId",
              EXTRACT(EPOCH FROM (NOW() - fv.updated_at)) / 3600 AS "hoursSinceUpdate",
              ARRAY(
                SELECT tier FROM visit_escalation_alerts
                 WHERE visit_id = fv.id
                 ORDER BY tier
              ) AS "tiersAlerted"
         FROM field_visits fv
         LEFT JOIN clients c ON c.id = fv.client_id
        WHERE fv.status IN ('in_progress', 'ended')
          AND EXISTS (SELECT 1 FROM visit_escalation_alerts vea WHERE vea.visit_id = fv.id)
          ${branchClause}
        ORDER BY fv.updated_at ASC
        LIMIT 200`,
      params,
    );
    return res.json({ count: rows.length, items: rows });
  } catch (err: any) {
    console.error('[field-visits] GET /escalation-alerts error:', err);
    res.status(500).json({ error: err?.message ?? 'فشل تحميل التنبيهات' });
  }
});

// ─── EXECUTIVE BRANCH SUMMARY ────────────────────────────────────────────────
// Cross-branch aggregation for the executive view of the visits page. Returns
// one row per branch for a date range, with KPIs that let leadership compare
// performance side-by-side. Requires GLOBAL scope (super admin or admin with
// global field_visits.view) - branch-scoped users are restricted to their own
// branch and would not need this endpoint.
router.get('/branch-summary', requirePermission('field_visits.view'), async (req, res) => {
  try {
    const authContext = getAuthContext(req);
    // Default window: last 7 days inclusive. Caller may override via from/to.
    const today = new Date();
    const defaultTo = today.toISOString().slice(0, 10);
    const defaultFrom = new Date(today.getTime() - 6 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const from = typeof req.query.from === 'string' && req.query.from ? req.query.from : defaultFrom;
    const to   = typeof req.query.to   === 'string' && req.query.to   ? req.query.to   : defaultTo;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return res.status(400).json({ error: 'صيغة التاريخ غير صحيحة (المتوقع YYYY-MM-DD)' });
    }
    if (from > to) {
      return res.status(400).json({ error: 'تاريخ البداية يجب أن يسبق تاريخ النهاية' });
    }

    // Branch-scoped callers only see their own branch in the summary - they
    // still get a "table" but it has one row. Super admins see all branches.
    const params: any[] = [from, to];
    let branchClause = '';
    const summaryPlan = getFieldVisitListAccessPlan(authContext);
    if (summaryPlan.scope !== 'GLOBAL') {
      if (summaryPlan.allowedBranchIds.length === 0) {
        return res.json({ from, to, branches: [] });
      }
      params.push(summaryPlan.allowedBranchIds);
      branchClause = `AND fv.branch_id = ANY($${params.length}::int[])`;
    }

    const { rows } = await pool.query(
      `WITH visit_summary AS (
         SELECT
           fv.id,
           fv.branch_id,
           fv.status,
           vgl.duration_minutes,
           vgl.location_missing,
           EXISTS (
             SELECT 1 FROM visit_escalation_alerts vea WHERE vea.visit_id = fv.id
           ) AS is_escalated
         FROM field_visits fv
         LEFT JOIN visit_geo_logs vgl ON vgl.visit_id = fv.id
         WHERE fv.scheduled_date BETWEEN $1::date AND $2::date
         ${branchClause}
       ),
       -- Device-demo pre-offer outcomes. Source of truth is the customer-level
       -- pre-offer record (customer_device_pre_offers.response_state), reached
       -- via: field_visit -> visit_task(device_demo) -> open_task ->
       -- open_task_pre_offers.source_customer_pre_offer_id ->
       -- customer_device_pre_offers. Pre-offers without a customer-level link
       -- are excluded (they have no recorded response yet).
       demo_offers AS (
         SELECT
           fv.branch_id,
           cdpo.response_state
         FROM field_visits fv
         JOIN visit_tasks vt ON vt.field_visit_id = fv.id AND vt.task_type = 'device_demo'
         JOIN open_task_pre_offers otpo ON otpo.open_task_id = vt.source_open_task_id
         JOIN customer_device_pre_offers cdpo ON cdpo.id = otpo.source_customer_pre_offer_id
         WHERE fv.scheduled_date BETWEEN $1::date AND $2::date
         ${branchClause}
       )
       SELECT
         b.id   AS "branchId",
         b.name AS "branchName",
         COUNT(vs.id)::int                                                            AS total,
         COUNT(vs.id) FILTER (WHERE vs.status = 'scheduled')::int                     AS scheduled,
         COUNT(vs.id) FILTER (WHERE vs.status = 'in_progress')::int                   AS "inProgress",
         COUNT(vs.id) FILTER (WHERE vs.status = 'ended')::int                         AS ended,
         COUNT(vs.id) FILTER (WHERE vs.status = 'completed')::int                     AS completed,
         COUNT(vs.id) FILTER (WHERE vs.status = 'not_completed')::int                 AS "notCompleted",
         COUNT(vs.id) FILTER (WHERE vs.status = 'cancelled')::int                     AS cancelled,
         COUNT(vs.id) FILTER (WHERE vs.is_escalated)::int                             AS "stuckEscalated",
         COUNT(vs.id) FILTER (WHERE vs.location_missing = TRUE)::int                  AS "locationMissing",
         COALESCE(ROUND(AVG(vs.duration_minutes) FILTER (WHERE vs.duration_minutes IS NOT NULL))::int, 0) AS "avgDurationMinutes",
         COALESCE((SELECT COUNT(*)::int FROM demo_offers d WHERE d.branch_id = b.id), 0)                                              AS "demoOffersPresented",
         COALESCE((SELECT COUNT(*)::int FROM demo_offers d WHERE d.branch_id = b.id AND d.response_state = 'accepted'), 0)            AS "demoOffersAccepted",
         COALESCE((SELECT COUNT(*)::int FROM demo_offers d WHERE d.branch_id = b.id AND d.response_state = 'rejected'), 0)            AS "demoOffersRejected",
         COALESCE((SELECT COUNT(*)::int FROM demo_offers d WHERE d.branch_id = b.id AND d.response_state = 'extension_requested'), 0) AS "demoOffersExtension",
         COALESCE((SELECT COUNT(*)::int FROM demo_offers d WHERE d.branch_id = b.id AND d.response_state = 'pending'), 0)             AS "demoOffersPending"
       FROM branches b
       LEFT JOIN visit_summary vs ON vs.branch_id = b.id
       ${summaryPlan.scope !== 'GLOBAL'
         ? `WHERE b.id = ANY($${params.length}::int[])` : ''}
       GROUP BY b.id, b.name
       ORDER BY total DESC, b.name ASC`,
      params,
    );

    return res.json({ from, to, branches: rows });
  } catch (err: any) {
    console.error('[field-visits] GET /branch-summary error:', err);
    res.status(500).json({ error: err?.message ?? 'فشل تحميل ملخص الفروع' });
  }
});

// ─── TASK-TYPE ANALYTICS SUMMARY ─────────────────────────────────────────────
// Per-task-type aggregation over a date range for the executive "تحليل المهام"
// view. One row per active task type with universal KPIs (attempts, status
// breakdown, documentation rate) plus type-specific KPIs we can compute today
// (currently only device_demo pre-offer outcomes). Other task types are listed
// without their specialized KPIs - those will be added per ticket as the
// matching success criteria get nailed down.
router.get('/task-type-summary', requirePermission('field_visits.view'), async (req, res) => {
  try {
    const authContext = getAuthContext(req);
    const today = new Date();
    const defaultTo = today.toISOString().slice(0, 10);
    const defaultFrom = new Date(today.getTime() - 6 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const from = typeof req.query.from === 'string' && req.query.from ? req.query.from : defaultFrom;
    const to   = typeof req.query.to   === 'string' && req.query.to   ? req.query.to   : defaultTo;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return res.status(400).json({ error: 'صيغة التاريخ غير صحيحة (المتوقع YYYY-MM-DD)' });
    }
    if (from > to) {
      return res.status(400).json({ error: 'تاريخ البداية يجب أن يسبق تاريخ النهاية' });
    }

    const params: any[] = [from, to];
    let branchClause = '';
    const typeSummaryPlan = getFieldVisitListAccessPlan(authContext);
    if (typeSummaryPlan.scope !== 'GLOBAL') {
      if (typeSummaryPlan.allowedBranchIds.length === 0) {
        return res.json({ from, to, taskTypes: [] });
      }
      params.push(typeSummaryPlan.allowedBranchIds);
      branchClause = `AND fv.branch_id = ANY($${params.length}::int[])`;
    }

    const { rows } = await pool.query(
      `WITH visit_tasks_in_period AS (
         SELECT vt.id, vt.task_type, vt.status, vt.source_open_task_id, fv.branch_id
         FROM visit_tasks vt
         JOIN field_visits fv ON fv.id = vt.field_visit_id
         WHERE fv.scheduled_date BETWEEN $1::date AND $2::date
         ${branchClause}
       ),
       -- Device-demo pre-offer outcomes (the only type with a fully-wired
       -- success signal today). Linked via the same chain used by the branch
       -- summary endpoint.
       demo_offers AS (
         SELECT cdpo.response_state
         FROM visit_tasks vt
         JOIN field_visits fv ON fv.id = vt.field_visit_id
         JOIN open_task_pre_offers otpo ON otpo.open_task_id = vt.source_open_task_id
         JOIN customer_device_pre_offers cdpo ON cdpo.id = otpo.source_customer_pre_offer_id
         WHERE vt.task_type = 'device_demo'
           AND fv.scheduled_date BETWEEN $1::date AND $2::date
           ${branchClause}
       )
       SELECT
         ttc.task_type                                                                    AS "taskType",
         ttc.task_family                                                                  AS "taskFamily",
         ttc.arabic_label                                                                 AS "arabicLabel",
         ttc.display_order                                                                AS "displayOrder",
         COALESCE(COUNT(vtp.id)::int, 0)                                                  AS "totalAttempts",
         COALESCE(COUNT(vtp.id) FILTER (WHERE vtp.status = 'completed')::int, 0)          AS completed,
         COALESCE(COUNT(vtp.id) FILTER (WHERE vtp.status = 'not_completed')::int, 0)      AS "notCompleted",
         COALESCE(COUNT(vtp.id) FILTER (WHERE vtp.status = 'cancelled')::int, 0)          AS cancelled,
         COALESCE(COUNT(vtp.id) FILTER (WHERE vtp.status = 'in_progress')::int, 0)        AS "inProgress",
         COALESCE(COUNT(vtp.id) FILTER (WHERE vtp.status = 'pending')::int, 0)            AS pending,
         COALESCE(COUNT(vtp.id) FILTER (WHERE EXISTS (
           SELECT 1 FROM visit_task_results vtr
           WHERE vtr.visit_task_id = vtp.id AND vtr.final_decision IS NOT NULL
         ))::int, 0)                                                                     AS documented,
         CASE WHEN ttc.task_type = 'device_demo'
           THEN COALESCE((SELECT COUNT(*)::int FROM demo_offers), 0)
           ELSE NULL END                                                                  AS "demoOffersPresented",
         CASE WHEN ttc.task_type = 'device_demo'
           THEN COALESCE((SELECT COUNT(*)::int FROM demo_offers WHERE response_state = 'accepted'), 0)
           ELSE NULL END                                                                  AS "demoOffersAccepted",
         CASE WHEN ttc.task_type = 'device_demo'
           THEN COALESCE((SELECT COUNT(*)::int FROM demo_offers WHERE response_state = 'rejected'), 0)
           ELSE NULL END                                                                  AS "demoOffersRejected",
         CASE WHEN ttc.task_type = 'device_demo'
           THEN COALESCE((SELECT COUNT(*)::int FROM demo_offers WHERE response_state = 'extension_requested'), 0)
           ELSE NULL END                                                                  AS "demoOffersExtension",
         CASE WHEN ttc.task_type = 'device_demo'
           THEN COALESCE((SELECT COUNT(*)::int FROM demo_offers WHERE response_state = 'pending'), 0)
           ELSE NULL END                                                                  AS "demoOffersPending"
       FROM task_type_config ttc
       LEFT JOIN visit_tasks_in_period vtp ON vtp.task_type = ttc.task_type
       WHERE ttc.is_active = TRUE
       GROUP BY ttc.task_type, ttc.task_family, ttc.arabic_label, ttc.display_order
       ORDER BY ttc.display_order ASC, ttc.task_type ASC`,
      params,
    );

    return res.json({ from, to, taskTypes: rows });
  } catch (err: any) {
    console.error('[field-visits] GET /task-type-summary error:', err);
    res.status(500).json({ error: err?.message ?? 'فشل تحميل ملخص المهام' });
  }
});

router.get('/:id', requirePermission('field_visits.view'), async (req, res) => {
  try {
    const authContext = getAuthContext(req);
    const visitId = Number(req.params.id);
    if (!Number.isFinite(visitId)) return res.status(400).json({ error: 'معرف الزيارة غير صالح' });

    const hasDeliveryAddressColumn = await hasOpenTaskColumn('delivery_address');

    // ── Visit header + live customer snapshot (VDP §1, §2, §7) ──────────────
    // Customer name/address/contact are read live from `clients` for display
    // completeness (the stored customer_snapshot is intentionally sparse).
    const { rows: fvRows } = await pool.query(
      `SELECT fv.*,
              c.name AS client_name, c.mobile AS client_mobile,
              ${buildClientLifecycleStatusSql('c')} AS candidate_status,
              c.first_name        AS client_first_name,
              c.father_name       AS client_father_name,
              c.last_name         AS client_last_name,
              c.nickname          AS client_nickname,
              c.gender            AS client_gender,
              c.data_quality      AS client_data_quality,
              c.source_channel    AS client_source_channel,
              c.notes             AS client_notes,
              c.contacts          AS client_contacts,
              c.gps_coordinates   AS client_gps,
              c.detailed_address  AS client_detailed_address,
              c.occupation        AS client_occupation,
              c.spouse_occupation AS client_spouse_occupation,
              c.rating            AS client_rating,
              c.referrers         AS client_referrers,
              c.referrer_type     AS client_referrer_type,
              c.referrer_name     AS client_referrer_name,
              c.water_source      AS client_water_source,
              c.governorate       AS client_governorate_id,
              c.district          AS client_district_id,
              c.neighborhood      AS client_neighborhood_id,
              gg.name AS governorate_name,
              gd.name AS district_name,
              gn.name AS neighborhood_name,
              b.name  AS branch_name,
              tm.name AS telemarketer_name,
              sl.value AS cancellation_reason_label
       FROM field_visits fv
       JOIN clients c ON c.id = fv.client_id
       LEFT JOIN branches b   ON b.id  = fv.branch_id
       LEFT JOIN hr_users tm  ON tm.id = fv.booked_by_telemarketer_id
       LEFT JOIN geo_units gg ON gg.id = c.governorate
       LEFT JOIN geo_units gd ON gd.id = c.district
       LEFT JOIN geo_units gn ON gn.id = c.neighborhood
       LEFT JOIN system_lists sl ON sl.id = fv.cancellation_reason_id
       WHERE fv.id = $1`,
      [visitId],
    );
    if (!fvRows[0]) return res.status(404).json({ error: 'الزيارة غير موجودة' });
    if (!canViewFieldVisit(authContext, fvRows[0].branch_id).allowed) {
      return res.status(403).json({ error: 'ليس لديك صلاحية الوصول' });
    }
    const fv = fvRows[0];

    const [tasksRes, geoRes, sourceRes, stationRes, sheetRes, surveyRes, clientGeoRes, ownershipRes] = await Promise.all([
      // Tasks: arabic label + location basis + general result + linked contract.
      // DEC-007 D40: name-collection columns dropped — list moved to referral_sheets.
      pool.query(
        `SELECT vt.*,
                ttc.arabic_label, ttc.location_basis,
                vtr.id AS result_id, vtr.final_decision, vtr.reason_code,
                vtr.closing_notes, vtr.closed_at,
                ot.reason,
                ${hasDeliveryAddressColumn ? 'ot.delivery_address' : 'idev.installation_address_text'} AS delivery_address,
                ot.device_id, ot.contract_snapshot AS "contractSnapshot",
                idev.installation_address_text AS current_device_address,
                idev.installation_geo_unit_id AS current_device_geo_unit_id,
                ct.contract_number, ct.device_model_name
         FROM visit_tasks vt
         LEFT JOIN task_type_config ttc ON ttc.task_type = vt.task_type
         LEFT JOIN visit_task_results vtr ON vtr.visit_task_id = vt.id
         LEFT JOIN open_tasks ot ON ot.id = vt.source_open_task_id
         LEFT JOIN installed_devices idev ON idev.id = ot.device_id
         LEFT JOIN contracts ct ON ct.id = COALESCE(vt.contract_id, ot.contract_id)
         WHERE vt.field_visit_id = $1
         ORDER BY vt.sequence_no`,
        [visitId],
      ),
      pool.query('SELECT * FROM visit_geo_logs WHERE visit_id = $1', [visitId]),
      pool.query('SELECT * FROM visit_sources WHERE visit_id = $1', [visitId]),
      // Station (VDP §3): geo unit of the contract-based task if any, else the
      // client's neighborhood — returned with its full ancestor hierarchy.
      pool.query(
        `WITH RECURSIVE station AS (
           SELECT COALESCE(
             (SELECT idev.installation_geo_unit_id
                FROM visit_tasks vt
                JOIN task_type_config ttc ON ttc.task_type = vt.task_type
                LEFT JOIN open_tasks ot ON ot.id = vt.source_open_task_id
                LEFT JOIN contracts ct ON ct.id = COALESCE(vt.contract_id, ot.contract_id)
                JOIN installed_devices idev ON idev.id = COALESCE(ot.device_id, ct.installed_device_id)
               WHERE vt.field_visit_id = $1
                 AND ttc.location_basis IN ('contract', 'device')
                 AND idev.installation_geo_unit_id IS NOT NULL
               LIMIT 1),
             (SELECT neighborhood FROM clients WHERE id = $2)
           ) AS geo_id
         ),
         ancestors AS (
           SELECT g.id, g.name, g.level, g.parent_id
             FROM geo_units g WHERE g.id = (SELECT geo_id FROM station)
           UNION ALL
           SELECT p.id, p.name, p.level, p.parent_id
             FROM geo_units p JOIN ancestors a ON p.id = a.parent_id
         )
         SELECT id, name, level FROM ancestors ORDER BY level`,
        [visitId, fv.client_id],
      ),
      pool.query(
        `SELECT id, status, target_candidates, total_candidates, owner_user_id
           FROM referral_sheets WHERE field_visit_id = $1`,
        [visitId],
      ),
      pool.query(
        `SELECT vs.id, vs.is_skipped, vs.skip_reason, vs.filled_at,
                u.name AS filled_by_name
           FROM visit_surveys vs
           LEFT JOIN hr_users u ON u.id = vs.filled_by_user_id
          WHERE vs.field_visit_id = $1`,
        [visitId],
      ),
      // Client address hierarchy (ClientSnapshot §ج): full ancestor path of the
      // client's own neighborhood — gov(1) → district(2) → subArea(3) → neighborhood(4).
      pool.query(
        `WITH RECURSIVE ancestors AS (
           SELECT g.id, g.name, g.level, g.parent_id
             FROM geo_units g
             WHERE g.id = (SELECT neighborhood FROM clients WHERE id = $1)
           UNION ALL
           SELECT p.id, p.name, p.level, p.parent_id
             FROM geo_units p JOIN ancestors a ON p.id = a.parent_id
         )
         SELECT id, name, level FROM ancestors ORDER BY level`,
        [fv.client_id],
      ),
      // Ownership (ClientSnapshot §ز): assignees with role display name.
      pool.query(
        `SELECT u.name AS user_name, COALESCE(r.display_name, r.name) AS role_display
           FROM client_assignments ca
           JOIN hr_users u ON u.id = ca.hr_user_id
           LEFT JOIN roles r ON r.id = u.role_id
          WHERE ca.client_id = $1 AND u.is_active = TRUE
          ORDER BY ca.assigned_at ASC`,
        [fv.client_id],
      ),
    ]);

    // Fetch direct suggestions per task
    const taskIds = tasksRes.rows.map((t: any) => t.id);
    const { rows: suggestRows } = taskIds.length > 0
      ? await pool.query(
          'SELECT * FROM direct_suggestions WHERE visit_task_id = ANY($1::bigint[]) ORDER BY created_at',
          [taskIds],
        )
      : { rows: [] as any[] };

    const suggestByTask = new Map<string, any[]>();
    suggestRows.forEach((s: any) => {
      const key = String(s.visit_task_id);
      if (!suggestByTask.has(key)) suggestByTask.set(key, []);
      suggestByTask.get(key)!.push(s);
    });

    const sourceOpenTaskIds = tasksRes.rows
      .map((t: any) => Number(t.source_open_task_id))
      .filter((id: number) => Number.isInteger(id) && id > 0);
    const { rows: preOfferRows } = sourceOpenTaskIds.length > 0
      ? await pool.query(
          `SELECT
             otpo.open_task_id,
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
             otpo.no_closing_reason AS "noClosingReason",
             otpo.source_customer_pre_offer_id AS "sourceCustomerPreOfferId",
             otpo.sale_reference_number AS "saleReferenceNumber",
             linked_spo.response_state AS "customerResponse"
           FROM open_task_pre_offers otpo
           LEFT JOIN device_models dm ON dm.id = otpo.device_model_id
           LEFT JOIN customer_device_pre_offers linked_spo ON linked_spo.id = otpo.source_customer_pre_offer_id
           WHERE otpo.open_task_id = ANY($1::int[])
           ORDER BY otpo.id`,
          [sourceOpenTaskIds],
        )
      : { rows: [] as any[] };

    const preOffersByOpenTask = new Map<number, any[]>();
    preOfferRows.forEach((offer: any) => {
      const key = Number(offer.open_task_id);
      if (!preOffersByOpenTask.has(key)) preOffersByOpenTask.set(key, []);
      preOffersByOpenTask.get(key)!.push(offer);
    });

    const tasks = tasksRes.rows.map((t: any) => ({
      ...t,
      directSuggestions: suggestByTask.get(String(t.id)) ?? [],
      preOffers: preOffersByOpenTask.get(Number(t.source_open_task_id)) ?? [],
    }));

    // ── Resolve team member names (VDP §4) ─────────────────────────────────
    // team_snapshot / reassigned_team_snapshot store employee IDs only.
    const teamIds = new Set<number>();
    const collectIds = (snap: any) => {
      if (!snap) return;
      for (const k of ['supervisorEmployeeId', 'technicianEmployeeId', 'traineeEmployeeId']) {
        if (snap[k]) teamIds.add(Number(snap[k]));
      }
    };
    collectIds(fv.team_snapshot);
    collectIds(fv.reassigned_team_snapshot);
    const empNames = new Map<number, string>();
    if (teamIds.size > 0) {
      const { rows: empRows } = await pool.query(
        'SELECT id, name FROM employees WHERE id = ANY($1::int[])',
        [[...teamIds]],
      );
      empRows.forEach((e: any) => empNames.set(Number(e.id), e.name));
    }
    const buildTeam = (snap: any) => {
      if (!snap) return null;
      const member = (id: any) =>
        id ? { id: Number(id), name: empNames.get(Number(id)) ?? `#${id}` } : null;
      return {
        supervisor: member(snap.supervisorEmployeeId),
        technician: member(snap.technicianEmployeeId),
        trainee: member(snap.traineeEmployeeId),
      };
    };
    const team = {
      original: buildTeam(fv.team_snapshot),
      reassigned: buildTeam(fv.reassigned_team_snapshot),
      reassigned_at: fv.reassigned_at,
    };

    // ── Standard ClientSnapshot (Level 2) per docs/.../client-snapshot.md ────
    const geoPath: any[] = clientGeoRes.rows;
    const byLevel = (lvl: number) => geoPath.find((g: any) => g.level === lvl)?.name ?? null;
    const assignees = ownershipRes.rows.map((a: any) => ({
      userName: a.user_name,
      roleDisplay: a.role_display ?? null,
    }));
    // Referrers (ClientSnapshot §ه): prefer the JSONB array; fall back to the
    // legacy single-referrer flat columns (referrer_type / referrer_name).
    let referrersArr: any[] = Array.isArray(fv.client_referrers) ? fv.client_referrers : [];
    if (referrersArr.length === 0 && (fv.client_referrer_name || fv.client_referrer_type)) {
      referrersArr = [{ type: fv.client_referrer_type ?? null, name: fv.client_referrer_name ?? null }];
    }
    // Classification: candidate_status holds OP/FOP once promoted; an unset
    // status means the client is still a LEAD.
    const candStatus = String(fv.candidate_status ?? '').toUpperCase();
    const classification = ['OP', 'FOP'].includes(candStatus) ? candStatus : 'LEAD';
    const clientSnapshot = {
      gender: fv.client_gender ?? null,
      dataQuality: fv.client_data_quality ?? null,
      firstName: fv.client_first_name ?? null,
      fatherName: fv.client_father_name ?? null,
      lastName: fv.client_last_name ?? null,
      nickname: fv.client_nickname ?? null,
      fullName: fv.client_name,
      classification, // LEAD / OP / FOP
      primaryMobile: fv.client_mobile ?? null,
      contacts: Array.isArray(fv.client_contacts) ? fv.client_contacts : [],
      address: {
        governorate: byLevel(1),
        district: byLevel(2),
        subArea: byLevel(3),
        neighborhood: byLevel(4),
        detailedAddress: fv.client_detailed_address ?? null,
        gps: fv.client_gps ?? null,
        geoPath,
      },
      occupation: fv.client_occupation ?? null,
      spouseOccupation: fv.client_spouse_occupation ?? null,
      // waterSource intentionally omitted here — it is shown in the appointment
      // section (معلومات الموعد) to avoid duplicating it in the customer card.
      committed: fv.client_rating ?? null, // shown only when classification === 'OP'
      referrers: referrersArr.map((r: any) => ({ type: r?.type ?? null, name: r?.name ?? null })),
      referrersCount: referrersArr.length,
      notes: fv.client_notes ?? null,
      sourceChannel: fv.client_source_channel ?? null,
      ownership: {
        assignees,
        branchName: fv.branch_name ?? null,
      },
    };

    // Lazily resolve source if missing
    let source = sourceRes.rows[0] ?? null;
    if (!source) {
      const src = await resolveVisitSource(visitId);
      if (src) {
        const { rows: ins } = await pool.query(
          `INSERT INTO visit_sources (visit_id, source_type, source_label, actor_employee_ids)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (visit_id) DO UPDATE SET
             source_type = EXCLUDED.source_type,
             source_label = EXCLUDED.source_label,
             actor_employee_ids = EXCLUDED.actor_employee_ids
           RETURNING *`,
          [visitId, src.source_type, src.source_label, src.actor_employee_ids],
        );
        source = ins[0] ?? null;
      }
    }

    res.json({
      ...fv,
      tasks,
      geo: geoRes.rows[0] ?? null,
      source,
      station: stationRes.rows,
      team,
      clientSnapshot,
      referralSheet: sheetRes.rows[0] ?? null,
      survey: surveyRes.rows[0] ?? null,
    });
  } catch (err: any) {
    console.error('[field-visits] GET /:id error:', err);
    res.status(500).json({ error: 'فشل في تحميل تفاصيل الزيارة' });
  }
});

// ─── NAME COLLECTION (LEGACY — retired 2026-06-10) ────────────────────────────
//
// DEC-007 D40/D41 replaced this workflow with referral_sheets. The three
// endpoints below are kept registered so any unexpected caller gets a clear
// 410 Gone instead of a 404 mystery. The legacy table visit_name_collections
// will be dropped after the 14-day staging soak window.
//
// Original handlers were removed in the same change; git history at
// commit BEFORE this paragraph preserves the full implementation.

router.post('/visit-tasks/:taskId/name-collection', requirePermission('field_visits.edit'), async (_req, res) => {
  res.status(410).json({ error: 'هذا المسار مُعطَّل — استخدم لائحة الإحالات (referral sheets) بدلاً عنه' });
});

router.put('/name-collections/:id/record-names', requirePermission('field_visits.edit'), async (_req, res) => {
  res.status(410).json({ error: 'هذا المسار مُعطَّل — تسجيل الأسماء انتقل إلى referral_sheets' });
});

router.get('/name-collections/:id', requirePermission('field_visits.view'), async (_req, res) => {
  res.status(410).json({ error: 'هذا المسار مُعطَّل — استخدم GET /api/field-visits/:visitId لمعلومات الإحالة' });
});


// ─── DIRECT SUGGESTIONS ───────────────────────────────────────────────────────

// POST /api/field-visits/visit-tasks/:taskId/direct-suggestions
/**
 * @swagger
 * /api/field-visits/visit-tasks/:taskId/direct-suggestions:
 *   post:
 *     tags: [Field Visits]
 *     summary: Create a direct suggestion
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Branch ID
 *       - in: path
 *         name: taskId
 *         required: true
 *         schema:
 *           type: integer
 *         description: Task ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               phone:
 *                 type: string
 *               notes:
 *                 type: string
 *     responses:
 *       201:
 *         description: Direct suggestion created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DirectSuggestion'
 *       400:
 *         description: Invalid input or taskId
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Task not found
 *       500:
 *         description: Server error
 */
router.post('/visit-tasks/:taskId/direct-suggestions', requirePermission('field_visits.edit'), async (req, res) => {
  try {
    const authContext = getAuthContext(req);
    const taskId = Number(req.params.taskId);
    if (!Number.isFinite(taskId)) return res.status(400).json({ error: 'معرف المهمة غير صالح' });

    const name = String(req.body?.name ?? '').trim();
    if (!name) return res.status(400).json({ error: 'الاسم مطلوب' });

    const phone = typeof req.body?.phone === 'string' ? req.body.phone.trim() || null : null;
    const notes = typeof req.body?.notes === 'string' ? req.body.notes.trim() || null : null;

    // Validate task belongs to caller's branch
    const { rows: taskRows } = await pool.query(
      `SELECT vt.id, fv.branch_id, fv.client_id
       FROM visit_tasks vt
       JOIN field_visits fv ON fv.id = vt.field_visit_id
       WHERE vt.id = $1`,
      [taskId],
    );
    if (!taskRows[0]) return res.status(404).json({ error: 'المهمة غير موجودة' });
    if (!canEditFieldVisit(authContext, taskRows[0].branch_id).allowed) {
      return res.status(403).json({ error: 'ليس لديك صلاحية الوصول' });
    }

    const { rows } = await pool.query(
      `INSERT INTO direct_suggestions (visit_task_id, name, phone, is_direct, notes, client_id)
       VALUES ($1, $2, $3, TRUE, $4, $5)
       RETURNING *`,
      [taskId, name, phone, notes, taskRows[0].client_id],
    );

    res.status(201).json(rows[0]);
  } catch (err: any) {
    console.error('[field-visits] POST /visit-tasks/:taskId/direct-suggestions error:', err);
    res.status(500).json({ error: 'فشل في إضافة الاقتراح المباشر' });
  }
});

// GET /api/field-visits/visit-tasks/:taskId/direct-suggestions
/**
 * @swagger
 * /api/field-visits/visit-tasks/{taskId}/direct-suggestions:
 *   get:
 *     tags: [Field Visits]
 *     summary: Get all direct suggestions for a visit task
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Branch ID
 *       - in: path
 *         name: taskId
 *         required: true
 *         schema:
 *           type: integer
 *         description: Task ID
 *     responses:
 *       200:
 *         description: Direct suggestions retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/DirectSuggestion'
 *       400:
 *         description: Invalid taskId
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get('/visit-tasks/:taskId/direct-suggestions', requirePermission('field_visits.view'), async (req, res) => {
  try {
    const taskId = Number(req.params.taskId);
    if (!Number.isFinite(taskId)) return res.status(400).json({ error: 'معرف المهمة غير صالح' });

    const { rows } = await pool.query(
      'SELECT * FROM direct_suggestions WHERE visit_task_id = $1 ORDER BY created_at',
      [taskId],
    );
    res.json(rows);
  } catch (err: any) {
    console.error('[field-visits] GET /visit-tasks/:taskId/direct-suggestions error:', err);
    res.status(500).json({ error: 'فشل في تحميل الاقتراحات' });
  }
});

// ─── COMPLETION GUARD ─────────────────────────────────────────────────────────

// POST /api/field-visits/:id/complete
/**
 * @swagger
 * /api/field-visits/{id}/complete:
 *   post:
 *     tags: [Field Visits]
 *     summary: Complete a field visit
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Branch ID
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Field Visit ID
 *     responses:
 *       200:
 *         description: Visit completed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *       400:
 *         description: Guard checks failed (e.g. pending tasks or incomplete name collection)
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Visit not found
 *       500:
 *         description: Server error
 */
router.post('/:id/complete', requirePermission('field_visits.edit'), async (req, res) => {
  try {
    const authContext = getAuthContext(req);
    const visitId = Number(req.params.id);
    if (!Number.isFinite(visitId)) return res.status(400).json({ error: 'معرف الزيارة غير صالح' });

    const { rows: fvRows } = await pool.query(
      'SELECT id, branch_id, status FROM field_visits WHERE id = $1',
      [visitId],
    );
    if (!fvRows[0]) return res.status(404).json({ error: 'الزيارة غير موجودة' });
    if (!canEditFieldVisit(authContext, fvRows[0].branch_id).allowed) {
      return res.status(403).json({ error: 'ليس لديك صلاحية الوصول' });
    }

    // DEC-007 D44/D45 + P-DEC007-04: delegate to the shared completion service.
    // Guards enforced: (1) every visit_task has a result with final_decision,
    // (2) visit_surveys row exists (filled OR skipped). Referral sheet is NOT
    // a guard — the legacy visit_name_collections check is dropped (D45).
    const result = await checkAndCompleteVisit(visitId, authContext.userId ?? null);
    if (result.completed) {
      return res.json({ success: true, alreadyCompleted: result.alreadyCompleted === true });
    }

    if (result.reason === 'guards_failed') {
      const parts: string[] = [];
      if (result.missing?.includes('tasks')) {
        parts.push(`${result.pendingTaskCount ?? 0} مهمة لم تُسجَّل نتيجتها`);
      }
      if (result.missing?.includes('survey')) {
        parts.push('الاستبيان (visit_survey) غير موجود — تعبئة كاملة أو سبب تخطٍ مطلوب');
      }
      return res.status(400).json({ error: `لا يمكن إتمام الزيارة: ${parts.join(' و ')}` });
    }
    if (result.reason?.startsWith('status_not_eligible')) {
      const current = result.reason.split(':')[1] ?? '';
      return res.status(409).json({ error: `حالة الزيارة الحالية (${current}) لا تسمح بالإكمال` });
    }
    return res.status(400).json({ error: result.reason ?? 'فشل غير معروف' });
  } catch (err: any) {
    console.error('[field-visits] POST /:id/complete error:', err);
    res.status(500).json({ error: 'فشل في إتمام الزيارة' });
  }
});

// ============================================================================
// POST /field-visits/:id/close
// ============================================================================
// Administrative closure after completion. Once closed, ordinary result edits
// stop; privileged users can reopen via /:id/reopen if a correction is needed.
router.post('/:id/close', requirePermission('field_visits.edit'), async (req, res) => {
  const pgClient = await pool.connect();
  try {
    const authContext = getAuthContext(req);
    const visitId = Number(req.params.id);
    if (!Number.isFinite(visitId)) return res.status(400).json({ error: 'معرف الزيارة غير صالح' });

    await pgClient.query('BEGIN');

    const { rows: fvRows } = await pgClient.query(
      `SELECT id, branch_id, status
         FROM field_visits
        WHERE id = $1
        FOR UPDATE`,
      [visitId],
    );
    if (!fvRows[0]) {
      await pgClient.query('ROLLBACK');
      return res.status(404).json({ error: 'الزيارة غير موجودة' });
    }
    if (!canEditFieldVisit(authContext, fvRows[0].branch_id).allowed) {
      await pgClient.query('ROLLBACK');
      return res.status(403).json({ error: 'ليس لديك صلاحية الوصول' });
    }
    if (fvRows[0].status !== 'completed') {
      await pgClient.query('ROLLBACK');
      return res.status(409).json({ error: `لا يمكن إقفال الزيارة قبل أن تكون مكتملة (الحالة: ${fvRows[0].status})` });
    }

    const { rows: guardRows } = await pgClient.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(vtr.id)::int AS documented
       FROM visit_tasks vt
       LEFT JOIN visit_task_results vtr ON vtr.visit_task_id = vt.id AND vtr.final_decision IS NOT NULL
       WHERE vt.field_visit_id = $1`,
      [visitId],
    );
    const total = Number(guardRows[0]?.total ?? 0);
    const documented = Number(guardRows[0]?.documented ?? 0);
    if (total === 0 || documented !== total) {
      await pgClient.query('ROLLBACK');
      return res.status(400).json({ error: 'لا يمكن الإقفال قبل تسجيل نتيجة كل مهام الزيارة' });
    }

    await pgClient.query(
      `UPDATE visit_tasks
          SET status = 'closed',
              updated_at = NOW()
        WHERE field_visit_id = $1`,
      [visitId],
    );

    await pgClient.query(
      `UPDATE field_visits
          SET status = 'closed',
              closed_by = $2,
              closed_at = NOW(),
              updated_at = NOW()
        WHERE id = $1`,
      [visitId, authContext.userId ?? null],
    );

    await pgClient.query('COMMIT');
    return res.json({ success: true });
  } catch (err: any) {
    await pgClient.query('ROLLBACK');
    console.error('[field-visits] POST /:id/close error:', err);
    res.status(500).json({ error: err?.message ?? 'فشل إقفال الزيارة' });
  } finally {
    pgClient.release();
  }
});

// ============================================================================
// POST /field-visits/:id/tasks — DEC-003 D7 expanded (cascading)
// ============================================================================
// Adds a visit_task to a field_visit currently in_progress, optionally creating
// the underlying open_task in the same call (creation_origin = 'cascading_during_visit').
//
// Constraint (D7 expanded): the open_task must belong to the same client_id.
// No task-type whitelist, no N-window check.
router.post('/:id/tasks', requirePermission('field_visits.edit'), async (req, res) => {
  const fieldVisitId = Number(req.params.id);
  if (!Number.isInteger(fieldVisitId) || fieldVisitId <= 0) {
    return res.status(400).json({ error: 'fieldVisitId غير صالح' });
  }
  const performedByUserId = (req as any).authContext?.userId ?? null;
  const body = req.body ?? {};
  const taskType = typeof body.taskType === 'string' ? body.taskType : null;
  if (!taskType) {
    return res.status(400).json({ error: 'taskType مطلوب' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Load and verify the field_visit is in_progress
    const { rows: visitRows } = await client.query(
      `SELECT id, client_id, branch_id, status
         FROM field_visits
        WHERE id = $1
        LIMIT 1`,
      [fieldVisitId],
    );
    if (visitRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'الزيارة غير موجودة' });
    }
    const visit = visitRows[0];
    if (visit.status !== 'in_progress') {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: `إضافة مهمة cascading متاحة فقط لزيارة in_progress (الحالة الحالية: ${visit.status})`,
      });
    }

    // 2. Verify task_type is active and resolve task_family
    const { rows: configRows } = await client.query(
      `SELECT task_type, task_family
         FROM task_type_config
        WHERE task_type = $1 AND is_active = TRUE
        LIMIT 1`,
      [taskType],
    );
    if (configRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `نوع المهمة "${taskType}" غير معروف أو معطّل.` });
    }
    const taskFamily = configRows[0].task_family;

    // 3. Resolve the source open_task — DEC-010: pull-only.
    //    Creation-from-visit (D-PB1) is deferred; only an existing task in the
    //    waiting phase (D-PB2) of the visit's own branch (D-PB4) may be pulled.
    const PULLABLE_STATUSES = ['open', 'needs_follow_up'];
    const openTaskId: number | null = Number(body.openTaskId) || null;
    if (!(openTaskId != null && openTaskId > 0)) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'إنشاء مهمة جديدة من داخل الزيارة غير مدعوم حالياً — اسحب مهمة قائمة (DEC-010 D-PB1).',
      });
    }
    const { rows: existingRows } = await client.query(
      `SELECT id, client_id, branch_id, task_type, status FROM open_tasks WHERE id = $1 LIMIT 1`,
      [openTaskId],
    );
    if (existingRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: `open_task #${openTaskId} غير موجودة` });
    }
    const ot = existingRows[0];
    if (Number(ot.client_id) !== Number(visit.client_id)) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'لا يجوز سحب مهمة لزبون مختلف عن زبون الزيارة (DEC-003 D7).',
      });
    }
    if (ot.task_type !== taskType) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: `نوع المهمة المطلوب (${taskType}) لا يطابق نوع open_task #${openTaskId} (${ot.task_type}).`,
      });
    }
    if (Number(ot.branch_id) !== Number(visit.branch_id)) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'لا يجوز سحب مهمة من فرع مختلف عن فرع الزيارة (DEC-010 D-PB4).',
      });
    }
    if (!PULLABLE_STATUSES.includes(ot.status)) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: `لا يمكن سحب المهمة — حالتها "${ot.status}". يُسمح فقط بمهام قيد الانتظار (open / needs_follow_up) (DEC-010 D-PB2).`,
      });
    }

    // 4. Insert the visit_task (marked as pulled — DEC-010 D-PB7).
    const { rows: vtRows } = await client.query(
      `INSERT INTO visit_tasks (
         field_visit_id, source_open_task_id,
         task_type, task_family,
         sequence_no, status, added_via
       )
       SELECT $1, $2, $3, $4,
              COALESCE(MAX(sequence_no), 0) + 1,
              'pending', 'pull'
         FROM visit_tasks WHERE field_visit_id = $1
       RETURNING id, sequence_no`,
      [fieldVisitId, openTaskId, taskType, taskFamily],
    );

    // 5. Move the open_task to scheduled, preserving the waiting status so
    //    undo-pull (D-PB8) can restore it.
    await client.query(
      `UPDATE open_tasks
          SET last_waiting_status = CASE
                WHEN status IN ('open', 'needs_follow_up') THEN status
                ELSE last_waiting_status
              END,
              status = 'scheduled',
              updated_at = NOW()
        WHERE id = $1 AND status IN ('open', 'needs_follow_up')`,
      [openTaskId],
    );

    await client.query('COMMIT');
    return res.json({
      visitTaskId: vtRows[0].id,
      sequenceNo: vtRows[0].sequence_no,
      openTaskId,
    });
  } catch (err: any) {
    await client.query('ROLLBACK');
    console.error('[field-visits] POST /:id/tasks error:', err);
    res.status(500).json({ error: err?.message ?? 'فشل إضافة المهمة' });
  } finally {
    client.release();
  }
});

// ============================================================================
// DEC-010 — Visit Task Pull
// ============================================================================

/**
 * GET /api/field-visits/:id/pullable-tasks
 * The customer's waiting-phase open_tasks (open / needs_follow_up) in the
 * visit's branch, that the team can pull into the in_progress visit.
 *   - D-PB2: status restricted to the waiting phase (also the duplicate guard —
 *            a task already pulled is `scheduled` and never appears here).
 *   - D-PB3: constrained by client only, location-agnostic.
 *   - D-PB4: branch restricted to the visit's branch.
 *   - D-PB5: no N-Window, no eligibility filter.
 *   - D-PB6: oldest-first, information-dense.
 */
router.get('/:id/pullable-tasks', requirePermission('field_visits.view'), async (req, res) => {
  const fieldVisitId = Number(req.params.id);
  if (!Number.isInteger(fieldVisitId) || fieldVisitId <= 0) {
    return res.status(400).json({ error: 'معرف الزيارة غير صالح' });
  }
  try {
    const { rows: visitRows } = await pool.query(
      `SELECT id, client_id, branch_id FROM field_visits WHERE id = $1 LIMIT 1`,
      [fieldVisitId],
    );
    if (visitRows.length === 0) return res.status(404).json({ error: 'الزيارة غير موجودة' });
    const visit = visitRows[0];

    const { rows } = await pool.query(
      `SELECT ot.id                       AS "openTaskId",
              ot.task_type                AS "taskType",
              ttc.arabic_label            AS "arabicLabel",
              ot.task_family              AS "taskFamily",
              ot.status,
              ot.reason,
              ot.priority,
              ot.creation_origin          AS "creationOrigin",
              ot.created_at               AS "createdAt",
              ot.expected_date            AS "expectedDate",
              ot.expected_time            AS "expectedTime",
              ot.contract_id              AS "contractId",
              ct.contract_number          AS "contractNumber",
              ct.device_model_name        AS "deviceModelName",
              ot.installment_id           AS "installmentId",
              ci.installment_number       AS "installmentNumber",
              ci.amount_syp               AS "installmentAmount",
              ci.remaining_balance        AS "installmentRemaining",
              ot.expected_amount_syp      AS "expectedAmount",
              ot.receivable_source_label  AS "receivableLabel",
              idev.installation_address_text AS "taskAddress",
              idev.installation_geo_unit_id  AS "taskGeoUnitId"
         FROM open_tasks ot
         LEFT JOIN task_type_config ttc ON ttc.task_type = ot.task_type
         LEFT JOIN contracts ct ON ct.id = ot.contract_id
         LEFT JOIN contract_installments ci ON ci.id = ot.installment_id
         LEFT JOIN installed_devices idev ON idev.id = ot.device_id
        WHERE ot.client_id = $1
          AND ot.branch_id = $2
          AND ot.status IN ('open', 'needs_follow_up')
        ORDER BY ot.created_at ASC`,
      [visit.client_id, visit.branch_id],
    );
    return res.json(rows);
  } catch (err: any) {
    console.error('[field-visits] GET /:id/pullable-tasks error:', err);
    res.status(500).json({ error: err?.message ?? 'فشل جلب المهام القابلة للسحب' });
  }
});

/**
 * DELETE /api/field-visits/:id/tasks/:visitTaskId
 * Undo a pull (DEC-010 D-PB8). Allowed only when the visit_task:
 *   1. was added via pull (added_via = 'pull') — never an original booked task, and
 *   2. has no result yet (still pending).
 * Effect: delete the visit_task, restore the open_task to its last_waiting_status.
 */
router.delete('/:id/tasks/:visitTaskId', requirePermission('field_visits.edit'), async (req, res) => {
  const fieldVisitId = Number(req.params.id);
  const visitTaskId = Number(req.params.visitTaskId);
  if (!Number.isInteger(fieldVisitId) || fieldVisitId <= 0 ||
      !Number.isInteger(visitTaskId) || visitTaskId <= 0) {
    return res.status(400).json({ error: 'معرّف غير صالح' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT vt.id, vt.source_open_task_id, vt.added_via,
              fv.status AS visit_status,
              vtr.id AS result_id
         FROM visit_tasks vt
         JOIN field_visits fv ON fv.id = vt.field_visit_id
         LEFT JOIN visit_task_results vtr ON vtr.visit_task_id = vt.id
        WHERE vt.id = $1 AND vt.field_visit_id = $2
        LIMIT 1`,
      [visitTaskId, fieldVisitId],
    );
    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'المهمة غير موجودة ضمن هذه الزيارة' });
    }
    const row = rows[0];
    if (row.visit_status !== 'in_progress') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'إلغاء السحب متاح فقط أثناء سير الزيارة (in_progress).' });
    }
    if (row.added_via !== 'pull') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'لا يمكن إلغاء سحب مهمة أصلية من حجز الزيارة — تُلغى عبر إلغاء/عدم إتمام (DEC-010 D-PB8).' });
    }
    if (row.result_id != null) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'لا يمكن إلغاء السحب بعد تسجيل نتيجة — عدّل النتيجة بدلاً من ذلك (DEC-010 D-PB8).' });
    }

    await client.query(`DELETE FROM visit_tasks WHERE id = $1`, [visitTaskId]);
    if (row.source_open_task_id) {
      await client.query(
        `UPDATE open_tasks
            SET status = COALESCE(last_waiting_status, 'open'),
                updated_at = NOW()
          WHERE id = $1 AND status = 'scheduled'`,
        [row.source_open_task_id],
      );
    }
    await client.query('COMMIT');
    return res.json({
      success: true,
      removedVisitTaskId: visitTaskId,
      restoredOpenTaskId: row.source_open_task_id ?? null,
    });
  } catch (err: any) {
    await client.query('ROLLBACK');
    console.error('[field-visits] DELETE /:id/tasks/:visitTaskId error:', err);
    res.status(500).json({ error: err?.message ?? 'فشل إلغاء سحب المهمة' });
  } finally {
    client.release();
  }
});

// ============================================================================
// Referral sheet endpoints — DEC-007 D40, D41
// ============================================================================

/**
 * GET /api/field-visits/:id/referral-sheet
 * Returns the referral_sheet bound to this visit (if any). Frontend uses this
 * to decide whether to show "إضافة لائحة جديدة" or "تعديل عدد اللائحة".
 */
router.get('/:id/referral-sheet', requirePermission('field_visits.view'), async (req, res) => {
  try {
    const visitId = Number(req.params.id);
    if (!Number.isFinite(visitId)) return res.status(400).json({ error: 'معرف الزيارة غير صالح' });
    const { rows } = await pool.query(
      `SELECT id,
              field_visit_id  AS "fieldVisitId",
              target_candidates AS "targetCandidates",
              owner_user_id   AS "ownerUserId",
              status,
              referral_name_snapshot AS "referralNameSnapshot",
              referral_address_text  AS "referralAddressText"
         FROM referral_sheets
        WHERE field_visit_id = $1
        LIMIT 1`,
      [visitId],
    );
    return res.json(rows[0] ?? null);
  } catch (err: any) {
    console.error('[field-visits] GET /:id/referral-sheet error:', err);
    res.status(500).json({ error: 'فشل تحميل اللائحة' });
  }
});

/**
 * POST /api/field-visits/:id/referral-sheet  (DEC-007 D41)
 *
 * Creates a referral_sheet bound to this visit. Only allowed while the visit
 * is in_progress or ended (D46). The team_responsible_user_id snapshot decides
 * the owner_user_id (D47).
 */
router.post('/:id/referral-sheet', requirePermission('field_visits.edit'), async (req, res) => {
  try {
    const visitId = Number(req.params.id);
    if (!Number.isFinite(visitId)) return res.status(400).json({ error: 'معرف الزيارة غير صالح' });
    const authContext = getAuthContext(req);
    const body = req.body ?? {};
    const targetCandidates = Number.isFinite(body.targetCandidates) && body.targetCandidates >= 0
      ? Math.floor(body.targetCandidates)
      : 0;

    const { rows: visitRows } = await pool.query(
      `SELECT fv.id, fv.client_id, fv.branch_id, fv.status,
              fv.scheduled_date, fv.team_responsible_user_id,
              c.name AS client_name,
              c.detailed_address AS client_address
         FROM field_visits fv
         LEFT JOIN clients c ON c.id = fv.client_id
        WHERE fv.id = $1
        LIMIT 1`,
      [visitId],
    );
    if (visitRows.length === 0) return res.status(404).json({ error: 'الزيارة غير موجودة' });
    const visit = visitRows[0];
    if (!canEditFieldVisit(authContext, visit.branch_id).allowed) {
      return res.status(403).json({ error: 'ليس لديك صلاحية' });
    }
    if (visit.status !== 'in_progress' && visit.status !== 'ended') {
      return res.status(409).json({
        error: `إنشاء اللائحة مسموح فقط بعد بدء الزيارة (الحالة الحالية: ${visit.status}) — DEC-007 D46`,
      });
    }

    // DEC-007 D40: enforce one referral_sheet per field_visit
    const { rows: existing } = await pool.query(
      'SELECT id FROM referral_sheets WHERE field_visit_id = $1 LIMIT 1',
      [visitId],
    );
    if (existing.length > 0) {
      return res.status(409).json({ error: 'يوجد لائحة لهذه الزيارة سابقاً — استخدم تعديل target_candidates' });
    }

    const ownerUserId = visit.team_responsible_user_id ?? authContext.userId ?? null;

    const { rows: created } = await pool.query(
      `INSERT INTO referral_sheets (
         referral_type, referral_entity_id,
         referral_name_snapshot, referral_address_text,
         referral_origin_channel,
         field_visit_id,
         owner_user_id,
         branch_id,
         target_candidates,
         status,
         referral_date,
         created_by
       ) VALUES (
         'client', $1,
         $2, $3,
         'visit',
         $4,
         $5,
         $6,
         $7,
         'New',
         $8,
         $5
       )
       RETURNING id, target_candidates AS "targetCandidates", status, owner_user_id AS "ownerUserId"`,
      [
        visit.client_id,
        visit.client_name ?? null,
        visit.client_address ?? null,
        visitId,
        ownerUserId,
        visit.branch_id,
        targetCandidates,
        String(visit.scheduled_date ?? '').slice(0, 10),
      ],
    );

    return res.json({ fieldVisitId: visitId, ...created[0] });
  } catch (err: any) {
    console.error('[field-visits] POST /:id/referral-sheet error:', err);
    res.status(500).json({ error: err?.message ?? 'فشل إنشاء اللائحة' });
  }
});

/**
 * PATCH /api/field-visits/:id/referral-sheet/target  (DEC-007 D41)
 * Updates target_candidates on the visit's referral_sheet.
 */
router.patch('/:id/referral-sheet/target', requirePermission('field_visits.edit'), async (req, res) => {
  try {
    const visitId = Number(req.params.id);
    if (!Number.isFinite(visitId)) return res.status(400).json({ error: 'معرف الزيارة غير صالح' });
    const targetCandidates = Number(req.body?.targetCandidates);
    if (!Number.isFinite(targetCandidates) || targetCandidates < 0) {
      return res.status(400).json({ error: 'targetCandidates يجب أن يكون رقماً ≥ 0' });
    }
    const { rows } = await pool.query(
      `UPDATE referral_sheets
          SET target_candidates = $1
        WHERE field_visit_id = $2
        RETURNING id, target_candidates AS "targetCandidates"`,
      [Math.floor(targetCandidates), visitId],
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'لا توجد لائحة لهذه الزيارة' });
    }
    return res.json(rows[0]);
  } catch (err: any) {
    console.error('[field-visits] PATCH /:id/referral-sheet/target error:', err);
    res.status(500).json({ error: err?.message ?? 'فشل التحديث' });
  }
});

// ============================================================================
// Visit survey endpoints — DEC-007 D42, D43, D44
// ============================================================================

/**
 * GET /api/field-visits/:id/survey
 * Returns the visit's survey row if it exists.
 */
router.get('/:id/survey', requirePermission('field_visits.view'), async (req, res) => {
  try {
    const visitId = Number(req.params.id);
    if (!Number.isFinite(visitId)) return res.status(400).json({ error: 'معرف الزيارة غير صالح' });
    const { rows } = await pool.query(
      `SELECT id,
              field_visit_id                    AS "fieldVisitId",
              is_skipped                        AS "isSkipped",
              skip_reason                       AS "skipReason",
              filled_by_user_id                 AS "filledByUserId",
              filled_at                         AS "filledAt",
              household_members_count           AS "householdMembersCount",
              drinking_water_source             AS "drinkingWaterSource",
              tds_test_result                   AS "tdsTestResult",
              hardness_test_drops               AS "hardnessTestDrops",
              demo_kit_tds_result               AS "demoKitTdsResult",
              customer_opinion_water_source     AS "customerOpinionWaterSource",
              customer_opinion_demo_kit         AS "customerOpinionDemoKit",
              customer_opinion_purification_idea AS "customerOpinionPurificationIdea",
              customer_purchase_intent          AS "customerPurchaseIntent",
              expected_payment_method           AS "expectedPaymentMethod",
              area_evaluation                   AS "areaEvaluation"
         FROM visit_surveys
        WHERE field_visit_id = $1
        LIMIT 1`,
      [visitId],
    );
    return res.json(rows[0] ?? null);
  } catch (err: any) {
    console.error('[field-visits] GET /:id/survey error:', err);
    res.status(500).json({ error: 'فشل تحميل الاستبيان' });
  }
});

const SURVEY_REQUIRED_FIELDS = [
  'householdMembersCount',
  'drinkingWaterSource',
  'tdsTestResult',
  'hardnessTestDrops',
  'demoKitTdsResult',
  'customerOpinionWaterSource',
  'customerOpinionDemoKit',
  'customerOpinionPurificationIdea',
  'customerPurchaseIntent',
  'expectedPaymentMethod',
  'areaEvaluation',
] as const;

/**
 * POST /api/field-visits/:id/survey  (DEC-007 D42, D43)
 *
 * Upserts a filled visit_survey. All 11 fields must be present. Triggers
 * checkAndCompleteVisit on success.
 */
router.post('/:id/survey', requirePermission('field_visits.edit'), async (req, res) => {
  try {
    const visitId = Number(req.params.id);
    if (!Number.isFinite(visitId)) return res.status(400).json({ error: 'معرف الزيارة غير صالح' });
    const authContext = getAuthContext(req);
    const body = req.body ?? {};

    // 1. Verify visit status allows survey edit (DEC-007 D46)
    const { rows: visitRows } = await pool.query(
      'SELECT id, branch_id, status FROM field_visits WHERE id = $1 LIMIT 1',
      [visitId],
    );
    if (visitRows.length === 0) return res.status(404).json({ error: 'الزيارة غير موجودة' });
    if (!canEditFieldVisit(authContext, visitRows[0].branch_id).allowed) {
      return res.status(403).json({ error: 'ليس لديك صلاحية' });
    }
    if (visitRows[0].status !== 'in_progress' && visitRows[0].status !== 'ended') {
      return res.status(409).json({
        error: `تعبئة الاستبيان مسموحة فقط بعد بدء الزيارة (الحالة الحالية: ${visitRows[0].status}) — DEC-007 D46`,
      });
    }

    // 2. Validate every required field present
    const missing = SURVEY_REQUIRED_FIELDS.filter((k) => body[k] === undefined || body[k] === null || body[k] === '');
    if (missing.length > 0) {
      return res.status(400).json({ error: `حقول مفقودة: ${missing.join(', ')}` });
    }

    const filledByUserId = authContext.userId ?? null;

    // 3. Upsert (insert or update if a row already exists)
    const { rows: upserted } = await pool.query(
      `INSERT INTO visit_surveys (
         field_visit_id,
         is_skipped, skip_reason,
         filled_by_user_id, filled_at,
         household_members_count, drinking_water_source,
         tds_test_result, hardness_test_drops, demo_kit_tds_result,
         customer_opinion_water_source, customer_opinion_demo_kit,
         customer_opinion_purification_idea, customer_purchase_intent,
         expected_payment_method, area_evaluation
       ) VALUES (
         $1,
         FALSE, NULL,
         $2, NOW(),
         $3, $4,
         $5, $6, $7,
         $8, $9,
         $10, $11,
         $12, $13
       )
       ON CONFLICT (field_visit_id) DO UPDATE SET
         is_skipped                          = FALSE,
         skip_reason                         = NULL,
         filled_by_user_id                   = EXCLUDED.filled_by_user_id,
         filled_at                           = NOW(),
         household_members_count             = EXCLUDED.household_members_count,
         drinking_water_source               = EXCLUDED.drinking_water_source,
         tds_test_result                     = EXCLUDED.tds_test_result,
         hardness_test_drops                 = EXCLUDED.hardness_test_drops,
         demo_kit_tds_result                 = EXCLUDED.demo_kit_tds_result,
         customer_opinion_water_source       = EXCLUDED.customer_opinion_water_source,
         customer_opinion_demo_kit           = EXCLUDED.customer_opinion_demo_kit,
         customer_opinion_purification_idea  = EXCLUDED.customer_opinion_purification_idea,
         customer_purchase_intent            = EXCLUDED.customer_purchase_intent,
         expected_payment_method             = EXCLUDED.expected_payment_method,
         area_evaluation                     = EXCLUDED.area_evaluation,
         updated_at                          = NOW()
       RETURNING id, field_visit_id AS "fieldVisitId"`,
      [
        visitId,
        filledByUserId,
        Number(body.householdMembersCount),
        String(body.drinkingWaterSource),
        Number(body.tdsTestResult),
        Number(body.hardnessTestDrops),
        Number(body.demoKitTdsResult),
        String(body.customerOpinionWaterSource),
        String(body.customerOpinionDemoKit),
        String(body.customerOpinionPurificationIdea),
        Boolean(body.customerPurchaseIntent),
        String(body.expectedPaymentMethod),
        String(body.areaEvaluation),
      ],
    );

    // 4. Trigger auto-completion check (DEC-007 P-DEC007-04)
    const completion = await checkAndCompleteVisit(visitId, filledByUserId);

    return res.json({ survey: upserted[0], completion });
  } catch (err: any) {
    console.error('[field-visits] POST /:id/survey error:', err);
    res.status(500).json({ error: err?.message ?? 'فشل حفظ الاستبيان' });
  }
});

/**
 * POST /api/field-visits/:id/survey/skip  (DEC-007 D42)
 *
 * Records that the survey was skipped with a reason from system_lists.
 * Body: { skipReason: string }. Triggers checkAndCompleteVisit on success.
 */
router.post('/:id/survey/skip', requirePermission('field_visits.edit'), async (req, res) => {
  try {
    const visitId = Number(req.params.id);
    if (!Number.isFinite(visitId)) return res.status(400).json({ error: 'معرف الزيارة غير صالح' });
    const authContext = getAuthContext(req);
    const skipReason = String(req.body?.skipReason ?? '').trim();
    if (!skipReason) return res.status(400).json({ error: 'skipReason مطلوب' });

    const { rows: visitRows } = await pool.query(
      'SELECT id, branch_id, status FROM field_visits WHERE id = $1 LIMIT 1',
      [visitId],
    );
    if (visitRows.length === 0) return res.status(404).json({ error: 'الزيارة غير موجودة' });
    if (!canEditFieldVisit(authContext, visitRows[0].branch_id).allowed) {
      return res.status(403).json({ error: 'ليس لديك صلاحية' });
    }
    if (visitRows[0].status !== 'in_progress' && visitRows[0].status !== 'ended') {
      return res.status(409).json({
        error: `تسجيل التخطي مسموح فقط بعد بدء الزيارة — DEC-007 D46`,
      });
    }

    // Insert OR overwrite an existing row with the skipped form
    const { rows: upserted } = await pool.query(
      `INSERT INTO visit_surveys (
         field_visit_id, is_skipped, skip_reason
       ) VALUES ($1, TRUE, $2)
       ON CONFLICT (field_visit_id) DO UPDATE SET
         is_skipped                          = TRUE,
         skip_reason                         = EXCLUDED.skip_reason,
         filled_by_user_id                   = NULL,
         filled_at                           = NULL,
         household_members_count             = NULL,
         drinking_water_source               = NULL,
         tds_test_result                     = NULL,
         hardness_test_drops                 = NULL,
         demo_kit_tds_result                 = NULL,
         customer_opinion_water_source       = NULL,
         customer_opinion_demo_kit           = NULL,
         customer_opinion_purification_idea  = NULL,
         customer_purchase_intent            = NULL,
         expected_payment_method             = NULL,
         area_evaluation                     = NULL,
         updated_at                          = NOW()
       RETURNING id, field_visit_id AS "fieldVisitId", skip_reason AS "skipReason"`,
      [visitId, skipReason],
    );

    const completion = await checkAndCompleteVisit(visitId, authContext.userId ?? null);
    return res.json({ survey: upserted[0], completion });
  } catch (err: any) {
    console.error('[field-visits] POST /:id/survey/skip error:', err);
    res.status(500).json({ error: err?.message ?? 'فشل تسجيل التخطي' });
  }
});

// ============================================================================
// POST /field-visits/:id/reopen — DEC-004 D11
// ============================================================================
// Reopens a `closed` visit. Gated by the new field_visits.reopen_closed
// permission (migration 219). A reason is mandatory and stored as a closing
// note for audit. The visit returns to `ended` (the last pre-close state),
// since post-close edits go through the standard "update_result" flow.
router.post('/:id/reopen', requirePermission('field_visits.reopen_closed'), async (req, res) => {
  try {
    const authContext = getAuthContext(req);
    const visitId = Number(req.params.id);
    if (!Number.isFinite(visitId)) return res.status(400).json({ error: 'معرف الزيارة غير صالح' });
    const reason = String(req.body?.reason ?? '').trim();
    if (!reason) return res.status(400).json({ error: 'سبب الفتح مطلوب' });

    const { rows: fvRows } = await pool.query(
      'SELECT id, branch_id, status FROM field_visits WHERE id = $1',
      [visitId],
    );
    if (!fvRows[0]) return res.status(404).json({ error: 'الزيارة غير موجودة' });
    if (!authorize(authContext, { permission: 'field_visits.reopen_closed', branchId: fvRows[0].branch_id }).allowed) {
      return res.status(403).json({ error: 'ليس لديك صلاحية' });
    }
    if (fvRows[0].status !== 'closed') {
      return res.status(409).json({ error: `الزيارة ليست مُقفلة (الحالة: ${fvRows[0].status})` });
    }

    await pool.query(
      `UPDATE field_visits
          SET status     = 'ended',
              closed_by  = NULL,
              closed_at  = NULL,
              field_notes = COALESCE(field_notes || E'\n\n', '') || $2,
              updated_at = NOW()
        WHERE id = $1`,
      [visitId, `[reopen by user #${authContext.userId} at ${new Date().toISOString()}] ${reason}`],
    );
    await pool.query(
      `UPDATE visit_tasks
          SET status = 'completed',
              updated_at = NOW()
        WHERE field_visit_id = $1
          AND status = 'closed'`,
      [visitId],
    );

    return res.json({ success: true });
  } catch (err: any) {
    console.error('[field-visits] POST /:id/reopen error:', err);
    res.status(500).json({ error: err?.message ?? 'فشل فتح الزيارة' });
  }
});

// ============================================================================
// POST /field-visits/:visitId/tasks/:taskId/result
// ============================================================================
// Unified task-result entrypoint. Routes by visit_tasks.task_type to the
// matching reflection service (currently: device_demo). The service writes
// visit_task_results + side table + per-offer rows + reflects onto open_task
// and calls checkAndCompleteVisit at the end — all in one transaction.
//
// Reference: docs/constitution/features/tasks/device-demo.md
router.post('/:visitId/tasks/:taskId/result', requirePermission('tasks.results.record'), async (req, res) => {
  try {
    const authContext = getAuthContext(req);
    const visitId = Number(req.params.visitId);
    const taskId  = Number(req.params.taskId);
    if (!Number.isInteger(visitId) || visitId <= 0) return res.status(400).json({ error: 'معرف الزيارة غير صالح' });
    if (!Number.isInteger(taskId)  || taskId  <= 0) return res.status(400).json({ error: 'معرف المهمة غير صالح' });

    // Verify the visit_task belongs to the requested visit and resolve task_type.
    const { rows: vtRows } = await pool.query(
      `SELECT vt.id, vt.task_type, vt.field_visit_id, fv.branch_id
         FROM visit_tasks vt
         JOIN field_visits fv ON fv.id = vt.field_visit_id
        WHERE vt.id = $1 AND vt.field_visit_id = $2 LIMIT 1`,
      [taskId, visitId],
    );
    if (vtRows.length === 0) return res.status(404).json({ error: 'المهمة غير موجودة ضمن هذه الزيارة' });
    // Unified result gate: one permission records results for every task type.
    if (!authorize(authContext, { permission: 'tasks.results.record', branchId: vtRows[0].branch_id }).allowed) {
      return res.status(403).json({ error: 'ليس لديك صلاحية تسجيل نتائج المهام' });
    }

    const taskType = vtRows[0].task_type;
    const body = req.body ?? {};

    if (taskType === 'device_demo') {
      const result = await applyDeviceDemoResult(taskId, body, authContext.userId);
      return res.json({ success: true, ...result });
    }

    if (taskType === 'device_delivery') {
      const result = await applyDeviceDeliveryResult(taskId, body, authContext.userId);
      return res.json({ success: true, ...result });
    }

    if (taskType === 'device_installation') {
      const result = await applyDeviceInstallationResult(taskId, body, authContext.userId);
      return res.json({ success: true, ...result });
    }

    if (taskType === 'device_activation') {
      const result = await applyDeviceActivationResult(taskId, body, authContext.userId);
      return res.json({ success: true, ...result });
    }

    if (taskType === 'device_disconnection') {
      const result = await applyDeviceDisconnectionResult(taskId, body, authContext.userId);
      return res.json({ success: true, ...result });
    }

    if (taskType === 'emergency_maintenance') {
      // Lifecycle-only path (reschedule / cancel). The "apply maintenance"
      // outcome continues to use the dedicated /api/emergency-result wizard.
      const result = await applyEmergencyMaintenanceLifecycleResult(taskId, body, authContext.userId);
      return res.json({ success: true, ...result });
    }

    if (taskType === 'golden_warranty_offer') {
      const result = await applyGoldenWarrantyOfferResult(taskId, body, authContext.userId);
      return res.json({ success: true, ...result });
    }

    if (taskType === 'golden_warranty_card_delivery') {
      const result = await applyGoldenWarrantyCardDeliveryResult(taskId, body, authContext.userId);
      return res.json({ success: true, ...result });
    }

    if (taskType === 'installment_collection') {
      const result = await applyInstallmentCollectionResult(taskId, body, authContext.userId);
      return res.json({ success: true, ...result });
    }

    return res.status(501).json({
      error: `تسجيل نتيجة موحَّد غير مدعوم بعد لنوع المهمة "${taskType}"`,
    });
  } catch (err: any) {
    if (err instanceof ResultValidationError) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error('[field-visits] POST /:visitId/tasks/:taskId/result error:', err);
    res.status(500).json({ error: err?.message ?? 'فشل تسجيل النتيجة' });
  }
});

export default router;
