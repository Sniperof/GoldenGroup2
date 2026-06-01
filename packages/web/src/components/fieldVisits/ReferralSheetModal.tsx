// ============================================================
// ReferralSheetModal.tsx — DEC-007 D40/D41 referral sheet UI
// ============================================================
// Replaces the legacy NameCollectionModal. Edits only target_candidates;
// actual names are entered later in a separate screen (out of scope for the
// visit per DEC-007 D45 + GAP-031 partial resolution).
//
// Two modes:
//   - Create: no referral_sheet yet for this visit → "إضافة لائحة جديدة".
//   - Edit:   sheet exists → "تعديل عدد اللائحة".
// ============================================================

import { useEffect, useState } from 'react';
import { X, ListPlus, Save } from 'lucide-react';
import { api } from '../../lib/api';

interface Props {
  visitId: number;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export default function ReferralSheetModal({ visitId, open, onClose, onSaved }: Props) {
  const [existingSheetId, setExistingSheetId] = useState<number | null>(null);
  const [target, setTarget] = useState<number>(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setBusy(false);
    void (async () => {
      const sheet = await api.fieldVisits.getReferralSheet(visitId);
      if (sheet) {
        setExistingSheetId(sheet.id);
        setTarget(sheet.targetCandidates ?? 0);
      } else {
        setExistingSheetId(null);
        setTarget(0);
      }
    })();
  }, [open, visitId]);

  async function save() {
    setError(null);
    if (!Number.isFinite(target) || target < 0) {
      setError('عدد الأسماء يجب أن يكون ≥ 0');
      return;
    }
    setBusy(true);
    try {
      if (existingSheetId == null) {
        await api.fieldVisits.createReferralSheet(visitId, { targetCandidates: Math.floor(target) });
      } else {
        await api.fieldVisits.updateReferralTarget(visitId, Math.floor(target));
      }
      onSaved();
      onClose();
    } catch (e: any) {
      setError(e?.message ?? 'فشل الحفظ');
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full overflow-hidden">
        <header className="flex items-center justify-between px-5 py-3 border-b border-slate-200 bg-slate-50">
          <div className="flex items-center gap-2">
            <ListPlus className="w-4 h-4 text-sky-700" />
            <h2 className="text-sm font-bold text-slate-800">
              {existingSheetId == null ? 'إضافة لائحة جديدة' : 'تعديل عدد اللائحة'}
            </h2>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-200">
            <X className="w-4 h-4 text-slate-600" />
          </button>
        </header>

        <div className="px-5 py-4 space-y-3">
          {error && (
            <div className="rounded-md bg-red-50 border border-red-200 p-2 text-xs font-bold text-red-700">
              {error}
            </div>
          )}

          <p className="text-[11px] text-slate-500">
            اللائحة اختيارية — يُسمح بإكمال الزيارة بدونها. عدد الأسماء وعد من الفريق
            يُعبَّأ لاحقاً في شاشة سجلات الأسماء المنفصلة.
          </p>

          <div>
            <label className="block text-[11px] font-bold text-slate-600 mb-1">
              عدد الأسماء المستهدفة (target_candidates)
            </label>
            <input
              type="number"
              min={0}
              value={target}
              onChange={(e) => setTarget(Math.max(0, Number(e.target.value) || 0))}
              className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </div>
        </div>

        <footer className="flex justify-end gap-2 px-5 py-3 border-t border-slate-200 bg-slate-50">
          <button
            onClick={onClose}
            disabled={busy}
            className="px-3 py-1.5 rounded-md text-xs font-bold border border-slate-300 text-slate-700 bg-white hover:bg-slate-100"
          >
            إلغاء
          </button>
          <button
            onClick={() => void save()}
            disabled={busy}
            className="px-3 py-1.5 rounded-md text-xs font-bold bg-sky-600 text-white hover:bg-sky-700 inline-flex items-center gap-1"
          >
            <Save className="w-3.5 h-3.5" />
            {existingSheetId == null ? 'إنشاء اللائحة' : 'حفظ التعديل'}
          </button>
        </footer>
      </div>
    </div>
  );
}
