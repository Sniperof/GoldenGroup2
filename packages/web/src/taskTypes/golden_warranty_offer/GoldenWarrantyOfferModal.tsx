// ============================================================
// GoldenWarrantyOfferModal — RESULT modal (3-outcome chooser).
// Constitution: 02b §13.6 + DEC-CT-17, device-demo lifecycle model.
//
// Outcomes (final_decision): activated / rescheduled / cancelled.
//  - activated: pick which of the task's devices to activate; each gets its own
//    receipt → its own warranty (months + value [+ optional down payment]).
//    المحصلة = عدد الأجهزة المُفعّلة.
//  - rescheduled (تفعيل لاحقاً): reason + expected date → needs_follow_up.
//  - cancelled (رفض): reason → close.
// Submits via the unified recordTaskResult; warranty creation is a reflection.
// ============================================================
import { useEffect, useMemo, useState } from 'react';
import { Award, CalendarClock, ChevronDown, ChevronLeft, CircleCheck, CircleX, CreditCard, Loader2, Trash2, Wrench, X } from 'lucide-react';
import { api } from '../../lib/api';
import type { TaskResultModalProps } from '../../components/tasks/types';
import { TechnicalStateFields, buildTechnicalStatePayload, hasAnyTechnicalReading, type TechStateForm } from '../../components/devices/TechnicalStateFields';
import Select from '../../components/ui/Select';
import WarrantyPaymentEntries, { warrantyEntrySyp, warrantyPaymentPayload, type WarrantyPaymentRow } from '../../components/warranty/WarrantyPaymentEntries';

type Mode = 'activate' | 'later' | 'reject';
type PaymentType = 'cash' | 'installment';
interface InstallmentDraft { installmentNumber: number; dueDate: string; amountSyp: string; }
interface DeviceRow {
  installedDeviceId: number;
  deviceModelName: string;
  serialNumber: string | null;
  activeGoldenWarrantyId: number | null;
  selected: boolean;
  months: string;
  totalValue: string;
  expanded: boolean;
  paymentType: PaymentType;
  payments: WarrantyPaymentRow[];
  installmentCount: string;
  installments: InstallmentDraft[];
  reading: TechStateForm;
}

function addMonths(dateStr: string, months: number): string {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '';
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

export default function GoldenWarrantyOfferModal({ visitId, taskId, task, onClose, onSaved }: TaskResultModalProps) {
  const openTaskId = task?.sourceOpenTaskId ?? task?.source_open_task_id ?? task?.id;
  const today = new Date().toISOString().slice(0, 10);

  const [mode, setMode] = useState<Mode>('activate');
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [receiptDate, setReceiptDate] = useState(today);
  const [laterReasons, setLaterReasons] = useState<any[]>([]);
  const [rejectReasons, setRejectReasons] = useState<any[]>([]);
  const [reason, setReason] = useState('');
  const [expectedDate, setExpectedDate] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (openTaskId) {
      api.openTasks.getInstalledDevices(Number(openTaskId))
        .then((rows: any[]) => setDevices((Array.isArray(rows) ? rows : []).map((r) => ({
          installedDeviceId: r.installedDeviceId,
          deviceModelName: r.deviceModelName,
          serialNumber: r.serialNumber ?? null,
          activeGoldenWarrantyId: r.activeGoldenWarrantyId ?? null,
          selected: !r.activeGoldenWarrantyId,
          months: '12',
          totalValue: '',
          expanded: false,
          paymentType: 'cash' as PaymentType,
          payments: [] as WarrantyPaymentRow[],
          installmentCount: '6',
          installments: [] as InstallmentDraft[],
          reading: {} as TechStateForm,
        }))))
        .catch(() => setDevices([]));
    }
    api.systemLists.getItemsByCode('golden_offer_followup_reasons').then((r: any) => setLaterReasons(Array.isArray(r) ? r : [])).catch(() => {});
    api.systemLists.getItemsByCode('golden_offer_rejection_reasons').then((r: any) => setRejectReasons(Array.isArray(r) ? r : [])).catch(() => {});
  }, [openTaskId]);

  const activatedCount = useMemo(() => devices.filter((d) => d.selected).length, [devices]);
  const updateDevice = (i: number, patch: Partial<DeviceRow>) =>
    setDevices((p) => p.map((d, idx) => (idx === i ? { ...d, ...patch } : d)));

  const devicePaidSyp = (d: DeviceRow) => d.payments.reduce((s, p) => s + warrantyEntrySyp(p), 0);

  // Generate an installment schedule for one device: (value − down payment)
  // split over N monthly steps starting one month after the receipt date.
  const generateInstallments = (i: number) => {
    const d = devices[i];
    const total = Number(d.totalValue) || 0;
    const downPaid = devicePaidSyp(d);
    const remaining = total - downPaid;
    const count = parseInt(d.installmentCount, 10) || 0;
    if (remaining <= 0 || count <= 0) { updateDevice(i, { installments: [] }); return; }
    const monthly = Math.floor(remaining / count);
    const last = remaining - monthly * (count - 1);
    const drafts: InstallmentDraft[] = [];
    for (let n = 0; n < count; n++) {
      drafts.push({
        installmentNumber: n + 1,
        dueDate: addMonths(receiptDate, n + 1),
        amountSyp: String(n === count - 1 ? last : monthly),
      });
    }
    updateDevice(i, { installments: drafts });
  };

  const updateInstallment = (i: number, n: number, patch: Partial<InstallmentDraft>) =>
    updateDevice(i, { installments: devices[i].installments.map((x, xi) => (xi === n ? { ...x, ...patch } : x)) });

  async function submit() {
    setError('');
    let body: any;
    if (mode === 'activate') {
      const chosen = devices.filter((d) => d.selected);
      if (chosen.length === 0) { setError('اختر جهازاً واحداً على الأقل للتفعيل'); return; }
      for (const d of chosen) {
        const label = d.serialNumber ?? `#${d.installedDeviceId}`;
        if (!(Number(d.months) > 0)) { setError(`المدة غير صالحة للجهاز ${label}`); return; }
        if (d.paymentType === 'installment') {
          if (!(Number(d.totalValue) > 0)) { setError(`قيمة الكفالة مطلوبة للتقسيط — الجهاز ${label}`); return; }
          if (d.installments.length === 0) { setError(`ولّد أقساط الجهاز ${label} قبل الحفظ`); return; }
        }
      }
      body = {
        final_decision: 'activated',
        receipt_date: receiptDate,
        closing_notes: notes.trim() || null,
        devices: chosen.map((d) => ({
          installedDeviceId: d.installedDeviceId,
          months: Number(d.months),
          totalValue: d.totalValue.trim() ? Number(d.totalValue) : null,
          paymentType: d.paymentType,
          payments: d.payments
            .filter((p) => (p.paymentCategory === 'barter' ? Number(p.barterValueSyp) > 0 : Number(p.amountValue) > 0))
            .map(warrantyPaymentPayload),
          installments: d.paymentType === 'installment'
            ? d.installments.map((inst) => ({
                installmentNumber: inst.installmentNumber,
                dueDate: inst.dueDate,
                amountSyp: Number(inst.amountSyp) || 0,
              }))
            : [],
          reading: hasAnyTechnicalReading(d.reading) ? buildTechnicalStatePayload(d.reading) : null,
        })),
      };
    } else if (mode === 'later') {
      if (!reason) { setError('سبب التفعيل لاحقاً مطلوب'); return; }
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
    { key: 'activate', label: 'تفعيل الكفالة', Icon: CircleCheck, cls: 'border-emerald-300 bg-emerald-50 text-emerald-800' },
    { key: 'later', label: 'تفعيل لاحقاً', Icon: CalendarClock, cls: 'border-amber-300 bg-amber-50 text-amber-800' },
    { key: 'reject', label: 'رفض التفعيل', Icon: CircleX, cls: 'border-rose-300 bg-rose-50 text-rose-800' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" dir="rtl">
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-amber-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-amber-200 bg-amber-50 px-5 py-4">
          <div className="flex items-center gap-2"><Award className="h-5 w-5 text-amber-600" /><h2 className="text-base font-black text-amber-900">نتيجة عرض الكفالة الذهبية</h2></div>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-white hover:text-slate-700"><X className="h-5 w-5" /></button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}

          <div className="grid grid-cols-3 gap-2">
            {chooser.map(({ key, label, Icon, cls }) => (
              <button key={key} type="button" onClick={() => { setMode(key); setReason(''); }}
                className={`rounded-lg border-2 p-3 text-center transition ${mode === key ? cls : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>
                <Icon className="mx-auto mb-1 h-5 w-5" /><div className="text-sm font-bold">{label}</div>
              </button>
            ))}
          </div>

          {mode === 'activate' && (
            <>
              <label className="flex items-center gap-3 text-sm">
                <span className="font-bold text-slate-600">تاريخ الوصل (بداية)</span>
                <input type="date" value={receiptDate} onChange={(e) => setReceiptDate(e.target.value)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm" />
                <span className="mr-auto text-xs text-emerald-700">المحصلة: {activatedCount} جهاز</span>
              </label>
              <div className="rounded-lg border border-slate-200">
                {devices.length === 0 && <p className="px-4 py-3 text-sm text-slate-400">لا أجهزة مرتبطة بالمهمة.</p>}
                {devices.map((d, i) => (
                  <div key={d.installedDeviceId} className={`border-b border-slate-100 last:border-0 ${d.activeGoldenWarrantyId ? 'opacity-60' : ''}`}>
                    <div className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                      <input type="checkbox" checked={d.selected} disabled={!!d.activeGoldenWarrantyId} onChange={(e) => updateDevice(i, { selected: e.target.checked })} />
                      <span className="font-medium">{d.deviceModelName}</span>
                      <span className="text-slate-400">{d.serialNumber ?? `#${d.installedDeviceId}`}</span>
                      {d.activeGoldenWarrantyId
                        ? <span className="text-xs text-amber-700">كفالة فعّالة — غير قابل</span>
                        : (
                          <>
                            <span className="text-slate-500">المدة:</span>
                            <input type="number" min="1" value={d.months} onChange={(e) => updateDevice(i, { months: e.target.value })} className="w-16 rounded border border-slate-200 px-2 py-1 text-sm" />
                            <span className="text-slate-500">القيمة:</span>
                            <input type="number" min="0" value={d.totalValue} onChange={(e) => updateDevice(i, { totalValue: e.target.value })} placeholder="—" className="w-24 rounded border border-slate-200 px-2 py-1 text-sm" />
                            <span className="text-xs text-slate-400">النهاية: {Number(d.months) > 0 ? addMonths(receiptDate, Number(d.months)) : '—'}</span>
                            <button type="button" onClick={() => updateDevice(i, { expanded: !d.expanded })}
                              className="mr-auto inline-flex items-center gap-1 text-xs font-bold text-amber-700">
                              {d.expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronLeft className="h-3.5 w-3.5" />}
                              دفعات وقراءة فنية
                            </button>
                          </>
                        )}
                    </div>
                    {d.selected && !d.activeGoldenWarrantyId && d.expanded && (
                      <div className="space-y-3 border-t border-slate-100 bg-slate-50/40 px-3 py-3">
                        {/* ── بطاقة الدفع ─────────────────────────────── */}
                        <section className="rounded-xl border border-emerald-200 bg-white">
                          <header className="flex items-center gap-2 border-b border-emerald-100 bg-emerald-50/60 px-3 py-2">
                            <CreditCard className="h-4 w-4 text-emerald-600" />
                            <span className="text-xs font-black text-emerald-800">الدفع</span>
                          </header>
                          <div className="space-y-3 p-3">
                            {/* نوع الدفع */}
                            <div className="flex gap-2">
                              {([
                                { v: 'cash', label: 'نقدي' },
                                { v: 'installment', label: 'تقسيط' },
                              ] as Array<{ v: PaymentType; label: string }>).map((o) => (
                                <button key={o.v} type="button"
                                  onClick={() => updateDevice(i, { paymentType: o.v, installments: o.v === 'cash' ? [] : d.installments })}
                                  className={`flex-1 rounded-lg border-2 py-2 text-xs font-bold transition ${
                                    d.paymentType === o.v
                                      ? 'border-emerald-400 bg-emerald-50 text-emerald-700'
                                      : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'
                                  }`}>
                                  {o.label}
                                </button>
                              ))}
                            </div>

                            <div>
                              <p className="mb-1.5 text-[11px] font-bold text-slate-500">
                                {d.paymentType === 'installment' ? 'الدفعة المقدّمة (اختياري)' : 'الدفعات'}
                              </p>
                              <WarrantyPaymentEntries
                                entries={d.payments}
                                onChange={(next) => updateDevice(i, { payments: next })}
                                grandTotal={d.paymentType === 'cash' && Number(d.totalValue) > 0 ? Number(d.totalValue) : null}
                              />
                            </div>

                            {/* جدول الأقساط */}
                            {d.paymentType === 'installment' && (
                              <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-3 space-y-2">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="text-[11px] font-bold text-slate-500">عدد الأقساط</span>
                                  <input type="number" min="1" value={d.installmentCount}
                                    onChange={(e) => updateDevice(i, { installmentCount: e.target.value })}
                                    className="w-16 rounded border border-slate-200 px-2 py-1 text-sm" />
                                  <button type="button" onClick={() => generateInstallments(i)}
                                    className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-500">
                                    توليد الأقساط
                                  </button>
                                  <span className="mr-auto text-[11px] text-slate-400">
                                    المتبقّي بعد المقدّم: {Math.max(0, (Number(d.totalValue) || 0) - devicePaidSyp(d)).toLocaleString('ar-SY')} ل.س
                                  </span>
                                </div>
                                {d.installments.length > 0 ? (
                                  <div className="space-y-1">
                                    {d.installments.map((inst, n) => (
                                      <div key={n} className="flex items-center gap-2">
                                        <span className="w-6 text-center text-[11px] font-bold text-slate-400">{inst.installmentNumber}</span>
                                        <input type="date" value={inst.dueDate}
                                          onChange={(e) => updateInstallment(i, n, { dueDate: e.target.value })}
                                          className="rounded border border-slate-200 px-2 py-1 text-xs" />
                                        <input type="number" min="0" value={inst.amountSyp}
                                          onChange={(e) => updateInstallment(i, n, { amountSyp: e.target.value })}
                                          className="w-28 rounded border border-slate-200 px-2 py-1 text-xs" dir="ltr" />
                                        <span className="text-[11px] text-slate-400">ل.س</span>
                                        <button type="button" onClick={() => updateDevice(i, { installments: d.installments.filter((_, xi) => xi !== n) })}
                                          className="mr-auto rounded p-1 text-rose-400 hover:bg-rose-50"><Trash2 className="h-3.5 w-3.5" /></button>
                                      </div>
                                    ))}
                                    <div className="flex justify-between border-t border-slate-200 pt-1 text-xs font-black text-slate-700">
                                      <span>مجموع الأقساط</span>
                                      <span>{d.installments.reduce((s, x) => s + (Number(x.amountSyp) || 0), 0).toLocaleString('ar-SY')} ل.س</span>
                                    </div>
                                  </div>
                                ) : (
                                  <p className="text-[11px] text-slate-400">لم تُولّد أقساط بعد.</p>
                                )}
                              </div>
                            )}
                          </div>
                        </section>

                        {/* ── بطاقة الحالة الفنية ─────────────────────── */}
                        <section className="rounded-xl border border-sky-200 bg-white">
                          <header className="flex items-center gap-2 border-b border-sky-100 bg-sky-50/60 px-3 py-2">
                            <Wrench className="h-4 w-4 text-sky-600" />
                            <span className="text-xs font-black text-sky-800">الحالة الفنية المرجعية (خط الأساس)</span>
                          </header>
                          <div className="p-3">
                            <TechnicalStateFields value={d.reading} onChange={(next) => updateDevice(i, { reading: next })} />
                          </div>
                        </section>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}

          {(mode === 'later' || mode === 'reject') && (
            <div className="space-y-3">
              <label className="block space-y-1.5">
                <span className="text-xs font-bold text-slate-500">{mode === 'later' ? 'سبب التفعيل لاحقاً *' : 'سبب الرفض *'}</span>
                <Select
                  value={reason}
                  onChange={setReason}
                  className="w-full"
                  placeholder="— اختر —"
                  options={(mode === 'later' ? laterReasons : rejectReasons).map((r: any) => ({ value: r.value, label: r.value }))}
                />
              </label>
              {mode === 'later' && (
                <label className="block space-y-1.5">
                  <span className="text-xs font-bold text-slate-500">التاريخ المتوقع *</span>
                  <input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" />
                </label>
              )}
            </div>
          )}

          <label className="block space-y-1.5">
            <span className="text-xs font-bold text-slate-500">ملاحظات</span>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm" />
          </label>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4">
          <button onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50">إلغاء</button>
          <button onClick={submit} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-bold text-white hover:bg-amber-500 disabled:opacity-60">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {mode === 'activate' ? 'تفعيل وتسليم الوصل' : mode === 'later' ? 'حفظ (تفعيل لاحقاً)' : 'حفظ (رفض)'}
          </button>
        </div>
      </div>
    </div>
  );
}
