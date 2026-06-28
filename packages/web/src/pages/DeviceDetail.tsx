import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
    ChevronRight, Loader2, Package, Clock, Wrench, PenTool, GraduationCap,
    Truck, Gem, Star, Image, Video, FileText, AlertCircle, RefreshCw,
    Zap, Tag, Plus, Pencil, Trash2, Save, ShieldCheck,
} from 'lucide-react';
import Modal from '../components/ui/Modal';
import { api } from '../lib/api';
import type { DeviceModel, DeviceDiscount, SparePart, MaintenancePartType, CatalogPriceHistoryEntry } from '../lib/types';
import { usePermissions } from '../hooks/usePermissions';

/* ------------------------------------------------------------------ */
/*  Config                                                              */
/* ------------------------------------------------------------------ */

const categoryLabels: Record<string, { label: string; icon: string; color: string; bg: string }> = {
    'منزلي': { label: 'منزلي', icon: '🏠', color: 'text-green-700', bg: 'bg-green-100' },
    'صناعي': { label: 'صناعي', icon: '🏭', color: 'text-orange-700', bg: 'bg-orange-100' },
};

const serviceLabels: Record<string, { label: string; Icon: any; color: string; bg: string }> = {
    'تسليم': { label: 'تسليم', Icon: Truck,         color: 'text-sky-600',    bg: 'bg-sky-50' },
    'تركيب': { label: 'تركيب', Icon: Wrench,        color: 'text-blue-600',   bg: 'bg-blue-50' },
    'صيانة': { label: 'صيانة', Icon: PenTool,       color: 'text-violet-600', bg: 'bg-violet-50' },
    'تعليم': { label: 'تعليم', Icon: GraduationCap, color: 'text-amber-600',  bg: 'bg-amber-50' },
};

const partTypeConfig: Record<MaintenancePartType, { label: string; color: string; bg: string; border: string; Icon: any }> = {
    Periodic:  { label: 'دورية',   color: 'text-blue-700',   bg: 'bg-blue-50',   border: 'border-blue-200',   Icon: RefreshCw },
    Emergency: { label: 'طوارئ',   color: 'text-red-700',    bg: 'bg-red-50',    border: 'border-red-200',    Icon: Zap },
    Accessory: { label: 'ملحقات',  color: 'text-purple-700', bg: 'bg-purple-50', border: 'border-purple-200', Icon: Tag },
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

const maintenanceLabels: Record<string, string> = {
    '3 أشهر': '3 أشهر',
    '6 أشهر': '6 أشهر',
    '1 سنة': 'سنة واحدة',
};

/* ------------------------------------------------------------------ */
/*  Sub-components                                                      */
/* ------------------------------------------------------------------ */

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
    return (
        <div className="flex items-start justify-between py-3 border-b border-slate-100 last:border-0">
            <span className="text-sm text-slate-500">{label}</span>
            <div className="text-sm font-medium text-slate-800 text-left">{value}</div>
        </div>
    );
}

function PartCard({ part }: { part: SparePart }) {
    const tc = partTypeConfig[part.maintenanceType];
    return (
        <div className="bg-white rounded-xl border border-slate-200 p-4 flex items-center gap-4 hover:shadow-sm transition-shadow">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${tc.bg} ${tc.border} border`}>
                <tc.Icon className={`w-4.5 h-4.5 ${tc.color}`} size={18} />
            </div>
            <div className="flex-1 min-w-0">
                <span className="text-sm font-semibold text-slate-800 block">{part.name}</span>
                <span className="text-xs text-slate-400 font-mono">{part.code}</span>
            </div>
            <div className="shrink-0 text-left">
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold border ${tc.bg} ${tc.color} ${tc.border} mb-1 block text-center`}>
                    {tc.label}
                </span>
                <span className="text-sm font-bold text-slate-700 font-mono block text-center">{formatPrice(part.basePrice)}</span>
            </div>
        </div>
    );
}

/* ------------------------------------------------------------------ */
/*  DeviceDetail Page                                                   */
/* ------------------------------------------------------------------ */

export default function DeviceDetail() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const { hasAnyPermission } = usePermissions();
    const canViewDiscounts = hasAnyPermission('devices.discounts.view', 'devices.discounts.manage', 'catalog.manage');
    const canManageDiscounts = hasAnyPermission('devices.discounts.manage', 'catalog.manage');
    const canViewPrices = hasAnyPermission('devices.prices.view', 'devices.prices.manage', 'catalog.manage');
    const canManagePrices = hasAnyPermission('devices.prices.manage', 'catalog.manage');

    const [device, setDevice] = useState<DeviceModel | null>(null);
    const [allParts, setAllParts] = useState<SparePart[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedImage, setSelectedImage] = useState<string | null>(null);
    const [discounts, setDiscounts] = useState<DeviceDiscount[]>([]);
    const [prices, setPrices] = useState<CatalogPriceHistoryEntry[]>([]);
    const [discountModalOpen, setDiscountModalOpen] = useState(false);
    const [editingDiscount, setEditingDiscount] = useState<DeviceDiscount | null>(null);
    const [priceModalOpen, setPriceModalOpen] = useState(false);
    const [activeHistoryTab, setActiveHistoryTab] = useState<'prices' | 'discounts'>('prices');

    useEffect(() => {
        (async () => {
            setLoading(true);
            try {
                const [devices, parts] = await Promise.all([
                    api.deviceModels.list(),
                    api.spareParts.list(),
                ]);
                const found = devices.find(d => String(d.id) === String(id));
                setDevice(found || null);
                setAllParts(parts);
            } finally {
                setLoading(false);
            }
        })();
    }, [id]);

    useEffect(() => {
        if (!device || !canViewDiscounts) return;
        api.deviceModels.getAllDiscounts(device.id)
            .then(setDiscounts)
            .catch(() => setDiscounts([]));
    }, [device?.id, canViewDiscounts]);

    useEffect(() => {
        if (!device || !canViewPrices) return;
        api.deviceModels.getPrices(device.id)
            .then(setPrices)
            .catch(() => setPrices([]));
    }, [device?.id, canViewPrices]);

    if (loading) {
        return (
            <div className="h-full flex items-center justify-center">
                <Loader2 className="w-7 h-7 text-sky-500 animate-spin" />
            </div>
        );
    }

    if (!device) {
        return (
            <div className="h-full flex flex-col items-center justify-center gap-3 text-slate-400">
                <AlertCircle className="w-10 h-10" />
                <span className="text-sm font-medium">الجهاز غير موجود</span>
                <button onClick={() => navigate('/devices')} className="text-xs text-sky-600 hover:underline">العودة للقائمة</button>
            </div>
        );
    }

    const cat = categoryLabels[device.category] || { label: device.category, icon: '📦', color: 'text-slate-700', bg: 'bg-slate-100' };
    const images = (device.images || []) as { id: string; name: string; url: string }[];
    const videos = (device.videos || []) as { id: string; name: string; url: string }[];
    const documents = (device.documents || []) as { id: string; name: string; url: string }[];
    const primaryImage = images.find(i => i.id === device.primaryImageId) || images[0];

    const compatibleParts = allParts.filter(p => p.compatibleDeviceIds?.includes(device.id));
    const periodicParts = compatibleParts.filter(p => p.maintenanceType === 'Periodic');
    const emergencyParts = compatibleParts.filter(p => p.maintenanceType === 'Emergency');
    const accessoryParts = compatibleParts.filter(p => p.maintenanceType === 'Accessory');
    const activeDetailTab = canViewPrices && activeHistoryTab === 'prices'
        ? 'prices'
        : canViewDiscounts
            ? 'discounts'
            : 'prices';

    const refetchDiscounts = () => {
        if (!canViewDiscounts) return;
        api.deviceModels.getAllDiscounts(device.id)
            .then(setDiscounts)
            .catch(() => setDiscounts([]));
    };

    const refetchPrices = () => {
        if (!canViewPrices) return;
        api.deviceModels.getPrices(device.id)
            .then(setPrices)
            .catch(() => setPrices([]));
    };

    const refetchDevice = () => {
        api.deviceModels.list()
            .then(devices => {
                const found = devices.find(d => String(d.id) === String(id));
                if (found) setDevice(found);
            })
            .catch(() => undefined);
    };

    const handleDeleteDiscount = async (discountId: number) => {
        if (!canManageDiscounts) return;
        if (!window.confirm('هل أنت متأكد من حذف هذه الحملة؟')) return;
        await api.deviceModels.deleteDiscount(device.id, discountId);
        refetchDiscounts();
    };

    const handleEditClick = (discount: DeviceDiscount) => {
        if (!canManageDiscounts) return;
        setEditingDiscount(discount);
        setDiscountModalOpen(true);
    };

    const handleAddClick = () => {
        if (!canManageDiscounts) return;
        setEditingDiscount(null);
        setDiscountModalOpen(true);
    };

    const handleAddPriceClick = () => {
        if (!canManagePrices) return;
        setPriceModalOpen(true);
    };

    const getDiscountStatus = (d: DeviceDiscount): { label: string; color: string } => {
        const today = new Date().toISOString().slice(0, 10);
        if (!d.isActive || d.endDate < today) return { label: 'غير فعّال', color: 'text-slate-500 bg-slate-100' };
        if (d.startDate > today) return { label: 'قادم', color: 'text-yellow-700 bg-yellow-50' };
        return { label: 'فعّال', color: 'text-emerald-700 bg-emerald-50' };
    };

    return (
        <div className="h-full flex flex-col overflow-hidden bg-slate-50" dir="rtl">
            {/* Breadcrumb header */}
            <div className="bg-white border-b border-slate-200 px-6 py-4 shrink-0 flex items-center gap-3">
                <button
                    onClick={() => navigate('/devices')}
                    className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 transition-colors"
                >
                    <ChevronRight className="w-4 h-4" />
                    <span>الأجهزة</span>
                </button>
                <span className="text-slate-300">/</span>
                <span className="text-sm font-semibold text-slate-800">{device.nameAr || device.name}</span>
            </div>

            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto">
                <div className="max-w-5xl mx-auto px-6 py-6 space-y-6">

                    {/* ── Hero card ── */}
                    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                        <div className="flex flex-col md:flex-row gap-0">
                            {/* Image panel */}
                            <div className="md:w-72 shrink-0 bg-slate-100 flex items-center justify-center min-h-48 relative">
                                {primaryImage ? (
                                    <img
                                        src={selectedImage || primaryImage.url}
                                        alt={device.nameAr || device.name}
                                        className="w-full h-full object-contain max-h-64 cursor-zoom-in"
                                        onClick={() => setSelectedImage(null)}
                                    />
                                ) : (
                                    <div className="flex flex-col items-center gap-2 text-slate-300 p-8">
                                        <Package className="w-14 h-14" />
                                        <span className="text-xs">لا توجد صورة</span>
                                    </div>
                                )}
                                {/* Device ID badge */}
                                <div className="absolute top-3 right-3 bg-white/90 backdrop-blur-sm border border-slate-200 rounded-lg px-2.5 py-1 text-xs font-mono font-bold text-slate-600 shadow-sm">
                                    #{String(device.id).padStart(4, '0')}
                                </div>
                            </div>

                            {/* Info panel */}
                            <div className="flex-1 p-6 space-y-5">
                                {/* Name + category */}
                                <div>
                                    <div className="flex items-start justify-between gap-3 mb-1">
                                        <h1 className="text-2xl font-bold text-slate-800">{device.nameAr || device.name}</h1>
                                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold shrink-0 ${cat.bg} ${cat.color}`}>
                                            <span>{cat.icon}</span>{cat.label}
                                        </span>
                                    </div>
                                    {device.nameEn && <p className="text-sm text-slate-400 font-mono">{device.nameEn}</p>}
                                    {device.code && (
                                        <div className="flex items-center gap-2 mt-1">
                                            <span className="text-xs font-mono text-slate-400 bg-slate-100 px-2 py-0.5 rounded">الرمز: {device.code}</span>
                                        </div>
                                    )}
                                    {device.description && <p className="text-sm text-slate-500 mt-2 leading-relaxed">{device.description}</p>}
                                    {device.descriptionEn && (
                                        <p className="text-sm text-slate-500 mt-2 leading-relaxed" dir="ltr">{device.descriptionEn}</p>
                                    )}
                                </div>

                                {/* Price */}
                                <div className="flex items-end gap-3">
                                    <div>
                                        <span className="text-xs text-slate-400 block mb-0.5">السعر</span>
                                        <span className="text-2xl font-bold text-slate-900 font-mono">
                                            {formatPrice(device.basePrice)}
                                        </span>
                                    </div>
                                </div>

                                {/* Badges row */}
                                <div className="flex flex-wrap gap-2">
                                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-100 text-slate-600">
                                        <Clock className="w-3.5 h-3.5" />
                                        {maintenanceLabels[device.maintenanceInterval] || device.maintenanceInterval}
                                    </span>
                                    {device.isGoldenWarranty && (
                                        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">
                                            <Gem className="w-3.5 h-3.5" />
                                            كفالة ذهبية
                                            {(device.goldenWarrantyPeriods?.length || 0) > 0 && (
                                                <span className="opacity-70">· {(device.goldenWarrantyPeriods as Array<{ months: number; label: string }>).map(p => p.label).join(' / ')}</span>
                                            )}
                                        </span>
                                    )}
                                    {(device.warrantyPeriods as Array<{ months: number; label: string; visits: number }> | undefined)?.length
                                        ? (device.warrantyPeriods as Array<{ months: number; label: string; visits: number }>).map(p => (
                                            <span key={p.months} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-sky-50 text-sky-700 border border-sky-200">
                                                <ShieldCheck className="w-3.5 h-3.5" />
                                                {p.label} · {p.visits} زيارة
                                            </span>
                                        ))
                                        : null
                                    }
                                    {device.isFeatured && (
                                        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-sky-50 text-sky-700 border border-sky-200">
                                            جهاز بارز
                                        </span>
                                    )}
                                </div>

                                {/* Supported services */}
                                {(device.supportedVisitTypes as string[]).length > 0 && (
                                    <div>
                                        <span className="text-xs text-slate-400 block mb-2">الخدمات المدعومة</span>
                                        <div className="flex flex-wrap gap-2">
                                            {(device.supportedVisitTypes as string[]).map(type => {
                                                const S = serviceLabels[type];
                                                if (!S) return null;
                                                return (
                                                    <span key={type} className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium ${S.bg} ${S.color}`}>
                                                        <S.Icon size={13} />{S.label}
                                                    </span>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Thumbnail strip */}
                        {images.length > 1 && (
                            <div className="border-t border-slate-100 px-4 py-3 flex gap-2 overflow-x-auto">
                                {images.map(img => (
                                    <button
                                        key={img.id}
                                        onClick={() => setSelectedImage(img.url)}
                                        className={`w-14 h-14 rounded-lg overflow-hidden border-2 shrink-0 transition-all ${(selectedImage === img.url || (!selectedImage && img.id === primaryImage?.id)) ? 'border-sky-500' : 'border-slate-200 hover:border-slate-300'}`}
                                    >
                                        <img src={img.url} alt={img.name} className="w-full h-full object-cover" />
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* ── Videos ── */}
                    {videos.length > 0 && (
                        <div className="bg-white rounded-xl border border-slate-200 p-5">
                            <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2 mb-4">
                                <Video className="w-4 h-4 text-purple-500" /> فيديوهات الجهاز
                            </h2>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                {videos.map(vid => (
                                    <div key={vid.id} className="rounded-xl overflow-hidden border border-slate-200">
                                        <video src={vid.url} controls className="w-full bg-black max-h-48 object-contain" />
                                        <div className="px-3 py-2 text-xs text-slate-500 truncate bg-slate-50">{vid.name}</div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* ── Documents ── */}
                    {documents.length > 0 && (
                        <div className="bg-white rounded-xl border border-slate-200 p-5">
                            <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2 mb-4">
                                <FileText className="w-4 h-4 text-emerald-500" /> المستندات
                            </h2>
                            <div className="space-y-2">
                                {documents.map(doc => {
                                    const isPdf = doc.name.toLowerCase().endsWith('.pdf');
                                    const isImage = doc.url.startsWith('data:image');
                                    return (
                                        <div key={doc.id} className="flex items-center gap-3 px-4 py-3 rounded-xl bg-slate-50 border border-slate-200">
                                            {isImage
                                                ? <img src={doc.url} alt={doc.name} className="w-10 h-10 object-cover rounded-lg" />
                                                : <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-white text-xs font-bold ${isPdf ? 'bg-red-500' : 'bg-blue-500'}`}>
                                                    {isPdf ? 'PDF' : 'DOC'}
                                                  </div>
                                            }
                                            <span className="text-sm text-slate-700 flex-1 truncate">{doc.name}</span>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* ── Spare Parts ── */}
                    <div className="bg-white rounded-xl border border-slate-200 p-5">
                        <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2 mb-5">
                            <Wrench className="w-4 h-4 text-slate-400" />
                            القطع المرتبطة بالجهاز
                            <span className="mr-auto text-xs font-normal text-slate-400 bg-slate-100 px-2.5 py-0.5 rounded-full">
                                {compatibleParts.length} قطعة
                            </span>
                        </h2>

                        {compatibleParts.length === 0 ? (
                            <div className="text-center py-10 text-slate-300">
                                <Wrench className="w-10 h-10 mx-auto mb-2 opacity-40" />
                                <p className="text-sm">لا توجد قطع مرتبطة بهذا الجهاز</p>
                            </div>
                        ) : (
                            <div className="space-y-6">
                                {/* Periodic */}
                                {periodicParts.length > 0 && (
                                    <div>
                                        <div className="flex items-center gap-2 mb-3">
                                            <RefreshCw className="w-3.5 h-3.5 text-blue-500" />
                                            <span className="text-xs font-bold text-blue-600 uppercase tracking-wider">قطع الصيانة الدورية</span>
                                            <span className="text-xs text-blue-400 bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded-full">{periodicParts.length}</span>
                                        </div>
                                        <div className="space-y-2">
                                            {periodicParts.map(p => <PartCard key={p.id} part={p} />)}
                                        </div>
                                    </div>
                                )}

                                {/* Emergency */}
                                {emergencyParts.length > 0 && (
                                    <div>
                                        <div className="flex items-center gap-2 mb-3">
                                            <Zap className="w-3.5 h-3.5 text-red-500" />
                                            <span className="text-xs font-bold text-red-600 uppercase tracking-wider">قطع الطوارئ</span>
                                            <span className="text-xs text-red-400 bg-red-50 border border-red-200 px-1.5 py-0.5 rounded-full">{emergencyParts.length}</span>
                                        </div>
                                        <div className="space-y-2">
                                            {emergencyParts.map(p => <PartCard key={p.id} part={p} />)}
                                        </div>
                                    </div>
                                )}

                                {/* Accessories */}
                                {accessoryParts.length > 0 && (
                                    <div>
                                        <div className="flex items-center gap-2 mb-3">
                                            <Tag className="w-3.5 h-3.5 text-purple-500" />
                                            <span className="text-xs font-bold text-purple-600 uppercase tracking-wider">ملحقات</span>
                                            <span className="text-xs text-purple-400 bg-purple-50 border border-purple-200 px-1.5 py-0.5 rounded-full">{accessoryParts.length}</span>
                                        </div>
                                        <div className="space-y-2">
                                            {accessoryParts.map(p => <PartCard key={p.id} part={p} />)}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                </div>

                    {(canViewPrices || canViewDiscounts) && (
                    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                        <div className="flex items-center gap-1 border-b border-slate-100 px-5 pt-4">
                            {canViewPrices && (
                                <button
                                    type="button"
                                    onClick={() => setActiveHistoryTab('prices')}
                                    className={`px-4 py-2 text-sm font-bold border-b-2 transition-colors ${activeDetailTab === 'prices' ? 'border-sky-500 text-sky-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
                                >
                                    سجل الأسعار
                                </button>
                            )}
                            {canViewDiscounts && (
                                <button
                                    type="button"
                                    onClick={() => setActiveHistoryTab('discounts')}
                                    className={`px-4 py-2 text-sm font-bold border-b-2 transition-colors ${activeDetailTab === 'discounts' ? 'border-emerald-500 text-emerald-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
                                >
                                    الحملات الزمنية
                                </button>
                            )}
                        </div>
                        <div className="p-5">
                    {canViewPrices && activeDetailTab === 'prices' && (
                    <div>
                        <div className="flex items-center justify-between mb-5">
                            <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                                <Tag className="w-4 h-4 text-sky-500" />
                                سجل الأسعار
                                <span className="mr-auto text-xs font-normal text-slate-400 bg-slate-100 px-2.5 py-0.5 rounded-full">
                                    {prices.length}
                                </span>
                            </h2>
                            {canManagePrices && (
                            <button
                                onClick={handleAddPriceClick}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-50 border border-sky-200 text-xs font-bold text-sky-700 hover:bg-sky-100 transition-colors"
                            >
                                <Plus className="w-3.5 h-3.5" /> إضافة سعر
                            </button>
                            )}
                        </div>

                        {prices.length === 0 ? (
                            <div className="text-center py-10 text-slate-300">
                                <Tag className="w-10 h-10 mx-auto mb-2 opacity-40" />
                                <p className="text-sm">لا يوجد سجل أسعار بعد</p>
                            </div>
                        ) : (
                            <div className="overflow-hidden rounded-xl border border-slate-200">
                                <table className="min-w-full divide-y divide-slate-100 text-sm">
                                    <thead className="bg-slate-50 text-slate-600">
                                        <tr>
                                            <th className="px-4 py-3 text-right font-bold">السعر</th>
                                            <th className="px-4 py-3 text-right font-bold">من تاريخ</th>
                                            <th className="px-4 py-3 text-right font-bold">حتى تاريخ</th>
                                            <th className="px-4 py-3 text-right font-bold">الحالة</th>
                                            <th className="px-4 py-3 text-right font-bold">ملاحظة</th>
                                            <th className="px-4 py-3 text-right font-bold">أضيف بواسطة</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100 bg-white">
                                        {prices.map(p => (
                                            <tr key={p.id} className="align-middle">
                                                <td className="px-4 py-3 text-slate-800 font-bold font-mono">{formatPrice(p.price)}</td>
                                                <td className="px-4 py-3 text-slate-500 text-xs">{formatPriceMoment(p.effectiveFrom)}</td>
                                                <td className="px-4 py-3 text-slate-500 text-xs">{formatPriceMoment(p.effectiveTo)}</td>
                                                <td className="px-4 py-3">
                                                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold ${p.isCurrent ? 'text-sky-700 bg-sky-50' : 'text-slate-500 bg-slate-100'}`}>
                                                        {p.isCurrent ? 'فعال الآن' : 'تاريخي'}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-3 text-slate-500 text-xs">{p.note || '—'}</td>
                                                <td className="px-4 py-3 text-slate-500 text-xs">{p.createdByName || '—'}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                    )}

                    {/* ── Time-Based Discounts ── */}
                    {canViewDiscounts && activeDetailTab === 'discounts' && (
                    <div>
                        <div className="flex items-center justify-between mb-5">
                            <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                                <Tag className="w-4 h-4 text-emerald-500" />
                                الحسومات الزمنية
                                <span className="mr-auto text-xs font-normal text-slate-400 bg-slate-100 px-2.5 py-0.5 rounded-full">
                                    {discounts.length}
                                </span>
                            </h2>
                            {canManageDiscounts && (
                            <button
                                onClick={handleAddClick}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-50 border border-emerald-200 text-xs font-bold text-emerald-700 hover:bg-emerald-100 transition-colors"
                            >
                                <Plus className="w-3.5 h-3.5" /> إضافة حملة
                            </button>
                            )}
                        </div>

                        {discounts.length === 0 ? (
                            <div className="text-center py-10 text-slate-300">
                                <Tag className="w-10 h-10 mx-auto mb-2 opacity-40" />
                                <p className="text-sm">لا توجد حسومات زمنية</p>
                            </div>
                        ) : (
                            <div className="overflow-hidden rounded-xl border border-slate-200">
                                <table className="min-w-full divide-y divide-slate-100 text-sm">
                                    <thead className="bg-slate-50 text-slate-600">
                                        <tr>
                                            <th className="px-4 py-3 text-right font-bold">الحملة</th>
                                            <th className="px-4 py-3 text-right font-bold">%</th>
                                            <th className="px-4 py-3 text-right font-bold">من تاريخ</th>
                                            <th className="px-4 py-3 text-right font-bold">حتى تاريخ</th>
                                            <th className="px-4 py-3 text-right font-bold">حالة</th>
                                                    {canManageDiscounts && <th className="px-4 py-3 text-right font-bold">إجراءات</th>}
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100 bg-white">
                                        {discounts.map(d => {
                                            const status = getDiscountStatus(d);
                                            return (
                                                <tr key={d.id} className="align-middle">
                                                    <td className="px-4 py-3 font-semibold text-slate-800">{d.label}</td>
                                                    <td className="px-4 py-3 text-slate-600 font-mono">{d.percentage}%</td>
                                                    <td className="px-4 py-3 text-slate-500 text-xs">{d.startDate}</td>
                                                    <td className="px-4 py-3 text-slate-500 text-xs">{d.endDate}</td>
                                                    <td className="px-4 py-3">
                                                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold ${status.color}`}>
                                                            {status.label}
                                                        </span>
                                                    </td>
                                                    {canManageDiscounts && (
                                                    <td className="px-4 py-3">
                                                        <div className="flex gap-2">
                                                            <button
                                                                onClick={() => handleEditClick(d)}
                                                                className="p-1.5 rounded-lg text-slate-400 hover:text-sky-600 hover:bg-sky-50 transition-colors"
                                                                title="تعديل"
                                                            >
                                                                <Pencil className="w-3.5 h-3.5" />
                                                            </button>
                                                            <button
                                                                onClick={() => handleDeleteDiscount(d.id)}
                                                                className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                                                                title="حذف"
                                                            >
                                                                <Trash2 className="w-3.5 h-3.5" />
                                                            </button>
                                                        </div>
                                                    </td>
                                                    )}
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                    )}
                        </div>
                    </div>
                    )}

                </div>

            {/* Discount Modal */}
            {discountModalOpen && canManageDiscounts && (
                <DiscountModal
                    deviceId={device.id}
                    editingDiscount={editingDiscount}
                    onClose={() => { setDiscountModalOpen(false); setEditingDiscount(null); }}
                    onSaved={() => { refetchDiscounts(); setDiscountModalOpen(false); setEditingDiscount(null); }}
                />
            )}
            {priceModalOpen && canManagePrices && (
                <PriceModal
                    deviceId={device.id}
                    currentPrice={device.basePrice}
                    onClose={() => setPriceModalOpen(false)}
                    onSaved={() => { refetchPrices(); refetchDevice(); setPriceModalOpen(false); }}
                />
            )}
        </div>
    );
}

/* ------------------------------------------------------------------ */
/*  Price Modal                                                         */
/* ------------------------------------------------------------------ */

function PriceModal({ deviceId, currentPrice, onClose, onSaved }: {
    deviceId: number;
    currentPrice: number;
    onClose: () => void;
    onSaved: () => void;
}) {
    const [price, setPrice] = useState(String(currentPrice || ''));
    const [note, setNote] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    const handleSave = async () => {
        const numericPrice = Number(price);
        if (!Number.isFinite(numericPrice) || numericPrice <= 0) {
            setError('السعر يجب أن يكون أكبر من صفر');
            return;
        }
        setSaving(true);
        setError('');
        try {
            await api.deviceModels.createPrice(deviceId, {
                price: numericPrice,
                note: note.trim() || null,
            });
            onSaved();
        } catch {
            setError('حدث خطأ أثناء حفظ السعر');
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal
            isOpen
            onClose={onClose}
            size="md"
            title="إضافة سعر جديد"
            footer={
              <div className="w-full flex gap-3">
                <button onClick={onClose} className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 text-sm font-semibold">
                    إلغاء
                </button>
                <button onClick={handleSave} disabled={saving}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-sky-600 text-white rounded-xl hover:bg-sky-500 text-sm font-semibold disabled:opacity-60">
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    {saving ? 'جاري الحفظ...' : 'حفظ'}
                </button>
              </div>
            }
        >
                <div className="px-5 py-5 space-y-4">
                    {error && (
                        <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-sm">
                            <AlertCircle className="w-4 h-4 shrink-0" />
                            {error}
                        </div>
                    )}

                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1.5">السعر <span className="text-red-500">*</span></label>
                        <input
                            type="number"
                            min={1}
                            value={price}
                            onChange={e => setPrice(e.target.value)}
                            className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-sky-500 outline-none"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1.5">ملاحظة</label>
                        <textarea
                            value={note}
                            onChange={e => setNote(e.target.value)}
                            rows={3}
                            className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-sky-500 outline-none resize-none"
                            placeholder="سبب تغيير السعر أو مرجع القرار"
                        />
                    </div>
                </div>
        </Modal>
    );
}

/* ------------------------------------------------------------------ */
/*  Discount Modal                                                      */
/* ------------------------------------------------------------------ */

function DiscountModal({ deviceId, editingDiscount, onClose, onSaved }: {
    deviceId: number;
    editingDiscount: DeviceDiscount | null;
    onClose: () => void;
    onSaved: () => void;
}) {
    const [label, setLabel] = useState(editingDiscount?.label ?? '');
    const [percentage, setPercentage] = useState(String(editingDiscount?.percentage ?? ''));
    const [startDate, setStartDate] = useState(editingDiscount?.startDate?.slice(0, 10) ?? '');
    const [endDate, setEndDate] = useState(editingDiscount?.endDate?.slice(0, 10) ?? '');
    const [isActive, setIsActive] = useState(editingDiscount?.isActive ?? true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    const handleSave = async () => {
        if (!label.trim()) { setError('اسم الحملة مطلوب'); return; }
        const pct = Number(percentage);
        if (!Number.isFinite(pct) || pct < 0 || pct > 100) { setError('نسبة الحسم يجب أن تكون بين 0 و 100'); return; }
        if (!startDate || !endDate) { setError('يرجى تحديد تواريخ البداية والنهاية'); return; }
        if (startDate > endDate) { setError('تاريخ البداية يجب أن يكون قبل أو يساوي تاريخ النهاية'); return; }

        setSaving(true);
        setError('');
        try {
            const data = { label: label.trim(), percentage: pct, startDate, endDate, isActive };
            if (editingDiscount) {
                await api.deviceModels.updateDiscount(deviceId, editingDiscount.id, data);
            } else {
                await api.deviceModels.createDiscount(deviceId, data);
            }
            onSaved();
        } catch {
            setError('حدث خطأ أثناء الحفظ');
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal
            isOpen
            onClose={onClose}
            size="md"
            title={editingDiscount ? 'تعديل حملة الخصم' : 'إضافة حملة خصم'}
            footer={
              <div className="w-full flex gap-3">
                <button onClick={onClose} className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 text-sm font-semibold">
                    إلغاء
                </button>
                <button onClick={handleSave} disabled={saving}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-600 text-white rounded-xl hover:bg-emerald-500 text-sm font-semibold disabled:opacity-60">
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    {saving ? 'جاري الحفظ...' : 'حفظ'}
                </button>
              </div>
            }
        >
                <div className="px-5 py-5 space-y-4">
                    {error && (
                        <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-sm">
                            <AlertCircle className="w-4 h-4 shrink-0" />
                            {error}
                        </div>
                    )}

                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1.5">اسم الحملة <span className="text-red-500">*</span></label>
                        <input
                            type="text"
                            value={label}
                            onChange={e => setLabel(e.target.value)}
                            className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                            placeholder="مثال: عرض رمضان"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1.5">نسبة الحسم % <span className="text-red-500">*</span></label>
                        <input
                            type="number"
                            min={0}
                            max={100}
                            value={percentage}
                            onChange={e => setPercentage(e.target.value)}
                            className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                            placeholder="0–100"
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1.5">من تاريخ <span className="text-red-500">*</span></label>
                            <input
                                type="date"
                                value={startDate}
                                onChange={e => setStartDate(e.target.value)}
                                className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1.5">حتى تاريخ <span className="text-red-500">*</span></label>
                            <input
                                type="date"
                                value={endDate}
                                onChange={e => setEndDate(e.target.value)}
                                className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                            />
                        </div>
                    </div>

                    <label className="flex items-center gap-3 cursor-pointer px-3 py-2.5 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors">
                        <input
                            type="checkbox"
                            checked={isActive}
                            onChange={e => setIsActive(e.target.checked)}
                            className="w-4 h-4 accent-emerald-600"
                        />
                        <span className="text-sm font-medium text-slate-700">فعّال</span>
                    </label>
                </div>
        </Modal>
    );
}
