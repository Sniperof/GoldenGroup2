import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { api } from '../../lib/api';
import Modal from '../ui/Modal';
import Select from '../ui/Select';

// «الفريق الرديف» (migration 478): replace one or more members of a scheduled
// visit's crew, or pick a whole team of the day. The reason comes from the
// managed list `visit_team_change_reasons`.

type Role = 'supervisor' | 'technician' | 'trainee';
type Members = Record<Role, number | null>;

const ROLE_LABELS: Record<Role, string> = { supervisor: 'المشرف', technician: 'الفني', trainee: 'المتدرّب' };
const NO_TRAINEE = '__none__';

interface Options {
  kind: 'team' | 'solo';
  original: Members;
  current: Members;
  names: Record<string, string>;
  candidates: Array<{ id: number; name: string; role: Role; busyVisitId: number | null }>;
  dayTeams: Array<{ teamKey: string; members: Members }>;
  reasons: Array<{ id: number; label: string }>;
}

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
  const [members, setMembers] = useState<Members>({ supervisor: null, technician: null, trainee: null });
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
        setMembers(data.current);
      })
      .catch((err: any) => setError(err?.message ?? 'تعذر تحميل خيارات تغيير الفريق'))
      .finally(() => setLoading(false));
  }, [open, visitId]);

  const roles: Role[] = options?.kind === 'solo' ? ['technician', 'trainee'] : ['supervisor', 'technician', 'trainee'];

  const nameOf = (id: number | null) => {
    if (id == null) return '—';
    return options?.names?.[String(id)]
      ?? options?.candidates.find((c) => c.id === id)?.name
      ?? `#${id}`;
  };

  const changedRoles = useMemo(
    () => (options ? roles.filter((role) => members[role] !== options.current[role]) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [options, members],
  );

  const roleOptions = (role: Role) => {
    if (!options) return [];
    const list = options.candidates
      .filter((c) => c.role === role)
      .map((c) => {
        const isCurrent = c.id === options.current[role];
        const busy = c.busyVisitId != null && !isCurrent;
        return {
          value: String(c.id),
          label: `${c.name}${isCurrent ? ' (الحالي)' : ''}${busy ? ` — مشغول بزيارة #${c.busyVisitId}` : ''}`,
          disabled: busy,
        };
      });
    const currentId = options.current[role];
    if (currentId != null && !list.some((o) => o.value === String(currentId))) {
      list.unshift({ value: String(currentId), label: `${nameOf(currentId)} (الحالي)`, disabled: false });
    }
    // A role present in the original crew can be replaced but not emptied.
    if (role === 'trainee' && options.original.trainee == null) {
      list.unshift({ value: NO_TRAINEE, label: 'بدون متدرّب', disabled: false });
    }
    return list;
  };

  const setRole = (role: Role, value: string) => {
    setTeamKey(null);
    setMembers((prev) => ({ ...prev, [role]: value === NO_TRAINEE ? null : Number(value) }));
  };

  const pickDayTeam = (key: string) => {
    const team = options?.dayTeams.find((t) => t.teamKey === key);
    if (!team) return;
    setMembers({
      supervisor: options?.kind === 'solo' ? null : team.members.supervisor,
      technician: team.members.technician,
      trainee: team.members.trainee,
    });
    setTeamKey(key);
  };

  const dayTeamLabel = (t: { teamKey: string; members: Members }) => {
    const index = Number(t.teamKey.split('_')[1]) + 1;
    const people = roles
      .filter((r) => t.members[r] != null)
      .map((r) => `${ROLE_LABELS[r]}: ${nameOf(t.members[r])}`)
      .join(' · ');
    return `${options?.kind === 'solo' ? 'فريق طوارئ' : 'فريق'} ${index}${people ? ` — ${people}` : ''}`;
  };

  const submit = async () => {
    if (!options) return;
    if (changedRoles.length === 0) {
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
      await api.fieldVisits.reassignTeam(visitId, {
        supervisorEmployeeId: members.supervisor,
        technicianEmployeeId: members.technician,
        traineeEmployeeId: members.trainee,
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
          <button type="button" onClick={submit} disabled={saving || loading || !options || changedRoles.length === 0 || !reasonId}
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

            <div className="grid gap-3 sm:grid-cols-3">
              {roles.map((role) => (
                <label key={role} className="block">
                  <span className="mb-2 block text-sm font-bold text-slate-700">
                    {ROLE_LABELS[role]}
                    {changedRoles.includes(role) ? <span className="mr-1 text-xs font-bold text-indigo-600">· سيتغيّر</span> : null}
                  </span>
                  <Select
                    value={members[role] == null ? (role === 'trainee' ? NO_TRAINEE : '') : String(members[role])}
                    onChange={(value) => setRole(role, value)}
                    disabled={saving}
                    placeholder={`اختر ${ROLE_LABELS[role]}`}
                    ariaLabel={ROLE_LABELS[role]}
                    options={roleOptions(role)}
                  />
                </label>
              ))}
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
