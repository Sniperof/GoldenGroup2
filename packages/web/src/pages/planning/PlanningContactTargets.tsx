import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowRight, Loader2, PhoneCall, Target } from 'lucide-react';
import { api } from '../../lib/api';
import { getOutcomeMeta } from '@golden-crm/shared';
import type { Client, CustomerOwnership, GeoUnit } from '../../lib/types';

type MarketingTargetsResponse = {
    teamKey: string;
    leads: Client[];
    counts: {
        leads: number;
        candidates: number;
        total: number;
    };
    reason?: string | null;
};

const contactTargetStatusLabels: Record<string, string> = {
    new: 'جديد',
    queued: 'بالانتظار',
    in_call_list: 'ضمن قائمة اتصال', // legacy alias for 'queued' — kept for old DB records
    contacted: 'تم الاتصال',
    booked: 'تم حجز موعد',
    closed: 'مغلق',
};

const dailyStatusLabels: Record<string, string> = {
    pending: 'بالانتظار',
    called: 'تم الاتصال',
    booked: 'تم حجز موعد',
};

const getToday = () => new Date().toISOString().split('T')[0];

const getLeadPhone = (lead: Client) => {
    const contacts = Array.isArray((lead as any).contacts) ? (lead as any).contacts : [];
    const primary = contacts.find((contact: any) => contact?.isPrimary && contact?.number);
    const firstNumber = contacts.find((contact: any) => contact?.number);
    return primary?.number || lead.mobile || firstNumber?.number || '--';
};

const getLeadName = (lead: Client) => {
    return lead.name || [lead.firstName, lead.fatherName, lead.lastName].filter(Boolean).join(' ') || `#${lead.id}`;
};

function OwnerLabelCell({ ownership }: { ownership?: CustomerOwnership | null }) {
    const text = ownership?.ownerLabel || 'الشركة العامة';
    const isPersonal = (ownership?.ownerType ?? '').startsWith('personal');
    return (
        <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-bold ${
            isPersonal
                ? 'border-indigo-200 bg-indigo-50 text-indigo-700'
                : 'border-slate-200 bg-slate-50 text-slate-600'
        }`}>
            {text}
        </span>
    );
}

const getDailyStatusLabel = (lead: any): { label: string; className: string } => {
    const queuedInCurrentTeam = lead.queuedInCurrentTeamToday;
    const queuedInAnotherTeam = lead.queuedInAnotherTeamToday;
    const dailyStatus = lead.dailyItemStatus;
    const dailyOutcome = lead.dailyCallOutcome;

    if (queuedInCurrentTeam && dailyStatus) {
        if (dailyStatus === 'booked') {
            return { label: 'تم حجز موعد', className: 'text-emerald-700 bg-emerald-50 border-emerald-200' };
        }
        if (dailyStatus === 'called') {
            if (dailyOutcome) {
                const meta = getOutcomeMeta(dailyOutcome);
                if (meta.closesContactTarget) {
                    return { label: 'مغلق لهذا اليوم', className: 'text-red-700 bg-red-50 border-red-200' };
                }
            }
            return { label: 'تم الاتصال', className: 'text-sky-700 bg-sky-50 border-sky-200' };
        }
        return { label: dailyStatusLabels[dailyStatus] || dailyStatus, className: 'text-violet-700 bg-violet-50 border-violet-200' };
    }

    if (queuedInAnotherTeam) {
        const teamKey = lead.queuedTeamKeyToday || 'فريق آخر';
        return { label: `ضمن قائمة ${teamKey} اليوم`, className: 'text-amber-700 bg-amber-50 border-amber-200' };
    }

    return { label: 'جاهز للتوليد', className: 'text-slate-600 bg-slate-50 border-slate-200' };
};

export default function PlanningContactTargets() {
    const navigate = useNavigate();
    const { teamKey = '' } = useParams();
    const [searchParams] = useSearchParams();
    const date = searchParams.get('date') || getToday();
    const teamLabel = searchParams.get('label') || teamKey;

    const [geoUnits, setGeoUnits] = useState<GeoUnit[]>([]);
    const [targetsData, setTargetsData] = useState<MarketingTargetsResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(false);
    const [generating, setGenerating] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'warning' | 'error'; text: string } | null>(null);

    const leads = targetsData?.leads || [];
    const targetCount = targetsData?.counts?.total ?? 0;

    const zoneNames = useMemo(() => {
        return new Map(geoUnits.map(unit => [unit.id, unit.name]));
    }, [geoUnits]);

    const getUnitName = (id: number) => zoneNames.get(id) || 'غير متوفر';

    const loadData = async () => {
        setLoading(true);
        setLoadError(false);
        try {
            const [geo, targets] = await Promise.all([
                api.geoUnits.list(),
                api.planning.marketingTargets(date, teamKey),
            ]);
            setGeoUnits(geo);
            setTargetsData(targets as MarketingTargetsResponse);
        } catch (error) {
            console.error('Failed to load planning contact targets:', error);
            setLoadError(true);
            setTargetsData(null);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadData();
    }, [date, teamKey]);

    const handleGenerateContactList = async () => {
        setGenerating(true);
        setMessage(null);
        try {
            const result = await api.telemarketing.generateTaskListFromPlan({ date, teamKey });
            const skippedCount = result?.counts?.skipped ?? 0;
            const added = result?.counts?.added ?? 0;
            const updated = result?.counts?.updated ?? 0;
            const skipped = result?.skipped ?? [];

            if (skippedCount > 0 && Array.isArray(skipped) && skipped.length > 0) {
                const reasons = skipped.map((s: any) => {
                    if (s.reason === 'already_queued_today') {
                        return `الهدف #${s.entityId} موجود ضمن قائمة ${s.existingTeamKey || 'فريق آخر'} اليوم`;
                    }
                    if (s.reason === 'no_contact_target') {
                        return `الهدف #${s.entityId} لا يملك سجل اتصال`;
                    }
                    return `الهدف #${s.entityId}: ${s.reason}`;
                }).join('؛ ');
                setMessage({
                    type: 'warning',
                    text: `تمت إضافة ${added} وتحديث ${updated}. تم استبعاد ${skippedCount} هدف: ${reasons}`,
                });
            } else {
                setMessage({
                    type: 'success',
                    text: `تم توليد قائمة الاتصال. تمت إضافة ${added} وتحديث ${updated}.`,
                });
            }
            await loadData();
        } catch (error: any) {
            console.error('Failed to generate contact list from plan:', error);
            const serverMsg = error?.message || '';
            if (serverMsg.includes('Branch context')) {
                setMessage({ type: 'error', text: 'يجب تحديد فرع قبل توليد قائمة الاتصال' });
            } else if (serverMsg.includes('No schedule found') || serverMsg.includes('Team not found')) {
                setMessage({ type: 'error', text: 'لا يوجد جدول فرق لهذا التاريخ. يرجى إنشاء الجدول أولاً.' });
            } else {
                setMessage({ type: 'error', text: serverMsg || 'تعذر توليد قائمة الاتصال' });
            }
        } finally {
            setGenerating(false);
        }
    };

    return (
        <div className="h-full overflow-y-auto p-8 custom-scroll">
            <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
                <div>
                    <button
                        type="button"
                        onClick={() => navigate('/planning/overview')}
                        className="mb-3 inline-flex items-center gap-2 text-sm font-bold text-slate-500 hover:text-sky-600"
                    >
                        <ArrowRight className="h-4 w-4" />
                        العودة إلى ملخص الخطة
                    </button>
                    <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900">
                        <Target className="h-6 w-6 text-sky-600" />
                        أهداف الاتصال - {teamLabel}
                    </h1>
                    <p className="mt-1 text-sm text-slate-500">الأهداف التسويقية ضمن نطاق عمل الفريق بتاريخ {date}</p>
                    <p className="mt-0.5 text-xs font-medium text-amber-600">
                        الحالة اليومية تعكس حالة بند قائمة الاتصال — منفصلة عن حالة المهمة المفتوحة.
                    </p>
                </div>

                <button
                    type="button"
                    disabled={generating || loading || loadError || leads.length === 0}
                    onClick={handleGenerateContactList}
                    className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-indigo-500 disabled:bg-slate-100 disabled:text-slate-400 disabled:shadow-none"
                >
                    {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <PhoneCall className="h-4 w-4" />}
                    <span>{generating ? 'جاري توليد قائمة الاتصال...' : 'توليد قائمة الاتصال'}</span>
                </button>
            </div>

            {message && (
                <div className={`mb-5 rounded-xl border px-4 py-3 text-sm font-bold ${
                    message.type === 'success'
                        ? 'border-emerald-100 bg-emerald-50 text-emerald-700'
                        : message.type === 'warning'
                            ? 'border-amber-100 bg-amber-50 text-amber-700'
                            : 'border-red-100 bg-red-50 text-red-700'
                }`}>
                    {message.text}
                </div>
            )}

            <div className="mb-5 grid grid-cols-1 gap-4 md:grid-cols-3">
                <div className="rounded-xl border border-sky-100 bg-sky-50 p-5">
                    <p className="text-xs font-bold text-sky-600">عدد الأهداف</p>
                    <p className="mt-1 text-3xl font-bold text-sky-800">{targetCount}</p>
                </div>
            </div>

            {loading ? (
                <div className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white py-16 text-sm font-bold text-slate-500">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>جاري تحميل أهداف الاتصال...</span>
                </div>
            ) : loadError ? (
                <div className="rounded-xl border border-red-100 bg-red-50 py-16 text-center text-sm font-bold text-red-700">
                    تعذر تحميل أهداف الاتصال
                </div>
            ) : leads.length === 0 ? (
                <div className="rounded-xl border border-slate-200 bg-white py-16 text-center text-sm font-bold text-slate-500">
                    لا توجد أهداف اتصال ضمن نطاق هذا الفريق
                </div>
            ) : (
                <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                    <div className="overflow-x-auto custom-scroll">
                        <table className="w-full min-w-[1200px] border-collapse text-sm">
                            <thead className="sticky top-0 bg-slate-50 text-xs font-bold text-slate-500">
                                <tr>
                                    <th className="px-4 py-3 text-right">ID الزبون</th>
                                    <th className="px-4 py-3 text-right">الزبون</th>
                                    <th className="px-4 py-3 text-right">رقم الموبايل الرئيسي</th>
                                    <th className="px-4 py-3 text-right">العنوان</th>
                                    <th className="px-4 py-3 text-right">جهة الإسناد</th>
                                    <th className="px-4 py-3 text-right">التصنيف</th>
                                    <th className="px-4 py-3 text-right">
                                        <span>الحالة اليومية</span>
                                        <span className="block text-[10px] font-normal text-slate-400">بند قائمة الاتصال</span>
                                    </th>
                                    <th className="px-4 py-3 text-right">آخر نتيجة اتصال</th>
                                    <th className="px-4 py-3 text-right">آخر موعد</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {leads.map((lead) => {
                                    const zoneId = Number(lead.neighborhood);
                                    const zoneName = Number.isFinite(zoneId) ? getUnitName(zoneId) : lead.neighborhood;
                                    const dailyState = getDailyStatusLabel(lead as any);
                                    const latestOutcome = (lead as any).latestCallOutcome;
                                    const latestOutcomeMeta = latestOutcome ? getOutcomeMeta(latestOutcome) : null;
                                    const ctStatus = (lead as any).contactTargetStatus;
                                    const latestAppointment = (lead as any).latestAppointment;

                                    return (
                                        <tr key={lead.id} className="hover:bg-slate-50">
                                            <td className="px-4 py-3 font-mono text-slate-600" dir="ltr">{lead.id}</td>
                                            <td className="px-4 py-3 font-bold text-slate-800">{getLeadName(lead)}</td>
                                            <td className="px-4 py-3 font-mono text-slate-600" dir="ltr">{getLeadPhone(lead)}</td>
                                            <td className="px-4 py-3 text-slate-600">{zoneName || 'غير متوفر'}</td>
                                            <td className="px-4 py-3">
                                                <OwnerLabelCell ownership={(lead as any).ownership} />
                                            </td>
                                            <td className="px-4 py-3">
                                                <span className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-bold text-sky-700">
                                                    Lead
                                                </span>
                                            </td>
                                            <td className="px-4 py-3">
                                                <span className={`rounded-full border px-2.5 py-1 text-xs font-bold ${dailyState.className}`}>
                                                    {dailyState.label}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 text-slate-500 text-xs">
                                                {latestOutcomeMeta ? latestOutcomeMeta.label : '-'}
                                            </td>
                                            <td className="px-4 py-3 text-slate-500 text-xs">
                                                {latestAppointment ? [latestAppointment.date, latestAppointment.timeSlot].filter(Boolean).join(' ') : '-'}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
}
