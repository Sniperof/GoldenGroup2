import React, { useState } from 'react';
import { useCandidateStore } from '../../hooks/useCandidateStore';
import { UserPlus, Search, Filter, Phone, Trash2, CheckCircle, XCircle, AlertCircle, FileText } from 'lucide-react';
import AddCandidateModal from './AddCandidateModal';
import { Candidate } from '../../lib/types';
import { getEntityContacts, getPrimaryContact } from '../../lib/contactUtils';

export default function CandidatesEntry() {
    const candidates = useCandidateStore(state => state.candidates);
    const referralSheets = useCandidateStore(state => state.referralSheets);
    const qualifyCandidate = useCandidateStore(state => state.qualifyCandidate);
    const markJunk = useCandidateStore(state => state.markJunk);

    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [filterStatus, setFilterStatus] = useState<'All' | 'New' | 'Qualified' | 'Junk'>('All');

    // Filter Logic
    const filteredCandidates = candidates.filter(c => {
        const matchesSearch =
            (c.firstName?.includes(searchTerm) || false) ||
            (c.nickname?.includes(searchTerm) || false) ||
            (c.mobile?.includes(searchTerm) || false) ||
            c.referralNameSnapshot.includes(searchTerm);

        const matchesStatus = filterStatus === 'All' ? true : c.status === filterStatus;

        return matchesSearch && matchesStatus;
    });

    return (
        <div className="h-full flex flex-col bg-slate-50" dir="rtl">
            {/* Toolbar */}
            <div className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-4">
                    <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
                        <UserPlus className="w-6 h-6 text-sky-600" />
                        إدارة أوراق الترشيح (Referral Sheets)
                    </h1>
                    <span className="px-3 py-1 bg-sky-100 text-sky-700 rounded-full text-sm font-bold border border-sky-200">
                        {filteredCandidates.length} اسم
                    </span>
                </div>
                <div className="flex items-center gap-3">
                    <div className="relative">
                        <Search className="absolute right-3 top-2.5 w-4 h-4 text-slate-400" />
                        <input
                            type="text"
                            placeholder="بحث (اسم، موبايل، وسيط)..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="pl-4 pr-10 py-2 w-64 rounded-xl border border-slate-200 focus:border-sky-400 focus:ring-2 focus:ring-sky-400/20 text-sm transition-all"
                        />
                    </div>
                    <select
                        value={filterStatus}
                        onChange={(e) => setFilterStatus(e.target.value as any)}
                        className="px-4 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm font-medium text-slate-600 focus:border-sky-400"
                    >
                        <option value="All">الكل</option>
                        <option value="New">جديد (New)</option>
                        <option value="Qualified">تم التحويل (Qualified)</option>
                        <option value="Junk">مرفوض (Junk)</option>
                    </select>
                    <button
                        onClick={() => setIsAddModalOpen(true)}
                        className="flex items-center gap-2 px-5 py-2.5 bg-sky-600 hover:bg-sky-700 text-white rounded-xl text-sm font-bold shadow-lg shadow-sky-600/20 transition-all hover:-translate-y-0.5"
                    >
                        <UserPlus className="w-4 h-4" />
                        إضافة اسم جديد
                    </button>
                </div>
            </div>

            {/* Table Area */}
            <div className="flex-1 overflow-auto p-6">
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                    <table className="w-full text-right">
                        <thead className="bg-slate-50 border-b border-slate-200">
                            <tr>
                                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">الاسم / اللقب</th>
                                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">الموبايل</th>
                                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">تفاصيل الورقة / المصدر</th>
                                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">المنطقة</th>
                                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">الحالة</th>
                                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">الإجراءات</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {filteredCandidates.length > 0 ? (
                                filteredCandidates.map((candidate) => {
                                    const sheet = referralSheets.find(s => s.id === candidate.referralSheetId);

                                    return (
                                        <tr key={candidate.id} className={`hover:bg-slate-50/80 transition-colors ${candidate.duplicateFlag ? 'bg-amber-50/30' : ''}`}>
                                            <td className="px-6 py-4">
                                                <div className="flex flex-col">
                                                    <span className="font-bold text-slate-800 text-sm">
                                                        {candidate.firstName ? `${candidate.firstName} ${candidate.lastName || ''}` : candidate.nickname}
                                                    </span>
                                                    {candidate.nickname && candidate.firstName && (
                                                        <span className="text-xs text-slate-400">({candidate.nickname})</span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="flex flex-col gap-1">
                                                    <div className="flex items-center gap-2 text-slate-600 font-mono text-sm" dir="ltr">
                                                        <Phone className="w-3 h-3 text-slate-400 shrink-0" />
                                                        <span>{getPrimaryContact(candidate).number}</span>
                                                    </div>
                                                    {getEntityContacts(candidate).length > 1 && (
                                                        <span className="text-[10px] font-bold text-sky-600 bg-sky-50 px-2 py-0.5 rounded-full border border-sky-100 self-start">
                                                            {getEntityContacts(candidate).length} أرقام تواصل
                                                        </span>
                                                    )}
                                                </div>
                                                {candidate.duplicateFlag && (
                                                    <div className="flex items-center gap-1 mt-1 text-amber-600 text-[10px] font-bold">
                                                        <AlertCircle className="w-3 h-3" />
                                                        مكرر ({candidate.duplicateType === 'Client' ? 'زبون' : 'مرشح'})
                                                    </div>
                                                )}
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="flex flex-col gap-1">
                                                    <div className="flex items-center gap-1.5">
                                                        <span className="px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700 text-[10px] font-bold border border-indigo-100">
                                                            {candidate.referralType}
                                                        </span>
                                                        <span className="text-xs font-bold text-slate-700">{candidate.referralNameSnapshot}</span>
                                                    </div>
                                                    <div className="flex items-center gap-1 text-[11px] text-slate-400">
                                                        <FileText className="w-3 h-3" />
                                                        {sheet ? `ورقة #${sheet.id}` : 'إدخال مباشر'} | {candidate.referralDate.split('T')[0]}
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <span className="text-sm text-slate-600">{candidate.addressText}</span>
                                            </td>
                                            <td className="px-6 py-4">
                                                <StatusBadge status={candidate.status} />
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="flex items-center gap-2">
                                                    {candidate.status === 'Suggested' && (
                                                        <>
                                                            <button
                                                                onClick={() => qualifyCandidate(candidate.id)}
                                                                title="تحويل لـ Lead"
                                                                className="p-1.5 rounded-lg text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700 transition-colors border border-transparent hover:border-emerald-200"
                                                            >
                                                                <CheckCircle className="w-4 h-4" />
                                                            </button>
                                                            <button
                                                                onClick={() => markJunk(candidate.id)}
                                                                title="رفض / Junk"
                                                                className="p-1.5 rounded-lg text-red-400 hover:bg-red-50 hover:text-red-600 transition-colors border border-transparent hover:border-red-200"
                                                            >
                                                                <XCircle className="w-4 h-4" />
                                                            </button>
                                                        </>
                                                    )}
                                                    {candidate.status === 'Qualified' && (
                                                        <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded border border-emerald-100">
                                                            ID: {candidate.convertedToLeadId}
                                                        </span>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })
                            ) : (
                                <tr>
                                    <td colSpan={6} className="px-6 py-12 text-center text-slate-400">
                                        <div className="flex flex-col items-center gap-2">
                                            <Search className="w-8 h-8 text-slate-200" />
                                            <p>لا توجد أسماء مطابقة للبحث</p>
                                        </div>
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            <AddCandidateModal isOpen={isAddModalOpen} onClose={() => setIsAddModalOpen(false)} />
        </div>
    );
}

function StatusBadge({ status }: { status: string }) {
    switch (status) {
        case 'New':
            return <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-sky-50 text-sky-700 border border-sky-100"><span className="w-1.5 h-1.5 rounded-full bg-sky-500"></span>جديد</span>;
        case 'Qualified':
            return <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-100"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>تم التحويل</span>;
        case 'Junk':
            return <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-red-50 text-red-700 border border-red-100"><span className="w-1.5 h-1.5 rounded-full bg-red-500"></span>مرفوض</span>;
        default:
            return <span className="text-xs text-slate-500">{status}</span>;
    }
}
