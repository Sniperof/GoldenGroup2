// ============================================================
// metricsCatalog.ts — كتالوج المؤشرات القانونية (reporting-analytics §8.2)
// ============================================================
// كل مؤشر = تعريف واحد يحقّق "عقد تعريف الـ Widget":
//   key · permission (بوابة الرؤية §8.1) · titleAr · unit · compute (مصدر واحد §1.2)
// التقييد بالنطاق (GLOBAL/BRANCH/ASSIGNED) يُطبَّق في metricsService عبر
// MetricComputeContext (branchIds + scope + userId) — لا يخترع المؤشر نطاقًا.
//
// قاعدة عدم التكرار (§8.3): مؤشر قانوني واحد لكل (مفهوم × حبيبة)؛ أي نسخة أخرى
// = تغيير نطاق/فلتر للمؤشر نفسه، لا مؤشر جديد.
// ============================================================

import pool from '../../db.js';
import { appendCandidateScope, appendClientScope } from './reportingScope.js';

export type MetricUnit = 'count' | 'percent';
export type ScopeMode = 'GLOBAL' | 'BRANCH' | 'ASSIGNED';

export interface MetricComputeContext {
  scope: ScopeMode;
  /** فارغة => بلا تقييد فرع (GLOBAL على كل الفروع). غير فارغة => c.branch_id = ANY(...) */
  branchIds: number[];
  /** لإسناد ASSIGNED (السجلات المسندة للمستخدم). */
  userId: number;
  from: Date;
  to: Date;
  prevFrom: Date;
  prevTo: Date;
}

export interface MetricResult {
  value: number;
  /** قيمة الفترة السابقة لحساب الدلتا، أو null للمؤشرات اللحظية. */
  previous: number | null;
}

export interface MetricDefinition {
  key: string;
  permission: string;
  titleAr: string;
  unit: MetricUnit;
  /** غاية المؤشر (§8.4): قرار/سير عمل/إنجاز فريق — للتوثيق والتدقيق. */
  purpose: string;
  compute: (ctx: MetricComputeContext) => Promise<MetricResult>;
}

async function scalar(sql: string, params: unknown[]): Promise<number> {
  const { rows } = await pool.query(sql, params);
  const v = rows[0]?.v;
  return typeof v === 'number' ? v : Number(v ?? 0);
}

// ── المؤشرات (CRM — تعمّق P1) ──────────────────────────────────────────────────

const clientsNewCount: MetricDefinition = {
  key: 'clients.new_count',
  permission: 'clients.view_list',
  titleAr: 'زبائن جدد',
  unit: 'count',
  purpose: 'قرار/سير عمل: قياس اكتساب الزبائن خلال الفترة على مستوى النطاق المختار.',
  async compute(ctx) {
    const count = async (from: Date, to: Date) => {
      const params: unknown[] = [from, to];
      const sql =
        `SELECT COUNT(*)::int AS v FROM clients c
          WHERE c.deleted_at IS NULL
            AND c.created_at >= $1 AND c.created_at < $2` + appendClientScope(ctx, params);
      return scalar(sql, params);
    };
    return { value: await count(ctx.from, ctx.to), previous: await count(ctx.prevFrom, ctx.prevTo) };
  },
};

const clientsActiveTotal: MetricDefinition = {
  key: 'clients.active_total',
  permission: 'clients.view_list',
  titleAr: 'إجمالي الزبائن الفعّالين',
  unit: 'count',
  purpose: 'قرار: قياس الحجم الحالي لقاعدة الزبائن ضمن النطاق لتخطيط القدرة التشغيلية.',
  async compute(ctx) {
    // لقطة حالية تراكمية؛ لا تُقارن بفترة سابقة.
    const params: unknown[] = [];
    const sql =
      `SELECT COUNT(*)::int AS v FROM clients c
        WHERE c.deleted_at IS NULL
          AND c.is_active IS NOT FALSE` + appendClientScope(ctx, params);
    return { value: await scalar(sql, params), previous: null };
  },
};

const clientsUnownedCount: MetricDefinition = {
  key: 'clients.unowned_count',
  permission: 'clients.view_list',
  titleAr: 'زبائن بحاجة إلى إسناد',
  unit: 'count',
  purpose: 'سير عمل: كشف سجلات Lead التي لا تملك مسؤولًا فرديًا لإغلاق فجوة الإسناد.',
  async compute(ctx) {
    // OP/FOP ملكيتهما فرعية وفق BR-4، لذلك لا يُعدّان «بلا مالك».
    const params: unknown[] = [];
    const sql =
      `SELECT COUNT(*)::int AS v FROM clients c
        WHERE c.deleted_at IS NULL
          AND c.is_active IS NOT FALSE
          AND c.candidate_status IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM client_assignments ca WHERE ca.client_id = c.id
          )` + appendClientScope(ctx, params);
    return { value: await scalar(sql, params), previous: null };
  },
};

const candidateConversionRate: MetricDefinition = {
  key: 'candidates.conversion_rate',
  permission: 'candidates.view_list',
  titleAr: 'معدّل تحويل المرشّحين',
  unit: 'percent',
  purpose: 'قرار: فاعلية تحويل الأسماء المقترحة إلى زبائن (converted_to_lead_id).',
  async compute(ctx) {
    const rate = async (from: Date, to: Date): Promise<number> => {
      const params: unknown[] = [from, to];
      const sql =
        `SELECT
            COUNT(*) FILTER (WHERE c.converted_to_lead_id IS NOT NULL)::numeric AS conv,
            COUNT(*)::numeric AS total
           FROM candidates c
          WHERE c.created_at >= $1 AND c.created_at < $2` + appendCandidateScope(ctx, params);
      const { rows } = await pool.query(sql, params);
      const total = Number(rows[0]?.total ?? 0);
      const conv = Number(rows[0]?.conv ?? 0);
      return total > 0 ? Math.round((conv / total) * 1000) / 10 : 0;
    };
    return { value: await rate(ctx.from, ctx.to), previous: await rate(ctx.prevFrom, ctx.prevTo) };
  },
};

const candidatesQualifiedUnconverted: MetricDefinition = {
  key: 'candidates.qualified_unconverted',
  permission: 'candidates.view_list',
  titleAr: 'مؤهّلون لم يُحوّلوا',
  unit: 'count',
  purpose: 'سير عمل: تراكم مرشّحين Qualified بلا تحويل — فرص بيع معلّقة تحتاج متابعة.',
  async compute(ctx) {
    // مؤشر لحظي (backlog حالي) — لا يعتمد على نافذة الزمن.
    const params: unknown[] = [];
    const sql =
      `SELECT COUNT(*)::int AS v FROM candidates c
        WHERE c.status = 'Qualified' AND c.converted_to_lead_id IS NULL` + appendCandidateScope(ctx, params);
    return { value: await scalar(sql, params), previous: null };
  },
};

const clientsCommittedRatio: MetricDefinition = {
  key: 'clients.committed_ratio',
  permission: 'clients.rating.view',
  titleAr: 'نسبة الزبائن الملتزمين',
  unit: 'percent',
  purpose: 'قرار/إنجاز فريق: جودة قاعدة الزبائن (التزام السداد/التعامل).',
  async compute(ctx) {
    // مؤشر لحظي على التقييم الحالي (clients.rating) ضمن النطاق.
    const params: unknown[] = [];
    const sql =
      `SELECT
          COUNT(*) FILTER (WHERE c.rating = 'Committed')::numeric AS committed,
          COUNT(*) FILTER (WHERE c.rating IN ('Committed','NotCommitted'))::numeric AS rated
         FROM clients c
        WHERE c.deleted_at IS NULL` + appendClientScope(ctx, params);
    const { rows } = await pool.query(sql, params);
    const rated = Number(rows[0]?.rated ?? 0);
    const committed = Number(rows[0]?.committed ?? 0);
    return { value: rated > 0 ? Math.round((committed / rated) * 1000) / 10 : 0, previous: null };
  },
};

const candidatesNewCount: MetricDefinition = {
  key: 'candidates.new_count',
  permission: 'candidates.view_list',
  titleAr: 'مرشّحون جدد',
  unit: 'count',
  purpose: 'سير عمل: قياس تغذية أعلى القمع — كم اسمًا مقترحًا جديدًا دخل خلال الفترة على النطاق المختار.',
  async compute(ctx) {
    const count = async (from: Date, to: Date) => {
      const params: unknown[] = [from, to];
      const sql =
        `SELECT COUNT(*)::int AS v FROM candidates c
          WHERE c.created_at >= $1 AND c.created_at < $2` + appendCandidateScope(ctx, params);
      return scalar(sql, params);
    };
    return { value: await count(ctx.from, ctx.to), previous: await count(ctx.prevFrom, ctx.prevTo) };
  },
};

const candidatesJunkRate: MetricDefinition = {
  key: 'candidates.junk_rate',
  permission: 'candidates.view_list',
  titleAr: 'نسبة الهدر (Junk)',
  unit: 'percent',
  purpose: 'قرار: تقييم جودة مصادر الترشيح — نسبة الأسماء المرفوضة (Junk) من إجمالي ما دخل خلال الفترة.',
  async compute(ctx) {
    const rate = async (from: Date, to: Date): Promise<number> => {
      const params: unknown[] = [from, to];
      const sql =
        `SELECT
            COUNT(*) FILTER (WHERE c.status = 'Junk')::numeric AS junk,
            COUNT(*)::numeric AS total
           FROM candidates c
          WHERE c.created_at >= $1 AND c.created_at < $2` + appendCandidateScope(ctx, params);
      const { rows } = await pool.query(sql, params);
      const total = Number(rows[0]?.total ?? 0);
      const junk = Number(rows[0]?.junk ?? 0);
      return total > 0 ? Math.round((junk / total) * 1000) / 10 : 0;
    };
    return { value: await rate(ctx.from, ctx.to), previous: await rate(ctx.prevFrom, ctx.prevTo) };
  },
};

export const METRIC_CATALOG: MetricDefinition[] = [
  clientsNewCount,
  clientsActiveTotal,
  clientsUnownedCount,
  candidatesNewCount,
  candidateConversionRate,
  candidatesJunkRate,
  candidatesQualifiedUnconverted,
  clientsCommittedRatio,
];

export function findMetric(key: string): MetricDefinition | undefined {
  return METRIC_CATALOG.find(m => m.key === key);
}
