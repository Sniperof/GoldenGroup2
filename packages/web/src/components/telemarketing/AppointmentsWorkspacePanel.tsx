import React, { useMemo } from 'react';
import { AlertTriangle, Calendar, CheckCircle2, Layers, User } from '../ui/icons';
import type { Appointment } from '../../lib/types';
import TeamAgendaPanel from './TeamAgendaPanel';

interface TeamOption {
    key: string;
    label: string;
}

interface AppointmentsWorkspacePanelProps {
    appointments: Appointment[];
    date: string;
    teams: TeamOption[];
    selectedTeamKey: string;
    onSelectTeam: (teamKey: string) => void;
    highlightedAppointmentKey?: string | null;
}

const isCompleted = (appointment: Appointment) => appointment.status === 'completed';
const isUnfinished = (appointment: Appointment) => appointment.status === 'not_completed';

export default function AppointmentsWorkspacePanel({
    appointments,
    date,
    teams,
    selectedTeamKey,
    onSelectTeam,
    highlightedAppointmentKey,
}: AppointmentsWorkspacePanelProps) {
    const appointmentsByTeam = useMemo(() => {
        const grouped = new Map<string, Appointment[]>();
        for (const appointment of appointments) {
            const current = grouped.get(appointment.teamKey) || [];
            current.push(appointment);
            grouped.set(appointment.teamKey, current);
        }
        return grouped;
    }, [appointments]);

    const selectedTeam = teams.find(team => team.key === selectedTeamKey);
    const selectedAppointments = appointmentsByTeam.get(selectedTeamKey) || [];
    const teamsWithAppointments = teams.filter(team => (appointmentsByTeam.get(team.key)?.length || 0) > 0).length;
    const completedCount = appointments.filter(isCompleted).length;
    const unfinishedCount = appointments.filter(isUnfinished).length;

    return (
        <div className="flex-1 min-h-0 overflow-hidden p-3 flex flex-col gap-3">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 shrink-0">
                <MetricCard icon={Calendar} label="إجمالي المواعيد" value={appointments.length} tone="violet" />
                <MetricCard icon={User} label="فرق لديها مواعيد" value={teamsWithAppointments} tone="sky" />
                <MetricCard icon={CheckCircle2} label="تم تنفيذ الزيارة" value={completedCount} tone="emerald" />
                <MetricCard icon={AlertTriangle} label="تعذر إتمام الزيارة" value={unfinishedCount} tone="rose" />
            </div>

            <div className="flex-1 min-h-0 flex gap-3 overflow-hidden">
                <aside className="w-72 shrink-0 rounded-xl border border-slate-200 bg-white overflow-hidden flex flex-col">
                    <div className="border-b border-slate-100 px-4 py-3">
                        <h2 className="text-sm font-black text-slate-800">فرق العمل</h2>
                        <p className="mt-1 text-xs font-bold text-slate-400">اختر فريقاً لعرض جدوله الزمني</p>
                    </div>
                    <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1 custom-scroll">
                        {teams.length === 0 ? (
                            <div className="h-full flex flex-col items-center justify-center px-4 text-center">
                                <Layers className="w-8 h-8 text-slate-300 mb-2" />
                                <p className="text-xs font-bold text-slate-400">لا توجد فرق متاحة لهذا التاريخ</p>
                            </div>
                        ) : teams.map(team => {
                            const count = appointmentsByTeam.get(team.key)?.length || 0;
                            const isActive = team.key === selectedTeamKey;
                            return (
                                <button
                                    key={team.key}
                                    type="button"
                                    onClick={() => onSelectTeam(team.key)}
                                    className={`w-full rounded-lg border px-3 py-2.5 text-right transition-colors ${isActive
                                        ? 'border-violet-200 bg-violet-50 text-violet-800'
                                        : 'border-transparent bg-white text-slate-700 hover:border-slate-200 hover:bg-slate-50'}`}
                                >
                                    <span className="flex items-center justify-between gap-3">
                                        <span className="min-w-0 truncate text-sm font-black">{team.label}</span>
                                        <span className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-black ${isActive ? 'bg-violet-600 text-white' : 'bg-slate-100 text-slate-600'}`}>
                                            {count}
                                        </span>
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </aside>

                <section className="flex-1 min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white">
                    <TeamAgendaPanel
                        appointments={selectedAppointments}
                        date={date}
                        teamLabel={selectedTeam?.label}
                        highlightedAppointmentKey={highlightedAppointmentKey}
                    />
                </section>
            </div>
        </div>
    );
}

function MetricCard({
    icon: Icon,
    label,
    value,
    tone,
}: {
    icon: React.ComponentType<{ className?: string }>;
    label: string;
    value: number;
    tone: 'violet' | 'sky' | 'emerald' | 'amber' | 'rose';
}) {
    const tones = {
        violet: 'border-violet-100 bg-violet-50 text-violet-700',
        sky: 'border-sky-100 bg-sky-50 text-sky-700',
        emerald: 'border-emerald-100 bg-emerald-50 text-emerald-700',
        amber: 'border-amber-100 bg-amber-50 text-amber-700',
        rose: 'border-rose-100 bg-rose-50 text-rose-700',
    } as const;

    return (
        <div className={`rounded-xl border px-4 py-3 ${tones[tone]}`}>
            <div className="flex items-center justify-between gap-3">
                <div>
                    <p className="text-xs font-bold opacity-75">{label}</p>
                    <p className="mt-1 text-2xl font-black leading-none">{value}</p>
                </div>
                <div className="rounded-xl bg-white/70 p-2.5">
                    <Icon className="h-5 w-5" />
                </div>
            </div>
        </div>
    );
}
