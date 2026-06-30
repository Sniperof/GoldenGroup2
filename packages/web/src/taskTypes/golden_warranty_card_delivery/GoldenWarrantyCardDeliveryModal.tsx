// ============================================================
// GoldenWarrantyCardDeliveryModal — RESULT modal (3-outcome chooser).
// Constitution: 02b §13.6 + DEC-CT-17.
//
// The task may combine several cards. Outcomes apply to ALL:
//  - delivered: recipient (customer/other) + auto date → stamps every linked
//    warranty's card_delivery_task_id. المحصلة = عدد الكروت المُسلَّمة.
//  - rescheduled: reason + expected date → needs_follow_up.
//  - cancelled: reason → close.
// Submits via the unified recordTaskResult.
// ============================================================
import { useEffect, useState } from 'react';
import { CreditCard, CalendarClock, CircleCheck, CircleX, Loader2 } from 'lucide-react';
import { api } from '../../lib/api';
import Select from '../../components/ui/Select';
import DateField from '../../components/ui/DateField';
import Modal from '../../components/ui/Modal';
import type { TaskResultModalProps } from '../../components/tasks/types';

type Mode = 'delivered' | 'reschedule' | 'cancel';

export default function GoldenWarrantyCardDeliveryModal({ visitId, taskId, task, onClose, onSaved }: TaskResultModalProps) {
  const openTaskId = task?.sourceOpenTaskId ?? task?.source_open_task_id ?? task?.id;

  const [mode, setMode] = useState<Mode>('delivered');
  const [cards, setCards] = useState<any[]>([]);
  const [recipientType, setRecipientType] = useState<'customer' | 'other'>('customer');
  const [recipientName, setRecipientName] = useState('');
  const [followReasons, setFollowReasons] = useState<any[]>([]);
  const [rejectReasons, setRejectReasons] = useState<any[]>([]);
  const [reason, setReason] = useState('');
  const [expectedDate, setExpectedDate] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (openTaskId) {
      api.openTasks.getInstalledDevices(Number(openTaskId))
        .then((rows: any[]) => setCards(Array.isArray(rows) ? rows.filter((r) => r.activeGoldenWarrantyId) : []))
        .catch(() => setCards([]));
    }
    api.systemLists.getItemsByCode('golden_card_followup_reasons').then((r: any) => setFollowReasons(Array.isArray(r) ? r : [])).catch(() => {});
    api.systemLists.getItemsByCode('golden_card_rejection_reasons').then((r: any) => setRejectReasons(Array.isArray(r) ? r : [])).catch(() => {});
  }, [openTaskId]);

  async function submit() {
    setError('');
    let body: any;
    if (mode === 'delivered') {
      if (recipientType === 'other' && !recipientName.trim()) { setError('اسم المستلِم مطلوب عند التسليم لشخص آخر'); return; }
      body = { final_decision: 'delivered', recipient_type: recipientType, recipient_name: recipientType === 'other' ? recipientName.trim() : null, closing_notes: notes.trim() || null };
    } else if (mode === 'reschedule') {
      if (!reason) { setError('سبب إعادة الجدولة مطلوب'); return; }
      if (!expectedDate) { setError('التاريخ المتوقع مطلوب'); return; }
      body = { final_decision: 'rescheduled', reason_code: reason, expected_date: expectedDate, closing_notes: notes.trim() || null };
    } else {
      if (!reason) { setError('سبب الرفض مطلوب'); return; }
      body = { final_decision: 'cancelled', reason_code: reason, closing_notes: notes.trim() || null };
    }
    setSaving(true);
    try {
      await api.fieldVisits.recordTaskResult(visitId, taskId, body);
      onSaved();
    } catch (e: any) {
      setError(e?.message ?? 'فشل تسجيل النتيجة');
    } finally {
      setSaving(false);
    }
  }

  const chooser: Array<{ key: Mode; label: string; Icon: any; cls: string }> = [
    { key: 'delivered', label: 'تسليم الكل', Icon: CircleCheck, cls: 'border-emerald-300 bg-emerald-50 text-emerald-800' },
    { key: 'reschedule', label: 'إعادة جدولة', Icon: CalendarClock, cls: 'border-amber-300 bg-amber-50 text-amber-800' },
    { key: 'cancel', label: 'إلغاء التسليم', Icon: CircleX, cls: 'border-rose-300 bg-rose-50 text-rose-800' },
  ];

  return (
    <Modal
      isOpen
      onClose={onClose}
      size="2xl"
      title={<span className="flex items-center gap-2"><CreditCard className="h-5 w-5 text-amber-600" />نتيجة تسليم كروت الكفالة</span>}
      footer={
        <>
          <button onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50">إلغاء</button>
          <button onClick={submit} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-bold text-white hover:bg-amber-500 disabled:opacity-60">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {mode === 'delivered' ? 'تأكيد تسليم الكل' : 'حفظ'}
          </button>
        </>
      }
    >
        <div className="space-y-4 px-5 py-4">
          {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}

          <div className="rounded-lg border border-amber-100 bg-amber-50/50 px-3 py-2 text-xs text-amber-800">
            كروت المهمة: {cards.length} — النتيجة تنطبق على الكل.
          </div>

          <div className="grid grid-cols-3 gap-2">
            {chooser.map(({ key, label, Icon, cls }) => (
              <button key={key} type="button" onClick={() => { setMode(key); setReason(''); }}
                className={`rounded-lg border-2 p-3 text-center transition ${mode === key ? cls : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>
                <Icon className="mx-auto mb-1 h-5 w-5" /><div className="text-sm font-bold">{label}</div>
              </button>
            ))}
          </div>

          {mode === 'delivered' && (
            <div className="space-y-3">
              <div className="flex items-center gap-4 text-sm">
                <span className="font-bold text-slate-600">المستلِم:</span>
                <label className="flex items-center gap-1.5"><input type="radio" checked={recipientType === 'customer'} onChange={() => setRecipientType('customer')} /> الزبون</label>
                <label className="flex items-center gap-1.5"><input type="radio" checked={recipientType === 'other'} onChange={() => setRecipientType('other')} /> شخص آخر</label>
              </div>
              {recipientType === 'other' && (
                <input type="text" value={recipientName} onChange={(e) => setRecipientName(e.target.value)} placeholder="اسم المستلِم" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
              )}
              <p className="text-xs text-slate-400">التاريخ تلقائي (لحظة التسجيل).</p>
            </div>
          )}

          {(mode === 'reschedule' || mode === 'cancel') && (
            <div className="space-y-3">
              <label className="block space-y-1.5">
                <span className="text-xs font-bold text-slate-500">{mode === 'reschedule' ? 'سبب إعادة الجدولة *' : 'سبب الرفض *'}</span>
                <Select
                  value={reason}
                  onChange={setReason}
                  className="w-full"
                  placeholder="— اختر —"
                  options={(mode === 'reschedule' ? followReasons : rejectReasons).map((r: any) => ({ value: r.value, label: r.value }))}
                />
              </label>
              {mode === 'reschedule' && (
                <label className="block space-y-1.5">
                  <span className="text-xs font-bold text-slate-500">التاريخ المتوقع *</span>
                  <DateField value={expectedDate} onChange={setExpectedDate} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" />
                </label>
              )}
            </div>
          )}

          <label className="block space-y-1.5">
            <span className="text-xs font-bold text-slate-500">ملاحظات</span>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm" />
          </label>
        </div>
    </Modal>
  );
}
