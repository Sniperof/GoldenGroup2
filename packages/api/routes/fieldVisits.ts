import { Router } from 'express';
import pool from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permission.js';

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
router.post('/:id/start', requirePermission('marketing_visits.update_result'), async (req, res) => {
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
router.post('/:id/end', requirePermission('marketing_visits.update_result'), async (req, res) => {
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
router.get('/:id/geo', requirePermission('marketing_visits.view'), async (req, res) => {
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
router.get('/:id/source', requirePermission('marketing_visits.view'), async (req, res) => {
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

// ─── FULL VISIT DETAILS ───────────────────────────────────────────────────────

// GET /api/field-visits/:id — full visit with tasks, geo, source
router.get('/:id', requirePermission('marketing_visits.view'), async (req, res) => {
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
router.post('/visit-tasks/:taskId/name-collection', requirePermission('marketing_visits.update_result'), async (req, res) => {
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
router.put('/name-collections/:id/record-names', requirePermission('marketing_visits.update_result'), async (req, res) => {
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
router.get('/name-collections/:id', requirePermission('marketing_visits.view'), async (req, res) => {
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
router.post('/visit-tasks/:taskId/direct-suggestions', requirePermission('marketing_visits.update_result'), async (req, res) => {
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
router.get('/visit-tasks/:taskId/direct-suggestions', requirePermission('marketing_visits.view'), async (req, res) => {
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
router.post('/:id/complete', requirePermission('marketing_visits.update_result'), async (req, res) => {
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

    // Guard: all visit_tasks must have results
    const { rows: pendingTasks } = await pool.query(
      `SELECT vt.id FROM visit_tasks vt
       LEFT JOIN visit_task_results vtr ON vtr.visit_task_id = vt.id
       WHERE vt.field_visit_id = $1 AND vtr.id IS NULL`,
      [visitId],
    );
    if (pendingTasks.length > 0) {
      return res.status(400).json({
        error: `لا يمكن إتمام الزيارة: ${pendingTasks.length} مهمة لم يُسجَّل لها نتيجة بعد`,
      });
    }

    // Guard: name collections must be completed (not pending)
    const { rows: pendingNC } = await pool.query(
      `SELECT vnc.id, vnc.status, vnc.proposed_count, vnc.actual_count
       FROM visit_name_collections vnc
       JOIN visit_tasks vt ON vt.id = vnc.visit_task_id
       WHERE vt.field_visit_id = $1 AND vnc.status = 'pending' AND vnc.proposed_count > 0`,
      [visitId],
    );
    if (pendingNC.length > 0) {
      return res.status(400).json({
        error: 'مهمة التوصيل غير مكتملة — يجب تسجيل الأسماء الفعلية',
      });
    }

    const { rows: partialNC } = await pool.query(
      `SELECT vnc.id FROM visit_name_collections vnc
       JOIN visit_tasks vt ON vt.id = vnc.visit_task_id
       WHERE vt.field_visit_id = $1 AND vnc.status = 'partial'`,
      [visitId],
    );
    if (partialNC.length > 0) {
      return res.status(400).json({
        error: 'عدد الأسماء المسجل أقل من المقترح — تأكد من اكتمال التوصيل',
      });
    }

    await pool.query(
      `UPDATE field_visits SET status = 'completed', closed_by = $1, closed_at = NOW(), updated_at = NOW()
       WHERE id = $2`,
      [authContext.userId, visitId],
    );

    res.json({ success: true });
  } catch (err: any) {
    console.error('[field-visits] POST /:id/complete error:', err);
    res.status(500).json({ error: 'فشل في إتمام الزيارة' });
  }
});

export default router;
