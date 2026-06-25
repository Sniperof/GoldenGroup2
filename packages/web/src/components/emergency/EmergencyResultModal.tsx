import { useState } from 'react';
import Modal from '../ui/Modal';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import type { EmergencyFinalDecision } from '@golden-crm/shared';
import {
  EMERGENCY_FINAL_DECISION_LABELS,
  EMERGENCY_FINAL_DECISION_DESCRIPTIONS,
} from '@golden-crm/shared';
import Select from '../ui/Select';

export type { EmergencyFinalDecision };

export interface EmergencyResultPayload {
  finalDecision: EmergencyFinalDecision;
  closingNotes: string;
  technicalState?: {
    problemConfirmed?: boolean;
    technicalNotes?: string;
    waterTdsBefore?: number | null;
    waterTdsAfter?: number | null;
    membraneOutput?: 'Good' | 'Weak' | 'Dead' | '';
  };
  partsUsed?: Array<{
    partNameSnapshot: string;
    quantity: number;
    unitPrice?: number | null;
  }>;
  financials?: {
    laborCost?: number | null;
    partsCost?: number | null;
    totalCost?: number | null;
    paymentMethod?: string;
    collectedAmount?: number | null;
    invoiceNotes?: string;
  };
}

const DECISION_OPTIONS: Array<{ value: EmergencyFinalDecision }> = [
  { value: 'resolved' },
  { value: 'partially_resolved' },
  { value: 'unresolved' },
  { value: 'needs_followup' },
  { value: 'cancelled' },
];

const DECISION_COLORS: Record<EmergencyFinalDecision, string> = {
  resolved:           'border-emerald-500 bg-emerald-50 text-emerald-800',
  partially_resolved: 'border-amber-400 bg-amber-50 text-amber-800',
  unresolved:         'border-rose-400 bg-rose-50 text-rose-800',
  needs_followup:     'border-sky-400 bg-sky-50 text-sky-800',
  cancelled:          'border-slate-400 bg-slate-100 text-slate-600',
};

interface PartRow {
  partNameSnapshot: string;
  quantity: number;
  unitPrice: string;
}

// DEC-CT-17: the maintenance modal is colour-coded by the device's ACTIVE
// warranty — blue=contract, gold=golden, neutral=none — so the technician sees
// the expected coverage at a glance. It does NOT lock costs (DEC-CT-16 §3).
export type ActiveWarrantyKind = 'contract' | 'golden';
const WARRANTY_THEME: Record<ActiveWarrantyKind, { band: string; badge: string; label: string }> = {
  contract: { band: 'bg-sky-50 border-sky-200',   badge: 'bg-sky-100 text-sky-800 border-sky-300',     label: 'كفالة عقد' },
  golden:   { band: 'bg-amber-50 border-amber-200', badge: 'bg-amber-100 text-amber-800 border-amber-300', label: 'كفالة ذهبية' },
};

interface Props {
  isOpen: boolean;
  saving: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (payload: EmergencyResultPayload) => Promise<void>;
  /** Device's active warranty (drives the header colour). Omit when none. */
  activeWarranty?: { type: ActiveWarrantyKind; endDate?: string | null } | null;
}

function parseOptNum(v: string): number | null {
  const n = Number(v);
  return v.trim() !== '' && Number.isFinite(n) && n >= 0 ? n : null;
}

export default function EmergencyResultModal({ isOpen, saving, error, onClose, onSubmit, activeWarranty }: Props) {
  const [finalDecision, setFinalDecision] = useState<EmergencyFinalDecision | ''>('');
  const [closingNotes, setClosingNotes] = useState('');

  // Technical state
  const [problemConfirmed, setProblemConfirmed] = useState(false);
  const [technicalNotes, setTechnicalNotes] = useState('');
  const [waterTdsBefore, setWaterTdsBefore] = useState('');
  const [waterTdsAfter, setWaterTdsAfter] = useState('');
  const [membraneOutput, setMembraneOutput] = useState<'Good' | 'Weak' | 'Dead' | ''>('');

  // Parts
  const [parts, setParts] = useState<PartRow[]>([]);

  // Financials
  const [laborCost, setLaborCost] = useState('');
  const [partsCostField, setPartsCostField] = useState('');
  const [totalCost, setTotalCost] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [collectedAmount, setCollectedAmount] = useState('');
  const [invoiceNotes, setInvoiceNotes] = useState('');

  const [validationError, setValidationError] = useState('');

  const warrantyTheme = activeWarranty ? WARRANTY_THEME[activeWarranty.type] : null;

  const addPart = () => setParts((p) => [...p, { partNameSnapshot: '', quantity: 1, unitPrice: '' }]);
  const removePart = (i: number) => setParts((p) => p.filter((_, idx) => idx !== i));
  const updatePart = (i: number, field: keyof PartRow, value: string | number) => {
    setParts((p) => p.map((part, idx) => idx === i ? { ...part, [field]: value } : part));
  };

  const handleSubmit = async () => {
    setValidationError('');
    if (!finalDecision) {
      setValidationError('يرجى اختيار نتيجة المهمة');
      return;
    }
    if (!closingNotes.trim()) {
      setValidationError('ملاحظات الإغلاق مطلوبة');
      return;
    }

    const payload: EmergencyResultPayload = {
      finalDecision,
      closingNotes: closingNotes.trim(),
    };

    // Technical state (include if any field is filled)
    const hasTechnical = problemConfirmed || technicalNotes.trim() || waterTdsBefore || waterTdsAfter || membraneOutput;
    if (hasTechnical) {
      payload.technicalState = {
        problemConfirmed,
        technicalNotes: technicalNotes.trim() || undefined,
        waterTdsBefore: parseOptNum(waterTdsBefore),
        waterTdsAfter: parseOptNum(waterTdsAfter),
        membraneOutput: membraneOutput || undefined,
      };
    }

    // Parts (filter out empty rows)
    const validParts = parts.filter((p) => p.partNameSnapshot.trim());
    if (validParts.length > 0) {
      payload.partsUsed = validParts.map((p) => ({
        partNameSnapshot: p.partNameSnapshot.trim(),
        quantity: Math.max(1, Number(p.quantity) || 1),
        unitPrice: parseOptNum(p.unitPrice),
      }));
    }

    // Financials (include if any field is filled)
    const hasFinancials = laborCost || partsCostField || totalCost || paymentMethod || collectedAmount || invoiceNotes;
    if (hasFinancials) {
      payload.financials = {
        laborCost: parseOptNum(laborCost),
        partsCost: parseOptNum(partsCostField),
        totalCost: parseOptNum(totalCost),
        paymentMethod: paymentMethod.trim() || undefined,
        collectedAmount: parseOptNum(collectedAmount),
        invoiceNotes: invoiceNotes.trim() || undefined,
      };
    }

    await onSubmit(payload);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="2xl"
      closeOnBackdrop={false}
      closeOnEsc={!saving}
      title={
        <span className="flex items-center gap-3">
          تسجيل نتيجة زيارة الصيانة
          {warrantyTheme && (
            <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-bold ${warrantyTheme.badge}`}>
              {warrantyTheme.label}
              {activeWarranty?.endDate ? ` · حتى ${activeWarranty.endDate}` : ''}
            </span>
          )}
        </span>
      }
      footer={
        <>
          <button type="button" onClick={onClose} disabled={saving}
            className="rounded-xl px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-200 transition-colors">
            إلغاء
          </button>
          <button type="button" onClick={handleSubmit} disabled={saving}
            className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-emerald-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {saving ? 'جاري الحفظ...' : 'تسجيل النتيجة'}
          </button>
        </>
      }
    >
        <div className="p-6 space-y-6">
          {/* Final Decision */}
          <div className="space-y-2">
            <label className="text-sm font-bold text-slate-700">
              نتيجة الزيارة <span className="text-red-500">*</span>
            </label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {DECISION_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setFinalDecision(opt.value)}
                  className={`text-right rounded-xl border-2 px-4 py-3 transition-all ${
                    finalDecision === opt.value
                      ? `${DECISION_COLORS[opt.value]} border-2`
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <p className="text-sm font-bold">{EMERGENCY_FINAL_DECISION_LABELS[opt.value]}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{EMERGENCY_FINAL_DECISION_DESCRIPTIONS[opt.value]}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Closing Notes */}
          <div className="space-y-2">
            <label className="text-sm font-bold text-slate-700">
              ملاحظات الإغلاق <span className="text-red-500">*</span>
            </label>
            <textarea
              value={closingNotes}
              onChange={(e) => setClosingNotes(e.target.value)}
              rows={3}
              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-100"
              placeholder="ما الذي تم في الزيارة؟ ماذا وجد الفني؟"
            />
          </div>

          {/* Technical State */}
          <details className="rounded-xl border border-slate-200 bg-slate-50/50">
            <summary className="cursor-pointer px-4 py-3 text-sm font-bold text-slate-700 select-none">
              الحالة الفنية للجهاز (اختياري)
            </summary>
            <div className="px-4 pb-4 pt-2 space-y-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={problemConfirmed}
                  onChange={(e) => setProblemConfirmed(e.target.checked)}
                  className="rounded border-slate-300" />
                <span className="text-sm text-slate-700">تأكيد وجود المشكلة</span>
              </label>
              <div>
                <label className="text-xs font-bold text-slate-500 block mb-1">ملاحظات فنية</label>
                <textarea value={technicalNotes} onChange={(e) => setTechnicalNotes(e.target.value)}
                  rows={2}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-sky-400" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-500 block mb-1">TDS قبل (ppm)</label>
                  <input type="number" value={waterTdsBefore} onChange={(e) => setWaterTdsBefore(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-sky-400" />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-500 block mb-1">TDS بعد (ppm)</label>
                  <input type="number" value={waterTdsAfter} onChange={(e) => setWaterTdsAfter(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-sky-400" />
                </div>
              </div>
              <div>
                <label className="text-xs font-bold text-slate-500 block mb-1">حالة الغشاء</label>
                <Select<'Good' | 'Weak' | 'Dead' | ''>
                  value={membraneOutput}
                  onChange={setMembraneOutput}
                  placeholder="غير محدد"
                  ariaLabel="حالة الغشاء"
                  className="w-full"
                  options={[
                    { value: 'Good', label: 'جيد' },
                    { value: 'Weak', label: 'ضعيف' },
                    { value: 'Dead', label: 'تالف' },
                  ]}
                />
              </div>
            </div>
          </details>

          {/* Parts Used */}
          <details className="rounded-xl border border-slate-200 bg-slate-50/50">
            <summary className="cursor-pointer px-4 py-3 text-sm font-bold text-slate-700 select-none">
              القطع المستبدلة ({parts.filter((p) => p.partNameSnapshot.trim()).length})
            </summary>
            <div className="px-4 pb-4 pt-2 space-y-2">
              {parts.map((part, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder="اسم القطعة"
                    value={part.partNameSnapshot}
                    onChange={(e) => updatePart(i, 'partNameSnapshot', e.target.value)}
                    className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-sky-400"
                  />
                  <input
                    type="number"
                    min="1"
                    placeholder="الكمية"
                    value={part.quantity}
                    onChange={(e) => updatePart(i, 'quantity', Number(e.target.value))}
                    className="w-20 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-sky-400"
                  />
                  <input
                    type="number"
                    min="0"
                    placeholder="السعر"
                    value={part.unitPrice}
                    onChange={(e) => updatePart(i, 'unitPrice', e.target.value)}
                    className="w-28 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-sky-400"
                  />
                  <button type="button" onClick={() => removePart(i)}
                    className="p-1.5 rounded-lg text-rose-400 hover:bg-rose-50 transition-colors">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
              <button type="button" onClick={addPart}
                className="inline-flex items-center gap-1.5 text-sm font-bold text-sky-600 hover:text-sky-700 mt-1">
                <Plus className="w-4 h-4" />
                إضافة قطعة
              </button>
            </div>
          </details>

          {/* Financials */}
          <details className="rounded-xl border border-slate-200 bg-slate-50/50">
            <summary className="cursor-pointer px-4 py-3 text-sm font-bold text-slate-700 select-none">
              التكاليف المالية (اختياري)
            </summary>
            {warrantyTheme && (
              <div className="mx-4 mt-2 rounded-lg border border-slate-200 bg-white/70 px-3 py-2 text-xs text-slate-600">
                الجهاز ضمن <span className="font-bold">{warrantyTheme.label}</span> — التكلفة معدومة افتراضيًا، ويمكنك إدخال قيمة لأي قطعة أو كلفة عند الحاجة (لا إقفال).
              </div>
            )}
            <div className="px-4 pb-4 pt-2 grid grid-cols-2 gap-3">
              {[
                { label: 'تكلفة العمالة', value: laborCost, setter: setLaborCost },
                { label: 'تكلفة القطع', value: partsCostField, setter: setPartsCostField },
                { label: 'الإجمالي', value: totalCost, setter: setTotalCost },
                { label: 'المبلغ المحصّل', value: collectedAmount, setter: setCollectedAmount },
              ].map(({ label, value, setter }) => (
                <div key={label}>
                  <label className="text-xs font-bold text-slate-500 block mb-1">{label}</label>
                  <input type="number" min="0" value={value} onChange={(e) => setter(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-sky-400" />
                </div>
              ))}
              <div>
                <label className="text-xs font-bold text-slate-500 block mb-1">طريقة الدفع</label>
                <input type="text" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}
                  placeholder="كاش / تحويل / ..."
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-sky-400" />
              </div>
              <div className="col-span-2">
                <label className="text-xs font-bold text-slate-500 block mb-1">ملاحظات الفاتورة</label>
                <textarea value={invoiceNotes} onChange={(e) => setInvoiceNotes(e.target.value)}
                  rows={2}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-sky-400" />
              </div>
            </div>
          </details>

          {(validationError || error) && (
            <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
              {validationError || error}
            </div>
          )}
        </div>
    </Modal>
  );
}
