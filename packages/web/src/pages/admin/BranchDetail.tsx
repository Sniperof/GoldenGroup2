import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import type { Branch, Department, SystemList, DeviceModel } from '../../lib/types';
import SmartTable from '../../components/SmartTable';
import type { ColumnDef } from '../../components/SmartTable';
import {
  Building2, ArrowRight, Plus, Edit, Trash2, X,
  Layers, Cpu, Users, StickyNote, ChevronDown, CheckSquare, Square,
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
export default function BranchDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const branchId = Number(id);

  const [branch, setBranch] = useState<Branch | null>(null);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [deptTypes, setDeptTypes] = useState<SystemList[]>([]);
  const [deviceModels, setDeviceModels] = useState<DeviceModel[]>([]);
  const [loading, setLoading] = useState(true);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingDept, setEditingDept] = useState<Department | null>(null);
  const [form, setForm] = useState<DeptForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  // Does the currently-selected type allow device selection?
  const selectedType = deptTypes.find(t => t.id === Number(form.departmentTypeId));
  const canSelectDevice = !!(selectedType?.metadata as any)?.canSelectDevice;

  // ── Data loading ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!branchId) { setLoading(false); return; }

    let cancelled = false;

    async function load() {
      // 1. Load the branch itself — if this fails the page shows an error.
      try {
        const b: Branch = await api.branches.get(branchId);
        if (!cancelled) setBranch(b);
      } catch {
        if (!cancelled) setLoading(false);
        return;
      }

      // 2. Load supplementary data independently — failures here degrade gracefully.
      const [depts, types, models] = await Promise.allSettled([
        api.departments.list(branchId),
        api.systemLists.list({ category: 'department_type', activeOnly: true }),
        api.deviceModels.list(),
      ]);

      if (cancelled) return;

      if (depts.status === 'fulfilled') setDepartments(depts.value as Department[]);
      if (types.status === 'fulfilled') setDeptTypes(types.value as SystemList[]);
      if (models.status === 'fulfilled') setDeviceModels(models.value as DeviceModel[]);

      setLoading(false);
    }

    load();
    return () => { cancelled = true; };
  }, [branchId]);

  // ── Modal helpers ────────────────────────────────────────────────────────────
  const openCreate = () => {
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

  // ── Form save ────────────────────────────────────────────────────────────────
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        departmentTypeId: form.departmentTypeId !== '' ? Number(form.departmentTypeId) : null,
        deviceModelIds: canSelectDevice ? form.deviceModelIds : [],
        notes: form.notes.trim() || null,
        branchId,
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
      key: 'departmentTypeName', label: 'النوع', sortable: true,
      render: d => d.departmentTypeName
        ? <span className="px-2.5 py-1 bg-sky-50 text-sky-700 rounded-lg text-xs font-semibold">{d.departmentTypeName}</span>
        : <span className="text-slate-400 text-xs">—</span>,
    },
    {
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
    },
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

  if (!branch) {
    return (
      <div className="p-8 text-center" dir="rtl">
        <p className="text-slate-500">الفرع غير موجود أو لا تملك صلاحية الوصول إليه.</p>
        <button onClick={() => navigate('/branches')} className="mt-4 text-sky-600 hover:underline text-sm">
          ← العودة إلى الفروع
        </button>
      </div>
    );
  }

  return (
    <div className="p-8 space-y-6" dir="rtl">

      {/* ── Header ── */}
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3">
          <button
            onClick={() => navigate('/branches')}
            className="mt-1 p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition"
            title="العودة"
          >
            <ArrowRight className="w-5 h-5" />
          </button>
          <div>
            <div className="flex items-center gap-2 text-sm text-slate-400 mb-1">
              <Building2 className="w-4 h-4" />
              <span>إدارة الفروع</span>
              <ChevronDown className="w-3 h-3 -rotate-90" />
              <span className="font-medium text-slate-600">{branch.name}</span>
            </div>
            <h1 className="text-2xl font-black text-slate-800 flex items-center gap-2">
              <Layers className="w-7 h-7 text-sky-500" />
              أقسام الفرع
            </h1>
            <p className="text-sm text-slate-500 mt-0.5">
              إدارة الأقسام التابعة لـ <strong>{branch.name}</strong>
            </p>
          </div>
        </div>

        <button
          onClick={openCreate}
          className="flex items-center gap-2 bg-sky-600 hover:bg-sky-500 text-white px-5 py-2.5 rounded-xl text-sm font-bold shadow-lg shadow-sky-500/20 transition-all active:scale-95"
        >
          <Plus className="w-4 h-4" />
          إضافة قسم
        </button>
      </div>

      {/* ── Departments table ── */}
      <SmartTable<Department>
        title={`أقسام ${branch.name}`}
        icon={Layers}
        data={departments}
        columns={columns}
        getId={d => d.id}
        actions={d => (
          <div className="flex items-center gap-1">
            <button
              onClick={() => openEdit(d)}
              className="p-1.5 rounded-md hover:bg-sky-50 text-slate-400 hover:text-sky-500"
              title="تعديل"
            >
              <Edit className="w-4 h-4" />
            </button>
            <button
              onClick={() => handleDelete(d)}
              className="p-1.5 rounded-md hover:bg-red-50 text-slate-400 hover:text-red-500"
              title="حذف"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        )}
      />

      {/* ── Modal ── */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">

            {/* Modal header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/60 flex-shrink-0">
              <h3 className="font-bold text-lg text-slate-800 flex items-center gap-2">
                <Layers className="w-5 h-5 text-sky-500" />
                {editingDept ? 'تعديل القسم' : 'إضافة قسم جديد'}
              </h3>
              <button onClick={closeModal} className="text-slate-400 hover:text-slate-600 p-1">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSave} className="overflow-y-auto flex-1">
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
                    placeholder="مثال: قسم التسويق الرقمي"
                    className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:border-sky-500 focus:ring-2 focus:ring-sky-200 outline-none"
                  />
                </div>

                {/* Department type */}
                <div className="space-y-1.5">
                  <label className="text-sm font-semibold text-slate-700">نوع القسم</label>
                  <select
                    value={form.departmentTypeId}
                    onChange={e => setForm(f => ({ ...f, departmentTypeId: e.target.value !== '' ? Number(e.target.value) : '', deviceModelIds: [] }))}
                    className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:border-sky-500 focus:ring-2 focus:ring-sky-200 outline-none"
                  >
                    <option value="">— بدون نوع —</option>
                    {deptTypes.map(t => (
                      <option key={t.id} value={t.id}>{t.value}</option>
                    ))}
                  </select>
                  {selectedType && (selectedType.metadata as any)?.canSelectDevice && (
                    <p className="text-xs text-indigo-600 flex items-center gap-1 mt-1">
                      <Cpu className="w-3.5 h-3.5" />
                      هذا النوع يدعم تخصيص أجهزة — حدّد الأجهزة أدناه
                    </p>
                  )}
                </div>

                {/* Device multi-select — shown only when type has canSelectDevice */}
                {canSelectDevice && deviceModels.length > 0 && (
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
                            className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm text-right transition-colors ${
                              checked ? 'bg-indigo-50 text-indigo-700' : 'bg-white text-slate-700 hover:bg-slate-50'
                            }`}
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
                    rows={3}
                    placeholder="أي ملاحظات إضافية عن هذا القسم..."
                    className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:border-sky-500 focus:ring-2 focus:ring-sky-200 outline-none resize-none"
                  />
                </div>

                {/* Branch (read-only info) */}
                <div className="bg-slate-50 border border-slate-100 rounded-xl px-4 py-3 flex items-center gap-2 text-sm text-slate-500">
                  <Building2 className="w-4 h-4 text-slate-400" />
                  <span>تبعية الفرع: <strong className="text-slate-700">{branch.name}</strong></span>
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
                  disabled={saving}
                  className="px-5 py-2 rounded-xl text-sm font-bold bg-sky-600 hover:bg-sky-500 text-white transition disabled:opacity-60"
                >
                  {saving ? 'جاري الحفظ…' : editingDept ? 'حفظ التعديلات' : 'إضافة القسم'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
