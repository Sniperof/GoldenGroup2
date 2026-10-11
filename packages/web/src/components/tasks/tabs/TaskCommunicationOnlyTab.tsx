import { useState } from 'react';
import {
  Activity, CalendarClock, CheckCircle2, ClipboardCheck, Layers, Loader2, MessageSquare, PencilLine, Phone, PhoneCall,
  PhoneMissed, PlusCircle, RotateCcw, Send, ShoppingCart, Users,
} from '../../ui/icons';
import { OPEN_TASK_STATUS_LABELS, type OpenTaskStatus, getOutcomeMeta } from '@golden-crm/shared';
import { Card, EmptyState, TabAlert, formatDateTime } from '../shared';
import Button from '../../ui/Button';

const EVENT_TYPE_LABELS: Record<string, string> = {
  status_change: 'تغيير الحالة',
  note_added: 'إضافة ملاحظة',
  needs_follow_up: 'تحتاج متابعة',
  assigned: 'إسناد',
  reassigned: 'نقل المهمة',
  call_made: 'مكالمة',
  priority_changed: 'تغيير الأولوية',
  team_assigned: 'تعيين الفريق',
  team_changed: 'تغيير الفريق',
  offer_presented: 'تقديم عرض',
  customer_response: 'رد الزبون',
  created: 'إنشاء المهمة',
  rescheduled: 'تغيير الموعد',
  lifecycle_skip: 'تخطّي مرحلة',
  result_recorded: 'تسجيل النتيجة',
  result_edited: 'تعديل النتيجة',
};

/** Who did it, when no user is attached to the row. */
const ACTOR_ROLE_FALLBACK: Record<string, string> = {
  system: 'النظام',
  app: 'تطبيق الزبون',
  backfill: 'ترميم بيانات قديمة',
};

const CONTEXT_LABELS: Record<string, string> = {
  visit_result: 'من نتيجة الزيارة',
  result_edit: 'من تعديل نتيجة الزيارة',
};

const FINAL_DECISION_LABELS: Record<string, string> = {
  delivered: 'تم التسليم',
  delivered_successfully: 'تم التسليم',
  installed_successfully: 'تم التركيب',
  activated: 'تم التفعيل',
  activated_successfully: 'تم التفعيل',
  disconnected_successfully: 'تم الفصل',
  retrieved_successfully: 'تم السحب',
  returned_successfully: 'تم الإرجاع',
  transferred_successfully: 'تم النقل',
  offer_presented: 'تم تقديم العرض',
  performed: 'تم التنفيذ',
  partially_performed: 'تنفيذ جزئي',
  paid_full: 'دفع كامل',
  paid_partial: 'دفع جزئي',
  refused_to_pay: 'رفض الدفع',
  device_issue: 'مشكلة بالجهاز',
  rescheduled: 'تحتاج متابعة',
  cancelled: 'إلغاء',
};

const decisionLabel = (code: string | null | undefined) =>
  code ? FINAL_DECISION_LABELS[code] ?? code : null;

const statusLabel = (code: string | null | undefined) =>
  code ? OPEN_TASK_STATUS_LABELS[code as OpenTaskStatus] ?? code : null;

const EVENT_TYPE_COLORS: Record<string, string> = {
  created: 'bg-emerald-100 text-emerald-700',
  rescheduled: 'bg-amber-100 text-amber-700',
  lifecycle_skip: 'bg-slate-100 text-slate-600',
  result_recorded: 'bg-teal-100 text-teal-700',
  result_edited: 'bg-orange-100 text-orange-700',
  status_change: 'bg-blue-100 text-blue-700',
  note_added: 'bg-slate-100 text-slate-600',
  needs_follow_up: 'bg-amber-100 text-amber-700',
  assigned: 'bg-emerald-100 text-emerald-700',
  reassigned: 'bg-indigo-100 text-indigo-700',
  call_made: 'bg-sky-100 text-sky-700',
  priority_changed: 'bg-rose-100 text-rose-700',
  team_assigned: 'bg-purple-100 text-purple-700',
  team_changed: 'bg-purple-100 text-purple-700',
  offer_presented: 'bg-violet-100 text-violet-700',
  customer_response: 'bg-teal-100 text-teal-700',
};

export interface TaskCommunicationOnlyTabProps {
  task: any;
  calls: any[];
  activity: any[];
  onSubmitNote: (text: string) => Promise<void>;
}

export default function TaskCommunicationOnlyTab({ task, calls, activity, onSubmitNote }: TaskCommunicationOnlyTabProps) {
  const [noteText, setNoteText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // The task's own `notes` field is the creator's opening note — treat it as the
  // first note in the thread, attributed to whoever created the task.
  const creatorNote = task?.notes
    ? {
        id: 'creator-note',
        author: task.createdByName || 'منشئ المهمة',
        createdAt: task.createdAt,
        text: task.notes,
        isCreator: true,
      }
    : null;
  const activityNotes = activity
    .filter((a) => a.eventType === 'note_added')
    .map((a) => ({
      id: a.id,
      author: a.performedByName || 'مستخدم',
      createdAt: a.createdAt,
      text: a.newValue,
      isCreator: false,
    }));
  const notes = [...(creatorNote ? [creatorNote] : []), ...activityNotes];

  const issues: string[] = [];
  if (calls.length === 0) issues.push('لا توجد مكالمات تيلماركتر');
  if (activity.length === 0) issues.push('لا يوجد سجل نشاط بعد');
  if (notes.length === 0) issues.push('لا توجد ملاحظات بعد');

  const handleSubmit = async () => {
    if (!noteText.trim()) return;
    setSubmitting(true);
    setError('');
    try {
      await onSubmitNote(noteText.trim());
      setNoteText('');
    } catch (err: any) {
      setError(err.message || 'فشل في إضافة الملاحظة');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <TabAlert title="ملاحظات على التواصل والمتابعة" items={issues} />

      <Card title="اتصالات التيلماركتر" icon={PhoneCall}>
        {calls.length > 0 ? (
          <div className="space-y-2.5">
            {calls.map((call: any) => {
              const meta = getOutcomeMeta(call.outcome);
              const isNotReached = meta.group === 'not_reached';
              const isBooked = meta.group === 'booked';
              const siblings: any[] = Array.isArray(call.siblingTasks) ? call.siblingTasks : [];
              const borderCls = isBooked
                ? 'border-r-4 border-emerald-400'
                : isNotReached
                  ? 'border-r-4 border-slate-300'
                  : 'border-r-4 border-sky-400';
              return (
                <div key={call.id} className={`rounded-xl bg-white border border-slate-100 p-3.5 space-y-2 shadow-sm ${borderCls}`}>
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      {isNotReached
                        ? <PhoneMissed className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        : <Phone className="w-3.5 h-3.5 text-sky-500 shrink-0" />}
                      <span className="text-sm font-bold text-slate-800">{meta.label}</span>
                    </div>
                    <span className="text-xs text-slate-400 font-mono whitespace-nowrap">
                      {formatDateTime(call.callDate ?? call.createdAt)}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    {call.contactLabel && (
                      <span className="text-xs bg-sky-50 text-sky-600 border border-sky-100 px-2 py-0.5 rounded font-bold">
                        {call.contactLabel}
                      </span>
                    )}
                    {call.communicationChannel && (
                      <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded font-bold">
                        {call.communicationChannel === 'cellular_call' ? 'مكالمة هاتفية'
                          : call.communicationChannel === 'cellular_text' ? 'رسالة نصية'
                          : call.communicationChannel === 'whatsapp_call' ? 'واتساب صوتي'
                          : call.communicationChannel === 'whatsapp_text' ? 'واتساب نصي'
                          : call.communicationChannel}
                      </span>
                    )}
                    {call.telemarketerName && (
                      <span className="text-xs bg-violet-50 text-violet-600 border border-violet-100 px-2 py-0.5 rounded font-bold">
                        {call.telemarketerName}
                      </span>
                    )}
                  </div>

                  {siblings.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-slate-100">
                      <span className="flex items-center gap-1 text-xs text-violet-600 font-bold shrink-0">
                        <Layers className="w-3 h-3" />
                        شملت أيضاً:
                      </span>
                      {siblings.map((s: any) => (
                        <span key={s.taskId} className="text-xs bg-violet-50 text-violet-700 border border-violet-100 px-2 py-0.5 rounded font-bold">
                          {s.arabicLabel}
                        </span>
                      ))}
                    </div>
                  )}
                  {call.notes && (
                    <p className="text-xs text-slate-500 leading-relaxed pt-1 border-t border-slate-100">{call.notes}</p>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState icon={PhoneCall} title="لا توجد اتصالات تيلماركتر لهذه المهمة" description="تظهر هنا المكالمات المسجلة من قسم إدارة المواعيد." />
        )}
      </Card>

      <Card title="السجل" icon={Activity}>
        {activity.length > 0 ? (
          <div className="space-y-4">
            {activity.map((entry: any) => (
              <div key={entry.id} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <div className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center shrink-0 mt-0.5">
                    {entry.eventType === 'note_added' && <MessageSquare className="w-3.5 h-3.5 text-slate-500" />}
                    {entry.eventType === 'status_change' && <RotateCcw className="w-3.5 h-3.5 text-blue-500" />}
                    {entry.eventType === 'call_made' && <PhoneCall className="w-3.5 h-3.5 text-sky-500" />}
                    {(entry.eventType === 'team_assigned' || entry.eventType === 'team_changed') && <Users className="w-3.5 h-3.5 text-purple-500" />}
                    {entry.eventType === 'assigned' && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />}
                    {entry.eventType === 'offer_presented' && <ShoppingCart className="w-3.5 h-3.5 text-violet-500" />}
                    {entry.eventType === 'customer_response' && <MessageSquare className="w-3.5 h-3.5 text-teal-500" />}
                    {entry.eventType === 'created' && <PlusCircle className="w-3.5 h-3.5 text-emerald-500" />}
                    {entry.eventType === 'rescheduled' && <CalendarClock className="w-3.5 h-3.5 text-amber-500" />}
                    {entry.eventType === 'result_recorded' && <ClipboardCheck className="w-3.5 h-3.5 text-teal-500" />}
                    {entry.eventType === 'result_edited' && <PencilLine className="w-3.5 h-3.5 text-orange-500" />}
                  </div>
                  <div className="w-px flex-1 bg-slate-100 mt-1" />
                </div>
                <div className="pb-4 flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className={`text-xs font-bold px-2 py-0.5 rounded ${EVENT_TYPE_COLORS[entry.eventType] ?? 'bg-slate-100 text-slate-600'}`}>
                      {EVENT_TYPE_LABELS[entry.eventType] ?? entry.eventType}
                    </span>
                    <span className="text-xs text-slate-400">{formatDateTime(entry.createdAt)}</span>
                  </div>
                  {(entry.performedByName || ACTOR_ROLE_FALLBACK[entry.role]) && (
                    <p className="text-xs text-slate-500 mb-1">
                      {entry.performedByName ?? ACTOR_ROLE_FALLBACK[entry.role]}
                      {entry.performedByName && entry.role && <span className="text-slate-400"> · {entry.role}</span>}
                      {entry.context && CONTEXT_LABELS[entry.context] && (
                        <span className="text-slate-400"> · {CONTEXT_LABELS[entry.context]}</span>
                      )}
                    </p>
                  )}
                  {entry.eventType === 'status_change' && entry.newValue && (
                    <p className="text-xs text-slate-700">
                      {entry.oldValue && (
                        <>
                          <span className="line-through text-slate-400">{statusLabel(entry.oldValue)}</span>
                          {' → '}
                        </>
                      )}
                      <span className="font-bold">{statusLabel(entry.newValue)}</span>
                    </p>
                  )}
                  {entry.eventType === 'created' && entry.newValue && (
                    <p className="text-xs text-slate-700">الحالة الأولى: <span className="font-bold">{statusLabel(entry.newValue)}</span></p>
                  )}
                  {entry.eventType === 'team_changed' && (
                    <p className="text-xs text-slate-700">
                      {entry.oldValue && (
                        <>
                          <span className="line-through text-slate-400">{entry.oldValue}</span>
                          {' → '}
                        </>
                      )}
                      <span className="font-bold">{entry.newValue || 'بدون فريق'}</span>
                    </p>
                  )}
                  {(entry.eventType === 'rescheduled' || entry.eventType === 'priority_changed') && (
                    <p className="text-xs text-slate-700">
                      <span className="line-through text-slate-400">{entry.oldValue || '—'}</span>
                      {' → '}
                      <span className="font-bold">{entry.newValue || '—'}</span>
                    </p>
                  )}
                  {entry.eventType === 'result_recorded' && entry.newValue && (
                    <p className="text-xs text-slate-700">النتيجة: <span className="font-bold">{decisionLabel(entry.newValue)}</span></p>
                  )}
                  {entry.eventType === 'result_edited' && (
                    <p className="text-xs text-slate-700">
                      <span className="line-through text-slate-400">{decisionLabel(entry.oldValue) ?? '—'}</span>
                      {' → '}
                      <span className="font-bold">{decisionLabel(entry.newValue) ?? '—'}</span>
                    </p>
                  )}
                  {entry.eventType === 'note_added' && entry.newValue && (
                    <p className="text-sm text-slate-700 whitespace-pre-wrap bg-slate-50 rounded-lg p-2 border border-slate-100 mt-1">{entry.newValue}</p>
                  )}
                  {entry.eventType === 'call_made' && <p className="text-xs text-slate-600">{entry.newValue || 'مكالمة مسجلة'}</p>}
                  {entry.reason && <p className="text-xs text-slate-500 mt-1">السبب: {entry.reason}</p>}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState icon={Activity} title="لا توجد أحداث مسجلة بعد" description="ستظهر هنا تغييرات الحالة والإسناد والملاحظات." />
        )}
      </Card>

      <Card title="الملاحظات" icon={MessageSquare}>
        <div className="space-y-4">
          {notes.length > 0 ? (
            <div className="space-y-2.5">
              {notes.map((n) => (
                <div
                  key={n.id}
                  className={`rounded-xl border p-3 ${n.isCreator ? 'border-indigo-200 bg-indigo-50/50' : 'border-slate-100 bg-slate-50'}`}
                >
                  <div className="flex items-center gap-2 flex-wrap mb-1.5">
                    <span className="text-xs font-bold text-slate-700">{n.author}</span>
                    {n.isCreator && (
                      <span className="text-xs font-bold text-indigo-600 bg-white border border-indigo-200 px-1.5 py-0.5 rounded">
                        منشئ المهمة · أول ملاحظة
                      </span>
                    )}
                    {n.createdAt && <span className="text-xs text-slate-400">{formatDateTime(n.createdAt)}</span>}
                  </div>
                  <p className="text-sm text-slate-700 whitespace-pre-wrap">{n.text}</p>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState icon={MessageSquare} title="لا توجد ملاحظات بعد" description="ستظهر هنا ملاحظة منشئ المهمة وأي ملاحظات متابعة لاحقة." />
          )}
          {error && <div className="text-xs text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">{error}</div>}
          <textarea
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            className="w-full min-h-[90px] rounded-xl border border-slate-200 p-3 text-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none resize-y"
            placeholder="أضف ملاحظة متابعة داخلية..."
          />
          <div className="flex justify-end">
            <Button
              icon={Send}
              loading={submitting}
              disabled={submitting || !noteText.trim()}
              onClick={handleSubmit}
            >
              حفظ الملاحظة
            </Button>
          </div>
        </div>
      </Card>
    </>
  );
}
