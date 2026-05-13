import { Router } from 'express';
import pool from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

const selectFields = `
  id, name, brand, name_ar AS "nameAr", name_en AS "nameEn", category,
  maintenance_interval AS "maintenanceInterval", base_price AS "basePrice",
  discount_percent AS "discountPercent", discounted_price AS "discountedPrice",
  supported_visit_types AS "supportedVisitTypes",
  is_golden_warranty AS "isGoldenWarranty",
  golden_warranty_periods AS "goldenWarrantyPeriods",
  is_offer_included AS "isOfferIncluded",
  description, images, primary_image_id AS "primaryImageId", videos, documents
`;

function serializeDevice(row: any) {
  return {
    ...row,
    basePrice: Number(row.basePrice ?? 0),
    discountPercent: Number(row.discountPercent ?? 0),
    discountedPrice: Number(row.discountedPrice ?? row.basePrice ?? 0),
    supportedVisitTypes: Array.isArray(row.supportedVisitTypes) ? row.supportedVisitTypes : [],
    goldenWarrantyPeriods: Array.isArray(row.goldenWarrantyPeriods) ? row.goldenWarrantyPeriods : [],
    images: Array.isArray(row.images) ? row.images : [],
    videos: Array.isArray(row.videos) ? row.videos : [],
    documents: Array.isArray(row.documents) ? row.documents : [],
  };
}

function normalizeDevicePayload(body: any) {
  const nameAr = String(body.nameAr ?? body.name ?? '').trim();
  const nameEn = String(body.nameEn ?? body.brand ?? '').trim();
  const basePrice = Number(body.basePrice);
  const discountPercent = Math.max(0, Math.min(100, Number(body.discountPercent) || 0));
  const discountedPrice = Math.round(basePrice * (1 - discountPercent / 100));

  return {
    nameAr,
    nameEn,
    name: nameAr,
    brand: nameEn,
    category: body.category || 'صناعي',
    maintenanceInterval: body.maintenanceInterval || '6 أشهر',
    basePrice,
    discountPercent,
    discountedPrice,
    supportedVisitTypes: Array.isArray(body.supportedVisitTypes) ? body.supportedVisitTypes : [],
    isGoldenWarranty: body.isGoldenWarranty === true,
    goldenWarrantyPeriods: body.isGoldenWarranty === true && Array.isArray(body.goldenWarrantyPeriods)
      ? body.goldenWarrantyPeriods
      : [],
    isOfferIncluded: body.isOfferIncluded === true,
    description: String(body.description ?? '').trim() || null,
    images: Array.isArray(body.images) ? body.images : [],
    primaryImageId: body.primaryImageId || null,
    videos: Array.isArray(body.videos) ? body.videos : [],
    documents: Array.isArray(body.documents) ? body.documents : [],
  };
}

router.get('/', async (_req, res) => {
  const { rows } = await pool.query(`SELECT ${selectFields} FROM device_models ORDER BY id`);
  res.json(rows.map(serializeDevice));
});

router.get('/for-sale', requireAuth, async (req, res) => {
  try {
    if (req.user?.isSuperAdmin === true) {
      const { rows } = await pool.query(
        `SELECT id, name, category
         FROM device_models
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
       WHERE id = ANY($1::int[])
       ORDER BY name ASC, id ASC`,
      [deviceModelIds],
    );
    return res.json(rows);
  } catch (err: any) {
    console.error('[device-models] GET /for-sale error:', err);
    return res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  const d = normalizeDevicePayload(req.body);
  if (!d.nameAr) return res.status(400).json({ error: 'اسم الجهاز باللغة العربية مطلوب' });
  if (!Number.isFinite(d.basePrice) || d.basePrice <= 0) return res.status(400).json({ error: 'السعر الأساسي مطلوب' });
  if (d.isGoldenWarranty && d.goldenWarrantyPeriods.length === 0) {
    return res.status(400).json({ error: 'يجب اختيار فترة كفالة ذهبية واحدة على الأقل' });
  }

  const { rows } = await pool.query(
    `INSERT INTO device_models (
      name, brand, name_ar, name_en, category, maintenance_interval, base_price,
      discount_percent, discounted_price, supported_visit_types, is_golden_warranty,
      golden_warranty_periods, is_offer_included, description, images, primary_image_id,
      videos, documents
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
    RETURNING ${selectFields}`,
    [
      d.name, d.brand, d.nameAr, d.nameEn, d.category, d.maintenanceInterval, d.basePrice,
      d.discountPercent, d.discountedPrice, JSON.stringify(d.supportedVisitTypes),
      d.isGoldenWarranty, JSON.stringify(d.goldenWarrantyPeriods), d.isOfferIncluded,
      d.description, JSON.stringify(d.images), d.primaryImageId, JSON.stringify(d.videos),
      JSON.stringify(d.documents),
    ]
  );
  res.json(serializeDevice(rows[0]));
});

router.put('/:id', async (req, res) => {
  const d = normalizeDevicePayload(req.body);
  if (!d.nameAr) return res.status(400).json({ error: 'اسم الجهاز باللغة العربية مطلوب' });
  if (!Number.isFinite(d.basePrice) || d.basePrice <= 0) return res.status(400).json({ error: 'السعر الأساسي مطلوب' });
  if (d.isGoldenWarranty && d.goldenWarrantyPeriods.length === 0) {
    return res.status(400).json({ error: 'يجب اختيار فترة كفالة ذهبية واحدة على الأقل' });
  }

  const { rows } = await pool.query(
    `UPDATE device_models SET
      name=$1, brand=$2, name_ar=$3, name_en=$4, category=$5, maintenance_interval=$6,
      base_price=$7, discount_percent=$8, discounted_price=$9, supported_visit_types=$10,
      is_golden_warranty=$11, golden_warranty_periods=$12, is_offer_included=$13,
      description=$14, images=$15, primary_image_id=$16, videos=$17, documents=$18
     WHERE id=$19 RETURNING ${selectFields}`,
    [
      d.name, d.brand, d.nameAr, d.nameEn, d.category, d.maintenanceInterval, d.basePrice,
      d.discountPercent, d.discountedPrice, JSON.stringify(d.supportedVisitTypes),
      d.isGoldenWarranty, JSON.stringify(d.goldenWarrantyPeriods), d.isOfferIncluded,
      d.description, JSON.stringify(d.images), d.primaryImageId, JSON.stringify(d.videos),
      JSON.stringify(d.documents), req.params.id,
    ]
  );
  res.json(serializeDevice(rows[0]));
});

router.delete('/:id', async (req, res) => {
  await pool.query('DELETE FROM device_models WHERE id = $1', [req.params.id]);
  res.json({ success: true });
});

export default router;
