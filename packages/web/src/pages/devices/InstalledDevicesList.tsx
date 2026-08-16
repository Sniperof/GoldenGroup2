import { useState, useEffect, useCallback, type ReactNode } from 'react';
import { HardDrive, Eye, Loader2, ShieldCheck, MapPin, Search, SlidersHorizontal, ChevronDown, X, XCircle, Building2 } from '../../components/ui/icons';
import SmartTable from '../../components/SmartTable';
import type { ColumnDef } from '../../components/SmartTable';
import { collectAllPages } from '../../components/tableExport';
import Select from '../../components/ui/Select';
import DateField from '../../components/ui/DateField';
import BranchScopeIndicator from '../../components/BranchScopeIndicator';
import { useGeoCascade, GeoCascadeFields } from '../../components/filters/GeoCascadeFilter';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { usePermissions } from '../../hooks/usePermissions';
import { useAuthStore } from '../../hooks/useAuthStore';
import { useBranchContextStore } from '../../hooks/useBranchContextStore';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface InstalledDevice {
    id: number;
    contractId: number | null;
    customerId: number;
    branchId: number | null;
    deviceSource: string;
    saleSubtype: string | null;
    deviceModelName: string | null;
    serialNumber: string | null;
    status: string;
    installationGeoUnitName: string | null;
    installationAddressText: string | null;
    deliveryDate: string | null;
    installationDate: string | null;
    isGoldenWarranty: boolean;
    warrantyMonths: number | null;
    warrantyVisits: number | null;
    contractNumber: string | null;
    customerName: string | null;
    branchName: string | null;
}

/* ------------------------------------------------------------------ */
/*  Config — operational status dictionary (DEC-CT-03, 11 states)      */
/* ------------------------------------------------------------------ */

const statusConfig: Record<string, { label: string; style: string }> = {
    registered:        { label: 'مُسجّل',          style: 'bg-slate-50 text-slate-600 border-slate-200' },
    pending_delivery:  { label: 'بانتظار التسليم', style: 'bg-amber-50 text-amber-700 border-amber-200' },
    delivered:         { label: 'مُسلّم',          style: 'bg-sky-50 text-sky-700 border-sky-200' },
    installed:         { label: 'مُركّب',          style: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
    active:            { label: 'فعّال',           style: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    faulty:            { label: 'متعطّل',          style: 'bg-red-50 text-red-600 border-red-200' },
    in_workshop:       { label: 'في الورشة',       style: 'bg-orange-50 text-orange-700 border-orange-200' },
    ready:             { label: 'جاهز',            style: 'bg-teal-50 text-teal-700 border-teal-200' },
    out_of_service:    { label: 'خارج الخدمة',     style: 'bg-slate-100 text-slate-500 border-slate-300' },
    retrieved:         { label: 'مُسترجَع',        style: 'bg-purple-50 text-purple-700 border-purple-200' },
    contract_cancelled:{ label: 'مُلغى (عقد)',      style: 'bg-rose-50 text-rose-700 border-rose-200' },
};

const sourceLabels: Record<string, string> = { company_contract: 'شركة (عقد)', external: 'خارجي' };
const subtypeLabels: Record<string, string> = { definitive: 'قطعي', temporary: 'مؤقت', free: 'هدية' };
const YESNO_LABELS: Record<string, string> = { yes: 'نعم', no: 'لا' };

// SmartTable column key → server sort key (INSTALLED_DEVICE_SORT_COLUMNS).
const SORT_KEY_MAP: Record<string, string> = {
    deviceModelName: 'deviceModelName',
    customerName: 'customerName',
    installationDate: 'installationDate',
    status: 'status',
};

const formatDate = (d: string | null) => {
    if (!d) return '—';
    const dt = new Date(String(d).slice(0, 10) + 'T00:00:00');
    return isNaN(dt.getTime()) ? '—' : dt.toLocaleDateString('ar-SY', { month: 'short', day: 'numeric', year: 'numeric' });
};

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

export default function InstalledDevicesList() {
    const navigate = useNavigate();
    const { hasPermission } = usePermissions();
    const getPermissionScope = useAuthStore((s) => s.getPermissionScope);
    const contextBranchId = useBranchContextStore((s) => s.branchId);
    const [branchOptions, setBranchOptions] = useState<{ id: number; name: string }[]>([]);

    const canViewDevices = hasPermission('installed_devices.view');

    // Branch scope follows installed_devices.view (NOT identity): only a GLOBAL
    // viewer may narrow by branch; BRANCH is server-scoped. Devices are branch-only.
    const isGlobalView = getPermissionScope('installed_devices.view') === 'GLOBAL';

    // Branch-scoped geo cascade (محافظة → منطقة → ناحية → حي) → geoIdsCsv subtree.
    const geo = useGeoCascade({ branchId: isGlobalView ? contextBranchId : null });

    // ─── Server-paginated data: `devices` holds only the current page ───
    const [devices, setDevices] = useState<InstalledDevice[]>([]);
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
    const [filterSource, setFilterSource] = useState('all');
    const [filterGolden, setFilterGolden] = useState('all');
    const [filterSaleSubtype, setFilterSaleSubtype] = useState('all');
    const [filterDeviceModel, setFilterDeviceModel] = useState('all');
    const [filterServiceAgreement, setFilterServiceAgreement] = useState('all');
    const [filterWarrantyExpiring, setFilterWarrantyExpiring] = useState('all');
    const [installFrom, setInstallFrom] = useState('');
    const [installTo, setInstallTo] = useState('');

    const [deviceModelOptions, setDeviceModelOptions] = useState<{ id: number; name: string }[]>([]);

    useEffect(() => {
        const t = setTimeout(() => { setDebouncedSearch(searchTerm); setPage(1); }, 300);
        return () => clearTimeout(t);
    }, [searchTerm]);

    useEffect(() => { setPage(1); }, [
        filterStatus, filterSource, filterGolden, filterSaleSubtype, filterDeviceModel,
        filterServiceAgreement, filterWarrantyExpiring, installFrom, installTo, contextBranchId, geo.geoIdsCsv,
    ]);

    useEffect(() => {
        if (!isGlobalView) return;
        api.branches.list()
            .then((rows) => setBranchOptions((rows as any[]).map((b) => ({ id: b.id, name: b.name }))))
            .catch(() => setBranchOptions([]));
    }, [isGlobalView]);

    useEffect(() => {
        api.deviceModels.list({ activeOnly: true })
            .then((rows) => setDeviceModelOptions((rows as any[]).map((m) => ({ id: m.id, name: m.name ?? m.modelName ?? String(m.id) }))))
            .catch(() => setDeviceModelOptions([]));
    }, []);

    const buildListParams = useCallback((): Parameters<typeof api.installedDevices.listPaged>[0] => {
        const branchParam = isGlobalView ? contextBranchId : null;
        const useSort = sortDir != null && sortKey != null;
        return {
            branchId: branchParam,
            search: debouncedSearch,
            status: filterStatus,
            deviceSource: filterSource,
            goldenWarranty: filterGolden === 'all' ? undefined : (filterGolden === 'yes' ? 'true' : 'false'),
            saleSubtype: filterSaleSubtype,
            deviceModel: filterDeviceModel,
            hasServiceAgreement: filterServiceAgreement,
            warrantyExpiringDays: filterWarrantyExpiring === 'all' ? undefined : filterWarrantyExpiring,
            installFrom,
            installTo,
            geoIds: geo.geoIdsCsv || undefined,
            sortKey: useSort ? (SORT_KEY_MAP[sortKey!] ?? undefined) : undefined,
            sortDir: useSort ? sortDir : undefined,
        };
    }, [isGlobalView, contextBranchId, debouncedSearch, filterStatus, filterSource, filterGolden,
        filterSaleSubtype, filterDeviceModel, filterServiceAgreement, filterWarrantyExpiring, installFrom, installTo, geo.geoIdsCsv, sortKey, sortDir]);

    const fetchDevices = useCallback(async () => {
        const res = await api.installedDevices.listPaged({
            ...buildListParams(),
            page,
            limit,
        });
        setDevices(res.items as InstalledDevice[]);
        setTotal(res.total);
    }, [buildListParams, page, limit]);

    const fetchAllFiltered = useCallback(() => collectAllPages<InstalledDevice>(async (exportPage, exportLimit) => {
        const res = await api.installedDevices.listPaged({
            ...buildListParams(),
            page: exportPage,
            limit: exportLimit,
        });
        return { items: res.items as InstalledDevice[], total: res.total };
    }), [buildListParams]);

    useEffect(() => {
        if (!canViewDevices) { setLoading(false); setInitialLoad(false); return; }
        let active = true;
        setLoading(true);
        fetchDevices()
            .catch((err) => console.error('Failed to load installed devices:', err))
            .finally(() => { if (active) { setLoading(false); setInitialLoad(false); } });
        return () => { active = false; };
    }, [canViewDevices, fetchDevices]);

    // Branch column only for a cross-branch viewer (GLOBAL with "all branches").
    const showBranchColumn = isGlobalView && contextBranchId == null;

    const clearAllFilters = () => {
        setSearchTerm(''); setFilterStatus('all'); setFilterSource('all'); setFilterGolden('all');
        setFilterSaleSubtype('all'); setFilterDeviceModel('all'); setFilterServiceAgreement('all');
        setFilterWarrantyExpiring('all'); setInstallFrom(''); setInstallTo(''); geo.reset();
    };

    type Chip = { key: string; label: string; value: string; onRemove: () => void };
    const filterChips: Chip[] = [];
    if (filterStatus !== 'all') filterChips.push({ key: 'status', label: 'الحالة', value: statusConfig[filterStatus]?.label ?? filterStatus, onRemove: () => setFilterStatus('all') });
    if (filterSource !== 'all') filterChips.push({ key: 'source', label: 'المصدر', value: sourceLabels[filterSource] ?? filterSource, onRemove: () => setFilterSource('all') });
    if (filterGolden !== 'all') filterChips.push({ key: 'golden', label: 'ضمان ذهبي', value: YESNO_LABELS[filterGolden], onRemove: () => setFilterGolden('all') });
    if (filterSaleSubtype !== 'all') filterChips.push({ key: 'subtype', label: 'النوع الفرعي', value: subtypeLabels[filterSaleSubtype] ?? filterSaleSubtype, onRemove: () => setFilterSaleSubtype('all') });
    if (filterDeviceModel !== 'all') filterChips.push({ key: 'model', label: 'الموديل', value: deviceModelOptions.find((m) => String(m.id) === filterDeviceModel)?.name ?? filterDeviceModel, onRemove: () => setFilterDeviceModel('all') });
    if (filterServiceAgreement !== 'all') filterChips.push({ key: 'sa', label: 'اتفاق خدمة ساري', value: YESNO_LABELS[filterServiceAgreement], onRemove: () => setFilterServiceAgreement('all') });
    if (filterWarrantyExpiring !== 'all') filterChips.push({ key: 'exp', label: 'كفالة تنتهي خلال', value: `${filterWarrantyExpiring} يوم`, onRemove: () => setFilterWarrantyExpiring('all') });
    if (installFrom || installTo) filterChips.push({ key: 'install', label: 'فترة التركيب', value: `${installFrom || '…'} → ${installTo || '…'}`, onRemove: () => { setInstallFrom(''); setInstallTo(''); } });
    if (geo.active) filterChips.push({ key: 'geo', label: 'الموقع', value: geo.chipLabel ?? '—', onRemove: geo.reset });

    const columns: ColumnDef<InstalledDevice>[] = [
        {
            key: 'deviceModelName', label: 'الجهاز', sortable: true,
            render: (d) => (
                <div>
                    <span className="text-sm font-semibold text-slate-800">{d.deviceModelName || '—'}</span>
                    {d.serialNumber && (
                        <span className="block text-xs text-slate-400 font-mono">{d.serialNumber}</span>
                    )}
                </div>
            ),
        },
        {
            key: 'customerName', label: 'الزبون', sortable: true,
            render: (d) => <span className="text-sm text-slate-700">{d.customerName || '—'}</span>,
        },
        ...(showBranchColumn ? [{
            key: 'branchName', label: 'الفرع',
            render: (d: InstalledDevice) => <span className="text-sm text-slate-600">{d.branchName || '—'}</span>,
        }] : []),
        {
            key: 'installationGeoUnitName', label: 'الموقع',
            render: (d) => (
                <span className="text-sm text-slate-600 inline-flex items-center gap-1">
                    {d.installationGeoUnitName ? <MapPin className="w-3 h-3 text-slate-400" /> : null}
                    {d.installationGeoUnitName || '—'}
                </span>
            ),
        },
        {
            key: 'deviceSource', label: 'المصدر',
            render: (d) => {
                const subtype = d.deviceSource !== 'external' && d.saleSubtype ? subtypeLabels[d.saleSubtype] ?? d.saleSubtype : null;
                return (
                    <div className="flex items-center gap-1.5">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${d.deviceSource === 'external' ? 'bg-fuchsia-50 text-fuchsia-700' : 'bg-slate-50 text-slate-600'}`}>
                            {sourceLabels[d.deviceSource] || d.deviceSource}
                        </span>
                        {subtype && (
                            <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-sky-50 text-sky-700">{subtype}</span>
                        )}
                    </div>
                );
            },
        },
        {
            key: 'installationDate', label: 'تاريخ التركيب', sortable: true,
            render: (d) => <span className="text-sm text-slate-500">{formatDate(d.installationDate)}</span>,
        },
        {
            key: 'warrantyMonths', label: 'الكفالة',
            render: (d) => {
                const terms: string[] = [];
                if (d.warrantyMonths != null) terms.push(`${d.warrantyMonths} شهر`);
                if (d.warrantyVisits != null) terms.push(`${d.warrantyVisits} زيارة`);
                return (
                    <div className="flex flex-col gap-0.5">
                        {d.isGoldenWarranty && (
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600">
                                <ShieldCheck className="w-3.5 h-3.5" />ذهبية
                            </span>
                        )}
                        {terms.length > 0
                            ? <span className="text-xs text-slate-600">{terms.join(' · ')}</span>
                            : (!d.isGoldenWarranty && <span className="text-xs text-slate-400">—</span>)}
                    </div>
                );
            },
        },
        {
            key: 'status', label: 'الحالة', sortable: true,
            render: (d) => {
                const s = statusConfig[d.status] ?? { label: d.status, style: 'bg-slate-50 text-slate-600 border-slate-200' };
                return <span className={`px-2.5 py-1 rounded-full text-xs font-medium border ${s.style}`}>{s.label}</span>;
            },
        },
    ];

    if (!canViewDevices) {
        return <div className="p-8 text-sm text-slate-500">لا تملك صلاحية عرض الأجهزة المركّبة.</div>;
    }

    if (initialLoad && loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="w-8 h-8 text-sky-500 animate-spin" />
            </div>
        );
    }

    return (
        <div className="p-8 space-y-6">
            {/* Unified search & filter bar (server-driven) */}
            <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm space-y-3">
                <div className="flex flex-wrap items-center gap-3">
                    <div className="relative flex-1 min-w-[220px]">
                        <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                        <input
                            type="text"
                            placeholder="بحث عن جهاز (موديل / رقم تسلسلي / زبون / رقم عقد)..."
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
                                options={[{ value: 'all', label: 'جميع الحالات' }, ...Object.entries(statusConfig).map(([value, { label }]) => ({ value, label }))]} />
                        </FilterField>
                        <FilterField label="المصدر">
                            <Select className="w-full" value={filterSource} onChange={setFilterSource} ariaLabel="المصدر"
                                options={[{ value: 'all', label: 'كل المصادر' }, { value: 'company_contract', label: 'شركة (عقد)' }, { value: 'external', label: 'خارجي' }]} />
                        </FilterField>
                        <FilterField label="الضمان الذهبي">
                            <Select className="w-full" value={filterGolden} onChange={setFilterGolden} ariaLabel="الضمان الذهبي"
                                options={[{ value: 'all', label: 'الكل' }, { value: 'yes', label: 'ذهبي فعّال' }, { value: 'no', label: 'بدون ذهبي' }]} />
                        </FilterField>
                        <FilterField label="النوع الفرعي (عقد)">
                            <Select className="w-full" value={filterSaleSubtype} onChange={setFilterSaleSubtype} ariaLabel="النوع الفرعي"
                                options={[{ value: 'all', label: 'الكل' }, { value: 'definitive', label: 'قطعي' }, { value: 'temporary', label: 'مؤقت' }, { value: 'free', label: 'هدية' }]} />
                        </FilterField>
                        {deviceModelOptions.length > 0 && (
                            <FilterField label="موديل الجهاز">
                                <Select className="w-full" value={filterDeviceModel} onChange={setFilterDeviceModel} ariaLabel="موديل الجهاز"
                                    options={[{ value: 'all', label: 'كل الموديلات' }, ...deviceModelOptions.map((m) => ({ value: String(m.id), label: m.name }))]} />
                            </FilterField>
                        )}
                        <GeoCascadeFields cascade={geo} />
                        <FilterField label="اتفاق خدمة ساري">
                            <Select className="w-full" value={filterServiceAgreement} onChange={setFilterServiceAgreement} ariaLabel="اتفاق خدمة ساري"
                                options={[{ value: 'all', label: 'الكل' }, { value: 'yes', label: 'نعم' }, { value: 'no', label: 'لا' }]} />
                        </FilterField>
                        <FilterField label="كفالة تنتهي خلال">
                            <Select className="w-full" value={filterWarrantyExpiring} onChange={setFilterWarrantyExpiring} ariaLabel="كفالة تنتهي خلال"
                                options={[{ value: 'all', label: 'غير محدد' }, { value: '30', label: '٣٠ يوماً' }, { value: '60', label: '٦٠ يوماً' }, { value: '90', label: '٩٠ يوماً' }]} />
                        </FilterField>
                        <FilterField label="فترة التركيب" wide>
                            <div className="flex items-center gap-1.5">
                                <DateField value={installFrom} onChange={setInstallFrom} placeholder="من تاريخ" className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 hover:border-slate-300 focus:border-sky-500 focus:outline-none transition-colors" />
                                <span className="text-xs text-slate-400 shrink-0">إلى</span>
                                <DateField value={installTo} onChange={setInstallTo} placeholder="إلى تاريخ" className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 hover:border-slate-300 focus:border-sky-500 focus:outline-none transition-colors" />
                            </div>
                        </FilterField>
                    </div>
                )}
            </div>

            <div className={`transition-opacity ${loading ? 'opacity-60 pointer-events-none' : ''}`}>
                <SmartTable<InstalledDevice>
                    title="الأجهزة المركّبة"
                    icon={HardDrive}
                    scopeIndicator={<BranchScopeIndicator />}
                    hideFilterBar={true}
                    data={devices}
                    columns={columns}
                    exportRows={fetchAllFiltered}
                    getId={(d) => d.id}
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
                    actions={(d) => (
                        <button
                            onClick={() => navigate(`/installed-devices/${d.id}`)}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium transition-colors"
                        >
                            <Eye className="w-3.5 h-3.5" /><span>عرض</span>
                        </button>
                    )}
                    emptyIcon={HardDrive}
                    emptyMessage="لا توجد أجهزة مركّبة"
                />
            </div>
        </div>
    );
}
