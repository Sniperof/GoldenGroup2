import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../../lib/api';

// ── Lookup maps ───────────────────────────────────────────────────────────────

const PAYMENT_LABELS: Record<string, string> = { cash: 'نقدي', installment: 'أقساط' };
const MAINTENANCE_LABELS: Record<string, string> = {
  '3': '3 أشهر', '6': '6 أشهر', '12': 'سنة', '24': 'سنتان',
};

function maintenanceIntervalLabel(warrantyMonths?: number | null, warrantyVisits?: number | null, maintenancePlan?: string | null): string | null {
  if (warrantyMonths && warrantyVisits) {
    const days = Math.round((warrantyMonths * 30) / warrantyVisits);
    return `كل ${days} يوم (${warrantyVisits} زيارة / ${warrantyMonths} شهر)`;
  }
  if (maintenancePlan) return `كل ${MAINTENANCE_LABELS[maintenancePlan] ?? maintenancePlan}`;
  return null;
}
const SALE_TYPE_LABELS: Record<string, string> = {
  tradein: 'استبدال', retention: 'احتفاظ', direct: 'بيع مباشر',
};
const SALE_SOURCE_LABELS: Record<string, string> = {
  device_demo_task: 'مهمة عرض جهاز', app: 'التطبيق', social_media: 'وسائل التواصل الاجتماعي',
};
const METHOD_LABELS: Record<string, string> = {
  cash: 'نقد', sham_cash: 'شام كاش', syriatel_cash: 'سيرياتيل كاش',
  mtn_cash: 'MTN كاش', alharam: 'الهرم', bank_transfer: 'حوالة بنكية',
  barter: 'مقايضة', usd_cash: 'دولار نقدي',
};
const AVATAR_BG: Record<string, string> = {
  Complete: 'bg-emerald-100 border-emerald-200',
  Partial:  'bg-amber-100 border-amber-200',
  Minimal:  'bg-red-100 border-red-200',
};
const AVATAR_ICON: Record<string, string> = {
  Complete: 'text-emerald-600',
  Partial:  'text-amber-600',
  Minimal:  'text-red-500',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(d?: string | null) {
  if (!d) return '—';
  return String(d).slice(0, 10);
}

function fmtDateTime(d?: string | null) {
  if (!d) return '—';
  return String(d).slice(0, 16).replace('T', ' ');
}

function fmtMoney(n?: number | null) {
  if (n == null || isNaN(Number(n))) return '—';
  return Number(n).toLocaleString('en-US') + ' ل.س';
}

function contractTitle(type: string, subtype?: string | null) {
  if (type === 'maintenance_contract') return 'اتفاقية خدمة قديمة';
  if (subtype === 'temporary') return 'عقد مؤقت';
  if (subtype === 'free') return 'عقد هدية / تمليك بلا مقابل';
  return 'عقد بيع قطعي';
}

function saleSubtypeLabel(subtype: string) {
  const map: Record<string, string> = {
    definitive: 'عقد قطعي',
    temporary: 'عقد مؤقت',
    free: 'عقد مجاني',
  };
  return map[subtype] ?? subtype;
}

// ── UI Components ─────────────────────────────────────────────────────────────

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-white rounded-2xl shadow-sm border border-gray-100 p-5 ${className}`}>
      {children}
    </div>
  );
}

function CardTitle({ children }: { children: React.ReactNode }) {
  return <div className="text-base font-bold text-slate-800 mb-4">{children}</div>;
}

function Divider() {
  return <div className="h-px bg-gray-100 my-4"></div>;
}

function Chip({ children, cls }: { children: React.ReactNode; cls: string }) {
  return <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${cls}`}>{children}</span>;
}

function LabelVal({
  label, value, mono, valueCls,
}: {
  label: string; value?: React.ReactNode; mono?: boolean; valueCls?: string;
}) {
  return (
    <div>
      <span className="text-slate-400 text-xs">{label}:</span>
      {mono
        ? <span className={`font-mono text-slate-700 mr-1 ${valueCls ?? ''}`}>{value ?? '—'}</span>
        : <span className={`text-slate-700 mr-1 ${valueCls ?? ''}`}>{value ?? '—'}</span>}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { cls: string; label: string }> = {
    draft:     { cls: 'bg-amber-100 text-amber-700',    label: 'مسودة' },
    active:    { cls: 'bg-emerald-100 text-emerald-700', label: 'نشط' },
    completed: { cls: 'bg-blue-100 text-blue-700',      label: 'مكتمل' },
    cancelled: { cls: 'bg-red-100 text-red-700',        label: 'ملغى' },
    discarded: { cls: 'bg-slate-200 text-slate-700',    label: 'مؤرشف / مرفوض' },
  };
  const m = map[status] ?? { cls: 'bg-slate-100 text-slate-600', label: status };
  return <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${m.cls}`}>{m.label}</span>;
}

function DeviceStatusBadge({ status }: { status: string }) {
  // DEC-CT-03: unified device status dictionary.
  const map: Record<string, { cls: string; label: string }> = {
    registered:       { cls: 'bg-indigo-100 text-indigo-700',  label: 'مسجّل' },
    pending_delivery: { cls: 'bg-amber-100 text-amber-700',    label: 'بانتظار التوصيل' },
    delivered:        { cls: 'bg-sky-100 text-sky-700',        label: 'تم التوصيل' },
    installed:        { cls: 'bg-emerald-100 text-emerald-700', label: 'مركّب' },
    active:           { cls: 'bg-green-100 text-green-700',    label: 'نشط' },
    faulty:           { cls: 'bg-red-100 text-red-700',        label: 'معطل' },
    in_workshop:      { cls: 'bg-orange-100 text-orange-700',  label: 'في الورشة' },
    ready:            { cls: 'bg-cyan-100 text-cyan-700',      label: 'جاهز' },
    out_of_service:   { cls: 'bg-gray-100 text-gray-500',      label: 'خارج الخدمة' },
    retrieved:        { cls: 'bg-slate-100 text-slate-600',    label: 'مستردة' },
  };
  const m = map[status] ?? { cls: 'bg-slate-100 text-slate-600', label: status };
  return <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${m.cls}`}>{m.label}</span>;
}

function ClientAvatar({ dataQuality }: { dataQuality?: string | null }) {
  const bg   = AVATAR_BG[dataQuality ?? '']   ?? 'bg-slate-100 border-slate-200';
  const icon = AVATAR_ICON[dataQuality ?? ''] ?? 'text-slate-500';
  return (
    <div className={`w-12 h-12 rounded-full border-2 flex items-center justify-center shrink-0 ${bg}`}>
      <svg className={icon} width="28" height="28" viewBox="0 0 64 64">
        <circle cx="32" cy="20" r="12" className="fill-current" opacity="0.9" />
        <path d="M14 56c0-9.941 8.059-18 18-18s18 8.059 18 18H14z" className="fill-current" opacity="0.75" />
      </svg>
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
    if (data && activateFinalPrice === 0) setActivateFinalPrice(Number(data.finalPrice) || 0);
  }, [data]);

  useEffect(() => {
    if (!id) return;
    api.contracts.get(Number(id))
      .then(setData)
      .catch(err => setError(err.message || 'فشل التحميل'))
      .finally(() => setLoading(false));
  }, [id]);

  const handleCancelContract = async () => {
    if (!window.confirm('هل أنت متأكد من إلغاء هذا العقد؟')) return;
    setActionLoading(true);
    try {
      const updated = await api.contracts.update(Number(id), { ...data, status: 'cancelled' });
      setData(updated);
    } catch (err: any) {
      alert('فشل إلغاء العقد: ' + (err.message || err));
    } finally {
      setActionLoading(false);
    }
  };

  const handleActivatePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (activateFinalPrice <= 0) { alert('الرجاء إدخال السعر النهائي'); return; }
    if (activatePaymentType === 'installment' && activateDownPayment >= activateFinalPrice) {
      alert('الدفعة الأولى يجب أن تكون أقل من السعر النهائي'); return;
    }
    setActivationLoading(true);
    try {
      const contractId = Number(id);
      const paymentEntries: any[] = [];
      if (activatePaymentType === 'cash') {
        paymentEntries.push({ method: 'cash', currency: 'SYP', amountValue: activateFinalPrice, amountSyp: activateFinalPrice, notes: 'دفعة كاملة لتنشيط العقد' });
      } else if (activateDownPayment > 0) {
        paymentEntries.push({ method: 'cash', currency: 'SYP', amountValue: activateDownPayment, amountSyp: activateDownPayment, notes: 'الدفعة الأولى لتنشيط العقد' });
      }
      const installments: any[] = [];
      if (activatePaymentType === 'installment') {
        const remaining = activateFinalPrice - activateDownPayment;
        const base = Math.floor(remaining / activateInstallmentsCount);
        const baseDate = new Date();
        let distributed = 0;
        for (let i = 1; i <= activateInstallmentsCount; i++) {
          const dueDate = new Date(baseDate);
          dueDate.setMonth(baseDate.getMonth() + i);
          const amount = i === activateInstallmentsCount ? remaining - distributed : base;
          if (i !== activateInstallmentsCount) distributed += base;
          installments.push({ installmentNumber: i, dueDate: dueDate.toISOString().slice(0, 10), amountSyp: amount });
        }
      }
      await api.contracts.update(contractId, {
        ...data, status: 'active', saleSubtype: 'definitive',
        paymentType: activatePaymentType, basePrice: activateFinalPrice,
        finalPrice: activateFinalPrice, downPayment: activateDownPayment,
        installmentsCount: activatePaymentType === 'cash' ? 0 : activateInstallmentsCount,
      });
      if (paymentEntries.length > 0) await api.contracts.savePaymentEntries(contractId, paymentEntries);
      if (activatePaymentType === 'installment') {
        await api.contracts.saveInstallments(contractId, installments);
        await api.contracts.confirmInstallments(contractId);
      }
      const refreshed = await api.contracts.get(contractId);
      setData(refreshed);
      setShowActivateModal(false);
    } catch (err: any) {
      alert('فشل في تنشيط الدفع: ' + (err.message || err));
    } finally {
      setActivationLoading(false);
    }
  };

  // ── Loading / Error ──────────────────────────────────────────────────────────

  if (loading) return (
    <div className="flex flex-col items-center justify-center gap-3 h-full text-slate-400">
      <svg className="animate-spin h-8 w-8 text-sky-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
      </svg>
      <span className="text-sm font-medium">جاري تحميل تفاصيل العقد...</span>
    </div>
  );

  if (error || !data) return (
    <div className="flex flex-col items-center justify-center gap-3 h-full">
      <p className="text-sm font-bold text-slate-500">{error || 'العقد غير موجود'}</p>
      <button onClick={() => navigate('/contracts')} className="text-sky-600 text-sm font-bold hover:underline">العودة للقائمة</button>
    </div>
  );

  // ── Derived values ───────────────────────────────────────────────────────────

  const tasks          = data.tasks          ?? [];
  const dues           = data.dues           ?? [];
  const paymentEntries = data.paymentEntries ?? [];
  const installments   = data.installments   ?? [];
  const lineItems      = data.lineItems      ?? [];

  const isMaintenance = data.contractType === 'maintenance_contract';
  const isFree        = !isMaintenance && data.saleSubtype === 'free';

  const grandTotal = Number(data.finalPrice) || 0;
  const totalPaid  = paymentEntries.reduce((s: number, e: any) => s + Number(e.amountSyp), 0);
  const remaining  = Math.max(0, grandTotal - totalPaid);

  const installationGeoPath: string[] = data.installationGeoPath ?? [];
  const mapsUrl = data.installationLat && data.installationLng
    ? `https://maps.google.com/?q=${data.installationLat},${data.installationLng}`
    : null;

  const hasSourceOrClosing = data.sourceVisit || data.sourceOpenTaskId || data.sourceTaskOfferId
    || data.closingEmployeeName || data.closingDate;

  return (
    <div className="h-full overflow-y-auto bg-slate-50 pb-20">

      {/* ── Sticky Navbar ────────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-50 bg-gradient-to-r from-sky-600 to-sky-500 shadow-md">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <button onClick={() => navigate('/contracts')}
            className="text-white/80 hover:text-white text-sm transition-colors">
            ← رجوع
          </button>
          <h1 className="text-white font-bold text-lg">تفاصيل العقد</h1>
          <button onClick={() => navigate(`/contracts/${id}/edit`)}
            className="text-white/80 hover:text-white text-sm border border-white/30 rounded-lg px-3 py-1 transition-colors">
            تعديل
          </button>
        </div>
      </div>

      {/* ── Temporary Contract Banner ─────────────────────────────────────── */}
      {/* DEC-CT-01: `temporary` moved from status → saleSubtype */}
      {data.saleSubtype === 'temporary' && data.status !== 'cancelled' && data.status !== 'discarded' && (
        <div className="max-w-5xl mx-auto px-4 pt-4">
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <p className="text-sm font-bold text-amber-900">⏳ عقد مؤقت لمدة شهر</p>
              <p className="text-xs text-amber-700 mt-1">
                يجب إما تنشيط الدفع ليصبح بيعاً قطعياً أو إلغاؤه بعد انتهاء الشهر.
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <button onClick={() => setShowActivateModal(true)}
                className="bg-amber-600 hover:bg-amber-700 text-white rounded-xl px-4 py-2 text-xs font-bold transition-colors">
                ⚡ تنشيط عملية الدفع
              </button>
              <button disabled={actionLoading} onClick={handleCancelContract}
                className="bg-white hover:bg-rose-50 text-rose-600 border border-rose-200 rounded-xl px-4 py-2 text-xs font-bold transition-colors">
                {actionLoading ? 'جاري...' : 'إلغاء العقد'}
              </button>
            </div>
          </div>
        </div>
      )}

      {isMaintenance && (
        <div className="max-w-5xl mx-auto px-4 pt-4">
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5">
            <p className="text-sm font-bold text-amber-900">هذا السجل من مسار عقود الصيانة القديم</p>
            <p className="text-xs text-amber-700 mt-1">
              المسار الحالي للأجهزة الخارجية أصبح عبر اتفاقيات الخدمة، وليس من شاشة العقود.
            </p>
          </div>
        </div>
      )}

      <div className="max-w-5xl mx-auto px-4 py-6 space-y-4">

        {/* ══ Group 1: رأس العقد ══════════════════════════════════════════════ */}
        <Card>
          <div className="text-sm font-mono text-sky-600 mb-2">{data.contractNumber ?? '—'}</div>
          <div className="flex items-center gap-3 flex-wrap mb-3">
            <h2 className="text-xl font-black text-slate-800">
              {contractTitle(data.contractType, data.saleSubtype)}
            </h2>
            <StatusBadge status={data.status} />
            {data.branchName && (
              <Chip cls="bg-slate-100 text-slate-600">🏢 {data.branchName}</Chip>
            )}
          </div>
          <Divider />
          <div className="flex gap-6 text-sm text-slate-500 flex-wrap">
            <LabelVal label="تاريخ العقد" value={fmtDate(data.contractDate)} mono />
            <LabelVal label="تاريخ الإنشاء" value={fmtDateTime(data.createdAt)} mono />
            {data.createdByName && <LabelVal label="👤 منشئ العقد" value={data.createdByName} />}
          </div>
        </Card>

        {/* ══ Groups 2+3: هوية المشتري + الجهاز ════════════════════════════ */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

          {/* ── Group 2: هوية المشتري ──────────────────────────────────────── */}
          <Card>
            {/* الجزء أ: MiniSnapshot Header */}
            <div className="flex items-center gap-3">
              <ClientAvatar dataQuality={data.client?.dataQuality} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <button onClick={() => data.client && navigate(`/clients/${data.client.id}`)}
                    className="text-base font-bold text-slate-800 hover:text-sky-600 hover:underline transition-colors text-right">
                    {data.customerName ?? data.client?.name ?? '—'}
                    {data.client?.nickname ? ` (${data.client.nickname})` : ''}
                  </button>
                </div>
                <div className="text-sm text-slate-500 mt-0.5">
                  {data.client?.mobile && <span className="font-mono">{data.client.mobile}</span>}
                </div>
              </div>
            </div>

            <Divider />

            {/* الجزء ب: العنوان الكامل + المهنة */}
            {data.client?.geoPath?.length > 0 && (
              <div className="mb-4">
                <div className="text-xs font-medium text-slate-400 mb-1">📍 العنوان الكامل</div>
                <div className="text-sm text-slate-700">{data.client.geoPath.join(' → ')}</div>
                {data.client?.detailedAddress && (
                  <div className="text-sm text-slate-500 mt-0.5">{data.client.detailedAddress}</div>
                )}
                {data.client?.lat && data.client?.lng && (
                  <a href={`https://maps.google.com/?q=${data.client.lat},${data.client.lng}`}
                    target="_blank" rel="noopener noreferrer"
                    className="mt-2 text-xs text-sky-600 font-medium">🗺️ عرض على الخريطة</a>
                )}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
              <div>
                <div className="text-xs font-medium text-slate-400 mb-0.5">💼 المهنة</div>
                <div className={`text-sm ${data.client?.occupation ? 'text-slate-700' : 'text-slate-400 italic'}`}>
                  {data.client?.occupation || 'غير محدد'}
                </div>
              </div>
              <div>
                <div className="text-xs font-medium text-slate-400 mb-0.5">💼 مهنة الزوج/ة</div>
                <div className={`text-sm ${data.client?.spouseOccupation ? 'text-slate-700' : 'text-slate-400 italic'}`}>
                  {data.client?.spouseOccupation || 'غير محدد'}
                </div>
              </div>
            </div>

            <Divider />

            {/* الجزء ج: الهوية القانونية */}
            <div>
              <div className="text-xs font-bold text-slate-500 mb-2 uppercase tracking-wide">📋 الهوية القانونية</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-2 gap-x-4 text-sm">
                <LabelVal label="🆔 الرقم الوطني" value={data.client?.nationalId} mono />
                <LabelVal label="🎂 الميلاد" value={fmtDate(data.buyerBirthDate || data.client?.birthDate)} mono />
                <LabelVal label="👩‍👦 الأم" value={data.buyerMotherName || data.client?.motherName} />
                <LabelVal label="📋 السجل المدني" value={data.buyerNationalIdRegistry || data.client?.nationalIdRegistry} />
                <LabelVal label="🏛️ جهة الإصدار" value={data.buyerNationalIdIssuedBy || data.client?.nationalIdIssuedBy} />
                <LabelVal label="📅 تاريخ الإصدار" value={fmtDate(data.buyerNationalIdIssueDate || data.client?.nationalIdIssueDate)} mono />
                <LabelVal label="📦 الخانة" value={data.buyerNationalIdBox || data.client?.nationalIdBox} mono />
              </div>
            </div>

            {/* الجزء د: الملكية */}
            {data.ownershipDisplay && (
              <>
                <Divider />
                <div className="flex items-center justify-between text-sm flex-wrap gap-2">
                  <LabelVal label="المسؤول" value={data.ownershipDisplay} />
                </div>
              </>
            )}

            {/* الجزء هـ: وسطاء العقد */}
            {Array.isArray(data.contractReferrers) && data.contractReferrers.length > 0 && (
              <>
                <Divider />
                <div>
                  <div className="text-xs font-bold text-slate-500 mb-2 uppercase tracking-wide">🤝 وسطاء العقد</div>
                  <div className="flex flex-wrap gap-2">
                    {data.contractReferrers.map((referrer: any) => (
                      <div key={referrer.id || referrer.referrerName} className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-sm">
                        <span className="text-slate-700 font-medium">{referrer.referrerName}</span>
                        {referrer.referrerType && (
                          <span className="text-xs text-slate-400">
                            ({referrer.referrerType === 'client' ? 'زبون'
                              : referrer.referrerType === 'employee' ? 'موظف'
                              : referrer.referrerType === 'personal' ? 'شخصي'
                              : referrer.referrerType === 'customer' ? 'عميل'
                              : referrer.referrerType})
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </Card>

          {/* ── Group 3: الجهاز والصيانة ───────────────────────────────────── */}
          <Card>
            <CardTitle>🖥️ الجهاز والصيانة</CardTitle>
            <div className="space-y-3">
              {data.deviceModelName && (
                <div className="flex justify-between items-center">
                  <span className="text-sm text-slate-500">الموديل:</span>
                  <span className="text-sm font-bold text-slate-800">{data.deviceModelName}</span>
                </div>
              )}
              {data.code && (
                <div className="flex justify-between items-center">
                  <span className="text-sm text-slate-500">الرمز:</span>
                  <span className="text-sm font-mono text-slate-700">{data.code}</span>
                </div>
              )}
              {data.serialNumber && (
                <div className="flex justify-between items-center">
                  <span className="text-sm text-slate-500">الرقم التسلسلي:</span>
                  <span className="text-sm font-mono text-slate-700">{data.serialNumber}</span>
                </div>
              )}
              {(data.maintenancePlan || data.warrantyMonths || data.deviceStatus) && <div className="h-px bg-gray-100"></div>}
              <div className="grid grid-cols-2 gap-3">
                {maintenanceIntervalLabel(data.warrantyMonths, data.warrantyVisits, data.maintenancePlan) && (
                  <div>
                    <span className="text-xs text-slate-400 block mb-1">دورة الصيانة</span>
                    <span className="text-sm text-slate-700">
                      {maintenanceIntervalLabel(data.warrantyMonths, data.warrantyVisits, data.maintenancePlan)}
                    </span>
                  </div>
                )}
                {data.deviceStatus && (
                  <div>
                    <span className="text-xs text-slate-400 block mb-1">حالة الجهاز</span>
                    <DeviceStatusBadge status={data.deviceStatus} />
                  </div>
                )}
              </div>
            </div>
          </Card>
        </div>

        {/* ══ Group 4: الملخص المالي ══════════════════════════════════════════ */}
        {!isMaintenance && !isFree && (
          <Card>
            <CardTitle>💰 الملخص المالي</CardTitle>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4 text-sm">
              {data.saleType && <LabelVal label="نوع البيع" value={SALE_TYPE_LABELS[data.saleType] ?? data.saleType} />}
              {data.saleSubtype && <LabelVal label="الفئة" value={saleSubtypeLabel(data.saleSubtype)} />}
              {data.saleSource && <LabelVal label="المصدر" value={SALE_SOURCE_LABELS[data.saleSource] ?? data.saleSource} />}
              {data.saleReferenceNumber && <LabelVal label="المرجع" value={data.saleReferenceNumber} mono />}
            </div>

            <Divider />

            <div className="space-y-2">
              {data.basePrice && (
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">السعر الأساسي</span>
                  <span className={`font-mono ${data.finalPrice && data.finalPrice < data.basePrice ? 'text-slate-400 line-through' : 'text-slate-700'}`}>
                    {fmtMoney(data.basePrice)}
                  </span>
                </div>
              )}
              {data.discount && data.discount.amount > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">الخصم ({data.discount.percentage}%)</span>
                  <span className="font-mono text-red-600">-{fmtMoney(data.discount.amount)}</span>
                </div>
              )}
              <div className="h-px bg-gray-200 my-2"></div>
              <div className="flex justify-between">
                <span className="text-slate-800 font-bold">السعر النهائي</span>
                <span className="font-mono text-slate-800 font-black text-lg">{fmtMoney(grandTotal)}</span>
              </div>
            </div>

            <Divider />

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
              <LabelVal label="طريقة الدفع" value={PAYMENT_LABELS[data.paymentType] ?? data.paymentType ?? '—'} />
              {data.downPayment > 0 && <LabelVal label="الدفعة الأولى" value={fmtMoney(data.downPayment)} mono />}
              {data.paymentType === 'installment' && data.installmentsCount > 0 && (
                <LabelVal label="الأقساط"
                  value={`${data.installmentsCount} × ${fmtMoney(
                    installments.length > 0
                      ? Number(installments[0].amountSyp)
                      : Math.round((grandTotal - (data.downPayment || 0)) / data.installmentsCount)
                  )}`}
                  mono />
              )}
            </div>

            <Divider />

            <div className="flex justify-between items-center text-sm">
              <div className="flex gap-6">
                <LabelVal label="المدفوع" value={fmtMoney(totalPaid)} valueCls="text-emerald-700 font-bold" mono />
                <LabelVal label="المتبقي" value={fmtMoney(remaining)}
                  valueCls={remaining > 0 ? 'text-amber-700 font-bold' : 'text-emerald-700 font-bold'} mono />
              </div>
              {data.receiptNumber && <LabelVal label="رقم الإيصال" value={data.receiptNumber} mono />}
            </div>
          </Card>
        )}

        {/* ══ Group 5: التسليم والتركيب ═══════════════════════════════════════ */}
        <Card>
          <CardTitle>📍 التسليم والتركيب</CardTitle>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <LabelVal label="📅 تاريخ التسليم المتوقع" value={fmtDate(data.deliveryDate)} mono />
            <LabelVal label="🔧 تاريخ التركيب المتوقع" value={fmtDate(data.installationDate)} mono />
          </div>

          {(installationGeoPath.length > 0 || data.installationAddressText || mapsUrl) && (
            <>
              <Divider />
              <div>
                <div className="text-xs text-slate-400 block mb-1">📍 عنوان التركيب</div>
                {installationGeoPath.length > 0 && (
                  <div className="text-sm text-slate-700">{installationGeoPath.join(' → ')}</div>
                )}
                {data.installationAddressText && (
                  <div className="text-sm text-slate-500 mt-0.5">{data.installationAddressText}</div>
                )}
                {mapsUrl && (
                  <a href={mapsUrl} target="_blank" rel="noopener noreferrer"
                    className="mt-2 text-xs text-sky-600 font-medium hover:text-sky-700 flex items-center gap-1">
                    🗺️ عرض على الخريطة
                  </a>
                )}
              </div>
            </>
          )}
        </Card>

        {/* ══ Group 6: مصدر العقد وإغلاقه ════════════════════════════════════ */}
        {hasSourceOrClosing && (
          <Card>
            <CardTitle>🔗 مصدر العقد وإغلاقه</CardTitle>
            <div className="space-y-2 mb-4">
              {data.sourceVisit && (
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-slate-400">📌 مصدر الزيارة:</span>
                  <button onClick={() => navigate(`/field-visits/${data.sourceVisit}`)}
                    className="text-sky-600 font-mono hover:underline">#{data.sourceVisit}</button>
                </div>
              )}
              {data.sourceOpenTaskId && (
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-slate-400">📋 المهمة المفتوحة:</span>
                  <button onClick={() => navigate('/tasks/open')}
                    className="text-sky-600 font-mono hover:underline">#{data.sourceOpenTaskId}</button>
                </div>
              )}
              {data.sourceTaskOfferId && (
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-slate-400">💼 عرض المهمة:</span>
                  <span className="text-sky-600 font-mono">#{data.sourceTaskOfferId}</span>
                </div>
              )}
            </div>
            {(data.closingEmployeeName || data.closingDate || data.noClosingReasonName) && (
              <>
                <Divider />
                <div className="grid grid-cols-2 gap-4 text-sm">
                  {data.closingEmployeeName && <LabelVal label="👤 موظف الإغلاق" value={data.closingEmployeeName} />}
                  {data.closingDate && <LabelVal label="📅 تاريخ الإغلاق" value={fmtDate(data.closingDate)} mono />}
                  {!data.closingEmployeeName && data.noClosingReasonName && (
                    <div>
                      <span className="text-xs text-slate-400 block mb-1">سبب عدم الإغلاق</span>
                      <Chip cls="bg-red-100 text-red-600">{data.noClosingReasonName}</Chip>
                    </div>
                  )}
                </div>
              </>
            )}
          </Card>
        )}

        {/* ══ Group 7: بنود العقد ══════════════════════════════════════════════ */}
        {lineItems.length > 0 && (
          <Card className="!p-0 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100">
              <span className="text-base font-bold text-slate-800">📦 بنود العقد ({lineItems.length})</span>
            </div>
            <div className="grid gap-x-3 px-5 py-2.5 bg-slate-50 border-b border-slate-100 text-xs font-bold text-slate-400"
              style={{ gridTemplateColumns: '2rem 2fr 4rem 1fr 1fr' }}>
              <span>#</span><span>البيان</span><span>الكمية</span><span>سعر الوحدة</span><span>الإجمالي</span>
            </div>
            {lineItems.map((item: any, i: number) => (
              <div key={item.id ?? i}
                className="grid gap-x-3 px-5 py-3 border-b border-slate-50 hover:bg-slate-50/60 text-sm items-center"
                style={{ gridTemplateColumns: '2rem 2fr 4rem 1fr 1fr' }}>
                <span className="font-mono text-xs text-slate-400">{i + 1}</span>
                <span className="text-slate-700">{item.description ?? '—'}</span>
                <span className="text-slate-600">{item.quantity}</span>
                <span className="font-mono text-slate-600">{fmtMoney(item.unitPrice)}</span>
                <span className="font-mono font-bold text-slate-800">{fmtMoney(item.totalPrice)}</span>
              </div>
            ))}
            <div className="grid gap-x-3 px-5 py-3 bg-slate-50 text-xs font-bold text-slate-500"
              style={{ gridTemplateColumns: '2rem 2fr 4rem 1fr 1fr' }}>
              <span></span><span>المجموع</span><span></span><span></span>
              <span className="font-mono text-slate-800">
                {fmtMoney(lineItems.reduce((s: number, i: any) => s + Number(i.totalPrice), 0))}
              </span>
            </div>
          </Card>
        )}

        {/* ══ Group 8: دفعات العقد ════════════════════════════════════════════ */}
        <Card className="!p-0 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <span className="text-base font-bold text-slate-800">💳 دفعات العقد ({paymentEntries.length})</span>
          </div>
          {paymentEntries.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-slate-400">لا توجد دفعات مسجلة</div>
          ) : (
            <>
              <div className="grid gap-x-3 px-5 py-2.5 bg-slate-50 border-b border-slate-100 text-xs font-bold text-slate-400"
                style={{ gridTemplateColumns: '2rem 1fr 4rem 1fr 1fr 5rem' }}>
                <span>#</span><span>الطريقة</span><span>العملة</span><span>المبلغ</span><span>المكافئ ل.س</span><span>مرجع</span>
              </div>
              {paymentEntries.map((e: any, i: number) => (
                <div key={e.id ?? i}
                  className="grid gap-x-3 px-5 py-3 border-b border-slate-50 hover:bg-slate-50/60 text-sm items-center"
                  style={{ gridTemplateColumns: '2rem 1fr 4rem 1fr 1fr 5rem' }}>
                  <span className="font-mono text-xs text-slate-400">{i + 1}</span>
                  <span className="text-slate-700">{METHOD_LABELS[e.method] ?? e.method}</span>
                  <span className="text-slate-500">{e.currency}</span>
                  <span className="font-mono text-slate-700">
                    {e.method === 'barter'
                      ? <span className="text-purple-600 text-xs">{e.barterName}</span>
                      : `${Number(e.amountValue).toLocaleString('en-US')} ${e.currency === 'USD' ? '$' : 'ل.س'}`}
                  </span>
                  <span className="font-mono font-bold text-slate-800">{fmtMoney(Number(e.amountSyp))}</span>
                  <span className="font-mono text-slate-400 text-xs">{e.referenceNumber ?? '—'}</span>
                </div>
              ))}
              <div className="grid gap-x-3 px-5 py-3 bg-slate-50 text-xs font-bold text-slate-500"
                style={{ gridTemplateColumns: '2rem 1fr 4rem 1fr 1fr 5rem' }}>
                <span></span><span>المجموع</span><span></span><span></span>
                <span className="font-mono text-emerald-700">{fmtMoney(totalPaid)}</span>
                <span></span>
              </div>
            </>
          )}
        </Card>

        {/* ══ Group 9: جدول الأقساط ═══════════════════════════════════════════ */}
        {data.paymentType === 'installment' && (
          <Card className="!p-0 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100">
              <span className="text-base font-bold text-slate-800">📆 جدول الأقساط ({installments.length})</span>
            </div>
            {installments.length === 0 ? (
              <div className="px-5 py-8 text-center text-sm text-slate-400">لا توجد أقساط مسجلة</div>
            ) : (
              <>
                <div className="grid gap-x-3 px-5 py-2.5 bg-slate-50 border-b border-slate-100 text-xs font-bold text-slate-400"
                  style={{ gridTemplateColumns: '2rem 1fr 1fr 1fr 1fr 5rem' }}>
                  <span>#</span><span>تاريخ الاستحقاق</span><span>المبلغ</span><span>المدفوع</span><span>المتبقي</span><span>الحالة</span>
                </div>
                {installments.map((inst: any, i: number) => {
                  const isOverdue = inst.status === 'pending' && inst.dueDate && new Date(inst.dueDate) < new Date();
                  const statusMap: Record<string, { cls: string; label: string }> = {
                    pending: { cls: 'bg-amber-100 text-amber-700',    label: 'معلق' },
                    paid:    { cls: 'bg-emerald-100 text-emerald-700', label: 'مدفوع' },
                    partial: { cls: 'bg-blue-100 text-blue-700',      label: 'جزئي' },
                    overdue: { cls: 'bg-red-100 text-red-700',        label: 'متأخر' },
                  };
                  const sm = statusMap[isOverdue ? 'overdue' : inst.status] ?? statusMap.pending;
                  return (
                    <div key={inst.id ?? i}
                      className={`grid gap-x-3 px-5 py-3 border-b border-slate-50 hover:bg-slate-50/60 text-sm items-center ${isOverdue ? 'bg-red-50/30' : ''}`}
                      style={{ gridTemplateColumns: '2rem 1fr 1fr 1fr 1fr 5rem' }}>
                      <span className="font-mono text-xs text-slate-400">{inst.installmentNumber}</span>
                      <span className="font-mono text-slate-600">{fmtDate(inst.dueDate)}</span>
                      <span className="font-mono font-bold text-slate-800">{fmtMoney(Number(inst.amountSyp))}</span>
                      <span className="font-mono text-emerald-700">{fmtMoney(Number(inst.paidAmount))}</span>
                      <span className="font-mono text-amber-700">{fmtMoney(Number(inst.remainingBalance))}</span>
                      <span><Chip cls={sm.cls}>{sm.label}</Chip></span>
                    </div>
                  );
                })}
              </>
            )}
          </Card>
        )}

        {/* ══ Group 10: الأقساط المفتوحة (projection of installment balances) ══ */}
        {dues.length > 0 && (
          <Card className="!p-0 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100">
              <div className="flex flex-col gap-1">
                <span className="text-base font-bold text-slate-800">💰 الأقساط المفتوحة ({dues.length})</span>
                <span className="text-xs text-slate-500">
                  هذا القسم مشتق تلقائياً من الأقساط التي لا يزال عليها رصيد متبقٍ.
                </span>
              </div>
            </div>
            <div className="grid gap-x-3 px-5 py-2.5 bg-slate-50 border-b border-slate-100 text-xs font-bold text-slate-400"
              style={{ gridTemplateColumns: '2rem 1fr 1fr 1fr 5rem' }}>
              <span>#</span><span>تاريخ الاستحقاق</span><span>المبلغ الأصلي</span><span>المتبقي</span><span>الحالة</span>
            </div>
            {dues.map((due: any, i: number) => {
              const dueStatus: Record<string, { cls: string; label: string }> = {
                Pending: { cls: 'bg-amber-100 text-amber-700',    label: 'معلق' },
                Partial: { cls: 'bg-blue-100 text-blue-700',      label: 'جزئي' },
                Paid:    { cls: 'bg-emerald-100 text-emerald-700', label: 'مدفوع' },
                Overdue: { cls: 'bg-red-100 text-red-700',        label: 'متأخر' },
              };
              const ds = dueStatus[due.status] ?? { cls: 'bg-slate-100 text-slate-500', label: due.status };
              return (
                <div key={due.id ?? i}
                  className="grid gap-x-3 px-5 py-3 border-b border-slate-50 hover:bg-slate-50/60 text-sm items-center"
                  style={{ gridTemplateColumns: '2rem 1fr 1fr 1fr 5rem' }}>
                  <span className="font-mono text-xs text-slate-400">{i + 1}</span>
                  <span className="font-mono text-slate-600">{fmtDate(due.adjustedDate ?? due.scheduledDate)}</span>
                  <span className="font-mono font-bold text-slate-800">{fmtMoney(Number(due.originalAmount))}</span>
                  <span className="font-mono text-amber-700">{fmtMoney(Number(due.remainingBalance))}</span>
                  <span><Chip cls={ds.cls}>{ds.label}</Chip></span>
                </div>
              );
            })}
            <div className="grid gap-x-3 px-5 py-3 bg-slate-50 text-xs font-bold text-slate-500"
              style={{ gridTemplateColumns: '2rem 1fr 1fr 1fr 5rem' }}>
              <span></span><span>إجمالي الرصيد المفتوح</span><span></span>
              <span className="font-mono text-amber-700">
                {fmtMoney(dues.reduce((s: number, d: any) => s + Number(d.remainingBalance), 0))}
              </span>
              <span></span>
            </div>
          </Card>
        )}

        {/* ══ Group 11: المهام المرتبطة ════════════════════════════════════════ */}
        <Card className="!p-0 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <span className="text-base font-bold text-slate-800">📋 المهام المرتبطة ({tasks.length})</span>
          </div>
          {tasks.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-slate-400">لا توجد مهام مرتبطة بهذا العقد</div>
          ) : (
            <div className="divide-y divide-slate-100">
              {tasks.map((t: any) => {
                const taskStatusMap: Record<string, { cls: string; label: string }> = {
                  open:          { cls: 'bg-sky-100 text-sky-700',      label: 'مفتوحة' },
                  assigned:      { cls: 'bg-violet-100 text-violet-700', label: 'مسندة' },
                  in_scheduling: { cls: 'bg-indigo-100 text-indigo-700', label: 'قيد الجدولة' },
                  scheduled:     { cls: 'bg-teal-100 text-teal-700',    label: 'مجدولة' },
                  in_execution:  { cls: 'bg-amber-100 text-amber-700',  label: 'قيد التنفيذ' },
                  completed:     { cls: 'bg-emerald-100 text-emerald-700', label: 'مكتملة' },
                  closed:        { cls: 'bg-slate-100 text-slate-600',  label: 'مغلقة' },
                  cancelled:     { cls: 'bg-red-100 text-red-600',      label: 'ملغاة' },
                };
                const ts = taskStatusMap[t.status] ?? { cls: 'bg-slate-100 text-slate-500', label: t.status };
                const isEmergency = t.taskFamily === 'emergency' || t.taskType === 'emergency_maintenance';
                const path = isEmergency ? `/tasks/emergency/${t.id}` : `/tasks/${t.taskType}/${t.id}`;
                return (
                  <div key={t.id} className="flex items-center justify-between gap-4 px-5 py-3.5 hover:bg-slate-50/60">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${isEmergency ? 'bg-rose-100 text-rose-500' : 'bg-sky-100 text-sky-500'}`}>
                        {isEmergency ? '⚡' : '🔧'}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-700 truncate">{t.taskLabel ?? t.taskType}</p>
                        {t.dueDate && <p className="text-xs text-slate-400 font-mono">{fmtDate(t.dueDate)}</p>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Chip cls={ts.cls}>{ts.label}</Chip>
                      <button onClick={() => navigate(path)} className="text-xs text-sky-600 hover:underline font-mono">#{t.id}</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        {/* ══ Group 12: ملاحظات الفاتورة ══════════════════════════════════════ */}
        {data.invoiceNotes && (
          <Card>
            <CardTitle>📝 ملاحظات الفاتورة</CardTitle>
            <div className="bg-slate-50 rounded-xl p-3 text-sm text-slate-700 min-h-[3rem] whitespace-pre-line">
              {data.invoiceNotes}
            </div>
          </Card>
        )}

      </div>

      {/* ══ Activation Modal ════════════════════════════════════════════════════ */}
      {showActivateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-bold text-slate-800">تنشيط عملية الدفع</h3>
              <button onClick={() => setShowActivateModal(false)} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
            </div>
            <form onSubmit={handleActivatePayment} className="space-y-4">
              <div>
                <label className="text-xs font-bold text-slate-500 mb-1 block">طريقة الدفع</label>
                <div className="grid grid-cols-2 gap-2">
                  {(['cash', 'installment'] as const).map(m => (
                    <button type="button" key={m}
                      onClick={() => setActivatePaymentType(m)}
                      className={`py-2 rounded-xl text-sm font-bold border transition-colors ${activatePaymentType === m ? 'bg-sky-600 text-white border-sky-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>
                      {m === 'cash' ? 'نقدي' : 'أقساط'}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs font-bold text-slate-500 mb-1 block">السعر النهائي (ل.س)</label>
                <input type="number" value={activateFinalPrice} onChange={e => setActivateFinalPrice(Number(e.target.value))}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-sky-500" required />
              </div>
              {activatePaymentType === 'installment' && (
                <>
                  <div>
                    <label className="text-xs font-bold text-slate-500 mb-1 block">الدفعة الأولى (ل.س)</label>
                    <input type="number" value={activateDownPayment} onChange={e => setActivateDownPayment(Number(e.target.value))}
                      className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-sky-500" />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-500 mb-1 block">عدد الأقساط</label>
                    <input type="number" min="1" max="60" value={activateInstallmentsCount} onChange={e => setActivateInstallmentsCount(Number(e.target.value))}
                      className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-sky-500" />
                  </div>
                </>
              )}
              <div className="flex gap-3 pt-2">
                <button type="submit" disabled={activationLoading}
                  className="flex-1 bg-sky-600 hover:bg-sky-700 text-white rounded-xl py-2.5 text-sm font-bold transition-colors disabled:opacity-60">
                  {activationLoading ? 'جاري التنشيط...' : 'تأكيد التنشيط'}
                </button>
                <button type="button" onClick={() => setShowActivateModal(false)}
                  className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl py-2.5 text-sm font-bold transition-colors">
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
