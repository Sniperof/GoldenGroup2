import { Router } from 'express';
import pool from '../db.js';
import { requirePermission } from '../middleware/permission.js';
import { authorize } from '../services/authorizationService.js';
import { isAcceptedMediaUrl } from '../services/media/mediaAttachments.js';
import { syncMediaOwnership } from '../services/media/mediaOwnership.js';
import type { AuthContext } from '@golden-crm/shared';

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

export function validateBranchImages(images: unknown, primaryImageId: unknown): string | null {
  if (!Array.isArray(images)) return 'images يجب أن يكون مصفوفة';
  if (images.length > 20) return 'لا يمكن إضافة أكثر من 20 صورة للفرع';
  const ids = new Set<string>();
  for (const image of images) {
    if (!image || typeof image !== 'object') return 'كل عنصر في images يجب أن يكون كائناً';
    const id = typeof (image as any).id === 'string' ? (image as any).id.trim() : '';
    const name = typeof (image as any).name === 'string' ? (image as any).name.trim() : '';
    const url = typeof (image as any).url === 'string' ? (image as any).url.trim() : '';
    if (!id || !name || !url) return 'كل صورة يجب أن تحتوي id و name و url';
    if (ids.has(id)) return 'معرفات الصور يجب أن تكون فريدة';
    // Any string used to pass here, so branch photos were stored as multi-MB
    // base64 inside the row and shipped on every branch list query. Only files
    // this server hosts are accepted now (migration 423).
    if (!isAcceptedMediaUrl(url)) return 'يجب رفع صور الفرع عبر النظام';
    ids.add(id);
  }
  const primary = typeof primaryImageId === 'string' ? primaryImageId.trim() : '';
  if (primary && !ids.has(primary)) return 'الصورة الرئيسية يجب أن تكون ضمن صور الفرع';
  return null;
}

export function normalizeMapLocation(latitudeValue: unknown, longitudeValue: unknown) {
  const latitudeMissing = latitudeValue == null || (typeof latitudeValue === 'string' && !latitudeValue.trim());
  const longitudeMissing = longitudeValue == null || (typeof longitudeValue === 'string' && !longitudeValue.trim());
  if (latitudeMissing && longitudeMissing) return { latitude: null, longitude: null, error: null };
  if (latitudeMissing !== longitudeMissing) {
    return { latitude: null, longitude: null, error: 'يجب إدخال خط العرض وخط الطول معاً' };
  }
  const latitude = Number(latitudeValue);
  const longitude = Number(longitudeValue);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    return { latitude: null, longitude: null, error: 'خط العرض يجب أن يكون بين -90 و 90' };
  }
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    return { latitude: null, longitude: null, error: 'خط الطول يجب أن يكون بين -180 و 180' };
  }
  return { latitude, longitude, error: null };
}

export function validateMobileProfile(body: any, partial = false) {
  if (Object.prototype.hasOwnProperty.call(body, 'mobileVisible') && typeof body.mobileVisible !== 'boolean') {
    return 'mobileVisible يجب أن تكون قيمة منطقية';
  }
  const hasImages = Object.prototype.hasOwnProperty.call(body, 'images');
  const hasPrimaryImage = Object.prototype.hasOwnProperty.call(body, 'primaryImageId');
  if (!partial || hasImages || hasPrimaryImage) {
    if (partial && hasImages !== hasPrimaryImage) return 'يجب إرسال images و primaryImageId معاً';
    const imageError = validateBranchImages(body.images ?? [], body.primaryImageId);
    if (imageError) return imageError;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'publicDescription')) {
    const description = String(body.publicDescription ?? '').trim();
    if (description.length > 2000) return 'وصف الفرع العام يجب ألا يتجاوز 2000 محرف';
  }

  if (Object.prototype.hasOwnProperty.call(body, 'mobileDisplayOrder')) {
    const order = Number(body.mobileDisplayOrder);
    if (!Number.isInteger(order) || order < 0) return 'ترتيب ظهور الفرع يجب أن يكون عدداً صحيحاً غير سالب';
  }

  const hasLatitude = Object.prototype.hasOwnProperty.call(body, 'latitude');
  const hasLongitude = Object.prototype.hasOwnProperty.call(body, 'longitude');
  if (!partial || hasLatitude || hasLongitude) {
    if (partial && hasLatitude !== hasLongitude) return 'يجب إرسال latitude و longitude معاً';
    return normalizeMapLocation(body.latitude, body.longitude).error;
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

function hasGlobalPermission(authContext: AuthContext, permission: string): boolean {
  const result = authorize(authContext, { permission });
  return result.allowed && (result.reason === 'SUPER_ADMIN' || result.reason === 'GRANTED_GLOBAL');
}

function hasBranchPermission(
  authContext: AuthContext,
  permission: string,
  branchId: number,
): boolean {
  return authorize(authContext, { permission, branchId }).allowed;
}

async function loadBranchCoverage(branchId: number): Promise<number[]> {
  const { rows } = await pool.query(
    `SELECT geo_unit_id AS "geoUnitId"
       FROM branch_geo_coverage
      WHERE branch_id = $1
      ORDER BY geo_unit_id`,
    [branchId],
  );

  return rows.map(row => Number(row.geoUnitId)).filter(Number.isInteger);
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
router.get('/', requirePermission('branches.view', 'branches.lookup', 'reference_data.lookup'), async (req, res) => {
  try {
    const authContext = req.authContext!;
    const canViewManagement = authorize(authContext, { permission: 'branches.view' }).allowed;
    // A GLOBAL branch/reference lookup means "all branches as reference data" —
    // a company-wide operator must see every branch name in pickers, not only
    // their assigned ones. Otherwise callers are confined to allowedBranchIds.
    const hasGlobalLookup = (authContext.grants ?? []).some((g: any) =>
      (g.permission === 'branches.lookup' || g.permission === 'reference_data.lookup') && g.scope === 'GLOBAL');
    const returnAllBranches = canViewManagement || authContext.isSuperAdmin || hasGlobalLookup;

    const { rows } = await pool.query(`
      SELECT b.id, b.name,
             b.location_geo_id AS "locationGeoId",
             b.detailed_address AS "detailedAddress",
             ARRAY(
               SELECT geo_unit_id FROM branch_geo_coverage
               WHERE branch_id = b.id ORDER BY geo_unit_id
             ) AS "coveredGeoIds",
             COALESCE(b.contact_info, '[]'::jsonb) AS "contactInfo",
             b.mobile_visible AS "mobileVisible",
             b.mobile_display_order AS "mobileDisplayOrder",
             b.public_description AS "publicDescription",
             COALESCE(b.images, '[]'::jsonb) AS images,
             b.primary_image_id AS "primaryImageId",
             b.latitude,
             b.longitude,
             b.status,
             b.created_at      AS "createdAt",
             g.name            AS "locationGeoName"
      FROM branches b
      LEFT JOIN geo_units g ON g.id = b.location_geo_id
      WHERE $1::boolean
         OR b.id = ANY($2::int[])
      ORDER BY b.created_at DESC
    `, [returnAllBranches, authContext.allowedBranchIds]);
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
router.get('/:id', requirePermission('branches.view', 'branches.lookup', 'reference_data.lookup'), async (req, res) => {
  try {
    const authContext = req.authContext!;
    const canViewManagement = authorize(authContext, { permission: 'branches.view' }).allowed;
    const branchId = Number(req.params.id);
    if (!Number.isInteger(branchId) || branchId <= 0) {
      return res.status(400).json({ error: 'ط±ظ‚ظ… ط§ظ„ظپط±ط¹ ط؛ظٹط± طµط§ظ„ط­' });
    }
    if (!canViewManagement && !authContext.isSuperAdmin && !authContext.allowedBranchIds.includes(branchId)) {
      return res.status(403).json({ error: 'ط؛ظٹط± ظ…ط³ظ…ظˆط­' });
    }

    const { rows } = await pool.query(
      `SELECT b.id, b.name,
              b.location_geo_id AS "locationGeoId",
              b.detailed_address AS "detailedAddress",
              ARRAY(
                SELECT geo_unit_id FROM branch_geo_coverage
                WHERE branch_id = b.id ORDER BY geo_unit_id
              ) AS "coveredGeoIds",
              COALESCE(b.contact_info, '[]'::jsonb) AS "contactInfo",
              b.mobile_visible AS "mobileVisible",
              b.mobile_display_order AS "mobileDisplayOrder",
              b.public_description AS "publicDescription",
              COALESCE(b.images, '[]'::jsonb) AS images,
              b.primary_image_id AS "primaryImageId",
              b.latitude,
              b.longitude,
              b.status,
              b.created_at      AS "createdAt",
              g.name            AS "locationGeoName"
       FROM branches b
       LEFT JOIN geo_units g ON g.id = b.location_geo_id
       WHERE b.id = $1`,
      [branchId]
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
    if (!hasGlobalPermission(req.authContext!, 'branches.manage')) {
      return res.status(403).json({ error: 'Creating branches requires GLOBAL branches.manage' });
    }

    const { name, locationGeoId, detailedAddress, coveredGeoIds, contactInfo, status } = req.body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'اسم الفرع مطلوب' });
    }
    const contactErr = validateContactInfo(contactInfo ?? []);
    if (contactErr) {
      return res.status(400).json({ error: contactErr });
    }
    const mobileProfileErr = validateMobileProfile(req.body);
    if (mobileProfileErr) {
      return res.status(400).json({ error: mobileProfileErr });
    }
    const mapLocation = normalizeMapLocation(req.body.latitude, req.body.longitude);

    const ids: number[] = Array.isArray(coveredGeoIds) ? coveredGeoIds.map(Number).filter(Boolean) : [];

    await client.query('BEGIN');

    const { rows } = await client.query(
      `INSERT INTO branches (
         name, location_geo_id, detailed_address, contact_info, status,
         mobile_visible, mobile_display_order, public_description,
         images, primary_image_id, latitude, longitude
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING id, name,
                 location_geo_id AS "locationGeoId",
                 detailed_address AS "detailedAddress",
                 COALESCE(contact_info, '[]'::jsonb) AS "contactInfo",
                 mobile_visible AS "mobileVisible",
                 mobile_display_order AS "mobileDisplayOrder",
                 public_description AS "publicDescription",
                 COALESCE(images, '[]'::jsonb) AS images,
                 primary_image_id AS "primaryImageId",
                 latitude,
                 longitude,
                 status,
                 created_at AS "createdAt"`,
      [
        name,
        locationGeoId || null,
        detailedAddress || null,
        JSON.stringify(contactInfo || []),
        status || 'active',
        req.body.mobileVisible === true,
        Number(req.body.mobileDisplayOrder ?? 0),
        String(req.body.publicDescription ?? '').trim() || null,
        JSON.stringify(req.body.images ?? []),
        req.body.primaryImageId || null,
        mapLocation.latitude,
        mapLocation.longitude,
      ]
    );
    const newBranch = rows[0];

    await syncBranchGeoCoverage(client as any, newBranch.id, ids);
    await syncMediaOwnership(client, 'branch', newBranch.id, req.body.images);

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
    const branchId = Number(req.params.id);
    if (!Number.isInteger(branchId) || branchId <= 0) {
      return res.status(400).json({ error: 'Invalid branch id' });
    }
    const { name, locationGeoId, detailedAddress, coveredGeoIds, contactInfo, status } = req.body;

    // coveredGeoIds and status are security-sensitive (affect data scoping / operations).
    // branches.edit is insufficient — branches.manage is required.
    const sensitiveFieldsPresent = coveredGeoIds !== undefined
      || status !== undefined
      || req.body.mobileVisible !== undefined
      || req.body.mobileDisplayOrder !== undefined;
    const canManageThisBranch = hasBranchPermission(req.authContext!, 'branches.manage', branchId);
    const canEditThisBranch = hasBranchPermission(req.authContext!, 'branches.edit', branchId);
    if (sensitiveFieldsPresent ? !canManageThisBranch : (!canManageThisBranch && !canEditThisBranch)) {
      return res.status(403).json({
        error: sensitiveFieldsPresent
          ? 'Updating branch status, coverage, publication, or mobile ordering requires branches.manage on this branch'
          : 'Updating branch details requires branches.edit or branches.manage on this branch',
      });
    }

    if (sensitiveFieldsPresent && req.authContext) {
      const manageCheck = authorize(req.authContext, { permission: 'branches.manage', branchId });
      if (!manageCheck.allowed) {
        return res.status(403).json({
          error: 'غير مسموح: تعديل التغطية أو الحالة أو نشر الفرع للموبايل يتطلب صلاحية branches.manage',
        });
      }
    }

    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'اسم الفرع مطلوب' });
    }
    const contactErr = validateContactInfo(contactInfo ?? []);
    if (contactErr) {
      return res.status(400).json({ error: contactErr });
    }
    const mobileProfileErr = validateMobileProfile(req.body, true);
    if (mobileProfileErr) {
      return res.status(400).json({ error: mobileProfileErr });
    }
    const hasMapLocation = Object.prototype.hasOwnProperty.call(req.body, 'latitude');
    const mapLocation = hasMapLocation
      ? normalizeMapLocation(req.body.latitude, req.body.longitude)
      : { latitude: null, longitude: null };

    const ids: number[] = Array.isArray(coveredGeoIds) ? coveredGeoIds.map(Number).filter(Boolean) : [];

    await client.query('BEGIN');

    const { rows } = await client.query(
      `UPDATE branches SET
         name             = $1,
         location_geo_id  = $2,
         detailed_address = $3,
         contact_info     = $4,
         status           = COALESCE($5, status),
         mobile_visible   = CASE WHEN $6 THEN $7 ELSE mobile_visible END,
         mobile_display_order = CASE WHEN $8 THEN $9 ELSE mobile_display_order END,
         public_description = CASE WHEN $10 THEN $11 ELSE public_description END,
         images           = CASE WHEN $12 THEN $13 ELSE images END,
         primary_image_id = CASE WHEN $12 THEN $14 ELSE primary_image_id END,
         latitude         = CASE WHEN $15 THEN $16 ELSE latitude END,
         longitude        = CASE WHEN $15 THEN $17 ELSE longitude END
       WHERE id = $18
       RETURNING id, name,
                 location_geo_id AS "locationGeoId",
                 detailed_address AS "detailedAddress",
                 COALESCE(contact_info, '[]'::jsonb) AS "contactInfo",
                 mobile_visible AS "mobileVisible",
                 mobile_display_order AS "mobileDisplayOrder",
                 public_description AS "publicDescription",
                 COALESCE(images, '[]'::jsonb) AS images,
                 primary_image_id AS "primaryImageId",
                 latitude,
                 longitude,
                 status,
                 created_at AS "createdAt"`,
      [
        name,
        locationGeoId || null,
        detailedAddress || null,
        JSON.stringify(contactInfo || []),
        status ?? null,
        Object.prototype.hasOwnProperty.call(req.body, 'mobileVisible'),
        req.body.mobileVisible === true,
        Object.prototype.hasOwnProperty.call(req.body, 'mobileDisplayOrder'),
        Number(req.body.mobileDisplayOrder ?? 0),
        Object.prototype.hasOwnProperty.call(req.body, 'publicDescription'),
        String(req.body.publicDescription ?? '').trim() || null,
        Object.prototype.hasOwnProperty.call(req.body, 'images'),
        JSON.stringify(req.body.images ?? []),
        req.body.primaryImageId || null,
        hasMapLocation,
        mapLocation.latitude,
        mapLocation.longitude,
        branchId,
      ]
    );

    if (rows.length === 0) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'الفرع غير موجود' });
      return;
    }

    if (coveredGeoIds !== undefined) {
      await syncBranchGeoCoverage(client as any, branchId, ids);
    }
    // Only when images were part of this request — the UPDATE leaves the column
    // untouched otherwise, so re-syncing would release every image on any
    // unrelated branch edit.
    if (Object.prototype.hasOwnProperty.call(req.body, 'images')) {
      await syncMediaOwnership(client, 'branch', branchId, req.body.images);
    }

    await client.query('COMMIT');
    res.json({
      ...rows[0],
      coveredGeoIds: coveredGeoIds !== undefined ? ids : await loadBranchCoverage(branchId),
    });
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
    const branchId = Number(req.params.id);
    if (!Number.isInteger(branchId) || branchId <= 0) {
      return res.status(400).json({ error: 'Invalid branch id' });
    }

    if (!hasBranchPermission(req.authContext!, 'branches.manage', branchId)) {
      return res.status(403).json({ error: 'Deleting this branch requires branches.manage on this branch' });
    }

    const { rowCount } = await pool.query('DELETE FROM branches WHERE id = $1', [branchId]);
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
