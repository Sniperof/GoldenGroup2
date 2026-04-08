import { useState, useCallback, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Calendar, Users, UserCheck, Plus, User, Copy, Save, X, PhoneCall } from 'lucide-react';
import { api } from '../../lib/api';
import type { DaySchedule, Employee } from '../../lib/types';

const getToday = () => new Date().toISOString().split('T')[0];
const getYesterday = () => { const d = new Date(); d.setDate(d.getDate() - 1); return d.toISOString().split('T')[0]; };

export default function TeamScheduler() {
    const [current, setCurrent] = useState<DaySchedule>({ teams: [], solos: [] });
    const [date, setDate] = useState(getToday);
    const [selectedSlot, setSelectedSlot] = useState<{ type: string; slotIdx: number; role: string } | null>(null);
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        api.employees.list().then((data: Employee[]) => setEmployees(data)).catch(() => {});
    }, []);

    useEffect(() => {
        setLoading(true);
        api.schedules.get(date)
            .then((data: DaySchedule) => {
                setCurrent(data && (data.teams || data.solos) ? data : { teams: [], solos: [] });
            })
            .catch(() => {
                setCurrent({ teams: [], solos: [] });
            })
            .finally(() => setLoading(false));
    }, [date]);

    const updateCurrent = useCallback((sched: DaySchedule) => {
        setCurrent(sched);
        api.schedules.save(date, { teams: sched.teams, solos: sched.solos }).catch(() => {});
    }, [date]);

    const addTeamSlot = () => updateCurrent({ ...current, teams: [...current.teams, { supervisor: null, technician: null }] });
    const addSoloSlot = () => updateCurrent({ ...current, solos: [...current.solos, { technician: null }] });
    const removeTeamSlot = (idx: number) => updateCurrent({ ...current, teams: current.teams.filter((_, i) => i !== idx) });
    const removeSoloSlot = (idx: number) => updateCurrent({ ...current, solos: current.solos.filter((_, i) => i !== idx) });

    const assignedIds = [
        ...current.teams.flatMap(t => [t.supervisor, t.technician, ...(t.telemarketers || [])]),
        ...current.solos.map(s => s.technician),
    ].filter(Boolean) as number[];

    const availableSups = employees.filter(e => e.role === 'supervisor' && e.status === 'active' && !assignedIds.includes(e.id));
    const availableTechs = employees.filter(e => e.role === 'technician' && e.status === 'active' && !assignedIds.includes(e.id));
    const availableTeles = employees.filter(e => e.role === 'telemarketer' && e.status === 'active' && !assignedIds.includes(e.id));
    const poolEmployees = [...availableSups, ...availableTechs, ...availableTeles];

    const selectSlot = (type: string, slotIdx: number, role: string) => {
        setSelectedSlot(s => s && s.type === type && s.slotIdx === slotIdx && s.role === role ? null : { type, slotIdx, role });
    };

    const assignEmployee = (empId: number) => {
        if (!selectedSlot) return;
        const emp = employees.find(e => e.id === empId);
        if (!emp) return;
        const { type, slotIdx, role } = selectedSlot;
        if (type === 'team') {
            const teams = [...current.teams];
            if (role === 'telemarketer') {
                if (emp.role !== 'telemarketer') return;
                const currentTeles = teams[slotIdx].telemarketers || [];
                if (!currentTeles.includes(empId)) {
                    teams[slotIdx] = { ...teams[slotIdx], telemarketers: [...currentTeles, empId] };
                }
            } else {
                if (role === 'supervisor' && emp.role !== 'supervisor') return;
                if (role === 'technician' && emp.role !== 'technician') return;
                teams[slotIdx] = { ...teams[slotIdx], [role]: empId };
            }
            updateCurrent({ ...current, teams });
        } else {
            if (emp.role !== 'technician') return;
            const solos = [...current.solos];
            solos[slotIdx] = { technician: empId };
            updateCurrent({ ...current, solos });
        }
        if (role !== 'telemarketer') {
            setSelectedSlot(null);
        }
    };

    const unassign = (type: string, slotIdx: number, role: string, empId?: number) => {
        if (type === 'team') {
            const teams = [...current.teams];
            if (role === 'telemarketer') {
                const currentTeles = teams[slotIdx].telemarketers || [];
                teams[slotIdx] = { ...teams[slotIdx], telemarketers: currentTeles.filter(id => id !== empId) };
            } else {
                teams[slotIdx] = { ...teams[slotIdx], [role]: null };
            }
            updateCurrent({ ...current, teams });
        } else {
            const solos = [...current.solos];
            solos[slotIdx] = { technician: null };
            updateCurrent({ ...current, solos });
        }
    };

    const copyFromYesterday = async () => {
        const yest = getYesterday();
        try {
            const yesterdaySchedule: DaySchedule = await api.schedules.get(yest);
            if (!yesterdaySchedule || (!yesterdaySchedule.teams?.length && !yesterdaySchedule.solos?.length)) {
                alert('لا يوجد جدول محفوظ ليوم ' + yest);
                return;
            }
            if (current.teams.length > 0 || current.solos.length > 0) {
                if (!confirm('سيتم استبدال الجدول الحالي. متابعة؟')) return;
            }
            updateCurrent(JSON.parse(JSON.stringify(yesterdaySchedule)));
        } catch {
            alert('لا يوجد جدول محفوظ ليوم ' + yest);
        }
    };

    const saveSchedule = async () => {
        try {
            await api.schedules.save(date, { teams: current.teams, solos: current.solos });
            alert('تم حفظ الجدول!');
        } catch {
            alert('حدث خطأ أثناء الحفظ');
        }
    };

    const getEmpName = (id: number | null) => { const e = employees.find(e => e.id === id); return e?.name || ''; };

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
            <div className="flex items-end justify-between mb-6">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900 mb-1">جدولة الفرق</h1>
                    <p className="text-slate-500 text-sm">تعيين المشرفين والفنيين للفرق اليومية.</p>
                </div>
            </div>

            {/* Control Bar */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-6 flex items-center gap-4 flex-wrap">
                <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-sky-500" />
                    <input type="date" value={date} onChange={e => { setDate(e.target.value); setSelectedSlot(null); }} className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 focus:border-sky-500 focus:outline-none" />
                </div>
                <div className="h-8 w-px bg-slate-200" />
                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1.5 text-sm"><UserCheck className="w-4 h-4 text-indigo-500" /><span className="text-slate-500">مشرفون:</span><span className="text-slate-900 font-bold">{availableSups.length}</span></div>
                    <div className="flex items-center gap-1.5 text-sm"><Users className="w-4 h-4 text-emerald-500" /><span className="text-slate-500">فنيون:</span><span className="text-slate-900 font-bold">{availableTechs.length}</span></div>
                    <div className="flex items-center gap-1.5 text-sm"><PhoneCall className="w-4 h-4 text-violet-500" /><span className="text-slate-500">مسوقون:</span><span className="text-slate-900 font-bold">{availableTeles.length}</span></div>
                </div>
                <div className="mr-auto flex items-center gap-2">
                    <button onClick={copyFromYesterday} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 text-sm transition-colors"><Copy className="w-4 h-4" /><span>نسخ من الأمس</span></button>
                    <button onClick={saveSchedule} className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg text-sm font-bold shadow-lg transition-all"><Save className="w-4 h-4" /><span>حفظ الجدول</span></button>
                </div>
            </div>

            <div className="grid grid-cols-3 gap-6">
                {/* Staff Pool */}
                <div className="col-span-1">
                    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden sticky top-0">
                        <div className="px-4 py-3 bg-gray-50 border-b border-gray-100">
                            <h3 className="text-gray-500 font-semibold text-xs uppercase tracking-wider flex items-center gap-2"><Users className="w-4 h-4 text-gray-400" />الموظفون المتاحون</h3>
                        </div>
                        <div className="divide-y divide-gray-100 max-h-[60vh] overflow-y-auto custom-scroll">
                            {poolEmployees.length === 0 ? (
                                <p className="text-center text-gray-400 text-sm py-8">لا يوجد موظفون متاحون</p>
                            ) : poolEmployees.map(e => (
                                <motion.div
                                    key={e.id}
                                    onClick={() => assignEmployee(e.id)}
                                    className={`flex items-center gap-3 p-3 cursor-pointer transition-all ${selectedSlot
                                        ? ((selectedSlot.role === 'supervisor' && e.role === 'supervisor') ||
                                            (selectedSlot.role === 'technician' && e.role === 'technician') ||
                                            (selectedSlot.role === 'telemarketer' && e.role === 'telemarketer') ||
                                            (selectedSlot.type === 'solo' && e.role === 'technician'))
                                            ? 'hover:bg-sky-50'
                                            : 'opacity-40 grayscale cursor-not-allowed'
                                        : 'hover:bg-sky-50'
                                        }`}
                                >
                                    <div className="relative">
                                        <img src={e.avatar} alt="" className="w-9 h-9 rounded-full border border-gray-100 object-cover" />
                                        <span className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-white ${e.status === 'active' ? 'bg-emerald-500' : 'bg-gray-300'}`}></span>
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium text-slate-700 truncate">{e.name}</p>
                                        <p className="text-xs text-gray-500">{e.role === 'supervisor' ? 'مشرف' : e.role === 'telemarketer' ? 'مسوق هاتفي' : 'فني'}</p>
                                    </div>
                                    {e.role === 'supervisor' ? (
                                        <span className="px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-600 text-[10px] font-bold">مشرف</span>
                                    ) : e.role === 'telemarketer' ? (
                                        <span className="px-2 py-0.5 rounded-full bg-violet-50 text-violet-600 text-[10px] font-bold">مسوق</span>
                                    ) : (
                                        <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600 text-[10px] font-bold">فني</span>
                                    )}
                                </motion.div>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Slots Area */}
                <div className="col-span-2 space-y-4">
                    <div className="flex gap-2">
                        <button onClick={addTeamSlot} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-sm font-bold transition-all"><Plus className="w-4 h-4" /><span>إضافة فريق</span></button>
                        <button onClick={addSoloSlot} className="flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 text-sm transition-colors"><User className="w-4 h-4" /><span>وحدة فردية / طوارئ</span></button>
                    </div>

                    {current.teams.length === 0 && current.solos.length === 0 ? (
                        <div className="text-center text-slate-400 py-10"><Calendar className="w-10 h-10 mx-auto mb-3 opacity-30" /><p>اضغط "إضافة فريق" أو "وحدة فردية" لبدء الجدولة</p></div>
                    ) : (
                        <div className="space-y-4">
                            {current.teams.map((t, idx) => {
                                const teamName = t.supervisor ? `فريق ${getEmpName(t.supervisor)}` : `فريق #${idx + 1}`;
                                const isSup = selectedSlot?.type === 'team' && selectedSlot.slotIdx === idx && selectedSlot.role === 'supervisor';
                                const isTech = selectedSlot?.type === 'team' && selectedSlot.slotIdx === idx && selectedSlot.role === 'technician';
                                const isTele = selectedSlot?.type === 'team' && selectedSlot.slotIdx === idx && selectedSlot.role === 'telemarketer';
                                const teamTeles = t.telemarketers || [];

                                return (
                                    <motion.div key={`team-${idx}`} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                                        <div className="p-3 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
                                            <div className="flex items-center gap-2">
                                                <div className="w-8 h-8 rounded-lg bg-sky-100 flex items-center justify-center text-sky-600"><Users className="w-4 h-4" /></div>
                                                <span className="font-bold text-slate-800 text-sm">{teamName}</span>
                                                <span className="text-xs text-slate-500">فريق قياسي</span>
                                            </div>
                                            <button onClick={() => removeTeamSlot(idx)} className="text-slate-400 hover:text-red-500 transition-colors"><X className="w-4 h-4" /></button>
                                        </div>
                                        <div className="p-4 grid grid-cols-2 gap-3">
                                            {/* Supervisor Slot */}
                                            <div onClick={() => selectSlot('team', idx, 'supervisor')} className={`p-3 rounded-lg border-2 cursor-pointer transition-all ${isSup ? 'border-sky-500 bg-sky-50' : 'border-dashed border-slate-300 hover:border-sky-300'}`}>
                                                {t.supervisor ? (
                                                    <div className="flex items-center gap-2">
                                                        <img src={employees.find(e => e.id === t.supervisor)?.avatar || ''} alt="" className="w-8 h-8 rounded-full" />
                                                        <div className="flex-1"><p className="text-sm text-slate-900">{getEmpName(t.supervisor)}</p><p className="text-xs text-indigo-500">مشرف</p></div>
                                                        <button onClick={e => { e.stopPropagation(); unassign('team', idx, 'supervisor'); }} className="text-slate-400 hover:text-red-500"><X className="w-3.5 h-3.5" /></button>
                                                    </div>
                                                ) : (
                                                    <div className="text-center py-2"><UserCheck className="w-5 h-5 mx-auto text-slate-400 mb-1" /><p className="text-xs text-slate-400">مشرف</p></div>
                                                )}
                                            </div>
                                            {/* Technician Slot */}
                                            <div onClick={() => selectSlot('team', idx, 'technician')} className={`p-3 rounded-lg border-2 cursor-pointer transition-all ${isTech ? 'border-sky-500 bg-sky-50' : 'border-dashed border-slate-300 hover:border-sky-300'}`}>
                                                {t.technician ? (
                                                    <div className="flex items-center gap-2">
                                                        <img src={employees.find(e => e.id === t.technician)?.avatar || ''} alt="" className="w-8 h-8 rounded-full" />
                                                        <div className="flex-1"><p className="text-sm text-slate-900">{getEmpName(t.technician)}</p><p className="text-xs text-emerald-500">فني</p></div>
                                                        <button onClick={e => { e.stopPropagation(); unassign('team', idx, 'technician'); }} className="text-slate-400 hover:text-red-500"><X className="w-3.5 h-3.5" /></button>
                                                    </div>
                                                ) : (
                                                    <div className="text-center py-2"><User className="w-5 h-5 mx-auto text-slate-400 mb-1" /><p className="text-xs text-slate-400">فني</p></div>
                                                )}
                                            </div>
                                        </div>
                                        <div className="p-4 border-t border-gray-100 bg-slate-50/50">
                                            {/* Telemarketer Slots */}
                                            <div onClick={() => selectSlot('team', idx, 'telemarketer')} className={`p-3 rounded-lg border-2 cursor-pointer transition-all ${isTele ? 'border-sky-500 bg-sky-50' : 'border-dashed border-slate-300 hover:border-sky-300'}`}>
                                                {teamTeles.length > 0 ? (
                                                    <div className="space-y-2">
                                                        <p className="text-xs font-bold text-violet-600 mb-2">المسوقون الهاتفون ({teamTeles.length})</p>
                                                        <div className="flex flex-wrap gap-2">
                                                            {teamTeles.map(teleId => (
                                                                <div key={teleId} className="flex items-center gap-1.5 bg-white border border-violet-100 rounded-full pl-1.5 pr-3 py-1 shadow-sm">
                                                                    <img src={employees.find(e => e.id === teleId)?.avatar || ''} alt="" className="w-5 h-5 rounded-full" />
                                                                    <span className="text-xs font-medium text-slate-700">{getEmpName(teleId)}</span>
                                                                    <button onClick={e => { e.stopPropagation(); unassign('team', idx, 'telemarketer', teleId); }} className="text-slate-400 hover:text-red-500 ml-1"><X className="w-3 h-3" /></button>
                                                                </div>
                                                            ))}
                                                        </div>
                                                        {isTele && <p className="text-[10px] text-sky-600 mt-2 text-center">انقر على موظف من القائمة جانباً للإضافة</p>}
                                                    </div>
                                                ) : (
                                                    <div className="text-center py-2"><PhoneCall className="w-5 h-5 mx-auto text-slate-400 mb-1" /><p className="text-xs text-slate-400">مسوق هاتفي (اختياري)</p></div>
                                                )}
                                            </div>
                                        </div>
                                    </motion.div>
                                );
                            })}

                            {current.solos.map((s, idx) => {
                                const isSolo = selectedSlot?.type === 'solo' && selectedSlot.slotIdx === idx;
                                return (
                                    <motion.div key={`solo-${idx}`} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                                        <div className="p-3 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
                                            <div className="flex items-center gap-2">
                                                <div className="w-8 h-8 rounded-lg bg-orange-100 flex items-center justify-center text-orange-600"><User className="w-4 h-4" /></div>
                                                <span className="font-bold text-slate-800 text-sm">وحدة فردية / طوارئ</span>
                                            </div>
                                            <button onClick={() => removeSoloSlot(idx)} className="text-slate-400 hover:text-red-500 transition-colors"><X className="w-4 h-4" /></button>
                                        </div>
                                        <div className="p-4">
                                            <div onClick={() => selectSlot('solo', idx, 'technician')} className={`p-3 rounded-lg border-2 cursor-pointer transition-all ${isSolo ? 'border-sky-500 bg-sky-50' : 'border-dashed border-slate-300 hover:border-sky-300'}`}>
                                                {s.technician ? (
                                                    <div className="flex items-center gap-2">
                                                        <img src={employees.find(e => e.id === s.technician)?.avatar || ''} alt="" className="w-8 h-8 rounded-full" />
                                                        <div className="flex-1"><p className="text-sm text-slate-900">{getEmpName(s.technician)}</p><p className="text-xs text-emerald-500">فني</p></div>
                                                        <button onClick={e => { e.stopPropagation(); unassign('solo', idx, 'technician'); }} className="text-slate-400 hover:text-red-500"><X className="w-3.5 h-3.5" /></button>
                                                    </div>
                                                ) : (
                                                    <div className="text-center py-2"><User className="w-5 h-5 mx-auto text-slate-400 mb-1" /><p className="text-xs text-slate-400">فني</p></div>
                                                )}
                                            </div>
                                        </div>
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
