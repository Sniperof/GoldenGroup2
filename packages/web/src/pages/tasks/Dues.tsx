import { useState, useEffect } from 'react';
import { DollarSign, UserPlus, AlertTriangle, TrendingDown, Flag, Loader2 } from 'lucide-react';
import { useCollectionStore } from '../../hooks/useCollectionStore';
import { api } from '../../lib/api';
import SmartTable from '../../components/SmartTable';
import type { ColumnDef, FilterDef, BulkActionDef } from '../../components/SmartTable';
import CollectionModal from '../../components/CollectionModal';
import AssignAgentModal from '../../components/AssignAgentModal';
import { Due } from '../../lib/types';

const formatDate = (d: string) => new Date(d).toLocaleDateString('ar-SY', { month: 'short', day: 'numeric', year: 'numeric' });
const formatMoney = (n: number) => n.toLocaleString('ar-SY') + ' ل.س';

export default function Dues() {
    const { dues, getKPIs } = useCollectionStore();
    const kpis = getKPIs();

    const [employees, setEmployees] = useState<any[]>([]);
    const [loadingEmployees, setLoadingEmployees] = useState(true);

    const [selectedDue, setSelectedDue] = useState<(Due & { customerName: string; mobile: string }) | null>(null);
    const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);
    const [selectedDueIds, setSelectedDueIds] = useState<number[]>([]);

    useEffect(() => {
        api.employees.list()
            .then(data => setEmployees(data))
            .catch(err => console.error('Failed to fetch employees:', err))
            .finally(() => setLoadingEmployees(false));
    }, []);

    const columns: ColumnDef<typeof dues[0]>[] = [
        { key: 'customerName', label: 'الزبون', sortable: true, render: (d) => <span className="text-sm font-bold text-slate-800">{d.customerName}</span> },
        { key: 'mobile', label: 'الموبايل', render: (d) => <span className="text-sm font-mono text-slate-500 dir-ltr">{d.mobile}</span> },
        {
            key: 'type', label: 'النوع', sortable: true,
            render: (d) => <span className="text-xs font-medium px-2 py-0.5 rounded bg-gray-100 text-gray-600">{d.type === 'Installment' ? 'قسط' : d.type === 'Down Payment' ? 'دفعة أولى' : 'صيانة'}</span>
        },
        {
            key: 'remainingBalance', label: 'المتبقي', sortable: true,
            render: (d) => <span className="text-sm font-bold text-slate-900">{formatMoney(d.remainingBalance)}</span>
        },
        {
            key: 'adjustedDate', label: 'تاريخ الاستحقاق', sortable: true,
            render: (d) => <span className="text-sm text-slate-600">{formatDate(d.adjustedDate)}</span>
        },
        {
            key: 'assignedTelemarketerId', label: 'الموظف المسند', sortable: true,
            render: (d) => {
                const agent = employees.find(e => e.id === d.assignedTelemarketerId);
                return agent ? (
                    <div className="flex items-center gap-1.5">
                        <img src={agent.avatar} alt="" className="w-5 h-5 rounded-full" />
                        <span className="text-xs text-slate-700">{agent.name}</span>
                    </div>
                ) : <span className="text-xs text-slate-400 italic">-- غير مسند --</span>;
            }
        },
        {
            key: 'status', label: 'الحالة', sortable: true,
            render: (d) => {
                const styles: Record<string, string> = {
                    'Pending': 'bg-gray-100 text-slate-600',
                    'Partial': 'bg-amber-50 text-amber-700 border-amber-200',
                    'Paid': 'bg-emerald-50 text-emerald-700 border-emerald-200',
                    'Overdue': 'bg-red-50 text-red-700 border-red-200',
                };
                return (
                    <div className="flex items-center gap-2">
                        <span className={`px-2.5 py-1 rounded-full text-xs font-medium border ${styles[d.status] || styles.Pending}`}>
                            {d.status === 'Pending' ? 'انتظار' : d.status === 'Partial' ? 'دفع جزئي' : d.status === 'Paid' ? 'مدفوع' : 'متأخر'}
                        </span>
                        {d.escalated && <Flag className="w-4 h-4 text-red-500 fill-red-500" />}
                    </div>
                );
            },
        },
    ];

    const filters: FilterDef[] = [
        { key: 'status', label: 'جميع الحالات', options: [{ value: 'Pending', label: 'انتظار' }, { value: 'Overdue', label: 'متأخر' }, { value: 'Partial', label: 'دفع جزئي' }, { value: 'Paid', label: 'مدفوع' }] },
        { key: 'type', label: 'جميع الأنواع', options: [{ value: 'Installment', label: 'قسط' }, { value: 'Maintenance Fee', label: 'رسوم صيانة' }] },
    ];

    const bulkActions: BulkActionDef<typeof dues[0]>[] = [
        {
            label: 'إسناد لموظف',
            icon: UserPlus,
            onClick: (items) => {
                setSelectedDueIds(items.map(i => i.id));
                setIsAssignModalOpen(true);
            }
        }
    ];

    const getRowClass = (d: typeof dues[0]) => {
        if (d.status === 'Paid') return 'opacity-60 bg-gray-50';

        const today = new Date();
        const due = new Date(d.adjustedDate);
        const diffTime = today.getTime() - due.getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        if (diffDays > 30) return 'bg-red-50 hover:bg-red-100 border-l-4 border-l-red-500';
        if (diffDays > 0) return 'bg-amber-50 hover:bg-amber-100 border-l-4 border-l-amber-500';

        return '';
    };

    if (loadingEmployees) {
        return (
            <div className="h-full flex items-center justify-center">
                <Loader2 className="w-8 h-8 text-sky-600 animate-spin" />
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full space-y-6">
            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 px-8 pt-6">
                <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center justify-between">
                    <div>
                        <p className="text-slate-500 text-sm font-medium mb-1">إجمالي الديون المتبقية</p>
                        <h3 className="text-2xl font-bold text-slate-900">{formatMoney(kpis.totalRemaining)}</h3>
                    </div>
                    <div className="w-12 h-12 bg-emerald-50 rounded-xl flex items-center justify-center text-emerald-600">
                        <DollarSign className="w-6 h-6" />
                    </div>
                </div>

                <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center justify-between">
                    <div>
                        <p className="text-slate-500 text-sm font-medium mb-1">نسبة المتأخرات (&gt;30 يوم)</p>
                        <h3 className="text-2xl font-bold text-slate-900">{kpis.overdueRate.toFixed(1)}%</h3>
                    </div>
                    <div className="w-12 h-12 bg-red-50 rounded-xl flex items-center justify-center text-red-600">
                        <TrendingDown className="w-6 h-6" />
                    </div>
                </div>

                <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center justify-between">
                    <div>
                        <p className="text-slate-500 text-sm font-medium mb-1">ديون غير مسندة</p>
                        <h3 className="text-2xl font-bold text-slate-900">{kpis.unassignedDues}</h3>
                    </div>
                    <div className="w-12 h-12 bg-amber-50 rounded-xl flex items-center justify-center text-amber-600">
                        <AlertTriangle className="w-6 h-6" />
                    </div>
                </div>
            </div>

            {/* Smart Table */}
            <div className="flex-1 min-h-0 flex flex-col">
                <SmartTable
                    title="لوحة التحصيل"
                    icon={DollarSign}
                    data={dues}
                    columns={columns}
                    filters={filters}
                    searchKeys={['customerName', 'mobile']}
                    searchPlaceholder="بحث في المستحقات..."
                    getId={(d) => d.id}
                    onRowClick={(d) => setSelectedDue(d)}
                    bulkActions={bulkActions}
                    rowClassName={getRowClass}
                    emptyIcon={DollarSign}
                    emptyMessage="لا توجد مستحقات تطابق البحث"
                />
            </div>

            {/* Modals */}
            <CollectionModal
                isOpen={!!selectedDue}
                onClose={() => setSelectedDue(null)}
                due={selectedDue}
            />

            <AssignAgentModal
                isOpen={isAssignModalOpen}
                onClose={() => setIsAssignModalOpen(false)}
                selectedDueIds={selectedDueIds}
            />
        </div>
    );
}
