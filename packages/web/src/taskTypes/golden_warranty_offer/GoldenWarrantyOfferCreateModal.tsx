// ============================================================
// GoldenWarrantyOfferCreateModal — creates ONE golden-warranty offer task that
// targets the customer's chosen golden-eligible devices. DEC-CT-17.
// Creation reason is folded into notes (open_tasks.reason stays the validated
// 'golden_warranty_offer'). Posts api.openTasks.create with installedDeviceIds.
// ============================================================
import { useEffect, useMemo, useState } from 'react';
import { Award, Loader2, X } from 'lucide-react';
import { api } from '../../lib/api';

interface DevicePick { id: number; label: string; hasActiveGolden: boolean; selected: boolean; }

export default function GoldenWarrantyOfferCreateModal({
  customerId, branchId, onClose, onSaved,
}: { customerId: number; branchId?: number | null; onClose: () => void; onSaved: () => void; }) {
  const today = new Date().toISOString().slice(0, 10);
  const [devices, setDevices] = useState<DevicePick[]>([]);
  const [dueDate, setDueDate] = useState(today);
  const [reasons, setReasons] = useState<any[]>([]);
  const [reason, setReason] = useState('');
  const [priority, setPriority] = useState('medium');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.installedDevices.list({ customerId, ...(branchId ? { branchId } : {}) })
      .then((rows: any[]) => {
        const list = (Array.isArray(rows) ? rows : []).map((d) => {
          const end = d.goldenWarrantyEndDate ?? d.golden_warranty_end_date ?? null;
          const hasActiveGolden = !!end && String(end) >= today;
          return {
            id: d.id,
            label: `${d.deviceModelName ?? d.device_model_name ?? 'جهاز'} — ${d.serialNumber ?? d.serial_number ?? `#${d.id}`}`,
            hasActiveGolden,
            selected: !hasActiveGolden,
          };
        });
        // Auto-select when exactly one eligible device.
        const eligible = list.filter((d) => !d.hasActiveGolden);
        setDevices(list.map((d) => ({ ...d, selected: eligible.length === 1 ? !d.hasActiveGolden : d.selected })));
      })
      .catch(() => setDevices([]));
    api.systemLists.getItemsByCode('golden_offer_creation_reasons').then((r: any) => setReasons(Array.isArray(r) ? r : [])).catch(() => {});
  }, [customerId, branchId]);

  const selectedIds = useMemo(() => devices.filter((d) => d.selected && !d.hasActiveGolden).map((d) => d.id), [devices]);
  const toggle = (id: number) => setDevices((p) => p.map((d) => (d.id === id ? { ...d, selected: !d.selected } : d)));

  async function submit() {
    setError('');
    if (selectedIds.length === 0) { setError('اختر جهازاً مؤهَّلاً واحداً على الأقل'); return; }
    if (!dueDate) { setError('التاريخ المطلوب مطلوب'); return; }
    setSaving(true);
    try {
      await api.openTasks.create({
        clientId: customerId,
        branchId: branchId ?? undefined,
        taskType: 'golden_warranty_offer',
        taskFamily: 'warranty',
        reason: 'golden_warranty_offer',
        creationReason: reason || null,
        dueDate,
        priority,
        notes: notes.trim() || null,
        installedDeviceId: selectedIds[0],
        installedDeviceIds: selectedIds,
        creationOrigin: 'manual_creation',
      });
      onSaved();
    } catch (e: any) {
      setError(e?.message ?? 'فشل إنشاء مهمة العرض');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" dir="rtl">
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-amber-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-amber-200 bg-amber-50 px-5 py-4">
          <div className="flex items-center gap-2"><Award className="h-5 w-5 text-amber-600" /><h2 className="text-base font-black text-amber-900">إنشاء عرض كفالة ذهبية</h2></div>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-white hover:text-slate-700"><X className="h-5 w-5" /></button>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
          <div>
            <div className="text-xs font-bold text-slate-500 mb-1">الأجهزة المؤهَّلة (اختيار متعدد)</div>
            <div className="rounded-lg border border-slate-200 p-2">
              {devices.length === 0 && <p className="text-sm text-slate-400 px-1 py-2">لا أجهزة لهذا الزبون.</p>}
              {devices.map((d) => (
                <label key={d.id} className={`flex items-center gap-2 px-1 py-1.5 text-sm ${d.hasActiveGolden ? 'opacity-60' : ''}`}>
                  <input type="checkbox" checked={d.selected} disabled={d.hasActiveGolden} onChange={() => toggle(d.id)} />
                  <span>{d.label}</span>
                  {d.hasActiveGolden && <span className="text-xs text-amber-700">كفالة ذهبية فعّالة</span>}
                </label>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1.5 block"><span className="text-xs font-bold text-slate-500">التاريخ المطلوب *</span>
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" /></label>
            <label className="space-y-1.5 block"><span className="text-xs font-bold text-slate-500">الأولوية</span>
              <select value={priority} onChange={(e) => setPriority(e.target.value)} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                <option value="high">عالية</option><option value="medium">متوسطة</option><option value="low">منخفضة</option></select></label>
            <label className="space-y-1.5 block col-span-2"><span className="text-xs font-bold text-slate-500">سبب الإنشاء</span>
              <select value={reason} onChange={(e) => setReason(e.target.value)} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                <option value="">— اختر —</option>{reasons.map((r: any) => <option key={r.id} value={r.value}>{r.value}</option>)}</select></label>
            <label className="space-y-1.5 block col-span-2"><span className="text-xs font-bold text-slate-500">ملاحظات</span>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm" /></label>
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4">
          <button onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50">إلغاء</button>
          <button onClick={submit} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-bold text-white hover:bg-amber-500 disabled:opacity-60">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}إنشاء مهمة العرض</button>
        </div>
      </div>
    </div>
  );
}
