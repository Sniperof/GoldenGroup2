// ============================================================
// breakdownCatalog.ts — كتالوج المؤشرات التجميعية (reporting-analytics §3.4)
// ============================================================
// مؤشر تجميعي = يُعيد سلسلة مجموعات {key,label,value} بدل قيمة قياسية واحدة،
// ليُرسم كـ Funnel / Bar / Donut. يتشارك نفس عقد النطاق وأدوات التقييد مع
// المؤشرات القياسية (metricsCatalog) عبر MetricComputeContext — لا يخترع نطاقًا.
// ============================================================

import pool from '../../db.js';
import type { MetricComputeContext } from './metricsCatalog.js';

export type BreakdownKind = 'funnel' | 'ranked-bar' | 'donut';

export interface BreakdownGroup {
  key: string;
  label: string;
  value: number;
  /** قيمة ثانوية اختيارية تُعرض كتعليق بجانب الشريط (مثل معدّل التحويل). */
  value2?: number;
}

export interface BreakdownDefinition {
  key: string;
  permission: string;
  titleAr: string;
  kind: BreakdownKind;
  /** وحدة القيمة الأساسية لتنسيق العرض (افتراضي 'count'). */
  valueUnit?: 'count' | 'percent';
  /** تسمية القيمة الثانوية value2 (مثل 'تحويل') — تظهر بجانبها كنسبة٪. */
  secondaryLabel?: string;
  /** غاية المؤشر (§8.4): قرار/سير عمل/إنجاز فريق — للتوثيق والتدقيق. */
  purpose: string;
  compute: (ctx: MetricComputeContext) => Promise<BreakdownGroup[]>;
}

// نفس نمط candidateScope في metricsCatalog (يُبقي التقييد بالنطاق موحّدًا؛
// ASSIGNED عبر owner_user_id كبقيّة مؤشرات المرشّحين).
function candidateScope(ctx: MetricComputeContext, params: unknown[]): string {
  let sql = '';
  if (ctx.branchIds.length > 0) {
    params.push(ctx.branchIds);
    sql += ` AND c.branch_id = ANY($${params.length})`;
  }
  if (ctx.scope === 'ASSIGNED') {
    params.push(ctx.userId);
    sql += ` AND c.owner_user_id = $${params.length}`;
  }
  return sql;
}

// تقييد لوائح الأسماء (referral_sheets مُسمّاة s) — نفس المبدأ؛ ASSIGNED عبر
// owner_user_id (الجامع الفعلي)، فتنهار المجموعة تلقائيًا لصفّه (reporting §3.8).
function sheetScope(ctx: MetricComputeContext, params: unknown[]): string {
  let sql = '';
  if (ctx.branchIds.length > 0) {
    params.push(ctx.branchIds);
    sql += ` AND s.branch_id = ANY($${params.length})`;
  }
  if (ctx.scope === 'ASSIGNED') {
    params.push(ctx.userId);
    sql += ` AND s.owner_user_id = $${params.length}`;
  }
  return sql;
}

// تقييد الزبائن (مُسمّاة c) — نفس مبدأ metricsCatalog.clientScope؛ ASSIGNED عبر
// جدول client_assignments (إسناد M2M) فتنهار المجموعة تلقائيًا لسجلّات المستخدم.
function clientScope(ctx: MetricComputeContext, params: unknown[]): string {
  let sql = '';
  if (ctx.branchIds.length > 0) {
    params.push(ctx.branchIds);
    sql += ` AND c.branch_id = ANY($${params.length})`;
  }
  if (ctx.scope === 'ASSIGNED') {
    params.push(ctx.userId);
    sql += ` AND EXISTS (SELECT 1 FROM client_assignments ca
                          WHERE ca.client_id = c.id AND ca.hr_user_id = $${params.length})`;
  }
  return sql;
}

// تسميات عربية لنوع الإحالة (القيم المعروفة في الكود)؛ أي قيمة أخرى تُعرض كما هي.
const REFERRAL_TYPE_LABELS: Record<string, string> = {
  Personal: 'شخصي',
  Client: 'زبون',
  Employee: 'موظف',
};

// تسميات عربية لقنوات الوصول المعروفة؛ أي قيمة أخرى تُعرض كما هي (fallback خام).
const ORIGIN_CHANNEL_LABELS: Record<string, string> = {
  PhoneCall: 'مكالمة هاتفية',
  SocialMedia: 'وسائل التواصل',
  Acquaintance: 'معرفة شخصية',
};

// قمع حالة المرشّح — الحالات الست بترتيب المسار (reporting-analytics §3.4 #2).
// القيمة الفعلية في قاعدة البيانات هي 'New' (لا 'Prospect' التي يعلنها النوع
// المشترك — انحراف موثّق §3.10). كل مرشّح في حالة واحدة، فالقمع = توزيع الحالة.
const CANDIDATE_STAGES: { key: string; label: string }[] = [
  { key: 'New', label: 'جديد' },
  { key: 'Suggested', label: 'مقترح' },
  { key: 'Contacted', label: 'تم الاتصال' },
  { key: 'FollowUp', label: 'متابعة' },
  { key: 'Qualified', label: 'مؤهّل' },
  { key: 'Junk', label: 'مرفوض' },
];

const candidatesStageFunnel: BreakdownDefinition = {
  key: 'candidates.stage_funnel',
  permission: 'candidates.view_list',
  titleAr: 'قمع حالة الأسماء المقترحة',
  kind: 'funnel',
  purpose: 'قرار: تحديد أين الاختناق في مسار المرشّحين (توزيع الحالة ضمن الفترة والنطاق).',
  async compute(ctx) {
    const params: unknown[] = [ctx.from, ctx.to];
    const sql =
      `SELECT c.status AS status, COUNT(*)::int AS v
         FROM candidates c
        WHERE c.created_at >= $1 AND c.created_at < $2` + candidateScope(ctx, params) +
      ` GROUP BY c.status`;
    const { rows } = await pool.query(sql, params);
    const counts = new Map<string, number>();
    for (const r of rows) counts.set(String(r.status), Number(r.v ?? 0));
    // نُعيد الحالات الست بالترتيب دائمًا (حتى الصفرية) ليعكس الرسم شكل القمع كاملًا.
    return CANDIDATE_STAGES.map(s => ({ key: s.key, label: s.label, value: counts.get(s.key) ?? 0 }));
  },
};

// ترتيب الفرق بجودة الإحالة (reporting-analytics §3.4 #8) — إنجاز فريق.
// المصدر referral_sheets؛ القيمة = متوسط الجودة٪، الثانوية = متوسط التحويل٪.
const referralSheetsTeamQuality: BreakdownDefinition = {
  key: 'referral_sheets.team_quality_leaderboard',
  permission: 'candidates.name_lists.view_list',
  titleAr: 'ترتيب الفرق بجودة الإحالة',
  kind: 'ranked-bar',
  valueUnit: 'percent',
  secondaryLabel: 'تحويل',
  purpose: 'إنجاز فريق: قياس جودة عمل كل مُجمِّع أسماء ميداني (متوسط الجودة/التحويل ضمن الفترة).',
  async compute(ctx) {
    const params: unknown[] = [ctx.from, ctx.to];
    const sql =
      `SELECT s.owner_user_id AS uid,
              COALESCE(hu.name, 'غير محدد') AS name,
              ROUND(AVG(s.quality_percentage)::numeric, 1) AS quality,
              ROUND(AVG(s.conversion_percentage)::numeric, 1) AS conversion
         FROM referral_sheets s
         LEFT JOIN hr_users hu ON hu.id = s.owner_user_id
        WHERE s.created_at >= $1 AND s.created_at < $2
          AND s.owner_user_id IS NOT NULL` + sheetScope(ctx, params) +
      ` GROUP BY s.owner_user_id, hu.name
        ORDER BY quality DESC NULLS LAST
        LIMIT 10`;
    const { rows } = await pool.query(sql, params);
    return rows.map(r => ({
      key: String(r.uid),
      label: String(r.name),
      value: Number(r.quality ?? 0),
      value2: Number(r.conversion ?? 0),
    }));
  },
};

// أداء الملكية حسب الموظف (reporting-analytics §3.8 #2) — إنجاز فريق.
// القيمة = عدد المرشّحين المملوكين، الثانوية = معدّل تحويلهم٪.
const candidatesOwnershipBreakdown: BreakdownDefinition = {
  key: 'candidates.ownership_breakdown',
  permission: 'candidates.view_list',
  titleAr: 'المرشّحون المملوكون لكل موظف',
  kind: 'ranked-bar',
  valueUnit: 'count',
  secondaryLabel: 'تحويل',
  purpose: 'إنجاز فريق: حجم محفظة كل موظف من المرشّحين ومعدّل تحويله فعليًا (لا مجرّد الجمع).',
  async compute(ctx) {
    const params: unknown[] = [ctx.from, ctx.to];
    const sql =
      `SELECT c.owner_user_id AS uid,
              COALESCE(hu.name, 'غير محدد') AS name,
              COUNT(*)::int AS cnt,
              COUNT(*) FILTER (WHERE c.converted_to_lead_id IS NOT NULL)::int AS converted
         FROM candidates c
         LEFT JOIN hr_users hu ON hu.id = c.owner_user_id
        WHERE c.created_at >= $1 AND c.created_at < $2
          AND c.owner_user_id IS NOT NULL` + candidateScope(ctx, params) +
      ` GROUP BY c.owner_user_id, hu.name
        ORDER BY cnt DESC
        LIMIT 10`;
    const { rows } = await pool.query(sql, params);
    return rows.map(r => {
      const cnt = Number(r.cnt ?? 0);
      const conv = Number(r.converted ?? 0);
      return {
        key: String(r.uid),
        label: String(r.name),
        value: cnt,
        value2: cnt > 0 ? Math.round((conv / cnt) * 1000) / 10 : 0,
      };
    });
  },
};

// ── توزيعات (Donut) — أبعاد فئوية (reporting-analytics §3.4 #6/#11 و §3.2) ──────

// توزيع نوع الإحالة (من أحال الاسم: شخصي/زبون/موظف) خلال الفترة والنطاق.
const candidatesReferralTypeDistribution: BreakdownDefinition = {
  key: 'candidates.referral_type_distribution',
  permission: 'candidates.view_list',
  titleAr: 'توزيع نوع الإحالة',
  kind: 'donut',
  valueUnit: 'count',
  purpose: 'قرار: من أين تأتي الأسماء المقترحة (شخصي/زبون/موظف) خلال الفترة على النطاق المختار.',
  async compute(ctx) {
    const params: unknown[] = [ctx.from, ctx.to];
    const sql =
      `SELECT COALESCE(NULLIF(TRIM(c.referral_type), ''), 'غير محدد') AS k, COUNT(*)::int AS v
         FROM candidates c
        WHERE c.created_at >= $1 AND c.created_at < $2` + candidateScope(ctx, params) +
      ` GROUP BY 1
        ORDER BY v DESC`;
    const { rows } = await pool.query(sql, params);
    return rows.map(r => {
      const k = String(r.k);
      return { key: k, label: REFERRAL_TYPE_LABELS[k] ?? k, value: Number(r.v ?? 0) };
    });
  },
};

// اكتساب المرشّحين حسب قناة الوصول (referral_origin_channel) خلال الفترة والنطاق.
const candidatesAcquisitionByChannel: BreakdownDefinition = {
  key: 'candidates.acquisition_by_channel',
  permission: 'candidates.view_list',
  titleAr: 'اكتساب المرشّحين حسب القناة',
  kind: 'donut',
  valueUnit: 'count',
  purpose: 'قرار: أي قناة إحالة تُغذّي أعلى القمع أكثر (كيفية وصول الاسم) خلال الفترة على النطاق المختار.',
  async compute(ctx) {
    const params: unknown[] = [ctx.from, ctx.to];
    const sql =
      `SELECT COALESCE(NULLIF(TRIM(c.referral_origin_channel), ''), 'غير محدد') AS k,
              COUNT(*)::int AS v
         FROM candidates c
        WHERE c.created_at >= $1 AND c.created_at < $2` + candidateScope(ctx, params) +
      ` GROUP BY 1
        ORDER BY v DESC
        LIMIT 8`;
    const { rows } = await pool.query(sql, params);
    return rows.map(r => {
      const k = String(r.k);
      return { key: k, label: ORIGIN_CHANNEL_LABELS[k] ?? k, value: Number(r.v ?? 0) };
    });
  },
};

// توزيع مصادر مياه الزبائن — لقطة راهنة لقاعدة الزبائن ضمن النطاق (كـ committed_ratio).
const clientsWaterSourceDistribution: BreakdownDefinition = {
  key: 'clients.water_source_distribution',
  permission: 'clients.view_list',
  titleAr: 'توزيع مصادر مياه الزبائن',
  kind: 'donut',
  valueUnit: 'count',
  purpose: 'قرار: تركيبة قاعدة الزبائن الحالية حسب مصدر المياه (لقطة راهنة) — توجّه العروض والصيانة.',
  async compute(ctx) {
    // لقطة راهنة لا تعتمد على نافذة الزمن (نظير clients.committed_ratio).
    const params: unknown[] = [];
    const sql =
      `SELECT COALESCE(NULLIF(TRIM(c.water_source), ''), 'غير محدد') AS k,
              COUNT(*)::int AS v
         FROM clients c
        WHERE c.deleted_at IS NULL` + clientScope(ctx, params) +
      ` GROUP BY 1
        ORDER BY v DESC
        LIMIT 8`;
    const { rows } = await pool.query(sql, params);
    return rows.map(r => ({ key: String(r.k), label: String(r.k), value: Number(r.v ?? 0) }));
  },
};

export const BREAKDOWN_CATALOG: BreakdownDefinition[] = [
  candidatesStageFunnel,
  referralSheetsTeamQuality,
  candidatesOwnershipBreakdown,
  candidatesReferralTypeDistribution,
  candidatesAcquisitionByChannel,
  clientsWaterSourceDistribution,
];

export function findBreakdown(key: string): BreakdownDefinition | undefined {
  return BREAKDOWN_CATALOG.find(b => b.key === key);
}
