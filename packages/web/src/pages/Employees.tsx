import { useEffect, useMemo, useState } from 'react';
import { Loader2, Plus, Save, Users, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import SmartTable from '../components/SmartTable';
import type { ColumnDef, FilterDef } from '../components/SmartTable';
import { usePermissions } from '../hooks/usePermissions';
import { api } from '../lib/api';
import type { Employee } from '../lib/types';

const ROLE_LABELS: Record<Employee['role'], string> = {
  supervisor: 'مشرفة',
  technician: 'فني',
  telemarketer: 'تيلماركتر',
};

const STATUS_META: Record<Employee['status'], { label: string; className: string }> = {
  active: { label: 'نشط', className: 'bg-emerald-50 text-emerald-700 border border-emerald-100' },
  leave: { label: 'إجازة', className: 'bg-amber-50 text-amber-700 border border-amber-100' },
  inactive: { label: 'غير فعال', className: 'bg-gray-50 text-gray-600 border border-gray-100' },
};

type EmployeeForm = {
  name: string;
  mobile: string;
  branch: string;
  residence: string;
  status: Employee['status'];
  jobTitle: string;
};

const EMPTY_FORM: EmployeeForm = {
  name: '',
  mobile: '',
  branch: '',
  residence: '',
  status: 'active',
  jobTitle: '',
};

function getEmployeeResidenceTableLabel(employee: Employee) {
  return employee.residenceShort || employee.residence || '—';
}

function CreateEmployeeModal({
  saving,
  error,
  form,
  onClose,
  onSubmit,
  onChange,
}: {
  saving: boolean;
  error: string;
  form: EmployeeForm;
  onClose: () => void;
  onSubmit: () => void;
  onChange: (patch: Partial<EmployeeForm>) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-slate-900/55 backdrop-blur-sm flex items-center justify-center p-4" dir="rtl">
      <div className="w-full max-w-xl bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden">
        <div className="px-6 py-5 border-b border-slate-100 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900">إضافة موظف مباشرة</h2>
            <p className="text-sm text-slate-500 mt-1">
              هذا المسار مخصص للموظفين الحاليين الذين نريد إدخالهم للنظام بدون المرور بطلب توظيف.
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-10 h-10 rounded-xl border border-slate-200 text-slate-400 hover:text-slate-700 hover:border-slate-300 transition-colors inline-flex items-center justify-center"
            title="إغلاق"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {error && (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="block text-xs font-semibold text-slate-500 mb-2">الاسم الكامل</span>
              <input
                value={form.name}
                onChange={(e) => onChange({ name: e.target.value })}
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-400"
                placeholder="اسم الموظف"
              />
            </label>

            <label className="block">
              <span className="block text-xs font-semibold text-slate-500 mb-2">رقم الهاتف الأساسي</span>
              <input
                value={form.mobile}
                onChange={(e) => onChange({ mobile: e.target.value })}
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-400"
                placeholder="09xxxxxxxx"
              />
            </label>

            <label className="block">
              <span className="block text-xs font-semibold text-slate-500 mb-2">الفرع</span>
              <input
                value={form.branch}
                onChange={(e) => onChange({ branch: e.target.value })}
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-400"
                placeholder="مثال: فرع دمشق"
              />
            </label>

            <label className="block">
              <span className="block text-xs font-semibold text-slate-500 mb-2">مكان الإقامة</span>
              <input
                value={form.residence}
                onChange={(e) => onChange({ residence: e.target.value })}
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-400"
                placeholder="مثال: ركن الدين - البرامكة"
              />
            </label>

            <label className="block">
              <span className="block text-xs font-semibold text-slate-500 mb-2">الحالة</span>
              <select
                value={form.status}
                onChange={(e) => onChange({ status: e.target.value as Employee['status'] })}
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-400"
              >
                <option value="active">نشط</option>
                <option value="leave">إجازة</option>
                <option value="inactive">غير فعال</option>
              </select>
            </label>

            <label className="block md:col-span-2">
              <span className="block text-xs font-semibold text-slate-500 mb-2">المسمى الوظيفي</span>
              <input
                value={form.jobTitle}
                onChange={(e) => onChange({ jobTitle: e.target.value })}
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-400"
                placeholder="مثال: مشرفة أو فني صيانة أو تيلماركتر"
              />
            </label>
          </div>

          <div className="rounded-2xl border border-dashed border-sky-200 bg-sky-50 px-4 py-4 text-sm text-sky-800">
            يتم اشتقاق الدور التشغيلي تلقائيًا من المسمى الوظيفي، لذلك استخدم مسمى واضحًا من عائلة:
            مشرفة، فني، تيلماركتر.
          </div>
        </div>

        <div className="px-6 py-5 border-t border-slate-100 flex items-center justify-between gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"
          >
            إلغاء
          </button>
          <button
            onClick={onSubmit}
            disabled={saving}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-sky-500 hover:bg-sky-600 text-white rounded-xl text-sm font-semibold transition-colors disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            حفظ الموظف
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Employees() {
  const navigate = useNavigate();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [form, setForm] = useState<EmployeeForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [createError, setCreateError] = useState('');
  const { hasPermission } = usePermissions();

  const canViewEmployees = hasPermission('employees.view_list');
  const canCreateEmployees = hasPermission('employees.create');

  useEffect(() => {
    if (!canViewEmployees) {
      setLoading(false);
      return;
    }

    api.employees.list()
      .then((data) => setEmployees(data))
      .catch((err) => console.error('Failed to fetch employees:', err))
      .finally(() => setLoading(false));
  }, [canViewEmployees]);

  const columns: ColumnDef<Employee>[] = useMemo(() => [
    {
      key: 'name',
      label: 'الاسم الكامل',
      sortable: true,
      render: (employee) => (
        <div className="flex items-center gap-3">
          {employee.avatar ? (
            <img src={employee.avatar} alt={employee.name} className="w-9 h-9 rounded-full border border-gray-100 object-cover" />
          ) : (
            <div className="w-9 h-9 rounded-full border border-slate-200 bg-sky-50 text-sky-600 flex items-center justify-center text-xs font-bold">
              {employee.name.slice(0, 1)}
            </div>
          )}
          <div className="min-w-0">
            <div className="text-slate-700 font-semibold text-sm">{employee.name}</div>
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
          {employee.jobTitle || ROLE_LABELS[employee.role]}
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
      key: 'residence',
      label: 'مكان الإقامة',
      sortable: true,
      render: (employee) => <span className="text-sm text-slate-600">{getEmployeeResidenceTableLabel(employee)}</span>,
    },
    {
      key: 'mobile',
      label: 'رقم الهاتف الأساسي',
      sortable: true,
      render: (employee) => <span className="text-sm text-slate-600 font-mono tracking-wide">{employee.mobile}</span>,
    },
    {
      key: 'status',
      label: 'الحالة',
      sortable: true,
      render: (employee) => {
        const meta = STATUS_META[employee.status];
        return <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${meta.className}`}>{meta.label}</span>;
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
        { value: 'leave', label: 'إجازة' },
        { value: 'inactive', label: 'غير فعال' },
      ],
    },
  ];

  function resetCreateForm() {
    setForm(EMPTY_FORM);
    setCreateError('');
  }

  async function handleCreateEmployee() {
    if (!form.name.trim()) {
      setCreateError('الاسم الكامل مطلوب.');
      return;
    }
    if (!form.mobile.trim()) {
      setCreateError('رقم الهاتف مطلوب.');
      return;
    }
    if (!form.branch.trim()) {
      setCreateError('الفرع مطلوب.');
      return;
    }
    if (!form.residence.trim()) {
      setCreateError('مكان الإقامة مطلوب.');
      return;
    }
    if (!form.jobTitle.trim()) {
      setCreateError('المسمى الوظيفي مطلوب.');
      return;
    }

    setSaving(true);
    setCreateError('');
    try {
      const created = await api.employees.create({
        name: form.name.trim(),
        mobile: form.mobile.trim(),
        branch: form.branch.trim(),
        residence: form.residence.trim(),
        status: form.status,
        jobTitle: form.jobTitle.trim(),
      }) as Employee;

      setEmployees((current) => [created, ...current]);
      setShowCreateModal(false);
      resetCreateForm();
      navigate(`/employees/${created.id}`);
    } catch (err: any) {
      setCreateError(err.message ?? 'تعذر إضافة الموظف.');
    } finally {
      setSaving(false);
    }
  }

  if (!loading && !canViewEmployees) {
    return (
      <div className="h-full flex items-center justify-center p-6">
        <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center max-w-md w-full">
          <div className="w-14 h-14 rounded-2xl bg-slate-100 text-slate-500 flex items-center justify-center mx-auto mb-4">
            <Users className="w-6 h-6" />
          </div>
          <h2 className="text-lg font-bold text-slate-800 mb-2">لا تملك صلاحية عرض سجلات الموظفين</h2>
          <p className="text-sm text-slate-500 leading-relaxed">
            تم تقييد الوصول إلى هذه الشاشة بحسب الدور والصلاحيات المعتمدة.
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  return (
    <>
      <SmartTable<Employee>
        title="سجلات الموظفين"
        icon={Users}
        data={employees}
        columns={columns}
        filters={filters}
        searchKeys={['name', 'mobile', 'jobTitle', 'branch', 'residence', 'residenceShort']}
        searchPlaceholder="بحث بالاسم أو الرقم..."
        onRowClick={(employee) => navigate(`/employees/${employee.id}`)}
        headerActions={canCreateEmployees ? (
          <button
            onClick={() => {
              resetCreateForm();
              setShowCreateModal(true);
            }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-sky-500 hover:bg-sky-600 text-white text-sm font-semibold transition-colors whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            إضافة موظف
          </button>
        ) : null}
        getId={(employee) => employee.id}
        emptyIcon={Users}
        emptyMessage="لا يوجد موظفون"
      />

      {showCreateModal && (
        <CreateEmployeeModal
          saving={saving}
          error={createError}
          form={form}
          onClose={() => {
            if (saving) return;
            setShowCreateModal(false);
            resetCreateForm();
          }}
          onSubmit={handleCreateEmployee}
          onChange={(patch) => setForm((current) => ({ ...current, ...patch }))}
        />
      )}
    </>
  );
}
