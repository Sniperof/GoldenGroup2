import { useState, useCallback, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Navigate } from 'react-router-dom';
import {
    Plus, Eye, Trash2, X, ArrowUp, ArrowDown,
    Route as RouteIcon, ChevronRight,
} from 'lucide-react';
import { api } from '../lib/api';
import { levelNames } from '../lib/geoConstants';
import SmartTable, { type ColumnDef } from '../components/SmartTable';
import PageHeader from '../components/ui/PageHeader';
import type { Route, GeoUnit, RoutePoint } from '../lib/types';
import { usePermissions } from '../hooks/usePermissions';
import { useAuthStore } from '../hooks/useAuthStore';
import { useBranchContextStore } from '../hooks/useBranchContextStore';
import BranchScopeIndicator from '../components/BranchScopeIndicator';
import IconButton from '../components/ui/IconButton';

/* ------------------------------------------------------------------ */
/*  Constants                                                           */
/* ------------------------------------------------------------------ */

const levelColors: Record<number, { bg: string; text: string; border: string }> = {
    1: { bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200' },
    2: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200' },
    3: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200' },
    4: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' },
};

/* ------------------------------------------------------------------ */
/*  Main Component                                                      */
/* ------------------------------------------------------------------ */

export default function RouteManager() {
    const { hasPermission } = usePermissions();
    const canManageGeo = hasPermission('routes.manage');
    const getPermissionScope = useAuthStore(s => s.getPermissionScope);
    // The unified external filter (§4) — its value drives the server-side narrowing
    // now (X-Branch-Id), replacing the old in-page branch dropdown.
    const branchContextId = useBranchContextStore(s => s.branchId);
    // Add gate (§5): a GLOBAL manager on "all branches" has no branch to own the new
    // route, so creation is blocked until a branch is picked (mirrors the server's
    // SH-3 reject). A BRANCH manager is pinned, so never blocked.
    const mustPickBranch = getPermissionScope('routes.manage') === 'GLOBAL' && branchContextId == null;

    const [routes, setRoutes] = useState<Route[]>([]);
    // Scoped geo list for the builder PICKER (form pick = operation's branch coverage, §5.1).
    const [geoUnits, setGeoUnits] = useState<GeoUnit[]>([]);
    // Global name map for DISPLAY labels — every unit, no scope, so a visible route's
    // stations always render (§3). Distinct from the scoped picker list above.
    const [geoNames, setGeoNames] = useState<Map<number, string>>(new Map());

    const [loading, setLoading] = useState(true);
    const [showBuilder, setShowBuilder] = useState(false);
    const [editRoute, setEditRoute] = useState<Route | null>(null);

    const [builderName, setBuilderName] = useState('');
    const [builderPoints, setBuilderPoints] = useState<RoutePoint[]>([]);
    const [treeSel, setTreeSel] = useState<(number | null)[]>([null, null, null, null]);

    if (!hasPermission('routes.view')) return <Navigate to="/" replace />;

    const fetchData = useCallback(async () => {
        try {
            const [routesData, geoUnitsData, geoNamesData] = await Promise.all([
                api.routes.list(),
                api.geoUnits.list(),
                api.geoUnits.names(),
            ]);
            setRoutes(routesData);
            setGeoUnits(geoUnitsData);
            setGeoNames(new Map(geoNamesData.map((u: any) => [u.id, u.name])));
        } catch (e) {
            console.error('Failed to fetch data', e);
        } finally {
            setLoading(false);
        }
    }, []);

    // Re-fetch when the external branch filter changes (server narrows via X-Branch-Id).
    useEffect(() => { fetchData(); }, [fetchData, branchContextId]);

    const getChildren = useCallback((level: number, parentId: number | null) => {
        return geoUnits.filter(u => u.level === level && u.parentId === parentId);
    }, [geoUnits]);

    const getUnitName = useCallback((id: number) =>
        geoNames.get(id) || '??', [geoNames]);

    const openBuilder = (route?: Route) => {
        if (route) {
            setEditRoute(route);
            setBuilderName(route.name);
            setBuilderPoints([...route.points]);
        } else {
            setEditRoute(null);
            setBuilderName('');
            setBuilderPoints([]);
        }
        setTreeSel([null, null, null, null]);
        setShowBuilder(true);
    };

    const addableUnit = useMemo(() => {
        for (let lvl = 3; lvl >= 0; lvl--) {
            const selId = treeSel[lvl];
            if (selId !== null) {
                if (lvl + 2 > 4) return { id: selId, level: lvl + 1 };
                const children = getChildren(lvl + 2, selId);
                if (children.length === 0) return { id: selId, level: lvl + 1 };
                return null;
            }
        }
        return null;
    }, [treeSel, getChildren]);

    const handleTreeSelect = (level: number, id: number) => {
        const next = [...treeSel];
        next[level - 1] = id;
        for (let i = level; i < 4; i++) next[i] = null;
        setTreeSel(next);
    };

    const addPoint = () => {
        if (!addableUnit) return;
        if (builderPoints.some(p => p.geoUnitId === addableUnit.id)) return;
        setBuilderPoints([...builderPoints, {
            geoUnitId: addableUnit.id,
            level: addableUnit.level,
            order: builderPoints.length + 1,
        }]);
        setTreeSel([null, null, null, null]);
    };

    const removePoint = (idx: number) =>
        setBuilderPoints(builderPoints.filter((_, i) => i !== idx).map((p, i) => ({ ...p, order: i + 1 })));

    const movePoint = (idx: number, dir: -1 | 1) => {
        const next = [...builderPoints];
        const swap = idx + dir;
        if (swap < 0 || swap >= next.length) return;
        [next[idx], next[swap]] = [next[swap], next[idx]];
        setBuilderPoints(next.map((p, i) => ({ ...p, order: i + 1 })));
    };

    const saveRoute = async () => {
        if (!canManageGeo) return;
        if (!builderName.trim() || builderPoints.length === 0) {
            alert('أدخل اسم المسار وأضف محطة واحدة على الأقل');
            return;
        }
        try {
            if (editRoute) {
                await api.routes.update(editRoute.id, { name: builderName, points: builderPoints, status: editRoute.status });
            } else {
                await api.routes.create({ name: builderName, points: builderPoints, status: 'active' });
            }
            await fetchData();
            setShowBuilder(false);
        } catch (e) {
            console.error('Failed to save route', e);
        }
    };

    const deleteRoute = async (id: number) => {
        if (!canManageGeo) return;
        if (!confirm('حذف هذا المسار؟')) return;
        try { await api.routes.delete(id); await fetchData(); }
        catch (e) { console.error('Failed to delete route', e); }
    };

    const columns: ColumnDef<Route>[] = [
        {
            key: 'name',
            label: 'اسم المسار',
            sortable: true,
            minWidth: '200px',
            getValue: (r) => r.name,
            render: (r) => (
                <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-sky-50 flex items-center justify-center text-sky-600">
                        <RouteIcon className="w-4 h-4" />
                    </div>
                    <span className="text-slate-900 font-medium text-sm">{r.name}</span>
                </div>
            ),
        },
        {
            key: 'branchLabel',
            label: 'الفرع التابع',
            sortable: true,
            getValue: (r) => r.branchLabel ?? '',
            render: (r) =>
                r.branchLabel ? (
                    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700 border border-indigo-200">{r.branchLabel}</span>
                ) : (
                    <span className="text-xs text-slate-400">—</span>
                ),
        },
        {
            key: 'pointsCount',
            label: 'عدد المحطات',
            sortable: true,
            width: 'w-28',
            getValue: (r) => r.points.length,
            render: (r) => <span className="text-sm text-slate-700">{r.points.length}</span>,
        },
        {
            key: 'stations',
            label: 'المحطات',
            minWidth: '260px',
            render: (r) => (
                <div className="flex flex-wrap gap-1">
                    {[...r.points].sort((a, b) => a.order - b.order).slice(0, 4).map((p) => {
                        const colors = levelColors[p.level] || levelColors[4];
                        return (
                            <span key={p.geoUnitId} className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs ${colors.bg} ${colors.text} border ${colors.border}`}>
                                {getUnitName(p.geoUnitId)}
                                <span className="opacity-60 text-xs">{levelNames[p.level]}</span>
                            </span>
                        );
                    })}
                    {r.points.length > 4 && (
                        <span className="px-2 py-0.5 rounded-full bg-slate-100 text-xs text-slate-500">+{r.points.length - 4}</span>
                    )}
                </div>
            ),
        },
    ];

    if (loading) {
        return (
            <div className="h-full flex items-center justify-center">
                <div className="text-slate-500 text-sm">جاري التحميل...</div>
            </div>
        );
    }

    return (
        <div className="h-full overflow-y-auto p-8 custom-scroll relative" dir="rtl">

            {/* ── Page header ── */}
            <div className="flex items-end justify-between mb-6">
                <PageHeader
                    title="إدارة خطوط السير"
                    subtitle="عرض وإدارة مسارات التوزيع والصيانة."
                />
                <button
                    onClick={() => openBuilder()}
                    disabled={!canManageGeo || mustPickBranch}
                    title={mustPickBranch ? 'اختر فرعاً أولاً لإنشاء مسار' : undefined}
                    className="flex items-center gap-2 bg-sky-600 hover:bg-sky-500 text-white px-4 py-2.5 rounded-lg text-sm font-bold shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    <Plus className="w-4 h-4" />
                    <span>{mustPickBranch ? 'اختر فرعاً لإنشاء مسار' : 'مسار جديد'}</span>
                </button>
            </div>

            {/* ── Routes table ── */}
            <SmartTable
                title="المسارات"
                icon={RouteIcon}
                data={routes}
                columns={columns}
                getId={(r) => r.id}
                searchKeys={['name']}
                searchPlaceholder="بحث عن مسار..."
                scopeIndicator={<BranchScopeIndicator />}
                emptyIcon={RouteIcon}
                emptyMessage="لا توجد مسارات"
                tableMinWidth={900}
                defaultSortKey="name"
                defaultSortDir="asc"
                actions={(r) => (
                    <div className="flex items-center gap-2">
                        <button onClick={(e) => { e.stopPropagation(); openBuilder(r); }} disabled={!canManageGeo} className="p-1.5 rounded-lg hover:bg-sky-50 text-slate-400 hover:text-sky-600 transition-all disabled:opacity-50">
                            <Eye className="w-4 h-4" />
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); deleteRoute(r.id); }} disabled={!canManageGeo} className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500 transition-all disabled:opacity-50">
                            <Trash2 className="w-4 h-4" />
                        </button>
                    </div>
                )}
            />

            {/* ── Route Builder Slide-in ── */}
            <AnimatePresence>
                {showBuilder && canManageGeo && (
                    <>
                        <motion.div
                            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                            className="fixed inset-0 bg-black/30 backdrop-blur-sm z-40"
                            onClick={() => setShowBuilder(false)}
                        />
                        <motion.div
                            initial={{ x: '-100%' }} animate={{ x: 0 }} exit={{ x: '-100%' }}
                            transition={{ type: 'spring', damping: 25 }}
                            className="fixed top-0 left-0 h-full w-[480px] bg-white border-r border-slate-200 z-50 flex flex-col shadow-2xl"
                            style={{ direction: 'rtl' }}
                        >
                            {/* Builder header */}
                            <div className="p-4 border-b border-slate-200 flex items-center justify-between">
                                <div>
                                    <h3 className="text-slate-800 font-bold">
                                        {editRoute ? 'تعديل المسار' : 'مسار جديد'}
                                    </h3>
                                </div>
                                <IconButton icon={X} label="إغلاق" onClick={() => setShowBuilder(false)} />
                            </div>

                            <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scroll">
                                {/* Route name */}
                                <div className="space-y-1">
                                    <label className="text-xs font-semibold text-slate-600">اسم المسار</label>
                                    <input
                                        type="text"
                                        value={builderName}
                                        onChange={e => setBuilderName(e.target.value)}
                                        placeholder="مثال: مسار المنصور"
                                        className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5 text-sm text-slate-800 focus:border-sky-500 focus:ring-1 focus:ring-sky-500 focus:outline-none"
                                    />
                                </div>

                                {/* Geo Tree Picker */}
                                <div className="space-y-2">
                                    <label className="text-xs font-semibold text-slate-600">
                                        اختر محطة من الشجرة الجغرافية
                                    </label>
                                    <div className="bg-slate-50 rounded-xl border border-slate-200 overflow-hidden">
                                        {[1, 2, 3, 4].map(level => {
                                            const parentId = level === 1 ? null : treeSel[level - 2];
                                            const canShow = level === 1 || parentId !== null;
                                            const children = canShow ? getChildren(level, parentId) : [];

                                            if (!canShow) return null;
                                            if (children.length === 0 && level > 1) return null;

                                            return (
                                                <div key={level} className={level > 1 ? 'border-t border-slate-200' : ''}>
                                                    <div className="px-3 py-1.5 bg-slate-100">
                                                        <p className="text-xs font-semibold text-sky-600 uppercase tracking-wider">
                                                            {levelNames[level]}
                                                        </p>
                                                    </div>
                                                    <div className="p-1.5 flex flex-wrap gap-1 max-h-32 overflow-y-auto custom-scroll">
                                                        {children.map(u => {
                                                            const isSelected = treeSel[level - 1] === u.id;
                                                            const alreadyAdded = builderPoints.some(p => p.geoUnitId === u.id);
                                                            return (
                                                                <button
                                                                    key={u.id}
                                                                    onClick={() => handleTreeSelect(level, u.id)}
                                                                    disabled={alreadyAdded}
                                                                    className={`px-2.5 py-1.5 rounded-lg text-xs transition-all flex items-center gap-1 ${
                                                                        alreadyAdded
                                                                            ? 'bg-slate-100 text-slate-400 cursor-not-allowed line-through'
                                                                            : isSelected
                                                                                ? 'bg-sky-50 text-sky-700 font-bold ring-1 ring-sky-300'
                                                                                : 'bg-white text-slate-700 hover:bg-sky-50 hover:text-sky-700 border border-slate-200'
                                                                    }`}
                                                                >
                                                                    <span>{u.name}</span>
                                                                    {!alreadyAdded && level < 4 && getChildren(level + 1, u.id).length > 0 && (
                                                                        <ChevronRight className="w-3 h-3 opacity-40" style={{ transform: 'scaleX(-1)' }} />
                                                                    )}
                                                                </button>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>

                                    {addableUnit && (
                                        <motion.button
                                            initial={{ opacity: 0, y: -5 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            onClick={addPoint}
                                            className="w-full flex items-center justify-center gap-2 bg-sky-600 hover:bg-sky-500 text-white py-2.5 rounded-lg text-sm font-bold transition-all"
                                        >
                                            <Plus className="w-4 h-4" />
                                            <span>إضافة «{getUnitName(addableUnit.id)}» كمحطة</span>
                                            <span className={`px-1.5 py-0.5 rounded text-xs ${levelColors[addableUnit.level].bg} ${levelColors[addableUnit.level].text}`}>
                                                {levelNames[addableUnit.level]}
                                            </span>
                                        </motion.button>
                                    )}
                                </div>

                                {/* Stations list */}
                                <div className="space-y-2">
                                    <p className="text-xs font-semibold text-slate-600">المحطات ({builderPoints.length})</p>
                                    {builderPoints.map((p, idx) => {
                                        const colors = levelColors[p.level] || levelColors[4];
                                        return (
                                            <div key={p.geoUnitId} className="flex items-center gap-2 p-2 rounded-lg bg-slate-50 border border-slate-200">
                                                <span className="w-6 h-6 rounded-full bg-sky-600 text-white text-xs font-bold flex items-center justify-center flex-shrink-0">
                                                    {idx + 1}
                                                </span>
                                                <span className="flex-1 text-sm text-slate-800">{getUnitName(p.geoUnitId)}</span>
                                                <span className={`px-1.5 py-0.5 rounded text-xs font-medium border ${colors.bg} ${colors.text} ${colors.border}`}>
                                                    {levelNames[p.level]}
                                                </span>
                                                <button onClick={() => movePoint(idx, -1)} disabled={idx === 0} className="text-slate-400 hover:text-sky-600 disabled:opacity-30">
                                                    <ArrowUp className="w-3.5 h-3.5" />
                                                </button>
                                                <button onClick={() => movePoint(idx, 1)} disabled={idx === builderPoints.length - 1} className="text-slate-400 hover:text-sky-600 disabled:opacity-30">
                                                    <ArrowDown className="w-3.5 h-3.5" />
                                                </button>
                                                <button onClick={() => removePoint(idx)} className="text-slate-400 hover:text-red-500">
                                                    <Trash2 className="w-3.5 h-3.5" />
                                                </button>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>

                            <div className="p-4 border-t border-slate-200">
                                <button onClick={saveRoute} className="w-full bg-sky-600 hover:bg-sky-500 text-white py-2.5 rounded-lg font-bold text-sm transition-all">
                                    {editRoute ? 'حفظ التعديلات' : 'إنشاء المسار'}
                                </button>
                            </div>
                        </motion.div>
                    </>
                )}
            </AnimatePresence>
        </div>
    );
}
