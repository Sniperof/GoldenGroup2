import React, { useState, useMemo, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useCandidateStore } from '../../hooks/useCandidateStore';
import { UserPlus, Search, Building2, MapPin, AlertCircle, ArrowRight, XCircle, FilePlus2, Download, Upload, Info, LayoutGrid, List, ShieldCheck, Edit, User } from 'lucide-react';
import AddCandidateModal from '../../components/candidates/AddCandidateModal';
import CreateReferralSheetModal from '../../components/candidates/CreateReferralSessionModal';
import ImportCSVModal from '../../components/candidates/ImportCSVModal';
import ReferralSheetDetailsModal from '../../components/candidates/SessionDetailsModal';
import QualificationModal from '../../components/candidates/QualificationModal';
import ClientModal from '../../components/ClientModal';
import { api } from '../../lib/api';
import { Client, Candidate, GeoUnit } from '../../lib/types';
import { usePermissions } from '../../hooks/usePermissions';
import { formatGeoUnitLastLevels } from '../../components/GeoSmartSearch';

const referralTypeLabels: Record<string, string> = {
    Personal: 'شخصي',
    Employee: 'موظف',
    Client: 'زبون',
    Unknown: 'غير معروف',
};

const getReferralTypeLabel = (type?: string | null) => {
    if (!type) return '--';
    return referralTypeLabels[type] || type;
};

export default function CandidatesEntry() {
    const { hasAnyPermission, hasPermission } = usePermissions();
    const canViewNameLists = hasAnyPermission('candidates.name_lists.view_list', 'referral_sheets.view_list');
    const canCreateNameLists = hasAnyPermission('candidates.name_lists.create', 'referral_sheets.create');
    const canCreateCandidates = hasPermission('candidates.create');

    // UI State
    const [activeTab, setActiveTab] = useState<'candidates' | 'sheets'>('candidates');
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [isCreateSheetOpen, setIsCreateSheetOpen] = useState(false);
    const [isImportModalOpen, setIsImportModalOpen] = useState(false);
    const [sheetDetailsId, setSheetDetailsId] = useState<number | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [errorModal, setErrorModal] = useState<string | null>(null);

    // Candidate Filters
    const [candidateStatusFilter, setCandidateStatusFilter] = useState('');
    const [candidateSupervisorFilter, setCandidateSupervisorFilter] = useState('');
    const [candidateBranchFilter, setCandidateBranchFilter] = useState('');

    // Sheet Filters
    const [sheetSearchQuery, setSheetSearchQuery] = useState('');
    const [sheetStatusFilter, setSheetStatusFilter] = useState('');
    const [sheetSupervisorFilter, setSheetSupervisorFilter] = useState('');
    const [sheetBranchFilter, setSheetBranchFilter] = useState('');

    // Pagination State
    const [candidatePage, setCandidatePage] = useState(1);
    const [sheetsPage, setSheetsPage] = useState(1);
    const ITEMS_PER_PAGE = 10;

    // Data Store
    const candidates = useCandidateStore(state => state.candidates);
    const referralSheets = useCandidateStore(state => state.referralSheets);
    const fetchData = useCandidateStore(state => state.fetchData);
    const qualifyCandidate = useCandidateStore(state => state.qualifyCandidate);
    const linkCandidateToClient = useCandidateStore(state => state.linkCandidateToClient);
    const markJunk = useCandidateStore(state => state.markJunk);
    const markForFollowUp = useCandidateStore(state => state.markForFollowUp);

    // New Qualification & Client Modals
    const [isQualifyModalOpen, setIsQualifyModalOpen] = useState(false);
    const [activeCandidateForQualify, setActiveCandidateForQualify] = useState<Candidate | null>(null);
    const [isClientModalOpen, setIsClientModalOpen] = useState(false);
    const [clientInitialData, setClientInitialData] = useState<Client | null>(null);
    const [editingCandidate, setEditingCandidate] = useState<Candidate | null>(null);
    const [geoUnits, setGeoUnits] = useState<GeoUnit[]>([]);

    // Derived: unique supervisors and branches for filter dropdowns
    const candidateSupervisors = useMemo(() =>
        [...new Set(candidates.flatMap(c => (c.assignments || []).map(a => a.userName)))].sort(),
        [candidates]
    );
    const candidateBranches = useMemo(() =>
        [...new Set(candidates.map(c => c.branchName).filter(Boolean) as string[])].sort(),
        [candidates]
    );
    const sheetSupervisors = useMemo(() =>
        [...new Set(referralSheets.map(s => s.assignedHrUserName).filter(Boolean) as string[])].sort(),
        [referralSheets]
    );
    const sheetBranches = useMemo(() =>
        [...new Set(referralSheets.map(s => s.branchName).filter(Boolean) as string[])].sort(),
        [referralSheets]
    );

    // Derived State: filtered candidates
    const filteredCandidates = useMemo(() =>
        candidates
            .filter(c => {
                const fullStr = `${c.firstName || ''} ${c.nickname || ''} ${c.lastName || ''} ${c.mobile}`.toLowerCase();
                if (searchQuery && !fullStr.includes(searchQuery.toLowerCase())) return false;
                if (candidateStatusFilter && c.status !== candidateStatusFilter) return false;
                if (candidateSupervisorFilter && !(c.assignments || []).some(a => a.userName === candidateSupervisorFilter)) return false;
                if (candidateBranchFilter && c.branchName !== candidateBranchFilter) return false;
                return true;
            })
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
        [candidates, searchQuery, candidateStatusFilter, candidateSupervisorFilter, candidateBranchFilter]
    );

    // Derived State: filtered sheets
    const filteredSheets = useMemo(() =>
        referralSheets.filter(s => {
            if (sheetSearchQuery) {
                const q = sheetSearchQuery.toLowerCase();
                if (!s.referralNameSnapshot.toLowerCase().includes(q)) return false;
            }
            if (sheetStatusFilter && s.status !== sheetStatusFilter) return false;
            if (sheetSupervisorFilter && s.assignedHrUserName !== sheetSupervisorFilter) return false;
            if (sheetBranchFilter && s.branchName !== sheetBranchFilter) return false;
            return true;
        }),
        [referralSheets, sheetSearchQuery, sheetStatusFilter, sheetSupervisorFilter, sheetBranchFilter]
    );

    // Pagination for Candidates
    const totalCandidatePages = Math.ceil(filteredCandidates.length / ITEMS_PER_PAGE);
    const paginatedCandidates = filteredCandidates.slice((candidatePage - 1) * ITEMS_PER_PAGE, candidatePage * ITEMS_PER_PAGE);

    // Pagination for Sheets
    const totalSheetsPages = Math.ceil(filteredSheets.length / ITEMS_PER_PAGE);
    const paginatedSheets = filteredSheets.slice((sheetsPage - 1) * ITEMS_PER_PAGE, sheetsPage * ITEMS_PER_PAGE);

    const handleOpenQualify = (candidate: Candidate) => {
        setActiveCandidateForQualify(candidate);
        setIsQualifyModalOpen(true);
    };

    const handleQualificationConfirmed = (candidate: Candidate) => {
        // Prepare pre-filled Client data
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
            candidateStatus: 'Lead'
        };

        setClientInitialData(prefilledClient as Client);
        setIsQualifyModalOpen(false);
        setIsClientModalOpen(true);
    };

    const handleSaveClient = (clientData: Client) => {
        if (!activeCandidateForQualify) return;

        // Perform the standard qualify action which saves to clients and updates candidate status
        try {
            qualifyCandidate(activeCandidateForQualify.id, clientData);
            setIsClientModalOpen(false);
            setClientInitialData(null);
            setActiveCandidateForQualify(null);
        } catch (err: any) {
            setErrorModal(err.message);
        }
    };

    useEffect(() => {
        void fetchData();
    }, [fetchData]);

    useEffect(() => {
        let active = true;

        api.geoUnits.list()
            .then((units) => {
                if (active) setGeoUnits(units);
            })
            .catch((error) => {
                console.error('Failed to load geo units in candidates entry:', error);
                if (active) setGeoUnits([]);
            });

        return () => {
            active = false;
        };
    }, []);

    const getNeighborhoodHierarchy = (id?: string) => {
        if (!id) return '--';
        const nId = parseInt(id);
        const neighborhood = geoUnits.find(gu => gu.id === nId);
        if (!neighborhood) return '--';
        const subArea = geoUnits.find(gu => gu.id === neighborhood.parentId);
        if (!subArea) return neighborhood.name;
        return `${subArea.name} > ${neighborhood.name}`;
    };

    const getCandidateAddressDisplay = (candidate: Candidate) => {
        const savedText = candidate.addressText && candidate.addressText !== 'غير محدد' ? candidate.addressText : '';
        return formatGeoUnitLastLevels(geoUnits, candidate.geoUnitId) || savedText || '--';
    };

    return (
        <div className="p-8 space-y-6" dir="rtl">
            {/* Error Message Modal */}
            {errorModal && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
                    <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl p-6 text-center">
                        <div className="w-12 h-12 mx-auto bg-red-100 text-red-600 rounded-full flex items-center justify-center mb-4"><AlertCircle className="w-6 h-6" /></div>
                        <h3 className="text-lg font-bold text-slate-800 mb-2">تنبيه النظام</h3>
                        <p className="text-sm text-slate-600 mb-6">{errorModal}</p>
                        <button onClick={() => setErrorModal(null)} className="w-full bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-2.5 rounded-xl transition-all">إغلاق</button>
                    </div>
                </div>
            )}

            {/* Header & Tabs */}
            <div className="flex flex-col gap-6">
                <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-bold text-slate-800">سجلات الأسماء المقترحة</h1>
                        <p className="text-sm text-slate-500 mt-1">فلترة، تدقيق، وتوجيه الأسماء الجديدة</p>
                    </div>
                    <div className="flex gap-2">
                        {canCreateNameLists && (
                        <button onClick={() => setIsCreateSheetOpen(true)} className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 rounded-xl font-bold shadow-sm transition-all text-sm">
                            <FilePlus2 className="w-4 h-4" /> لائحة جديدة
                        </button>
                        )}
                        {canCreateCandidates && (
                        <button onClick={() => setIsAddModalOpen(true)} className="flex items-center gap-2 px-5 py-2 bg-sky-600 hover:bg-sky-700 text-white text-sm font-bold rounded-xl shadow-md shadow-sky-500/20 transition-all">
                            <UserPlus className="w-4 h-4" /> إضافة اسم
                        </button>
                        )}
                    </div>
                </div>

                {/* Tabs Navigation */}
                <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl w-fit">
                    <button
                        onClick={() => setActiveTab('candidates')}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all ${activeTab === 'candidates' ? 'bg-white text-sky-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                        <List className="w-4 h-4" /> سجل الأسماء ({filteredCandidates.length})
                    </button>
                    {canViewNameLists && (
                    <button
                        onClick={() => setActiveTab('sheets')}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all ${activeTab === 'sheets' ? 'bg-white text-amber-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                        <LayoutGrid className="w-4 h-4" /> لوائح الأسماء ({filteredSheets.length})
                    </button>
                    )}
                </div>
            </div>

            {/* TAB CONTENT: Candidates List */}
            {activeTab === 'candidates' && (
                <div className="flex flex-col border rounded-2xl border-slate-200 bg-white shadow-sm overflow-hidden">
                    {/* Filters Bar for Candidates */}
                    <div className="p-4 border-b border-slate-100 bg-slate-50/30 flex flex-wrap gap-3 items-center">
                        <div className="relative flex-1 min-w-[180px]">
                            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                            <input
                                type="text"
                                placeholder="بحث (اسم، رقم، وسيط)..."
                                value={searchQuery}
                                onChange={(e) => { setSearchQuery(e.target.value); setCandidatePage(1); }}
                                className="w-full pl-4 pr-10 py-2 rounded-xl border border-slate-200 focus:border-sky-400 focus:ring-2 focus:ring-sky-400/20 text-sm"
                            />
                        </div>
                        <select
                            value={candidateStatusFilter}
                            onChange={(e) => { setCandidateStatusFilter(e.target.value); setCandidatePage(1); }}
                            className="py-2 px-3 rounded-xl border border-slate-200 focus:border-sky-400 focus:ring-2 focus:ring-sky-400/20 text-sm bg-white text-slate-700"
                        >
                            <option value="">كل الحالات</option>
                            <option value="Suggested">مقترح</option>
                            <option value="FollowUp">متابعة</option>
                            <option value="Qualified">محوَّل</option>
                            <option value="Junk">مرفوض</option>
                        </select>
                        {candidateSupervisors.length > 0 && (
                            <select
                                value={candidateSupervisorFilter}
                                onChange={(e) => { setCandidateSupervisorFilter(e.target.value); setCandidatePage(1); }}
                                className="py-2 px-3 rounded-xl border border-slate-200 focus:border-sky-400 focus:ring-2 focus:ring-sky-400/20 text-sm bg-white text-slate-700"
                            >
                                <option value="">كل المسؤولين</option>
                                {candidateSupervisors.map(s => <option key={s} value={s}>{s}</option>)}
                            </select>
                        )}
                        {candidateBranches.length > 0 && (
                            <select
                                value={candidateBranchFilter}
                                onChange={(e) => { setCandidateBranchFilter(e.target.value); setCandidatePage(1); }}
                                className="py-2 px-3 rounded-xl border border-slate-200 focus:border-sky-400 focus:ring-2 focus:ring-sky-400/20 text-sm bg-white text-slate-700"
                            >
                                <option value="">كل الفروع</option>
                                {candidateBranches.map(b => <option key={b} value={b}>{b}</option>)}
                            </select>
                        )}
                        {(searchQuery || candidateStatusFilter || candidateSupervisorFilter || candidateBranchFilter) && (
                            <button
                                onClick={() => { setSearchQuery(''); setCandidateStatusFilter(''); setCandidateSupervisorFilter(''); setCandidateBranchFilter(''); setCandidatePage(1); }}
                                className="flex items-center gap-1 text-xs text-slate-500 hover:text-red-600 transition-colors"
                            >
                                <XCircle className="w-4 h-4" /> مسح الفلاتر
                            </button>
                        )}
                    </div>

                    <div className="flex-1 overflow-y-auto custom-scroll" style={{ maxHeight: '480px' }}>
                        <table className="w-full text-sm text-right border-collapse">
                            <thead className="sticky top-0 z-10 bg-slate-50 border-b border-slate-200 shadow-sm">
                                <tr className="text-slate-600 font-bold text-xs uppercase tracking-wider">
                                    <th className="px-5 h-12">ID</th>
                                    <th className="px-5 h-12">الاسم المقترح</th>
                                    <th className="px-5 h-12">أرقام التواصل</th>
                                    <th className="px-5 h-12">العنوان</th>
                                    <th className="px-5 h-12">اسم الوسيط</th>
                                    <th className="px-5 h-12">نوع الترشيح</th>
                                    <th className="px-5 h-12">أضيف بواسطة</th>
                                    <th className="px-5 h-12">المسؤولون</th>
                                    <th className="px-5 h-12">الفرع</th>
                                    <th className="px-5 h-12">الحالة</th>
                                    <th className="px-5 h-12 text-center">الإجراءات</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {paginatedCandidates.length === 0 ? (
                                    <tr><td colSpan={11} className="px-6 py-12 text-center text-slate-400 font-medium">لا توجد بيانات</td></tr>
                                ) : (
                                    paginatedCandidates.map(c => {
                                        const nameStr = c.firstName
                                            ? `${c.firstName} ${c.lastName || ''} ${c.nickname ? `(${c.nickname})` : ''}`.trim()
                                            : `${c.nickname || ''} ${c.lastName || ''}`.trim();

                                        const primaryPhone = c.contacts?.find(con => con.isPrimary)?.number || c.contacts?.[0]?.number || c.mobile;
                                        const extraCount = Math.max(0, (c.contacts?.length || 0) - 1);
                                        const allPhones = c.contacts?.map(con => con.number).join('\n') || '';

                                        return (
                                            <tr key={c.id} className="hover:bg-slate-50 transition-colors h-12 group">
                                                <td className="px-5 py-2 font-mono text-xs text-slate-500">#{c.id}</td>
                                                <td className="px-5 py-2">
                                                    <div className="font-bold text-slate-800">{nameStr}</div>
                                                </td>
                                                <td className="px-5 py-2 text-right" dir="ltr">
                                                    <div className="flex items-center justify-end gap-1.5 font-mono text-xs text-slate-700">
                                                        <span>{primaryPhone}</span>
                                                        {extraCount > 0 && (
                                                            <span className="bg-sky-100 text-sky-700 px-1.5 py-0.5 rounded cursor-help font-bold" title={allPhones}>
                                                                +{extraCount}
                                                            </span>
                                                        )}
                                                    </div>
                                                </td>
                                                <td className="px-5 py-2 text-xs text-slate-600">
                                                    <span className="inline-flex items-center gap-1.5">
                                                        <MapPin className="w-3 h-3 text-slate-400" />
                                                        {getCandidateAddressDisplay(c)}
                                                    </span>
                                                </td>
                                                <td className="px-5 py-2 text-xs font-medium text-slate-700">
                                                    {c.referralType === 'Client' && c.referralEntityId ? (
                                                        <Link to={`/clients/${c.referralEntityId}`} className="text-sky-600 hover:text-sky-800 hover:underline">
                                                            {c.referralNameSnapshot || 'زبون مجهول'}
                                                        </Link>
                                                    ) : (
                                                        <span>{c.referralNameSnapshot || '--'}</span>
                                                    )}
                                                </td>
                                                <td className="px-5 py-2 text-xs">
                                                    {c.referralSheetId ? (
                                                        <button onClick={() => setSheetDetailsId(c.referralSheetId!)} className="text-sky-600 hover:underline font-medium">
                                                            لائحة #{c.referralSheetId}
                                                        </button>
                                                    ) : (
                                                        <span className="text-slate-600">مباشر</span>
                                                    )}
                                                </td>
                                                <td className="px-5 py-2 text-xs">
                                                    {c.createdByUserName ? (
                                                        <div className="leading-5">
                                                            <div className="font-bold text-slate-700">{c.createdByUserName}</div>
                                                            {c.createdByRoleDisplayName && (
                                                                <div className="text-slate-400">{c.createdByRoleDisplayName}</div>
                                                            )}
                                                        </div>
                                                    ) : (
                                                        <span className="text-slate-400">--</span>
                                                    )}
                                                </td>
                                                <td className="px-5 py-2 text-xs">
                                                    {(() => {
                                                        const list = c.assignments || [];
                                                        if (list.length === 0) return <span className="text-slate-400">--</span>;
                                                        const visible = list.slice(0, 2);
                                                        const extra = list.length - visible.length;
                                                        return (
                                                            <div className="flex flex-col gap-0.5">
                                                                {visible.map((a, i) => (
                                                                    <div key={i} className="leading-4">
                                                                        <span className="font-bold text-slate-700">{a.userName}</span>
                                                                        {a.roleDisplayName && <span className="text-slate-400"> · {a.roleDisplayName}</span>}
                                                                    </div>
                                                                ))}
                                                                {extra > 0 && <span className="text-[10px] text-sky-500 font-bold">+{extra} آخرين</span>}
                                                            </div>
                                                        );
                                                    })()}
                                                </td>
                                                <td className="px-5 py-2 text-xs">
                                                    {c.branchName ? (
                                                        <span className="flex items-center gap-1 text-slate-600">
                                                            <Building2 className="w-3 h-3 text-slate-400" />{c.branchName}
                                                        </span>
                                                    ) : (
                                                        <span className="text-slate-400">--</span>
                                                    )}
                                                </td>
                                                <td className="px-5 py-2 text-xs">
                                                    <span className={`px-2 py-0.5 rounded text-[10px] font-black border ${c.status === 'Suggested' ? 'bg-sky-50 text-sky-700 border-sky-100' : c.status === 'Qualified' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-red-50 text-red-700 border-red-100'}`}>
                                                        {c.status === 'Suggested' ? 'مقترح' : c.status === 'FollowUp' ? 'متابعة' : c.status === 'Qualified' ? (c.duplicateFlag ? 'تم الربط' : 'تم التحويل') : 'مرفوض'}
                                                    </span>
                                                </td>
                                                <td className="px-5 py-2">
                                                    <div className="flex items-center justify-center gap-2">
                                                        {(c.status === 'Suggested' || c.status === 'FollowUp') && (
                                                            <button
                                                                onClick={() => handleOpenQualify(c)}
                                                                className="w-8 h-8 flex items-center justify-center bg-sky-50 text-sky-600 hover:bg-sky-600 hover:text-white rounded-lg border border-sky-100 transition-all"
                                                                title="تأهيل"
                                                            >
                                                                <ShieldCheck className="w-4 h-4" />
                                                            </button>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })
                                )}
                            </tbody>
                        </table>
                    </div>

                    {/* Footer Pagination */}
                    {filteredCandidates.length > 0 && (
                        <div className="sticky bottom-0 bg-white z-10 border-t border-slate-100 p-3 flex items-center justify-between">
                            <span className="text-xs font-bold text-slate-500">
                                عرض {Math.min(filteredCandidates.length, (candidatePage - 1) * ITEMS_PER_PAGE + 1)}-{Math.min(filteredCandidates.length, candidatePage * ITEMS_PER_PAGE)} من {filteredCandidates.length}
                            </span>
                            <div className="flex items-center gap-2">
                                <button
                                    disabled={candidatePage === 1}
                                    onClick={() => setCandidatePage(p => p - 1)}
                                    className="px-3 py-1 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold disabled:opacity-30"
                                >السابق</button>
                                <span className="text-xs font-black text-sky-700 bg-sky-50 px-2.5 py-1 rounded-lg border border-sky-100">{candidatePage}</span>
                                <button
                                    disabled={candidatePage === totalCandidatePages || totalCandidatePages === 0}
                                    onClick={() => setCandidatePage(p => p + 1)}
                                    className="px-3 py-1 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold disabled:opacity-30"
                                >التالي</button>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* TAB CONTENT: Sheets List */}
            {activeTab === 'sheets' && canViewNameLists && (
                <div className="flex flex-col border rounded-2xl border-slate-200 bg-white shadow-sm overflow-hidden">
                    {/* Filters Bar for Sheets */}
                    <div className="p-4 border-b border-slate-100 bg-amber-50/20 flex flex-wrap gap-3 items-center">
                        <div className="relative flex-1 min-w-[180px]">
                            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                            <input
                                type="text"
                                placeholder="بحث باسم الوسيط..."
                                value={sheetSearchQuery}
                                onChange={(e) => { setSheetSearchQuery(e.target.value); setSheetsPage(1); }}
                                className="w-full pl-4 pr-10 py-2 rounded-xl border border-amber-200 focus:border-amber-400 focus:ring-2 focus:ring-amber-400/20 text-sm bg-white"
                            />
                        </div>
                        <select
                            value={sheetStatusFilter}
                            onChange={(e) => { setSheetStatusFilter(e.target.value); setSheetsPage(1); }}
                            className="py-2 px-3 rounded-xl border border-amber-200 focus:border-amber-400 focus:ring-2 focus:ring-amber-400/20 text-sm bg-white text-slate-700"
                        >
                            <option value="">كل الحالات</option>
                            <option value="New">نشط</option>
                            <option value="Completed">مكتمل</option>
                            <option value="Archived">مؤرشف</option>
                        </select>
                        {sheetSupervisors.length > 0 && (
                            <select
                                value={sheetSupervisorFilter}
                                onChange={(e) => { setSheetSupervisorFilter(e.target.value); setSheetsPage(1); }}
                                className="py-2 px-3 rounded-xl border border-amber-200 focus:border-amber-400 focus:ring-2 focus:ring-amber-400/20 text-sm bg-white text-slate-700"
                            >
                                <option value="">كل المشرفات</option>
                                {sheetSupervisors.map(s => <option key={s} value={s}>{s}</option>)}
                            </select>
                        )}
                        {sheetBranches.length > 0 && (
                            <select
                                value={sheetBranchFilter}
                                onChange={(e) => { setSheetBranchFilter(e.target.value); setSheetsPage(1); }}
                                className="py-2 px-3 rounded-xl border border-amber-200 focus:border-amber-400 focus:ring-2 focus:ring-amber-400/20 text-sm bg-white text-slate-700"
                            >
                                <option value="">كل الفروع</option>
                                {sheetBranches.map(b => <option key={b} value={b}>{b}</option>)}
                            </select>
                        )}
                        {(sheetSearchQuery || sheetStatusFilter || sheetSupervisorFilter || sheetBranchFilter) && (
                            <button
                                onClick={() => { setSheetSearchQuery(''); setSheetStatusFilter(''); setSheetSupervisorFilter(''); setSheetBranchFilter(''); setSheetsPage(1); }}
                                className="flex items-center gap-1 text-xs text-slate-500 hover:text-red-600 transition-colors"
                            >
                                <XCircle className="w-4 h-4" /> مسح الفلاتر
                            </button>
                        )}
                    </div>

                    <div className="flex-1 overflow-y-auto custom-scroll" style={{ maxHeight: '480px' }}>
                        <table className="w-full text-sm text-right border-collapse">
                            <thead className="sticky top-0 z-10 bg-slate-50 border-b border-slate-200 shadow-sm">
                                <tr className="text-slate-600 font-bold text-xs uppercase tracking-wider">
                                    <th className="px-5 h-12 text-right">رقم الورقة / المصدر</th>
                                    <th className="px-5 h-12 text-right">المشرفة</th>
                                    <th className="px-5 h-12 text-right">الفرع</th>
                                    <th className="px-5 h-12 text-center">الأسماء</th>
                                    <th className="px-5 h-12 text-center">الجودة</th>
                                    <th className="px-5 h-12 text-center">التحويل</th>
                                    <th className="px-5 h-12 text-center">الحالة</th>
                                    <th className="px-5 h-12 text-center">عرض</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {paginatedSheets.length === 0 ? (
                                    <tr><td colSpan={8} className="px-6 py-12 text-center text-slate-400 font-medium font-bold">لا توجد نتائج مطابقة للفلاتر المحددة</td></tr>
                                ) : (
                                    paginatedSheets.map(sheet => (
                                        <tr key={sheet.id} className="hover:bg-amber-50/30 transition-colors h-12 group">
                                            <td className="px-5 py-2">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-8 h-8 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center font-black text-[10px]">
                                                        {sheet.id}
                                                    </div>
                                                    <div>
                                                        <div className="font-bold text-slate-800 group-hover:text-amber-700 transition-colors">{sheet.referralNameSnapshot}</div>
                                                        <div className="text-[10px] text-slate-400">{getReferralTypeLabel(sheet.referralType)}</div>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-5 py-2 text-xs">
                                                {sheet.assignedHrUserName ? (
                                                    <span className="flex items-center gap-1 text-violet-700 font-medium">
                                                        <User className="w-3 h-3" />{sheet.assignedHrUserName}
                                                    </span>
                                                ) : (
                                                    <span className="text-slate-400">--</span>
                                                )}
                                            </td>
                                            <td className="px-5 py-2 text-xs">
                                                {sheet.branchName ? (
                                                    <span className="flex items-center gap-1 text-slate-600">
                                                        <Building2 className="w-3 h-3 text-slate-400" />{sheet.branchName}
                                                    </span>
                                                ) : (
                                                    <span className="text-slate-400">--</span>
                                                )}
                                            </td>
                                            <td className="px-5 py-2 text-center font-bold text-slate-700">{sheet.stats?.totalCandidates || 0}</td>
                                            <td className="px-5 py-2 text-center">
                                                <span className="bg-blue-50 text-blue-700 px-2 py-0.5 rounded-lg border border-blue-100 font-bold text-[10px]">{sheet.stats?.qualityPercentage || 0}%</span>
                                            </td>
                                            <td className="px-5 py-2 text-center">
                                                <span className="bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-lg border border-emerald-100 font-bold text-[10px]">{sheet.stats?.conversionPercentage || 0}%</span>
                                            </td>
                                            <td className="px-5 py-2 text-center">
                                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${sheet.status === 'New' ? 'bg-green-50 text-green-700 border-green-100' : sheet.status === 'Completed' ? 'bg-blue-50 text-blue-700 border-blue-100' : 'bg-slate-50 text-slate-500 border-slate-200'}`}>
                                                    {sheet.status === 'New' ? 'نشط' : sheet.status === 'Completed' ? 'مكتمل' : 'مؤرشف'}
                                                </span>
                                            </td>
                                            <td className="px-5 py-2 text-center">
                                                <button onClick={() => setSheetDetailsId(sheet.id)} className="w-8 h-8 mx-auto flex items-center justify-center bg-amber-50 text-amber-600 hover:bg-amber-500 hover:text-white rounded-lg border border-amber-100 transition-all">
                                                    <LayoutGrid className="w-4 h-4" />
                                                </button>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>

                    {/* Footer Pagination */}
                    {filteredSheets.length > 0 && (
                        <div className="sticky bottom-0 bg-white z-10 border-t border-slate-100 p-3 flex items-center justify-between">
                            <span className="text-xs font-bold text-slate-500">
                                عرض {Math.min(filteredSheets.length, (sheetsPage - 1) * ITEMS_PER_PAGE + 1)}-{Math.min(filteredSheets.length, sheetsPage * ITEMS_PER_PAGE)} من {filteredSheets.length}
                            </span>
                            <div className="flex items-center gap-2">
                                <button
                                    disabled={sheetsPage === 1}
                                    onClick={() => setSheetsPage(p => p - 1)}
                                    className="px-3 py-1 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold disabled:opacity-30"
                                >السابق</button>
                                <span className="text-xs font-black text-amber-700 bg-amber-50 px-2.5 py-1 rounded-lg border border-amber-100">{sheetsPage}</span>
                                <button
                                    disabled={sheetsPage === totalSheetsPages || totalSheetsPages === 0}
                                    onClick={() => setSheetsPage(p => p + 1)}
                                    className="px-3 py-1 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold disabled:opacity-30"
                                >التالي</button>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Modals */}
            <AddCandidateModal
                isOpen={isAddModalOpen}
                onClose={() => {
                    setIsAddModalOpen(false);
                    setEditingCandidate(null);
                }}
                initialData={editingCandidate || undefined}
                title="إضافة اسم مقترح جديد"
            />
            <CreateReferralSheetModal isOpen={isCreateSheetOpen} onClose={() => setIsCreateSheetOpen(false)} onSheetCreated={() => { if (canViewNameLists) setActiveTab('sheets'); }} />
            <ImportCSVModal isOpen={isImportModalOpen} onClose={() => setIsImportModalOpen(false)} />
            <ReferralSheetDetailsModal sheetId={sheetDetailsId} isOpen={sheetDetailsId !== null} onClose={() => setSheetDetailsId(null)} />

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
