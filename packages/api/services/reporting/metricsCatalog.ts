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
import { appendApplicationScope, appendAuditApplicationScope, appendCandidateScope, appendClientScope, appendContractScope, appendInstalledDeviceScope, appendInterviewScope, appendReferralSheetScope, appendVacancyScope } from './reportingScope.js';

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

const clientsRatingNetChange: MetricDefinition = {
  key: 'clients.rating_net_change',
  permission: 'clients.rating.view',
  titleAr: 'صافي تغيّر الالتزام',
  unit: 'count',
  // "ترقية" = دخول حالة الالتزام (new=Committed و old≠Committed)؛ "تخفيض" = الخروج
  // منها. الصافي = (الترقيات − التخفيضات) خلال الفترة — مكسب/خسارة الزبائن الملتزمين.
  purpose: 'قرار/سير عمل: هل جودة قاعدة الزبائن تتحسّن أم تتدهور — صافي دخول الالتزام مقابل خروجه خلال الفترة.',
  async compute(ctx) {
    const net = async (from: Date, to: Date) => {
      const params: unknown[] = [from, to];
      const sql =
        `SELECT (
             COUNT(*) FILTER (WHERE h.new_rating = 'Committed' AND h.old_rating IS DISTINCT FROM 'Committed')
           - COUNT(*) FILTER (WHERE h.old_rating = 'Committed' AND h.new_rating IS DISTINCT FROM 'Committed')
           )::int AS v
           FROM client_rating_history h
           JOIN clients c ON c.id = h.client_id
          WHERE h.changed_at >= $1 AND h.changed_at < $2
            AND c.deleted_at IS NULL` + appendClientScope(ctx, params);
      return scalar(sql, params);
    };
    return { value: await net(ctx.from, ctx.to), previous: await net(ctx.prevFrom, ctx.prevTo) };
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

const candidatesDuplicateRate: MetricDefinition = {
  key: 'candidates.duplicate_rate',
  permission: 'candidates.view_list',
  titleAr: 'نسبة التكرار',
  unit: 'percent',
  purpose: 'سير عمل: نظافة البيانات عند الإدخال الميداني — نسبة الأسماء المكرّرة من إجمالي ما دخل خلال الفترة.',
  async compute(ctx) {
    const rate = async (from: Date, to: Date): Promise<number> => {
      const params: unknown[] = [from, to];
      const sql =
        `SELECT
            COUNT(*) FILTER (WHERE c.duplicate_flag = TRUE)::numeric AS dup,
            COUNT(*)::numeric AS total
           FROM candidates c
          WHERE c.created_at >= $1 AND c.created_at < $2` + appendCandidateScope(ctx, params);
      const { rows } = await pool.query(sql, params);
      const total = Number(rows[0]?.total ?? 0);
      const dup = Number(rows[0]?.dup ?? 0);
      return total > 0 ? Math.round((dup / total) * 1000) / 10 : 0;
    };
    return { value: await rate(ctx.from, ctx.to), previous: await rate(ctx.prevFrom, ctx.prevTo) };
  },
};

const referralSheetsBehindTarget: MetricDefinition = {
  key: 'referral_sheets.behind_target_count',
  permission: 'candidates.name_lists.view_list',
  titleAr: 'أوراق إحالة دون الهدف',
  unit: 'count',
  purpose: 'سير عمل: متابعة إنجاز الأهداف الميدانية — لوائح قيد الجمع لم تبلغ عدد الأسماء المستهدف.',
  async compute(ctx) {
    // لقطة راهنة (backlog) — لا تعتمد على نافذة الزمن.
    const params: unknown[] = [];
    const sql =
      `SELECT COUNT(*)::int AS v
         FROM referral_sheets s
        WHERE s.status = 'In-Progress'
          AND s.target_candidates > 0
          AND s.total_candidates < s.target_candidates` + appendReferralSheetScope(ctx, params);
    return { value: await scalar(sql, params), previous: null };
  },
};

const referralSheetsNewCount: MetricDefinition = {
  key: 'referral_sheets.new_count',
  permission: 'candidates.name_lists.view_list',
  titleAr: 'لوائح أسماء جديدة',
  unit: 'count',
  purpose: 'سير عمل: حجم نشاط جمع الأسماء — كم لائحة أُنشئت خلال الفترة على النطاق المختار.',
  async compute(ctx) {
    const count = async (from: Date, to: Date) => {
      const params: unknown[] = [from, to];
      const sql =
        `SELECT COUNT(*)::int AS v FROM referral_sheets s
          WHERE s.created_at >= $1 AND s.created_at < $2` + appendReferralSheetScope(ctx, params);
      return scalar(sql, params);
    };
    return { value: await count(ctx.from, ctx.to), previous: await count(ctx.prevFrom, ctx.prevTo) };
  },
};

const referralSheetsInProgressCount: MetricDefinition = {
  key: 'referral_sheets.in_progress_count',
  permission: 'candidates.name_lists.view_list',
  titleAr: 'لوائح قيد الجمع',
  unit: 'count',
  purpose: 'سير عمل: كم لائحة ما زالت قيد الجمع الآن — عبء تشغيلي مفتوح (لقطة راهنة).',
  async compute(ctx) {
    const params: unknown[] = [];
    const sql =
      `SELECT COUNT(*)::int AS v FROM referral_sheets s
        WHERE s.status = 'In-Progress'` + appendReferralSheetScope(ctx, params);
    return { value: await scalar(sql, params), previous: null };
  },
};

const referralSheetsNamesCollected: MetricDefinition = {
  key: 'referral_sheets.names_collected',
  permission: 'candidates.name_lists.view_list',
  titleAr: 'الأسماء المجمّعة',
  unit: 'count',
  purpose: 'إنجاز فريق: الإنتاجية الفعلية — إجمالي الأسماء المجمّعة في لوائح الفترة على النطاق المختار.',
  async compute(ctx) {
    const sum = async (from: Date, to: Date) => {
      const params: unknown[] = [from, to];
      const sql =
        `SELECT COALESCE(SUM(s.total_candidates), 0)::int AS v FROM referral_sheets s
          WHERE s.created_at >= $1 AND s.created_at < $2` + appendReferralSheetScope(ctx, params);
      return scalar(sql, params);
    };
    return { value: await sum(ctx.from, ctx.to), previous: await sum(ctx.prevFrom, ctx.prevTo) };
  },
};

const referralSheetsAvgQuality: MetricDefinition = {
  key: 'referral_sheets.avg_quality',
  permission: 'candidates.name_lists.view_list',
  titleAr: 'متوسط جودة اللوائح',
  unit: 'percent',
  purpose: 'إنجاز فريق: مؤشر جودة قياسي مكمّل للـ leaderboard — متوسط جودة لوائح الفترة على النطاق.',
  async compute(ctx) {
    const avg = async (from: Date, to: Date) => {
      const params: unknown[] = [from, to];
      const sql =
        `SELECT COALESCE(ROUND(AVG(s.quality_percentage)::numeric, 1), 0)::numeric AS v FROM referral_sheets s
          WHERE s.created_at >= $1 AND s.created_at < $2
            AND s.quality_percentage IS NOT NULL` + appendReferralSheetScope(ctx, params);
      return scalar(sql, params);
    };
    return { value: await avg(ctx.from, ctx.to), previous: await avg(ctx.prevFrom, ctx.prevTo) };
  },
};

// ── العقود والمبيعات (§2.هـ) — فرعية فقط عبر appendContractScope؛ المبيعات تستبعد
// المسودات (DEC-CT-01)، وقيمة/متوسط المبيعات تستبعد الملغاة أيضاً (إيراد محقّق). ──
const contractsCount: MetricDefinition = {
  key: 'contracts.count',
  permission: 'contracts.view_list',
  titleAr: 'عدد العقود',
  unit: 'count',
  purpose: 'قرار: حجم التعاقد خلال الفترة على مستوى الفرع (يستبعد المسودات).',
  async compute(ctx) {
    const count = async (from: Date, to: Date) => {
      const params: unknown[] = [from, to];
      const sql =
        `SELECT COUNT(*)::int AS v FROM contracts c
          WHERE c.status <> 'draft' AND NULLIF(TRIM(c.contract_date), '')::timestamptz >= $1 AND NULLIF(TRIM(c.contract_date), '')::timestamptz < $2` + appendContractScope(ctx, params);
      return scalar(sql, params);
    };
    return { value: await count(ctx.from, ctx.to), previous: await count(ctx.prevFrom, ctx.prevTo) };
  },
};

const contractsSalesValue: MetricDefinition = {
  key: 'contracts.sales_value',
  permission: 'contracts.view_list',
  titleAr: 'قيمة المبيعات',
  unit: 'count',
  purpose: 'قرار: إجمالي قيمة المبيعات المحقّقة (عقود فعّالة/مكتملة) خلال الفترة — تستبعد المسودات والملغاة.',
  async compute(ctx) {
    const sum = async (from: Date, to: Date) => {
      const params: unknown[] = [from, to];
      const sql =
        `SELECT COALESCE(SUM(c.final_price), 0)::numeric AS v FROM contracts c
          WHERE c.status IN ('active','completed') AND NULLIF(TRIM(c.contract_date), '')::timestamptz >= $1 AND NULLIF(TRIM(c.contract_date), '')::timestamptz < $2` + appendContractScope(ctx, params);
      return scalar(sql, params);
    };
    return { value: await sum(ctx.from, ctx.to), previous: await sum(ctx.prevFrom, ctx.prevTo) };
  },
};

const contractsAvgValue: MetricDefinition = {
  key: 'contracts.avg_value',
  permission: 'contracts.view_list',
  titleAr: 'متوسط قيمة العقد',
  unit: 'count',
  purpose: 'قرار: متوسط قيمة العقد المحقّق (فعّال/مكتمل) خلال الفترة.',
  async compute(ctx) {
    const avg = async (from: Date, to: Date) => {
      const params: unknown[] = [from, to];
      const sql =
        `SELECT COALESCE(ROUND(AVG(c.final_price)), 0)::numeric AS v FROM contracts c
          WHERE c.status IN ('active','completed') AND NULLIF(TRIM(c.contract_date), '')::timestamptz >= $1 AND NULLIF(TRIM(c.contract_date), '')::timestamptz < $2` + appendContractScope(ctx, params);
      return scalar(sql, params);
    };
    return { value: await avg(ctx.from, ctx.to), previous: await avg(ctx.prevFrom, ctx.prevTo) };
  },
};

const contractsCancellationRate: MetricDefinition = {
  key: 'contracts.cancellation_rate',
  permission: 'contracts.view_list',
  titleAr: 'معدّل الإلغاء',
  unit: 'percent',
  purpose: 'قرار: نسبة العقود الملغاة من إجمالي المُبرمة (غير المسودة) خلال الفترة.',
  async compute(ctx) {
    const rate = async (from: Date, to: Date): Promise<number> => {
      const params: unknown[] = [from, to];
      const sql =
        `SELECT
            COUNT(*) FILTER (WHERE c.status = 'cancelled')::numeric AS cancelled,
            COUNT(*)::numeric AS total
           FROM contracts c
          WHERE c.status <> 'draft' AND NULLIF(TRIM(c.contract_date), '')::timestamptz >= $1 AND NULLIF(TRIM(c.contract_date), '')::timestamptz < $2` + appendContractScope(ctx, params);
      const { rows } = await pool.query(sql, params);
      const total = Number(rows[0]?.total ?? 0);
      const cancelled = Number(rows[0]?.cancelled ?? 0);
      return total > 0 ? Math.round((cancelled / total) * 1000) / 10 : 0;
    };
    return { value: await rate(ctx.from, ctx.to), previous: await rate(ctx.prevFrom, ctx.prevTo) };
  },
};

const contractsStuckDrafts: MetricDefinition = {
  key: 'contracts.stuck_drafts',
  permission: 'contracts.view_list',
  titleAr: 'مسودات عالقة',
  unit: 'count',
  purpose: 'سير عمل: عقود مسودة لم تُعتمد بعد — عالقة تحتاج إغلاقًا (لقطة راهنة).',
  async compute(ctx) {
    const params: unknown[] = [];
    const sql = `SELECT COUNT(*)::int AS v FROM contracts c WHERE c.status = 'draft'` + appendContractScope(ctx, params);
    return { value: await scalar(sql, params), previous: null };
  },
};

// ── الأجهزة المركّبة — فرعية فقط عبر appendInstalledDeviceScope (فرع فقط). ──
const devicesActiveBase: MetricDefinition = {
  key: 'devices.active_base',
  permission: 'installed_devices.view',
  titleAr: 'الأجهزة الفعّالة',
  unit: 'count',
  purpose: 'قرار: عدد الأجهزة الفعّالة حالياً (القاعدة التي تقود الصيانة والخدمة) — لقطة راهنة.',
  async compute(ctx) {
    const params: unknown[] = [];
    const sql = `SELECT COUNT(*)::int AS v FROM installed_devices d WHERE d.status = 'active'` + appendInstalledDeviceScope(ctx, params);
    return { value: await scalar(sql, params), previous: null };
  },
};

const devicesInstalledInPeriod: MetricDefinition = {
  key: 'devices.installed_in_period',
  permission: 'installed_devices.view',
  titleAr: 'أجهزة رُكّبت',
  unit: 'count',
  purpose: 'قرار: عدد الأجهزة التي رُكّبت خلال الفترة على مستوى الفرع.',
  async compute(ctx) {
    const count = async (from: Date, to: Date) => {
      const params: unknown[] = [from, to];
      const sql =
        `SELECT COUNT(*)::int AS v FROM installed_devices d
          WHERE d.installation_date >= $1::date AND d.installation_date < $2::date` + appendInstalledDeviceScope(ctx, params);
      return scalar(sql, params);
    };
    return { value: await count(ctx.from, ctx.to), previous: await count(ctx.prevFrom, ctx.prevTo) };
  },
};

const devicesGoldenActive: MetricDefinition = {
  key: 'devices.golden_active',
  permission: 'installed_devices.view',
  titleAr: 'أجهزة بضمان ذهبي',
  unit: 'count',
  purpose: 'قرار: عدد الأجهزة بضمان ذهبي فعّال — شريحة مميّزة — لقطة راهنة.',
  async compute(ctx) {
    const params: unknown[] = [];
    const sql = `SELECT COUNT(*)::int AS v FROM installed_devices d WHERE d.is_golden_warranty = TRUE AND d.status <> 'contract_cancelled'` + appendInstalledDeviceScope(ctx, params);
    return { value: await scalar(sql, params), previous: null };
  },
};

const devicesWarrantyExpiring: MetricDefinition = {
  key: 'devices.warranty_expiring',
  permission: 'installed_devices.view',
  titleAr: 'كفالات توشك على الانتهاء',
  unit: 'count',
  purpose: 'سير عمل: أجهزة فعّالة تنتهي كفالتها (ذهبية/عقد) خلال ٦٠ يوماً — هدف تجديد — لقطة راهنة.',
  async compute(ctx) {
    const params: unknown[] = [];
    const sql =
      `SELECT COUNT(*)::int AS v FROM installed_devices d
        WHERE d.status = 'active'
          AND LEAST(COALESCE(d.golden_warranty_end_date, DATE '9999-12-31'), COALESCE(d.contract_warranty_end_date, DATE '9999-12-31')) BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '60 days'` + appendInstalledDeviceScope(ctx, params);
    return { value: await scalar(sql, params), previous: null };
  },
};

// ── التوظيف (§2.ط) — الطبقة الأولى: القمع/الشواغر/زمن الدورة/المقابلات ──────────
// النطاق عبر appendApplicationScope/appendVacancyScope/appendInterviewScope، وكلها
// تعالج ASSIGNED صراحةً (لا توسيع صامت). القرارات النهائية على job_applications.decision.

const applicationsNewCount: MetricDefinition = {
  key: 'applications.new_count',
  permission: 'jobs.applications.view_list',
  titleAr: 'طلبات توظيف جديدة',
  unit: 'count',
  purpose: 'سير عمل: حجم التغذية أعلى قمع التوظيف — كم طلباً دخل خلال الفترة على النطاق المختار.',
  async compute(ctx) {
    const count = async (from: Date, to: Date) => {
      const params: unknown[] = [from, to];
      const sql =
        `SELECT COUNT(*)::int AS v FROM job_applications ja
          WHERE ja.created_at >= $1 AND ja.created_at < $2` + appendApplicationScope(ctx, params);
      return scalar(sql, params);
    };
    return { value: await count(ctx.from, ctx.to), previous: await count(ctx.prevFrom, ctx.prevTo) };
  },
};

const applicationsInProcessCount: MetricDefinition = {
  key: 'applications.in_process_count',
  permission: 'jobs.applications.view_list',
  titleAr: 'طلبات قيد المعالجة',
  unit: 'count',
  purpose: 'سير عمل: عبء التوظيف المفتوح — طلبات لم تُحسم بقرار نهائي ولم تُؤرشف (لقطة راهنة).',
  async compute(ctx) {
    const params: unknown[] = [];
    const sql =
      `SELECT COUNT(*)::int AS v FROM job_applications ja
        WHERE ja.decision IS NULL
          AND ja.is_archived IS NOT TRUE` + appendApplicationScope(ctx, params);
    return { value: await scalar(sql, params), previous: null };
  },
};

const applicationsAcceptanceRate: MetricDefinition = {
  key: 'applications.acceptance_rate',
  permission: 'jobs.applications.view_list',
  titleAr: 'معدّل القبول',
  unit: 'percent',
  purpose: 'قرار: فاعلية مسار التوظيف — نسبة المقبولين من الطلبات المحسومة بقرار نهائي خلال الفترة.',
  async compute(ctx) {
    const rate = async (from: Date, to: Date): Promise<number> => {
      const params: unknown[] = [from, to];
      const sql =
        `SELECT
            COUNT(*) FILTER (WHERE ja.decision = 'Hired')::numeric AS hired,
            COUNT(*)::numeric AS decided
           FROM job_applications ja
          WHERE ja.decision IS NOT NULL
            AND ja.updated_at >= $1 AND ja.updated_at < $2` + appendApplicationScope(ctx, params);
      const { rows } = await pool.query(sql, params);
      const decided = Number(rows[0]?.decided ?? 0);
      const hired = Number(rows[0]?.hired ?? 0);
      return decided > 0 ? Math.round((hired / decided) * 1000) / 10 : 0;
    };
    return { value: await rate(ctx.from, ctx.to), previous: await rate(ctx.prevFrom, ctx.prevTo) };
  },
};

const vacanciesOpenCount: MetricDefinition = {
  key: 'vacancies.open_count',
  permission: 'jobs.vacancies.view_list',
  titleAr: 'شواغر مفتوحة',
  unit: 'count',
  purpose: 'قرار: عدد الشواغر المتاحة للاستقبال حالياً ضمن النطاق (لقطة راهنة).',
  async compute(ctx) {
    const params: unknown[] = [];
    const sql =
      `SELECT COUNT(*)::int AS v FROM job_vacancies jv
        WHERE jv.status = 'Open'` + appendVacancyScope(ctx, params);
    return { value: await scalar(sql, params), previous: null };
  },
};

const vacanciesRemainingSlots: MetricDefinition = {
  key: 'vacancies.remaining_slots',
  permission: 'jobs.vacancies.view_list',
  titleAr: 'المقاعد الشاغرة',
  unit: 'count',
  purpose: 'قرار: الطاقة الاستيعابية المفتوحة فعلياً — مجموع المقاعد المطلوبة في الشواغر المفتوحة.',
  async compute(ctx) {
    const params: unknown[] = [];
    const sql =
      `SELECT COALESCE(SUM(jv.vacancy_count), 0)::int AS v FROM job_vacancies jv
        WHERE jv.status = 'Open'` + appendVacancyScope(ctx, params);
    return { value: await scalar(sql, params), previous: null };
  },
};

const vacanciesExpiringSoon: MetricDefinition = {
  key: 'vacancies.expiring_soon',
  permission: 'jobs.vacancies.view_list',
  titleAr: 'شواغر توشك على الانتهاء',
  unit: 'count',
  purpose: 'سير عمل: شواغر مفتوحة ينتهي تاريخها خلال ١٤ يوماً — تحتاج تمديداً أو إغلاقاً (لقطة راهنة).',
  async compute(ctx) {
    // migr 376 يغلق المنتهية تلقائياً؛ هذا المؤشر ينبّه قبل الإغلاق لا بعده.
    const params: unknown[] = [];
    const sql =
      `SELECT COUNT(*)::int AS v FROM job_vacancies jv
        WHERE jv.status = 'Open'
          AND jv.end_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '14 days'` + appendVacancyScope(ctx, params);
    return { value: await scalar(sql, params), previous: null };
  },
};

const applicationsAvgTimeToHire: MetricDefinition = {
  key: 'applications.avg_time_to_hire',
  permission: 'jobs.applications.view_list',
  titleAr: 'متوسط زمن التوظيف (أيام)',
  unit: 'count',
  purpose: 'قرار: كم يستغرق الطلب من التقديم حتى التوظيف النهائي — يكشف بطء المسار قبل فقدان المرشّح.',
  async compute(ctx) {
    // المصدر audit_logs: الفارق بين إنشاء الطلب وحدث «Final Hired» المسجَّل ضمن الفترة.
    const avg = async (from: Date, to: Date) => {
      const params: unknown[] = [from, to];
      const sql =
        `SELECT COALESCE(ROUND(AVG(EXTRACT(EPOCH FROM (al."timestamp" - ja.created_at)) / 86400)::numeric, 1), 0)::numeric AS v
           FROM audit_logs al
           JOIN job_applications ja ON ja.id = al.application_id
          WHERE al.action_type = 'Final Hired'
            AND al."timestamp" >= $1 AND al."timestamp" < $2` + appendAuditApplicationScope(ctx, params);
      return scalar(sql, params);
    };
    return { value: await avg(ctx.from, ctx.to), previous: await avg(ctx.prevFrom, ctx.prevTo) };
  },
};

const applicationsStalledCount: MetricDefinition = {
  key: 'applications.stalled_count',
  permission: 'jobs.applications.view_list',
  titleAr: 'طلبات عالقة',
  unit: 'count',
  purpose: 'سير عمل: طلبات قيد المعالجة بلا أي حركة مسجَّلة منذ ١٤ يوماً فأكثر — تحتاج دفعاً أو إغلاقاً.',
  async compute(ctx) {
    // «الحركة» = آخر حدث تدقيق للطلب؛ إن لم يوجد فأي حركة تُقاس من تاريخ الإنشاء.
    const params: unknown[] = [];
    const sql =
      `SELECT COUNT(*)::int AS v FROM job_applications ja
        WHERE ja.decision IS NULL
          AND ja.is_archived IS NOT TRUE
          AND COALESCE(
                (SELECT MAX(al."timestamp") FROM audit_logs al WHERE al.application_id = ja.id),
                ja.created_at
              ) < NOW() - INTERVAL '14 days'` + appendApplicationScope(ctx, params);
    return { value: await scalar(sql, params), previous: null };
  },
};

const interviewsScheduledCount: MetricDefinition = {
  key: 'interviews.scheduled_count',
  permission: 'jobs.interviews.view_list',
  titleAr: 'مقابلات مجدولة',
  unit: 'count',
  purpose: 'سير عمل: حجم نشاط المقابلات — كم مقابلة أُنشئت خلال الفترة ضمن النطاق.',
  async compute(ctx) {
    const count = async (from: Date, to: Date) => {
      const params: unknown[] = [from, to];
      const sql =
        `SELECT COUNT(*)::int AS v FROM interviews i
          WHERE i.created_at >= $1 AND i.created_at < $2` + appendInterviewScope(ctx, params);
      return scalar(sql, params);
    };
    return { value: await count(ctx.from, ctx.to), previous: await count(ctx.prevFrom, ctx.prevTo) };
  },
};

const interviewsPassRate: MetricDefinition = {
  key: 'interviews.pass_rate',
  permission: 'jobs.interviews.view_list',
  titleAr: 'معدّل نجاح المقابلات',
  unit: 'percent',
  purpose: 'قرار: جودة التصفية قبل المقابلة — نسبة المقابلات المكتملة من المحسومة (مكتملة أو راسبة).',
  async compute(ctx) {
    const rate = async (from: Date, to: Date): Promise<number> => {
      const params: unknown[] = [from, to];
      const sql =
        `SELECT
            COUNT(*) FILTER (WHERE i.interview_status = 'Interview Completed')::numeric AS passed,
            COUNT(*)::numeric AS resolved
           FROM interviews i
          WHERE i.interview_status IN ('Interview Completed','Interview Failed')
            AND i.created_at >= $1 AND i.created_at < $2` + appendInterviewScope(ctx, params);
      const { rows } = await pool.query(sql, params);
      const resolved = Number(rows[0]?.resolved ?? 0);
      const passed = Number(rows[0]?.passed ?? 0);
      return resolved > 0 ? Math.round((passed / resolved) * 1000) / 10 : 0;
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
  clientsRatingNetChange,
  candidatesDuplicateRate,
  referralSheetsBehindTarget,
  referralSheetsNewCount,
  referralSheetsInProgressCount,
  referralSheetsNamesCollected,
  referralSheetsAvgQuality,
  contractsCount,
  contractsSalesValue,
  contractsAvgValue,
  contractsCancellationRate,
  contractsStuckDrafts,
  devicesActiveBase,
  devicesInstalledInPeriod,
  devicesGoldenActive,
  devicesWarrantyExpiring,
  applicationsNewCount,
  applicationsInProcessCount,
  applicationsAcceptanceRate,
  applicationsAvgTimeToHire,
  applicationsStalledCount,
  vacanciesOpenCount,
  vacanciesRemainingSlots,
  vacanciesExpiringSoon,
  interviewsScheduledCount,
  interviewsPassRate,
];

export function findMetric(key: string): MetricDefinition | undefined {
  return METRIC_CATALOG.find(m => m.key === key);
}
