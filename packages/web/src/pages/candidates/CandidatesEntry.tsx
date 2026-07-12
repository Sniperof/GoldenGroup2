import React, { useState, useMemo, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useCandidateStore } from '../../hooks/useCandidateStore';
import { UserPlus, Search, Building2, MapPin, AlertCircle, ArrowRight, XCircle, X, FilePlus2, Download, Upload, Info, LayoutGrid, List, ShieldCheck, Edit, User, SlidersHorizontal, ChevronDown } from 'lucide-react';
import DateField from '../../components/ui/DateField';
import AddCandidateModal from '../../components/candidates/AddCandidateModal';
import CreateReferralSheetModal from '../../components/candidates/CreateReferralSessionModal';
import ImportCSVModal from '../../components/candidates/ImportCSVModal';
import ReferralSheetDetailsModal from '../../components/candidates/SessionDetailsModal';
import QualificationModal from '../../components/candidates/QualificationModal';
import ClientModal from '../../components/ClientModal';
import BranchScopeIndicator from '../../components/BranchScopeIndicator';
import Select from '../../components/ui/Select';
import PageHeader from '../../components/ui/PageHeader';
import Modal from '../../components/ui/Modal';
import Input from '../../components/ui/Input';
import Toggle from '../../components/ui/Toggle';
import { api } from '../../lib/api';
import { Client, Candidate, GeoUnit } from '../../lib/types';
import { usePermissions } from '../../hooks/usePermissions';
import { useAuthStore } from '../../hooks/useAuthStore';
import { useBranchContextStore } from '../../hooks/useBranchContextStore';
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

// Canonical Arabic labels for ReferralOriginChannel — matches AddCandidateModal.tsx's
// data-entry Select exactly (Acquaintance/PhoneCall/SocialMedia/Campaign). 'App' isn't
// offered there (folded into SocialMedia on entry) but may exist in historical data.
const channelLabels: Record<string, string> = {
    Acquaintance: 'معرفة شخصية',
    PhoneCall: 'مكالمة هاتفية',
    SocialMedia: 'سوشال ميديا',
    Campaign: 'حملة إعلانية',
    App: 'من التطبيق',
};

const getChannelLabel = (channel?: string | null) => {
    if (!channel) return '--';
    return channelLabels[channel] || channel;
};

// Status badge: covers all 6 real values (the runtime value is 'New' — see the
// status filter options above for why 'Prospect' from the shared TS type is wrong).
// Previously only 3 of 6 were branched, so 'New' and 'Contacted' silently fell
// through to a red "مرفوض" (rejected) badge — fixed here.
function getCandidateStatusBadge(candidate: { status: string; duplicateFlag?: boolean }): { label: string; className: string } {
    switch (candidate.status) {
        case 'New':
            return { label: 'جديد', className: 'bg-slate-50 text-slate-600 border-slate-200' };
        case 'Suggested':
            return { label: 'مقترح', className: 'bg-sky-50 text-sky-700 border-sky-100' };
        case 'Contacted':
            return { label: 'تم الاتصال', className: 'bg-indigo-50 text-indigo-700 border-indigo-100' };
        case 'FollowUp':
            return { label: 'متابعة', className: 'bg-amber-50 text-amber-700 border-amber-100' };
        case 'Qualified':
            return {
                label: candidate.duplicateFlag ? 'تم الربط' : 'تم التحويل',
                className: 'bg-emerald-50 text-emerald-700 border-emerald-100',
            };
        case 'Junk':
        default:
            return { label: 'مرفوض', className: 'bg-red-50 text-red-700 border-red-100' };
    }
}

// Canonical Arabic labels reused by both the filter <Select> options and the
// active-filter chips, so a value and its chip always read the same word.
// Candidate status: runtime value is 'New' (DB CHECK) — NOT the shared type's
// 'Prospect' (documented drift, reporting-analytics.md §3.10 / candidates.md §9).
const candidateStatusLabels: Record<string, string> = {
    New: 'جديد', Suggested: 'مقترح', Contacted: 'تم الاتصال', FollowUp: 'متابعة', Qualified: 'محوَّل', Junk: 'مرفوض',
};
const sheetStatusLabels: Record<string, string> = {
    New: 'نشط', 'In-Progress': 'قيد الجمع', Completed: 'مكتمل', Archived: 'مؤرشف',
};
const confirmationLabels: Record<string, string> = {
    Pending: 'قيد الانتظار', Confirmed: 'مؤكَّد', Rejected: 'مرفوض',
};

// ─── Unified filter primitives (shared by both tabs) ───
// A labeled control slot inside the single filter panel. Every filter gets an
// explicit label so the panel reads as one flat, scannable grid — there is no
// "advanced" tier, just one place that holds every filter.
function FilterField({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
    return (
        <div className={`flex flex-col gap-1 ${wide ? 'sm:col-span-2' : ''}`}>
            <label className="px-1 text-[11px] font-bold text-slate-500">{label}</label>
            {children}
        </div>
    );
}

// A removable pill summarizing one applied filter — the always-visible answer to
// "which filters are currently applied?", each independently clearable.
function ActiveFilterChip({ label, value, onRemove, tone = 'sky' }: { label: string; value: string; onRemove: () => void; tone?: 'sky' | 'amber' }) {
    const toneCls = tone === 'amber'
        ? 'bg-amber-50 border-amber-200 text-amber-800'
        : 'bg-sky-50 border-sky-200 text-sky-700';
    return (
        <span className={`inline-flex items-center gap-1.5 rounded-lg border py-1 pr-2.5 pl-1.5 text-xs font-bold ${toneCls}`}>
            <span className="font-medium opacity-60">{label}:</span>
            <span className="max-w-[160px] truncate">{value}</span>
            <button type="button" onClick={onRemove} aria-label={`إزالة فلتر ${label}`} className="rounded p-0.5 transition-colors hover:bg-white/70">
                <X className="h-3 w-3" />
            </button>
        </span>
    );
}

export default function CandidatesEntry() {
    const { hasAnyPermission, hasPermission } = usePermissions();
    const canViewNameLists = hasAnyPermission('candidates.name_lists.view_list');
    const canCreateNameLists = hasAnyPermission('candidates.name_lists.create');
    const canCreateCandidates = hasPermission('candidates.create');
    const canEditCandidates = hasPermission('candidates.edit');

    // ─── Management branch filter (scope-driven, NOT identity-driven) ───
    // Mode follows candidates.view_list scope (the names tab governs the page;
    // both families share the same per-role scope after the 292/293 baseline):
    //  GLOBAL → active picker, BRANCH → locked badge, ASSIGNED → no filter.
    const getPermissionScope = useAuthStore(s => s.getPermissionScope);
    const authUser = useAuthStore(s => s.user);
    const candidatesViewScope = getPermissionScope('candidates.view_list');
    const isGlobalNames = candidatesViewScope === 'GLOBAL';
    const isBranchNames = candidatesViewScope === 'BRANCH';
    const branchContextId = useBranchContextStore(s => s.branchId);
    // Add rule (§5): a GLOBAL operator on "all branches" must pick a branch first —
    // no silent fallback into the base branch (SH-3). Branch/assigned users are pinned.
    const mustPickBranch = isGlobalNames && branchContextId == null;
    const [branchOptions, setBranchOptions] = useState<{ id: number; name: string }[]>([]);

    // UI State
    const [activeTab, setActiveTab] = useState<'candidates' | 'sheets'>('candidates');
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [isCreateSheetOpen, setIsCreateSheetOpen] = useState(false);
    const [isImportModalOpen, setIsImportModalOpen] = useState(false);
    const [sheetDetailsId, setSheetDetailsId] = useState<number | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [errorModal, setErrorModal] = useState<string | null>(null);

    // Candidate Filters — primary (always visible)
    const [candidateStatusFilter, setCandidateStatusFilter] = useState('');
    const [candidateSupervisorFilter, setCandidateSupervisorFilter] = useState('');
    const [candidateBranchFilter, setCandidateBranchFilter] = useState('');
    // Candidate Filters — the rest, all in the one unified panel (no separate tier)
    const [candidateFiltersOpen, setCandidateFiltersOpen] = useState(false);
    const [candidateConvertedFilter, setCandidateConvertedFilter] = useState<'' | 'converted' | 'unconverted'>('');
    const [candidateReferralTypeFilter, setCandidateReferralTypeFilter] = useState('');
    const [candidateChannelFilter, setCandidateChannelFilter] = useState('');
    const [candidateDuplicateFilter, setCandidateDuplicateFilter] = useState<'' | 'yes' | 'no'>('');
    const [candidateConfirmationFilter, setCandidateConfirmationFilter] = useState('');
    const [candidateCreatorFilter, setCandidateCreatorFilter] = useState('');
    const [candidateSourceFilter, setCandidateSourceFilter] = useState<'' | 'fromSheet' | 'direct'>('');
    const [candidateGeoFilter, setCandidateGeoFilter] = useState('');
    const [candidateDateFrom, setCandidateDateFrom] = useState('');
    const [candidateDateTo, setCandidateDateTo] = useState('');

    // Sheet Filters — primary (always visible)
    const [sheetSearchQuery, setSheetSearchQuery] = useState('');
    const [sheetStatusFilter, setSheetStatusFilter] = useState('');
    const [sheetBranchFilter, setSheetBranchFilter] = useState('');
    // Sheet Filters — the rest, all in the one unified panel. The three independent
    // roles (owner/assigned reviewer/creator) fully replace the old single merged
    // "supervisor" filter per docs/analysis/candidates-referral-sheets-filters-audit.md §2.2.
    const [sheetFiltersOpen, setSheetFiltersOpen] = useState(false);
    const [sheetOwnerFilter, setSheetOwnerFilter] = useState('');
    const [sheetAssignedReviewerFilter, setSheetAssignedReviewerFilter] = useState('');
    const [sheetCreatorFilter, setSheetCreatorFilter] = useState('');
    const [sheetSourceFilter, setSheetSourceFilter] = useState<'' | 'fromVisit' | 'manual'>('');
    const [sheetReferralTypeFilter, setSheetReferralTypeFilter] = useState('');
    const [sheetChannelFilter, setSheetChannelFilter] = useState('');
    const [sheetQualityMin, setSheetQualityMin] = useState('');
    const [sheetConversionMin, setSheetConversionMin] = useState('');
    const [sheetBehindTargetFilter, setSheetBehindTargetFilter] = useState(false);
    const [sheetDateFrom, setSheetDateFrom] = useState('');
    const [sheetDateTo, setSheetDateTo] = useState('');

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
    const sheetBranches = useMemo(() =>
        [...new Set(referralSheets.map(s => s.branchName).filter(Boolean) as string[])].sort(),
        [referralSheets]
    );

    // Derived option lists for the advanced candidate filters — dynamic, scoped to
    // the currently-visible data only (reporting-analytics.md §3.5-أ "شرط الظهور: عام").
    const candidateReferralTypes = useMemo(() =>
        [...new Set(candidates.map(c => c.referralType).filter(Boolean) as string[])].sort(),
        [candidates]
    );
    const candidateChannels = useMemo(() =>
        [...new Set(candidates.map(c => c.referralOriginChannel).filter(Boolean) as string[])].sort(),
        [candidates]
    );
    const candidateCreators = useMemo(() =>
        [...new Set(candidates.map(c => c.createdByUserName).filter(Boolean) as string[])].sort(),
        [candidates]
    );

    // Derived option lists for the advanced sheet filters (reporting-analytics.md §3.5-ب).
    const sheetOwners = useMemo(() =>
        [...new Set(referralSheets.map(s => s.ownerUserName).filter(Boolean) as string[])].sort(),
        [referralSheets]
    );
    // Assigned-reviewer name is only meaningful when assignedHrUserId is actually set —
    // in that case the merged assignedHrUserName IS the reviewer's name (COALESCE picks
    // it first), so no extra API field is needed to derive this list correctly.
    const sheetAssignedReviewers = useMemo(() =>
        [...new Set(referralSheets.filter(s => s.assignedHrUserId != null).map(s => s.assignedHrUserName).filter(Boolean) as string[])].sort(),
        [referralSheets]
    );
    const sheetCreators = useMemo(() =>
        [...new Set(referralSheets.map(s => s.createdByUserName).filter(Boolean) as string[])].sort(),
        [referralSheets]
    );
    const sheetReferralTypes = useMemo(() =>
        [...new Set(referralSheets.map(s => s.referralType).filter(Boolean) as string[])].sort(),
        [referralSheets]
    );
    const sheetChannels = useMemo(() =>
        [...new Set(referralSheets.map(s => s.referralOriginChannel).filter(Boolean) as string[])].sort(),
        [referralSheets]
    );

    // Derived State: filtered candidates
    const filteredCandidates = useMemo(() =>
        candidates
            .filter(c => {
                // Search covers referral_name_snapshot too (fixes the gap documented in
                // docs/analysis/candidates-referral-sheets-filters-audit.md §1.1 — the
                // placeholder promised "وسيط" search that the old implementation lacked).
                const fullStr = `${c.firstName || ''} ${c.nickname || ''} ${c.lastName || ''} ${c.mobile} ${c.referralNameSnapshot || ''}`.toLowerCase();
                if (searchQuery && !fullStr.includes(searchQuery.toLowerCase())) return false;
                if (candidateStatusFilter && c.status !== candidateStatusFilter) return false;
                if (candidateSupervisorFilter && !(c.assignments || []).some(a => a.userName === candidateSupervisorFilter)) return false;
                if (candidateBranchFilter && c.branchName !== candidateBranchFilter) return false;
                if (candidateConvertedFilter === 'converted' && c.convertedToLeadId == null) return false;
                if (candidateConvertedFilter === 'unconverted' && c.convertedToLeadId != null) return false;
                if (candidateReferralTypeFilter && c.referralType !== candidateReferralTypeFilter) return false;
                if (candidateChannelFilter && c.referralOriginChannel !== candidateChannelFilter) return false;
                if (candidateDuplicateFilter === 'yes' && !c.duplicateFlag) return false;
                if (candidateDuplicateFilter === 'no' && c.duplicateFlag) return false;
                if (candidateConfirmationFilter && c.referralConfirmationStatus !== candidateConfirmationFilter) return false;
                if (candidateCreatorFilter && c.createdByUserName !== candidateCreatorFilter) return false;
                if (candidateSourceFilter === 'fromSheet' && c.referralSheetId == null) return false;
                if (candidateSourceFilter === 'direct' && c.referralSheetId != null) return false;
                if (candidateGeoFilter && String(c.geoUnitId ?? '') !== candidateGeoFilter) return false;
                if (candidateDateFrom && new Date(c.createdAt) < new Date(candidateDateFrom)) return false;
                if (candidateDateTo && new Date(c.createdAt) > new Date(`${candidateDateTo}T23:59:59`)) return false;
                return true;
            })
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
        [
            candidates, searchQuery, candidateStatusFilter, candidateSupervisorFilter, candidateBranchFilter,
            candidateConvertedFilter, candidateReferralTypeFilter, candidateChannelFilter, candidateDuplicateFilter,
            candidateConfirmationFilter, candidateCreatorFilter, candidateSourceFilter, candidateGeoFilter,
            candidateDateFrom, candidateDateTo,
        ]
    );

    const clearCandidateFilters = () => {
        setSearchQuery('');
        setCandidateStatusFilter('');
        setCandidateSupervisorFilter('');
        setCandidateBranchFilter('');
        setCandidateConvertedFilter('');
        setCandidateReferralTypeFilter('');
        setCandidateChannelFilter('');
        setCandidateDuplicateFilter('');
        setCandidateConfirmationFilter('');
        setCandidateCreatorFilter('');
        setCandidateSourceFilter('');
        setCandidateGeoFilter('');
        setCandidateDateFrom('');
        setCandidateDateTo('');
        setCandidatePage(1);
    };

    // Derived State: filtered sheets
    const filteredSheets = useMemo(() =>
        referralSheets.filter(s => {
            if (sheetSearchQuery) {
                const q = sheetSearchQuery.toLowerCase();
                const matchesName = s.referralNameSnapshot.toLowerCase().includes(q);
                const matchesId = String(s.id).includes(q);
                if (!matchesName && !matchesId) return false;
            }
            if (sheetStatusFilter && s.status !== sheetStatusFilter) return false;
            if (sheetBranchFilter && s.branchName !== sheetBranchFilter) return false;
            if (sheetOwnerFilter && s.ownerUserName !== sheetOwnerFilter) return false;
            if (sheetAssignedReviewerFilter && (s.assignedHrUserId == null || s.assignedHrUserName !== sheetAssignedReviewerFilter)) return false;
            if (sheetCreatorFilter && s.createdByUserName !== sheetCreatorFilter) return false;
            if (sheetSourceFilter === 'fromVisit' && s.fieldVisitId == null) return false;
            if (sheetSourceFilter === 'manual' && s.fieldVisitId != null) return false;
            if (sheetReferralTypeFilter && s.referralType !== sheetReferralTypeFilter) return false;
            if (sheetChannelFilter && s.referralOriginChannel !== sheetChannelFilter) return false;
            if (sheetQualityMin && (s.stats?.qualityPercentage ?? 0) < Number(sheetQualityMin)) return false;
            if (sheetConversionMin && (s.stats?.conversionPercentage ?? 0) < Number(sheetConversionMin)) return false;
            if (sheetBehindTargetFilter && !((s.stats?.targetCandidates ?? 0) > 0 && (s.stats?.totalCandidates ?? 0) < (s.stats?.targetCandidates ?? 0))) return false;
            if (sheetDateFrom && new Date(s.createdAt) < new Date(sheetDateFrom)) return false;
            if (sheetDateTo && new Date(s.createdAt) > new Date(`${sheetDateTo}T23:59:59`)) return false;
            return true;
        }),
        [
            referralSheets, sheetSearchQuery, sheetStatusFilter, sheetBranchFilter,
            sheetOwnerFilter, sheetAssignedReviewerFilter, sheetCreatorFilter, sheetSourceFilter,
            sheetReferralTypeFilter, sheetChannelFilter, sheetQualityMin, sheetConversionMin,
            sheetBehindTargetFilter, sheetDateFrom, sheetDateTo,
        ]
    );

    const clearSheetFilters = () => {
        setSheetSearchQuery('');
        setSheetStatusFilter('');
        setSheetBranchFilter('');
        setSheetOwnerFilter('');
        setSheetAssignedReviewerFilter('');
        setSheetCreatorFilter('');
        setSheetSourceFilter('');
        setSheetReferralTypeFilter('');
        setSheetChannelFilter('');
        setSheetQualityMin('');
        setSheetConversionMin('');
        setSheetBehindTargetFilter(false);
        setSheetDateFrom('');
        setSheetDateTo('');
        setSheetsPage(1);
    };

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
            branchId: candidate.branchId,
            assignments: candidate.assignments,
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
        // Only a GLOBAL viewer may narrow by branch; BRANCH/ASSIGNED are scoped
        // by the server, so never send a cross-branch header for them.
        void fetchData(isGlobalNames ? branchContextId : null);
    }, [fetchData, isGlobalNames, branchContextId]);

    // Branch list for the management filter (shown only when the filter is visible).
    useEffect(() => {
        if (!isGlobalNames && !isBranchNames) return;
        api.branches.list()
            .then(rows => setBranchOptions((rows as any[]).map(b => ({ id: b.id, name: b.name }))))
            .catch(() => setBranchOptions([]));
    }, [isGlobalNames, isBranchNames]);

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

    // Applied-filter chips — one removable pill per active filter (search excluded:
    // it has its own always-visible box + inline clear). Order mirrors the panel.
    type Chip = { key: string; label: string; value: string; onRemove: () => void };
    const candidateChips: Chip[] = [];
    if (candidateStatusFilter) candidateChips.push({ key: 'status', label: 'الحالة', value: candidateStatusLabels[candidateStatusFilter] ?? candidateStatusFilter, onRemove: () => { setCandidateStatusFilter(''); setCandidatePage(1); } });
    if (candidateSupervisorFilter) candidateChips.push({ key: 'supervisor', label: 'المسؤول', value: candidateSupervisorFilter, onRemove: () => { setCandidateSupervisorFilter(''); setCandidatePage(1); } });
    if (candidateBranchFilter) candidateChips.push({ key: 'branch', label: 'الفرع', value: candidateBranchFilter, onRemove: () => { setCandidateBranchFilter(''); setCandidatePage(1); } });
    if (candidateConvertedFilter) candidateChips.push({ key: 'converted', label: 'التحويل', value: candidateConvertedFilter === 'converted' ? 'محوَّل' : 'غير محوَّل', onRemove: () => { setCandidateConvertedFilter(''); setCandidatePage(1); } });
    if (candidateReferralTypeFilter) candidateChips.push({ key: 'referralType', label: 'نوع الترشيح', value: getReferralTypeLabel(candidateReferralTypeFilter), onRemove: () => { setCandidateReferralTypeFilter(''); setCandidatePage(1); } });
    if (candidateChannelFilter) candidateChips.push({ key: 'channel', label: 'القناة', value: getChannelLabel(candidateChannelFilter), onRemove: () => { setCandidateChannelFilter(''); setCandidatePage(1); } });
    if (candidateDuplicateFilter) candidateChips.push({ key: 'duplicate', label: 'التكرار', value: candidateDuplicateFilter === 'yes' ? 'مكرَّر' : 'غير مكرَّر', onRemove: () => { setCandidateDuplicateFilter(''); setCandidatePage(1); } });
    if (candidateConfirmationFilter) candidateChips.push({ key: 'confirmation', label: 'تأكيد الترشيح', value: confirmationLabels[candidateConfirmationFilter] ?? candidateConfirmationFilter, onRemove: () => { setCandidateConfirmationFilter(''); setCandidatePage(1); } });
    if (candidateCreatorFilter) candidateChips.push({ key: 'creator', label: 'المنشئ', value: candidateCreatorFilter, onRemove: () => { setCandidateCreatorFilter(''); setCandidatePage(1); } });
    if (candidateSourceFilter) candidateChips.push({ key: 'source', label: 'مصدر الإدخال', value: candidateSourceFilter === 'fromSheet' ? 'من لائحة' : 'إدخال مباشر', onRemove: () => { setCandidateSourceFilter(''); setCandidatePage(1); } });
    if (candidateGeoFilter) candidateChips.push({ key: 'geo', label: 'المنطقة', value: getNeighborhoodHierarchy(candidateGeoFilter), onRemove: () => { setCandidateGeoFilter(''); setCandidatePage(1); } });
    if (candidateDateFrom || candidateDateTo) candidateChips.push({ key: 'date', label: 'التاريخ', value: `${candidateDateFrom || '…'} → ${candidateDateTo || '…'}`, onRemove: () => { setCandidateDateFrom(''); setCandidateDateTo(''); setCandidatePage(1); } });

    const sheetChips: Chip[] = [];
    if (sheetStatusFilter) sheetChips.push({ key: 'status', label: 'الحالة', value: sheetStatusLabels[sheetStatusFilter] ?? sheetStatusFilter, onRemove: () => { setSheetStatusFilter(''); setSheetsPage(1); } });
    if (sheetBranchFilter) sheetChips.push({ key: 'branch', label: 'الفرع', value: sheetBranchFilter, onRemove: () => { setSheetBranchFilter(''); setSheetsPage(1); } });
    if (sheetOwnerFilter) sheetChips.push({ key: 'owner', label: 'الجامع الفعلي', value: sheetOwnerFilter, onRemove: () => { setSheetOwnerFilter(''); setSheetsPage(1); } });
    if (sheetAssignedReviewerFilter) sheetChips.push({ key: 'reviewer', label: 'المُراجِع المُسنَد', value: sheetAssignedReviewerFilter, onRemove: () => { setSheetAssignedReviewerFilter(''); setSheetsPage(1); } });
    if (sheetCreatorFilter) sheetChips.push({ key: 'creator', label: 'المنشئ', value: sheetCreatorFilter, onRemove: () => { setSheetCreatorFilter(''); setSheetsPage(1); } });
    if (sheetSourceFilter) sheetChips.push({ key: 'source', label: 'مصدر الإنشاء', value: sheetSourceFilter === 'fromVisit' ? 'من زيارة ميدانية' : 'يدوي', onRemove: () => { setSheetSourceFilter(''); setSheetsPage(1); } });
    if (sheetReferralTypeFilter) sheetChips.push({ key: 'referralType', label: 'نوع الترشيح', value: getReferralTypeLabel(sheetReferralTypeFilter), onRemove: () => { setSheetReferralTypeFilter(''); setSheetsPage(1); } });
    if (sheetChannelFilter) sheetChips.push({ key: 'channel', label: 'القناة', value: getChannelLabel(sheetChannelFilter), onRemove: () => { setSheetChannelFilter(''); setSheetsPage(1); } });
    if (sheetQualityMin) sheetChips.push({ key: 'quality', label: 'أدنى جودة', value: `${sheetQualityMin}%`, onRemove: () => { setSheetQualityMin(''); setSheetsPage(1); } });
    if (sheetConversionMin) sheetChips.push({ key: 'conversion', label: 'أدنى تحويل', value: `${sheetConversionMin}%`, onRemove: () => { setSheetConversionMin(''); setSheetsPage(1); } });
    if (sheetBehindTargetFilter) sheetChips.push({ key: 'behind', label: 'الهدف', value: 'دون الهدف', onRemove: () => { setSheetBehindTargetFilter(false); setSheetsPage(1); } });
    if (sheetDateFrom || sheetDateTo) sheetChips.push({ key: 'date', label: 'التاريخ', value: `${sheetDateFrom || '…'} → ${sheetDateTo || '…'}`, onRemove: () => { setSheetDateFrom(''); setSheetDateTo(''); setSheetsPage(1); } });

    return (
        <div className="p-8 space-y-6" dir="rtl">
            {/* Error Message Modal */}
            <Modal
                isOpen={!!errorModal}
                onClose={() => setErrorModal(null)}
                size="sm"
                hideCloseButton
                footer={
                    <button onClick={() => setErrorModal(null)} className="w-full bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-2.5 rounded-xl transition-all">إغلاق</button>
                }
            >
                    <div className="p-6 text-center">
                        <div className="w-12 h-12 mx-auto bg-red-100 text-red-600 rounded-full flex items-center justify-center mb-4"><AlertCircle className="w-6 h-6" /></div>
                        <h3 className="text-base font-bold text-slate-800 mb-2">تنبيه النظام</h3>
                        <p className="text-sm text-slate-600">{errorModal}</p>
                    </div>
            </Modal>

            {/* Header & Tabs */}
            <div className="flex flex-col gap-6">
                <PageHeader
                    title="سجلات الأسماء المقترحة"
                    subtitle="فلترة، تدقيق، وتوجيه الأسماء الجديدة"
                    actions={<>
                        {/* GLOBAL branch filter moved to the unified external switcher (sidebar). */}
                        {isBranchNames && (
                            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-100 border border-slate-200 text-slate-600 text-sm font-bold">
                                <Building2 className="w-4 h-4 shrink-0" />
                                <span className="truncate">
                                    {branchOptions.find(b => b.id === authUser?.branchId)?.name ?? `الفرع #${authUser?.branchId ?? ''}`}
                                </span>
                            </div>
                        )}
                        {canCreateNameLists && (
                        <button disabled={mustPickBranch} title={mustPickBranch ? 'اختر فرعاً أولاً' : undefined} onClick={() => setIsCreateSheetOpen(true)} className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 rounded-xl font-bold shadow-sm transition-all text-sm disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed">
                            <FilePlus2 className="w-4 h-4" /> لائحة جديدة
                        </button>
                        )}
                        {canCreateCandidates && (
                        <button disabled={mustPickBranch} title={mustPickBranch ? 'اختر فرعاً أولاً لإضافة اسم' : undefined} onClick={() => setIsAddModalOpen(true)} className="flex items-center gap-2 px-5 py-2 bg-sky-600 hover:bg-sky-700 text-white text-sm font-bold rounded-xl shadow-md shadow-sky-500/20 transition-all disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none disabled:cursor-not-allowed">
                            <UserPlus className="w-4 h-4" /> {mustPickBranch ? 'اختر فرعاً' : 'إضافة اسم'}
                        </button>
                        )}
                    </>}
                >
                    <BranchScopeIndicator />
                </PageHeader>

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
                    <div className="p-4 border-b border-slate-100 bg-slate-50/30 flex flex-col gap-3">
                        {/* Toolbar: free-text search · one filters toggle · clear-all */}
                        <div className="flex flex-wrap items-center gap-3">
                            <div className="relative flex-1 min-w-[220px]">
                                <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                                <input
                                    type="text"
                                    placeholder="بحث (اسم، رقم، وسيط)..."
                                    value={searchQuery}
                                    onChange={(e) => { setSearchQuery(e.target.value); setCandidatePage(1); }}
                                    className="w-full pl-9 pr-10 py-3 rounded-xl border border-slate-200 focus:border-sky-400 focus:ring-2 focus:ring-sky-400/20 text-sm"
                                />
                                {searchQuery && (
                                    <button onClick={() => { setSearchQuery(''); setCandidatePage(1); }} aria-label="مسح البحث" className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                                        <X className="w-4 h-4" />
                                    </button>
                                )}
                            </div>
                            <button
                                onClick={() => setCandidateFiltersOpen(o => !o)}
                                aria-expanded={candidateFiltersOpen}
                                className={`flex items-center gap-2 px-4 py-3 rounded-xl border text-sm font-bold transition-all ${candidateFiltersOpen || candidateChips.length > 0 ? 'border-sky-200 bg-sky-50 text-sky-700' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
                            >
                                <SlidersHorizontal className="w-4 h-4" /> الفلاتر
                                {candidateChips.length > 0 && (
                                    <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-sky-600 text-white text-[11px] font-black">{candidateChips.length}</span>
                                )}
                                <ChevronDown className={`w-3.5 h-3.5 transition-transform ${candidateFiltersOpen ? 'rotate-180' : ''}`} />
                            </button>
                            {(candidateChips.length > 0 || searchQuery) && (
                                <button
                                    onClick={clearCandidateFilters}
                                    className="flex items-center gap-1 text-xs font-bold text-slate-500 hover:text-red-600 transition-colors"
                                >
                                    <XCircle className="w-4 h-4" /> مسح الكل
                                </button>
                            )}
                        </div>

                        {/* Active-filter chips — always-on "what's applied", each removable */}
                        {candidateChips.length > 0 && (
                            <div className="flex flex-wrap items-center gap-2">
                                {candidateChips.map(chip => (
                                    <ActiveFilterChip key={chip.key} label={chip.label} value={chip.value} onRemove={chip.onRemove} tone="sky" />
                                ))}
                            </div>
                        )}

                        {/* One unified filter panel — every filter, labeled, in a flat grid */}
                        {candidateFiltersOpen && (
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 pt-3 border-t border-dashed border-slate-200">
                                <FilterField label="الحالة">
                                    <Select className="w-full" value={candidateStatusFilter} onChange={(v) => { setCandidateStatusFilter(v); setCandidatePage(1); }} ariaLabel="حالة المرشح"
                                        options={[{ value: '', label: 'كل الحالات' }, ...Object.entries(candidateStatusLabels).map(([value, label]) => ({ value, label }))]} />
                                </FilterField>
                                {candidateSupervisors.length > 0 && (
                                    <FilterField label="المسؤول">
                                        <Select className="w-full" value={candidateSupervisorFilter} onChange={(v) => { setCandidateSupervisorFilter(v); setCandidatePage(1); }} ariaLabel="المسؤول"
                                            options={[{ value: '', label: 'كل المسؤولين' }, ...candidateSupervisors.map(s => ({ value: s, label: s }))]} />
                                    </FilterField>
                                )}
                                {candidateBranches.length > 1 && (
                                    <FilterField label="الفرع">
                                        <Select className="w-full" value={candidateBranchFilter} onChange={(v) => { setCandidateBranchFilter(v); setCandidatePage(1); }} ariaLabel="الفرع"
                                            options={[{ value: '', label: 'كل الفروع' }, ...candidateBranches.map(b => ({ value: b, label: b }))]} />
                                    </FilterField>
                                )}
                                <FilterField label="التحويل">
                                    <Select className="w-full" value={candidateConvertedFilter} onChange={(v) => { setCandidateConvertedFilter(v as any); setCandidatePage(1); }} ariaLabel="التحويل"
                                        options={[{ value: '', label: 'الكل' }, { value: 'converted', label: 'محوَّل فقط' }, { value: 'unconverted', label: 'غير محوَّل فقط' }]} />
                                </FilterField>
                                {candidateReferralTypes.length > 0 && (
                                    <FilterField label="نوع الترشيح">
                                        <Select className="w-full" value={candidateReferralTypeFilter} onChange={(v) => { setCandidateReferralTypeFilter(v); setCandidatePage(1); }} ariaLabel="نوع الترشيح"
                                            options={[{ value: '', label: 'كل الأنواع' }, ...candidateReferralTypes.map(t => ({ value: t, label: getReferralTypeLabel(t) }))]} />
                                    </FilterField>
                                )}
                                {candidateChannels.length > 0 && (
                                    <FilterField label="قناة المصدر">
                                        <Select className="w-full" value={candidateChannelFilter} onChange={(v) => { setCandidateChannelFilter(v); setCandidatePage(1); }} ariaLabel="قناة المصدر"
                                            options={[{ value: '', label: 'كل القنوات' }, ...candidateChannels.map(c => ({ value: c, label: getChannelLabel(c) }))]} />
                                    </FilterField>
                                )}
                                <FilterField label="التكرار">
                                    <Select className="w-full" value={candidateDuplicateFilter} onChange={(v) => { setCandidateDuplicateFilter(v as any); setCandidatePage(1); }} ariaLabel="تكرار محتمل"
                                        options={[{ value: '', label: 'الكل' }, { value: 'yes', label: 'مكرَّر فقط' }, { value: 'no', label: 'غير مكرَّر فقط' }]} />
                                </FilterField>
                                <FilterField label="تأكيد الترشيح">
                                    <Select className="w-full" value={candidateConfirmationFilter} onChange={(v) => { setCandidateConfirmationFilter(v); setCandidatePage(1); }} ariaLabel="تأكيد الترشيح"
                                        options={[{ value: '', label: 'الكل' }, ...Object.entries(confirmationLabels).map(([value, label]) => ({ value, label }))]} />
                                </FilterField>
                                {candidateCreators.length > 0 && (
                                    <FilterField label="المنشئ">
                                        <Select className="w-full" value={candidateCreatorFilter} onChange={(v) => { setCandidateCreatorFilter(v); setCandidatePage(1); }} ariaLabel="المنشئ"
                                            options={[{ value: '', label: 'كل المنشئين' }, ...candidateCreators.map(c => ({ value: c, label: c }))]} />
                                    </FilterField>
                                )}
                                <FilterField label="مصدر الإدخال">
                                    <Select className="w-full" value={candidateSourceFilter} onChange={(v) => { setCandidateSourceFilter(v as any); setCandidatePage(1); }} ariaLabel="مصدر الإدخال"
                                        options={[{ value: '', label: 'الكل' }, { value: 'fromSheet', label: 'من لائحة' }, { value: 'direct', label: 'إدخال مباشر' }]} />
                                </FilterField>
                                {geoUnits.filter(g => g.level === 4).length > 0 && (
                                    <FilterField label="المنطقة الجغرافية">
                                        <Select className="w-full" value={candidateGeoFilter} onChange={(v) => { setCandidateGeoFilter(v); setCandidatePage(1); }} ariaLabel="المنطقة الجغرافية"
                                            options={[{ value: '', label: 'كل المناطق' }, ...geoUnits.filter(g => g.level === 4).map(g => ({ value: String(g.id), label: getNeighborhoodHierarchy(String(g.id)) }))]} />
                                    </FilterField>
                                )}
                                <FilterField label="فترة التسجيل" wide>
                                    <div className="flex items-center gap-1.5">
                                        <DateField value={candidateDateFrom} onChange={(v) => { setCandidateDateFrom(v); setCandidatePage(1); }} placeholder="من تاريخ" className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 hover:border-slate-300 focus:border-sky-500 focus:outline-none transition-colors" />
                                        <span className="text-xs text-slate-400 shrink-0">إلى</span>
                                        <DateField value={candidateDateTo} onChange={(v) => { setCandidateDateTo(v); setCandidatePage(1); }} placeholder="إلى تاريخ" className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 hover:border-slate-300 focus:border-sky-500 focus:outline-none transition-colors" />
                                    </div>
                                </FilterField>
                            </div>
                        )}
                    </div>

                    <div className="flex-1 overflow-y-auto custom-scroll" style={{ maxHeight: '480px' }}>
                        <table className="w-full text-sm text-right border-collapse">
                            <thead className="sticky top-0 z-10 bg-slate-50 border-b border-slate-200 shadow-sm">
                                <tr className="text-slate-600 font-bold text-xs uppercase tracking-wider">
                                    <th className="px-5 h-12">ID</th>
                                    <th className="px-5 h-12">تاريخ الإضافة</th>
                                    <th className="px-5 h-12">الاسم المقترح</th>
                                    <th className="px-5 h-12">أرقام التواصل</th>
                                    <th className="px-5 h-12">العنوان</th>
                                    <th className="px-5 h-12">اسم الوسيط</th>
                                    <th className="px-5 h-12">نوع الترشيح</th>
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
                                    paginatedCandidates.map((c, idx) => {
                                        const nameStr = c.firstName
                                            ? `${c.firstName} ${c.lastName || ''} ${c.nickname ? `(${c.nickname})` : ''}`.trim()
                                            : `${c.nickname || ''} ${c.lastName || ''}`.trim();

                                        const primaryPhone = c.contacts?.find(con => con.isPrimary)?.number || c.contacts?.[0]?.number || c.mobile;
                                        const extraCount = Math.max(0, (c.contacts?.length || 0) - 1);
                                        const allPhones = c.contacts?.map(con => con.number).join('\n') || '';

                                        return (
                                            <tr key={c.id} className={`${idx % 2 === 1 ? 'bg-slate-50/50' : 'bg-white'} hover:bg-sky-50 transition-colors h-12 group`}>
                                                <td className="px-5 py-2 font-mono text-xs text-slate-500">#{c.id}</td>
                                                <td className="px-5 py-2 text-xs text-slate-600 whitespace-nowrap">
                                                    {c.createdAt ? new Date(c.createdAt).toLocaleDateString('ar-SY') : '--'}
                                                </td>
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
                                                                {extra > 0 && <span className="text-xs text-sky-500 font-bold">+{extra} آخرين</span>}
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
                                                    <span className={`px-2 py-0.5 rounded text-xs font-black border ${getCandidateStatusBadge(c).className}`}>
                                                        {getCandidateStatusBadge(c).label}
                                                    </span>
                                                </td>
                                                <td className="px-5 py-2">
                                                    <div className="flex items-center justify-center gap-2">
                                                        {canEditCandidates && c.status !== 'Qualified' && c.status !== 'Junk' && c.convertedToLeadId == null && (
                                                            <button
                                                                onClick={() => {
                                                                    setEditingCandidate(c);
                                                                    setIsAddModalOpen(true);
                                                                }}
                                                                className="w-8 h-8 flex items-center justify-center bg-slate-50 text-slate-600 hover:bg-slate-600 hover:text-white rounded-lg border border-slate-200 transition-all"
                                                                title="تعديل"
                                                            >
                                                                <Edit className="w-4 h-4" />
                                                            </button>
                                                        )}
                                                        {canEditCandidates && (c.status === 'Suggested' || c.status === 'FollowUp') && (
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
                    <div className="p-4 border-b border-slate-100 bg-amber-50/20 flex flex-col gap-3">
                        {/* Toolbar: free-text search · one filters toggle · clear-all */}
                        <div className="flex flex-wrap items-center gap-3">
                            <div className="relative flex-1 min-w-[220px]">
                                <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                                <input
                                    type="text"
                                    placeholder="بحث باسم الوسيط أو رقم اللائحة..."
                                    value={sheetSearchQuery}
                                    onChange={(e) => { setSheetSearchQuery(e.target.value); setSheetsPage(1); }}
                                    className="w-full pl-9 pr-10 py-3 rounded-xl border border-amber-200 focus:border-amber-400 focus:ring-2 focus:ring-amber-400/20 text-sm bg-white"
                                />
                                {sheetSearchQuery && (
                                    <button onClick={() => { setSheetSearchQuery(''); setSheetsPage(1); }} aria-label="مسح البحث" className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                                        <X className="w-4 h-4" />
                                    </button>
                                )}
                            </div>
                            <button
                                onClick={() => setSheetFiltersOpen(o => !o)}
                                aria-expanded={sheetFiltersOpen}
                                className={`flex items-center gap-2 px-4 py-3 rounded-xl border text-sm font-bold transition-all ${sheetFiltersOpen || sheetChips.length > 0 ? 'border-amber-300 bg-amber-100 text-amber-800' : 'border-amber-200 bg-white text-amber-700 hover:bg-amber-50'}`}
                            >
                                <SlidersHorizontal className="w-4 h-4" /> الفلاتر
                                {sheetChips.length > 0 && (
                                    <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-amber-600 text-white text-[11px] font-black">{sheetChips.length}</span>
                                )}
                                <ChevronDown className={`w-3.5 h-3.5 transition-transform ${sheetFiltersOpen ? 'rotate-180' : ''}`} />
                            </button>
                            {(sheetChips.length > 0 || sheetSearchQuery) && (
                                <button
                                    onClick={clearSheetFilters}
                                    className="flex items-center gap-1 text-xs font-bold text-slate-500 hover:text-red-600 transition-colors"
                                >
                                    <XCircle className="w-4 h-4" /> مسح الكل
                                </button>
                            )}
                        </div>

                        {/* Active-filter chips — always-on "what's applied", each removable */}
                        {sheetChips.length > 0 && (
                            <div className="flex flex-wrap items-center gap-2">
                                {sheetChips.map(chip => (
                                    <ActiveFilterChip key={chip.key} label={chip.label} value={chip.value} onRemove={chip.onRemove} tone="amber" />
                                ))}
                            </div>
                        )}

                        {/* One unified filter panel — every filter, labeled, in a flat grid */}
                        {sheetFiltersOpen && (
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 pt-3 border-t border-dashed border-amber-200">
                                <FilterField label="الحالة">
                                    <Select className="w-full" value={sheetStatusFilter} onChange={(v) => { setSheetStatusFilter(v); setSheetsPage(1); }} ariaLabel="حالة اللائحة"
                                        options={[{ value: '', label: 'كل الحالات' }, ...Object.entries(sheetStatusLabels).map(([value, label]) => ({ value, label }))]} />
                                </FilterField>
                                {sheetBranches.length > 1 && (
                                    <FilterField label="الفرع">
                                        <Select className="w-full" value={sheetBranchFilter} onChange={(v) => { setSheetBranchFilter(v); setSheetsPage(1); }} ariaLabel="الفرع"
                                            options={[{ value: '', label: 'كل الفروع' }, ...sheetBranches.map(b => ({ value: b, label: b }))]} />
                                    </FilterField>
                                )}
                                {sheetOwners.length > 0 && (
                                    <FilterField label="الجامع الفعلي">
                                        <Select className="w-full" value={sheetOwnerFilter} onChange={(v) => { setSheetOwnerFilter(v); setSheetsPage(1); }} ariaLabel="الجامع الفعلي"
                                            options={[{ value: '', label: 'الكل' }, ...sheetOwners.map(o => ({ value: o, label: o }))]} />
                                    </FilterField>
                                )}
                                {sheetAssignedReviewers.length > 0 && (
                                    <FilterField label="المُراجِع المُسنَد">
                                        <Select className="w-full" value={sheetAssignedReviewerFilter} onChange={(v) => { setSheetAssignedReviewerFilter(v); setSheetsPage(1); }} ariaLabel="المُراجِع المُسنَد"
                                            options={[{ value: '', label: 'الكل' }, ...sheetAssignedReviewers.map(r => ({ value: r, label: r }))]} />
                                    </FilterField>
                                )}
                                {sheetCreators.length > 0 && (
                                    <FilterField label="المنشئ">
                                        <Select className="w-full" value={sheetCreatorFilter} onChange={(v) => { setSheetCreatorFilter(v); setSheetsPage(1); }} ariaLabel="المنشئ"
                                            options={[{ value: '', label: 'الكل' }, ...sheetCreators.map(c => ({ value: c, label: c }))]} />
                                    </FilterField>
                                )}
                                <FilterField label="مصدر الإنشاء">
                                    <Select className="w-full" value={sheetSourceFilter} onChange={(v) => { setSheetSourceFilter(v as any); setSheetsPage(1); }} ariaLabel="مصدر الإنشاء"
                                        options={[{ value: '', label: 'الكل' }, { value: 'fromVisit', label: 'من زيارة ميدانية' }, { value: 'manual', label: 'يدوي' }]} />
                                </FilterField>
                                {sheetReferralTypes.length > 0 && (
                                    <FilterField label="نوع الترشيح">
                                        <Select className="w-full" value={sheetReferralTypeFilter} onChange={(v) => { setSheetReferralTypeFilter(v); setSheetsPage(1); }} ariaLabel="نوع الترشيح"
                                            options={[{ value: '', label: 'كل الأنواع' }, ...sheetReferralTypes.map(t => ({ value: t, label: getReferralTypeLabel(t) }))]} />
                                    </FilterField>
                                )}
                                {sheetChannels.length > 0 && (
                                    <FilterField label="قناة المصدر">
                                        <Select className="w-full" value={sheetChannelFilter} onChange={(v) => { setSheetChannelFilter(v); setSheetsPage(1); }} ariaLabel="قناة المصدر"
                                            options={[{ value: '', label: 'كل القنوات' }, ...sheetChannels.map(c => ({ value: c, label: getChannelLabel(c) }))]} />
                                    </FilterField>
                                )}
                                <FilterField label="أدنى جودة %">
                                    <Input type="number" min={0} max={100} placeholder="0–100"
                                        value={sheetQualityMin}
                                        onChange={(e) => { setSheetQualityMin(e.target.value); setSheetsPage(1); }} />
                                </FilterField>
                                <FilterField label="أدنى تحويل %">
                                    <Input type="number" min={0} max={100} placeholder="0–100"
                                        value={sheetConversionMin}
                                        onChange={(e) => { setSheetConversionMin(e.target.value); setSheetsPage(1); }} />
                                </FilterField>
                                <FilterField label="فترة الإنشاء" wide>
                                    <div className="flex items-center gap-1.5">
                                        <DateField value={sheetDateFrom} onChange={(v) => { setSheetDateFrom(v); setSheetsPage(1); }} placeholder="من تاريخ" className="w-full bg-white border border-amber-200 rounded-xl px-3 py-2 text-xs text-slate-800 hover:border-amber-300 focus:border-amber-500 focus:outline-none transition-colors" />
                                        <span className="text-xs text-slate-400 shrink-0">إلى</span>
                                        <DateField value={sheetDateTo} onChange={(v) => { setSheetDateTo(v); setSheetsPage(1); }} placeholder="إلى تاريخ" className="w-full bg-white border border-amber-200 rounded-xl px-3 py-2 text-xs text-slate-800 hover:border-amber-300 focus:border-amber-500 focus:outline-none transition-colors" />
                                    </div>
                                </FilterField>
                                <FilterField label="الهدف">
                                    <div className="flex items-center gap-2 h-[39px] px-3 rounded-full border border-amber-200 bg-white text-xs font-bold text-slate-600">
                                        <Toggle size="sm" checked={sheetBehindTargetFilter} onCheckedChange={(v) => { setSheetBehindTargetFilter(v); setSheetsPage(1); }} label="دون الهدف فقط" />
                                        <span>دون الهدف فقط</span>
                                    </div>
                                </FilterField>
                            </div>
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
                                    paginatedSheets.map((sheet, idx) => (
                                        <tr key={sheet.id} className={`${idx % 2 === 1 ? 'bg-slate-50/50' : 'bg-white'} hover:bg-amber-50/40 transition-colors h-12 group`}>
                                            <td className="px-5 py-2">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-8 h-8 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center font-black text-xs">
                                                        {sheet.id}
                                                    </div>
                                                    <div>
                                                        <div className="font-bold text-slate-800 group-hover:text-amber-700 transition-colors">{sheet.referralNameSnapshot}</div>
                                                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                                            <span className="text-xs text-slate-400">{getReferralTypeLabel(sheet.referralType)}</span>
                                                            {sheet.fieldVisitId ? (
                                                                <Link
                                                                    to={`/field-visits/${sheet.fieldVisitId}`}
                                                                    className="inline-flex items-center gap-1 rounded-lg border border-sky-100 bg-sky-50 px-1.5 py-0.5 text-xs font-bold text-sky-700 hover:border-sky-200 hover:bg-sky-100"
                                                                >
                                                                    من زيارة #{sheet.fieldVisitId}
                                                                </Link>
                                                            ) : (
                                                                <span className="inline-flex items-center rounded-lg border border-slate-100 bg-slate-50 px-1.5 py-0.5 text-xs font-bold text-slate-500">
                                                                    يدوي
                                                                </span>
                                                            )}
                                                        </div>
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
                                            <td className="px-5 py-2 text-center font-bold text-slate-700">
                                                {sheet.fieldVisitId && (sheet.stats?.targetCandidates ?? 0) > 0 ? (
                                                    <span>
                                                        <span className={
                                                            (sheet.stats?.totalCandidates || 0) >= (sheet.stats?.targetCandidates ?? 0)
                                                                ? 'text-emerald-600'
                                                                : 'text-amber-600'
                                                        }>
                                                            {sheet.stats?.totalCandidates || 0}
                                                        </span>
                                                        <span className="mx-1 font-normal text-slate-400">/</span>
                                                        <span className="text-slate-500">{sheet.stats.targetCandidates}</span>
                                                    </span>
                                                ) : (
                                                    sheet.stats?.totalCandidates || 0
                                                )}
                                            </td>
                                            <td className="px-5 py-2 text-center">
                                                <span className="bg-blue-50 text-blue-700 px-2 py-0.5 rounded-lg border border-blue-100 font-bold text-xs">{sheet.stats?.qualityPercentage || 0}%</span>
                                            </td>
                                            <td className="px-5 py-2 text-center">
                                                <span className="bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-lg border border-emerald-100 font-bold text-xs">{sheet.stats?.conversionPercentage || 0}%</span>
                                            </td>
                                            <td className="px-5 py-2 text-center">
                                                <span className={`px-2 py-0.5 rounded text-xs font-bold border ${sheet.status === 'New' ? 'bg-green-50 text-green-700 border-green-100' : sheet.status === 'Completed' ? 'bg-blue-50 text-blue-700 border-blue-100' : 'bg-slate-50 text-slate-500 border-slate-200'}`}>
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
                isOpen={canEditCandidates && isQualifyModalOpen}
                onClose={() => setIsQualifyModalOpen(false)}
                candidate={activeCandidateForQualify}
                onQualified={handleQualificationConfirmed}
                onJunk={(id) => { markJunk(id); setIsQualifyModalOpen(false); }}
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
