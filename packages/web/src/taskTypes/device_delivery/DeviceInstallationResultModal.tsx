import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, Clock, Loader2, MapPin, Plus, Trash2, Wrench, X, XCircle, Zap } from 'lucide-react';
import { api } from '../../lib/api';
import GeoSmartSearch, { formatGeoUnitLastLevels, type GeoSelection } from '../../components/GeoSmartSearch';
import MapPicker from '../../components/MapPicker';

type InstallationDecision = 'installed_successfully' | 'installation_incomplete' | 'refused_installation';

type AddressDraft = {
  geoSelection: GeoSelection;
  detailedAddress: string;
  mapPosition: [number, number] | null;
  showMap: boolean;
};

type InstallationPartDraft = {
  source: 'customer_stock' | 'company_stock' | 'external_or_manual';
  placement_state: 'installed' | 'customer_stock';
  spare_part_id: string;
  part_name: string;
  part_code: string;
  maintenance_type: string;
  quantity: string;
  unit_price: string;
  customer_stock_id: string;
  customer_stock_origin: string;
  notes: string;
};

const emptyGeoSelection: GeoSelection = { govId: '', regionId: '', subId: '', neighborhoodId: '' };

const DECISION_CARDS: Array<{ value: InstallationDecision; title: string; desc: string; Icon: any; cls: string }> = [
  { value: 'installed_successfully', title: 'تم التركيب', desc: 'تثبيت الموقع وإنشاء مهمة تشغيل', Icon: CheckCircle2, cls: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  { value: 'installation_incomplete', title: 'لم يكتمل', desc: 'تبقى المهمة للمتابعة بتاريخ جديد', Icon: Clock, cls: 'border-amber-200 bg-amber-50 text-amber-700' },
  { value: 'refused_installation', title: 'رفض التركيب', desc: 'إلغاء المهمة دون تغيير حالة الجهاز', Icon: XCircle, cls: 'border-rose-200 bg-rose-50 text-rose-700' },
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
  geoUnits,
  value,
  onChange,
}: {
  geoUnits: any[];
  value: AddressDraft;
  onChange: (next: AddressDraft) => void;
}) {
  const setPatch = (patch: Partial<AddressDraft>) => onChange({ ...value, ...patch });
  return (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-3">
      <GeoSmartSearch
        geoUnits={geoUnits}
        value={value.geoSelection}
        onChange={(geoSelection) => setPatch({ geoSelection })}
        label="موقع التركيب النهائي"
        required
        minSelectableLevel={3}
        placeholder="ابحث عن المحافظة، المنطقة، الناحية أو الحي"
      />
      <label className="block space-y-1.5">
        <span className="text-xs font-bold text-slate-500">العنوان التفصيلي *</span>
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

function emptyPart(): InstallationPartDraft {
  return {
    source: 'company_stock',
    placement_state: 'installed',
    spare_part_id: '',
    part_name: '',
    part_code: '',
    maintenance_type: '',
    quantity: '1',
    unit_price: '0',
    customer_stock_id: '',
    customer_stock_origin: '',
    notes: '',
  };
}

export default function DeviceInstallationResultModal({
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
  const currentGeoUnitId = Number(task?.currentDeviceGeoUnitId ?? task?.current_device_geo_unit_id) || null;
  const currentAddressText =
    task?.currentDeviceAddress ??
    task?.current_device_address ??
    task?.deliveryAddress ??
    task?.delivery_address ??
    task?.contractSnapshot?.installationAddress?.addressText ??
    '';

  const [decision, setDecision] = useState<InstallationDecision>('installed_successfully');
  const [finalAddress, setFinalAddress] = useState<AddressDraft>(() => makeAddress(currentGeoUnitId, currentAddressText));
  const [activationDueDate, setActivationDueDate] = useState('');
  const [expectedDate, setExpectedDate] = useState('');
  const [incompleteReasonId, setIncompleteReasonId] = useState('');
  const [refusalReasonId, setRefusalReasonId] = useState('');
  const [customerAcknowledged, setCustomerAcknowledged] = useState(true);
  const [receiverName, setReceiverName] = useState('');
  const [receiverSignature, setReceiverSignature] = useState('');
  const [notes, setNotes] = useState('');
  const [geoUnits, setGeoUnits] = useState<any[]>([]);
  const [incompleteReasons, setIncompleteReasons] = useState<any[]>([]);
  const [refusalReasons, setRefusalReasons] = useState<any[]>([]);
  const [spareParts, setSpareParts] = useState<any[]>([]);
  const [customerStock, setCustomerStock] = useState<any[]>([]);
  const [parts, setParts] = useState<InstallationPartDraft[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.geoUnits.list().then((rows) => setGeoUnits(Array.isArray(rows) ? rows : [])).catch(() => setGeoUnits([]));
    api.systemLists.getItemsByCode('installation_incomplete_reason').then(setIncompleteReasons).catch(() => setIncompleteReasons([]));
    api.systemLists.getItemsByCode('installation_refusal_reason').then(setRefusalReasons).catch(() => setRefusalReasons([]));
    api.spareParts.list().then((rows) => setSpareParts(Array.isArray(rows) ? rows : [])).catch(() => setSpareParts([]));
    const customerId = Number(task?.client_id ?? task?.clientId);
    if (customerId) {
      api.customers.getPartsStock(customerId)
        .then((result: any) => setCustomerStock(Array.isArray(result?.records) ? result.records : []))
        .catch(() => setCustomerStock([]));
    }
  }, [task]);

  const activeGeoUnits = useMemo(() => geoUnits.filter((unit) => unit?.status !== 'inactive'), [geoUnits]);

  async function submit() {
    setError(null);
    const finalGeoUnitId = deepestGeoId(finalAddress.geoSelection);
    const finalAddressText = finalAddress.detailedAddress.trim();

    if (decision === 'installed_successfully') {
      if (!finalGeoUnitId || !finalAddressText) {
        setError('موقع التركيب النهائي يتطلب منطقة وعنوانا تفصيليا');
        return;
      }
      if (!activationDueDate) {
        setError('تاريخ متابعة التشغيل مطلوب بعد نجاح التركيب');
        return;
      }
      if (!customerAcknowledged || !receiverName.trim() || !receiverSignature.trim()) {
        setError('إقرار الزبون واسم المستلم وتوقيعه مطلوبة عند نجاح التركيب');
        return;
      }
    }
    if (decision === 'installation_incomplete' && (!incompleteReasonId || !expectedDate)) {
      setError('سبب عدم الاكتمال وتاريخ المتابعة مطلوبان');
      return;
    }
    if (decision === 'refused_installation' && !refusalReasonId) {
      setError('سبب رفض التركيب مطلوب');
      return;
    }

    setSaving(true);
    try {
      await api.fieldVisits.recordTaskResult(visitId, taskId, {
        final_decision: decision,
        closing_notes: notes.trim() || null,
        notes: notes.trim() || null,
        installation_incomplete_reason_id: decision === 'installation_incomplete' ? Number(incompleteReasonId) : null,
        installation_refusal_reason_id: decision === 'refused_installation' ? Number(refusalReasonId) : null,
        expected_date: decision === 'installation_incomplete' ? expectedDate : null,
        activation_due_date: decision === 'installed_successfully' ? activationDueDate : null,
        final_installation_geo_unit_id: decision === 'installed_successfully' ? Number(finalGeoUnitId) : null,
        final_installation_address_text: decision === 'installed_successfully' ? finalAddressText : null,
        final_installation_address: decision === 'installed_successfully' ? formatAddress(activeGeoUnits, finalAddress) : null,
        final_installation_lat: decision === 'installed_successfully' ? finalAddress.mapPosition?.[0] ?? null : null,
        final_installation_lng: decision === 'installed_successfully' ? finalAddress.mapPosition?.[1] ?? null : null,
        customer_acknowledged: decision === 'installed_successfully' ? customerAcknowledged : null,
        receiver_name: decision === 'installed_successfully' ? receiverName.trim() : null,
        receiver_signature: decision === 'installed_successfully' ? receiverSignature.trim() : null,
        parts: decision === 'installed_successfully'
          ? parts.map((part) => ({
              source: part.source,
              placement_state: part.placement_state,
              spare_part_id: part.spare_part_id ? Number(part.spare_part_id) : null,
              part_name: part.part_name.trim() || null,
              part_code: part.part_code.trim() || null,
              maintenance_type: part.maintenance_type || null,
              quantity: Number(part.quantity) || 1,
              unit_price: part.source === 'customer_stock' ? 0 : Number(part.unit_price) || 0,
              customer_stock_origin: part.customer_stock_origin.trim() || null,
              notes: part.notes.trim() || null,
            }))
          : [],
      });
      onSaved();
    } catch (err: any) {
      setError(err?.message ?? 'فشل حفظ نتيجة التركيب');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" dir="rtl">
      <div className="w-full max-w-3xl rounded-xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-2">
            <Wrench className="h-5 w-5 text-sky-600" />
            <h2 className="text-base font-black text-slate-900">تسجيل نتيجة تركيب الجهاز</h2>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="max-h-[75vh] space-y-4 overflow-y-auto px-5 py-4">
          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              <AlertCircle className="h-4 w-4" />
              {error}
            </div>
          )}

          <div className="grid gap-3 md:grid-cols-3">
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

          {decision === 'installed_successfully' && (
            <>
              <AddressFields geoUnits={activeGeoUnits} value={finalAddress} onChange={setFinalAddress} />
              <div className="grid gap-4 rounded-lg border border-slate-200 bg-slate-50 p-4 md:grid-cols-2">
                <label className="space-y-1.5">
                  <span className="flex items-center gap-1 text-xs font-bold text-slate-500">
                    <Zap className="h-3.5 w-3.5" />
                    تاريخ متابعة التشغيل
                  </span>
                  <input type="date" value={activationDueDate} onChange={(e) => setActivationDueDate(e.target.value)} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" />
                </label>
                <label className="flex items-center gap-2 pt-6 text-sm font-semibold text-slate-700">
                  <input type="checkbox" checked={customerAcknowledged} onChange={(e) => setCustomerAcknowledged(e.target.checked)} />
                  إقرار الزبون بإتمام التركيب
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs font-bold text-slate-500">اسم المستلم *</span>
                  <input value={receiverName} onChange={(e) => setReceiverName(e.target.value)} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" />
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs font-bold text-slate-500">توقيع المستلم *</span>
                  <input value={receiverSignature} onChange={(e) => setReceiverSignature(e.target.value)} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" />
                </label>
              </div>
              <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-black text-slate-800">قطع التركيب</div>
                    <div className="text-xs text-slate-400">اختيارية، وتظهر ضمن نتيجة التركيب والفاتورة اللاحقة</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setParts((prev) => [...prev, emptyPart()])}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-bold text-sky-700 hover:bg-sky-100"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    إضافة قطعة
                  </button>
                </div>
                {parts.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-slate-200 px-3 py-4 text-center text-xs font-semibold text-slate-400">
                    لا توجد قطع مسجلة
                  </div>
                ) : (
                  <div className="space-y-3">
                    {parts.map((part, index) => {
                      const updatePart = (patch: Partial<InstallationPartDraft>) => {
                        setParts((prev) => prev.map((item, i) => i === index ? { ...item, ...patch } : item));
                      };
                      return (
                        <div key={index} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                          <div className="mb-3 flex items-center justify-between">
                            <span className="text-xs font-black text-slate-500">قطعة #{index + 1}</span>
                            <button
                              type="button"
                              onClick={() => setParts((prev) => prev.filter((_, i) => i !== index))}
                              className="rounded-lg p-1 text-rose-500 hover:bg-rose-50"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                          <div className="grid gap-3 md:grid-cols-3">
                            <label className="space-y-1.5">
                              <span className="text-xs font-bold text-slate-500">المصدر</span>
                              <select value={part.source} onChange={(e) => updatePart({ source: e.target.value as InstallationPartDraft['source'], unit_price: e.target.value === 'customer_stock' ? '0' : part.unit_price })} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                                <option value="company_stock">مخزون الشركة</option>
                                <option value="customer_stock">مخزون الزبون</option>
                                <option value="external_or_manual">إدخال يدوي</option>
                              </select>
                            </label>
                            <label className="space-y-1.5">
                              <span className="text-xs font-bold text-slate-500">الحالة</span>
                              <select value={part.placement_state} onChange={(e) => updatePart({ placement_state: e.target.value as InstallationPartDraft['placement_state'] })} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                                <option value="installed">مركبة</option>
                                <option value="customer_stock">مسلمة للمخزون</option>
                              </select>
                            </label>
                            <label className="space-y-1.5">
                              <span className="text-xs font-bold text-slate-500">نوع القطعة</span>
                              <select value={part.maintenance_type} onChange={(e) => updatePart({ maintenance_type: e.target.value })} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                                <option value="">اختر النوع</option>
                                <option value="Periodic">قطع الصيانة الدورية</option>
                                <option value="Emergency">قطع الصيانة الطارئة</option>
                                <option value="Accessory">إكسسوارات</option>
                              </select>
                            </label>
                          </div>
                          <div className="mt-3 grid gap-3 md:grid-cols-3">
                            {part.source === 'customer_stock' ? (
                              <label className="space-y-1.5 md:col-span-2">
                                <span className="text-xs font-bold text-slate-500">قطعة من مخزون الزبون</span>
                                <select
                              value={part.customer_stock_id}
                                  onChange={(e) => {
                                    const selected = customerStock.find((stock) => String(stock.stockId) === e.target.value);
                                    updatePart({
                                      spare_part_id: selected?.itemId ? String(selected.itemId) : '',
                                      customer_stock_id: e.target.value,
                                      part_name: selected?.itemName ?? '',
                                      part_code: selected?.itemCode ?? '',
                                      maintenance_type:
                                        selected?.itemType === 'periodic_part' ? 'Periodic'
                                          : selected?.itemType === 'emergency_part' ? 'Emergency'
                                            : 'Accessory',
                                      unit_price: '0',
                                      customer_stock_origin: Array.isArray(selected?.sources)
                                        ? selected.sources.map((source: any) => source.sourceLabel).filter(Boolean).join('، ')
                                        : '',
                                    });
                                  }}
                                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                                >
                                  <option value="">اختر من مخزون الزبون</option>
                                  {customerStock.map((stock) => (
                                    <option key={stock.stockId} value={stock.stockId}>
                                      {stock.itemName} - المتوفر {stock.quantityAvailable}
                                    </option>
                                  ))}
                                </select>
                              </label>
                            ) : part.source === 'company_stock' ? (
                              <label className="space-y-1.5 md:col-span-2">
                                <span className="text-xs font-bold text-slate-500">القطعة</span>
                                <select
                                  value={part.spare_part_id}
                                  onChange={(e) => {
                                    const selected = spareParts.find((sp) => String(sp.id) === e.target.value);
                                    updatePart({
                                      spare_part_id: e.target.value,
                                      part_name: selected?.name ?? '',
                                      part_code: selected?.code ?? '',
                                      maintenance_type: selected?.maintenanceType ?? part.maintenance_type,
                                      unit_price: selected?.basePrice != null ? String(selected.basePrice) : part.unit_price,
                                    });
                                  }}
                                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                                >
                                  <option value="">اختر قطعة</option>
                                  {spareParts.map((sp) => <option key={sp.id} value={sp.id}>{sp.name}</option>)}
                                </select>
                              </label>
                            ) : (
                              <label className="space-y-1.5 md:col-span-2">
                                <span className="text-xs font-bold text-slate-500">اسم القطعة</span>
                                <input value={part.part_name} onChange={(e) => updatePart({ part_name: e.target.value })} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" />
                              </label>
                            )}
                            <label className="space-y-1.5">
                              <span className="text-xs font-bold text-slate-500">الكمية</span>
                              <input type="number" min="1" value={part.quantity} onChange={(e) => updatePart({ quantity: e.target.value })} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" />
                            </label>
                          </div>
                          <div className="mt-3 grid gap-3 md:grid-cols-3">
                            <label className="space-y-1.5">
                              <span className="text-xs font-bold text-slate-500">السعر</span>
                              <input type="number" min="0" value={part.unit_price} disabled={part.source === 'customer_stock'} onChange={(e) => updatePart({ unit_price: e.target.value })} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm disabled:bg-slate-100" />
                            </label>
                            {part.source === 'customer_stock' && (
                              <label className="space-y-1.5 md:col-span-2">
                                <span className="text-xs font-bold text-slate-500">أصل القطعة للقراءة فقط</span>
                                <input value={part.customer_stock_origin || 'غير محدد'} readOnly className="w-full rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 text-sm text-slate-500" />
                              </label>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}

          {decision === 'installation_incomplete' && (
            <div className="grid gap-4 rounded-lg border border-amber-200 bg-amber-50/60 p-4 md:grid-cols-2">
              <label className="space-y-1.5">
                <span className="text-xs font-bold text-slate-500">سبب عدم الاكتمال</span>
                <select value={incompleteReasonId} onChange={(e) => setIncompleteReasonId(e.target.value)} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                  <option value="">اختر السبب</option>
                  {incompleteReasons.map((reason) => <option key={reason.id} value={reason.id}>{reason.value}</option>)}
                </select>
              </label>
              <label className="space-y-1.5">
                <span className="text-xs font-bold text-slate-500">تاريخ المتابعة</span>
                <input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" />
              </label>
            </div>
          )}

          {decision === 'refused_installation' && (
            <div className="rounded-lg border border-rose-200 bg-rose-50/60 p-4">
              <label className="space-y-1.5">
                <span className="text-xs font-bold text-slate-500">سبب الرفض</span>
                <select value={refusalReasonId} onChange={(e) => setRefusalReasonId(e.target.value)} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                  <option value="">اختر السبب</option>
                  {refusalReasons.map((reason) => <option key={reason.id} value={reason.id}>{reason.value}</option>)}
                </select>
              </label>
            </div>
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
