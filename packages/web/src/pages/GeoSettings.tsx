import { useState, useCallback, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Trash2, RotateCcw, Globe, MapPin, Map, Building, Home, X } from 'lucide-react';
import { levelNames } from '../lib/geoConstants';
import { api } from '../lib/api';
import type { GeoUnit } from '../lib/types';
import SmartTable from '../components/SmartTable';
import type { ColumnDef } from '../components/SmartTable';

const tabs = [
    { level: 1, label: 'المحافظات', icon: MapPin },
    { level: 2, label: 'المناطق', icon: Map },
    { level: 3, label: 'النواحي', icon: Building },
    { level: 4, label: 'الأحياء', icon: Home },
];

export default function GeoSettings() {
    const [geoUnits, setGeoUnits] = useState<GeoUnit[]>([]);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState(1);
    const [isModalOpen, setIsModalOpen] = useState(false);

    const [modalGov, setModalGov] = useState('');
    const [modalRegion, setModalRegion] = useState('');
    const [modalSubDistrict, setModalSubDistrict] = useState('');
    const [modalName, setModalName] = useState('');

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
        const descendants = new Set<number>();
        const collect = (pid: number) => {
            geoUnits.filter(u => u.parentId === pid).forEach(u => { descendants.add(u.id); collect(u.id); });
        };
        descendants.add(id);
        collect(id);
        if (!confirm(`سيتم حذف هذا العنصر و ${descendants.size - 1} عناصر تابعة. متابعة؟`)) return;
        try {
            await api.geoUnits.delete(id);
            await fetchGeoUnits();
        } catch (err) {
            console.error('Failed to delete geo unit:', err);
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
        const name = modalName.trim();
        if (!name) return;
        const level = activeTab;
        let parentId: number | null = null;
        if (level === 2) { if (!modalGov) return; parentId = Number(modalGov); }
        if (level === 3) { if (!modalRegion) return; parentId = Number(modalRegion); }
        if (level === 4) { if (!modalSubDistrict) return; parentId = Number(modalSubDistrict); }
        try {
            await api.geoUnits.create({ name, level, parentId });
            await fetchGeoUnits();
            setIsModalOpen(false);
        } catch (err) {
            console.error('Failed to create geo unit:', err);
        }
    };

    const resetData = async () => {
        if (!confirm('سيتم إعادة تحميل البيانات من الخادم. متابعة؟')) return;
        await fetchGeoUnits();
    };

    const govColumns: ColumnDef<GeoUnit>[] = [
        { key: 'name', label: 'اسم المحافظة', sortable: true, render: (u) => <span className="text-sm font-semibold text-slate-800">{u.name}</span> },
        { key: 'children', label: 'عدد المناطق', sortable: true, render: (u) => <span className="text-sm text-slate-600">{geoUnits.filter(c => c.parentId === u.id).length}</span>, getValue: (u) => geoUnits.filter(c => c.parentId === u.id).length },
    ];

    const regionColumns: ColumnDef<GeoUnit>[] = [
        { key: 'name', label: 'اسم المنطقة', sortable: true, render: (u) => <span className="text-sm font-semibold text-slate-800">{u.name}</span> },
        { key: 'parentId', label: 'المحافظة', sortable: true, render: (u) => <span className="px-2.5 py-1 rounded-full bg-sky-50 text-sky-700 text-xs font-medium border border-sky-100">{getParentName(u.parentId)}</span>, getValue: (u) => getParentName(u.parentId) },
        { key: 'children', label: 'عدد النواحي', sortable: true, render: (u) => <span className="text-sm text-slate-600">{geoUnits.filter(c => c.parentId === u.id).length}</span>, getValue: (u) => geoUnits.filter(c => c.parentId === u.id).length },
    ];

    const subDistrictColumns: ColumnDef<GeoUnit>[] = [
        { key: 'name', label: 'اسم الناحية', sortable: true, render: (u) => <span className="text-sm font-semibold text-slate-800">{u.name}</span> },
        { key: 'path', label: 'المسار', render: (u) => <span className="text-xs text-slate-500">{getPath(u)}</span>, getValue: (u) => getPath(u) },
        { key: 'children', label: 'عدد الأحياء', sortable: true, render: (u) => <span className="text-sm text-slate-600">{geoUnits.filter(c => c.parentId === u.id).length}</span>, getValue: (u) => geoUnits.filter(c => c.parentId === u.id).length },
    ];

    const neighborhoodColumns: ColumnDef<GeoUnit>[] = [
        { key: 'name', label: 'اسم الحي', sortable: true, render: (u) => <span className="text-sm font-semibold text-slate-800">{u.name}</span> },
        { key: 'path', label: 'المسار', render: (u) => <span className="text-xs text-slate-500">{getPath(u)}</span>, getValue: (u) => getPath(u) },
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
            <div className="flex-1 min-h-0">
                <SmartTable<GeoUnit>
                    title={currentTab.label}
                    icon={currentTab.icon}
                    data={currentData}
                    columns={columnsByLevel[activeTab]}
                    searchKeys={['name']}
                    searchPlaceholder={`بحث في ${currentTab.label}...`}
                    getId={(u) => u.id}
                    actions={(u) => (
                        <button onClick={() => deleteUnit(u.id)} className="p-1.5 rounded-md hover:bg-white hover:shadow-sm text-gray-400 hover:text-red-500 transition-all border border-transparent hover:border-gray-100">
                            <Trash2 className="w-4 h-4" />
                        </button>
                    )}
                    headerActions={
                        <button onClick={openAddModal} className="flex items-center gap-2 bg-sky-600 hover:bg-sky-500 text-white px-4 py-2 rounded-lg text-sm font-bold shadow-sm transition-all">
                            <Plus className="w-4 h-4" />
                            <span>إضافة {levelNames[activeTab]}</span>
                        </button>
                    }
                    emptyIcon={currentTab.icon}
                    emptyMessage={`لا توجد ${currentTab.label}`}
                />
            </div>

            {/* ============ Add Modal ============ */}
            <AnimatePresence>
                {isModalOpen && (
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
                                        onChange={e => setModalName(e.target.value)}
                                        onKeyDown={e => e.key === 'Enter' && handleAdd()}
                                        placeholder={`أدخل اسم ${levelNames[activeTab]}...`}
                                        className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-slate-900 placeholder:text-gray-400 focus:border-sky-500 focus:outline-none transition-colors"
                                        autoFocus
                                    />
                                </div>
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
