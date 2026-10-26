// «الشبكة» tab of the client profile.
//
// Two tables: the client's mediators (who referred this client) and the names
// this client referred, with a summary of how many of those names became
// clients and how many bought (OP). A referred client's stage is computed on
// the server like everywhere else; a referred candidate shows its own status.
//
// A name linked to a client that already existed («اسم مكرر») is labelled on
// both sides. It earns the mediator no acquisition credit, and purchase credit
// only for a contract made on or after the link day.

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, Share2, ShoppingBag, UserCheck, Users } from '../../components/ui/icons';
import SmartTable, { type ColumnDef } from '../../components/SmartTable';
import { api } from '../../lib/api';

interface Props {
    client: { id: number };
}

interface NetworkMediator {
    id: number | null;
    entityId: number | null;
    entityKind: 'client' | 'employee' | null;
    name: string;
    sourceCandidateId: number | null;
    candidateName: string | null;
    type: string;
    referralDate: string | null;
    referralSheetId: number | null;
    viaDuplicateLink: boolean;
    /** Who made them a mediator of this client: whoever linked or converted the name, else the client's creator. */
    recordedByName: string | null;
    recordedAt: string | null;
    address: string | null;
    mobile: string | null;
}

interface NetworkReferral {
    id: number;
    name: string;
    mobile: string | null;
    address: string | null;
    status: string;
    stage: 'LEAD' | 'FOP' | 'OP' | null;
    referralDate: string | null;
    referralSheetId: number | null;
    isClient: boolean;
    holderNames: string | null;
    viaDuplicateLink: boolean;
    linkedOn: string | null;
    boughtAfterLink: boolean;
}

const MEDIATOR_TYPES: Record<string, { label: string; className: string }> = {
    client: { label: 'زبون', className: 'bg-sky-100 text-sky-700' },
    employee: { label: 'موظف', className: 'bg-violet-100 text-violet-700' },
    personal: { label: 'شخصي', className: 'bg-amber-100 text-amber-700' },
    customer: { label: 'عميل', className: 'bg-emerald-100 text-emerald-700' },
    unknown: { label: 'غير معروف', className: 'bg-slate-100 text-slate-500' },
};

const CLIENT_STAGES: Record<string, { label: string; className: string }> = {
    LEAD: { label: 'زبون مرشح (LEAD)', className: 'bg-sky-100 text-sky-700' },
    FOP: { label: 'زبون مستهدف (FOP)', className: 'bg-orange-100 text-orange-700' },
    OP: { label: 'زبون فعلي (OP)', className: 'bg-emerald-100 text-emerald-700' },
};

const CANDIDATE_STATUSES: Record<string, { label: string; className: string }> = {
    Suggested: { label: 'مقترح', className: 'bg-slate-100 text-slate-600' },
    FollowUp: { label: 'قيد المتابعة', className: 'bg-amber-100 text-amber-700' },
    Contacted: { label: 'تم التواصل', className: 'bg-sky-100 text-sky-700' },
    Qualified: { label: 'مؤهل', className: 'bg-blue-100 text-blue-700' },
    Junk: { label: 'مرفوض', className: 'bg-red-100 text-red-700' },
    New: { label: 'جديد', className: 'bg-slate-100 text-slate-600' },
};

function mediatorType(type: string) {
    return MEDIATOR_TYPES[type?.toLowerCase()] ?? MEDIATOR_TYPES.unknown;
}

function referralStage(ref: NetworkReferral) {
    if (ref.isClient) return CLIENT_STAGES[ref.stage ?? 'LEAD'] ?? CLIENT_STAGES.LEAD;
    return CANDIDATE_STATUSES[ref.status] ?? { label: ref.status || 'غير محدد', className: 'bg-slate-100 text-slate-500' };
}

function referralMethod(sheetId: number | null) {
    return sheetId ? `لائحة أسماء #${sheetId}` : 'إدخال مباشر';
}

const DuplicateBadge = ({ title }: { title: string }) => (
    <span title={title} className="whitespace-nowrap rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-700">
        اسم مكرر
    </span>
);

// Credit a mediator gets for a referred name: acquisition only for an original
// referral; purchase for an original OP, or a linked one bought after the link.
function earnsAcquisition(ref: NetworkReferral) {
    return ref.isClient && !ref.viaDuplicateLink;
}
function earnsPurchase(ref: NetworkReferral) {
    if (!ref.isClient || ref.stage !== 'OP') return false;
    return !ref.viaDuplicateLink || ref.boughtAfterLink;
}

// Where a mediator can be opened. The entity id is scoped by the mediator type
// on the server (`entityKind`): a Client mediator addresses a client record and
// an Employee mediator an employee record. `Personal`/`Unknown` mediators are a
// free-text snapshot with no record behind them.
function mediatorLink(ref: NetworkMediator): string | null {
    if (ref.entityKind === 'client' && ref.entityId) return `/clients/${ref.entityId}`;
    if (ref.entityKind === 'employee' && ref.entityId) return `/employees/${ref.entityId}`;
    return null;
}

const Dash = () => <span className="text-slate-400">—</span>;

const mediatorColumns: ColumnDef<NetworkMediator>[] = [
    {
        key: 'name',
        label: 'الوسيط',
        render: ref => {
            const link = mediatorLink(ref);
            return link
                ? <Link to={link} onClick={e => e.stopPropagation()} className="font-bold text-sky-700 hover:underline">{ref.name || '—'}</Link>
                : <span className="font-bold text-slate-800">{ref.name || '—'}</span>;
        },
        exportValue: ref => ref.name,
    },
    {
        key: 'type',
        label: 'نوع الوسيط',
        render: ref => {
            const type = mediatorType(ref.type);
            return <span className={`whitespace-nowrap rounded-full px-2 py-1 text-xs font-bold ${type.className}`}>{type.label}</span>;
        },
        exportValue: ref => mediatorType(ref.type).label,
    },
    {
        key: 'mobile',
        label: 'رقم الوسيط',
        render: ref => ref.mobile ? <span className="font-mono text-sm text-slate-600" dir="ltr">{ref.mobile}</span> : <Dash />,
        exportValue: ref => ref.mobile ?? '',
    },
    {
        key: 'candidateName',
        label: 'الاسم المقترح',
        render: ref => ref.sourceCandidateId
            ? <Link to={`/candidates/${ref.sourceCandidateId}`} onClick={e => e.stopPropagation()} className="font-bold text-sky-700 hover:underline">{ref.candidateName || `#${ref.sourceCandidateId}`}</Link>
            : <Dash />,
        exportValue: ref => ref.candidateName ?? '',
    },
    {
        key: 'referralSheetId',
        label: 'طريقة الإحالة',
        render: ref => (
            <div className="flex flex-wrap items-center gap-1.5">
                <span className="whitespace-nowrap text-sm text-slate-700">{referralMethod(ref.referralSheetId)}</span>
                {ref.viaDuplicateLink && <DuplicateBadge title="أُضيف عند ربط اسم مقترح مكرر بهذا الزبون بعد تسجيله، وليس هو من جلب الزبون" />}
            </div>
        ),
        exportValue: ref => `${referralMethod(ref.referralSheetId)}${ref.viaDuplicateLink ? ' · اسم مكرر' : ''}`,
    },
    {
        key: 'referralDate',
        label: 'تاريخ الإحالة',
        render: ref => ref.referralDate ? <span className="whitespace-nowrap font-mono text-xs text-slate-500">{ref.referralDate}</span> : <Dash />,
        exportValue: ref => ref.referralDate ?? '',
    },
    {
        key: 'address',
        label: 'عنوان الإحالة',
        render: ref => ref.address ? <span className="text-sm text-slate-600">{ref.address}</span> : <Dash />,
        exportValue: ref => ref.address ?? '',
    },
    {
        key: 'recordedByName',
        label: 'سجّله',
        render: ref => ref.recordedByName ? (
            <div className="space-y-0.5">
                <span className="block whitespace-nowrap text-sm font-bold text-slate-700">{ref.recordedByName}</span>
                {ref.recordedAt && <span className="block whitespace-nowrap font-mono text-[11px] text-slate-400">{ref.recordedAt}</span>}
            </div>
        ) : ref.viaDuplicateLink
            // Links made before migration 486 recorded no employee.
            ? <span className="whitespace-nowrap text-xs text-slate-400" title="رُبط الاسم قبل بدء تسجيل الموظف الذي ينفّذ الربط">غير مسجل</span>
            : <Dash />,
        exportValue: ref => ref.recordedByName ?? '',
    },
];

const referralColumns: ColumnDef<NetworkReferral>[] = [
    {
        key: 'name',
        label: 'الاسم',
        render: ref => (
            <Link
                to={ref.isClient ? `/clients/${ref.id}` : `/candidates/${ref.id}`}
                onClick={e => e.stopPropagation()}
                className="font-bold text-sky-700 hover:underline"
            >
                {ref.name || `#${ref.id}`}
            </Link>
        ),
        exportValue: ref => ref.name,
    },
    {
        key: 'isClient',
        label: 'النوع',
        render: ref => (
            <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-1.5">
                    <span className="whitespace-nowrap text-sm text-slate-700">{ref.isClient ? 'زبون' : 'اسم مقترح'}</span>
                    {ref.viaDuplicateLink && <DuplicateBadge title="كان زبوناً قبل أن يرشّحه هذا الوسيط" />}
                </div>
                {ref.viaDuplicateLink && ref.linkedOn && (
                    <p className="whitespace-nowrap text-[11px] text-slate-400">رُبط في {ref.linkedOn}</p>
                )}
            </div>
        ),
        exportValue: ref => (ref.isClient ? (ref.viaDuplicateLink ? 'زبون · اسم مكرر' : 'زبون') : 'اسم مقترح'),
    },
    {
        key: 'stage',
        label: 'المرحلة',
        render: ref => {
            const stage = referralStage(ref);
            return (
                <div className="space-y-1">
                    <span className={`whitespace-nowrap rounded-full px-2 py-1 text-xs font-bold ${stage.className}`}>{stage.label}</span>
                    {ref.viaDuplicateLink && ref.stage === 'OP' && (
                        <p className="whitespace-nowrap text-[11px] text-slate-400">
                            {ref.boughtAfterLink ? 'اشترى بعد الربط' : 'اشترى قبل الترشيح'}
                        </p>
                    )}
                </div>
            );
        },
        exportValue: ref => referralStage(ref).label,
    },
    {
        key: 'mobile',
        label: 'الرقم',
        render: ref => ref.mobile ? <span className="font-mono text-sm text-slate-600" dir="ltr">{ref.mobile}</span> : <Dash />,
        exportValue: ref => ref.mobile ?? '',
    },
    {
        key: 'address',
        label: 'العنوان',
        render: ref => ref.address ? <span className="text-sm text-slate-600">{ref.address}</span> : <Dash />,
        exportValue: ref => ref.address ?? '',
    },
    {
        key: 'referralDate',
        label: 'تاريخ الترشيح',
        render: ref => ref.referralDate ? <span className="whitespace-nowrap font-mono text-xs text-slate-500">{ref.referralDate}</span> : <Dash />,
        exportValue: ref => ref.referralDate ?? '',
    },
    {
        key: 'referralSheetId',
        label: 'طريقة الترشيح',
        render: ref => <span className="whitespace-nowrap text-sm text-slate-700">{referralMethod(ref.referralSheetId)}</span>,
        exportValue: ref => referralMethod(ref.referralSheetId),
    },
    {
        key: 'holderNames',
        label: 'المالك / المسؤول',
        render: ref => ref.holderNames
            ? <span className="text-sm text-slate-700">{ref.holderNames}</span>
            : <span className="text-sm text-slate-400">ملك الفرع</span>,
        exportValue: ref => ref.holderNames ?? 'ملك الفرع',
    },
];

function SummaryCard({ icon: Icon, label, value, className }: {
    icon: typeof Users;
    label: string;
    value: string;
    className: string;
}) {
    return (
        <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${className}`}>
                <Icon className="h-5 w-5" />
            </span>
            <div className="min-w-0">
                <p className="text-xs font-bold text-slate-500">{label}</p>
                <p className="text-xl font-black text-slate-800">{value}</p>
            </div>
        </div>
    );
}

export default function NetworkTab({ client }: Props) {
    const [network, setNetwork] = useState<{ incoming: NetworkMediator[]; outgoing: NetworkReferral[] } | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [reloadKey, setReloadKey] = useState(0);

    useEffect(() => {
        let active = true;
        setLoading(true);
        setError(null);
        api.clients.getNetwork(client.id)
            .then(data => { if (active) setNetwork(data); })
            .catch(err => {
                console.error('Failed to load network:', err);
                if (active) {
                    setNetwork(null);
                    setError(err?.message || 'تعذر تحميل شبكة الزبون حالياً.');
                }
            })
            .finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, [client.id, reloadKey]);

    if (loading) {
        return (
            <div className="flex items-center justify-center gap-2 py-12 text-slate-400">
                <Loader2 className="h-6 w-6 animate-spin" />
                <span className="font-bold">جاري تحميل بيانات الشبكة...</span>
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-red-100 bg-red-50 px-6 py-12 text-center">
                <p className="font-bold text-red-700">{error}</p>
                <button
                    type="button"
                    onClick={() => setReloadKey(value => value + 1)}
                    className="rounded-xl bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-700"
                >
                    إعادة المحاولة
                </button>
            </div>
        );
    }

    const incoming = network?.incoming ?? [];
    const outgoing = network?.outgoing ?? [];
    const becameClients = outgoing.filter(earnsAcquisition).length;
    const bought = outgoing.filter(earnsPurchase).length;
    const linkedDuplicates = outgoing.filter(ref => ref.viaDuplicateLink).length;
    const percentOf = (count: number) => (outgoing.length > 0 ? ` (${Math.round((count / outgoing.length) * 100)}%)` : '');

    return (
        <div className="space-y-5">
            <SmartTable<NetworkMediator>
                title="وسطاء الزبون"
                subtitle={<>من رشّح هذا الزبون · {incoming.length} وسيط</>}
                icon={Share2}
                data={incoming}
                columns={mediatorColumns}
                getId={ref => `${ref.entityKind ?? 'x'}-${ref.entityId ?? ''}-${ref.sourceCandidateId ?? ''}-${ref.name}`}
                hideFilterBar
                paginated={false}
                tableMinWidth={1100}
                emptyIcon={Share2}
                emptyMessage="لا يوجد وسطاء مسجّلون لهذا الزبون"
            />

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <SummaryCard icon={Users} label="أسماء رشّحها" value={String(outgoing.length)} className="bg-slate-100 text-slate-600" />
                <SummaryCard icon={UserCheck} label="صاروا زبائن" value={`${becameClients}${percentOf(becameClients)}`} className="bg-sky-50 text-sky-600" />
                <SummaryCard icon={ShoppingBag} label="اشتروا (OP)" value={`${bought}${percentOf(bought)}`} className="bg-emerald-50 text-emerald-600" />
            </div>
            {linkedDuplicates > 0 && (
                <p className="-mt-2 text-xs text-slate-500">
                    منها {linkedDuplicates} اسم مكرر لزبون كان مسجلاً قبل الترشيح: لا يُحتسب ضمن «صاروا زبائن»، ويُحتسب ضمن «اشتروا» فقط إذا اشترى بعد الربط.
                </p>
            )}

            <SmartTable<NetworkReferral>
                title="الأسماء التي رشّحها الزبون"
                icon={Users}
                data={outgoing}
                columns={referralColumns}
                getId={ref => `${ref.isClient ? 'c' : 'n'}-${ref.id}`}
                hideFilterBar
                tableMinWidth={1050}
                emptyIcon={Users}
                emptyMessage="لم يرشّح هذا الزبون أي أسماء حتى الآن"
            />
        </div>
    );
}
