import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Clock, LayoutGrid } from 'lucide-react';
import { api } from '../lib/api';
import { usePermissions } from '../hooks/usePermissions';
import { useAuthStore } from '../hooks/useAuthStore';
import PageHeader from '../components/ui/PageHeader';
import ScopeFilterBar, { type BranchOption } from '../components/dashboard/ScopeFilterBar';
import MetricWidget from '../components/dashboard/MetricWidget';
import { WIDGET_REGISTRY, type ScopeState } from '../components/dashboard/widgetRegistry';

const container = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.06 } } };
const item = { hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0 } };

export default function Dashboard() {
  const { hasPermission } = usePermissions();
  const isSuperAdmin = useAuthStore(s => s.user?.isSuperAdmin === true);
  const getPermissionScope = useAuthStore(s => s.getPermissionScope);

  const [scope, setScope] = useState<ScopeState>({ preset: 'month', branchId: null });
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [recentClients, setRecentClients] = useState<any[]>([]);

  // §8.1 — الكتالوج يُفلتر ببوابة الرؤية: لا يرى المستخدم إلا widgets يملك صلاحية مصدرها.
  const visibleWidgets = useMemo(
    () => WIDGET_REGISTRY.filter(w => hasPermission(w.permission)),
    [hasPermission],
  );

  // منتقي الفرع يظهر فقط لمن يملك اتساع GLOBAL على أحد المؤشرات المعروضة.
  const canPickBranch = useMemo(
    () => isSuperAdmin || visibleWidgets.some(w => getPermissionScope(w.permission) === 'GLOBAL'),
    [isSuperAdmin, visibleWidgets, getPermissionScope],
  );

  useEffect(() => {
    api.dashboard.get().then(d => setRecentClients(d?.recentClients ?? [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (!canPickBranch) return;
    api.branches.list()
      .then(rows => setBranches((rows ?? []).map((b: any) => ({ id: b.id, name: b.name }))))
      .catch(() => {});
  }, [canPickBranch]);

  return (
    <div className="h-full overflow-y-auto p-8 custom-scroll">
      <PageHeader className="mb-6" title="نظرة عامة" subtitle="مؤشرات الأداء على مستوى النطاق والفترة المختارة." />

      <ScopeFilterBar value={scope} onChange={setScope} canPickBranch={canPickBranch} branches={branches} />

      {visibleWidgets.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-slate-400 flex flex-col items-center gap-3">
          <LayoutGrid className="w-8 h-8 text-slate-300" />
          <p className="text-sm">لا توجد مؤشرات متاحة لصلاحياتك بعد.</p>
        </div>
      ) : (
        <motion.div
          key={`${scope.preset}-${scope.branchId ?? 'all'}`}
          variants={container}
          initial="hidden"
          animate="show"
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 mb-8"
        >
          {visibleWidgets.map(def => (
            <motion.div key={def.key} variants={item}>
              <MetricWidget def={def} scope={scope} />
            </motion.div>
          ))}
        </motion.div>
      )}

      {/* آخر الزبائن المسجلين */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25 }}
        className="bg-white shadow-sm border border-slate-200 rounded-xl overflow-hidden lg:max-w-2xl"
      >
        <div className="p-4 border-b border-slate-100 flex items-center gap-2 bg-slate-50/50">
          <Clock className="w-4 h-4 text-sky-500" />
          <h3 className="text-slate-800 font-bold text-base">آخر الزبائن المسجلين</h3>
        </div>
        <div className="p-4">
          {recentClients.length === 0 ? (
            <p className="text-center text-slate-400 py-6 text-sm">لا توجد بيانات بعد</p>
          ) : (
            <div className="space-y-3">
              {recentClients.map((c: any) => (
                <div key={c.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-sky-50 transition-colors">
                  <img
                    src={`https://ui-avatars.com/api/?name=${encodeURIComponent(c?.name || '')}&background=0ea5e9&color=fff&size=32`}
                    alt=""
                    className="w-9 h-9 rounded-full border border-slate-100"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-slate-800 font-semibold truncate">{c?.name || 'بدون اسم'}</p>
                    <p className="text-xs text-slate-500">{c?.mobile || '--'}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
