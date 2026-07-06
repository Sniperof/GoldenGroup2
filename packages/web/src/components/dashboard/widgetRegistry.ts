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
  /** 'kpi' (افتراضي) = بطاقة رقم؛ 'funnel'/'ranked-bar' = مؤشر تجميعي عبر BreakdownWidget. */
  kind?: 'kpi' | 'funnel' | 'ranked-bar';
}

export const WIDGET_REGISTRY: WidgetDef[] = [
  { key: 'clients.new_count', titleAr: 'زبائن جدد', unit: 'count', permission: 'clients.view_list', department: 'الزبائن', defaultSize: 'sm' },
  { key: 'candidates.new_count', titleAr: 'مرشّحون جدد', unit: 'count', permission: 'candidates.view_list', department: 'الأسماء المقترحة', defaultSize: 'sm' },
  { key: 'candidates.conversion_rate', titleAr: 'معدّل تحويل المرشّحين', unit: 'percent', permission: 'candidates.view_list', department: 'الأسماء المقترحة', defaultSize: 'sm' },
  { key: 'candidates.junk_rate', titleAr: 'نسبة الهدر (Junk)', unit: 'percent', permission: 'candidates.view_list', department: 'الأسماء المقترحة', defaultSize: 'sm' },
  { key: 'candidates.qualified_unconverted', titleAr: 'مؤهّلون لم يُحوّلوا', unit: 'count', permission: 'candidates.view_list', department: 'الأسماء المقترحة', defaultSize: 'sm' },
  { key: 'candidates.stage_funnel', titleAr: 'قمع حالة الأسماء المقترحة', unit: 'count', permission: 'candidates.view_list', department: 'الأسماء المقترحة', defaultSize: 'lg', kind: 'funnel' },
  { key: 'candidates.ownership_breakdown', titleAr: 'المرشّحون المملوكون لكل موظف', unit: 'count', permission: 'candidates.view_list', department: 'الأسماء المقترحة', defaultSize: 'lg', kind: 'ranked-bar' },
  { key: 'referral_sheets.team_quality_leaderboard', titleAr: 'ترتيب الفرق بجودة الإحالة', unit: 'percent', permission: 'candidates.name_lists.view_list', department: 'الأسماء المقترحة', defaultSize: 'lg', kind: 'ranked-bar' },
  { key: 'clients.committed_ratio', titleAr: 'نسبة الزبائن الملتزمين', unit: 'percent', permission: 'clients.rating.view', department: 'الزبائن', defaultSize: 'sm' },
];

export const TIME_PRESET_OPTIONS: { value: TimePreset; label: string }[] = [
  { value: 'today', label: 'اليوم' },
  { value: 'week', label: 'آخر ٧ أيام' },
  { value: 'month', label: 'هذا الشهر' },
  { value: 'quarter', label: 'هذا الربع' },
];
