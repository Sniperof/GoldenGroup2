import React, { useState, useMemo, useEffect } from 'react';
import { Plus, Wrench, PenTool, Truck, Clock, Package, Cog, X, Save, AlertTriangle, RefreshCw, Gem, Loader2 } from 'lucide-react';
import { api } from '../lib/api';
import type { DeviceModel, SparePart, MaintenancePartType } from '../lib/types';
import { motion, AnimatePresence } from 'framer-motion';
import SmartTable from '../components/SmartTable';
import type { ColumnDef, FilterDef } from '../components/SmartTable';

/* ------------------------------------------------------------------ */
/*  Shared Config                                                       */
/* ------------------------------------------------------------------ */

const categoryLabels: Record<string, { label: string; icon: string; color: string }> = {
    'منزلي': { label: 'منزلي', icon: '🏠', color: 'bg-green-100 text-green-800' },
    'صناعي': { label: 'صناعي', icon: '🏭', color: 'bg-orange-100 text-orange-800' },
    'تجاري': { label: 'تجاري', icon: '🏢', color: 'bg-blue-100 text-blue-800' },
};

const maintenanceLabels: Record<string, string> = {
    '3 أشهر': '3 أشهر',
    '6 أشهر': '6 أشهر',
    '1 سنة': 'سنة واحدة',
};

const serviceLabels: Record<string, { label: string; Icon: any }> = {
    'تركيب': { label: 'تركيب', Icon: Wrench },
    'صيانة': { label: 'صيانة', Icon: PenTool },
    'توصيل': { label: 'توصيل', Icon: Truck },
};

const partTypeConfig: Record<MaintenancePartType, { label: string; color: string; bg: string; border: string; hint: string }> = {
    Periodic: { label: 'دورية', color: 'text-blue-700', bg: 'bg-blue-50', border: 'border-blue-200', hint: 'يعيد ضبط عداد الصيانة الدورية' },
    Emergency: { label: 'طوارئ', color: 'text-red-700', bg: 'bg-red-50', border: 'border-red-200', hint: 'قطعة بديلة للأعطال الطارئة' },
    Accessory: { label: 'ملحقات', color: 'text-purple-700', bg: 'bg-purple-50', border: 'border-purple-200', hint: 'ملحق إضافي غير إلزامي' },
};

const formatPrice = (n: number) => new Intl.NumberFormat('ar-SY', { style: 'currency', currency: 'SYP', maximumFractionDigits: 0 }).format(n);

type ActiveTab = 'devices' | 'parts';

/* ------------------------------------------------------------------ */
/*  Component                                                           */
/* ------------------------------------------------------------------ */

const DeviceManagement = () => {
    const [activeTab, setActiveTab] = useState<ActiveTab>('devices');
    const [loading, setLoading] = useState(true);

    // ──── Devices state ────
    const [devices, setDevices] = useState<DeviceModel[]>([]);
    const [isAddingDevice, setIsAddingDevice] = useState(false);
    const [newDevice, setNewDevice] = useState<Partial<DeviceModel>>({
        name: '', brand: '', category: 'صناعي', maintenanceInterval: '6 أشهر', basePrice: 0, supportedVisitTypes: [],
    });

    // ──── Spare Parts state ────
    const [parts, setParts] = useState<SparePart[]>([]);
    const [isAddingPart, setIsAddingPart] = useState(false);
    const [editingPart, setEditingPart] = useState<SparePart | null>(null);
    const [partForm, setPartForm] = useState<Partial<SparePart>>({
        name: '', code: '', basePrice: 0, maintenanceType: 'Periodic', compatibleDeviceIds: [],
    });

    const fetchData = async () => {
        try {
            setLoading(true);
            const [devicesData, partsData] = await Promise.all([
                api.deviceModels.list(),
                api.spareParts.list(),
            ]);
            setDevices(devicesData);
            setParts(partsData);
        } catch (err) {
            console.error('Failed to fetch device management data:', err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, []);

    // ──── Device handlers ────
    const handleDeviceInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        setNewDevice(prev => ({ ...prev, [name]: value }));
    };

    const toggleVisitType = (type: 'تركيب' | 'صيانة' | 'توصيل') => {
        setNewDevice(prev => {
            const current = prev.supportedVisitTypes || [];
            return { ...prev, supportedVisitTypes: current.includes(type) ? current.filter(t => t !== type) : [...current, type] };
        });
    };

    const handleDeviceSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (newDevice.name && newDevice.brand && newDevice.basePrice) {
            try {
                await api.deviceModels.create({
                    name: newDevice.name, brand: newDevice.brand,
                    category: newDevice.category, maintenanceInterval: newDevice.maintenanceInterval,
                    basePrice: Number(newDevice.basePrice), supportedVisitTypes: newDevice.supportedVisitTypes || [],
                });
                setIsAddingDevice(false);
                setNewDevice({ name: '', brand: '', category: 'صناعي', maintenanceInterval: '6 أشهر', basePrice: 0, supportedVisitTypes: [] });
                await fetchData();
            } catch (err) {
                console.error('Failed to create device:', err);
            }
        }
    };

    // ──── Part handlers ────
    const openPartForm = (part?: SparePart) => {
        if (part) {
            setEditingPart(part);
            setPartForm({ ...part });
        } else {
            setEditingPart(null);
            setPartForm({ name: '', code: '', basePrice: 0, maintenanceType: 'Periodic', compatibleDeviceIds: [] });
        }
        setIsAddingPart(true);
    };

    const toggleDeviceCompat = (deviceId: number) => {
        setPartForm(prev => {
            const current = prev.compatibleDeviceIds || [];
            return { ...prev, compatibleDeviceIds: current.includes(deviceId) ? current.filter(id => id !== deviceId) : [...current, deviceId] };
        });
    };

    const handlePartSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!partForm.name || !partForm.code) return;
        try {
            const partData = {
                name: partForm.name!,
                code: partForm.code!,
                basePrice: Number(partForm.basePrice) || 0,
                maintenanceType: partForm.maintenanceType as MaintenancePartType || 'Periodic',
                compatibleDeviceIds: partForm.compatibleDeviceIds || [],
            };
            if (editingPart) {
                await api.spareParts.update(editingPart.id, partData);
            } else {
                await api.spareParts.create(partData);
            }
            setIsAddingPart(false);
            setEditingPart(null);
            await fetchData();
        } catch (err) {
            console.error('Failed to save spare part:', err);
        }
    };

    // ──── Columns ────
    const deviceColumns: ColumnDef<DeviceModel>[] = [
        {
            key: 'name', label: 'اسم الجهاز', sortable: true,
            render: (d) => (
                <div>
                    <span className="font-semibold text-slate-700 block text-sm">{d.name}</span>
                    <span className="text-xs text-gray-400">#{d.id.toString().padStart(4, '0')}</span>
                </div>
            ),
        },
        { key: 'brand', label: 'العلامة التجارية', sortable: true, render: (d) => <span className="text-sm text-slate-600">{d.brand}</span> },
        {
            key: 'category', label: 'الفئة', sortable: true,
            render: (d) => {
                const cat = categoryLabels[d.category] || { label: d.category, icon: '📦', color: 'bg-gray-100 text-gray-800' };
                return <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium gap-1.5 ${cat.color}`}><span className="text-[10px]">{cat.icon}</span>{cat.label}</span>;
            },
        },
        {
            key: 'maintenanceInterval', label: 'دورة الصيانة', sortable: true,
            render: (d) => <span className="text-sm text-slate-600 flex items-center gap-1.5"><Clock className="w-3.5 h-3.5 text-gray-400" />{maintenanceLabels[d.maintenanceInterval] || d.maintenanceInterval}</span>,
        },
        {
            key: 'basePrice', label: 'السعر الأساسي', sortable: true,
            render: (d) => <span className="font-mono text-sm text-slate-700 font-medium">{formatPrice(d.basePrice)}</span>,
        },
        {
            key: 'supportedVisitTypes', label: 'الخدمات',
            render: (d) => (
                <div className="flex gap-2">
                    {d.supportedVisitTypes.map(type => {
                        const S = serviceLabels[type];
                        if (!S) return null;
                        return <div key={type} title={S.label} className="p-1.5 rounded-md hover:bg-white hover:shadow-sm text-gray-400 hover:text-sky-600 transition-all cursor-help"><S.Icon size={16} /></div>;
                    })}
                </div>
            ),
        },
    ];

    const partColumns: ColumnDef<SparePart>[] = [
        {
            key: 'name', label: 'اسم القطعة', sortable: true,
            render: (p) => (
                <div>
                    <span className="font-semibold text-slate-700 block text-sm">{p.name}</span>
                    <span className="text-xs text-gray-400 font-mono">{p.code}</span>
                </div>
            ),
        },
        {
            key: 'maintenanceType', label: 'النوع', sortable: true,
            render: (p) => {
                const tc = partTypeConfig[p.maintenanceType];
                return (
                    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border ${tc.bg} ${tc.color} ${tc.border}`}>
                        {tc.label}
                    </span>
                );
            },
        },
        {
            key: 'basePrice', label: 'السعر', sortable: true,
            render: (p) => <span className="font-mono text-sm text-slate-700 font-medium">{formatPrice(p.basePrice)}</span>,
        },
        {
            key: 'compatibleDeviceIds', label: 'الأجهزة المتوافقة',
            render: (p) => (
                <div className="flex flex-wrap gap-1">
                    {p.compatibleDeviceIds.map(did => {
                        const dev = devices.find(d => d.id === did);
                        return dev ? (
                            <span key={did} className="px-2 py-0.5 rounded text-[10px] font-medium bg-sky-50 text-sky-600 border border-sky-200">
                                {dev.name}
                            </span>
                        ) : null;
                    })}
                    {p.compatibleDeviceIds.length === 0 && <span className="text-xs text-gray-300">—</span>}
                </div>
            ),
        },
    ];

    const deviceFilters: FilterDef[] = [
        { key: 'category', label: 'جميع الفئات', options: [{ value: 'منزلي', label: 'منزلي' }, { value: 'صناعي', label: 'صناعي' }, { value: 'تجاري', label: 'تجاري' }] },
        { key: 'maintenanceInterval', label: 'جميع الدورات', options: [{ value: '3 أشهر', label: '3 أشهر' }, { value: '6 أشهر', label: '6 أشهر' }, { value: '1 سنة', label: 'سنة واحدة' }] },
    ];

    const partFilters: FilterDef[] = [
        { key: 'maintenanceType', label: 'جميع الأنواع', options: [{ value: 'Periodic', label: 'دورية' }, { value: 'Emergency', label: 'طوارئ' }, { value: 'Accessory', label: 'ملحقات' }] },
    ];

    const tabs: { id: ActiveTab; label: string; icon: any; count: number }[] = [
        { id: 'devices', label: 'الأجهزة', icon: Package, count: devices.length },
        { id: 'parts', label: 'قطع الغيار', icon: Cog, count: parts.length },
    ];

    if (loading) {
        return (
            <div className="h-full flex items-center justify-center">
                <div className="flex flex-col items-center gap-3">
                    <Loader2 className="w-8 h-8 text-sky-500 animate-spin" />
                    <span className="text-sm text-gray-500">جاري تحميل البيانات...</span>
                </div>
            </div>
        );
    }

    return (
        <>
            {/* ============ TAB HEADER ============ */}
            <div className="h-full flex flex-col overflow-hidden">
                <div className="bg-white border-b border-gray-200 flex gap-1 px-6 pt-4 shrink-0">
                    {tabs.map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`flex items-center gap-2 px-5 py-3 text-sm font-bold rounded-t-lg transition-all relative top-[1px] ${activeTab === tab.id
                                ? 'bg-slate-50 text-sky-600 border border-gray-200 border-b-slate-50 shadow-sm'
                                : 'text-slate-500 hover:text-slate-700 hover:bg-gray-50'
                                }`}
                        >
                            <tab.icon className="w-4 h-4" />
                            <span>{tab.label}</span>
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${activeTab === tab.id ? 'bg-sky-100 text-sky-600' : 'bg-gray-100 text-gray-500'}`}>
                                {tab.count}
                            </span>
                        </button>
                    ))}
                </div>

                {/* ============ TAB CONTENT ============ */}
                <div className="flex-1 overflow-hidden min-h-0 flex flex-col">
                    {activeTab === 'devices' && (
                        <SmartTable<DeviceModel>
                            title="إدارة الأجهزة وقطع الغيار"
                            icon={Package}
                            data={devices}
                            columns={deviceColumns}
                            filters={deviceFilters}
                            searchKeys={['name', 'brand']}
                            searchPlaceholder="بحث عن جهاز..."
                            getId={(d) => d.id}
                            headerActions={
                                <button onClick={() => setIsAddingDevice(true)} className="flex items-center gap-2 bg-sky-600 hover:bg-sky-500 text-white px-4 py-2 rounded-lg text-sm font-bold shadow-sm transition-all">
                                    <Plus className="w-4 h-4" /><span>إضافة جهاز</span>
                                </button>
                            }
                            emptyIcon={Package}
                            emptyMessage="لا توجد أجهزة"
                        />
                    )}

                    {activeTab === 'parts' && (
                        <SmartTable<SparePart>
                            title="قطع الغيار"
                            icon={Cog}
                            data={parts}
                            columns={partColumns}
                            filters={partFilters}
                            searchKeys={['name', 'code']}
                            searchPlaceholder="بحث عن قطعة..."
                            getId={(p) => p.id}
                            onRowClick={(p) => openPartForm(p)}
                            headerActions={
                                <button onClick={() => openPartForm()} className="flex items-center gap-2 bg-sky-600 hover:bg-sky-500 text-white px-4 py-2 rounded-lg text-sm font-bold shadow-sm transition-all">
                                    <Plus className="w-4 h-4" /><span>إضافة قطعة</span>
                                </button>
                            }
                            emptyIcon={Cog}
                            emptyMessage="لا توجد قطع غيار"
                        />
                    )}
                </div>
            </div>

            {/* ============ ADD DEVICE MODAL ============ */}
            <AnimatePresence>
                {isAddingDevice && (
                    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-white rounded-xl shadow-xl w-full max-w-lg overflow-hidden text-right" dir="rtl">
                            <div className="p-6 border-b border-gray-100 flex justify-between items-center">
                                <h2 className="text-xl font-bold text-slate-900">إضافة جهاز جديد</h2>
                                <button onClick={() => setIsAddingDevice(false)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
                            </div>
                            <form onSubmit={handleDeviceSubmit} className="p-6 space-y-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">اسم الجهاز</label>
                                    <input type="text" name="name" required value={newDevice.name} onChange={handleDeviceInputChange} className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-sky-500 outline-none text-right placeholder-gray-400 text-sm" placeholder="مثال: فلتر جولدن 7 مراحل" />
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">العلامة التجارية</label>
                                        <input type="text" name="brand" required value={newDevice.brand} onChange={handleDeviceInputChange} className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-sky-500 outline-none text-right text-sm" placeholder="مثال: Golden" />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">السعر (ل.س)</label>
                                        <input type="number" name="basePrice" required value={newDevice.basePrice} onChange={handleDeviceInputChange} className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-sky-500 outline-none text-right text-sm" />
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">الفئة</label>
                                        <div className="flex bg-gray-100 p-1 rounded-lg">
                                            {(['منزلي', 'صناعي', 'تجاري'] as const).map(cat => (
                                                <button type="button" key={cat} onClick={() => setNewDevice(prev => ({ ...prev, category: cat }))}
                                                    className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-all flex items-center justify-center gap-1 ${newDevice.category === cat ? 'bg-white shadow-sm text-sky-600' : 'text-gray-500 hover:text-gray-700'}`}>
                                                    <span>{categoryLabels[cat]?.icon || '📦'}</span>{categoryLabels[cat]?.label || cat}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">دورة الصيانة</label>
                                        <select name="maintenanceInterval" value={newDevice.maintenanceInterval} onChange={handleDeviceInputChange} className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-sky-500 outline-none bg-white text-right text-sm">
                                            <option value="3 أشهر">3 أشهر</option>
                                            <option value="6 أشهر">6 أشهر</option>
                                            <option value="1 سنة">سنة واحدة</option>
                                        </select>
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">الخدمات المدعومة</label>
                                    <div className="flex gap-4">
                                        {[
                                            { id: 'تركيب' as const, icon: <Wrench size={16} />, label: 'تركيب' },
                                            { id: 'صيانة' as const, icon: <PenTool size={16} />, label: 'صيانة' },
                                            { id: 'توصيل' as const, icon: <Truck size={16} />, label: 'توصيل' },
                                        ].map(type => (
                                            <label key={type.id} className={`flex items-center gap-2 px-4 py-2 rounded-lg border cursor-pointer transition-all ${newDevice.supportedVisitTypes?.includes(type.id) ? 'border-sky-500 bg-sky-50 text-sky-700' : 'border-gray-200 hover:bg-gray-50'}`}>
                                                <input type="checkbox" className="hidden" checked={newDevice.supportedVisitTypes?.includes(type.id)} onChange={() => toggleVisitType(type.id)} />
                                                {type.icon}
                                                <span className="text-sm font-medium">{type.label}</span>
                                            </label>
                                        ))}
                                    </div>
                                </div>
                                <div className="pt-4 flex gap-3">
                                    <button type="button" onClick={() => setIsAddingDevice(false)} className="flex-1 px-4 py-2 border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 font-medium text-sm">إلغاء</button>
                                    <button type="submit" className="flex-1 px-4 py-2 bg-sky-600 text-white rounded-lg hover:bg-sky-500 font-medium text-sm">حفظ الجهاز</button>
                                </div>
                            </form>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>

            {/* ============ ADD/EDIT PART MODAL ============ */}
            <AnimatePresence>
                {isAddingPart && (
                    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => { setIsAddingPart(false); setEditingPart(null); }}>
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            className="bg-white rounded-xl shadow-xl w-full max-w-lg overflow-hidden text-right"
                            dir="rtl"
                            onClick={e => e.stopPropagation()}
                        >
                            <div className="p-6 border-b border-gray-100 flex justify-between items-center">
                                <h2 className="text-xl font-bold text-slate-900">{editingPart ? 'تعديل قطعة غيار' : 'إضافة قطعة غيار'}</h2>
                                <button onClick={() => { setIsAddingPart(false); setEditingPart(null); }} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
                            </div>
                            <form onSubmit={handlePartSubmit} className="p-6 space-y-4">
                                {/* Name + Code */}
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">اسم القطعة <span className="text-red-400">*</span></label>
                                        <input type="text" required value={partForm.name || ''} onChange={e => setPartForm(p => ({ ...p, name: e.target.value }))}
                                            className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-sky-500 outline-none text-right text-sm" placeholder="مثال: فلتر PP 5 مايكرون" />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">الرمز (SKU) <span className="text-red-400">*</span></label>
                                        <input type="text" required value={partForm.code || ''} onChange={e => setPartForm(p => ({ ...p, code: e.target.value }))}
                                            className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-sky-500 outline-none font-mono text-sm" dir="ltr" placeholder="SP-XXX" />
                                    </div>
                                </div>

                                {/* Price */}
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">السعر ل.س</label>
                                    <input type="number" value={partForm.basePrice || ''} onChange={e => setPartForm(p => ({ ...p, basePrice: Number(e.target.value) }))}
                                        className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-sky-500 outline-none text-right text-sm" />
                                </div>

                                {/* Type Selector */}
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">نوع الصيانة</label>
                                    <div className="flex gap-2">
                                        {(['Periodic', 'Emergency', 'Accessory'] as const).map(type => {
                                            const tc = partTypeConfig[type];
                                            const isActive = partForm.maintenanceType === type;
                                            return (
                                                <button
                                                    key={type}
                                                    type="button"
                                                    onClick={() => setPartForm(p => ({ ...p, maintenanceType: type }))}
                                                    className={`flex-1 px-3 py-3 rounded-xl border-2 transition-all text-center ${isActive
                                                        ? `${tc.bg} ${tc.border} ${tc.color} shadow-sm`
                                                        : 'bg-white border-gray-200 text-slate-500 hover:border-gray-300'
                                                        }`}
                                                >
                                                    <span className="text-sm font-bold block">{tc.label}</span>
                                                    <span className="text-[10px] opacity-70 block mt-0.5">{tc.hint}</span>
                                                </button>
                                            );
                                        })}
                                    </div>
                                    {partForm.maintenanceType === 'Periodic' && (
                                        <div className="mt-2 flex items-center gap-2 text-[11px] text-blue-600 bg-blue-50 rounded-lg px-3 py-2 border border-blue-100">
                                            <RefreshCw className="w-3.5 h-3.5 shrink-0" />
                                            <span>استخدام هذه القطعة في زيارة سيعيد ضبط عداد الصيانة الدورية للجهاز</span>
                                        </div>
                                    )}
                                </div>

                                {/* Compatible Devices — Multi-select */}
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">الأجهزة المتوافقة</label>
                                    <div className="grid grid-cols-1 gap-2 max-h-40 overflow-y-auto border border-gray-200 rounded-lg p-3 bg-gray-50">
                                        {devices.map(dev => {
                                            const isSelected = partForm.compatibleDeviceIds?.includes(dev.id) || false;
                                            return (
                                                <label
                                                    key={dev.id}
                                                    className={`flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-all ${isSelected ? 'bg-sky-50 border border-sky-200' : 'bg-white border border-gray-100 hover:bg-gray-50'}`}
                                                >
                                                    <input type="checkbox" checked={isSelected} onChange={() => toggleDeviceCompat(dev.id)} className="accent-sky-600 w-4 h-4" />
                                                    <div className="flex-1 min-w-0">
                                                        <span className="text-sm font-medium text-slate-700 block">{dev.name}</span>
                                                        <span className="text-[10px] text-gray-400">{dev.brand} · {categoryLabels[dev.category]?.label || dev.category}</span>
                                                    </div>
                                                    <Gem className={`w-3.5 h-3.5 shrink-0 ${isSelected ? 'text-sky-500' : 'text-gray-300'}`} />
                                                </label>
                                            );
                                        })}
                                    </div>
                                </div>

                                {/* Actions */}
                                <div className="pt-4 flex gap-3">
                                    <button type="button" onClick={() => { setIsAddingPart(false); setEditingPart(null); }} className="flex-1 px-4 py-2 border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 font-medium text-sm">إلغاء</button>
                                    <button type="submit" className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-sky-600 text-white rounded-lg hover:bg-sky-500 font-medium text-sm">
                                        <Save className="w-4 h-4" />
                                        <span>{editingPart ? 'حفظ التعديلات' : 'إضافة القطعة'}</span>
                                    </button>
                                </div>
                            </form>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </>
    );
};

export default DeviceManagement;
