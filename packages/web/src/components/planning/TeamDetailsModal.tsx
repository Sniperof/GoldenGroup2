import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, PhoneCall, User, Briefcase, MapPin } from 'lucide-react';
import { Candidate, Client, GeoUnit } from '../../lib/types';

interface TeamDetailsModalProps {
    isOpen: boolean;
    onClose: () => void;
    teamKey: string;
    teamLabel: string;
    candidates: Candidate[];
    leads: Client[];
    geoUnits: GeoUnit[];
    onGenerate: (teamKey: string, candList: Candidate[], leadList: Client[]) => void;
}

export default function TeamDetailsModal({
    isOpen,
    onClose,
    teamKey,
    teamLabel,
    candidates,
    leads,
    geoUnits,
    onGenerate,
}: TeamDetailsModalProps) {
    if (!isOpen) return null;

    const totalCustomers = candidates.length + leads.length;

    const getGeoName = (id: number | null) => {
        const unit = geoUnits.find((geoUnit) => geoUnit.id === id);
        return unit ? unit.name : 'غير محدد';
    };

    const handleGenerateClick = () => {
        onGenerate(teamKey, candidates, leads);
        onClose();
    };

    return (
        <AnimatePresence>
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    onClick={onClose}
                    className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"
                />

                <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: 20 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: 20 }}
                    className="relative w-full max-w-4xl max-h-[90vh] bg-white rounded-2xl shadow-xl flex flex-col overflow-hidden"
                >
                    <div className="flex items-center justify-between p-6 border-b border-gray-100 bg-gray-50/50">
                        <div>
                            <h2 className="text-xl font-bold text-slate-800">{teamLabel}</h2>
                            <p className="text-sm text-slate-500 mt-1 flex items-center gap-2">
                                <Briefcase className="w-4 h-4 text-emerald-500" />
                                <span>إجمالي الزبائن المستهدفين: {totalCustomers}</span>
                            </p>
                        </div>
                        <button
                            onClick={onClose}
                            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>

                    <div className="flex-1 overflow-y-auto p-6 custom-scroll bg-slate-50/30">
                        {totalCustomers === 0 ? (
                            <div className="text-center py-12">
                                <MapPin className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                                <h3 className="text-lg font-bold text-slate-700">لا يوجد زبائن في مسار هذا الفريق</h3>
                                <p className="text-slate-500 mt-2">يرجى التأكد من تعيين مسار صحيح أو إضافة زبائن للمناطق المستهدفة.</p>
                            </div>
                        ) : (
                            <div className="space-y-4">
                                <div className="flex justify-between items-center">
                                    <h3 className="text-sm font-bold text-slate-700">قائمة الزبائن المستهدفين</h3>
                                    <button
                                        onClick={handleGenerateClick}
                                        className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white px-5 py-2.5 rounded-xl font-bold shadow-lg shadow-emerald-500/20 transition-all text-sm"
                                    >
                                        <PhoneCall className="w-4 h-4" />
                                        <span>توليد/تحديث قائمة الاتصال</span>
                                    </button>
                                </div>

                                <div className="bg-white border text-sm border-gray-200 rounded-xl overflow-hidden shadow-sm">
                                    <table className="w-full text-right">
                                        <thead className="bg-gray-50 border-b border-gray-200">
                                            <tr>
                                                <th className="px-4 py-3 font-semibold text-slate-600">الاسم</th>
                                                <th className="px-4 py-3 font-semibold text-slate-600">النوع</th>
                                                <th className="px-4 py-3 font-semibold text-slate-600">رقم الهاتف</th>
                                                <th className="px-4 py-3 font-semibold text-slate-600">العنوان</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-100">
                                            {candidates.map((candidate) => (
                                                <tr key={`cand-${candidate.id}`} className="hover:bg-slate-50/50 transition-colors">
                                                    <td className="px-4 py-3 text-slate-800 font-medium">
                                                        <div className="flex items-center gap-2">
                                                            <User className="w-4 h-4 text-blue-400" />
                                                            {`${candidate.firstName || ''} ${candidate.lastName || ''}`.trim() || candidate.nickname || 'بدون اسم'}
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-3"><span className="px-2 py-1 rounded bg-blue-50 text-blue-700 text-xs font-bold">اسم مقترح</span></td>
                                                    <td className="px-4 py-3 text-slate-600" dir="ltr">{candidate.mobile || (candidate.contacts && candidate.contacts.length > 0 ? candidate.contacts[0].number : '')}</td>
                                                    <td className="px-4 py-3 text-slate-500">{candidate.addressText || getGeoName(candidate.geoUnitId)}</td>
                                                </tr>
                                            ))}
                                            {leads.map((lead) => (
                                                <tr key={`lead-${lead.id}`} className="hover:bg-slate-50/50 transition-colors">
                                                    <td className="px-4 py-3 text-slate-800 font-medium">
                                                        <div className="flex items-center gap-2">
                                                            <Briefcase className="w-4 h-4 text-amber-500" />
                                                            {lead.name}
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-3"><span className="px-2 py-1 rounded bg-amber-50 text-amber-700 text-xs font-bold">زبون محتمل</span></td>
                                                    <td className="px-4 py-3 text-slate-600" dir="ltr">{lead.contacts?.find((contact) => contact.isPrimary)?.number || lead.contacts?.[0]?.number || '--'}</td>
                                                    <td className="px-4 py-3 text-slate-500">{getGeoName(parseInt(lead.neighborhood)) || lead.neighborhood}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="p-4 border-t border-gray-100 bg-white flex justify-end">
                        <button
                            onClick={onClose}
                            className="px-8 py-2.5 rounded-xl border border-gray-200 text-slate-600 font-bold hover:bg-gray-50 transition-colors"
                        >
                            إغلاق
                        </button>
                    </div>
                </motion.div>
            </div>
        </AnimatePresence>
    );
}
