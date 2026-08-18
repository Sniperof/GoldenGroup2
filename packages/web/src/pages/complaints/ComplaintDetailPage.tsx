import { useEffect, useState } from 'react';
import type { ElementType, FormEvent, ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AlertCircle, ArrowRight, Building2, CheckCircle2, ClipboardCheck, Image as ImageIcon, MessageSquare, RotateCcw, UserRound } from 'lucide-react';
import Button from '../../components/ui/Button';
import Modal from '../../components/ui/Modal';
import Select from '../../components/ui/Select';
import { usePermissions } from '../../hooks/usePermissions';
import { complaintsApi } from './complaintsApi';
import { COMPLAINT_CATEGORY_LABELS_AR } from '@golden-crm/shared';

const STATUS: Record<string, string> = { new: 'جديدة', triaged: 'تم الفرز', assigned: 'معيّنة', in_progress: 'قيد المعالجة', awaiting_complainant: 'بانتظار المشتكي', resolved: 'محلولة', closed: 'مغلقة', rejected: 'مرفوضة', withdrawn: 'مسحوبة' };
const TYPE: Record<string, string> = { technical: 'فنية', device: 'جهاز', general: 'عامة' };
const PRIORITY: Record<string, string> = { low: 'منخفضة', normal: 'عادية', high: 'مرتفعة', urgent: 'عاجلة' };
const SOURCE: Record<string, string> = { mobile_app: 'تطبيق الموبايل', admin_portal: 'لوحة الإدارة', web: 'الموقع الإلكتروني' };
const ENTRY: Record<string, string> = { home: 'الرئيسية', visit: 'تفاصيل الزيارة', device: 'تفاصيل الجهاز', admin: 'لوحة الإدارة' };
const OUTCOMES = [
  { value: 'upheld', label: 'الشكوى محقة' }, { value: 'partially_upheld', label: 'الشكوى محقة جزئياً' },
  { value: 'not_upheld', label: 'الشكوى غير محقة' }, { value: 'service_recovery_completed', label: 'تم تصحيح الخدمة' },
  { value: 'redirected_to_service', label: 'تم تحويلها إلى خدمة' }, { value: 'duplicate_confirmed', label: 'شكوى مكررة' },
];
type DialogKind = 'branch' | 'handler' | 'update' | 'note' | 'resolve' | 'reject' | 'reopen';
type DialogState = { kind: DialogKind; title: string; action: string } | null;

function Card({ title, icon: Icon, children, className = '' }: { title: string; icon?: ElementType; children: ReactNode; className?: string }) {
  return <section className={'rounded-2xl border border-slate-200 bg-white p-5 shadow-sm ' + className}><div className="mb-5 flex items-center gap-2">{Icon && <span className="rounded-lg bg-sky-50 p-2 text-sky-600"><Icon className="h-4 w-4" /></span>}<h2 className="font-bold text-slate-900">{title}</h2></div>{children}</section>;
}
function Field({ label, value }: { label: string; value: ReactNode }) {
  const shown = value === null || value === undefined || value === '' ? '—' : value;
  return <div className="min-w-0"><div className="text-xs font-medium text-slate-500">{label}</div><div className="mt-1 break-words text-sm font-semibold text-slate-800">{shown}</div></div>;
}
function Empty({ children }: { children: ReactNode }) { return <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-7 text-center text-sm text-slate-500">{children}</div>; }

export default function ComplaintDetailPage() {
  const { id } = useParams();
  const { hasPermission } = usePermissions();
  const [data, setData] = useState<any>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [options, setOptions] = useState<Array<{ value: number; label: string }>>([]);
  const [selectedId, setSelectedId] = useState<number | ''>('');
  const [textValue, setTextValue] = useState('');
  const [outcome, setOutcome] = useState('');
  const [internalNotes, setInternalNotes] = useState('');
  const [publicSummary, setPublicSummary] = useState('');

  const load = async () => { try { setData(await complaintsApi.detail(id!)); } catch (caught) { setError((caught as Error).message); } };
  useEffect(() => { void load(); }, [id]);
  const command = async (action: string, body: unknown = {}) => {
    setBusy(true); setError('');
    try { await complaintsApi.command(id!, action, body); setDialog(null); await load(); }
    catch (caught) { setError((caught as Error).message); }
    finally { setBusy(false); }
  };
  const openAssignment = async (kind: 'branch' | 'handler', action: string, title: string) => {
    setError(''); setBusy(true); setSelectedId('');
    try {
      const response = kind === 'branch' ? await complaintsApi.assignmentBranches(id!) : await complaintsApi.assignmentHandlers(id!);
      setOptions(response.items.map((item: any) => ({ value: Number(item.id), label: item.name || item.username })));
      setDialog({ kind, action, title });
    } catch (caught) { setError((caught as Error).message); } finally { setBusy(false); }
  };
  const openText = (kind: 'update' | 'note' | 'reject' | 'reopen', action: string, title: string) => { setTextValue(''); setDialog({ kind, action, title }); };
  const submitDialog = (event: FormEvent) => {
    event.preventDefault(); if (!dialog) return;
    if (dialog.kind === 'branch') return void command(dialog.action, { branchId: selectedId });
    if (dialog.kind === 'handler') return void command(dialog.action, { userId: selectedId });
    if (dialog.kind === 'update') return void command(dialog.action, { message: textValue });
    if (dialog.kind === 'note') return void command(dialog.action, { note: textValue });
    if (dialog.kind === 'reject' || dialog.kind === 'reopen') return void command(dialog.action, { reason: textValue });
    return void command(dialog.action, { outcome, internalResolutionNotes: internalNotes, publicResolutionSummary: publicSummary });
  };

  if (!data) return <div className="p-10 text-center text-slate-500">{error || 'جار تحميل الشكوى...'}</div>;
  const requester = data.requester ?? {};
  const address = requester.address_snapshot ?? {};
  const category = data.category_code === 'other' ? 'أخرى' + (data.other_category_text ? ' — ' + data.other_category_text : '') : COMPLAINT_CATEGORY_LABELS_AR[data.category_code as keyof typeof COMPLAINT_CATEGORY_LABELS_AR] ?? '—';
  const canAssignHandler = data.status !== 'new' && Boolean(data.handling_branch_id);

  return <div dir="rtl" className="min-h-full bg-slate-50/70 p-4 md:p-6"><div className="mx-auto max-w-[1500px] space-y-5">
    <header className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <Link to="/complaints" className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-sky-600 hover:text-sky-700"><ArrowRight className="h-4 w-4" />قائمة الشكاوى</Link>
      <div className="flex flex-wrap items-start justify-between gap-4"><div><div className="text-sm text-slate-500">شكوى رقم</div><h1 className="mt-1 text-2xl font-bold text-slate-900">{data.public_ref_number}</h1><p className="mt-2 text-sm text-slate-500">{TYPE[data.complaint_type]} · {new Date(data.created_at).toLocaleString('ar-SY')}</p></div><div className="flex flex-wrap gap-2"><span className="rounded-full bg-sky-50 px-3 py-1.5 text-sm font-bold text-sky-700">{STATUS[data.status] ?? data.status}</span><span className="rounded-full bg-amber-50 px-3 py-1.5 text-sm font-bold text-amber-700">{PRIORITY[data.priority] ?? data.priority}</span></div></div>
      <div className="mt-5 grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-2 lg:grid-cols-4"><Field label="فرع المعالجة" value={data.handling_branch_name} /><Field label="المعالج" value={data.assigned_user_name} /><Field label="المصدر" value={SOURCE[data.source_channel] ?? data.source_channel} /><Field label="نقطة الدخول" value={ENTRY[data.entry_point] ?? data.entry_point} /></div>
    </header>
    {error && <div role="alert" className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"><AlertCircle className="mt-0.5 h-5 w-5 shrink-0" /><div><strong className="block">تعذّر تنفيذ الإجراء</strong>{error}</div></div>}

    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,2fr)_360px]"><main className="space-y-5">
      <Card title="بيانات الشكوى" icon={ClipboardCheck}><div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3"><Field label="النوع" value={TYPE[data.complaint_type]} /><Field label="التصنيف" value={category} />{data.technicalDetails && <><Field label="الموظف أو الفريق" value={data.technicalDetails.reported_target_name ?? data.technicalDetails.visit_snapshot?.team_name} /><Field label="تاريخ المشكلة" value={data.technicalDetails.incident_date} /></>}{data.deviceDetails && <><Field label="الجهاز" value={data.deviceDetails.manual_device_name ?? data.deviceDetails.device_snapshot?.device_model_name ?? data.deviceDetails.device_snapshot?.external_device_name} /><Field label="الرقم التسلسلي" value={data.deviceDetails.manual_device_serial ?? data.deviceDetails.manual_device_number ?? data.deviceDetails.device_snapshot?.serial_number} /><Field label="آخر صيانة" value={data.deviceDetails.reported_last_maintenance_date} /></>}</div><div className="mt-5 rounded-xl bg-slate-50 p-4"><div className="mb-2 text-xs font-medium text-slate-500">وصف الشكوى</div><p className="whitespace-pre-wrap text-sm leading-7 text-slate-800">{data.description}</p></div></Card>
      <Card title="مقدم الشكوى" icon={UserRound}><div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3"><Field label="الاسم" value={[requester.first_name, requester.middle_name, requester.last_name].filter(Boolean).join(' ')} /><Field label="الهاتف الأساسي" value={requester.primary_phone} /><Field label="واتساب الأساسي" value={requester.primary_phone_has_whatsapp == null ? 'غير محدد' : requester.primary_phone_has_whatsapp ? 'نعم' : 'لا'} /><Field label="الهاتف الثانوي" value={requester.secondary_phone} /><Field label="واتساب الثانوي" value={requester.secondary_phone_has_whatsapp == null ? 'غير محدد' : requester.secondary_phone_has_whatsapp ? 'نعم' : 'لا'} /><Field label="المحافظة" value={address.governorate_name ?? address.governorate} /><Field label="المنطقة" value={address.region_name ?? address.region} /><Field label="الناحية" value={address.subdistrict_name ?? address.subdistrict} /><Field label="الحي" value={address.neighborhood_name ?? address.neighborhood} /><Field label="العنوان التفصيلي" value={requester.detailed_address} /></div></Card>
      <Card title="صور الشكوى" icon={ImageIcon}>{data.attachments?.length ? <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{data.attachments.map((attachment: any) => <button key={attachment.id} type="button" onClick={() => void complaintsApi.openAttachment(id!, attachment.id).catch(caught => setError((caught as Error).message))} className="flex h-28 flex-col items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 text-sm font-medium text-sky-700 transition hover:border-sky-300 hover:bg-sky-50"><ImageIcon className="h-6 w-6" />عرض الصورة</button>)}</div> : <Empty>لا توجد صور مرفقة مع الشكوى.</Empty>}</Card>
      <Card title="التحديثات الظاهرة للمشتكي" icon={MessageSquare}>{data.publicUpdates?.length ? <div className="space-y-3">{data.publicUpdates.map((item: any) => <div key={item.id} className="rounded-xl border-r-4 border-sky-400 bg-slate-50 p-4"><p className="whitespace-pre-wrap text-sm text-slate-800">{item.message}</p><div className="mt-2 text-xs text-slate-400">{new Date(item.created_at).toLocaleString('ar-SY')}</div></div>)}</div> : <Empty>لم تتم إضافة تحديثات ظاهرة للمشتكي بعد.</Empty>}{hasPermission('complaints.publish_update') && <Button className="mt-4" variant="secondary" onClick={() => openText('update', 'public-updates', 'إضافة تحديث ظاهر')}>إضافة تحديث ظاهر</Button>}</Card>
      <Card title="الملاحظات الداخلية" icon={MessageSquare}>{data.internalNotes?.length ? <div className="space-y-3">{data.internalNotes.map((item: any) => <div key={item.id} className="rounded-xl bg-slate-50 p-4 text-sm text-slate-800">{item.note}</div>)}</div> : <Empty>لا توجد ملاحظات داخلية بعد.</Empty>}{hasPermission('complaints.add_internal_note') && <Button className="mt-4" variant="secondary" onClick={() => openText('note', 'internal-notes', 'إضافة ملاحظة داخلية')}>إضافة ملاحظة</Button>}</Card>
    </main>

    <aside className="space-y-5 xl:sticky xl:top-5"><Card title="إجراءات المعالجة" icon={CheckCircle2}><div className="space-y-2">
      {hasPermission('complaints.triage') && data.status === 'new' && <Button fullWidth loading={busy} onClick={() => void command('triage')}>فرز الشكوى</Button>}
      {hasPermission('complaints.assign_branch') && !data.handling_branch_id && <Button fullWidth variant="secondary" icon={Building2} onClick={() => void openAssignment('branch', 'assign-branch', 'تعيين فرع المعالجة')}>تعيين فرع المعالجة</Button>}
      {hasPermission('complaints.transfer_branch') && data.handling_branch_id && <Button fullWidth variant="secondary" icon={Building2} onClick={() => void openAssignment('branch', 'transfer-branch', 'نقل فرع المعالجة')}>نقل فرع المعالجة</Button>}
      {canAssignHandler && hasPermission('complaints.assign_handler') && !data.assigned_user_id && <Button fullWidth variant="secondary" icon={UserRound} onClick={() => void openAssignment('handler', 'assign-handler', 'تعيين معالج')}>تعيين معالج</Button>}
      {canAssignHandler && hasPermission('complaints.reassign_handler') && data.assigned_user_id && <Button fullWidth variant="secondary" icon={UserRound} onClick={() => void openAssignment('handler', 'reassign-handler', 'إعادة تعيين المعالج')}>إعادة تعيين المعالج</Button>}
      {hasPermission('complaints.start_processing') && data.status === 'assigned' && <Button fullWidth onClick={() => void command('start-processing')}>بدء المعالجة</Button>}
      {hasPermission('complaints.request_information') && data.status === 'in_progress' && <Button fullWidth variant="secondary" onClick={() => void command('request-information')}>بانتظار معلومات المشتكي</Button>}
      {hasPermission('complaints.resume_processing') && data.status === 'awaiting_complainant' && <Button fullWidth onClick={() => void command('resume-processing')}>استئناف المعالجة</Button>}
      {hasPermission('complaints.resolve') && ['in_progress', 'awaiting_complainant'].includes(data.status) && <Button fullWidth onClick={() => { setOutcome(''); setInternalNotes(''); setPublicSummary(''); setDialog({ kind: 'resolve', action: 'resolve', title: 'حل الشكوى' }); }}>حل الشكوى</Button>}
      {hasPermission('complaints.close') && data.status === 'resolved' && <Button fullWidth onClick={() => void command('close')}>إغلاق الشكوى</Button>}
      {hasPermission('complaints.reject') && ['new', 'triaged'].includes(data.status) && <Button fullWidth variant="danger" onClick={() => openText('reject', 'reject', 'رفض الشكوى')}>رفض الشكوى</Button>}
      {hasPermission('complaints.reopen') && ['resolved', 'closed', 'rejected', 'withdrawn'].includes(data.status) && <Button fullWidth variant="secondary" icon={RotateCcw} onClick={() => openText('reopen', 'reopen', 'إعادة فتح الشكوى داخلياً')}>إعادة فتح داخلياً</Button>}
    </div></Card><Card title="سجل الحالة">{data.statusHistory?.length ? <div className="space-y-4">{data.statusHistory.map((item: any) => <div key={item.id} className="relative border-r-2 border-slate-200 pr-4"><span className="absolute -right-[5px] top-1 h-2 w-2 rounded-full bg-sky-500" /><div className="text-sm font-bold text-slate-800">{STATUS[item.to_status] ?? item.to_status}</div><div className="mt-1 text-xs text-slate-400">{new Date(item.created_at).toLocaleString('ar-SY')}</div></div>)}</div> : <Empty>لا يوجد سجل حالة.</Empty>}</Card></aside></div>
  </div>

  <Modal isOpen={Boolean(dialog)} onClose={() => !busy && setDialog(null)} title={dialog?.title} size={dialog?.kind === 'resolve' ? 'lg' : 'md'} footer={<><Button variant="secondary" disabled={busy} onClick={() => setDialog(null)}>إلغاء</Button><Button type="submit" form="complaint-action-form" loading={busy} disabled={((dialog?.kind === 'branch' || dialog?.kind === 'handler') && selectedId === '') || (dialog?.kind === 'resolve' && outcome === '')}>حفظ</Button></>}>
    <form id="complaint-action-form" onSubmit={submitDialog} className="space-y-5 p-5">
      {(dialog?.kind === 'branch' || dialog?.kind === 'handler') && <div><label className="mb-2 block text-sm font-bold text-slate-700">{dialog.kind === 'branch' ? 'اختر الفرع' : 'اختر المعالج'}</label><Select value={selectedId} onChange={setSelectedId} options={options} placeholder={options.length ? 'اختر من القائمة' : 'لا توجد خيارات متاحة'} disabled={!options.length} /></div>}
      {dialog?.kind === 'resolve' && <><div><label className="mb-2 block text-sm font-bold text-slate-700">نتيجة المعالجة</label><Select value={outcome} onChange={setOutcome} options={OUTCOMES} placeholder="اختر النتيجة" /></div><div><label className="mb-2 block text-sm font-bold text-slate-700">ملاحظات الحل الداخلية</label><textarea required minLength={3} maxLength={4000} value={internalNotes} onChange={event => setInternalNotes(event.target.value)} className="min-h-28 w-full rounded-xl border border-slate-200 p-3 text-sm outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100" /></div><div><label className="mb-2 block text-sm font-bold text-slate-700">ملخص الحل الظاهر للمشتكي</label><textarea required minLength={3} maxLength={2000} value={publicSummary} onChange={event => setPublicSummary(event.target.value)} className="min-h-24 w-full rounded-xl border border-slate-200 p-3 text-sm outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100" /></div></>}
      {dialog && ['update', 'note', 'reject', 'reopen'].includes(dialog.kind) && <div><label className="mb-2 block text-sm font-bold text-slate-700">{dialog.kind === 'update' ? 'النص الظاهر للمشتكي' : dialog.kind === 'note' ? 'الملاحظة الداخلية' : 'السبب'}</label><textarea autoFocus required minLength={3} maxLength={2000} value={textValue} onChange={event => setTextValue(event.target.value)} className="min-h-28 w-full rounded-xl border border-slate-200 p-3 text-sm outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100" /></div>}
    </form>
  </Modal>
  </div>;
}
