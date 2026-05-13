import { useEffect, useState } from 'react';
import { CheckCircle2, Download, Loader2, Plus, Printer, Share2, Trash2, X } from 'lucide-react';
import { api } from '../../lib/api';
import type { Client, DeviceModel, Employee, SystemList } from '../../lib/types';

type PreOfferDraft = {
  deviceModelId: string;
  offerType: '' | 'cash' | 'installment';
  quantity: string;
  totalAmount: string;
  firstPaymentAmount: string;
  installmentMonths: string;
  currency: string;
  discountPercentage: string;
  closedByEmployeeId: string;
  noClosingReason: string;
};

type CreationReasonOption = {
  value: string;
  label: string;
};

const FALLBACK_CREATION_REASONS: CreationReasonOption[] = [
  { value: 'new_lead', label: 'عميل جديد' },
  { value: 'follow_up', label: 'متابعة' },
  { value: 'renewal', label: 'تجديد' },
  { value: 'service_request', label: 'طلب خدمة' },
  { value: 'other', label: 'أخرى' },
];

const NO_CLOSING_REASON_OPTIONS: CreationReasonOption[] = [
  { value: '', label: 'بدون سبب' },
  { value: 'not_closed', label: 'لم يتم التسكير' },
  { value: 'follow_up', label: 'متابعة لاحقة' },
  { value: 'customer_busy', label: 'العميل مشغول' },
  { value: 'price_issue', label: 'سبب سعري' },
  { value: 'other', label: 'أخرى' },
];

function createPreOfferDraft(): PreOfferDraft {
  return {
    deviceModelId: '',
    offerType: '',
    quantity: '1',
    totalAmount: '',
    firstPaymentAmount: '',
    installmentMonths: '',
    currency: 'SYP',
    discountPercentage: '',
    closedByEmployeeId: '',
    noClosingReason: '',
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

function formatAmount(amount: number, currency: string): string {
  return `${new Intl.NumberFormat('en-US').format(amount)} ${currency}`;
}

function getOfferLabel(offerType: '' | 'cash' | 'installment'): string {
  if (offerType === 'cash') return 'كاش';
  if (offerType === 'installment') return 'تقسيط';
  return '—';
}

function formatOfferAmountDetails(offer: PreOfferDraft): string {
  const quantity = parsePositiveInteger(offer.quantity) ?? 1;
  const totalAmount = parsePositiveNumber(offer.totalAmount) ?? 0;
  const discount = parsePositiveNumber(offer.discountPercentage) ?? 0;
  const currency = offer.currency || 'SYP';
  const unitLabel = formatAmount(totalAmount, currency);
  const discountLabel = discount > 0 ? ` (حسم ${discount}%)` : '';
  const totalLabel = quantity > 1 ? `${unitLabel} × ${quantity} = ${formatAmount(totalAmount * quantity, currency)}` : unitLabel;

  if (offer.offerType === 'installment') {
    const firstPayment = parsePositiveNumber(offer.firstPaymentAmount) ?? 0;
    const months = parsePositiveInteger(offer.installmentMonths) ?? 0;
    return `${totalLabel}${discountLabel} | دفعة أولى: ${formatAmount(firstPayment, currency)} | أشهر: ${months}`;
  }

  return `${totalLabel}${discountLabel}`;
}

function offerSummaryText(offer: PreOfferDraft, deviceName: string): string {
  const quantity = parsePositiveInteger(offer.quantity) ?? 1;
  const totalAmount = parsePositiveNumber(offer.totalAmount) ?? 0;
  const discount = parsePositiveNumber(offer.discountPercentage) ?? 0;
  const currency = offer.currency || 'SYP';
  const unitAmountLabel = formatAmount(totalAmount, currency);
  const totalLabel = quantity > 1 ? `${unitAmountLabel} × ${quantity} = ${formatAmount(totalAmount * quantity, currency)}` : unitAmountLabel;
  const discountLabel = discount > 0 ? `خصم ${discount}%` : 'بدون حسم';

  if (offer.offerType === 'installment') {
    const firstPayment = parsePositiveNumber(offer.firstPaymentAmount) ?? 0;
    const months = parsePositiveInteger(offer.installmentMonths) ?? 0;
    return [
      `الجهاز: ${deviceName}`,
      `الكمية: ${quantity}`,
      `نوع العرض: تقسيط`,
      `القيمة: ${totalLabel}`,
      `الدفعة الأولى: ${formatAmount(firstPayment, currency)}`,
      `الأشهر: ${months}`,
      `الحسم: ${discountLabel}`,
      offer.closedByEmployeeId ? `الموظف: ${offer.closedByEmployeeId}` : '',
      offer.noClosingReason ? `سبب عدم التسكير: ${getNoClosingReasonLabel(offer.noClosingReason)}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  return [
    `الجهاز: ${deviceName}`,
    `الكمية: ${quantity}`,
    `نوع العرض: كاش` ,
    `القيمة: ${totalLabel}`,
    `الحسم: ${discountLabel}`,
    offer.closedByEmployeeId ? `الموظف: ${offer.closedByEmployeeId}` : '',
    offer.noClosingReason ? `سبب عدم التسكير: ${getNoClosingReasonLabel(offer.noClosingReason)}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function getReasonLabel(value: string): string {
  return FALLBACK_CREATION_REASONS.find((item) => item.value === value)?.label ?? value;
}

function buildReasonOptions(listItems: SystemList[]): CreationReasonOption[] {
  const mapped = listItems
    .map((item) => ({ value: item.value, label: getReasonLabel(item.value) }))
    .filter((item) => item.value.trim().length > 0);
  const merged = [...mapped, ...FALLBACK_CREATION_REASONS.filter((fallback) => !mapped.some((item) => item.value === fallback.value))];
  return merged;
}

function getNoClosingReasonLabel(value: string): string {
  return NO_CLOSING_REASON_OPTIONS.find((item) => item.value === value)?.label ?? value;
}

function buildReceiptHtml(args: {
  client: Client;
  deviceName: string;
  offer: PreOfferDraft;
  dueDate: string;
  priority: string;
  reasonLabel: string;
  employeeName?: string | null;
}) {
  const { client, deviceName, offer, dueDate, priority, reasonLabel, employeeName } = args;
  const quantity = parsePositiveInteger(offer.quantity) ?? 1;
  const totalAmount = parsePositiveNumber(offer.totalAmount) ?? 0;
  const discount = parsePositiveNumber(offer.discountPercentage) ?? 0;
  const currency = offer.currency || 'SYP';
  const unitAmountLabel = formatAmount(totalAmount, currency);
  const grandTotal = quantity > 1 ? formatAmount(totalAmount * quantity, currency) : unitAmountLabel;
  const paymentBlock = offer.offerType === 'installment'
    ? `
      <div class="row"><span>الدفعة الأولى</span><strong>${formatAmount(parsePositiveNumber(offer.firstPaymentAmount) ?? 0, currency)}</strong></div>
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
        <div><div class="muted">تاريخ الاستحقاق</div><strong>${dueDate}</strong></div>
        <div><div class="muted">الأولوية</div><strong>${priority || 'غير محددة'}</strong></div>
        <div><div class="muted">النوع</div><strong>${offer.offerType === 'installment' ? 'تقسيط' : 'كاش'}</strong></div>
      </div>

      <div class="section">
        <h2>تفاصيل العرض</h2>
        <div class="row"><span>الجهاز</span><strong>${deviceName}</strong></div>
        <div class="row"><span>الكمية</span><strong>${quantity}</strong></div>
        <div class="row"><span>سعر الوحدة</span><strong>${unitAmountLabel}</strong></div>
        <div class="row"><span>الإجمالي</span><strong>${grandTotal}</strong></div>
        <div class="row"><span>الحسم</span><strong>${discount > 0 ? `${discount}%` : 'بدون حسم'}</strong></div>
        ${paymentBlock}
        <div class="row"><span>الموظف</span><strong>${employeeName ?? '—'}</strong></div>
        <div class="row"><span>سبب عدم التسكير</span><strong>${offer.noClosingReason ? getNoClosingReasonLabel(offer.noClosingReason) : '—'}</strong></div>
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
  employees: Employee[];
  dueDate: string;
  priority: string;
  reasonLabel: string;
}) {
  const { isOpen, onClose, client, deviceName, offer, employees, dueDate, priority, reasonLabel } = props;
  if (!isOpen) return null;

  const employeeName = offer.closedByEmployeeId
    ? employees.find((employee) => String(employee.id) === offer.closedByEmployeeId)?.name ?? offer.closedByEmployeeId
    : null;

  const quantity = parsePositiveInteger(offer.quantity) ?? 1;
  const totalAmount = parsePositiveNumber(offer.totalAmount) ?? 0;
  const discount = parsePositiveNumber(offer.discountPercentage) ?? 0;
  const currency = offer.currency || 'SYP';
  const unitAmountLabel = formatAmount(totalAmount, currency);
  const grandTotal = quantity > 1 ? formatAmount(totalAmount * quantity, currency) : unitAmountLabel;

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
      `تاريخ الاستحقاق: ${dueDate}`,
      `الأولوية: ${priority || 'غير محددة'}`,
    ].join('\n');

    if (navigator.share) {
      await navigator.share({ title: 'إيصال عرض جهاز', text });
      return;
    }

    await navigator.clipboard.writeText(text);
  };

  const handleDownload = () => {
    const html = buildReceiptHtml({
      client,
      deviceName,
      offer,
      dueDate,
      priority,
      reasonLabel,
      employeeName,
    });
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
      <div className="w-full max-w-3xl overflow-hidden rounded-3xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-6 py-4">
          <div>
            <h3 className="text-lg font-black text-slate-800">إيصال العرض</h3>
            <p className="mt-1 text-xs text-slate-500">مراجعة قبل الحفظ أو المشاركة</p>
          </div>
          <button onClick={onClose} className="rounded-xl p-2 text-slate-400 hover:bg-white hover:text-slate-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="max-h-[75vh] overflow-y-auto p-6 space-y-5">
          <div className="rounded-2xl border border-sky-100 bg-sky-50 p-4">
            <div className="flex items-center gap-2 text-sky-700 font-bold">
              <CheckCircle2 className="h-4 w-4" /> العرض جاهز للتثبيت
            </div>
            <p className="mt-1 text-sm text-sky-700/90">هذا الملخص يعرض بيانات العرض كما ستظهر في الإيصال أو ملف الحفظ.</p>
          </div>

          <div className="grid gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 md:grid-cols-2">
            <div>
              <p className="text-xs font-bold text-slate-500">الزبون</p>
              <p className="mt-1 text-sm font-semibold text-slate-800">{client.name}</p>
            </div>
            <div>
              <p className="text-xs font-bold text-slate-500">سبب إنشاء المهمة</p>
              <p className="mt-1 text-sm font-semibold text-slate-800">{reasonLabel}</p>
            </div>
            <div>
              <p className="text-xs font-bold text-slate-500">تاريخ الاستحقاق</p>
              <p className="mt-1 text-sm font-semibold text-slate-800">{dueDate}</p>
            </div>
            <div>
              <p className="text-xs font-bold text-slate-500">الأولوية</p>
              <p className="mt-1 text-sm font-semibold text-slate-800">{priority || 'غير محددة'}</p>
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <div className="border-b border-slate-100 bg-slate-50 px-4 py-3 font-bold text-slate-700">تفاصيل العرض</div>
            <div className="divide-y divide-slate-100 px-4">
              <div className="flex items-center justify-between gap-4 py-3"><span className="text-slate-500">الجهاز</span><strong className="text-slate-800">{deviceName}</strong></div>
              <div className="flex items-center justify-between gap-4 py-3"><span className="text-slate-500">الكمية</span><strong className="text-slate-800">{quantity}</strong></div>
              <div className="flex items-center justify-between gap-4 py-3"><span className="text-slate-500">نوع العرض</span><strong className="text-slate-800">{offer.offerType === 'installment' ? 'تقسيط' : 'كاش'}</strong></div>
              <div className="flex items-center justify-between gap-4 py-3"><span className="text-slate-500">سعر الوحدة</span><strong className="text-slate-800">{unitAmountLabel}</strong></div>
              <div className="flex items-center justify-between gap-4 py-3"><span className="text-slate-500">الإجمالي</span><strong className="text-slate-800">{grandTotal}</strong></div>
              <div className="flex items-center justify-between gap-4 py-3"><span className="text-slate-500">الحسم</span><strong className="text-slate-800">{discount > 0 ? `${discount}%` : 'بدون حسم'}</strong></div>
              {offer.offerType === 'installment' && (
                <>
                  <div className="flex items-center justify-between gap-4 py-3"><span className="text-slate-500">الدفعة الأولى</span><strong className="text-slate-800">{formatAmount(parsePositiveNumber(offer.firstPaymentAmount) ?? 0, currency)}</strong></div>
                  <div className="flex items-center justify-between gap-4 py-3"><span className="text-slate-500">عدد الأشهر</span><strong className="text-slate-800">{parsePositiveInteger(offer.installmentMonths) ?? 0}</strong></div>
                </>
              )}
              <div className="flex items-center justify-between gap-4 py-3"><span className="text-slate-500">الموظف</span><strong className="text-slate-800">{employeeName ?? '—'}</strong></div>
              <div className="flex items-center justify-between gap-4 py-3"><span className="text-slate-500">سبب عدم التسكير</span><strong className="text-slate-800">{offer.noClosingReason ? getNoClosingReasonLabel(offer.noClosingReason) : '—'}</strong></div>
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
  onCreated: () => void;
}

export default function DeviceOfferModal({ isOpen, onClose, client, onCreated }: DeviceOfferModalProps) {
  const [deviceModels, setDeviceModels] = useState<DeviceModel[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [creationReasons, setCreationReasons] = useState<CreationReasonOption[]>(FALLBACK_CREATION_REASONS);
  const [preOffers, setPreOffers] = useState<PreOfferDraft[]>([]);
  const [draftOffer, setDraftOffer] = useState<PreOfferDraft>(createPreOfferDraft());
  const [dueDate, setDueDate] = useState('');
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [priority, setPriority] = useState<'' | 'high' | 'medium' | 'low'>('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [receiptOfferIndex, setReceiptOfferIndex] = useState<number | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    setLoading(true);
    setError('');
    Promise.all([
      api.deviceModels.list(),
      api.employees.list(),
      api.systemLists.getItemsByCode('open_task_reasons'),
    ])
      .then(([models, employeeRows, reasonRows]) => {
        setDeviceModels(models);
        setEmployees(employeeRows.filter((employee) => employee.status === 'active'));
        setCreationReasons(buildReasonOptions(reasonRows as SystemList[]));
        setReason((current) => current || '');
      })
      .catch((err: any) => setError(err.message || 'فشل في تحميل البيانات'))
      .finally(() => setLoading(false));
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    setPreOffers([]);
    setDraftOffer(createPreOfferDraft());
    setDueDate('');
    setReason('');
    setNotes('');
    setPriority('');
    setReceiptOfferIndex(null);
    setError('');
  }, [isOpen]);

  if (!isOpen) return null;

  const reasonLabel = creationReasons.find((item) => item.value === reason)?.label || '—';
  const usedOfferDeviceIds = new Set(preOffers.map((offer) => offer.deviceModelId));
  const availableDraftDeviceModels = deviceModels.filter((model) => !usedOfferDeviceIds.has(String(model.id)));

  const handleAddOffer = () => {
    if (deviceModels.length === 0) {
      setError('لا توجد أجهزة متاحة');
      return;
    }

    const validationError = validateOfferDraft(draftOffer, 'العرض الجديد');
    if (validationError) {
      setError(validationError);
      return;
    }

    if (preOffers.some((item) => item.deviceModelId === draftOffer.deviceModelId)) {
      setError('هذا الجهاز مستخدم في عرض آخر');
      return;
    }

    setPreOffers((current) => [...current, { ...draftOffer }]);
    setDraftOffer(createPreOfferDraft());
    setError('');
  };

  const updateDraftOffer = (field: keyof PreOfferDraft, value: string) => {
    setDraftOffer((current) => ({ ...current, [field]: value }));
  };

  const validateOfferDraft = (offer: PreOfferDraft, label: string): string => {
    if (!offer.deviceModelId) return `يرجى اختيار الجهاز في ${label}`;
    if (!offer.offerType) return `يرجى اختيار نوع العرض في ${label}`;
    if (!parsePositiveNumber(offer.totalAmount)) return `يرجى إدخال قيمة العرض في ${label}`;
    if (!offer.currency.trim()) return `يرجى إدخال العملة في ${label}`;
    if (offer.offerType === 'installment') {
      if (!parsePositiveNumber(offer.firstPaymentAmount) || !parsePositiveInteger(offer.installmentMonths)) {
        return `يرجى استكمال بيانات التقسيط في ${label}`;
      }
    }
    return '';
  };

  const openReceipt = (index: number) => {
    const offer = preOffers[index];
    if (!offer) return;
    const validationError = validateOfferDraft(offer, `العرض رقم ${index + 1}`);
    if (validationError) {
      setError(validationError);
      return;
    }
    setError('');
    setReceiptOfferIndex(index);
  };

  const handleSubmit = async () => {
    setError('');

    if (!dueDate) {
      setError('تاريخ مستحق مطلوب');
      return;
    }
    if (!reason) {
      setError('سبب إنشاء المهمة مطلوب');
      return;
    }
    if (preOffers.length === 0) {
      setError('أضف عرضًا واحدًا على الأقل');
      return;
    }

    const seenDevices = new Set<string>();
    for (const [index, offer] of preOffers.entries()) {
      const validationError = validateOfferDraft(offer, `العرض رقم ${index + 1}`);
      if (validationError) {
        setError(validationError);
        return;
      }
      if (seenDevices.has(offer.deviceModelId)) {
        setError('لا يمكن تكرار نفس الجهاز في أكثر من عرض');
        return;
      }
      seenDevices.add(offer.deviceModelId);
    }

    const normalizedDevices = Array.from(new Set(preOffers.map((offer) => offer.deviceModelId)))
      .map((deviceModelId) => ({
        deviceModelId: Number(deviceModelId),
        quantity: 1,
      }))
      .filter((item) => Number.isInteger(item.deviceModelId) && item.deviceModelId > 0);

    const normalizedOffers = preOffers.map((offer) => ({
      deviceModelId: Number(offer.deviceModelId),
      offerType: offer.offerType,
      quantity: parsePositiveInteger(offer.quantity) ?? 1,
      totalAmount: parsePositiveNumber(offer.totalAmount) ?? 0,
      firstPaymentAmount: offer.firstPaymentAmount ? parsePositiveNumber(offer.firstPaymentAmount) : null,
      installmentMonths: offer.installmentMonths ? parsePositiveInteger(offer.installmentMonths) : null,
      currency: offer.currency,
      discountPercentage: offer.discountPercentage ? Number(offer.discountPercentage) : null,
      closedByEmployeeId: offer.closedByEmployeeId ? Number(offer.closedByEmployeeId) : null,
      noClosingReason: offer.noClosingReason.trim() || null,
    }));

    setSaving(true);
    try {
      await api.openTasks.create({
        clientId: client.id,
        branchId: client.branchId,
        dueDate,
        reason,
        priority: priority || null,
        notes: notes.trim() || null,
        devices: normalizedDevices,
        preOffers: normalizedOffers,
      });
      onCreated();
    } catch (err: any) {
      setError(err.message || 'فشل في إنشاء المهمة');
    } finally {
      setSaving(false);
    }
  };

  const reasonOptions = creationReasons;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4" dir="rtl">
      <div className="w-full max-w-5xl rounded-3xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div>
            <h3 className="text-lg font-black text-slate-800">إضافة عرض جهاز</h3>
            <p className="mt-1 text-xs text-slate-500">{client.name}</p>
          </div>
          <button onClick={onClose} className="rounded-xl p-2 text-slate-400 hover:bg-slate-50 hover:text-slate-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="max-h-[80vh] overflow-y-auto bg-slate-50/50 px-6 py-6 space-y-6">
          {loading ? (
            <div className="py-16 text-center"><Loader2 className="mx-auto w-8 h-8 animate-spin text-slate-300" /></div>
          ) : (
            <>
              <section className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h4 className="text-sm font-black text-slate-800">العروض المسبقة</h4>
                    <p className="text-xs text-slate-500">أضف العرض في النموذج التالي، ثم يظهر مباشرة داخل جدول منظم مع إمكانية فتح الإيصال من نفس السطر.</p>
                  </div>
                  <button
                    type="button"
                    onClick={handleAddOffer}
                    className="inline-flex items-center gap-1 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-bold text-sky-700 hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={deviceModels.length === 0}
                  >
                    <Plus className="w-3.5 h-3.5" /> تثبيت العرض
                  </button>
                </div>

                {deviceModels.length === 0 ? (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                    لا توجد أجهزة متاحة الآن.
                  </div>
                ) : (
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <div className="space-y-2 xl:col-span-2">
                      <label className="text-sm font-bold text-slate-700">الجهاز</label>
                      <select
                        value={draftOffer.deviceModelId}
                        onChange={(event) => updateDraftOffer('deviceModelId', event.target.value)}
                        className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm"
                      >
                        <option value="">اختر الجهاز...</option>
                        {availableDraftDeviceModels.map((model) => (
                          <option key={model.id} value={model.id}>
                            {model.nameAr || model.name}
                          </option>
                        ))}
                      </select>
                      {availableDraftDeviceModels.length === 0 && (
                        <p className="text-xs text-slate-400">كل الأجهزة الحالية لديها عروض مثبتة بالفعل.</p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-bold text-slate-700">نوع العرض</label>
                      <select
                        value={draftOffer.offerType}
                        onChange={(event) => updateDraftOffer('offerType', event.target.value as PreOfferDraft['offerType'])}
                        className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm"
                      >
                        <option value="">اختر نوع العرض...</option>
                        <option value="cash">كاش</option>
                        <option value="installment">تقسيط</option>
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-bold text-slate-700">الكمية</label>
                      <input
                        type="number"
                        min="1"
                        value={draftOffer.quantity}
                        onChange={(event) => updateDraftOffer('quantity', event.target.value)}
                        className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm"
                        placeholder="1"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-bold text-slate-700">العملة</label>
                      <input
                        value={draftOffer.currency}
                        onChange={(event) => updateDraftOffer('currency', event.target.value)}
                        className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm"
                        placeholder="SYP"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-bold text-slate-700">سعر الوحدة</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={draftOffer.totalAmount}
                        onChange={(event) => updateDraftOffer('totalAmount', event.target.value)}
                        className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm"
                        placeholder="0"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-bold text-slate-700">الحسم %</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={draftOffer.discountPercentage}
                        onChange={(event) => updateDraftOffer('discountPercentage', event.target.value)}
                        className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm"
                        placeholder="0"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-bold text-slate-700">موظف التسكير</label>
                      <select
                        value={draftOffer.closedByEmployeeId}
                        onChange={(event) => updateDraftOffer('closedByEmployeeId', event.target.value)}
                        className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm"
                      >
                        <option value="">اختياري</option>
                        {employees.map((employee) => (
                          <option key={employee.id} value={employee.id}>{employee.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-bold text-slate-700">سبب عدم التسكير</label>
                      <select
                        value={draftOffer.noClosingReason}
                        onChange={(event) => updateDraftOffer('noClosingReason', event.target.value)}
                        className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm"
                      >
                        {NO_CLOSING_REASON_OPTIONS.map((option) => (
                          <option key={option.value || 'empty'} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    {draftOffer.offerType === 'installment' && (
                      <>
                        <div className="space-y-2">
                          <label className="text-sm font-bold text-slate-700">الدفعة الأولى</label>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={draftOffer.firstPaymentAmount}
                            onChange={(event) => updateDraftOffer('firstPaymentAmount', event.target.value)}
                            className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm"
                            placeholder="0"
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-bold text-slate-700">عدد الأشهر</label>
                          <input
                            type="number"
                            min="1"
                            value={draftOffer.installmentMonths}
                            onChange={(event) => updateDraftOffer('installmentMonths', event.target.value)}
                            className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm"
                            placeholder="12"
                          />
                        </div>
                      </>
                    )}
                  </div>
                )}

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
                          const deviceName = deviceModels.find((model) => String(model.id) === offer.deviceModelId)?.nameAr
                            || deviceModels.find((model) => String(model.id) === offer.deviceModelId)?.name
                            || '—';
                          const closingLabel = offer.closedByEmployeeId
                            ? employees.find((employee) => String(employee.id) === offer.closedByEmployeeId)?.name || offer.closedByEmployeeId
                            : offer.noClosingReason
                              ? getNoClosingReasonLabel(offer.noClosingReason)
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
                                  <button
                                    type="button"
                                    onClick={() => openReceipt(index)}
                                    className="inline-flex items-center gap-1 rounded-lg border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-bold text-sky-700 hover:bg-sky-100"
                                  >
                                    <CheckCircle2 className="h-3.5 w-3.5" /> فتح الإيصال
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setPreOffers((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                                    className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-bold text-red-700 hover:bg-red-100"
                                  >
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

              <section className="grid gap-4 rounded-2xl border border-slate-200 bg-white p-5 md:grid-cols-3">
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">سبب إنشاء المهمة <span className="text-red-500">*</span></label>
                  <select value={reason} onChange={(event) => setReason(event.target.value)} className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm">
                    <option value="">اختر السبب...</option>
                    {reasonOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">تاريخ مستحق <span className="text-red-500">*</span></label>
                  <input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">الأولوية</label>
                  <select value={priority} onChange={(event) => setPriority(event.target.value as '' | 'high' | 'medium' | 'low')} className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm">
                    <option value="">غير محددة</option>
                    <option value="high">عالية</option>
                    <option value="medium">متوسطة</option>
                    <option value="low">منخفضة</option>
                  </select>
                </div>
                <div className="space-y-2 md:col-span-3">
                  <label className="text-sm font-bold text-slate-700">ملاحظات</label>
                  <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm" />
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
          <button onClick={handleSubmit} disabled={saving || loading} className="inline-flex items-center gap-2 rounded-xl bg-sky-600 px-5 py-2 text-sm font-bold text-white hover:bg-sky-700 disabled:opacity-60">
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
          deviceName={deviceModels.find((model) => String(model.id) === preOffers[receiptOfferIndex].deviceModelId)?.nameAr
            || deviceModels.find((model) => String(model.id) === preOffers[receiptOfferIndex].deviceModelId)?.name
            || '—'}
          offer={preOffers[receiptOfferIndex]}
          employees={employees}
          dueDate={dueDate}
          priority={priority}
          reasonLabel={reasonLabel}
        />
      )}
    </div>
  );
}
