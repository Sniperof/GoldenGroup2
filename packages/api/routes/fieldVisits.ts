import { Router } from 'express';
import pool from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permission.js';
import { checkAndCompleteVisit } from '../services/visitCompletion.js';

const router = Router();
router.use(requireAuth);

function getAuthContext(req: any) {
  if (!req.authContext) throw new Error('AuthContext is required');
  return req.authContext as {
    userId: number;
    isSuperAdmin: boolean;
    actingBranchId: number | null;
    [key: string]: any;
  };
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
    if (!authContext.isSuperAdmin && fvRows[0].branch_id !== authContext.actingBranchId) {
      return res.status(403).json({ error: 'ليس لديك صلاحية الوصول' });
    }

    const lat = req.body?.lat != null ? Number(req.body.lat) : null;
    const lng = req.body?.lng != null ? Number(req.body.lng) : null;
    const accuracy = req.body?.accuracy != null ? Number(req.body.accuracy) : null;
    const locationMissing = lat === null || lng === null || !Number.isFinite(lat) || !Number.isFinite(lng);

    const now = new Date();

    await pool.query(
      `INSERT INTO visit_geo_logs (visit_id, actual_start_time, actual_start_lat, actual_start_lng,
         actual_start_accuracy, location_missing, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
       ON CONFLICT (visit_id) DO UPDATE SET
         actual_start_time = EXCLUDED.actual_start_time,
         actual_start_lat  = EXCLUDED.actual_start_lat,
         actual_start_lng  = EXCLUDED.actual_start_lng,
         actual_start_accuracy = EXCLUDED.actual_start_accuracy,
         location_missing  = EXCLUDED.location_missing,
         updated_at        = NOW()`,
      [visitId, now, locationMissing ? null : lat, locationMissing ? null : lng,
       accuracy && Number.isFinite(accuracy) ? Math.round(accuracy) : null, locationMissing],
    );

    await pool.query(
      `UPDATE field_visits SET status = 'in_progress', updated_at = NOW()
       WHERE id = $1 AND status NOT IN ('ended','completed','cancelled')`,
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
    if (!authContext.isSuperAdmin && fvRows[0].branch_id !== authContext.actingBranchId) {
      return res.status(403).json({ error: 'ليس لديك صلاحية الوصول' });
    }

    const lat = req.body?.lat != null ? Number(req.body.lat) : null;
    const lng = req.body?.lng != null ? Number(req.body.lng) : null;
    const accuracy = req.body?.accuracy != null ? Number(req.body.accuracy) : null;
    const locationMissing = lat === null || lng === null || !Number.isFinite(lat) || !Number.isFinite(lng);

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
         actual_end_accuracy, duration_minutes, distance_meters, location_missing, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
       ON CONFLICT (visit_id) DO UPDATE SET
         actual_end_time     = EXCLUDED.actual_end_time,
         actual_end_lat      = EXCLUDED.actual_end_lat,
         actual_end_lng      = EXCLUDED.actual_end_lng,
         actual_end_accuracy = EXCLUDED.actual_end_accuracy,
         duration_minutes    = EXCLUDED.duration_minutes,
         distance_meters     = EXCLUDED.distance_meters,
         location_missing    = visit_geo_logs.location_missing OR EXCLUDED.location_missing,
         updated_at          = NOW()`,
      [visitId, now, locationMissing ? null : lat, locationMissing ? null : lng,
       accuracy && Number.isFinite(accuracy) ? Math.round(accuracy) : null,
       durationMinutes, distanceMeters, locationMissing],
    );

    await pool.query(
      `UPDATE field_visits SET status = 'ended', updated_at = NOW()
       WHERE id = $1 AND status NOT IN ('completed','cancelled')`,
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
router.get('/', requirePermission('field_visits.view'), async (req, res) => {
  try {
    const authContext = getAuthContext(req);
    const clientId = req.query.clientId ? Number(req.query.clientId) : null;
    const date = typeof req.query.date === 'string' ? req.query.date : null;

    if (clientId === null && date === null) {
      return res.status(400).json({ error: 'يجب تحديد clientId أو date' });
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
    if (!authContext.isSuperAdmin && authContext.actingBranchId != null) {
      conditions.push(`fv.branch_id = $${idx++}`);
      params.push(authContext.actingBranchId);
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
         fv.customer_snapshot AS "customerSnapshot",
         fv.field_notes AS "fieldNotes",
         fv.created_at AS "createdAt",
         fv.updated_at AS "updatedAt"
       FROM field_visits fv
       ${where}
       ORDER BY fv.scheduled_date DESC, fv.scheduled_time ASC, fv.created_at DESC`,
      params,
    );
    return res.json(rows);
  } catch (err: any) {
    console.error('[field-visits] GET / error:', err);
    res.status(500).json({ error: 'فشل في تحميل الزيارات' });
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
router.get('/:id', requirePermission('field_visits.view'), async (req, res) => {
  try {
    const authContext = getAuthContext(req);
    const visitId = Number(req.params.id);
    if (!Number.isFinite(visitId)) return res.status(400).json({ error: 'معرف الزيارة غير صالح' });

    const { rows: fvRows } = await pool.query(
      `SELECT fv.*,
              c.name AS client_name, c.mobile AS client_mobile,
              c.candidate_status, c.neighborhood,
              b.name AS branch_name
       FROM field_visits fv
       JOIN clients c ON c.id = fv.client_id
       LEFT JOIN branches b ON b.id = fv.branch_id
       WHERE fv.id = $1`,
      [visitId],
    );
    if (!fvRows[0]) return res.status(404).json({ error: 'الزيارة غير موجودة' });
    if (!authContext.isSuperAdmin && fvRows[0].branch_id !== authContext.actingBranchId) {
      return res.status(403).json({ error: 'ليس لديك صلاحية الوصول' });
    }

    const [tasksRes, geoRes, sourceRes] = await Promise.all([
      pool.query(
        `SELECT vt.*,
                vtr.id AS result_id, vtr.final_decision, vtr.closing_notes, vtr.closed_at,
                vnc.id AS name_coll_id, vnc.proposed_count, vnc.actual_count,
                vnc.referral_sheet_id, vnc.status AS name_coll_status, vnc.notes AS name_coll_notes
         FROM visit_tasks vt
         LEFT JOIN visit_task_results vtr ON vtr.visit_task_id = vt.id
         LEFT JOIN visit_name_collections vnc ON vnc.visit_task_id = vt.id
         WHERE vt.field_visit_id = $1
         ORDER BY vt.sequence_no`,
        [visitId],
      ),
      pool.query('SELECT * FROM visit_geo_logs WHERE visit_id = $1', [visitId]),
      pool.query('SELECT * FROM visit_sources WHERE visit_id = $1', [visitId]),
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

    const tasks = tasksRes.rows.map((t: any) => ({
      ...t,
      directSuggestions: suggestByTask.get(String(t.id)) ?? [],
    }));

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
      ...fvRows[0],
      tasks,
      geo: geoRes.rows[0] ?? null,
      source,
    });
  } catch (err: any) {
    console.error('[field-visits] GET /:id error:', err);
    res.status(500).json({ error: 'فشل في تحميل تفاصيل الزيارة' });
  }
});

// ─── NAME COLLECTION ──────────────────────────────────────────────────────────

// POST /api/field-visits/visit-tasks/:taskId/name-collection
/**
 * @swagger
 * /api/field-visits/visit-tasks/{taskId}/name-collection:
 *   post:
 *     tags: [Field Visits]
 *     summary: Create a name collection task
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
 *               proposed_count:
 *                 type: integer
 *     responses:
 *       201:
 *         description: Created name collection task
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/VisitNameCollection'
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
router.post('/visit-tasks/:taskId/name-collection', requirePermission('field_visits.edit'), async (req, res) => {
  try {
    const authContext = getAuthContext(req);
    const taskId = Number(req.params.taskId);
    if (!Number.isFinite(taskId)) return res.status(400).json({ error: 'معرف المهمة غير صالح' });

    const proposedCount = Number(req.body?.proposed_count ?? 0);
    if (!Number.isInteger(proposedCount) || proposedCount < 0) {
      return res.status(400).json({ error: 'proposed_count يجب أن يكون رقماً صحيحاً ≥ 0' });
    }

    const { rows: taskRows } = await pool.query(
      `SELECT vt.id, vt.field_visit_id, fv.client_id, fv.branch_id
       FROM visit_tasks vt
       JOIN field_visits fv ON fv.id = vt.field_visit_id
       WHERE vt.id = $1`,
      [taskId],
    );
    if (!taskRows[0]) return res.status(404).json({ error: 'المهمة غير موجودة' });
    if (!authContext.isSuperAdmin && taskRows[0].branch_id !== authContext.actingBranchId) {
      return res.status(403).json({ error: 'ليس لديك صلاحية الوصول' });
    }

    const clientId = taskRows[0].client_id;
    let referralSheetId: number | null = null;

    // Create referral_sheet if proposedCount > 0
    if (proposedCount > 0) {
      const { rows: clientRows } = await pool.query(
        'SELECT name FROM clients WHERE id = $1',
        [clientId],
      );
      const clientName = clientRows[0]?.name ?? 'زبون';

      const { rows: sheetRows } = await pool.query(
        `INSERT INTO referral_sheets (
           referral_type, referral_entity_id, referral_name_snapshot,
           referral_date, owner_user_id, total_candidates,
           branch_id, created_by, created_at
         ) VALUES (
           'client_visit', $1, $2,
           NOW()::date::text, $3, $4,
           $5, $3, NOW()
         ) RETURNING id`,
        [clientId, clientName, authContext.userId, proposedCount, taskRows[0].branch_id],
      );
      referralSheetId = sheetRows[0].id;
    }

    const { rows } = await pool.query(
      `INSERT INTO visit_name_collections
         (visit_task_id, client_id, proposed_count, actual_count, referral_sheet_id, status)
       VALUES ($1, $2, $3, 0, $4, 'pending')
       ON CONFLICT (visit_task_id) DO UPDATE SET
         proposed_count    = EXCLUDED.proposed_count,
         referral_sheet_id = COALESCE(EXCLUDED.referral_sheet_id, visit_name_collections.referral_sheet_id),
         status            = 'pending',
         updated_at        = NOW()
       RETURNING *`,
      [taskId, clientId, proposedCount, referralSheetId],
    );

    res.status(201).json(rows[0]);
  } catch (err: any) {
    console.error('[field-visits] POST /visit-tasks/:taskId/name-collection error:', err);
    res.status(500).json({ error: 'فشل في إنشاء مهمة التوصيل' });
  }
});

// PUT /api/field-visits/name-collections/:id/record-names
/**
 * @swagger
 * /api/field-visits/name-collections/{id}/record-names:
 *   put:
 *     tags: [Field Visits]
 *     summary: Record actual names collected
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
 *         description: Name Collection ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               actual_count:
 *                 type: integer
 *               notes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Names recorded successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/VisitNameCollection'
 *       400:
 *         description: Invalid input or ID
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Name collection not found
 *       500:
 *         description: Server error
 */
router.put('/name-collections/:id/record-names', requirePermission('field_visits.edit'), async (req, res) => {
  try {
    const authContext = getAuthContext(req);
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'معرف التوصيل غير صالح' });

    const actualCount = Number(req.body?.actual_count ?? 0);
    if (!Number.isInteger(actualCount) || actualCount < 0) {
      return res.status(400).json({ error: 'actual_count يجب أن يكون رقماً صحيحاً ≥ 0' });
    }
    const notes: string | null = typeof req.body?.notes === 'string' ? req.body.notes.trim() || null : null;

    const { rows: ncRows } = await pool.query(
      `SELECT vnc.*, fv.branch_id
       FROM visit_name_collections vnc
       JOIN visit_tasks vt ON vt.id = vnc.visit_task_id
       JOIN field_visits fv ON fv.id = vt.field_visit_id
       WHERE vnc.id = $1`,
      [id],
    );
    if (!ncRows[0]) return res.status(404).json({ error: 'سجل التوصيل غير موجود' });
    if (!authContext.isSuperAdmin && ncRows[0].branch_id !== authContext.actingBranchId) {
      return res.status(403).json({ error: 'ليس لديك صلاحية الوصول' });
    }

    const nc = ncRows[0];
    const newStatus = actualCount >= nc.proposed_count ? 'completed' : actualCount > 0 ? 'partial' : 'pending';

    const { rows } = await pool.query(
      `UPDATE visit_name_collections
       SET actual_count = $1, notes = $2, status = $3, updated_at = NOW()
       WHERE id = $4
       RETURNING *`,
      [actualCount, notes, newStatus, id],
    );

    // Sync referral_sheet total_candidates
    if (nc.referral_sheet_id && actualCount > 0) {
      await pool.query(
        'UPDATE referral_sheets SET total_candidates = $1 WHERE id = $2',
        [actualCount, nc.referral_sheet_id],
      );
    }

    res.json(rows[0]);
  } catch (err: any) {
    console.error('[field-visits] PUT /name-collections/:id/record-names error:', err);
    res.status(500).json({ error: 'فشل في تسجيل الأسماء' });
  }
});

// GET /api/field-visits/name-collections/:id
/**
 * @swagger
 * /api/field-visits/name-collections/{id}:
 *   get:
 *     tags: [Field Visits]
 *     summary: Get name collection details
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
 *         description: Name Collection ID
 *     responses:
 *       200:
 *         description: Name collection retrieved
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/VisitNameCollection'
 *       400:
 *         description: Invalid ID
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Name collection not found
 *       500:
 *         description: Server error
 */
router.get('/name-collections/:id', requirePermission('field_visits.view'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'معرف التوصيل غير صالح' });

    const { rows } = await pool.query(
      'SELECT * FROM visit_name_collections WHERE id = $1',
      [id],
    );
    if (!rows[0]) return res.status(404).json({ error: 'سجل التوصيل غير موجود' });
    res.json(rows[0]);
  } catch (err: any) {
    console.error('[field-visits] GET /name-collections/:id error:', err);
    res.status(500).json({ error: 'فشل في تحميل سجل التوصيل' });
  }
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
    if (!authContext.isSuperAdmin && taskRows[0].branch_id !== authContext.actingBranchId) {
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
    if (!authContext.isSuperAdmin && fvRows[0].branch_id !== authContext.actingBranchId) {
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

    // 3. Resolve or create the source open_task
    let openTaskId: number | null = Number(body.openTaskId) || null;
    if (openTaskId != null && openTaskId > 0) {
      const { rows: existingRows } = await client.query(
        `SELECT id, client_id, task_type FROM open_tasks WHERE id = $1 LIMIT 1`,
        [openTaskId],
      );
      if (existingRows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: `open_task #${openTaskId} غير موجودة` });
      }
      if (Number(existingRows[0].client_id) !== Number(visit.client_id)) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: 'لا يجوز إضافة مهمة لزبون مختلف عن زبون الزيارة (DEC-003 D7).',
        });
      }
      if (existingRows[0].task_type !== taskType) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: `نوع المهمة المطلوب (${taskType}) لا يطابق نوع open_task #${openTaskId} (${existingRows[0].task_type}).`,
        });
      }
    } else {
      // Create new open_task with creation_origin = cascading_during_visit
      const { rows: newRows } = await client.query(
        `INSERT INTO open_tasks (
           client_id, branch_id, task_type, task_family, reason, status,
           source, origin, creation_origin,
           assigned_at, assigned_by, assigned_via,
           created_by
         ) VALUES (
           $1, $2, $3, $4, $5, 'scheduled',
           'manual', 'manual_entry', 'cascading_during_visit',
           NOW(), $6, 'cascading',
           $6
         )
         RETURNING id`,
        [
          visit.client_id,
          visit.branch_id,
          taskType,
          taskFamily,
          body.reason ?? 'إضافة أثناء الزيارة',
          performedByUserId,
        ],
      );
      openTaskId = Number(newRows[0].id);
    }

    // 4. Insert the visit_task
    const { rows: vtRows } = await client.query(
      `INSERT INTO visit_tasks (
         field_visit_id, source_open_task_id,
         task_type, task_family,
         sequence_no, status
       )
       SELECT $1, $2, $3, $4,
              COALESCE(MAX(sequence_no), 0) + 1,
              'pending'
         FROM visit_tasks WHERE field_visit_id = $1
       RETURNING id, sequence_no`,
      [fieldVisitId, openTaskId, taskType, taskFamily],
    );

    // 5. Ensure the linked open_task is in scheduled state
    await client.query(
      `UPDATE open_tasks SET status = 'scheduled', updated_at = NOW() WHERE id = $1 AND status IN ('open', 'needs_follow_up', 'assigned', 'in_scheduling')`,
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
    if (!authContext.isSuperAdmin && visit.branch_id !== authContext.actingBranchId) {
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
    if (!authContext.isSuperAdmin && visitRows[0].branch_id !== authContext.actingBranchId) {
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
    if (!authContext.isSuperAdmin && visitRows[0].branch_id !== authContext.actingBranchId) {
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

export default router;
