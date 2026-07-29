import { useState, useEffect, useCallback, type ReactNode } from 'react';
import { FileText, Plus, Eye, Loader2, Building2, Search, SlidersHorizontal, ChevronDown, X, XCircle } from '../../components/ui/icons';
import SmartTable from '../../components/SmartTable';
import type { ColumnDef } from '../../components/SmartTable';
import Select from '../../components/ui/Select';
import DateField from '../../components/ui/DateField';
import BranchScopeIndicator from '../../components/BranchScopeIndicator';
import type { Contract } from '../../lib/types';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { usePermissions } from '../../hooks/usePermissions';
import { useAuthStore } from '../../hooks/useAuthStore';
import { useBranchContextStore } from '../../hooks/useBranchContextStore';

/* ------------------------------------------------------------------ */
/*  Config                                                              */
/* ------------------------------------------------------------------ */

const statusConfig: Record<string, { label: string; style: string }> = {
    draft: { label: 'مسودة', style: 'bg-slate-50 text-slate-600 border-slate-200' },
    active: { label: 'فعال', style: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    completed: { label: 'مكتمل', style: 'bg-blue-50 text-blue-700 border-blue-200' },
    cancelled: { label: 'ملغي', style: 'bg-red-50 text-red-600 border-red-200' },
};

const paymentLabels: Record<string, string> = { cash: 'نقدي', installment: 'أقساط' };

const formatDate = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('ar-SY', { month: 'short', day: 'numeric' });
const formatPrice = (n: number) => String(n) + ' ل.س';

// SmartTable column key → server sort key. Columns not listed are non-sortable
// (subquery-derived names / branch), so a header click never silently no-ops.
const SORT_KEY_MAP: Record<string, string> = {
    contractNumber: 'contractNumber',
    customerName: 'customerName',
    deviceModelName: 'deviceModelName',
    finalPrice: 'finalPrice',
    contractDate: 'contractDate',
    status: 'status',
};

const SALE_TYPE_LABELS: Record<string, string> = { tradein: 'استبدال', retention: 'احتفاظ', direct: 'بيع مباشر' };
const SALE_SUBTYPE_LABELS: Record<string, string> = { definitive: 'نهائي', temporary: 'مؤقت', free: 'مجاني' };
const STATUS_LABELS: Record<string, string> = { draft: 'مسودة', active: 'فعال', completed: 'مكتمل', cancelled: 'ملغي' };
const YESNO_LABELS: Record<string, string> = { yes: 'نعم', no: 'لا' };

// Labeled slot inside the unified filter panel.
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

/* ------------------------------------------------------------------ */
/*  Component                                                           */
/* ------------------------------------------------------------------ */

export default function ContractList() {
    const navigate = useNavigate();
    const { hasPermission } = usePermissions();
    const getPermissionScope = useAuthStore((s) => s.getPermissionScope);
    const contextBranchId = useBranchContextStore((s) => s.branchId);
    const [branchOptions, setBranchOptions] = useState<{ id: number; name: string }[]>([]);

    const canViewContracts = hasPermission('contracts.view_list');
    const canCreateContracts = hasPermission('contracts.create');

    // Branch filter follows contracts.view_list scope (NOT identity): only a
    // GLOBAL viewer may narrow by branch; BRANCH is server-scoped. Contracts are
    // branch-only — there is no ASSIGNED tier.
    const isGlobalView = getPermissionScope('contracts.view_list') === 'GLOBAL';

    // ─── Server-paginated data: `contracts` holds only the current page ───
    const [contracts, setContracts] = useState<Contract[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [initialLoad, setInitialLoad] = useState(true);

    const [page, setPage] = useState(1);
    const [limit, setLimit] = useState(10);
    const [sortKey, setSortKey] = useState<string | null>(null);
    const [sortDir, setSortDir] = useState<'asc' | 'desc' | null>(null);

    // ─── Filters & search ───
    const [searchTerm, setSearchTerm] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [filtersOpen, setFiltersOpen] = useState(false);
    const [filterStatus, setFilterStatus] = useState('all');
    const [filterPaymentType, setFilterPaymentType] = useState('all');
    const [filterSaleType, setFilterSaleType] = useState('all');
    const [filterSaleSubtype, setFilterSaleSubtype] = useState('all');
    const [filterSaleOwner, setFilterSaleOwner] = useState('all');
    const [filterClosingEmployee, setFilterClosingEmployee] = useState('all');
    const [filterDeviceModel, setFilterDeviceModel] = useState('all');
    const [filterHasDevice, setFilterHasDevice] = useState('all');
    const [filterGoldenWarranty, setFilterGoldenWarranty] = useState('all');
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');
    const [priceMin, setPriceMin] = useState('');
    const [priceMax, setPriceMax] = useState('');

    // Option sources (fetched separately — not derivable from the loaded page).
    const [employeeOptions, setEmployeeOptions] = useState<{ id: number; name: string }[]>([]);
    const [closerOptions, setCloserOptions] = useState<{ id: number; name: string }[]>([]);
    const [deviceModelOptions, setDeviceModelOptions] = useState<{ id: number; name: string }[]>([]);

    useEffect(() => {
        const t = setTimeout(() => { setDebouncedSearch(searchTerm); setPage(1); }, 300);
        return () => clearTimeout(t);
    }, [searchTerm]);

    useEffect(() => { setPage(1); }, [
        filterStatus, filterPaymentType, contextBranchId,
        filterSaleType, filterSaleSubtype, filterSaleOwner, filterClosingEmployee, filterDeviceModel,
        filterHasDevice, filterGoldenWarranty, dateFrom, dateTo, priceMin, priceMax,
    ]);

    useEffect(() => {
        if (!isGlobalView) return;
        api.branches.list()
            .then((rows) => setBranchOptions((rows as any[]).map((b) => ({ id: b.id, name: b.name }))))
            .catch(() => setBranchOptions([]));
    }, [isGlobalView]);

    // Option sources for the dynamic filters.
    useEffect(() => {
        const branchParam = isGlobalView ? contextBranchId : null;
        api.employees.list(branchParam)
            .then((rows) => setEmployeeOptions((rows as any[]).map((e) => ({ id: e.id, name: e.name }))))
            .catch(() => setEmployeeOptions([]));
    }, [isGlobalView, contextBranchId]);
    useEffect(() => {
        api.employees.closers()
            .then((rows) => setCloserOptions((rows as any[]).map((e) => ({ id: e.id, name: e.name }))))
            .catch(() => setCloserOptions([]));
    }, []);
    useEffect(() => {
        api.deviceModels.list({ activeOnly: true })
            .then((rows) => setDeviceModelOptions((rows as any[]).map((m) => ({ id: m.id, name: m.name ?? m.modelName ?? String(m.id) }))))
            .catch(() => setDeviceModelOptions([]));
    }, []);

    const fetchContracts = useCallback(async () => {
        const branchParam = isGlobalView ? contextBranchId : null;
        const useSort = sortDir != null && sortKey != null;
        const res = await api.contracts.listPaged({
            branchId: branchParam,
            page,
            limit,
            search: debouncedSearch,
            status: filterStatus,
            paymentType: filterPaymentType,
            saleType: filterSaleType,
            saleSubtype: filterSaleSubtype,
            saleOwner: filterSaleOwner,
            closingEmployee: filterClosingEmployee,
            deviceModel: filterDeviceModel,
            hasDevice: filterHasDevice,
            goldenWarranty: filterGoldenWarranty,
            dateFrom,
            dateTo,
            priceMin,
            priceMax,
            sortKey: useSort ? (SORT_KEY_MAP[sortKey!] ?? undefined) : undefined,
            sortDir: useSort ? sortDir : undefined,
        });
        setContracts(res.items as Contract[]);
        setTotal(res.total);
    }, [isGlobalView, contextBranchId, page, limit, debouncedSearch, filterStatus, filterPaymentType,
        filterSaleType, filterSaleSubtype, filterSaleOwner, filterClosingEmployee, filterDeviceModel,
        filterHasDevice, filterGoldenWarranty, dateFrom, dateTo, priceMin, priceMax, sortKey, sortDir]);

    useEffect(() => {
        if (!canViewContracts) { setLoading(false); setInitialLoad(false); return; }
        let active = true;
        setLoading(true);
        fetchContracts()
            .catch((err) => console.error('Failed to load contracts:', err))
            .finally(() => { if (active) { setLoading(false); setInitialLoad(false); } });
        return () => { active = false; };
    }, [canViewContracts, fetchContracts]);

    // Show the branch column only to a cross-branch viewer (GLOBAL, "all branches").
    const showBranchColumn = isGlobalView && contextBranchId == null;

    const columns: ColumnDef<Contract>[] = [
        {
            key: 'contractNumber', label: 'رقم العقد', sortable: true,
            render: (c) => <span className="text-sm font-mono font-semibold text-sky-600">{c.contractNumber}</span>,
        },
        {
            key: 'customerName', label: 'الزبون', sortable: true,
            render: (c) => <span className="text-sm font-semibold text-slate-800">{c.customerName}</span>,
        },
        ...(showBranchColumn ? [{
            key: 'branchName', label: 'الفرع', sortable: false,
            render: (c: Contract) => <span className="text-sm text-slate-600">{c.branchName || '—'}</span>,
        }] : []),
        {
            key: 'deviceModelName', label: 'الجهاز', sortable: true,
            render: (c) => (
                <div>
                    <span className="text-sm text-slate-700">{c.deviceModelName}</span>
                    <span className="text-xs text-slate-400 mr-1.5 font-mono">{c.serialNumber}</span>
                </div>
            ),
        },
        {
            key: 'finalPrice', label: 'المبلغ', sortable: true,
            render: (c) => (
                <div className="text-left" dir="ltr">
                    <span className="text-sm font-bold text-slate-800">{formatPrice(c.finalPrice)}</span>
                    <span className={`mr-1.5 px-1.5 py-0.5 rounded text-xs font-medium ${c.paymentType === 'cash' ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>
                        {paymentLabels[c.paymentType]}
                    </span>
                </div>
            ),
        },
        {
            key: 'saleOwnerName', label: 'صاحب البيعة', sortable: false,
            render: (c) => <span className="text-sm text-slate-600">{c.saleOwnerName || c.createdByName || '—'}</span>,
        },
        {
            key: 'closingEmployeeName', label: 'موظف التسكير', sortable: false,
            render: (c) => <span className="text-sm text-slate-600">{c.closingEmployeeName || '—'}</span>,
        },
        {
            key: 'contractDate', label: 'التاريخ', sortable: true,
            render: (c) => <span className="text-sm text-slate-500">{formatDate(c.contractDate)}</span>,
        },
        {
            key: 'status', label: 'الحالة', sortable: true,
            render: (c) => {
                const s = statusConfig[c.status];
                return <span className={`px-2.5 py-1 rounded-full text-xs font-medium border ${s.style}`}>{s.label}</span>;
            },
        },
    ];

    if (initialLoad) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="w-8 h-8 text-sky-500 animate-spin" />
            </div>
        );
    }

    const mustPickBranch = isGlobalView && contextBranchId == null;

    const clearAllFilters = () => {
        setSearchTerm(''); setFilterStatus('all'); setFilterPaymentType('all');
        setFilterSaleType('all'); setFilterSaleSubtype('all'); setFilterSaleOwner('all');
        setFilterClosingEmployee('all'); setFilterDeviceModel('all');
        setFilterHasDevice('all'); setFilterGoldenWarranty('all');
        setDateFrom(''); setDateTo(''); setPriceMin(''); setPriceMax('');
    };

    type Chip = { key: string; label: string; value: string; onRemove: () => void };
    const filterChips: Chip[] = [];
    if (filterStatus !== 'all') filterChips.push({ key: 'status', label: 'الحالة', value: STATUS_LABELS[filterStatus] ?? filterStatus, onRemove: () => setFilterStatus('all') });
    if (filterPaymentType !== 'all') filterChips.push({ key: 'payment', label: 'الدفع', value: filterPaymentType === 'cash' ? 'نقدي' : 'أقساط', onRemove: () => setFilterPaymentType('all') });
    if (filterSaleType !== 'all') filterChips.push({ key: 'saleType', label: 'نوع البيع', value: SALE_TYPE_LABELS[filterSaleType] ?? filterSaleType, onRemove: () => setFilterSaleType('all') });
    if (filterSaleSubtype !== 'all') filterChips.push({ key: 'saleSubtype', label: 'النوع الفرعي', value: SALE_SUBTYPE_LABELS[filterSaleSubtype] ?? filterSaleSubtype, onRemove: () => setFilterSaleSubtype('all') });
    if (filterSaleOwner !== 'all') filterChips.push({ key: 'owner', label: 'صاحب البيعة', value: employeeOptions.find((e) => String(e.id) === filterSaleOwner)?.name ?? filterSaleOwner, onRemove: () => setFilterSaleOwner('all') });
    if (filterClosingEmployee !== 'all') filterChips.push({ key: 'closer', label: 'موظف التسكير', value: closerOptions.find((e) => String(e.id) === filterClosingEmployee)?.name ?? filterClosingEmployee, onRemove: () => setFilterClosingEmployee('all') });
    if (filterDeviceModel !== 'all') filterChips.push({ key: 'model', label: 'الموديل', value: deviceModelOptions.find((m) => String(m.id) === filterDeviceModel)?.name ?? filterDeviceModel, onRemove: () => setFilterDeviceModel('all') });
    if (filterHasDevice !== 'all') filterChips.push({ key: 'hasDevice', label: 'لديه جهاز', value: YESNO_LABELS[filterHasDevice], onRemove: () => setFilterHasDevice('all') });
    if (filterGoldenWarranty !== 'all') filterChips.push({ key: 'golden', label: 'ضمان ذهبي', value: YESNO_LABELS[filterGoldenWarranty], onRemove: () => setFilterGoldenWarranty('all') });
    if (dateFrom || dateTo) filterChips.push({ key: 'date', label: 'الفترة', value: `${dateFrom || '…'} → ${dateTo || '…'}`, onRemove: () => { setDateFrom(''); setDateTo(''); } });
    if (priceMin || priceMax) filterChips.push({ key: 'price', label: 'المبلغ', value: `${priceMin || '…'} - ${priceMax || '…'}`, onRemove: () => { setPriceMin(''); setPriceMax(''); } });

    return (
        <div className="p-8 space-y-6">
            {/* Unified search & filter bar (server-driven) */}
            <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm space-y-3">
                <div className="flex flex-wrap items-center gap-3">
                    <div className="relative flex-1 min-w-[220px]">
                        <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                        <input
                            type="text"
                            placeholder="بحث عن عقد (رقم، زبون، جهاز، سيريال)..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full bg-slate-50 border border-slate-200 rounded-xl pr-10 pl-4 py-3 text-sm focus:border-sky-500 focus:outline-none transition-all focus:bg-white"
                        />
                    </div>
                    <button
                        onClick={() => setFiltersOpen((o) => !o)}
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
                    {canCreateContracts && (
                        <button
                            onClick={() => navigate('/contracts/new')}
                            disabled={mustPickBranch}
                            title={mustPickBranch ? 'اختر فرعاً أولاً لإضافة عقد' : undefined}
                            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold transition-colors shadow-sm disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed"
                        >
                            <Plus className="w-3.5 h-3.5" />
                            <span>{mustPickBranch ? 'اختر فرعاً لإضافة عقد' : 'عقد جديد'}</span>
                        </button>
                    )}
                </div>

                {filterChips.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2">
                        {filterChips.map((chip) => (
                            <ActiveFilterChip key={chip.key} label={chip.label} value={chip.value} onRemove={chip.onRemove} />
                        ))}
                    </div>
                )}

                {filtersOpen && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 pt-3 border-t border-dashed border-slate-200">
                        <FilterField label="الحالة">
                            <Select className="w-full" value={filterStatus} onChange={setFilterStatus} ariaLabel="الحالة"
                                options={[{ value: 'all', label: 'جميع الحالات' }, { value: 'draft', label: 'مسودة' }, { value: 'active', label: 'فعال' }, { value: 'completed', label: 'مكتمل' }, { value: 'cancelled', label: 'ملغي' }]} />
                        </FilterField>
                        <FilterField label="نوع الدفع">
                            <Select className="w-full" value={filterPaymentType} onChange={setFilterPaymentType} ariaLabel="نوع الدفع"
                                options={[{ value: 'all', label: 'كل أنواع الدفع' }, { value: 'cash', label: 'نقدي' }, { value: 'installment', label: 'أقساط' }]} />
                        </FilterField>
                        <FilterField label="نوع البيع">
                            <Select className="w-full" value={filterSaleType} onChange={setFilterSaleType} ariaLabel="نوع البيع"
                                options={[{ value: 'all', label: 'كل الأنواع' }, { value: 'direct', label: 'بيع مباشر' }, { value: 'tradein', label: 'استبدال' }, { value: 'retention', label: 'احتفاظ' }]} />
                        </FilterField>
                        <FilterField label="النوع الفرعي">
                            <Select className="w-full" value={filterSaleSubtype} onChange={setFilterSaleSubtype} ariaLabel="النوع الفرعي"
                                options={[{ value: 'all', label: 'الكل' }, { value: 'definitive', label: 'نهائي' }, { value: 'temporary', label: 'مؤقت' }, { value: 'free', label: 'مجاني' }]} />
                        </FilterField>
                        {employeeOptions.length > 0 && (
                            <FilterField label="صاحب البيعة">
                                <Select className="w-full" value={filterSaleOwner} onChange={setFilterSaleOwner} ariaLabel="صاحب البيعة"
                                    options={[{ value: 'all', label: 'الكل' }, ...employeeOptions.map((e) => ({ value: String(e.id), label: e.name }))]} />
                            </FilterField>
                        )}
                        {closerOptions.length > 0 && (
                            <FilterField label="موظف التسكير">
                                <Select className="w-full" value={filterClosingEmployee} onChange={setFilterClosingEmployee} ariaLabel="موظف التسكير"
                                    options={[{ value: 'all', label: 'الكل' }, ...closerOptions.map((e) => ({ value: String(e.id), label: e.name }))]} />
                            </FilterField>
                        )}
                        {deviceModelOptions.length > 0 && (
                            <FilterField label="موديل الجهاز">
                                <Select className="w-full" value={filterDeviceModel} onChange={setFilterDeviceModel} ariaLabel="موديل الجهاز"
                                    options={[{ value: 'all', label: 'كل الموديلات' }, ...deviceModelOptions.map((m) => ({ value: String(m.id), label: m.name }))]} />
                            </FilterField>
                        )}
                        <FilterField label="لديه جهاز مركّب">
                            <Select className="w-full" value={filterHasDevice} onChange={setFilterHasDevice} ariaLabel="لديه جهاز مركّب"
                                options={[{ value: 'all', label: 'الكل' }, { value: 'yes', label: 'نعم' }, { value: 'no', label: 'لا' }]} />
                        </FilterField>
                        <FilterField label="ضمان ذهبي فعّال">
                            <Select className="w-full" value={filterGoldenWarranty} onChange={setFilterGoldenWarranty} ariaLabel="ضمان ذهبي فعّال"
                                options={[{ value: 'all', label: 'الكل' }, { value: 'yes', label: 'نعم' }, { value: 'no', label: 'لا' }]} />
                        </FilterField>
                        <FilterField label="فترة التعاقد" wide>
                            <div className="flex items-center gap-1.5">
                                <DateField value={dateFrom} onChange={setDateFrom} placeholder="من تاريخ" className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 hover:border-slate-300 focus:border-sky-500 focus:outline-none transition-colors" />
                                <span className="text-xs text-slate-400 shrink-0">إلى</span>
                                <DateField value={dateTo} onChange={setDateTo} placeholder="إلى تاريخ" className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 hover:border-slate-300 focus:border-sky-500 focus:outline-none transition-colors" />
                            </div>
                        </FilterField>
                        <FilterField label="مدى المبلغ" wide>
                            <div className="flex items-center gap-1.5">
                                <input type="number" inputMode="numeric" value={priceMin} onChange={(e) => setPriceMin(e.target.value)} placeholder="من" className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 hover:border-slate-300 focus:border-sky-500 focus:outline-none transition-colors" />
                                <span className="text-xs text-slate-400 shrink-0">إلى</span>
                                <input type="number" inputMode="numeric" value={priceMax} onChange={(e) => setPriceMax(e.target.value)} placeholder="إلى" className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 hover:border-slate-300 focus:border-sky-500 focus:outline-none transition-colors" />
                            </div>
                        </FilterField>
                    </div>
                )}
            </div>

            <div className={`transition-opacity ${loading ? 'opacity-60 pointer-events-none' : ''}`}>
                <SmartTable<Contract>
                    title="إدارة العقود"
                    icon={FileText}
                    scopeIndicator={<BranchScopeIndicator />}
                    hideFilterBar={true}
                    data={contracts}
                    columns={columns}
                    getId={(c) => c.id}
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
                    headerActions={
                        isGlobalView && contextBranchId != null ? (
                            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-100 border border-slate-200 text-slate-600 text-xs font-bold">
                                <Building2 className="w-3.5 h-3.5 shrink-0" />
                                <span className="truncate">{branchOptions.find((b) => b.id === contextBranchId)?.name ?? `الفرع #${contextBranchId}`}</span>
                            </div>
                        ) : undefined
                    }
                    actions={(c) => (
                        <button
                            onClick={() => navigate(`/contracts/${c.id}`)}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium transition-colors"
                        >
                            <Eye className="w-3.5 h-3.5" /><span>عرض</span>
                        </button>
                    )}
                    emptyIcon={FileText}
                    emptyMessage="لا توجد عقود"
                />
            </div>
        </div>
    );
}
