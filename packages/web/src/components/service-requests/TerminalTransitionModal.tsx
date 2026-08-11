// ============================================================
// TerminalTransitionModal — Phase 4 polish
// Replaces inline prompt() calls for the 4 in_review actions.
//
// Constitution: maintenance.md §٠.٣, §٠.٤, §٠.٥, §SR-AUTH-01
//
// Modes ('requestInfo' removed — request-section-contract.md §3):
//   - 'resolveAtIntake'  → resolved_at_intake (terminal)
//   - 'escalate'         → sets review_required_flag (non-terminal)
//   - 'cancel'           → cancelled (terminal)
//   - 'reject'           → rejected (terminal)
//
// All modes:
//   - Show a contextual warning when terminal.
//   - Enforce required fields client-side (matches backend validation).
//   - Use Arabic labels backed by the constitutional enum values.
// ============================================================
import { useEffect, useState } from 'react';
import { AlertTriangle } from '../ui/icons';
import Button, { type ButtonVariant } from '../ui/Button';
import Modal from '../ui/Modal';
import { api } from '../../lib/api';

export type ModalMode = 'resolveAtIntake' | 'escalate' | 'cancel' | 'reject';

interface Option {
  value: string;
  label: string;
  description?: string;
}

const RESOLVE_AT_INTAKE_LIST_BY_REQUEST_TYPE: Record<string, string> = {
  emergency_maintenance: 'service_request_resolve_at_intake_emergency_maintenance',
  water_check: 'service_request_resolve_at_intake_water_check',
  periodic_maintenance: 'service_request_resolve_at_intake_periodic_maintenance',
  golden_warranty: 'service_request_resolve_at_intake_golden_warranty',
};

const REJECT_LIST_BY_REQUEST_TYPE: Record<string, string> = {
  periodic_maintenance: 'service_request_rejection_periodic_maintenance',
  golden_warranty: 'service_request_rejection_golden_warranty',
};

function resolveAtIntakeListCode(requestType?: string | null): string {
  return RESOLVE_AT_INTAKE_LIST_BY_REQUEST_TYPE[requestType || '']
    ?? RESOLVE_AT_INTAKE_LIST_BY_REQUEST_TYPE.emergency_maintenance;
}

function optionFromSystemListItem(item: any, useId = false): Option {
  return {
    value: useId ? String(item?.id ?? '') : String(item?.value ?? ''),
    label: String(item?.metadata?.label ?? item?.label ?? item?.value ?? ''),
    description: item?.metadata?.description ? String(item.metadata.description) : undefined,
  };
}

const CANCEL_OUTCOMES: Option[] = [
  { value: 'data_entry_error',           label: 'خطأ في الإدخال',          description: 'الـ Operator أَخطأ عند الإنشاء' },
  { value: 'customer_withdrew_via_support', label: 'الزبون ألغى عبر دعم آخر', description: 'وَصلَنا اعتذار من قناة أخرى' },
  { value: 'redundant_with_existing_task',  label: 'مُكَرَّر مع مهمة قائمة',  description: 'يَنبغي التَحقُّق ودَمج إن لزم' },
];

// Reject outcomes — mirror stateMachine.ts TRIAGE_OUTCOMES_BY_TERMINAL.rejected.
// A closed radio list prevents the invalid_triage_outcome error that a free
// prompt allowed.
const REJECT_OUTCOMES: Option[] = [
  { value: 'duplicate',         label: 'مُكرَّر',               description: 'طلب مطابق لطلب آخر قائم' },
  { value: 'invalid_request',   label: 'طلب غير صالح',          description: 'بيانات ناقصة أو غير منطقية' },
  { value: 'spam',              label: 'مزعج / سبام',           description: 'طلب عبثي أو دعائي' },
  { value: 'out_of_scope',      label: 'خارج النطاق',           description: 'لا يخصّ خدماتنا' },
  { value: 'unverified_caller', label: 'متصل غير موثّق',        description: 'تعذّر التحقق من هوية مقدّم الطلب' },
  { value: 'device_not_company', label: 'الجهاز ليس من الشركة',  description: 'الجهاز خارج نطاق أجهزتنا' },
];

const MODE_CONFIG: Record<ModalMode, {
  title: string;
  badge: string;
  badgeClass: string;
  description: string;
  isTerminal: boolean;
  requiresOutcome: boolean;
  outcomes?: Option[];
  noteLabel: string;
  noteRequired: boolean;
  notePlaceholder: string;
  confirmText: string;
  confirmClass: string;
  confirmVariant: ButtonVariant;
}> = {
  resolveAtIntake: {
    title: 'حُلَّ في الاستلام',
    badge: 'نهائي',
    badgeClass: 'bg-emerald-100 text-emerald-700',
    description: 'إغلاق الطلب بَدون إنشاء مهمة. لا يُعاد فتحه إلا عبر "إعادة فتح".',
    isTerminal: true,
    requiresOutcome: true,
    noteLabel: 'ملاحظات الفرز',
    noteRequired: true,
    notePlaceholder: 'وَصف موجز لكيفية الحلّ + أي إرشاد للزبون',
    confirmText: 'تَأكيد الحلّ',
    confirmClass: 'bg-emerald-600 hover:bg-emerald-700',
    confirmVariant: 'primary',
  },
  escalate: {
    title: 'تَصعيد للمدقّق',
    badge: 'يَفتح باب الرفض',
    badgeClass: 'bg-red-100 text-red-700',
    description: 'يُرفَع علم "يَحتاج مراجعة" — يُمَكِّن المدقّق من رفض الطلب (SR-AUTH-01).',
    isTerminal: false,
    requiresOutcome: false,
    noteLabel: 'سبب التَصعيد',
    noteRequired: true,
    notePlaceholder: 'لِمَ يَستحقّ المراجعة؟ مَثلاً: مشكوك في الإبلاغ، أو خارج النطاق',
    confirmText: 'تَأكيد التَصعيد',
    confirmClass: 'bg-red-600 hover:bg-red-700',
    confirmVariant: 'danger',
  },
  cancel: {
    title: 'إلغاء إداري',
    badge: 'نهائي',
    badgeClass: 'bg-slate-100 text-slate-700',
    description: 'إغلاق إداري للطلب. لا cascade. يُمكن إعادة الفتح لاحقاً.',
    isTerminal: true,
    requiresOutcome: true,
    outcomes: CANCEL_OUTCOMES,
    noteLabel: 'سبب الإلغاء',
    noteRequired: true,
    notePlaceholder: 'تَفاصيل إضافية تَتعلَّق بالسبب المُختار',
    confirmText: 'تَأكيد الإلغاء',
    confirmClass: 'bg-slate-700 hover:bg-slate-800',
    confirmVariant: 'primary',
  },
  reject: {
    title: 'رَفض الطلب (مدقّق)',
    badge: 'نهائي',
    badgeClass: 'bg-red-100 text-red-700',
    description: 'رفض نهائي للطلب. يتطلب سبباً من القائمة. يُمكن إعادة الفتح لاحقاً بصلاحية المدقّق.',
    isTerminal: true,
    requiresOutcome: true,
    outcomes: REJECT_OUTCOMES,
    noteLabel: 'ملاحظة الرفض',
    noteRequired: false,
    notePlaceholder: 'تفاصيل إضافية (اختياري)',
    confirmText: 'تَأكيد الرفض',
    confirmClass: 'bg-red-600 hover:bg-red-700',
    confirmVariant: 'danger',
  },
};

interface Props {
  mode: ModalMode;
  requestType?: string | null;
  onClose: () => void;
  onConfirm: (data: {
    triageOutcome?: string;
    decisionReasonId?: number;
    triageNotes?: string;
    note?: string;
  }) => Promise<void>;
}

export default function TerminalTransitionModal({ mode, requestType, onClose, onConfirm }: Props) {
  const cfg = MODE_CONFIG[mode];
  const [resolveOutcomes, setResolveOutcomes] = useState<Option[]>([]);
  const [resolveOutcomesLoading, setResolveOutcomesLoading] = useState(false);
  const [resolveOutcomesError, setResolveOutcomesError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmStep, setConfirmStep] = useState(false);

  useEffect(() => {
    const listCode = mode === 'resolveAtIntake'
      ? resolveAtIntakeListCode(requestType)
      : mode === 'reject' ? REJECT_LIST_BY_REQUEST_TYPE[requestType || ''] : null;
    if (!listCode) return;
    let active = true;
    setOutcome('');
    setResolveOutcomes([]);
    setResolveOutcomesError(null);
    setResolveOutcomesLoading(true);
    api.systemLists
      .getItemsByCode(listCode)
      .then((rows) => {
        if (!active) return;
        setResolveOutcomes(
          (Array.isArray(rows) ? rows : [])
            .filter((row: any) => row?.isActive !== false)
            .map((row: any) => optionFromSystemListItem(
              row,
              requestType === 'periodic_maintenance' || requestType === 'golden_warranty',
            ))
            .filter((option) => option.value && option.label),
        );
      })
      .catch((e: any) => {
        if (active) setResolveOutcomesError(e?.message ?? 'تعذر تحميل قائمة الأسباب الإدارية');
      })
      .finally(() => {
        if (active) setResolveOutcomesLoading(false);
      });
    return () => {
      active = false;
    };
  }, [mode, requestType]);

  const usesAdministrativeOutcomes = mode === 'resolveAtIntake'
    || (mode === 'reject' && (requestType === 'periodic_maintenance' || requestType === 'golden_warranty'));
  const outcomes = usesAdministrativeOutcomes ? resolveOutcomes : (cfg.outcomes ?? []);
  const noteOk = !cfg.noteRequired || note.trim().length > 0;
  const outcomeOk = !cfg.requiresOutcome || outcome !== '';
  const canSubmit = noteOk && outcomeOk && !busy && !(usesAdministrativeOutcomes && resolveOutcomesLoading);

  async function handleConfirm() {
    if (cfg.isTerminal && !confirmStep) {
      setConfirmStep(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // Map the modal fields to the right API shape per mode.
      const payload: any = {};
      if (cfg.requiresOutcome) {
        if (
          (requestType === 'periodic_maintenance' || requestType === 'golden_warranty')
          && (mode === 'resolveAtIntake' || mode === 'reject')
        ) {
          payload.decisionReasonId = Number(outcome);
        } else {
          payload.triageOutcome = outcome;
        }
      }
      // For resolve_at_intake the field is triageNotes; for cancel it's the
      // same; for escalate it's "reason" (note in audit). For requestInfo we
      // pass triageNotes too so the operator's expectation is recorded.
      if (mode === 'escalate') {
        payload.note = note.trim();
      } else {
        payload.triageNotes = note.trim();
        payload.note = note.trim();
      }
      await onConfirm(payload);
    } catch (e: any) {
      setError(e?.message ?? 'فَشلت العملية');
      setBusy(false);
      setConfirmStep(false);
    }
  }

  return (
    <Modal
      isOpen
      onClose={onClose}
      size="lg"
      closeOnEsc={!busy}
      closeOnBackdrop={!busy}
      title={
        <span className="flex items-center gap-2">
          {cfg.title}
          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${cfg.badgeClass}`}>{cfg.badge}</span>
        </span>
      }
    >
        <div className="p-4 space-y-4">
          <div className={`flex items-start gap-2 text-sm p-3 rounded ${
            cfg.isTerminal ? 'bg-amber-50 border border-amber-200 text-amber-900' : 'bg-blue-50 border border-blue-200 text-blue-900'
          }`}>
            <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <p>{cfg.description}</p>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm p-2 rounded">
              {error}
            </div>
          )}

          {usesAdministrativeOutcomes && resolveOutcomesLoading && (
            <div className="rounded border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
              جارٍ تحميل قائمة الأسباب الإدارية...
            </div>
          )}

          {usesAdministrativeOutcomes && resolveOutcomesError && (
            <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {resolveOutcomesError}
            </div>
          )}

          {usesAdministrativeOutcomes && !resolveOutcomesLoading && !resolveOutcomesError && outcomes.length === 0 && (
            <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              لا توجد أسباب فعّالة ضمن قائمة هذا النوع من الطلب. أضف سبباً من إدارة القوائم ضمن مجموعة قوائم الطلبات.
            </div>
          )}

          {cfg.requiresOutcome && outcomes.length > 0 && (
            <div className="space-y-2">
              <label className="block text-sm font-medium text-slate-700">
                السبب <span className="text-red-500">*</span>
              </label>
              <div className="space-y-1.5">
                {outcomes.map((o) => (
                  <label
                    key={o.value}
                    className={`block p-2.5 rounded border cursor-pointer ${
                      outcome === o.value
                        ? 'bg-blue-50 border-blue-400 ring-1 ring-blue-400'
                        : 'bg-white border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <input
                        type="radio"
                        name="outcome"
                        value={o.value}
                        checked={outcome === o.value}
                        onChange={() => setOutcome(o.value)}
                        className="mt-1"
                      />
                      <div className="flex-1">
                        <div className="text-sm font-medium text-slate-800">{o.label}</div>
                        {o.description && (
                          <div className="text-xs text-slate-500 mt-0.5">{o.description}</div>
                        )}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              {cfg.noteLabel} {cfg.noteRequired && <span className="text-red-500">*</span>}
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder={cfg.notePlaceholder}
              className="w-full text-sm border border-slate-300 rounded p-2 focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
            />
          </div>

          {confirmStep && cfg.isTerminal && (
            <div className="bg-amber-100 border-2 border-amber-400 rounded p-3 text-sm text-amber-900">
              <strong>تَأكيد نهائي:</strong> هذه العملية تُغلق الطلب. اضغط مَرة أخرى للمتابعة.
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <Button
              variant={cfg.confirmVariant}
              onClick={handleConfirm}
              disabled={!canSubmit}
              loading={busy}
              className="flex-1"
            >
              {busy ? 'جاري...' : confirmStep ? `${cfg.confirmText} — تَأكيد` : cfg.confirmText}
            </Button>
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              إلغاء
            </Button>
          </div>
        </div>
    </Modal>
  );
}
