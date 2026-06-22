import { useEffect, useMemo, useState } from 'react';
import IconButton from '../ui/IconButton';
import { AlertCircle, Loader2, RotateCcw, X, XCircle } from 'lucide-react';
import type {
  MarketingVisit,
  MarketingVisitCancelRequest,
  MarketingVisitLifecycleTaskUpdate,
  MarketingVisitRescheduleRequest,
  SystemList,
} from '@golden-crm/shared';
import { api } from '../../lib/api';
import Select from '../ui/Select';

type LifecycleMode = 'reschedule' | 'cancel';
type WizardStep = 0 | 1 | 2;
type Priority = 'high' | 'medium' | 'low';

interface TaskFormState {
  openTaskId: number;
  taskId: string;
  taskLabel: string;
  customerName: string;
  priority: Priority;
  targetDate: string;
}

interface VisitLifecycleActionModalProps {
  isOpen: boolean;
  visit: MarketingVisit | null;
  mode: LifecycleMode;
  saving: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (payload: MarketingVisitRescheduleRequest | MarketingVisitCancelRequest) => Promise<void>;
}

const STEP_TITLES: Record<WizardStep, string> = {
  0: 'السبب',
  1: 'المهام المرتبطة',
  2: 'الملاحظات والتأكيد',
};

const MODE_META: Record<LifecycleMode, {
  title: string;
  description: string;
  confirmLabel: string;
  icon: typeof RotateCcw;
  iconClassName: string;
  buttonClassName: string;
  reasonCode: string;
  reasonField: 'rescheduleReasonId' | 'cancellationReasonId';
}> = {
  reschedule: {
    title: 'تأجيل الموعد',
    description: 'الزيارة لم تُنفذ، وسيتم تحويل المهام المرتبطة إلى حالة تحتاج إعادة جدولة.',
    confirmLabel: 'تأكيد التأجيل',
    icon: RotateCcw,
    iconClassName: 'bg-amber-50 text-amber-700 border border-amber-200',
    buttonClassName: 'bg-amber-600 hover:bg-amber-700 disabled:bg-amber-300',
    reasonCode: 'task_reschedule_reasons',
    reasonField: 'rescheduleReasonId',
  },
  cancel: {
    title: 'إلغاء الموعد',
    description: 'الزيارة أُلغيت ولن تُنفذ، وستعود المهام المرتبطة إلى القائمة المفتوحة.',
    confirmLabel: 'تأكيد الإلغاء',
    icon: XCircle,
    iconClassName: 'bg-rose-50 text-rose-700 border border-rose-200',
    buttonClassName: 'bg-rose-600 hover:bg-rose-700 disabled:bg-rose-300',
    reasonCode: 'task_cancellation_reasons',
    reasonField: 'cancellationReasonId',
  },
};

const PRIORITY_OPTIONS: Array<{ value: Priority; label: string; className: string }> = [
  { value: 'high', label: 'عالية', className: 'border-rose-200 bg-rose-50 text-rose-700' },
  { value: 'medium', label: 'متوسطة', className: 'border-amber-200 bg-amber-50 text-amber-700' },
  { value: 'low', label: 'منخفضة', className: 'border-sky-200 bg-sky-50 text-sky-700' },
];

function buildTaskLabel(visit: MarketingVisit, taskId: string): string {
  const tasks = visit.tasks ?? [];
  const sameTypeIndex = tasks.findIndex((task) => task.id === taskId);
  if (tasks.length <= 1 || sameTypeIndex === -1) return 'عرض جهاز';
  return `عرض جهاز (${sameTypeIndex + 1})`;
}

function normalizeTasks(visit: MarketingVisit | null): TaskFormState[] {
  if (!visit) return [];
  return (visit.tasks ?? [])
    .filter((task) => task.sourceOpenTaskId != null)
    .map((task) => ({
      openTaskId: Number(task.sourceOpenTaskId),
      taskId: task.id,
      taskLabel: buildTaskLabel(visit, task.id),
      customerName: visit.customerName || 'الزبون الحالي',
      priority: task.openTaskPriority ?? 'medium',
      targetDate: '',
    }));
}

export default function VisitLifecycleActionModal({
  isOpen,
  visit,
  mode,
  saving,
  error,
  onClose,
  onSubmit,
}: VisitLifecycleActionModalProps) {
  const meta = MODE_META[mode];
  const Icon = meta.icon;

  const [step, setStep] = useState<WizardStep>(0);
  const [reasonId, setReasonId] = useState('');
  const [notes, setNotes] = useState('');
  const [taskStates, setTaskStates] = useState<TaskFormState[]>([]);
  const [reasonOptions, setReasonOptions] = useState<SystemList[]>([]);
  const [loadingReasons, setLoadingReasons] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [validationError, setValidationError] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setStep(0);
    setReasonId('');
    setNotes('');
    setTaskStates(normalizeTasks(visit));
    setValidationError('');
    setLoadError('');
  }, [isOpen, visit, mode]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setLoadingReasons(true);
    setLoadError('');

    api.systemLists.getItemsByCode(meta.reasonCode)
      .then((items) => {
        if (cancelled) return;
        setReasonOptions(items);
      })
      .catch((err: any) => {
        if (cancelled) return;
        setLoadError(err?.message || 'تعذر تحميل أسباب الإجراء');
      })
      .finally(() => {
        if (!cancelled) setLoadingReasons(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, meta.reasonCode]);

  const canGoNext = useMemo(() => {
    if (step === 0) return !!reasonId && !loadingReasons;
    if (step === 1) return taskStates.length > 0;
    return true;
  }, [loadingReasons, reasonId, step, taskStates.length]);

  const hasTasks = taskStates.length > 0;
  const combinedError = validationError || error || loadError;

  if (!isOpen || !visit) return null;

  const updateTaskState = (openTaskId: number, patch: Partial<TaskFormState>) => {
    setTaskStates((current) =>
      current.map((task) => (task.openTaskId === openTaskId ? { ...task, ...patch } : task)),
    );
  };

  const goNext = () => {
    if (!canGoNext) {
      if (step === 0 && !reasonId) setValidationError('يرجى اختيار السبب أولاً.');
      if (step === 1 && !hasTasks) setValidationError('لا توجد مهام مرتبطة بهذه الزيارة.');
      return;
    }
    setValidationError('');
    setStep((current) => Math.min(2, current + 1) as WizardStep);
  };

  const goBack = () => {
    setValidationError('');
    setStep((current) => Math.max(0, current - 1) as WizardStep);
  };

  const handleSubmit = async () => {
    if (!reasonId) {
      setStep(0);
      setValidationError('يرجى اختيار السبب قبل المتابعة.');
      return;
    }

    if (!hasTasks) {
      setStep(1);
      setValidationError('لا توجد مهام مرتبطة بهذه الزيارة.');
      return;
    }

    const taskUpdates: MarketingVisitLifecycleTaskUpdate[] = taskStates.map((task) => ({
      openTaskId: task.openTaskId,
      priority: task.priority,
      dueDate: mode === 'cancel' ? (task.targetDate.trim() || null) : null,
      expectedDate: mode === 'reschedule' ? (task.targetDate.trim() || null) : null,
    }));

    setValidationError('');
    if (mode === 'reschedule') {
      await onSubmit({
        rescheduleReasonId: Number(reasonId),
        notes: notes.trim() || null,
        taskUpdates,
      });
      return;
    }

    await onSubmit({
      cancellationReasonId: Number(reasonId),
      notes: notes.trim() || null,
      taskUpdates,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4" dir="rtl">
      <div className="max-h-[90vh] w-full max-w-5xl overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-5">
          <div className="flex items-start gap-3">
            <div className={`flex h-11 w-11 items-center justify-center rounded-2xl ${meta.iconClassName}`}>
              <Icon className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-800">{meta.title}</h2>
              <p className="mt-1 text-sm text-slate-500">{meta.description}</p>
            </div>
          </div>
          <IconButton icon={X} label="إغلاق" onClick={onClose} disabled={saving} />
        </div>

        <div className="border-b border-slate-100 px-6 py-4">
          <div className="flex flex-wrap gap-2">
            {(Object.keys(STEP_TITLES) as unknown as WizardStep[]).map((stepKey) => (
              <div
                key={stepKey}
                className={`rounded-2xl border px-3 py-2 text-xs font-bold ${
                  step === stepKey
                    ? 'border-sky-200 bg-sky-50 text-sky-700'
                    : step > stepKey
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                      : 'border-slate-200 bg-slate-50 text-slate-500'
                }`}
              >
                {Number(stepKey) + 1}. {STEP_TITLES[stepKey]}
              </div>
            ))}
          </div>
        </div>

        <div className="max-h-[calc(90vh-13rem)] overflow-y-auto px-6 py-5">
          {combinedError ? (
            <div className="mb-5 flex items-start gap-2 rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{combinedError}</span>
            </div>
          ) : null}

          {step === 0 ? (
            <div className="space-y-4">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-sm font-bold text-slate-700">سبب الإجراء</p>
                <p className="mt-1 text-xs text-slate-500">
                  اختر السبب الذي يفسر {mode === 'reschedule' ? 'تأجيل الزيارة' : 'إلغاء الزيارة'} على مستوى الموعد بالكامل.
                </p>
              </div>

              <label className="block">
                <span className="mb-2 block text-sm font-bold text-slate-700">السبب</span>
                <Select
                  value={reasonId}
                  onChange={setReasonId}
                  disabled={loadingReasons || saving}
                  placeholder={loadingReasons ? 'جاري تحميل الأسباب...' : 'اختر السبب'}
                  ariaLabel="السبب"
                  className="w-full"
                  options={reasonOptions.map(option => ({ value: String(option.id), label: option.value }))}
                />
              </label>
            </div>
          ) : null}

          {step === 1 ? (
            <div className="space-y-4">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-sm font-bold text-slate-700">المهام المرتبطة بالزيارة</p>
                <p className="mt-1 text-xs text-slate-500">
                  حدّد أولوية كل مهمة. {mode === 'reschedule' ? 'التاريخ المتوقع' : 'التاريخ المطلوب'} اختياري، وإذا تُرك فارغاً سيبقى التاريخ الحالي كما هو.
                </p>
              </div>

              {taskStates.map((task) => (
                <div key={task.openTaskId} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="text-base font-bold text-slate-800">{task.taskLabel}</h3>
                      <p className="mt-1 text-xs text-slate-500">{task.customerName}</p>
                    </div>
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-bold text-slate-500">
                      Open Task #{task.openTaskId}
                    </span>
                  </div>

                  <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_220px]">
                    <div>
                      <p className="mb-2 text-xs font-bold text-slate-600">الأولوية</p>
                      <div className="flex flex-wrap gap-2">
                        {PRIORITY_OPTIONS.map((option) => {
                          const active = task.priority === option.value;
                          return (
                            <button
                              key={option.value}
                              type="button"
                              onClick={() => updateTaskState(task.openTaskId, { priority: option.value })}
                              className={`rounded-2xl border px-4 py-2 text-xs font-bold transition ${
                                active
                                  ? option.className
                                  : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
                              }`}
                            >
                              {option.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <label className="block">
                      <span className="mb-2 block text-xs font-bold text-slate-600">{mode === 'reschedule' ? 'التاريخ المتوقع' : 'التاريخ المطلوب'}</span>
                      <input
                        type="date"
                        value={task.targetDate}
                        onChange={(event) => updateTaskState(task.openTaskId, { targetDate: event.target.value })}
                        className="w-full rounded-2xl border border-slate-200 px-4 py-2.5 text-sm text-slate-800 outline-none transition focus:border-sky-300 focus:ring-4 focus:ring-sky-100"
                      />
                    </label>
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {step === 2 ? (
            <div className="space-y-4">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-sm font-bold text-slate-700">ملاحظات إضافية</p>
                <p className="mt-1 text-xs text-slate-500">
                  الملاحظات اختيارية، وستُرسل مع الإجراء لكل المهام المحددة.
                </p>
              </div>

              <label className="block">
                <span className="mb-2 block text-sm font-bold text-slate-700">ملاحظات</span>
                <textarea
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  rows={4}
                  placeholder="اكتب أي ملاحظات إضافية هنا..."
                  className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-sky-300 focus:ring-4 focus:ring-sky-100"
                />
              </label>

              <div className="rounded-2xl border border-slate-200 bg-white p-5">
                <p className="text-sm font-black text-slate-900">ملخص التنفيذ</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                    <div className="text-xs font-bold text-slate-500">الإجراء</div>
                    <div className="mt-1 text-sm font-bold text-slate-800">{meta.title}</div>
                  </div>
                  <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                    <div className="text-xs font-bold text-slate-500">عدد المهام</div>
                    <div className="mt-1 text-sm font-bold text-slate-800">{taskStates.length}</div>
                  </div>
                  <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                    <div className="text-xs font-bold text-slate-500">السبب المختار</div>
                    <div className="mt-1 text-sm font-bold text-slate-800">
                      {reasonOptions.find((option) => String(option.id) === reasonId)?.value || '—'}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-6 py-4">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="rounded-2xl bg-slate-100 px-4 py-2.5 text-sm font-bold text-slate-600 transition hover:bg-slate-200 disabled:opacity-50"
            >
              إلغاء
            </button>
            {step > 0 ? (
              <button
                type="button"
                onClick={goBack}
                disabled={saving}
                className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
              >
                رجوع
              </button>
            ) : null}
          </div>

          {step < 2 ? (
            <button
              type="button"
              onClick={goNext}
              disabled={!canGoNext || saving}
              className="rounded-2xl bg-sky-600 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-sky-700 disabled:bg-sky-300"
            >
              التالي
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={saving || !hasTasks || !reasonId}
              className={`inline-flex items-center gap-2 rounded-2xl px-5 py-2.5 text-sm font-bold text-white transition ${meta.buttonClassName}`}
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {meta.confirmLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
