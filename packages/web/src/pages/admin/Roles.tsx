import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useRoleStore } from '../../hooks/useRoleStore';
import type { Role, HrUser } from '../../hooks/useRoleStore';
import type { BranchCatalogItem, UserBranchAssignment } from '@golden-crm/shared';
import { trpc } from '../../lib/trpc';
import type { RoleUser as TrpcRoleUser } from '../../lib/trpc-contract';
import { usePermissions } from '../../hooks/usePermissions';
import Select from '../../components/ui/Select';
import Card from '../../components/ui/Card';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import IconButton from '../../components/ui/IconButton';
import Toggle from '../../components/ui/Toggle';
import {
  ShieldCheck, Plus, Edit2, Trash2, Users, Key,
  ToggleLeft, ToggleRight, X, Save, Loader2, AlertTriangle,
  UserPlus, User, Eye, EyeOff, ChevronDown, Building2, Star,
  ExternalLink, ListChecks,
} from 'lucide-react';

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
          <h2 className="text-base font-bold text-slate-800">{isEdit ? 'تعديل الدور' : 'إنشاء دور جديد'}</h2>
          <IconButton icon={X} label="إغلاق" size="sm" onClick={onClose} />
        </div>
        <div className="p-5 space-y-4">
          {error && <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 rounded-lg p-3"><AlertTriangle className="w-4 h-4 shrink-0" />{error}</div>}
          {!isEdit && (
            <div>
              <Input
                label="المعرف الداخلي"
                required
                value={name}
                onChange={e => setName(e.target.value.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, ''))}
                placeholder="مثال: branch_manager"
                helper="حروف إنجليزية صغيرة وأرقام وشرطة سفلية فقط"
              />
            </div>
          )}
          <Input
            label="الاسم المعروض"
            required
            value={displayName}
            onChange={e => setDisplayName(e.target.value)}
            placeholder="مثال: مدير الفرع"
          />
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">الوصف</label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3}
              placeholder="وصف مختصر لصلاحيات هذا الدور..."
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400 resize-none" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">خانة الفريق</label>
            <Select
              value={teamSlotType ?? ''}
              onChange={v => setTeamSlotType(v ? v as 'SUPERVISOR' | 'TECHNICIAN' | 'TRAINEE' | 'TELEMARKETER' : null)}
              placeholder="— لا يوجد —"
              ariaLabel="خانة الفريق"
              className="w-full"
              options={[
                { value: 'SUPERVISOR', label: 'مشرف' },
                { value: 'TECHNICIAN', label: 'فني' },
                { value: 'TRAINEE', label: 'متدرب' },
                { value: 'TELEMARKETER', label: 'مسوق هاتفي' },
              ]}
            />
            <p className="mt-1.5 text-[11px] text-slate-500 leading-5">
              تحدد هذه الخانة موقع الدور داخل الفريق. ولظهور الموظف في جدولة الفرق يجب أن يملك هذا الدور أيضاً صلاحية
              <span className="font-semibold text-slate-700"> الظهور في جدولة الفرق</span>.
            </p>
          </div>
        </div>
        <div className="flex gap-3 p-5 border-t border-slate-100">
          <Button onClick={handleSave} loading={saving} icon={Save} fullWidth>
            {isEdit ? 'حفظ التعديلات' : 'إنشاء الدور'}
          </Button>
          <Button variant="secondary" onClick={onClose}>إلغاء</Button>
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
            <h3 className="text-lg font-bold text-slate-800">المهام الوظيفية</h3>
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
                      <Input
                        value={task.title}
                        onChange={(e) => updateTask(index, { title: e.target.value })}
                        placeholder="عنوان المهمة"
                        className="flex-1"
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

              <Button
                variant="ghost"
                onClick={() => setTasks((cur) => [...cur, { title: '', description: '', isActive: true }])}
                fullWidth
                className="border border-dashed border-sky-200 bg-sky-50/50 text-sky-600 hover:bg-sky-50"
              >
                إضافة مهمة
              </Button>
            </>
          )}
        </div>

        <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>إلغاء</Button>
          <Button onClick={handleSave} disabled={loading} loading={saving} icon={Save}>
            حفظ المهام
          </Button>
        </div>
      </div>
    </div>
  );
}

function UserModal({ user, roles, onClose }: { user?: HrUser | null; roles: Role[]; onClose: () => void }) {
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

  const activeRoles = roles.filter(r => r.isActive);
  const assignedVisibleRole = user?.roleId ? activeRoles.find(r => r.id === user.roleId) ?? null : null;
  const hasReadOnlySystemRole = Boolean(user?.roleId && !assignedVisibleRole && user?.roleDisplayName);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between p-5 border-b border-slate-100">
          <h2 className="text-base font-bold text-slate-800">{isEdit ? 'تعديل بيانات المستخدم' : 'إضافة مستخدم جديد'}</h2>
          <IconButton icon={X} label="إغلاق" size="sm" onClick={onClose} />
        </div>
        <div className="p-5 space-y-4">
          {error && <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 rounded-lg p-3"><AlertTriangle className="w-4 h-4 shrink-0" />{error}</div>}

          <Input
            label="الاسم الكامل"
            required
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="اسم المستخدم"
          />

          <Input
            label="اسم الدخول"
            required
            value={username}
            onChange={e => setUsername(e.target.value)}
            placeholder="مثال: admin_user"
          />

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
                <p className="mt-1 text-[11px] text-amber-700/80">
                  هذا دور نظامي مخفي للقراءة فقط ولا يظهر ضمن قائمة الإسناد العادية.
                </p>
              </div>
            ) : (
              <Select
                value={roleId === '' ? '' : String(roleId)}
                onChange={v => setRoleId(v === '' ? '' : Number(v))}
                placeholder="— اختر دوراً —"
                ariaLabel="الدور"
                className="w-full"
                options={activeRoles.map(r => ({ value: String(r.id), label: r.displayName }))}
              />
            )}
          </div>
        </div>
        <div className="flex gap-3 p-5 border-t border-slate-100">
          <Button onClick={handleSave} loading={saving} icon={Save} fullWidth>
            {isEdit ? 'حفظ التعديلات' : 'إضافة المستخدم'}
          </Button>
          <Button variant="secondary" onClick={onClose}>إلغاء</Button>
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
            <h2 className="text-base font-bold text-slate-800">المستخدمون بهذا الدور</h2>
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
            <div className="flex-1 max-w-xs">
              <Select
                value={branchFilter === 'all' ? 'all' : String(branchFilter)}
                onChange={v => setBranchFilter(v === 'all' ? 'all' : Number(v))}
                ariaLabel="تصفية حسب الفرع"
                size="sm"
                className="w-full"
                options={[
                  { value: 'all', label: 'كل الفروع' },
                  ...allBranches.map(b => ({ value: String(b.id), label: b.name })),
                ]}
              />
            </div>
            <p className="text-[10px] text-slate-400">الفروع من إسنادات الفروع فقط — ليس من الدور</p>
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
                          <Badge variant={user.isActive ? 'success' : 'error'} size="sm">
                            {user.isActive ? 'نشط' : 'موقوف'}
                          </Badge>
                        </div>
                        <p className="text-[11px] text-slate-400 font-mono mt-0.5">{user.username}</p>
                      </div>
                    </div>
                  </div>

                  {/* Branch assignments */}
                  <div className="mt-3 pt-3 border-t border-slate-50">
                    <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-2">
                      الفروع المسموحة (من إسنادات الفروع)
                    </p>
                    {user.branchAssignments.length === 0 ? (
                      <p className="text-xs text-slate-400 italic">لا توجد فروع مسندة</p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {user.branchAssignments.map(b => (
                          <span
                            key={b.branchId}
                            className={`inline-flex items-center gap-1 text-[11px] font-medium rounded-full px-2.5 py-1 border ${
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
          <p className="text-[10px] text-slate-400">
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
function UserBranchAssignmentsModal({
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
            <h2 className="text-base font-bold text-slate-800">الفروع المسموحة</h2>
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
                <Select
                  value={selectedBranchId === '' ? '' : String(selectedBranchId)}
                  onChange={v => setSelectedBranchId(v === '' ? '' : Number(v))}
                  disabled={readOnly || loading}
                  placeholder="— اختر فرعاً فعالاً —"
                  ariaLabel="إضافة فرع"
                  className="w-full"
                  options={availableBranches.map(branch => ({ value: String(branch.id), label: branch.name }))}
                />
              </div>
              <Button
                onClick={() => void handleAddBranch()}
                disabled={readOnly || !selectedBranchId}
                loading={savingKey === 'add'}
                icon={Plus}
              >
                إضافة فرع
              </Button>
            </div>
            {readOnly && (
              <p className="text-[11px] text-slate-500 mt-3">تملك صلاحية العرض فقط. إدارة الفروع المسموحة تتطلب permission مستقلة عن إدارة الأدوار.</p>
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
                          <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                            <Star className="w-3 h-3" />
                            الفرع الأساسي
                          </span>
                        )}
                        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${assignment.status === 'active' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-100 text-slate-500'}`}>
                          {assignment.status === 'active' ? 'فعال' : 'معطل'}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 mt-1">
                        الفرع منفصل عن الدور. تغيير هذه القائمة لا يغير role المستخدم ولا ينشئ clones.
                      </p>
                    </div>
                    <div className="flex items-center gap-2 justify-end flex-wrap">
                      {assignment.status === 'active' && !assignment.isPrimary && (
                        <Button
                          variant="gold"
                          size="sm"
                          onClick={() => void handleSetPrimary(assignment)}
                          disabled={readOnly}
                          loading={savingKey === `primary-${assignment.branchId}`}
                          icon={Star}
                        >
                          تعيين كأساسي
                        </Button>
                      )}
                      {assignment.status === 'active' ? (
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => void handleDeactivate(assignment)}
                          disabled={readOnly}
                          loading={savingKey === `deactivate-${assignment.branchId}`}
                          icon={ToggleLeft}
                        >
                          تعطيل
                        </Button>
                      ) : (
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => void handleReactivate(assignment)}
                          disabled={readOnly}
                          loading={savingKey === `reactivate-${assignment.branchId}`}
                          icon={ToggleRight}
                        >
                          إعادة التفعيل
                        </Button>
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
        <Button onClick={() => { setEditRole(null); setShowModal(true); }} disabled={!canManageRoles} icon={Plus}>
          دور جديد
        </Button>
      </div>

      {error && <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 rounded-xl p-4 mb-4"><AlertTriangle className="w-4 h-4 shrink-0" />{error}</div>}
      {loading && <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-sky-400" /></div>}

      {!loading && (
        <div className="grid gap-4 sm:grid-cols-2">
          {roles.map(role => (
            <Card key={role.id} className="space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-bold text-slate-800 text-sm">{role.displayName}</h3>
                    {role.isSystem && (
                      <Badge variant="warning" size="sm">نظام</Badge>
                    )}
                    <Badge variant={role.isActive ? 'success' : 'neutral'} size="sm">
                      {role.isActive ? 'نشط' : 'معطّل'}
                    </Badge>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-0.5 font-mono">{role.name}</p>
                  {role.description && <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">{role.description}</p>}
                </div>
                {!role.isSystem && !role.isProtected && (
                  <Toggle checked={role.isActive} onCheckedChange={() => handleToggleActive(role)} label={role.isActive ? 'تعطيل' : 'تفعيل'} className="mt-0.5" />
                )}
              </div>

              {/* Stats — user count is clickable and opens RoleUsersModal */}
              <div className="flex items-center gap-4 text-xs text-slate-500">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setRoleUsersModal(role)}
                  icon={Users}
                  title="عرض المستخدمين بهذا الدور"
                  className="text-slate-500 hover:text-sky-600 px-2"
                >
                  {role.userCount} مستخدم
                </Button>
                <div className="flex items-center gap-1.5"><Key className="w-3.5 h-3.5" /><span>{role.permissionCount} صلاحية</span></div>
                <div className="flex items-center gap-1.5"><ListChecks className="w-3.5 h-3.5" /><span>{role.jobTaskCount ?? 0} مهمة</span></div>
              </div>

              {/* Actions */}
              <div className="flex gap-2 pt-1 border-t border-slate-50">
                {/* Primary: manage permissions */}
                <Button
                  size="sm"
                  onClick={() => navigate(`/admin/roles/${role.id}/permissions`)}
                  disabled={!canManageRoles || role.isSystem || role.isProtected}
                  icon={Key}
                  className="flex-1"
                >
                  إدارة الصلاحيات
                </Button>
                {/* Secondary: view users of this role */}
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setRoleUsersModal(role)}
                  icon={Users}
                  title="المستخدمون بهذا الدور"
                >
                  <span className="hidden sm:inline">المستخدمون</span>
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => setRoleTasksModal(role)}
                  disabled={!canManageRoles || role.isSystem || role.isProtected}
                  icon={ListChecks}
                  title="المهام الوظيفية"
                >
                  <span className="hidden sm:inline">المهام</span>
                </Button>
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
            </Card>
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
// Users Tab
// ══════════════════════════════════════════════════════════════════
function UsersTab() {
  const { roles, hrUsers, loading, fetchRoles, fetchHrUsers, updateHrUser } = useRoleStore();
  const { hasPermission } = usePermissions();
  const [showModal, setShowModal] = useState(false);
  const [editUser, setEditUser] = useState<HrUser | null>(null);
  const [branchUser, setBranchUser] = useState<HrUser | null>(null);
  const [togglingId, setTogglingId] = useState<number | null>(null);
  const canViewBranchAssignments = hasPermission('users.branch_assignments.view');
  const canManageBranchAssignments = hasPermission('users.branch_assignments.manage');
  const canManageRoles = hasPermission('admin.roles.manage');

  useEffect(() => {
    fetchRoles();
    fetchHrUsers();
  }, [fetchRoles, fetchHrUsers]);

  async function handleToggle(user: HrUser) {
    setTogglingId(user.id);
    try { await updateHrUser(user.id, { isActive: !user.isActive }); }
    finally { setTogglingId(null); }
  }

  const roleMap = Object.fromEntries(roles.map(r => [r.id, r]));

  return (
    <>
      <div className="flex justify-end mb-4">
        <Button onClick={() => { setEditUser(null); setShowModal(true); }} disabled={!canManageRoles} icon={UserPlus}>
          مستخدم جديد
        </Button>
      </div>

      {loading && <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-sky-400" /></div>}

      {!loading && (
        <Card padding="none" className="overflow-hidden">
          {hrUsers.length === 0 ? (
            <div className="text-center py-16 text-slate-400">
              <User className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="text-sm">لا يوجد مستخدمون بعد</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50">
                  <th className="text-right px-5 py-3 text-xs font-semibold text-slate-500">المستخدم</th>
                  <th className="text-right px-5 py-3 text-xs font-semibold text-slate-500">اسم الدخول</th>
                  <th className="text-right px-5 py-3 text-xs font-semibold text-slate-500">الدور</th>
                  <th className="text-right px-5 py-3 text-xs font-semibold text-slate-500">الحالة</th>
                  <th className="px-5 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {hrUsers.map(user => {
                  const role = user.roleId ? roleMap[user.roleId] : null;
                  const readOnlySystemRoleName = !role && user.roleDisplayName
                    ? user.roleDisplayName
                    : null;
                  return (
                    <tr key={user.id} className="hover:bg-slate-50/60 transition-colors">
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-full bg-sky-100 flex items-center justify-center shrink-0">
                            <User className="w-4 h-4 text-sky-600" />
                          </div>
                          <span className="font-semibold text-slate-800">{user.name}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3.5 text-slate-500 font-mono text-xs">{user.username}</td>
                      <td className="px-5 py-3.5">
                        {role ? (
                          <span className="inline-flex items-center gap-1 text-xs bg-sky-50 text-sky-700 border border-sky-100 rounded-full px-2.5 py-1 font-medium">
                            <ShieldCheck className="w-3 h-3" />{role.displayName}
                          </span>
                        ) : readOnlySystemRoleName ? (
                          <span className="inline-flex items-center gap-1 text-xs bg-amber-50 text-amber-700 border border-amber-200 rounded-full px-2.5 py-1 font-medium">
                            <ShieldCheck className="w-3 h-3" />{readOnlySystemRoleName}
                          </span>
                        ) : (
                          <span className="text-xs text-slate-400 italic">بدون دور</span>
                        )}
                      </td>
                      <td className="px-5 py-3.5">
                        <Badge variant={user.isActive ? 'success' : 'error'} size="sm">
                          {user.isActive ? 'نشط' : 'موقوف'}
                        </Badge>
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-1 justify-end">
                          {canViewBranchAssignments && (
                            <button
                              onClick={() => setBranchUser(user)}
                              className="p-1.5 rounded-lg text-slate-400 hover:bg-sky-50 hover:text-sky-600 transition-colors"
                              title="الفروع المسموحة"
                            >
                              <Building2 className="w-4 h-4" />
                            </button>
                          )}
                          <Toggle checked={user.isActive} onCheckedChange={() => handleToggle(user)} disabled={!canManageRoles || togglingId === user.id} size="sm" label={user.isActive ? 'إيقاف الحساب' : 'تفعيل الحساب'} />
                          <button onClick={() => { setEditUser(user); setShowModal(true); }}
                            disabled={!canManageRoles}
                            className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors" title="تعديل">
                            <Edit2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Card>
      )}

      {showModal && canManageRoles && (
        <UserModal
          user={editUser}
          roles={roles}
          onClose={() => { setShowModal(false); setEditUser(null); }}
        />
      )}
      {branchUser && (
        <UserBranchAssignmentsModal
          user={branchUser}
          readOnly={!canManageBranchAssignments}
          onClose={() => setBranchUser(null)}
        />
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

  if (!hasPermission('admin.roles.view')) {
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
            <h1 className="text-xl font-bold text-slate-800">الأدوار والصلاحيات</h1>
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
              <h2 className="text-sm font-bold text-slate-800">إسناد حساب نظام لموظف</h2>
              <p className="text-sm text-slate-500 mt-1 leading-relaxed">
                لإعطاء موظف صلاحية تسجيل الدخول، افتح ملف الموظف وحدد له حساباً ودوراً إدارياً من هناك.
              </p>
            </div>
          </div>
          <Button
            variant="secondary"
            onClick={() => navigate('/employees')}
            icon={ExternalLink}
            className="shrink-0"
          >
            ملف الموظفين
          </Button>
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

        {/* All system users management — separate from role cards */}
        <div className="space-y-3">
          <div>
            <h2 className="text-lg font-bold text-slate-800">إدارة المستخدمين</h2>
            <p className="text-sm text-slate-500 mt-1">
              كل مستخدمي النظام. الدور يحدد الصلاحيات، والفروع المسموحة تحدد أين تطبق هذه الصلاحيات.
            </p>
          </div>
          <UsersTab />
        </div>

      </div>
    </div>
  );
}
