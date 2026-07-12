import { useEffect, useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { api } from '../../lib/api';
import Modal from '../ui/Modal';
import Select from '../ui/Select';

type ReasonItem = { id: number; value: string };

export default function VisitReasonModal({
  open,
  category,
  title,
  description,
  confirmLabel,
  includeNotes = false,
  saving = false,
  onClose,
  onConfirm,
}: {
  open: boolean;
  category: 'location_missing_reasons' | 'visit_cancellation_reasons';
  title: string;
  description: string;
  confirmLabel: string;
  includeNotes?: boolean;
  saving?: boolean;
  onClose: () => void;
  onConfirm: (reasonId: number, notes: string | null) => Promise<void> | void;
}) {
  const [reasons, setReasons] = useState<ReasonItem[]>([]);
  const [reasonId, setReasonId] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setReasonId('');
    setNotes('');
    setError('');
    setLoading(true);
    api.systemLists.list({ category, activeOnly: true })
      .then((rows) => setReasons(Array.isArray(rows) ? rows : []))
      .catch((err: any) => setError(err?.message ?? 'تعذر تحميل قائمة الأسباب'))
      .finally(() => setLoading(false));
  }, [category, open]);

  const submit = async () => {
    const selected = Number(reasonId);
    if (!Number.isInteger(selected) || selected <= 0) {
      setError('يرجى اختيار السبب أولاً.');
      return;
    }
    setError('');
    await onConfirm(selected, notes.trim() || null);
  };

  return (
    <Modal
      isOpen={open}
      onClose={saving ? () => undefined : onClose}
      title={title}
      subtitle={description}
      footer={
        <div className="flex w-full justify-end gap-2">
          <button type="button" onClick={onClose} disabled={saving}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-bold text-slate-600 disabled:opacity-50">
            رجوع
          </button>
          <button type="button" onClick={submit} disabled={saving || loading || !reasonId}
            className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {confirmLabel}
          </button>
        </div>
      }
    >
      <div className="space-y-4 p-5">
        {error ? (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        ) : null}
        <label className="block">
          <span className="mb-2 block text-sm font-bold text-slate-700">السبب</span>
          <Select
            value={reasonId}
            onChange={setReasonId}
            disabled={loading || saving}
            placeholder={loading ? 'جاري تحميل الأسباب...' : 'اختر السبب'}
            ariaLabel="سبب الإجراء"
            options={reasons.map((reason) => ({ value: String(reason.id), label: reason.value }))}
          />
        </label>
        {includeNotes ? (
          <label className="block">
            <span className="mb-2 block text-sm font-bold text-slate-700">ملاحظات اختيارية</span>
            <textarea value={notes} onChange={(event) => setNotes(event.target.value)} disabled={saving}
              rows={3} className="w-full rounded-lg border border-slate-200 p-3 text-sm outline-none focus:border-sky-400" />
          </label>
        ) : null}
      </div>
    </Modal>
  );
}
