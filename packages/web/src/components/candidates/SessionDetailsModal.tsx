import React, { useState, useEffect } from 'react';
import { useCandidateStore } from '../../hooks/useCandidateStore';
import { X, Calendar, User, FileText, AlertCircle, Phone, MapPin, ShieldCheck } from 'lucide-react';
import QualificationModal from './QualificationModal';
import ClientModal from '../ClientModal';
import { Candidate, Client, GeoUnit } from '../../lib/types';
import { api } from '../../lib/api';
import { formatGeoUnitLastLevels } from '../GeoSmartSearch';

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
    const [isClientModalOpen, setIsClientModalOpen] = useState(false);
    const [clientInitialData, setClientInitialData] = useState<Client | null>(null);
    const [geoUnits, setGeoUnits] = useState<GeoUnit[]>([]);

    useEffect(() => {
        if (!isOpen) return;
        let active = true;
        api.geoUnits.list()
            .then(units => { if (active) setGeoUnits(units); })
            .catch(() => {});
        return () => { active = false; };
    }, [isOpen]);

    const handleOpenQualify = (candidate: Candidate) => {
        setActiveCandidateForQualify(candidate);
        setIsQualifyModalOpen(true);
    };

    const handleQualificationConfirmed = (candidate: Candidate) => {
        // Pre-fill the ClientModal with candidate data — same as CandidatesEntry page
        const prefilledClient: Partial<Client> = {
            firstName: candidate.firstName || '',
            lastName: candidate.lastName || '',
            nickname: candidate.nickname || '',
            name: `${candidate.firstName || ''} ${candidate.lastName || ''}`.trim() || candidate.nickname || '',
            mobile: candidate.mobile,
            contacts: candidate.contacts || [],
            neighborhood: candidate.geoUnitId?.toString() || '',
            detailedAddress: candidate.addressText || '',
            occupation: candidate.occupation || '',
            sourceChannel: candidate.referralOriginChannel,
            referrerType: candidate.referralType,
            referrerName: candidate.referralNameSnapshot,
            referralEntityId: candidate.referralEntityId,
            referralDate: candidate.referralDate,
            referralReason: candidate.referralReason,
            referralSheetId: candidate.referralSheetId,
            referralAddressText: candidate.addressText,
            isCandidate: false,
            candidateStatus: 'Lead',
        };
        setClientInitialData(prefilledClient as Client);
        setIsQualifyModalOpen(false);
        setIsClientModalOpen(true);
    };

    const handleSaveClient = (clientData: Client) => {
        if (!activeCandidateForQualify) return;
        try {
            qualifyCandidate(activeCandidateForQualify.id, clientData);
            setIsClientModalOpen(false);
            setClientInitialData(null);
            setActiveCandidateForQualify(null);
        } catch (err: any) {
            console.error('Failed to qualify candidate:', err);
        }
    };

    if (!isOpen || !sheetId) return null;

    const sheet = referralSheets.find(s => s.id === sheetId);
    if (!sheet) return null;

    const sheetCandidates = candidates
        .filter(c => c.referralSheetId === sheetId)
        .sort((a, b) => b.id - a.id);
    const getCandidateAddressDisplay = (candidate: Candidate) => {
        const savedText = candidate.addressText && candidate.addressText !== 'غير محدد' ? candidate.addressText : '';
        return formatGeoUnitLastLevels(geoUnits, candidate.geoUnitId) || savedText || '--';
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm" dir="rtl">
            <div className="bg-white rounded-2xl w-[95vw] max-w-6xl h-[90vh] shadow-2xl p-6 flex flex-col">
                <div className="flex justify-between items-start mb-6 shrink-0">
                    <div>
                        <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                            <FileText className="w-5 h-5 text-amber-600" />
                            تفاصيل لائحة الأسماء #{sheet.id}
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
                                    <th className="px-4 py-3 text-xs font-black text-slate-500 w-16">ID</th>
                                    <th className="px-4 py-3 text-xs font-black text-slate-600">الاسم المقترح</th>
                                    <th className="px-4 py-3 text-xs font-black text-slate-600">أرقام التواصل</th>
                                    <th className="px-4 py-3 text-xs font-black text-slate-600">العنوان</th>
                                    <th className="px-4 py-3 text-xs font-black text-slate-600">المهنة</th>
                                    <th className="px-4 py-3 text-xs font-black text-slate-600">الحالة</th>
                                    <th className="px-4 py-3 text-xs font-black text-slate-600 text-center w-24">الإجراءات</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {sheetCandidates.map(c => {
                                    const allNumbers = c.contacts && c.contacts.length > 0
                                        ? c.contacts.map(con => con.number).filter(Boolean)
                                        : c.mobile ? [c.mobile] : [];
                                    return (
                                    <tr key={c.id} className="hover:bg-slate-50/50 transition-colors group">
                                        {/* ID */}
                                        <td className="px-4 py-3">
                                            <span className="text-xs font-mono text-slate-400">#{c.id}</span>
                                        </td>
                                        {/* الاسم المقترح */}
                                        <td className="px-4 py-3">
                                            <span className="font-bold text-slate-800 text-sm">
                                                {[c.firstName, c.lastName].filter(Boolean).join(' ') || c.nickname || '--'}
                                            </span>
                                            {c.nickname && (c.firstName || c.lastName) && (
                                                <div className="text-[10px] text-slate-400 mt-0.5">({c.nickname})</div>
                                            )}
                                        </td>
                                        {/* أرقام التواصل */}
                                        <td className="px-4 py-3">
                                            {allNumbers.length > 0 ? (
                                                <div className="space-y-0.5">
                                                    {allNumbers.map((num, i) => (
                                                        <div key={i} className="flex items-center gap-1 text-slate-700 text-sm">
                                                            <Phone className="w-3 h-3 text-slate-400 shrink-0" />
                                                            <span className="font-mono tracking-wide" dir="ltr">{num}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            ) : (
                                                <span className="text-slate-300 text-sm">--</span>
                                            )}
                                        </td>
                                        {/* العنوان */}
                                        <td className="px-4 py-3">
                                            {getCandidateAddressDisplay(c) !== '--' ? (
                                                <div className="flex items-center gap-1.5 text-slate-600 text-sm">
                                                    <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                                    <span>{getCandidateAddressDisplay(c)}</span>
                                                </div>
                                            ) : (
                                                <span className="text-slate-300 text-sm">--</span>
                                            )}
                                        </td>
                                        {/* المهنة */}
                                        <td className="px-4 py-3">
                                            <span className="text-sm text-slate-600">{c.occupation || '--'}</span>
                                        </td>
                                        {/* الحالة */}
                                        <td className="px-4 py-3">
                                            <span className={`px-2 py-1 rounded text-[10px] font-bold border ${
                                                c.status === 'Suggested' ? 'bg-sky-50 text-sky-700 border-sky-200'
                                                : c.status === 'FollowUp' ? 'bg-amber-50 text-amber-700 border-amber-200'
                                                : c.status === 'Qualified' ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                                : 'bg-red-50 text-red-700 border-red-200'
                                            }`}>
                                                {c.status === 'Suggested' ? 'مقترح'
                                                : c.status === 'FollowUp' ? 'متابعة'
                                                : c.status === 'Qualified' ? (c.duplicateFlag ? 'تم الربط' : 'تم التحويل')
                                                : 'مرفوض'}
                                            </span>
                                            {c.duplicateFlag && (
                                                <div className={`text-[10px] font-bold mt-1 flex items-center gap-1 ${c.status === 'Qualified' ? 'text-emerald-600' : 'text-amber-500'}`}>
                                                    <AlertCircle className="w-3 h-3" />
                                                    {c.status === 'Qualified' ? 'زبون حالي' : 'احتمال تكرار'}
                                                </div>
                                            )}
                                        </td>
                                        {/* الإجراءات */}
                                        <td className="px-4 py-3 text-center">
                                            {(c.status === 'Suggested' || c.status === 'FollowUp') && (
                                                <button
                                                    onClick={() => handleOpenQualify(c)}
                                                    className="flex flex-col mx-auto items-center justify-center w-9 h-9 bg-sky-50 text-sky-600 hover:bg-sky-500 hover:text-white rounded-xl border border-sky-100 hover:border-sky-500 shadow-sm transition-all"
                                                    title="تأهيل والتحقق الذكي"
                                                >
                                                    <ShieldCheck className="w-4 h-4" />
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                    );
                                })}
                                {sheetCandidates.length === 0 && (
                                    <tr>
                                        <td colSpan={7} className="px-5 py-12 text-center text-slate-400">
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

            <ClientModal
                isOpen={isClientModalOpen}
                onClose={() => setIsClientModalOpen(false)}
                onSave={handleSaveClient}
                initialData={clientInitialData}
                geoUnits={geoUnits}
                fromCandidate={true}
            />
        </div>
    );
}
