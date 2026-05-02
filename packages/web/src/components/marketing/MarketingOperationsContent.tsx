import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, PhoneCall, RefreshCw, Target, Users } from 'lucide-react';
import { api } from '../../lib/api';
import SmartTable, { ColumnDef, FilterDef } from '../SmartTable';

type LatestAppointment = {
    id: string;
    date: string;
    timeSlot: string;
    teamKey: string;
} | null;

type SupervisorSummary = {
    hrUserId: number;
    employeeId: number | null;
    name: string;
};

type MarketingContactTarget = {
    contactTargetId: number;
    clientId: number;
    customerName: string;
    phone: string;
    supervisorHrUserId: number | null;
    supervisorName: string | null;
    supervisors?: SupervisorSummary[];
    zoneId: number | null;
    zoneName: string | null;
    routeName: string | null;
    status: string;
    latestCallOutcome: string | null;
    latestAppointment: LatestAppointment;
    branchId: number;
    createdAt: string;
    updatedAt: string;
};

type MarketingContactTargetRow = MarketingContactTarget & {
    supervisors: SupervisorSummary[];
    supervisorSearchText: string;
    supervisorsDisplay: string;
    statusFilter: string;
    latestAppointmentText: string;
};

const statusLabels: Record<string, string> = {
    new: 'جديد',
    queued: 'بالانتظار',
    in_call_list: 'ضمن قائمة اتصال',
    contacted: 'تم الاتصال',
    booked: 'تم حجز موعد',
    closed: 'مغلق',
    cancelled: 'ملغى',
};

const outcomeLabels: Record<string, string> = {
    no_answer: 'لا يرد',
    busy: 'مشغول',
    rejected: 'رفض',
    booked: 'تم الحجز',
};

function getStatusLabel(status: string) {
    return statusLabels[status] || status;
}

function getOutcomeLabel(outcome: string | null) {
    return outcome ? outcomeLabels[outcome] || outcome : '--';
}

function getAppointmentText(appointment: LatestAppointment) {
    if (!appointment) return '--';
    return `${appointment.date} ${appointment.timeSlot}`;
}

function getSupervisorsDisplay(supervisors: SupervisorSummary[]) {
    if (supervisors.length === 0) return 'غير مسند';
    const names = supervisors.map(supervisor => supervisor.name).filter(Boolean);
    if (names.length <= 2) return names.join('، ');
    return `${names[0]}، ${names[1]} +${names.length - 2}`;
}

export default function MarketingOperationsContent() {
    const [targets, setTargets] = useState<MarketingContactTarget[]>([]);
    const [loading, setLoading] = useState(true);
    const [syncing, setSyncing] = useState(false);
    const [selectedSupervisor, setSelectedSupervisor] = useState('all');
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    const loadTargets = useCallback(async () => {
        setLoading(true);
        try {
            const data = await api.contactTargets.listMarketing();
            setTargets(data);
        } catch (error) {
            console.error('Failed to load marketing contact targets:', error);
            setTargets([]);
            setMessage({ type: 'error', text: 'تعذر تحميل أهداف التسويق' });
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadTargets();
    }, [loadTargets]);

    const handleSync = async () => {
        setSyncing(true);
        setMessage(null);
        try {
            const result = await api.contactTargets.syncMarketing();
            setTargets(result.targets);
            setMessage({ type: 'success', text: `تم تحديث أهداف التسويق (${result.count})` });
        } catch (error) {
            console.error('Failed to sync marketing contact targets:', error);
            setMessage({ type: 'error', text: 'تعذر تحديث أهداف التسويق' });
        } finally {
            setSyncing(false);
        }
    };

    const rows = useMemo<MarketingContactTargetRow[]>(() => {
        return targets.map(target => ({
            ...target,
            supervisors: target.supervisors ?? [],
            supervisorSearchText: (target.supervisors ?? []).map(supervisor => supervisor.name).join('، '),
            supervisorsDisplay: getSupervisorsDisplay(target.supervisors ?? []),
            statusFilter: target.status,
            latestAppointmentText: getAppointmentText(target.latestAppointment),
        }));
    }, [targets]);

    const supervisorOptions = useMemo(() => {
        const supervisors = new Map<string, string>();
        let hasUnassigned = false;
        rows.forEach(row => {
            if (row.supervisors.length === 0) {
                hasUnassigned = true;
                return;
            }
            row.supervisors.forEach(supervisor => {
                supervisors.set(String(supervisor.hrUserId), supervisor.name);
            });
        });

        const options = Array.from(supervisors.entries()).map(([value, label]) => ({ value, label }));
        if (hasUnassigned) options.push({ value: 'unassigned', label: 'غير مسند' });
        return options;
    }, [rows]);

    const filteredRowsBySupervisor = useMemo(() => {
        if (selectedSupervisor === 'all') return rows;
        if (selectedSupervisor === 'unassigned') {
            return rows.filter(row => row.supervisors.length === 0);
        }
        return rows.filter(row =>
            row.supervisors.some(supervisor => String(supervisor.hrUserId) === selectedSupervisor),
        );
    }, [rows, selectedSupervisor]);

    const filters = useMemo<FilterDef[]>(() => {
        const statuses = new Map<string, string>();
        filteredRowsBySupervisor.forEach(row => {
            statuses.set(row.statusFilter, getStatusLabel(row.status));
        });

        return [
            {
                key: 'statusFilter',
                label: 'الحالة',
                options: Array.from(statuses.entries()).map(([value, label]) => ({ value, label })),
            },
        ];
    }, [filteredRowsBySupervisor]);

    const columns: ColumnDef<MarketingContactTargetRow>[] = [
        {
            key: 'clientId',
            label: 'ID الزبون',
            sortable: true,
            render: target => <span className="font-mono text-sm text-slate-600" dir="ltr">{target.clientId}</span>,
        },
        {
            key: 'customerName',
            label: 'الزبون',
            sortable: true,
            render: target => <span className="font-semibold text-slate-700">{target.customerName}</span>,
        },
        {
            key: 'phone',
            label: 'الهاتف',
            sortable: true,
            render: target => <span className="font-mono text-slate-600 tracking-wide" dir="ltr">{target.phone || '--'}</span>,
        },
        {
            key: 'supervisorSearchText',
            label: 'المشرفات',
            sortable: true,
            render: target => (
                <span
                    className={`text-sm ${target.supervisors.length === 0 ? 'font-bold text-amber-700' : 'text-slate-600'}`}
                    title={target.supervisorSearchText || 'غير مسند'}
                >
                    {target.supervisorsDisplay}
                </span>
            ),
            getValue: target => target.supervisorSearchText || 'غير مسند',
        },
        {
            key: 'zoneName',
            label: 'المنطقة',
            sortable: true,
            render: target => <span className="text-sm text-slate-600">{target.zoneName || '--'}</span>,
            getValue: target => target.zoneName || '',
        },
        {
            key: 'routeName',
            label: 'المسار',
            sortable: true,
            render: target => <span className="text-sm text-slate-600">{target.routeName || '-'}</span>,
            getValue: target => target.routeName || '',
        },
        {
            key: 'status',
            label: 'حالة هدف الاتصال',
            sortable: true,
            render: target => (
                <span className="px-2.5 py-1 rounded-full bg-sky-50 text-sky-700 text-xs font-bold border border-sky-200">
                    {getStatusLabel(target.status)}
                </span>
            ),
            getValue: target => getStatusLabel(target.status),
        },
        {
            key: 'latestCallOutcome',
            label: 'آخر نتيجة اتصال',
            sortable: true,
            render: target => <span className="text-sm text-slate-600">{getOutcomeLabel(target.latestCallOutcome)}</span>,
            getValue: target => getOutcomeLabel(target.latestCallOutcome),
        },
        {
            key: 'latestAppointmentText',
            label: 'آخر موعد',
            sortable: true,
            render: target => <span className="text-sm text-slate-600">{target.latestAppointmentText}</span>,
        },
        {
            key: 'flags',
            label: 'ملاحظات',
            render: target => (
                <span className="text-xs font-bold text-slate-400">
                    {target.supervisors.length === 0 ? 'بحاجة لإسناد' : '--'}
                </span>
            ),
        },
    ];

    const assignedCount = rows.filter(row => row.supervisors.length > 0).length;
    const bookedCount = rows.filter(row => row.status === 'booked').length;

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
                        <Target className="w-6 h-6 text-indigo-600" />
                        عمليات التسويق
                    </h1>
                    <p className="text-slate-500 mt-1">أهداف الاتصال التسويقية للـ Leads ضمن الفرع الحالي.</p>
                </div>
                <button
                    type="button"
                    onClick={handleSync}
                    disabled={syncing}
                    className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition-all hover:bg-indigo-500 disabled:opacity-60"
                >
                    {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                    <span>{syncing ? 'جاري التحديث...' : 'تحديث أهداف التسويق'}</span>
                </button>
            </div>

            {message && (
                <div className={`rounded-lg border px-4 py-3 text-sm font-bold ${message.type === 'success' ? 'border-emerald-100 bg-emerald-50 text-emerald-700' : 'border-red-100 bg-red-50 text-red-700'}`}>
                    {message.text}
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
                    <div>
                        <p className="text-sm font-semibold text-slate-500 mb-1">إجمالي أهداف الاتصال</p>
                        <p className="text-3xl font-bold text-indigo-600">{rows.length}</p>
                    </div>
                    <div className="w-12 h-12 bg-indigo-50 rounded-xl flex items-center justify-center">
                        <Target className="w-6 h-6 text-indigo-500" />
                    </div>
                </div>

                <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
                    <div>
                        <p className="text-sm font-semibold text-slate-500 mb-1">مسندة لمشرفات</p>
                        <p className="text-3xl font-bold text-sky-600">{assignedCount}</p>
                    </div>
                    <div className="w-12 h-12 bg-sky-50 rounded-xl flex items-center justify-center">
                        <Users className="w-6 h-6 text-sky-500" />
                    </div>
                </div>

                <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
                    <div>
                        <p className="text-sm font-semibold text-slate-500 mb-1">تم حجز موعد</p>
                        <p className="text-3xl font-bold text-emerald-600">{bookedCount}</p>
                    </div>
                    <div className="w-12 h-12 bg-emerald-50 rounded-xl flex items-center justify-center">
                        <PhoneCall className="w-6 h-6 text-emerald-500" />
                    </div>
                </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <label className="mb-2 block text-sm font-bold text-slate-700">فلتر المشرفات</label>
                <select
                    value={selectedSupervisor}
                    onChange={event => setSelectedSupervisor(event.target.value)}
                    className="w-full max-w-xs rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-sky-500 focus:outline-none"
                >
                    <option value="all">كل المشرفات</option>
                    {supervisorOptions.map(option => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                </select>
            </div>

            <SmartTable<MarketingContactTargetRow>
                title="أهداف الاتصال التسويقية"
                icon={Target}
                data={filteredRowsBySupervisor}
                columns={columns}
                filters={filters}
                searchKeys={['customerName', 'phone', 'supervisorSearchText', 'zoneName', 'routeName']}
                searchPlaceholder="بحث بالاسم أو الهاتف أو المشرفات أو المسار..."
                getId={target => target.contactTargetId}
                emptyIcon={Target}
                emptyMessage={loading ? 'جاري تحميل أهداف التسويق...' : 'لا توجد أهداف اتصال تسويقية حالياً'}
                tableMinWidth={1120}
                defaultSortKey="customerName"
                defaultSortDir="asc"
            />
        </div>
    );
}
