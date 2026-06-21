// ============================================================
// TerminalTransitionModal — Phase 4 polish
// Replaces inline prompt() calls for the 4 in_review actions.
//
// Constitution: maintenance.md §٠.٣, §٠.٤, §٠.٥, §SR-AUTH-01
//
// Modes:
//   - 'requestInfo'      → awaiting_customer_info (non-terminal)
//   - 'resolveAtIntake'  → resolved_at_intake (terminal)
//   - 'escalate'         → sets review_required_flag (non-terminal)
//   - 'cancel'           → cancelled (terminal)
//
// All modes:
//   - Show a contextual warning when terminal.
//   - Enforce required fields client-side (matches backend validation).
//   - Use Arabic labels backed by the constitutional enum values.
// ============================================================
import { useState } from 'react';
import IconButton from '../ui/IconButton';
import { AlertTriangle, X } from 'lucide-react';
import Button, { type ButtonVariant } from '../ui/Button';

export type ModalMode = 'requestInfo' | 'resolveAtIntake' | 'escalate' | 'cancel';

interface Option {
  value: string;
  label: string;
  description?: string;
}

const RESOLVE_OUTCOMES: Option[] = [
  { value: 'resolved_by_advice',     label: 'حُلَّ بنصيحة هاتفية',     description: 'الفني وَصف خطوات على الهاتف وحُلَّ العطل' },
  { value: 'customer_self_fixed',    label: 'الزبون حلَّه ذاتياً',      description: 'الزبون أصلحه قبل وصولنا' },
  { value: 'false_alarm',            label: 'إنذار خاطئ',              description: 'لم يَكن هناك عطل فعلاً' },
  { value: 'info_clarified_no_issue', label: 'استيضاح بلا عطل',         description: 'كان استفساراً لا مشكلة' },
];

const CANCEL_OUTCOMES: Option[] = [
  { value: 'data_entry_error',           label: 'خطأ في الإدخال',          description: 'الـ Operator أَخطأ عند الإنشاء' },
  { value: 'customer_withdrew_via_support', label: 'الزبون ألغى عبر دعم آخر', description: 'وَصلَنا اعتذار من قناة أخرى' },
  { value: 'redundant_with_existing_task',  label: 'مُكَرَّر مع مهمة قائمة',  description: 'يَنبغي التَحقُّق ودَمج إن لزم' },
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
  showExpectedCallback?: boolean;
  confirmText: string;
  confirmClass: string;
  confirmVariant: ButtonVariant;
}> = {
  requestInfo: {
    title: 'طَلب معلومة من الزبون',
    badge: 'غير نهائي',
    badgeClass: 'bg-amber-100 text-amber-700',
    description: 'سَيَنتقل الطلب إلى "بانتظار الزبون". لو لم يَردّ خلال 7 أيام، يُلغى آلياً.',
    isTerminal: false,
    requiresOutcome: false,
    noteLabel: 'ما الذي تَنتظر من الزبون؟',
    noteRequired: true,
    notePlaceholder: 'مثلاً: صورة للشاشة + رقم العقد',
    showExpectedCallback: true,
    confirmText: 'إرسال الطلب',
    confirmClass: 'bg-amber-600 hover:bg-amber-700',
    confirmVariant: 'gold',
  },
  resolveAtIntake: {
    title: 'حُلَّ في الاستلام',
    badge: 'نهائي',
    badgeClass: 'bg-emerald-100 text-emerald-700',
    description: 'إغلاق الطلب بَدون إنشاء مهمة. لا يُعاد فتحه إلا عبر "إعادة فتح".',
    isTerminal: true,
    requiresOutcome: true,
    outcomes: RESOLVE_OUTCOMES,
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
};

interface Props {
  mode: ModalMode;
  onClose: () => void;
  onConfirm: (data: {
    triageOutcome?: string;
    triageNotes?: string;
    note?: string;
    expectedCallbackAt?: string | null;
  }) => Promise<void>;
}

export default function TerminalTransitionModal({ mode, onClose, onConfirm }: Props) {
  const cfg = MODE_CONFIG[mode];
  const [outcome, setOutcome] = useState('');
  const [note, setNote] = useState('');
  const [expectedCallback, setExpectedCallback] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmStep, setConfirmStep] = useState(false);

  const noteOk = !cfg.noteRequired || note.trim().length > 0;
  const outcomeOk = !cfg.requiresOutcome || outcome !== '';
  const canSubmit = noteOk && outcomeOk && !busy;

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
      if (cfg.requiresOutcome) payload.triageOutcome = outcome;
      // For resolve_at_intake the field is triageNotes; for cancel it's the
      // same; for escalate it's "reason" (note in audit). For requestInfo we
      // pass triageNotes too so the operator's expectation is recorded.
      if (mode === 'escalate') {
        payload.note = note.trim();
      } else {
        payload.triageNotes = note.trim();
        payload.note = note.trim();
      }
      if (mode === 'requestInfo' && expectedCallback) {
        payload.expectedCallbackAt = expectedCallback;
      }
      await onConfirm(payload);
    } catch (e: any) {
      setError(e?.message ?? 'فَشلت العملية');
      setBusy(false);
      setConfirmStep(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" dir="rtl">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full mx-4 max-h-[90vh] overflow-auto">
        <header className="flex items-center justify-between p-4 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-gray-800">{cfg.title}</h2>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${cfg.badgeClass}`}>
              {cfg.badge}
            </span>
          </div>
          <IconButton icon={X} label="إغلاق" onClick={onClose} disabled={busy} />
        </header>

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

          {cfg.requiresOutcome && cfg.outcomes && (
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">
                السبب <span className="text-red-500">*</span>
              </label>
              <div className="space-y-1.5">
                {cfg.outcomes.map((o) => (
                  <label
                    key={o.value}
                    className={`block p-2.5 rounded border cursor-pointer ${
                      outcome === o.value
                        ? 'bg-blue-50 border-blue-400 ring-1 ring-blue-400'
                        : 'bg-white border-gray-200 hover:bg-gray-50'
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
                        <div className="text-sm font-medium text-gray-800">{o.label}</div>
                        {o.description && (
                          <div className="text-xs text-gray-500 mt-0.5">{o.description}</div>
                        )}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {cfg.noteLabel} {cfg.noteRequired && <span className="text-red-500">*</span>}
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder={cfg.notePlaceholder}
              className="w-full text-sm border border-gray-300 rounded p-2 focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
            />
          </div>

          {cfg.showExpectedCallback && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                موعد الردّ المُتَوقَّع <span className="text-xs text-gray-400">(اختياري)</span>
              </label>
              <input
                type="datetime-local"
                value={expectedCallback}
                onChange={(e) => setExpectedCallback(e.target.value)}
                className="w-full text-sm border border-gray-300 rounded p-2"
              />
            </div>
          )}

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
      </div>
    </div>
  );
}
