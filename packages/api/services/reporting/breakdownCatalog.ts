// ============================================================
// breakdownCatalog.ts — كتالوج المؤشرات التجميعية (reporting-analytics §3.4)
// ============================================================
// مؤشر تجميعي = يُعيد سلسلة مجموعات {key,label,value} بدل قيمة قياسية واحدة،
// ليُرسم كـ Funnel / Bar / Donut. يتشارك نفس عقد النطاق وأدوات التقييد مع
// المؤشرات القياسية (metricsCatalog) عبر MetricComputeContext — لا يخترع نطاقًا.
// ============================================================

import pool from '../../db.js';
import type { MetricComputeContext } from './metricsCatalog.js';
import { appendCandidateScope, appendClientScope, appendContractScope, appendInstalledDeviceScope, appendReferralSheetScope } from './reportingScope.js';

export type BreakdownKind = 'funnel' | 'ranked-bar' | 'donut' | 'timeline';

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

// تسميات عربية لنوع الإحالة (القيم المعروفة في الكود)؛ أي قيمة أخرى تُعرض كما هي.
const REFERRAL_TYPE_LABELS: Record<string, string> = {
  Personal: 'شخصي',
  Client: 'زبون',
  Employee: 'موظف',
  Unknown: 'مجهول',
  Other: 'أخرى',
};

// تسميات عربية لقنوات الوصول المعروفة؛ أي قيمة أخرى تُعرض كما هي (fallback خام).
const ORIGIN_CHANNEL_LABELS: Record<string, string> = {
  PhoneCall: 'مكالمة هاتفية',
  SocialMedia: 'وسائل التواصل',
  Acquaintance: 'معرفة شخصية',
  mobile_app: 'تطبيق الموبايل',
};

// مراحل مسار المرشّح الفعلية بالترتيب (Suggested→FollowUp→Qualified): المرشّح يُنشأ
// 'Suggested'، و'Qualified' هو المخرج الناجح (يُعرض «تم الربط/تم التحويل» حسب
// duplicate_flag — انظر candidates.qualified_outcome_split). 'Junk' (مرفوض) خروج
// جانبي يغطّيه مؤشر نسبة الهدر، و'New'/'Contacted' ليستا في سير العمل الفعلي.
const CANDIDATE_FUNNEL_STAGES: { key: string; label: string }[] = [
  { key: 'Suggested', label: 'مقترح' },
  { key: 'FollowUp', label: 'متابعة' },
  { key: 'Qualified', label: 'مؤهّل' },
];

const candidatesStageFunnel: BreakdownDefinition = {
  key: 'candidates.stage_funnel',
  permission: 'candidates.view_list',
  titleAr: 'قمع حالة الأسماء المقترحة',
  kind: 'funnel',
  purpose: 'قرار: أين يتساقط المرشّحون في المسار (قمع تراكمي للمراحل ضمن الفترة والنطاق).',
  async compute(ctx) {
    const params: unknown[] = [ctx.from, ctx.to];
    const sql =
      `SELECT c.status AS status, COUNT(*)::int AS v
         FROM candidates c
        WHERE c.created_at >= $1 AND c.created_at < $2` + appendCandidateScope(ctx, params) +
      ` GROUP BY c.status`;
    const { rows } = await pool.query(sql, params);
    const counts = new Map<string, number>();
    for (const r of rows) counts.set(String(r.status), Number(r.v ?? 0));
    // قمع تراكمي: قيمة كل مرحلة = مَن بلغها أو تجاوزها (الحالة الحالية = أعمق مرحلة
    // بلغها المرشّح، بافتراض تقدّم خطّي) — فتتناقص القيم فيظهر شكل القمع الحقيقي.
    return CANDIDATE_FUNNEL_STAGES.map((s, idx) => {
      let reached = 0;
      for (let k = idx; k < CANDIDATE_FUNNEL_STAGES.length; k++) {
        reached += counts.get(CANDIDATE_FUNNEL_STAGES[k].key) ?? 0;
      }
      return { key: s.key, label: s.label, value: reached };
    });
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
          AND s.owner_user_id IS NOT NULL` + appendReferralSheetScope(ctx, params) +
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

// أداء الملكية حسب الموظف/الفرع (reporting-analytics §3.8 #2).
// Zero candidate_assignments rows is an intentional branch-ownership bucket.
const candidatesOwnershipBreakdown: BreakdownDefinition = {
  key: 'candidates.ownership_breakdown',
  permission: 'candidates.view_list',
  titleAr: 'توزيع ملكية الأسماء المقترحة',
  kind: 'ranked-bar',
  valueUnit: 'count',
  secondaryLabel: 'تحويل',
  purpose: 'عدد الأسماء المملوكة لكل موظف وملكية كل فرع ومعدّل التحويل الفعلي لكل منها.',
  async compute(ctx) {
    const params: unknown[] = [ctx.from, ctx.to];
    const scopeSql = appendCandidateScope(ctx, params);
    let assigneeSql = '';
    if (ctx.scope === 'ASSIGNED') {
      params.push(ctx.userId);
      assigneeSql = ` AND ca.hr_user_id = $${params.length}`;
    }
    const sql =
      `SELECT CASE
                WHEN ca.hr_user_id IS NULL THEN 'branch:' || c.branch_id::text
                ELSE 'user:' || ca.hr_user_id::text
              END AS ownership_key,
              CASE
                WHEN ca.hr_user_id IS NULL THEN 'ملكية فرع ' || COALESCE(b.name, 'غير محدد')
                ELSE COALESCE(hu.name, 'غير محدد')
              END AS name,
              COUNT(*)::int AS cnt,
              COUNT(*) FILTER (WHERE c.converted_to_lead_id IS NOT NULL)::int AS converted
         FROM candidates c
         LEFT JOIN LATERAL (
           SELECT ca0.hr_user_id
             FROM candidate_assignments ca0
            WHERE ca0.candidate_id = c.id
            ORDER BY ca0.assigned_at, ca0.id
            LIMIT 1
         ) ca ON TRUE
         LEFT JOIN hr_users hu ON hu.id = ca.hr_user_id
         LEFT JOIN branches b ON b.id = c.branch_id
        WHERE c.created_at >= $1 AND c.created_at < $2
          ` + scopeSql + assigneeSql +
      ` GROUP BY ownership_key, ca.hr_user_id, hu.name, c.branch_id, b.name
        ORDER BY cnt DESC
        LIMIT 10`;
    const { rows } = await pool.query(sql, params);
    return rows.map(r => {
      const cnt = Number(r.cnt ?? 0);
      const conv = Number(r.converted ?? 0);
      return {
        key: String(r.ownership_key),
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
        WHERE c.created_at >= $1 AND c.created_at < $2` + appendCandidateScope(ctx, params) +
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
        WHERE c.created_at >= $1 AND c.created_at < $2` + appendCandidateScope(ctx, params) +
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
        WHERE c.deleted_at IS NULL` + appendClientScope(ctx, params) +
      ` GROUP BY 1
        ORDER BY v DESC
        LIMIT 8`;
    const { rows } = await pool.query(sql, params);
    return rows.map(r => ({ key: String(r.k), label: String(r.k), value: Number(r.v ?? 0) }));
  },
};

const clientsClassificationDistribution: BreakdownDefinition = {
  key: 'clients.classification_distribution',
  permission: 'clients.view_list',
  titleAr: 'توزيع دورة حياة الزبائن',
  kind: 'donut',
  valueUnit: 'count',
  purpose: 'قرار: قراءة تركيب قاعدة الزبائن الحالية حسب Lead وFOP وOP.',
  async compute(ctx) {
    const params: unknown[] = [];
    const sql =
      `SELECT CASE
                WHEN c.candidate_status = 'OP' THEN 'OP'
                WHEN c.candidate_status = 'FOP' THEN 'FOP'
                ELSE 'Lead'
              END AS k,
              COUNT(*)::int AS v
         FROM clients c
        WHERE c.deleted_at IS NULL
          AND c.is_active IS NOT FALSE` + appendClientScope(ctx, params) +
      ` GROUP BY 1
        ORDER BY CASE
          WHEN CASE WHEN c.candidate_status = 'OP' THEN 'OP' WHEN c.candidate_status = 'FOP' THEN 'FOP' ELSE 'Lead' END = 'Lead' THEN 1
          WHEN CASE WHEN c.candidate_status = 'OP' THEN 'OP' WHEN c.candidate_status = 'FOP' THEN 'FOP' ELSE 'Lead' END = 'FOP' THEN 2
          ELSE 3
        END`;
    const { rows } = await pool.query(sql, params);
    const labels: Record<string, string> = { Lead: 'Lead · اسم مرشّح', FOP: 'FOP · زبون محتمل', OP: 'OP · زبون فعلي' };
    return rows.map(r => ({ key: String(r.k), label: labels[String(r.k)] ?? String(r.k), value: Number(r.v ?? 0) }));
  },
};

const clientsAcquisitionByChannel: BreakdownDefinition = {
  key: 'clients.acquisition_by_channel',
  permission: 'clients.view_list',
  titleAr: 'اكتساب الزبائن حسب القناة',
  kind: 'ranked-bar',
  valueUnit: 'count',
  purpose: 'قرار تسويقي: تحديد القنوات الأكثر جلبًا لسجلات الزبائن خلال الفترة.',
  async compute(ctx) {
    const params: unknown[] = [ctx.from, ctx.to];
    const sql =
      `SELECT COALESCE(NULLIF(TRIM(c.source_channel), ''), 'غير محدد') AS k,
              COUNT(*)::int AS v
         FROM clients c
        WHERE c.deleted_at IS NULL
          AND c.created_at >= $1 AND c.created_at < $2` + appendClientScope(ctx, params) +
      ` GROUP BY 1
        ORDER BY v DESC
        LIMIT 8`;
    const { rows } = await pool.query(sql, params);
    return rows.map(r => {
      const key = String(r.k);
      return { key, label: ORIGIN_CHANNEL_LABELS[key] ?? key, value: Number(r.v ?? 0) };
    });
  },
};

const clientsDataQualityDistribution: BreakdownDefinition = {
  key: 'clients.data_quality_distribution',
  permission: 'clients.view_list',
  titleAr: 'جودة بيانات الزبائن',
  kind: 'donut',
  valueUnit: 'count',
  purpose: 'سير عمل: قياس قابلية استخدام سجلات الزبائن وتحديد حجم البيانات التي تحتاج استكمالًا.',
  async compute(ctx) {
    const params: unknown[] = [];
    const sql =
      `SELECT COALESCE(NULLIF(TRIM(c.data_quality), ''), 'Undefined') AS k,
              COUNT(*)::int AS v
         FROM clients c
        WHERE c.deleted_at IS NULL
          AND c.is_active IS NOT FALSE` + appendClientScope(ctx, params) +
      ` GROUP BY 1
        ORDER BY v DESC`;
    const { rows } = await pool.query(sql, params);
    const labels: Record<string, string> = {
      Complete: 'مكتملة', Partial: 'جزئية', Minimal: 'حد أدنى', Undefined: 'غير محددة',
      correct: 'صحيحة', incorrect: 'تحتاج تصحيحًا',
    };
    return rows.map(r => ({ key: String(r.k), label: labels[String(r.k)] ?? String(r.k), value: Number(r.v ?? 0) }));
  },
};

function acquisitionBucket(from: Date, to: Date): { trunc: 'hour' | 'day' | 'week' | 'month'; interval: string } {
  const days = Math.max(1, (to.getTime() - from.getTime()) / 86_400_000);
  if (days <= 2) return { trunc: 'hour', interval: '1 hour' };
  if (days <= 45) return { trunc: 'day', interval: '1 day' };
  if (days <= 210) return { trunc: 'week', interval: '1 week' };
  return { trunc: 'month', interval: '1 month' };
}

const clientsAcquisitionTrend: BreakdownDefinition = {
  key: 'clients.acquisition_trend',
  permission: 'clients.view_list',
  titleAr: 'تطور اكتساب الزبائن',
  kind: 'timeline',
  valueUnit: 'count',
  purpose: 'قرار: إظهار اتجاه اكتساب الزبائن عبر الزمن ضمن الفترة والنطاق المختار.',
  async compute(ctx) {
    const bucket = acquisitionBucket(ctx.from, ctx.to);
    const params: unknown[] = [ctx.from, ctx.to];
    // trunc/interval محصوران في القيم الثابتة أعلاه، وليسا مدخل مستخدم.
    const sql =
      `WITH buckets AS (
         SELECT generate_series(
           date_trunc('${bucket.trunc}', $1::timestamptz),
           date_trunc('${bucket.trunc}', $2::timestamptz - interval '1 millisecond'),
           interval '${bucket.interval}'
         ) AS bucket
       ), counts AS (
         SELECT date_trunc('${bucket.trunc}', c.created_at) AS bucket, COUNT(*)::int AS v
           FROM clients c
          WHERE c.deleted_at IS NULL
            AND c.created_at >= $1 AND c.created_at < $2` + appendClientScope(ctx, params) +
      ` GROUP BY 1
       )
       SELECT b.bucket, COALESCE(ct.v, 0)::int AS v
         FROM buckets b
         LEFT JOIN counts ct ON ct.bucket = b.bucket
        ORDER BY b.bucket`;
    const { rows } = await pool.query(sql, params);
    return rows.map(r => {
      const iso = new Date(r.bucket).toISOString();
      return { key: iso, label: iso, value: Number(r.v ?? 0) };
    });
  },
};

// تقسيم مخرجات المؤهّلين: «تم الربط» (زبون موجود، duplicate_flag) مقابل «تم التحويل»
// (زبون جديد) — ضمن الفترة والنطاق.
const candidatesQualifiedOutcome: BreakdownDefinition = {
  key: 'candidates.qualified_outcome_split',
  permission: 'candidates.view_list',
  titleAr: 'مخرجات المؤهّلين (ربط/تحويل)',
  kind: 'donut',
  valueUnit: 'count',
  purpose: 'قرار: من بين المؤهّلين، كم رُبط بزبون موجود مقابل كم حُوّل لزبون جديد (ضمن الفترة والنطاق).',
  async compute(ctx) {
    const params: unknown[] = [ctx.from, ctx.to];
    const sql =
      `SELECT c.duplicate_flag AS dup, COUNT(*)::int AS v
         FROM candidates c
        WHERE c.status = 'Qualified'
          AND c.converted_to_lead_id IS NOT NULL
          AND c.created_at >= $1 AND c.created_at < $2` + appendCandidateScope(ctx, params) +
      ` GROUP BY c.duplicate_flag`;
    const { rows } = await pool.query(sql, params);
    return rows.map(r => ({
      key: r.dup ? 'linked' : 'converted',
      label: r.dup ? 'تم الربط' : 'تم التحويل',
      value: Number(r.v ?? 0),
    }));
  },
};

// ── إضافات مشتقّة من فلاتر جدول الزبائن (§3.2 #5/#8 · §3.8 #1) ──────────────────
// كلها clients.view_list ومقيَّدة بالنطاق عبر appendClientScope: صاحب ASSIGNED
// يرى محفظته وحدها (لا أرقام مدير)، وBRANCH فرعه، وGLOBAL الكل — دفاع بطبقتين.

// أداء الملكية: عدد الزبائن المملوكين لكل موظف/فرع (§3.8 #1، Tier 1). لصاحب
// ASSIGNED تنهار المجموعة لصفّه وحده («أدائي الشخصي») — لا تسريب أسماء/أرقام زملاء.
const clientsOwnershipBreakdown: BreakdownDefinition = {
  key: 'clients.ownership_breakdown',
  permission: 'clients.view_list',
  titleAr: 'توزيع ملكية الزبائن',
  kind: 'ranked-bar',
  valueUnit: 'count',
  purpose: 'إنجاز فريق: عدد الزبائن المسندين لكل موظف (وملكية الفرع) ضمن النطاق.',
  async compute(ctx) {
    const params: unknown[] = [];
    const scopeSql = appendClientScope(ctx, params);
    let assigneeSql = '';
    if (ctx.scope === 'ASSIGNED') {
      params.push(ctx.userId);
      assigneeSql = ` AND ca.hr_user_id = $${params.length}`;
    }
    const sql =
      `SELECT CASE
                WHEN ca.hr_user_id IS NULL THEN 'branch:' || c.branch_id::text
                ELSE 'user:' || ca.hr_user_id::text
              END AS ownership_key,
              CASE
                WHEN ca.hr_user_id IS NULL THEN 'ملكية فرع ' || COALESCE(b.name, 'غير محدد')
                ELSE COALESCE(hu.name, 'غير محدد')
              END AS name,
              COUNT(*)::int AS cnt
         FROM clients c
         LEFT JOIN LATERAL (
           SELECT ca0.hr_user_id
             FROM client_assignments ca0
            WHERE ca0.client_id = c.id
            ORDER BY ca0.assigned_at, ca0.id
            LIMIT 1
         ) ca ON TRUE
         LEFT JOIN hr_users hu ON hu.id = ca.hr_user_id
         LEFT JOIN branches b ON b.id = c.branch_id
        WHERE c.deleted_at IS NULL
          AND c.is_active IS NOT FALSE` + scopeSql + assigneeSql +
      ` GROUP BY ownership_key, ca.hr_user_id, hu.name, c.branch_id, b.name
        ORDER BY cnt DESC
        LIMIT 10`;
    const { rows } = await pool.query(sql, params);
    return rows.map(r => ({ key: String(r.ownership_key), label: String(r.name), value: Number(r.cnt ?? 0) }));
  },
};

// توزيع اكتساب الزبائن حسب نوع الوسيط (§3.2 #5): مَن أحضر الزبون (شخصي/زبون/موظف).
const clientsReferrerTypeDistribution: BreakdownDefinition = {
  key: 'clients.acquisition_by_referrer_type',
  permission: 'clients.view_list',
  titleAr: 'اكتساب الزبائن حسب نوع الوسيط',
  kind: 'donut',
  valueUnit: 'count',
  purpose: 'قرار: تقييم برنامج الإحالة مقابل التسويق المباشر — مَن يُحضر الزبائن فعليًا.',
  async compute(ctx) {
    const params: unknown[] = [ctx.from, ctx.to];
    const sql =
      `SELECT COALESCE(NULLIF(TRIM(c.referrer_type), ''), 'غير محدد') AS k, COUNT(*)::int AS v
         FROM clients c
        WHERE c.deleted_at IS NULL
          AND c.created_at >= $1 AND c.created_at < $2` + appendClientScope(ctx, params) +
      ` GROUP BY 1 ORDER BY v DESC LIMIT 8`;
    const { rows } = await pool.query(sql, params);
    // Fallback to Arabic 'غير محدد' so no raw English enum key can surface as a label.
    return rows.map(r => { const k = String(r.k); return { key: k, label: REFERRAL_TYPE_LABELS[k] ?? 'غير محدد', value: Number(r.v ?? 0) }; });
  },
};

// أعلى المناطق كثافة زبائن (§3.2 #8): تجميع لحظي على مستوى المحافظة ضمن النطاق.
const clientsTopGeoAreas: BreakdownDefinition = {
  key: 'clients.top_geo_areas',
  permission: 'clients.view_list',
  titleAr: 'أعلى المناطق كثافة زبائن',
  kind: 'ranked-bar',
  valueUnit: 'count',
  purpose: 'قرار: تخطيط التغطية الميدانية — أي المحافظات تحوي أعلى كثافة زبائن ضمن النطاق.',
  async compute(ctx) {
    const params: unknown[] = [];
    const sql =
      `SELECT COALESCE(g.name, 'غير محدد') AS k, COUNT(*)::int AS v
         FROM clients c
         LEFT JOIN geo_units g ON g.id = NULLIF(c.governorate::text, '')::int
        WHERE c.deleted_at IS NULL
          AND c.is_active IS NOT FALSE` + appendClientScope(ctx, params) +
      ` GROUP BY 1 ORDER BY v DESC LIMIT 10`;
    const { rows } = await pool.query(sql, params);
    return rows.map(r => ({ key: String(r.k), label: String(r.k), value: Number(r.v ?? 0) }));
  },
};

// كثافة الزبائن حسب خط السير (§3.7 #1): مطابقة قانونية عبر نقاط الخط عند المستوى
// الرابع (الحي) — c.neighborhood = route_points.geo_unit_id حيث level=4.
const clientsByRoute: BreakdownDefinition = {
  key: 'clients.by_route',
  permission: 'clients.view_list',
  titleAr: 'كثافة الزبائن حسب خط السير',
  kind: 'ranked-bar',
  valueUnit: 'count',
  purpose: 'قرار: أي خطوط السير تغطّي أعلى كثافة زبائن فعليًا — يربط بيانات الزبائن بقرار التخطيط الميداني.',
  async compute(ctx) {
    const params: unknown[] = [];
    const sql =
      `SELECT r.id AS rid, r.name AS rname, COUNT(DISTINCT c.id)::int AS v
         FROM clients c
         JOIN route_points rp ON rp.level = 4 AND rp.geo_unit_id = NULLIF(c.neighborhood::text, '')::int
         JOIN routes r ON r.id = rp.route_id
        WHERE c.deleted_at IS NULL
          AND c.is_active IS NOT FALSE` + appendClientScope(ctx, params) +
      ` GROUP BY r.id, r.name
        ORDER BY v DESC
        LIMIT 10`;
    const { rows } = await pool.query(sql, params);
    return rows.map(r => ({ key: String(r.rid), label: String(r.rname), value: Number(r.v ?? 0) }));
  },
};

// أكثر الوسطاء إحضارًا للزبائن (§3.2 #13): ترتيب حسب اسم الوسيط خلال الفترة والنطاق.
const clientsTopReferrers: BreakdownDefinition = {
  key: 'clients.top_referrers',
  permission: 'clients.view_list',
  titleAr: 'أكثر الوسطاء إحضارًا للزبائن',
  kind: 'ranked-bar',
  valueUnit: 'count',
  purpose: 'قرار/إنجاز فريق: مَن يُحضر أكثر الزبائن فعليًا — أساس أي برنامج حوافز إحالة.',
  async compute(ctx) {
    const params: unknown[] = [ctx.from, ctx.to];
    const sql =
      `SELECT COALESCE(NULLIF(TRIM(c.referrer_name), ''), 'غير محدد') AS k, COUNT(*)::int AS v
         FROM clients c
        WHERE c.deleted_at IS NULL
          AND c.referrer_name IS NOT NULL AND TRIM(c.referrer_name) <> ''
          AND c.created_at >= $1 AND c.created_at < $2` + appendClientScope(ctx, params) +
      ` GROUP BY 1 ORDER BY v DESC LIMIT 10`;
    const { rows } = await pool.query(sql, params);
    return rows.map(r => ({ key: String(r.k), label: String(r.k), value: Number(r.v ?? 0) }));
  },
};

// ── التوزيع الجغرافي وخط السير للمرشّحين (§3.7 #2/#3) ──────────────────────────

// كثافة المرشّحين حسب خط السير + معدّل التحويل لكل خط (مطابقة geo_unit_id مباشرة).
const candidatesByRoute: BreakdownDefinition = {
  key: 'candidates.by_route',
  permission: 'candidates.view_list',
  titleAr: 'كثافة المرشّحين حسب خط السير',
  kind: 'ranked-bar',
  valueUnit: 'count',
  secondaryLabel: 'تحويل',
  purpose: 'قرار: أي خطوط السير تُنتج مرشّحين قابلين للتحويل فعليًا لا عددًا فقط.',
  async compute(ctx) {
    const params: unknown[] = [];
    const sql =
      `SELECT r.id AS rid, r.name AS rname,
              COUNT(DISTINCT c.id)::int AS cnt,
              COUNT(DISTINCT c.id) FILTER (WHERE c.converted_to_lead_id IS NOT NULL)::int AS conv
         FROM candidates c
         JOIN route_points rp ON rp.geo_unit_id = c.geo_unit_id
         JOIN routes r ON r.id = rp.route_id
        WHERE c.geo_unit_id IS NOT NULL` + appendCandidateScope(ctx, params) +
      ` GROUP BY r.id, r.name ORDER BY cnt DESC LIMIT 10`;
    const { rows } = await pool.query(sql, params);
    return rows.map(r => {
      const cnt = Number(r.cnt ?? 0);
      const conv = Number(r.conv ?? 0);
      return { key: String(r.rid), label: String(r.rname), value: cnt, value2: cnt > 0 ? Math.round((conv / cnt) * 1000) / 10 : 0 };
    });
  },
};

// أعلى المناطق كثافة مرشّحين (لقطة راهنة على geo_unit_id ضمن النطاق).
const candidatesByGeoArea: BreakdownDefinition = {
  key: 'candidates.by_geo_area',
  permission: 'candidates.view_list',
  titleAr: 'أعلى المناطق كثافة مرشّحين',
  kind: 'ranked-bar',
  valueUnit: 'count',
  purpose: 'قرار: تخطيط تغطية ميدانية على مستوى المنطقة/الحي حسب كثافة المرشّحين.',
  async compute(ctx) {
    const params: unknown[] = [];
    const sql =
      `SELECT COALESCE(g.name, 'غير محدد') AS k, COUNT(*)::int AS v
         FROM candidates c
         LEFT JOIN geo_units g ON g.id = c.geo_unit_id
        WHERE TRUE` + appendCandidateScope(ctx, params) +
      ` GROUP BY 1 ORDER BY v DESC LIMIT 10`;
    const { rows } = await pool.query(sql, params);
    return rows.map(r => ({ key: String(r.k), label: String(r.k), value: Number(r.v ?? 0) }));
  },
};

// ── العقود والمبيعات (§2.هـ) — فرعية فقط عبر appendContractScope. المبيعات
// (القيمة/الاتجاه/حسب الفرع/البائع) تستبعد المسودات والملغاة؛ التوزيعات العدَدية
// تستبعد المسودات فقط. الفترة على contract_date إلا الملغاة (على cancelled_at). ──
const CONTRACT_SALE_TYPE_LABELS: Record<string, string> = { tradein: 'استبدال', retention: 'احتفاظ', direct: 'بيع مباشر' };
const CONTRACT_PAYMENT_LABELS: Record<string, string> = { cash: 'نقدي', installment: 'أقساط' };

const contractsSalesByBranch: BreakdownDefinition = {
  key: 'contracts.sales_by_branch',
  permission: 'contracts.view_list',
  titleAr: 'المبيعات حسب الفرع',
  kind: 'ranked-bar',
  valueUnit: 'count',
  purpose: 'قرار: توزيع قيمة المبيعات المحقّقة على الفروع خلال الفترة.',
  async compute(ctx) {
    const params: unknown[] = [ctx.from, ctx.to];
    const sql =
      `SELECT COALESCE(b.name, 'غير محدد') AS k, COALESCE(SUM(c.final_price), 0)::numeric AS v
         FROM contracts c LEFT JOIN branches b ON b.id = c.branch_id
        WHERE c.status IN ('active','completed') AND NULLIF(TRIM(c.contract_date), '')::timestamptz >= $1 AND NULLIF(TRIM(c.contract_date), '')::timestamptz < $2` + appendContractScope(ctx, params) +
      ` GROUP BY 1 ORDER BY v DESC LIMIT 10`;
    const { rows } = await pool.query(sql, params);
    return rows.map(r => ({ key: String(r.k), label: String(r.k), value: Number(r.v ?? 0) }));
  },
};

const contractsSalesBySeller: BreakdownDefinition = {
  key: 'contracts.sales_by_seller',
  permission: 'contracts.view_list',
  titleAr: 'المبيعات حسب البائع',
  kind: 'ranked-bar',
  valueUnit: 'count',
  purpose: 'إنجاز فريق: قيمة المبيعات المحقّقة لكل صاحب بيعة خلال الفترة.',
  async compute(ctx) {
    const params: unknown[] = [ctx.from, ctx.to];
    const sql =
      `SELECT COALESCE(e.name, 'غير محدد') AS k, COALESCE(SUM(c.final_price), 0)::numeric AS v
         FROM contracts c LEFT JOIN employees e ON e.id = c.sale_owner_id
        WHERE c.status IN ('active','completed') AND NULLIF(TRIM(c.contract_date), '')::timestamptz >= $1 AND NULLIF(TRIM(c.contract_date), '')::timestamptz < $2` + appendContractScope(ctx, params) +
      ` GROUP BY 1 ORDER BY v DESC LIMIT 10`;
    const { rows } = await pool.query(sql, params);
    return rows.map(r => ({ key: String(r.k), label: String(r.k), value: Number(r.v ?? 0) }));
  },
};

const contractsSalesBySaleType: BreakdownDefinition = {
  key: 'contracts.sales_by_sale_type',
  permission: 'contracts.view_list',
  titleAr: 'العقود حسب نوع البيع',
  kind: 'donut',
  valueUnit: 'count',
  purpose: 'قرار: تركيبة التعاقد حسب نوع البيع (مباشر/استبدال/احتفاظ) خلال الفترة.',
  async compute(ctx) {
    const params: unknown[] = [ctx.from, ctx.to];
    const sql =
      `SELECT COALESCE(NULLIF(TRIM(c.sale_type), ''), 'غير محدد') AS k, COUNT(*)::int AS v
         FROM contracts c
        WHERE c.status <> 'draft' AND NULLIF(TRIM(c.contract_date), '')::timestamptz >= $1 AND NULLIF(TRIM(c.contract_date), '')::timestamptz < $2` + appendContractScope(ctx, params) +
      ` GROUP BY 1 ORDER BY v DESC`;
    const { rows } = await pool.query(sql, params);
    return rows.map(r => { const k = String(r.k); return { key: k, label: CONTRACT_SALE_TYPE_LABELS[k] ?? k, value: Number(r.v ?? 0) }; });
  },
};

const contractsByPaymentType: BreakdownDefinition = {
  key: 'contracts.by_payment_type',
  permission: 'contracts.view_list',
  titleAr: 'العقود حسب نوع الدفع',
  kind: 'donut',
  valueUnit: 'count',
  purpose: 'قرار: توزيع العقود بين النقدي والأقساط خلال الفترة.',
  async compute(ctx) {
    const params: unknown[] = [ctx.from, ctx.to];
    const sql =
      `SELECT COALESCE(NULLIF(TRIM(c.payment_type), ''), 'غير محدد') AS k, COUNT(*)::int AS v
         FROM contracts c
        WHERE c.status <> 'draft' AND NULLIF(TRIM(c.contract_date), '')::timestamptz >= $1 AND NULLIF(TRIM(c.contract_date), '')::timestamptz < $2` + appendContractScope(ctx, params) +
      ` GROUP BY 1 ORDER BY v DESC`;
    const { rows } = await pool.query(sql, params);
    return rows.map(r => { const k = String(r.k); return { key: k, label: CONTRACT_PAYMENT_LABELS[k] ?? k, value: Number(r.v ?? 0) }; });
  },
};

const contractsByDeviceModel: BreakdownDefinition = {
  key: 'contracts.by_device_model',
  permission: 'contracts.view_list',
  titleAr: 'العقود حسب موديل الجهاز',
  kind: 'ranked-bar',
  valueUnit: 'count',
  purpose: 'قرار: أكثر موديلات الأجهزة تعاقدًا خلال الفترة (توجيه المخزون والعروض).',
  async compute(ctx) {
    const params: unknown[] = [ctx.from, ctx.to];
    const sql =
      `SELECT COALESCE(NULLIF(TRIM(c.device_model_name), ''), 'غير محدد') AS k, COUNT(*)::int AS v
         FROM contracts c
        WHERE c.status <> 'draft' AND NULLIF(TRIM(c.contract_date), '')::timestamptz >= $1 AND NULLIF(TRIM(c.contract_date), '')::timestamptz < $2` + appendContractScope(ctx, params) +
      ` GROUP BY 1 ORDER BY v DESC LIMIT 10`;
    const { rows } = await pool.query(sql, params);
    return rows.map(r => ({ key: String(r.k), label: String(r.k), value: Number(r.v ?? 0) }));
  },
};

const contractsCancelledByReason: BreakdownDefinition = {
  key: 'contracts.cancelled_by_reason',
  permission: 'contracts.view_list',
  titleAr: 'العقود الملغاة حسب السبب',
  kind: 'ranked-bar',
  valueUnit: 'count',
  purpose: 'قرار: أبرز أسباب إلغاء العقود خلال الفترة (سبب نصّي حرّ — قيد جودة بيانات).',
  async compute(ctx) {
    const params: unknown[] = [ctx.from, ctx.to];
    const sql =
      `SELECT COALESCE(NULLIF(TRIM(sl.metadata->>'label'), ''), NULLIF(TRIM(c.cancellation_reason), ''), 'غير محدد') AS k, COUNT(*)::int AS v
         FROM contracts c
         LEFT JOIN system_lists sl
           ON sl.category = 'contract_cancellation_reasons' AND sl.value = c.cancellation_reason
        WHERE c.status = 'cancelled' AND c.cancelled_at >= $1 AND c.cancelled_at < $2` + appendContractScope(ctx, params) +
      ` GROUP BY 1 ORDER BY v DESC LIMIT 10`;
    const { rows } = await pool.query(sql, params);
    return rows.map(r => ({ key: String(r.k), label: String(r.k), value: Number(r.v ?? 0) }));
  },
};

const contractsSalesTrend: BreakdownDefinition = {
  key: 'contracts.sales_trend',
  permission: 'contracts.view_list',
  titleAr: 'اتجاه قيمة المبيعات',
  kind: 'timeline',
  valueUnit: 'count',
  purpose: 'قرار: حركة قيمة المبيعات المحقّقة عبر الزمن ضمن الفترة والنطاق.',
  async compute(ctx) {
    const bucket = acquisitionBucket(ctx.from, ctx.to);
    const params: unknown[] = [ctx.from, ctx.to];
    const sql =
      `WITH buckets AS (
         SELECT generate_series(
           date_trunc('${bucket.trunc}', $1::timestamptz),
           date_trunc('${bucket.trunc}', $2::timestamptz - interval '1 millisecond'),
           interval '${bucket.interval}'
         ) AS bucket
       ), sums AS (
         SELECT date_trunc('${bucket.trunc}', c.contract_date::timestamptz) AS bucket, COALESCE(SUM(c.final_price), 0)::numeric AS v
           FROM contracts c
          WHERE c.status IN ('active','completed')
            AND NULLIF(TRIM(c.contract_date), '')::timestamptz >= $1 AND NULLIF(TRIM(c.contract_date), '')::timestamptz < $2` + appendContractScope(ctx, params) +
      ` GROUP BY 1
       )
       SELECT b.bucket, COALESCE(s.v, 0)::numeric AS v
         FROM buckets b LEFT JOIN sums s ON s.bucket = b.bucket
        ORDER BY b.bucket`;
    const { rows } = await pool.query(sql, params);
    return rows.map(r => { const iso = new Date(r.bucket).toISOString(); return { key: iso, label: iso, value: Number(r.v ?? 0) }; });
  },
};

// ── الأجهزة المركّبة — فرعية فقط عبر appendInstalledDeviceScope (فرع فقط). ──
const DEVICE_STATUS_LABELS: Record<string, string> = {
  registered: 'مُسجّل', pending_delivery: 'بانتظار التسليم', delivered: 'مُسلّم', installed: 'مُركّب',
  active: 'فعّال', faulty: 'متعطّل', in_workshop: 'في الورشة', ready: 'جاهز',
  out_of_service: 'خارج الخدمة', retrieved: 'مُسترجَع', contract_cancelled: 'مُلغى (عقد)',
};
const DEVICE_SOURCE_LABELS: Record<string, string> = { company_contract: 'شركة (عقد)', external: 'خارجي' };

const devicesByStatus: BreakdownDefinition = {
  key: 'devices.by_status',
  permission: 'installed_devices.view',
  titleAr: 'الأجهزة حسب الحالة',
  kind: 'donut',
  valueUnit: 'count',
  purpose: 'قرار: توزيع الأجهزة على حالاتها التشغيلية (لقطة راهنة ضمن النطاق).',
  async compute(ctx) {
    const params: unknown[] = [];
    const sql =
      `SELECT d.status AS k, COUNT(*)::int AS v FROM installed_devices d WHERE 1=1` + appendInstalledDeviceScope(ctx, params) +
      ` GROUP BY 1 ORDER BY v DESC`;
    const { rows } = await pool.query(sql, params);
    return rows.map(r => { const k = String(r.k); return { key: k, label: DEVICE_STATUS_LABELS[k] ?? k, value: Number(r.v ?? 0) }; });
  },
};

const devicesBySource: BreakdownDefinition = {
  key: 'devices.by_source',
  permission: 'installed_devices.view',
  titleAr: 'الأجهزة حسب المصدر',
  kind: 'donut',
  valueUnit: 'count',
  purpose: 'قرار: نسبة أجهزة الشركة (عقد) مقابل الخارجية (لقطة راهنة).',
  async compute(ctx) {
    const params: unknown[] = [];
    const sql =
      `SELECT COALESCE(NULLIF(TRIM(d.device_source), ''), 'غير محدد') AS k, COUNT(*)::int AS v FROM installed_devices d WHERE 1=1` + appendInstalledDeviceScope(ctx, params) +
      ` GROUP BY 1 ORDER BY v DESC`;
    const { rows } = await pool.query(sql, params);
    return rows.map(r => { const k = String(r.k); return { key: k, label: DEVICE_SOURCE_LABELS[k] ?? k, value: Number(r.v ?? 0) }; });
  },
};

const devicesByModel: BreakdownDefinition = {
  key: 'devices.by_model',
  permission: 'installed_devices.view',
  titleAr: 'الأجهزة حسب الموديل',
  kind: 'ranked-bar',
  valueUnit: 'count',
  purpose: 'قرار: أكثر الموديلات انتشارًا في القاعدة المركّبة (توجيه المخزون والقطع).',
  async compute(ctx) {
    const params: unknown[] = [];
    const sql =
      `SELECT COALESCE(NULLIF(TRIM(COALESCE(d.device_model_name, c.device_model_name, d.external_device_name)), ''), 'غير محدد') AS k, COUNT(*)::int AS v
         FROM installed_devices d LEFT JOIN contracts c ON c.id = d.contract_id WHERE 1=1` + appendInstalledDeviceScope(ctx, params) +
      ` GROUP BY 1 ORDER BY v DESC LIMIT 10`;
    const { rows } = await pool.query(sql, params);
    return rows.map(r => ({ key: String(r.k), label: String(r.k), value: Number(r.v ?? 0) }));
  },
};

const devicesByBranch: BreakdownDefinition = {
  key: 'devices.by_branch',
  permission: 'installed_devices.view',
  titleAr: 'الأجهزة حسب الفرع',
  kind: 'ranked-bar',
  valueUnit: 'count',
  purpose: 'قرار: توزيع القاعدة المركّبة على الفروع.',
  async compute(ctx) {
    const params: unknown[] = [];
    const sql =
      `SELECT COALESCE(b.name, 'غير محدد') AS k, COUNT(*)::int AS v
         FROM installed_devices d LEFT JOIN branches b ON b.id = d.branch_id WHERE 1=1` + appendInstalledDeviceScope(ctx, params) +
      ` GROUP BY 1 ORDER BY v DESC LIMIT 10`;
    const { rows } = await pool.query(sql, params);
    return rows.map(r => ({ key: String(r.k), label: String(r.k), value: Number(r.v ?? 0) }));
  },
};

const devicesInstallationTrend: BreakdownDefinition = {
  key: 'devices.installation_trend',
  permission: 'installed_devices.view',
  titleAr: 'اتجاه التركيب',
  kind: 'timeline',
  valueUnit: 'count',
  purpose: 'قرار: حركة تركيب الأجهزة عبر الزمن ضمن الفترة والنطاق.',
  async compute(ctx) {
    const bucket = acquisitionBucket(ctx.from, ctx.to);
    const params: unknown[] = [ctx.from, ctx.to];
    const sql =
      `WITH buckets AS (
         SELECT generate_series(
           date_trunc('${bucket.trunc}', $1::timestamptz),
           date_trunc('${bucket.trunc}', $2::timestamptz - interval '1 millisecond'),
           interval '${bucket.interval}'
         ) AS bucket
       ), counts AS (
         SELECT date_trunc('${bucket.trunc}', d.installation_date::timestamptz) AS bucket, COUNT(*)::int AS v
           FROM installed_devices d
          WHERE d.installation_date >= $1::date AND d.installation_date < $2::date` + appendInstalledDeviceScope(ctx, params) +
      ` GROUP BY 1
       )
       SELECT b.bucket, COALESCE(cnt.v, 0)::int AS v
         FROM buckets b LEFT JOIN counts cnt ON cnt.bucket = b.bucket
        ORDER BY b.bucket`;
    const { rows } = await pool.query(sql, params);
    return rows.map(r => { const iso = new Date(r.bucket).toISOString(); return { key: iso, label: iso, value: Number(r.v ?? 0) }; });
  },
};

export const BREAKDOWN_CATALOG: BreakdownDefinition[] = [
  candidatesStageFunnel,
  referralSheetsTeamQuality,
  candidatesOwnershipBreakdown,
  candidatesReferralTypeDistribution,
  candidatesAcquisitionByChannel,
  candidatesQualifiedOutcome,
  clientsAcquisitionTrend,
  clientsClassificationDistribution,
  clientsAcquisitionByChannel,
  clientsDataQualityDistribution,
  clientsWaterSourceDistribution,
  clientsOwnershipBreakdown,
  clientsReferrerTypeDistribution,
  clientsTopGeoAreas,
  clientsByRoute,
  clientsTopReferrers,
  candidatesByRoute,
  candidatesByGeoArea,
  contractsSalesByBranch,
  contractsSalesBySeller,
  contractsSalesBySaleType,
  contractsByPaymentType,
  contractsByDeviceModel,
  contractsCancelledByReason,
  contractsSalesTrend,
  devicesByStatus,
  devicesBySource,
  devicesByModel,
  devicesByBranch,
  devicesInstallationTrend,
];

export function findBreakdown(key: string): BreakdownDefinition | undefined {
  return BREAKDOWN_CATALOG.find(b => b.key === key);
}
