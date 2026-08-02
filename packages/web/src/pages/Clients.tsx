import { useState, useCallback, useMemo, useEffect, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, Trash2, UserPlus, CheckCircle2, AlertCircle, Clock, Search, Lightbulb, Pencil, Loader2, Building2, SlidersHorizontal, ChevronDown, X, XCircle } from '../components/ui/icons';
import DateField from '../components/ui/DateField';
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

// Labeled slot inside the unified filter panel (mirrors CandidatesEntry pattern).
function FilterField({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
    return (
        <div className={`flex flex-col gap-1 ${wide ? 'sm:col-span-2' : ''}`}>
            <label className="px-1 text-[11px] font-bold text-slate-500">{label}</label>
            {children}
        </div>
    );
}

// Removable pill summarizing one applied filter.
function ActiveFilterChip({ label, value, onRemove }: { label: string; value: string; onRemove: () => void }) {
    return (
        <span className="inline-flex items-center gap-1.5 rounded-lg border border-sky-200 bg-sky-50 text-sky-700 py-1 pr-2.5 pl-1.5 text-xs font-bold">
            <span className="font-medium opacity-60">{label}:</span>
            <span className="max-w-[160px] truncate">{value}</span>
            <button type="button" onClick={onRemove} aria-label={`إزالة فلتر ${label}`} className="rounded p-0.5 transition-colors hover:bg-white/70">
                <X className="h-3 w-3" />
            </button>
        </span>
    );
}
import ClientModal from '../components/ClientModal';
import Button from '../components/ui/Button';
import Select from '../components/ui/Select';
import PageHeader from '../components/ui/PageHeader';
import ClientAvatar from '../components/ClientAvatar';
import SmartTable from '../components/SmartTable';
import type { ColumnDef, FilterDef } from '../components/SmartTable';
import { collectAllPages } from '../components/tableExport';
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
    // `initialLoad` gates the full-page spinner to the FIRST fetch only; later
    // refetches (filter/page/sort) keep the page mounted and just refresh the
    // table rows — no whole-page flash. See the render guard below.
    const [initialLoad, setInitialLoad] = useState(true);

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
    const [filterMediator, setFilterMediator] = useState('all');

    // Enriched catalog (§7) — all live in one unified, collapsible panel.
    const [filtersOpen, setFiltersOpen] = useState(false);
    const [filterOwner, setFilterOwner] = useState('all');
    const [filterRating, setFilterRating] = useState('all');
    // Geo cascade (branch-scoped): محافظة → منطقة → ناحية → حي, each optional.
    const [filterGov, setFilterGov] = useState('all');
    const [filterRegion, setFilterRegion] = useState('all');
    const [filterSubarea, setFilterSubarea] = useState('all');
    const [filterHood, setFilterHood] = useState('all');
    const [filterHasDevice, setFilterHasDevice] = useState('all');   // all | yes | no
    const [filterTaskType, setFilterTaskType] = useState('all');
    const [filterRoute, setFilterRoute] = useState('all');
    const [filterWaterSource, setFilterWaterSource] = useState('all');
    const [filterDataQuality, setFilterDataQuality] = useState('all');
    const [filterSerial, setFilterSerial] = useState('');
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');

    // Option sources for the dynamic filters (fetched separately — cannot be
    // derived from the loaded page under server pagination).
    const [ownerOptions, setOwnerOptions] = useState<{ id: number; name: string }[]>([]);
    const [taskTypeOptions, setTaskTypeOptions] = useState<{ value: string; label: string }[]>([]);
    const [routeOptions, setRouteOptions] = useState<{ id: number; name: string; points: { geoUnitId: number }[] }[]>([]);
    const [waterSourceOptions, setWaterSourceOptions] = useState<string[]>([]);
    // Branch-scoped geo units drive the cascade OPTIONS; the global `geoUnits`
    // (names) tree stays for row-address labels and subtree expansion.
    const [scopedGeo, setScopedGeo] = useState<GeoUnit[]>([]);

    // Debounce the free-text search so we don't fire a request per keystroke.
    useEffect(() => {
        const t = setTimeout(() => { setDebouncedSearch(searchTerm); setPage(1); }, 300);
        return () => clearTimeout(t);
    }, [searchTerm]);

    // Debounce the free-text serial lookup like the main search.
    const [debouncedSerial, setDebouncedSerial] = useState('');
    useEffect(() => {
        const t = setTimeout(() => { setDebouncedSerial(filterSerial); setPage(1); }, 300);
        return () => clearTimeout(t);
    }, [filterSerial]);

    // Any filter/branch change resets to the first page.
    useEffect(() => { setPage(1); }, [
        filterClass, filterMediator, branchContextId,
        filterOwner, filterRating, filterGov, filterRegion, filterSubarea, filterHood,
        filterHasDevice, filterTaskType, filterRoute, filterWaterSource, filterDataQuality, dateFrom, dateTo,
    ]);

    // Geo-tree child index + subtree expander (reused by the geo cascade AND the
    // route filter): expand root ids to their full subtree (from the global tree),
    // so the server matches every client under the selection (§7).
    const geoChildren = useMemo(() => {
        const m = new Map<number, number[]>();
        for (const g of geoUnits) {
            if (g.parentId == null) continue;
            const arr = m.get(g.parentId) ?? [];
            arr.push(g.id);
            m.set(g.parentId, arr);
        }
        return m;
    }, [geoUnits]);
    const expandSubtrees = useCallback((roots: number[]): string[] => {
        const out: number[] = [];
        const seen = new Set<number>();
        const stack = [...roots];
        while (stack.length) {
            const id = stack.pop()!;
            if (seen.has(id)) continue;
            seen.add(id);
            out.push(id);
            for (const child of geoChildren.get(id) ?? []) stack.push(child);
        }
        return out.map(String);
    }, [geoChildren]);

    const geoIdsCsv = useMemo(() => {
        const deepest = [filterHood, filterSubarea, filterRegion, filterGov].find(v => v !== 'all');
        return deepest ? expandSubtrees([Number(deepest)]).join(',') : '';
    }, [filterGov, filterRegion, filterSubarea, filterHood, expandSubtrees]);

    // Selected route → union of its points' subtrees (route filter, §7).
    const routeGeoIdsCsv = useMemo(() => {
        if (filterRoute === 'all') return '';
        const route = routeOptions.find(r => String(r.id) === filterRoute);
        return route ? expandSubtrees(route.points.map(p => p.geoUnitId)).join(',') : '';
    }, [filterRoute, routeOptions, expandSubtrees]);

    // Build the shared listPaged query from all current filter state.
    const buildListParams = useCallback((): Parameters<typeof api.clients.listPaged>[0] => {
        const branchParam = isGlobalClients ? branchContextId : null;
        return {
            branchId: branchParam,
            search: debouncedSearch,
            filterClass, filterMediator,
            geoIds: geoIdsCsv,
            routeGeoIds: routeGeoIdsCsv,
            owner: filterOwner, rating: filterRating,
            waterSource: filterWaterSource, dataQuality: filterDataQuality,
            hasDevice: filterHasDevice, taskType: filterTaskType,
            serial: debouncedSerial,
            createdFrom: dateFrom, createdTo: dateTo,
        };
    }, [isGlobalClients, branchContextId, debouncedSearch, filterClass, filterMediator, geoIdsCsv, routeGeoIdsCsv,
        filterOwner, filterRating, filterWaterSource, filterDataQuality, filterHasDevice, filterTaskType, debouncedSerial, dateFrom, dateTo]);

    const fetchClients = useCallback(async () => {
        const useSort = sortDir != null;
        const res = await api.clients.listPaged({
            ...buildListParams(),
            page,
            limit,
            sortKey: useSort ? (SORT_KEY_MAP[sortKey] ?? 'id') : undefined,
            sortDir: useSort ? sortDir : undefined,
        });
        setClients(res.items as Client[]);
        setTotal(res.total);
        setKpis(res.kpis);
    }, [buildListParams, page, limit, sortKey, sortDir]);

    // Refetch whenever any server-side query input changes (page/limit/sort/filters/branch).
    useEffect(() => {
        let active = true;
        setLoading(true);
        fetchClients()
            .catch(err => console.error('Failed to fetch clients:', err))
            .finally(() => { if (active) { setLoading(false); setInitialLoad(false); } });
        return () => { active = false; };
    }, [fetchClients]);

    // On-demand loader shared by whole-filter bulk actions and CSV export. It
    // keeps the active server filters and sort instead of exporting one page.
    const fetchAllFiltered = useCallback(async (): Promise<Array<Client & { lifecycleStage: string }>> => {
        const base = buildListParams();
        const useSort = sortDir != null;
        const rows = await collectAllPages<Client>(async (exportPage, exportLimit) => {
            const res = await api.clients.listPaged({
                ...base,
                page: exportPage,
                limit: exportLimit,
                sortKey: useSort ? (SORT_KEY_MAP[sortKey] ?? 'id') : undefined,
                sortDir: useSort ? sortDir : undefined,
            });
            return { items: res.items as Client[], total: res.total };
        });
        return rows.map(client => ({
            ...client,
            lifecycleStage: (client as Client & { lifecycleStage?: string }).lifecycleStage ?? 'Lead',
        }));
    }, [buildListParams, sortKey, sortDir]);

    // Owner options — eligible personal owners, scoped to the branch filter.
    useEffect(() => {
        const branchParam = isGlobalClients ? branchContextId : null;
        api.admin.hrUsers.nameListAssignable(branchParam)
            .then(rows => setOwnerOptions((rows as any[]).map(u => ({ id: u.id, name: u.name }))))
            .catch(() => setOwnerOptions([]));
    }, [isGlobalClients, branchContextId]);

    // Task-type options for the "has task of type" filter.
    useEffect(() => {
        api.admin.taskTypes.list(true)
            .then(rows => setTaskTypeOptions((rows as any[]).map(t => ({
                value: t.taskType ?? t.key,
                label: t.labelAr ?? t.arabicLabel ?? t.label ?? t.taskType ?? t.key,
            }))))
            .catch(() => setTaskTypeOptions([]));
    }, []);

    // Branch-scoped geo units for the cascade options: only the areas the branch
    // covers (national tree when GLOBAL is on "all branches"). Reset the cascade
    // when the scope changes so stale selections don't linger.
    useEffect(() => {
        const branchParam = isGlobalClients ? branchContextId : null;
        api.geoUnits.list(branchParam)
            .then(rows => setScopedGeo(rows as GeoUnit[]))
            .catch(() => setScopedGeo([]));
        setFilterGov('all'); setFilterRegion('all'); setFilterSubarea('all'); setFilterHood('all');
    }, [isGlobalClients, branchContextId]);

    // Route options (each carries its geo points for subtree expansion).
    useEffect(() => {
        api.routes.list()
            .then(rows => setRouteOptions((rows as any[]).map(r => ({
                id: r.id, name: r.name, points: Array.isArray(r.points) ? r.points.map((p: any) => ({ geoUnitId: p.geoUnitId })) : [],
            }))))
            .catch(() => setRouteOptions([]));
    }, []);

    // Water-source options (same admin list the client form uses).
    useEffect(() => {
        api.systemLists.list({ category: 'water_source', activeOnly: true })
            .then(rows => setWaterSourceOptions((rows as any[]).map(item => item.value)))
            .catch(() => setWaterSourceOptions([]));
    }, []);

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

    // ─── Filter option lists & applied-filter chips ───
    // Gated geo cascade: a level's options populate only once its parent is
    // determined — either explicitly selected, or auto-resolved when the level
    // above has exactly one option (branch coverage). This prevents any level
    // from dumping its whole list (e.g. "الحي" won't list every neighbourhood).
    const govOptions = useMemo(() => scopedGeo.filter(g => g.level === 1), [scopedGeo]);
    const effGov = filterGov !== 'all' ? Number(filterGov) : (govOptions.length === 1 ? govOptions[0].id : null);
    const regionOptions = useMemo(() => effGov == null ? [] : scopedGeo.filter(g => g.level === 2 && g.parentId === effGov), [scopedGeo, effGov]);
    const effRegion = filterRegion !== 'all' ? Number(filterRegion) : (regionOptions.length === 1 ? regionOptions[0].id : null);
    const subareaOptions = useMemo(() => effRegion == null ? [] : scopedGeo.filter(g => g.level === 3 && g.parentId === effRegion), [scopedGeo, effRegion]);
    const effSubarea = filterSubarea !== 'all' ? Number(filterSubarea) : (subareaOptions.length === 1 ? subareaOptions[0].id : null);
    const hoodOptions = useMemo(() => effSubarea == null ? [] : scopedGeo.filter(g => g.level === 4 && g.parentId === effSubarea), [scopedGeo, effSubarea]);
    const geoName = (id: string) => geoUnits.find(g => String(g.id) === id)?.name ?? scopedGeo.find(g => String(g.id) === id)?.name ?? id;
    const deepestGeo = [filterHood, filterSubarea, filterRegion, filterGov].find(v => v !== 'all');
    const resetGeo = () => { setFilterGov('all'); setFilterRegion('all'); setFilterSubarea('all'); setFilterHood('all'); };

    const RATING_LABELS: Record<string, string> = { Committed: 'ملتزم', NotCommitted: 'غير ملتزم', Undefined: 'غير محدد' };
    const DATA_QUALITY_LABELS: Record<string, string> = { correct: 'صحيحة', incorrect: 'غير صحيحة', needs_edit: 'تحتاج تعديل' };
    const YESNO_LABELS: Record<string, string> = { yes: 'نعم', no: 'لا' };
    const MEDIATOR_LABELS: Record<string, string> = { Personal: 'شخصي', Employee: 'موظف', Client: 'زبون حالي' };

    const clearAllFilters = useCallback(() => {
        setSearchTerm(''); setFilterClass('all'); setFilterMediator('all');
        setFilterGov('all'); setFilterRegion('all'); setFilterSubarea('all'); setFilterHood('all');
        setFilterOwner('all'); setFilterRating('all');
        setFilterHasDevice('all'); setFilterTaskType('all');
        setFilterRoute('all'); setFilterWaterSource('all'); setFilterDataQuality('all');
        setFilterSerial(''); setDateFrom(''); setDateTo('');
    }, []);

    type Chip = { key: string; label: string; value: string; onRemove: () => void };
    const filterChips: Chip[] = [];
    if (filterClass !== 'all') filterChips.push({ key: 'class', label: 'التصنيف', value: filterClass, onRemove: () => setFilterClass('all') });
    if (filterMediator !== 'all') filterChips.push({ key: 'mediator', label: 'نوع الوسيط', value: MEDIATOR_LABELS[filterMediator] ?? filterMediator, onRemove: () => setFilterMediator('all') });
    if (deepestGeo) filterChips.push({ key: 'geo', label: 'المنطقة', value: geoName(deepestGeo), onRemove: resetGeo });
    if (filterOwner !== 'all') filterChips.push({ key: 'owner', label: 'المسؤول', value: ownerOptions.find(o => String(o.id) === filterOwner)?.name ?? filterOwner, onRemove: () => setFilterOwner('all') });
    if (filterRating !== 'all') filterChips.push({ key: 'rating', label: 'الالتزام', value: RATING_LABELS[filterRating] ?? filterRating, onRemove: () => setFilterRating('all') });
    if (filterHasDevice !== 'all') filterChips.push({ key: 'device', label: 'لديه جهاز', value: YESNO_LABELS[filterHasDevice], onRemove: () => setFilterHasDevice('all') });
    if (filterTaskType !== 'all') filterChips.push({ key: 'taskType', label: 'نوع المهمة', value: taskTypeOptions.find(t => t.value === filterTaskType)?.label ?? filterTaskType, onRemove: () => setFilterTaskType('all') });
    if (filterRoute !== 'all') filterChips.push({ key: 'route', label: 'خط السير', value: routeOptions.find(r => String(r.id) === filterRoute)?.name ?? filterRoute, onRemove: () => setFilterRoute('all') });
    if (filterWaterSource !== 'all') filterChips.push({ key: 'water', label: 'مصدر المياه', value: filterWaterSource, onRemove: () => setFilterWaterSource('all') });
    if (filterDataQuality !== 'all') filterChips.push({ key: 'dq', label: 'صحة البيانات', value: DATA_QUALITY_LABELS[filterDataQuality] ?? filterDataQuality, onRemove: () => setFilterDataQuality('all') });
    if (filterSerial) filterChips.push({ key: 'serial', label: 'السيريال', value: filterSerial, onRemove: () => setFilterSerial('') });
    if (dateFrom || dateTo) filterChips.push({ key: 'date', label: 'التسجيل', value: `${dateFrom || '…'} → ${dateTo || '…'}`, onRemove: () => { setDateFrom(''); setDateTo(''); } });

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

    if (initialLoad) {
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

            {/* 3. Unified Search & Filter Bar (panel + chips) */}
            <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm space-y-3">
                {/* Toolbar: search · filters toggle · clear-all · bulk */}
                <div className="flex flex-wrap items-center gap-3">
                    <div className="relative flex-1 min-w-[220px]">
                        <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                        <input
                            type="text"
                            placeholder="بحث ذكي (الاسم، الهاتف، المعرف، الوسيط)..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full bg-slate-50 border border-slate-200 rounded-xl pr-10 pl-4 py-3 text-sm focus:border-sky-500 focus:outline-none transition-all focus:bg-white"
                        />
                    </div>

                    <button
                        onClick={() => setFiltersOpen(o => !o)}
                        aria-expanded={filtersOpen}
                        className={`flex items-center gap-2 px-4 py-3 rounded-xl border text-sm font-bold transition-all ${filtersOpen || filterChips.length > 0 ? 'border-sky-200 bg-sky-50 text-sky-700' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
                    >
                        <SlidersHorizontal className="w-4 h-4" /> الفلاتر
                        {filterChips.length > 0 && (
                            <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-sky-600 text-white text-[11px] font-black">{filterChips.length}</span>
                        )}
                        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${filtersOpen ? 'rotate-180' : ''}`} />
                    </button>

                    {(filterChips.length > 0 || searchTerm) && (
                        <button onClick={clearAllFilters} className="flex items-center gap-1 text-xs font-bold text-slate-500 hover:text-red-600 transition-colors">
                            <XCircle className="w-4 h-4" /> مسح الكل
                        </button>
                    )}

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

                {/* Applied-filter chips — always-visible "what's applied", each removable */}
                {filterChips.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2">
                        {filterChips.map(chip => (
                            <ActiveFilterChip key={chip.key} label={chip.label} value={chip.value} onRemove={chip.onRemove} />
                        ))}
                    </div>
                )}

                {/* Unified filter panel — every filter, labeled, in a flat grid */}
                {filtersOpen && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 pt-3 border-t border-dashed border-slate-200">
                        <FilterField label="التصنيف">
                            <Select className="w-full" value={filterClass} onChange={setFilterClass} ariaLabel="التصنيف"
                                options={[{ value: 'all', label: 'كل التصنيفات' }, { value: 'Lead', label: 'Lead - مرشح' }, { value: 'FOP', label: 'FOP - مستهدف' }, { value: 'OP', label: 'OP - فعلي' }]} />
                        </FilterField>
                        <FilterField label="الالتزام">
                            <Select className="w-full" value={filterRating} onChange={setFilterRating} ariaLabel="الالتزام"
                                options={[{ value: 'all', label: 'كل التقييمات' }, { value: 'Committed', label: 'ملتزم' }, { value: 'NotCommitted', label: 'غير ملتزم' }, { value: 'Undefined', label: 'غير محدد' }]} />
                        </FilterField>
                        {ownerOptions.length > 0 && (
                            <FilterField label="المسؤول">
                                <Select className="w-full" value={filterOwner} onChange={setFilterOwner} ariaLabel="المسؤول"
                                    options={[{ value: 'all', label: 'كل المسؤولين' }, ...ownerOptions.map(o => ({ value: String(o.id), label: o.name }))]} />
                            </FilterField>
                        )}
                        <FilterField label="نوع الوسيط">
                            <Select className="w-full" value={filterMediator} onChange={setFilterMediator} ariaLabel="نوع الوسيط"
                                options={[{ value: 'all', label: 'كل أنواع الوسيط' }, { value: 'Personal', label: 'شخصي' }, { value: 'Employee', label: 'موظف' }, { value: 'Client', label: 'زبون حالي' }]} />
                        </FilterField>
                        {govOptions.length > 1 && (
                            <FilterField label="المحافظة">
                                <Select className="w-full" value={filterGov} onChange={(v) => { setFilterGov(v); setFilterRegion('all'); setFilterSubarea('all'); setFilterHood('all'); }} ariaLabel="المحافظة"
                                    options={[{ value: 'all', label: 'كل المحافظات' }, ...govOptions.map(g => ({ value: String(g.id), label: g.name }))]} />
                            </FilterField>
                        )}
                        {regionOptions.length > 1 && (
                            <FilterField label="المنطقة">
                                <Select className="w-full" value={filterRegion} onChange={(v) => { setFilterRegion(v); setFilterSubarea('all'); setFilterHood('all'); }} ariaLabel="المنطقة"
                                    options={[{ value: 'all', label: 'كل المناطق' }, ...regionOptions.map(g => ({ value: String(g.id), label: g.name }))]} />
                            </FilterField>
                        )}
                        {subareaOptions.length > 1 && (
                            <FilterField label="الناحية">
                                <Select className="w-full" value={filterSubarea} onChange={(v) => { setFilterSubarea(v); setFilterHood('all'); }} ariaLabel="الناحية"
                                    options={[{ value: 'all', label: 'كل النواحي' }, ...subareaOptions.map(g => ({ value: String(g.id), label: g.name }))]} />
                            </FilterField>
                        )}
                        {hoodOptions.length > 1 && (
                            <FilterField label="الحي">
                                <Select className="w-full" value={filterHood} onChange={setFilterHood} ariaLabel="الحي"
                                    options={[{ value: 'all', label: 'كل الأحياء' }, ...hoodOptions.map(g => ({ value: String(g.id), label: g.name }))]} />
                            </FilterField>
                        )}
                        <FilterField label="لديه جهاز">
                            <Select className="w-full" value={filterHasDevice} onChange={setFilterHasDevice} ariaLabel="لديه جهاز"
                                options={[{ value: 'all', label: 'الكل' }, { value: 'yes', label: 'نعم' }, { value: 'no', label: 'لا' }]} />
                        </FilterField>
                        {taskTypeOptions.length > 0 && (
                            <FilterField label="نوع المهمة">
                                <Select className="w-full" value={filterTaskType} onChange={setFilterTaskType} ariaLabel="نوع المهمة"
                                    options={[{ value: 'all', label: 'كل الأنواع' }, ...taskTypeOptions]} />
                            </FilterField>
                        )}
                        {routeOptions.length > 0 && (
                            <FilterField label="خط السير">
                                <Select className="w-full" value={filterRoute} onChange={setFilterRoute} ariaLabel="خط السير"
                                    options={[{ value: 'all', label: 'كل الخطوط' }, ...routeOptions.map(r => ({ value: String(r.id), label: r.name }))]} />
                            </FilterField>
                        )}
                        {waterSourceOptions.length > 0 && (
                            <FilterField label="مصدر المياه">
                                <Select className="w-full" value={filterWaterSource} onChange={setFilterWaterSource} ariaLabel="مصدر المياه"
                                    options={[{ value: 'all', label: 'كل المصادر' }, ...waterSourceOptions.map(w => ({ value: w, label: w }))]} />
                            </FilterField>
                        )}
                        <FilterField label="صحة البيانات">
                            <Select className="w-full" value={filterDataQuality} onChange={setFilterDataQuality} ariaLabel="صحة البيانات"
                                options={[{ value: 'all', label: 'الكل' }, { value: 'correct', label: 'صحيحة' }, { value: 'incorrect', label: 'غير صحيحة' }, { value: 'needs_edit', label: 'تحتاج تعديل' }]} />
                        </FilterField>
                        <FilterField label="الرقم التسلسلي للجهاز">
                            <input type="text" value={filterSerial} onChange={e => setFilterSerial(e.target.value)} placeholder="بحث بالسيريال"
                                className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 hover:border-slate-300 focus:border-sky-500 focus:outline-none transition-colors" />
                        </FilterField>
                        <FilterField label="فترة التسجيل" wide>
                            <div className="flex items-center gap-1.5">
                                <DateField value={dateFrom} onChange={setDateFrom} placeholder="من تاريخ" className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 hover:border-slate-300 focus:border-sky-500 focus:outline-none transition-colors" />
                                <span className="text-xs text-slate-400 shrink-0">إلى</span>
                                <DateField value={dateTo} onChange={setDateTo} placeholder="إلى تاريخ" className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 hover:border-slate-300 focus:border-sky-500 focus:outline-none transition-colors" />
                            </div>
                        </FilterField>
                    </div>
                )}
            </div >

            {/* 4. Main Data Table — dimmed (not unmounted) while a refetch is in flight */}
            <div className={`transition-opacity ${loading ? 'opacity-60 pointer-events-none' : ''}`}>
            <SmartTable<Client & { lifecycleStage: string }>
                title="جدول بيانات الزبائن"
                icon={Users}
                scopeIndicator={<BranchScopeIndicator />}
                hideFilterBar={true}
                data={mainList}
                columns={visibleClientColumns}
                exportRows={fetchAllFiltered}
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
            </div>

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
