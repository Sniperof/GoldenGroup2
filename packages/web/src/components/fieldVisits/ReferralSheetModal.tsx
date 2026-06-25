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
import { ListPlus, Save } from 'lucide-react';
import { api } from '../../lib/api';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Modal from '../ui/Modal';

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

  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      closeOnEsc={!busy}
      closeOnBackdrop={!busy}
      title={
        <span className="flex items-center gap-2">
          <ListPlus className="w-4 h-4 text-sky-700" />
          {existingSheetId == null ? 'إضافة لائحة جديدة' : 'تعديل عدد اللائحة'}
        </span>
      }
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={busy}>إلغاء</Button>
          <Button size="sm" onClick={() => void save()} disabled={busy} icon={Save}>
            {existingSheetId == null ? 'إنشاء اللائحة' : 'حفظ التعديل'}
          </Button>
        </>
      }
    >
        <div className="px-5 py-4 space-y-3">
          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 p-2 text-xs font-bold text-red-700">
              {error}
            </div>
          )}

          <p className="text-xs text-slate-500">
            اللائحة اختيارية — يُسمح بإكمال الزيارة بدونها. عدد الأسماء وعد من الفريق
            يُعبَّأ لاحقاً في شاشة سجلات الأسماء المنفصلة.
          </p>

          <Input
            label="عدد الأسماء المستهدفة (target_candidates)"
            type="number"
            min={0}
            value={target}
            onChange={(e) => setTarget(Math.max(0, Number(e.target.value) || 0))}
            inputSize="sm"
          />
        </div>
    </Modal>
  );
}
