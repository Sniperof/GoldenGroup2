import { useState, useCallback, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Navigate } from 'react-router-dom';
import { Plus, Trash2, RotateCcw, Globe, MapPin, Map, Building, Home, X, Pencil } from 'lucide-react';
import { levelNames } from '../lib/geoConstants';
import { api } from '../lib/api';
import type { GeoUnit } from '../lib/types';
import SmartTable from '../components/SmartTable';
import type { ColumnDef } from '../components/SmartTable';
import { usePermissions } from '../hooks/usePermissions';

const tabs = [
    { level: 1, label: 'المحافظات', icon: MapPin },
    { level: 2, label: 'المناطق', icon: Map },
    { level: 3, label: 'النواحي', icon: Building },
    { level: 4, label: 'الأحياء', icon: Home },
];

export default function GeoSettings() {
    const { hasPermission } = usePermissions();
    const canManageGeo = hasPermission('geo.manage');
    const [geoUnits, setGeoUnits] = useState<GeoUnit[]>([]);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState(1);
    const [isModalOpen, setIsModalOpen] = useState(false);

    const [modalGov, setModalGov] = useState('');
    const [modalRegion, setModalRegion] = useState('');
    const [modalSubDistrict, setModalSubDistrict] = useState('');
    const [modalName, setModalName] = useState('');
    const [addError, setAddError] = useState('');

    const [editUnit, setEditUnit] = useState<GeoUnit | null>(null);
    const [editName, setEditName] = useState('');
    const [editError, setEditError] = useState('');
    const [deleteError, setDeleteError] = useState<string | null>(null);

    if (!hasPermission('geo.view')) {
        return <Navigate to="/" replace />;
    }

    const fetchGeoUnits = useCallback(async () => {
        try {
            setLoading(true);
            const data = await api.geoUnits.list();
            setGeoUnits(data);
        } catch (err) {
            console.error('Failed to fetch geo units:', err);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchGeoUnits();
    }, [fetchGeoUnits]);

    const byLevel = (level: number) => geoUnits.filter(u => u.level === level);
    const getParentName = (parentId: number | null) => geoUnits.find(u => u.id === parentId)?.name || '--';

    const governorates = byLevel(1);
    const regions = useMemo(() => modalGov ? geoUnits.filter(u => u.level === 2 && u.parentId === Number(modalGov)) : [], [geoUnits, modalGov]);
    const subDistricts = useMemo(() => modalRegion ? geoUnits.filter(u => u.level === 3 && u.parentId === Number(modalRegion)) : [], [geoUnits, modalRegion]);

    const getPath = (unit: GeoUnit): string => {
        const parts: string[] = [];
        let current: GeoUnit | undefined = unit;
        while (current && current.parentId !== null) {
            const parent = geoUnits.find(u => u.id === current!.parentId);
            if (parent) parts.unshift(parent.name);
            current = parent;
        }
        return parts.join(' › ') || '--';
    };

    const deleteUnit = async (id: number) => {
        if (!canManageGeo) return;
        setDeleteError(null);
        const childCount = geoUnits.filter(u => u.parentId === id).length;
        if (childCount > 0) {
            setDeleteError(`لا يمكن حذف هذا المستوى — يوجد ${childCount} ${childCount === 1 ? 'وحدة تابعة' : 'وحدات تابعة'} له. احذف الأبناء أولاً.`);
            return;
        }
        if (!confirm('سيتم حذف هذا العنصر نهائياً. متابعة؟')) return;
        try {
            await api.geoUnits.delete(id);
            await fetchGeoUnits();
        } catch (err: any) {
            const msg = err?.message || '';
            if (msg.includes('409') || msg.includes('تابعة')) {
                setDeleteError('لا يمكن حذف هذا المستوى — يوجد وحدات تابعة له. احذف الأبناء أولاً.');
            } else {
                setDeleteError('حدث خطأ أثناء الحذف. يرجى المحاولة مرة أخرى.');
            }
        }
    };

    const openEditModal = (unit: GeoUnit) => {
        setEditUnit(unit);
        setEditName(unit.name);
        setEditError('');
    };

    const handleEdit = async () => {
        if (!editUnit || !canManageGeo) return;
        setEditError('');
        const name = editName.trim();
        if (!name) { setEditError('يرجى إدخال الاسم'); return; }
        if (name === editUnit.name) { setEditUnit(null); return; }
        const isDuplicate = geoUnits.some(
            u => u.id !== editUnit.id && u.level === editUnit.level && u.parentId === editUnit.parentId && u.name.trim().toLowerCase() === name.toLowerCase()
        );
        if (isDuplicate) {
            setEditError(`يوجد ${levelNames[editUnit.level]} بنفس الاسم "${name}" في هذا المستوى بالفعل`);
            return;
        }
        try {
            await api.geoUnits.update(editUnit.id, { name });
            await fetchGeoUnits();
            setEditUnit(null);
        } catch (err) {
            setEditError('حدث خطأ أثناء التعديل. يرجى المحاولة مرة أخرى.');
        }
    };

    const openAddModal = () => {
        setModalGov('');
        setModalRegion('');
        setModalSubDistrict('');
        setModalName('');
        setIsModalOpen(true);
    };

    const handleAdd = async () => {
        if (!canManageGeo) return;
        setAddError('');
        const name = modalName.trim();
        if (!name) { setAddError('يرجى إدخال الاسم'); return; }
        const level = activeTab;
        let parentId: number | null = null;
        if (level === 2) { if (!modalGov) { setAddError('يرجى اختيار المحافظة'); return; } parentId = Number(modalGov); }
        if (level === 3) { if (!modalRegion) { setAddError('يرجى اختيار المنطقة'); return; } parentId = Number(modalRegion); }
        if (level === 4) { if (!modalSubDistrict) { setAddError('يرجى اختيار الناحية'); return; } parentId = Number(modalSubDistrict); }
        // Check for duplicate name at same level and parent
        const isDuplicate = geoUnits.some(
            u => u.level === level && u.parentId === parentId && u.name.trim().toLowerCase() === name.toLowerCase()
        );
        if (isDuplicate) {
            setAddError(`يوجد ${levelNames[level]} بنفس الاسم "${name}" في هذا المستوى بالفعل`);
            return;
        }
        try {
            await api.geoUnits.create({ name, level, parentId });
            await fetchGeoUnits();
            setIsModalOpen(false);
        } catch (err) {
            const msg = (err instanceof Error ? err.message : '');
            const isDupe = msg.includes('409') || msg.includes('مكرر');
            setAddError(isDupe ? `يوجد ${levelNames[level]} بنفس الاسم "${name}" في هذا المستوى بالفعل` : 'حدث خطأ أثناء الإضافة. يرجى المحاولة مرة أخرى.');
        }
    };

    const resetData = async () => {
        if (!confirm('سيتم إعادة تحميل البيانات من الخادم. متابعة؟')) return;
        await fetchGeoUnits();
    };

    const toggleStatus = async (unit: GeoUnit) => {
        if (!canManageGeo) return;
        const next: 'active' | 'inactive' = unit.status === 'active' ? 'inactive' : 'active';
        try {
            await api.geoUnits.updateStatus(unit.id, next);
            await fetchGeoUnits();
        } catch {
            setDeleteError('حدث خطأ أثناء تغيير الحالة.');
        }
    };

    const StatusBadge = ({ unit }: { unit: GeoUnit }) => (
        <button
            onClick={() => canManageGeo && toggleStatus(unit)}
            title={canManageGeo ? (unit.status === 'active' ? 'انقر لتعطيل' : 'انقر لتفعيل') : undefined}
            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${canManageGeo ? 'cursor-pointer hover:opacity-75' : 'cursor-default'} ${unit.status === 'active' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-gray-100 text-gray-500 border-gray-200'}`}
        >
            <span className={`w-1.5 h-1.5 rounded-full ${unit.status === 'active' ? 'bg-emerald-500' : 'bg-gray-400'}`} />
            {unit.status === 'active' ? 'نشط' : 'معطّل'}
        </button>
    );

    const govColumns: ColumnDef<GeoUnit>[] = [
        { key: 'name', label: 'اسم المحافظة', sortable: true, render: (u) => <span className="text-sm font-semibold text-slate-800">{u.name}</span> },
        { key: 'children', label: 'عدد المناطق', sortable: true, render: (u) => <span className="text-sm text-slate-600">{geoUnits.filter(c => c.parentId === u.id).length}</span>, getValue: (u) => geoUnits.filter(c => c.parentId === u.id).length },
        { key: 'status', label: 'الحالة', render: (u) => <StatusBadge unit={u} />, getValue: (u) => u.status ?? 'active' },
    ];

    const regionColumns: ColumnDef<GeoUnit>[] = [
        { key: 'name', label: 'اسم المنطقة', sortable: true, render: (u) => <span className="text-sm font-semibold text-slate-800">{u.name}</span> },
        { key: 'parentId', label: 'المحافظة', sortable: true, render: (u) => <span className="px-2.5 py-1 rounded-full bg-sky-50 text-sky-700 text-xs font-medium border border-sky-100">{getParentName(u.parentId)}</span>, getValue: (u) => getParentName(u.parentId) },
        { key: 'children', label: 'عدد النواحي', sortable: true, render: (u) => <span className="text-sm text-slate-600">{geoUnits.filter(c => c.parentId === u.id).length}</span>, getValue: (u) => geoUnits.filter(c => c.parentId === u.id).length },
        { key: 'status', label: 'الحالة', render: (u) => <StatusBadge unit={u} />, getValue: (u) => u.status ?? 'active' },
    ];

    const subDistrictColumns: ColumnDef<GeoUnit>[] = [
        { key: 'name', label: 'اسم الناحية', sortable: true, render: (u) => <span className="text-sm font-semibold text-slate-800">{u.name}</span> },
        { key: 'path', label: 'المسار', render: (u) => <span className="text-xs text-slate-500">{getPath(u)}</span>, getValue: (u) => getPath(u) },
        { key: 'children', label: 'عدد الأحياء', sortable: true, render: (u) => <span className="text-sm text-slate-600">{geoUnits.filter(c => c.parentId === u.id).length}</span>, getValue: (u) => geoUnits.filter(c => c.parentId === u.id).length },
        { key: 'status', label: 'الحالة', render: (u) => <StatusBadge unit={u} />, getValue: (u) => u.status ?? 'active' },
    ];

    const neighborhoodColumns: ColumnDef<GeoUnit>[] = [
        { key: 'name', label: 'اسم الحي', sortable: true, render: (u) => <span className="text-sm font-semibold text-slate-800">{u.name}</span> },
        { key: 'path', label: 'المسار', render: (u) => <span className="text-xs text-slate-500">{getPath(u)}</span>, getValue: (u) => getPath(u) },
        { key: 'status', label: 'الحالة', render: (u) => <StatusBadge unit={u} />, getValue: (u) => u.status ?? 'active' },
    ];

    const columnsByLevel: Record<number, ColumnDef<GeoUnit>[]> = { 1: govColumns, 2: regionColumns, 3: subDistrictColumns, 4: neighborhoodColumns };
    const currentData = byLevel(activeTab);
    const currentTab = tabs.find(t => t.level === activeTab)!;

    if (loading && geoUnits.length === 0) {
        return (
            <div className="h-full flex items-center justify-center">
                <div className="text-center">
                    <div className="w-8 h-8 border-4 border-sky-600 border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
                    <p className="text-slate-500 text-sm">جاري تحميل البيانات...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="h-full overflow-hidden flex flex-col">
            {/* Header */}
            <div className="px-8 pt-8 pb-0">
                <div className="flex items-end justify-between mb-5">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-sky-50 border border-sky-100 flex items-center justify-center">
                            <Globe className="w-5 h-5 text-sky-600" />
                        </div>
                        <div>
                            <h1 className="text-xl font-bold text-slate-900 leading-tight">إدارة المستويات الإدارية</h1>
                            <p className="text-slate-500 text-xs mt-0.5">{geoUnits.length} وحدة جغرافية</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button onClick={resetData} className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 text-sm transition-all">
                            <RotateCcw className="w-3.5 h-3.5" />
                            <span>إعادة تعيين</span>
                        </button>
                    </div>
                </div>

                {/* Tabs */}
                <div className="flex gap-1 bg-gray-100 p-1 rounded-xl">
                    {tabs.map(tab => (
                        <button
                            key={tab.level}
                            onClick={() => setActiveTab(tab.level)}
                            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${activeTab === tab.level
                                ? 'bg-white shadow-sm text-sky-600 font-bold'
                                : 'text-slate-500 hover:text-slate-700'
                                }`}
                        >
                            <tab.icon className="w-4 h-4" />
                            <span>{tab.label}</span>
                            <span className={`px-1.5 py-0.5 rounded-md text-[10px] font-bold ${activeTab === tab.level ? 'bg-sky-50 text-sky-600' : 'bg-gray-200 text-gray-500'}`}>
                                {byLevel(tab.level).length}
                            </span>
                        </button>
                    ))}
                </div>
            </div>

            {/* Table Content */}
            <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4">
                <SmartTable<GeoUnit>
                    title={currentTab.label}
                    icon={currentTab.icon}
                    data={currentData}
                    columns={columnsByLevel[activeTab]}
                    searchKeys={['name']}
                    searchPlaceholder={`بحث في ${currentTab.label}...`}
                    getId={(u) => u.id}
                    tableMinWidth={520}
                    actions={(u) => (
                        <div className="flex items-center gap-1">
                            {canManageGeo && (
                                <button onClick={() => openEditModal(u)} className="p-1.5 rounded-md hover:bg-white hover:shadow-sm text-gray-400 hover:text-sky-500 transition-all border border-transparent hover:border-gray-100">
                                    <Pencil className="w-4 h-4" />
                                </button>
                            )}
                            {canManageGeo && (
                                <button onClick={() => deleteUnit(u.id)} className="p-1.5 rounded-md hover:bg-white hover:shadow-sm text-gray-400 hover:text-red-500 transition-all border border-transparent hover:border-gray-100">
                                    <Trash2 className="w-4 h-4" />
                                </button>
                            )}
                        </div>
                    )}
                    headerActions={
                        canManageGeo ? (
                            <button onClick={openAddModal} className="flex items-center gap-2 bg-sky-600 hover:bg-sky-500 text-white px-4 py-2 rounded-lg text-sm font-bold shadow-sm transition-all">
                                <Plus className="w-4 h-4" />
                                <span>إضافة {levelNames[activeTab]}</span>
                            </button>
                        ) : undefined
                    }
                    emptyIcon={currentTab.icon}
                    emptyMessage={`لا توجد ${currentTab.label}`}
                />
            </div>

            {/* Delete Error Banner */}
            <AnimatePresence>
                {deleteError && (
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 20 }}
                        className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-red-600 text-white px-5 py-3 rounded-xl shadow-lg flex items-center gap-3 max-w-md"
                    >
                        <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                        <span className="text-sm font-medium">{deleteError}</span>
                        <button onClick={() => setDeleteError(null)} className="mr-2 text-white/70 hover:text-white">
                            <X className="w-4 h-4" />
                        </button>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* ============ Edit Modal ============ */}
            <AnimatePresence>
                {editUnit && canManageGeo && (
                    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            className="bg-white rounded-xl shadow-xl w-full max-w-sm overflow-hidden"
                        >
                            <div className="p-5 border-b border-gray-100 flex justify-between items-center">
                                <h2 className="text-lg font-bold text-slate-900">تعديل {levelNames[editUnit.level]}</h2>
                                <button onClick={() => setEditUnit(null)} className="text-gray-400 hover:text-gray-600 transition-colors">
                                    <X className="w-5 h-5" />
                                </button>
                            </div>
                            <div className="p-5 space-y-4">
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1.5">الاسم الجديد <span className="text-red-500">*</span></label>
                                    <input
                                        type="text"
                                        value={editName}
                                        onChange={e => { setEditName(e.target.value); setEditError(''); }}
                                        onKeyDown={e => e.key === 'Enter' && handleEdit()}
                                        className={`w-full bg-gray-50 border rounded-lg px-3 py-2.5 text-sm text-slate-900 focus:outline-none transition-colors ${editError ? 'border-red-300 focus:border-red-500' : 'border-gray-200 focus:border-sky-500'}`}
                                        autoFocus
                                    />
                                </div>
                                {editError && (
                                    <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                                        <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                        {editError}
                                    </div>
                                )}
                            </div>
                            <div className="p-5 border-t border-gray-100 flex gap-3">
                                <button onClick={() => setEditUnit(null)} className="flex-1 px-4 py-2.5 border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 font-medium text-sm transition-colors">
                                    إلغاء
                                </button>
                                <button onClick={handleEdit} className="flex-1 px-4 py-2.5 bg-sky-600 text-white rounded-lg hover:bg-sky-500 font-bold text-sm transition-colors">
                                    حفظ التعديل
                                </button>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>

            {/* ============ Add Modal ============ */}
            <AnimatePresence>
                {isModalOpen && canManageGeo && (
                    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden"
                        >
                            {/* Modal Header */}
                            <div className="p-5 border-b border-gray-100 flex justify-between items-center">
                                <h2 className="text-lg font-bold text-slate-900">إضافة {levelNames[activeTab]}</h2>
                                <button onClick={() => setIsModalOpen(false)} className="text-gray-400 hover:text-gray-600 transition-colors">
                                    <X className="w-5 h-5" />
                                </button>
                            </div>

                            {/* Modal Body */}
                            <div className="p-5 space-y-4">
                                {/* Cascading Dropdowns */}
                                {activeTab >= 2 && (
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 mb-1.5">المحافظة <span className="text-red-500">*</span></label>
                                        <select
                                            value={modalGov}
                                            onChange={e => { setModalGov(e.target.value); setModalRegion(''); setModalSubDistrict(''); }}
                                            className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-slate-900 focus:border-sky-500 focus:outline-none transition-colors"
                                        >
                                            <option value="">اختر المحافظة...</option>
                                            {governorates.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                                        </select>
                                    </div>
                                )}

                                {activeTab >= 3 && (
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 mb-1.5">المنطقة <span className="text-red-500">*</span></label>
                                        <select
                                            value={modalRegion}
                                            onChange={e => { setModalRegion(e.target.value); setModalSubDistrict(''); }}
                                            disabled={!modalGov}
                                            className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-slate-900 focus:border-sky-500 focus:outline-none transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            <option value="">اختر المنطقة...</option>
                                            {regions.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                                        </select>
                                    </div>
                                )}

                                {activeTab >= 4 && (
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 mb-1.5">الناحية <span className="text-red-500">*</span></label>
                                        <select
                                            value={modalSubDistrict}
                                            onChange={e => setModalSubDistrict(e.target.value)}
                                            disabled={!modalRegion}
                                            className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-slate-900 focus:border-sky-500 focus:outline-none transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            <option value="">اختر الناحية...</option>
                                            {subDistricts.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                                        </select>
                                    </div>
                                )}

                                {/* Name Input */}
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1.5">اسم {levelNames[activeTab]} <span className="text-red-500">*</span></label>
                                    <input
                                        type="text"
                                        value={modalName}
                                        onChange={e => { setModalName(e.target.value); setAddError(''); }}
                                        onKeyDown={e => e.key === 'Enter' && handleAdd()}
                                        placeholder={`أدخل اسم ${levelNames[activeTab]}...`}
                                        className={`w-full bg-gray-50 border rounded-lg px-3 py-2.5 text-sm text-slate-900 placeholder:text-gray-400 focus:outline-none transition-colors ${addError ? 'border-red-300 focus:border-red-500' : 'border-gray-200 focus:border-sky-500'}`}
                                        autoFocus
                                    />
                                </div>
                                {addError && (
                                    <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                                        <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                        {addError}
                                    </div>
                                )}
                            </div>

                            {/* Modal Footer */}
                            <div className="p-5 border-t border-gray-100 flex gap-3">
                                <button onClick={() => setIsModalOpen(false)} className="flex-1 px-4 py-2.5 border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 font-medium text-sm transition-colors">
                                    إلغاء
                                </button>
                                <button onClick={handleAdd} className="flex-1 px-4 py-2.5 bg-sky-600 text-white rounded-lg hover:bg-sky-500 font-bold text-sm transition-colors flex items-center justify-center gap-2">
                                    <Plus className="w-4 h-4" />
                                    <span>إضافة</span>
                                </button>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </div>
    );
}
