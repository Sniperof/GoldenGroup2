import { useState, useCallback, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, Trash2, UserPlus, CheckCircle2, AlertCircle, Clock, Search, Lightbulb, Pencil, Loader2, Building2 } from '../components/ui/icons';
import { api } from '../lib/api';
import type { Client, CustomerOwnership, GeoUnit } from '../lib/types';

// SmartTable column key → server sort key. Only columns the /paged endpoint can
// sort are mapped; the others are rendered non-sortable so a header click never
// silently no-ops.
const SORT_KEY_MAP: Record<string, string> = {
    id: 'id',
    name: 'name',
    branchName: 'branchName',
    status: 'lifecycleStage',
    rating: 'rating',
};
import ClientModal from '../components/ClientModal';
import Button from '../components/ui/Button';
import Select from '../components/ui/Select';
import PageHeader from '../components/ui/PageHeader';
import ClientAvatar from '../components/ClientAvatar';
import SmartTable from '../components/SmartTable';
import type { ColumnDef, FilterDef } from '../components/SmartTable';
import ManualSearchModal from '../components/candidates/ManualSearchModal';
import QualificationModal from '../components/candidates/QualificationModal';
import AddCandidateModal from '../components/candidates/AddCandidateModal';
import { useCandidateStore } from '../hooks/useCandidateStore';
import { useAuthStore } from '../hooks/useAuthStore';
import { useBranchContextStore } from '../hooks/useBranchContextStore';
import BranchScopeIndicator from '../components/BranchScopeIndicator';
import BulkActivateModal from '../components/appAccounts/BulkActivateModal';
import { usePermissions } from '../hooks/usePermissions';

function extractApiPayload(error: unknown): any | null {
    if (!(error instanceof Error)) {
        return null;
    }

    const prefix = error.message.match(/^API Error \d+: ([\s\S]+)$/);
    if (!prefix) {
        return null;
    }

    try {
        return JSON.parse(prefix[1]);
    } catch {
        return null;
    }
}

function OwnershipCell({ ownership }: { ownership?: CustomerOwnership | null }) {
    const label = ownership?.ownerLabel || 'الشركة العامة';
    const isPersonal = (ownership?.ownerType ?? '').startsWith('personal');
    const personalAssignments = ownership?.personalAssignments || [];

    return (
        <div className="flex flex-col gap-0.5">
            <span className={`inline-flex w-fit items-center rounded-full border px-2.5 py-1 text-xs font-bold ${
                isPersonal
                    ? 'border-indigo-200 bg-indigo-50 text-indigo-700'
                    : 'border-slate-200 bg-slate-50 text-slate-600'
            }`}>
                {label}
            </span>
            {isPersonal && personalAssignments.length > 1 ? (
                <span className="text-xs font-bold text-slate-400">{personalAssignments.length} إسنادات شخصية فعالة</span>
            ) : null}
        </div>
    );
}

export default function Clients() {
    const getPermissionScope = useAuthStore(s => s.getPermissionScope);
    const authUser = useAuthStore(s => s.user);
    // Show assignments only for GLOBAL or BRANCH scope — ASSIGNED scope users must not see who else is assigned
    const clientsViewScope = getPermissionScope('clients.view_list');
    const canSeeAssignments = clientsViewScope === 'GLOBAL' || clientsViewScope === 'BRANCH';

    // ─── Management branch filter (scope-driven, NOT identity-driven) ───
    // The filter mode follows THIS section's view scope:
    //  - GLOBAL (super-admin or company manager) → active picker (All + branches)
    //  - BRANCH (branch manager)                 → locked badge of their branch
    //  - ASSIGNED (supervisor)                   → no filter at all
    // Selection is written to the shared branch-context store so the add-client
    // modal pins the operational branch to it automatically.
    const branchContextId = useBranchContextStore(s => s.branchId);
    const isGlobalClients = clientsViewScope === 'GLOBAL';
    const isBranchClients = clientsViewScope === 'BRANCH';
    // Add rule (§5): a GLOBAL operator viewing "all branches" has no explicit branch
    // to own the new record, so the add button is blocked until a branch is picked —
    // no silent fallback into the base branch (SH-3). Branch/assigned users are pinned.
    const mustPickBranch = isGlobalClients && branchContextId == null;
    const [branchOptions, setBranchOptions] = useState<{ id: number; name: string }[]>([]);

    // Server-paginated data: `clients` holds ONLY the current page (not the whole
    // table). Totals/KPIs come from the server. See docs/analysis/clients-records-performance-and-filters.md
    const [clients, setClients] = useState<Client[]>([]);
    const [total, setTotal] = useState(0);
    const [kpis, setKpis] = useState({ total: 0, leads: 0, fops: 0, ops: 0 });
    const [geoUnits, setGeoUnits] = useState<GeoUnit[]>([]);
    const [loading, setLoading] = useState(true);

    // Server pagination + sort state (controlled by SmartTable's server mode).
    const [page, setPage] = useState(1);
    const [limit, setLimit] = useState(10);
    const [sortKey, setSortKey] = useState<string>('id');
    const [sortDir, setSortDir] = useState<'asc' | 'desc' | null>('desc');

    const [activeTab, setActiveTab] = useState<'clients' | 'candidates'>('clients');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingClient, setEditingClient] = useState<Client | null>(null);
    const [isPreAddModalOpen, setIsPreAddModalOpen] = useState(false);
    const [bulkActivationTarget, setBulkActivationTarget] = useState<{
        scope: 'filtered' | 'selected';
        clients: Client[];
    } | null>(null);
    const { hasPermission } = usePermissions();
    const canBulkActivate = hasPermission('app_accounts.bulk_activate');
    const canDeleteClients = hasPermission('clients.delete');
    const [activeCandidateForSearch, setActiveCandidateForSearch] = useState<any>(null);
    const [verifiedPhone, setVerifiedPhone] = useState('');
    const [isAddCandidateModalOpen, setIsAddCandidateModalOpen] = useState(false);
    const qualifyCandidate = useCandidateStore((state: any) => state.qualifyCandidate);

    const navigate = useNavigate();

    // ─── Filters & Search State ───
    const [searchTerm, setSearchTerm] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [filterClass, setFilterClass] = useState('all');
    const [filterArea, setFilterArea] = useState('all');
    const [filterMediator, setFilterMediator] = useState('all');

    // Debounce the free-text search so we don't fire a request per keystroke.
    useEffect(() => {
        const t = setTimeout(() => { setDebouncedSearch(searchTerm); setPage(1); }, 300);
        return () => clearTimeout(t);
    }, [searchTerm]);

    // Any filter/branch change resets to the first page.
    useEffect(() => { setPage(1); }, [filterClass, filterMediator, filterArea, branchContextId]);

    const fetchClients = useCallback(async () => {
        // Only a GLOBAL viewer may narrow by branch; BRANCH/ASSIGNED are scoped
        // by the server, so we never send a cross-branch header for them.
        const branchParam = isGlobalClients ? branchContextId : null;
        const useSort = sortDir != null;
        const res = await api.clients.listPaged({
            branchId: branchParam,
            page,
            limit,
            search: debouncedSearch,
            filterClass,
            filterMediator,
            filterArea,
            sortKey: useSort ? (SORT_KEY_MAP[sortKey] ?? 'id') : undefined,
            sortDir: useSort ? sortDir : undefined,
        });
        setClients(res.items as Client[]);
        setTotal(res.total);
        setKpis(res.kpis);
    }, [isGlobalClients, branchContextId, page, limit, debouncedSearch, filterClass, filterMediator, filterArea, sortKey, sortDir]);

    // Refetch whenever any server-side query input changes (page/limit/sort/filters/branch).
    useEffect(() => {
        let active = true;
        setLoading(true);
        fetchClients()
            .catch(err => console.error('Failed to fetch clients:', err))
            .finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, [fetchClients]);

    // On-demand loader for the "activate filtered results" bulk action — walks the
    // paged endpoint (100/page) to gather the WHOLE filtered set, since the page
    // state only holds one page. Explicit admin action, so a larger fetch is fine.
    const fetchAllFiltered = useCallback(async (): Promise<Client[]> => {
        const branchParam = isGlobalClients ? branchContextId : null;
        const acc: Client[] = [];
        for (let p = 1; p <= 500; p++) {
            const res = await api.clients.listPaged({
                branchId: branchParam, page: p, limit: 100,
                search: debouncedSearch, filterClass, filterMediator, filterArea,
            });
            acc.push(...(res.items as Client[]));
            if (acc.length >= res.total || res.items.length === 0) break;
        }
        return acc;
    }, [isGlobalClients, branchContextId, debouncedSearch, filterClass, filterMediator, filterArea]);

    // Branch list for the management filter (shown only when the filter is visible).
    useEffect(() => {
        if (!isGlobalClients && !isBranchClients) return;
        api.branches.list()
            .then(rows => setBranchOptions((rows as any[]).map(b => ({ id: b.id, name: b.name }))))
            .catch(() => setBranchOptions([]));
    }, [isGlobalClients, isBranchClients]);

    // Address NAMES are reference labels — resolved from the global name map
    // (`names()`, no branch scope) so every visible client's address renders
    // regardless of the admin branch filter. The scoped picker lives in the add/edit
    // modal (`api.geoUnits.list(branchId)`). See branch-scope std §3.
    useEffect(() => {
        api.geoUnits.names()
            .then(setGeoUnits)
            .catch(() => setGeoUnits([]));
    }, []);

    // The current page as rendered — the server already returns `lifecycleStage`
    // per row, filtered/sorted/paginated. No client-side re-derivation.
    const mainList = useMemo(
        () => clients.map(c => ({ ...c, lifecycleStage: (c as any).lifecycleStage ?? 'Lead' })),
        [clients],
    );

    const convertToLead = async (id: number) => {
        if (!confirm('هل أنت متأكد من تحويل هذا المرشح إلى عميل محتمل؟')) return;
        const client = clients.find(c => c.id === id);
        if (!client) return;
        try {
            await api.clients.update(id, { ...client, isCandidate: false });
            await fetchClients();
        } catch (err) {
            console.error('Failed to convert candidate:', err);
        }
    };

    const deleteClient = async (id: number) => {
        const client = clients.find(c => c.id === id);
        const clientName = client?.name ?? `#${id}`;
        if (!confirm(`حذف الزبون "${clientName}"؟\n\nملاحظة: لا يمكن الحذف إذا كان للزبون عقود أو سجل زيارات أو مهام مكتملة.`)) return;
        try {
            await api.clients.delete(id);
            await fetchClients();
        } catch (err: any) {
            const payload = extractApiPayload(err);
            const msg = payload?.error || err?.response?.data?.error || err?.message || 'تعذر حذف الزبون';
            alert(msg);
            console.error('Failed to delete client:', err);
        }
    };

    const handleSaveClient = async (clientData: Client) => {
        try {
            if (editingClient) {
                // Warn about OP/FOP transition
                const wasOpFop = ['OP', 'FOP'].includes(editingClient.candidateStatus ?? '');
                const nowOpFop = ['OP', 'FOP'].includes(clientData.candidateStatus ?? '');
                if (!wasOpFop && nowOpFop) {
                    const ok = confirm('تغيير الحالة إلى OP/FOP سيحذف جميع التعيينات الشخصية ويلغي المهام التسويقية. تأكيد؟');
                    if (!ok) return;
                }
                await api.clients.update(clientData.id, clientData);
            } else {
                await api.clients.create({
                    ...clientData,
                    createdAt: new Date().toISOString(),
                    status: 'New',
                    isCandidate: activeTab === 'candidates',
                });
            }
            await fetchClients();
            setIsModalOpen(false);
            setIsAddCandidateModalOpen(false);
            setEditingClient(null);
        } catch (err) {
            const payload = extractApiPayload(err);
            if (payload?.status === 'MATCH_RESTRICTED') {
                alert(payload.message || 'الرقم موجود مسبقاً في النظام ولا يمكنك عرض تفاصيله.');
                return;
            }

            if (payload?.status === 'MATCH_VISIBLE') {
                alert(`الرقم موجود مسبقاً للزبون: ${payload.client?.name || `#${payload.client?.id}`}`);
                return;
            }

            const serverMsg = (err as any)?.response?.data?.error || (err as any)?.message;
            console.error('Failed to save client:', err);
            alert(serverMsg || 'تعذر حفظ الزبون حالياً.');
        }
    };

    const openEditModal = (client: Client) => { setEditingClient(client); setIsModalOpen(true); };

    const getNeighborhoodHierarchy = (id: string) => {
        const nId = parseInt(id);
        const neighborhood = geoUnits.find(gu => gu.id === nId);
        if (!neighborhood) return '--';
        const subArea = geoUnits.find(gu => gu.id === neighborhood.parentId);
        if (subArea) return `${subArea.name} > ${neighborhood.name}`;
        return neighborhood.name;
    };

    const clientColumns: ColumnDef<Client & { lifecycleStage: string }>[] = [
        { key: 'id', label: 'ID', sortable: true, render: (c) => <span className="text-sm text-slate-500 font-mono">#{c.id}</span> },
        {
            key: 'name', label: 'الاسم الكامل', sortable: true,
            render: (c) => (
                <div className="flex items-center gap-3">
                    <ClientAvatar gender={c.gender} dataQuality={c.dataQuality} size="sm" />
                    <div>
                        <span className="block text-slate-800 font-semibold text-sm">{c.firstName} {c.fatherName} {c.lastName}</span>
                        {c.nickname && <span className="block text-xs text-slate-400">({c.nickname})</span>}
                    </div>
                </div>
            ),
        },
        {
            key: 'contacts', label: 'رقم الموبايل الرئيسي', sortable: false, render: (c) => {
                const primary = c.contacts?.find(con => con.isPrimary)?.number || c.contacts?.[0]?.number || '--';
                return <span className="text-sm text-slate-600 font-mono tracking-wide">{primary}</span>;
            }
        },
        { key: 'neighborhood', label: 'العنوان', sortable: false, render: (c) => <span className="text-sm text-slate-600 font-medium">{getNeighborhoodHierarchy(c.neighborhood)}</span> },
        { key: 'occupation', label: 'العنوان', sortable: false, render: (c) => <span className="text-sm text-slate-600">{getNeighborhoodHierarchy(c.neighborhood)}</span> },
        {
            key: 'status', label: 'التصنيف', sortable: true,
            render: (c) => {
                const stage = c.lifecycleStage;
                if (stage === 'OP') return <span className="px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700 text-xs font-bold border border-emerald-200 shadow-sm flex items-center gap-1 w-fit"><CheckCircle2 className="w-3 h-3" /> زبون فعلي (OP)</span>;
                if (stage === 'FOP') return <span className="px-2.5 py-1 rounded-full bg-orange-100 text-orange-700 text-xs font-bold border border-orange-200 shadow-sm flex items-center gap-1 w-fit"><Clock className="w-3 h-3" /> مستهدف (FOP)</span>;
                return <span className="px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 text-xs font-bold border border-slate-200 flex items-center gap-1 w-fit"><AlertCircle className="w-3 h-3" /> مرشح (Lead)</span>;
            },
            getValue: (c) => c.lifecycleStage
        },
        {
            key: 'rating', label: 'الالتزام', sortable: true,
            render: (c) => {
                const r = c.rating || 'Undefined';
                if (r === 'Committed') return <span className="px-2.5 py-1 rounded-lg bg-green-50 text-green-700 text-xs font-black border border-green-200">ملتزم</span>;
                if (r === 'NotCommitted') return <span className="px-2.5 py-1 rounded-lg bg-red-50 text-red-700 text-xs font-black border border-red-200">غير ملتزم</span>;
                return <span className="px-2.5 py-1 rounded-lg bg-slate-50 text-slate-400 text-xs font-black border border-slate-200">غير محدد</span>;
            }
        },
        {
            key: 'referrerType', label: 'نوع الوسيط', sortable: false,
            render: (c) => {
                const types: Record<string, string> = {
                    'Personal': 'شخصي',
                    'Employee': 'موظف',
                    'Client': 'زبون حالي',
                    'Unknown': 'مجهول',
                    'Other': 'أخرى',
                };
                return <span className="text-xs text-slate-600 bg-slate-50 px-2 py-1 rounded border border-slate-200">{types[c.referrerType || ''] || c.referrerType || '--'}</span>;
            }
        },
        { key: 'referrerName', label: 'اسم الوسيط', sortable: false, render: (c) => <span className="text-sm font-medium text-slate-700">{c.referrerName || '--'}</span> },
    ];

    const visibleClientColumns: ColumnDef<Client & { lifecycleStage: string }>[] = [
        clientColumns[0],
        clientColumns[1],
        clientColumns[2],
        {
            key: 'branchName',
            label: 'فرع التسجيل',
            sortable: true,
            render: (c) => (
                <span className="inline-flex items-center rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-bold text-slate-700">
                    {c.branchName || '--'}
                </span>
            ),
            getValue: (c) => c.branchName || '',
        },
        // Only GLOBAL and BRANCH scope users may see assignment info
        ...(canSeeAssignments ? [{
            key: 'ownership' as const,
            label: 'الملكية',
            sortable: false,
            render: (c: Client & { lifecycleStage: string }) => {
                return <OwnershipCell ownership={c.ownership} />;
            },
            getValue: (c: Client & { lifecycleStage: string }) => c.ownership?.ownerLabel || '',
        }] : []),
        ...clientColumns.slice(4),
    ];

    const candidateColumns: ColumnDef<Client>[] = [
        { key: 'name', label: 'الاسم المرشح', sortable: true, render: (c) => <span className="font-semibold text-slate-700">{c.name}</span> },
        { key: 'mobile', label: 'رقم الهاتف', sortable: true, render: (c) => <span className="font-mono text-slate-600">{c.mobile}</span> },
        { key: 'sourceChannel', label: 'المصدر', sortable: true, render: (c) => <span className="text-xs bg-slate-100 text-slate-500 px-2 py-1 rounded">{c.sourceChannel || 'N/A'}</span> },
        { key: 'createdAt', label: 'تاريخ الإضافة', sortable: true, render: (c) => <span className="text-sm text-slate-500">{c.createdAt?.slice(0, 10)}</span> },
    ];

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="w-8 h-8 animate-spin text-sky-500" />
            </div>
        );
    }

    return (
        <div className="p-8 space-y-6">
            {/* 1. Page Title */}
            <div className="flex items-center justify-between">
                <PageHeader
                    title="سجلات الزبائن"
                    subtitle="إدارة وتحليل بيانات الزبائن والشبكة"
                />
                <div className="flex items-center gap-3">
                    {/* GLOBAL branch filter moved to the unified external switcher
                        (sidebar). Branch users still see their pinned-branch badge. */}
                    {isBranchClients && (
                        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-100 border border-slate-200 text-slate-600 text-sm font-bold">
                            <Building2 className="w-4 h-4 shrink-0" />
                            <span className="truncate">
                                {branchOptions.find(b => b.id === authUser?.branchId)?.name ?? `الفرع #${authUser?.branchId ?? ''}`}
                            </span>
                        </div>
                    )}
                <Button
                    icon={UserPlus}
                    disabled={mustPickBranch}
                    title={mustPickBranch ? 'اختر فرعاً أولاً لإضافة زبون' : undefined}
                    onClick={() => {
                        setActiveCandidateForSearch({
                            id: 0,
                            firstName: '',
                            lastName: '',
                            nickname: '',
                            mobile: '',
                            referralType: 'Personal',
                            referralNameSnapshot: 'المدير/المشرف المباشر'
                        });
                        setIsPreAddModalOpen(true);
                    }}
                >
                    {mustPickBranch ? 'اختر فرعاً لإضافة زبون' : 'إضافة اسم مرشح جديد'}
                </Button>
                </div>
            </div>

            {/* 2. KPI Stat Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {[
                    { label: 'إجمالي الزبائن', value: kpis.total, icon: Users, color: 'text-sky-600', bg: 'bg-sky-50' },
                    { label: 'إجمالي الأسماء المرشحة', value: kpis.leads, icon: AlertCircle, color: 'text-slate-600', bg: 'bg-slate-50' },
                    { label: 'إجمالي الزبائن المحتملة FOP', value: kpis.fops, icon: Clock, color: 'text-amber-600', bg: 'bg-amber-50' },
                    { label: 'إجمالي الزبائن OP', value: kpis.ops, icon: CheckCircle2, color: 'text-emerald-600', bg: 'bg-emerald-50' },
                ].map((kpi, idx) => (
                    <div key={idx} className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm hover:shadow-md transition-all group">
                        <div className="flex items-center justify-between mb-2">
                            <div className={`p-2 rounded-xl ${kpi.bg} ${kpi.color} group-hover:scale-110 transition-transform`}>
                                <kpi.icon className="w-5 h-5" />
                            </div>
                            <span className="text-xs font-black text-slate-300 uppercase tracking-widest">مؤشرات مباشرة</span>
                        </div>
                        <p className="text-xs font-bold text-slate-400 mb-1">{kpi.label}</p>
                        <p className={`text-lg font-black ${kpi.color}`}>{kpi.value}</p>
                    </div>
                ))}
            </div>

            {/* 3. Unified Search & Filter Bar */}
            <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm space-y-4">
                <div className="flex flex-col md:flex-row items-center gap-4">
                    {/* Smart Search */}
                    <div className="relative flex-1 w-full">
                        <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                        <input
                            type="text"
                            placeholder="بحث ذكي (الاسم، الهاتف، المعرف، الوسيط)..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full bg-slate-50 border border-slate-200 rounded-xl pr-10 pl-4 py-3 text-sm focus:border-sky-500 focus:outline-none transition-all focus:bg-white"
                        />
                    </div>

                    {/* Filters */}
                    <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
                        <Select
                            value={filterClass}
                            onChange={setFilterClass}
                            ariaLabel="التصنيف"
                            options={[
                                { value: 'all', label: 'كل التصنيفات' },
                                { value: 'Lead', label: 'Lead - مرشح' },
                                { value: 'FOP', label: 'FOP - مستهدف' },
                                { value: 'OP', label: 'OP - فعلي' },
                            ]}
                        />

                        <Select
                            value={filterMediator}
                            onChange={setFilterMediator}
                            ariaLabel="نوع الوسيط"
                            options={[
                                { value: 'all', label: 'كل أنواع الوسيط' },
                                { value: 'Personal', label: 'شخصي' },
                                { value: 'Employee', label: 'موظف' },
                                { value: 'Client', label: 'زبون حالي' },
                            ]}
                        />

                        <Select
                            value={filterArea}
                            onChange={setFilterArea}
                            ariaLabel="المحافظة"
                            options={[{ value: 'all', label: 'كل المحافظات' }, ...geoUnits.filter(g => g.level === 1).map(g => ({ value: String(g.id), label: g.name }))]}
                        />

                        <button
                            onClick={() => { setSearchTerm(''); setFilterClass('all'); setFilterMediator('all'); setFilterArea('all'); }}
                            className="text-xs font-bold text-slate-400 hover:text-sky-600 px-3 transition-colors"
                        >
                            تفريغ الفلاتر
                        </button>

                        {canBulkActivate && total > 0 && (
                            <button
                                onClick={async () => {
                                    const all = await fetchAllFiltered();
                                    setBulkActivationTarget({ scope: 'filtered', clients: all });
                                }}
                                title="تفعيل حساب تطبيق للزبائن المطابقين للفلاتر الحالية"
                                className="text-xs font-bold text-emerald-600 hover:text-emerald-700 border border-emerald-200 hover:border-emerald-300 rounded-lg px-2.5 py-1 inline-flex items-center gap-1 transition-colors"
                            >
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                تفعيل نتائج الفلاتر ({total})
                            </button>
                        )}
                    </div>
                </div>
            </div >

            {/* 4. Main Data Table */}
            <SmartTable<Client & { lifecycleStage: string }>
                title="جدول بيانات الزبائن"
                icon={Users}
                scopeIndicator={<BranchScopeIndicator />}
                hideFilterBar={true}
                data={mainList}
                columns={visibleClientColumns}
                tableMinWidth={980}
                getId={(c) => c.id}
                defaultSortKey="id"
                defaultSortDir="desc"
                server={{
                    totalCount: total,
                    page,
                    itemsPerPage: limit,
                    onPageChange: setPage,
                    onItemsPerPageChange: (n) => { setLimit(n); setPage(1); },
                    sortKey,
                    sortDir,
                    onSortChange: (key, dir) => { setSortKey(key); setSortDir(dir); setPage(1); },
                }}
                onRowClick={(c) => navigate(`/clients/${c.id}`)}
                bulkActions={canBulkActivate ? [
                    {
                        label: 'تفعيل حسابات المحددين',
                        icon: CheckCircle2,
                        onClick: (items) => setBulkActivationTarget({
                            scope: 'selected',
                            clients: items,
                        }),
                    },
                ] : undefined}
                actions={(c) => (
                    <div className="flex items-center gap-1">
                        <button onClick={(e) => { e.stopPropagation(); openEditModal(c as any); }} className="p-1.5 rounded-lg hover:bg-white hover:shadow-sm text-slate-400 hover:text-sky-500 transition-all border border-transparent hover:border-slate-100" title="تعديل بيانات الزبون">
                            <Pencil className="w-4 h-4" />
                        </button>
                        {canDeleteClients && (
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    void deleteClient(c.id);
                                }}
                                className="p-1.5 rounded-lg hover:bg-white hover:shadow-sm text-slate-400 hover:text-rose-600 transition-all border border-transparent hover:border-rose-100"
                                title="حذف الزبون"
                            >
                                <Trash2 className="w-4 h-4" />
                            </button>
                        )}
                    </div>
                )}
                emptyIcon={Users}
                emptyMessage="لا يوجد سجلات زبائن حالياً"
            />

            <BulkActivateModal
                open={bulkActivationTarget != null}
                onClose={() => setBulkActivationTarget(null)}
                scope={bulkActivationTarget?.scope ?? 'selected'}
                clients={(bulkActivationTarget?.clients ?? []).map((client) => ({
                    id: client.id,
                    name: client.name || [client.firstName, client.fatherName, client.lastName].filter(Boolean).join(' ') || `#${client.id}`,
                    mobile: client.mobile ?? null,
                }))}
            />

            <ClientModal
                isOpen={isModalOpen || isAddCandidateModalOpen}
                onClose={() => {
                    setIsModalOpen(false);
                    setIsAddCandidateModalOpen(false);
                    setVerifiedPhone('');
                }}
                onSave={handleSaveClient}
                initialData={editingClient}
                geoUnits={geoUnits}
                lockedPhone={isAddCandidateModalOpen ? verifiedPhone : undefined}
            />

            <ManualSearchModal
                isOpen={isPreAddModalOpen}
                onClose={() => setIsPreAddModalOpen(false)}
                candidate={activeCandidateForSearch || {}}
                onLink={(entity, type) => {
                    setIsPreAddModalOpen(false);
                    if (type === 'Client') {
                        navigate(`/clients/${entity.id}`);
                    } else {
                        navigate(`/candidates`);
                    }
                }}
                onNoMatch={(mobile) => {
                    setVerifiedPhone(mobile);
                    setIsPreAddModalOpen(false);
                    setIsAddCandidateModalOpen(true);
                }}
            />


        </div >
    );
}
