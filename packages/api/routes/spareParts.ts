import { Router } from 'express';
import pool from '../db.js';
import { requirePermission } from '../middleware/permission.js';

const router = Router();
const CATALOG_NOW_SQL = `(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Damascus')`;

function serializePrice(row: any) {
  return {
    ...row,
    price: Number(row.price ?? 0),
    isCurrent: row.isCurrent === true,
  };
}

async function insertSparePartPriceHistory(sparePartId: number, body: any, createdBy: number | null) {
  const price = Number(body.price);
  const note = String(body.note ?? '').trim() || null;

  if (!Number.isFinite(price) || price <= 0) {
    const err: any = new Error('Price must be greater than zero');
    err.status = 400;
    throw err;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: partRows } = await client.query(
      'SELECT id FROM spare_parts WHERE id = $1 AND deleted_at IS NULL FOR UPDATE',
      [sparePartId],
    );
    if (!partRows.length) {
      const err: any = new Error('Spare part not found');
      err.status = 404;
      throw err;
    }

    const { rows: nowRows } = await client.query(`SELECT ${CATALOG_NOW_SQL} AS value`);
    const effectiveFrom = nowRows[0].value;
    const { rows: previousRows } = await client.query(
      `SELECT id
       FROM spare_part_price_history
       WHERE spare_part_id = $1
         AND effective_from <= $2::timestamp
         AND (effective_to IS NULL OR effective_to > $2::timestamp)
       ORDER BY effective_from DESC, id DESC
       FOR UPDATE`,
      [sparePartId, effectiveFrom],
    );

    if (previousRows.length > 0) {
      await client.query(
        `UPDATE spare_part_price_history
         SET effective_to = $2::timestamp
         WHERE id = ANY($1::bigint[])`,
        [previousRows.map((row: any) => row.id), effectiveFrom],
      );
    }

    const { rows } = await client.query(
      `INSERT INTO spare_part_price_history
        (spare_part_id, price, currency, effective_from, effective_to, note, created_by)
       VALUES ($1, $2, 'SYP', $3::timestamp, NULL, $4, $5)
       RETURNING id, spare_part_id AS "sparePartId", price, currency,
         effective_from AS "effectiveFrom", effective_to AS "effectiveTo",
         note, created_by AS "createdBy", created_at AS "createdAt"`,
      [sparePartId, price, effectiveFrom, note, createdBy],
    );

    const { rows: currentRows } = await client.query(
      `SELECT price
       FROM spare_part_price_history
       WHERE spare_part_id = $1
         AND effective_from <= ${CATALOG_NOW_SQL}
         AND (effective_to IS NULL OR effective_to > ${CATALOG_NOW_SQL})
       ORDER BY effective_from DESC, id DESC
       LIMIT 1`,
      [sparePartId],
    );
    if (currentRows[0]) {
      await client.query(
        'UPDATE spare_parts SET base_price = $1 WHERE id = $2',
        [currentRows[0].price, sparePartId],
      );
    }

    await client.query('COMMIT');
    return serializePrice(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * @swagger
 * components:
 *   schemas:
 *     SparePart:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *         name:
 *           type: string
 *         code:
 *           type: string
 *         basePrice:
 *           type: number
 *         maintenanceType:
 *           type: string
 *         compatibleDeviceIds:
 *           type: array
 *           items:
 *             type: integer
 */

/**
 * @swagger
 * /api/spare-parts:
 *   get:
 *     tags: [Spare Parts]
 *     summary: Retrieve list of spare parts
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
 *                 $ref: '#/components/schemas/SparePart'
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get(
  '/',
  requirePermission('spare_parts.lookup', 'spare_parts.task_lookup', 'reference_data.lookup', 'catalog.manage'),
  async (_req, res) => {
  const { rows } = await pool.query(`
    SELECT id, name, code,
      COALESCE((
        SELECT ph.price
        FROM spare_part_price_history ph
        WHERE ph.spare_part_id = spare_parts.id
          AND ph.effective_from <= ${CATALOG_NOW_SQL}
          AND (ph.effective_to IS NULL OR ph.effective_to > ${CATALOG_NOW_SQL})
        ORDER BY ph.effective_from DESC, ph.id DESC
        LIMIT 1
      ), base_price) AS "basePrice",
      maintenance_type AS "maintenanceType",
      compatible_device_ids AS "compatibleDeviceIds"
    FROM spare_parts WHERE deleted_at IS NULL ORDER BY id
  `);
  res.json(rows.map(r => ({ ...r, basePrice: Number(r.basePrice) })));
});

/**
 * @swagger
 * /api/spare-parts:
 *   post:
 *     tags: [Spare Parts]
 *     summary: Create new spare part
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
 *             required: [name, basePrice]
 *             properties:
 *               name:
 *                 type: string
 *               code:
 *                 type: string
 *               basePrice:
 *                 type: number
 *               maintenanceType:
 *                 type: string
 *               compatibleDeviceIds:
 *                 type: array
 *                 items:
 *                   type: integer
 *     responses:
 *       200:
 *         description: Success
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SparePart'
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.post('/', requirePermission('spare_parts.manage', 'catalog.manage'), async (req, res) => {
  const s = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO spare_parts (name, code, base_price, maintenance_type, compatible_device_ids)
      VALUES ($1,$2,$3,$4,$5) RETURNING id, name, code, base_price AS "basePrice",
        maintenance_type AS "maintenanceType", compatible_device_ids AS "compatibleDeviceIds"`,
      [s.name, s.code, s.basePrice, s.maintenanceType, JSON.stringify(s.compatibleDeviceIds || [])]
    );
    await client.query(
      `INSERT INTO spare_part_price_history
        (spare_part_id, price, currency, effective_from, note, created_by)
       VALUES ($1, $2, 'SYP', ${CATALOG_NOW_SQL}, $3, $4)`,
      [rows[0].id, Number(s.basePrice), 'Initial catalog price', req.user?.id ?? null],
    );
    await client.query('COMMIT');
    res.json({ ...rows[0], basePrice: Number(rows[0].basePrice) });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

/**
 * @swagger
 * /api/spare-parts/{id}:
 *   put:
 *     tags: [Spare Parts]
 *     summary: Update spare part details by ID
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
 *         description: Spare Part ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               code:
 *                 type: string
 *               basePrice:
 *                 type: number
 *     responses:
 *       200:
 *         description: Success
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SparePart'
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Not found
 *       500:
 *         description: Server error
 */
router.put('/:id', requirePermission('spare_parts.manage', 'catalog.manage'), async (req, res) => {
  const s = req.body;
  const { rows } = await pool.query(
    `UPDATE spare_parts SET name=$1, code=$2, maintenance_type=$3,
      compatible_device_ids=$4 WHERE id=$5 AND deleted_at IS NULL
    RETURNING id, name, code, base_price AS "basePrice",
      maintenance_type AS "maintenanceType", compatible_device_ids AS "compatibleDeviceIds"`,
    [s.name, s.code, s.maintenanceType, JSON.stringify(s.compatibleDeviceIds || []), req.params.id]
  );
  res.json({ ...rows[0], basePrice: Number(rows[0].basePrice) });
});

/**
 * @swagger
 * /api/spare-parts/{id}:
 *   delete:
 *     tags: [Spare Parts]
 *     summary: Delete spare part by ID
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
 *         description: Spare Part ID
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
router.delete('/:id', requirePermission('spare_parts.manage', 'catalog.manage'), async (req, res) => {
  await pool.query('UPDATE spare_parts SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL', [req.params.id]);
  res.json({ success: true });
});

router.get('/:id/prices', requirePermission('spare_parts.prices.manage', 'catalog.manage'), async (req, res) => {
  const { rows } = await pool.query(
    `SELECT ph.id,
       ph.spare_part_id AS "sparePartId",
       ph.price,
       ph.currency,
       ph.effective_from AS "effectiveFrom",
       ph.effective_to AS "effectiveTo",
       ph.note,
       ph.created_by AS "createdBy",
       u.name AS "createdByName",
       ph.created_at AS "createdAt",
       (ph.effective_from <= ${CATALOG_NOW_SQL} AND (ph.effective_to IS NULL OR ph.effective_to > ${CATALOG_NOW_SQL})) AS "isCurrent"
     FROM spare_part_price_history ph
     LEFT JOIN hr_users u ON u.id = ph.created_by
     WHERE ph.spare_part_id = $1
     ORDER BY ph.effective_from DESC, ph.id DESC`,
    [req.params.id],
  );
  res.json(rows.map(serializePrice));
});

router.post('/:id/prices', requirePermission('spare_parts.prices.manage'), async (req, res) => {
  try {
    const price = await insertSparePartPriceHistory(Number(req.params.id), req.body, req.user?.id ?? null);
    res.json(price);
  } catch (err: any) {
    if (err.code === '23505') {
      return res.status(400).json({ error: 'يوجد سعر مسجل بنفس تاريخ البداية لهذه القطعة' });
    }
    return res.status(err.status ?? 500).json({ error: err.message ?? 'فشل حفظ السعر' });
  }
});

export default router;
