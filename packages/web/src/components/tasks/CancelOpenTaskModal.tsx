import { useEffect, useMemo, useState } from 'react';
import { Ban } from '../ui/icons';
import { getTaskCancellationReasonCategory } from '@golden-crm/shared';
import { api } from '../../lib/api';
import Button from '../ui/Button';
import Modal from '../ui/Modal';

interface ReasonItem {
  id: number;
  value: string;
  label?: string | null;
  metadata?: { label?: string | null } | null;
}

interface CancelOpenTaskModalProps {
  open: boolean;
  task: any;
  onClose: () => void;
  onCancelled: (task: any) => void;
}

export default function CancelOpenTaskModal({
  open,
  task,
  onClose,
  onCancelled,
}: CancelOpenTaskModalProps) {
  const taskType = task?.taskType ?? task?.task_type ?? '';
  const category = useMemo(
    () => getTaskCancellationReasonCategory(taskType),
    [taskType],
  );
  const [reasons, setReasons] = useState<ReasonItem[]>([]);
  const [reasonId, setReasonId] = useState('');
  const [loadingReasons, setLoadingReasons] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    let active = true;
    setReasonId('');
    setError('');
    setLoadingReasons(true);
    api.systemLists.getItemsByCode(category)
      .then((rows: any) => {
        if (active) setReasons(Array.isArray(rows) ? rows : []);
      })
      .catch((err: any) => {
        if (active) {
          setReasons([]);
          setError(err?.message ?? 'تعذر تحميل أسباب الإلغاء');
        }
      })
      .finally(() => {
        if (active) setLoadingReasons(false);
      });
    return () => { active = false; };
  }, [category, open]);

  async function submit() {
    const parsedReasonId = Number(reasonId);
    if (!Number.isInteger(parsedReasonId) || parsedReasonId <= 0) {
      setError('اختر سبب الإلغاء');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const result = await api.openTasks.cancel(Number(task.id), parsedReasonId);
      onCancelled(result.task);
    } catch (err: any) {
      setError(err?.message ?? 'فشل إلغاء المهمة');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      size="md"
      title={
        <span className="inline-flex items-center gap-2">
          <Ban className="h-4 w-4 text-rose-600" />
          إلغاء المهمة قبل الجدولة
        </span>
      }
      subtitle="ستنقل المهمة إلى مرحلة الإغلاق بحالة ملغاة."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>تراجع</Button>
          <Button variant="danger" onClick={submit} loading={saving} disabled={loadingReasons || reasons.length === 0}>
            تأكيد الإلغاء
          </Button>
        </>
      }
    >
      <div className="space-y-4 p-5" dir="rtl">
        {error && (
          <div className="border-y border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">
            {error}
          </div>
        )}
        <label className="block space-y-1.5">
          <span className="text-sm font-bold text-slate-700">سبب الإلغاء أو الرفض *</span>
          <select
            value={reasonId}
            onChange={(event) => setReasonId(event.target.value)}
            disabled={loadingReasons || saving}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100"
          >
            <option value="">{loadingReasons ? 'جارٍ تحميل الأسباب...' : 'اختر السبب'}</option>
            {reasons.map((reason) => (
              <option key={reason.id} value={reason.id}>
                {reason.metadata?.label || reason.label || reason.value}
              </option>
            ))}
          </select>
        </label>
        <p className="text-xs leading-5 text-slate-500">
          هذه هي قائمة الرفض نفسها المعتمدة لنتيجة هذا النوع. بعد الجدولة لا يمكن الإلغاء من هنا، وتصبح النتيجة من مسؤولية الزيارة.
        </p>
      </div>
    </Modal>
  );
}
