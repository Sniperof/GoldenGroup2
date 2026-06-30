// ============================================================
// GoldenWarrantyCardCreateModal — creates ONE card-delivery task combining the
// customer's active golden warranties (cards). DEC-CT-17.
// Posts api.openTasks.create with installedDeviceIds (devices with an active
// golden warranty). Creation reason folded into notes.
// ============================================================
import { useEffect, useMemo, useState } from 'react';
import { CreditCard, Loader2 } from 'lucide-react';
import { api } from '../../lib/api';
import Select from '../../components/ui/Select';
import DateField from '../../components/ui/DateField';
import Modal from '../../components/ui/Modal';

interface CardPick { id: number; label: string; selected: boolean; }

export default function GoldenWarrantyCardCreateModal({
  customerId, branchId, onClose, onSaved,
}: { customerId: number; branchId?: number | null; onClose: () => void; onSaved: () => void; }) {
  const today = new Date().toISOString().slice(0, 10);
  const [cards, setCards] = useState<CardPick[]>([]);
  const [dueDate, setDueDate] = useState(today);
  const [reasons, setReasons] = useState<any[]>([]);
  const [reason, setReason] = useState('');
  const [priority, setPriority] = useState('low');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.installedDevices.list({ customerId, ...(branchId ? { branchId } : {}) })
      .then((rows: any[]) => {
        const list = (Array.isArray(rows) ? rows : [])
          .filter((d) => {
            const end = d.goldenWarrantyEndDate ?? d.golden_warranty_end_date ?? null;
            return !!end && String(end) >= today; // has an active golden warranty (a card)
          })
          .map((d) => ({
            id: d.id,
            label: `${d.deviceModelName ?? d.device_model_name ?? 'جهاز'} — ${d.serialNumber ?? d.serial_number ?? `#${d.id}`}`,
            selected: true,
          }));
        setCards(list);
      })
      .catch(() => setCards([]));
    api.systemLists.getItemsByCode('golden_card_creation_reasons').then((r: any) => setReasons(Array.isArray(r) ? r : [])).catch(() => {});
  }, [customerId, branchId]);

  const selectedIds = useMemo(() => cards.filter((c) => c.selected).map((c) => c.id), [cards]);
  const toggle = (id: number) => setCards((p) => p.map((c) => (c.id === id ? { ...c, selected: !c.selected } : c)));

  async function submit() {
    setError('');
    if (selectedIds.length === 0) { setError('اختر كفالة واحدة على الأقل لتسليم كرتها'); return; }
    if (!dueDate) { setError('التاريخ المطلوب مطلوب'); return; }
    setSaving(true);
    try {
      await api.openTasks.create({
        clientId: customerId,
        branchId: branchId ?? undefined,
        taskType: 'golden_warranty_card_delivery',
        taskFamily: 'warranty',
        reason: 'golden_warranty_card_delivery',
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
      setError(e?.message ?? 'فشل إنشاء مهمة التسليم');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      isOpen
      onClose={onClose}
      size="2xl"
      title={<span className="flex items-center gap-2"><CreditCard className="h-5 w-5 text-amber-600" />إنشاء تسليم كرت كفالة ذهبية</span>}
      footer={
        <>
          <button onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50">إلغاء</button>
          <button onClick={submit} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-bold text-white hover:bg-amber-500 disabled:opacity-60">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}إنشاء مهمة التسليم</button>
        </>
      }
    >
        <div className="space-y-4 px-5 py-4">
          {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
          <div>
            <div className="text-xs font-bold text-slate-500 mb-1">الكفالات الذهبية الفعّالة (الكروت)</div>
            <div className="rounded-lg border border-slate-200 p-2">
              {cards.length === 0 && <p className="text-sm text-slate-400 px-1 py-2">لا كفالات ذهبية فعّالة لهذا الزبون.</p>}
              {cards.map((c) => (
                <label key={c.id} className="flex items-center gap-2 px-1 py-1.5 text-sm">
                  <input type="checkbox" checked={c.selected} onChange={() => toggle(c.id)} /><span>{c.label}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1.5 block"><span className="text-xs font-bold text-slate-500">التاريخ المطلوب *</span>
              <DateField value={dueDate} onChange={setDueDate} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" /></label>
            <label className="space-y-1.5 block"><span className="text-xs font-bold text-slate-500">الأولوية</span>
              <Select
                value={priority}
                onChange={setPriority}
                className="w-full"
                options={[
                  { value: 'high', label: 'عالية' },
                  { value: 'medium', label: 'متوسطة' },
                  { value: 'low', label: 'منخفضة' },
                ]}
              /></label>
            <label className="space-y-1.5 block col-span-2"><span className="text-xs font-bold text-slate-500">سبب الإنشاء</span>
              <Select
                value={reason}
                onChange={setReason}
                className="w-full"
                placeholder="— اختر —"
                options={reasons.map((r: any) => ({ value: r.value, label: r.value }))}
              /></label>
            <label className="space-y-1.5 block col-span-2"><span className="text-xs font-bold text-slate-500">ملاحظات</span>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm" /></label>
          </div>
        </div>
    </Modal>
  );
}
