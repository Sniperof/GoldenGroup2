import { useState, type ComponentType } from 'react';
import { Link } from 'react-router-dom';
import { CalendarClock, CheckCircle2, ChevronLeft, Clock, Footprints, Plus } from 'lucide-react';
import { OPEN_TASK_STATUS_LABELS, type OpenTaskStatus } from '@golden-crm/shared';
import { Card, InfoLine, TabAlert, formatDate, formatDateTime } from '../shared';
import type { TaskResultRendererProps } from '../types';
import DeviceDemoResultModal from '../../../taskTypes/device_demo/DeviceDemoResultModal';

const TERMINAL_STATUSES = new Set(['completed', 'closed', 'cancelled']);

// Arabic labels for the unified final_decision values (device_demo first;
// other task types extend this map as they migrate to the new model).
// Reference: docs/constitution/features/tasks/device-demo.md
const FINAL_DECISION_LABELS: Record<string, { label: string; cls: string }> = {
  offer_presented: { label: 'تقديم عرض',   cls: 'bg-sky-50 text-sky-700 border-sky-200' },
  device_sold:     { label: 'تم البيع',    cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  rescheduled:     { label: 'إعادة جدولة', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  cancelled:       { label: 'إلغاء',       cls: 'bg-rose-50 text-rose-700 border-rose-200' },
  // legacy values kept for read-back of historical rows
  accepted:        { label: 'مقبول (قديم)',   cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  rejected:        { label: 'مرفوض (قديم)',   cls: 'bg-rose-50 text-rose-700 border-rose-200' },
  needs_followup:  { label: 'متابعة (قديم)',  cls: 'bg-amber-50 text-amber-700 border-amber-200' },
};

const VISIT_STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  scheduled: { label: 'مجدولة', cls: 'bg-slate-100 text-slate-600' },
  in_progress: { label: 'جارية', cls: 'bg-blue-50 text-blue-700' },
  ended: { label: 'انتهت ميدانياً', cls: 'bg-amber-50 text-amber-700' },
  completed: { label: 'مكتملة', cls: 'bg-emerald-50 text-emerald-700' },
  not_completed: { label: 'لم تتم', cls: 'bg-rose-50 text-rose-700' },
  cancelled: { label: 'ملغاة', cls: 'bg-slate-100 text-slate-500' },
  closed: { label: 'مقفلة', cls: 'bg-slate-200 text-slate-700' },
};

function renderFinalDecision(value?: string | null) {
  if (!value) return 'غير مسجلة بعد';
  const meta = FINAL_DECISION_LABELS[value];
  if (!meta) return <span className="font-mono text-xs">{value}</span>;
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-lg text-xs font-bold border ${meta.cls}`}>
      {meta.label}
    </span>
  );
}

function renderDerivedOutcome(finalDecision: string | null, task: any, preOffers: any[] = []) {
  const offers = Array.isArray(task.offers) && task.offers.length > 0
    ? task.offers
    : preOffers;
  const count = (response: string) =>
    offers.filter((offer: any) => offer?.customerResponse === response).length;
  const accepted = count('accepted');
  const rejected = count('rejected');
  const extension = count('extension_requested');
  const total = offers.length;

  let label = 'غير مسجلة بعد';
  let cls = 'bg-slate-50 text-slate-600 border-slate-200';

  if (finalDecision === 'offer_presented') {
    if (accepted > 0) {
      label = accepted === 1 ? 'بيع عبر عرض مقبول' : `بيع عبر ${accepted} عروض مقبولة`;
      cls = 'bg-emerald-50 text-emerald-700 border-emerald-200';
    } else if (extension > 0) {
      label = extension === 1 ? 'بانتظار متابعة عرض عليه مهلة' : `بانتظار متابعة ${extension} عروض عليها مهلة`;
      cls = 'bg-amber-50 text-amber-700 border-amber-200';
    } else if (total > 0 && rejected === total) {
      label = 'لم يتم البيع - كل العروض مرفوضة';
      cls = 'bg-rose-50 text-rose-700 border-rose-200';
    } else if (total > 0) {
      label = 'تقديم عرض - بانتظار ردود مكتملة';
      cls = 'bg-sky-50 text-sky-700 border-sky-200';
    } else {
      label = 'تقديم عرض - لا توجد عروض مقروءة';
      cls = 'bg-sky-50 text-sky-700 border-sky-200';
    }
  } else if (finalDecision === 'device_sold') {
    label = 'بيع مباشر';
    cls = 'bg-emerald-50 text-emerald-700 border-emerald-200';
  } else if (finalDecision === 'rescheduled') {
    label = 'مؤجلة / تحتاج متابعة';
    cls = 'bg-amber-50 text-amber-700 border-amber-200';
  } else if (finalDecision === 'cancelled') {
    label = 'ألغيت / لم تنجز';
    cls = 'bg-rose-50 text-rose-700 border-rose-200';
  }

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-lg text-xs font-bold border ${cls}`}>
      {label}
    </span>
  );
}

export interface TaskResultTabProps {
  task: any;
  hasResult: boolean;
  attempts?: any[];
  /** Custom result renderer provided by the task type (e.g. device demo pre-offers table). */
  ResultRenderer?: ComponentType<TaskResultRendererProps>;
  /** Extra data forwarded to the custom renderer */
  rendererProps?: Partial<TaskResultRendererProps>;
}

export default function TaskResultTab({ task, hasResult, attempts = [], ResultRenderer, rendererProps }: TaskResultTabProps) {
  const statusLabel = OPEN_TASK_STATUS_LABELS[task.status as OpenTaskStatus] ?? task.status;
  const [showResultModal, setShowResultModal] = useState(false);

  // The open_task has a final result only in terminal states. While the
  // story is alive, the result of an individual past attempt does NOT count
  // as the task's final result — that's the diagnostic fix this tab is built
  // around.
  const isTerminal = TERMINAL_STATUSES.has(task.status);
  const lastAttempt = task.lastAttempt ?? null;
  const lastAttemptDetail = task.lastAttemptDetail ?? null;
  // Task-level decision: only the last attempt's decision counts as the task's
  // final result, and only after the open_task has actually closed out.
  const taskFinalDecision: string | null = isTerminal ? (lastAttempt?.finalDecision ?? null) : null;
  // Attempt-level decision: always the last attempt's recorded decision, if any.
  const attemptFinalDecision: string | null = lastAttempt?.finalDecision ?? null;

  const shouldShowResultDetails = attemptFinalDecision === 'offer_presented';

  // Result modal is only wired for device_demo today; other task types still
  // surface a read-only result block until they migrate to the new model.
  // canRecordResult now relies on activeVisit (a live booking with no result yet).
  // If activeVisit is null, there's nothing to record a result against.
  const activeVisit = task.activeVisit ?? null;
  const canRecordResult =
    task.taskType === 'device_demo' &&
    activeVisit != null &&
    (activeVisit.status === 'in_progress' || activeVisit.status === 'ended') &&
    !isTerminal;

  return (
    <>
      <TabAlert title="ملاحظات على النتيجة" items={hasResult ? [] : ['لا توجد نتيجة مسجلة بعد']} />

      {canRecordResult && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setShowResultModal(true)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold bg-indigo-600 text-white hover:bg-indigo-500 transition-colors"
          >
            <Plus className="w-4 h-4" />
            تسجيل نتيجة الزيارة
          </button>
        </div>
      )}

      <Card title="ملخص النتيجة" icon={CheckCircle2}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-1.5">
          <InfoLine
            label="نتيجة المهمة"
            value={isTerminal
              ? renderFinalDecision(taskFinalDecision)
              : <span className="inline-flex items-center px-2.5 py-0.5 rounded-lg text-xs font-bold border bg-slate-50 text-slate-600 border-slate-200">قيد المتابعة</span>}
          />
          <InfoLine
            label="المحصلة"
            value={renderDerivedOutcome(taskFinalDecision, task, rendererProps?.preOffers ?? [])}
          />
          <InfoLine label="الحالة" value={statusLabel} />
          <InfoLine
            label="تاريخ الإتمام"
            value={isTerminal && lastAttempt?.closedAt ? formatDateTime(lastAttempt.closedAt) : '—'}
          />
          {lastAttempt && (
            <div className="md:col-span-2 mt-2 pt-2 border-t border-slate-100">
              <InfoLine
                label="نتيجة آخر محاولة"
                value={
                  <span className="inline-flex items-center gap-2 text-xs">
                    {renderFinalDecision(attemptFinalDecision)}
                    <span className="text-slate-400">
                      · {formatDate(lastAttempt.scheduledDate)}
                      {lastAttempt.scheduledTime ? ` · ${lastAttempt.scheduledTime}` : ''}
                    </span>
                  </span>
                }
              />
              {lastAttemptDetail?.reasonCode && (
                <InfoLine
                  label="سبب آخر محاولة"
                  value={<span className="text-rose-700">{lastAttemptDetail.reasonCode}</span>}
                />
              )}
              {lastAttemptDetail?.closingNotes && (
                <InfoLine label="ملاحظات آخر محاولة" value={lastAttemptDetail.closingNotes} />
              )}
            </div>
          )}
        </div>
      </Card>

      <Card title="محاولات التنفيذ" icon={Footprints}>
        {attempts.length > 0 ? (
          <div className="space-y-2.5">
            <p className="text-xs text-slate-400 mb-1">
              كل سطر هو محاولة تنفيذ لهذه المهمة الأم داخل زيارة مستقلة. النتيجة هنا تخص المحاولة، ثم تنعكس آخر نتيجة فعالة على حالة المهمة.
            </p>
            {attempts.map((at: any, idx: number) => {
              const vs = VISIT_STATUS_LABELS[at.visitStatus] ?? { label: at.visitStatus, cls: 'bg-slate-100 text-slate-600' };
              const decision = at.finalDecision
                ? (FINAL_DECISION_LABELS[at.finalDecision]?.label ?? at.finalDecision)
                : null;
              return (
                <Link
                  key={at.visitTaskId ?? `${at.visitId}-${idx}`}
                  to={`/field-visits/${at.visitId}`}
                  className="flex items-center gap-3 rounded-xl bg-white border border-slate-100 hover:border-indigo-200 hover:bg-indigo-50/30 p-3 shadow-sm transition-colors group"
                >
                  <div className="w-8 h-8 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0 text-xs font-black">
                    {idx + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-bold text-slate-800">المحاولة {idx + 1}</span>
                      {at.arabicLabel && <span className="text-[11px] text-slate-400">· {at.arabicLabel}</span>}
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${vs.cls}`}>{vs.label}</span>
                    </div>
                    <div className="flex items-center gap-3 text-[11px] text-slate-500 mt-1 flex-wrap">
                      {at.scheduledDate && (
                        <span className="inline-flex items-center gap-1">
                          <CalendarClock className="w-3 h-3" />
                          {String(at.scheduledDate).slice(0, 10)}{at.scheduledTime ? ` · ${at.scheduledTime}` : ''}
                        </span>
                      )}
                      {decision ? (
                        <span className="inline-flex items-center gap-1 text-emerald-600 font-semibold">
                          <CheckCircle2 className="w-3 h-3" /> نتيجة المحاولة: {decision}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-amber-600">
                          <Clock className="w-3 h-3" /> بانتظار نتيجة المحاولة
                        </span>
                      )}
                    </div>
                    {at.closingNotes && <p className="text-[11px] text-slate-400 mt-1 truncate">{at.closingNotes}</p>}
                  </div>
                  <ChevronLeft className="w-4 h-4 text-slate-300 group-hover:text-indigo-400 shrink-0" />
                </Link>
              );
            })}
          </div>
        ) : (
          <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-6 text-center">
            <Footprints className="w-8 h-8 mx-auto mb-2 text-slate-300" />
            <p className="text-sm font-bold text-slate-500">لا توجد محاولات تنفيذ بعد</p>
            <p className="text-xs text-slate-400 mt-1">عند جدولة المهمة ضمن زيارة، ستظهر هنا كل محاولة مع نتيجتها.</p>
          </div>
        )}
      </Card>

      {ResultRenderer && shouldShowResultDetails && <ResultRenderer task={task} {...rendererProps} />}

      {showResultModal && canRecordResult && activeVisit && (
        <DeviceDemoResultModal
          visitId={Number(activeVisit.id)}
          taskId={Number(activeVisit.visitTaskId)}
          task={task}
          preOffers={rendererProps?.preOffers ?? []}
          onClose={() => setShowResultModal(false)}
          onSaved={() => {
            setShowResultModal(false);
            // Trigger reload by reloading the page — simplest and most reliable
            // until we add a refresh callback through TaskDetailLayout.
            window.location.reload();
          }}
        />
      )}
    </>
  );
}
