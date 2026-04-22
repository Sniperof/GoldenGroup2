import { Router } from 'express';
import pool from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { requireSuperAdmin } from '../middleware/permission.js';

const router = Router();

// GET is open to any authenticated user (dropdowns need it in every UI).
// Writes are HQ-only: system_lists are global reference data.

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Build the full SELECT clause with linked role display name */
const SELECT_COLS = `
  sl.id,
  sl.category,
  sl.value,
  sl.is_active       AS "isActive",
  sl.display_order   AS "displayOrder",
  sl.linked_role_id  AS "linkedRoleId",
  r.display_name     AS "linkedRoleName",
  sl.metadata
FROM system_lists sl
LEFT JOIN roles r ON r.id = sl.linked_role_id
`;

// ─── Routes ──────────────────────────────────────────────────────────────────

// GET /api/system-lists
router.get('/', requireAuth, async (req, res) => {
  try {
    const { category, activeOnly } = req.query;

    let query = `SELECT ${SELECT_COLS}`;
    const params: any[] = [];
    const conditions: string[] = [];

    if (category) {
      params.push(category);
      conditions.push(`sl.category = $${params.length}`);
    }
    if (activeOnly === 'true') {
      conditions.push(`sl.is_active = TRUE`);
    }
    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }
    query += ` ORDER BY sl.category ASC, sl.display_order ASC, sl.id ASC`;

    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err: any) {
    console.error('Error fetching system lists:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/system-lists
router.post('/', requireSuperAdmin, async (req, res) => {
  try {
    const { category, value, isActive, displayOrder, linkedRoleId, metadata } = req.body;

    if (!category || !value) {
      return res.status(400).json({ error: 'Category and value are required' });
    }

    const roleId = linkedRoleId != null ? linkedRoleId : null;
    const metaJson = metadata != null ? JSON.stringify(metadata) : '{}';

    const { rows } = await pool.query(
      `INSERT INTO system_lists (category, value, is_active, display_order, linked_role_id, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [category, value, isActive !== undefined ? isActive : true, displayOrder || 0, roleId, metaJson]
    );

    // Fetch with joined role name
    const { rows: full } = await pool.query(
      `SELECT ${SELECT_COLS} WHERE sl.id = $1`,
      [rows[0].id]
    );

    res.status(201).json(full[0]);
  } catch (err: any) {
    console.error('Error creating system list item:', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/system-lists/:id
router.put('/:id', requireSuperAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { category, value, isActive, displayOrder, linkedRoleId, metadata } = req.body;

    const { rowCount } = await pool.query(
      `SELECT id FROM system_lists WHERE id = $1`,
      [id]
    );
    if (!rowCount) {
      return res.status(404).json({ error: 'System list item not found' });
    }

    // linkedRoleId === null means "clear the link"; undefined means "don't touch"
    const extraClauses: string[] = [];
    const baseParams: any[] = [category, value, isActive, displayOrder, id];
    let pIdx = 6;

    if (linkedRoleId !== undefined) {
      extraClauses.push(`, linked_role_id = $${pIdx++}`);
      baseParams.push(linkedRoleId ?? null);
    }
    if (metadata !== undefined) {
      extraClauses.push(`, metadata = $${pIdx++}`);
      baseParams.push(JSON.stringify(metadata));
    }

    await pool.query(
      `UPDATE system_lists SET
         category      = COALESCE($1, category),
         value         = COALESCE($2, value),
         is_active     = COALESCE($3, is_active),
         display_order = COALESCE($4, display_order),
         updated_at    = NOW()
         ${extraClauses.join('')}
       WHERE id = $5`,
      baseParams
    );

    // Fetch with joined role name
    const { rows: full } = await pool.query(
      `SELECT ${SELECT_COLS} WHERE sl.id = $1`,
      [id]
    );

    res.json(full[0]);
  } catch (err: any) {
    console.error('Error updating system list item:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/system-lists/:id
router.delete('/:id', requireSuperAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { rowCount } = await pool.query('DELETE FROM system_lists WHERE id = $1', [id]);

    if (rowCount === 0) {
      return res.status(404).json({ error: 'System list item not found' });
    }

    res.json({ success: true });
  } catch (err: any) {
    console.error('Error deleting system list item:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
