import { Router } from 'express';
import pool from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permission.js';

const router = Router();

const selectFields = `
  id, name, brand, name_ar AS "nameAr", name_en AS "nameEn", category,
  maintenance_interval AS "maintenanceInterval", base_price AS "basePrice",
  supported_visit_types AS "supportedVisitTypes",
  is_golden_warranty AS "isGoldenWarranty",
  golden_warranty_periods AS "goldenWarrantyPeriods",
  warranty_periods AS "warrantyPeriods",
  is_featured AS "isFeatured",
  description, description_en AS "descriptionEn", images, primary_image_id AS "primaryImageId", videos, documents, code
`;

function serializeDevice(row: any) {
  return {
    ...row,
    basePrice: Number(row.basePrice ?? 0),
    supportedVisitTypes: Array.isArray(row.supportedVisitTypes) ? row.supportedVisitTypes : [],
    goldenWarrantyPeriods: Array.isArray(row.goldenWarrantyPeriods) ? row.goldenWarrantyPeriods : [],
    warrantyPeriods: Array.isArray(row.warrantyPeriods) ? row.warrantyPeriods : [],
    descriptionEn: row.descriptionEn || null,
    code: row.code || null,
    images: Array.isArray(row.images) ? row.images : [],
    videos: Array.isArray(row.videos) ? row.videos : [],
    documents: Array.isArray(row.documents) ? row.documents : [],
  };
}

function normalizeDevicePayload(body: any) {
  const nameAr = String(body.nameAr ?? body.name ?? '').trim();
  const nameEn = String(body.nameEn ?? '').trim();
  const basePrice = Number(body.basePrice);

  return {
    nameAr,
    nameEn,
    name: nameAr,
    brand: nameEn,
    category: body.category || 'Industrial',
    maintenanceInterval: body.maintenanceInterval || '6 أشهر',
    basePrice,
    supportedVisitTypes: Array.isArray(body.supportedVisitTypes) ? body.supportedVisitTypes : [],
    isGoldenWarranty: body.isGoldenWarranty === true,
    goldenWarrantyPeriods: body.isGoldenWarranty === true && Array.isArray(body.goldenWarrantyPeriods)
      ? body.goldenWarrantyPeriods
      : [],
    warrantyPeriods: Array.isArray(body.warrantyPeriods) ? body.warrantyPeriods : [],
    isFeatured: body.isFeatured === true,
    description: String(body.description ?? '').trim() || null,
    descriptionEn: String(body.descriptionEn ?? '').trim() || null,
    images: Array.isArray(body.images) ? body.images : [],
    primaryImageId: body.primaryImageId || null,
    videos: Array.isArray(body.videos) ? body.videos : [],
    documents: Array.isArray(body.documents) ? body.documents : [],
    code: String(body.code ?? '').trim() || null,
  };
}

/**
 * @swagger
 * components:
 *   schemas:
 *     DeviceModel:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *         name:
 *           type: string
 *         brand:
 *           type: string
 *         nameAr:
 *           type: string
 *         nameEn:
 *           type: string
 *         category:
 *           type: string
 *         maintenanceInterval:
 *           type: string
 *         basePrice:
 *           type: number
 *         supportedVisitTypes:
 *           type: array
 *           items:
 *             type: string
 *         isGoldenWarranty:
 *           type: boolean
 *         goldenWarrantyPeriods:
 *           type: array
 *           items:
 *             type: string
 *         isFeatured:
 *           type: boolean
 *         description:
 *           type: string
 *         descriptionEn:
 *           type: string
 *         images:
 *           type: array
 *           items:
 *             type: string
 *         primaryImageId:
 *           type: string
 *         videos:
 *           type: array
 *           items:
 *             type: string
 *         documents:
 *           type: array
 *           items:
 *             type: string
 *         code:
 *           type: string
 */

/**
 * @swagger
 * /api/device-models:
 *   get:
 *     tags: [Device Models]
 *     summary: Retrieve list of all device models (public)
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: false
 *         description: Branch context
 *       - in: query
 *         name: branchId
 *         schema:
 *           type: integer
 *         required: false
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         required: false
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *         required: false
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         required: false
 *     responses:
 *       200:
 *         description: Success
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/DeviceModel'
 *       500:
 *         description: Server error
 */
router.get('/', requireAuth, async (_req, res) => {
  const { rows } = await pool.query(`SELECT ${selectFields} FROM device_models WHERE deleted_at IS NULL ORDER BY id`);
  res.json(rows.map(serializeDevice));
});

/**
 * @swagger
 * /api/device-models/for-sale:
 *   get:
 *     tags: [Device Models]
 *     summary: Retrieve authorized device models for sale
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: false
 *         description: Branch context
 *       - in: query
 *         name: branchId
 *         schema:
 *           type: integer
 *         required: false
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         required: false
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *         required: false
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         required: false
 *     responses:
 *       200:
 *         description: Success
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
 *                   category:
 *                     type: string
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get('/for-sale', requireAuth, async (req, res) => {
  try {
    if (req.user?.isSuperAdmin === true) {
      const { rows } = await pool.query(
        `SELECT id, name, category
         FROM device_models
         WHERE deleted_at IS NULL
         ORDER BY name ASC, id ASC`,
      );
      return res.json(rows);
    }

    const { rows: userRows } = await pool.query(
      `SELECT e.department_id AS "departmentId"
       FROM hr_users u
       LEFT JOIN employees e ON e.id = u.employee_id
       WHERE u.id = $1`,
      [req.user?.id ?? null],
    );
    const departmentId = userRows[0]?.departmentId ?? null;

    if (!departmentId) {
      return res.json([]);
    }

    const { rows: deptRows } = await pool.query(
      `SELECT device_model_ids AS "deviceModelIds"
       FROM departments
       WHERE id = $1`,
      [departmentId],
    );

    const rawIds = Array.isArray(deptRows[0]?.deviceModelIds) ? deptRows[0].deviceModelIds : [];
    const deviceModelIds = rawIds
      .map((value: any) => Number(value))
      .filter((value: number) => Number.isInteger(value) && value > 0);

    if (deviceModelIds.length === 0) {
      return res.json([]);
    }

    const { rows } = await pool.query(
      `SELECT id, name, category
       FROM device_models
       WHERE id = ANY($1::int[]) AND deleted_at IS NULL
       ORDER BY name ASC, id ASC`,
      [deviceModelIds],
    );
    return res.json(rows);
  } catch (err: any) {
    console.error('[device-models] GET /for-sale error:', err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/device-models:
 *   post:
 *     tags: [Device Models]
 *     summary: Create new device model
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: false
 *         description: Branch context
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [nameAr, nameEn, basePrice]
 *             properties:
 *               nameAr:
 *                 type: string
 *               nameEn:
 *                 type: string
 *               basePrice:
 *                 type: number
 *               category:
 *                 type: string
 *     responses:
 *       200:
 *         description: Success
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DeviceModel'
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.post('/', requirePermission('catalog.manage'), async (req, res) => {
  const d = normalizeDevicePayload(req.body);
  if (!d.nameAr) return res.status(400).json({ error: 'اسم الجهاز باللغة العربية مطلوب' });
  if (!d.nameEn) return res.status(400).json({ error: 'اسم الجهاز بالإنكليزية مطلوب' });
  if (!Number.isFinite(d.basePrice) || d.basePrice <= 0) return res.status(400).json({ error: 'السعر الأساسي مطلوب' });
  if (d.isGoldenWarranty && d.goldenWarrantyPeriods.length === 0) {
    return res.status(400).json({ error: 'يجب اختيار فترة كفالة ذهبية واحدة على الأقل' });
  }

  const { rows } = await pool.query(
    `INSERT INTO device_models (
      name, brand, name_ar, name_en, category, maintenance_interval, base_price,
      supported_visit_types, is_golden_warranty,
      golden_warranty_periods, warranty_periods, is_featured, description, description_en, images, primary_image_id,
      videos, documents, code
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
    RETURNING ${selectFields}`,
    [
      d.name, d.brand, d.nameAr, d.nameEn, d.category, d.maintenanceInterval, d.basePrice,
      JSON.stringify(d.supportedVisitTypes),
      d.isGoldenWarranty, JSON.stringify(d.goldenWarrantyPeriods), JSON.stringify(d.warrantyPeriods), d.isFeatured,
      d.description, d.descriptionEn, JSON.stringify(d.images), d.primaryImageId,
      JSON.stringify(d.videos), JSON.stringify(d.documents), d.code,
    ]
  );
  res.json(serializeDevice(rows[0]));
});

/**
 * @swagger
 * /api/device-models/{id}:
 *   put:
 *     tags: [Device Models]
 *     summary: Update device model details by ID
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: false
 *         description: Branch context
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Device Model ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [nameAr, nameEn, basePrice]
 *             properties:
 *               nameAr:
 *                 type: string
 *               nameEn:
 *                 type: string
 *               basePrice:
 *                 type: number
 *     responses:
 *       200:
 *         description: Success
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DeviceModel'
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Not found
 *       500:
 *         description: Server error
 */
router.put('/:id', requirePermission('catalog.manage'), async (req, res) => {
  const d = normalizeDevicePayload(req.body);
  if (!d.nameAr) return res.status(400).json({ error: 'اسم الجهاز باللغة العربية مطلوب' });
  if (!d.nameEn) return res.status(400).json({ error: 'اسم الجهاز بالإنكليزية مطلوب' });
  if (!Number.isFinite(d.basePrice) || d.basePrice <= 0) return res.status(400).json({ error: 'السعر الأساسي مطلوب' });
  if (d.isGoldenWarranty && d.goldenWarrantyPeriods.length === 0) {
    return res.status(400).json({ error: 'يجب اختيار فترة كفالة ذهبية واحدة على الأقل' });
  }

  const { rows } = await pool.query(
    `UPDATE device_models SET
      name=$1, brand=$2, name_ar=$3, name_en=$4, category=$5, maintenance_interval=$6,
      base_price=$7, supported_visit_types=$8,
      is_golden_warranty=$9, golden_warranty_periods=$10, warranty_periods=$11, is_featured=$12,
      description=$13, description_en=$14, images=$15, primary_image_id=$16, videos=$17, documents=$18,
      code=$19
     WHERE id=$20 AND deleted_at IS NULL RETURNING ${selectFields}`,
    [
      d.name, d.brand, d.nameAr, d.nameEn, d.category, d.maintenanceInterval, d.basePrice,
      JSON.stringify(d.supportedVisitTypes),
      d.isGoldenWarranty, JSON.stringify(d.goldenWarrantyPeriods), JSON.stringify(d.warrantyPeriods), d.isFeatured,
      d.description, d.descriptionEn, JSON.stringify(d.images), d.primaryImageId,
      JSON.stringify(d.videos), JSON.stringify(d.documents), d.code, req.params.id,
    ]
  );
  res.json(serializeDevice(rows[0]));
});

/**
 * @swagger
 * /api/device-models/{id}:
 *   delete:
 *     tags: [Device Models]
 *     summary: Delete device model by ID
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: false
 *         description: Branch context
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Device Model ID
 *     responses:
 *       200:
 *         description: Success
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Not found
 *       500:
 *         description: Server error
 */
router.delete('/:id', requirePermission('catalog.manage'), async (req, res) => {
  await pool.query('UPDATE device_models SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL', [req.params.id]);
  res.json({ success: true });
});

// GET /:id/discounts — active discounts for this device today
/**
 * @swagger
 * /api/device-models/{id}/discounts:
 *   get:
 *     tags: [Device Models]
 *     summary: Retrieve active discounts for today for a device model
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: false
 *         description: Branch context
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Device Model ID
 *     responses:
 *       200:
 *         description: Success
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: integer
 *                   label:
 *                     type: string
 *                   percentage:
 *                     type: number
 *                   startDate:
 *                     type: string
 *                   endDate:
 *                     type: string
 *       410:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get('/:id/discounts', requireAuth, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, label, percentage, start_date AS "startDate", end_date AS "endDate"
     FROM device_discounts
     WHERE device_model_id = $1
       AND is_active = TRUE
       AND start_date <= CURRENT_DATE
       AND end_date >= CURRENT_DATE
     ORDER BY end_date ASC`,
    [req.params.id]
  );
  res.json(rows);
});

// GET /:id/discounts/all — all discounts (admin management view)
/**
 * @swagger
 * /api/device-models/{id}/discounts/all:
 *   get:
 *     tags: [Device Models]
 *     summary: Retrieve all discounts for a device model (admin view)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: false
 *         description: Branch context
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Device Model ID
 *     responses:
 *       200:
 *         description: Success
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: integer
 *                   label:
 *                     type: string
 *                   percentage:
 *                     type: number
 *                   startDate:
 *                     type: string
 *                   endDate:
 *                     type: string
 *                   isActive:
 *                     type: boolean
 *                   createdAt:
 *                     type: string
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get('/:id/discounts/all', requireAuth, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, label, percentage, start_date AS "startDate", end_date AS "endDate", is_active AS "isActive", created_at AS "createdAt"
     FROM device_discounts
     WHERE device_model_id = $1
     ORDER BY start_date DESC`,
    [req.params.id]
  );
  res.json(rows);
});

// POST /:id/discounts — create discount
/**
 * @swagger
 * /api/device-models/{id}/discounts:
 *   post:
 *     tags: [Device Models]
 *     summary: Create a new discount campaign for a device model
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: false
 *         description: Branch context
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Device Model ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [label, percentage, startDate, endDate]
 *             properties:
 *               label:
 *                 type: string
 *               percentage:
 *                 type: number
 *               startDate:
 *                 type: string
 *               endDate:
 *                 type: string
 *     responses:
 *       200:
 *         description: Success
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: integer
 *                 label:
 *                   type: string
 *                 percentage:
 *                   type: number
 *                 startDate:
 *                   type: string
 *                 endDate:
 *                   type: string
 *                 isActive:
 *                   type: boolean
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.post('/:id/discounts', requirePermission('devices.discounts.manage'), async (req, res) => {
  const { label, percentage, startDate, endDate } = req.body;
  if (!label || !percentage || !startDate || !endDate) {
    return res.status(400).json({ error: 'جميع الحقول مطلوبة' });
  }
  if (startDate > endDate) {
    return res.status(400).json({ error: 'تاريخ البداية يجب أن يكون قبل أو يساوي تاريخ النهاية' });
  }
  const dupCheck = await pool.query(
    'SELECT 1 FROM device_discounts WHERE device_model_id = $1 AND label = $2 LIMIT 1',
    [req.params.id, label.trim()]
  );
  if (dupCheck.rows.length > 0) {
    return res.status(400).json({ error: 'في حملة بنفس الاسم لهاد الجهاز' });
  }
  const overlapCheck = await pool.query(
    `SELECT 1 FROM device_discounts
     WHERE device_model_id = $1 AND start_date <= $3::date AND end_date >= $2::date
     LIMIT 1`,
    [req.params.id, startDate, endDate]
  );
  if (overlapCheck.rows.length > 0) {
    return res.status(400).json({ error: 'يوجد خصم آخر يتداخل مع هذه الفترة الزمنية لنفس الجهاز' });
  }
  const pct = Math.max(0, Math.min(100, Number(percentage) || 0));
  const { rows } = await pool.query(
    `INSERT INTO device_discounts (device_model_id, label, percentage, start_date, end_date, created_by)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING id, label, percentage, start_date AS "startDate", end_date AS "endDate", is_active AS "isActive"`,
    [req.params.id, label.trim(), pct, startDate, endDate, req.user?.id ?? null]
  );
  res.json(rows[0]);
});

// PUT /:id/discounts/:discountId — update discount
/**
 * @swagger
 * /api/device-models/{id}/discounts/{discountId}:
 *   put:
 *     tags: [Device Models]
 *     summary: Update discount campaign details
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: false
 *         description: Branch context
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Device Model ID
 *       - in: path
 *         name: discountId
 *         required: true
 *         schema:
 *           type: integer
 *         description: Discount ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               label:
 *                 type: string
 *               percentage:
 *                 type: number
 *               startDate:
 *                 type: string
 *               endDate:
 *                 type: string
 *               isActive:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Success
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: integer
 *                 label:
 *                   type: string
 *                 percentage:
 *                   type: number
 *                 startDate:
 *                   type: string
 *                 endDate:
 *                   type: string
 *                 isActive:
 *                   type: boolean
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Not found
 *       500:
 *         description: Server error
 */
router.put('/:id/discounts/:discountId', requirePermission('devices.discounts.manage'), async (req, res) => {
  const { label, percentage, startDate, endDate, isActive } = req.body;
  if (startDate && endDate && startDate > endDate) {
    return res.status(400).json({ error: 'تاريخ البداية يجب أن يكون قبل أو يساوي تاريخ النهاية' });
  }
  if (label) {
    const dupCheck = await pool.query(
      'SELECT 1 FROM device_discounts WHERE device_model_id = $1 AND label = $2 AND id != $3 LIMIT 1',
      [req.params.id, label.trim(), req.params.discountId]
    );
    if (dupCheck.rows.length > 0) {
      return res.status(400).json({ error: 'في حملة بنفس الاسم لهاد الجهاز' });
    }
  }
  if (startDate && endDate) {
    const overlapCheck = await pool.query(
      `SELECT 1 FROM device_discounts
       WHERE device_model_id = $1 AND start_date <= $3::date AND end_date >= $2::date AND id != $4
       LIMIT 1`,
      [req.params.id, startDate, endDate, req.params.discountId]
    );
    if (overlapCheck.rows.length > 0) {
      return res.status(400).json({ error: 'يوجد خصم آخر يتداخل مع هذه الفترة الزمنية لنفس الجهاز' });
    }
  }
  const pct = percentage != null ? Math.max(0, Math.min(100, Number(percentage) || 0)) : undefined;
  const { rows } = await pool.query(
    `UPDATE device_discounts
     SET label = COALESCE($1, label),
         percentage = COALESCE($2, percentage),
         start_date = COALESCE($3, start_date),
         end_date = COALESCE($4, end_date),
         is_active = COALESCE($5, is_active)
     WHERE id = $6 AND device_model_id = $7
     RETURNING id, label, percentage, start_date AS "startDate", end_date AS "endDate", is_active AS "isActive"`,
    [label?.trim(), pct, startDate, endDate, isActive, req.params.discountId, req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'الحسم غير موجود' });
  res.json(rows[0]);
});

// DELETE /:id/discounts/:discountId
/**
 * @swagger
 * /api/device-models/{id}/discounts/{discountId}:
 *   delete:
 *     tags: [Device Models]
 *     summary: Delete discount campaign by ID
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: false
 *         description: Branch context
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Device Model ID
 *       - in: path
 *         name: discountId
 *         required: true
 *         schema:
 *           type: integer
 *         description: Discount ID
 *     responses:
 *       200:
 *         description: Success
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.delete('/:id/discounts/:discountId', requirePermission('devices.discounts.manage'), async (req, res) => {
  await pool.query(
    'DELETE FROM device_discounts WHERE id = $1 AND device_model_id = $2',
    [req.params.discountId, req.params.id]
  );
  res.json({ success: true });
});

export default router;
