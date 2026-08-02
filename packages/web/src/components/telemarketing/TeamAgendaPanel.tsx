import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MapPin, User, Calendar, CalendarOff, Phone, Layers, Clock } from '../ui/icons';
import { Appointment } from '../../lib/types';
import { OPEN_TASK_TYPE_LABELS } from '@golden-crm/shared';

interface TeamAgendaPanelProps {
    appointments: Appointment[];
    date: string;
    teamLabel?: string;
    highlightedAppointmentKey?: string | null;
}

const normalizeTimeSlot = (value: string | null | undefined) => String(value || '').slice(0, 5);

export const getAppointmentDisplayKey = (appointment: Pick<Appointment, 'entityId' | 'teamKey' | 'date' | 'timeSlot'>) =>
    `${appointment.entityId}:${appointment.teamKey}:${appointment.date}:${normalizeTimeSlot(appointment.timeSlot)}`;

export const VISIT_EXECUTION_STATUS_META: Record<string, { label: string; className: string }> = {
    scheduled: { label: 'بانتظار التنفيذ', className: 'border-sky-200 bg-sky-50 text-sky-700' },
    in_progress: { label: 'قيد التنفيذ', className: 'border-indigo-200 bg-indigo-50 text-indigo-700' },
    ended: { label: 'بانتظار توثيق النتائج', className: 'border-amber-200 bg-amber-50 text-amber-700' },
    completed: { label: 'تم تنفيذ الزيارة', className: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
    not_completed: { label: 'تعذر إتمام الزيارة', className: 'border-rose-200 bg-rose-50 text-rose-700' },
    postponed_by_company: { label: 'مؤجلة من الشركة', className: 'border-amber-200 bg-amber-50 text-amber-700' },
    postponed_by_customer: { label: 'مؤجلة من الزبون', className: 'border-amber-200 bg-amber-50 text-amber-700' },
    needs_reschedule: { label: 'تحتاج إعادة جدولة', className: 'border-violet-200 bg-violet-50 text-violet-700' },
    cancelled: { label: 'ملغاة', className: 'border-slate-200 bg-slate-100 text-slate-600' },
    closed: { label: 'مغلقة', className: 'border-slate-200 bg-slate-100 text-slate-600' },
};

export const getVisitExecutionStatusMeta = (status: Appointment['status']) =>
    VISIT_EXECUTION_STATUS_META[status || 'scheduled'] || VISIT_EXECUTION_STATUS_META.scheduled;

export const getAppointmentAreaLabel = (appointment: Appointment): string => {
    const path = (appointment.workLocationPath || []).map(part => String(part).trim()).filter(Boolean);
    if (path.length > 0) return path.slice(-2).join('، ');
    return appointment.workLocationName?.trim() || 'منطقة غير محددة';
};

export default function TeamAgendaPanel({ appointments, date, teamLabel, highlightedAppointmentKey }: TeamAgendaPanelProps) {
    const [grouping, setGrouping] = useState<'time' | 'area'>('time');
    // Flexible booking means appointments can land on any minute, so the agenda
    // is now a real chronological list of the actual bookings rather than a
    // fixed 24-row hourly grid.
    const sortedAppointments = useMemo(
        () => [...appointments].sort((a, b) =>
            normalizeTimeSlot(a.timeSlot).localeCompare(normalizeTimeSlot(b.timeSlot))),
        [appointments],
    );
    const highlightedAppointmentRef = useRef<HTMLDivElement>(null);
    const areaGroups = useMemo(() => {
        const groups = new Map<string, { key: string; label: string; appointments: Appointment[] }>();
        sortedAppointments.forEach(appointment => {
            const label = getAppointmentAreaLabel(appointment);
            const key = appointment.workLocationGeoUnitId != null
                ? `geo:${appointment.workLocationGeoUnitId}`
                : `label:${label}`;
            const group = groups.get(key) || { key, label, appointments: [] };
            group.appointments.push(appointment);
            groups.set(key, group);
        });
        return Array.from(groups.values());
    }, [sortedAppointments]);

    useEffect(() => {
        if (!highlightedAppointmentKey) return;
        highlightedAppointmentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, [highlightedAppointmentKey, sortedAppointments.length]);

    const renderAppointmentRow = (app: Appointment) => {
        const time = normalizeTimeSlot(app.timeSlot);
        const executionMeta = getVisitExecutionStatusMeta(app.status);
        const isHighlighted = getAppointmentDisplayKey(app) === highlightedAppointmentKey;
        const taskLabels = (app.visitTasks || []).map(taskType => OPEN_TASK_TYPE_LABELS[taskType] || taskType);
        const areaLabel = getAppointmentAreaLabel(app);
        return (
            <motion.div
                key={app.id}
                ref={isHighlighted ? highlightedAppointmentRef : undefined}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className={`relative border-b border-slate-100 px-3 py-3 transition-colors last:border-b-0 hover:bg-slate-50/80 ${isHighlighted ? 'bg-violet-50 ring-2 ring-inset ring-violet-300' : 'bg-white'}`}
                data-appointment-key={getAppointmentDisplayKey(app)}
            >
                <div className="grid gap-3 lg:grid-cols-[82px_minmax(170px,1fr)_minmax(210px,1.35fr)_minmax(170px,1fr)_170px] lg:items-center">
                    <div className="flex items-center gap-2 lg:block">
                        <span className="inline-flex min-w-[70px] items-center justify-center rounded-lg bg-slate-900 px-2.5 py-1.5 font-mono text-sm font-black text-white" dir="ltr">
                            {time || '--:--'}
                        </span>
                        <span className="text-xs font-bold text-slate-400 lg:hidden">وقت الموعد</span>
                    </div>

                    <div className="flex min-w-0 flex-wrap items-center gap-1.5 self-center lg:flex-nowrap">
                        <User className="h-3.5 w-3.5 shrink-0 text-violet-600" />
                        <p className="truncate text-sm font-black text-slate-900">{app.customerName}</p>
                        {app.customerMobile && <span className="hidden h-4 w-px shrink-0 bg-slate-200 lg:block" aria-hidden />}
                        {app.customerMobile && (
                            <div className="flex shrink-0 items-center gap-1 text-xs font-bold text-slate-500" dir="ltr">
                                <Phone className="h-3 w-3" />
                                <span>{app.customerMobile}</span>
                            </div>
                        )}
                        {isHighlighted && (
                            <span className="shrink-0 rounded border border-violet-200 bg-violet-100 px-1.5 py-0.5 text-xs font-bold text-violet-700">حُجز الآن</span>
                        )}
                    </div>

                    <div className="flex min-w-0 items-center gap-1.5 self-center text-xs font-bold text-slate-600">
                        <MapPin className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                        <span className={`shrink-0 rounded-md border px-1.5 py-0.5 font-black ${app.workLocationGeoUnitId != null ? 'border-sky-200 bg-sky-50 text-sky-700' : 'border-slate-200 bg-slate-50 text-slate-500'}`}>
                            {areaLabel}
                        </span>
                        <span className="hidden h-4 w-px shrink-0 bg-slate-200 lg:block" aria-hidden />
                        <p className="line-clamp-2 min-w-0 leading-5 lg:truncate">{app.customerAddress || 'العنوان التفصيلي غير مسجل'}</p>
                    </div>

                    <div className="flex min-w-0 flex-wrap items-center gap-1 self-center">
                        <Layers className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                        {taskLabels.length > 0 ? taskLabels.slice(0, 2).map((label, index) => (
                            <span key={`${label}:${index}`} className="max-w-[150px] truncate rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-xs font-bold text-slate-600">
                                {label}
                            </span>
                        )) : (
                            <span className="text-xs font-bold text-slate-400">غير محددة</span>
                        )}
                        {taskLabels.length > 2 && <span className="text-xs font-black text-violet-600">+{taskLabels.length - 2}</span>}
                    </div>

                    <div className="self-center">
                        <span className={`inline-flex whitespace-nowrap rounded-lg border px-2.5 py-1 text-xs font-black ${executionMeta.className}`}>
                            {executionMeta.label}
                        </span>
                    </div>
                </div>
            </motion.div>
        );
    };

    return (
        <div className="w-full bg-slate-50 border-gray-200 flex flex-col shrink-0 h-full overflow-hidden shadow-sm z-20">
            {/* Header */}
            <div className="px-4 py-3 border-b border-gray-200 bg-white shrink-0 flex items-center justify-between">
                <div>
                    <h2 className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                        <Calendar className="w-3.5 h-3.5 text-emerald-600" />
                        <span>{teamLabel ? `مواعيد ${teamLabel}` : 'مواعيد الفريق'}</span>
                    </h2>
                    <p className="text-xs text-slate-500 mt-1 mr-5">جدول زيارات الخطة: {date}</p>
                </div>
                <div className="flex items-center gap-2">
                    <div className="flex rounded-lg border border-slate-200 bg-slate-50 p-0.5" role="group" aria-label="طريقة ترتيب المواعيد">
                        <button
                            type="button"
                            onClick={() => setGrouping('time')}
                            className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-black transition-colors ${grouping === 'time' ? 'bg-white text-violet-700 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
                        >
                            <Clock className="h-3.5 w-3.5" /> حسب الوقت
                        </button>
                        <button
                            type="button"
                            onClick={() => setGrouping('area')}
                            className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-black transition-colors ${grouping === 'area' ? 'bg-white text-violet-700 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
                        >
                            <MapPin className="h-3.5 w-3.5" /> حسب المنطقة
                        </button>
                    </div>
                    <span className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-bold text-emerald-700">
                        {sortedAppointments.length} موعد
                    </span>
                </div>
            </div>

            {/* Compact operational agenda */}
            <div className="flex-1 overflow-y-auto p-3 custom-scroll">
                {sortedAppointments.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-center px-4 py-8">
                        <CalendarOff className="w-8 h-8 text-slate-300 mb-2" />
                        <p className="text-xs font-bold text-slate-400">لا توجد مواعيد محجوزة لهذا الفريق بعد</p>
                    </div>
                ) : (
                    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                        <div className="hidden lg:grid lg:grid-cols-[82px_minmax(170px,1fr)_minmax(210px,1.35fr)_minmax(170px,1fr)_170px] items-center gap-3 border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-black text-slate-500">
                            <span>الوقت</span>
                            <span>الزبون</span>
                            <span>المنطقة والعنوان التفصيلي</span>
                            <span>المهام</span>
                            <span>حالة التنفيذ</span>
                        </div>
                        {grouping === 'area' ? areaGroups.map(group => (
                            <div key={group.key}>
                                <div className="flex items-center justify-between border-b border-slate-100 bg-violet-50/70 px-3 py-2">
                                    <span className="flex items-center gap-1.5 text-xs font-black text-violet-800">
                                        <MapPin className="h-3.5 w-3.5" />
                                        {group.label}
                                    </span>
                                    <span className="text-xs font-bold text-violet-500">{group.appointments.length} موعد</span>
                                </div>
                                <AnimatePresence>
                                    {group.appointments.map(renderAppointmentRow)}
                                </AnimatePresence>
                            </div>
                        )) : (
                        <AnimatePresence>
                            {sortedAppointments.map(renderAppointmentRow)}
                        </AnimatePresence>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
