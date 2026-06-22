import { useState, useEffect } from 'react';
import { FileText, Plus, Eye, Loader2, Building2 } from 'lucide-react';
import SmartTable from '../../components/SmartTable';
import type { ColumnDef, FilterDef } from '../../components/SmartTable';
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

/* ------------------------------------------------------------------ */
/*  Component                                                           */
/* ------------------------------------------------------------------ */

export default function ContractList() {
    const navigate = useNavigate();
    const [contracts, setContracts] = useState<Contract[]>([]);
    const [loading, setLoading] = useState(true);
    const { hasPermission } = usePermissions();
    const getPermissionScope = useAuthStore((s) => s.getPermissionScope);
    const contextBranchId = useBranchContextStore((s) => s.branchId);
    const [branchOptions, setBranchOptions] = useState<{ id: number; name: string }[]>([]);

    const canViewContracts = hasPermission('contracts.view_list');
    const canCreateContracts = hasPermission('contracts.create');

    // Branch filter follows contracts.view_list scope (NOT identity): only a
    // GLOBAL viewer may narrow by branch; BRANCH/ASSIGNED are server-scoped, so
    // we never send a cross-branch header for them. The sidebar BranchSwitcher is
    // hidden for GLOBAL-grant operators (e.g. مدير الشركة), so this in-page filter
    // is their only way to pick a branch context — mirrors Clients/Employees.
    const isGlobalView = getPermissionScope('contracts.view_list') === 'GLOBAL';

    useEffect(() => {
        if (!isGlobalView) return;
        api.branches.list()
            .then((rows) => setBranchOptions((rows as any[]).map((b) => ({ id: b.id, name: b.name }))))
            .catch(() => setBranchOptions([]));
    }, [isGlobalView]);

    useEffect(() => {
        if (!canViewContracts) {
            setLoading(false);
            return;
        }
        const branchParam = isGlobalView ? contextBranchId : null;
        setLoading(true);
        api.contracts.list({ branchId: branchParam })
            .then(data => setContracts(data))
            .catch(err => console.error('Failed to load contracts:', err))
            .finally(() => setLoading(false));
    }, [canViewContracts, isGlobalView, contextBranchId]);

    // Show the branch column only to a cross-branch viewer (GLOBAL scope with no
    // single branch selected) — i.e. when "all branches" are in view.
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
            key: 'branchName', label: 'الفرع', sortable: true,
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
            key: 'saleOwnerName', label: 'صاحب البيعة', sortable: true,
            render: (c) => <span className="text-sm text-slate-600">{c.saleOwnerName || c.createdByName || '—'}</span>,
        },
        {
            key: 'closingEmployeeName', label: 'موظف التسكير', sortable: true,
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

    const filters: FilterDef[] = [
        {
            key: 'status', label: 'جميع الحالات',
            options: [
                { value: 'draft', label: 'مسودة' },
                { value: 'active', label: 'فعال' },
                { value: 'completed', label: 'مكتمل' },
                { value: 'cancelled', label: 'ملغي' },
            ],
        },
        {
            key: 'paymentType', label: 'نوع الدفع',
            options: [
                { value: 'cash', label: 'نقدي' },
                { value: 'installment', label: 'أقساط' },
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
            <SmartTable<Contract>
                title="إدارة العقود"
                icon={FileText}
                scopeIndicator={<BranchScopeIndicator />}
                data={contracts}
                columns={columns}
                filters={filters}
                searchKeys={['contractNumber', 'customerName', 'deviceModelName', 'serialNumber']}
                searchPlaceholder="بحث عن عقد..."
                getId={(c) => c.id}
                headerActions={
                    <div className="flex items-center gap-3">
                        {/* GLOBAL branch filter moved to the unified external switcher (sidebar). */}
                        {canCreateContracts && (() => {
                            // A GLOBAL operator must pick a branch before creating —
                            // otherwise the server silently lands the contract in their
                            // home branch (resolveActingBranch → primaryBranchId). Force
                            // an explicit choice, mirroring the super-admin server rule.
                            const mustPickBranch = isGlobalView && contextBranchId == null;
                            return (
                                <button
                                    onClick={() => navigate('/contracts/new')}
                                    disabled={mustPickBranch}
                                    title={mustPickBranch ? 'اختر فرعاً أولاً لإضافة عقد' : undefined}
                                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold transition-colors shadow-sm disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed"
                                >
                                    <Plus className="w-3.5 h-3.5" />
                                    <span>{mustPickBranch ? 'اختر فرعاً لإضافة عقد' : 'عقد جديد'}</span>
                                </button>
                            );
                        })()}
                    </div>
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
    );
}
