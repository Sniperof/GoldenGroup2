import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { LayoutDashboard, LayoutGrid, RefreshCw, SlidersHorizontal, Sparkles } from '../components/ui/icons';
import { usePermissions } from '../hooks/usePermissions';
import { useBranchContextStore } from '../hooks/useBranchContextStore';
import ScopeFilterBar from '../components/dashboard/ScopeFilterBar';
import MetricWidget from '../components/dashboard/MetricWidget';
import BreakdownWidget from '../components/dashboard/BreakdownWidget';
import DashboardCustomizer from '../components/dashboard/DashboardCustomizer';
import { WIDGET_REGISTRY, type ScopeState, type WidgetDef, type TimePreset } from '../components/dashboard/widgetRegistry';
import { api, type DashboardWidget } from '../lib/api';

const container = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.06 } } };
const item = { hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0 } };
const MAX_DEFAULT_WIDGETS = 8;
const DEFAULT_WIDGET_PRIORITY = [
  'clients.new_count', 'clients.active_total', 'candidates.new_count', 'candidates.conversion_rate',
  'candidates.qualified_unconverted', 'contracts.count', 'contracts.sales_value', 'devices.active_base',
  'devices.warranty_expiring', 'applications.new_count', 'vacancies.open_count',
];

export function buildDefaultDashboardLayout(availableWidgets: WidgetDef[]): DashboardWidget[] {
  const byKey = new Map(availableWidgets.map(widget => [widget.key, widget]));
  const ordered = [
    ...DEFAULT_WIDGET_PRIORITY.map(key => byKey.get(key)).filter((widget): widget is WidgetDef => Boolean(widget)),
    ...availableWidgets.filter(widget => (!widget.kind || widget.kind === 'kpi') && !DEFAULT_WIDGET_PRIORITY.includes(widget.key)),
  ];
  const unique = ordered.filter((widget, index, all) => all.findIndex(candidate => candidate.key === widget.key) === index);
  return unique.slice(0, MAX_DEFAULT_WIDGETS).map(widget => ({ key: widget.key, size: widget.defaultSize, scope: null }));
}

function sanitizeClientLayout(layout: DashboardWidget[], availableWidgets: WidgetDef[]): DashboardWidget[] {
  const allowed = new Map(availableWidgets.map(widget => [widget.key, widget]));
  const seen = new Set<string>();
  return layout.flatMap(saved => {
    const definition = allowed.get(saved.key);
    if (!definition || seen.has(saved.key)) return [];
    seen.add(saved.key);
    return [{ key: saved.key, size: saved.size === 'sm' || saved.size === 'md' || saved.size === 'lg' ? saved.size : definition.defaultSize, scope: saved.scope ?? null }];
  });
}

export default function Dashboard() {
  const { hasPermission } = usePermissions();
  const [preset, setPreset] = useState<TimePreset>('month');
  const [layout, setLayout] = useState<DashboardWidget[]>([]);
  const [layoutLoading, setLayoutLoading] = useState(true);
  const [layoutError, setLayoutError] = useState<string | null>(null);
  const [customizerOpen, setCustomizerOpen] = useState(false);
  const contextBranchId = useBranchContextStore(state => state.branchId);
  const scope = useMemo<ScopeState>(() => ({ preset, branchId: contextBranchId ?? null }), [preset, contextBranchId]);
  const visibleWidgets = useMemo(() => WIDGET_REGISTRY.filter(widget => hasPermission(widget.permission)), [hasPermission]);
  const visibleSignature = visibleWidgets.map(widget => widget.key).join('|');
  const defaultLayout = useMemo(() => buildDefaultDashboardLayout(visibleWidgets), [visibleSignature]);
  const widgetByKey = useMemo(() => new Map(visibleWidgets.map(widget => [widget.key, widget])), [visibleSignature]);

  const loadLayout = useCallback(async () => {
    setLayoutLoading(true);
    setLayoutError(null);
    try {
      const response = await api.dashboardLayout.get();
      setLayout(response.customized ? sanitizeClientLayout(response.layout, visibleWidgets) : defaultLayout);
    } catch (error) {
      setLayoutError(error instanceof Error ? error.message : 'تعذر تحميل تخطيط لوحة المتابعة');
    } finally {
      setLayoutLoading(false);
    }
  }, [visibleSignature, defaultLayout]);

  useEffect(() => { void loadLayout(); }, [loadLayout]);
  const selectedWidgets = useMemo(() => layout.flatMap(saved => {
    const definition = widgetByKey.get(saved.key);
    return definition ? [{ saved, definition }] : [];
  }), [layout, widgetByKey]);
  const selectedKeys = useMemo(() => layout.map(widget => widget.key), [layout]);
  const defaultKeys = useMemo(() => defaultLayout.map(widget => widget.key), [defaultLayout]);

  const saveLayout = async (keys: string[]) => {
    const current = new Map(layout.map(widget => [widget.key, widget]));
    const next = keys.flatMap(key => {
      const definition = widgetByKey.get(key);
      return definition ? [current.get(key) ?? { key, size: definition.defaultSize, scope: null }] : [];
    });
    const response = await api.dashboardLayout.save(next);
    setLayout(sanitizeClientLayout(response.layout, visibleWidgets));
  };

  return (
    <div className="custom-scroll h-full overflow-y-auto bg-slate-50/70">
      <div className="mx-auto w-full max-w-[1600px] p-4 sm:p-6 lg:p-8">
        <section className="relative mb-6 overflow-hidden rounded-3xl border border-sky-100 bg-gradient-to-l from-sky-700 via-sky-600 to-indigo-600 px-6 py-7 text-white shadow-lg shadow-sky-900/10 sm:px-8">
          <div className="absolute -left-16 -top-20 h-56 w-56 rounded-full bg-white/10 blur-2xl" />
          <div className="absolute -bottom-28 right-1/3 h-52 w-52 rounded-full bg-cyan-300/15 blur-3xl" />
          <div className="relative flex flex-col justify-between gap-5 md:flex-row md:items-end">
            <div>
              <div className="mb-3 flex w-fit items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-bold text-sky-50 backdrop-blur-sm"><Sparkles className="h-3.5 w-3.5" /> لوحتي</div>
              <h1 className="text-2xl font-black tracking-tight sm:text-3xl">لوحة المتابعة</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-sky-100">اختر المؤشرات والمخططات التي تحتاجها في عملك، ورتّبها مرة واحدة لتظهر لك بهذا الشكل دائماً.</p>
            </div>
            {visibleWidgets.length > 0 && <button type="button" onClick={() => setCustomizerOpen(true)} className="flex items-center justify-center gap-2 rounded-xl border border-white/25 bg-white/15 px-4 py-3 text-sm font-black text-white backdrop-blur-sm transition hover:bg-white/25"><SlidersHorizontal className="h-4 w-4" /> تخصيص اللوحة <span className="rounded-full bg-white/15 px-2 py-0.5 text-[11px]">{layout.length}</span></button>}
          </div>
        </section>
        <ScopeFilterBar preset={preset} onPresetChange={setPreset} />

        {layoutLoading ? (
          <div className="mt-5 flex min-h-48 items-center justify-center rounded-2xl border border-slate-200 bg-white text-sm font-bold text-slate-500 shadow-sm"><RefreshCw className="ml-2 h-4 w-4 animate-spin text-sky-600" /> جارٍ تحميل لوحتك…</div>
        ) : layoutError ? (
          <div className="mt-5 flex min-h-48 flex-col items-center justify-center gap-3 rounded-2xl border border-rose-200 bg-white p-8 text-center shadow-sm"><p className="text-sm font-bold text-rose-700">{layoutError}</p><button type="button" onClick={() => void loadLayout()} className="flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-bold text-white"><RefreshCw className="h-4 w-4" /> إعادة المحاولة</button></div>
        ) : visibleWidgets.length === 0 ? (
          <div className="mt-5 flex flex-col items-center gap-3 rounded-2xl border border-slate-200 bg-white p-12 text-center text-slate-400 shadow-sm"><LayoutGrid className="h-9 w-9 text-slate-300" /><p className="text-sm font-bold">لا توجد مؤشرات متاحة لصلاحياتك حالياً.</p></div>
        ) : selectedWidgets.length === 0 ? (
          <div className="mt-5 flex flex-col items-center gap-4 rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center shadow-sm"><span className="rounded-2xl bg-sky-50 p-3 text-sky-600"><LayoutDashboard className="h-7 w-7" /></span><div><h2 className="font-black text-slate-800">لوحتك فارغة</h2><p className="mt-1 text-sm text-slate-500">أضف المؤشرات والمخططات التي تهمك لتبدأ المتابعة.</p></div><button type="button" onClick={() => setCustomizerOpen(true)} className="flex items-center gap-2 rounded-lg bg-sky-600 px-5 py-2.5 text-sm font-bold text-white"><SlidersHorizontal className="h-4 w-4" /> اختيار العناصر</button></div>
        ) : (
          <motion.section key={`${scope.preset}-${scope.branchId ?? 'all'}`} variants={container} initial="hidden" animate="show" className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {selectedWidgets.map(({ saved, definition }) => {
              const widgetScope = { ...scope, branchId: saved.scope?.branchId ?? scope.branchId };
              const isChart = Boolean(definition.kind && definition.kind !== 'kpi');
              const span = isChart || saved.size === 'lg' || saved.size === 'md' ? 'sm:col-span-2 xl:col-span-2' : '';
              return <motion.div key={definition.key} variants={item} className={`min-w-0 ${span}`}>{isChart ? <BreakdownWidget def={definition} scope={widgetScope} /> : <MetricWidget def={definition} scope={widgetScope} />}</motion.div>;
            })}
          </motion.section>
        )}
      </div>
      <DashboardCustomizer open={customizerOpen} availableWidgets={visibleWidgets} selectedKeys={selectedKeys} defaultKeys={defaultKeys} onClose={() => setCustomizerOpen(false)} onSave={saveLayout} />
    </div>
  );
}
