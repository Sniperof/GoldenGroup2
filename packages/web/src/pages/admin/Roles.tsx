import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useRoleStore } from '../../hooks/useRoleStore';
import type { Role, HrUser } from '../../hooks/useRoleStore';
import type { BranchCatalogItem, UserBranchAssignment } from '@golden-crm/shared';
import { trpc } from '../../lib/trpc';
import type { RoleUser as TrpcRoleUser } from '../../lib/trpc-contract';
import { usePermissions } from '../../hooks/usePermissions';
import {
  ShieldCheck, Plus, Edit2, Trash2, Users, Key,
  ToggleLeft, ToggleRight, X, Save, Loader2, AlertTriangle,
  UserPlus, User, Eye, EyeOff, ChevronDown, Building2, Star,
  ExternalLink, ListChecks,
} from 'lucide-react';
import Select from '../../components/ui/Select';
import IconButton from '../../components/ui/IconButton';

// ══════════════════════════════════════════════════════════════════
// Role Modal
// ══════════════════════════════════════════════════════════════════
function RoleModal({ role, onClose }: { role?: Role | null; onClose: () => void }) {
  const { createRole, updateRole } = useRoleStore();
  const [displayName, setDisplayName] = useState(role?.displayName ?? '');
  const [name, setName] = useState(role?.name ?? '');
  const [description, setDescription] = useState(role?.description ?? '');
  const [teamSlotType, setTeamSlotType] = useState<'SUPERVISOR' | 'TECHNICIAN' | 'TRAINEE' | 'TELEMARKETER' | null>(role?.teamSlotType ?? null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const isEdit = !!role;

  async function handleSave() {
    if (!displayName.trim() || (!isEdit && !name.trim())) {
      setError('يرجى تعبئة جميع الحقول المطلوبة');
      return;
    }
    setSaving(true); setError('');
    try {
      if (isEdit) await updateRole(role!.id, { displayName, description, teamSlotType });
      else await createRole({ name, displayName, description, teamSlotType });
      onClose();
    } catch (e: any) { setError(e.message ?? 'حدث خطأ'); }
    finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between p-5 border-b border-slate-100">
          <h2 className="text-lg font-bold text-slate-800">{isEdit ? 'تعديل الدور' : 'إنشاء دور جديد'}</h2>
          <IconButton icon={X} label="إغلاق" size="sm" onClick={onClose} />
        </div>
        <div className="p-5 space-y-4">
          {error && <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 rounded-lg p-3"><AlertTriangle className="w-4 h-4 shrink-0" />{error}</div>}
          {!isEdit && (
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">المعرف الداخلي <span className="text-red-500">*</span></label>
              <input value={name} onChange={e => setName(e.target.value.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, ''))}
                placeholder="مثال: branch_manager"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400" />
              <p className="text-xs text-slate-400 mt-1">حروف إنجليزية صغيرة وأرقام وشرطة سفلية فقط</p>
            </div>
          )}
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">الاسم المعروض <span className="text-red-500">*</span></label>
            <input value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="مثال: مدير الفرع"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">الوصف</label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3}
              placeholder="وصف مختصر لصلاحيات هذا الدور..."
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400 resize-none" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">خانة الفريق</label>
            <div className="relative">
              <Select<'' | 'SUPERVISOR' | 'TECHNICIAN' | 'TRAINEE' | 'TELEMARKETER'>
                value={teamSlotType ?? ''}
                onChange={(v) => setTeamSlotType(v ? v as 'SUPERVISOR' | 'TECHNICIAN' | 'TRAINEE' | 'TELEMARKETER' : null)}
                ariaLabel="خانة الفريق"
                className="w-full"
                options={[
                  { value: '', label: '— لا يوجد —' },
                  { value: 'SUPERVISOR', label: 'مشرف' },
                  { value: 'TECHNICIAN', label: 'فني' },
                  { value: 'TRAINEE', label: 'متدرب' },
                  { value: 'TELEMARKETER', label: 'مسوق هاتفي' },
                ]}
              />
            </div>
            <p className="mt-1.5 text-xs text-slate-500 leading-5">
              تحدد هذه الخانة موقع الدور داخل الفريق. ولظهور الموظف في جدولة الفرق يجب أن يملك هذا الدور أيضاً صلاحية
              <span className="font-semibold text-slate-700"> الظهور في جدولة الفرق</span>.
            </p>
          </div>
        </div>
        <div className="flex gap-3 p-5 border-t border-slate-100">
          <button onClick={handleSave} disabled={saving}
            className="flex-1 flex items-center justify-center gap-2 bg-sky-500 hover:bg-sky-600 text-white text-sm font-semibold py-2.5 rounded-xl transition-colors disabled:opacity-50">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {isEdit ? 'حفظ التعديلات' : 'إنشاء الدور'}
          </button>
          <button onClick={onClose} className="px-4 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-600 hover:bg-slate-50">إلغاء</button>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// HR User Modal
// ══════════════════════════════════════════════════════════════════
type EditableRoleTask = {
  title: string;
  description: string;
  isActive: boolean;
};

function RoleJobTasksModal({ role, onClose }: { role: Role; onClose: () => void }) {
  const { fetchRoles } = useRoleStore();
  const [tasks, setTasks] = useState<EditableRoleTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    trpc.roles.getRoleJobTasks.query({ roleId: role.id })
      .then((rows) => {
        if (!active) return;
        setTasks(rows.map((task) => ({
          title: task.title,
          description: task.description ?? '',
          isActive: task.isActive,
        })));
      })
      .catch((err: any) => {
        if (active) setError(err.message ?? 'تعذر تحميل المهام الوظيفية');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => { active = false; };
  }, [role.id]);

  function updateTask(index: number, patch: Partial<EditableRoleTask>) {
    setTasks((cur) => cur.map((task, i) => i === index ? { ...task, ...patch } : task));
  }

  async function handleSave() {
    const cleaned = tasks
      .map((task) => ({
        title: task.title.trim(),
        description: task.description.trim() || null,
        isActive: task.isActive,
      }))
      .filter((task) => task.title);

    setSaving(true);
    setError('');
    try {
      const saved = await trpc.roles.setRoleJobTasks.mutate({ roleId: role.id, tasks: cleaned });
      setTasks(saved.map((task) => ({
        title: task.title,
        description: task.description ?? '',
        isActive: task.isActive,
      })));
      await fetchRoles();
      onClose();
    } catch (err: any) {
      setError(err.message ?? 'تعذر حفظ المهام الوظيفية');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm" dir="rtl">
      <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-slate-800">المهام الوظيفية</h3>
            <p className="text-xs text-slate-400 mt-0.5">{role.displayName}</p>
          </div>
          <IconButton icon={X} label="إغلاق" onClick={onClose} />
        </div>

        <div className="p-6 space-y-4 max-h-[65vh] overflow-y-auto">
          {error && <div className="rounded-xl bg-red-50 border border-red-100 text-red-600 text-sm px-4 py-3">{error}</div>}
          {loading ? (
            <div className="py-10 flex justify-center text-slate-400">
              <Loader2 className="w-6 h-6 animate-spin" />
            </div>
          ) : (
            <>
              <div className="space-y-3">
                {tasks.map((task, index) => (
                  <div key={index} className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="w-7 h-7 rounded-lg bg-white border border-slate-200 flex items-center justify-center text-xs font-bold text-slate-500">
                        {index + 1}
                      </span>
                      <input
                        value={task.title}
                        onChange={(e) => updateTask(index, { title: e.target.value })}
                        placeholder="عنوان المهمة"
                        className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
                      />
                      <button
                        type="button"
                        onClick={() => setTasks((cur) => cur.filter((_, i) => i !== index))}
                        className="w-8 h-8 rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-500"
                        title="حذف المهمة"
                      >
                        <Trash2 className="w-4 h-4 mx-auto" />
                      </button>
                    </div>
                    <textarea
                      value={task.description}
                      onChange={(e) => updateTask(index, { description: e.target.value })}
                      placeholder="تفاصيل اختيارية"
                      rows={2}
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400 resize-none"
                    />
                    <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-500">
                      <input
                        type="checkbox"
                        checked={task.isActive}
                        onChange={(e) => updateTask(index, { isActive: e.target.checked })}
                        className="rounded border-slate-300 text-sky-600"
                      />
                      مفعلة وتظهر للموظفين
                    </label>
                  </div>
                ))}
              </div>

              <button
                type="button"
                onClick={() => setTasks((cur) => [...cur, { title: '', description: '', isActive: true }])}
                className="w-full rounded-xl border border-dashed border-sky-200 bg-sky-50/50 py-3 text-sm font-bold text-sky-600 hover:bg-sky-50"
              >
                إضافة مهمة
              </button>
            </>
          )}
        </div>

        <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm font-semibold text-slate-500 hover:bg-slate-200">إلغاء</button>
          <button
            onClick={handleSave}
            disabled={saving || loading}
            className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-sky-500 hover:bg-sky-600 text-white text-sm font-bold disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            حفظ المهام
          </button>
        </div>
      </div>
    </div>
  );
}

export function UserModal({ user, roles, onClose }: { user?: HrUser | null; roles: Role[]; onClose: () => void }) {
  const { createHrUser, updateHrUser } = useRoleStore();
  const [name, setName] = useState(user?.name ?? '');
  const [username, setUsername] = useState(user?.username ?? '');
  const [password, setPassword] = useState('');
  const [roleId, setRoleId] = useState<number | ''>(user?.roleId ?? '');
  const [showPass, setShowPass] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const isEdit = !!user;

  async function handleSave() {
    if (!name.trim() || !username.trim() || (!isEdit && !password.trim()) || !roleId) {
      setError('يرجى تعبئة جميع الحقول المطلوبة');
      return;
    }
    setSaving(true); setError('');
    try {
      if (isEdit) {
        await updateHrUser(user!.id, { name, username, roleId: Number(roleId), ...(password ? { password } : {}) });
      } else {
        await createHrUser({ name, username, password, roleId: Number(roleId) });
      }
      onClose();
    } catch (e: any) { setError(e.message ?? 'حدث خطأ'); }
    finally { setSaving(false); }
  }

  // Only roles the current actor may assign without escalating (server flag).
  // The editing user's current role stays visible so it still renders.
  const activeRoles = roles.filter(r => r.isActive && (r.assignable !== false || r.id === user?.roleId));
  const assignedVisibleRole = user?.roleId ? activeRoles.find(r => r.id === user.roleId) ?? null : null;
  const hasReadOnlySystemRole = Boolean(user?.roleId && !assignedVisibleRole && user?.roleDisplayName);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between p-5 border-b border-slate-100">
          <h2 className="text-lg font-bold text-slate-800">{isEdit ? 'تعديل بيانات المستخدم' : 'إضافة مستخدم جديد'}</h2>
          <IconButton icon={X} label="إغلاق" size="sm" onClick={onClose} />
        </div>
        <div className="p-5 space-y-4">
          {error && <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 rounded-lg p-3"><AlertTriangle className="w-4 h-4 shrink-0" />{error}</div>}

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">الاسم الكامل <span className="text-red-500">*</span></label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="اسم المستخدم"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400" />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">اسم الدخول <span className="text-red-500">*</span></label>
            <input value={username} onChange={e => setUsername(e.target.value)} placeholder="مثال: admin_user"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400" />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">
              كلمة المرور {!isEdit && <span className="text-red-500">*</span>}
              {isEdit && <span className="text-slate-400 font-normal">(اتركها فارغة للإبقاء على الحالية)</span>}
            </label>
            <div className="relative">
              <input type={showPass ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)}
                placeholder={isEdit ? '••••••••' : 'كلمة مرور قوية'}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 pl-10 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400" />
              <button type="button" onClick={() => setShowPass(v => !v)}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">الدور <span className="text-red-500">*</span></label>
            {hasReadOnlySystemRole ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
                <div className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  {user?.roleDisplayName ?? 'دور نظامي محمي'}
                </div>
                <p className="mt-1 text-xs text-amber-700/80">
                  هذا دور نظامي مخفي للقراءة فقط ولا يظهر ضمن قائمة الإسناد العادية.
                </p>
              </div>
            ) : (
              <div className="relative">
                <Select
                  value={roleId === '' ? '' : String(roleId)}
                  onChange={(v) => setRoleId(v ? Number(v) : '')}
                  placeholder="— اختر دوراً —"
                  ariaLabel="الدور"
                  className="w-full"
                  options={[{ value: '', label: '— اختر دوراً —' }, ...activeRoles.map(r => ({ value: String(r.id), label: r.displayName }))]}
                />
              </div>
            )}
          </div>
        </div>
        <div className="flex gap-3 p-5 border-t border-slate-100">
          <button onClick={handleSave} disabled={saving}
            className="flex-1 flex items-center justify-center gap-2 bg-sky-500 hover:bg-sky-600 text-white text-sm font-semibold py-2.5 rounded-xl transition-colors disabled:opacity-50">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {isEdit ? 'حفظ التعديلات' : 'إضافة المستخدم'}
          </button>
          <button onClick={onClose} className="px-4 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-600 hover:bg-slate-50">إلغاء</button>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// Role Users Modal  — shows only users whose role_id = role.id
// ══════════════════════════════════════════════════════════════════
function RoleUsersModal({ role, onClose }: { role: Role; onClose: () => void }) {
  const [users, setUsers] = useState<TrpcRoleUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [branchFilter, setBranchFilter] = useState<number | 'all'>('all');

  useEffect(() => {
    setLoading(true);
    setError('');
    trpc.roles.getRoleUsers.query({ roleId: role.id })
      .then(setUsers)
      .catch((err: unknown) => setError((err as Error).message ?? 'تعذر تحميل المستخدمين'))
      .finally(() => setLoading(false));
  }, [role.id]);

  // Collect distinct branches across all users (from user_branch_assignments)
  const allBranches = Array.from(
    new Map(
      users.flatMap(u => u.branchAssignments.map(b => [b.branchId, b.branchName]))
    ).entries()
  ).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'ar'));

  // Filter: if a branch is selected, only show users who have that branch in their assignments
  const filteredUsers = branchFilter === 'all'
    ? users
    : users.filter(u => u.branchAssignments.some(b => b.branchId === branchFilter));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">

        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-slate-100">
          <div>
            <h2 className="text-lg font-bold text-slate-800">المستخدمون بهذا الدور</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              <span className="inline-flex items-center gap-1 bg-sky-50 text-sky-700 border border-sky-100 rounded-full px-2 py-0.5 font-medium">
                <ShieldCheck className="w-3 h-3" />{role.displayName}
              </span>
              <span className="mx-2 text-slate-300">·</span>
              {loading ? '...' : `${filteredUsers.length} مستخدم`}
            </p>
          </div>
          <IconButton icon={X} label="إغلاق" size="sm" className="mt-0.5" onClick={onClose} />
        </div>

        {/* Branch filter */}
        {!loading && allBranches.length > 0 && (
          <div className="px-5 py-3 border-b border-slate-50 bg-slate-50/60 flex items-center gap-3">
            <span className="text-xs font-semibold text-slate-500 shrink-0">تصفية حسب الفرع:</span>
            <div className="relative flex-1 max-w-xs">
              <Select
                value={branchFilter === 'all' ? 'all' : String(branchFilter)}
                onChange={(v) => setBranchFilter(v === 'all' ? 'all' : Number(v))}
                ariaLabel="تصفية حسب الفرع"
                className="w-full"
                options={[{ value: 'all', label: 'كل الفروع' }, ...allBranches.map(b => ({ value: String(b.id), label: b.name }))]}
              />
            </div>
            <p className="text-xs text-slate-400">الفروع من إسنادات الفروع فقط — ليس من الدور</p>
          </div>
        )}

        {/* Body */}
        <div className="overflow-y-auto flex-1 p-5">
          {error && (
            <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 rounded-lg p-3 mb-4">
              <AlertTriangle className="w-4 h-4 shrink-0" />{error}
            </div>
          )}

          {loading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="w-8 h-8 animate-spin text-sky-400" />
            </div>
          ) : filteredUsers.length === 0 ? (
            <div className="text-center py-16 text-slate-400 border border-dashed border-slate-200 rounded-2xl">
              <Users className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="text-sm font-medium">
                {users.length === 0
                  ? 'لا يوجد مستخدمون بهذا الدور بعد'
                  : 'لا يوجد مستخدمون بهذا الدور في الفرع المحدد'}
              </p>
              <p className="text-xs mt-1 text-slate-400">
                لإضافة مستخدم، اختر الدور عند إنشاء المستخدم من "إدارة المستخدمين" أدناه
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredUsers.map(user => (
                <div key={user.id} className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-full bg-sky-100 flex items-center justify-center shrink-0">
                        <User className="w-4 h-4 text-sky-600" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-slate-800 text-sm">{user.name}</span>
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${
                            user.isActive
                              ? 'bg-emerald-50 text-emerald-600 border-emerald-200'
                              : 'bg-red-50 text-red-500 border-red-200'
                          }`}>
                            {user.isActive ? 'نشط' : 'موقوف'}
                          </span>
                        </div>
                        <p className="text-xs text-slate-400 font-mono mt-0.5">{user.username}</p>
                      </div>
                    </div>
                  </div>

                  {/* Branch assignments */}
                  <div className="mt-3 pt-3 border-t border-slate-50">
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">
                      الفروع المسموحة (من إسنادات الفروع)
                    </p>
                    {user.branchAssignments.length === 0 ? (
                      <p className="text-xs text-slate-400 italic">لا توجد فروع مسندة</p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {user.branchAssignments.map(b => (
                          <span
                            key={b.branchId}
                            className={`inline-flex items-center gap-1 text-xs font-medium rounded-full px-2.5 py-1 border ${
                              b.status === 'active'
                                ? 'bg-slate-50 text-slate-700 border-slate-200'
                                : 'bg-slate-50 text-slate-400 border-slate-200 opacity-60'
                            }`}
                          >
                            <Building2 className="w-3 h-3 shrink-0 text-sky-400" />
                            {b.branchName}
                            {b.isPrimary && (
                              <Star className="w-2.5 h-2.5 text-amber-400 shrink-0" />
                            )}
                            {b.status !== 'active' && (
                              <span className="text-[9px] text-slate-400">(معطل)</span>
                            )}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer note */}
        <div className="px-5 py-3 border-t border-slate-100 bg-slate-50/60">
          <p className="text-xs text-slate-400">
            الفروع الظاهرة مصدرها <code className="bg-slate-100 px-1 rounded">user_branch_assignments</code> وليس الدور.
            الدور يحدد الصلاحيات فقط، والفروع تحدد أين تطبق.
          </p>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// User Branch Assignments Modal
// ══════════════════════════════════════════════════════════════════
export function UserBranchAssignmentsModal({
  user,
  readOnly,
  onClose,
}: {
  user: HrUser;
  readOnly: boolean;
  onClose: () => void;
}) {
  const [assignments, setAssignments] = useState<UserBranchAssignment[]>([]);
  const [branches, setBranches] = useState<BranchCatalogItem[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState<number | ''>('');
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState('');

  async function loadData() {
    setLoading(true);
    setError('');
    try {
      const [nextAssignments, nextBranches] = await Promise.all([
        trpc.roles.getUserBranchAssignments.query({ userId: user.id }),
        trpc.roles.branchCatalog.query(),
      ]);
      setAssignments(nextAssignments);
      setBranches(nextBranches);
    } catch (err: any) {
      setError(err.message ?? 'تعذر تحميل فروع المستخدم');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, [user.id]);

  async function handleAddBranch() {
    if (!selectedBranchId || readOnly) return;

    setSavingKey('add');
    setError('');
    try {
      const nextAssignments = await trpc.roles.upsertUserBranchAssignment.mutate({
        userId: user.id,
        branchId: Number(selectedBranchId),
        status: 'active',
      });
      setAssignments(nextAssignments);
      setSelectedBranchId('');
    } catch (err: any) {
      setError(err.message ?? 'تعذر إسناد الفرع');
    } finally {
      setSavingKey(null);
    }
  }

  async function handleDeactivate(assignment: UserBranchAssignment) {
    if (readOnly) return;

    setSavingKey(`deactivate-${assignment.branchId}`);
    setError('');
    try {
      const nextAssignments = await trpc.roles.deactivateUserBranchAssignment.mutate({
        userId: user.id,
        branchId: assignment.branchId,
      });
      setAssignments(nextAssignments);
    } catch (err: any) {
      setError(err.message ?? 'تعذر تعطيل الفرع');
    } finally {
      setSavingKey(null);
    }
  }

  async function handleReactivate(assignment: UserBranchAssignment) {
    if (readOnly) return;

    setSavingKey(`reactivate-${assignment.branchId}`);
    setError('');
    try {
      const nextAssignments = await trpc.roles.upsertUserBranchAssignment.mutate({
        userId: user.id,
        branchId: assignment.branchId,
        status: 'active',
      });
      setAssignments(nextAssignments);
    } catch (err: any) {
      setError(err.message ?? 'تعذر إعادة تفعيل الفرع');
    } finally {
      setSavingKey(null);
    }
  }

  async function handleSetPrimary(assignment: UserBranchAssignment) {
    if (readOnly) return;

    setSavingKey(`primary-${assignment.branchId}`);
    setError('');
    try {
      const nextAssignments = await trpc.roles.setPrimaryUserBranchAssignment.mutate({
        userId: user.id,
        branchId: assignment.branchId,
      });
      setAssignments(nextAssignments);
    } catch (err: any) {
      setError(err.message ?? 'تعذر تعيين الفرع الأساسي');
    } finally {
      setSavingKey(null);
    }
  }

  const availableBranches = branches.filter(branch => {
    if (branch.status !== 'active') return false;
    return !assignments.some(assignment => assignment.branchId === branch.id && assignment.status === 'active');
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-slate-100">
          <div>
            <h2 className="text-lg font-bold text-slate-800">الفروع المسموحة</h2>
            <p className="text-xs text-slate-500 mt-1">
              {user.name} ({user.username}) - الدور يحدد ماذا يستطيع المستخدم فعله، والفروع تحدد أين يستطيع فعله.
            </p>
          </div>
          <IconButton icon={X} label="إغلاق" size="sm" onClick={onClose} />
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          {error && (
            <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 rounded-lg p-3">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              {error}
            </div>
          )}

          <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-end">
              <div className="flex-1">
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">إضافة فرع للمستخدم</label>
                <div className="relative">
                  <Select
                    value={selectedBranchId === '' ? '' : String(selectedBranchId)}
                    onChange={(v) => setSelectedBranchId(v ? Number(v) : '')}
                    disabled={readOnly || loading}
                    placeholder="— اختر فرعاً فعالاً —"
                    ariaLabel="فرع فعال"
                    className="w-full"
                    options={[{ value: '', label: '— اختر فرعاً فعالاً —' }, ...availableBranches.map(branch => ({ value: String(branch.id), label: branch.name }))]}
                  />
                </div>
              </div>
              <button
                onClick={() => void handleAddBranch()}
                disabled={readOnly || !selectedBranchId || savingKey === 'add'}
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-sky-500 hover:bg-sky-600 text-white rounded-xl text-sm font-semibold transition-colors disabled:opacity-50"
              >
                {savingKey === 'add' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                إضافة فرع
              </button>
            </div>
            {readOnly && (
              <p className="text-xs text-slate-500 mt-3">تملك صلاحية العرض فقط. إدارة الفروع المسموحة تتطلب permission مستقلة عن إدارة الأدوار.</p>
            )}
          </div>

          {loading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="w-8 h-8 animate-spin text-sky-400" />
            </div>
          ) : assignments.length === 0 ? (
            <div className="text-center py-16 text-slate-400 border border-dashed border-slate-200 rounded-2xl">
              <Building2 className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="text-sm">لا توجد فروع مسندة لهذا المستخدم بعد</p>
            </div>
          ) : (
            <div className="space-y-3">
              {assignments.map(assignment => (
                <div key={assignment.branchId} className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <div className="inline-flex items-center gap-2 text-sm font-bold text-slate-800">
                          <Building2 className="w-4 h-4 text-sky-500" />
                          {assignment.branchName}
                        </div>
                        {assignment.isPrimary && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">
                            <Star className="w-3 h-3" />
                            الفرع الأساسي
                          </span>
                        )}
                        <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${assignment.status === 'active' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-100 text-slate-500'}`}>
                          {assignment.status === 'active' ? 'فعال' : 'معطل'}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 mt-1">
                        الفرع منفصل عن الدور. تغيير هذه القائمة لا يغير role المستخدم ولا ينشئ clones.
                      </p>
                    </div>
                    <div className="flex items-center gap-2 justify-end flex-wrap">
                      {assignment.status === 'active' && !assignment.isPrimary && (
                        <button
                          onClick={() => void handleSetPrimary(assignment)}
                          disabled={readOnly || savingKey === `primary-${assignment.branchId}`}
                          className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-amber-700 bg-amber-50 hover:bg-amber-100 transition-colors disabled:opacity-50"
                        >
                          {savingKey === `primary-${assignment.branchId}` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Star className="w-3.5 h-3.5" />}
                          تعيين كأساسي
                        </button>
                      )}
                      {assignment.status === 'active' ? (
                        <button
                          onClick={() => void handleDeactivate(assignment)}
                          disabled={readOnly || savingKey === `deactivate-${assignment.branchId}`}
                          className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 transition-colors disabled:opacity-50"
                        >
                          {savingKey === `deactivate-${assignment.branchId}` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ToggleLeft className="w-3.5 h-3.5" />}
                          تعطيل
                        </button>
                      ) : (
                        <button
                          onClick={() => void handleReactivate(assignment)}
                          disabled={readOnly || savingKey === `reactivate-${assignment.branchId}`}
                          className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 transition-colors disabled:opacity-50"
                        >
                          {savingKey === `reactivate-${assignment.branchId}` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ToggleRight className="w-3.5 h-3.5" />}
                          إعادة التفعيل
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// Roles Tab
// ══════════════════════════════════════════════════════════════════
function RolesTab() {
  const navigate = useNavigate();
  const { roles, loading, error, fetchRoles, updateRole, deleteRole } = useRoleStore();
  const { hasPermission } = usePermissions();
  const [showModal, setShowModal] = useState(false);
  const [editRole, setEditRole] = useState<Role | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [roleUsersModal, setRoleUsersModal] = useState<Role | null>(null);
  const [roleTasksModal, setRoleTasksModal] = useState<Role | null>(null);
  const canManageRoles = hasPermission('admin.roles.manage');
  const canManageRoleUsers = hasPermission('admin.roles.users.manage');

  useEffect(() => { fetchRoles(); }, [fetchRoles]);

  async function handleToggleActive(role: Role) {
    try { await updateRole(role.id, { isActive: !role.isActive }); }
    catch { /* ignore */ }
  }

  async function handleDelete(id: number) {
    if (!confirm('هل أنت متأكد من حذف هذا الدور؟')) return;
    setDeleting(id);
    try { await deleteRole(id); } finally { setDeleting(null); }
  }

  return (
    <>
      <div className="flex justify-end mb-4">
        <button onClick={() => { setEditRole(null); setShowModal(true); }}
          disabled={!canManageRoles}
          className="flex items-center gap-2 bg-sky-500 hover:bg-sky-600 text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors shadow-sm">
          <Plus className="w-4 h-4" />دور جديد
        </button>
      </div>

      {error && <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 rounded-xl p-4 mb-4"><AlertTriangle className="w-4 h-4 shrink-0" />{error}</div>}
      {loading && <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-sky-400" /></div>}

      {!loading && (
        <div className="grid gap-4 sm:grid-cols-2">
          {roles.map(role => (
            <div key={role.id} className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-bold text-slate-800 text-base">{role.displayName}</h3>
                    {role.isSystem && (
                      <span className="text-xs bg-amber-50 text-amber-600 border border-amber-200 rounded-full px-2 py-0.5 font-medium">نظام</span>
                    )}
                    <span className={`text-xs rounded-full px-2 py-0.5 font-medium border ${role.isActive ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : 'bg-slate-50 text-slate-400 border-slate-200'}`}>
                      {role.isActive ? 'نشط' : 'معطّل'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5 font-mono">{role.name}</p>
                  {role.description && <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">{role.description}</p>}
                </div>
                {!role.isSystem && !role.isProtected && (
                  <button onClick={() => handleToggleActive(role)} className="text-slate-400 hover:text-sky-500 transition-colors mt-0.5" title={role.isActive ? 'تعطيل' : 'تفعيل'}>
                    {role.isActive ? <ToggleRight className="w-6 h-6 text-emerald-500" /> : <ToggleLeft className="w-6 h-6" />}
                  </button>
                )}
              </div>

              {/* Stats — user count is clickable and opens RoleUsersModal */}
              <div className="flex items-center gap-4 text-xs text-slate-500">
                <button
                  onClick={() => setRoleUsersModal(role)}
                  className="flex items-center gap-1.5 hover:text-sky-600 transition-colors group"
                  title="عرض المستخدمين بهذا الدور"
                >
                  <Users className="w-3.5 h-3.5 group-hover:text-sky-500" />
                  <span className="group-hover:underline">{role.userCount} مستخدم</span>
                </button>
                <div className="flex items-center gap-1.5"><Key className="w-3.5 h-3.5" /><span>{role.permissionCount} صلاحية</span></div>
                <div className="flex items-center gap-1.5"><ListChecks className="w-3.5 h-3.5" /><span>{role.jobTaskCount ?? 0} مهمة</span></div>
              </div>

              {/* Actions */}
              <div className="flex gap-2 pt-1 border-t border-slate-50">
                {/* Primary: manage permissions */}
                <button onClick={() => navigate(`/admin/roles/${role.id}/permissions`)}
                  disabled={!canManageRoles || role.isSystem || role.isProtected}
                  className="flex-1 flex items-center justify-center gap-1.5 text-xs font-semibold text-sky-600 bg-sky-50 hover:bg-sky-100 py-2 rounded-lg transition-colors">
                  <Key className="w-3.5 h-3.5" />إدارة الصلاحيات
                </button>
                {/* Secondary: view users of this role */}
                <button
                  onClick={() => setRoleUsersModal(role)}
                  className="flex items-center justify-center gap-1.5 text-xs font-semibold text-slate-600 bg-slate-50 hover:bg-slate-100 py-2 px-3 rounded-lg transition-colors"
                  title="المستخدمون بهذا الدور"
                >
                  <Users className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">المستخدمون</span>
                </button>
                <button
                  onClick={() => setRoleTasksModal(role)}
                  disabled={!canManageRoles || role.isSystem || role.isProtected}
                  className="flex items-center justify-center gap-1.5 text-xs font-semibold text-emerald-600 bg-emerald-50 hover:bg-emerald-100 py-2 px-3 rounded-lg transition-colors disabled:opacity-50"
                  title="المهام الوظيفية"
                >
                  <ListChecks className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">المهام</span>
                </button>
                {!role.isSystem && !role.isProtected && canManageRoles && (
                  <>
                    <button onClick={() => { setEditRole(role); setShowModal(true); }}
                      className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 transition-colors" title="تعديل">
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button onClick={() => handleDelete(role.id)} disabled={deleting === role.id}
                      className="p-2 rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-500 transition-colors disabled:opacity-50" title="حذف">
                      {deleting === role.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
          {roles.length === 0 && !loading && (
            <div className="sm:col-span-2 text-center py-16 text-slate-400">
              <ShieldCheck className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="text-sm">لا توجد أدوار بعد</p>
            </div>
          )}
        </div>
      )}

      {showModal && canManageRoles && <RoleModal role={editRole} onClose={() => { setShowModal(false); setEditRole(null); }} />}
      {roleUsersModal && (
        <RoleUsersModal role={roleUsersModal} onClose={() => setRoleUsersModal(null)} />
      )}
      {roleTasksModal && canManageRoles && (
        <RoleJobTasksModal role={roleTasksModal} onClose={() => setRoleTasksModal(null)} />
      )}
    </>
  );
}

// ══════════════════════════════════════════════════════════════════
// Main Page
// ══════════════════════════════════════════════════════════════════
export default function Roles() {
  const navigate = useNavigate();
  const { hasPermission } = usePermissions();

  // Roles page is GLOBAL admin only (role + permission management). User management
  // moved to the standalone /admin/users records page — so a branch manager who only
  // holds admin.roles.users.manage no longer lands here.
  const canViewRoles = hasPermission('admin.roles.view');

  if (!canViewRoles) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="h-full overflow-y-auto bg-slate-50">
      <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">

        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-sky-500 flex items-center justify-center shadow-lg shadow-sky-500/30">
            <ShieldCheck className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl mb-1 font-bold text-slate-800">الأدوار والصلاحيات</h1>
            <p className="text-xs text-slate-500">إدارة أدوار النظام وصلاحياتها، وإسناد المستخدمين إلى الأدوار والفروع</p>
          </div>
        </div>

        {/*
          Info box — explains how role assignment works.
          Button navigates to /employees (field employee records)
          so admins can open an employee file and assign a system account from there.
          This is separate from role cards — it's a workflow guide, not a role-level action.
        */}
        <div className="bg-sky-50 border border-sky-100 rounded-2xl p-5 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-sky-100 border border-sky-200 text-sky-600 flex items-center justify-center shrink-0">
              <Users className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-800">إسناد حساب نظام لموظف</h2>
              <p className="text-sm text-slate-500 mt-1 leading-relaxed">
                لإعطاء موظف صلاحية تسجيل الدخول، افتح ملف الموظف وحدد له حساباً ودوراً إدارياً من هناك.
              </p>
            </div>
          </div>
          <button
            onClick={() => navigate('/employees')}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-white hover:bg-sky-50 text-sky-700 border border-sky-200 rounded-xl text-sm font-semibold transition-colors shrink-0"
          >
            <ExternalLink className="w-4 h-4" />
            ملف الموظفين
          </button>
        </div>

        {/* Role cards — each card shows permissions + users for THAT role only */}
        <div className="space-y-3">
          <div>
            <h2 className="text-lg font-bold text-slate-800">الأدوار</h2>
            <p className="text-sm text-slate-500 mt-1">
              كل دور يحمل مجموعة صلاحيات. اضغط على عدد المستخدمين لرؤية من يحمل هذا الدور وفروعهم المسموحة.
            </p>
          </div>
          <RolesTab />
        </div>

      </div>
    </div>
  );
}
