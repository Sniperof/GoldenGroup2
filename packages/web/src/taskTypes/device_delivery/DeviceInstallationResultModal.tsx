import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, Clock, Loader2, MapPin, Plus, Trash2, Wrench, X, XCircle, Zap } from 'lucide-react';
import IconButton from '../../components/ui/IconButton';
import { api } from '../../lib/api';
import GeoSmartSearch, { formatGeoUnitLastLevels, type GeoSelection } from '../../components/GeoSmartSearch';
import MapPicker from '../../components/MapPicker';
import PaymentEntriesList, { newEntry, type PaymentEntry } from '../../components/emergency/PaymentEntriesList';

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

const PART_TYPE_LABELS: Record<string, string> = {
  Periodic: 'قطع الصيانة الدورية',
  Emergency: 'قطع الصيانة الطارئة',
  Accessory: 'إكسسوارات',
};

const STOCK_ITEM_TYPE_BY_MAINTENANCE_TYPE: Record<string, string[]> = {
  Periodic: ['periodic_part'],
  Emergency: ['emergency_part'],
  Accessory: ['accessory', 'accessory_part'],
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

function paymentEntrySyp(entry: PaymentEntry): number {
  const amount = Number(entry.amountValue) || 0;
  if (entry.method === 'barter') return amount;
  return entry.currency === 'usd' ? amount * (Number(entry.exchangeRate) || 0) : amount;
}

function formatSyp(value: number): string {
  return `${Math.round(value).toLocaleString('ar-SY')} ل.س`;
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
  const [paymentType, setPaymentType] = useState<'cash' | 'installment' | ''>('cash');
  const [paymentEntries, setPaymentEntries] = useState<PaymentEntry[]>([newEntry()]);
  const [invoiceNotes, setInvoiceNotes] = useState('');
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
  const billableParts = useMemo(
    () => parts.filter((part) => part.source !== 'customer_stock' && (Number(part.unit_price) || 0) > 0),
    [parts],
  );
  const partsTotal = useMemo(
    () => billableParts.reduce((sum, part) => sum + (Number(part.unit_price) || 0) * (Number(part.quantity) || 1), 0),
    [billableParts],
  );
  const totalPaidSyp = useMemo(
    () => paymentEntries.reduce((sum, entry) => sum + paymentEntrySyp(entry), 0),
    [paymentEntries],
  );
  const paymentGap = totalPaidSyp - partsTotal;

  function printReceipt() {
    const rows = parts.map((part) => {
      const qty = Number(part.quantity) || 1;
      const unit = part.source === 'customer_stock' ? 0 : Number(part.unit_price) || 0;
      const total = unit * qty;
      const sourceLabel = part.source === 'customer_stock' ? 'مدفوعة مسبقا / مخزون الزبون'
        : part.source === 'company_stock' ? 'مخزون الشركة' : 'إدخال يدوي';
      const placementLabel = part.placement_state === 'installed' ? 'مركبة' : 'مسلمة للمخزون';
      return `<tr><td>${part.part_name || '-'}</td><td>${PART_TYPE_LABELS[part.maintenance_type] || '-'}</td><td>${sourceLabel}</td><td>${placementLabel}</td><td>${qty}</td><td>${formatSyp(unit)}</td><td>${formatSyp(total)}</td></tr>`;
    }).join('');
    const paymentRows = paymentEntries
      .filter((entry) => entry.method && Number(entry.amountValue) > 0)
      .map((entry, index) => {
        const method = entry.method === 'hand' ? 'يد'
          : entry.method === 'transfer' ? 'حوالة'
            : entry.method === 'barter' ? 'مقايضة' : '-';
        const detail = entry.method === 'barter'
          ? entry.barterDescription || '-'
          : entry.currency === 'usd'
            ? `${entry.amountValue} $ × ${entry.exchangeRate || '-'}`
            : `${entry.amountValue} ل.س`;
        return `<tr><td>الدفعة ${index + 1}</td><td>${method}</td><td>${detail}</td><td>${formatSyp(paymentEntrySyp(entry))}</td></tr>`;
      }).join('');
    const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>وصل تركيب جهاز</title><style>
      body{font-family:Arial,Tahoma,sans-serif;margin:28px;color:#0f172a} h1{font-size:22px;margin:0 0 6px} .muted{color:#64748b;font-size:12px}
      .box{border:1px solid #e2e8f0;border-radius:10px;padding:12px;margin-top:14px} table{width:100%;border-collapse:collapse;margin-top:8px;font-size:12px}
      th,td{border:1px solid #e2e8f0;padding:8px;text-align:right} th{background:#f8fafc;color:#475569}.total{font-weight:800;font-size:15px}
      .sign{display:flex;gap:36px;margin-top:28px}.sign div{flex:1;border-top:1px solid #cbd5e1;padding-top:8px;color:#475569}
      @media print{button{display:none}}
    </style></head><body>
      <button onclick="window.print()">طباعة</button>
      <h1>وصل تركيب جهاز</h1>
      <div class="muted">المهمة #${taskId} · ${new Date().toLocaleString('ar-SY')}</div>
      <div class="box"><strong>الزبون:</strong> ${task?.clientName || task?.client_name || '-'}<br><strong>العقد/الجهاز:</strong> ${task?.contractNumber || task?.contract_number || '-'} ${task?.deviceModelName || task?.device_model_name || ''}</div>
      <div class="box"><strong>القطع</strong><table><thead><tr><th>القطعة</th><th>النوع</th><th>المصدر</th><th>المصير</th><th>الكمية</th><th>السعر</th><th>الإجمالي</th></tr></thead><tbody>${rows || '<tr><td colspan="7">لا توجد قطع</td></tr>'}</tbody></table></div>
      <div class="box"><strong>الدفع</strong><table><thead><tr><th>البند</th><th>الطريقة</th><th>التفاصيل</th><th>القيمة</th></tr></thead><tbody>${paymentRows || '<tr><td colspan="4">لا توجد دفعات مسجلة</td></tr>'}</tbody></table></div>
      <div class="box total">الإجمالي: ${formatSyp(partsTotal)}<br>المدفوع: ${formatSyp(totalPaidSyp)}<br>المتبقي: ${formatSyp(Math.max(0, partsTotal - totalPaidSyp))}</div>
      ${invoiceNotes ? `<div class="box"><strong>ملاحظات الفاتورة:</strong><br>${invoiceNotes}</div>` : ''}
      <div class="sign"><div>توقيع المستلم</div><div>توقيع الفني</div></div>
    </body></html>`;
    const receiptWindow = window.open('', '_blank');
    if (!receiptWindow) {
      setError('تعذر فتح نافذة الوصل. تحقق من إعدادات المتصفح.');
      return;
    }
    receiptWindow.document.write(html);
    receiptWindow.document.close();
    receiptWindow.focus();
  }

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
        installation_payment: decision === 'installed_successfully' ? {
          payment_type: paymentType || null,
          invoice_notes: invoiceNotes.trim() || null,
          total_parts_amount: partsTotal,
          total_paid_syp: totalPaidSyp,
          payment_entries: paymentEntries
            .filter((entry) => entry.method && Number(entry.amountValue) > 0)
            .map((entry) => ({
              method: entry.method,
              amount_value: Number(entry.amountValue) || 0,
              currency: entry.currency,
              exchange_rate: entry.exchangeRate ? Number(entry.exchangeRate) : null,
              transfer_company_id: entry.transferCompanyId ? Number(entry.transferCompanyId) : null,
              barter_description: entry.barterDescription || null,
              amount_syp: paymentEntrySyp(entry),
            })),
        } : null,
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
          <IconButton icon={X} label="إغلاق" onClick={onClose} />
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
                      const filteredSpareParts = part.maintenance_type
                        ? spareParts.filter((sp) => sp.maintenanceType === part.maintenance_type)
                        : [];
                      const allowedCustomerItemTypes = part.maintenance_type
                        ? STOCK_ITEM_TYPE_BY_MAINTENANCE_TYPE[part.maintenance_type] ?? []
                        : [];
                      const filteredCustomerStock = part.maintenance_type
                        ? customerStock.filter((stock) => allowedCustomerItemTypes.includes(stock.itemType))
                        : [];
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
                              <select
                                value={part.source}
                                onChange={(e) => updatePart({
                                  source: e.target.value as InstallationPartDraft['source'],
                                  spare_part_id: '',
                                  customer_stock_id: '',
                                  part_name: '',
                                  part_code: '',
                                  unit_price: e.target.value === 'customer_stock' ? '0' : part.unit_price,
                                  customer_stock_origin: '',
                                })}
                                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                              >
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
                              <select
                                value={part.maintenance_type}
                                onChange={(e) => updatePart({
                                  maintenance_type: e.target.value,
                                  spare_part_id: '',
                                  customer_stock_id: '',
                                  part_name: '',
                                  part_code: '',
                                  unit_price: part.source === 'customer_stock' ? '0' : part.unit_price,
                                  customer_stock_origin: '',
                                })}
                                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                              >
                                <option value="">اختر النوع</option>
                                <option value="Periodic">{PART_TYPE_LABELS.Periodic}</option>
                                <option value="Emergency">{PART_TYPE_LABELS.Emergency}</option>
                                <option value="Accessory">{PART_TYPE_LABELS.Accessory}</option>
                              </select>
                            </label>
                          </div>
                          <div className="mt-3 grid gap-3 md:grid-cols-3">
                            {part.source === 'customer_stock' ? (
                              <label className="space-y-1.5 md:col-span-2">
                                <span className="text-xs font-bold text-slate-500">قطعة من مخزون الزبون</span>
                                <select
                                  value={part.customer_stock_id}
                                  disabled={!part.maintenance_type}
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
                                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm disabled:bg-slate-100 disabled:text-slate-400"
                                >
                                  <option value="">{part.maintenance_type ? `اختر من ${PART_TYPE_LABELS[part.maintenance_type]}` : 'اختر نوع القطعة أولاً'}</option>
                                  {filteredCustomerStock.map((stock) => (
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
                                  disabled={!part.maintenance_type}
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
                                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm disabled:bg-slate-100 disabled:text-slate-400"
                                >
                                  <option value="">{part.maintenance_type ? `اختر من ${PART_TYPE_LABELS[part.maintenance_type]}` : 'اختر نوع القطعة أولاً'}</option>
                                  {filteredSpareParts.map((sp) => <option key={sp.id} value={sp.id}>{sp.name}</option>)}
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

              <div className="space-y-4 rounded-lg border border-emerald-200 bg-emerald-50/40 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-black text-slate-800">الدفع والوصل</div>
                    <div className="text-xs text-slate-500">خاص بالقطع المباعة أثناء التركيب. قطع مخزون الزبون تظهر بقيمة معدومة لأنها مدفوعة مسبقا.</div>
                  </div>
                  <button
                    type="button"
                    onClick={printReceipt}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-white px-3 py-1.5 text-xs font-bold text-emerald-700 hover:bg-emerald-50"
                  >
                    طباعة وصل
                  </button>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <label className="space-y-1.5">
                    <span className="text-xs font-bold text-slate-500">نوع الدفع</span>
                    <select
                      value={paymentType}
                      onChange={(e) => setPaymentType(e.target.value as 'cash' | 'installment' | '')}
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                    >
                      <option value="">غير محدد</option>
                      <option value="cash">كاش</option>
                      <option value="installment">تقسيط</option>
                    </select>
                  </label>
                  <div className="rounded-lg border border-white bg-white px-3 py-2">
                    <div className="flex justify-between text-xs font-bold text-slate-500">
                      <span>إجمالي القطع</span>
                      <span>{formatSyp(partsTotal)}</span>
                    </div>
                    <div className="mt-1 flex justify-between text-xs font-bold text-slate-500">
                      <span>المدفوع</span>
                      <span>{formatSyp(totalPaidSyp)}</span>
                    </div>
                    <div className={`mt-1 flex justify-between border-t pt-1 text-sm font-black ${paymentGap >= 0 ? 'border-emerald-100 text-emerald-700' : 'border-amber-100 text-amber-700'}`}>
                      <span>{paymentGap >= 0 ? 'مغطى' : 'المتبقي'}</span>
                      <span>{paymentGap >= 0 ? formatSyp(paymentGap) : formatSyp(Math.abs(paymentGap))}</span>
                    </div>
                  </div>
                </div>

                <PaymentEntriesList
                  entries={paymentEntries}
                  onChange={setPaymentEntries}
                  grandTotal={partsTotal}
                  label={paymentType === 'installment' ? 'الدفعة الأولى' : 'الدفعات الجزئية'}
                />

                <label className="block space-y-1.5">
                  <span className="text-xs font-bold text-slate-500">ملاحظات الفاتورة</span>
                  <textarea
                    value={invoiceNotes}
                    onChange={(e) => setInvoiceNotes(e.target.value)}
                    rows={2}
                    className="w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                    placeholder="تفاصيل الدفع أو ملاحظة على الوصل..."
                  />
                </label>
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
