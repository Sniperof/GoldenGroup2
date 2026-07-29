import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { BarChart3, ClipboardList, LayoutDashboard, LayoutGrid, Sparkles, UsersRound, FileText } from '../components/ui/icons';
import { useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { usePermissions } from '../hooks/usePermissions';
import { useAuthStore } from '../hooks/useAuthStore';
import ScopeFilterBar, { type BranchOption } from '../components/dashboard/ScopeFilterBar';
import MetricWidget from '../components/dashboard/MetricWidget';
import BreakdownWidget from '../components/dashboard/BreakdownWidget';
import { WIDGET_REGISTRY, type ScopeState, type WidgetDef } from '../components/dashboard/widgetRegistry';

const container = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.06 } } };
const item = { hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0 } };

type DashboardSection = 'summary' | 'clients' | 'candidates' | 'name-lists' | 'contracts';

const SECTION_META: Record<DashboardSection, {
  label: string;
  title: string;
  description: string;
  icon: typeof BarChart3;
}> = {
  summary: {
    label: 'الملخص',
    title: 'ملخص الأداء',
    description: 'أهم المؤشرات المشتركة خلال الفترة المختارة',
    icon: LayoutDashboard,
  },
  clients: {
    label: 'الزبائن',
    title: 'تحليلات الزبائن',
    description: 'نمو المحفظة، دورة الحياة، جودة البيانات ومصادر الاكتساب',
    icon: BarChart3,
  },
  candidates: {
    label: 'الأسماء المقترحة',
    title: 'تحليلات الأسماء المقترحة',
    description: 'جودة القمع، توزيع المسؤوليات ومصادر الترشيح',
    icon: UsersRound,
  },
  'name-lists': {
    label: 'لوائح الأسماء',
    title: 'أداء لوائح الأسماء',
    description: 'قراءة جودة اللوائح والتحويل حسب الفريق',
    icon: ClipboardList,
  },
  contracts: {
    label: 'العقود',
    title: 'تحليلات العقود والمبيعات',
    description: 'قيمة المبيعات، نوع البيع، أداء البائعين ومعدّل الإلغاء',
    icon: FileText,
  },
};

function isNameListWidget(widget: WidgetDef): boolean {
  return widget.key.startsWith('referral_sheets.');
}

function widgetsForSection(section: DashboardSection, widgets: WidgetDef[]): WidgetDef[] {
  // الملخص يجمع كل بطاقات KPI القانونية فقط؛ الرسوم التفصيلية تبقى داخل أقسامها.
  if (section === 'summary') return widgets.filter(widget => !widget.kind || widget.kind === 'kpi');
  if (section === 'clients') return widgets.filter(widget => widget.department === 'الزبائن');
  if (section === 'name-lists') return widgets.filter(isNameListWidget);
  if (section === 'contracts') return widgets.filter(widget => widget.department === 'العقود');
  return widgets.filter(widget => widget.department === 'الأسماء المقترحة' && !isNameListWidget(widget));
}

function SectionHeading({ icon: Icon, title, description }: {
  icon: typeof BarChart3;
  title: string;
  description: string;
}) {
  return (
    <div className="mb-4 flex items-center gap-3">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-sky-100 bg-sky-50 text-sky-600">
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <h2 className="text-base font-black text-slate-800">{title}</h2>
        <p className="mt-0.5 text-xs text-slate-500">{description}</p>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { hasPermission } = usePermissions();
  const isSuperAdmin = useAuthStore(s => s.user?.isSuperAdmin === true);
  const getPermissionScope = useAuthStore(s => s.getPermissionScope);
  const [searchParams, setSearchParams] = useSearchParams();
  const [scope, setScope] = useState<ScopeState>({ preset: 'month', branchId: null });
  const [branches, setBranches] = useState<BranchOption[]>([]);

  // §8.1 — لا يدخل أي مؤشر إلى الواجهة قبل اجتياز بوابة صلاحية مصدره.
  const visibleWidgets = useMemo(
    () => WIDGET_REGISTRY.filter(widget => hasPermission(widget.permission)),
    [hasPermission],
  );

  const availableSections = useMemo(() => {
    const sections: DashboardSection[] = [];
    if (widgetsForSection('summary', visibleWidgets).length > 0) sections.push('summary');
    if (widgetsForSection('clients', visibleWidgets).length > 0) sections.push('clients');
    if (widgetsForSection('candidates', visibleWidgets).length > 0) sections.push('candidates');
    if (widgetsForSection('name-lists', visibleWidgets).length > 0) sections.push('name-lists');
    if (widgetsForSection('contracts', visibleWidgets).length > 0) sections.push('contracts');
    return sections;
  }, [visibleWidgets]);

  const requestedSection = searchParams.get('section') as DashboardSection | null;
  const activeSection = requestedSection && availableSections.includes(requestedSection)
    ? requestedSection
    : (availableSections[0] ?? 'summary');
  const activeWidgets = useMemo(
    () => widgetsForSection(activeSection, visibleWidgets),
    [activeSection, visibleWidgets],
  );
  const kpiWidgets = useMemo(
    () => activeWidgets.filter(widget => !widget.kind || widget.kind === 'kpi'),
    [activeWidgets],
  );
  const chartWidgets = useMemo(
    () => activeWidgets.filter(widget => widget.kind && widget.kind !== 'kpi'),
    [activeWidgets],
  );
  const sectionMeta = SECTION_META[activeSection];

  // الفلتر عام للقسم المفتوح، ولا يظهر إذا كانت صلاحيات مؤشرات القسم ذات نطاقات مختلطة.
  const canPickBranch = useMemo(
    () => isSuperAdmin || (activeWidgets.length > 0 && activeWidgets.every(widget => getPermissionScope(widget.permission) === 'GLOBAL')),
    [isSuperAdmin, activeWidgets, getPermissionScope],
  );

  useEffect(() => {
    if (requestedSection === activeSection || availableSections.length === 0) return;
    const next = new URLSearchParams(searchParams);
    next.set('section', activeSection);
    setSearchParams(next, { replace: true });
  }, [activeSection, availableSections.length, requestedSection, searchParams, setSearchParams]);

  useEffect(() => {
    if (!canPickBranch && scope.branchId != null) {
      setScope(current => ({ ...current, branchId: null }));
    }
  }, [canPickBranch, scope.branchId]);

  useEffect(() => {
    if (!canPickBranch) return;
    api.branches.list()
      .then(rows => setBranches((rows ?? []).map((branch: any) => ({ id: branch.id, name: branch.name }))))
      .catch(() => setBranches([]));
  }, [canPickBranch]);

  const selectSection = (section: DashboardSection) => {
    const next = new URLSearchParams(searchParams);
    next.set('section', section);
    setSearchParams(next);
  };

  return (
    <div className="custom-scroll h-full overflow-y-auto bg-slate-50/70">
      <div className="mx-auto w-full max-w-[1600px] p-4 sm:p-6 lg:p-8">
        <section className="relative mb-6 overflow-hidden rounded-3xl border border-sky-100 bg-gradient-to-l from-sky-700 via-sky-600 to-indigo-600 px-6 py-7 text-white shadow-lg shadow-sky-900/10 sm:px-8">
          <div className="absolute -left-16 -top-20 h-56 w-56 rounded-full bg-white/10 blur-2xl" />
          <div className="absolute -bottom-28 right-1/3 h-52 w-52 rounded-full bg-cyan-300/15 blur-3xl" />
          <div className="relative flex flex-col justify-between gap-5 md:flex-row md:items-end">
            <div>
              <div className="mb-3 flex w-fit items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-bold text-sky-50 backdrop-blur-sm">
                <Sparkles className="h-3.5 w-3.5" />
                مركز المؤشرات
              </div>
              <h1 className="text-2xl font-black tracking-tight sm:text-3xl">نظرة عامة</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-sky-100">
                اختر القسم المطلوب لتحميل مؤشراته فقط، مع تطبيق الفترة والنطاق المصرّح لك به.
              </p>
            </div>
            <div className="flex items-center gap-3 rounded-2xl border border-white/15 bg-white/10 px-4 py-3 backdrop-blur-sm">
              <sectionMeta.icon className="h-5 w-5 text-cyan-200" />
              <div>
                <p className="text-[11px] text-sky-100">القسم الحالي</p>
                <p className="text-sm font-black">{sectionMeta.label}</p>
              </div>
            </div>
          </div>
        </section>

        <ScopeFilterBar value={scope} onChange={setScope} canPickBranch={canPickBranch} branches={branches} />

        {availableSections.length > 0 && (
          <nav className="mb-7 mt-4 overflow-x-auto rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm" aria-label="أقسام الداشبورد">
            <div className="flex min-w-max gap-1">
              {availableSections.map(section => {
                const meta = SECTION_META[section];
                const Icon = meta.icon;
                const active = section === activeSection;
                return (
                  <button
                    key={section}
                    type="button"
                    onClick={() => selectSection(section)}
                    aria-current={active ? 'page' : undefined}
                    className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-black transition-colors sm:text-sm ${
                      active ? 'bg-sky-600 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-50 hover:text-sky-700'
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    {meta.label}
                  </button>
                );
              })}
            </div>
          </nav>
        )}

        {visibleWidgets.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-slate-200 bg-white p-12 text-center text-slate-400 shadow-sm">
            <LayoutGrid className="h-9 w-9 text-slate-300" />
            <p className="text-sm font-bold">لا توجد مؤشرات متاحة لصلاحياتك بعد.</p>
          </div>
        ) : (
          <motion.section
            key={`${activeSection}-${scope.preset}-${scope.branchId ?? 'all'}`}
            variants={container}
            initial="hidden"
            animate="show"
          >
            <SectionHeading icon={sectionMeta.icon} title={sectionMeta.title} description={sectionMeta.description} />

            {kpiWidgets.length > 0 && (
              <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {kpiWidgets.map(def => (
                  <motion.div key={def.key} variants={item}><MetricWidget def={def} scope={scope} /></motion.div>
                ))}
              </div>
            )}

            {chartWidgets.length > 0 && (
              <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
                {chartWidgets.map(def => (
                  <motion.div key={def.key} variants={item} className="h-full">
                    <BreakdownWidget def={def} scope={scope} />
                  </motion.div>
                ))}
              </div>
            )}
          </motion.section>
        )}
      </div>
    </div>
  );
}
