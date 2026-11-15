// ============================================================
// exchangeRates.ts — central exchange rate + FX differences ledger (migr 493)
// ============================================================
//   GET  /api/exchange-rates            exchange_rates.view   current + history
//   POST /api/exchange-rates            exchange_rates.manage add a new rate (append-only)
//   GET  /api/fx-differences            fx_differences.view   per-branch ledger (scoped)
//
// One rate for all branches (SYP per 1 USD). A new rate takes effect from its
// effective date; it cannot be backdated (history stays honest) and rows are
// never edited — a correction is a new row.
// ============================================================

import { Router } from 'express';
import pool from '../db.js';
import { requirePermission } from '../middleware/permission.js';
import { resolveListAccessScope } from '../services/authorizationService.js';
import { getRateOn, getRoundingUnit, todayDamascus } from '../services/fxRates.js';

export const exchangeRatesRouter = Router();
export const fxDifferencesRouter = Router();

exchangeRatesRouter.get('/', requirePermission('exchange_rates.view'), async (_req, res) => {
  try {
    const [current, today, roundingUnit, { rows }] = await Promise.all([
      getRateOn(pool, null),
      todayDamascus(pool),
      getRoundingUnit(),
      pool.query(
        `SELECT r.id, r.rate::float AS rate, to_char(r.effective_from, 'YYYY-MM-DD') AS "effectiveFrom",
                r.note, r.created_at AS "createdAt", u.name AS "createdByName"
           FROM exchange_rates r
           LEFT JOIN hr_users u ON u.id = r.created_by
          ORDER BY r.effective_from DESC, r.id DESC
          LIMIT 500`,
      ),
    ]);
    return res.json({ current, today, roundingUnit, history: rows });
  } catch (err: any) {
    console.error('[exchange-rates] list failed:', err);
    return res.status(500).json({ error: 'فشل تحميل أسعار الصرف' });
  }
});

// GET /api/exchange-rates/current — any signed-in user. The rate is needed by
// whoever enters a schedule or collects an installment (the form shows USD
// live); it carries no customer data, so no extra key is required.
exchangeRatesRouter.get('/current', async (_req, res) => {
  try {
    const [current, roundingUnit] = await Promise.all([getRateOn(pool, null), getRoundingUnit()]);
    return res.json({ current, roundingUnit });
  } catch (err: any) {
    console.error('[exchange-rates] current failed:', err);
    return res.status(500).json({ error: 'فشل تحميل سعر الصرف' });
  }
});

exchangeRatesRouter.post('/',requirePermission('exchange_rates.manage'), async (req, res) => {
  const rate = Number(req.body?.rate);
  const effectiveFrom = typeof req.body?.effectiveFrom === 'string' ? req.body.effectiveFrom.trim() : '';
  const note = typeof req.body?.note === 'string' && req.body.note.trim() ? req.body.note.trim() : null;
  if (!Number.isFinite(rate) || rate <= 0 || rate > 1e9) {
    return res.status(400).json({ error: 'سعر الصرف يجب أن يكون رقماً موجباً (ليرة لكل دولار).' });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) {
    return res.status(400).json({ error: 'تاريخ السريان مطلوب بصيغة YYYY-MM-DD.' });
  }
  try {
    const today = await todayDamascus(pool);
    if (effectiveFrom < today) {
      return res.status(400).json({ error: 'لا يمكن إدخال سعر بتاريخ سريان سابق لليوم.' });
    }
    const { rows } = await pool.query(
      `INSERT INTO exchange_rates (rate, effective_from, note, created_by)
       VALUES ($1, $2::date, $3, $4)
       RETURNING id, rate::float AS rate, to_char(effective_from, 'YYYY-MM-DD') AS "effectiveFrom", note, created_at AS "createdAt"`,
      [Math.round(rate * 10000) / 10000, effectiveFrom, note, req.authContext?.userId ?? null],
    );
    return res.status(201).json(rows[0]);
  } catch (err: any) {
    console.error('[exchange-rates] create failed:', err);
    return res.status(500).json({ error: 'فشل حفظ سعر الصرف' });
  }
});

// GET /api/fx-differences?branchId=&from=YYYY-MM-DD&to=YYYY-MM-DD
fxDifferencesRouter.get('/', requirePermission('fx_differences.view'), async (req, res) => {
  try {
    const authContext = req.authContext!;
    const plan = resolveListAccessScope(authContext, 'fx_differences.view');
    if (plan.scope === 'NONE') return res.status(403).json({ error: 'غير مسموح' });

    const params: any[] = [];
    const where: string[] = [];
    if (plan.scope !== 'GLOBAL') {
      params.push(plan.allowedBranchIds ?? []);
      where.push(`f.branch_id = ANY($${params.length}::int[])`);
    }
    const branchId = Number(req.query.branchId);
    if (Number.isInteger(branchId) && branchId > 0) {
      params.push(branchId);
      where.push(`f.branch_id = $${params.length}`);
    }
    const from = typeof req.query.from === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.from) ? req.query.from : null;
    const to = typeof req.query.to === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.to) ? req.query.to : null;
    if (from) {
      params.push(from);
      where.push(`(f.occurred_at AT TIME ZONE 'Asia/Damascus')::date >= $${params.length}::date`);
    }
    if (to) {
      params.push(to);
      where.push(`(f.occurred_at AT TIME ZONE 'Asia/Damascus')::date <= $${params.length}::date`);
    }
    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

    const [{ rows }, { rows: totals }] = await Promise.all([
      pool.query(
        `SELECT f.id, f.branch_id AS "branchId", b.name AS "branchName",
                f.source_kind AS "sourceKind",
                f.contract_id AS "contractId", c.contract_number AS "contractNumber",
                c.customer_name AS "customerName",
                f.installment_id AS "installmentId",
                COALESCE(i.installment_number, mi.installment_number) AS "installmentNumber",
                f.maintenance_installment_id AS "maintenanceInstallmentId", f.open_task_id AS "openTaskId",
                f.payment_entry_id AS "paymentEntryId",
                f.contract_rate::float AS "contractRate", f.day_rate::float AS "dayRate",
                f.usd_settled::float AS "usdSettled",
                f.collected_syp::float AS "collectedSyp", f.settled_syp::float AS "settledSyp",
                f.difference_syp::float AS "differenceSyp",
                f.occurred_at AS "occurredAt", u.name AS "recordedByName"
           FROM branch_fx_differences f
           LEFT JOIN branches b ON b.id = f.branch_id
           LEFT JOIN contracts c ON c.id = f.contract_id
           LEFT JOIN contract_installments i ON i.id = f.installment_id
           LEFT JOIN emergency_installments mi ON mi.id = f.maintenance_installment_id
           LEFT JOIN hr_users u ON u.id = f.recorded_by
           ${whereSql}
          ORDER BY f.occurred_at DESC, f.id DESC
          LIMIT 1000`,
        params,
      ),
      pool.query(
        `SELECT f.branch_id AS "branchId", b.name AS "branchName",
                COUNT(*)::int AS "count",
                COALESCE(SUM(f.collected_syp), 0)::float AS "collectedSyp",
                COALESCE(SUM(f.settled_syp), 0)::float AS "settledSyp",
                COALESCE(SUM(f.difference_syp), 0)::float AS "balanceSyp"
           FROM branch_fx_differences f
           LEFT JOIN branches b ON b.id = f.branch_id
           ${whereSql}
          GROUP BY f.branch_id, b.name
          ORDER BY b.name`,
        params,
      ),
    ]);
    const balanceSyp = totals.reduce((s: number, t: any) => s + Number(t.balanceSyp), 0);
    return res.json({ rows, branches: totals, balanceSyp, truncated: rows.length >= 1000 });
  } catch (err: any) {
    console.error('[fx-differences] list failed:', err);
    return res.status(500).json({ error: 'فشل تحميل حساب فروقات سعر الصرف' });
  }
});
