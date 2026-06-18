import { useState, useCallback, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Navigate } from 'react-router-dom';
import {
    Plus, Search, Eye, Trash2, X, ArrowUp, ArrowDown,
    Route as RouteIcon, ChevronRight,
} from 'lucide-react';
import { api } from '../lib/api';
import IconButton from '../components/ui/IconButton';
import { levelNames } from '../lib/geoConstants';
import type { Route, GeoUnit, RoutePoint } from '../lib/types';
import { usePermissions } from '../hooks/usePermissions';
import Button from '../components/ui/Button';

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
    const canManageGeo = hasPermission('geo.manage');

    const [routes, setRoutes] = useState<Route[]>([]);
    const [geoUnits, setGeoUnits] = useState<GeoUnit[]>([]);

    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [showBuilder, setShowBuilder] = useState(false);
    const [editRoute, setEditRoute] = useState<Route | null>(null);

    const [builderName, setBuilderName] = useState('');
    const [builderPoints, setBuilderPoints] = useState<RoutePoint[]>([]);
    const [treeSel, setTreeSel] = useState<(number | null)[]>([null, null, null, null]);

    if (!hasPermission('geo.view')) return <Navigate to="/" replace />;

    const fetchData = useCallback(async () => {
        try {
            const [routesData, geoUnitsData] = await Promise.all([
                api.routes.list(),
                api.geoUnits.list(),
            ]);
            setRoutes(routesData);
            setGeoUnits(geoUnitsData);
        } catch (e) {
            console.error('Failed to fetch data', e);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetchData(); }, [fetchData]);

    const getChildren = useCallback((level: number, parentId: number | null) => {
        return geoUnits.filter(u => u.level === level && u.parentId === parentId);
    }, [geoUnits]);

    const getUnitName = useCallback((id: number) =>
        geoUnits.find(u => u.id === id)?.name || '??', [geoUnits]);

    const filtered = routes.filter(r => r.name.includes(search));

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
                <div>
                    <h1 className="text-xl font-bold text-slate-900 mb-1">إدارة خطوط السير</h1>
                    <p className="text-slate-500 text-sm">عرض وإدارة مسارات التوزيع والصيانة.</p>
                </div>
                <Button icon={Plus} onClick={() => openBuilder()} disabled={!canManageGeo}>
                    مسار جديد
                </Button>
            </div>

            {/* ── Search ── */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-3 mb-6 flex items-center gap-3">
                <div className="relative flex-1">
                    <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                        type="text"
                        placeholder="بحث عن مسار..."
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        className="w-full bg-gray-50 border border-gray-200 rounded-lg pr-10 pl-4 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:border-sky-500 focus:ring-1 focus:ring-sky-500 focus:outline-none"
                    />
                </div>
            </div>

            {/* ── Routes table ── */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <table className="w-full">
                    <thead>
                        <tr className="border-b border-gray-200 bg-gray-50">
                            <th className="text-right px-6 py-3 text-xs font-semibold text-gray-500 uppercase">#</th>
                            <th className="text-right px-6 py-3 text-xs font-semibold text-gray-500 uppercase">اسم المسار</th>
                            <th className="text-right px-6 py-3 text-xs font-semibold text-gray-500 uppercase">عدد المحطات</th>
                            <th className="text-right px-6 py-3 text-xs font-semibold text-gray-500 uppercase">المحطات</th>
                            <th className="text-right px-6 py-3 text-xs font-semibold text-gray-500 uppercase">إجراءات</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {filtered.length === 0 ? (
                            <tr>
                                <td colSpan={5} className="text-center text-slate-500 py-10 text-sm">لا توجد مسارات</td>
                            </tr>
                        ) : filtered.map((r, i) => (
                            <motion.tr key={r.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="hover:bg-sky-50 transition-colors">
                                <td className="px-6 py-4 text-sm text-slate-500">{i + 1}</td>
                                <td className="px-6 py-4">
                                    <div className="flex items-center gap-2">
                                        <div className="w-8 h-8 rounded-lg bg-sky-50 flex items-center justify-center text-sky-600">
                                            <RouteIcon className="w-4 h-4" />
                                        </div>
                                        <span className="text-slate-900 font-medium text-sm">{r.name}</span>
                                    </div>
                                </td>
                                <td className="px-6 py-4 text-sm text-slate-700">{r.points.length}</td>
                                <td className="px-6 py-4">
                                    <div className="flex flex-wrap gap-1">
                                        {r.points.sort((a, b) => a.order - b.order).slice(0, 4).map(p => {
                                            const colors = levelColors[p.level] || levelColors[4];
                                            return (
                                                <span key={p.geoUnitId} className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs ${colors.bg} ${colors.text} border ${colors.border}`}>
                                                    {getUnitName(p.geoUnitId)}
                                                    <span className="opacity-60 text-[10px]">{levelNames[p.level]}</span>
                                                </span>
                                            );
                                        })}
                                        {r.points.length > 4 && (
                                            <span className="px-2 py-0.5 rounded-full bg-gray-100 text-xs text-slate-500">
                                                +{r.points.length - 4}
                                            </span>
                                        )}
                                    </div>
                                </td>
                                <td className="px-6 py-4">
                                    <div className="flex items-center gap-2">
                                        <button onClick={() => openBuilder(r)} disabled={!canManageGeo} className="p-1.5 rounded-lg hover:bg-sky-50 text-slate-400 hover:text-sky-600 transition-all disabled:opacity-50">
                                            <Eye className="w-4 h-4" />
                                        </button>
                                        <button onClick={() => deleteRoute(r.id)} disabled={!canManageGeo} className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500 transition-all disabled:opacity-50">
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                </td>
                            </motion.tr>
                        ))}
                    </tbody>
                </table>
            </div>

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
                            className="fixed top-0 left-0 h-full w-[480px] bg-white border-r border-gray-200 z-50 flex flex-col shadow-2xl"
                            style={{ direction: 'rtl' }}
                        >
                            {/* Builder header */}
                            <div className="p-4 border-b border-gray-200 flex items-center justify-between">
                                <div>
                                    <h3 className="text-slate-900 font-bold">
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
                                        className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-slate-800 focus:border-sky-500 focus:ring-1 focus:ring-sky-500 focus:outline-none"
                                    />
                                </div>

                                {/* Geo Tree Picker */}
                                <div className="space-y-2">
                                    <label className="text-xs font-semibold text-slate-600">
                                        اختر محطة من الشجرة الجغرافية
                                    </label>
                                    <div className="bg-gray-50 rounded-xl border border-gray-200 overflow-hidden">
                                        {[1, 2, 3, 4].map(level => {
                                            const parentId = level === 1 ? null : treeSel[level - 2];
                                            const canShow = level === 1 || parentId !== null;
                                            const children = canShow ? getChildren(level, parentId) : [];

                                            if (!canShow) return null;
                                            if (children.length === 0 && level > 1) return null;

                                            return (
                                                <div key={level} className={level > 1 ? 'border-t border-gray-200' : ''}>
                                                    <div className="px-3 py-1.5 bg-gray-100">
                                                        <p className="text-[10px] font-semibold text-sky-600 uppercase tracking-wider">
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
                                                                            ? 'bg-gray-100 text-slate-400 cursor-not-allowed line-through'
                                                                            : isSelected
                                                                                ? 'bg-sky-50 text-sky-700 font-bold ring-1 ring-sky-300'
                                                                                : 'bg-white text-slate-700 hover:bg-sky-50 hover:text-sky-700 border border-gray-200'
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
                                            <span className={`px-1.5 py-0.5 rounded text-[10px] ${levelColors[addableUnit.level].bg} ${levelColors[addableUnit.level].text}`}>
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
                                            <div key={p.geoUnitId} className="flex items-center gap-2 p-2 rounded-lg bg-gray-50 border border-gray-200">
                                                <span className="w-6 h-6 rounded-full bg-sky-600 text-white text-xs font-bold flex items-center justify-center flex-shrink-0">
                                                    {idx + 1}
                                                </span>
                                                <span className="flex-1 text-sm text-slate-800">{getUnitName(p.geoUnitId)}</span>
                                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${colors.bg} ${colors.text} ${colors.border}`}>
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

                            <div className="p-4 border-t border-gray-200">
                                <Button fullWidth onClick={saveRoute}>
                                    {editRoute ? 'حفظ التعديلات' : 'إنشاء المسار'}
                                </Button>
                            </div>
                        </motion.div>
                    </>
                )}
            </AnimatePresence>
        </div>
    );
}
