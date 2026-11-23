import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Calendar, Users, UserCheck, Plus, User, Save, X, PhoneCall, CheckCircle, AlertCircle, LayoutGrid, ArrowLeft } from '../../components/ui/icons';
import { api } from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import IconButton from '../../components/ui/IconButton';
import DateField from '../../components/ui/DateField';
import { useBranchContextStore } from '../../hooks/useBranchContextStore';
import { isLockedTeam } from '@golden-crm/shared';
import type { DayScheduleTeam, Employee, ScheduledTeamView, TeamTypeDef, TeamTypeSlotDef } from '../../lib/types';

// DEC-026: every team has a type (its slots and allowed tasks come from the
// team types catalog) and an explicit key. Another branch's team arrives as
// `{ key, locked: true }`; it is hidden here and the server restores it from
// storage on save, so removing or adding a team never disturbs anyone else.

// Local calendar date (NOT UTC). toISOString() returns the UTC date, which is a day
// behind between local midnight and the UTC offset (01:00 in Damascus +03 is still
// "yesterday" in UTC) — that off-by-one showed 14/6 instead of 15/6.
const getPlanningDate = () => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** A team being edited. `localId` keeps React keys stable; new teams have no server key yet. */
type EditableTeam = ScheduledTeamView & { localId: string; isNew?: boolean };
type EditorEntry = EditableTeam | (DayScheduleTeam & { locked: true; localId: string });

const STANDARD = 'standard';
const EMERGENCY = 'emergency';

function typeTheme(typeKey: string) {
    if (typeKey === EMERGENCY) return { card: 'border-orange-200', head: 'bg-orange-50 border-orange-200', icon: 'bg-orange-100 text-orange-600', button: 'border-orange-200 text-orange-600 hover:bg-orange-50' };
    if (typeKey === STANDARD) return { card: 'border-slate-200', head: 'bg-slate-50 border-slate-200', icon: 'bg-sky-100 text-sky-600', button: 'bg-sky-600 hover:bg-sky-500 text-white border-sky-600' };
    return { card: 'border-violet-200', head: 'bg-violet-50 border-violet-200', icon: 'bg-violet-100 text-violet-600', button: 'border-violet-200 text-violet-700 hover:bg-violet-50' };
}

function slotIcon(slot: TeamTypeSlotDef) {
    if (slot.slotFunction === 'lead') return UserCheck;
    if (slot.slotFunction === 'caller') return PhoneCall;
    return User;
}

let localCounter = 0;
const nextLocalId = () => `local_${++localCounter}`;

function toEditor(teams: DayScheduleTeam[]): EditorEntry[] {
    return teams.map(team => ({ ...team, localId: team.key || nextLocalId() } as EditorEntry));
}

export default function TeamScheduler() {
    const navigate = useNavigate();
    const [teams, setTeams] = useState<EditorEntry[]>([]);
    const [date, setDate] = useState(getPlanningDate);
    const [selectedSlot, setSelectedSlot] = useState<{ localId: string; slotKey: string } | null>(null);
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [catalog, setCatalog] = useState<TeamTypeDef[]>([]);
    const [branchTypeIds, setBranchTypeIds] = useState<number[]>([]);
    const [loading, setLoading] = useState(true);
    const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle');
    const [saveError, setSaveError] = useState<string | null>(null);
    // React to the external branch switcher (no full reload — §4).
    const branchId = useBranchContextStore(s => s.branchId);

    useEffect(() => {
        api.employees.schedulePool().then((data: Employee[]) => setEmployees(data)).catch(() => setEmployees([]));
        api.teamTypes.list().then(setCatalog).catch(() => setCatalog([]));
        api.teamTypes.branch().then(r => setBranchTypeIds(r.teamTypeIds)).catch(() => setBranchTypeIds([]));
    }, [branchId]);

    useEffect(() => {
        setLoading(true);
        api.schedules.get(date)
            .then(data => setTeams(toEditor(Array.isArray(data?.teams) ? data.teams : [])))
            .catch(() => setTeams([]))
            .finally(() => setLoading(false));
    }, [date, branchId]);

    const typeByKey = useMemo(() => new Map(catalog.map(type => [type.key, type])), [catalog]);
    const addableTypes = useMemo(
        () => catalog.filter(type => type.isActive && branchTypeIds.includes(type.id)),
        [catalog, branchTypeIds],
    );
    const employeeById = useMemo(() => new Map(employees.map(e => [e.id, e])), [employees]);

    const ownTeams = teams.filter((t): t is EditableTeam => !isLockedTeam(t));
    const assignedIds = new Set(ownTeams.flatMap(t => Object.values(t.members).flat()));
    const poolEmployees = employees.filter(e => e.canAppearInSchedule === true && e.status === 'active' && !assignedIds.has(e.id));

    const selected = selectedSlot ? ownTeams.find(t => t.localId === selectedSlot.localId) : null;
    const selectedDef = selected ? typeByKey.get(selected.teamType)?.slots.find(s => s.slotKey === selectedSlot!.slotKey) ?? null : null;
    const fitsSelected = (e: Employee) => Boolean(selectedDef && e.roleId != null && selectedDef.roleIds.includes(e.roleId));

    const updateTeam = (localId: string, change: (team: EditableTeam) => EditableTeam) =>
        setTeams(list => list.map(t => (!isLockedTeam(t) && t.localId === localId ? change(t as EditableTeam) : t)));

    const addTeam = (type: TeamTypeDef) => {
        const localId = nextLocalId();
        setTeams(list => [...list, { key: '', teamType: type.key, teamTypeName: type.name, members: {}, localId, isNew: true }]);
    };

    const removeTeam = (localId: string) => {
        setTeams(list => list.filter(t => t.localId !== localId));
        if (selectedSlot?.localId === localId) setSelectedSlot(null);
    };

    const selectSlot = (localId: string, slotKey: string) =>
        setSelectedSlot(s => (s && s.localId === localId && s.slotKey === slotKey ? null : { localId, slotKey }));

    const assignEmployee = (empId: number) => {
        if (!selectedSlot || !selectedDef) return;
        const emp = employeeById.get(empId);
        if (!emp || !fitsSelected(emp)) return;
        const { slotKey } = selectedSlot;
        updateTeam(selectedSlot.localId, team => {
            const current = team.members[slotKey] ?? [];
            if (current.includes(empId)) return team;
            const next = selectedDef.maxMembers === 1
                ? [empId]
                : (selectedDef.maxMembers != null && current.length >= selectedDef.maxMembers ? current : [...current, empId]);
            return { ...team, members: { ...team.members, [slotKey]: next } };
        });
        if (selectedDef.maxMembers === 1) setSelectedSlot(null);
    };

    const unassign = (localId: string, slotKey: string, empId: number) =>
        updateTeam(localId, team => ({
            ...team,
            members: { ...team.members, [slotKey]: (team.members[slotKey] ?? []).filter(id => id !== empId) },
        }));

    const saveSchedule = async () => {
        try {
            // A new team has no key: the server gives it a fresh, never-used one.
            const payload = teams.map(t => {
                if (isLockedTeam(t)) return { key: t.key, locked: true as const };
                const team = t as EditableTeam;
                const members = Object.fromEntries(Object.entries(team.members).filter(([, ids]) => ids.length > 0));
                return team.isNew
                    ? { teamType: team.teamType, members }
                    : { key: team.key, teamType: team.teamType, members };
            });
            const saved = await api.schedules.save(date, { teams: payload });
            setTeams(toEditor(Array.isArray(saved?.teams) ? saved.teams : []));
            setSelectedSlot(null);
            setSaveStatus('success');
            setSaveError(null);
            setTimeout(() => setSaveStatus('idle'), 3000);
        } catch (err: any) {
            const msg = err?.response?.data?.error || err?.message || null;
            setSaveError(msg);
            setSaveStatus('error');
            setTimeout(() => { setSaveStatus('idle'); setSaveError(null); }, 5000);
        }
    };

    const empName = (id: number) => employeeById.get(id)?.name || `#${id}`;

    if (loading) {
        return (
            <div className="h-full overflow-y-auto p-8 custom-scroll">
                <div className="flex items-center justify-center h-64">
                    <div className="text-slate-400 text-lg">جاري التحميل...</div>
                </div>
            </div>
        );
    }

    return (
        <div className="h-full overflow-y-auto p-8 custom-scroll">
            <PageHeader
                className="mb-6"
                title="جدولة الفرق"
                subtitle="تشكيل فرق اليوم حسب أنواع الفرق المفعّلة للفرع."
                actions={
                    <button
                        type="button"
                        onClick={() => navigate('/planning/zone-map')}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-2 text-xs font-bold text-white hover:bg-sky-500"
                    >
                        <LayoutGrid className="w-3.5 h-3.5" /> دراسة النطاقات <ArrowLeft className="w-3.5 h-3.5" />
                    </button>
                }
            />

            {/* Control Bar */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 mb-6 flex items-center gap-4 flex-wrap">
                <DateField value={date} onChange={v => { setDate(v); setSelectedSlot(null); }} className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 focus:border-sky-500 focus:outline-none" />
                <div className="h-8 w-px bg-slate-200" />
                <div className="flex items-center gap-1.5 text-sm"><Users className="w-4 h-4 text-emerald-500" /><span className="text-slate-500">موظفون متاحون:</span><span className="text-slate-900 font-bold">{poolEmployees.length}</span></div>
                <div className="mr-auto flex items-center gap-2">
                    {saveStatus === 'success' && <span className="flex items-center gap-1 text-emerald-600 text-sm font-medium"><CheckCircle className="w-4 h-4" />تم الحفظ</span>}
                    {saveStatus === 'error' && <span className="flex items-center gap-1 text-red-500 text-sm font-medium"><AlertCircle className="w-4 h-4" />{saveError || 'خطأ في الحفظ'}</span>}
                    <button onClick={saveSchedule} className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg text-sm font-bold shadow-lg transition-all"><Save className="w-4 h-4" /><span>حفظ الجدول</span></button>
                </div>
            </div>

            <div className="grid grid-cols-3 gap-6">
                {/* Staff Pool */}
                <div className="col-span-1">
                    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden sticky top-0">
                        <div className="px-4 py-3 bg-slate-50 border-b border-slate-100">
                            <h3 className="text-slate-500 font-bold text-base uppercase tracking-wider flex items-center gap-2"><Users className="w-4 h-4 text-slate-400" />الموظفون المتاحون</h3>
                            {selectedDef && <p className="text-xs text-sky-600 mt-1">اختر موظفاً لخانة «{selectedDef.label}»</p>}
                        </div>
                        <div className="divide-y divide-slate-100 max-h-[60vh] overflow-y-auto custom-scroll">
                            {poolEmployees.length === 0 ? (
                                <p className="text-center text-slate-400 text-sm py-8">لا يوجد موظفون متاحون</p>
                            ) : poolEmployees.map(e => {
                                const enabled = !selectedDef || fitsSelected(e);
                                return (
                                    <motion.div
                                        key={e.id}
                                        onClick={() => assignEmployee(e.id)}
                                        className={`flex items-center gap-3 p-3 transition-all ${enabled ? 'cursor-pointer hover:bg-sky-50' : 'opacity-40 grayscale cursor-not-allowed'}`}
                                    >
                                        <div className="relative">
                                            <img src={e.avatar} alt="" className="w-9 h-9 rounded-full border border-slate-100 object-cover" />
                                            <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-white bg-emerald-500"></span>
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-medium text-slate-700 truncate">{e.name}</p>
                                            <p className="text-xs text-slate-500 truncate">{e.jobTitle || ''}</p>
                                        </div>
                                    </motion.div>
                                );
                            })}
                        </div>
                    </div>
                </div>

                {/* Teams Area */}
                <div className="col-span-2 space-y-4">
                    <div className="flex gap-2 flex-wrap">
                        {addableTypes.map(type => {
                            const theme = typeTheme(type.key);
                            return (
                                <button key={type.id} onClick={() => addTeam(type)} className={`flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-bold transition-all ${theme.button}`}>
                                    {type.key === EMERGENCY ? <AlertCircle className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                                    <span>{type.name}</span>
                                </button>
                            );
                        })}
                        {addableTypes.length === 0 && <p className="text-sm text-slate-400">لا توجد أنواع فرق مفعّلة لهذا الفرع</p>}
                    </div>

                    {ownTeams.length === 0 ? (
                        <div className="text-center text-slate-400 py-10"><Calendar className="w-10 h-10 mx-auto mb-3 opacity-30" /><p>اختر نوع فريق من الأزرار أعلاه لبدء الجدولة</p></div>
                    ) : (
                        <div className="space-y-4">
                            {ownTeams.map(team => {
                                const type = typeByKey.get(team.teamType) ?? null;
                                const theme = typeTheme(team.teamType);
                                const leadSlot = type?.slots.find(s => s.slotFunction === 'lead');
                                const leadId = leadSlot ? team.members[leadSlot.slotKey]?.[0] : undefined;
                                const typeName = type?.name ?? team.teamTypeName ?? 'فريق';
                                const title = leadId != null ? `${typeName}: ${empName(leadId)}` : typeName;
                                return (
                                    <motion.div key={team.localId} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className={`bg-white rounded-xl shadow-sm border overflow-hidden ${theme.card}`}>
                                        <div className={`p-3 border-b flex justify-between items-center ${theme.head}`}>
                                            <div className="flex items-center gap-2">
                                                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${theme.icon}`}>{team.teamType === EMERGENCY ? <AlertCircle className="w-4 h-4" /> : <Users className="w-4 h-4" />}</div>
                                                <span className="font-bold text-slate-800 text-sm">{title}</span>
                                                {!team.isNew && <span className="text-xs text-slate-400" dir="ltr">{team.key}</span>}
                                            </div>
                                            <IconButton icon={X} label="حذف" variant="danger" size="sm" onClick={() => removeTeam(team.localId)} />
                                        </div>
                                        {!type ? (
                                            <p className="p-4 text-sm text-red-500">نوع الفريق «{team.teamType}» غير موجود في الكتالوج</p>
                                        ) : (
                                            <div className="p-4 grid grid-cols-2 gap-3">
                                                {type.slots.map(slot => {
                                                    const ids = team.members[slot.slotKey] ?? [];
                                                    const isSelected = selectedSlot?.localId === team.localId && selectedSlot.slotKey === slot.slotKey;
                                                    const required = slot.minMembers >= 1;
                                                    const missing = ids.length < slot.minMembers;
                                                    const Icon = slotIcon(slot);
                                                    const wide = slot.slotFunction === 'caller' || slot.maxMembers !== 1;
                                                    const capacity = slot.maxMembers == null ? '' : ` (${ids.length}/${slot.maxMembers})`;
                                                    return (
                                                        <div
                                                            key={slot.slotKey}
                                                            onClick={() => selectSlot(team.localId, slot.slotKey)}
                                                            className={`${wide ? 'col-span-2' : ''} p-3 rounded-lg border-2 cursor-pointer transition-all ${isSelected ? 'border-sky-500 bg-sky-50' : missing ? 'border-dashed border-red-300 hover:border-sky-300' : 'border-dashed border-slate-300 hover:border-sky-300'}`}
                                                        >
                                                            {ids.length > 0 ? (
                                                                <div className="space-y-2">
                                                                    <p className="text-xs font-bold text-slate-500">{slot.label}{capacity}</p>
                                                                    <div className="flex flex-wrap gap-2">
                                                                        {ids.map(id => (
                                                                            <div key={id} className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-full pl-1.5 pr-3 py-1 shadow-sm">
                                                                                <img src={employeeById.get(id)?.avatar || ''} alt="" className="w-5 h-5 rounded-full" />
                                                                                <span className="text-xs font-medium text-slate-700">{empName(id)}</span>
                                                                                <IconButton icon={X} label="حذف" variant="danger" size="sm" className="ml-1" onClick={e => { e.stopPropagation(); unassign(team.localId, slot.slotKey, id); }} />
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                    {isSelected && slot.maxMembers !== 1 && <p className="text-xs text-sky-600 text-center">انقر على موظف من القائمة جانباً للإضافة</p>}
                                                                </div>
                                                            ) : (
                                                                <div className="text-center py-2">
                                                                    <Icon className={`w-5 h-5 mx-auto mb-1 ${missing ? 'text-red-400' : 'text-slate-400'}`} />
                                                                    <p className={`text-xs ${missing ? 'text-red-400' : 'text-slate-400'}`}>{slot.label} {required ? '(مطلوب)' : '(اختياري)'}</p>
                                                                </div>
                                                            )}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </motion.div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
