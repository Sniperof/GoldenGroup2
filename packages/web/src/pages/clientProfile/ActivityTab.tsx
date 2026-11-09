// «سجل التغييرات»: every change to the client record, written by a database
// trigger (migration 489) — who changed which field, from what to what, and
// through which operation. Rating, contact control and ownership keep their
// own histories in their own tabs.
import { useEffect, useState } from 'react';
import { History, Loader2, Pencil, Trash2, UserPlus, RotateCcw, type LucideIcon } from '../../components/ui/icons';
import SmartTable, { type ColumnDef } from '../../components/SmartTable';
import { api, type ClientActivityEntry } from '../../lib/api';

const FIELD_LABELS: Record<string, string> = {
    name: 'الاسم',
    nickname: 'اللقب',
    mobile: 'الرقم الأساسي',
    contacts: 'أرقام التواصل',
    governorate: 'المحافظة',
    district: 'المنطقة',
    neighborhood: 'الحي / الناحية',
    detailed_address: 'العنوان التفصيلي',
    gps_coordinates: 'الموقع على الخريطة',
    branch_id: 'فرع الملكية',
    source_channel: 'طريقة التواصل',
    referrer_type: 'نوع الوسيط',
    referrer_name: 'اسم الوسيط',
    referrers: 'الوسطاء',
    referral_date: 'تاريخ الإحالة',
    referral_reason: 'سبب الإحالة',
    referral_sheet_id: 'ورقة الإحالة',
    referral_address_text: 'عنوان الإحالة',
    referral_notes: 'ملاحظات الوسيط',
    candidate_status: 'مرحلة الزبون',
    is_candidate: 'اسم مقترح',
    target_client: 'زبون مستهدف',
    is_active: 'فعّال',
    gender: 'الجنس',
    birth_date: 'تاريخ الميلاد',
    mother_name: 'اسم الأم',
    national_id: 'الرقم الوطني',
    national_id_registry: 'القيد',
    national_id_issued_by: 'جهة الإصدار',
    national_id_issue_date: 'تاريخ الإصدار',
    national_id_box: 'الخانة',
    occupation: 'المهنة',
    spouse_occupation: 'مهنة الزوج/ة',
    water_source: 'مصدر المياه',
    data_quality: 'جودة البيانات',
    notes: 'ملاحظات',
};

const CONTEXT_LABELS: Record<string, string> = {
    client_created: 'إضافة زبون',
    candidate_converted: 'تحويل من اسم مقترح',
    client_edit: 'تعديل بيانات الزبون',
    client_contacts_edit: 'تعديل أرقام التواصل',
    client_deleted: 'حذف الزبون',
    mediator_renamed: 'تحديث اسم الوسيط تلقائياً',
    backfill: 'قبل بدء السجل',
};

// Coded values shown as words; anything else is displayed as stored.
const VALUE_LABELS: Record<string, Record<string, string>> = {
    referrer_type: { Personal: 'شخصي', Employee: 'موظف', Client: 'زبون', Unknown: 'مجهول', Other: 'أخرى' },
    source_channel: { Acquaintance: 'معرفة شخصية', PhoneCall: 'مكالمة هاتفية', SocialMedia: 'سوشال ميديا', Campaign: 'حملة إعلانية' },
    candidate_status: { LEAD: 'مرشح (LEAD)', FOP: 'مستهدف (FOP)', OP: 'زبون فعلي (OP)' },
    gender: { male: 'ذكر', female: 'أنثى' },
    is_candidate: { true: 'نعم', false: 'لا' },
    is_active: { true: 'نعم', false: 'لا' },
};

const EVENT_BADGES: Record<ClientActivityEntry['eventType'], { label: string; icon: LucideIcon; className: string }> = {
    created: { label: 'أُضيف الزبون', icon: UserPlus, className: 'bg-emerald-50 text-emerald-700' },
    field_changed: { label: 'تعديل', icon: Pencil, className: 'bg-sky-50 text-sky-700' },
    deleted: { label: 'حُذف الزبون', icon: Trash2, className: 'bg-red-50 text-red-600' },
    restored: { label: 'استُعيد الزبون', icon: RotateCcw, className: 'bg-emerald-50 text-emerald-700' },
};

function formatDateTime(value?: string | null) {
    if (!value) return '—';
    try {
        return new Date(value).toLocaleString('ar-SY', { dateStyle: 'medium', timeStyle: 'short' });
    } catch {
        return value;
    }
}

function displayValue(entry: ClientActivityEntry, value: string | null) {
    if (value == null || value === '') return null;
    const labels = entry.fieldKey ? VALUE_LABELS[entry.fieldKey] : undefined;
    return labels?.[value] ?? value;
}

function whatLabel(entry: ClientActivityEntry) {
    if (entry.eventType === 'field_changed') return FIELD_LABELS[entry.fieldKey ?? ''] ?? entry.fieldKey ?? '—';
    if (entry.eventType === 'created') return entry.newValue ?? '—';
    return '—';
}

function contextLabel(entry: ClientActivityEntry) {
    return (entry.changeContext && CONTEXT_LABELS[entry.changeContext]) || '—';
}

const columns: ColumnDef<ClientActivityEntry>[] = [
    { key: 'createdAt', label: 'التاريخ', render: e => <span className="whitespace-nowrap text-sm text-slate-600">{formatDateTime(e.createdAt)}</span>, exportValue: e => e.createdAt },
    {
        key: 'eventType',
        label: 'الحدث',
        render: e => {
            const badge = EVENT_BADGES[e.eventType] ?? EVENT_BADGES.field_changed;
            const Icon = badge.icon;
            return (
                <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-bold ${badge.className}`}>
                    <Icon className="h-3 w-3" /> {badge.label}
                </span>
            );
        },
        exportValue: e => (EVENT_BADGES[e.eventType] ?? EVENT_BADGES.field_changed).label,
    },
    { key: 'fieldKey', label: 'الحقل', render: e => <span className="font-bold text-slate-800">{whatLabel(e)}</span>, exportValue: e => whatLabel(e) },
    {
        key: 'oldValue',
        label: 'القيمة السابقة',
        render: e => {
            if (e.eventType !== 'field_changed') return <span className="text-sm text-slate-300">—</span>;
            const v = displayValue(e, e.oldValue);
            return v ? <span className="text-sm text-slate-500 line-through decoration-slate-300">{v}</span> : <span className="text-sm text-slate-400">فارغ</span>;
        },
        exportValue: e => displayValue(e, e.oldValue) ?? '',
    },
    {
        key: 'newValue',
        label: 'القيمة الجديدة',
        render: e => {
            if (e.eventType !== 'field_changed') return <span className="text-sm text-slate-300">—</span>;
            const v = displayValue(e, e.newValue);
            return v ? <span className="text-sm font-bold text-slate-800">{v}</span> : <span className="text-sm text-slate-400">فارغ</span>;
        },
        exportValue: e => displayValue(e, e.newValue) ?? '',
    },
    { key: 'changeContext', label: 'المصدر', render: e => <span className="text-sm text-slate-700">{contextLabel(e)}</span>, exportValue: e => contextLabel(e) },
    { key: 'performedByName', label: 'بواسطة', render: e => <span className="text-sm text-slate-600">{e.performedByName ?? (e.role === 'system' ? 'النظام' : '—')}</span>, exportValue: e => e.performedByName ?? '' },
];

export default function ActivityTab({ clientId }: { clientId: number }) {
    const [entries, setEntries] = useState<ClientActivityEntry[] | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        setEntries(null);
        setError(null);
        api.clients.getActivity(clientId)
            .then(rows => { if (!cancelled) setEntries(rows); })
            .catch((err: any) => { if (!cancelled) setError(err?.message || 'تعذّر تحميل سجل التغييرات'); });
        return () => { cancelled = true; };
    }, [clientId]);

    if (error) {
        return <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-700">{error}</div>;
    }
    if (!entries) {
        return (
            <div className="flex items-center justify-center gap-2 p-10 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" /> جارٍ تحميل السجل…
            </div>
        );
    }

    return (
        <SmartTable<ClientActivityEntry>
            title="سجل التغييرات"
            icon={History}
            data={entries}
            columns={columns}
            getId={entry => entry.id}
            hideFilterBar
            tableMinWidth={1000}
            emptyIcon={History}
            emptyMessage="لا توجد تغييرات مسجلة على هذا الزبون"
        />
    );
}
