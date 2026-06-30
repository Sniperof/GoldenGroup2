import { useEffect, useState } from 'react';
import {
  AlertCircle, ArrowRight, CheckCircle2, Loader2, Plus, Save,
} from 'lucide-react';
import { api } from '../../../lib/api';
import { useSystemListItems } from '../../../hooks/useSystemListItems';
import PaymentEntriesList, { type PaymentEntry, newEntry } from '../PaymentEntriesList';
import InstallmentsSchedule, { type Installment } from '../InstallmentsSchedule';
import Select from '../../ui/Select';
import Card from '../../ui/Card';
import Badge from '../../ui/Badge';

const inp = "w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:border-rose-400 focus:ring-2 focus:ring-rose-400/20 bg-white";
const sel = `${inp} appearance-none cursor-pointer`;

// ── Decisions ─────────────────────────────────────────────────────────────────

const DECISIONS = [
  { value: 'resolved',      label: 'تمت المعالجة',  description: 'المشكلة حُلّت بالكامل',    cls: 'border-emerald-400 bg-emerald-500', reasonKey: 'emergency_resolved_reason' },
  { value: 'unresolved',    label: 'لم تُحل',        description: 'تعذّر حلّ المشكلة',          cls: 'border-red-400 bg-red-500',        reasonKey: 'emergency_unresolved_reason' },
  { value: 'needs_followup',label: 'تحتاج متابعة',  description: 'تحتاج إجراء متابعة لاحق',    cls: 'border-violet-400 bg-violet-500',  reasonKey: 'emergency_followup_reason' },
  { value: 'cancelled',     label: 'ملغاة',           description: 'رفض الخدمة نهائياً',        cls: 'border-slate-400 bg-slate-500',    reasonKey: 'emergency_cancelled_reason' },
] as const;

const PERIODIC_DECISIONS = [
  { value: 'performed',             label: 'نُفذت',         description: 'تم تنفيذ الصيانة الدورية بالكامل', cls: 'border-emerald-400 bg-emerald-500' },
  { value: 'partially_performed',   label: 'نُفذت جزئياً',  description: 'بقي جزء جوهري غير منفذ',           cls: 'border-amber-400 bg-amber-500', reasonKey: 'periodic_partially_performed_reason' },
  { value: 'not_performed',         label: 'لم تُنفذ',       description: 'تمت الزيارة دون تنفيذ الصيانة',     cls: 'border-red-400 bg-red-500', reasonKey: 'periodic_not_performed_reason' },
] as const;

type DecisionOption = (typeof DECISIONS[number] | typeof PERIODIC_DECISIONS[number]) & { reasonKey?: string };
type DecisionValue = typeof DECISIONS[number]['value'] | typeof PERIODIC_DECISIONS[number]['value'];
type MaintenanceKind = 'emergency' | 'periodic';

const PRIORITY_META = [
  { value: 'Critical', label: 'حرجة',  cls: 'border-red-300 bg-red-50 text-red-700' },
  { value: 'High',     label: 'عالية', cls: 'border-amber-300 bg-amber-50 text-amber-700' },
  { value: 'Normal',   label: 'عادية', cls: 'border-slate-200 bg-slate-50 text-slate-600' },
];

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2.5">{children}</p>;
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  taskId: number;
  initialData?: any;
  readOnly?: boolean;
  onSaved: () => void;
  onBack?: () => void;
  maintenanceKind?: MaintenanceKind;
  // Phase 6c.2 — new-path props. When sourceServiceRequestId is set,
  // the manual DECISIONS picker is replaced by a readonly derived_outcome
  // badge and finalDecision is auto-mapped to a legacy CHECK value.
  sourceServiceRequestId?: number | null;
  derivedOutcome?: { outcome: string; counts: Record<string, number>; total: number } | null;
  periodicAttachmentCandidate?: {
    taskId: number;
    dueDate: string;
    daysUntilDue: number;
    attachWindowDays: number;
  } | null;
}

/** Maps the §٠.١٩.ح derived outcome to one of the 4 legacy
 *  emergency_result_costs.final_decision CHECK values. The new wizard
 *  is meant to surface the richer outcome label; the legacy DB write
 *  still needs a 4-value enum. */
const DERIVED_TO_LEGACY: Record<string, DecisionValue> = {
  fully_resolved: 'resolved',
  partially_resolved: 'resolved',
  all_deferred: 'needs_followup',
  partially_unresolvable: 'unresolved',
  fully_unresolvable: 'unresolved',
  all_cancelled: 'cancelled',
  mixed: 'needs_followup',
  no_problems: 'resolved',
};

const DERIVED_LABELS: Record<string, string> = {
  fully_resolved: 'محلولة بالكامل',
  partially_resolved: 'محلولة جزئياً',
  all_deferred: 'كل الأعطال مُؤجَّلة',
  partially_unresolvable: 'بعض الأعطال غير قابلة',
  fully_unresolvable: 'كل الأعطال غير قابلة',
  all_cancelled: 'كل الأعطال مُلغاة',
  mixed: 'حالة مَختلطة',
  no_problems: 'لا توجد أعطال',
};

const DERIVED_COLORS: Record<string, string> = {
  fully_resolved: 'border-emerald-400 bg-emerald-500 text-white',
  partially_resolved: 'border-amber-400 bg-amber-500 text-white',
  all_deferred: 'border-yellow-400 bg-yellow-500 text-white',
  partially_unresolvable: 'border-orange-400 bg-orange-500 text-white',
  fully_unresolvable: 'border-red-400 bg-red-500 text-white',
  all_cancelled: 'border-slate-400 bg-slate-500 text-white',
  mixed: 'border-violet-400 bg-violet-500 text-white',
  no_problems: 'border-slate-300 bg-slate-300 text-slate-700',
};

export default function CostsForm({
  taskId,
  initialData,
  readOnly = false,
  onSaved,
  onBack,
  maintenanceKind = 'emergency',
  sourceServiceRequestId = null,
  derivedOutcome = null,
  periodicAttachmentCandidate = null,
}: Props) {
  const isNewPath = sourceServiceRequestId != null;
  const isPeriodic = maintenanceKind === 'periodic';
  const decisionOptions: DecisionOption[] = isPeriodic ? [...PERIODIC_DECISIONS] : [...DECISIONS];

  // ── Decision ───────────────────────────────────────────────────────────────
  const [finalDecision, setFinalDecision]       = useState<DecisionValue | ''>(initialData?.finalDecision ?? '');
  const [decisionReasonId, setDecisionReasonId] = useState(initialData?.decisionReasonId ? String(initialData.decisionReasonId) : '');
  const [followUpPriority, setFollowUpPriority] = useState(initialData?.followUpPriority ?? 'High');
  const [followUpExpectedDate, setFollowUpExpectedDate] = useState(initialData?.followUpExpectedDate ?? '');
  const [closingNotes, setClosingNotes]         = useState(initialData?.closingNotes ?? '');
  const [coverPeriodic, setCoverPeriodic]       = useState(false);

  // ── Costs breakdown ────────────────────────────────────────────────────────
  const [transportFee, setTransportFee]         = useState(String(initialData?.transportFee ?? ''));
  const [assemblyFee, setAssemblyFee]           = useState(String(initialData?.assemblyFee ?? ''));
  const [discountPct, setDiscountPct]           = useState(String(initialData?.discountPercentage ?? ''));
  const [discountReasonId, setDiscountReasonId] = useState(initialData?.discountReasonId ? String(initialData.discountReasonId) : '');
  const [partsCostTotal, setPartsCostTotal]     = useState(0);

  // ── Payment type ───────────────────────────────────────────────────────────
  const [paymentType, setPaymentType]           = useState(initialData?.paymentType ?? '');
  const [hasFirstPayment, setHasFirstPayment]   = useState(initialData?.hasFirstPayment ?? false);

  // ── Payment entries (cash OR first-payment portion) ───────────────────────
  const [paymentEntries, setPaymentEntries]     = useState<PaymentEntry[]>([newEntry()]);

  // ── Installments ──────────────────────────────────────────────────────────
  const [installments, setInstallments]         = useState<Installment[]>([]);
  const [installmentsConfirmed, setInstallmentsConfirmed] = useState(false);

  // ── Employee ───────────────────────────────────────────────────────────────
  const [closingEmployeeId, setClosingEmployeeId] = useState(initialData?.closingEmployeeId ? String(initialData.closingEmployeeId) : '');
  const [employees, setEmployees]                 = useState<any[]>([]);
  const [invoiceNotes, setInvoiceNotes]           = useState(initialData?.invoiceNotes ?? '');

  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');
  const [saved, setSaved]   = useState(false);
  const isFollowupDecision = finalDecision === 'needs_followup'
    || finalDecision === 'partially_performed'
    || finalDecision === 'not_performed';
  const requiresDecisionReason = finalDecision === 'partially_performed'
    || finalDecision === 'not_performed';

  const activeDecision  = decisionOptions.find(d => d.value === finalDecision);
  const decisionReasons = useSystemListItems(activeDecision?.reasonKey ?? '');
  const discountReasons = useSystemListItems('discount_reason');

  // ── Load on mount ──────────────────────────────────────────────────────────
  useEffect(() => {
    api.emergencyResult.getParts(taskId)
      .then(parts => setPartsCostTotal(parts.reduce((s: number, p: any) => {
        const status = p.executionStatus ?? (p.placementState === 'customer_stock' ? 'delivered_to_customer_stock' : 'replaced');
        return status === 'replaced' || status === 'delivered_to_customer_stock'
          ? s + Number(p.lineTotal ?? 0)
          : s;
      }, 0)))
      .catch(() => {});
    api.employees.list().then(setEmployees).catch(() => {});
    if (initialData) {
      api.emergencyResult.getPaymentEntries(taskId)
        .then(entries => { if (entries.length) setPaymentEntries(entries.map((e: any) => ({ ...e, _key: String(e.id), amountValue: String(e.amountValue ?? ''), exchangeRate: String(e.exchangeRate ?? ''), transferCompanyId: e.transferCompanyId ? String(e.transferCompanyId) : '' }))); })
        .catch(() => {});
      api.emergencyResult.getInstallments(taskId)
        .then(data => {
          if (data.installments?.length) {
            setInstallments(data.installments.map((i: any) => ({ ...i, amountSyp: String(i.amountSyp) })));
            setInstallmentsConfirmed(data.confirmed);
            setHasFirstPayment(data.hasFirstPayment);
          }
        })
        .catch(() => {});
    }
  }, [taskId]);

  // Reset incompatible saved selections if the same component is reused for another maintenance kind.
  useEffect(() => {
    if (finalDecision && !decisionOptions.some(d => d.value === finalDecision)) {
      setFinalDecision('');
      setDecisionReasonId('');
    }
  }, [maintenanceKind]);

  // Phase 6c.2 — On the new path, auto-map derivedOutcome to a legacy
  // final_decision value so the existing save logic + CHECK constraint
  // stay happy. Re-runs whenever the outcome changes.
  useEffect(() => {
    if (isNewPath && !isPeriodic && derivedOutcome) {
      const mapped = DERIVED_TO_LEGACY[derivedOutcome.outcome] ?? 'resolved';
      setFinalDecision(mapped);
    }
  }, [isNewPath, isPeriodic, derivedOutcome?.outcome]);

  // ── Calculations ───────────────────────────────────────────────────────────
  const transport  = Number(transportFee) || 0;
  const assembly   = Number(assemblyFee)  || 0;
  const discPctNum = Number(discountPct)  || 0;
  const subtotal   = partsCostTotal + transport + assembly;
  const discAmt    = Math.round(subtotal * discPctNum / 100);
  const grandTotal = subtotal - discAmt;

  const entrySyp = (e: PaymentEntry) => {
    const v = Number(e.amountValue) || 0;
    if (e.method === 'barter') return v;
    return e.currency === 'usd' ? v * (Number(e.exchangeRate) || 0) : v;
  };
  const totalFirstPaymentSyp = paymentType === 'installment' && hasFirstPayment
    ? paymentEntries.reduce((s, e) => s + entrySyp(e), 0)
    : paymentType === 'cash'
      ? paymentEntries.reduce((s, e) => s + entrySyp(e), 0)
      : 0;
  const installableAmount = grandTotal - (paymentType === 'installment' ? totalFirstPaymentSyp : 0);

  // ── Shared save logic (quiet = no onSaved trigger) ────────────────────────
  const saveCostsAndEntries = async () => {
    await api.emergencyResult.saveCosts(taskId, {
      finalDecision,
      closingNotes:        closingNotes.trim() || null,
      partsCost:           partsCostTotal,
      transportFee:        transport,
      assemblyFee:         assembly,
      discountPercentage:  discPctNum,
      discountReasonId:    discountReasonId ? Number(discountReasonId) : null,
      invoiceNotes:        invoiceNotes.trim() || null,
      decisionReasonId:    decisionReasonId ? Number(decisionReasonId) : null,
      followUpPriority:    finalDecision === 'needs_followup' ? followUpPriority : null,
      followUpExpectedDate: finalDecision === 'needs_followup' && followUpExpectedDate ? followUpExpectedDate : null,
      paymentType:         paymentType || null,
      hasFirstPayment:     paymentType === 'installment' ? hasFirstPayment : null,
      closingEmployeeId:   closingEmployeeId ? Number(closingEmployeeId) : null,
      coveredPeriodicTaskId: !isPeriodic && coverPeriodic && periodicAttachmentCandidate
        ? periodicAttachmentCandidate.taskId
        : null,
    });
    const validEntries = paymentEntries.filter(e => e.method && Number(e.amountValue) > 0);
    if (validEntries.length) await api.emergencyResult.savePaymentEntries(taskId, validEntries);
  };

  // ── Save (with onSaved trigger) ───────────────────────────────────────────
  const handleSave = async () => {
    if (!finalDecision) { setError('يجب تحديد القرار النهائي'); return; }
    if (requiresDecisionReason && !decisionReasonId) { setError('يجب تحديد سبب القرار'); return; }
    setSaving(true); setError('');
    try {
      await saveCostsAndEntries();
      setSaved(true);
      onSaved();
    } catch (err: any) { setError(err.message || 'فشل الحفظ'); }
    finally { setSaving(false); }
  };

  const handleSaveInstallments = async (rows: Installment[], count: number) => {
    // Auto-save costs first if not yet saved
    if (!initialData && finalDecision) await saveCostsAndEntries().catch(() => {});
    await api.emergencyResult.saveInstallments(taskId, {
      installments: rows, hasFirstPayment, installmentsCount: count,
    });
    setInstallments(rows);
  };

  const handleConfirmInstallments = async (rows: Installment[]) => {
    if (!finalDecision) throw new Error('يجب تحديد القرار النهائي أولاً');
    // 1. حفظ التكاليف (يضمن وجود costsId)
    await saveCostsAndEntries();
    // 2. حفظ الأقساط بالصفوف الحالية من المكوّن مباشرة
    await api.emergencyResult.saveInstallments(taskId, {
      installments: rows, hasFirstPayment, installmentsCount: rows.length,
    });
    // 3. اعتماد الجدول
    await api.emergencyResult.confirmInstallments(taskId);
    setInstallmentsConfirmed(true);
    setInstallments(rows);
    setSaved(true);
    onSaved();
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <Card padding="none" className="overflow-hidden" dir="rtl">
      <div className="px-5 py-3.5 border-b border-slate-100 bg-rose-50/50 flex items-center justify-between">
        <h3 className="font-bold text-slate-800 text-base">تكاليف الصيانة والقرار النهائي</h3>
        {(initialData || saved) && (
          <Badge variant="success" size="sm">محفوظة ✓</Badge>
        )}
      </div>

      <div className="p-5 space-y-5">

        {/* ══ القرار النهائي ══ */}
        {isNewPath && !isPeriodic ? (
          // Phase 6c.2 — readonly derived_outcome badge (§٠.١٩.ح).
          // The user no longer picks one of the 4 manual DECISIONS; the
          // result is computed from the problems list. The legacy
          // finalDecision is auto-mapped for the DB write below.
          <div>
            <SectionLabel>النتيجة المُحسوبة (من لائحة الأعطال)</SectionLabel>
            {derivedOutcome ? (
              <div className={`rounded-xl border-2 px-4 py-3 flex items-center justify-between ${DERIVED_COLORS[derivedOutcome.outcome] ?? 'border-slate-200 bg-slate-100 text-slate-600'}`}>
                <div>
                  <div className="text-sm font-black">
                    {DERIVED_LABELS[derivedOutcome.outcome] ?? derivedOutcome.outcome}
                  </div>
                  <div className="text-xs opacity-80 mt-0.5">
                    {Object.entries(derivedOutcome.counts).map(([k, n]) => `${k}: ${n}`).join(' • ') || '—'}
                  </div>
                </div>
                <CheckCircle2 className="h-6 w-6 opacity-90" />
              </div>
            ) : (
              <div className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded p-3">
                لا توجد أعطال على هذه المهمة بعد.
              </div>
            )}
            <p className="text-xs text-slate-500 mt-2">
              النتيجة محسوبة آلياً من لائحة الأعطال (§٠.١٩.ح). لا يَتمّ اختيار قرار يدوي على المَسار الجديد.
            </p>
          </div>
        ) : (
          <div>
            <SectionLabel>القرار النهائي <span className="text-red-500 normal-case">*</span></SectionLabel>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {decisionOptions.map(d => (
                <button key={d.value} type="button" disabled={readOnly}
                  onClick={() => { setFinalDecision(d.value); setDecisionReasonId(''); }}
                  className={`flex flex-col items-center gap-1.5 px-3 py-3 rounded-xl border-2 text-xs font-bold transition-all ${
                    finalDecision === d.value ? `${d.cls} text-white` : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
                  }`}>
                  {finalDecision === d.value && <CheckCircle2 className="h-4 w-4" />}
                  <span>{d.label}</span>
                  <span className={`text-xs font-normal ${finalDecision === d.value ? 'opacity-75' : 'text-slate-400'}`}>{d.description}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ══ سبب القرار ══ */}
        {!isPeriodic && periodicAttachmentCandidate && (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={coverPeriodic}
                disabled={readOnly}
                onChange={(e) => setCoverPeriodic(e.target.checked)}
                className="mt-1 h-4 w-4 rounded border-emerald-300 text-emerald-600 focus:ring-emerald-500"
              />
              <span className="text-sm text-emerald-900">
                <span className="block font-black">أُنجزت الدورية المستحقة ضمن هذه الطارئة</span>
                <span className="mt-1 block text-xs text-emerald-800">
                  الدورية #{periodicAttachmentCandidate.taskId}، تاريخها {periodicAttachmentCandidate.dueDate}،
                  الفارق {periodicAttachmentCandidate.daysUntilDue} يوم ضمن نافذة {periodicAttachmentCandidate.attachWindowDays} يوم.
                </span>
              </span>
            </label>
          </div>
        )}

        {finalDecision && activeDecision?.reasonKey && (
          <div className="space-y-1">
            <label className="block text-xs font-bold text-slate-600">
              سبب {activeDecision?.label}
              {requiresDecisionReason
                ? <span className="text-red-500 normal-case"> *</span>
                : <span className="font-normal text-slate-400"> (اختياري)</span>}
            </label>
            <Select
              value={decisionReasonId}
              onChange={setDecisionReasonId}
              disabled={readOnly || decisionReasons.loading}
              placeholder="— اختر السبب —"
              ariaLabel="سبب القرار"
              className="w-full"
              options={decisionReasons.items.map(r => ({ value: String(r.id), label: r.value }))}
            />
          </div>
        )}

        {/* ══ needs_followup — hidden on new path (no cascade per V-R007) ══ */}
        {finalDecision === 'needs_followup' && !isNewPath && (
          <div className="rounded-2xl border-2 border-violet-200 bg-violet-50/30 p-4 space-y-3">
            <div className="flex items-center gap-2 text-xs font-bold text-violet-700">
              <Plus className="h-4 w-4" /> ستُنشأ مهمة طوارئ جديدة بعد الحفظ
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="block text-xs font-bold text-slate-600">الأولوية <span className="text-red-400">*</span></label>
                <div className="flex gap-1.5">
                  {PRIORITY_META.map(p => (
                    <button key={p.value} type="button" disabled={readOnly}
                      onClick={() => setFollowUpPriority(p.value)}
                      className={`flex-1 py-1.5 rounded-lg border-2 text-xs font-bold transition-all ${followUpPriority === p.value ? `${p.cls} border-current` : 'bg-white border-slate-200 text-slate-500'}`}>
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-1">
                <label className="block text-xs font-bold text-slate-600">التاريخ المتوقع <span className="text-red-400">*</span></label>
                <input type="date" value={followUpExpectedDate}
                  onChange={e => setFollowUpExpectedDate(e.target.value)}
                  min={new Date().toISOString().slice(0,10)}
                  disabled={readOnly} className={inp} />
              </div>
            </div>
          </div>
        )}

        {/* ══ ملاحظات الإغلاق ══ */}
        <div className="space-y-1">
          <label className="block text-xs font-bold text-slate-600">ملاحظات الإغلاق</label>
          <textarea value={closingNotes} onChange={e => setClosingNotes(e.target.value)}
            rows={2} disabled={readOnly} className={`${inp} resize-none`} placeholder="ملاحظات ختامية..." />
        </div>

        {/* ══ التكاليف ══ */}
        <div className="rounded-2xl border border-slate-200 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 bg-slate-50 border-b border-slate-100">
            <span className="text-xs font-bold text-slate-600">إجمالي القطع المنفذة</span>
            <span className="font-black text-slate-800">{partsCostTotal.toLocaleString('ar-SY')} ل.س</span>
          </div>
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
            <label className="text-xs font-bold text-slate-600 shrink-0">أجور مواصلات وخدمة</label>
            <input type="number" min="0" value={transportFee} onChange={e => setTransportFee(e.target.value)}
              placeholder="0" disabled={readOnly}
              className="w-36 rounded-xl border border-slate-200 px-3 py-1.5 text-sm text-left font-bold focus:outline-none focus:border-rose-400 bg-white" dir="ltr" />
          </div>
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
            <label className="text-xs font-bold text-slate-600 shrink-0">أجور فك أو تركيب</label>
            <input type="number" min="0" value={assemblyFee} onChange={e => setAssemblyFee(e.target.value)}
              placeholder="0" disabled={readOnly}
              className="w-36 rounded-xl border border-slate-200 px-3 py-1.5 text-sm text-left font-bold focus:outline-none focus:border-rose-400 bg-white" dir="ltr" />
          </div>
          <div className="flex items-center justify-between px-4 py-3 bg-slate-50 border-b border-slate-200">
            <span className="text-xs font-bold text-slate-500">المجموع قبل الحسم</span>
            <span className="font-bold text-slate-700">{subtotal.toLocaleString('ar-SY')} ل.س</span>
          </div>
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
            <label className="text-xs font-bold text-slate-600 shrink-0">نسبة الحسم %</label>
            <div className="flex items-center gap-2">
              <input type="number" min="0" max="100" value={discountPct} onChange={e => setDiscountPct(e.target.value)}
                placeholder="0" disabled={readOnly}
                className="w-24 rounded-xl border border-slate-200 px-3 py-1.5 text-sm text-center font-bold focus:outline-none focus:border-amber-400 bg-white" />
              {discAmt > 0 && <span className="text-xs font-bold text-amber-700">− {discAmt.toLocaleString('ar-SY')} ل.س</span>}
            </div>
          </div>
          {discPctNum > 0 && (
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-amber-50/40">
              <label className="text-xs font-bold text-amber-700 shrink-0">سبب الحسم</label>
              <Select
                value={discountReasonId}
                onChange={setDiscountReasonId}
                disabled={readOnly}
                placeholder="— اختر —"
                ariaLabel="سبب الحسم"
                size="sm"
                className="w-48"
                options={discountReasons.items.map(r => ({ value: String(r.id), label: r.value }))}
              />
            </div>
          )}
          <div className="flex items-center justify-between px-4 py-4 bg-emerald-50 border-t-2 border-emerald-200">
            <span className="text-sm font-black text-emerald-800">الإجمالي الواجب دفعه</span>
            <span className="text-lg font-black text-emerald-700">{grandTotal.toLocaleString('ar-SY')} ل.س</span>
          </div>
        </div>

        {/* ══ نوع الدفع ══ */}
        <div className="rounded-2xl border border-slate-200 overflow-hidden">
          <div className="px-4 py-3 bg-slate-50 border-b border-slate-100">
            <SectionLabel>تفاصيل الدفع</SectionLabel>
          </div>
          <div className="p-4 space-y-4">

            {/* نوع الدفع */}
            <div>
              <label className="block text-xs font-bold text-slate-600 mb-2">نوع الدفع</label>
              <div className="flex gap-2">
                {[
                  { value: 'cash',        label: 'كاش',   desc: 'المبلغ دفعة واحدة' },
                  { value: 'installment', label: 'تقسيط', desc: 'دفعة أولى + أقساط' },
                ].map(pt => (
                  <button key={pt.value} type="button" disabled={readOnly}
                    onClick={() => setPaymentType(pt.value)}
                    className={`flex-1 flex flex-col items-center gap-1 py-2.5 rounded-xl border-2 text-xs font-bold transition-all ${
                      paymentType === pt.value ? 'border-rose-400 bg-rose-50 text-rose-700' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                    }`}>
                    <span>{pt.label}</span>
                    <span className="font-normal text-xs opacity-60">{pt.desc}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* ── كاش: دفعات جزئية ── */}
            {paymentType === 'cash' && (
              <PaymentEntriesList
                entries={paymentEntries}
                onChange={setPaymentEntries}
                disabled={readOnly}
                grandTotal={grandTotal}
                label="الدفعات الجزئية"
              />
            )}

            {/* ── تقسيط ── */}
            {paymentType === 'installment' && (
              <div className="space-y-4">

                {/* هل يوجد دفعة أولى؟ */}
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-2">هل يوجد دفعة أولى؟</label>
                  <div className="flex gap-2">
                    {[{ v: true, l: 'نعم' }, { v: false, l: 'لا' }].map(opt => (
                      <button key={String(opt.v)} type="button" disabled={readOnly}
                        onClick={() => setHasFirstPayment(opt.v)}
                        className={`flex-1 py-2 rounded-xl border-2 text-xs font-bold transition-all ${
                          hasFirstPayment === opt.v ? 'border-rose-400 bg-rose-50 text-rose-700' : 'border-slate-200 bg-white text-slate-500'
                        }`}>
                        {opt.l}
                      </button>
                    ))}
                  </div>
                </div>

                {/* الدفعة الأولى */}
                {hasFirstPayment && (
                  <PaymentEntriesList
                    entries={paymentEntries}
                    onChange={setPaymentEntries}
                    disabled={readOnly}
                    grandTotal={grandTotal}
                    label="الدفعة الأولى (الجزء المقدّم)"
                  />
                )}

                {/* جدول الأقساط */}
                <div>
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                    جدول الأقساط
                    {hasFirstPayment && totalFirstPaymentSyp > 0 && (
                      <span className="mr-2 font-normal normal-case text-slate-500">
                        المبلغ المقسّط: {installableAmount.toLocaleString('ar-SY')} ل.س
                      </span>
                    )}
                  </p>
                  <InstallmentsSchedule
                    installableAmount={installableAmount}
                    initialInstallments={installments.length ? installments : undefined}
                    confirmed={installmentsConfirmed}
                    onSave={handleSaveInstallments}
                    onConfirm={handleConfirmInstallments}
                    disabled={readOnly}
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ══ موظف التسكير ══ */}
        <div className="space-y-1">
          <label className="block text-xs font-bold text-slate-600">
            موظف التسكير
            <span className="font-normal text-slate-400 mr-1 text-xs">(الموظف الذي استلم الدفعة وأغلق المهمة)</span>
          </label>
          <Select
            value={closingEmployeeId}
            onChange={setClosingEmployeeId}
            disabled={readOnly}
            placeholder="— اختر الموظف —"
            ariaLabel="موظف التسكير"
            className="w-full"
            options={employees.map(e => ({ value: String(e.id), label: e.name }))}
          />
        </div>

        {/* ══ ملاحظات الفاتورة ══ */}
        <div className="space-y-1">
          <label className="block text-xs font-bold text-slate-600">ملاحظات الفاتورة</label>
          <textarea value={invoiceNotes} onChange={e => setInvoiceNotes(e.target.value)}
            rows={2} disabled={readOnly} className={`${inp} resize-none`} placeholder="تفاصيل الفاتورة..." />
        </div>

        {error && (
          <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-xs font-bold text-red-700">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />{error}
          </div>
        )}

        {!readOnly && (
          <div className="flex gap-2 pt-1">
            {onBack && (
              <button type="button" onClick={onBack}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-50">
                <ArrowRight className="h-4 w-4" /> السابق
              </button>
            )}
            <button type="button" onClick={handleSave}
              disabled={saving || !finalDecision || (requiresDecisionReason && !decisionReasonId) || (finalDecision === 'needs_followup' && !isNewPath && !followUpExpectedDate)}
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-rose-500 disabled:opacity-60 shadow-sm">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {saving ? 'جاري الحفظ...' : isFollowupDecision ? 'حفظ مع متابعة' : 'حفظ وإنهاء'}
            </button>
          </div>
        )}
      </div>

    </Card>
  );
}
