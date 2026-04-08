import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { X, MapPin, ShieldCheck, Calendar, User, AlertTriangle, FileText, Paperclip, History, ChevronDown, Wrench } from 'lucide-react';
import { api } from '../lib/api';
import type { EmergencyTicket, EmergencyTicketPriority, MaintenanceRequest, ClientRating } from '../lib/types';

interface Props {
    ticket: EmergencyTicket;
    onClose: () => void;
    onUpdate: (updates: Partial<EmergencyTicket>) => void;
}

const RATING_LABELS: Record<ClientRating, { label: string; color: string }> = {
    Committed: { label: 'ملتزم', color: 'bg-green-50 text-green-700 border-green-200' },
    NotCommitted: { label: 'غير ملتزم', color: 'bg-red-50 text-red-700 border-red-200' },
    Undefined: { label: 'غير محدد', color: 'bg-slate-50 text-slate-500 border-slate-200' },
};

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
    'New': { label: 'جديد', color: 'bg-blue-100 text-blue-700' },
    'Assigned': { label: 'معيّن', color: 'bg-amber-100 text-amber-700' },
    'In Progress': { label: 'قيد التنفيذ', color: 'bg-purple-100 text-purple-700' },
    'Completed': { label: 'مكتمل', color: 'bg-emerald-100 text-emerald-700' },
    'Cancelled': { label: 'ملغي', color: 'bg-slate-100 text-slate-500' },
};

const PRIORITY_CONFIG: Record<EmergencyTicketPriority, { label: string; color: string }> = {
    'Critical': { label: 'حرج', color: 'bg-red-500 text-white' },
    'High': { label: 'عالي', color: 'bg-orange-500 text-white' },
    'Normal': { label: 'عادي', color: 'bg-sky-100 text-sky-700' },
};

export default function TicketDetailsModal({ ticket, onClose, onUpdate }: Props) {
    const [maintenanceRequests, setMaintenanceRequests] = useState<MaintenanceRequest[]>([]);
    const [employees, setEmployees] = useState<any[]>([]);

    useEffect(() => {
        let active = true;

        Promise.all([api.maintenanceRequests.list(), api.employees.list()])
            .then(([requests, employeeList]) => {
                if (!active) return;
                setMaintenanceRequests(requests);
                setEmployees(employeeList);
            })
            .catch((error) => {
                console.error('Failed to load ticket detail dependencies:', error);
                if (!active) return;
                setMaintenanceRequests([]);
                setEmployees([]);
            });

        return () => {
            active = false;
        };
    }, []);

    const maintenanceHistory = useMemo(() => {
        if (!ticket.contractId) return [];
        return maintenanceRequests
            .filter(r => r.contractId === ticket.contractId)
            .sort((a, b) => new Date(b.requestDate).getTime() - new Date(a.requestDate).getTime());
    }, [ticket.contractId, maintenanceRequests]);

    const assignedTech = useMemo(() =>
        ticket.assignedTechnicianId ? employees.find(e => e.id === ticket.assignedTechnicianId) : null,
        [ticket.assignedTechnicianId, employees]
    );

    const rating = RATING_LABELS[ticket.clientRating || 'Undefined'];
    const status = STATUS_LABELS[ticket.status] || STATUS_LABELS['New'];
    const createdDate = new Date(ticket.createdAt);

    return (
        <div className="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={onClose}>
            <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="p-5 border-b border-gray-100 bg-gradient-to-l from-sky-50/80 to-white">
                    <div className="flex justify-between items-start">
                        <div className="flex items-center gap-3">
                            <div className="w-11 h-11 rounded-xl bg-sky-100 flex items-center justify-center text-sky-600 font-bold text-sm">
                                #{ticket.id}
                            </div>
                            <div>
                                <h2 className="text-lg font-bold text-slate-800">{ticket.clientName}</h2>
                                <div className="flex items-center gap-2 mt-1">
                                    <span className={`text-[11px] font-bold px-2 py-0.5 rounded-lg ${status.color}`}>{status.label}</span>

                                    {/* Priority dropdown (changeable from details) */}
                                    <select
                                        value={ticket.priority}
                                        onChange={e => onUpdate({ priority: e.target.value as EmergencyTicketPriority })}
                                        className={`text-[11px] font-bold px-2 py-0.5 rounded-lg border-0 cursor-pointer ${PRIORITY_CONFIG[ticket.priority].color}`}
                                    >
                                        <option value="Critical">حرج</option>
                                        <option value="High">عالي</option>
                                        <option value="Normal">عادي</option>
                                    </select>
                                </div>
                            </div>
                        </div>
                        <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg transition-colors">
                            <X className="w-5 h-5 text-slate-400" />
                        </button>
                    </div>
                </div>

                {/* Content */}
                <div className="p-6 overflow-y-auto flex-1 space-y-5">
                    {/* Info Grid */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                        <InfoCard icon={MapPin} label="العنوان" value={ticket.clientAddress} />
                        <InfoCard icon={ShieldCheck} label="التقييم">
                            <span className={`text-[11px] font-bold px-2 py-0.5 rounded-lg border ${rating.color}`}>{rating.label}</span>
                        </InfoCard>
                        <InfoCard icon={Wrench} label="الجهاز" value={ticket.deviceModelName || 'غير محدد'} />
                        <InfoCard icon={Calendar} label="التاريخ" value={`${createdDate.toLocaleDateString('ar-SY')} ${createdDate.toLocaleTimeString('ar-SY', { hour: '2-digit', minute: '2-digit' })}`} />
                        <InfoCard icon={User} label="مستقبل المكالمة" value={ticket.callReceiver} />
                        {assignedTech && (
                            <InfoCard icon={User} label="الفني المعيّن" value={assignedTech.name} />
                        )}
                    </div>

                    {/* Problem Description */}
                    <div className="bg-red-50/50 rounded-xl p-4 border border-red-100">
                        <div className="flex items-center gap-2 mb-2">
                            <AlertTriangle className="w-4 h-4 text-red-500" />
                            <span className="text-xs font-bold text-red-700">وصف المشكلة</span>
                        </div>
                        <p className="text-sm text-slate-700 leading-relaxed">{ticket.problemDescription}</p>
                    </div>

                    {/* Call Notes */}
                    {ticket.callNotes && (
                        <div className="bg-sky-50/50 rounded-xl p-4 border border-sky-100">
                            <div className="flex items-center gap-2 mb-2">
                                <FileText className="w-4 h-4 text-sky-500" />
                                <span className="text-xs font-bold text-sky-700">ملاحظات المكالمة</span>
                            </div>
                            <p className="text-sm text-slate-600 leading-relaxed">{ticket.callNotes}</p>
                        </div>
                    )}

                    {/* Attachments */}
                    {ticket.attachments && ticket.attachments.length > 0 && (
                        <div>
                            <div className="flex items-center gap-2 mb-2">
                                <Paperclip className="w-4 h-4 text-slate-400" />
                                <span className="text-xs font-bold text-slate-500">المرفقات ({ticket.attachments.length})</span>
                            </div>
                            <div className="flex gap-2 flex-wrap">
                                {ticket.attachments.map((att, i) => (
                                    <a key={i} href={att} target="_blank" rel="noopener noreferrer" className="w-20 h-20 rounded-lg overflow-hidden border border-gray-200 block hover:shadow-lg transition-shadow">
                                        <img src={att} alt="" className="w-full h-full object-cover" />
                                    </a>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Technical History */}
                    <div className="border-t border-gray-100 pt-5">
                        <div className="flex items-center gap-2 mb-3">
                            <History className="w-4 h-4 text-indigo-500" />
                            <span className="text-sm font-bold text-slate-700">السجل الفني للجهاز</span>
                            {maintenanceHistory.length > 0 && (
                                <span className="text-[10px] font-medium bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full">{maintenanceHistory.length} سجل</span>
                            )}
                        </div>

                        {maintenanceHistory.length === 0 ? (
                            <div className="bg-slate-50 rounded-xl p-6 text-center border border-slate-100">
                                <History className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                                <p className="text-xs text-slate-400">
                                    {ticket.contractId ? 'لا يوجد سجل صيانة سابق لهذا الجهاز' : 'لم يتم تحديد جهاز لهذا الطلب'}
                                </p>
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {maintenanceHistory.map((req) => {
                                    const tech = req.technicianId ? employees.find(e => e.id === req.technicianId) : null;
                                    const date = new Date(req.requestDate);
                                    return (
                                        <div key={req.id} className="bg-slate-50 rounded-xl p-3 border border-slate-100 hover:border-indigo-200 transition-colors">
                                            <div className="flex justify-between items-start gap-3">
                                                <div>
                                                    <div className="flex items-center gap-2 mb-1">
                                                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${req.visitType === 'Emergency' ? 'bg-red-100 text-red-700' :
                                                                req.visitType === 'Periodic' ? 'bg-indigo-100 text-indigo-700' :
                                                                    'bg-slate-100 text-slate-600'
                                                            }`}>
                                                            {req.visitType === 'Emergency' ? 'طوارئ' : req.visitType === 'Periodic' ? 'دوري' : req.visitType}
                                                        </span>
                                                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${req.resolutionStatus === 'Completed' ? 'bg-emerald-100 text-emerald-700' :
                                                                req.resolutionStatus === 'Pending' ? 'bg-amber-100 text-amber-700' :
                                                                    'bg-slate-100 text-slate-600'
                                                            }`}>
                                                            {req.resolutionStatus === 'Completed' ? 'مكتمل' :
                                                                req.resolutionStatus === 'Pending' ? 'معلق' : req.resolutionStatus}
                                                        </span>
                                                    </div>
                                                    <p className="text-xs text-slate-600">{req.problemDescription}</p>
                                                    {tech && <p className="text-[10px] text-slate-400 mt-1">الفني: {tech.name}</p>}
                                                </div>
                                                <span className="text-[10px] text-slate-400 whitespace-nowrap">{date.toLocaleDateString('ar-SY')}</span>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-gray-100 bg-gray-50 flex justify-end">
                    <button onClick={onClose} className="px-5 py-2.5 text-sm font-medium text-slate-600 hover:text-slate-800 transition-colors bg-white border border-gray-200 rounded-xl hover:bg-slate-50">
                        إغلاق
                    </button>
                </div>
            </motion.div>
        </div>
    );
}

// --- Helper Component ---
function InfoCard({ icon: Icon, label, value, children }: { icon: typeof MapPin; label: string; value?: string; children?: React.ReactNode }) {
    return (
        <div className="bg-slate-50 rounded-xl p-3 border border-slate-100">
            <div className="flex items-center gap-1 mb-1">
                <Icon className="w-3 h-3 text-slate-400" />
                <span className="text-[10px] text-slate-400 font-bold">{label}</span>
            </div>
            {children || <p className="text-xs font-medium text-slate-700 truncate">{value}</p>}
        </div>
    );
}
