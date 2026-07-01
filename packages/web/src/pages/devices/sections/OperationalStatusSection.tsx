// Device operational status + lifecycle dates.

import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Loader2, MapPin, Truck, Unplug, Wrench, Zap } from 'lucide-react';
import { DeviceStatusBadge } from '../../../components/devices/DeviceStatusBadge';
import { SectionShell } from './SectionShell';
import { api } from '../../../lib/api';
import GeoSmartSearch, { formatGeoUnitLastLevels, type GeoSelection } from '../../../components/GeoSmartSearch';
import MapPicker from '../../../components/MapPicker';
import Button from '../../../components/ui/Button';
import Select from '../../../components/ui/Select';
import Modal from '../../../components/ui/Modal';
import DateField from '../../../components/ui/DateField';

interface Props {
  device: any;
  tasks?: any[];
  onTaskCreated?: () => void;
}

type DeliveryCreationReason = {
  value: string;
  label: string;
  systemReason?: string | null;
};

type CreationReasonOption = {
  value: string;
  label: string;
  systemReason?: string | null;
};

const ACTIVE_TASK_STATUSES = ['completed', 'closed', 'cancelled'];
const FALLBACK_DELIVERY_CREATION_REASONS: DeliveryCreationReason[] = [
  { value: 'تسليم جهاز بعد البيع', label: 'تسليم جهاز بعد البيع', systemReason: 'sale_delivery' },
  { value: 'إرجاع جهاز بعد الصيانة', label: 'إرجاع جهاز بعد الصيانة', systemReason: 'post_maintenance_return' },
  { value: 'تسليم جهاز تبديل مؤقت', label: 'تسليم جهاز تبديل مؤقت', systemReason: 'temporary_swap_delivery' },
  { value: 'تسليم جهاز بديل', label: 'تسليم جهاز بديل', systemReason: 'replacement_delivery' },
  { value: 'إنشاء يدوي', label: 'إنشاء يدوي', systemReason: 'manual_delivery' },
];
const FALLBACK_INSTALLATION_CREATION_REASONS: CreationReasonOption[] = [
  { value: 'إنشاء يدوي من حالة الجهاز', label: 'إنشاء يدوي من حالة الجهاز', systemReason: 'other' },
  { value: 'تركيب بعد نجاح التسليم', label: 'تركيب بعد نجاح التسليم', systemReason: 'service_request' },
  { value: 'متابعة ما بعد البيع', label: 'متابعة ما بعد البيع', systemReason: 'service_request' },
  { value: 'تصحيح بيانات التركيب', label: 'تصحيح بيانات التركيب', systemReason: 'other' },
];
const FALLBACK_DISCONNECTION_CREATION_REASONS: CreationReasonOption[] = [
  { value: 'طلب الزبون', label: 'طلب الزبون', systemReason: 'customer_request' },
  { value: 'إلغاء عقد', label: 'إلغاء عقد', systemReason: 'contract_cancelled' },
  { value: 'إيقاف مؤقت', label: 'إيقاف مؤقت', systemReason: 'temporary_stop' },
  { value: 'سلامة فنية', label: 'سلامة فنية', systemReason: 'technical_safety' },
  { value: 'تحضير تبديل', label: 'تحضير تبديل', systemReason: 'replacement_preparation' },
  { value: 'تحضير صيانة', label: 'تحضير صيانة', systemReason: 'maintenance_preparation' },
  { value: 'إنشاء يدوي', label: 'إنشاء يدوي', systemReason: 'other' },
];

const emptyGeoSelection: GeoSelection = { govId: '', regionId: '', subId: '', neighborhoodId: '' };

function fmt(d?: string | null) {
  if (!d) return null;
  try { return new Date(d).toLocaleDateString('ar-SY', { numberingSystem: 'latn' }); } catch { return d; }
}

function deepestGeoId(selection: GeoSelection) {
  return selection.neighborhoodId || selection.subId || selection.regionId || selection.govId || '';
}

function normalizeCreationReasons(rows: any, fallback: CreationReasonOption[]) {
  const items = Array.isArray(rows)
    ? rows
        .filter((row: any) => row?.isActive !== false)
        .map((row: any) => ({
          value: String(row.value ?? '').trim(),
          label: String(row.metadata?.label ?? row.value ?? '').trim(),
          systemReason: row.metadata?.systemReason ? String(row.metadata.systemReason).trim() : null,
        }))
        .filter((item: CreationReasonOption) => item.value && item.label)
    : [];
  return items.length > 0 ? items : fallback;
}

function selectedCreationReason(current: string, options: CreationReasonOption[]) {
  return options.some((item) => item.value === current) ? current : (options[0]?.value ?? '');
}

function selectedCreationOption(current: string, options: CreationReasonOption[]) {
  const value = selectedCreationReason(current, options);
  return options.find((item) => item.value === value) ?? null;
}

function LifecycleValue({ value, reason }: { value?: string | null; reason: string }) {
  const formatted = fmt(value);
  if (formatted) return <div className="text-sm font-semibold text-slate-700">{formatted}</div>;
  return (
    <div className="inline-flex flex-col">
      <span className="text-sm font-bold text-amber-700">غير مثبت بعد</span>
      <span className="text-xs text-slate-400">{reason}</span>
    </div>
  );
}

const ALLOWED_NEXT_TASK: Record<string, { type: 'device_delivery' | 'device_installation' | 'device_activation' | 'device_disconnection'; label: string; Icon: any; reason: string }> = {
  pending_delivery: { type: 'device_delivery', label: 'جدولة مهمة تسليم', Icon: Truck, reason: 'sale_delivery' },
  delivered: { type: 'device_installation', label: 'جدولة مهمة تركيب', Icon: Wrench, reason: 'other' },
  installed: { type: 'device_activation', label: 'جدولة مهمة تشغيل', Icon: Zap, reason: 'other' },
  active: { type: 'device_disconnection', label: 'جدولة مهمة فك', Icon: Unplug, reason: 'customer_request' },
};

export function OperationalStatusSection({ device, tasks, onTaskCreated }: Props) {
  const [busy, setBusy] = useState(false);
  const [showInstallationModal, setShowInstallationModal] = useState(false);
  const [showActivationModal, setShowActivationModal] = useState(false);
  const [showDisconnectionModal, setShowDisconnectionModal] = useState(false);
  const [geoUnits, setGeoUnits] = useState<any[]>([]);
  const [dueDate, setDueDate] = useState('');
  const [activationDueDate, setActivationDueDate] = useState('');
  const [activationExecutionDate, setActivationExecutionDate] = useState('');
  const [activationPriority, setActivationPriority] = useState<'high' | 'medium' | 'low'>('medium');
  const [activationNotes, setActivationNotes] = useState('');
  const [geoSelection, setGeoSelection] = useState<GeoSelection>({ ...emptyGeoSelection });
  const [detailedAddress, setDetailedAddress] = useState('');
  const [mapPosition, setMapPosition] = useState<[number, number] | null>(null);
  const [showMap, setShowMap] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [deliveryCreationReasons, setDeliveryCreationReasons] = useState<DeliveryCreationReason[]>(FALLBACK_DELIVERY_CREATION_REASONS);
  const [installationCreationReasons, setInstallationCreationReasons] = useState<CreationReasonOption[]>(FALLBACK_INSTALLATION_CREATION_REASONS);
  const [installationCreationReason, setInstallationCreationReason] = useState(FALLBACK_INSTALLATION_CREATION_REASONS[0].value);
  const [disconnectionCreationReasons, setDisconnectionCreationReasons] = useState<CreationReasonOption[]>(FALLBACK_DISCONNECTION_CREATION_REASONS);
  const [disconnectionCreationReason, setDisconnectionCreationReason] = useState(FALLBACK_DISCONNECTION_CREATION_REASONS[0].value);
  const next = ALLOWED_NEXT_TASK[device?.status];
  // Guard against duplicate scheduling — backend rejects with 409 if a task
  // of the same type is already open on this device. Hide the button when
  // such a task exists and show a helper pointing to the existing one.
  const existingActiveTask = useMemo(() => {
    if (!next || !device?.id || !Array.isArray(tasks)) return null;
    return tasks.find((t: any) => (
      Number(t?.deviceId) === Number(device.id)
      && t?.taskType === next.type
      && !ACTIVE_TASK_STATUSES.includes(String(t?.status))
    )) ?? null;
  }, [tasks, device?.id, next]);
  const activeGeoUnits = useMemo(() => geoUnits.filter((unit) => unit?.status !== 'inactive'), [geoUnits]);

  useEffect(() => {
    if (!showInstallationModal) return;
    api.geoUnits.list().then((rows) => setGeoUnits(Array.isArray(rows) ? rows : [])).catch(() => setGeoUnits([]));
  }, [showInstallationModal]);

  useEffect(() => {
    if (next?.type !== 'device_delivery') return;
    api.systemLists.getItemsByCode('device_delivery_creation_reasons')
      .then((rows: any[]) => {
        const items = Array.isArray(rows)
          ? rows
              .filter((row: any) => row?.isActive !== false)
              .map((row: any) => ({
                value: String(row.value ?? '').trim(),
                label: String(row.metadata?.label ?? row.value ?? '').trim(),
                systemReason: row.metadata?.systemReason ? String(row.metadata.systemReason).trim() : null,
              }))
              .filter((item: DeliveryCreationReason) => item.value && item.label)
          : [];
        setDeliveryCreationReasons(items.length > 0 ? items : FALLBACK_DELIVERY_CREATION_REASONS);
      })
      .catch(() => setDeliveryCreationReasons(FALLBACK_DELIVERY_CREATION_REASONS));
  }, [next?.type]);

  useEffect(() => {
    if (next?.type !== 'device_installation') return;
    api.systemLists.getItemsByCode('device_installation_creation_reasons')
      .then((rows: any[]) => {
        const items = Array.isArray(rows)
          ? rows
              .filter((row: any) => row?.isActive !== false)
              .map((row: any) => ({
                value: String(row.value ?? '').trim(),
                label: String(row.metadata?.label ?? row.value ?? '').trim(),
                systemReason: row.metadata?.systemReason ? String(row.metadata.systemReason).trim() : null,
              }))
              .filter((item: CreationReasonOption) => item.value && item.label)
          : [];
        const nextItems = items.length > 0 ? items : FALLBACK_INSTALLATION_CREATION_REASONS;
        setInstallationCreationReasons(nextItems);
        setInstallationCreationReason((current) => (
          nextItems.some((item) => item.value === current) ? current : nextItems[0].value
        ));
      })
      .catch(() => {
        setInstallationCreationReasons(FALLBACK_INSTALLATION_CREATION_REASONS);
        setInstallationCreationReason((current) => (
          FALLBACK_INSTALLATION_CREATION_REASONS.some((item) => item.value === current)
            ? current
            : FALLBACK_INSTALLATION_CREATION_REASONS[0].value
        ));
      });
  }, [next?.type]);

  useEffect(() => {
    if (next?.type !== 'device_disconnection') return;
    api.systemLists.getItemsByCode('device_disconnection_creation_reasons')
      .then((rows: any[]) => {
        const nextItems = normalizeCreationReasons(rows, FALLBACK_DISCONNECTION_CREATION_REASONS);
        setDisconnectionCreationReasons(nextItems);
        setDisconnectionCreationReason((current) => (
          nextItems.some((item) => item.value === current) ? current : nextItems[0].value
        ));
      })
      .catch(() => {
        setDisconnectionCreationReasons(FALLBACK_DISCONNECTION_CREATION_REASONS);
        setDisconnectionCreationReason((current) => (
          FALLBACK_DISCONNECTION_CREATION_REASONS.some((item) => item.value === current)
            ? current
            : FALLBACK_DISCONNECTION_CREATION_REASONS[0].value
        ));
      });
  }, [next?.type]);

  function getDeliveryCreationReason(reasonCode: string) {
    return (
      deliveryCreationReasons.find((item) => item.systemReason === reasonCode)
      ?? deliveryCreationReasons[0]
      ?? FALLBACK_DELIVERY_CREATION_REASONS[0]
    ).value;
  }

  function openInstallationModal() {
    setDueDate(new Date().toISOString().split('T')[0]);
    setGeoSelection(device?.installationGeoUnitId ? { ...emptyGeoSelection, neighborhoodId: String(device.installationGeoUnitId) } : { ...emptyGeoSelection });
    setDetailedAddress(device?.installationAddressText ?? '');
    setMapPosition(device?.installationLat && device?.installationLng ? [Number(device.installationLat), Number(device.installationLng)] : null);
    setShowMap(false);
    setInstallationCreationReason((current) => (
      installationCreationReasons.some((item) => item.value === current)
        ? current
        : installationCreationReasons[0]?.value ?? FALLBACK_INSTALLATION_CREATION_REASONS[0].value
    ));
    setModalError(null);
    setShowInstallationModal(true);
  }

  function openActivationModal() {
    const today = new Date().toISOString().split('T')[0];
    const target = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    setActivationExecutionDate(today);
    setActivationDueDate(target);
    setActivationPriority('medium');
    setActivationNotes('');
    setModalError(null);
    setShowActivationModal(true);
  }

  function openDisconnectionModal() {
    if (!next) return;
    const options = disconnectionCreationReasons.length > 0 ? disconnectionCreationReasons : FALLBACK_DISCONNECTION_CREATION_REASONS;
    setDisconnectionCreationReason((current) => selectedCreationReason(current, options));
    setModalError(null);
    setShowDisconnectionModal(true);
  }

  async function handleSchedule() {
    if (!next || !device?.id) return;
    if (next.type === 'device_installation') {
      openInstallationModal();
      return;
    }
    if (next.type === 'device_activation') {
      openActivationModal();
      return;
    }
    if (next.type === 'device_disconnection') {
      openDisconnectionModal();
      return;
    }
    setBusy(true);
    try {
      await api.openTasks.create({
        clientId: device.customerId,
        branchId: device.branchId,
        installedDeviceId: device.id,
        taskType: next.type,
        taskFamily: 'delivery',
        reason: next.reason,
        creationReason: next.type === 'device_delivery' ? getDeliveryCreationReason(next.reason) : undefined,
        contractId: device.contractId,
        deliveryAddress: device.installationAddressText || undefined,
        dueDate: new Date().toISOString().split('T')[0],
      });
      onTaskCreated?.();
    } catch (err: any) {
      console.error('[OperationalStatusSection] schedule failed:', err);
      alert('فشل إنشاء المهمة: ' + (err?.message || err));
    } finally {
      setBusy(false);
    }
  }

  async function createDisconnectionTask() {
    if (!next || next.type !== 'device_disconnection') return;
    const options = disconnectionCreationReasons.length > 0 ? disconnectionCreationReasons : FALLBACK_DISCONNECTION_CREATION_REASONS;
    const creationOption = selectedCreationOption(disconnectionCreationReason, options);
    const creationReason = creationOption?.value ?? '';
    const taskReason = creationOption?.systemReason || next.reason;
    if (!creationReason) {
      setModalError('سبب إنشاء مهمة فك الجهاز مطلوب');
      return;
    }

    setBusy(true);
    setModalError(null);
    try {
      await api.openTasks.create({
        clientId: device.customerId,
        branchId: device.branchId,
        installedDeviceId: device.id,
        taskType: 'device_disconnection',
        taskFamily: 'service',
        reason: taskReason,
        creationReason,
        contractId: device.contractId,
        deliveryAddress: device.installationAddressText || undefined,
        dueDate: new Date().toISOString().split('T')[0],
      });
      setShowDisconnectionModal(false);
      onTaskCreated?.();
    } catch (err: any) {
      console.error('[OperationalStatusSection] schedule disconnection failed:', err);
      setModalError('فشل إنشاء مهمة فك الجهاز: ' + (err?.message || err));
    } finally {
      setBusy(false);
    }
  }

  async function createActivationTask() {
    if (!activationExecutionDate) {
      setModalError('موعد التنفيذ مطلوب');
      return;
    }
    if (!activationDueDate) {
      setModalError('التاريخ المطلوب مطلوب');
      return;
    }
    if (!activationPriority) {
      setModalError('الأولوية مطلوبة');
      return;
    }
    if (!device?.installationAddressText) {
      setModalError('لا يمكن إنشاء مهمة تشغيل قبل اكتمال عنوان التركيب النهائي للجهاز');
      return;
    }

    setBusy(true);
    setModalError(null);
    try {
      await api.openTasks.create({
        clientId: device.customerId,
        branchId: device.branchId,
        installedDeviceId: device.id,
        taskType: 'device_activation',
        taskFamily: 'delivery',
        reason: 'other',
        contractId: device.contractId,
        deliveryAddress: device.installationAddressText || undefined,
        expectedDate: activationExecutionDate,
        dueDate: activationDueDate,
        priority: activationPriority,
        notes: activationNotes.trim() || null,
      });
      setShowActivationModal(false);
      onTaskCreated?.();
    } catch (err: any) {
      console.error('[OperationalStatusSection] schedule activation failed:', err);
      setModalError('فشل إنشاء مهمة التشغيل: ' + (err?.message || err));
    } finally {
      setBusy(false);
    }
  }

  async function createInstallationTask() {
    const geoUnitId = deepestGeoId(geoSelection);
    const addressText = detailedAddress.trim();
    const geoLabel = formatGeoUnitLastLevels(activeGeoUnits, geoUnitId);
    const addressLabel = [geoLabel, addressText].filter(Boolean).join('، ');
    if (!dueDate) {
      setModalError('تاريخ استحقاق مهمة التركيب مطلوب');
      return;
    }
    if (!geoUnitId || !addressText) {
      setModalError('موقع التركيب المخطط يتطلب منطقة وعنوانا تفصيليا');
      return;
    }
    if (!installationCreationReason.trim()) {
      setModalError('سبب إنشاء مهمة التركيب مطلوب');
      return;
    }

    setBusy(true);
    setModalError(null);
    try {
      await api.openTasks.create({
        clientId: device.customerId,
        branchId: device.branchId,
        installedDeviceId: device.id,
        taskType: 'device_installation',
        taskFamily: 'delivery',
        reason: 'other',
        creationReason: installationCreationReason,
        contractId: device.contractId,
        deliveryAddress: addressLabel || addressText,
        dueDate,
        installationGeoUnitId: Number(geoUnitId),
        installationAddressText: addressText,
        installationLat: mapPosition?.[0] ?? null,
        installationLng: mapPosition?.[1] ?? null,
      });
      setShowInstallationModal(false);
      onTaskCreated?.();
    } catch (err: any) {
      console.error('[OperationalStatusSection] schedule installation failed:', err);
      setModalError('فشل إنشاء مهمة التركيب: ' + (err?.message || err));
    } finally {
      setBusy(false);
    }
  }

  const disconnectionCreationOptions = next?.type === 'device_disconnection'
    ? (disconnectionCreationReasons.length > 0 ? disconnectionCreationReasons : FALLBACK_DISCONNECTION_CREATION_REASONS)
    : FALLBACK_DISCONNECTION_CREATION_REASONS;
  const selectedDisconnectionCreationReason = selectedCreationReason(disconnectionCreationReason, disconnectionCreationOptions);

  return (
    <>
      <SectionShell
        id="operational"
        title="الحالة التشغيلية"
        subtitle="حالة الجهاز الحالية وتواريخ مراحل دورة حياته"
        actions={
          next && (
            existingActiveTask ? (
              <span className="inline-flex items-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700">
                <AlertCircle className="h-3.5 w-3.5" />
                يوجد مهمة {next.label.replace('جدولة مهمة ', '')} نشطة بالفعل #{existingActiveTask.id}
              </span>
            ) : (
              <Button
                size="sm"
                icon={next.Icon}
                onClick={handleSchedule}
                loading={busy}
              >
                {next.label}
              </Button>
            )
          )
        }
      >
        <div className="grid grid-cols-2 gap-5 md:grid-cols-4">
          <div>
            <div className="mb-1 text-xs font-bold text-slate-400">الحالة</div>
            <DeviceStatusBadge status={device?.status} />
          </div>
          <div>
            <div className="mb-1 text-xs font-bold text-slate-400">تاريخ التسليم</div>
            <LifecycleValue value={device?.deliveryDate} reason="يثبت عند إغلاق مهمة التسليم بنجاح." />
          </div>
          <div>
            <div className="mb-1 text-xs font-bold text-slate-400">تاريخ التركيب</div>
            <LifecycleValue value={device?.installationDate} reason="يثبت عند إغلاق مهمة التركيب بنجاح." />
          </div>
          <div>
            <div className="mb-1 text-xs font-bold text-slate-400">تاريخ التشغيل</div>
            <LifecycleValue value={device?.activatedAt} reason="يثبت عند انتقال الجهاز إلى حالة active." />
          </div>
        </div>
      </SectionShell>

      <Modal
        isOpen={showDisconnectionModal}
        onClose={() => setShowDisconnectionModal(false)}
        size="xl"
        title={<span className="flex items-center gap-2"><Unplug className="h-5 w-5 text-sky-600" />إنشاء مهمة فك جهاز</span>}
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowDisconnectionModal(false)}>إلغاء</Button>
            <Button onClick={createDisconnectionTask} loading={busy}>إنشاء المهمة</Button>
          </>
        }
      >
        <div className="space-y-4 px-5 py-4">
          {modalError && (
            <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              <AlertCircle className="h-4 w-4" />
              {modalError}
            </div>
          )}
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
            <div className="text-xs font-bold text-slate-400">الجهاز</div>
            <div className="mt-1 text-sm font-black text-slate-800">
              {device?.deviceModelName || device?.modelName || device?.serialNumber || `جهاز #${device?.id}`}
            </div>
            <div className="mt-1 text-xs text-slate-500">الحالة الحالية: {device?.status}</div>
          </div>
          <label className="block space-y-1.5">
            <span className="text-xs font-bold text-slate-500">سبب إنشاء مهمة فك الجهاز</span>
            <Select<string>
              value={selectedDisconnectionCreationReason}
              onChange={setDisconnectionCreationReason}
              ariaLabel="سبب إنشاء مهمة فك الجهاز"
              className="w-full"
              options={disconnectionCreationOptions.map((item) => ({ value: item.value, label: item.label }))}
            />
          </label>
        </div>
      </Modal>

      <Modal
        isOpen={showInstallationModal}
        onClose={() => setShowInstallationModal(false)}
        size="2xl"
        title={<span className="flex items-center gap-2"><Wrench className="h-5 w-5 text-sky-600" />إنشاء مهمة تركيب</span>}
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowInstallationModal(false)}>إلغاء</Button>
            <Button onClick={createInstallationTask} loading={busy}>إنشاء المهمة</Button>
          </>
        }
      >
            <div className="space-y-4 px-5 py-4">
              {modalError && (
                <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                  <AlertCircle className="h-4 w-4" />
                  {modalError}
                </div>
              )}
              <label className="block space-y-1.5">
                <span className="text-xs font-bold text-slate-500">تاريخ استحقاق المهمة</span>
                <DateField value={dueDate} onChange={setDueDate} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" />
              </label>
              <label className="block space-y-1.5">
                <span className="text-xs font-bold text-slate-500">سبب إنشاء مهمة التركيب</span>
                <Select<string>
                  value={installationCreationReason}
                  onChange={setInstallationCreationReason}
                  ariaLabel="سبب إنشاء مهمة التركيب"
                  className="w-full"
                  options={installationCreationReasons.map((item) => ({ value: item.value, label: item.label }))}
                />
              </label>
              <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-3">
                <GeoSmartSearch
                  geoUnits={activeGeoUnits}
                  value={geoSelection}
                  onChange={setGeoSelection}
                  label="موقع التركيب المخطط"
                  required
                  minSelectableLevel={3}
                  placeholder="ابحث عن المحافظة، المنطقة، الناحية أو الحي"
                />
                <label className="block space-y-1.5">
                  <span className="text-xs font-bold text-slate-500">العنوان التفصيلي *</span>
                  <textarea value={detailedAddress} onChange={(e) => setDetailedAddress(e.target.value)} rows={2} className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                </label>
                <div className="space-y-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={MapPin}
                    onClick={() => setShowMap(!showMap)}
                  >
                    {showMap ? 'إخفاء الخريطة' : 'اختيار من الخريطة'}
                  </Button>
                  {mapPosition && (
                    <span className="mr-2 font-mono text-xs text-slate-500" dir="ltr">
                      {mapPosition[0].toFixed(5)}, {mapPosition[1].toFixed(5)}
                    </span>
                  )}
                  {showMap && (
                    <MapPicker
                      position={mapPosition}
                      onLocationSelect={(lat, lng) => setMapPosition(lat === 0 && lng === 0 ? null : [lat, lng])}
                    />
                  )}
                </div>
              </div>
            </div>
      </Modal>

      <Modal
        isOpen={showActivationModal}
        onClose={() => setShowActivationModal(false)}
        size="xl"
        title={<span className="flex items-center gap-2"><Zap className="h-5 w-5 text-sky-600" />إنشاء مهمة تشغيل</span>}
        footer={
          <>
            <button onClick={() => setShowActivationModal(false)} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50">
              إلغاء
            </button>
            <button onClick={createActivationTask} disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-bold text-white hover:bg-sky-500 disabled:opacity-60">
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              إنشاء المهمة
            </button>
          </>
        }
      >
            <div className="space-y-4 px-5 py-4">
              {modalError && (
                <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                  <AlertCircle className="h-4 w-4" />
                  {modalError}
                </div>
              )}
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
                <div className="text-xs font-bold text-slate-400">الجهاز المركّب</div>
                <div className="mt-1 text-sm font-black text-slate-800">
                  {device?.deviceModelName || device?.modelName || device?.serialNumber || `جهاز #${device?.id}`}
                </div>
                <div className="mt-1 text-xs text-slate-500">{device?.installationAddressText || 'عنوان التركيب غير مكتمل'}</div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="space-y-1.5">
                  <span className="text-xs font-bold text-slate-500">موعد التنفيذ</span>
                  <DateField value={activationExecutionDate} onChange={setActivationExecutionDate} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" />
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs font-bold text-slate-500">التاريخ المطلوب</span>
                  <DateField value={activationDueDate} onChange={setActivationDueDate} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" />
                </label>
              </div>
              <label className="block space-y-1.5">
                <span className="text-xs font-bold text-slate-500">الأولوية</span>
                <Select<'high' | 'medium' | 'low'>
                  value={activationPriority}
                  onChange={setActivationPriority}
                  ariaLabel="الأولوية"
                  className="w-full"
                  options={[
                    { value: 'high', label: 'عالية' },
                    { value: 'medium', label: 'متوسطة' },
                    { value: 'low', label: 'منخفضة' },
                  ]}
                />
              </label>
              <label className="block space-y-1.5">
                <span className="text-xs font-bold text-slate-500">ملاحظات</span>
                <textarea
                  value={activationNotes}
                  onChange={(e) => setActivationNotes(e.target.value)}
                  rows={3}
                  className="w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                  placeholder="تعليمات التنفيذ، تفضيلات الزبون، أو أي ملاحظة ميدانية..."
                />
              </label>
            </div>
      </Modal>
    </>
  );
}

export default OperationalStatusSection;
