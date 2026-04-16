import { Router } from 'express';
import pool from '../db.js';
import { parsePagination, hasPaginationParams, paginatedResponse } from '../utils/paginate.js';

const router = Router();

async function syncJobTitleRole(listId: number, displayName: string, isActive = true) {
  const roleName = `job_title_${listId}`;

  const { rows: existingRoles } = await pool.query(
    `SELECT id FROM roles WHERE name = $1`,
    [roleName]
  );

  if (existingRoles.length > 0) {
    await pool.query(
      `UPDATE roles
       SET display_name = $1,
           description = $2,
           is_active = $3,
           updated_at = NOW()
       WHERE name = $4`,
      [
        displayName,
        'دور إداري مرتبط بعنوان وظيفي من القوائم النظامية',
        isActive,
        roleName,
      ]
    );
    return;
  }

  await pool.query(
    `INSERT INTO roles (name, display_name, description, is_active, is_system)
     VALUES ($1, $2, $3, $4, FALSE)
     ON CONFLICT (name) DO NOTHING`,
    [
      roleName,
      displayName,
      'دور إداري مرتبط بعنوان وظيفي من القوائم النظامية',
      isActive,
    ]
  );
}

// GET /api/system-lists
// Get all lists, optionally filtered by category. Supports ?page=&limit= pagination.
router.get('/', async (req, res) => {
  try {
    const { category, activeOnly } = req.query;
    const params: any[] = [];
    const conditions: string[] = [];

    if (category) {
      params.push(category);
      conditions.push(`category = $${params.length}`);
    }
    if (activeOnly === 'true') {
      conditions.push(`is_active = TRUE`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const baseQuery = `
      SELECT id, category, value, is_active AS "isActive", display_order AS "displayOrder"
      FROM system_lists ${where}
    `;
    const order = ` ORDER BY category ASC, display_order ASC, id ASC`;

    if (hasPaginationParams(req.query)) {
      const { page, limit, offset } = parsePagination(req.query);
      const [{ rows }, { rows: countRows }] = await Promise.all([
        pool.query(`${baseQuery} ${order} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, limit, offset]),
        pool.query(`SELECT COUNT(*) FROM system_lists ${where}`, params),
      ]);
      res.json(paginatedResponse(rows, parseInt(countRows[0].count), page, limit));
    } else {
      const { rows } = await pool.query(`${baseQuery} ${order}`, params);
      res.json(rows);
    }
  } catch (err: any) {
    console.error('Error fetching system lists:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/system-lists
// Create a new list item
router.post('/', async (req, res) => {
  try {
    const { category, value, isActive, displayOrder } = req.body;
    
    if (!category || !value) {
      return res.status(400).json({ error: 'Category and matching value are required' });
    }
    
    const { rows } = await pool.query(
      `INSERT INTO system_lists (category, value, is_active, display_order)
       VALUES ($1, $2, $3, $4)
       RETURNING id, category, value, is_active AS "isActive", display_order AS "displayOrder"`,
      [category, value, isActive !== undefined ? isActive : true, displayOrder || 0]
    );

    if (category === 'job_title') {
      await syncJobTitleRole(rows[0].id, rows[0].value, rows[0].isActive);
    }

    res.status(201).json(rows[0]);
  } catch (err: any) {
    console.error('Error creating system list item:', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/system-lists/:id
// Update an existing list item
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { category, value, isActive, displayOrder } = req.body;
    const { rows: currentRows } = await pool.query(
      `SELECT id, category, value, is_active AS "isActive", display_order AS "displayOrder"
       FROM system_lists
       WHERE id = $1`,
      [id]
    );

    if (currentRows.length === 0) {
      return res.status(404).json({ error: 'System list item not found' });
    }
    
    const { rows } = await pool.query(
      `UPDATE system_lists SET 
        category = COALESCE($1, category),
        value = COALESCE($2, value),
        is_active = COALESCE($3, is_active),
        display_order = COALESCE($4, display_order),
        updated_at = NOW()
       WHERE id = $5
       RETURNING id, category, value, is_active AS "isActive", display_order AS "displayOrder"`,
      [category, value, isActive, displayOrder, id]
    );
    
    const updated = rows[0];

    if ((updated.category || currentRows[0].category) === 'job_title') {
      await syncJobTitleRole(
        updated.id,
        updated.value,
        updated.isActive
      );
    }
    
    res.json(updated);
  } catch (err: any) {
    console.error('Error updating system list item:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/system-lists/:id
// Delete a list item (Hard delete)
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { rowCount } = await pool.query('DELETE FROM system_lists WHERE id = $1', [id]);
    
    if (rowCount === 0) {
      return res.status(404).json({ error: 'System list item not found' });
    }
    
    res.json({ success: true, message: 'Item deleted successfully' });
  } catch (err: any) {
    console.error('Error deleting system list item:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
