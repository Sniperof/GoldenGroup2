import { confirmDialog } from '../../lib/dialogs';
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuthStore } from '../../hooks/useAuthStore';
import { DollarSign } from '../../components/ui/icons';
import TaskDetailLayout from '../../components/tasks/TaskDetailLayout';
import { InfoLine, formatDate } from '../../components/tasks/shared';
import type { TaskDetailData, TaskTypeExtension } from '../../components/tasks/types';

const RECEIVABLE_SOURCE_TYPE_LABELS: Record<string, string> = {
  contract: 'عقد',
  maintenance_task: 'مهمة صيانة',
  golden_warranty: 'ضمان ذهبي',
};

function money(value: unknown): string {
  const n = Number(value);
  return Number.isFinite(n) ? `${n.toLocaleString('ar-SY')} ل.س` : '—';
}

// D3: «عكس التحصيل» — appends opposite entries (nothing is edited or deleted)
// and makes the task collectable again. Behind collections.reverse.
function ReverseCollectionAction({ taskId, reversal }: { taskId: number; reversal: any }) {
  const { user, hasPermission } = useAuthStore();
  const canReverse = user?.isSuperAdmin === true || hasPermission('collections.reverse');
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!reversal) return null;
  if (reversal.reversedAt) {
    return <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">تم عكس آخر تحصيل على هذه المهمة.</div>;
  }
  if (!reversal.reversible || !canReverse) return null;
  const submit = async () => {
    if (!reason.trim()) { setError('سبب عكس التحصيل مطلوب'); return; }
    if (!await confirmDialog({ message: 'تأكيد عكس التحصيل؟ تُسجَّل قيود معاكسة ويعود القسط غير مسدَّد، ثم تُسجَّل النتيجة الصحيحة من جديد.', tone: 'danger' })) return;
    setBusy(true); setError('');
    try {
      await api.openTasks.reverseCollection(taskId, reason.trim());
      window.location.reload();
    } catch (e: any) {
      setError(e?.message ?? 'فشل عكس التحصيل');
    } finally { setBusy(false); }
  };
  return (
    <div className="mt-3 space-y-2">
      {!open ? (
        <button type="button" onClick={() => setOpen(true)}
          className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-1.5 text-xs font-bold text-rose-700 hover:bg-rose-100">
          عكس التحصيل
        </button>
      ) : (
        <div className="rounded-lg border border-rose-200 bg-rose-50/50 p-3 space-y-2">
          <label className="block text-xs font-bold text-rose-800">سبب عكس التحصيل *</label>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2}
            className="w-full rounded-lg border border-rose-200 px-3 py-2 text-sm" />
          {error && <div className="text-xs font-bold text-rose-700">{error}</div>}
          <div className="flex gap-2">
            <button type="button" onClick={submit} disabled={busy}
              className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-60">
              {busy ? 'جارٍ العكس…' : 'تأكيد العكس'}
            </button>
            <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600">إلغاء</button>
          </div>
        </div>
      )}
    </div>
  );
}

function collectionOverviewCard(data: TaskDetailData) {
  const { task } = data;
  // قسط مربوط بالدولار (migr 493): المستحق يُحسب اليوم من الخادم.
  const usdDue = (task as any).usdDue ?? null;
  return (
    <div className="rounded-lg border border-emerald-100 bg-white p-4 shadow-sm">
      <h3 className="mb-3 text-sm font-black text-emerald-900">تفاصيل الذمة</h3>
      <div className="grid gap-2 text-sm sm:grid-cols-2">
        <InfoLine label="مصدر الذمة" value={task.receivableSourceLabel ?? task.receivable_source_label ?? '—'} />
        <InfoLine label="نوع المصدر" value={RECEIVABLE_SOURCE_TYPE_LABELS[String(task.receivableSourceType ?? task.receivable_source_type ?? '')] ?? task.receivableSourceType ?? task.receivable_source_type ?? '—'} />
        <InfoLine label="رقم القسط" value={task.installmentNumber ?? task.installment_number ?? task.installmentId ?? task.installment_id ?? '—'} />
        {usdDue ? (
          <>
            <InfoLine label="المستحق اليوم" value={usdDue.dueTodaySyp != null ? money(usdDue.dueTodaySyp) : 'لا يوجد سعر صرف اليوم'} />
            <InfoLine label="المتبقي بالدولار" value={`$${Number(usdDue.remainingUsd).toLocaleString('en-US', { maximumFractionDigits: 2 })}`} />
            <InfoLine label="سعر صرف اليوم" value={usdDue.dayRate ? money(usdDue.dayRate) : '—'} />
            <InfoLine label="سعر العقد" value={money(usdDue.contractRate)} />
            <InfoLine label="المتبقي بالليرة الأصلية" value={money(usdDue.remainingBalanceSyp)} />
          </>
        ) : (
          <InfoLine label="المبلغ المتوقع" value={money(task.expectedAmountSyp ?? task.expected_amount_syp)} />
        )}
      </div>
      <ReverseCollectionAction taskId={Number((task as any).id)} reversal={(task as any).collectionReversal ?? null} />
    </div>
  );
}

const collectionExtension: TaskTypeExtension = {
  overviewExtraCards: collectionOverviewCard,
};

function scheduleExtraRows(data: TaskDetailData) {
  const { task } = data;
  const activeVisit = task.activeVisit ?? null;
  const lastAttempt = task.lastAttempt ?? null;
  if (activeVisit) {
    return (
      <>
        <InfoLine label="موعد الزيارة القادمة" value={formatDate(activeVisit.scheduledDate)} />
        <InfoLine label="وقت الزيارة القادمة" value={activeVisit.scheduledTime || '—'} />
      </>
    );
  }
  if (lastAttempt) {
    const datePart = formatDate(lastAttempt.scheduledDate);
    const value = lastAttempt.scheduledTime ? `${datePart} · ${lastAttempt.scheduledTime}` : datePart;
    return <InfoLine label="آخر محاولة" value={value} />;
  }
  return null;
}

function hasResultFor(data: TaskDetailData): boolean {
  const status = data.task.status;
  return status === 'completed' || status === 'closed' || status === 'cancelled';
}

export default function CollectionTaskDetail() {
  const { id } = useParams<{ id: string }>();
  const taskId = Number(id);

  return (
    <TaskDetailLayout
      taskId={taskId}
      typeIcon={DollarSign}
      typeIconColor="text-emerald-500"
      backLabel="مهام تسديد الذمم"
      backHref="/tasks/group/collection"
      extension={collectionExtension}
      scheduleExtraRows={scheduleExtraRows}
      hasResultFor={hasResultFor}
    />
  );
}
