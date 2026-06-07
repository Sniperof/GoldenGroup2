import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
    ArrowRight, MapPin, Clock, AlertTriangle, CheckCircle2, AlertCircle,
    User, Users, Play, Square, Flag, Loader2,
    ClipboardList, Navigation, Ruler, Calendar, CalendarClock,
    Headphones, MessageSquare, Droplets, UserCheck,
    ShoppingCart, Smartphone, Wrench, Zap, Puzzle, Map as MapIcon,
    ClipboardCheck, ListPlus, Lock, Unlock, RefreshCw, FileText,
    Repeat, XCircle, ChevronLeft,
} from 'lucide-react';
import { api } from '../../lib/api';
import VisitSurveyModal from '../../components/fieldVisits/VisitSurveyModal';
import ReferralSheetModal from '../../components/fieldVisits/ReferralSheetModal';
import DeviceDemoResultModal from '../../taskTypes/device_demo/DeviceDemoResultModal';
import DeviceDeliveryResultModal from '../../taskTypes/device_delivery/DeviceDeliveryResultModal';
import DeviceInstallationResultModal from '../../taskTypes/device_delivery/DeviceInstallationResultModal';
import EmergencyResultModal from '../../taskTypes/emergency_maintenance/EmergencyResultModal';
import ClientSnapshot from '../../components/ClientSnapshot';
import { useAuthStore } from '../../hooks/useAuthStore';

// ── helpers ───────────────────────────────────────────────────────────────────

// DEC-004 D18: 7 canonical states + `closed`.
const STATUS_LABELS: Record<string, { label: string; color: string; bg: string }> = {
    scheduled:             { label: 'مجدولة',         color: 'text-slate-700',   bg: 'bg-slate-100'  },
    in_progress:           { label: 'جارية',          color: 'text-blue-700',    bg: 'bg-blue-50'    },
    ended:                 { label: 'انتهت ميدانياً', color: 'text-amber-700',   bg: 'bg-amber-50'   },
    completed:             { label: 'مكتملة',         color: 'text-emerald-700', bg: 'bg-emerald-50' },
    not_completed:         { label: 'لم تتم',         color: 'text-rose-700',    bg: 'bg-rose-50'    },
    cancelled:             { label: 'ملغاة',          color: 'text-slate-500',   bg: 'bg-slate-100'  },
    closed:                { label: 'مُقفلة إدارياً', color: 'text-slate-700',   bg: 'bg-slate-200'  },
    postponed_by_company:  { label: 'مؤجلة (الشركة)', color: 'text-amber-700',   bg: 'bg-amber-50'   },
    postponed_by_customer: { label: 'مؤجلة (الزبون)', color: 'text-orange-700',  bg: 'bg-orange-50'  },
    needs_reschedule:      { label: 'تحتاج إعادة جدولة', color: 'text-yellow-700', bg: 'bg-yellow-50' },
};

// VDP §1: who answered the booking call
const ANSWERED_BY_LABELS: Record<string, string> = {
    customer: 'الزبون شخصياً',
    spouse:   'الزوج / الزوجة',
    child:    'الابن / الابنة',
    other:    'شخص آخر',
};

const ORIGIN_LABELS: Record<string, string> = {
    telemarketing:      'تسويق هاتفي',
    expected_followup:  'متابعة متوقعة',
    manual:             'إنشاء يدوي',
    emergency_request:  'طلب طارئ',
    system:             'النظام',
};

// VDP §6: visit task status
const TASK_STATUS_LABELS: Record<string, { label: string; color: string; bg: string }> = {
    pending:       { label: 'بانتظار التنفيذ', color: 'text-slate-500',   bg: 'bg-slate-100'  },
    in_progress:   { label: 'قيد التنفيذ',     color: 'text-blue-700',    bg: 'bg-blue-50'    },
    completed:     { label: 'مكتملة',          color: 'text-emerald-700', bg: 'bg-emerald-50' },
    not_completed: { label: 'لم تكتمل',        color: 'text-rose-700',    bg: 'bg-rose-50'    },
    cancelled:     { label: 'ملغاة',           color: 'text-slate-400',   bg: 'bg-slate-100'  },
    closed:        { label: 'مغلقة',           color: 'text-slate-700',   bg: 'bg-slate-200'  },
};

const FINAL_DECISION_LABELS: Record<string, { label: string; cls: string }> = {
    offer_presented: { label: 'تقديم عرض', cls: 'bg-sky-50 text-sky-700 border-sky-200' },
    device_sold: { label: 'تم البيع', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    rescheduled: { label: 'إعادة جدولة', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
    cancelled: { label: 'إلغاء', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
    accepted: { label: 'مقبول (قديم)', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    rejected: { label: 'مرفوض (قديم)', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
    needs_followup: { label: 'متابعة (قديم)', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
    delivered_successfully: { label: 'تم التسليم', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    customer_not_available: { label: 'الزبون غير متوفر', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
    wrong_address: { label: 'عنوان خاطئ', cls: 'bg-orange-50 text-orange-700 border-orange-200' },
    refused_delivery: { label: 'رفض التسليم', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
    installed_successfully: { label: 'تم التركيب', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    installation_incomplete: { label: 'التركيب غير مكتمل', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
    refused_installation: { label: 'رفض التركيب', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
    // emergency_maintenance lifecycle outcomes
    resolved: { label: 'تَم الإصلاح', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    unresolved: { label: 'لم يُحَلّ بالكامل', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
    needs_follow_up: { label: 'بحاجة مُتابعة', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
};

function getFinalDecisionMeta(value?: string | null) {
    if (!value) {
        return { label: 'غير مسجلة بعد', cls: 'bg-slate-50 text-slate-600 border-slate-200' };
    }
    return FINAL_DECISION_LABELS[value] ?? {
        label: value,
        cls: 'bg-slate-50 text-slate-700 border-slate-200 font-mono',
    };
}

function getDerivedOutcomeMeta(task: any) {
    const finalDecision = task.final_decision ?? null;
    const offers = Array.isArray(task.offers) && task.offers.length > 0
        ? task.offers
        : (Array.isArray(task.preOffers) ? task.preOffers : task.pre_offers ?? []);
    const count = (response: string) =>
        offers.filter((offer: any) => offer?.customerResponse === response).length;
    const accepted = count('accepted');
    const rejected = count('rejected');
    const extension = count('extension_requested');
    const total = offers.length;

    if (finalDecision === 'offer_presented') {
        if (accepted > 0) {
            return {
                label: accepted === 1 ? 'بيع من عرض مقبول' : `بيع من ${accepted} عروض مقبولة`,
                detail: total > 0 ? `${accepted}/${total} عروض مقبولة` : null,
                cls: 'bg-emerald-50 text-emerald-700 border-emerald-200',
                counts: { total, accepted, rejected, extension },
            };
        }
        if (extension > 0) {
            return {
                label: extension === 1 ? 'مهلة على عرض' : `مهلة على ${extension} عروض`,
                detail: 'تحتاج متابعة لاحقة',
                cls: 'bg-amber-50 text-amber-700 border-amber-200',
                counts: { total, accepted, rejected, extension },
            };
        }
        if (total > 0 && rejected === total) {
            return {
                label: 'لم يتم البيع',
                detail: 'كل العروض مرفوضة',
                cls: 'bg-rose-50 text-rose-700 border-rose-200',
                counts: { total, accepted, rejected, extension },
            };
        }
        return {
            label: total > 0 ? 'عرض بانتظار رد مكتمل' : 'تقديم عرض دون عروض مرتبطة',
            detail: total > 0 ? `${total} عروض مسجلة` : null,
            cls: 'bg-sky-50 text-sky-700 border-sky-200',
            counts: { total, accepted, rejected, extension },
        };
    }

    if (finalDecision === 'device_sold') {
        return {
            label: 'بيع مباشر',
            detail: 'سجل قديم أو مسار بيع مباشر',
            cls: 'bg-emerald-50 text-emerald-700 border-emerald-200',
            counts: { total, accepted, rejected, extension },
        };
    }

    if (finalDecision === 'rescheduled' || finalDecision === 'needs_followup') {
        return {
            label: 'تحتاج متابعة',
            detail: task.reason_code ? `السبب: ${task.reason_code}` : null,
            cls: 'bg-amber-50 text-amber-700 border-amber-200',
            counts: { total, accepted, rejected, extension },
        };
    }

    if (finalDecision === 'cancelled') {
        return {
            label: 'لم تنجز',
            detail: task.reason_code ? `السبب: ${task.reason_code}` : null,
            cls: 'bg-rose-50 text-rose-700 border-rose-200',
            counts: { total, accepted, rejected, extension },
        };
    }

    return {
        label: 'محصلة غير محددة',
        detail: null,
        cls: 'bg-slate-50 text-slate-600 border-slate-200',
        counts: { total, accepted, rejected, extension },
    };
}

function formatTime(ts: string | null | undefined) {
    if (!ts) return null;
    try { return new Date(ts).toLocaleTimeString('ar-SY', { hour: '2-digit', minute: '2-digit', numberingSystem: 'latn' }); }
    catch { return ts; }
}

function formatDate(ts: string | null | undefined) {
    if (!ts) return null;
    try { return new Date(ts).toLocaleDateString('ar-SY', { numberingSystem: 'latn' }); }
    catch { return ts; }
}

const dash = (v: any) => (v === null || v === undefined || v === '' ? '—' : v);

// ── small presentational primitives ─────────────────────────────────────────

function Section({ icon: Icon, title, accent = 'text-sky-600', children, action }: {
    icon: any; title: string; accent?: string; children: React.ReactNode; action?: React.ReactNode;
}) {
    return (
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
            <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-2">
                <Icon className={`w-4 h-4 ${accent}`} />
                <h2 className="text-sm font-bold text-slate-700">{title}</h2>
                {action && <div className="mr-auto">{action}</div>}
            </div>
            <div className="p-5">{children}</div>
        </div>
    );
}

function Field({ icon: Icon, label, value, mono = false, full = false, dir }: {
    icon?: any; label: string; value: any; mono?: boolean; full?: boolean; dir?: 'ltr' | 'rtl';
}) {
    return (
        <div className={full ? 'col-span-2 md:col-span-3' : ''}>
            <p className="text-xs text-slate-400 font-medium flex items-center gap-1">
                {Icon && <Icon className="w-3 h-3" />} {label}
            </p>
            <p className={`text-sm font-semibold text-slate-800 mt-1 ${mono ? 'font-mono' : ''}`} dir={dir}>
                {dash(value)}
            </p>
        </div>
    );
}

// ── component ─────────────────────────────────────────────────────────────────

export default function VisitDetailPage() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();

    const [visit, setVisit] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [actionLoading, setActionLoading] = useState<string | null>(null);

    const [surveyOpen, setSurveyOpen] = useState(false);
    const [referralOpen, setReferralOpen] = useState(false);
    const [resultTask, setResultTask] = useState<any | null>(null);
    const [reopening, setReopening] = useState(false);
    const hasPermission = useAuthStore((s) => s.hasPermission);
    const canReopen = hasPermission('field_visits.reopen_closed');

    const visitId = Number(id);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const data = await api.fieldVisits.get(visitId);
            setVisit(data);
        } catch (err: any) {
            setError(err?.message ?? 'تعذّر تحميل الزيارة');
        } finally {
            setLoading(false);
        }
    }, [visitId]);

    useEffect(() => { load(); }, [load]);

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
        } finally { setActionLoading(null); }
    };

    const handleEnd = async () => {
        setActionLoading('end');
        try {
            const gps = await captureGps();
            await api.fieldVisits.end(visitId, gps ?? {});
            await load();
        } catch (err: any) {
            alert(err?.message ?? 'فشل في تسجيل نهاية الزيارة');
        } finally { setActionLoading(null); }
    };

    const handleComplete = async () => {
        if (!confirm('تأكيد إتمام الزيارة؟')) return;
        setActionLoading('complete');
        try {
            await api.fieldVisits.complete(visitId);
            await load();
        } catch (err: any) {
            alert(err?.message ?? 'فشل في إتمام الزيارة');
        } finally { setActionLoading(null); }
    };

    const handleClose = async () => {
        if (!confirm('تأكيد إقفال الزيارة وكل مهامها؟ بعد الإقفال ستحتاج صلاحية فتح الزيارة للتعديل.')) return;
        setActionLoading('close');
        try {
            await api.fieldVisits.close(visitId);
            await load();
        } catch (err: any) {
            alert(err?.message ?? 'فشل في إقفال الزيارة');
        } finally { setActionLoading(null); }
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
                <button onClick={() => navigate(-1)} className="text-sm text-sky-600 hover:underline">عودة</button>
            </div>
        );
    }

    const status = STATUS_LABELS[visit.status] ?? { label: visit.status, color: 'text-slate-700', bg: 'bg-slate-100' };
    const geo = visit.geo;
    const tasks: any[] = visit.tasks ?? [];
    const station: any[] = visit.station ?? [];
    const team = visit.team ?? {};
    const sheet = visit.referralSheet;
    const survey = visit.survey;
    const gps = visit.client_gps;

    const canStart = visit.status === 'scheduled';
    const canEnd = visit.status === 'in_progress';
    const canComplete = visit.status === 'ended';
    const canManageReferral = visit.status === 'in_progress' || visit.status === 'ended';
    const allTasksHaveResult = tasks.every((t: any) => t.result_id != null);
    const canCloseVisit = visit.status === 'completed' && allTasksHaveResult;

    // VDP §4: reassigned team becomes primary; original becomes backup
    const reassigned = team.reassigned;
    const primaryTeam = reassigned ?? team.original;
    const backupTeam = reassigned ? team.original : null;

    const answeredByLabel = visit.answered_by
        ? (ANSWERED_BY_LABELS[visit.answered_by] ?? visit.answered_by)
        : null;

    const gpsHref = gps?.lat && gps?.lng ? `https://www.google.com/maps?q=${gps.lat},${gps.lng}` : null;

    function TeamCard({ data, label, muted }: { data: any; label: string; muted?: boolean }) {
        const roles = [
            { key: 'supervisor', title: 'المشرف', icon: UserCheck },
            { key: 'technician', title: 'الفني', icon: Wrench },
            { key: 'trainee', title: 'المتدرّب', icon: User },
        ];
        return (
            <div className={`rounded-xl border p-4 ${muted ? 'bg-slate-50 border-slate-200' : 'bg-indigo-50/40 border-indigo-200'}`}>
                <p className={`text-xs font-bold mb-3 ${muted ? 'text-slate-500' : 'text-indigo-700'}`}>{label}</p>
                <div className="grid grid-cols-3 gap-3">
                    {roles.map(({ key, title, icon: Icon }) => (
                        <div key={key} className="flex items-center gap-2">
                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${muted ? 'bg-slate-200' : 'bg-white'}`}>
                                <Icon className={`w-4 h-4 ${muted ? 'text-slate-400' : 'text-indigo-500'}`} />
                            </div>
                            <div className="min-w-0">
                                <p className="text-[10px] text-slate-400">{title}</p>
                                <p className="text-xs font-semibold text-slate-700 truncate">{dash(data?.[key]?.name)}</p>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        );
    }

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
        return (
            <div className={`rounded-2xl border p-4 ${isDevice ? 'bg-blue-50/50 border-blue-200' : isEmergency ? 'bg-orange-50/50 border-orange-200' : 'bg-slate-50 border-slate-200'}`}>
                <div className="flex items-center gap-2 mb-2">
                    <TypeIcon className={`w-3.5 h-3.5 ${tc.iconClass}`} />
                    <span className="text-xs font-bold text-slate-700">{r.sourceLabel}</span>
                    <span className="text-[10px] text-slate-400">{r.purchaseDate}</span>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-black text-slate-800">{r.itemName}</span>
                    {r.itemCode && <span className="text-[10px] font-mono text-slate-400 bg-white px-1.5 py-0.5 rounded border border-slate-200">{r.itemCode}</span>}
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${tc.badgeClass}`}>{tc.label}</span>
                </div>
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                    <span className="text-xs font-black text-slate-700">
                        {Number(r.totalPrice).toLocaleString('ar-SY', { numberingSystem: 'latn' })} ل.س
                    </span>
                    {r.quantity > 1 && <span className="text-[10px] text-slate-500">كمية: {r.quantity}</span>}
                </div>
            </div>
        );
    }

    return (
        <div className="h-full overflow-y-auto custom-scroll bg-slate-50/40">
            {/* ── Header ── */}
            <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center gap-4 sticky top-0 z-10">
                <button onClick={() => navigate(-1)}
                    className="w-8 h-8 rounded-lg border border-gray-200 flex items-center justify-center hover:bg-gray-50 text-slate-500">
                    <ArrowRight className="w-4 h-4" />
                </button>
                <div className="flex-1">
                    <h1 className="text-base font-bold text-slate-800">
                        {visit.client_name ?? `زيارة #${visit.id}`}
                        <span className="text-slate-300 font-mono text-sm mr-2">#{visit.id}</span>
                    </h1>
                    <div className="flex items-center gap-2 mt-0.5">
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${status.bg} ${status.color}`}>{status.label}</span>
                        {visit.scheduled_date && <span className="text-xs text-slate-400">{formatDate(visit.scheduled_date)}</span>}
                        {visit.origin_type && (
                            <span className="text-[10px] text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                                {ORIGIN_LABELS[visit.origin_type] ?? visit.origin_type}
                            </span>
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
                        <button onClick={handleComplete} disabled={actionLoading === 'complete' || !allTasksHaveResult}
                            title={!allTasksHaveResult ? 'يجب تسجيل نتائج جميع المهام أولاً' : ''}
                            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                            {actionLoading === 'complete' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Flag className="w-4 h-4" />}
                            <span>إتمام الزيارة</span>
                        </button>
                    )}
                    {canCloseVisit && (
                        <button onClick={handleClose} disabled={actionLoading === 'close'}
                            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 text-white text-sm font-bold hover:bg-slate-700 disabled:opacity-60 transition-colors">
                            {actionLoading === 'close' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
                            <span>إقفال المهام</span>
                        </button>
                    )}
                    {canManageReferral && (
                        <button onClick={() => setReferralOpen(true)}
                            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-sky-600 text-white text-sm font-bold hover:bg-sky-500 transition-colors">
                            <ListPlus className="w-4 h-4" /><span>اللائحة</span>
                        </button>
                    )}
                    {canManageReferral && (
                        <button onClick={() => setSurveyOpen(true)}
                            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-700 text-white text-sm font-bold hover:bg-emerald-600 transition-colors">
                            <ClipboardCheck className="w-4 h-4" /><span>الاستبيان</span>
                        </button>
                    )}
                    {visit.status === 'closed' && canReopen && (
                        <button
                            onClick={async () => {
                                const reason = window.prompt('سبب فتح الزيارة المُقفلة:');
                                if (!reason || !reason.trim()) return;
                                setReopening(true);
                                try { await api.fieldVisits.reopen(visit.id, reason.trim()); await load(); }
                                catch (e: any) { alert(e?.message ?? 'فشل الفتح'); }
                                finally { setReopening(false); }
                            }}
                            disabled={reopening}
                            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-violet-600 text-white text-sm font-bold hover:bg-violet-500 disabled:opacity-60 transition-colors">
                            {reopening ? <Loader2 className="w-4 h-4 animate-spin" /> : <Unlock className="w-4 h-4" />}
                            <span>فتح المُقفل</span>
                        </button>
                    )}
                    {visit.status === 'closed' && !canReopen && (
                        <span className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 text-slate-500 text-xs">
                            <Lock className="w-3.5 h-3.5" /> مُقفلة
                        </span>
                    )}
                </div>
            </div>

            <div className="p-6 space-y-5 max-w-4xl mx-auto">

                {/* ── ١) معلومات الموعد ── */}
                <Section icon={CalendarClock} title="معلومات الموعد" accent="text-sky-600">
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-y-4 gap-x-4">
                        <Field icon={Calendar} label="تاريخ التنفيذ" value={formatDate(visit.scheduled_date)} />
                        <Field icon={Clock} label="الموعد المتوقع للوصول" value={visit.scheduled_time} mono />
                        <Field icon={Headphones} label="من رد على الاتصال" value={answeredByLabel} />
                        <Field icon={Calendar} label="تاريخ حجز الموعد" value={formatDate(visit.appointment_booked_at)} />
                        <Field icon={Clock} label="وقت حجز الموعد" value={formatTime(visit.appointment_booked_at)} mono />
                        <Field icon={User} label="التيليماركتر" value={visit.telemarketer_name} />
                        <Field icon={Droplets} label="مصدر المياه" value={visit.client_water_source} />
                        <Field icon={MessageSquare} label="ملاحظات التيليماركتر" value={visit.telemarketer_notes} full />
                    </div>
                </Section>

                {/* ── ٣) محطة نطاق العمل والموقع ── */}
                <Section icon={MapIcon} title="محطة نطاق العمل والموقع" accent="text-rose-600">
                    {station.length > 0 ? (
                        <div className="flex items-center gap-1.5 flex-wrap mb-4">
                            {station.map((s: any, i: number) => (
                                <span key={s.id} className="flex items-center gap-1.5">
                                    {i > 0 && <ChevronLeft className="w-3.5 h-3.5 text-slate-300" />}
                                    <span className={`text-xs font-bold px-2.5 py-1 rounded-lg ${
                                        i === station.length - 1 ? 'bg-rose-50 text-rose-700 border border-rose-200' : 'bg-slate-100 text-slate-600'
                                    }`}>{s.name}</span>
                                </span>
                            ))}
                        </div>
                    ) : (
                        <p className="text-sm text-slate-400 mb-4">لم تُحدَّد المحطة بعد</p>
                    )}
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-y-4 gap-x-4">
                        <Field icon={MapPin} label="العنوان التفصيلي" value={visit.client_detailed_address} full />
                        {gpsHref ? (
                            <div>
                                <p className="text-xs text-slate-400 font-medium flex items-center gap-1"><Navigation className="w-3 h-3" /> الموقع على الخريطة</p>
                                <a href={gpsHref} target="_blank" rel="noreferrer"
                                    className="text-sm font-semibold text-sky-600 hover:underline mt-1 inline-flex items-center gap-1">
                                    <MapPin className="w-3.5 h-3.5" /><span dir="ltr">{Number(gps.lat).toFixed(5)}, {Number(gps.lng).toFixed(5)}</span>
                                </a>
                            </div>
                        ) : (
                            <Field icon={Navigation} label="الموقع على الخريطة" value={null} />
                        )}
                    </div>
                </Section>

                {/* ── ٢) بيانات الزبون — ClientSnapshot المستوى الثاني ── */}
                <Section icon={User} title="بيانات الزبون" accent="text-indigo-600">
                    {visit.clientSnapshot
                        ? <ClientSnapshot data={visit.clientSnapshot} />
                        : <p className="text-sm text-slate-400 text-center py-3">لا تتوفر بيانات الزبون</p>}
                </Section>

                {/* ── ٤) الفريق المسؤول ── */}
                <Section icon={Users} title="الفريق المسؤول عن الزيارة" accent="text-indigo-600"
                    action={visit.status === 'scheduled' ? (
                        <button
                            onClick={() => alert('ميزة تغيير الفريق قيد التطوير ضمن مسار منفصل.')}
                            className="flex items-center gap-1 text-xs font-bold text-indigo-600 hover:text-indigo-500">
                            <RefreshCw className="w-3.5 h-3.5" /> تغيير الفريق
                        </button>
                    ) : undefined}>
                    <div className="space-y-3">
                        <TeamCard data={primaryTeam} label={backupTeam ? 'الفريق الرئيسي (بعد التغيير)' : 'الفريق المكلّف'} />
                        {backupTeam && (
                            <div>
                                <TeamCard data={backupTeam} label="الفريق الرديف (الأصلي)" muted />
                                {team.reassigned_at && (
                                    <p className="text-[10px] text-slate-400 mt-1.5 flex items-center gap-1">
                                        <Repeat className="w-3 h-3" /> تاريخ التغيير: {formatDate(team.reassigned_at)} {formatTime(team.reassigned_at)}
                                    </p>
                                )}
                            </div>
                        )}
                    </div>
                </Section>

                {/* ── ٥) لائحة الأسماء ── */}
                <Section icon={ListPlus} title="لائحة الأسماء المقترحة" accent="text-sky-600"
                    action={canManageReferral ? (
                        <button onClick={() => setReferralOpen(true)}
                            className="flex items-center gap-1 text-xs font-bold text-sky-600 hover:text-sky-500">
                            <ListPlus className="w-3.5 h-3.5" /> {sheet ? 'تعديل اللائحة' : 'إضافة لائحة'}
                        </button>
                    ) : undefined}>
                    {sheet ? (
                        <div className="flex items-center gap-4 flex-wrap">
                            <div className="flex items-center gap-2">
                                <div className="w-9 h-9 rounded-lg bg-sky-50 flex items-center justify-center">
                                    <ListPlus className="w-5 h-5 text-sky-600" />
                                </div>
                                <div>
                                    <p className="text-sm font-bold text-slate-800">لائحة باسم {visit.client_name}</p>
                                    <p className="text-xs text-slate-400">رقم اللائحة #{sheet.id}</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-2 mr-auto">
                                <div className="text-center px-3 py-1.5 rounded-lg bg-sky-50 border border-sky-200">
                                    <p className="text-base font-black text-sky-700">{sheet.target_candidates ?? 0}</p>
                                    <p className="text-[10px] text-sky-600">أسماء مقترحة</p>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <p className="text-sm text-slate-400 text-center py-3">
                            {canManageReferral ? 'لا توجد لائحة بعد — أضف عدد الأسماء التي اقترحها الزبون.' : 'لم تُنشأ لائحة أسماء لهذه الزيارة.'}
                        </p>
                    )}
                </Section>

                {/* ── ٦) مهام الزيارة ── */}
                <Section icon={ClipboardList} title={`مهام الزيارة (${tasks.length})`} accent="text-indigo-600">
                    {tasks.length === 0 && <p className="text-sm text-slate-400 text-center py-4">لا توجد مهام مرتبطة بهذه الزيارة</p>}
                    <div className="space-y-3">
                        {tasks.map((task: any) => {
                            const ts = TASK_STATUS_LABELS[task.status] ?? { label: task.status, color: 'text-slate-500', bg: 'bg-slate-100' };
                            const hasResult = task.result_id != null;
                            // DEC-004 D15: task results may be recorded while the visit is
                            // `in_progress` (during the field work) and remain editable
                            // after it transitions to `ended`. The visit auto-completes
                            // once the last task result + the survey are in place.
                            const canRecord = (visit.status === 'in_progress' || visit.status === 'ended') && !hasResult;
                            const isDemo = task.task_type === 'device_demo';
                            const isDelivery = task.task_type === 'device_delivery';
                            const isInstallation = task.task_type === 'device_installation';
                            const isEmergency = task.task_type === 'emergency_maintenance';
                            const supportsUnifiedResult = isDemo || isDelivery || isInstallation || isEmergency;
                            const canEditResult = visit.status === 'completed' && hasResult && supportsUnifiedResult;
                            const decisionMeta = getFinalDecisionMeta(task.final_decision);
                            const outcomeMeta = getDerivedOutcomeMeta(task);
                            return (
                                <div key={task.id} className="rounded-xl border border-gray-200 p-4">
                                    <div className="flex items-start justify-between gap-3">
                                        <div>
                                            <p className="text-sm font-bold text-slate-800">
                                                {task.arabic_label ?? task.task_type}
                                                {task.sequence_no > 1 && <span className="text-slate-400 font-normal"> #{task.sequence_no}</span>}
                                            </p>
                                            <p className="text-xs text-slate-500 mt-0.5">
                                                {task.task_family === 'marketing' ? 'تسويق' : 'خدمة'}
                                                {task.contract_number && (
                                                    <span className="text-slate-400"> · عقد {task.contract_number}{task.device_model_name ? ` — ${task.device_model_name}` : ''}</span>
                                                )}
                                            </p>
                                        </div>
                                        <span className={`text-xs font-bold px-2 py-1 rounded-full shrink-0 ${ts.bg} ${ts.color}`}>{ts.label}</span>
                                    </div>

                                    {hasResult && task.final_decision && (
                                        <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50/80 p-3">
                                            <div className="grid gap-2 md:grid-cols-2">
                                                <div className="rounded-xl border border-white bg-white px-3 py-2 shadow-sm">
                                                    <div className="mb-1 text-[11px] font-bold text-slate-400">النتيجة</div>
                                                    <span className={`inline-flex items-center rounded-lg border px-2.5 py-1 text-xs font-black ${decisionMeta.cls}`}>
                                                        {decisionMeta.label}
                                                    </span>
                                                </div>
                                                <div className="rounded-xl border border-white bg-white px-3 py-2 shadow-sm">
                                                    <div className="mb-1 text-[11px] font-bold text-slate-400">المحصلة</div>
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <span className={`inline-flex items-center rounded-lg border px-2.5 py-1 text-xs font-black ${outcomeMeta.cls}`}>
                                                            {outcomeMeta.label}
                                                        </span>
                                                        {outcomeMeta.detail && (
                                                            <span className="text-[11px] font-semibold text-slate-500">{outcomeMeta.detail}</span>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                            {outcomeMeta.counts.total > 0 && (
                                                <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] font-bold">
                                                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">العروض: {outcomeMeta.counts.total}</span>
                                                    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700">مقبول: {outcomeMeta.counts.accepted}</span>
                                                    <span className="rounded-full bg-rose-50 px-2 py-0.5 text-rose-700">رفض: {outcomeMeta.counts.rejected}</span>
                                                    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-700">مهلة: {outcomeMeta.counts.extension}</span>
                                                </div>
                                            )}
                                            {task.closing_notes && (
                                                <div className="mt-2 rounded-xl bg-white px-3 py-2 text-xs text-slate-600">
                                                    <span className="font-bold text-slate-500">ملاحظات النتيجة: </span>{task.closing_notes}
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {/* الإجراء حسب حالة الزيارة */}
                                    <div className="mt-3">
                                        {visit.status === 'scheduled' && <span className="text-xs text-slate-400">عرض فقط — لم تبدأ الزيارة</span>}
                                        {visit.status === 'cancelled' && <span className="text-xs text-slate-400">الزيارة ملغاة</span>}
                                        {canRecord && supportsUnifiedResult && (
                                            <button onClick={() => setResultTask(task)}
                                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-500 transition-colors">
                                                <ClipboardCheck className="w-3.5 h-3.5" /> تسجيل النتيجة
                                            </button>
                                        )}
                                        {canRecord && !supportsUnifiedResult && (
                                            <span className="text-xs text-amber-600 bg-amber-50 px-2 py-1 rounded inline-flex items-center gap-1">
                                                <AlertCircle className="w-3 h-3" /> تسجيل نتيجة هذا النوع قيد التطوير
                                            </span>
                                        )}
                                        {canEditResult && (
                                            <button onClick={() => setResultTask(task)}
                                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-700 text-xs font-bold hover:bg-indigo-100 transition-colors">
                                                <ClipboardCheck className="w-3.5 h-3.5" /> تعديل النتيجة
                                            </button>
                                        )}
                                        {!canRecord && hasResult && !canEditResult && (
                                            <span className="text-xs text-emerald-600 inline-flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> النتيجة مسجّلة</span>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </Section>

                {/* ── ٧) محصلة الزيارة ── */}
                <Section icon={Flag} title="محصلة الزيارة" accent="text-emerald-600">
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-y-4 gap-x-4">
                        <Field icon={Calendar} label="تاريخ الزيارة الفعلي" value={formatDate(geo?.actual_start_time)} />
                        <Field icon={Clock} label="وقت بدء الزيارة" value={formatTime(geo?.actual_start_time)} mono />
                        <Field icon={Clock} label="وقت انتهاء الزيارة" value={formatTime(geo?.actual_end_time)} mono />
                        <Field icon={Clock} label="مدة الزيارة" value={geo?.duration_minutes != null ? `${geo.duration_minutes} دقيقة` : null} />
                        <Field icon={Ruler} label="مسافة التنقل" value={geo?.distance_meters != null ? `${geo.distance_meters} م` : null} />
                        <div>
                            <p className="text-xs text-slate-400 font-medium flex items-center gap-1"><Flag className="w-3 h-3" /> حالة الزيارة</p>
                            <span className={`inline-block text-xs font-bold px-2 py-0.5 rounded-full mt-1 ${status.bg} ${status.color}`}>{status.label}</span>
                        </div>
                    </div>

                    {geo?.location_missing && (
                        <div className="flex items-center gap-1.5 text-xs text-amber-600 mt-4">
                            <AlertTriangle className="w-3.5 h-3.5" /> لم يُسجَّل موقع GPS لهذه الزيارة
                        </div>
                    )}

                    {visit.status === 'cancelled' && (
                        <div className="mt-4 pt-4 border-t border-gray-100 bg-rose-50/40 -mx-5 -mb-5 px-5 py-4">
                            <p className="text-xs font-bold text-rose-700 flex items-center gap-1 mb-2"><XCircle className="w-4 h-4" /> سبب إلغاء الزيارة</p>
                            <p className="text-sm font-semibold text-slate-800">{dash(visit.cancellation_reason_label)}</p>
                            {visit.cancellation_notes && <p className="text-xs text-slate-500 mt-1">{visit.cancellation_notes}</p>}
                        </div>
                    )}

                    {visit.field_notes && (
                        <div className="mt-4 pt-4 border-t border-gray-100">
                            <Field icon={FileText} label="ملاحظات الميدان" value={visit.field_notes} full />
                        </div>
                    )}

                    {survey && (
                        <div className="mt-4 pt-4 border-t border-gray-100 flex items-center gap-2 text-xs">
                            <ClipboardCheck className="w-4 h-4 text-emerald-500" />
                            <span className="text-slate-500">الاستبيان:</span>
                            {survey.is_skipped ? (
                                <span className="text-amber-600 bg-amber-50 px-2 py-0.5 rounded">تم تخطّيه{survey.skip_reason ? ` — ${survey.skip_reason}` : ''}</span>
                            ) : survey.filled_at ? (
                                <span className="text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded">
                                    مُعبَّأ{survey.filled_by_name ? ` بواسطة ${survey.filled_by_name}` : ''}
                                </span>
                            ) : (
                                <span className="text-slate-400">غير مُعبَّأ</span>
                            )}
                        </div>
                    )}
                </Section>

            </div>

            {/* Modals */}
            {visit && (
                <>
                    <VisitSurveyModal visitId={visit.id} open={surveyOpen}
                        onClose={() => setSurveyOpen(false)} onSaved={() => { setSurveyOpen(false); load(); }} />
                    <ReferralSheetModal visitId={visit.id} open={referralOpen}
                        onClose={() => setReferralOpen(false)} onSaved={() => { setReferralOpen(false); load(); }} />
                </>
            )}
            {resultTask?.task_type === 'device_demo' && (
                <DeviceDemoResultModal
                    key={`${visit.id}:${resultTask.id}`}
                    visitId={visit.id}
                    taskId={resultTask.id}
                    visit={visit}
                    task={resultTask}
                    preOffers={resultTask.preOffers ?? resultTask.pre_offers ?? []}
                    onClose={() => setResultTask(null)}
                    onSaved={() => { setResultTask(null); load(); }}
                />
            )}
            {resultTask?.task_type === 'device_delivery' && (
                <DeviceDeliveryResultModal
                    key={`${visit.id}:${resultTask.id}`}
                    visitId={visit.id}
                    taskId={resultTask.id}
                    task={resultTask}
                    onClose={() => setResultTask(null)}
                    onSaved={() => { setResultTask(null); load(); }}
                />
            )}
            {resultTask?.task_type === 'device_installation' && (
                <DeviceInstallationResultModal
                    key={`${visit.id}:${resultTask.id}`}
                    visitId={visit.id}
                    taskId={resultTask.id}
                    task={resultTask}
                    onClose={() => setResultTask(null)}
                    onSaved={() => { setResultTask(null); load(); }}
                />
            )}
            {resultTask?.task_type === 'emergency_maintenance' && (
                <EmergencyResultModal
                    key={`${visit.id}:${resultTask.id}`}
                    taskId={resultTask.source_open_task_id ?? resultTask.open_task_id ?? resultTask.id}
                    visitId={visit.id}
                    visitTaskId={resultTask.id}
                    contractId={resultTask.contract_id ?? null}
                    visitTechnicianEmployeeId={primaryTeam?.technician?.id ?? backupTeam?.technician?.id ?? null}
                    visitTechnicianName={primaryTeam?.technician?.name ?? backupTeam?.technician?.name ?? null}
                    onClose={() => setResultTask(null)}
                    onSaved={() => { setResultTask(null); load(); }}
                />
            )}
        </div>
    );
}
