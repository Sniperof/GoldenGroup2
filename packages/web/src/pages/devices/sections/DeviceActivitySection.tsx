// «سجل التغييرات»: every change to the device record, written by a database
// trigger (migration 498) — status moves and field edits, old → new, who made
// them and through which operation (a visit result names its task type).
// Warranties, possession, parts and technical states keep their own sections.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, History, Loader2, PackagePlus, Pencil, type LucideIcon } from '../../../components/ui/icons';
import SmartTable, { type ColumnDef } from '../../../components/SmartTable';
import { DeviceStatusBadge } from '../../../components/devices/DeviceStatusBadge';
import { api, type DeviceActivityEntry } from '../../../lib/api';

const FIELD_LABELS: Record<string, string> = {
  status: 'الحالة',
  contract_id: 'العقد',
  customer_id: 'الزبون',
  branch_id: 'الفرع',
  device_model_name: 'الموديل',
  serial_number: 'الرقم التسلسلي',
  installation_geo_unit_id: 'منطقة التركيب',
  installation_address_text: 'عنوان التركيب',
  installation_lat: 'خط العرض',
  installation_lng: 'خط الطول',
  delivery_date: 'تاريخ التسليم',
  installation_date: 'تاريخ التركيب',
  contract_warranty_end_date: 'نهاية كفالة العقد',
  warranty_months: 'مدة الكفالة (أشهر)',
  warranty_visits: 'زيارات الكفالة',
  device_source: 'مصدر الجهاز',
  external_device_name: 'اسم الجهاز الخارجي',
  external_device_serial: 'رقم الجهاز الخارجي',
  external_device_notes: 'ملاحظات الجهاز الخارجي',
};

const CONTEXT_LABELS: Record<string, string> = {
  contract_approved: 'اعتماد العقد',
  contract_cancelled: 'إلغاء العقد',
  device_edit: 'تعديل يدوي للجهاز',
  device_details_edit: 'تعديل من صفحة الجهاز',
  possession_transfer: 'نقل الحيازة إلى زبون آخر',
  external_device_created: 'تسجيل جهاز خارجي',
  service_request_promoted: 'ترقية طلب خدمة',
  installation_task_planned: 'إنشاء مهمة تركيب',
  task_completed: 'إغلاق مهمة',
  delivery_suspended: 'تعليق التسليم',
  delivery_resumed: 'استئناف التسليم',
  backfill: 'قبل بدء السجل',
};

const TASK_LABELS: Record<string, string> = {
  device_delivery: 'تسليم الجهاز',
  device_installation: 'تركيب الجهاز',
  device_activation: 'تشغيل الجهاز',
  device_checkup: 'تشييك الجهاز',
  device_disconnection: 'فك الجهاز',
  device_retrieval: 'سحب الجهاز',
  device_return: 'إرجاع الجهاز',
  device_transfer: 'نقل الجهاز',
  golden_warranty_offer: 'عرض كفالة ذهبية',
};

const VALUE_LABELS: Record<string, Record<string, string>> = {
  device_source: { company_contract: 'من عقد شركة', external: 'خارجي' },
};

const EVENT_BADGES: Record<DeviceActivityEntry['eventType'], { label: string; icon: LucideIcon; className: string }> = {
  created: { label: 'أُنشئ الجهاز', icon: PackagePlus, className: 'bg-emerald-50 text-emerald-700' },
  status_changed: { label: 'تغيّر الحالة', icon: Activity, className: 'bg-indigo-50 text-indigo-700' },
  field_changed: { label: 'تعديل', icon: Pencil, className: 'bg-sky-50 text-sky-700' },
};

function formatDateTime(value?: string | null) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString('ar-SY', { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return value;
  }
}

function contextLabel(entry: DeviceActivityEntry) {
  if (entry.changeContext === 'visit_result' || entry.changeContext === 'result_edit') {
    const task = (entry.taskType && TASK_LABELS[entry.taskType]) || 'مهمة';
    return entry.changeContext === 'result_edit' ? `تعديل نتيجة ${task}` : `نتيجة ${task}`;
  }
  return (entry.changeContext && CONTEXT_LABELS[entry.changeContext]) || '—';
}

function whatLabel(entry: DeviceActivityEntry) {
  if (entry.eventType === 'created') return '—';
  return FIELD_LABELS[entry.fieldKey ?? ''] ?? entry.fieldKey ?? '—';
}

function renderValue(entry: DeviceActivityEntry, value: string | null, previous: boolean) {
  if (entry.eventType === 'created') {
    return previous || !value
      ? <span className="text-sm text-slate-300">—</span>
      : <DeviceStatusBadge status={value} />;
  }
  if (value == null || value === '') return <span className="text-sm text-slate-400">فارغ</span>;
  if (entry.eventType === 'status_changed') return <DeviceStatusBadge status={value} className={previous ? 'opacity-60' : ''} />;
  const text = (entry.fieldKey && VALUE_LABELS[entry.fieldKey]?.[value]) ?? value;
  return previous
    ? <span className="text-sm text-slate-500 line-through decoration-slate-300">{text}</span>
    : <span className="text-sm font-bold text-slate-800">{text}</span>;
}

const columns: ColumnDef<DeviceActivityEntry>[] = [
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
  { key: 'oldValue', label: 'القيمة السابقة', render: e => renderValue(e, e.oldValue, true), exportValue: e => e.oldValue ?? '' },
  { key: 'newValue', label: 'القيمة الجديدة', render: e => renderValue(e, e.newValue, false), exportValue: e => e.newValue ?? '' },
  {
    key: 'changeContext',
    label: 'المصدر',
    render: e => (
      <div className="text-sm text-slate-700">
        {e.visitId ? <Link to={`/field-visits/${e.visitId}`} className="text-sky-700 hover:underline">{contextLabel(e)}</Link> : contextLabel(e)}
        {e.reason && <div className="text-xs text-slate-500">{e.reason}</div>}
      </div>
    ),
    exportValue: e => [contextLabel(e), e.reason].filter(Boolean).join(' — '),
  },
  { key: 'performedByName', label: 'بواسطة', render: e => <span className="text-sm text-slate-600">{e.performedByName ?? (e.role === 'system' ? 'النظام' : '—')}</span>, exportValue: e => e.performedByName ?? '' },
];

export function DeviceActivitySection({ deviceId }: { deviceId: number }) {
  const [entries, setEntries] = useState<DeviceActivityEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setEntries(null);
    setError(null);
    api.installedDevices.getActivity(deviceId)
      .then(rows => { if (!cancelled) setEntries(rows); })
      .catch((err: any) => { if (!cancelled) setError(err?.message || 'تعذّر تحميل سجل التغييرات'); });
    return () => { cancelled = true; };
  }, [deviceId]);

  return (
    <section id="activity" className="scroll-mt-16">
      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-700">{error}</div>
      ) : !entries ? (
        <div className="flex items-center justify-center gap-2 rounded-2xl border border-slate-100 bg-white p-10 text-sm text-slate-500 shadow-sm">
          <Loader2 className="h-4 w-4 animate-spin" /> جارٍ تحميل السجل…
        </div>
      ) : (
        <SmartTable<DeviceActivityEntry>
          title="سجل التغييرات"
          subtitle={`${entries.length} سطر`}
          icon={History}
          data={entries}
          columns={columns}
          getId={entry => entry.id}
          hideFilterBar
          tableMinWidth={1100}
          emptyIcon={History}
          emptyMessage="لا توجد تغييرات مسجلة على هذا الجهاز"
        />
      )}
    </section>
  );
}
