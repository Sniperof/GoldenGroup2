// All open_tasks belonging to this device. The list is filtered client-side
// because /api/open-tasks/client/:clientId returns the client's full task feed.

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  Gauge,
  Loader2,
  PackageCheck,
  PlayCircle,
  Repeat,
  RotateCcw,
  CalendarClock,
  Truck,
  Unplug,
  Wrench,
  X,
  Zap,
} from 'lucide-react';
import SmartTable, { type ColumnDef } from '../../../components/SmartTable';
import { api } from '../../../lib/api';
import Button from '../../../components/ui/Button';
import Select from '../../../components/ui/Select';
import DateField from '../../../components/ui/DateField';
import { usePermissions } from '../../../hooks/usePermissions';
import GeoSmartSearch, { type GeoSelection } from '../../../components/GeoSmartSearch';

interface Props {
  tasks: any[];
  deviceId: number;
  contractId?: number | null;
  device: any;
  onTaskCreated?: () => void;
}

const STATUS_LABEL: Record<string, { cls: string; label: string }> = {
  open:              { cls: 'bg-amber-100 text-amber-700',     label: 'مفتوحة' },
  in_progress:       { cls: 'bg-sky-100 text-sky-700',         label: 'قيد التنفيذ' },
  completed:         { cls: 'bg-emerald-100 text-emerald-700', label: 'مكتملة' },
  cancelled:         { cls: 'bg-slate-100 text-slate-500',     label: 'ملغاة' },
  needs_follow_up:   { cls: 'bg-rose-100 text-rose-700',       label: 'تحتاج متابعة' },
};

function fmt(d?: string | null) {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('ar-SY'); } catch { return d; }
}

function sameId(a: unknown, b: unknown) {
  if (a == null || b == null) return false;
  return Number(a) === Number(b);
}

const TERMINAL_STATUSES = ['completed', 'closed', 'cancelled'];

const emptyGeoSelection = (): GeoSelection => ({
  govId: '',
  regionId: '',
  subId: '',
  neighborhoodId: '',
});

const TASK_OPTIONS = [
  { type: 'device_delivery', label: 'تسليم', Icon: Truck },
  { type: 'device_installation', label: 'تركيب', Icon: Wrench },
  { type: 'device_activation', label: 'تشغيل', Icon: Zap },
  { type: 'device_checkup', label: 'تشييك', Icon: Gauge },
  { type: 'device_disconnection', label: 'فك', Icon: Unplug },
  { type: 'device_retrieval', label: 'سحب', Icon: PackageCheck },
  { type: 'device_transfer', label: 'نقل', Icon: Repeat },
  { type: 'device_return', label: 'إرجاع', Icon: RotateCcw },
  { type: 'emergency_maintenance', label: 'صيانة طارئة', Icon: PlayCircle },
  { type: 'periodic_maintenance', label: 'صيانة دورية', Icon: CalendarClock },
] as const;

function activeTaskOf(tasks: any[], taskType: string, deviceId: number) {
  return tasks.find((task) => (
    sameId(task.deviceId, deviceId)
    && task.taskType === taskType
    && !TERMINAL_STATUSES.includes(String(task.status))
  ));
}

function hasSuccessfulDisconnection(tasks: any[], deviceId: number) {
  return tasks.some((task) => (
    sameId(task.deviceId, deviceId)
    && task.taskType === 'device_disconnection'
    && TERMINAL_STATUSES.includes(String(task.status))
    && ['disconnected_successfully', 'requires_retrieval'].includes(String(task.lastAttempt?.finalDecision ?? task.latestFinalDecision ?? ''))
  ));
}

function hasSuccessfulMaintenanceRetrieval(tasks: any[], deviceId: number) {
  return tasks.some((task) => (
    sameId(task.deviceId, deviceId)
    && task.taskType === 'device_retrieval'
    && TERMINAL_STATUSES.includes(String(task.status))
    && String(task.lastAttempt?.finalDecision ?? task.latestFinalDecision ?? '') === 'retrieved_successfully'
    && String(task.retrievalPurpose ?? task.retrieval_purpose ?? '') === 'maintenance'
  ));
}

function taskAvailability(taskType: string, device: any, deviceTasks: any[]) {
  const duplicate = activeTaskOf(deviceTasks, taskType, Number(device?.id));
  if (duplicate) return { allowed: false, reason: `توجد مهمة نشطة بالفعل #${duplicate.id}` };

  switch (taskType) {
    case 'device_delivery':
      return device?.status === 'pending_delivery'
        ? { allowed: true, reason: 'الجهاز بانتظار التسليم' }
        : { allowed: false, reason: 'التسليم مسموح فقط لجهاز بانتظار التسليم' };
    case 'device_installation':
      return device?.status === 'delivered'
        ? { allowed: true, reason: 'الجهاز مُسلّم وجاهز للتركيب' }
        : { allowed: false, reason: 'التركيب يحتاج جهازاً بحالة delivered' };
    case 'device_activation':
      return device?.status === 'installed'
        ? { allowed: true, reason: 'الجهاز مركب وجاهز للتشغيل' }
        : { allowed: false, reason: 'التشغيل يحتاج جهازاً بحالة installed' };
    case 'device_checkup':
      return ['delivered', 'installed', 'active'].includes(String(device?.status))
        ? { allowed: true, reason: 'يسجل الحالة الفنية الحالية للجهاز فقط' }
        : { allowed: false, reason: 'التشييك يحتاج جهازاً موجوداً عند الزبون' };
    case 'device_disconnection':
      return device?.status === 'active'
        ? { allowed: true, reason: 'الجهاز فعال ويمكن فكه' }
        : { allowed: false, reason: 'الفك يحتاج جهازاً بحالة active' };
    case 'device_retrieval': {
      if (device?.status !== 'out_of_service') {
        return { allowed: false, reason: 'السحب يحتاج جهازاً بحالة out_of_service' };
      }
      if (!hasSuccessfulDisconnection(deviceTasks, Number(device?.id))) {
        return { allowed: false, reason: 'السحب يحتاج مهمة فك ناجحة سابقة' };
      }
      return { allowed: true, reason: 'الجهاز مفكوك وجاهز للسحب إلى فرع الخدمة' };
    }
    case 'device_return': {
      if (device?.status !== 'in_workshop') {
        return { allowed: false, reason: 'الإرجاع يحتاج جهازاً بحالة in_workshop' };
      }
      if (!hasSuccessfulMaintenanceRetrieval(deviceTasks, Number(device?.id))) {
        return { allowed: false, reason: 'الإرجاع يحتاج سحب صيانة ناجح سابق' };
      }
      return { allowed: true, reason: 'الجهاز داخل الورشة وجاهز لإنشاء مهمة إرجاع' };
    }
    case 'device_transfer':
      return ['delivered', 'installed', 'active'].includes(String(device?.status))
        ? { allowed: true, reason: 'يمكن نقل الجهاز إلى عنوان مبدئي جديد أو إلى زبون آخر' }
        : { allowed: false, reason: 'النقل يحتاج جهازاً موجوداً عند الزبون' };
    case 'emergency_maintenance':
      return ['active', 'installed', 'faulty', 'out_of_service'].includes(String(device?.status))
        ? { allowed: true, reason: 'يمكن فتح صيانة طارئة مع وصف العطل' }
        : { allowed: false, reason: 'الصيانة الطارئة تحتاج جهازاً في مسار خدمة فعلي' };
    case 'periodic_maintenance':
      return device?.status === 'active'
        ? { allowed: true, reason: 'يمكن إنشاء دورية يدوية لجهاز فعال' }
        : { allowed: false, reason: 'الصيانة الدورية اليدوية تحتاج جهازاً active' };
    default:
      return { allowed: false, reason: 'نوع المهمة غير مدعوم' };
  }
}

export function TasksSection({ tasks, deviceId, contractId, device, onTaskCreated }: Props) {
  const { hasPermission } = usePermissions();
  const [showDialog, setShowDialog] = useState(false);
  const [mode, setMode] = useState<'choose' | 'checkup' | 'retrieval' | 'return' | 'transfer' | 'periodic'>('choose');
  const [branches, setBranches] = useState<any[]>([]);
  const [geoUnits, setGeoUnits] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retrievalPurpose, setRetrievalPurpose] = useState<'maintenance' | 'replacement'>('maintenance');
  const [serviceBranchId, setServiceBranchId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState<'high' | 'medium' | 'low'>('medium');
  const [notes, setNotes] = useState('');
  const [periodicReason, setPeriodicReason] = useState('bootstrap جهاز قائم');
  const [periodicIntervalMonths, setPeriodicIntervalMonths] = useState('');
  const [transferKind, setTransferKind] = useState<'same_customer_new_address' | 'another_customer'>('same_customer_new_address');
  const [targetClientId, setTargetClientId] = useState('');
  const [transferGeoSelection, setTransferGeoSelection] = useState<GeoSelection>(emptyGeoSelection);
  const [transferAddressText, setTransferAddressText] = useState('');
  const [transferLat, setTransferLat] = useState('');
  const [transferLng, setTransferLng] = useState('');
  const myTasks = (tasks ?? []).filter(t =>
    sameId(t.deviceId, deviceId) || sameId(t.contractId, contractId)
  );
  const activeBranches = useMemo(() => branches.filter((branch) => branch.status !== 'inactive'), [branches]);
  const activeGeoUnits = useMemo(() => geoUnits.filter((unit) => unit?.status !== 'inactive'), [geoUnits]);
  const targetClients = useMemo(() => clients.filter((client) => Number(client.id) !== Number(device?.customerId)), [clients, device?.customerId]);

  useEffect(() => {
    if (!showDialog) return;
    api.branches.list()
      .then((rows) => {
        const list = Array.isArray(rows) ? rows : [];
        setBranches(list);
        const preferred = list.find((branch: any) => Number(branch.id) === Number(device?.branchId) && branch.status !== 'inactive') ?? list.find((branch: any) => branch.status !== 'inactive');
        setServiceBranchId(preferred?.id ? String(preferred.id) : '');
      })
      .catch(() => setBranches([]));
    api.geoUnits.list()
      .then((rows) => setGeoUnits(Array.isArray(rows) ? rows : []))
      .catch(() => setGeoUnits([]));
    api.clients.list()
      .then((rows) => setClients(Array.isArray(rows) ? rows : []))
      .catch(() => setClients([]));
  }, [showDialog, device?.branchId]);

  function openDialog() {
    setMode('choose');
    setError(null);
    setRetrievalPurpose('maintenance');
    setDueDate(new Date().toISOString().split('T')[0]);
    setPriority('medium');
    setNotes('');
    setPeriodicReason('bootstrap جهاز قائم');
    setPeriodicIntervalMonths('');
    setTransferKind('same_customer_new_address');
    setTargetClientId('');
    setTransferGeoSelection(emptyGeoSelection());
    setTransferAddressText('');
    setTransferLat('');
    setTransferLng('');
    setShowDialog(true);
  }

  async function createRetrievalTask() {
    setError(null);
    if (!serviceBranchId) {
      setError('اختر فرع الخدمة');
      return;
    }
    if (!dueDate) {
      setError('تاريخ المهمة مطلوب');
      return;
    }
    setBusy(true);
    try {
      await api.openTasks.create({
        clientId: device.customerId,
        branchId: Number(serviceBranchId),
        installedDeviceId: device.id,
        taskType: 'device_retrieval',
        taskFamily: 'service',
        reason: retrievalPurpose === 'maintenance' ? 'device_retrieval_maintenance' : 'device_retrieval_replacement',
        contractId: device.contractId,
        dueDate,
        priority,
        serviceBranchId: Number(serviceBranchId),
        retrievalPurpose,
        notes: notes.trim() || null,
      });
      setShowDialog(false);
      onTaskCreated?.();
    } catch (err: any) {
      setError(err?.message || 'فشل إنشاء مهمة سحب الجهاز');
    } finally {
      setBusy(false);
    }
  }

  async function createReturnTask() {
    setError(null);
    if (!dueDate) {
      setError('تاريخ المهمة مطلوب');
      return;
    }
    setBusy(true);
    try {
      await api.openTasks.create({
        clientId: device.customerId,
        branchId: device.branchId,
        installedDeviceId: device.id,
        taskType: 'device_return',
        taskFamily: 'service',
        reason: 'device_return_after_maintenance',
        contractId: device.contractId,
        dueDate,
        priority,
        notes: notes.trim() || null,
      });
      setShowDialog(false);
      onTaskCreated?.();
    } catch (err: any) {
      setError(err?.message || 'فشل إنشاء مهمة إرجاع الجهاز');
    } finally {
      setBusy(false);
    }
  }

  async function createCheckupTask() {
    setError(null);
    if (!dueDate) {
      setError('تاريخ المهمة مطلوب');
      return;
    }
    setBusy(true);
    try {
      await api.openTasks.create({
        clientId: device.customerId,
        branchId: device.branchId,
        installedDeviceId: device.id,
        taskType: 'device_checkup',
        taskFamily: 'service',
        reason: 'device_checkup',
        contractId: device.contractId,
        dueDate,
        priority,
        notes: notes.trim() || null,
      });
      setShowDialog(false);
      onTaskCreated?.();
    } catch (err: any) {
      setError(err?.message || 'فشل إنشاء مهمة تشييك الجهاز');
    } finally {
      setBusy(false);
    }
  }

  async function createTransferTask() {
    setError(null);
    const neighborhoodId = transferGeoSelection.neighborhoodId;
    if (!dueDate) {
      setError('تاريخ المهمة مطلوب');
      return;
    }
    if (!neighborhoodId) {
      setError('اختر الحي في العنوان المبدئي الجديد');
      return;
    }
    if (!transferAddressText.trim()) {
      setError('العنوان التفصيلي مطلوب');
      return;
    }
    if (transferKind === 'another_customer' && !targetClientId) {
      setError('اختر الزبون الجديد');
      return;
    }
    setBusy(true);
    try {
      await api.openTasks.create({
        clientId: device.customerId,
        branchId: device.branchId,
        installedDeviceId: device.id,
        taskType: 'device_transfer',
        taskFamily: 'service',
        reason: transferKind === 'another_customer' ? 'device_transfer_another_customer' : 'device_transfer_same_customer_new_address',
        dueDate,
        priority,
        transferKind,
        targetClientId: transferKind === 'another_customer' ? Number(targetClientId) : null,
        plannedTransferGeoUnitId: Number(neighborhoodId),
        plannedTransferAddressText: transferAddressText.trim(),
        plannedTransferLat: transferLat.trim() ? Number(transferLat) : null,
        plannedTransferLng: transferLng.trim() ? Number(transferLng) : null,
        notes: notes.trim() || null,
      });
      setShowDialog(false);
      onTaskCreated?.();
    } catch (err: any) {
      setError(err?.message || 'فشل إنشاء مهمة نقل الجهاز');
    } finally {
      setBusy(false);
    }
  }

  async function createPeriodicTask() {
    setError(null);
    if (!dueDate) {
      setError('تاريخ الاستحقاق مطلوب');
      return;
    }
    if (!periodicReason.trim()) {
      setError('سبب الإنشاء اليدوي مطلوب');
      return;
    }
    setBusy(true);
    try {
      await api.installedDevices.createPeriodicMaintenance(device.id, {
        dueDate,
        manualReason: periodicReason.trim(),
        intervalMonths: periodicIntervalMonths ? Number(periodicIntervalMonths) : null,
        notes: notes.trim() || null,
      });
      setShowDialog(false);
      onTaskCreated?.();
    } catch (err: any) {
      setError(err?.message || 'فشل إنشاء الصيانة الدورية');
    } finally {
      setBusy(false);
    }
  }

  // Columns mirror the original raw table 1:1 (design-only migration to <SmartTable>).
  const columns: ColumnDef<any>[] = [
    {
      key: 'id', label: '#',
      render: t => <Link to={`/tasks/${t.id}`} className="font-mono text-sm text-slate-500 hover:text-sky-600 hover:underline">#{t.id}</Link>,
    },
    { key: 'taskType', label: 'النوع', render: t => <span className="text-sm text-slate-700">{t.taskType}</span> },
    { key: 'taskFamily', label: 'العائلة', render: t => <span className="text-sm text-slate-500">{t.taskFamily}</span> },
    { key: 'dueDate', label: 'تاريخ الاستحقاق', render: t => <span className="text-sm text-slate-700">{fmt(t.dueDate)}</span> },
    {
      key: 'status', label: 'الحالة',
      render: t => {
        const st = STATUS_LABEL[t.status] ?? { cls: 'bg-slate-100 text-slate-600', label: t.status };
        return <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${st.cls}`}>{st.label}</span>;
      },
    },
  ];

  return (
    <section id="tasks" className="scroll-mt-24">
      <SmartTable<any>
        title="المهام المرتبطة"
        subtitle="كل المهام الميدانية على هذا الجهاز"
        icon={ClipboardList}
        data={myTasks}
        columns={columns}
        getId={t => t.id}
        hideFilterBar
        tableMinWidth={620}
        headerActions={
          <Button size="sm" icon={ClipboardList} onClick={openDialog}>
            إضافة مهمة جديدة
          </Button>
        }
        emptyIcon={ClipboardList}
        emptyMessage="لا مهام مرتبطة بهذا الجهاز."
      />

      {showDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" dir="rtl">
          <div className="w-full max-w-4xl rounded-xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <div className="flex items-center gap-2">
                <ClipboardList className="h-5 w-5 text-slate-700" />
                <h2 className="text-base font-black text-slate-900">إضافة مهمة جديدة للجهاز</h2>
              </div>
              <button onClick={() => setShowDialog(false)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="max-h-[75vh] overflow-y-auto px-5 py-4">
              {error && (
                <div className="mb-4 flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                  <AlertTriangle className="h-4 w-4" />
                  {error}
                </div>
              )}

              {mode === 'choose' && (
                <div className="grid gap-3 md:grid-cols-4">
                  {TASK_OPTIONS.map(({ type, label, Icon }) => {
                    const availability = taskAvailability(type, device, myTasks);
                    const enabled = availability.allowed && (
                      type === 'device_checkup'
                      || type === 'device_retrieval'
                      || type === 'device_return'
                      || type === 'device_transfer'
                      || (type === 'periodic_maintenance' && hasPermission('tasks.periodic.create_manual'))
                    );
                    return (
                      <button
                        key={type}
                        type="button"
                        disabled={!enabled}
                        onClick={() => {
                          if (type === 'device_retrieval') setMode('retrieval');
                          if (type === 'device_checkup') setMode('checkup');
                          if (type === 'device_return') setMode('return');
                          if (type === 'device_transfer') setMode('transfer');
                          if (type === 'periodic_maintenance') setMode('periodic');
                        }}
                        className={`min-h-[132px] rounded-lg border p-3 text-right transition ${
                          enabled
                            ? 'border-sky-200 bg-sky-50 text-sky-800 hover:bg-sky-100'
                            : availability.allowed
                              ? 'border-slate-200 bg-white text-slate-500 opacity-75'
                              : 'border-slate-200 bg-slate-50 text-slate-400'
                        }`}
                        title={availability.reason}
                      >
                        <Icon className="mb-2 h-5 w-5" />
                        <div className="flex items-center gap-1.5 text-sm font-black">
                          {label}
                          {availability.allowed && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />}
                        </div>
                        <div className="mt-1 text-xs leading-relaxed">{availability.reason}</div>
                        {availability.allowed && type === 'periodic_maintenance' && !hasPermission('tasks.periodic.create_manual') && (
                          <div className="mt-2 text-xs font-bold text-amber-600">تحتاج صلاحية إنشاء دورية يدوياً</div>
                        )}
                        {availability.allowed && type !== 'device_checkup' && type !== 'device_retrieval' && type !== 'device_return' && type !== 'device_transfer' && type !== 'periodic_maintenance' && (
                          <div className="mt-2 text-xs font-bold text-amber-600">نموذج الإنشاء سيضاف لاحقاً</div>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}

              {mode === 'periodic' && (
                <div className="space-y-4">
                  <button onClick={() => setMode('choose')} className="text-xs font-bold text-sky-700 hover:underline">
                    رجوع لاختيار نوع المهمة
                  </button>

                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
                    <div className="text-xs font-bold text-slate-400">الجهاز</div>
                    <div className="mt-1 text-sm font-black text-slate-800">
                      {device?.deviceModelName || device?.serialNumber || `جهاز #${device?.id}`}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">الحالة الحالية: {device?.status}</div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="space-y-1.5">
                      <span className="text-xs font-bold text-slate-500">تاريخ الاستحقاق</span>
                      <DateField value={dueDate} onChange={setDueDate} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" />
                    </label>

                    <label className="space-y-1.5">
                      <span className="text-xs font-bold text-slate-500">سبب الإنشاء اليدوي</span>
                      <Select<string>
                        value={periodicReason}
                        onChange={setPeriodicReason}
                        ariaLabel="سبب الإنشاء اليدوي"
                        className="w-full"
                        options={[
                          { value: 'bootstrap جهاز قائم', label: 'bootstrap جهاز قائم' },
                          { value: 'تصحيح جدول الصيانة', label: 'تصحيح جدول الصيانة' },
                          { value: 'طلب زيارة خارج الدورة', label: 'طلب زيارة خارج الدورة' },
                          { value: 'أخرى', label: 'أخرى' },
                        ]}
                      />
                    </label>

                    <label className="space-y-1.5">
                      <span className="text-xs font-bold text-slate-500">فترة مخصصة بالأشهر</span>
                      <input
                        type="number"
                        min={1}
                        value={periodicIntervalMonths}
                        onChange={(e) => setPeriodicIntervalMonths(e.target.value)}
                        placeholder="اتركها فارغة لاستخدام العقد"
                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                      />
                    </label>
                  </div>

                  <label className="block space-y-1.5">
                    <span className="text-xs font-bold text-slate-500">ملاحظات</span>
                    <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                  </label>
                </div>
              )}

              {mode === 'retrieval' && (
                <div className="space-y-4">
                  <button onClick={() => setMode('choose')} className="text-xs font-bold text-sky-700 hover:underline">
                    رجوع لاختيار نوع المهمة
                  </button>

                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
                    <div className="text-xs font-bold text-slate-400">الجهاز</div>
                    <div className="mt-1 text-sm font-black text-slate-800">
                      {device?.deviceModelName || device?.serialNumber || `جهاز #${device?.id}`}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">الحالة الحالية: {device?.status}</div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="space-y-1.5">
                      <span className="text-xs font-bold text-slate-500">غرض السحب</span>
                      <Select<'maintenance' | 'replacement'>
                        value={retrievalPurpose}
                        onChange={setRetrievalPurpose}
                        ariaLabel="غرض السحب"
                        className="w-full"
                        options={[
                          { value: 'maintenance', label: 'صيانة داخل فرع الشركة' },
                          { value: 'replacement', label: 'تبديل الجهاز بجهاز آخر' },
                        ]}
                      />
                    </label>

                    <label className="space-y-1.5">
                      <span className="text-xs font-bold text-slate-500">فرع الخدمة</span>
                      <select value={serviceBranchId} onChange={(e) => setServiceBranchId(e.target.value)} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                        <option value="">اختر فرع الخدمة</option>
                        {activeBranches.map((branch) => (
                          <option key={branch.id} value={branch.id}>{branch.name}</option>
                        ))}
                      </select>
                    </label>

                    <label className="space-y-1.5">
                      <span className="text-xs font-bold text-slate-500">تاريخ المهمة</span>
                      <DateField value={dueDate} onChange={setDueDate} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" />
                    </label>

                    <label className="space-y-1.5">
                      <span className="text-xs font-bold text-slate-500">الأولوية</span>
                      <Select<'high' | 'medium' | 'low'>
                        value={priority}
                        onChange={setPriority}
                        ariaLabel="الأولوية"
                        className="w-full"
                        options={[
                          { value: 'high', label: 'عالية' },
                          { value: 'medium', label: 'متوسطة' },
                          { value: 'low', label: 'منخفضة' },
                        ]}
                      />
                    </label>
                  </div>

                  <label className="block space-y-1.5">
                    <span className="text-xs font-bold text-slate-500">ملاحظات</span>
                    <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                  </label>
                </div>
              )}

              {mode === 'return' && (
                <div className="space-y-4">
                  <button onClick={() => setMode('choose')} className="text-xs font-bold text-sky-700 hover:underline">
                    رجوع لاختيار نوع المهمة
                  </button>

                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
                    <div className="text-xs font-bold text-slate-400">الجهاز</div>
                    <div className="mt-1 text-sm font-black text-slate-800">
                      {device?.deviceModelName || device?.serialNumber || `جهاز #${device?.id}`}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">الحالة الحالية: {device?.status}</div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="space-y-1.5">
                      <span className="text-xs font-bold text-slate-500">تاريخ المهمة</span>
                      <DateField value={dueDate} onChange={setDueDate} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" />
                    </label>

                    <label className="space-y-1.5">
                      <span className="text-xs font-bold text-slate-500">الأولوية</span>
                      <Select<'high' | 'medium' | 'low'>
                        value={priority}
                        onChange={setPriority}
                        ariaLabel="الأولوية"
                        className="w-full"
                        options={[
                          { value: 'high', label: 'عالية' },
                          { value: 'medium', label: 'متوسطة' },
                          { value: 'low', label: 'منخفضة' },
                        ]}
                      />
                    </label>
                  </div>

                  <label className="block space-y-1.5">
                    <span className="text-xs font-bold text-slate-500">ملاحظات</span>
                    <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                  </label>
                </div>
              )}
              {mode === 'checkup' && (
                <div className="space-y-4">
                  <button onClick={() => setMode('choose')} className="text-xs font-bold text-sky-700 hover:underline">
                    رجوع لاختيار نوع المهمة
                  </button>

                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
                    <div className="text-xs font-bold text-slate-400">الجهاز</div>
                    <div className="mt-1 text-sm font-black text-slate-800">
                      {device?.deviceModelName || device?.serialNumber || `جهاز #${device?.id}`}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">الحالة الحالية: {device?.status}</div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="space-y-1.5">
                      <span className="text-xs font-bold text-slate-500">تاريخ المهمة</span>
                      <DateField value={dueDate} onChange={setDueDate} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" />
                    </label>

                    <label className="space-y-1.5">
                      <span className="text-xs font-bold text-slate-500">الأولوية</span>
                      <Select<'high' | 'medium' | 'low'>
                        value={priority}
                        onChange={setPriority}
                        ariaLabel="الأولوية"
                        className="w-full"
                        options={[
                          { value: 'high', label: 'عالية' },
                          { value: 'medium', label: 'متوسطة' },
                          { value: 'low', label: 'منخفضة' },
                        ]}
                      />
                    </label>
                  </div>

                  <label className="block space-y-1.5">
                    <span className="text-xs font-bold text-slate-500">ملاحظات</span>
                    <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                  </label>
                </div>
              )}
              {mode === 'transfer' && (
                <div className="space-y-4">
                  <button onClick={() => setMode('choose')} className="text-xs font-bold text-sky-700 hover:underline">
                    رجوع لاختيار نوع المهمة
                  </button>

                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
                    <div className="text-xs font-bold text-slate-400">الجهاز</div>
                    <div className="mt-1 text-sm font-black text-slate-800">
                      {device?.deviceModelName || device?.serialNumber || `جهاز #${device?.id}`}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">الحالة الحالية: {device?.status}</div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="space-y-1.5">
                      <span className="text-xs font-bold text-slate-500">نوع النقل</span>
                      <Select<'same_customer_new_address' | 'another_customer'>
                        value={transferKind}
                        onChange={setTransferKind}
                        ariaLabel="نوع النقل"
                        className="w-full"
                        options={[
                          { value: 'same_customer_new_address', label: 'إلى عنوان جديد لنفس الزبون' },
                          { value: 'another_customer', label: 'إلى زبون آخر' },
                        ]}
                      />
                    </label>

                    {transferKind === 'another_customer' && (
                      <label className="space-y-1.5">
                        <span className="text-xs font-bold text-slate-500">الزبون الجديد</span>
                        <select value={targetClientId} onChange={(e) => setTargetClientId(e.target.value)} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                          <option value="">اختر الزبون الجديد</option>
                          {targetClients.map((client) => (
                            <option key={client.id} value={client.id}>
                              {client.name || [client.firstName, client.lastName].filter(Boolean).join(' ') || `زبون #${client.id}`}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}

                    <label className="space-y-1.5">
                      <span className="text-xs font-bold text-slate-500">تاريخ المهمة</span>
                      <DateField value={dueDate} onChange={setDueDate} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" />
                    </label>

                    <label className="space-y-1.5">
                      <span className="text-xs font-bold text-slate-500">الأولوية</span>
                      <Select<'high' | 'medium' | 'low'>
                        value={priority}
                        onChange={setPriority}
                        ariaLabel="الأولوية"
                        className="w-full"
                        options={[
                          { value: 'high', label: 'عالية' },
                          { value: 'medium', label: 'متوسطة' },
                          { value: 'low', label: 'منخفضة' },
                        ]}
                      />
                    </label>
                  </div>

                  <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-3">
                    <GeoSmartSearch
                      geoUnits={activeGeoUnits}
                      value={transferGeoSelection}
                      onChange={setTransferGeoSelection}
                      label="الحي في العنوان المبدئي الجديد"
                      required
                      minSelectableLevel={4}
                      placeholder="ابحث عن الحي"
                    />
                    <label className="block space-y-1.5">
                      <span className="text-xs font-bold text-slate-500">العنوان التفصيلي</span>
                      <textarea value={transferAddressText} onChange={(e) => setTransferAddressText(e.target.value)} rows={2} className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                    </label>
                    <div className="grid gap-3 md:grid-cols-2">
                      <label className="space-y-1.5">
                        <span className="text-xs font-bold text-slate-500">Latitude</span>
                        <input type="number" step="any" value={transferLat} onChange={(e) => setTransferLat(e.target.value)} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" />
                      </label>
                      <label className="space-y-1.5">
                        <span className="text-xs font-bold text-slate-500">Longitude</span>
                        <input type="number" step="any" value={transferLng} onChange={(e) => setTransferLng(e.target.value)} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" />
                      </label>
                    </div>
                  </div>

                  <label className="block space-y-1.5">
                    <span className="text-xs font-bold text-slate-500">ملاحظات</span>
                    <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                  </label>
                </div>
              )}
              {mode === 'return' && (
                <button onClick={createReturnTask} disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-bold text-white hover:bg-sky-500 disabled:opacity-60">
                  {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                  إنشاء مهمة الإرجاع
                </button>
              )}
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4">
              <button onClick={() => setShowDialog(false)} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50">
                إلغاء
              </button>
              {mode === 'retrieval' && (
                <button onClick={createRetrievalTask} disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-bold text-white hover:bg-sky-500 disabled:opacity-60">
                  {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                  إنشاء مهمة السحب
                </button>
              )}
              {mode === 'checkup' && (
                <button onClick={createCheckupTask} disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-bold text-white hover:bg-sky-500 disabled:opacity-60">
                  {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                  إنشاء مهمة التشييك
                </button>
              )}
              {mode === 'transfer' && (
                <button onClick={createTransferTask} disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-bold text-white hover:bg-sky-500 disabled:opacity-60">
                  {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                  إنشاء مهمة النقل
                </button>
              )}
              {mode === 'periodic' && (
                <button onClick={createPeriodicTask} disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-bold text-white hover:bg-sky-500 disabled:opacity-60">
                  {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                  إنشاء الصيانة الدورية
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

export default TasksSection;
