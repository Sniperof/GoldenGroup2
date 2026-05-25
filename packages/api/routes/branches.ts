import { Router } from 'express';
import pool from '../db.js';
import { requirePermission } from '../middleware/permission.js';
import { authorize } from '../services/authorizationService.js';

const router = Router();

const VALID_CONTACT_TYPES = new Set(['email', 'phone', 'mobile', 'website']);
const VALID_DEPARTMENTS   = new Set(['customer_service', 'hr', 'management', 'accounting', 'other']);

function validateContactInfo(contactInfo: unknown): string | null {
  if (!Array.isArray(contactInfo)) return 'contactInfo يجب أن يكون مصفوفة';
  for (const item of contactInfo) {
    if (typeof item !== 'object' || item === null) return 'كل عنصر في contactInfo يجب أن يكون كائناً';
    if (!VALID_CONTACT_TYPES.has((item as any).type))
      return `نوع التواصل "${(item as any).type}" غير مدعوم — المسموح: email, phone, mobile, website`;
    if (!VALID_DEPARTMENTS.has((item as any).department))
      return `القسم "${(item as any).department}" غير مدعوم — المسموح: customer_service, hr, management, accounting, other`;
    if (typeof (item as any).value !== 'string' || !(item as any).value.trim())
      return 'حقل value مطلوب لكل عنصر في contactInfo';
  }
  return null;
}

// Helper: sync branch_geo_coverage rows within an open transaction client
async function syncBranchGeoCoverage(
  client: typeof pool,
  branchId: number,
  coveredGeoIds: number[],
): Promise<void> {
  await (client as any).query('DELETE FROM branch_geo_coverage WHERE branch_id = $1', [branchId]);
  for (const geoId of coveredGeoIds) {
    await (client as any).query(
      'INSERT INTO branch_geo_coverage (branch_id, geo_unit_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [branchId, geoId],
    );
  }
}

/**
 * @swagger
 * /api/branches:
 *   get:
 *     tags: [Branches]
 *     summary: List all branches
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of branches
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: integer
 *                   name:
 *                     type: string
 *                   locationGeoId:
 *                     type: integer
 *                   detailedAddress:
 *                     type: string
 *                   coveredGeoIds:
 *                     type: array
 *                     items:
 *                       type: integer
 *                   contactInfo:
 *                     type: array
 *                   status:
 *                     type: string
 *                   createdAt:
 *                     type: string
 *                     format: date-time
 *                   locationGeoName:
 *                     type: string
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get('/', requirePermission('branches.view'), async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT b.id, b.name,
             b.location_geo_id AS "locationGeoId",
             b.detailed_address AS "detailedAddress",
             ARRAY(
               SELECT geo_unit_id FROM branch_geo_coverage
               WHERE branch_id = b.id ORDER BY geo_unit_id
             ) AS "coveredGeoIds",
             COALESCE(b.contact_info, '[]'::jsonb) AS "contactInfo",
             b.status,
             b.created_at      AS "createdAt",
             g.name            AS "locationGeoName"
      FROM branches b
      LEFT JOIN geo_units g ON g.id = b.location_geo_id
      ORDER BY b.created_at DESC
    `);
    res.json(rows);
  } catch (err: any) {
    console.error('Error fetching branches:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/branches/{id}:
 *   get:
 *     tags: [Branches]
 *     summary: Get a branch by ID
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Branch ID
 *     responses:
 *       200:
 *         description: Branch details
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Branch not found
 *       500:
 *         description: Server error
 */
router.get('/:id', requirePermission('branches.view'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT b.id, b.name,
              b.location_geo_id AS "locationGeoId",
              b.detailed_address AS "detailedAddress",
              ARRAY(
                SELECT geo_unit_id FROM branch_geo_coverage
                WHERE branch_id = b.id ORDER BY geo_unit_id
              ) AS "coveredGeoIds",
              COALESCE(b.contact_info, '[]'::jsonb) AS "contactInfo",
              b.status,
              b.created_at      AS "createdAt",
              g.name            AS "locationGeoName"
       FROM branches b
       LEFT JOIN geo_units g ON g.id = b.location_geo_id
       WHERE b.id = $1`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'الفرع غير موجود' });
    res.json(rows[0]);
  } catch (err: any) {
    console.error('Error fetching branch:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/branches:
 *   post:
 *     tags: [Branches]
 *     summary: Create a new branch
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name:
 *                 type: string
 *               locationGeoId:
 *                 type: integer
 *               detailedAddress:
 *                 type: string
 *               coveredGeoIds:
 *                 type: array
 *                 items:
 *                   type: integer
 *               contactInfo:
 *                 type: array
 *               status:
 *                 type: string
 *                 enum: [active, inactive]
 *     responses:
 *       200:
 *         description: Created branch
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       500:
 *         description: Server error
 */
router.post('/', requirePermission('branches.manage'), async (req, res) => {
  const client = await pool.connect();
  try {
    const { name, locationGeoId, detailedAddress, coveredGeoIds, contactInfo, status } = req.body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      client.release();
      return res.status(400).json({ error: 'اسم الفرع مطلوب' });
    }
    const contactErr = validateContactInfo(contactInfo ?? []);
    if (contactErr) {
      client.release();
      return res.status(400).json({ error: contactErr });
    }

    const ids: number[] = Array.isArray(coveredGeoIds) ? coveredGeoIds.map(Number).filter(Boolean) : [];

    await client.query('BEGIN');

    const { rows } = await client.query(
      `INSERT INTO branches (name, location_geo_id, detailed_address, contact_info, status)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name,
                 location_geo_id AS "locationGeoId",
                 detailed_address AS "detailedAddress",
                 COALESCE(contact_info, '[]'::jsonb) AS "contactInfo",
                 status,
                 created_at AS "createdAt"`,
      [
        name,
        locationGeoId || null,
        detailedAddress || null,
        JSON.stringify(contactInfo || []),
        status || 'active',
      ]
    );
    const newBranch = rows[0];

    await syncBranchGeoCoverage(client as any, newBranch.id, ids);

    await client.query('COMMIT');
    res.json({ ...newBranch, coveredGeoIds: ids });
  } catch (err: any) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error creating branch:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

/**
 * @swagger
 * /api/branches/{id}:
 *   put:
 *     tags: [Branches]
 *     summary: Update a branch
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Branch ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               locationGeoId:
 *                 type: integer
 *               detailedAddress:
 *                 type: string
 *               coveredGeoIds:
 *                 type: array
 *                 items:
 *                   type: integer
 *               contactInfo:
 *                 type: array
 *               status:
 *                 type: string
 *                 enum: [active, inactive]
 *     responses:
 *       200:
 *         description: Updated branch
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Branch not found
 *       500:
 *         description: Server error
 */
router.put('/:id', requirePermission('branches.edit', 'branches.manage'), async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { name, locationGeoId, detailedAddress, coveredGeoIds, contactInfo, status } = req.body;

    // coveredGeoIds and status are security-sensitive (affect data scoping / operations).
    // branches.edit is insufficient — branches.manage is required.
    const sensitiveFieldsPresent = coveredGeoIds !== undefined || status !== undefined;
    if (sensitiveFieldsPresent && req.authContext) {
      const manageCheck = authorize(req.authContext, { permission: 'branches.manage' });
      if (!manageCheck.allowed) {
        client.release();
        return res.status(403).json({
          error: 'غير مسموح: تعديل نطاق التغطية الجغرافية أو حالة الفرع يتطلب صلاحية branches.manage',
        });
      }
    }

    if (!name || typeof name !== 'string' || !name.trim()) {
      client.release();
      return res.status(400).json({ error: 'اسم الفرع مطلوب' });
    }
    const contactErr = validateContactInfo(contactInfo ?? []);
    if (contactErr) {
      client.release();
      return res.status(400).json({ error: contactErr });
    }

    const ids: number[] = Array.isArray(coveredGeoIds) ? coveredGeoIds.map(Number).filter(Boolean) : [];

    await client.query('BEGIN');

    const { rows } = await client.query(
      `UPDATE branches SET
         name             = $1,
         location_geo_id  = $2,
         detailed_address = $3,
         contact_info     = $4,
         status           = COALESCE($5, status)
       WHERE id = $6
       RETURNING id, name,
                 location_geo_id AS "locationGeoId",
                 detailed_address AS "detailedAddress",
                 COALESCE(contact_info, '[]'::jsonb) AS "contactInfo",
                 status,
                 created_at AS "createdAt"`,
      [
        name,
        locationGeoId || null,
        detailedAddress || null,
        JSON.stringify(contactInfo || []),
        status ?? null,
        id,
      ]
    );

    if (rows.length === 0) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'الفرع غير موجود' });
      return;
    }

    await syncBranchGeoCoverage(client as any, Number(id), ids);

    await client.query('COMMIT');
    res.json({ ...rows[0], coveredGeoIds: ids });
  } catch (err: any) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error updating branch:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

/**
 * @swagger
 * /api/branches/{id}:
 *   delete:
 *     tags: [Branches]
 *     summary: Delete a branch
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Branch ID
 *     responses:
 *       200:
 *         description: Deleted successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Branch not found
 *       500:
 *         description: Server error
 */
router.delete('/:id', requirePermission('branches.manage'), async (req, res) => {
  try {
    const { id } = req.params;
    const { rowCount } = await pool.query('DELETE FROM branches WHERE id = $1', [id]);
    if (rowCount === 0) return res.status(404).json({ error: 'الفرع غير موجود' });
    res.json({ success: true });
  } catch (err: any) {
    if (err.code === '23503') {
      res.status(409).json({
        error: 'لا يمكن حذف هذا الفرع — يوجد عملاء أو موظفون أو عقود مرتبطة به. أرشف الفرع بدلاً من حذفه.',
      });
      return;
    }
    console.error('Error deleting branch:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
