import { useCallback, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { api } from '../lib/api';
import type { Branch, Department, SystemList, DeviceModel } from '../lib/types';
import SmartTable from '../components/SmartTable';
import type { ColumnDef } from '../components/SmartTable';
import { usePermissions } from '../hooks/usePermissions';
import { useAuthStore } from '../hooks/useAuthStore';
import { useBranchContextStore } from '../hooks/useBranchContextStore';
import BranchScopeIndicator from '../components/BranchScopeIndicator';
import Select from '../components/ui/Select';
import PageHeader from '../components/ui/PageHeader';
import Modal from '../components/ui/Modal';
import {
  Building2, Plus, Edit, Trash2,
  Layers, Cpu, Users, StickyNote, CheckSquare, Square,
} from 'lucide-react';

// ─── Department form state ────────────────────────────────────────────────────
interface DeptForm {
  name: string;
  departmentTypeId: number | '';
  deviceModelIds: number[];
  notes: string;
}

const EMPTY_FORM: DeptForm = {
  name: '',
  departmentTypeId: '',
  deviceModelIds: [],
  notes: '',
};

// ─── Component ────────────────────────────────────────────────────────────────
export default function Departments() {
  const { hasPermission, hasAnyPermission } = usePermissions();
  const getPermissionScope = useAuthStore(s => s.getPermissionScope);

  const canManageDepartments = hasPermission('departments.manage');
  const canViewDeviceAvailability = hasAnyPermission('devices.department_availability.view', 'devices.department_availability.manage');
  const canManageDeviceAvailability = hasPermission('devices.department_availability.manage');
  const canEditDepartmentModal = canManageDepartments || canManageDeviceAvailability;

  // ─── Management branch filter (scope-driven — mirrors the Clients template §4/§5) ───
  //  - GLOBAL (company manager / super-admin) → external picker (All + branches)
  //  - BRANCH (branch manager)                → pinned to their branch by the server
  const viewScope = getPermissionScope('departments.view_list');
  const branchContextId = useBranchContextStore(s => s.branchId);
  const isGlobal = viewScope === 'GLOBAL';
  // Add rule (§5 / SH-3): a GLOBAL operator viewing "all branches" has no explicit
  // branch to own the new record — the add button is blocked until a branch is
  // picked (the server rejects the silent fallback too).
  const mustPickBranch = isGlobal && branchContextId == null;

  const [departments, setDepartments] = useState<Department[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [deptTypes, setDeptTypes] = useState<SystemList[]>([]);
  const [deviceModels, setDeviceModels] = useState<DeviceModel[]>([]);
  const [loading, setLoading] = useState(true);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingDept, setEditingDept] = useState<Department | null>(null);
  const [form, setForm] = useState<DeptForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  // Department-management requires departments.view_list (any scope). Pure lookup
  // holders (supervisors) use departments only inside form pickers, not this page.
  if (viewScope == null) {
    return <Navigate to="/" replace />;
  }

  // Does the currently-selected type allow device selection?
  const selectedType = deptTypes.find(t => t.id === Number(form.departmentTypeId));
  const canSelectDevice = !!(selectedType?.metadata as any)?.canSelectDevice;

  const branchName = (id: number | null | undefined) =>
    branches.find(b => b.id === id)?.name ?? (id != null ? `#${id}` : '—');

  // ── Data loading ────────────────────────────────────────────────────────────
  const fetchDepartments = useCallback(async () => {
    // Only a GLOBAL viewer narrows by the external filter; BRANCH is server-scoped.
    const branchParam = isGlobal ? branchContextId : null;
    const data = await api.departments.list(branchParam);
    setDepartments(data as Department[]);
  }, [isGlobal, branchContextId]);

  // Departments refetch whenever the management filter changes (GLOBAL) or on mount.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchDepartments()
      .catch(() => { if (!cancelled) setDepartments([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [fetchDepartments]);

  // Reference data — load once (branch names are §3 labels for the visible rows).
  useEffect(() => {
    api.branches.list().then(setBranches).catch(() => { /* keep page alive */ });
    api.systemLists.list({ category: 'department_type', activeOnly: true })
      .then(d => setDeptTypes(d as SystemList[])).catch(() => {});
    if (canViewDeviceAvailability) {
      api.deviceModels.list().then(d => setDeviceModels(d as DeviceModel[])).catch(() => {});
    }
  }, [canViewDeviceAvailability]);

  // ── Modal helpers ────────────────────────────────────────────────────────────
  const openCreate = () => {
    if (mustPickBranch) return;
    setEditingDept(null);
    setForm(EMPTY_FORM);
    setIsModalOpen(true);
  };

  const openEdit = (dept: Department) => {
    setEditingDept(dept);
    setForm({
      name: dept.name,
      departmentTypeId: dept.departmentTypeId ?? '',
      deviceModelIds: dept.deviceModelIds ?? [],
      notes: dept.notes ?? '',
    });
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingDept(null);
    setForm(EMPTY_FORM);
  };

  // The branch that a new department will belong to: the picked branch for a
  // GLOBAL operator, otherwise pinned by the server to the actor's branch.
  const targetBranchId = editingDept ? editingDept.branchId : (isGlobal ? branchContextId : null);

  // ── Form save ────────────────────────────────────────────────────────────────
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEditDepartmentModal) return;
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        departmentTypeId: form.departmentTypeId !== '' ? Number(form.departmentTypeId) : null,
        deviceModelIds: canManageDeviceAvailability
          ? (canSelectDevice ? form.deviceModelIds : [])
          : (editingDept?.deviceModelIds ?? []),
        notes: form.notes.trim() || null,
        // Send the owning branch only when known (create-as-GLOBAL). For a branch
        // user it is omitted so the server pins it (no cross-branch create).
        ...(targetBranchId != null ? { branchId: targetBranchId } : {}),
      };

      if (editingDept) {
        const updated: Department = await api.departments.update(editingDept.id, payload);
        setDepartments(ds => ds.map(d => d.id === updated.id ? updated : d));
      } else {
        const created: Department = await api.departments.create(payload);
        setDepartments(ds => [created, ...ds]);
      }
      closeModal();
    } catch (err: any) {
      alert(err.message || 'حدث خطأ أثناء الحفظ');
    } finally {
      setSaving(false);
    }
  };

  // ── Delete ────────────────────────────────────────────────────────────────────
  const handleDelete = async (dept: Department) => {
    if (!canManageDepartments) return;
    if (!confirm(`هل أنت متأكد من حذف قسم "${dept.name}"؟\nسيتم إلغاء ارتباط الموظفين بهذا القسم.`)) return;
    try {
      await api.departments.delete(dept.id);
      setDepartments(ds => ds.filter(d => d.id !== dept.id));
    } catch (err: any) {
      alert(err.message || 'حدث خطأ أثناء الحذف');
    }
  };

  // ── Device model multi-select toggle ────────────────────────────────────────
  const toggleDevice = (modelId: number) => {
    if (!canManageDeviceAvailability) return;
    setForm(f => ({
      ...f,
      deviceModelIds: f.deviceModelIds.includes(modelId)
        ? f.deviceModelIds.filter(id => id !== modelId)
        : [...f.deviceModelIds, modelId],
    }));
  };

  // ── Table columns ────────────────────────────────────────────────────────────
  const columns: ColumnDef<Department>[] = [
    {
      key: 'id', label: '#', sortable: true,
      render: d => <span className="font-mono text-slate-400 text-xs">#{d.id}</span>,
    },
    {
      key: 'name', label: 'اسم القسم', sortable: true,
      render: d => <span className="font-bold text-slate-800">{d.name}</span>,
    },
    {
      key: 'branchId', label: 'الفرع', sortable: true,
      render: d => (
        <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600 bg-slate-100 px-2.5 py-1 rounded-lg">
          <Building2 className="w-3.5 h-3.5" />
          {branchName(d.branchId)}
        </span>
      ),
    },
    {
      key: 'departmentTypeName', label: 'النوع', sortable: true,
      render: d => d.departmentTypeName
        ? <span className="px-2.5 py-1 bg-sky-50 text-sky-700 rounded-lg text-xs font-semibold">{d.departmentTypeName}</span>
        : <span className="text-slate-400 text-xs">—</span>,
    },
    ...(canViewDeviceAvailability ? [{
      key: 'deviceModelIds', label: 'الأجهزة', sortable: false,
      render: d => {
        const ids: number[] = d.deviceModelIds ?? [];
        if (ids.length === 0) return <span className="text-slate-400 text-xs">—</span>;
        const names = ids.map(id => deviceModels.find(m => m.id === id)?.name ?? `#${id}`);
        return (
          <div className="flex flex-wrap gap-1">
            {names.slice(0, 2).map((n, i) => (
              <span key={i} className="px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded text-xs font-medium">
                {n}
              </span>
            ))}
            {names.length > 2 && <span className="text-xs text-slate-400">+{names.length - 2}</span>}
          </div>
        );
      },
    } satisfies ColumnDef<Department>] : []),
    {
      key: 'employeeCount', label: 'الموظفون', sortable: true,
      render: d => (
        <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600 bg-slate-100 px-2.5 py-1 rounded-lg">
          <Users className="w-3.5 h-3.5" />
          {d.employeeCount ?? 0}
        </span>
      ),
    },
    {
      key: 'notes', label: 'ملاحظات', sortable: false,
      render: d => d.notes
        ? <span className="text-xs text-slate-500 max-w-[160px] truncate block">{d.notes}</span>
        : <span className="text-slate-300 text-xs">—</span>,
    },
  ];

  // ── Render ────────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center" dir="rtl">
        <div className="animate-spin w-8 h-8 border-4 border-sky-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="p-8 space-y-6" dir="rtl">

      {/* ── Header ── */}
      <div className="flex items-start justify-between">
        <PageHeader
          title="الأقسام"
          subtitle="إدارة أقسام الفروع وأنواعها وتخصيص الأجهزة لها"
          icon={<Layers className="w-7 h-7 text-sky-500" />}
        />

        <button
          onClick={openCreate}
          disabled={!canManageDepartments || mustPickBranch}
          title={mustPickBranch ? 'اختر فرعاً أولاً لإضافة قسم' : undefined}
          className="flex items-center gap-2 bg-sky-600 hover:bg-sky-500 text-white px-5 py-2.5 rounded-xl text-sm font-bold shadow-lg shadow-sky-500/20 transition-all active:scale-95 disabled:opacity-50"
        >
          <Plus className="w-4 h-4" />
          {mustPickBranch ? 'اختر فرعاً لإضافة قسم' : 'إضافة قسم'}
        </button>
      </div>

      {/* ── Departments table ── */}
      <SmartTable<Department>
        title="الأقسام"
        icon={Layers}
        data={departments}
        columns={columns}
        getId={d => d.id}
        scopeIndicator={<BranchScopeIndicator />}
        actions={d => (
          <div className="flex items-center gap-1">
            <button
              onClick={() => openEdit(d)}
              disabled={!canEditDepartmentModal}
              className="p-1.5 rounded-lg hover:bg-sky-50 text-slate-400 hover:text-sky-500 disabled:opacity-50"
              title="تعديل"
            >
              <Edit className="w-4 h-4" />
            </button>
            <button
              onClick={() => handleDelete(d)}
              disabled={!canManageDepartments}
              className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500 disabled:opacity-50"
              title="حذف"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        )}
      />

      {/* ── Modal ── */}
      <Modal
        isOpen={isModalOpen && canEditDepartmentModal}
        onClose={closeModal}
        size="lg"
        title={
          <span className="flex items-center gap-2">
            <Layers className="w-5 h-5 text-sky-500" />
            {editingDept ? 'تعديل القسم' : 'إضافة قسم جديد'}
          </span>
        }
      >
            <form onSubmit={handleSave}>
              <div className="p-6 space-y-5">

                {/* Name */}
                <div className="space-y-1.5">
                  <label className="text-sm font-semibold text-slate-700">
                    اسم القسم <span className="text-red-500">*</span>
                  </label>
                  <input
                    required
                    value={form.name}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    disabled={!canManageDepartments}
                    placeholder="مثال: قسم التسويق الرقمي"
                    className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:border-sky-500 focus:ring-2 focus:ring-sky-200 outline-none"
                  />
                </div>

                {/* Department type */}
                <div className="space-y-1.5">
                  <label className="text-sm font-semibold text-slate-700">نوع القسم</label>
                  <Select
                    value={form.departmentTypeId === '' ? '' : String(form.departmentTypeId)}
                    onChange={(v) => setForm(f => ({
                      ...f,
                      departmentTypeId: v !== '' ? Number(v) : '',
                      deviceModelIds: canManageDeviceAvailability ? [] : f.deviceModelIds,
                    }))}
                    disabled={!canManageDepartments}
                    placeholder="— بدون نوع —"
                    ariaLabel="نوع القسم"
                    className="w-full"
                    options={[{ value: '', label: '— بدون نوع —' }, ...deptTypes.map(t => ({ value: String(t.id), label: t.value }))]}
                  />
                  {selectedType && (selectedType.metadata as any)?.canSelectDevice && (
                    <p className="text-xs text-indigo-600 flex items-center gap-1 mt-1">
                      <Cpu className="w-3.5 h-3.5" />
                      هذا النوع يدعم تخصيص أجهزة — حدّد الأجهزة أدناه
                    </p>
                  )}
                </div>

                {/* Device multi-select — shown only when type has canSelectDevice */}
                {canSelectDevice && canViewDeviceAvailability && deviceModels.length > 0 && (
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
                      <Cpu className="w-4 h-4 text-indigo-500" />
                      الأجهزة المخصصة لهذا القسم
                    </label>
                    <div className="border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-100 max-h-48 overflow-y-auto">
                      {deviceModels.map(m => {
                        const checked = form.deviceModelIds.includes(m.id);
                        return (
                          <button
                            key={m.id}
                            type="button"
                            onClick={() => toggleDevice(m.id)}
                            disabled={!canManageDeviceAvailability}
                            className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm text-right transition-colors ${
                              checked ? 'bg-indigo-50 text-indigo-700' : 'bg-white text-slate-700 hover:bg-slate-50'
                            } disabled:opacity-50`}
                          >
                            {checked
                              ? <CheckSquare className="w-4 h-4 text-indigo-500 flex-shrink-0" />
                              : <Square className="w-4 h-4 text-slate-300 flex-shrink-0" />}
                            <span className="font-medium">{m.name}</span>
                            {m.brand && <span className="text-xs text-slate-400 mr-auto">{m.brand}</span>}
                          </button>
                        );
                      })}
                    </div>
                    {form.deviceModelIds.length > 0 && (
                      <p className="text-xs text-indigo-600">
                        {form.deviceModelIds.length} جهاز محدد
                      </p>
                    )}
                  </div>
                )}

                {/* Notes */}
                <div className="space-y-1.5">
                  <label className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
                    <StickyNote className="w-4 h-4 text-amber-500" />
                    ملاحظات عامة
                  </label>
                  <textarea
                    value={form.notes}
                    onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                    disabled={!canManageDepartments}
                    rows={3}
                    placeholder="أي ملاحظات إضافية عن هذا القسم..."
                    className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:border-sky-500 focus:ring-2 focus:ring-sky-200 outline-none resize-none"
                  />
                </div>

                {/* Branch (read-only info) */}
                <div className="bg-slate-50 border border-slate-100 rounded-xl px-4 py-3 flex items-center gap-2 text-sm text-slate-500">
                  <Building2 className="w-4 h-4 text-slate-400" />
                  <span>تبعية الفرع: <strong className="text-slate-700">{branchName(targetBranchId)}</strong></span>
                </div>

              </div>

              {/* Footer */}
              <div className="px-6 py-4 border-t border-slate-100 bg-slate-50/60 flex justify-end gap-3 flex-shrink-0">
                <button
                  type="button"
                  onClick={closeModal}
                  className="px-5 py-2 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-100 transition"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={saving || !canEditDepartmentModal}
                  className="px-5 py-2 rounded-xl text-sm font-bold bg-sky-600 hover:bg-sky-500 text-white transition disabled:opacity-60"
                >
                  {saving ? 'جاري الحفظ…' : editingDept ? 'حفظ التعديلات' : 'إضافة القسم'}
                </button>
              </div>
            </form>
      </Modal>
    </div>
  );
}
