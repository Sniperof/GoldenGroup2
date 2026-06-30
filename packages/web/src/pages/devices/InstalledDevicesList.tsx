import { useState, useEffect } from 'react';
import { HardDrive, Eye, Loader2, ShieldCheck, MapPin } from 'lucide-react';
import SmartTable from '../../components/SmartTable';
import type { ColumnDef, FilterDef } from '../../components/SmartTable';
import BranchScopeIndicator from '../../components/BranchScopeIndicator';
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
/*  Config — operational status dictionary (DEC-CT-03, 10 states)      */
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
};

const sourceLabels: Record<string, string> = {
    company_contract: 'شركة (عقد)',
    external: 'خارجي',
};

// contracts.sale_subtype — the contract nature for company devices.
const subtypeLabels: Record<string, string> = {
    definitive: 'قطعي',
    temporary: 'مؤقت',
    free: 'هدية',
};

const formatDate = (d: string | null) => {
    if (!d) return '—';
    // `date` columns arrive as full ISO timestamps over JSON ("2026-06-14T00:00:00.000Z");
    // take the date part only to avoid timezone drift and "Invalid Date".
    const dt = new Date(String(d).slice(0, 10) + 'T00:00:00');
    return isNaN(dt.getTime()) ? '—' : dt.toLocaleDateString('ar-SY', { month: 'short', day: 'numeric', year: 'numeric' });
};

/* ------------------------------------------------------------------ */
/*  Component                                                           */
/* ------------------------------------------------------------------ */

export default function InstalledDevicesList() {
    const navigate = useNavigate();
    const [devices, setDevices] = useState<InstalledDevice[]>([]);
    const [loading, setLoading] = useState(true);
    const { hasPermission } = usePermissions();
    const getPermissionScope = useAuthStore((s) => s.getPermissionScope);
    const contextBranchId = useBranchContextStore((s) => s.branchId);

    const canViewDevices = hasPermission('installed_devices.view');

    // Branch scope follows installed_devices.view (NOT identity): only a GLOBAL
    // viewer may narrow by branch via the unified external switcher; BRANCH/ASSIGNED
    // are server-scoped, so we never send a cross-branch header for them. Mirrors
    // the Contracts reference page.
    const isGlobalView = getPermissionScope('installed_devices.view') === 'GLOBAL';

    useEffect(() => {
        if (!canViewDevices) {
            setLoading(false);
            return;
        }
        const branchParam = isGlobalView ? contextBranchId : null;
        setLoading(true);
        api.installedDevices.list({ branchId: branchParam ?? undefined })
            .then((data) => setDevices(data as InstalledDevice[]))
            .catch((err) => console.error('Failed to load installed devices:', err))
            .finally(() => setLoading(false));
    }, [canViewDevices, isGlobalView, contextBranchId]);

    // Branch column only for a cross-branch viewer (GLOBAL with "all branches").
    const showBranchColumn = isGlobalView && contextBranchId == null;

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
            key: 'branchName', label: 'الفرع', sortable: true,
            render: (d: InstalledDevice) => <span className="text-sm text-slate-600">{d.branchName || '—'}</span>,
        }] : []),
        {
            key: 'installationGeoUnitName', label: 'الموقع', sortable: true,
            render: (d) => (
                <span className="text-sm text-slate-600 inline-flex items-center gap-1">
                    {d.installationGeoUnitName ? <MapPin className="w-3 h-3 text-slate-400" /> : null}
                    {d.installationGeoUnitName || '—'}
                </span>
            ),
        },
        {
            key: 'deviceSource', label: 'المصدر', sortable: true,
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
            key: 'warrantyMonths', label: 'الكفالة', sortable: true,
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

    const filters: FilterDef[] = [
        {
            key: 'status', label: 'جميع الحالات',
            options: Object.entries(statusConfig).map(([value, { label }]) => ({ value, label })),
        },
        {
            key: 'deviceSource', label: 'المصدر',
            options: [
                { value: 'company_contract', label: 'شركة (عقد)' },
                { value: 'external', label: 'خارجي' },
            ],
        },
    ];

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="w-8 h-8 text-sky-500 animate-spin" />
            </div>
        );
    }

    return (
        <div className="p-8">
            <SmartTable<InstalledDevice>
                title="الأجهزة المركّبة"
                icon={HardDrive}
                scopeIndicator={<BranchScopeIndicator />}
                data={devices}
                columns={columns}
                filters={filters}
                searchKeys={['deviceModelName', 'serialNumber', 'customerName']}
                searchPlaceholder="بحث عن جهاز (موديل / رقم تسلسلي / زبون)..."
                getId={(d) => d.id}
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
    );
}
