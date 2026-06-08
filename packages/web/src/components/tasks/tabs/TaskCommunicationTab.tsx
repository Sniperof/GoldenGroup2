import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  PhoneCall, Activity, MessageSquare, RotateCcw, Users, CheckCircle2,
  ShoppingCart, Send, Loader2, Phone, PhoneMissed, Layers,
  Footprints, CalendarClock, ChevronLeft, Clock,
} from 'lucide-react';
import { OPEN_TASK_STATUS_LABELS, type OpenTaskStatus, getOutcomeMeta } from '@golden-crm/shared';
import { Card, EmptyState, TabAlert, formatDateTime } from '../shared';

// سياق المهمة — labels for the execution-attempt chain
const VISIT_STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  scheduled:     { label: 'مجدولة',         cls: 'bg-slate-100 text-slate-600' },
  in_progress:   { label: 'جارية',          cls: 'bg-blue-50 text-blue-700' },
  ended:         { label: 'انتهت ميدانياً', cls: 'bg-amber-50 text-amber-700' },
  completed:     { label: 'مكتملة',         cls: 'bg-emerald-50 text-emerald-700' },
  not_completed: { label: 'لم تتم',         cls: 'bg-rose-50 text-rose-700' },
  cancelled:     { label: 'ملغاة',          cls: 'bg-slate-100 text-slate-500' },
  closed:        { label: 'مُقفلة',         cls: 'bg-slate-200 text-slate-700' },
};
const FINAL_DECISION_LABELS: Record<string, string> = {
  offer_presented: 'تقديم عرض',
  device_sold:     'بيع جهاز',
  rescheduled:     'إعادة جدولة',
  cancelled:       'إلغاء',
  // emergency_maintenance lifecycle outcomes
  resolved:        'تَم الإصلاح',
  unresolved:      'لم يُحَلّ بالكامل',
  needs_follow_up: 'بحاجة مُتابعة',
};

const CALL_TYPE_LABELS: Record<string, string> = {
  inbound: 'واردة', outbound: 'صادرة', follow_up: 'متابعة', missed: 'فائتة',
};
const CALL_OUTCOME_LABELS: Record<string, string> = {
  answered: 'تم الرد', no_answer: 'لم يرد', busy: 'مشغول', callback: 'طلب معاودة الاتصال',
  interested: 'مهتم', not_interested: 'غير مهتم',
};
const EVENT_TYPE_LABELS: Record<string, string> = {
  status_change: 'تغيير الحالة',
  note_added: 'إضافة ملاحظة',
  needs_follow_up: 'تحتاج متابعة',
  assigned: 'إسناد',
  reassigned: 'نقل المهمة',
  call_made: 'مكالمة',
  priority_changed: 'تغيير الأولوية',
  team_assigned: 'تعيين الفريق',
  offer_presented: 'تقديم عرض',
  customer_response: 'رد الزبون',
};
const EVENT_TYPE_COLORS: Record<string, string> = {
  status_change: 'bg-blue-100 text-blue-700',
  note_added: 'bg-slate-100 text-slate-600',
  needs_follow_up: 'bg-amber-100 text-amber-700',
  assigned: 'bg-emerald-100 text-emerald-700',
  reassigned: 'bg-indigo-100 text-indigo-700',
  call_made: 'bg-sky-100 text-sky-700',
  priority_changed: 'bg-rose-100 text-rose-700',
  team_assigned: 'bg-purple-100 text-purple-700',
  offer_presented: 'bg-violet-100 text-violet-700',
  customer_response: 'bg-teal-100 text-teal-700',
};

export interface TaskCommunicationTabProps {
  calls: any[];
  activity: any[];
  attempts?: any[];
  onSubmitNote: (text: string) => Promise<void>;
}

export default function TaskCommunicationTab({ calls, activity, attempts = [], onSubmitNote }: TaskCommunicationTabProps) {
  const [noteText, setNoteText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const notes = activity.filter((a) => a.eventType === 'note_added');

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

      {/* سياق المهمة — سلسلة محاولات التنفيذ عبر الزيارات */}
      <Card title="سياق المهمة" icon={Footprints}>
        {attempts.length > 0 ? (
          <div className="space-y-2.5">
            <p className="text-xs text-slate-400 mb-1">
              كل سطر = محاولة تنفيذ لهذه المهمة ضمن زيارة. النتيجة تُسجّل في الزيارة وتنعكس على حالة المهمة.
            </p>
            {attempts.map((at: any, idx: number) => {
              const vs = VISIT_STATUS_LABELS[at.visitStatus] ?? { label: at.visitStatus, cls: 'bg-slate-100 text-slate-600' };
              const decision = at.finalDecision
                ? (FINAL_DECISION_LABELS[at.finalDecision] ?? at.finalDecision)
                : null;
              return (
                <Link
                  key={at.visitTaskId}
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
                          <CheckCircle2 className="w-3 h-3" /> {decision}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-amber-600">
                          <Clock className="w-3 h-3" /> بانتظار النتيجة
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
          <EmptyState icon={Footprints} title="لا توجد محاولات تنفيذ بعد" description="عند جدولة المهمة ضمن زيارة، تظهر هنا كل محاولة بنتيجتها." />
        )}
      </Card>

      <Card title="اتصالات التيلماركتر" icon={PhoneCall}>
        {calls.length > 0 ? (
          <div className="space-y-2.5">
            {calls.map((call: any) => {
              const meta = getOutcomeMeta(call.outcome);
              const isNotReached = meta.group === 'not_reached';
              const isBooked    = meta.group === 'booked';
              const siblings: any[] = Array.isArray(call.siblingTasks) ? call.siblingTasks : [];
              const borderCls = isBooked
                ? 'border-r-4 border-emerald-400'
                : isNotReached
                  ? 'border-r-4 border-slate-300'
                  : 'border-r-4 border-sky-400';
              return (
                <div key={call.id} className={`rounded-xl bg-white border border-slate-100 p-3.5 space-y-2 shadow-sm ${borderCls}`}>
                  {/* Header row */}
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      {isNotReached
                        ? <PhoneMissed className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        : <Phone className="w-3.5 h-3.5 text-sky-500 shrink-0" />}
                      <span className="text-sm font-bold text-slate-800">{meta.label}</span>
                    </div>
                    <span className="text-[10px] text-slate-400 font-mono whitespace-nowrap">
                      {formatDateTime(call.callDate ?? call.createdAt)}
                    </span>
                  </div>
                  {/* Meta tags */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    {call.contactLabel && (
                      <span className="text-[10px] bg-sky-50 text-sky-600 border border-sky-100 px-2 py-0.5 rounded font-bold">
                        {call.contactLabel}
                      </span>
                    )}
                    {call.communicationChannel && (
                      <span className="text-[10px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded font-bold">
                        {call.communicationChannel === 'cellular_call'  ? 'مكالمة هاتفية'
                        : call.communicationChannel === 'cellular_text'  ? 'رسالة نصية'
                        : call.communicationChannel === 'whatsapp_call'  ? 'واتساب صوتي'
                        : call.communicationChannel === 'whatsapp_text'  ? 'واتساب نصي'
                        : call.communicationChannel}
                      </span>
                    )}
                    {call.telemarketerName && (
                      <span className="text-[10px] bg-violet-50 text-violet-600 border border-violet-100 px-2 py-0.5 rounded font-bold">
                        {call.telemarketerName}
                      </span>
                    )}
                  </div>
                  {/* Sibling tasks — other tasks covered by the same CT in this call */}
                  {siblings.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-slate-100">
                      <span className="flex items-center gap-1 text-[10px] text-violet-600 font-bold shrink-0">
                        <Layers className="w-3 h-3" />
                        شملت أيضاً:
                      </span>
                      {siblings.map((s: any) => (
                        <span key={s.taskId} className="text-[10px] bg-violet-50 text-violet-700 border border-violet-100 px-2 py-0.5 rounded font-bold">
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
                    {entry.eventType === 'team_assigned' && <Users className="w-3.5 h-3.5 text-purple-500" />}
                    {entry.eventType === 'assigned' && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />}
                    {entry.eventType === 'offer_presented' && <ShoppingCart className="w-3.5 h-3.5 text-violet-500" />}
                    {entry.eventType === 'customer_response' && <MessageSquare className="w-3.5 h-3.5 text-teal-500" />}
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
                  {entry.performedByName && (
                    <p className="text-xs text-slate-500 mb-1">
                      {entry.performedByName}
                      {entry.role && <span className="text-slate-400"> · {entry.role}</span>}
                    </p>
                  )}
                  {entry.eventType === 'status_change' && entry.oldValue && entry.newValue && (
                    <p className="text-xs text-slate-700">
                      <span className="line-through text-slate-400">{OPEN_TASK_STATUS_LABELS[entry.oldValue as OpenTaskStatus] ?? entry.oldValue}</span>
                      {' → '}
                      <span className="font-bold">{OPEN_TASK_STATUS_LABELS[entry.newValue as OpenTaskStatus] ?? entry.newValue}</span>
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
          <div className="space-y-2">
            <textarea
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              rows={3}
              placeholder="أضف ملاحظة..."
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none"
            />
            {error && <p className="text-xs text-rose-600">{error}</p>}
            <button
              onClick={handleSubmit}
              disabled={submitting || !noteText.trim()}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold bg-indigo-600 text-white hover:bg-indigo-500 transition-colors disabled:opacity-50"
            >
              {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              إضافة الملاحظة
            </button>
          </div>

          {notes.length > 0 ? (
            <div className="border-t border-slate-100 pt-4 space-y-3">
              {notes.map((note: any) => (
                <div key={note.id} className="rounded-lg bg-slate-50 border border-slate-100 p-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-bold text-slate-700">
                      {note.performedByName || '—'}
                      {note.role && <span className="font-normal text-slate-400"> · {note.role}</span>}
                    </span>
                    <span className="text-xs text-slate-400">{formatDateTime(note.createdAt)}</span>
                  </div>
                  <p className="text-sm text-slate-700 whitespace-pre-wrap">{note.newValue}</p>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState icon={MessageSquare} title="لا توجد ملاحظات بعد" description="اكتب الملاحظة الأولى." />
          )}
        </div>
      </Card>
    </>
  );
}
