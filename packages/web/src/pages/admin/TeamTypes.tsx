import { useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Users, Plus, Save, Loader2, AlertTriangle, X, UserCheck, User, PhoneCall, ShieldCheck } from '../../components/ui/icons';
import { api } from '../../lib/api';
import { useAuthStore } from '../../hooks/useAuthStore';
import PageHeader from '../../components/ui/PageHeader';
import Modal from '../../components/ui/Modal';
import Checkbox from '../../components/ui/Checkbox';
import IconButton from '../../components/ui/IconButton';
import { OPEN_TASK_FAMILY_LABELS, type TeamSlotFunction, type TeamTypeDef, type TeamTypeSlotDef } from '@golden-crm/shared';

// DEC-026 — company-wide catalog of team types. A type is a set of slots
// (one lead, any number of field and caller slots), the roles each slot
// accepts, and the task types the type may be assigned.

type Options = Awaited<ReturnType<typeof api.teamTypes.options>>;

type DraftSlot = Omit<TeamTypeSlotDef, 'maxMembers' | 'minMembers'> & {
  minMembers: string;
  maxMembers: string;
  /** Saved before: its function can no longer change. */
  persisted: boolean;
};

type Draft = {
  id: number | null;
  isSystem: boolean;
  name: string;
  description: string;
  slots: DraftSlot[];
  taskTypes: string[];
};

const FUNCTION_LABELS: Record<TeamSlotFunction, string> = {
  lead: 'رئيس الفريق',
  field: 'ميداني',
  caller: 'اتصال',
};

const FUNCTION_HINTS: Record<TeamSlotFunction, string> = {
  lead: 'شخص واحد، إلزامي. ينزل إلى الزيارة، ويُسمّى الفريق باسمه، وزبائنه الشخصيون يدخلون حمل الفريق.',
  field: 'ينزل إلى الزيارة. يمكن أن تدخل زبائنه الشخصيون حمل الفريق.',
  caller: 'يستلم كشف الاتصال ولا ينزل إلى الزيارة. لا يملك زبائن في الحمل.',
};

function FunctionIcon({ fn, className }: { fn: TeamSlotFunction; className?: string }) {
  if (fn === 'lead') return <UserCheck className={className} />;
  if (fn === 'caller') return <PhoneCall className={className} />;
  return <User className={className} />;
}

function toDraft(type: TeamTypeDef | null): Draft {
  if (!type) {
    return {
      id: null,
      isSystem: false,
      name: '',
      description: '',
      slots: [{ slotKey: '', label: 'رئيس الفريق', slotFunction: 'lead', countsOwnership: true, minMembers: '1', maxMembers: '1', roleIds: [], persisted: false }],
      taskTypes: [],
    };
  }
  return {
    id: type.id,
    isSystem: type.isSystem,
    name: type.name,
    description: type.description ?? '',
    slots: type.slots.map(slot => ({
      ...slot,
      minMembers: String(slot.minMembers),
      maxMembers: slot.maxMembers == null ? '' : String(slot.maxMembers),
      persisted: true,
    })),
    taskTypes: [...type.taskTypes],
  };
}

function toPayload(draft: Draft) {
  return {
    name: draft.name,
    description: draft.description || null,
    slots: draft.slots.map(slot => ({
      slotKey: slot.slotKey || undefined,
      label: slot.label,
      slotFunction: slot.slotFunction,
      countsOwnership: slot.countsOwnership,
      minMembers: slot.minMembers === '' ? 0 : Number(slot.minMembers),
      maxMembers: slot.maxMembers === '' ? null : Number(slot.maxMembers),
      roleIds: slot.roleIds,
    })),
    taskTypes: draft.taskTypes,
  };
}

export default function TeamTypes() {
  const { user, hasPermission } = useAuthStore();
  const canManage = user?.isSuperAdmin === true || hasPermission('planning.team_types.manage');

  const [types, setTypes] = useState<TeamTypeDef[]>([]);
  const [options, setOptions] = useState<Options | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const reload = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [list, opts] = await Promise.all([api.teamTypes.list({ includeInactive: true }), api.teamTypes.options()]);
      setTypes(list);
      setOptions(opts);
    } catch (err: any) {
      setLoadError(err?.message || 'تعذر تحميل أنواع الفرق');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (canManage) void reload(); }, [canManage]);

  const roleName = useMemo(() => new Map((options?.roles ?? []).map(r => [r.id, r.displayName])), [options]);
  const taskLabel = useMemo(() => new Map((options?.taskTypes ?? []).map(t => [t.taskType, t.label])), [options]);
  const families = useMemo(() => {
    const byFamily = new Map<string, Options['taskTypes']>();
    for (const t of options?.taskTypes ?? []) {
      const list = byFamily.get(t.taskFamily) ?? [];
      list.push(t);
      byFamily.set(t.taskFamily, list);
    }
    return [...byFamily.entries()];
  }, [options]);

  if (!canManage) return <Navigate to="/" replace />;

  const updateSlot = (index: number, change: Partial<DraftSlot>) =>
    setDraft(d => d && ({ ...d, slots: d.slots.map((s, i) => (i === index ? { ...s, ...change } : s)) }));

  const addSlot = (fn: TeamSlotFunction) =>
    setDraft(d => d && ({
      ...d,
      slots: [...d.slots, {
        slotKey: '',
        label: fn === 'caller' ? 'مسوقون' : 'خانة ميدانية',
        slotFunction: fn,
        countsOwnership: false,
        minMembers: '0',
        maxMembers: fn === 'caller' ? '' : '1',
        roleIds: [],
        persisted: false,
      }],
    }));

  const toggleRole = (index: number, roleId: number) => {
    const slot = draft?.slots[index];
    if (!slot) return;
    updateSlot(index, {
      roleIds: slot.roleIds.includes(roleId) ? slot.roleIds.filter(id => id !== roleId) : [...slot.roleIds, roleId],
    });
  };

  const setTaskTypes = (taskTypes: string[], on: boolean) =>
    setDraft(d => d && ({
      ...d,
      taskTypes: on ? [...new Set([...d.taskTypes, ...taskTypes])] : d.taskTypes.filter(t => !taskTypes.includes(t)),
    }));

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setSaveError(null);
    try {
      if (draft.id == null) await api.teamTypes.create(toPayload(draft));
      else await api.teamTypes.update(draft.id, toPayload(draft));
      setDraft(null);
      await reload();
    } catch (err: any) {
      setSaveError(err?.message || 'تعذر حفظ نوع الفريق');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (type: TeamTypeDef) => {
    try {
      await api.teamTypes.setActive(type.id, !type.isActive);
      await reload();
    } catch (err: any) {
      setLoadError(err?.message || 'تعذر تغيير حالة النوع');
    }
  };

  return (
    <div className="h-full overflow-y-auto p-8 custom-scroll">
      <PageHeader
        className="mb-6"
        title="أنواع الفرق"
        subtitle="أنواع على مستوى الشركة: خانات كل نوع، والأدوار المقبولة فيها، والمهام التي يستلمها. كل فرع يختار منها ما يجدول به."
        actions={
          <button type="button" onClick={() => { setSaveError(null); setDraft(toDraft(null)); }} className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-2 text-xs font-bold text-white hover:bg-sky-500">
            <Plus className="w-3.5 h-3.5" /> نوع جديد
          </button>
        }
      />

      {loadError && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertTriangle className="w-4 h-4" /> {loadError}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-48 text-slate-400"><Loader2 className="w-5 h-5 animate-spin" /></div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {types.map(type => (
            <article key={type.id} className={`rounded-xl border bg-white shadow-sm ${type.isActive ? 'border-slate-200' : 'border-slate-200 opacity-60'}`}>
              <header className="flex items-start justify-between gap-3 border-b border-slate-100 bg-slate-50/70 p-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-100 text-sky-700"><Users className="h-5 w-5" /></div>
                  <div>
                    <h3 className="font-black text-slate-900 flex items-center gap-2">
                      {type.name}
                      {type.isSystem && <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-indigo-600"><ShieldCheck className="w-3 h-3" /> أساسي</span>}
                      {!type.isActive && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">معطّل</span>}
                    </h3>
                    {type.description && <p className="text-xs text-slate-500 mt-0.5">{type.description}</p>}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {!type.isSystem && (
                    <button type="button" onClick={() => toggleActive(type)} className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50">
                      {type.isActive ? 'تعطيل' : 'تفعيل'}
                    </button>
                  )}
                  <button type="button" onClick={() => { setSaveError(null); setDraft(toDraft(type)); }} className="rounded-lg bg-sky-600 px-2.5 py-1 text-xs font-bold text-white hover:bg-sky-500">تعديل</button>
                </div>
              </header>
              <div className="p-4 space-y-3">
                <div className="flex flex-wrap gap-2">
                  {type.slots.map(slot => (
                    <span key={slot.slotKey} className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-700" title={slot.roleIds.map(id => roleName.get(id) ?? `#${id}`).join('، ')}>
                      <FunctionIcon fn={slot.slotFunction} className="w-3.5 h-3.5 text-slate-400" />
                      {slot.label}
                      <span className="text-slate-400">
                        {slot.slotFunction === 'lead' ? '' : slot.maxMembers == null ? ` ${slot.minMembers}+` : ` ${slot.minMembers}–${slot.maxMembers}`}
                      </span>
                    </span>
                  ))}
                </div>
                <p className="text-xs text-slate-500">
                  المهام المسموحة ({type.taskTypes.length}): {type.taskTypes.slice(0, 6).map(t => taskLabel.get(t) ?? t).join('، ')}{type.taskTypes.length > 6 ? '…' : ''}
                </p>
              </div>
            </article>
          ))}
        </div>
      )}

      <Modal
        isOpen={draft != null}
        onClose={() => !saving && setDraft(null)}
        title={draft?.id == null ? 'نوع فريق جديد' : `تعديل: ${draft?.name ?? ''}`}
        size="4xl"
        footer={
          <div className="flex items-center gap-3 w-full">
            {saveError && <span className="text-sm text-red-600 flex items-center gap-1"><AlertTriangle className="w-4 h-4" />{saveError}</span>}
            <button type="button" disabled={saving} onClick={save} className="mr-auto inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-500 disabled:opacity-60">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} حفظ
            </button>
          </div>
        }
      >
        {draft && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-3">
              <label className="text-sm">
                <span className="block text-xs font-bold text-slate-500 mb-1">الاسم</span>
                <input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none" />
              </label>
              <label className="text-sm">
                <span className="block text-xs font-bold text-slate-500 mb-1">الوصف</span>
                <input value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none" />
              </label>
            </div>

            <section>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-black text-slate-800">الخانات</h4>
                <div className="flex gap-2">
                  <button type="button" onClick={() => addSlot('field')} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50"><Plus className="w-3 h-3" /> خانة ميدانية</button>
                  <button type="button" onClick={() => addSlot('caller')} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50"><Plus className="w-3 h-3" /> خانة اتصال</button>
                </div>
              </div>
              <div className="space-y-3">
                {draft.slots.map((slot, index) => (
                  <div key={slot.slotKey || `new-${index}`} className="rounded-lg border border-slate-200 p-3">
                    <div className="flex items-center gap-3 flex-wrap">
                      <FunctionIcon fn={slot.slotFunction} className="w-4 h-4 text-slate-400" />
                      <input value={slot.label} onChange={e => updateSlot(index, { label: e.target.value })} className="w-40 rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:border-sky-500 focus:outline-none" />
                      <select
                        value={slot.slotFunction}
                        disabled={slot.persisted || slot.slotFunction === 'lead'}
                        onChange={e => updateSlot(index, { slotFunction: e.target.value as TeamSlotFunction, countsOwnership: false })}
                        className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm disabled:bg-slate-50"
                      >
                        {(slot.slotFunction === 'lead' ? ['lead'] : ['field', 'caller']).map(fn => (
                          <option key={fn} value={fn}>{FUNCTION_LABELS[fn as TeamSlotFunction]}</option>
                        ))}
                      </select>
                      {slot.slotFunction !== 'lead' && (
                        <>
                          <label className="flex items-center gap-1 text-xs text-slate-500">من
                            <input type="number" min={0} value={slot.minMembers} onChange={e => updateSlot(index, { minMembers: e.target.value })} className="w-14 rounded border border-slate-200 px-1.5 py-1 text-sm" />
                          </label>
                          <label className="flex items-center gap-1 text-xs text-slate-500">إلى
                            <input type="number" min={1} placeholder="∞" value={slot.maxMembers} onChange={e => updateSlot(index, { maxMembers: e.target.value })} className="w-14 rounded border border-slate-200 px-1.5 py-1 text-sm" />
                          </label>
                        </>
                      )}
                      {slot.slotFunction === 'field' && (
                        <Checkbox size="sm" checked={slot.countsOwnership} onCheckedChange={v => updateSlot(index, { countsOwnership: v })}>
                          <span className="text-xs text-slate-600">زبائنه يدخلون الحمل</span>
                        </Checkbox>
                      )}
                      {slot.slotFunction !== 'lead' && (
                        <IconButton icon={X} label="حذف الخانة" variant="danger" size="sm" className="mr-auto"
                          onClick={() => setDraft({ ...draft, slots: draft.slots.filter((_, i) => i !== index) })} />
                      )}
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1">{FUNCTION_HINTS[slot.slotFunction]}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {(options?.roles ?? []).map(role => {
                        const on = slot.roleIds.includes(role.id);
                        return (
                          <button key={role.id} type="button" onClick={() => toggleRole(index, role.id)}
                            className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${on ? 'border-sky-500 bg-sky-50 text-sky-700 font-bold' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}>
                            {role.displayName}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section>
              <h4 className="text-sm font-black text-slate-800 mb-1">المهام المسموحة</h4>
              <p className="text-[11px] text-slate-500 mb-2">
                الفريق لا يأخذ زبوناً إلا إذا قدر على كل مهامه المؤهلة لذلك اليوم. الصيانة الطارئة مستثناة. نوع المهمة الجديد لا يُضاف تلقائياً.
                {draft.isSystem && ' المهام المسموحة لنوع أساسي ثابتة.'}
              </p>
              <div className="grid grid-cols-2 gap-3">
                {families.map(([family, list]) => {
                  const keys = list.map(t => t.taskType);
                  const selected = keys.filter(k => draft.taskTypes.includes(k)).length;
                  return (
                    <div key={family} className="rounded-lg border border-slate-200 p-3">
                      <Checkbox
                        size="sm"
                        disabled={draft.isSystem}
                        checked={selected === keys.length}
                        indeterminate={selected > 0 && selected < keys.length}
                        onCheckedChange={v => setTaskTypes(keys, v)}
                      >
                        <span className="text-sm font-bold text-slate-700">{(OPEN_TASK_FAMILY_LABELS as Record<string, string>)[family] ?? family}</span>
                      </Checkbox>
                      <div className="mt-2 mr-6 space-y-1">
                        {list.map(t => (
                          <Checkbox key={t.taskType} size="sm" disabled={draft.isSystem} checked={draft.taskTypes.includes(t.taskType)} onCheckedChange={v => setTaskTypes([t.taskType], v)}>
                            <span className="text-xs text-slate-600">{t.label}{!t.isActive && <span className="text-slate-400"> (معطّل)</span>}</span>
                          </Checkbox>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          </div>
        )}
      </Modal>
    </div>
  );
}
