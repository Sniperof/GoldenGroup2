import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Clock, MapPin, User, Calendar } from 'lucide-react';
import { Appointment, WORKING_HOURS } from '../../lib/types';

interface TeamAgendaPanelProps {
    appointments: Appointment[];
    date: string;
}

// Generate the hourly slots based on WORKING_HOURS
const getHourlySlots = () => {
    const slots = [];
    for (let i = WORKING_HOURS.start; i < WORKING_HOURS.end; i++) {
        slots.push(`${i.toString().padStart(2, '0')}:00`);
    }
    return slots;
};

export default function TeamAgendaPanel({ appointments, date }: TeamAgendaPanelProps) {
    const hourlySlots = getHourlySlots();

    // Helper to find appointments that fall into a specific hour slot
    // E.g., if slot is "09:00", we look for appointments where timeSlot starts with "09:"
    const getAppointmentsForSlot = (slotTime: string) => {
        const hourPrefix = slotTime.split(':')[0] + ':';
        return appointments.filter(app => app.timeSlot.startsWith(hourPrefix));
    };

    return (
        <div className="w-full bg-slate-50 border-gray-200 flex flex-col shrink-0 h-full overflow-hidden shadow-sm z-20">
            {/* Header */}
            <div className="px-4 py-3 border-b border-gray-200 bg-white shrink-0">
                <h2 className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-emerald-600" />
                    <span> مواعيد الفريق</span>
                </h2>
                <p className="text-[10px] text-slate-500 mt-1 mr-5">جدول الزيارات لليوم: {date}</p>
            </div>

            {/* Timetable */}
            <div className="flex-1 overflow-y-auto p-3 space-y-2 custom-scroll">
                {hourlySlots.map((slot, index) => {
                    const slotApps = getAppointmentsForSlot(slot);
                    const isBooked = slotApps.length > 0;

                    return (
                        <div key={slot} className="relative group">
                            {/* Time Label */}
                            <div className="flex items-center gap-2 mb-1">
                                <Clock className={`w-3 h-3 ${isBooked ? 'text-emerald-500' : 'text-slate-400'}`} />
                                <span className={`text-[10px] font-bold ${isBooked ? 'text-emerald-700' : 'text-slate-500'}`}>{slot}</span>
                            </div>

                            {/* Slot Content */}
                            {isBooked ? (
                                <div className="space-y-1.5 pl-2 border-r-2 border-emerald-400">
                                    <AnimatePresence>
                                        {slotApps.map(app => (
                                            <motion.div
                                                key={app.id}
                                                initial={{ opacity: 0, x: 20 }}
                                                animate={{ opacity: 1, x: 0 }}
                                                className="bg-white border text-right border-emerald-100 rounded-lg p-2.5 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden"
                                            >
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
                                                <div className="absolute top-2 left-2 px-1.5 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-100 rounded text-[9px] font-mono font-bold">
                                                    {app.timeSlot}
                                                </div>
                                            </motion.div>
                                        ))}
                                    </AnimatePresence>
                                </div>
                            ) : (
                                <div className="pl-2 border-r-2 border-dashed border-slate-200">
                                    <div className="bg-slate-50/50 border border-dashed border-slate-200 rounded-lg p-2.5 flex items-center justify-center min-h-[50px] group-hover:bg-slate-100/50 transition-colors">
                                        <p className="text-[10px] text-slate-400">وقت متاح</p>
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

