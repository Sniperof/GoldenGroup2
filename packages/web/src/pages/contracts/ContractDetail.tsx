import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AlertCircle, ArrowRight, Calendar, CheckCircle2, ClipboardList,
  CreditCard, ExternalLink, FileText, Loader2, MapPin, Monitor,
  Navigation, Phone, User, Wrench, Zap, X,
} from 'lucide-react';
import { api } from '../../lib/api';

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_META: Record<string, { label: string; badge: string; dot: string }> = {
  active:    { label: 'نشط',    badge: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500' },
  cancelled: { label: 'ملغى',   badge: 'bg-red-50 text-red-600 border-red-200',             dot: 'bg-red-400' },
  temporary: { label: 'مؤقت',   badge: 'bg-amber-50 text-amber-700 border-amber-200',       dot: 'bg-amber-500' },
};

const DUE_STATUS_META: Record<string, { label: string; cls: string }> = {
  Pending: { label: 'معلّق',   cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  Partial: { label: 'جزئي',   cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  Paid:    { label: 'مدفوع',  cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  Overdue: { label: 'متأخر',  cls: 'bg-red-50 text-red-700 border-red-200' },
};

const TASK_STATUS: Record<string, { label: string; cls: string }> = {
  open:            { label: 'مفتوحة',        cls: 'bg-sky-50 text-sky-700 border-sky-200' },
  assigned:        { label: 'مسندة',         cls: 'bg-violet-50 text-violet-700 border-violet-200' },
  in_scheduling:   { label: 'قيد الجدولة',   cls: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  scheduled:       { label: 'مجدولة',        cls: 'bg-teal-50 text-teal-700 border-teal-200' },
  in_execution:    { label: 'قيد التنفيذ',   cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  completed:       { label: 'مكتملة',        cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  closed:          { label: 'مغلقة',         cls: 'bg-slate-100 text-slate-600 border-slate-200' },
  cancelled:       { label: 'ملغاة',         cls: 'bg-red-50 text-red-600 border-red-200' },
  needs_follow_up: { label: 'متابعة',        cls: 'bg-orange-50 text-orange-700 border-orange-200' },
};

const SALE_TYPE_LABELS: Record<string, string> = {
  tradein: 'استبدال', retention: 'احتفاظ', direct: 'بيع مباشر',
};

const SALE_SOURCE_LABELS: Record<string, string> = {
  device_demo_task: 'مهمة عرض جهاز', app: 'التطبيق', social_media: 'وسائل التواصل',
};

const PAYMENT_LABELS: Record<string, string> = { cash: 'نقدي', installment: 'أقساط' };

const MAINTENANCE_LABELS: Record<string, string> = {
  '3': '3 أشهر', '6': '6 أشهر', '12': 'سنة', '24': 'سنتان',
};

function formatDate(d?: string | null) {
  if (!d) return '—';
  try { return new Date(d.slice(0, 10) + 'T00:00:00').toLocaleDateString('ar-SY', { day: 'numeric', month: 'long', year: 'numeric' }); }
  catch { return d; }
}
function formatMoney(n?: number | null) {
  if (n == null) return '—';
  return String(Number(n)) + ' ل.س';
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionCard({ title, icon: Icon, children, accent }: {
  title: string; icon: React.ElementType; children: React.ReactNode; accent?: string;
}) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
      <div className={`flex items-center gap-2.5 px-5 py-3.5 border-b border-slate-100 ${accent ?? 'bg-slate-50/60'}`}>
        <Icon className="h-4 w-4 text-slate-400 shrink-0" />
        <h3 className="text-sm font-bold text-slate-700">{title}</h3>
      </div>
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5 border-b border-slate-50 last:border-0">
      <span className="text-xs font-semibold text-slate-400 shrink-0">{label}</span>
      <span className="text-sm font-medium text-slate-800 text-left">{value ?? '—'}</span>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ContractDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showActivateModal, setShowActivateModal] = useState(false);
  const [activatePaymentType, setActivatePaymentType] = useState<'cash' | 'installment'>('cash');
  const [activateFinalPrice, setActivateFinalPrice] = useState<number>(0);
  const [activateDownPayment, setActivateDownPayment] = useState<number>(0);
  const [activateInstallmentsCount, setActivateInstallmentsCount] = useState<number>(6);
  const [actionLoading, setActionLoading] = useState(false);
  const [activationLoading, setActivationLoading] = useState(false);

  useEffect(() => {
    if (data && activateFinalPrice === 0) {
      setActivateFinalPrice(Number(data.finalPrice) || 0);
    }
  }, [data]);

  const handleCancelContract = async () => {
    if (!window.confirm('هل أنت متأكد من إلغاء هذا العقد؟')) return;
    setActionLoading(true);
    try {
      const updated = await api.contracts.update(Number(id), {
        ...data,
        status: 'cancelled'
      });
      setData(updated);
      alert('تم إلغاء العقد بنجاح');
    } catch (err: any) {
      alert('فشل إلغاء العقد: ' + (err.message || err));
    } finally {
      setActionLoading(false);
    }
  };

  const handleActivatePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (activateFinalPrice <= 0) {
      alert('الرجاء إدخال السعر النهائي');
      return;
    }
    if (activatePaymentType === 'installment' && activateDownPayment >= activateFinalPrice) {
      alert('الدفعة الأولى يجب أن تكون أقل من السعر النهائي');
      return;
    }

    setActivationLoading(true);
    try {
      const contractId = Number(id);
      
      // 1. Generate payment entries
      const paymentEntries = [];
      if (activatePaymentType === 'cash') {
        paymentEntries.push({
          method: 'cash',
          currency: 'SYP',
          amountValue: activateFinalPrice,
          amountSyp: activateFinalPrice,
          notes: 'دفعة كاملة لتنشيط العقد القطعي'
        });
      } else if (activatePaymentType === 'installment' && activateDownPayment > 0) {
        paymentEntries.push({
          method: 'cash',
          currency: 'SYP',
          amountValue: activateDownPayment,
          amountSyp: activateDownPayment,
          notes: 'الدفعة الأولى لتنشيط العقد القطعي'
        });
      }

      // 2. Generate installments
      const installments = [];
      if (activatePaymentType === 'installment') {
        const remainingAmount = activateFinalPrice - activateDownPayment;
        const baseAmount = Math.floor(remainingAmount / activateInstallmentsCount);
        const baseDate = new Date();
        
        let distributed = 0;
        for (let i = 1; i <= activateInstallmentsCount; i++) {
          const dueDate = new Date(baseDate);
          dueDate.setMonth(baseDate.getMonth() + i);
          
          let amount = baseAmount;
          if (i === activateInstallmentsCount) {
            amount = remainingAmount - distributed;
          } else {
            distributed += baseAmount;
          }

          installments.push({
            installmentNumber: i,
            dueDate: dueDate.toISOString().slice(0, 10),
            amountSyp: amount
          });
        }
      }

      // 3. Perform backend updates
      // A. Update contract financials and subtype
      await api.contracts.update(contractId, {
        ...data,
        status: 'active',
        saleSubtype: 'definitive',
        paymentType: activatePaymentType,
        basePrice: activateFinalPrice,
        finalPrice: activateFinalPrice,
        downPayment: activateDownPayment,
        installmentsCount: activatePaymentType === 'cash' ? 0 : activateInstallmentsCount
      });

      // B. Save payment entries if any
      if (paymentEntries.length > 0) {
        await api.contracts.savePaymentEntries(contractId, paymentEntries);
      }

      // C. Save and confirm installments if installment type
      if (activatePaymentType === 'installment') {
        await api.contracts.saveInstallments(contractId, installments);
        await api.contracts.confirmInstallments(contractId);
      }

      // 4. Retrieve fresh data and close modal
      const refreshed = await api.contracts.get(contractId);
      setData(refreshed);
      setShowActivateModal(false);
      alert('تم تنشيط عملية الدفع بنجاح وتحويل العقد إلى بيع قطعي!');
    } catch (err: any) {
      console.error('Failed to activate payment:', err);
      alert('فشل في تنشيط الدفع: ' + (err.message || err));
    } finally {
      setActivationLoading(false);
    }
  };

  useEffect(() => {
    if (!id) return;
    api.contracts.get(Number(id))
      .then(setData)
      .catch(err => setError(err.message || 'فشل التحميل'))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return (
    <div className="flex flex-col items-center justify-center gap-3 h-full text-slate-400">
      <Loader2 className="h-8 w-8 animate-spin text-sky-500" />
      <span className="text-sm font-medium">جاري تحميل تفاصيل العقد...</span>
    </div>
  );

  if (error || !data) return (
    <div className="flex flex-col items-center justify-center gap-3 h-full">
      <AlertCircle className="h-10 w-10 text-rose-300" />
      <p className="text-sm font-bold text-slate-500">{error || 'العقد غير موجود'}</p>
      <button onClick={() => navigate('/contracts')} className="text-sky-600 text-sm font-bold hover:underline">
        العودة للقائمة
      </button>
    </div>
  );

  const sm      = STATUS_META[data.status] ?? STATUS_META.active;
  const tasks   = data.tasks   ?? [];
  const client  = data.client;
  const paymentEntries  = data.paymentEntries  ?? [];
  const installments    = data.installments    ?? [];
  const lineItemsTotal  = (data.lineItems ?? []).reduce((s: number, i: any) => s + Number(i.totalPrice), 0);
  const grandTotal      = Number(data.finalPrice) || lineItemsTotal || 0;
  const totalPaid       = paymentEntries.reduce((s: number, e: any) => s + Number(e.amountSyp), 0);
  const remaining       = Math.max(0, grandTotal - totalPaid);
  const discountAmount  = data.basePrice && data.finalPrice ? Math.max(0, data.basePrice - data.finalPrice) : 0;
  const hasDiscount     = discountAmount > 0;

  const primaryPhone = client?.contacts?.find((c: any) => c.isPrimary)?.number ?? client?.mobile ?? null;
  const mapsUrl = data.installationLat && data.installationLng
    ? `https://maps.google.com/?q=${data.installationLat},${data.installationLng}`
    : null;

  return (
    <div className="h-full overflow-y-auto bg-slate-50/70 custom-scroll" dir="rtl">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-10 bg-white border-b border-slate-200 shadow-sm">
        <div className="mx-auto max-w-5xl px-4 py-3 flex items-center gap-3">
          <button onClick={() => navigate('/contracts')}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50 transition-colors">
            <ArrowRight className="h-3.5 w-3.5" /> العقود
          </button>
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <span className="font-mono font-black text-slate-900">{data.contractNumber}</span>
            <span className="text-slate-300">·</span>
            <span className="text-sm text-slate-600 truncate">{data.customerName}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className={`w-2 h-2 rounded-full ${sm.dot}`} />
            <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold ${sm.badge}`}>
              {sm.label}
            </span>
          </div>
          <button onClick={() => navigate(`/contracts/${id}/edit`)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50 transition-colors">
            تعديل
          </button>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-4 py-5 space-y-4">

        {data.status === 'temporary' && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-sm animate-fadeIn">
            <div className="flex items-start gap-3">
              <div className="bg-amber-100 text-amber-800 rounded-xl p-2 shrink-0">
                <Calendar className="h-6 w-6" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-amber-900">عقد مؤقت لمدة شهر (1 Month Trial Contract)</h4>
                <p className="text-xs text-amber-700 mt-1">
                  هذا العقد مسجل كعقد مؤقت بدون التزامات مالية حالياً. بعد انتهاء الشهر، يجب إما تنشيط الدفع ليصبح عقداً نشطاً (بيع قطعي) أو إلغاؤه.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <button
                onClick={() => setShowActivateModal(true)}
                className="bg-amber-600 hover:bg-amber-700 text-white rounded-xl px-4 py-2 text-xs font-bold transition-all shadow-sm flex items-center gap-1.5 shrink-0"
              >
                <Zap className="h-4 w-4" /> تنشيط عملية الدفع
              </button>
              <button
                disabled={actionLoading}
                onClick={handleCancelContract}
                className="bg-white hover:bg-rose-50 text-rose-600 border border-rose-200 hover:border-rose-300 rounded-xl px-4 py-2 text-xs font-bold transition-all shrink-0"
              >
                {actionLoading ? 'جاري الإلغاء...' : 'إلغاء العقد'}
              </button>
            </div>
          </div>
        )}

        {/* ── Financial summary strip ──────────────────────────────────── */}
        <div className={`grid gap-3 ${hasDiscount ? 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-6' : 'grid-cols-2 sm:grid-cols-4'}`}>
          {[
            ...(hasDiscount ? [
              { label: 'السعر الأصلي', value: formatMoney(data.basePrice), cls: 'text-slate-400 line-through decoration-2' },
            ] : []),
            { label: 'إجمالي العقد',   value: formatMoney(data.finalPrice),  cls: 'text-slate-900' },
            ...(hasDiscount ? [
              { label: 'قيمة الحسم', value: `-${formatMoney(discountAmount)}`, cls: 'text-emerald-600' },
            ] : []),
            { label: 'نوع الدفع',      value: PAYMENT_LABELS[data.paymentType] ?? data.paymentType, cls: 'text-slate-700' },
            { label: 'المدفوع',        value: formatMoney(totalPaid),         cls: 'text-emerald-700' },
            { label: 'المتبقي',        value: formatMoney(remaining),         cls: remaining > 0 ? 'text-amber-700' : 'text-emerald-700' },
          ].map(({ label, value, cls }) => (
            <div key={label} className="bg-white rounded-xl border border-slate-200 px-4 py-3">
              <p className="text-[10px] font-bold text-slate-400 mb-0.5">{label}</p>
              <p className={`text-base font-black ${cls}`}>{value}</p>
            </div>
          ))}
        </div>

        <div className="grid gap-4 lg:grid-cols-2">

          {/* ── 1. بيانات الزبون ──────────────────────────────────────── */}
          <SectionCard title="بيانات الزبون" icon={User}>
            <div className="px-5 py-4 space-y-0">
              <Row label="الاسم"   value={<button onClick={() => client && navigate(`/clients/${client.id}`)}
                  className="font-bold text-sky-600 hover:underline flex items-center gap-1">
                  {data.customerName}<ExternalLink className="h-3 w-3 opacity-60" />
                </button>} />
              {data.buyerBirthDate && <Row label="تاريخ الميلاد" value={formatDate(data.buyerBirthDate)} />}
              {data.buyerGender && <Row label="الجنس" value={data.buyerGender === 'male' ? 'ذكر' : 'أنثى'} />}
              {data.buyerMotherName && <Row label="اسم الأم" value={data.buyerMotherName} />}
              {data.buyerNationalIdRegistry && <Row label="القيد" value={data.buyerNationalIdRegistry} />}
              {data.buyerNationalIdIssuedBy && <Row label="أمانة السجل المدني" value={data.buyerNationalIdIssuedBy} />}
              {data.buyerNationalIdIssueDate && <Row label="تاريخ منح الهوية" value={formatDate(data.buyerNationalIdIssueDate)} />}
              {data.buyerNationalIdBox && <Row label="الخانة" value={data.buyerNationalIdBox} />}
              <Row label="الهاتف" value={primaryPhone
                ? <a href={`tel:${primaryPhone}`} className="font-mono font-bold text-slate-700 hover:text-sky-600 flex items-center gap-1.5">
                    <Phone className="h-3 w-3" />{primaryPhone}
                  </a>
                : null} />
              <Row label="التقييم" value={client?.rating === 'Committed'
                ? <span className="text-xs font-bold text-emerald-600">ملتزم</span>
                : client?.rating === 'NotCommitted'
                  ? <span className="text-xs font-bold text-rose-600">غير ملتزم</span>
                  : null} />
            </div>
          </SectionCard>

          {/* ── 2. تفاصيل العقد ───────────────────────────────────────── */}
          <SectionCard title="تفاصيل العقد" icon={FileText}>
            <div className="px-5 py-4 space-y-0">
              <Row label="تاريخ العقد"    value={formatDate(data.contractDate)} />
              <Row label="نوع البيع"      value={SALE_TYPE_LABELS[data.saleType] ?? data.saleType} />
              {data.saleSource && <Row label="مصدر البيع" value={SALE_SOURCE_LABELS[data.saleSource] ?? data.saleSource} />}
              {data.saleSource === 'device_demo_task' && data.sourceVisit && (
                <Row label="رقم مهمة العرض" value={<span className="font-mono">{data.sourceVisit}</span>} />
              )}
              {data.discount && (
                <>
                  <Row label="الحسم المطبق" value={
                    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                      {data.discount.label} — {data.discount.percentage}%
                    </span>
                  } />
                  {discountAmount > 0 && (
                    <Row label="مبلغ الحسم" value={
                      <span className="text-emerald-600 font-bold">-{formatMoney(discountAmount)}</span>
                    } />
                  )}
                </>
              )}
              <Row label="خطة الصيانة"   value={MAINTENANCE_LABELS[data.maintenancePlan] ?? data.maintenancePlan} />
              <Row label="تاريخ التسليم" value={formatDate(data.deliveryDate)} />
              <Row label="تاريخ التركيب" value={formatDate(data.installationDate)} />
            </div>
          </SectionCard>

          {/* ── 3. الجهاز ─────────────────────────────────────────────── */}
          <SectionCard title="الجهاز" icon={Monitor}>
            <div className="px-5 py-4 space-y-0">
              <Row label="الموديل"        value={<span className="font-bold">{data.deviceModelName}</span>} />
              <Row label="الرقم التسلسلي" value={<span className="font-mono text-slate-600">{data.serialNumber}</span>} />
              <Row label="خطة الصيانة"   value={MAINTENANCE_LABELS[data.maintenancePlan] ?? data.maintenancePlan} />
            </div>
          </SectionCard>

          {/* ── 4. موقع الجهاز ────────────────────────────────────────── */}
          <SectionCard title="موقع التركيب" icon={MapPin}>
            <div className="px-5 py-4 space-y-3">
              {data.installationAddressText && (
                <p className="text-sm text-slate-700 leading-relaxed">{data.installationAddressText}</p>
              )}
              {mapsUrl && (
                <a href={mapsUrl} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700 hover:bg-emerald-100 transition-colors">
                  <Navigation className="h-3.5 w-3.5" />
                  فتح على الخريطة
                  <ExternalLink className="h-3 w-3 opacity-50" />
                </a>
              )}
              {!data.installationAddressText && !mapsUrl && (
                <p className="text-sm text-slate-400">لم يُسجَّل موقع التركيب</p>
              )}
            </div>
          </SectionCard>
        </div>

        {/* ── 5. بنود العقد ───────────────────────────────────────────── */}
        {(data.lineItems ?? []).length > 0 && (
          <SectionCard title={`بنود العقد (${(data.lineItems ?? []).length})`} icon={FileText}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-y border-slate-100 text-[11px] font-bold text-slate-500">
                  <tr>
                    <th className="px-4 py-2.5 text-right">#</th>
                    <th className="px-4 py-2.5 text-right">النوع</th>
                    <th className="px-4 py-2.5 text-right">البيان</th>
                    <th className="px-4 py-2.5 text-right">الكمية</th>
                    <th className="px-4 py-2.5 text-right">سعر الوحدة</th>
                    <th className="px-4 py-2.5 text-right">الإجمالي</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {(data.lineItems ?? []).map((item: any, i: number) => (
                    <tr key={item.id ?? i} className="hover:bg-slate-50/60 transition-colors">
                      <td className="px-4 py-3 text-slate-400 font-mono text-xs">{i + 1}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                          item.itemType === 'device'      ? 'bg-sky-50 text-sky-700 border-sky-200' :
                          item.itemType === 'accessory'   ? 'bg-purple-50 text-purple-700 border-purple-200' :
                          'bg-amber-50 text-amber-700 border-amber-200'
                        }`}>
                          {item.itemType === 'device' ? 'جهاز' : item.itemType === 'accessory' ? 'ملحق' : 'رسوم خدمة'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-700 font-medium">{item.description ?? '—'}</td>
                      <td className="px-4 py-3 text-slate-600">{item.quantity}</td>
                      <td className="px-4 py-3 font-mono text-slate-600">{formatMoney(item.unitPrice)}</td>
                      <td className="px-4 py-3 font-bold text-slate-800">{formatMoney(item.totalPrice)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-slate-50 border-t border-slate-200 text-xs font-bold">
                  <tr>
                    <td colSpan={5} className="px-4 py-2.5 text-slate-500">المجموع</td>
                    <td className="px-4 py-2.5 text-slate-800">
                      {formatMoney((data.lineItems ?? []).reduce((s: number, i: any) => s + Number(i.totalPrice), 0))}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </SectionCard>
        )}

        {/* ── 6. دفعات العقد ──────────────────────────────────────────── */}
        <SectionCard title={`دفعات العقد (${paymentEntries.length})`} icon={CreditCard}>
          {paymentEntries.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-slate-400">لا توجد دفعات مسجلة</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-y border-slate-100 text-[11px] font-bold text-slate-500">
                  <tr>
                    <th className="px-4 py-2.5 text-right">#</th>
                    <th className="px-4 py-2.5 text-right">الطريقة</th>
                    <th className="px-4 py-2.5 text-right">العملة</th>
                    <th className="px-4 py-2.5 text-right">المبلغ</th>
                    <th className="px-4 py-2.5 text-right">المكافئ ل.س</th>
                    <th className="px-4 py-2.5 text-right">رقم المرجع</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {paymentEntries.map((e: any, i: number) => {
                    const methodLabels: Record<string, string> = {
                      cash: 'نقد', sham_cash: 'شام كاش', syriatel_cash: 'سيرياتيل كاش',
                      mtn_cash: 'MTN كاش', alharam: 'الهرم', bank_transfer: 'حوالة بنكية',
                      barter: 'مقايضة', usd_cash: 'دولار نقدي',
                    };
                    return (
                      <tr key={e.id ?? i} className="hover:bg-slate-50/60 transition-colors">
                        <td className="px-4 py-3 text-slate-400 font-mono text-xs">{i + 1}</td>
                        <td className="px-4 py-3 text-slate-700">{methodLabels[e.method] ?? e.method}</td>
                        <td className="px-4 py-3 text-slate-500">{e.currency}</td>
                        <td className="px-4 py-3 font-mono text-slate-700">
                          {e.method === 'barter'
                            ? <span className="text-xs text-purple-600">{e.barterName}</span>
                            : `${String(Number(e.amountValue))} ل.س`
                          }
                        </td>
                        <td className="px-4 py-3 font-bold text-slate-800 font-mono">{formatMoney(Number(e.amountSyp))}</td>
                        <td className="px-4 py-3 text-slate-500 font-mono text-xs">{e.referenceNumber ?? '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="bg-slate-50 border-t border-slate-200 text-xs font-bold">
                  <tr>
                    <td colSpan={4} className="px-4 py-2.5 text-slate-500">المجموع المدفوع</td>
                    <td className="px-4 py-2.5 text-emerald-700 font-mono">{formatMoney(totalPaid)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </SectionCard>

        {/* ── 7. جدول الأقساط ──────────────────────────────────────────── */}
        {data.paymentType === 'installment' && (
          <SectionCard title={`جدول الأقساط (${installments.length})`} icon={Calendar}>
            {installments.length === 0 ? (
              <div className="px-5 py-8 text-center text-sm text-slate-400">لا توجد أقساط مسجلة</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-y border-slate-100 text-[11px] font-bold text-slate-500">
                    <tr>
                      <th className="px-4 py-2.5 text-right">#</th>
                      <th className="px-4 py-2.5 text-right">تاريخ الاستحقاق</th>
                      <th className="px-4 py-2.5 text-right">المبلغ</th>
                      <th className="px-4 py-2.5 text-right">المدفوع</th>
                      <th className="px-4 py-2.5 text-right">المتبقي</th>
                      <th className="px-4 py-2.5 text-center">الحالة</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {installments.map((inst: any, i: number) => {
                      const statusCls: Record<string, string> = {
                        pending: 'bg-amber-50 text-amber-700 border-amber-200',
                        paid:    'bg-emerald-50 text-emerald-700 border-emerald-200',
                        partial: 'bg-blue-50 text-blue-700 border-blue-200',
                        overdue: 'bg-red-50 text-red-700 border-red-200',
                      };
                      const statusLabel: Record<string, string> = {
                        pending: 'معلق', paid: 'مدفوع', partial: 'جزئي', overdue: 'متأخر',
                      };
                      const isOverdue = inst.status === 'pending' && inst.dueDate && new Date(inst.dueDate) < new Date();
                      return (
                        <tr key={inst.id ?? i} className={`hover:bg-slate-50/60 ${isOverdue ? 'bg-red-50/30' : ''}`}>
                          <td className="px-4 py-3 text-slate-400 font-mono text-xs">{inst.installmentNumber}</td>
                          <td className="px-4 py-3 text-slate-600 flex items-center gap-1.5">
                            <Calendar className="h-3 w-3 text-slate-300" />{formatDate(inst.dueDate)}
                          </td>
                          <td className="px-4 py-3 font-bold text-slate-800 font-mono">{formatMoney(Number(inst.amountSyp))}</td>
                          <td className="px-4 py-3 text-emerald-700 font-mono">{formatMoney(Number(inst.paidAmount))}</td>
                          <td className="px-4 py-3 text-amber-700 font-mono">{formatMoney(Number(inst.remainingBalance))}</td>
                          <td className="px-4 py-3 text-center">
                            <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-[10px] font-bold ${isOverdue ? 'bg-red-50 text-red-700 border-red-200' : (statusCls[inst.status] ?? statusCls.pending)}`}>
                              {isOverdue ? 'متأخر' : (statusLabel[inst.status] ?? inst.status)}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
        )}

        {/* ── 8. بيانات التسكير ────────────────────────────────────────── */}
        {(data.receiptNumber || data.invoiceNotes || data.closingEmployeeId) && (
          <SectionCard title="بيانات التسكير" icon={CheckCircle2}>
            <div className="px-5 py-4 space-y-0">
              {data.receiptNumber && <Row label="رقم الإيصال" value={<span className="font-mono">{data.receiptNumber}</span>} />}
              {data.closingEmployeeId && <Row label="معرّف موظف التسكير" value={<span className="font-mono">{data.closingEmployeeId}</span>} />}
              {data.invoiceNotes && <Row label="ملاحظات الفاتورة" value={<span className="text-slate-600 text-xs leading-relaxed">{data.invoiceNotes}</span>} />}
            </div>
          </SectionCard>
        )}

        {/* ── 9. المهام المرتبطة ───────────────────────────────────────── */}
        <SectionCard title={`المهام المرتبطة (${tasks.length})`} icon={ClipboardList}>
          {tasks.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-slate-400">لا توجد مهام مرتبطة بهذا العقد</div>
          ) : (
            <div className="divide-y divide-slate-100">
              {tasks.map((t: any) => {
                const ts = TASK_STATUS[t.status] ?? { label: t.status, cls: 'bg-slate-100 text-slate-500 border-slate-200' };
                const isEmergency = t.taskFamily === 'emergency' || t.taskType === 'emergency_maintenance';
                const path = isEmergency ? `/tasks/emergency/${t.id}` : `/tasks/device-demo/${t.id}`;
                return (
                  <div key={t.id} className="flex items-center justify-between gap-4 px-5 py-3.5 hover:bg-slate-50/60 transition-colors">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={`w-8 h-8 rounded-xl flex items-center justify-center border shrink-0 ${isEmergency ? 'bg-rose-50 border-rose-200' : 'bg-sky-50 border-sky-200'}`}>
                        {isEmergency ? <Zap className="h-3.5 w-3.5 text-rose-500" /> : <Wrench className="h-3.5 w-3.5 text-sky-500" />}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-slate-800">{t.taskLabel || t.taskType}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className={`text-[10px] font-bold rounded-full border px-2 py-0.5 ${ts.cls}`}>{ts.label}</span>
                          {t.dueDate && <span className="text-[10px] text-slate-400 flex items-center gap-0.5"><Calendar className="h-2.5 w-2.5" />{formatDate(t.dueDate)}</span>}
                        </div>
                      </div>
                    </div>
                    <button onClick={() => navigate(path)}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-bold text-slate-500 hover:bg-slate-100 transition-colors shrink-0">
                      <ExternalLink className="h-3 w-3" /> تفاصيل
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </SectionCard>

      </div>

      {showActivateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <div className="bg-white rounded-3xl border border-slate-200 w-full max-w-md overflow-hidden shadow-2xl animate-scaleUp">
            <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100 bg-slate-50/60">
              <div className="flex items-center gap-2">
                <Zap className="h-5 w-5 text-amber-500" />
                <h3 className="text-base font-bold text-slate-800">تنشيط عملية الدفع (بيع قطعي)</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowActivateModal(false)}
                className="text-slate-400 hover:text-slate-600 rounded-lg p-1 hover:bg-slate-100 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleActivatePayment} className="p-6 space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-500">طريقة الدفع (Payment Type)</label>
                <select
                  value={activatePaymentType}
                  onChange={(e) => setActivatePaymentType(e.target.value as 'cash' | 'installment')}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-medium text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="cash">نقدي (Cash)</option>
                  <option value="installment">أقساط (Installment)</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-500">السعر النهائي (Final Price - SYP)</label>
                <input
                  type="number"
                  required
                  min="0"
                  placeholder="مثال: 1500000"
                  value={activateFinalPrice || ''}
                  onChange={(e) => setActivateFinalPrice(Number(e.target.value) || 0)}
                  className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm font-medium text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono text-left"
                  dir="ltr"
                />
              </div>

              {activatePaymentType === 'installment' && (
                <>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-500">الدفعة الأولى (Down Payment - SYP)</label>
                    <input
                      type="number"
                      required
                      min="0"
                      value={activateDownPayment || ''}
                      onChange={(e) => setActivateDownPayment(Number(e.target.value) || 0)}
                      className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm font-medium text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono text-left"
                      dir="ltr"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-500">عدد الأقساط الشهرية (Installment Months)</label>
                    <input
                      type="number"
                      required
                      min="1"
                      value={activateInstallmentsCount || ''}
                      onChange={(e) => setActivateInstallmentsCount(Number(e.target.value) || 6)}
                      className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm font-medium text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono text-left"
                      dir="ltr"
                    />
                  </div>
                </>
              )}

              <div className="flex items-center gap-3 pt-4 border-t border-slate-100 mt-6">
                <button
                  type="submit"
                  disabled={activationLoading}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white rounded-xl py-3 text-sm font-bold transition-all shadow-md flex items-center justify-center gap-1.5"
                >
                  {activationLoading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> جاري التنشيط...
                    </>
                  ) : (
                    'تنشيط الآن'
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setShowActivateModal(false)}
                  className="bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl px-5 py-3 text-sm font-bold transition-colors"
                >
                  إلغاء
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
