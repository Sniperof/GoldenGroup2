import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CalendarClock, CheckCircle2, Clock, Loader2, MapPin, PackageX, Route, Truck, X } from 'lucide-react';
import IconButton from '../../components/ui/IconButton';
import Select from '../../components/ui/Select';
import { api } from '../../lib/api';
import GeoSmartSearch, { formatGeoUnitLastLevels, type GeoSelection } from '../../components/GeoSmartSearch';
import MapPicker from '../../components/MapPicker';

type DeliveryDecision =
  | 'delivered_successfully'
  | 'customer_not_available'
  | 'wrong_address'
  | 'refused_delivery';

type AddressDraft = {
  geoSelection: GeoSelection;
  detailedAddress: string;
  mapPosition: [number, number] | null;
  showMap: boolean;
};

const emptyGeoSelection: GeoSelection = { govId: '', regionId: '', subId: '', neighborhoodId: '' };

const DECISION_CARDS: Array<{ value: DeliveryDecision; title: string; desc: string; Icon: any; cls: string }> = [
  { value: 'delivered_successfully', title: 'تم التسليم', desc: 'الجهاز أصبح عند الزبون', Icon: CheckCircle2, cls: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  { value: 'customer_not_available', title: 'الزبون غير متوفر', desc: 'تحتاج متابعة لاحقة', Icon: Clock, cls: 'border-amber-200 bg-amber-50 text-amber-700' },
  { value: 'wrong_address', title: 'عنوان خاطئ', desc: 'تحتاج تصحيح العنوان', Icon: Route, cls: 'border-orange-200 bg-orange-50 text-orange-700' },
  { value: 'refused_delivery', title: 'رفض التسليم', desc: 'إغلاق المهمة كملغاة', Icon: PackageX, cls: 'border-rose-200 bg-rose-50 text-rose-700' },
];

function deepestGeoId(selection: GeoSelection) {
  return selection.neighborhoodId || selection.subId || selection.regionId || selection.govId || '';
}

function makeAddress(initialGeoUnitId?: number | null, detailedAddress = ''): AddressDraft {
  return {
    geoSelection: initialGeoUnitId ? { ...emptyGeoSelection, neighborhoodId: String(initialGeoUnitId) } : { ...emptyGeoSelection },
    detailedAddress,
    mapPosition: null,
    showMap: false,
  };
}

function formatAddress(geoUnits: any[], draft: AddressDraft) {
  const geoLabel = formatGeoUnitLastLevels(geoUnits, deepestGeoId(draft.geoSelection));
  return [geoLabel, draft.detailedAddress.trim()].filter(Boolean).join('، ');
}

function AddressFields({
  title,
  geoUnits,
  value,
  onChange,
  required,
}: {
  title: string;
  geoUnits: any[];
  value: AddressDraft;
  onChange: (next: AddressDraft) => void;
  required?: boolean;
}) {
  const setPatch = (patch: Partial<AddressDraft>) => onChange({ ...value, ...patch });
  return (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-3">
      <GeoSmartSearch
        geoUnits={geoUnits}
        value={value.geoSelection}
        onChange={(geoSelection) => setPatch({ geoSelection })}
        label={title}
        required={required}
        minSelectableLevel={3}
        placeholder="ابحث عن المحافظة، المنطقة، الناحية أو الحي"
      />
      <label className="block space-y-1.5">
        <span className="text-xs font-bold text-slate-500">العنوان التفصيلي{required ? ' *' : ''}</span>
        <textarea
          value={value.detailedAddress}
          onChange={(e) => setPatch({ detailedAddress: e.target.value })}
          rows={2}
          className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none"
          placeholder="رقم البناء، الطابق، أقرب نقطة دالة..."
        />
      </label>
      <div className="space-y-2">
        <button
          type="button"
          onClick={() => setPatch({ showMap: !value.showMap })}
          className="inline-flex items-center gap-1.5 rounded-lg border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-bold text-sky-700 hover:bg-sky-100"
        >
          <MapPin className="h-3.5 w-3.5" />
          {value.showMap ? 'إخفاء الخريطة' : 'اختيار من الخريطة'}
        </button>
        {value.mapPosition && (
          <span className="mr-2 text-xs font-mono text-slate-500" dir="ltr">
            {value.mapPosition[0].toFixed(5)}, {value.mapPosition[1].toFixed(5)}
          </span>
        )}
        {value.showMap && (
          <MapPicker
            position={value.mapPosition}
            onLocationSelect={(lat, lng) => {
              setPatch({ mapPosition: lat === 0 && lng === 0 ? null : [lat, lng] });
            }}
          />
        )}
      </div>
    </div>
  );
}

export default function DeviceDeliveryResultModal({
  visitId,
  taskId,
  task,
  onClose,
  onSaved,
}: {
  visitId: number;
  taskId: number;
  task: any;
  onClose: () => void;
  onSaved: () => void;
}) {
  const defaultAddress =
    task?.deliveryAddress ??
    task?.delivery_address ??
    task?.currentDeviceAddress ??
    task?.current_device_address ??
    task?.contractSnapshot?.installationAddress?.addressText ??
    task?.contract_snapshot?.installationAddress?.addressText ??
    '';
  const currentDeviceGeoUnitId = Number(task?.currentDeviceGeoUnitId ?? task?.current_device_geo_unit_id) || null;
  const isPostMaintenanceReturn = (task?.reason ?? '') === 'post_maintenance_return';

  const [decision, setDecision] = useState<DeliveryDecision>('delivered_successfully');
  const [deliveryAddress, setDeliveryAddress] = useState<AddressDraft>(() => makeAddress(currentDeviceGeoUnitId, defaultAddress));
  const [deliveryCondition, setDeliveryCondition] = useState('perfect');
  const [customerAcknowledged, setCustomerAcknowledged] = useState(true);
  const [afterDeliveryAction, setAfterDeliveryAction] = useState<'none' | 'create_installation_task'>('none');
  const [installationSameAddress, setInstallationSameAddress] = useState(true);
  const [installationAddress, setInstallationAddress] = useState<AddressDraft>(() => makeAddress(currentDeviceGeoUnitId, defaultAddress));
  const [installationRequiredDate, setInstallationRequiredDate] = useState('');
  const [expectedDate, setExpectedDate] = useState('');
  const [expectedTime, setExpectedTime] = useState('');
  const [updateDeviceMainAddress, setUpdateDeviceMainAddress] = useState(false);
  const [geoUnits, setGeoUnits] = useState<any[]>([]);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.geoUnits.list().then((rows) => setGeoUnits(Array.isArray(rows) ? rows : [])).catch(() => setGeoUnits([]));
  }, []);

  useEffect(() => {
    if (installationSameAddress) setInstallationAddress(deliveryAddress);
  }, [installationSameAddress, deliveryAddress]);

  const needsFollowUp = decision === 'customer_not_available' || decision === 'wrong_address';
  const canUpdateDeviceAddress = decision === 'delivered_successfully' && isPostMaintenanceReturn;
  const activeGeoUnits = useMemo(() => geoUnits.filter((unit) => unit?.status !== 'inactive'), [geoUnits]);

  async function submit() {
    setError(null);
    const deliveryGeoUnitId = deepestGeoId(deliveryAddress.geoSelection);
    const deliveryAddressText = deliveryAddress.detailedAddress.trim();
    const deliveryAddressLabel = formatAddress(activeGeoUnits, deliveryAddress);
    const installationDraft = installationSameAddress ? deliveryAddress : installationAddress;
    const installationGeoUnitId = deepestGeoId(installationDraft.geoSelection);
    const installationAddressText = installationDraft.detailedAddress.trim();
    const installationAddressLabel = formatAddress(activeGeoUnits, installationDraft);

    if (!deliveryGeoUnitId || !deliveryAddressText) {
      setError('عنوان التسليم الفعلي يتطلب منطقة وعنوانا تفصيليا');
      return;
    }
    if (afterDeliveryAction === 'create_installation_task' && !installationRequiredDate) {
      setError('تاريخ التركيب مطلوب عند إنشاء مهمة تركيب');
      return;
    }
    if (afterDeliveryAction === 'create_installation_task' && (!installationGeoUnitId || !installationAddressText)) {
      setError('عنوان التركيب يتطلب منطقة وعنوانا تفصيليا');
      return;
    }
    if (needsFollowUp && !expectedDate) {
      setError('موعد المتابعة مطلوب');
      return;
    }

    setSaving(true);
    try {
      await api.fieldVisits.recordTaskResult(visitId, taskId, {
        final_decision: decision,
        delivery_address: deliveryAddressLabel,
        delivery_geo_unit_id: Number(deliveryGeoUnitId),
        delivery_address_text: deliveryAddressText,
        delivery_lat: deliveryAddress.mapPosition?.[0] ?? null,
        delivery_lng: deliveryAddress.mapPosition?.[1] ?? null,
        delivery_condition: decision === 'delivered_successfully' ? deliveryCondition : null,
        customer_acknowledged: decision === 'delivered_successfully' ? customerAcknowledged : false,
        notes: notes.trim() || null,
        closing_notes: notes.trim() || null,
        after_delivery_action: decision === 'delivered_successfully' ? afterDeliveryAction : 'none',
        installation_address_same_as_delivery:
          afterDeliveryAction === 'create_installation_task' ? installationSameAddress : null,
        installation_address:
          afterDeliveryAction === 'create_installation_task' ? installationAddressLabel : null,
        installation_geo_unit_id:
          afterDeliveryAction === 'create_installation_task' ? Number(installationGeoUnitId) : null,
        installation_address_text:
          afterDeliveryAction === 'create_installation_task' ? installationAddressText : null,
        installation_lat:
          afterDeliveryAction === 'create_installation_task' ? installationDraft.mapPosition?.[0] ?? null : null,
        installation_lng:
          afterDeliveryAction === 'create_installation_task' ? installationDraft.mapPosition?.[1] ?? null : null,
        installation_required_date:
          afterDeliveryAction === 'create_installation_task' ? installationRequiredDate : null,
        expected_date: needsFollowUp ? expectedDate : null,
        expected_time: needsFollowUp && expectedTime ? expectedTime : null,
        update_device_main_address: canUpdateDeviceAddress ? updateDeviceMainAddress : false,
        new_installation_geo_unit_id:
          canUpdateDeviceAddress && updateDeviceMainAddress ? Number(deliveryGeoUnitId) : null,
        new_installation_address_text:
          canUpdateDeviceAddress && updateDeviceMainAddress ? deliveryAddressText : null,
        new_installation_lat:
          canUpdateDeviceAddress && updateDeviceMainAddress ? deliveryAddress.mapPosition?.[0] ?? null : null,
        new_installation_lng:
          canUpdateDeviceAddress && updateDeviceMainAddress ? deliveryAddress.mapPosition?.[1] ?? null : null,
      });
      onSaved();
    } catch (err: any) {
      setError(err?.message ?? 'فشل حفظ نتيجة التسليم');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" dir="rtl">
      <div className="w-full max-w-3xl rounded-xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-2">
            <Truck className="h-5 w-5 text-sky-600" />
            <h2 className="text-lg font-bold text-slate-800">تسجيل نتيجة تسليم الجهاز</h2>
          </div>
          <IconButton icon={X} label="إغلاق" onClick={onClose} />
        </div>

        <div className="max-h-[75vh] space-y-4 overflow-y-auto px-5 py-4">
          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              <AlertCircle className="h-4 w-4" />
              {error}
            </div>
          )}

          <div className="grid gap-3 md:grid-cols-4">
            {DECISION_CARDS.map(({ value, title, desc, Icon, cls }) => {
              const selected = decision === value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setDecision(value)}
                  className={`min-h-[108px] rounded-lg border p-3 text-right transition ${
                    selected ? `${cls} shadow-sm ring-2 ring-offset-1 ring-current/20` : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <Icon className="mb-2 h-5 w-5" />
                  <div className="text-sm font-black">{title}</div>
                  <div className="mt-1 text-xs opacity-80">{desc}</div>
                </button>
              );
            })}
          </div>

          <AddressFields
            title="عنوان التسليم الفعلي"
            geoUnits={activeGeoUnits}
            value={deliveryAddress}
            onChange={setDeliveryAddress}
            required
          />

          {needsFollowUp && (
            <div className="grid gap-4 rounded-lg border border-amber-200 bg-amber-50/60 p-4 md:grid-cols-2">
              <label className="space-y-1.5">
                <span className="text-xs font-bold text-slate-500">تاريخ المتابعة القادم</span>
                <input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" />
              </label>
              <label className="space-y-1.5">
                <span className="text-xs font-bold text-slate-500">وقت المتابعة القادم</span>
                <input type="time" value={expectedTime} onChange={(e) => setExpectedTime(e.target.value)} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" />
              </label>
            </div>
          )}

          {decision === 'delivered_successfully' && (
            <div className="grid gap-4 rounded-lg border border-slate-200 bg-slate-50 p-4 md:grid-cols-2">
              <label className="space-y-1.5">
                <span className="text-xs font-bold text-slate-500">حالة الجهاز عند التسليم</span>
                <Select
                  value={deliveryCondition}
                  onChange={v => setDeliveryCondition(v)}
                  className="w-full"
                  options={[
                    { value: 'perfect', label: 'سليم' },
                    { value: 'minor_damage', label: 'ضرر بسيط' },
                    { value: 'missing_accessories', label: 'نقص ملحقات' },
                  ]}
                />
              </label>
              <label className="flex items-center gap-2 pt-6 text-sm font-semibold text-slate-700">
                <input type="checkbox" checked={customerAcknowledged} onChange={(e) => setCustomerAcknowledged(e.target.checked)} />
                إقرار الزبون بالاستلام
              </label>
            </div>
          )}

          {decision === 'delivered_successfully' && (
            <div className="space-y-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center gap-2">
                <CalendarClock className="h-4 w-4 text-slate-500" />
                <span className="text-xs font-bold text-slate-500">الإجراء بعد التسليم</span>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setAfterDeliveryAction('none')}
                  className={`rounded-lg border px-3 py-3 text-right text-sm font-bold ${afterDeliveryAction === 'none' ? 'border-slate-400 bg-white text-slate-800' : 'border-slate-200 bg-white text-slate-500'}`}
                >
                  لا شيء
                </button>
                <button
                  type="button"
                  onClick={() => setAfterDeliveryAction('create_installation_task')}
                  className={`rounded-lg border px-3 py-3 text-right text-sm font-bold ${afterDeliveryAction === 'create_installation_task' ? 'border-sky-300 bg-sky-50 text-sky-800' : 'border-slate-200 bg-white text-slate-500'}`}
                >
                  إنشاء مهمة تركيب
                </button>
              </div>

              {afterDeliveryAction === 'create_installation_task' && (
                <div className="space-y-4">
                  <label className="block space-y-1.5">
                    <span className="text-xs font-bold text-slate-500">تاريخ التركيب المطلوب</span>
                    <input type="date" value={installationRequiredDate} onChange={(e) => setInstallationRequiredDate(e.target.value)} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" />
                  </label>
                  <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                    <input type="checkbox" checked={installationSameAddress} onChange={(e) => setInstallationSameAddress(e.target.checked)} />
                    عنوان التركيب هو عنوان التسليم
                  </label>
                  {!installationSameAddress && (
                    <AddressFields
                      title="عنوان التركيب"
                      geoUnits={activeGeoUnits}
                      value={installationAddress}
                      onChange={setInstallationAddress}
                      required
                    />
                  )}
                </div>
              )}
            </div>
          )}

          {canUpdateDeviceAddress && (
            <label className="flex items-center gap-2 rounded-lg border border-sky-200 bg-sky-50/60 p-4 text-sm font-semibold text-slate-700">
              <input type="checkbox" checked={updateDeviceMainAddress} onChange={(e) => setUpdateDeviceMainAddress(e.target.checked)} />
              اعتماد عنوان التسليم الحالي كعنوان رئيسي جديد للجهاز
            </label>
          )}

          <label className="block space-y-1.5">
            <span className="text-xs font-bold text-slate-500">ملاحظات</span>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm" />
          </label>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4">
          <button onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50">
            إلغاء
          </button>
          <button onClick={submit} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-bold text-white hover:bg-sky-500 disabled:opacity-60">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            حفظ النتيجة
          </button>
        </div>
      </div>
    </div>
  );
}
