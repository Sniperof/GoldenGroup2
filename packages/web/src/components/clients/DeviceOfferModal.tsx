import { useEffect, useState } from 'react';
import { CheckCircle2, Download, Loader2, Plus, Printer, Share2, Trash2, X } from 'lucide-react';
import { api } from '../../lib/api';
import type { Client, DeviceDiscount, DeviceModel, SystemList } from '../../lib/types';
import Select from '../ui/Select';
import IconButton from '../ui/IconButton';

type PreOfferDraft = {
  deviceModelId: string;
  offerType: '' | 'cash' | 'installment';
  quantity: string;
  unitPrice: string;
  firstPaymentAmount: string;
  installmentMonths: string;
  discountPercentage: string;
  appliedDeviceDiscountId: string;
  closedByEmployeeId: string;
  noClosingReason: string;
  sourceCustomerPreOfferId?: number | null;
};

type SelectedDevice = {
  deviceModelId: number;
  quantity: number;
  deviceName: string;
};

type Closer = { id: number; name: string; roleDisplayName?: string };

type CreationReasonOption = { value: string; label: string };

type CustomerPreOfferEntry = {
  sourceKind?: 'task' | 'standalone';
  customerPreOfferId?: number | null;
  deviceModelId: number | null;
  offerType: 'cash' | 'installment' | string;
  quantity: number;
  totalAmount: number | null;
  firstPaymentAmount: number | null;
  installmentMonths: number | null;
  discountPercentage: number | null;
  appliedDeviceDiscountId: number | null;
  closedByEmployeeId: number | null;
  noClosingReason: string | null;
  outcome: {
    state: 'not_presented_yet' | 'needs_follow_up' | 'accepted' | 'not_chosen' | 'rejected';
  };
};

const FALLBACK_CREATION_REASONS: CreationReasonOption[] = [
  { value: 'new_lead', label: 'عميل جديد' },
  { value: 'follow_up', label: 'متابعة' },
  { value: 'renewal', label: 'تجديد' },
  { value: 'service_request', label: 'طلب خدمة' },
  { value: 'other', label: 'أخرى' },
];

function createPreOfferDraft(): PreOfferDraft {
  return {
    deviceModelId: '',
    offerType: '',
    quantity: '1',
    unitPrice: '',
    firstPaymentAmount: '',
    installmentMonths: '',
    discountPercentage: '',
    appliedDeviceDiscountId: '',
    closedByEmployeeId: '',
    noClosingReason: '',
    sourceCustomerPreOfferId: null,
  };
}

function parsePositiveNumber(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parsePositiveInteger(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function formatAmount(amount: number): string {
  return new Intl.NumberFormat('en-US').format(amount);
}

function getOfferLabel(offerType: '' | 'cash' | 'installment'): string {
  if (offerType === 'cash') return 'كاش';
  if (offerType === 'installment') return 'تقسيط';
  return '—';
}

function formatOfferAmountDetails(offer: PreOfferDraft): string {
  const quantity = parsePositiveInteger(offer.quantity) ?? 1;
  const unitPrice = parsePositiveNumber(offer.unitPrice) ?? 0;
  const discount = parsePositiveNumber(offer.discountPercentage) ?? 0;
  const unitLabel = formatAmount(unitPrice);
  const discountLabel = discount > 0 ? ` (حسم ${discount}%)` : '';
  const totalLabel = quantity > 1 ? `${unitLabel} × ${quantity} = ${formatAmount(unitPrice * quantity)}` : unitLabel;

  if (offer.offerType === 'installment') {
    const firstPayment = parsePositiveNumber(offer.firstPaymentAmount) ?? 0;
    const months = parsePositiveInteger(offer.installmentMonths) ?? 0;
    return `${totalLabel}${discountLabel} | دفعة أولى: ${formatAmount(firstPayment)} | أشهر: ${months}`;
  }

  return `${totalLabel}${discountLabel}`;
}

function offerSummaryText(offer: PreOfferDraft, deviceName: string): string {
  const quantity = parsePositiveInteger(offer.quantity) ?? 1;
  const unitPrice = parsePositiveNumber(offer.unitPrice) ?? 0;
  const discount = parsePositiveNumber(offer.discountPercentage) ?? 0;
  const unitAmountLabel = formatAmount(unitPrice);
  const totalLabel = quantity > 1 ? `${unitAmountLabel} × ${quantity} = ${formatAmount(unitPrice * quantity)}` : unitAmountLabel;
  const discountLabel = discount > 0 ? `خصم ${discount}%` : 'بدون حسم';

  if (offer.offerType === 'installment') {
    const firstPayment = parsePositiveNumber(offer.firstPaymentAmount) ?? 0;
    const months = parsePositiveInteger(offer.installmentMonths) ?? 0;
    return [
      `الجهاز: ${deviceName}`,
      `الكمية: ${quantity}`,
      `نوع العرض: تقسيط`,
      `القيمة: ${totalLabel}`,
      `الدفعة الأولى: ${formatAmount(firstPayment)}`,
      `الأشهر: ${months}`,
      `الحسم: ${discountLabel}`,
    ].filter(Boolean).join('\n');
  }

  return [
    `الجهاز: ${deviceName}`,
    `الكمية: ${quantity}`,
    `نوع العرض: كاش`,
    `القيمة: ${totalLabel}`,
    `الحسم: ${discountLabel}`,
  ].filter(Boolean).join('\n');
}

function getReasonLabel(value: string): string {
  return FALLBACK_CREATION_REASONS.find((item) => item.value === value)?.label ?? value;
}

function buildReasonOptions(listItems: SystemList[]): CreationReasonOption[] {
  const mapped = listItems
    .map((item) => ({ value: item.value, label: item.value }))
    .filter((item) => item.value.trim().length > 0);
  const merged = [...mapped, ...FALLBACK_CREATION_REASONS.filter((fallback) => !mapped.some((item) => item.value === fallback.value))];
  return merged;
}

function buildReceiptHtml(args: {
  client: Client;
  deviceName: string;
  offer: PreOfferDraft;
  dueDate: string;
  priority: string;
  reasonLabel: string;
  closerName?: string | null;
  noClosingReasonLabel?: string;
}) {
  const { client, deviceName, offer, dueDate, priority, reasonLabel, closerName, noClosingReasonLabel } = args;
  const quantity = parsePositiveInteger(offer.quantity) ?? 1;
  const unitPrice = parsePositiveNumber(offer.unitPrice) ?? 0;
  const discount = parsePositiveNumber(offer.discountPercentage) ?? 0;
  const unitAmountLabel = formatAmount(unitPrice);
  const grandTotal = quantity > 1 ? formatAmount(unitPrice * quantity) : unitAmountLabel;
  const paymentBlock = offer.offerType === 'installment'
    ? `
      <div class="row"><span>الدفعة الأولى</span><strong>${formatAmount(parsePositiveNumber(offer.firstPaymentAmount) ?? 0)}</strong></div>
      <div class="row"><span>عدد الأشهر</span><strong>${parsePositiveInteger(offer.installmentMonths) ?? 0}</strong></div>
    `
    : '';

  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>إيصال عرض جهاز</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 0; padding: 24px; background: #f8fafc; color: #0f172a; }
    .card { max-width: 760px; margin: 0 auto; background: white; border: 1px solid #e2e8f0; border-radius: 18px; overflow: hidden; box-shadow: 0 18px 40px rgba(15, 23, 42, .08); }
    .header { background: linear-gradient(135deg, #0ea5e9, #0369a1); color: white; padding: 22px 24px; }
    .header h1 { margin: 0 0 6px; font-size: 22px; }
    .header p { margin: 0; opacity: .92; font-size: 13px; }
    .body { padding: 22px 24px; }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px 16px; }
    .row { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 10px 0; border-bottom: 1px dashed #e2e8f0; }
    .row span { color: #64748b; font-size: 13px; }
    .row strong { color: #0f172a; font-size: 14px; text-align: left; }
    .section { margin-top: 18px; padding: 16px; border: 1px solid #e2e8f0; border-radius: 14px; background: #f8fafc; }
    .section h2 { margin: 0 0 10px; font-size: 15px; color: #334155; }
    .muted { color: #64748b; font-size: 12px; }
    .footer { padding: 16px 24px 24px; display: flex; justify-content: space-between; gap: 16px; color: #64748b; font-size: 12px; }
    @media print { body { background: white; padding: 0; } .card { box-shadow: none; border: none; border-radius: 0; } }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <h1>إيصال عرض جهاز</h1>
      <p>هذا المستند يلخص العرض المُثبت قبل إنشاء المهمة</p>
    </div>
    <div class="body">
      <div class="grid">
        <div><div class="muted">الزبون</div><strong>${client.name}</strong></div>
        <div><div class="muted">الفرع</div><strong>${client.branchId ?? '—'}</strong></div>
        <div><div class="muted">سبب إنشاء المهمة</div><strong>${reasonLabel}</strong></div>
        <div><div class="muted">التاريخ المطلوب</div><strong>${dueDate}</strong></div>
        <div><div class="muted">الأولوية</div><strong>${priority || 'غير محددة'}</strong></div>
        <div><div class="muted">النوع</div><strong>${offer.offerType === 'installment' ? 'تقسيط' : 'كاش'}</strong></div>
      </div>

      <div class="section">
        <h2>تفاصيل العرض</h2>
        <div class="row"><span>الجهاز</span><strong>${deviceName}</strong></div>
        <div class="row"><span>الكمية</span><strong>${quantity}</strong></div>
        <div class="row"><span>السعر الإفرادي</span><strong>${unitAmountLabel}</strong></div>
        <div class="row"><span>الإجمالي</span><strong>${grandTotal}</strong></div>
        <div class="row"><span>الحسم</span><strong>${discount > 0 ? `${discount}%` : 'بدون حسم'}</strong></div>
        ${paymentBlock}
        <div class="row"><span>الموظف</span><strong>${closerName ?? '—'}</strong></div>
        <div class="row"><span>سبب عدم التسكير</span><strong>${noClosingReasonLabel || '—'}</strong></div>
      </div>

      <div class="section">
        <h2>ملاحظات</h2>
        <div>${offerSummaryText(offer, deviceName).replace(/\n/g, '<br/>')}</div>
      </div>
    </div>
    <div class="footer">
      <span>إيصال قابل للطباعة أو الحفظ كـ PDF</span>
      <span>${new Date().toLocaleString('ar-SY')}</span>
    </div>
  </div>
</body>
</html>`;
}

function ReceiptModal(props: {
  isOpen: boolean;
  onClose: () => void;
  client: Client;
  deviceName: string;
  offer: PreOfferDraft;
  closers: Closer[];
  noClosingReasons: CreationReasonOption[];
  dueDate: string;
  priority: string;
  reasonLabel: string;
}) {
  const { isOpen, onClose, client, deviceName, offer, closers, noClosingReasons, dueDate, priority, reasonLabel } = props;
  if (!isOpen) return null;

  const closerName = offer.closedByEmployeeId
    ? closers.find((c) => String(c.id) === offer.closedByEmployeeId)?.name ?? offer.closedByEmployeeId
    : null;

  const noClosingReasonLabel = offer.noClosingReason
    ? noClosingReasons.find((r) => r.value === offer.noClosingReason)?.label ?? offer.noClosingReason
    : '';

  const quantity = parsePositiveInteger(offer.quantity) ?? 1;
  const unitPrice = parsePositiveNumber(offer.unitPrice) ?? 0;
  const discount = parsePositiveNumber(offer.discountPercentage) ?? 0;
  const unitAmountLabel = formatAmount(unitPrice);
  const grandTotal = quantity > 1 ? formatAmount(unitPrice * quantity) : unitAmountLabel;

  const handlePrint = () => window.print();

  const handleShare = async () => {
    const text = [
      `إيصال عرض جهاز`,
      `الزبون: ${client.name}`,
      `الجهاز: ${deviceName}`,
      `الكمية: ${quantity}`,
      `نوع العرض: ${offer.offerType === 'installment' ? 'تقسيط' : 'كاش'}`,
      `الإجمالي: ${grandTotal}`,
      `الحسم: ${discount > 0 ? `${discount}%` : 'بدون حسم'}`,
      `سبب إنشاء المهمة: ${reasonLabel}`,
      `التاريخ المطلوب: ${dueDate}`,
      `الأولوية: ${priority || 'غير محددة'}`,
    ].join('\n');

    if (navigator.share) {
      await navigator.share({ title: 'إيصال عرض جهاز', text });
      return;
    }
    await navigator.clipboard.writeText(text);
  };

  const handleDownload = () => {
    const html = buildReceiptHtml({ client, deviceName, offer, dueDate, priority, reasonLabel, closerName, noClosingReasonLabel });
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `offer-${client.name.replace(/\s+/g, '-')}-${Date.now()}.html`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/55 p-4" dir="rtl">
      <div className="w-full max-w-3xl overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-6 py-4">
          <div>
            <h3 className="text-base font-bold text-slate-800">إيصال العرض</h3>
            <p className="mt-1 text-xs text-slate-500">مراجعة قبل الحفظ أو المشاركة</p>
          </div>
          <IconButton icon={X} label="إغلاق" onClick={onClose} />
        </div>

        <div className="max-h-[75vh] overflow-y-auto p-6 space-y-5">
          <div className="rounded-2xl border border-sky-100 bg-sky-50 p-4">
            <div className="flex items-center gap-2 text-sky-700 font-bold">
              <CheckCircle2 className="h-4 w-4" /> العرض جاهز للتثبيت
            </div>
          </div>

          <div className="grid gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 md:grid-cols-2">
            <div><p className="text-xs font-bold text-slate-500">الزبون</p><p className="mt-1 text-sm font-semibold text-slate-800">{client.name}</p></div>
            <div><p className="text-xs font-bold text-slate-500">سبب إنشاء المهمة</p><p className="mt-1 text-sm font-semibold text-slate-800">{reasonLabel}</p></div>
            <div><p className="text-xs font-bold text-slate-500">التاريخ المطلوب</p><p className="mt-1 text-sm font-semibold text-slate-800">{dueDate}</p></div>
            <div><p className="text-xs font-bold text-slate-500">الأولوية</p><p className="mt-1 text-sm font-semibold text-slate-800">{priority || 'غير محددة'}</p></div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <div className="border-b border-slate-100 bg-slate-50 px-4 py-3 font-bold text-slate-700">تفاصيل العرض</div>
            <div className="divide-y divide-slate-100 px-4">
              <div className="flex items-center justify-between gap-4 py-3"><span className="text-slate-500">الجهاز</span><strong className="text-slate-800">{deviceName}</strong></div>
              <div className="flex items-center justify-between gap-4 py-3"><span className="text-slate-500">الكمية</span><strong className="text-slate-800">{quantity}</strong></div>
              <div className="flex items-center justify-between gap-4 py-3"><span className="text-slate-500">نوع العرض</span><strong className="text-slate-800">{offer.offerType === 'installment' ? 'تقسيط' : 'كاش'}</strong></div>
              <div className="flex items-center justify-between gap-4 py-3"><span className="text-slate-500">السعر الإفرادي</span><strong className="text-slate-800">{unitAmountLabel}</strong></div>
              <div className="flex items-center justify-between gap-4 py-3"><span className="text-slate-500">الإجمالي</span><strong className="text-slate-800">{grandTotal}</strong></div>
              <div className="flex items-center justify-between gap-4 py-3"><span className="text-slate-500">الحسم</span><strong className="text-slate-800">{discount > 0 ? `${discount}%` : 'بدون حسم'}</strong></div>
              {offer.offerType === 'installment' && (
                <>
                  <div className="flex items-center justify-between gap-4 py-3"><span className="text-slate-500">الدفعة الأولى</span><strong className="text-slate-800">{formatAmount(parsePositiveNumber(offer.firstPaymentAmount) ?? 0)}</strong></div>
                  <div className="flex items-center justify-between gap-4 py-3"><span className="text-slate-500">عدد الأشهر</span><strong className="text-slate-800">{parsePositiveInteger(offer.installmentMonths) ?? 0}</strong></div>
                </>
              )}
              <div className="flex items-center justify-between gap-4 py-3"><span className="text-slate-500">الموظف</span><strong className="text-slate-800">{closerName ?? '—'}</strong></div>
              <div className="flex items-center justify-between gap-4 py-3"><span className="text-slate-500">سبب عدم التسكير</span><strong className="text-slate-800">{noClosingReasonLabel || '—'}</strong></div>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-slate-100 px-6 py-4">
          <button onClick={handleDownload} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">
            <Download className="h-4 w-4" /> تنزيل
          </button>
          <button onClick={handleShare} className="inline-flex items-center gap-2 rounded-xl border border-sky-200 bg-sky-50 px-4 py-2 text-sm font-bold text-sky-700 hover:bg-sky-100">
            <Share2 className="h-4 w-4" /> مشاركة
          </button>
          <button onClick={handlePrint} className="inline-flex items-center gap-2 rounded-xl bg-sky-600 px-4 py-2 text-sm font-bold text-white hover:bg-sky-700">
            <Printer className="h-4 w-4" /> طباعة / حفظ PDF
          </button>
        </div>
      </div>
    </div>
  );
}

interface DeviceOfferModalProps {
  isOpen: boolean;
  onClose: () => void;
  client: Client;
  onCreated: (created?: any) => void;
}

export default function DeviceOfferModal({ isOpen, onClose, client, onCreated }: DeviceOfferModalProps) {
  const [deviceModels, setDeviceModels] = useState<DeviceModel[]>([]);
  const [closers, setClosers] = useState<Closer[]>([]);
  const [noClosingReasons, setNoClosingReasons] = useState<CreationReasonOption[]>([]);
  const [creationReasons, setCreationReasons] = useState<CreationReasonOption[]>(FALLBACK_CREATION_REASONS);

  // Top section — selected devices (mandatory)
  const [selectedDevices, setSelectedDevices] = useState<SelectedDevice[]>([]);
  const [devicePickerId, setDevicePickerId] = useState('');
  const [devicePickerQty, setDevicePickerQty] = useState('1');

  // Pre-offers section
  const [preOffers, setPreOffers] = useState<PreOfferDraft[]>([]);
  const [customerPreOffers, setCustomerPreOffers] = useState<CustomerPreOfferEntry[]>([]);
  const [draftOffer, setDraftOffer] = useState<PreOfferDraft>(createPreOfferDraft());
  const [deviceDiscounts, setDeviceDiscounts] = useState<DeviceDiscount[]>([]);

  // Task meta
  const [dueDate, setDueDate] = useState('');
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [priority, setPriority] = useState<'' | 'high' | 'medium' | 'low'>('');

  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [receiptOfferIndex, setReceiptOfferIndex] = useState<number | null>(null);

  // Load reference data on open
  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    setError('');
    Promise.all([
      api.deviceModels.list(client.branchId ?? undefined),
      api.employees.employeeClosers(),
      api.systemLists.getItemsByCode('open_task_reasons'),
      api.systemLists.getItemsByCode('no_closing_reasons'),
      api.customers.getPreOffers(client.id),
    ])
      .then(([models, closerRows, reasonRows, noClosingRows, customerPreOffersResponse]) => {
        setDeviceModels(models);
        setClosers(closerRows);
        setCreationReasons(buildReasonOptions(reasonRows as SystemList[]));
        setCustomerPreOffers(
          (((customerPreOffersResponse as { entries?: CustomerPreOfferEntry[] })?.entries) ?? []).filter((entry) => (
            entry.sourceKind === 'standalone'
            && ['not_presented_yet', 'needs_follow_up'].includes(entry.outcome?.state)
          )),
        );
        const ncr = (noClosingRows as SystemList[])
          .filter(r => r.value?.trim())
          .map(r => ({ value: r.value, label: r.value }));
        setNoClosingReasons(ncr.length > 0 ? ncr : [
          { value: 'لم يتم التسكير', label: 'لم يتم التسكير' },
          { value: 'متابعة لاحقة', label: 'متابعة لاحقة' },
          { value: 'العميل مشغول', label: 'العميل مشغول' },
          { value: 'سبب سعري', label: 'سبب سعري' },
          { value: 'أخرى', label: 'أخرى' },
        ]);
      })
      .catch((err: any) => setError(err.message || 'فشل في تحميل البيانات'))
      .finally(() => setLoading(false));
  }, [isOpen]);

  // Reset all state on open
  useEffect(() => {
    if (!isOpen) return;
    setSelectedDevices([]);
    setDevicePickerId('');
    setDevicePickerQty('1');
    setPreOffers([]);
    setCustomerPreOffers([]);
    setDraftOffer(createPreOfferDraft());
    setDeviceDiscounts([]);
    setDueDate('');
    setReason('');
    setNotes('');
    setPriority('');
    setReceiptOfferIndex(null);
    setError('');
  }, [isOpen]);

  // Load discounts when draft device changes
  useEffect(() => {
    updateDraftOffer('discountPercentage', '');
    updateDraftOffer('appliedDeviceDiscountId', '');
    updateDraftOffer('unitPrice', '');
    if (!draftOffer.deviceModelId) {
      setDeviceDiscounts([]);
      return;
    }
    // Auto-fill unit price from device base price
    const device = deviceModels.find(d => String(d.id) === draftOffer.deviceModelId);
    if (device?.basePrice) updateDraftOffer('unitPrice', String(device.basePrice));
    api.deviceModels.getDiscounts(Number(draftOffer.deviceModelId))
      .then(setDeviceDiscounts)
      .catch(() => setDeviceDiscounts([]));
  }, [draftOffer.deviceModelId]);

  if (!isOpen) return null;

  const reasonLabel = creationReasons.find((item) => item.value === reason)?.label || '—';

  const updateDraftOffer = (field: keyof PreOfferDraft, value: string) => {
    setDraftOffer((current) => ({ ...current, [field]: value }));
  };

  const buildDraftFromCustomerPreOffer = (entry: CustomerPreOfferEntry): PreOfferDraft | null => {
    if (!entry.customerPreOfferId || !entry.deviceModelId || entry.totalAmount == null) {
      return null;
    }
    return {
      deviceModelId: String(entry.deviceModelId),
      offerType: entry.offerType === 'installment' ? 'installment' : 'cash',
      quantity: String(entry.quantity ?? 1),
      unitPrice: String(entry.totalAmount),
      firstPaymentAmount: entry.firstPaymentAmount == null ? '' : String(entry.firstPaymentAmount),
      installmentMonths: entry.installmentMonths == null ? '' : String(entry.installmentMonths),
      discountPercentage: entry.discountPercentage == null ? '' : String(entry.discountPercentage),
      appliedDeviceDiscountId: entry.appliedDeviceDiscountId == null ? '' : String(entry.appliedDeviceDiscountId),
      closedByEmployeeId: entry.closedByEmployeeId == null ? '' : String(entry.closedByEmployeeId),
      noClosingReason: entry.noClosingReason ?? '',
      sourceCustomerPreOfferId: entry.customerPreOfferId,
    };
  };

  // ── Add device to top list ──
  const handleAddDevice = () => {
    if (!devicePickerId) { setError('اختر جهازاً'); return; }
    const qty = parsePositiveInteger(devicePickerQty) ?? 1;
    const device = deviceModels.find(d => d.id === Number(devicePickerId));
    if (!device) return;
    if (selectedDevices.some(d => d.deviceModelId === Number(devicePickerId))) {
      setError('هذا الجهاز مضاف بالفعل'); return;
    }
    const importedOffers = customerPreOffers
      .filter((entry) => entry.deviceModelId === device.id)
      .map(buildDraftFromCustomerPreOffer)
      .filter((entry): entry is PreOfferDraft => entry !== null)
      .filter((entry) => !preOffers.some((existing) => (
        existing.sourceCustomerPreOfferId != null
        && existing.sourceCustomerPreOfferId === entry.sourceCustomerPreOfferId
      )));
    setSelectedDevices(prev => [...prev, { deviceModelId: device.id, quantity: qty, deviceName: device.nameAr || device.name }]);
    if (importedOffers.length > 0) {
      setPreOffers((current) => [...current, ...importedOffers]);
    }
    setDevicePickerId('');
    setDevicePickerQty('1');
    setError('');
  };

  // ── Pre-offer form ──
  const validateOfferDraft = (offer: PreOfferDraft, label: string): string => {
    if (!offer.deviceModelId) return `يرجى اختيار الجهاز في ${label}`;
    if (!offer.offerType) return `يرجى اختيار نوع العرض في ${label}`;
    if (!parsePositiveNumber(offer.unitPrice)) return `يرجى إدخال السعر الإفرادي في ${label}`;
    if (offer.discountPercentage && !offer.appliedDeviceDiscountId) return `يجب اختيار الحسم من قائمة حسومات الجهاز في ${label}`;
    if (offer.offerType === 'installment') {
      if (!parsePositiveNumber(offer.firstPaymentAmount) || !parsePositiveInteger(offer.installmentMonths)) {
        return `يرجى استكمال بيانات التقسيط في ${label}`;
      }
    }
    if (!offer.closedByEmployeeId && !offer.noClosingReason) {
      return `كل عرض يجب أن يحتوي إما على موظف تسكير أو سبب عدم التسكير في ${label}`;
    }
    return '';
  };

  const handleAddOffer = () => {
    if (selectedDevices.length === 0) { setError('يجب اختيار جهاز واحد على الأقل من قائمة الأجهزة'); return; }
    const validationError = validateOfferDraft(draftOffer, 'العرض الجديد');
    if (validationError) { setError(validationError); return; }
    setPreOffers((current) => [...current, { ...draftOffer }]);
    setDraftOffer(createPreOfferDraft());
    setError('');
  };

  const openReceipt = (index: number) => {
    const offer = preOffers[index];
    if (!offer) return;
    const validationError = validateOfferDraft(offer, `العرض رقم ${index + 1}`);
    if (validationError) { setError(validationError); return; }
    setError('');
    setReceiptOfferIndex(index);
  };

  const handleSubmit = async () => {
    setError('');
    if (selectedDevices.length === 0) { setError('يجب اختيار جهاز واحد على الأقل'); return; }
    if (!dueDate) { setError('التاريخ المطلوب إلزامي'); return; }
    if (!reason) { setError('سبب إنشاء المهمة مطلوب'); return; }

    for (const [index, offer] of preOffers.entries()) {
      const validationError = validateOfferDraft(offer, `العرض رقم ${index + 1}`);
      if (validationError) { setError(validationError); return; }
    }

    const normalizedOffers = preOffers.map((offer) => ({
      deviceModelId: Number(offer.deviceModelId),
      offerType: offer.offerType,
      quantity: parsePositiveInteger(offer.quantity) ?? 1,
      totalAmount: parsePositiveNumber(offer.unitPrice) ?? 0,
      firstPaymentAmount: offer.firstPaymentAmount ? parsePositiveNumber(offer.firstPaymentAmount) : null,
      installmentMonths: offer.installmentMonths ? parsePositiveInteger(offer.installmentMonths) : null,
      currency: 'SYP',
      discountPercentage: offer.discountPercentage ? Number(offer.discountPercentage) : null,
      appliedDeviceDiscountId: offer.appliedDeviceDiscountId ? Number(offer.appliedDeviceDiscountId) : null,
      closedByEmployeeId: offer.closedByEmployeeId ? Number(offer.closedByEmployeeId) : null,
      noClosingReason: offer.noClosingReason.trim() || null,
      sourceCustomerPreOfferId: offer.sourceCustomerPreOfferId ?? null,
    }));

    setSaving(true);
    try {
      const created = await api.openTasks.create({
        clientId: client.id,
        branchId: client.branchId,
        dueDate,
        reason,
        priority: priority || null,
        notes: notes.trim() || null,
        devices: selectedDevices.map(d => ({ deviceModelId: d.deviceModelId, quantity: d.quantity })),
        preOffers: normalizedOffers,
      });
      onCreated(created);
    } catch (err: any) {
      setError(err.message || 'فشل في إنشاء المهمة');
    } finally {
      setSaving(false);
    }
  };

  // Devices available for pre-offer dropdown: only from selectedDevices, not yet used
  const availableOfferDevices = selectedDevices;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4" dir="rtl">
      <div className="w-full max-w-5xl rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div>
            <h3 className="text-base font-bold text-slate-800">إضافة عرض جهاز</h3>
            <p className="mt-1 text-xs text-slate-500">{client.name}</p>
          </div>
          <IconButton icon={X} label="إغلاق" onClick={onClose} />
        </div>

        <div className="max-h-[80vh] overflow-y-auto bg-slate-50/50 px-6 py-6 space-y-6">
          {loading ? (
            <div className="py-16 text-center"><Loader2 className="mx-auto w-8 h-8 animate-spin text-slate-300" /></div>
          ) : (
            <>
              {/* ══ Section 1: Selected Devices (MANDATORY) ══ */}
              <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
                <div>
                  <h4 className="text-sm font-black text-slate-800">الأجهزة المراد عرضها <span className="text-red-500">*</span></h4>
                  <p className="text-xs text-slate-500">اختر الأجهزة التي ستُعرض على الزبون. يجب اختيار جهاز واحد على الأقل.</p>
                </div>

                {/* Picker row */}
                <div className="flex gap-3 items-end">
                  <div className="flex-1 space-y-1">
                    <label className="text-xs font-bold text-slate-600">الجهاز</label>
                    <Select
                      value={devicePickerId}
                      onChange={setDevicePickerId}
                      placeholder="اختر الجهاز..."
                      ariaLabel="الجهاز"
                      className="w-full"
                      options={deviceModels
                        .filter(m => !selectedDevices.some(d => d.deviceModelId === m.id))
                        .map(m => ({ value: String(m.id), label: m.nameAr || m.name }))}
                    />
                  </div>
                  <div className="w-24 space-y-1">
                    <label className="text-xs font-bold text-slate-600">الكمية</label>
                    <input type="number" min={1} value={devicePickerQty}
                      onChange={e => setDevicePickerQty(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm" />
                  </div>
                  <button type="button" onClick={handleAddDevice}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-bold text-emerald-700 hover:bg-emerald-100">
                    <Plus className="w-4 h-4" /> إضافة للقائمة
                  </button>
                </div>

                {/* Selected devices table */}
                {selectedDevices.length > 0 && (
                  <div className="overflow-hidden rounded-xl border border-slate-200">
                    <table className="min-w-full divide-y divide-slate-100 text-sm">
                      <thead className="bg-slate-50 text-slate-600">
                        <tr>
                          <th className="px-4 py-2.5 text-right font-bold">#</th>
                          <th className="px-4 py-2.5 text-right font-bold">الجهاز</th>
                          <th className="px-4 py-2.5 text-right font-bold">الكمية</th>
                          <th className="px-4 py-2.5 text-right font-bold">حذف</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50 bg-white">
                        {selectedDevices.map((d, i) => (
                          <tr key={d.deviceModelId}>
                            <td className="px-4 py-2.5 text-slate-400">{i + 1}</td>
                            <td className="px-4 py-2.5 font-semibold text-slate-800">{d.deviceName}</td>
                            <td className="px-4 py-2.5 text-slate-600">{d.quantity}</td>
                            <td className="px-4 py-2.5">
                              <button type="button"
                                onClick={() => setSelectedDevices(prev => prev.filter((_, idx) => idx !== i))}
                                className="text-red-400 hover:text-red-600">
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {selectedDevices.length === 0 && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                    يجب اختيار جهاز واحد على الأقل
                  </div>
                )}
              </section>

              {/* ══ Section 2: Pre-Offers (OPTIONAL) ══ */}
              <section className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h4 className="text-sm font-black text-slate-800">العروض المسبقة</h4>
                    <p className="text-xs text-slate-500">اختياري — أضف عروضاً مفصّلة للأجهزة المختارة أعلاه.</p>
                  </div>
                  <button type="button" onClick={handleAddOffer}
                    disabled={selectedDevices.length === 0}
                    className="inline-flex items-center gap-1 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-bold text-sky-700 hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-40">
                    <Plus className="w-3.5 h-3.5" /> تثبيت العرض
                  </button>
                </div>

                {selectedDevices.length === 0 ? (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-400">
                    اختر جهازاً من القائمة أعلاه أولاً لإضافة عروض.
                  </div>
                ) : (
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    {/* Device dropdown — only from selectedDevices */}
                    <div className="space-y-2 xl:col-span-2">
                      <label className="text-sm font-bold text-slate-700">الجهاز</label>
                      <Select
                        value={draftOffer.deviceModelId}
                        onChange={v => updateDraftOffer('deviceModelId', v)}
                        placeholder="اختر الجهاز..."
                        ariaLabel="الجهاز"
                        className="w-full"
                        options={availableOfferDevices.map(d => ({ value: String(d.deviceModelId), label: d.deviceName }))}
                      />
                      {availableOfferDevices.length === 0 && (
                        <p className="text-xs text-slate-400">كل الأجهزة المختارة لديها عروض مثبتة.</p>
                      )}
                    </div>

                    {/* Offer type */}
                    <div className="space-y-2">
                      <label className="text-sm font-bold text-slate-700">نوع العرض</label>
                      <Select
                        value={draftOffer.offerType}
                        onChange={v => updateDraftOffer('offerType', v as PreOfferDraft['offerType'])}
                        placeholder="اختر نوع العرض..."
                        ariaLabel="نوع العرض"
                        className="w-full"
                        options={[
                          { value: 'cash', label: 'كاش' },
                          { value: 'installment', label: 'تقسيط' },
                        ]}
                      />
                    </div>

                    {/* Quantity */}
                    <div className="space-y-2">
                      <label className="text-sm font-bold text-slate-700">الكمية</label>
                      <input type="number" min="1" value={draftOffer.quantity}
                        onChange={e => updateDraftOffer('quantity', e.target.value)}
                        className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm" placeholder="1" />
                    </div>

                    {/* Unit price (renamed from totalAmount) */}
                    <div className="space-y-2">
                      <label className="text-sm font-bold text-slate-700">السعر الإفرادي</label>
                      <input type="number" min="0" step="0.01" value={draftOffer.unitPrice}
                        onChange={e => updateDraftOffer('unitPrice', e.target.value)}
                        className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm" placeholder="0" />
                    </div>

                    {/* Discount — dropdown if discounts exist, else manual */}
                    {draftOffer.deviceModelId ? (
                      <div className="space-y-2">
                        <label className="text-sm font-bold text-slate-700">حسم الجهاز</label>
                        <Select
                          value={draftOffer.appliedDeviceDiscountId}
                          onChange={v => {
                            const disc = deviceDiscounts.find(d => String(d.id) === v);
                            updateDraftOffer('appliedDeviceDiscountId', v);
                            updateDraftOffer('discountPercentage', disc ? String(disc.percentage) : '');
                          }}
                          placeholder="بدون حسم"
                          ariaLabel="حسم الجهاز"
                          className="w-full"
                          options={deviceDiscounts.map(d => ({ value: String(d.id), label: `${d.label} (${d.percentage}%)` }))}
                        />
                        {deviceDiscounts.length === 0 && (
                          <p className="text-xs text-slate-400">لا توجد حسومات فعالة لهذا الجهاز.</p>
                        )}
                        {draftOffer.appliedDeviceDiscountId && deviceDiscounts.find(d => String(d.id) === draftOffer.appliedDeviceDiscountId) && (
                          <p className="text-xs text-slate-400">
                            صالح حتى {new Date(deviceDiscounts.find(d => String(d.id) === draftOffer.appliedDeviceDiscountId)!.endDate).toLocaleDateString('ar-SY')}
                          </p>
                        )}
                      </div>
                    ) : null}

                    {/* Closing employee */}
                    <div className="space-y-2">
                      <label className="text-sm font-bold text-slate-700">موظف التسكير</label>
                      <Select
                        value={draftOffer.closedByEmployeeId}
                        onChange={v => {
                          updateDraftOffer('closedByEmployeeId', v);
                          if (v) updateDraftOffer('noClosingReason', '');
                        }}
                        placeholder="اختياري"
                        ariaLabel="موظف التسكير"
                        className="w-full"
                        options={closers.map(c => ({ value: String(c.id), label: c.name }))}
                      />
                    </div>

                    {/* No-closing reason */}
                    <div className="space-y-2">
                      <label className="text-sm font-bold text-slate-700">سبب عدم التسكير</label>
                      <Select
                        value={draftOffer.noClosingReason}
                        onChange={v => {
                          updateDraftOffer('noClosingReason', v);
                          if (v) updateDraftOffer('closedByEmployeeId', '');
                        }}
                        disabled={!!draftOffer.closedByEmployeeId}
                        placeholder="بدون سبب"
                        ariaLabel="سبب عدم التسكير"
                        className="w-full"
                        options={noClosingReasons.map(r => ({ value: r.value, label: r.label }))}
                      />
                    </div>

                    {/* Installment fields */}
                    {draftOffer.offerType === 'installment' && (
                      <>
                        <div className="space-y-2">
                          <label className="text-sm font-bold text-slate-700">الدفعة الأولى</label>
                          <input type="number" min="0" step="0.01" value={draftOffer.firstPaymentAmount}
                            onChange={e => updateDraftOffer('firstPaymentAmount', e.target.value)}
                            className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm" placeholder="0" />
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-bold text-slate-700">عدد الأشهر</label>
                          <input type="number" min="1" value={draftOffer.installmentMonths}
                            onChange={e => updateDraftOffer('installmentMonths', e.target.value)}
                            className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm" placeholder="12" />
                        </div>
                      </>
                    )}
                  </div>
                )}

                {/* Pre-offers table */}
                <div className="overflow-hidden rounded-2xl border border-slate-200">
                  <table className="min-w-full divide-y divide-slate-200 text-sm">
                    <thead className="bg-slate-50 text-slate-600">
                      <tr>
                        <th className="px-4 py-3 text-right font-bold">#</th>
                        <th className="px-4 py-3 text-right font-bold">الجهاز</th>
                        <th className="px-4 py-3 text-right font-bold">النوع</th>
                        <th className="px-4 py-3 text-right font-bold">الكمية</th>
                        <th className="px-4 py-3 text-right font-bold">القيمة</th>
                        <th className="px-4 py-3 text-right font-bold">التسكير</th>
                        <th className="px-4 py-3 text-right font-bold">الإجراءات</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {preOffers.length === 0 ? (
                        <tr>
                          <td className="px-4 py-6 text-center text-slate-400" colSpan={7}>
                            لا توجد عروض مثبتة بعد.
                          </td>
                        </tr>
                      ) : (
                        preOffers.map((offer, index) => {
                          const deviceName = selectedDevices.find(d => String(d.deviceModelId) === offer.deviceModelId)?.deviceName
                            || deviceModels.find(m => String(m.id) === offer.deviceModelId)?.nameAr
                            || '—';
                          const closingLabel = offer.closedByEmployeeId
                            ? closers.find(c => String(c.id) === offer.closedByEmployeeId)?.name || offer.closedByEmployeeId
                            : offer.noClosingReason
                              ? noClosingReasons.find(r => r.value === offer.noClosingReason)?.label || offer.noClosingReason
                              : '—';
                          return (
                            <tr key={`${offer.deviceModelId}-${index}`} className="align-top">
                              <td className="px-4 py-3 font-semibold text-slate-500">{index + 1}</td>
                              <td className="px-4 py-3 font-semibold text-slate-800">{deviceName}</td>
                              <td className="px-4 py-3 text-slate-600">{getOfferLabel(offer.offerType)}</td>
                              <td className="px-4 py-3 text-slate-600">{offer.quantity || 1}</td>
                              <td className="px-4 py-3 text-slate-600">{formatOfferAmountDetails(offer)}</td>
                              <td className="px-4 py-3 text-slate-600">{closingLabel}</td>
                              <td className="px-4 py-3">
                                <div className="flex flex-wrap gap-2">
                                  <button type="button" onClick={() => openReceipt(index)}
                                    className="inline-flex items-center gap-1 rounded-lg border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-bold text-sky-700 hover:bg-sky-100">
                                    <CheckCircle2 className="h-3.5 w-3.5" /> فتح الإيصال
                                  </button>
                                  <button type="button" onClick={() => setPreOffers(current => current.filter((_, i) => i !== index))}
                                    className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-bold text-red-700 hover:bg-red-100">
                                    <Trash2 className="h-3.5 w-3.5" /> حذف
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* ══ Section 3: Task Meta ══ */}
              <section className="grid gap-4 rounded-2xl border border-slate-200 bg-white p-5 md:grid-cols-3">
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">سبب إنشاء المهمة <span className="text-red-500">*</span></label>
                  <Select
                    value={reason}
                    onChange={setReason}
                    placeholder="اختر السبب..."
                    ariaLabel="سبب إنشاء المهمة"
                    className="w-full"
                    options={creationReasons.map(o => ({ value: o.value, label: o.label }))}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">تاريخ مستحق <span className="text-red-500">*</span></label>
                  <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">الأولوية</label>
                  <Select<'' | 'high' | 'medium' | 'low'>
                    value={priority}
                    onChange={setPriority}
                    placeholder="غير محددة"
                    ariaLabel="الأولوية"
                    className="w-full"
                    options={[
                      { value: 'high', label: 'عالية' },
                      { value: 'medium', label: 'متوسطة' },
                      { value: 'low', label: 'منخفضة' },
                    ]}
                  />
                </div>
                <div className="space-y-2 md:col-span-3">
                  <label className="text-sm font-bold text-slate-700">ملاحظات</label>
                  <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
                    className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm" />
                </div>
              </section>

              {error && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-slate-100 px-6 py-4">
          <button onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold text-slate-500 hover:bg-slate-50">
            إلغاء
          </button>
          <button onClick={handleSubmit} disabled={saving || loading}
            className="inline-flex items-center gap-2 rounded-xl bg-sky-600 px-5 py-2 text-sm font-bold text-white hover:bg-sky-700 disabled:opacity-60">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            إنشاء المهمة
          </button>
        </div>
      </div>

      {receiptOfferIndex != null && preOffers[receiptOfferIndex] && (
        <ReceiptModal
          isOpen={receiptOfferIndex != null}
          onClose={() => setReceiptOfferIndex(null)}
          client={client}
          deviceName={
            selectedDevices.find(d => String(d.deviceModelId) === preOffers[receiptOfferIndex].deviceModelId)?.deviceName
            || deviceModels.find(m => String(m.id) === preOffers[receiptOfferIndex].deviceModelId)?.nameAr
            || '—'
          }
          offer={preOffers[receiptOfferIndex]}
          closers={closers}
          noClosingReasons={noClosingReasons}
          dueDate={dueDate}
          priority={priority}
          reasonLabel={reasonLabel}
        />
      )}
    </div>
  );
}
