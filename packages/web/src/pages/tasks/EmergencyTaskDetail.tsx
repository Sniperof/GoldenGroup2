import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ChevronRight, ShieldAlert, Loader2, Pencil, Check, X,
  UserRound, Phone, FileText, Wrench, Users,
  ClipboardList, Clock, AlertCircle, Package, Tag, PlusCircle,
} from 'lucide-react';
import { api } from '../../lib/api';
import ClientCardPopup from '../../components/ClientCardPopup';
import EmergencyResultModal from '../../components/emergency/EmergencyResultModal';
import type { OpenTask, EmergencyTicket, ClientRating } from '@golden-crm/shared';
import type { EmergencyResultPayload } from '../../components/emergency/EmergencyResultModal';

const EMERGENCY_STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  open: { label: 'جديد', color: 'bg-blue-50 text-blue-700 border border-blue-200' },
  needs_follow_up: { label: 'بحاجة متابعة', color: 'bg-amber-50 text-amber-700 border border-amber-200' },
  assigned: { label: 'مسندة', color: 'bg-violet-50 text-violet-700 border border-violet-200' },
  in_scheduling: { label: 'قيد الجدولة', color: 'bg-indigo-50 text-indigo-700 border border-indigo-200' },
  scheduled: { label: 'تم تحديد موعد', color: 'bg-emerald-50 text-emerald-700 border border-emerald-200' },
  waiting_execution: { label: 'بانتظار التنفيذ', color: 'bg-teal-50 text-teal-700 border border-teal-200' },
  in_execution: { label: 'قيد التنفيذ', color: 'bg-cyan-50 text-cyan-700 border border-cyan-200' },
  ended: { label: 'انتهت', color: 'bg-slate-100 text-slate-700 border border-slate-200' },
  completed: { label: 'مكتملة', color: 'bg-green-50 text-green-700 border border-green-200' },
  closed: { label: 'مغلقة', color: 'bg-slate-200 text-slate-700 border border-slate-300' },
  cancelled: { label: 'لم تتم', color: 'bg-rose-50 text-rose-700 border border-rose-200' },
};

const RATING_CONFIG: Record<ClientRating, { label: string; color: string }> = {
  Committed: { label: 'ملتزم', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  NotCommitted: { label: 'غير ملتزم', color: 'bg-rose-50 text-rose-700 border-rose-200' },
  Undefined: { label: 'غير محدد', color: 'bg-slate-100 text-slate-600 border-slate-200' },
};

function getStatusMeta(status: string) {
  return EMERGENCY_STATUS_CONFIG[status] || { label: status || '—', color: 'bg-slate-50 text-slate-600 border border-slate-200' };
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    return d.toLocaleString('ar-SY', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return dateStr;
  }
}

function Card({ title, icon: Icon, children, className = '' }: { title: string; icon: any; children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-white rounded-xl border border-slate-200 overflow-hidden ${className}`}>
      <div className="px-5 py-3 border-b border-slate-100 bg-slate-50/50 flex items-center gap-2">
        <Icon className="w-4 h-4 text-slate-400" />
        <h3 className="text-sm font-bold text-slate-700">{title}</h3>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function InfoLine({ label, value, dir }: { label: string; value: React.ReactNode; dir?: string }) {
  return (
    <div className="flex items-start justify-between py-2 gap-4">
      <span className="text-xs text-slate-400 font-bold shrink-0">{label}</span>
      <span className={`text-sm font-medium text-slate-800 ${dir || ''}`}>{value}</span>
    </div>
  );
}

export default function EmergencyTaskDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const taskId = Number(id);

  const [task, setTask] = useState<OpenTask | null>(null);
  const [ticket, setTicket] = useState<EmergencyTicket | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [clientPopupId, setClientPopupId] = useState<number | null>(null);

  const [editingNotes, setEditingNotes] = useState(false);
  const [notesDraft, setNotesDraft] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);

  const [completing, setCompleting] = useState(false);

  const [visitResult, setVisitResult] = useState<any | null>(null);
  const [resultModalOpen, setResultModalOpen] = useState(false);
  const [savingResult, setSavingResult] = useState(false);
  const [resultError, setResultError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const [taskData, ticketsData, resultData] = await Promise.all([
          api.openTasks.get(taskId),
          api.emergencyTickets.list({ openTaskId: taskId }),
          api.openTasks.getEmergencyResult(taskId).catch(() => null),
        ]);
        if (!active) return;
        setTask(taskData);
        setTicket(ticketsData[0] || null);
        setVisitResult(resultData);
      } catch (err: any) {
        if (!active) return;
        setError(err.message || 'فشل في تحميل بيانات المهمة');
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => { active = false; };
  }, [taskId]);

  const handleSaveNotes = async () => {
    if (!task) return;
    setSavingNotes(true);
    try {
      const updated = await api.openTasks.update(task.id, { notes: notesDraft });
      setTask(updated);
      setEditingNotes(false);
    } catch (err: any) {
      setError(err.message || 'فشل في حفظ الملاحظات');
    } finally {
      setSavingNotes(false);
    }
  };

  const handleComplete = async () => {
    if (!task || !window.confirm('هل أنت متأكد من إنهاء هذه المهمة؟')) return;
    setCompleting(true);
    try {
      const updated = await api.openTasks.update(task.id, { status: 'completed' });
      setTask(updated);
    } catch (err: any) {
      setError(err.message || 'فشل في إنهاء المهمة');
    } finally {
      setCompleting(false);
    }
  };

  const handleSubmitResult = async (payload: EmergencyResultPayload) => {
    if (!task) return;
    setSavingResult(true);
    setResultError('');
    try {
      const updatedTask = await api.openTasks.submitEmergencyResult(task.id, payload);
      setTask(updatedTask);
      const resultData = await api.openTasks.getEmergencyResult(task.id);
      setVisitResult(resultData);
      setResultModalOpen(false);
    } catch (err: any) {
      setResultError(err.message || 'فشل في تسجيل النتيجة');
    } finally {
      setSavingResult(false);
    }
  };

  const primaryContact = useMemo(() => {
    if (!task?.clientSnapshot?.contacts?.length) return null;
    return task.clientSnapshot.contacts.find((c: any) => c.isPrimary) || task.clientSnapshot.contacts[0];
  }, [task]);

  if (loading) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-slate-500" dir="rtl">
        <Loader2 className="w-8 h-8 animate-spin text-sky-500 mb-3" />
        <p className="text-sm font-medium">جارٍ تحميل بيانات المهمة...</p>
      </div>
    );
  }

  if (error || !task) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-slate-500" dir="rtl">
        <AlertCircle className="w-10 h-10 text-rose-400 mb-3" />
        <p className="text-sm font-medium">{error || 'المهمة غير موجودة'}</p>
        <button
          onClick={() => navigate('/tasks/emergency')}
          className="mt-4 text-sky-600 font-bold text-sm flex items-center gap-2 hover:underline"
        >
          <ChevronRight className="w-4 h-4" /> العودة لقائمة الطوارئ
        </button>
      </div>
    );
  }

  const statusMeta = getStatusMeta(task.status);
  const client = task.clientSnapshot;
  const contract = task.contractSnapshot;
  const team = task.teamSnapshot;

  return (
    <div className="h-full flex flex-col bg-slate-50/50 overflow-hidden" dir="rtl">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 shrink-0">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/tasks/emergency')}
              className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
              <span>طوارئ الصيانة</span>
            </button>
            <span className="text-slate-300">/</span>
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-red-500" />
              <span className="text-sm font-bold text-slate-800">
                بلاغ طوارئ #{task.id}
              </span>
              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-lg text-xs font-bold ${statusMeta.color}`}>
                {statusMeta.label}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setNotesDraft(task.notes || '');
                setEditingNotes(true);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold bg-sky-50 text-sky-700 border border-sky-200 hover:bg-sky-100 transition-colors"
            >
              <Pencil className="w-3.5 h-3.5" />
              تعديل المشكلة
            </button>

            {!team && (
              <button
                onClick={() => alert('تعيين الفريق — يُفتح نموذج اختيار الفريق (لم يُطبَّق بعد)')}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 transition-colors"
              >
                <Users className="w-3.5 h-3.5" />
                تعيين فريق
              </button>
            )}

            {task.status !== 'completed' && task.status !== 'cancelled' && (
              <button
                onClick={handleComplete}
                disabled={completing}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition-colors disabled:opacity-50"
              >
                {completing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                إنهاء المهمة
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4 mt-3 text-xs text-slate-500">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-100">
            <Tag className="w-3 h-3" />
            صيانة طارئة
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Clock className="w-3 h-3" />
            {formatDate(task.createdAt)}
          </span>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-6 py-6 space-y-6">

          {/* Client Card */}
          <Card title="بيانات الزبون" icon={UserRound}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-1">
              <InfoLine
                label="الاسم"
                value={
                  <button
                    onClick={() => client && setClientPopupId(task.clientId)}
                    className="font-bold text-slate-800 hover:text-sky-700 hover:underline transition-colors"
                  >
                    {client?.name || '—'}
                  </button>
                }
              />
              <InfoLine
                label="الهاتف"
                value={<span className="font-mono text-slate-600" dir="ltr">{client?.mobile || '—'}</span>}
              />
              <InfoLine
                label="المحافظة"
                value={client?.address?.governorate || '—'}
              />
              <InfoLine
                label="المنطقة"
                value={client?.address?.district || '—'}
              />
              <InfoLine
                label="الناحية"
                value={client?.address?.subArea || '—'}
              />
              <InfoLine
                label="الحي"
                value={client?.address?.neighborhood || '—'}
              />
              <InfoLine
                label="العنوان التفصيلي"
                value={client?.address?.detailed || '—'}
              />
              <InfoLine
                label="الرقم الرئيسي"
                value={
                  <span className="font-mono text-slate-600" dir="ltr">
                    {primaryContact?.number || '—'}
                  </span>
                }
              />
              <InfoLine
                label="التقييم"
                value={
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold border ${RATING_CONFIG[(client?.rating as ClientRating) || 'Undefined'].color}`}>
                    {RATING_CONFIG[(client?.rating as ClientRating) || 'Undefined'].label}
                  </span>
                }
              />
            </div>
          </Card>

          {/* Contract & Device Card */}
          <Card title="العقد والجهاز" icon={Package}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-1">
              <InfoLine label="رقم العقد" value={contract?.contractNumber || '—'} />
              <InfoLine label="موديل الجهاز" value={contract?.device?.modelName || '—'} />
              <InfoLine label="الرقم التسلسلي" value={contract?.device?.serialNumber || '—'} />
              <InfoLine label="تاريخ التركيب" value={contract?.contractDate ? formatDate(contract.contractDate) : '—'} />
              <InfoLine label="حالة العقد" value={contract?.status || '—'} />
            </div>
          </Card>

          {/* Team Card */}
          <Card title="الفريق المكلف" icon={Users}>
            {team ? (
              <div className="space-y-3">
                {team.supervisor && (
                  <div className="flex items-center justify-between py-2 border-b border-slate-50 last:border-0">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center">
                        <UserRound className="w-4 h-4 text-indigo-500" />
                      </div>
                      <span className="text-sm font-medium text-slate-800">{team.supervisor.name}</span>
                    </div>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200">مشرف</span>
                  </div>
                )}
                {team.technician && (
                  <div className="flex items-center justify-between py-2 border-b border-slate-50 last:border-0">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-sky-50 flex items-center justify-center">
                        <Wrench className="w-4 h-4 text-sky-500" />
                      </div>
                      <span className="text-sm font-medium text-slate-800">{team.technician.name}</span>
                    </div>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-sky-50 text-sky-700 border border-sky-200">فني</span>
                  </div>
                )}
                {team.trainee && (
                  <div className="flex items-center justify-between py-2 border-b border-slate-50 last:border-0">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center">
                        <Users className="w-4 h-4 text-amber-500" />
                      </div>
                      <span className="text-sm font-medium text-slate-800">{team.trainee.name}</span>
                    </div>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">متدرب</span>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-6 text-slate-400">
                <Users className="w-8 h-8 mb-2" />
                <p className="text-sm mb-3">لم يتم تعيين فريق</p>
                <button
                  onClick={() => alert('تعيين الفريق — يُفتح نموذج اختيار الفريق (لم يُطبَّق بعد)')}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 transition-colors"
                >
                  <Users className="w-3.5 h-3.5" />
                  تعيين فريق
                </button>
              </div>
            )}
          </Card>

          {/* Call Source Card */}
          <Card title="مصدر البلاغ" icon={Phone}>
            <div className="flex items-center gap-2 mb-4">
              <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-bold bg-red-50 text-red-700 border border-red-200">
                بلاغ طوارئ
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-1">
              <InfoLine label="استلم البلاغ" value={ticket?.callReceiver || '—'} />
              <InfoLine label="تاريخ ووقت البلاغ" value={ticket ? formatDate(ticket.createdAt) : '—'} />
              <div className="md:col-span-2">
                <InfoLine
                  label="ملاحظات المكالمة"
                  value={
                    <span className="text-sm text-slate-700 whitespace-pre-wrap">
                      {ticket?.callNotes || 'لا توجد ملاحظات'}
                    </span>
                  }
                />
              </div>
            </div>
          </Card>

          {/* Problem Description */}
          <Card title="وصف المشكلة" icon={FileText}>
            {editingNotes ? (
              <div className="space-y-3">
                <textarea
                  value={notesDraft}
                  onChange={(e) => setNotesDraft(e.target.value)}
                  rows={5}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent resize-none"
                  placeholder="أدخل وصف المشكلة..."
                />
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleSaveNotes}
                    disabled={savingNotes}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold bg-sky-600 text-white hover:bg-sky-500 transition-colors disabled:opacity-50"
                  >
                    {savingNotes ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                    حفظ
                  </button>
                  <button
                    onClick={() => setEditingNotes(false)}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                    إلغاء
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">
                  {task.notes || 'لا يوجد وصف للمشكلة'}
                </p>
                <button
                  onClick={() => {
                    setNotesDraft(task.notes || '');
                    setEditingNotes(true);
                  }}
                  className="inline-flex items-center gap-1.5 text-xs font-bold text-sky-600 hover:text-sky-700 transition-colors"
                >
                  <Pencil className="w-3 h-3" />
                  تعديل الوصف
                </button>
              </div>
            )}
          </Card>

          {/* Visit Result Card */}
          <Card title="نتيجة الزيارة الميدانية" icon={ClipboardList}>
            {visitResult?.visitTaskResult ? (
              <div className="space-y-4">
                {/* Decision badge */}
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-500">القرار النهائي</span>
                  <span className={`inline-flex items-center px-3 py-1 rounded-lg text-xs font-bold border ${
                    visitResult.visitTaskResult.finalDecision === 'resolved'
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      : visitResult.visitTaskResult.finalDecision === 'cancelled'
                      ? 'bg-slate-100 text-slate-600 border-slate-200'
                      : 'bg-amber-50 text-amber-700 border-amber-200'
                  }`}>
                    {{
                      resolved: 'تم الحل نهائياً',
                      partially_resolved: 'تم الحل جزئياً',
                      unresolved: 'لم تُحَل',
                      needs_followup: 'تحتاج متابعة',
                      cancelled: 'ملغاة',
                    }[visitResult.visitTaskResult.finalDecision as string] ?? visitResult.visitTaskResult.finalDecision}
                  </span>
                </div>
                {visitResult.visitTaskResult.closingNotes && (
                  <InfoLine label="ملاحظات الإغلاق" value={visitResult.visitTaskResult.closingNotes} />
                )}

                {/* Technical state */}
                {visitResult.technicalState && (
                  <div className="mt-3 rounded-lg bg-slate-50 border border-slate-100 p-3 space-y-1.5">
                    <p className="text-xs font-bold text-slate-500 mb-2">الحالة الفنية للجهاز</p>
                    {visitResult.technicalState.problemConfirmed !== null && (
                      <InfoLine label="تأكيد المشكلة"
                        value={visitResult.technicalState.problemConfirmed ? 'نعم' : 'لا'} />
                    )}
                    {visitResult.technicalState.membraneOutput && (
                      <InfoLine label="حالة الغشاء" value={visitResult.technicalState.membraneOutput} />
                    )}
                    {visitResult.technicalState.waterTdsBefore != null && (
                      <InfoLine label="TDS قبل" value={`${visitResult.technicalState.waterTdsBefore} ppm`} />
                    )}
                    {visitResult.technicalState.waterTdsAfter != null && (
                      <InfoLine label="TDS بعد" value={`${visitResult.technicalState.waterTdsAfter} ppm`} />
                    )}
                    {visitResult.technicalState.technicalNotes && (
                      <InfoLine label="ملاحظات فنية" value={visitResult.technicalState.technicalNotes} />
                    )}
                  </div>
                )}

                {/* Parts */}
                {visitResult.partsUsed?.length > 0 && (
                  <div className="mt-3 rounded-lg bg-slate-50 border border-slate-100 p-3">
                    <p className="text-xs font-bold text-slate-500 mb-2">القطع المستبدلة ({visitResult.partsUsed.length})</p>
                    <div className="space-y-1">
                      {visitResult.partsUsed.map((part: any) => (
                        <div key={part.id} className="flex items-center justify-between text-sm">
                          <span className="text-slate-700">{part.partNameSnapshot}</span>
                          <span className="text-slate-500 text-xs">
                            x{part.quantity}
                            {part.unitPrice != null ? ` — ${part.unitPrice.toLocaleString()}` : ''}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Financials */}
                {visitResult.financials && (
                  <div className="mt-3 rounded-lg bg-slate-50 border border-slate-100 p-3 space-y-1.5">
                    <p className="text-xs font-bold text-slate-500 mb-2">التكاليف المالية</p>
                    {visitResult.financials.laborCost != null && (
                      <InfoLine label="تكلفة العمالة" value={`${visitResult.financials.laborCost.toLocaleString()} ل.س`} />
                    )}
                    {visitResult.financials.partsCost != null && (
                      <InfoLine label="تكلفة القطع" value={`${visitResult.financials.partsCost.toLocaleString()} ل.س`} />
                    )}
                    {visitResult.financials.totalCost != null && (
                      <InfoLine label="الإجمالي" value={`${visitResult.financials.totalCost.toLocaleString()} ل.س`} />
                    )}
                    {visitResult.financials.paymentMethod && (
                      <InfoLine label="طريقة الدفع" value={visitResult.financials.paymentMethod} />
                    )}
                    {visitResult.financials.collectedAmount != null && (
                      <InfoLine label="المبلغ المحصّل" value={`${visitResult.financials.collectedAmount.toLocaleString()} ل.س`} />
                    )}
                  </div>
                )}

                {task.status !== 'completed' && task.status !== 'cancelled' && (
                  <button
                    type="button"
                    onClick={() => { setResultError(''); setResultModalOpen(true); }}
                    className="inline-flex items-center gap-1.5 text-xs font-bold text-sky-600 hover:text-sky-700 transition-colors mt-2"
                  >
                    <Pencil className="w-3 h-3" />
                    تعديل النتيجة
                  </button>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-6 text-slate-400 space-y-3">
                <ClipboardList className="w-8 h-8" />
                <p className="text-sm">لم تُسجَّل نتيجة الزيارة بعد</p>
                {task.status !== 'completed' && task.status !== 'cancelled' && (
                  <button
                    type="button"
                    onClick={() => { setResultError(''); setResultModalOpen(true); }}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition-colors"
                  >
                    <PlusCircle className="w-4 h-4" />
                    تسجيل نتيجة الزيارة
                  </button>
                )}
              </div>
            )}
          </Card>

        </div>
      </div>

      {clientPopupId !== null && (
        <ClientCardPopup
          clientId={clientPopupId}
          onClose={() => setClientPopupId(null)}
        />
      )}

      <EmergencyResultModal
        isOpen={resultModalOpen}
        saving={savingResult}
        error={resultError}
        onClose={() => setResultModalOpen(false)}
        onSubmit={handleSubmitResult}
      />
    </div>
  );
}
