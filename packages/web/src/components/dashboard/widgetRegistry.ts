// ============================================================
// widgetRegistry.ts — كتالوج widgets الداشبورد (reporting-analytics §6.4 / §8.2)
// ============================================================
// كل عنصر = مؤشر من الكتالوج الخلفي. `permission` بوابة الرؤية (§8.1): يُفلتر
// الكتالوج بـ hasPermission فلا يرى المستخدم إلا ما يملك صلاحية مصدره. الخادم
// يفرض النطاق ثانيةً عبر صلاحية المؤشر (دفاع بطبقتين).
// ============================================================

export type TimePreset = 'today' | 'week' | 'month' | 'quarter';

export interface ScopeState {
  preset: TimePreset;
  /** null = كل الفروع (لأصحاب GLOBAL)؛ رقم = فرع محدّد. */
  branchId: number | null;
}

export interface WidgetDef {
  key: string;
  titleAr: string;
  unit: 'count' | 'percent';
  permission: string;
  department: string;
  defaultSize: 'sm' | 'md' | 'lg';
  description: string;
  accent: 'sky' | 'indigo' | 'emerald' | 'amber' | 'rose' | 'violet';
  trendDirection?: 'higher-is-better' | 'lower-is-better' | 'neutral';
  /** 'kpi' (افتراضي) = بطاقة رقم؛ الأنواع الأخرى مؤشرات تجميعية عبر BreakdownWidget. */
  kind?: 'kpi' | 'funnel' | 'ranked-bar' | 'donut' | 'timeline';
}

export const WIDGET_REGISTRY: WidgetDef[] = [
  { key: 'clients.new_count', titleAr: 'زبائن جدد', description: 'حجم الاكتساب خلال الفترة', unit: 'count', permission: 'clients.view_list', department: 'الزبائن', defaultSize: 'sm', accent: 'sky', trendDirection: 'higher-is-better' },
  { key: 'clients.active_total', titleAr: 'إجمالي الزبائن', description: 'الزبائن الفعّالون ضمن النطاق الحالي', unit: 'count', permission: 'clients.view_list', department: 'الزبائن', defaultSize: 'sm', accent: 'indigo', trendDirection: 'neutral' },
  { key: 'clients.unowned_count', titleAr: 'بحاجة إلى إسناد', description: 'سجلات Lead بلا مسؤول فردي', unit: 'count', permission: 'clients.view_list', department: 'الزبائن', defaultSize: 'sm', accent: 'amber', trendDirection: 'lower-is-better' },
  { key: 'candidates.new_count', titleAr: 'مرشّحون جدد', description: 'التغذية الجديدة لمسار المبيعات', unit: 'count', permission: 'candidates.view_list', department: 'الأسماء المقترحة', defaultSize: 'sm', accent: 'indigo', trendDirection: 'higher-is-better' },
  { key: 'candidates.conversion_rate', titleAr: 'معدّل التحويل', description: 'نسبة التحويل الفعلي إلى زبائن', unit: 'percent', permission: 'candidates.view_list', department: 'الأسماء المقترحة', defaultSize: 'sm', accent: 'emerald', trendDirection: 'higher-is-better' },
  { key: 'candidates.qualified_unconverted', titleAr: 'فرص عالقة', description: 'مؤهّلون ينتظرون إتمام التحويل', unit: 'count', permission: 'candidates.view_list', department: 'الأسماء المقترحة', defaultSize: 'sm', accent: 'amber', trendDirection: 'lower-is-better' },
  { key: 'candidates.junk_rate', titleAr: 'نسبة الهدر', description: 'الأسماء المرفوضة من إجمالي الداخلين', unit: 'percent', permission: 'candidates.view_list', department: 'الأسماء المقترحة', defaultSize: 'sm', accent: 'rose', trendDirection: 'lower-is-better' },
  { key: 'clients.committed_ratio', titleAr: 'التزام الزبائن', description: 'جودة قاعدة الزبائن الحالية', unit: 'percent', permission: 'clients.rating.view', department: 'الزبائن', defaultSize: 'sm', accent: 'violet', trendDirection: 'higher-is-better' },
  { key: 'clients.rating_net_change', titleAr: 'صافي تغيّر الالتزام', description: 'صافي دخول الالتزام مقابل خروجه خلال الفترة', unit: 'count', permission: 'clients.rating.view', department: 'الزبائن', defaultSize: 'sm', accent: 'violet', trendDirection: 'higher-is-better' },
  { key: 'clients.acquisition_trend', titleAr: 'تطور اكتساب الزبائن', description: 'حركة تسجيل الزبائن عبر الزمن', unit: 'count', permission: 'clients.view_list', department: 'الزبائن', defaultSize: 'lg', kind: 'timeline', accent: 'sky' },
  { key: 'clients.classification_distribution', titleAr: 'توزيع دورة الحياة', description: 'تركيب قاعدة الزبائن بين Lead وFOP وOP', unit: 'count', permission: 'clients.view_list', department: 'الزبائن', defaultSize: 'lg', kind: 'donut', accent: 'indigo' },
  { key: 'clients.acquisition_by_channel', titleAr: 'الاكتساب حسب القناة', description: 'القنوات الأكثر جلباً للزبائن خلال الفترة', unit: 'count', permission: 'clients.view_list', department: 'الزبائن', defaultSize: 'lg', kind: 'ranked-bar', accent: 'emerald' },
  { key: 'clients.data_quality_distribution', titleAr: 'جودة بيانات الزبائن', description: 'السجلات المكتملة مقابل التي تحتاج استكمالاً', unit: 'count', permission: 'clients.view_list', department: 'الزبائن', defaultSize: 'lg', kind: 'donut', accent: 'amber' },
  { key: 'candidates.stage_funnel', titleAr: 'قمع حالة الأسماء المقترحة', description: 'تدرّج المرشحين بين مراحل المتابعة', unit: 'count', permission: 'candidates.view_list', department: 'الأسماء المقترحة', defaultSize: 'lg', kind: 'funnel', accent: 'indigo' },
  { key: 'candidates.ownership_breakdown', titleAr: 'توزيع ملكية المرشّحين', description: 'عدد الأسماء المملوكة لكل موظف ومعدل تحويلها', unit: 'count', permission: 'candidates.view_list', department: 'الأسماء المقترحة', defaultSize: 'lg', kind: 'ranked-bar', accent: 'sky' },
  { key: 'referral_sheets.team_quality_leaderboard', titleAr: 'جودة الإحالات حسب الفريق', description: 'مقارنة جودة لوائح الأسماء والتحويل', unit: 'percent', permission: 'candidates.name_lists.view_list', department: 'الأسماء المقترحة', defaultSize: 'lg', kind: 'ranked-bar', accent: 'emerald' },
  { key: 'candidates.acquisition_by_channel', titleAr: 'قنوات اكتساب المرشّحين', description: 'القنوات الأكثر تغذية لمسار البيع', unit: 'count', permission: 'candidates.view_list', department: 'الأسماء المقترحة', defaultSize: 'lg', kind: 'donut', accent: 'sky' },
  { key: 'candidates.referral_type_distribution', titleAr: 'أنواع الإحالة', description: 'من قام بترشيح الأسماء', unit: 'count', permission: 'candidates.view_list', department: 'الأسماء المقترحة', defaultSize: 'lg', kind: 'donut', accent: 'violet' },
  { key: 'candidates.qualified_outcome_split', titleAr: 'مخرجات المؤهّلين', description: 'ربط بزبون قائم مقابل تحويل جديد', unit: 'count', permission: 'candidates.view_list', department: 'الأسماء المقترحة', defaultSize: 'lg', kind: 'donut', accent: 'emerald' },
  { key: 'candidates.duplicate_rate', titleAr: 'نسبة التكرار', description: 'الأسماء المكرّرة من إجمالي الداخلين خلال الفترة', unit: 'percent', permission: 'candidates.view_list', department: 'الأسماء المقترحة', defaultSize: 'sm', accent: 'rose', trendDirection: 'lower-is-better' },
  { key: 'referral_sheets.behind_target_count', titleAr: 'أوراق دون الهدف', description: 'لوائح قيد الجمع لم تبلغ عدد الأسماء المستهدف', unit: 'count', permission: 'candidates.name_lists.view_list', department: 'الأسماء المقترحة', defaultSize: 'sm', accent: 'amber', trendDirection: 'lower-is-better' },
  { key: 'candidates.by_route', titleAr: 'كثافة المرشّحين حسب خط السير', description: 'خطوط السير الأعلى إنتاجًا للمرشّحين ومعدل تحويلها', unit: 'count', permission: 'candidates.view_list', department: 'الأسماء المقترحة', defaultSize: 'lg', kind: 'ranked-bar', accent: 'sky' },
  { key: 'candidates.by_geo_area', titleAr: 'أعلى المناطق كثافة مرشّحين', description: 'المناطق الأعلى كثافة بالمرشّحين', unit: 'count', permission: 'candidates.view_list', department: 'الأسماء المقترحة', defaultSize: 'lg', kind: 'ranked-bar', accent: 'emerald' },
  { key: 'clients.water_source_distribution', titleAr: 'مصادر مياه الزبائن', description: 'تركيبة قاعدة الزبائن حسب مصدر المياه', unit: 'count', permission: 'clients.view_list', department: 'الزبائن', defaultSize: 'lg', kind: 'donut', accent: 'sky' },
  // Derived from the clients-table filters (§3.2 #5/#8 · §3.8 #1) — all scope-isolated via clients.view_list.
  { key: 'clients.ownership_breakdown', titleAr: 'توزيع ملكية الزبائن', description: 'عدد الزبائن المسندين لكل موظف', unit: 'count', permission: 'clients.view_list', department: 'الزبائن', defaultSize: 'lg', kind: 'ranked-bar', accent: 'sky', trendDirection: 'neutral' },
  { key: 'clients.acquisition_by_referrer_type', titleAr: 'الاكتساب حسب نوع الوسيط', description: 'مَن يُحضر الزبائن: شخصي/زبون/موظف', unit: 'count', permission: 'clients.view_list', department: 'الزبائن', defaultSize: 'lg', kind: 'donut', accent: 'violet' },
  { key: 'clients.top_geo_areas', titleAr: 'أعلى المناطق كثافة زبائن', description: 'المحافظات الأعلى كثافة ضمن النطاق', unit: 'count', permission: 'clients.view_list', department: 'الزبائن', defaultSize: 'lg', kind: 'ranked-bar', accent: 'emerald' },
  { key: 'clients.by_route', titleAr: 'كثافة الزبائن حسب خط السير', description: 'خطوط السير الأعلى كثافة بالزبائن', unit: 'count', permission: 'clients.view_list', department: 'الزبائن', defaultSize: 'lg', kind: 'ranked-bar', accent: 'emerald' },
  { key: 'clients.top_referrers', titleAr: 'أكثر الوسطاء إحضارًا للزبائن', description: 'ترتيب مَن يُحضر أكثر الزبائن خلال الفترة', unit: 'count', permission: 'clients.view_list', department: 'الزبائن', defaultSize: 'lg', kind: 'ranked-bar', accent: 'amber' },
];

export const TIME_PRESET_OPTIONS: { value: TimePreset; label: string }[] = [
  { value: 'today', label: 'اليوم' },
  { value: 'week', label: 'آخر ٧ أيام' },
  { value: 'month', label: 'هذا الشهر' },
  { value: 'quarter', label: 'هذا الربع' },
];
