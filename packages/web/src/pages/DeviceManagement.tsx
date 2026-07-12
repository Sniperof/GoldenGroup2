import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Plus, Wrench, PenTool, GraduationCap, Truck, Package, Cog, X, Save,
    RefreshCw, Gem, Loader2, Image, Video, FileText, Star, ChevronRight,
    AlertCircle, Pencil, Tag, ToggleLeft, ToggleRight,
} from 'lucide-react';
import IconButton from '../components/ui/IconButton';
import Modal from '../components/ui/Modal';
import { api } from '../lib/api';
import type { DeviceModel, SparePart, MaintenancePartType, CatalogPriceHistoryEntry } from '../lib/types';
import { motion, AnimatePresence } from 'framer-motion';
import SmartTable from '../components/SmartTable';
import type { ColumnDef, FilterDef } from '../components/SmartTable';
import { usePermissions } from '../hooks/usePermissions';

/* ------------------------------------------------------------------ */
/*  Shared Config                                                       */
/* ------------------------------------------------------------------ */

const categoryLabels: Record<string, { label: string; icon: string; color: string }> = {
    'منزلي': { label: 'منزلي', icon: '🏠', color: 'bg-green-100 text-green-800' },
    'صناعي': { label: 'صناعي', icon: '🏭', color: 'bg-orange-100 text-orange-800' },
};


const serviceLabels: Record<string, { label: string; icon: string; color: string }> = {
    'تسليم': { label: 'تسليم', icon: '🚚', color: 'bg-sky-100 text-sky-800' },
    'تركيب': { label: 'تركيب', icon: '🔧', color: 'bg-blue-100 text-blue-800' },
    'صيانة': { label: 'صيانة', icon: '🛠️', color: 'bg-orange-100 text-orange-800' },
    'تعليم': { label: 'تعليم', icon: '🎓', color: 'bg-amber-100 text-amber-800' },
};

const supportedServiceOptions = [
    { id: 'تسليم', icon: <Truck size={16} />, label: 'تسليم', desc: 'تسليم الجهاز للعميل' },
    { id: 'تركيب', icon: <Wrench size={16} />, label: 'تركيب', desc: 'تركيب الجهاز' },
    { id: 'صيانة', icon: <PenTool size={16} />, label: 'صيانة', desc: 'صيانة دورية وطوارئ' },
    { id: 'تعليم', icon: <GraduationCap size={16} />, label: 'تعليم', desc: 'تعليم استخدام الجهاز' },
] satisfies Array<{ id: DeviceModel['supportedVisitTypes'][number]; icon: React.ReactNode; label: string; desc: string }>;

const warrantyPeriodOptions: Array<{ months: number; label: string }> = [
    { months: 3,  label: '3 أشهر'  },
    { months: 6,  label: '6 أشهر'  },
    { months: 9,  label: '9 أشهر'  },
    { months: 12, label: '12 شهرًا' },
    { months: 24, label: '24 شهرًا' },
    { months: 36, label: '36 شهرًا' },
];

type DeviceAttachment = { id: string; name: string; url: string };
type SupportedVisitType = DeviceModel['supportedVisitTypes'][number];

const partTypeConfig: Record<MaintenancePartType, { label: string; color: string; bg: string; border: string; hint: string }> = {
    Periodic: { label: 'دورية', color: 'text-blue-700', bg: 'bg-blue-50', border: 'border-blue-200', hint: 'يعيد ضبط عداد الصيانة الدورية' },
    Emergency: { label: 'طوارئ', color: 'text-red-700', bg: 'bg-red-50', border: 'border-red-200', hint: 'قطعة بديلة للأعطال الطارئة' },
    Accessory: { label: 'ملحقات', color: 'text-purple-700', bg: 'bg-purple-50', border: 'border-purple-200', hint: 'ملحق إضافي غير إلزامي' },
};

const formatPrice = (n: number) =>
    new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(n) + ' ل.س';

const formatPriceMoment = (value?: string | null) => {
    if (!value) return 'مستمر';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value).slice(0, 16);
    return new Intl.DateTimeFormat('en-GB', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    }).format(date);
};

function CatalogStatusPill({ isActive }: { isActive?: boolean }) {
    return isActive === false ? (
        <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-700">
            غير نشط
        </span>
    ) : (
        <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700">
            نشط
        </span>
    );
}

type ActiveTab = 'devices' | 'parts';

const emptyDeviceForm = (): Partial<DeviceModel> => ({
    name: '',
    nameAr: '',
    nameEn: '',
    brand: '',
    category: 'صناعي',
    maintenanceInterval: '6 أشهر',
    basePrice: 0,
    supportedVisitTypes: [],
    isGoldenWarranty: false,
    goldenWarrantyPeriods: [],
    warrantyPeriods: [],
    isFeatured: false,
    description: '',
    descriptionEn: null,
    code: '',
    images: [],
    primaryImageId: null,
    videos: [],
    documents: [],
    isActive: true,
});

function makeAttachmentId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function readFileAsDataUrl(file: File): Promise<DeviceAttachment> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve({ id: makeAttachmentId(), name: file.name, url: String(reader.result || '') });
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
    });
}

/* ------------------------------------------------------------------ */
/*  Media Attachment Sections                                           */
/* ------------------------------------------------------------------ */

function ImageGrid({ images, primaryImageId, onSetPrimary, onRemove }: {
    images: DeviceAttachment[];
    primaryImageId: string | null | undefined;
    onSetPrimary: (id: string) => void;
    onRemove: (id: string) => void;
}) {
    if (images.length === 0) return null;
    return (
        <div className="grid grid-cols-3 gap-2 mt-2">
            {images.map(img => (
                <div key={img.id} className={`relative group rounded-lg overflow-hidden border-2 transition-all ${img.id === primaryImageId ? 'border-amber-400' : 'border-slate-200'}`}>
                    <img src={img.url} alt={img.name} className="w-full h-20 object-cover" />
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1">
                        <button type="button" onClick={() => onSetPrimary(img.id)}
                            className={`p-1 rounded-full ${img.id === primaryImageId ? 'bg-amber-400 text-white' : 'bg-white/80 text-slate-600 hover:bg-amber-400 hover:text-white'}`}
                            title="الصورة الرئيسية">
                            <Star className="w-3.5 h-3.5" />
                        </button>
                        <IconButton icon={X} label="حذف" variant="danger" size="sm" shape="circle" onClick={() => onRemove(img.id)} />
                    </div>
                    {img.id === primaryImageId && (
                        <div className="absolute top-1 right-1 bg-amber-400 text-white text-xs font-bold px-1.5 py-0.5 rounded-full">رئيسية</div>
                    )}
                </div>
            ))}
        </div>
    );
}

function VideoList({ videos, onRemove }: { videos: DeviceAttachment[]; onRemove: (id: string) => void }) {
    if (videos.length === 0) return null;
    return (
        <div className="space-y-2 mt-2">
            {videos.map(vid => (
                <div key={vid.id} className="rounded-lg overflow-hidden border border-slate-200 bg-slate-50">
                    <video src={vid.url} controls className="w-full max-h-32 object-contain bg-black" />
                    <div className="flex items-center justify-between px-2 py-1">
                        <span className="text-xs text-slate-500 truncate">{vid.name}</span>
                        <IconButton icon={X} label="حذف" variant="danger" size="sm" onClick={() => onRemove(vid.id)} />
                    </div>
                </div>
            ))}
        </div>
    );
}

function DocumentList({ documents, onRemove }: { documents: DeviceAttachment[]; onRemove: (id: string) => void }) {
    if (documents.length === 0) return null;
    return (
        <div className="space-y-1.5 mt-2">
            {documents.map(doc => {
                const isPdf = doc.name.toLowerCase().endsWith('.pdf');
                const isImage = doc.url.startsWith('data:image');
                return (
                    <div key={doc.id} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-50 border border-slate-200">
                        {isImage
                            ? <img src={doc.url} alt={doc.name} className="w-8 h-8 object-cover rounded" />
                            : <div className={`w-8 h-8 rounded flex items-center justify-center text-white text-xs font-bold ${isPdf ? 'bg-red-500' : 'bg-blue-500'}`}>{isPdf ? 'PDF' : 'DOC'}</div>
                        }
                        <span className="text-xs text-slate-600 flex-1 truncate">{doc.name}</span>
                        <IconButton icon={X} label="حذف" variant="danger" size="sm" onClick={() => onRemove(doc.id)} />
                    </div>
                );
            })}
        </div>
    );
}

/* ------------------------------------------------------------------ */
/*  Add Device Page                                                     */
/* ------------------------------------------------------------------ */

function normalizeDeviceForm(device?: DeviceModel | null): Partial<DeviceModel> {
    if (!device) return emptyDeviceForm();
    return {
        ...emptyDeviceForm(),
        ...device,
        name: device.nameAr || device.name,
        nameAr: device.nameAr || device.name,
        nameEn: device.nameEn || device.brand || '',
        brand: device.nameEn || device.brand || '',
        code: device.code || '',
        description: device.description || '',
        descriptionEn: device.descriptionEn || '',
        images: device.images || [],
        primaryImageId: device.primaryImageId || null,
        videos: device.videos || [],
        documents: device.documents || [],
        isActive: device.isActive !== false,
        supportedVisitTypes: device.supportedVisitTypes || [],
        goldenWarrantyPeriods: device.goldenWarrantyPeriods || [],
        warrantyPeriods: device.warrantyPeriods || [],
    };
}

function AddDevicePage({ device, onCancel, onSaved }: { device?: DeviceModel | null; onCancel: () => void; onSaved: (savedDevice?: DeviceModel) => void }) {
    const isEditing = !!device;
    const [newDevice, setNewDevice] = useState<Partial<DeviceModel>>(() => normalizeDeviceForm(device));
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [wpMonths, setWpMonths] = useState('');
    const [wpVisits, setWpVisits] = useState('');

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
        const { name, value } = e.target;
        setNewDevice(prev => ({ ...prev, [name]: value }));
    };

    const toggleVisitType = (type: SupportedVisitType) => {
        setNewDevice(prev => {
            const current = prev.supportedVisitTypes || [];
            return { ...prev, supportedVisitTypes: current.includes(type) ? current.filter(t => t !== type) : [...current, type] };
        });
    };

    const toggleWarrantyPeriod = (period: { months: number; label: string }) => {
        setNewDevice(prev => {
            const current = prev.goldenWarrantyPeriods || [];
            const exists = current.some(p => p.months === period.months);
            return { ...prev, goldenWarrantyPeriods: exists ? current.filter(p => p.months !== period.months) : [...current, period] };
        });
    };

    const addWarrantyPeriod = () => {
        const months = parseInt(wpMonths, 10);
        const visits = parseInt(wpVisits, 10);
        if (!months || months <= 0 || !visits || visits <= 0) return;
        const alreadyExists = (newDevice.warrantyPeriods || []).some(p => p.months === months);
        if (alreadyExists) return;
        const label = months === 1 ? 'شهر' : months < 11 ? `${months} أشهر` : `${months} شهرًا`;
        setNewDevice(prev => ({
            ...prev,
            warrantyPeriods: [...(prev.warrantyPeriods || []), { months, label, visits }].sort((a, b) => a.months - b.months),
        }));
        setWpMonths('');
        setWpVisits('');
    };

    const removeWarrantyPeriod = (months: number) => {
        setNewDevice(prev => ({ ...prev, warrantyPeriods: (prev.warrantyPeriods || []).filter(p => p.months !== months) }));
    };

    const addAttachments = async (field: 'images' | 'videos' | 'documents', files: FileList | null) => {
        if (!files || files.length === 0) return;
        const attachments = await Promise.all(Array.from(files).map(readFileAsDataUrl));
        setNewDevice(prev => {
            const current = (prev[field] || []) as DeviceAttachment[];
            const next = [...current, ...attachments];
            return {
                ...prev,
                [field]: next,
                primaryImageId: field === 'images' && !prev.primaryImageId && next[0] ? next[0].id : prev.primaryImageId,
            };
        });
    };

    const removeAttachment = (field: 'images' | 'videos' | 'documents', id: string) => {
        setNewDevice(prev => {
            const next = ((prev[field] || []) as DeviceAttachment[]).filter(item => item.id !== id);
            return {
                ...prev,
                [field]: next,
                primaryImageId: field === 'images' && prev.primaryImageId === id ? (next[0]?.id || null) : prev.primaryImageId,
            };
        });
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const nameAr = (newDevice.nameAr || newDevice.name || '').trim();
        const nameEn = (newDevice.nameEn || '').trim();
        const basePrice = Number(newDevice.basePrice) || 0;
        if (!nameAr) { setError('اسم الجهاز بالعربية مطلوب'); return; }
        if (!nameEn) { setError('اسم الجهاز بالإنكليزية مطلوب'); return; }
        if (basePrice <= 0) { setError('السعر الأساسي مطلوب'); return; }
        if (newDevice.isGoldenWarranty && (newDevice.goldenWarrantyPeriods?.length || 0) === 0) {
            setError('يرجى تحديد فترة الكفالة الذهبية'); return;
        }
        setError('');
        setSaving(true);
        try {
            const payload = {
                ...newDevice,
                name: nameAr,
                nameAr,
                nameEn,
                brand: nameEn,
                code: newDevice.code || null,
                category: newDevice.category,
                maintenanceInterval: newDevice.maintenanceInterval,
                basePrice,
                supportedVisitTypes: newDevice.supportedVisitTypes || [],
                descriptionEn: newDevice.descriptionEn || null,
            };
            const saved = isEditing && device
                ? await api.deviceModels.update(device.id, payload)
                : await api.deviceModels.create(payload);
            onSaved(saved);
        } catch (err) {
            console.error('Failed to save device:', err);
            setError('حدث خطأ أثناء الحفظ');
        } finally {
            setSaving(false);
        }
    };

    const images = (newDevice.images || []) as DeviceAttachment[];
    const videos = (newDevice.videos || []) as DeviceAttachment[];
    const documents = (newDevice.documents || []) as DeviceAttachment[];

    return (
        <motion.div
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 40 }}
            className="flex-1 overflow-hidden flex flex-col bg-slate-50 min-h-0"
            dir="rtl"
        >
            {/* Page header */}
            <div className="bg-white border-b border-slate-200 px-6 py-4 shrink-0 flex items-center gap-3">
                <button onClick={onCancel} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 transition-colors">
                    <ChevronRight className="w-4 h-4" />
                    <span>الأجهزة</span>
                </button>
                <span className="text-slate-300">/</span>
                <span className="text-sm font-semibold text-slate-800">{isEditing ? 'تعديل الجهاز' : 'إضافة جهاز جديد'}</span>
            </div>

            {/* Form content */}
            <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto">
                <div className="max-w-4xl mx-auto px-6 py-6 space-y-6">

                    {error && (
                        <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
                            <AlertCircle className="w-4 h-4 shrink-0" />
                            {error}
                        </div>
                    )}

                    {/* ── Section: الأسماء والسعر ── */}
                    <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
                        <h3 className="text-base font-bold text-slate-800 border-b border-slate-100 pb-3">معلومات الجهاز الأساسية</h3>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1.5">اسم الجهاز بالعربية <span className="text-red-500">*</span></label>
                                <input
                                    type="text" name="nameAr" required
                                    value={newDevice.nameAr || ''}
                                    onChange={handleInputChange}
                                    className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:ring-2 focus:ring-sky-500 outline-none text-right text-sm"
                                    placeholder="مثال: فلتر جولدن 7 مراحل"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1.5">اسم الجهاز بالإنكليزية <span className="text-red-500">*</span></label>
                                <input
                                    type="text" name="nameEn"
                                    value={newDevice.nameEn || ''}
                                    onChange={handleInputChange}
                                    className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:ring-2 focus:ring-sky-500 outline-none text-left text-sm"
                                    dir="ltr" placeholder="Golden 7 Stage Filter"
                                />
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1.5">الرمز</label>
                            <input
                                type="text" name="code"
                                value={newDevice.code || ''}
                                onChange={handleInputChange}
                                className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:ring-2 focus:ring-sky-500 outline-none text-left text-sm"
                                dir="ltr"
                                placeholder="مثال: GW-7H-2025"
                            />
                            <p className="text-xs text-slate-400 mt-1">رمز داخلي اختياري للجهاز</p>
                        </div>

                        <div className="grid grid-cols-1 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1.5">السعر الأساسي <span className="text-red-500">*</span></label>
                                <div className="relative">
                                    <input
                                        type="number" name="basePrice" required min={1}
                                        value={newDevice.basePrice || ''}
                                        onChange={handleInputChange}
                                        disabled={isEditing}
                                        className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:ring-2 focus:ring-sky-500 outline-none text-sm pr-12 disabled:bg-slate-50 disabled:text-slate-400"
                                    />
                                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 pointer-events-none">ل.س</span>
                                </div>
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1.5">وصف الجهاز</label>
                            <textarea
                                name="description"
                                value={newDevice.description || ''}
                                onChange={handleInputChange}
                                rows={3}
                                className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:ring-2 focus:ring-sky-500 outline-none text-right text-sm resize-none"
                                placeholder="وصف مختصر عن الجهاز..."
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1.5">وصف الجهاز بالإنكليزية</label>
                            <textarea
                                name="descriptionEn"
                                value={newDevice.descriptionEn || ''}
                                onChange={handleInputChange}
                                rows={3}
                                className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:ring-2 focus:ring-sky-500 outline-none text-left text-sm resize-none"
                                dir="ltr"
                                placeholder="English description..."
                            />
                        </div>
                    </div>

                    {/* ── Section: التصنيف والصيانة ── */}
                    <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
                        <h3 className="text-base font-bold text-slate-800 border-b border-slate-100 pb-3">التصنيف والصيانة</h3>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-2">الفئة</label>
                                <div className="flex bg-slate-100 p-1 rounded-lg gap-1">
                                    {(['منزلي', 'صناعي'] as const).map(cat => (
                                        <button
                                            type="button" key={cat}
                                            onClick={() => setNewDevice(prev => ({ ...prev, category: cat }))}
                                            className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-all flex items-center justify-center gap-1.5
                                                ${newDevice.category === cat ? 'bg-white shadow text-sky-600' : 'text-slate-500 hover:text-slate-700'}`}
                                        >
                                            <span className="text-base">{categoryLabels[cat].icon}</span>
                                            {categoryLabels[cat].label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                        </div>

                        {/* الخدمات المدعومة */}
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-2">الخدمات المدعومة</label>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                                {supportedServiceOptions.map(type => {
                                    const active = (newDevice.supportedVisitTypes as string[] || []).includes(type.id);
                                    return (
                                        <button
                                            type="button" key={type.id}
                                            onClick={() => toggleVisitType(type.id)}
                                            className={`flex flex-col items-center gap-1.5 px-3 py-3 rounded-xl border-2 transition-all text-center
                                                ${active ? 'border-sky-400 bg-sky-50 text-sky-700' : 'border-slate-200 bg-white text-slate-400 hover:border-slate-300 hover:text-slate-600'}`}
                                        >
                                            <span className={active ? 'text-sky-600' : 'text-slate-400'}>{type.icon}</span>
                                            <span className="text-xs font-bold">{type.label}</span>
                                            <span className="text-xs opacity-70">{type.desc}</span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    </div>

                    {/* ── Section: الكفالة والعروض ── */}
                    <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
                        <h3 className="text-base font-bold text-slate-800 border-b border-slate-100 pb-3">الكفالة والعروض</h3>

                        {/* Contract warranty periods */}
                        <div className="space-y-2">
                            <label className="block text-xs font-bold text-slate-600 uppercase tracking-wide">فترات كفالة العقد</label>
                            <p className="text-xs text-slate-400">حدد الفترات المتاحة لهذا الجهاز — كل فترة تتضمن عدد زيارات الصيانة خلالها</p>

                            {(newDevice.warrantyPeriods || []).length > 0 && (
                                <div className="space-y-1.5">
                                    {(newDevice.warrantyPeriods || []).map(p => {
                                        const intervalDays = Math.round((p.months * 30) / p.visits);
                                        return (
                                            <div key={p.months} className="flex items-center justify-between bg-sky-50 border border-sky-200 rounded-lg px-3 py-2">
                                                <div className="flex items-center gap-3">
                                                    <span className="text-xs font-bold text-sky-700">{p.label}</span>
                                                    <span className="text-xs text-slate-500">{p.visits} زيارة · كل {intervalDays} يوم</span>
                                                </div>
                                                <IconButton icon={X} label="حذف" variant="danger" size="sm" onClick={() => removeWarrantyPeriod(p.months)} />
                                            </div>
                                        );
                                    })}
                                </div>
                            )}

                            <div className="flex gap-2">
                                <input
                                    type="number" min={1} placeholder="المدة (أشهر)"
                                    value={wpMonths}
                                    onChange={e => setWpMonths(e.target.value)}
                                    className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:border-sky-400 focus:outline-none"
                                />
                                <input
                                    type="number" min={1} placeholder="عدد الزيارات"
                                    value={wpVisits}
                                    onChange={e => setWpVisits(e.target.value)}
                                    className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:border-sky-400 focus:outline-none"
                                />
                                <button
                                    type="button" onClick={addWarrantyPeriod}
                                    disabled={!wpMonths || !wpVisits}
                                    className="px-3 py-2 rounded-lg bg-sky-500 text-white text-xs font-bold hover:bg-sky-600 disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                    <Plus className="w-4 h-4" />
                                </button>
                            </div>
                        </div>

                        <div className="border-t border-slate-100 pt-3 space-y-3">
                        <label className="flex items-center justify-between rounded-xl border border-slate-200 px-4 py-3 cursor-pointer hover:bg-slate-50 transition-colors">
                            <div>
                                <span className="text-sm font-semibold text-slate-700 block">الكفالة الذهبية</span>
                                <span className="text-xs text-slate-400">الجهاز مشمول بالكفالة الذهبية</span>
                            </div>
                            <div className="relative">
                                <input
                                    type="checkbox"
                                    checked={newDevice.isGoldenWarranty || false}
                                    onChange={(e) => setNewDevice(prev => ({ ...prev, isGoldenWarranty: e.target.checked, goldenWarrantyPeriods: e.target.checked ? prev.goldenWarrantyPeriods : [] }))}
                                    className="w-5 h-5 accent-sky-600"
                                />
                            </div>
                        </label>

                        {newDevice.isGoldenWarranty && (
                            <div className="px-2 space-y-2">
                                <label className="block text-xs font-medium text-slate-600">اختر فترات الكفالة الذهبية المتاحة</label>
                                <div className="flex flex-wrap gap-2">
                                    {warrantyPeriodOptions.map(period => (
                                        <button
                                            type="button" key={period.months}
                                            onClick={() => toggleWarrantyPeriod(period)}
                                            className={`px-4 py-2 rounded-lg border-2 text-xs font-bold transition-all
                                                ${newDevice.goldenWarrantyPeriods?.some(p => p.months === period.months)
                                                    ? 'bg-amber-50 border-amber-400 text-amber-700 shadow-sm'
                                                    : 'border-slate-200 text-slate-500 hover:border-amber-200 hover:text-amber-600'}`}
                                        >
                                            {period.label}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                        </div>

                        <label className="flex items-center justify-between rounded-xl border border-slate-200 px-4 py-3 cursor-pointer hover:bg-slate-50 transition-colors">
                            <div>
                                <span className="text-sm font-semibold text-slate-700 block">جهاز بارز</span>
                                <span className="text-xs text-slate-400">يظهر في قائمة الأجهزة المُركّز عليها</span>
                            </div>
                            <input
                                type="checkbox"
                                checked={newDevice.isFeatured || false}
                                onChange={(e) => setNewDevice(prev => ({ ...prev, isFeatured: e.target.checked }))}
                                className="w-5 h-5 accent-sky-600"
                            />
                        </label>
                    </div>

                    {/* ── Section: الوسائط ── */}
                    <div className="bg-white rounded-xl border border-slate-200 p-5">
                        <h3 className="text-base font-bold text-slate-800 border-b border-slate-100 pb-3 mb-4">الصور والوسائط</h3>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                            {/* Images */}
                            <div>
                                <label className="flex items-center gap-2 text-sm font-semibold text-slate-700 mb-2">
                                    <Image className="w-4 h-4 text-sky-500" /> صور الجهاز
                                </label>
                                <label className="flex flex-col items-center justify-center gap-1.5 h-20 rounded-xl border-2 border-dashed border-slate-300 hover:border-sky-400 hover:bg-sky-50 cursor-pointer transition-all text-slate-400 hover:text-sky-500">
                                    <Plus className="w-5 h-5" />
                                    <span className="text-xs font-medium">إضافة صور</span>
                                    <input type="file" multiple accept="image/*" className="hidden" onChange={e => addAttachments('images', e.target.files)} />
                                </label>
                                <ImageGrid
                                    images={images}
                                    primaryImageId={newDevice.primaryImageId}
                                    onSetPrimary={id => setNewDevice(prev => ({ ...prev, primaryImageId: id }))}
                                    onRemove={id => removeAttachment('images', id)}
                                />
                            </div>

                            {/* Videos */}
                            <div>
                                <label className="flex items-center gap-2 text-sm font-semibold text-slate-700 mb-2">
                                    <Video className="w-4 h-4 text-purple-500" /> فيديوهات
                                </label>
                                <label className="flex flex-col items-center justify-center gap-1.5 h-20 rounded-xl border-2 border-dashed border-slate-300 hover:border-purple-400 hover:bg-purple-50 cursor-pointer transition-all text-slate-400 hover:text-purple-500">
                                    <Plus className="w-5 h-5" />
                                    <span className="text-xs font-medium">إضافة فيديو</span>
                                    <input type="file" multiple accept="video/*" className="hidden" onChange={e => addAttachments('videos', e.target.files)} />
                                </label>
                                <VideoList videos={videos} onRemove={id => removeAttachment('videos', id)} />
                            </div>

                            {/* Documents */}
                            <div>
                                <label className="flex items-center gap-2 text-sm font-semibold text-slate-700 mb-2">
                                    <FileText className="w-4 h-4 text-emerald-500" /> مستندات
                                </label>
                                <label className="flex flex-col items-center justify-center gap-1.5 h-20 rounded-xl border-2 border-dashed border-slate-300 hover:border-emerald-400 hover:bg-emerald-50 cursor-pointer transition-all text-slate-400 hover:text-emerald-500">
                                    <Plus className="w-5 h-5" />
                                    <span className="text-xs font-medium">إضافة مستند</span>
                                    <input type="file" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,image/*" className="hidden" onChange={e => addAttachments('documents', e.target.files)} />
                                </label>
                                <DocumentList documents={documents} onRemove={id => removeAttachment('documents', id)} />
                            </div>
                        </div>
                    </div>

                    {/* ── Actions ── */}
                    <div className="flex gap-3 pb-6">
                        <button type="button" onClick={onCancel} className="flex-1 px-6 py-3 border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 font-semibold text-sm transition-colors">
                            إلغاء
                        </button>
                        <button
                            type="submit" disabled={saving}
                            className="flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-sky-600 text-white rounded-xl hover:bg-sky-500 font-semibold text-sm transition-colors disabled:opacity-60"
                        >
                            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                            {saving ? 'جاري الحفظ...' : isEditing ? 'حفظ التعديلات' : 'حفظ الجهاز'}
                        </button>
                    </div>
                </div>
            </form>
        </motion.div>
    );
}

/* ------------------------------------------------------------------ */
/*  Spare Part Prices Modal                                             */
/* ------------------------------------------------------------------ */

function SparePartPricesModal({ part, onClose, onSaved }: {
    part: SparePart;
    onClose: () => void;
    onSaved: () => void;
}) {
    const [prices, setPrices] = useState<CatalogPriceHistoryEntry[]>([]);
    const [price, setPrice] = useState(String(part.basePrice || ''));
    const [note, setNote] = useState('');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    const loadPrices = async () => {
        setLoading(true);
        try {
            setPrices(await api.spareParts.getPrices(part.id));
        } catch {
            setPrices([]);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadPrices();
    }, [part.id]);

    const handleSave = async () => {
        const numericPrice = Number(price);
        if (!Number.isFinite(numericPrice) || numericPrice <= 0) {
            setError('السعر يجب أن يكون أكبر من صفر');
            return;
        }

        setSaving(true);
        setError('');
        try {
            await api.spareParts.createPrice(part.id, {
                price: numericPrice,
                note: note.trim() || null,
            });
            setNote('');
            await loadPrices();
            onSaved();
        } catch (err: any) {
            setError(err?.message || 'تعذر حفظ السعر');
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal
            isOpen
            onClose={onClose}
            size="4xl"
            title="سجل أسعار قطعة الصيانة"
            subtitle={`${part.name} · ${part.code}`}
            bodyClassName="bg-slate-50/60"
        >
                <div className="space-y-4 px-5 py-5">
                    <div className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 md:grid-cols-[180px_1fr_auto]">
                        <div>
                            <label className="mb-1.5 block text-sm font-bold text-slate-700">السعر الجديد</label>
                            <input
                                type="number"
                                min={1}
                                value={price}
                                onChange={e => setPrice(e.target.value)}
                                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-500"
                            />
                        </div>
                        <div>
                            <label className="mb-1.5 block text-sm font-bold text-slate-700">ملاحظة</label>
                            <input
                                type="text"
                                value={note}
                                onChange={e => setNote(e.target.value)}
                                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-500"
                                placeholder="سبب تغيير السعر أو مرجع القرار"
                            />
                        </div>
                        <div className="flex items-end">
                            <button
                                type="button"
                                onClick={handleSave}
                                disabled={saving}
                                className="inline-flex h-10 items-center gap-2 rounded-lg bg-sky-600 px-4 text-sm font-bold text-white hover:bg-sky-500 disabled:opacity-60"
                            >
                                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                                إضافة سعر
                            </button>
                        </div>
                    </div>

                    {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

                    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                        <table className="min-w-full divide-y divide-slate-100 text-sm">
                            <thead className="bg-slate-50 text-slate-600">
                                <tr>
                                    <th className="px-4 py-3 text-right font-bold">السعر</th>
                                    <th className="px-4 py-3 text-right font-bold">من لحظة</th>
                                    <th className="px-4 py-3 text-right font-bold">حتى لحظة</th>
                                    <th className="px-4 py-3 text-right font-bold">الحالة</th>
                                    <th className="px-4 py-3 text-right font-bold">ملاحظة</th>
                                    <th className="px-4 py-3 text-right font-bold">أضيف بواسطة</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 bg-white">
                                {loading ? (
                                    <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">جاري التحميل...</td></tr>
                                ) : prices.length === 0 ? (
                                    <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">لا يوجد سجل أسعار بعد.</td></tr>
                                ) : prices.map(entry => (
                                    <tr key={entry.id}>
                                        <td className="px-4 py-3 font-mono font-bold text-slate-800">{formatPrice(entry.price)}</td>
                                        <td className="px-4 py-3 text-xs text-slate-500">{formatPriceMoment(entry.effectiveFrom)}</td>
                                        <td className="px-4 py-3 text-xs text-slate-500">{formatPriceMoment(entry.effectiveTo)}</td>
                                        <td className="px-4 py-3">
                                            <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-bold ${entry.isCurrent ? 'bg-sky-50 text-sky-700' : 'bg-slate-100 text-slate-500'}`}>
                                                {entry.isCurrent ? 'فعال الآن' : 'تاريخي'}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-xs text-slate-500">{entry.note || '-'}</td>
                                        <td className="px-4 py-3 text-xs text-slate-500">{entry.createdByName || '-'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
        </Modal>
    );
}

/* ------------------------------------------------------------------ */
/*  Component                                                           */
/* ------------------------------------------------------------------ */

const DeviceManagement = () => {
    const navigate = useNavigate();
    const { hasAnyPermission } = usePermissions();
    const canManageDeviceModels = hasAnyPermission('device_models.manage', 'catalog.manage', 'devices.manage');
    const canManageSpareParts = hasAnyPermission('spare_parts.manage', 'catalog.manage', 'devices.manage');
    const canManageSparePartPrices = hasAnyPermission('spare_parts.prices.manage', 'catalog.manage');
    const [activeTab, setActiveTab] = useState<ActiveTab>('devices');
    const [loading, setLoading] = useState(true);

    const [devices, setDevices] = useState<DeviceModel[]>([]);
    const [isAddingDevice, setIsAddingDevice] = useState(false);
    const [editingDevice, setEditingDevice] = useState<DeviceModel | null>(null);

    const [parts, setParts] = useState<SparePart[]>([]);
    const [isAddingPart, setIsAddingPart] = useState(false);
    const [editingPart, setEditingPart] = useState<SparePart | null>(null);
    const [pricingPart, setPricingPart] = useState<SparePart | null>(null);
    const [partForm, setPartForm] = useState<Partial<SparePart>>({
        name: '', code: '', basePrice: 0, maintenanceType: 'Periodic', compatibleDeviceIds: [],
    });

    const fetchData = async () => {
        try {
            setLoading(true);
            const [devicesData, partsData] = await Promise.all([
                api.deviceModels.list({ includeInactive: true }),
                api.spareParts.list({ includeInactive: true }),
            ]);
            setDevices(devicesData);
            setParts(partsData);
        } catch (err) {
            console.error('Failed to fetch device management data:', err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchData(); }, []);

    const openCreateDevice = () => {
        if (!canManageDeviceModels) return;
        setEditingDevice(null);
        setIsAddingDevice(true);
    };

    const openEditDevice = (device: DeviceModel) => {
        if (!canManageDeviceModels) return;
        setEditingDevice(device);
        setIsAddingDevice(true);
    };

    const closeDeviceForm = () => {
        setIsAddingDevice(false);
        setEditingDevice(null);
    };

    const openPartForm = (part?: SparePart) => {
        if (!canManageSpareParts) return;
        if (part) {
            setEditingPart(part);
            setPartForm({ ...part });
        } else {
            setEditingPart(null);
            setPartForm({ name: '', code: '', basePrice: 0, maintenanceType: 'Periodic', compatibleDeviceIds: [], isActive: true });
        }
        setIsAddingPart(true);
    };

    const openPartPrices = (part: SparePart) => {
        if (!canManageSparePartPrices) return;
        setPricingPart(part);
    };

    const toggleDeviceCompat = (deviceId: number) => {
        setPartForm(prev => {
            const current = prev.compatibleDeviceIds || [];
            return { ...prev, compatibleDeviceIds: current.includes(deviceId) ? current.filter(id => id !== deviceId) : [...current, deviceId] };
        });
    };

    const handlePartSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!canManageSpareParts) return;
        if (!partForm.name || !partForm.code) return;
        try {
            const partData = {
                name: partForm.name!,
                code: partForm.code!,
                basePrice: Number(partForm.basePrice) || 0,
                maintenanceType: partForm.maintenanceType as MaintenancePartType || 'Periodic',
                compatibleDeviceIds: partForm.compatibleDeviceIds || [],
                isActive: partForm.isActive !== false,
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

    const toggleDeviceActive = async (device: DeviceModel) => {
        if (!canManageDeviceModels) return;
        try {
            await api.deviceModels.update(device.id, { ...device, isActive: device.isActive === false });
            await fetchData();
        } catch (err) {
            console.error('Failed to update device active state:', err);
        }
    };

    const togglePartActive = async (part: SparePart) => {
        if (!canManageSpareParts) return;
        try {
            await api.spareParts.update(part.id, { ...part, isActive: part.isActive === false });
            await fetchData();
        } catch (err) {
            console.error('Failed to update spare part active state:', err);
        }
    };

    // ──── Columns ────
    const deviceColumns: ColumnDef<DeviceModel>[] = [
        {
            key: 'name', label: 'اسم الجهاز', sortable: true,
            render: (d) => (
                <div>
                    <span className="font-semibold text-slate-700 block text-sm">{d.nameAr || d.name}</span>
                    <span className="text-xs text-slate-400 font-mono">#{String(d.id).padStart(4, '0')}</span>
                </div>
            ),
        },
        {
            key: 'brand', label: 'الاسم الإنكليزي', sortable: true,
            render: (d) => <span className="text-sm text-slate-600">{d.nameEn || d.brand || '—'}</span>,
        },
        {
            key: 'category', label: 'الفئة', sortable: true,
            render: (d) => {
                const cat = categoryLabels[d.category] || { label: d.category, icon: '📦', color: 'bg-slate-100 text-slate-800' };
                return (
                    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium gap-1.5 ${cat.color}`}>
                        <span className="text-xs">{cat.icon}</span>{cat.label}
                    </span>
                );
            },
        },
        {
            key: 'basePrice', label: 'السعر', sortable: true,
            render: (d) => (
                <div className="text-sm">
                    <span className="font-mono text-slate-700 font-medium block">{formatPrice(d.basePrice)}</span>
                </div>
            ),
        },
        {
            key: 'supportedVisitTypes', label: 'الخدمات',
            render: (d) => (
                <div className="flex gap-1.5 flex-wrap">
                    {(d.supportedVisitTypes as string[]).map(type => {
                        const S = serviceLabels[type];
                        if (!S) return null;
                        return (
                            <div key={type} title={S.label} className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium cursor-help ${S.color}`}>
                                <span>{S.icon}</span><span>{S.label}</span>
                            </div>
                        );
                    })}
                </div>
            ),
        },
        {
            key: 'isFeatured', label: 'بارز',
            render: (d) => d.isFeatured
                ? <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-sky-100 text-sky-700">بارز</span>
                : null,
        },
        {
            key: 'isActive', label: 'الحالة', sortable: true,
            getValue: (d) => d.isActive === false ? 0 : 1,
            render: (d) => (
                <div className="flex items-center gap-2">
                    <CatalogStatusPill isActive={d.isActive} />
                    {canManageDeviceModels && (
                        <button
                            type="button"
                            onClick={(event) => { event.stopPropagation(); toggleDeviceActive(d); }}
                            className={`p-1 rounded-lg transition-colors ${d.isActive === false ? 'text-slate-400 hover:bg-emerald-50 hover:text-emerald-600' : 'text-emerald-500 hover:bg-amber-50 hover:text-amber-600'}`}
                            title={d.isActive === false ? 'تفعيل الجهاز' : 'تعطيل الجهاز'}
                        >
                            {d.isActive === false ? <ToggleLeft className="w-4 h-4" /> : <ToggleRight className="w-4 h-4" />}
                        </button>
                    )}
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
                    <span className="text-xs text-slate-400 font-mono">{p.code}</span>
                </div>
            ),
        },
        {
            key: 'maintenanceType', label: 'النوع', sortable: true,
            render: (p) => {
                const tc = p.maintenanceType ? partTypeConfig[p.maintenanceType] : null;
                if (!tc) return (
                    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border bg-slate-50 text-slate-400 border-slate-200">—</span>
                );
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
                            <span key={did} className={`px-2 py-0.5 rounded text-xs font-medium border ${dev.isActive === false ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-sky-50 text-sky-600 border-sky-200'}`}>
                                {dev.nameAr || dev.name}
                                {dev.isActive === false && <span className="mr-1 opacity-75">غير نشط</span>}
                            </span>
                        ) : null;
                    })}
                    {p.compatibleDeviceIds.length === 0 && <span className="text-xs text-slate-300">—</span>}
                </div>
            ),
        },
        {
            key: 'isActive', label: 'الحالة', sortable: true,
            getValue: (p) => p.isActive === false ? 0 : 1,
            render: (p) => (
                <div className="flex items-center gap-2">
                    <CatalogStatusPill isActive={p.isActive} />
                    {canManageSpareParts && (
                        <button
                            type="button"
                            onClick={(event) => { event.stopPropagation(); togglePartActive(p); }}
                            className={`p-1 rounded-lg transition-colors ${p.isActive === false ? 'text-slate-400 hover:bg-emerald-50 hover:text-emerald-600' : 'text-emerald-500 hover:bg-amber-50 hover:text-amber-600'}`}
                            title={p.isActive === false ? 'تفعيل القطعة' : 'تعطيل القطعة'}
                        >
                            {p.isActive === false ? <ToggleLeft className="w-4 h-4" /> : <ToggleRight className="w-4 h-4" />}
                        </button>
                    )}
                </div>
            ),
        },
    ];

    const deviceFilters: FilterDef[] = [
        { key: 'isActive', label: 'كل الحالات', options: [{ value: 'true', label: 'نشط' }, { value: 'false', label: 'غير نشط' }] },
        { key: 'category', label: 'جميع الفئات', options: [{ value: 'منزلي', label: 'منزلي' }, { value: 'صناعي', label: 'صناعي' }] },
    ];

    const partFilters: FilterDef[] = [
        { key: 'isActive', label: 'كل الحالات', options: [{ value: 'true', label: 'نشط' }, { value: 'false', label: 'غير نشط' }] },
        { key: 'maintenanceType', label: 'جميع الأنواع', options: [{ value: 'Periodic', label: 'دورية' }, { value: 'Emergency', label: 'طوارئ' }, { value: 'Accessory', label: 'ملحقات' }] },
    ];

    const tabs: { id: ActiveTab; label: string; icon: any; count: number }[] = [
        { id: 'devices', label: 'الأجهزة', icon: Package, count: devices.length },
        { id: 'parts', label: 'قطع الأجهزة', icon: Cog, count: parts.length },
    ];

    if (loading) {
        return (
            <div className="h-full flex items-center justify-center">
                <div className="flex flex-col items-center gap-3">
                    <Loader2 className="w-8 h-8 text-sky-500 animate-spin" />
                    <span className="text-sm text-slate-500">جاري تحميل البيانات...</span>
                </div>
            </div>
        );
    }

    return (
        <>
            <div className="flex flex-col min-h-full">
                {/* TAB HEADER — hidden when adding device */}
                {!isAddingDevice && (
                    <div className="bg-white border-b border-slate-200 flex gap-1 px-6 pt-4 shrink-0">
                        {tabs.map(tab => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={`flex items-center gap-2 px-5 py-3 text-sm font-bold rounded-t-lg transition-all relative top-[1px] ${activeTab === tab.id
                                    ? 'bg-slate-50 text-sky-600 border border-slate-200 border-b-slate-50 shadow-sm'
                                    : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'}`}
                            >
                                <tab.icon className="w-4 h-4" />
                                <span>{tab.label}</span>
                                <span className={`px-1.5 py-0.5 rounded text-xs font-bold ${activeTab === tab.id ? 'bg-sky-100 text-sky-600' : 'bg-slate-100 text-slate-500'}`}>
                                    {tab.count}
                                </span>
                            </button>
                        ))}
                    </div>
                )}

                {/* TAB CONTENT */}
                <div className="flex-1 min-h-0 flex flex-col">
                    <AnimatePresence mode="wait">
                        {isAddingDevice && canManageDeviceModels ? (
                            <AddDevicePage
                                key="add-device"
                                device={editingDevice}
                                onCancel={closeDeviceForm}
                                onSaved={async () => { closeDeviceForm(); await fetchData(); }}
                            />
                        ) : activeTab === 'devices' ? (
                            <motion.div key="devices-table" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex-1 min-h-0 flex flex-col">
                                <SmartTable<DeviceModel>
                                    title="إدارة الأجهزة"
                                    icon={Package}
                                    data={devices}
                                    columns={deviceColumns}
                                    filters={deviceFilters}
                                    searchKeys={['name', 'nameAr', 'nameEn', 'brand']}
                                    searchPlaceholder="بحث عن جهاز..."
                                    getId={(d) => d.id}
                                    onRowClick={(d) => navigate(`/devices/${d.id}`)}
                                    rowClassName={(d) => d.isActive === false ? 'bg-slate-50 text-slate-500 opacity-75 hover:bg-slate-100' : ''}
                                    headerActions={canManageDeviceModels ? (
                                        <button
                                            onClick={openCreateDevice}
                                            className="flex items-center gap-2 bg-sky-600 hover:bg-sky-500 text-white px-4 py-2 rounded-lg text-sm font-bold shadow-sm transition-all"
                                        >
                                            <Plus className="w-4 h-4" /><span>إضافة جهاز</span>
                                        </button>
                                    ) : undefined}
                                    emptyIcon={Package}
                                    emptyMessage="لا توجد أجهزة"
                                    actions={canManageDeviceModels ? (d) => (
                                        <button
                                            type="button"
                                            onClick={(event) => { event.stopPropagation(); openEditDevice(d); }}
                                            className="p-1.5 rounded-lg hover:bg-sky-50 text-slate-400 hover:text-sky-600 transition-colors"
                                            title="تعديل الجهاز"
                                        >
                                            <Pencil className="w-4 h-4" />
                                        </button>
                                    ) : undefined}
                                />
                            </motion.div>
                        ) : (
                            <motion.div key="parts-table" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex-1 min-h-0 flex flex-col">
                                <SmartTable<SparePart>
                                    title="قطع الأجهزة"
                                    icon={Cog}
                                    data={parts}
                                    columns={partColumns}
                                    filters={partFilters}
                                    searchKeys={['name', 'code']}
                                    searchPlaceholder="بحث عن قطعة..."
                                    getId={(p) => p.id}
                                    onRowClick={canManageSpareParts ? (p) => openPartForm(p) : undefined}
                                    rowClassName={(p) => p.isActive === false ? 'bg-slate-50 text-slate-500 opacity-75 hover:bg-slate-100' : ''}
                                    headerActions={canManageSpareParts ? (
                                        <button
                                            onClick={() => openPartForm()}
                                            className="flex items-center gap-2 bg-sky-600 hover:bg-sky-500 text-white px-4 py-2 rounded-lg text-sm font-bold shadow-sm transition-all"
                                        >
                                            <Plus className="w-4 h-4" /><span>إضافة قطعة</span>
                                        </button>
                                    ) : undefined}
                                    emptyIcon={Cog}
                                    actions={(canManageSpareParts || canManageSparePartPrices) ? (p) => (
                                        <div className="flex items-center gap-1">
                                            {canManageSparePartPrices && (
                                                <button
                                                    type="button"
                                                    onClick={(event) => { event.stopPropagation(); openPartPrices(p); }}
                                                    className="p-1.5 rounded-lg hover:bg-sky-50 text-slate-400 hover:text-sky-600 transition-colors"
                                                    title="سجل أسعار القطعة"
                                                >
                                                    <Tag className="w-4 h-4" />
                                                </button>
                                            )}
                                            {canManageSpareParts && (
                                                <button
                                                    type="button"
                                                    onClick={(event) => { event.stopPropagation(); openPartForm(p); }}
                                                    className="p-1.5 rounded-lg hover:bg-sky-50 text-slate-400 hover:text-sky-600 transition-colors"
                                                    title="تعديل القطعة"
                                                >
                                                    <Pencil className="w-4 h-4" />
                                                </button>
                                            )}
                                        </div>
                                    ) : undefined}
                                    emptyMessage="لا توجد قطع غيار"
                                />
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </div>

            {pricingPart && (
                <SparePartPricesModal
                    part={pricingPart}
                    onClose={() => setPricingPart(null)}
                    onSaved={fetchData}
                />
            )}

            {/* ADD/EDIT PART MODAL */}
            <Modal
                isOpen={isAddingPart}
                onClose={() => { setIsAddingPart(false); setEditingPart(null); }}
                size="lg"
                title={editingPart ? 'تعديل قطعة غيار' : 'إضافة قطعة غيار'}
            >
                            <form onSubmit={handlePartSubmit} className="p-6 space-y-4">
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 mb-1">اسم القطعة <span className="text-red-400">*</span></label>
                                        <input type="text" required value={partForm.name || ''} onChange={e => setPartForm(p => ({ ...p, name: e.target.value }))}
                                            className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-sky-500 outline-none text-right text-sm" placeholder="مثال: فلتر PP 5 مايكرون" />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 mb-1">الرمز (SKU) <span className="text-red-400">*</span></label>
                                        <input type="text" required value={partForm.code || ''} onChange={e => setPartForm(p => ({ ...p, code: e.target.value }))}
                                            className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-sky-500 outline-none font-mono text-sm" dir="ltr" placeholder="SP-XXX" />
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">السعر ل.س</label>
                                    <input type="number" value={partForm.basePrice || ''} onChange={e => setPartForm(p => ({ ...p, basePrice: Number(e.target.value) }))}
                                        disabled={!!editingPart}
                                        className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-sky-500 outline-none text-right text-sm disabled:bg-slate-50 disabled:text-slate-400" />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-2">نوع القطعة</label>
                                    <div className="space-y-2">
                                        {/* قطع الغيار frame */}
                                        <div className="rounded-xl border-2 border-slate-200 p-2 space-y-1.5">
                                            <span className="block text-xs font-bold text-slate-400 px-1 uppercase tracking-wider">قطع غيار</span>
                                            <div className="flex gap-2">
                                                {(['Periodic', 'Emergency'] as const).map(type => {
                                                    const tc = partTypeConfig[type];
                                                    const isActive = partForm.maintenanceType === type;
                                                    return (
                                                        <button key={type} type="button"
                                                            onClick={() => setPartForm(p => ({ ...p, maintenanceType: type }))}
                                                            className={`flex-1 px-3 py-3 rounded-lg border-2 transition-all text-center ${isActive ? `${tc.bg} ${tc.border} ${tc.color} shadow-sm` : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'}`}
                                                        >
                                                            <span className="text-sm font-bold block">{tc.label}</span>
                                                            <span className="text-xs opacity-70 block mt-0.5">{tc.hint}</span>
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                        {/* ملحقات — منفصلة */}
                                        {(() => {
                                            const tc = partTypeConfig['Accessory'];
                                            const isActive = partForm.maintenanceType === 'Accessory';
                                            return (
                                                <button type="button"
                                                    onClick={() => setPartForm(p => ({ ...p, maintenanceType: 'Accessory' }))}
                                                    className={`w-full px-3 py-3 rounded-xl border-2 transition-all text-center ${isActive ? `${tc.bg} ${tc.border} ${tc.color} shadow-sm` : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'}`}
                                                >
                                                    <span className="text-sm font-bold block">{tc.label}</span>
                                                    <span className="text-xs opacity-70 block mt-0.5">{tc.hint}</span>
                                                </button>
                                            );
                                        })()}
                                    </div>
                                    {partForm.maintenanceType === 'Periodic' && (
                                        <div className="mt-2 flex items-center gap-2 text-xs text-blue-600 bg-blue-50 rounded-lg px-3 py-2 border border-blue-100">
                                            <RefreshCw className="w-3.5 h-3.5 shrink-0" />
                                            <span>استخدام هذه القطعة في زيارة سيعيد ضبط عداد الصيانة الدورية للجهاز</span>
                                        </div>
                                    )}
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-2">الأجهزة المتوافقة</label>
                                    <div className="grid grid-cols-1 gap-2 max-h-40 overflow-y-auto border border-slate-200 rounded-lg p-3 bg-slate-50">
                                        {devices.map(dev => {
                                            const isSelected = partForm.compatibleDeviceIds?.includes(dev.id) || false;
                                            const inactive = dev.isActive === false;
                                            return (
                                                <label key={dev.id}
                                                    className={`flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-all ${
                                                        isSelected
                                                            ? inactive ? 'bg-amber-50 border border-amber-200' : 'bg-sky-50 border border-sky-200'
                                                            : inactive ? 'bg-amber-50/60 border border-amber-100 hover:bg-amber-50' : 'bg-white border border-slate-100 hover:bg-slate-50'
                                                    }`}
                                                >
                                                    <input type="checkbox" checked={isSelected} onChange={() => toggleDeviceCompat(dev.id)} className="accent-sky-600 w-4 h-4" />
                                                    <div className="flex-1 min-w-0">
                                                        <span className={`text-sm font-medium block ${inactive ? 'text-amber-800' : 'text-slate-700'}`}>{dev.nameAr || dev.name}</span>
                                                        <div className="mt-0.5 flex flex-wrap items-center gap-2">
                                                            <span className="text-xs text-slate-400">{categoryLabels[dev.category]?.label || dev.category}</span>
                                                            {inactive && (
                                                                <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-100/70 px-2 py-0.5 text-[11px] font-bold text-amber-700">
                                                                    <AlertCircle className="w-3 h-3" />
                                                                    غير نشط
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>
                                                    <Gem className={`w-3.5 h-3.5 shrink-0 ${isSelected ? inactive ? 'text-amber-500' : 'text-sky-500' : 'text-slate-300'}`} />
                                                </label>
                                            );
                                        })}
                                    </div>
                                </div>

                                <div className="pt-2 flex gap-3">
                                    <button type="button" onClick={() => { setIsAddingPart(false); setEditingPart(null); }} className="flex-1 px-4 py-2 border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50 font-medium text-sm">إلغاء</button>
                                    <button type="submit" className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-sky-600 text-white rounded-lg hover:bg-sky-500 font-medium text-sm">
                                        <Save className="w-4 h-4" />
                                        <span>{editingPart ? 'حفظ التعديلات' : 'إضافة القطعة'}</span>
                                    </button>
                                </div>
                            </form>
            </Modal>
        </>
    );
};

export default DeviceManagement;
