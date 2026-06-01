import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
    ArrowRight, MapPin, Clock, AlertTriangle, CheckCircle2, AlertCircle,
    User, Building2, Users, Play, Square, Flag, Loader2,
    ClipboardList, Phone, UserPlus, Navigation, Ruler,
    ShoppingCart, Smartphone, Wrench, Zap, Puzzle,
    ClipboardCheck, ListPlus, Lock, Unlock,
} from 'lucide-react';
import { api } from '../../lib/api';
import NameCollectionModal from '../../components/NameCollectionModal';
import DirectSuggestionForm from '../../components/DirectSuggestionForm';
import VisitSurveyModal from '../../components/fieldVisits/VisitSurveyModal';
import ReferralSheetModal from '../../components/fieldVisits/ReferralSheetModal';
import { useAuthStore } from '../../hooks/useAuthStore';

// ── helpers ───────────────────────────────────────────────────────────────────

// DEC-004 D18: 7 canonical states + `closed`. Legacy statuses left for
// retro display of historical visits until migration 231 backfill is applied.
const STATUS_LABELS: Record<string, { label: string; color: string; bg: string }> = {
    scheduled:              { label: 'مجدولة',             color: 'text-slate-700',  bg: 'bg-slate-100'  },
    in_progress:            { label: 'جارية',              color: 'text-blue-700',   bg: 'bg-blue-50'    },
    ended:                  { label: 'انتهت ميدانياً',     color: 'text-amber-700',  bg: 'bg-amber-50'   },
    completed:              { label: 'مكتملة',             color: 'text-emerald-700',bg: 'bg-emerald-50' },
    not_completed:          { label: 'لم تتم',             color: 'text-rose-700',   bg: 'bg-rose-50'    },
    cancelled:              { label: 'ملغاة',              color: 'text-slate-500',  bg: 'bg-slate-100'  },
    closed:                 { label: 'مُقفلة إدارياً',     color: 'text-slate-700',  bg: 'bg-slate-200'  },
    // Legacy values — retained for historical visits before migration 231
    postponed_by_company:   { label: 'مؤجلة (الشركة)',    color: 'text-amber-700',  bg: 'bg-amber-50'   },
    postponed_by_customer:  { label: 'مؤجلة (الزبون)',    color: 'text-orange-700', bg: 'bg-orange-50'  },
    needs_reschedule:       { label: 'تحتاج إعادة جدولة', color: 'text-yellow-700', bg: 'bg-yellow-50'  },
};

const SOURCE_ICON: Record<string, any> = {
    supervisor:    User,
    technician:    User,
    both:          Users,
    company_branch: Building2,
    company_global: Building2,
};

function formatTime(ts: string | null | undefined) {
    if (!ts) return null;
    try { return new Date(ts).toLocaleTimeString('ar-SY', { hour: '2-digit', minute: '2-digit' }); }
    catch { return ts; }
}

function formatDate(ts: string | null | undefined) {
    if (!ts) return null;
    try { return new Date(ts).toLocaleDateString('ar-SY'); }
    catch { return ts; }
}

// ── component ─────────────────────────────────────────────────────────────────

export default function VisitDetailPage() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();

    const [visit, setVisit] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [actionLoading, setActionLoading] = useState<string | null>(null);

    // Name collection modal state (legacy — preserved for visits created before Phase 6)
    const [ncModal, setNcModal] = useState<any | null>(null);

    // DEC-007: visit-level survey + referral sheet modals
    const [surveyOpen, setSurveyOpen] = useState(false);
    const [referralOpen, setReferralOpen] = useState(false);
    const [reopening, setReopening] = useState(false);
    const hasPermission = useAuthStore((s) => s.hasPermission);
    const canReopen = hasPermission('field_visits.reopen_closed');

    // Direct suggestions per task (local state)
    const [suggestions, setSuggestions] = useState<Record<string, any[]>>({});

    // Purchase history
    const [purchaseHistory, setPurchaseHistory] = useState<{ records: any[]; summary: any } | null>(null);
    const [purchaseLoading, setPurchaseLoading] = useState(false);

    const visitId = Number(id);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const data = await api.fieldVisits.get(visitId);
            setVisit(data);
            // Seed suggestions from embedded tasks
            const initial: Record<string, any[]> = {};
            for (const t of data.tasks ?? []) {
                initial[String(t.id)] = t.directSuggestions ?? [];
            }
            setSuggestions(initial);
        } catch (err: any) {
            setError(err?.message ?? 'تعذّر تحميل الزيارة');
        } finally {
            setLoading(false);
        }
    }, [visitId]);

    useEffect(() => { load(); }, [load]);

    useEffect(() => {
        if (!visit?.client_id) return;
        setPurchaseLoading(true);
        api.customers.getPurchaseHistory(visit.client_id)
            .then(res => setPurchaseHistory(res))
            .catch(() => setPurchaseHistory(null))
            .finally(() => setPurchaseLoading(false));
    }, [visit?.client_id]);

    // GPS capture helper
    const captureGps = (): Promise<{ lat: number; lng: number; accuracy: number } | null> =>
        new Promise(resolve => {
            if (!navigator.geolocation) { resolve(null); return; }
            navigator.geolocation.getCurrentPosition(
                pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
                () => resolve(null),
                { timeout: 8000, maximumAge: 30000 },
            );
        });

    const handleStart = async () => {
        setActionLoading('start');
        try {
            const gps = await captureGps();
            await api.fieldVisits.start(visitId, gps ?? {});
            await load();
        } catch (err: any) {
            alert(err?.message ?? 'فشل في تسجيل بداية الزيارة');
        } finally {
            setActionLoading(null);
        }
    };

    const handleEnd = async () => {
        setActionLoading('end');
        try {
            const gps = await captureGps();
            await api.fieldVisits.end(visitId, gps ?? {});
            await load();
        } catch (err: any) {
            alert(err?.message ?? 'فشل في تسجيل نهاية الزيارة');
        } finally {
            setActionLoading(null);
        }
    };

    const handleComplete = async () => {
        if (!confirm('تأكيد إتمام الزيارة؟')) return;
        setActionLoading('complete');
        try {
            await api.fieldVisits.complete(visitId);
            await load();
        } catch (err: any) {
            alert(err?.message ?? 'فشل في إتمام الزيارة');
        } finally {
            setActionLoading(null);
        }
    };

    if (loading) {
        return (
            <div className="h-full flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-sky-600" />
            </div>
        );
    }

    if (error || !visit) {
        return (
            <div className="h-full flex flex-col items-center justify-center gap-3 text-slate-500">
                <AlertTriangle className="w-10 h-10 text-amber-500" />
                <p>{error ?? 'الزيارة غير موجودة'}</p>
                <button onClick={() => navigate(-1)}
                    className="text-sm text-sky-600 hover:underline">عودة</button>
            </div>
        );
    }

    const status = STATUS_LABELS[visit.status] ?? { label: visit.status, color: 'text-slate-700', bg: 'bg-slate-100' };
    const geo = visit.geo;
    const source = visit.source;
    const SourceIcon = source ? (SOURCE_ICON[source.source_type] ?? User) : User;
    const tasks: any[] = visit.tasks ?? [];

    const canStart = ['scheduled'].includes(visit.status);
    const canEnd   = ['in_progress'].includes(visit.status);
    const canComplete = ['ended'].includes(visit.status);

    function PurchaseRecordCard({ record: r }: { record: any }) {
        const isDevice = r.itemType === 'device';
        const isEmergency = r.itemType === 'emergency_part';

        const typeConfig: Record<string, { label: string; icon: any; iconClass: string; badgeClass: string }> = {
            device:         { label: 'جهاز',              icon: Smartphone, iconClass: 'text-blue-500',    badgeClass: 'bg-blue-50 text-blue-600'    },
            periodic_part:  { label: 'قطعة صيانة دورية', icon: Wrench,      iconClass: 'text-emerald-500', badgeClass: 'bg-emerald-50 text-emerald-600' },
            emergency_part: { label: 'قطعة صيانة طوارئ', icon: Zap,         iconClass: 'text-orange-500',  badgeClass: 'bg-orange-50 text-orange-600' },
            accessory:      { label: 'اكسسوار',           icon: Puzzle,      iconClass: 'text-purple-500',  badgeClass: 'bg-purple-50 text-purple-600' },
        };
        const tc = typeConfig[r.itemType] ?? typeConfig.accessory;
        const TypeIcon = tc.icon;

        const warrantyLabels: Record<string, string> = {
            contract_warranty: 'كفالة العقد',
            golden_warranty:   'كفالة ذهبية',
            no_warranty:       'بدون كفالة',
        };
        const paymentLabels: Record<string, string> = {
            cash:              'نقدي',
            installment:       'أقساط',
            maintenance_paid:  'مدفوع صيانة',
            warranty_free:     'مجاني (كفالة)',
        };

        return (
            <div className={`rounded-2xl border p-4 ${
                isDevice    ? 'bg-blue-50/50 border-blue-200' :
                isEmergency ? 'bg-orange-50/50 border-orange-200' :
                              'bg-slate-50 border-slate-200'
            }`}>
                {/* Row 1: source + date */}
                <div className="flex items-center gap-2 mb-2">
                    <TypeIcon className={`w-3.5 h-3.5 ${tc.iconClass}`} />
                    <span className="text-xs font-bold text-slate-700">{r.sourceLabel}</span>
                    <span className="text-[10px] text-slate-400">{r.purchaseDate}</span>
                </div>

                {/* Row 2: name + code + type badge */}
                <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-black text-slate-800">{r.itemName}</span>
                    {r.itemCode && (
                        <span className="text-[10px] font-mono text-slate-400 bg-white px-1.5 py-0.5 rounded border border-slate-200">
                            {r.itemCode}
                        </span>
                    )}
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${tc.badgeClass}`}>
                        {tc.label}
                    </span>
                </div>

                {/* Row 3: price + quantity + payment + warranty + install + old-part */}
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                    <span className="text-xs font-black text-slate-700">
                        {Number(r.totalPrice).toLocaleString('ar-SY', { numberingSystem: 'latn' })} ل.س
                    </span>

                    {r.discountInfo && (
                        <>
                            <span className="text-[10px] text-slate-400 line-through">
                                {Number(r.discountInfo.originalPrice).toLocaleString('ar-SY', { numberingSystem: 'latn' })} ل.س
                            </span>
                            <span className="text-[10px] text-emerald-600 bg-emerald-50 px-1.5 rounded">
                                حسم: {Number(r.discountInfo.discountAmount).toLocaleString('ar-SY', { numberingSystem: 'latn' })} ل.س
                            </span>
                        </>
                    )}

                    {r.quantity > 1 && (
                        <span className="text-[10px] text-slate-500">كمية: {r.quantity}</span>
                    )}

                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                        r.paymentType === 'cash'         ? 'bg-slate-100 text-slate-600' :
                        r.paymentType === 'installment'  ? 'bg-amber-50 text-amber-600'  :
                        r.paymentType === 'warranty_free'? 'bg-emerald-50 text-emerald-600' :
                                                           'bg-slate-100 text-slate-600'
                    }`}>
                        {paymentLabels[r.paymentType] ?? r.paymentType}
                    </span>

                    {r.warrantyContext && r.warrantyContext !== 'no_warranty' && (
                        <span className="text-[10px] text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                            {warrantyLabels[r.warrantyContext]}
                            {r.warrantyUntil && ` حتى ${r.warrantyUntil}`}
                        </span>
                    )}

                    {!isDevice && r.isInstalled === true && (
                        <span className="text-[10px] text-emerald-600 bg-emerald-50 px-1.5 rounded flex items-center gap-0.5">
                            <CheckCircle2 className="w-3 h-3" /> مركّب
                        </span>
                    )}
                    {!isDevice && r.isInstalled === false && (
                        <span className="text-[10px] text-amber-600 bg-amber-50 px-1.5 rounded flex items-center gap-0.5">
                            <Clock className="w-3 h-3" /> غير مركّب
                        </span>
                    )}

                    {isEmergency && r.oldPartRemoved === true && (
                        <span className="text-[10px] text-emerald-600 bg-emerald-50 px-1.5 rounded flex items-center gap-0.5">
                            <CheckCircle2 className="w-3 h-3" /> تم سحب القديم
                        </span>
                    )}
                    {isEmergency && r.oldPartRemoved === false && (
                        <span className="text-[10px] text-amber-600 bg-amber-50 px-1.5 rounded flex items-center gap-0.5">
                            <AlertCircle className="w-3 h-3" /> لم يتم السحب
                        </span>
                    )}
                </div>
            </div>
        );
    }

    const allTasksHaveResult = tasks.every((t: any) => t.result_id != null);
    const noBlockingNC = tasks.every((t: any) =>
        !t.name_coll_id || t.proposed_count === 0 || t.name_coll_status !== 'pending'
    );

    return (
        <div className="h-full overflow-y-auto custom-scroll">
            {/* ── Header ── */}
            <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center gap-4 sticky top-0 z-10">
                <button onClick={() => navigate(-1)}
                    className="w-8 h-8 rounded-lg border border-gray-200 flex items-center justify-center hover:bg-gray-50 text-slate-500">
                    <ArrowRight className="w-4 h-4" />
                </button>
                <div className="flex-1">
                    <h1 className="text-base font-bold text-slate-800">
                        {visit.client_name ?? `زيارة #${visit.id}`}
                    </h1>
                    <div className="flex items-center gap-2 mt-0.5">
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${status.bg} ${status.color}`}>
                            {status.label}
                        </span>
                        {visit.scheduled_date && (
                            <span className="text-xs text-slate-400">{formatDate(visit.scheduled_date)}</span>
                        )}
                    </div>
                </div>

                {/* Action buttons */}
                <div className="flex items-center gap-2">
                    {canStart && (
                        <button onClick={handleStart} disabled={actionLoading === 'start'}
                            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600 text-white text-sm font-bold hover:bg-blue-500 disabled:opacity-60 transition-colors">
                            {actionLoading === 'start' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                            <span>بدء الزيارة</span>
                        </button>
                    )}
                    {canEnd && (
                        <button onClick={handleEnd} disabled={actionLoading === 'end'}
                            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-amber-600 text-white text-sm font-bold hover:bg-amber-500 disabled:opacity-60 transition-colors">
                            {actionLoading === 'end' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Square className="w-4 h-4" />}
                            <span>إنهاء الزيارة</span>
                        </button>
                    )}
                    {canComplete && (
                        <button
                            onClick={handleComplete}
                            disabled={actionLoading === 'complete' || !allTasksHaveResult || !noBlockingNC}
                            title={!allTasksHaveResult ? 'يجب تسجيل نتائج جميع المهام أولاً' : !noBlockingNC ? 'يجب إتمام مهمة التوصيل أولاً' : ''}
                            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                            {actionLoading === 'complete' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Flag className="w-4 h-4" />}
                            <span>إتمام الزيارة</span>
                        </button>
                    )}
                    {/* DEC-007 D40/D41/D46: referral sheet button — visible during in_progress / ended */}
                    {(visit?.status === 'in_progress' || visit?.status === 'ended') && (
                        <button
                            onClick={() => setReferralOpen(true)}
                            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-sky-600 text-white text-sm font-bold hover:bg-sky-500 transition-colors">
                            <ListPlus className="w-4 h-4" />
                            <span>اللائحة</span>
                        </button>
                    )}
                    {/* DEC-007 D42/D46: visit survey button */}
                    {(visit?.status === 'in_progress' || visit?.status === 'ended') && (
                        <button
                            onClick={() => setSurveyOpen(true)}
                            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-700 text-white text-sm font-bold hover:bg-emerald-600 transition-colors">
                            <ClipboardCheck className="w-4 h-4" />
                            <span>الاستبيان</span>
                        </button>
                    )}
                    {/* DEC-004 D11: reopen closed visit (admin only) */}
                    {visit?.status === 'closed' && canReopen && (
                        <button
                            onClick={async () => {
                                const reason = window.prompt('سبب فتح الزيارة المُقفلة:');
                                if (!reason || !reason.trim()) return;
                                setReopening(true);
                                try {
                                    await api.fieldVisits.reopen(visit.id, reason.trim());
                                    await load();
                                } catch (e: any) {
                                    alert(e?.message ?? 'فشل الفتح');
                                } finally {
                                    setReopening(false);
                                }
                            }}
                            disabled={reopening}
                            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-violet-600 text-white text-sm font-bold hover:bg-violet-500 disabled:opacity-60 transition-colors">
                            {reopening ? <Loader2 className="w-4 h-4 animate-spin" /> : <Unlock className="w-4 h-4" />}
                            <span>فتح المُقفل</span>
                        </button>
                    )}
                    {visit?.status === 'closed' && !canReopen && (
                        <span className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 text-slate-500 text-xs">
                            <Lock className="w-3.5 h-3.5" />
                            مُقفلة — فتحها يتطلب صلاحية الإدارة العليا
                        </span>
                    )}
                </div>
            </div>

            <div className="p-6 space-y-5 max-w-3xl mx-auto">

                {/* ── Source Label ── */}
                {source && (
                    <div className="bg-white rounded-xl border border-gray-200 px-5 py-4 flex items-center gap-3">
                        <div className="w-9 h-9 rounded-lg bg-indigo-50 flex items-center justify-center shrink-0">
                            <SourceIcon className="w-5 h-5 text-indigo-600" />
                        </div>
                        <div>
                            <p className="text-xs text-slate-500 font-medium">مصدر الزيارة</p>
                            <p className="text-sm font-bold text-slate-800 mt-0.5">{source.source_label}</p>
                        </div>
                    </div>
                )}

                {/* ── Geo Tracking ── */}
                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                    <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-2">
                        <Navigation className="w-4 h-4 text-sky-600" />
                        <h2 className="text-sm font-bold text-slate-700">تتبع الموقع والوقت</h2>
                    </div>
                    <div className="p-5">
                        {geo ? (
                            <div className="grid grid-cols-2 gap-4">
                                {/* Start */}
                                <div className="space-y-1">
                                    <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">بداية الزيارة</p>
                                    {geo.actual_start_time ? (
                                        <>
                                            <div className="flex items-center gap-1.5 text-sm text-slate-700">
                                                <Clock className="w-3.5 h-3.5 text-emerald-500" />
                                                <span className="font-mono">{formatTime(geo.actual_start_time)}</span>
                                            </div>
                                            {geo.actual_start_lat ? (
                                                <div className="flex items-center gap-1.5 text-xs text-slate-500">
                                                    <MapPin className="w-3 h-3 text-emerald-400" />
                                                    <span dir="ltr">{Number(geo.actual_start_lat).toFixed(5)}, {Number(geo.actual_start_lng).toFixed(5)}</span>
                                                </div>
                                            ) : (
                                                <div className="flex items-center gap-1 text-xs text-amber-600">
                                                    <AlertTriangle className="w-3 h-3" />
                                                    <span>الموقع غير مسجل</span>
                                                </div>
                                            )}
                                        </>
                                    ) : <p className="text-xs text-slate-400">لم تبدأ بعد</p>}
                                </div>

                                {/* End */}
                                <div className="space-y-1">
                                    <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">نهاية الزيارة</p>
                                    {geo.actual_end_time ? (
                                        <>
                                            <div className="flex items-center gap-1.5 text-sm text-slate-700">
                                                <Clock className="w-3.5 h-3.5 text-red-400" />
                                                <span className="font-mono">{formatTime(geo.actual_end_time)}</span>
                                            </div>
                                            {geo.actual_end_lat ? (
                                                <div className="flex items-center gap-1.5 text-xs text-slate-500">
                                                    <MapPin className="w-3 h-3 text-red-400" />
                                                    <span dir="ltr">{Number(geo.actual_end_lat).toFixed(5)}, {Number(geo.actual_end_lng).toFixed(5)}</span>
                                                </div>
                                            ) : (
                                                <div className="flex items-center gap-1 text-xs text-amber-600">
                                                    <AlertTriangle className="w-3 h-3" />
                                                    <span>الموقع غير مسجل</span>
                                                </div>
                                            )}
                                        </>
                                    ) : <p className="text-xs text-slate-400">لم تنته بعد</p>}
                                </div>

                                {/* Duration / Distance */}
                                {(geo.duration_minutes != null || geo.distance_meters != null) && (
                                    <div className="col-span-2 pt-3 border-t border-gray-100 flex items-center gap-6">
                                        {geo.duration_minutes != null && (
                                            <div className="flex items-center gap-1.5 text-sm text-slate-600">
                                                <Clock className="w-4 h-4 text-slate-400" />
                                                <span className="font-bold">{geo.duration_minutes}</span>
                                                <span className="text-slate-400">دقيقة</span>
                                            </div>
                                        )}
                                        {geo.distance_meters != null && (
                                            <div className="flex items-center gap-1.5 text-sm text-slate-600">
                                                <Ruler className="w-4 h-4 text-slate-400" />
                                                <span className="font-bold">{geo.distance_meters}</span>
                                                <span className="text-slate-400">م</span>
                                            </div>
                                        )}
                                        {geo.location_missing && (
                                            <div className="flex items-center gap-1 text-xs text-amber-600 mr-auto">
                                                <AlertTriangle className="w-3.5 h-3.5" />
                                                <span>الموقع غير مسجل</span>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        ) : (
                            <p className="text-sm text-slate-400 text-center py-3">لا توجد بيانات موقع بعد — ابدأ الزيارة لتسجيل الموقع</p>
                        )}
                    </div>
                </div>

                {/* ── Tasks Panel ── */}
                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                    <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-2">
                        <ClipboardList className="w-4 h-4 text-indigo-600" />
                        <h2 className="text-sm font-bold text-slate-700">مهام الزيارة ({tasks.length})</h2>
                    </div>
                    <div className="divide-y divide-gray-100">
                        {tasks.length === 0 && (
                            <p className="text-sm text-slate-400 text-center py-6">لا توجد مهام مرتبطة بهذه الزيارة</p>
                        )}
                        {tasks.map((task: any) => {
                            const hasResult = task.result_id != null;
                            const taskSuggestions = suggestions[String(task.id)] ?? [];

                            return (
                                <div key={task.id} className="p-5 space-y-3">
                                    {/* Task header */}
                                    <div className="flex items-start justify-between gap-3">
                                        <div>
                                            <p className="text-sm font-bold text-slate-800">
                                                {task.task_type === 'device_demo' ? 'عرض جهاز' :
                                                 task.task_type === 'emergency_maintenance' ? 'صيانة طارئة' :
                                                 task.task_type}
                                                {task.sequence_no > 1 && (
                                                    <span className="text-slate-400 font-normal"> #{task.sequence_no}</span>
                                                )}
                                            </p>
                                            <p className="text-xs text-slate-500 mt-0.5">
                                                {task.task_family === 'marketing' ? 'تسويق' :
                                                 task.task_family === 'emergency' ? 'طوارئ' : 'خدمة'}
                                            </p>
                                        </div>
                                        <span className={`text-xs font-bold px-2 py-1 rounded-full shrink-0 ${
                                            hasResult
                                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                                : 'bg-slate-100 text-slate-500'
                                        }`}>
                                            {hasResult ? (
                                                <span className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3" />لها نتيجة</span>
                                            ) : 'بانتظار النتيجة'}
                                        </span>
                                    </div>

                                    {/* Result summary */}
                                    {hasResult && task.final_decision && (
                                        <div className="bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2 text-xs text-emerald-700">
                                            <span className="font-semibold">القرار: </span>{task.final_decision}
                                            {task.closing_notes && <span className="text-slate-600 mr-2">— {task.closing_notes}</span>}
                                        </div>
                                    )}

                                    {/* Name collection */}
                                    {task.name_coll_id && (
                                        <div className={`rounded-lg border px-3 py-2.5 ${
                                            task.name_coll_status === 'completed'
                                                ? 'bg-emerald-50 border-emerald-200'
                                                : task.name_coll_status === 'partial'
                                                ? 'bg-amber-50 border-amber-200'
                                                : 'bg-slate-50 border-slate-200'
                                        }`}>
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-2">
                                                    <UserPlus className="w-4 h-4 text-indigo-500" />
                                                    <span className="text-xs font-bold text-slate-700">مهمة التوصيل</span>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <span className="text-xs text-slate-500">
                                                        {task.actual_count ?? 0}/{task.proposed_count} أسماء
                                                    </span>
                                                    {task.name_coll_status !== 'completed' && (
                                                        <button
                                                            onClick={() => setNcModal({
                                                                id: task.name_coll_id,
                                                                proposed_count: task.proposed_count,
                                                                actual_count: task.actual_count ?? 0,
                                                                status: task.name_coll_status,
                                                                notes: task.name_coll_notes,
                                                            })}
                                                            className="text-xs px-2.5 py-1 rounded-lg bg-indigo-600 text-white font-bold hover:bg-indigo-500 transition-colors">
                                                            تسجيل
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {/* Direct suggestions */}
                                    <DirectSuggestionForm
                                        taskId={task.id}
                                        suggestions={taskSuggestions}
                                        onAdded={newS => setSuggestions(prev => ({
                                            ...prev,
                                            [String(task.id)]: [...(prev[String(task.id)] ?? []), newS],
                                        }))}
                                    />
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* ── Client Info ── */}
                <div className="bg-white rounded-xl border border-gray-200 px-5 py-4 grid grid-cols-2 gap-4">
                    <div>
                        <p className="text-xs text-slate-500">الزبون</p>
                        <p className="text-sm font-bold text-slate-800 mt-0.5">{visit.client_name}</p>
                    </div>
                    {visit.client_mobile && (
                        <div>
                            <p className="text-xs text-slate-500">الهاتف</p>
                            <a href={`tel:${visit.client_mobile}`} className="text-sm font-bold text-sky-600 mt-0.5 flex items-center gap-1">
                                <Phone className="w-3.5 h-3.5" />
                                <span dir="ltr">{visit.client_mobile}</span>
                            </a>
                        </div>
                    )}
                    {visit.branch_name && (
                        <div>
                            <p className="text-xs text-slate-500">الفرع</p>
                            <p className="text-sm font-semibold text-slate-700 mt-0.5">{visit.branch_name}</p>
                        </div>
                    )}
                    {visit.scheduled_time && (
                        <div>
                            <p className="text-xs text-slate-500">الموعد المجدول</p>
                            <p className="text-sm font-semibold text-slate-700 mt-0.5 font-mono">{visit.scheduled_time}</p>
                        </div>
                    )}
                </div>

                {/* ── Purchase History ── */}
                {visit.client_id && (
                    <div className="bg-white rounded-3xl p-6 border border-slate-100 shadow-sm space-y-4">
                        <div className="flex items-center justify-between">
                            <h4 className="font-black text-slate-800 text-sm flex items-center gap-2">
                                <ShoppingCart className="w-4 h-4 text-slate-400" />
                                سجل المشتريات
                            </h4>
                            {purchaseHistory && purchaseHistory.summary && (
                                <span className="text-xs font-bold text-slate-500 bg-slate-100 px-2 py-1 rounded-lg">
                                    {purchaseHistory.summary.totalPurchases} مشتريات
                                </span>
                            )}
                        </div>

                        {purchaseLoading && (
                            <div className="flex items-center justify-center py-4">
                                <Loader2 className="w-5 h-5 animate-spin text-sky-500" />
                            </div>
                        )}

                        {!purchaseLoading && purchaseHistory && purchaseHistory.summary && purchaseHistory.records.length > 0 && (
                            <div className="flex items-center gap-2 flex-wrap">
                                <div className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-50 border border-blue-200">
                                    <span className="text-xs font-bold text-blue-700">{purchaseHistory.summary.totalDevices}</span>
                                    <span className="text-[10px] text-blue-600">أجهزة</span>
                                </div>
                                <div className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-50 border border-emerald-200">
                                    <span className="text-xs font-bold text-emerald-700">{purchaseHistory.summary.totalParts}</span>
                                    <span className="text-[10px] text-emerald-600">قطع</span>
                                </div>
                                <div className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-50 border border-slate-200">
                                    <span className="text-xs font-bold text-slate-700">
                                        {Number(purchaseHistory.summary.totalSpent).toLocaleString('ar-SY', { numberingSystem: 'latn' })} ل.س
                                    </span>
                                    <span className="text-[10px] text-slate-600">الإجمالي</span>
                                </div>
                            </div>
                        )}

                        {!purchaseLoading && purchaseHistory && purchaseHistory.records.length === 0 && (
                            <p className="text-sm text-slate-400 text-center py-4">لا توجد مشتريات مسجّلة لهذا الزبون</p>
                        )}

                        {!purchaseLoading && purchaseHistory && purchaseHistory.records.length > 0 && (
                            <div className="space-y-3">
                                {purchaseHistory.records.map((record: any) => (
                                    <PurchaseRecordCard key={record.id} record={record} />
                                ))}
                            </div>
                        )}

                        {!purchaseLoading && !purchaseHistory && (
                            <p className="text-sm text-slate-400 text-center py-4">تعذّر تحميل سجل المشتريات</p>
                        )}
                    </div>
                )}
            </div>

            {/* Name Collection Modal (legacy) */}
            {ncModal && (
                <NameCollectionModal
                    nameColl={ncModal}
                    onClose={() => setNcModal(null)}
                    onSaved={() => { setNcModal(null); load(); }}
                />
            )}

            {/* DEC-007: visit-level survey + referral sheet modals */}
            {visit && (
                <>
                    <VisitSurveyModal
                        visitId={visit.id}
                        open={surveyOpen}
                        onClose={() => setSurveyOpen(false)}
                        onSaved={() => { setSurveyOpen(false); load(); }}
                    />
                    <ReferralSheetModal
                        visitId={visit.id}
                        open={referralOpen}
                        onClose={() => setReferralOpen(false)}
                        onSaved={() => { setReferralOpen(false); load(); }}
                    />
                </>
            )}
        </div>
    );
}
