// ============================================================
// dashboardLayout.ts — تخطيط الداشبورد لكل مستخدم (reporting-analytics §6.3)
// ============================================================
//   GET /api/me/dashboard-layout  — تخطيط المستخدم الحالي (مصفوفة widgets).
//   PUT /api/me/dashboard-layout  — حفظ التخطيط (إضافة/حذف/ترتيب).
// كل مستخدم يملك صفًا واحدًا (user_id PK). مُركّب خلف requireAuth في index.ts.
// ============================================================

import { Router, type Request, type Response } from 'express';
import type { AuthUser } from '../middleware/auth.js';
import { getOrBuildAuthContext } from '../middleware/permission.js';
import pool from '../db.js';

const router = Router();

interface LayoutItem {
  key: string;
  size: 'sm' | 'md' | 'lg';
  scope: { branchId?: number } | null;
}

const SIZES = new Set(['sm', 'md', 'lg']);

function sanitizeLayout(input: unknown): LayoutItem[] {
  if (!Array.isArray(input)) return [];
  const out: LayoutItem[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue;
    const key = (raw as any).key;
    if (typeof key !== 'string' || key.length === 0 || key.length > 80) continue;
    const size = SIZES.has((raw as any).size) ? (raw as any).size : 'sm';
    let scope: LayoutItem['scope'] = null;
    const rawScope = (raw as any).scope;
    if (rawScope && typeof rawScope === 'object') {
      const b = Number(rawScope.branchId);
      if (Number.isInteger(b) && b > 0) scope = { branchId: b };
    }
    out.push({ key, size, scope });
    if (out.length >= 60) break; // حدّ أعلى دفاعي
  }
  return out;
}

router.get('/dashboard-layout', async (req, res) => {
  try {
    const authContext = await getOrBuildAuthContext(req as Request & { user: AuthUser });
    const { rows } = await pool.query(
      'SELECT layout FROM user_dashboard_layouts WHERE user_id = $1 LIMIT 1',
      [authContext.userId],
    );
    res.json({ layout: rows[0]?.layout ?? [] });
  } catch (err) {
    console.error('[dashboard-layout] load failed:', err);
    res.status(500).json({ error: 'فشل تحميل تخطيط الداشبورد' });
  }
});

router.put('/dashboard-layout', async (req: Request, res: Response) => {
  try {
    const authContext = await getOrBuildAuthContext(req as Request & { user: AuthUser });
    const layout = sanitizeLayout(req.body?.layout);
    await pool.query(
      `INSERT INTO user_dashboard_layouts (user_id, layout, updated_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (user_id) DO UPDATE SET layout = EXCLUDED.layout, updated_at = NOW()`,
      [authContext.userId, JSON.stringify(layout)],
    );
    res.json({ layout });
  } catch (err) {
    console.error('[dashboard-layout] save failed:', err);
    res.status(500).json({ error: 'فشل حفظ تخطيط الداشبورد' });
  }
});

export default router;
