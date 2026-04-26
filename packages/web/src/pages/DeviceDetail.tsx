import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
    ChevronRight, Loader2, Package, Clock, Wrench, PenTool, GraduationCap,
    Truck, Gem, Star, Image, Video, FileText, AlertCircle, RefreshCw,
    Zap, Tag,
} from 'lucide-react';
import { api } from '../lib/api';
import type { DeviceModel, SparePart, MaintenancePartType } from '../lib/types';

/* ------------------------------------------------------------------ */
/*  Config                                                              */
/* ------------------------------------------------------------------ */

const categoryLabels: Record<string, { label: string; icon: string; color: string; bg: string }> = {
    'منزلي': { label: 'منزلي', icon: '🏠', color: 'text-green-700', bg: 'bg-green-100' },
    'صناعي': { label: 'صناعي', icon: '🏭', color: 'text-orange-700', bg: 'bg-orange-100' },
};

const serviceLabels: Record<string, { label: string; Icon: any; color: string; bg: string }> = {
    'تركيب':        { label: 'تركيب',        Icon: Wrench,        color: 'text-blue-600',   bg: 'bg-blue-50' },
    'صيانة':        { label: 'صيانة',        Icon: PenTool,       color: 'text-violet-600', bg: 'bg-violet-50' },
    'تعليم':        { label: 'تعليم',        Icon: GraduationCap, color: 'text-amber-600',  bg: 'bg-amber-50' },
    'تسليم':        { label: 'تسليم',        Icon: Truck,         color: 'text-sky-600',    bg: 'bg-sky-50' },
    'تعليم تسليم':  { label: 'تعليم تسليم',  Icon: GraduationCap, color: 'text-amber-600',  bg: 'bg-amber-50' },
};

const partTypeConfig: Record<MaintenancePartType, { label: string; color: string; bg: string; border: string; Icon: any }> = {
    Periodic:  { label: 'دورية',   color: 'text-blue-700',   bg: 'bg-blue-50',   border: 'border-blue-200',   Icon: RefreshCw },
    Emergency: { label: 'طوارئ',   color: 'text-red-700',    bg: 'bg-red-50',    border: 'border-red-200',    Icon: Zap },
    Accessory: { label: 'ملحقات',  color: 'text-purple-700', bg: 'bg-purple-50', border: 'border-purple-200', Icon: Tag },
};

const formatPrice = (n: number) =>
    new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(n) + ' ل.س';

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
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${tc.bg} ${tc.color} ${tc.border} mb-1 block text-center`}>
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

    const [device, setDevice] = useState<DeviceModel | null>(null);
    const [allParts, setAllParts] = useState<SparePart[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedImage, setSelectedImage] = useState<string | null>(null);

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

    const cat = categoryLabels[device.category] || { label: device.category, icon: '📦', color: 'text-gray-700', bg: 'bg-gray-100' };
    const images = (device.images || []) as { id: string; name: string; url: string }[];
    const videos = (device.videos || []) as { id: string; name: string; url: string }[];
    const documents = (device.documents || []) as { id: string; name: string; url: string }[];
    const primaryImage = images.find(i => i.id === device.primaryImageId) || images[0];

    const compatibleParts = allParts.filter(p => p.compatibleDeviceIds?.includes(device.id));
    const periodicParts = compatibleParts.filter(p => p.maintenanceType === 'Periodic');
    const emergencyParts = compatibleParts.filter(p => p.maintenanceType === 'Emergency');
    const accessoryParts = compatibleParts.filter(p => p.maintenanceType === 'Accessory');

    return (
        <div className="h-full flex flex-col overflow-hidden bg-slate-50" dir="rtl">
            {/* Breadcrumb header */}
            <div className="bg-white border-b border-gray-200 px-6 py-4 shrink-0 flex items-center gap-3">
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
                                        <h1 className="text-xl font-bold text-slate-900">{device.nameAr || device.name}</h1>
                                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold shrink-0 ${cat.bg} ${cat.color}`}>
                                            <span>{cat.icon}</span>{cat.label}
                                        </span>
                                    </div>
                                    {device.nameEn && <p className="text-sm text-slate-400 font-mono">{device.nameEn}</p>}
                                    {device.description && <p className="text-sm text-slate-500 mt-2 leading-relaxed">{device.description}</p>}
                                </div>

                                {/* Price */}
                                <div className="flex items-end gap-3">
                                    <div>
                                        <span className="text-xs text-slate-400 block mb-0.5">السعر</span>
                                        <span className="text-2xl font-bold text-slate-900 font-mono">
                                            {formatPrice(device.discountedPrice ?? device.basePrice)}
                                        </span>
                                    </div>
                                    {(device.discountPercent || 0) > 0 && (
                                        <div className="mb-1">
                                            <span className="text-xs line-through text-slate-400 font-mono block">{formatPrice(device.basePrice)}</span>
                                            <span className="text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
                                                خصم {device.discountPercent}%
                                            </span>
                                        </div>
                                    )}
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
                                                <span className="opacity-70">· {device.goldenWarrantyPeriods!.join(' / ')}</span>
                                            )}
                                        </span>
                                    )}
                                    {device.isOfferIncluded && (
                                        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-sky-50 text-sky-700 border border-sky-200">
                                            مشمول بالعروض
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
                            <h2 className="text-sm font-bold text-slate-700 flex items-center gap-2 mb-4">
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
                            <h2 className="text-sm font-bold text-slate-700 flex items-center gap-2 mb-4">
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
                                                : <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-white text-[10px] font-bold ${isPdf ? 'bg-red-500' : 'bg-blue-500'}`}>
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
                        <h2 className="text-sm font-bold text-slate-700 flex items-center gap-2 mb-5">
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
                                            <span className="text-[10px] text-blue-400 bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded-full">{periodicParts.length}</span>
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
                                            <span className="text-[10px] text-red-400 bg-red-50 border border-red-200 px-1.5 py-0.5 rounded-full">{emergencyParts.length}</span>
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
                                            <span className="text-[10px] text-purple-400 bg-purple-50 border border-purple-200 px-1.5 py-0.5 rounded-full">{accessoryParts.length}</span>
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
            </div>
        </div>
    );
}
