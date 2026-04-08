import React, { useState } from 'react';
import { useCandidateStore } from '../../hooks/useCandidateStore';
import { X, Calendar, User, FileText, CheckCircle, Clock, Search, AlertCircle, Phone, MapPin, Share2, ShieldCheck } from 'lucide-react';
import QualificationModal from './QualificationModal';
import { Candidate } from '../../lib/types';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    sheetId: number | null;
}

export default function ReferralSheetDetailsModal({ isOpen, onClose, sheetId }: Props) {
    const referralSheets = useCandidateStore(state => state.referralSheets);
    const closeReferralSheet = useCandidateStore(state => state.closeReferralSheet);
    const candidates = useCandidateStore(state => state.candidates);
    const qualifyCandidate = useCandidateStore(state => state.qualifyCandidate);
    const linkCandidateToClient = useCandidateStore(state => state.linkCandidateToClient);
    const markJunk = useCandidateStore(state => state.markJunk);
    const markForFollowUp = useCandidateStore(state => state.markForFollowUp);

    const [isQualifyModalOpen, setIsQualifyModalOpen] = useState(false);
    const [activeCandidateForQualify, setActiveCandidateForQualify] = useState<Candidate | null>(null);

    const handleOpenQualify = (candidate: Candidate) => {
        setActiveCandidateForQualify(candidate);
        setIsQualifyModalOpen(true);
    };

    const handleQualificationConfirmed = (candidate: Candidate) => {
        qualifyCandidate(candidate.id);
        setIsQualifyModalOpen(false);
        setActiveCandidateForQualify(null);
    };

    if (!isOpen || !sheetId) return null;

    const sheet = referralSheets.find(s => s.id === sheetId);
    if (!sheet) return null;

    const sheetCandidates = candidates.filter(c => c.referralSheetId === sheetId); // Updated

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm" dir="rtl">
            <div className="bg-white rounded-2xl w-[95vw] max-w-6xl h-[90vh] shadow-2xl p-6 flex flex-col">
                <div className="flex justify-between items-start mb-6 shrink-0">
                    <div>
                        <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                            <FileText className="w-5 h-5 text-amber-600" />
                            تفاصيل ورقة الترشيح #{sheet.id}
                        </h2>
                        <p className="text-sm text-slate-500 mt-1">الوسيط: {sheet.referralNameSnapshot}</p>
                    </div>
                    <button onClick={onClose}><X className="w-5 h-5 text-slate-400" /></button>
                </div>

                <div className="grid grid-cols-2 gap-4 mb-6">
                    <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                        <span className="text-xs text-slate-400 block mb-1">تاريخ الورقة</span>
                        <div className="font-bold text-slate-700 flex items-center gap-2">
                            <Calendar className="w-4 h-4 text-sky-500" />
                            {sheet.referralDate.split('T')[0]}
                        </div>
                    </div>
                    <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                        <span className="text-xs text-slate-400 block mb-1">عدد الأسماء</span>
                        <div className="font-bold text-slate-700 flex items-center gap-2">
                            <User className="w-4 h-4 text-emerald-500" />
                            {sheet.stats?.totalCandidates || 0}
                        </div>
                    </div>
                </div>

                <div className="border-t border-slate-100 pt-4 overflow-hidden flex flex-col flex-1">
                    <h3 className="text-sm font-bold text-slate-700 mb-3 px-1">قائمة الأسماء في هذه الورقة</h3>
                    <div className="overflow-x-auto overflow-y-auto custom-scroll flex-1 rounded-xl border border-gray-200">
                        <table className="w-full text-right bg-white">
                            <thead className="bg-slate-50 border-b border-gray-200 sticky top-0 z-10 shadow-sm">
                                <tr>
                                    <th className="px-5 py-4 text-xs font-black text-slate-600">الاسم المقترح</th>
                                    <th className="px-5 py-4 text-xs font-black text-slate-600">البيانات ومكان السكن</th>
                                    <th className="px-5 py-4 text-xs font-black text-slate-600">المصدر</th>
                                    <th className="px-5 py-4 text-xs font-black text-slate-600">الحالة</th>
                                    <th className="px-5 py-4 text-xs font-black text-slate-600 text-center w-40">الإجراء</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {sheetCandidates.map(c => (
                                    <tr key={c.id} className="hover:bg-slate-50/50 transition-colors group">
                                        <td className="px-5 py-4">
                                            <div className="font-bold text-slate-800">{c.firstName} {c.nickname} {c.lastName}</div>
                                            <div className="text-[10px] text-slate-400 mt-1">ID: {c.id}</div>
                                        </td>
                                        <td className="px-5 py-4">
                                            <div className="flex items-center gap-1.5 text-slate-700 text-sm mb-1.5">
                                                <Phone className="w-3.5 h-3.5 text-slate-400" />
                                                <span className="font-mono tracking-wide" dir="ltr">{c.mobile}</span>
                                            </div>
                                            <div className="flex items-center gap-1.5 text-slate-500 text-xs">
                                                <MapPin className="w-3.5 h-3.5 text-slate-400" />
                                                {c.addressText}
                                            </div>
                                        </td>
                                        <td className="px-5 py-4">
                                            <span className="inline-flex items-center gap-1 px-2 py-1 bg-amber-50 text-amber-700 text-xs rounded border border-amber-100">
                                                <FileText className="w-3 h-3" /> ورقة ترشيح
                                            </span>
                                            <div className="text-[10px] text-slate-400 mt-1">{c.referralOriginChannel} | {c.referralDate.split('T')[0]}</div>
                                        </td>
                                        <td className="px-5 py-4">
                                            <span className={`px-2 py-1 rounded text-[10px] font-bold border ${c.status === 'Suggested' ? 'bg-sky-50 text-sky-700 border-sky-200' : c.status === 'FollowUp' ? 'bg-amber-50 text-amber-700 border-amber-200' : c.status === 'Qualified' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-red-50 text-red-700 border-red-200'}`}>
                                                {c.status === 'Suggested' ? 'مقترح' : c.status === 'FollowUp' ? 'متابعة' : c.status === 'Qualified' ? (c.duplicateFlag ? 'تم الربط' : 'تم التحويل') : 'مرفوض'}
                                            </span>
                                            {c.duplicateFlag && <div className={`text-[10px] font-bold mt-1 flex items-center gap-1 ${c.status === 'Qualified' ? 'text-emerald-600' : 'text-amber-500'}`}><AlertCircle className="w-3 h-3" /> {c.status === 'Qualified' ? 'زبون حالي' : 'احتمال تكرار'}</div>}
                                        </td>
                                        <td className="px-5 py-4 text-center">
                                            {(c.status === 'Suggested' || c.status === 'FollowUp') && (
                                                <button
                                                    onClick={() => handleOpenQualify(c)}
                                                    className="flex flex-col mx-auto items-center justify-center w-10 h-10 bg-sky-50 text-sky-600 hover:bg-sky-500 hover:text-white rounded-xl border border-sky-100 hover:border-sky-500 shadow-sm transition-all group"
                                                    title="تأهيل والتحقق الذكي"
                                                >
                                                    <ShieldCheck className="w-5 h-5 group-hover:scale-110 transition-transform" />
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                                {sheetCandidates.length === 0 && (
                                    <tr>
                                        <td colSpan={5} className="px-5 py-12 text-center text-slate-400">
                                            لا توجد أسماء مقترحة في هذه الورقة
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                <div className="mt-6 flex justify-end shrink-0">
                    {sheet.status !== 'Completed' && (
                        <button
                            onClick={() => { closeReferralSheet(sheet.id); onClose(); }}
                            className="px-4 py-2 bg-slate-800 text-white rounded-xl text-sm font-bold hover:bg-slate-900 transition-colors"
                        >
                            إغلاق الورقة (أرشفة)
                        </button>
                    )}
                </div>
            </div>

            <QualificationModal
                isOpen={isQualifyModalOpen}
                onClose={() => setIsQualifyModalOpen(false)}
                candidate={activeCandidateForQualify}
                onQualified={handleQualificationConfirmed}
                onJunk={(id) => { markJunk(id); setIsQualifyModalOpen(false); }}
                onFollowUp={(id) => { markForFollowUp(id); setIsQualifyModalOpen(false); }}
                onLink={(candidateId, client) => {
                    linkCandidateToClient(candidateId, client.id);
                    setIsQualifyModalOpen(false);
                    setActiveCandidateForQualify(null);
                }}
            />
        </div>
    );
}
