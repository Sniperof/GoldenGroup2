import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Loader2, Plus, X } from 'lucide-react';
import { api } from '../../lib/api';
import Modal from '../ui/Modal';
import Select from '../ui/Select';

// «الفريق الرديف» (DEC-020, generalized by DEC-026): replace one or more
// travelling members of a scheduled visit's crew, or pick a whole team of the
// day of the same type. Slots come from the visit's team type; callers stay
// with the team and are not edited here.

type CrewSlots = Record<string, number[]>;

interface SlotDef {
  slotKey: string;
  label: string;
  slotFunction: 'lead' | 'field';
  minMembers: number;
  maxMembers: number | null;
  roleIds: number[];
}

interface Options {
  teamTypeName: string;
  slots: SlotDef[];
  original: CrewSlots;
  current: CrewSlots;
  names: Record<string, string>;
  candidates: Array<{ id: number; name: string; roleId: number; busyVisitId: number | null }>;
  dayTeams: Array<{ teamKey: string; label: string; slots: CrewSlots }>;
  reasons: Array<{ id: number; label: string }>;
}

const sameIds = (a: number[] = [], b: number[] = []) =>
  a.length === b.length && [...a].sort().every((id, i) => id === [...b].sort()[i]);

export default function ReassignTeamModal({
  open,
  visitId,
  onClose,
  onDone,
}: {
  open: boolean;
  visitId: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const [options, setOptions] = useState<Options | null>(null);
  const [crew, setCrew] = useState<CrewSlots>({});
  const [teamKey, setTeamKey] = useState<string | null>(null);
  const [reasonId, setReasonId] = useState('');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setError('');
    setReasonId('');
    setNote('');
    setTeamKey(null);
    setLoading(true);
    api.fieldVisits.reassignTeamOptions(visitId)
      .then((data: Options) => {
        setOptions(data);
        setCrew(data.current);
      })
      .catch((err: any) => setError(err?.message ?? 'تعذر تحميل خيارات تغيير الفريق'))
      .finally(() => setLoading(false));
  }, [open, visitId]);

  const nameOf = (id: number) =>
    options?.names?.[String(id)] ?? options?.candidates.find((c) => c.id === id)?.name ?? `#${id}`;

  const changedSlots = useMemo(
    () => (options ? options.slots.filter(slot => !sameIds(crew[slot.slotKey], options.current[slot.slotKey])).map(s => s.slotKey) : []),
    [options, crew],
  );

  const takenIds = useMemo(() => new Set(Object.values(crew).flat()), [crew]);

  const slotOptions = (slot: SlotDef, selected: number | null) => {
    if (!options) return [];
    const currentIds = options.current[slot.slotKey] ?? [];
    const list = options.candidates
      .filter((c) => slot.roleIds.includes(c.roleId))
      .filter((c) => c.id === selected || !takenIds.has(c.id))
      .map((c) => {
        const isCurrent = currentIds.includes(c.id);
        const busy = c.busyVisitId != null && !isCurrent;
        return {
          value: String(c.id),
          label: `${c.name}${isCurrent ? ' (الحالي)' : ''}${busy ? ` — مشغول بزيارة #${c.busyVisitId}` : ''}`,
          disabled: busy,
        };
      });
    if (selected != null && !list.some((o) => o.value === String(selected))) {
      list.unshift({ value: String(selected), label: `${nameOf(selected)} (الحالي)`, disabled: false });
    }
    return list;
  };

  const setMember = (slotKey: string, position: number, value: string) => {
    setTeamKey(null);
    setCrew((prev) => {
      const ids = [...(prev[slotKey] ?? [])];
      ids[position] = Number(value);
      return { ...prev, [slotKey]: ids };
    });
  };

  const addPosition = (slot: SlotDef) => {
    const free = options?.candidates.find(c => slot.roleIds.includes(c.roleId) && !takenIds.has(c.id) && c.busyVisitId == null);
    if (!free) return;
    setTeamKey(null);
    setCrew(prev => ({ ...prev, [slot.slotKey]: [...(prev[slot.slotKey] ?? []), free.id] }));
  };

  const removePosition = (slotKey: string, position: number) => {
    setTeamKey(null);
    setCrew(prev => ({ ...prev, [slotKey]: (prev[slotKey] ?? []).filter((_, i) => i !== position) }));
  };

  const pickDayTeam = (key: string) => {
    const team = options?.dayTeams.find((t) => t.teamKey === key);
    if (!team) return;
    setCrew(team.slots);
    setTeamKey(key);
  };

  const dayTeamLabel = (t: Options['dayTeams'][number]) => {
    const people = (options?.slots ?? [])
      .filter(slot => t.slots[slot.slotKey]?.length)
      .map(slot => `${slot.label}: ${t.slots[slot.slotKey]!.map(nameOf).join('، ')}`)
      .join(' · ');
    return `${t.label}${people ? ` — ${people}` : ''}`;
  };

  const submit = async () => {
    if (!options) return;
    if (changedSlots.length === 0) {
      setError('لم يتم تغيير أي عضو في الفريق.');
      return;
    }
    if (!reasonId) {
      setError('يرجى اختيار سبب تغيير الفريق.');
      return;
    }
    setError('');
    setSaving(true);
    try {
      const slots: CrewSlots = {};
      for (const slot of options.slots) slots[slot.slotKey] = (crew[slot.slotKey] ?? []).filter(Boolean);
      await api.fieldVisits.reassignTeam(visitId, {
        slots,
        teamKey,
        reasonId: Number(reasonId),
        note: note.trim() || null,
      });
      onDone();
    } catch (err: any) {
      setError(err?.message ?? 'فشل تغيير الفريق');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={open}
      onClose={saving ? () => undefined : onClose}
      title="تغيير فريق الزيارة"
      subtitle="الفريق الجديد يصبح «الفريق الرديف» المسؤول عن الزيارة، ويبقى الفريق الأصلي محفوظاً في السجل."
      footer={
        <div className="flex w-full justify-end gap-2">
          <button type="button" onClick={onClose} disabled={saving}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-bold text-slate-600 disabled:opacity-50">
            رجوع
          </button>
          <button type="button" onClick={submit} disabled={saving || loading || !options || changedSlots.length === 0 || !reasonId}
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            تأكيد تغيير الفريق
          </button>
        </div>
      }
    >
      <div className="space-y-4 p-5">
        {error ? (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        ) : null}

        {loading || !options ? (
          <div className="flex items-center justify-center py-8 text-slate-400">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : (
          <>
            <p className="text-xs text-slate-500">نوع الفريق: <span className="font-bold text-slate-700">{options.teamTypeName}</span></p>

            {options.dayTeams.length > 0 ? (
              <label className="block">
                <span className="mb-2 block text-sm font-bold text-slate-700">اختيار فريق كامل من جدول اليوم (اختياري)</span>
                <Select
                  value={teamKey ?? ''}
                  onChange={pickDayTeam}
                  placeholder="أو بدّل الأعضاء واحداً واحداً أدناه"
                  ariaLabel="فريق من جدول اليوم"
                  options={options.dayTeams.map((t) => ({ value: t.teamKey, label: dayTeamLabel(t) }))}
                />
              </label>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2">
              {options.slots.map((slot) => {
                const ids = crew[slot.slotKey] ?? [];
                const originalCount = options.original[slot.slotKey]?.length ?? 0;
                const floor = Math.max(slot.minMembers, originalCount > 0 ? 1 : 0);
                const canAdd = slot.maxMembers == null || ids.length < slot.maxMembers;
                return (
                  <div key={slot.slotKey} className="block">
                    <span className="mb-2 block text-sm font-bold text-slate-700">
                      {slot.label}
                      {changedSlots.includes(slot.slotKey) ? <span className="mr-1 text-xs font-bold text-indigo-600">· سيتغيّر</span> : null}
                    </span>
                    <div className="space-y-2">
                      {ids.map((id, position) => (
                        <div key={`${slot.slotKey}-${position}`} className="flex items-center gap-2">
                          <div className="flex-1">
                            <Select
                              value={String(id)}
                              onChange={(value) => setMember(slot.slotKey, position, value)}
                              disabled={saving}
                              placeholder={`اختر ${slot.label}`}
                              ariaLabel={slot.label}
                              options={slotOptions(slot, id)}
                            />
                          </div>
                          {ids.length > floor && (
                            <button type="button" onClick={() => removePosition(slot.slotKey, position)} className="text-slate-400 hover:text-red-500" aria-label="إزالة">
                              <X className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      ))}
                      {canAdd && slot.slotFunction === 'field' && (
                        <button type="button" onClick={() => addPosition(slot)} disabled={saving}
                          className="inline-flex items-center gap-1 rounded-lg border border-dashed border-slate-300 px-2.5 py-1 text-xs text-slate-500 hover:border-indigo-300">
                          <Plus className="h-3 w-3" /> إضافة إلى {slot.label}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <label className="block">
              <span className="mb-2 block text-sm font-bold text-slate-700">سبب التغيير</span>
              <Select
                value={reasonId}
                onChange={setReasonId}
                disabled={saving}
                placeholder="اختر السبب"
                ariaLabel="سبب تغيير الفريق"
                options={options.reasons.map((r) => ({ value: String(r.id), label: r.label }))}
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-bold text-slate-700">ملاحظة اختيارية</span>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} disabled={saving} rows={2}
                className="w-full rounded-lg border border-slate-200 p-3 text-sm outline-none focus:border-indigo-400" />
            </label>
          </>
        )}
      </div>
    </Modal>
  );
}
