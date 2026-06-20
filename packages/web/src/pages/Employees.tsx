import { useEffect, useMemo, useState } from 'react';
import { Building2, Plus, Users } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import SmartTable from '../components/SmartTable';
import type { ColumnDef, FilterDef } from '../components/SmartTable';
import EmployeeFormModal from '../components/employees/EmployeeFormModal';
import BranchScopeIndicator from '../components/BranchScopeIndicator';
import { usePermissions } from '../hooks/usePermissions';
import { useAuthStore } from '../hooks/useAuthStore';
import { useBranchContextStore } from '../hooks/useBranchContextStore';
import { useBranchStore } from '../hooks/useBranchStore';
import { api } from '../lib/api';
import type { Employee } from '../lib/types';

const ROLE_LABELS: Record<string, string> = {
  supervisor: 'مشرف',
  technician: 'فني',
  telemarketer: 'تيلماركتر',
  trainee: 'متدرب',
};

const STATUS_META: Record<Employee['status'], { label: string; className: string }> = {
  active: { label: 'نشط', className: 'bg-emerald-50 text-emerald-700 border border-emerald-100' },
  vacation: { label: 'إجازة', className: 'bg-amber-50 text-amber-700 border border-amber-100' },
  suspended: { label: 'موقوف', className: 'bg-orange-50 text-orange-700 border border-orange-100' },
  terminated: { label: 'منتهي الخدمة', className: 'bg-gray-50 text-gray-600 border border-gray-100' },
};

function getEmployeeResidenceTableLabel(employee: Employee) {
  return employee.residenceShort || employee.residence || '—';
}

export default function Employees() {
  const navigate = useNavigate();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [createError, setCreateError] = useState('');
  const { hasPermission } = usePermissions();
  const { user } = useAuthStore();
  const getPermissionScope = useAuthStore((s) => s.getPermissionScope);
  const contextBranchId = useBranchContextStore((s) => s.branchId);
  const { branches, fetchBranches } = useBranchStore();

  const canViewEmployees = hasPermission('employees.view_list');
  const canCreateEmployees = hasPermission('employees.create');

  // Management branch filter — visibility & mode follow employees.view_list scope
  // (NOT identity): GLOBAL → active picker; BRANCH → locked badge; else → none.
  const viewScope = getPermissionScope('employees.view_list');
  const isGlobalView = viewScope === 'GLOBAL';
  const isBranchView = viewScope === 'BRANCH';
  // Add rule (§5): a GLOBAL operator on "all branches" must pick a branch first —
  // no silent fallback into the base branch (SH-3). Branch/assigned users are pinned.
  const mustPickBranch = isGlobalView && contextBranchId == null;

  useEffect(() => {
    fetchBranches();
  }, [fetchBranches]);

  useEffect(() => {
    if (!canViewEmployees) {
      setLoading(false);
      return;
    }

    // Only a GLOBAL viewer may narrow by branch; BRANCH/ASSIGNED are scoped by
    // the server, so we never send a cross-branch header for them.
    const branchParam = isGlobalView ? contextBranchId : null;
    setLoading(true);
    api.employees.list(branchParam)
      .then((data) => setEmployees(data))
      .catch((err) => console.error('Failed to fetch employees:', err))
      .finally(() => setLoading(false));
  }, [canViewEmployees, isGlobalView, contextBranchId]);

  // Create modal pins to the management filter (GLOBAL) or the user's own branch.
  const fixedBranchId = isGlobalView
    ? (contextBranchId ?? null)
    : (user?.branchId ?? null);

  const fixedBranchName = branches.find((branch) => branch.id === fixedBranchId)?.name
    ?? (fixedBranchId != null ? `#${fixedBranchId}` : null);

  const columns: ColumnDef<Employee>[] = useMemo(() => [
    {
      key: 'name',
      label: 'الاسم الكامل',
      sortable: true,
      render: (employee) => (
        <div className="flex items-center gap-3">
          {employee.avatar ? (
            <img src={employee.avatar} alt={employee.name} className="h-9 w-9 rounded-full border border-gray-100 object-cover" />
          ) : (
            <div className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-sky-50 text-xs font-bold text-sky-600">
              {employee.name.slice(0, 1)}
            </div>
          )}
          <div className="min-w-0">
            <div className="text-sm font-semibold text-slate-700">{employee.name}</div>
            <div className="text-xs text-slate-400">
              {employee.employeeNumber ? `#${employee.employeeNumber}` : 'بدون رقم'}
            </div>
          </div>
        </div>
      ),
    },
    {
      key: 'jobTitle',
      label: 'المسمى الوظيفي',
      sortable: true,
      render: (employee) => (
        <span className="text-sm font-semibold text-slate-700">
          {employee.jobTitle || (employee.role ? ROLE_LABELS[employee.role] : '—')}
        </span>
      ),
    },
    {
      key: 'branch',
      label: 'الفرع',
      sortable: true,
      render: (employee) => <span className="text-sm text-slate-600">{employee.branch || '—'}</span>,
    },
    {
      key: 'departmentName',
      label: 'القسم',
      sortable: true,
      render: (employee) => <span className="text-sm text-slate-600">{employee.departmentName || '—'}</span>,
    },
    {
      key: 'residence',
      label: 'مكان الإقامة',
      sortable: true,
      render: (employee) => <span className="text-sm text-slate-600">{getEmployeeResidenceTableLabel(employee)}</span>,
    },
    {
      key: 'mobile',
      label: 'رقم الهاتف الأساسي',
      sortable: true,
      render: (employee) => <span className="font-mono text-sm tracking-wide text-slate-600">{employee.mobile}</span>,
    },
    {
      key: 'status',
      label: 'الحالة',
      sortable: true,
      render: (employee) => {
        const meta = STATUS_META[employee.status];
        return <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${meta.className}`}>{meta.label}</span>;
      },
    },
  ], []);

  const filters: FilterDef[] = [
    {
      key: 'branch',
      label: 'جميع الفروع',
      options: Array.from(new Set(employees.map((employee) => employee.branch).filter(Boolean) as string[]))
        .map((branch) => ({ value: branch, label: branch })),
    },
    {
      key: 'status',
      label: 'جميع الحالات',
      options: [
        { value: 'active', label: 'نشط' },
        { value: 'vacation', label: 'إجازة' },
        { value: 'suspended', label: 'موقوف' },
        { value: 'terminated', label: 'منتهي الخدمة' },
      ],
    },
  ];

  async function handleCreateEmployee(payload: Record<string, unknown>) {
    setSaving(true);
    setCreateError('');
    try {
      const created = await api.employees.create(payload) as Employee;
      setEmployees((current) => [created, ...current]);
      setShowCreateModal(false);
      navigate(`/employees/${created.id}`);
    } catch (err: any) {
      setCreateError(err.message ?? 'تعذر إضافة الموظف.');
    } finally {
      setSaving(false);
    }
  }

  if (!loading && !canViewEmployees) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-500">
            <Users className="h-6 w-6" />
          </div>
          <h2 className="mb-2 text-lg font-bold text-slate-800">لا تملك صلاحية عرض سجلات الموظفين</h2>
          <p className="text-sm leading-relaxed text-slate-500">
            تم تقييد الوصول إلى هذه الشاشة بحسب الدور والصلاحيات المعتمدة.
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-indigo-600" />
      </div>
    );
  }

  return (
    <>
      <SmartTable<Employee>
        title="سجلات الموظفين"
        icon={Users}
        scopeIndicator={<BranchScopeIndicator />}
        data={employees}
        columns={columns}
        filters={filters}
        searchKeys={['name', 'mobile', 'jobTitle', 'branch', 'departmentName', 'residence', 'residenceShort', 'employeeNumber']}
        searchPlaceholder="بحث بالاسم أو الرقم..."
        onRowClick={(employee) => navigate(`/employees/${employee.id}`)}
        headerActions={(
          <div className="flex items-center gap-3">
            {/* GLOBAL branch filter moved to the unified external switcher (sidebar). */}
            {isBranchView && (
              <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-100 px-3 py-2 text-sm font-bold text-slate-600">
                <Building2 className="h-4 w-4 shrink-0" />
                <span className="truncate">
                  {branches.find((b) => b.id === user?.branchId)?.name ?? `الفرع #${user?.branchId ?? ''}`}
                </span>
              </div>
            )}
            {canCreateEmployees && (
              <button
                disabled={mustPickBranch}
                title={mustPickBranch ? 'اختر فرعاً أولاً لإضافة موظف' : undefined}
                onClick={() => {
                  setCreateError('');
                  setShowCreateModal(true);
                }}
                className="inline-flex items-center gap-2 whitespace-nowrap rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-sky-600 disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed"
              >
                <Plus className="h-4 w-4" />
                {mustPickBranch ? 'اختر فرعاً لإضافة موظف' : 'إضافة موظف'}
              </button>
            )}
          </div>
        )}
        getId={(employee) => employee.id}
        emptyIcon={Users}
        emptyMessage="لا يوجد موظفون"
      />

      <EmployeeFormModal
        isOpen={showCreateModal}
        title="إضافة موظف جديد"
        description="هذا النموذج يوحّد إدخال بيانات الموظف المباشر بنفس البنية المستخدمة في التحويل من طلبات التوظيف، حتى لا يضيع أي جزء من بيانات الموارد البشرية."
        submitLabel="حفظ الموظف"
        submitting={saving}
        error={createError}
        fixedBranchId={fixedBranchId}
        fixedBranchName={fixedBranchName}
        branchLocked={!isGlobalView || contextBranchId != null}
        onClose={() => {
          if (saving) return;
          setShowCreateModal(false);
          setCreateError('');
        }}
        onSubmit={handleCreateEmployee}
      />
    </>
  );
}
