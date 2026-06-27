import React, { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MapPin, User, Calendar, CalendarOff } from 'lucide-react';
import { Appointment } from '../../lib/types';

interface TeamAgendaPanelProps {
    appointments: Appointment[];
    date: string;
}

const normalizeTimeSlot = (value: string | null | undefined) => String(value || '').slice(0, 5);

export default function TeamAgendaPanel({ appointments, date }: TeamAgendaPanelProps) {
    // Flexible booking means appointments can land on any minute, so the agenda
    // is now a real chronological list of the actual bookings rather than a
    // fixed 24-row hourly grid.
    const sortedAppointments = useMemo(
        () => [...appointments].sort((a, b) =>
            normalizeTimeSlot(a.timeSlot).localeCompare(normalizeTimeSlot(b.timeSlot))),
        [appointments],
    );

    return (
        <div className="w-full bg-slate-50 border-gray-200 flex flex-col shrink-0 h-full overflow-hidden shadow-sm z-20">
            {/* Header */}
            <div className="px-4 py-3 border-b border-gray-200 bg-white shrink-0 flex items-center justify-between">
                <div>
                    <h2 className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                        <Calendar className="w-3.5 h-3.5 text-emerald-600" />
                        <span>مواعيد الفريق</span>
                    </h2>
                    <p className="text-[10px] text-slate-500 mt-1 mr-5">جدول زيارات الخطة: {date}</p>
                </div>
                <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-2 py-0.5">
                    {sortedAppointments.length} موعد
                </span>
            </div>

            {/* Chronological timeline */}
            <div className="flex-1 overflow-y-auto p-3 custom-scroll">
                {sortedAppointments.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-center px-4 py-8">
                        <CalendarOff className="w-8 h-8 text-slate-300 mb-2" />
                        <p className="text-[11px] font-bold text-slate-400">لا توجد مواعيد محجوزة لهذا الفريق بعد</p>
                    </div>
                ) : (
                    <div className="relative space-y-2 pr-1">
                        {/* Vertical spine */}
                        <div className="absolute top-1 bottom-1 right-[34px] w-px bg-slate-200" aria-hidden />
                        <AnimatePresence>
                            {sortedAppointments.map(app => {
                                const time = normalizeTimeSlot(app.timeSlot);
                                return (
                                    <motion.div
                                        key={app.id}
                                        initial={{ opacity: 0, x: 20 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        exit={{ opacity: 0, x: 20 }}
                                        className="relative flex items-stretch gap-2"
                                    >
                                        {/* Time rail */}
                                        <div className="flex flex-col items-center w-[30px] shrink-0 pt-1.5">
                                            <span className="text-[10px] font-mono font-bold text-emerald-700" dir="ltr">{time}</span>
                                            <span className="mt-1 w-2 h-2 rounded-full bg-emerald-400 border-2 border-emerald-50 z-10" />
                                        </div>

                                        {/* Card */}
                                        <div className="flex-1 bg-white border text-right border-emerald-100 rounded-lg p-2.5 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden">
                                            <div className="absolute top-0 right-0 w-1 h-full bg-emerald-400" />
                                            <div className="flex items-center gap-1.5 mb-1.5">
                                                <User className="w-3 h-3 text-emerald-600 shrink-0" />
                                                <p className="text-xs font-bold text-slate-800 truncate">{app.customerName}</p>
                                            </div>
                                            <div className="flex items-start gap-1.5 text-[10px] text-slate-600">
                                                <MapPin className="w-3 h-3 text-slate-400 shrink-0 mt-0.5" />
                                                <p className="leading-tight">{app.customerAddress}</p>
                                            </div>
                                            {app.occupation && (
                                                <p className="text-[9px] text-slate-500 mt-1.5 bg-slate-50 inline-block px-1.5 py-0.5 rounded border border-slate-100 mr-4">
                                                    المهنة: {app.occupation}
                                                </p>
                                            )}
                                        </div>
                                    </motion.div>
                                );
                            })}
                        </AnimatePresence>
                    </div>
                )}
            </div>
        </div>
    );
}
