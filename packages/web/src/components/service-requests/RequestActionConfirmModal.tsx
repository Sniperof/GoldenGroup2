import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';

export interface RequestConfirmationAction {
  kind: 'promote_registered_location' | 'periodic_registered_location' | 'approve_agent' | 'resolve_escalation' | 'archive';
  title: string;
  description: string;
  confirmLabel: string;
  noteLabel?: string;
  noteRequired?: boolean;
}

export default function RequestActionConfirmModal({
  action,
  onClose,
  onConfirm,
}: {
  action: RequestConfirmationAction;
  onClose: () => void;
  onConfirm: (note: string) => Promise<void>;
}) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (action.noteRequired && !note.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm(note.trim());
    } catch (e: any) {
      setError(e?.message ?? 'تعذر تنفيذ الإجراء.');
      setBusy(false);
    }
  }

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={action.title}
      size="lg"
      closeOnEsc={!busy}
      closeOnBackdrop={!busy}
    >
      <div className="space-y-4 p-5" dir="rtl">
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{action.description}</p>
        </div>
        {action.noteLabel && (
          <label className="block space-y-1 text-sm font-semibold text-slate-700">
            <span>{action.noteLabel}{action.noteRequired && <span className="text-red-500"> *</span>}</span>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={3}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
            />
          </label>
        )}
        {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</div>}
        <div className="flex gap-2">
          <Button loading={busy} disabled={busy || !!(action.noteRequired && !note.trim())} onClick={submit}>
            {action.confirmLabel}
          </Button>
          <Button variant="secondary" disabled={busy} onClick={onClose}>إلغاء</Button>
        </div>
      </div>
    </Modal>
  );
}
