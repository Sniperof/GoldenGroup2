import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useRoleStore } from '../../hooks/useRoleStore';
import type { Role, HrUser } from '../../hooks/useRoleStore';
import {
  ShieldCheck, Plus, Edit2, Trash2, Users, Key,
  ToggleLeft, ToggleRight, X, Save, Loader2, AlertTriangle,
  UserPlus, User, Lock, Eye, EyeOff, ChevronDown
} from 'lucide-react';

// ══════════════════════════════════════════════════════════════════
// Role Modal
// ══════════════════════════════════════════════════════════════════
function RoleModal({ role, onClose }: { role?: Role | null; onClose: () => void }) {
  const { createRole, updateRole } = useRoleStore();
  const [displayName, setDisplayName] = useState(role?.displayName ?? '');
  const [name, setName] = useState(role?.name ?? '');
  const [description, setDescription] = useState(role?.description ?? '');
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
      if (isEdit) await updateRole(role!.id, { displayName, description });
      else await createRole({ name, displayName, description });
      onClose();
    } catch (e: any) { setError(e.message ?? 'حدث خطأ'); }
    finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between p-5 border-b border-slate-100">
          <h2 className="text-base font-bold text-slate-800">{isEdit ? 'تعديل الدور' : 'إنشاء دور جديد'}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-4">
          {error && <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 rounded-lg p-3"><AlertTriangle className="w-4 h-4 shrink-0" />{error}</div>}
          {!isEdit && (
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">المعرف الداخلي <span className="text-red-500">*</span></label>
              <input value={name} onChange={e => setName(e.target.value.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, ''))}
                placeholder="مثال: branch_manager"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400" />
              <p className="text-[10px] text-slate-400 mt-1">حروف إنجليزية صغيرة وأرقام وشرطة سفلية فقط</p>
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between p-5 border-b border-slate-100">
          <h2 className="text-base font-bold text-slate-800">{isEdit ? 'تعديل بيانات المستخدم' : 'إضافة مستخدم جديد'}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400"><X className="w-4 h-4" /></button>
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
            <div className="relative">
              <select value={roleId} onChange={e => setRoleId(e.target.value ? Number(e.target.value) : '')}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400 appearance-none bg-white">
                <option value="">— اختر دوراً —</option>
                {activeRoles.map(r => <option key={r.id} value={r.id}>{r.displayName}</option>)}
              </select>
              <ChevronDown className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
            </div>
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
// Roles Tab
// ══════════════════════════════════════════════════════════════════
function RolesTab() {
  const navigate = useNavigate();
  const { roles, loading, error, fetchRoles, updateRole, deleteRole } = useRoleStore();
  const [showModal, setShowModal] = useState(false);
  const [editRole, setEditRole] = useState<Role | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);

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
                    <h3 className="font-bold text-slate-800 text-sm">{role.displayName}</h3>
                    {role.isSystem && (
                      <span className="text-[10px] bg-amber-50 text-amber-600 border border-amber-200 rounded-full px-2 py-0.5 font-medium">نظام</span>
                    )}
                    <span className={`text-[10px] rounded-full px-2 py-0.5 font-medium border ${role.isActive ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : 'bg-slate-50 text-slate-400 border-slate-200'}`}>
                      {role.isActive ? 'نشط' : 'معطّل'}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-0.5 font-mono">{role.name}</p>
                  {role.description && <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">{role.description}</p>}
                </div>
                {!role.isSystem && (
                  <button onClick={() => handleToggleActive(role)} className="text-slate-400 hover:text-sky-500 transition-colors mt-0.5" title={role.isActive ? 'تعطيل' : 'تفعيل'}>
                    {role.isActive ? <ToggleRight className="w-6 h-6 text-emerald-500" /> : <ToggleLeft className="w-6 h-6" />}
                  </button>
                )}
              </div>

              <div className="flex items-center gap-4 text-xs text-slate-500">
                <div className="flex items-center gap-1.5"><Users className="w-3.5 h-3.5" /><span>{role.userCount} مستخدم</span></div>
                <div className="flex items-center gap-1.5"><Key className="w-3.5 h-3.5" /><span>{role.permissionCount} صلاحية</span></div>
              </div>

              <div className="flex gap-2 pt-1 border-t border-slate-50">
                <button onClick={() => navigate(`/admin/roles/${role.id}/permissions`)}
                  className="flex-1 flex items-center justify-center gap-1.5 text-xs font-semibold text-sky-600 bg-sky-50 hover:bg-sky-100 py-2 rounded-lg transition-colors">
                  <Key className="w-3.5 h-3.5" />إدارة الصلاحيات
                </button>
                {!role.isSystem && (
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

      {showModal && <RoleModal role={editRole} onClose={() => { setShowModal(false); setEditRole(null); }} />}
    </>
  );
}

// ══════════════════════════════════════════════════════════════════
// Users Tab
// ══════════════════════════════════════════════════════════════════
function UsersTab() {
  const { roles, hrUsers, loading, fetchRoles, fetchHrUsers, updateHrUser } = useRoleStore();
  const [showModal, setShowModal] = useState(false);
  const [editUser, setEditUser] = useState<HrUser | null>(null);
  const [togglingId, setTogglingId] = useState<number | null>(null);

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
        <button onClick={() => { setEditUser(null); setShowModal(true); }}
          className="flex items-center gap-2 bg-sky-500 hover:bg-sky-600 text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors shadow-sm">
          <UserPlus className="w-4 h-4" />مستخدم جديد
        </button>
      </div>

      {loading && <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-sky-400" /></div>}

      {!loading && (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
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
                        ) : (
                          <span className="text-xs text-slate-400 italic">بدون دور</span>
                        )}
                      </td>
                      <td className="px-5 py-3.5">
                        <span className={`text-[10px] font-medium px-2 py-1 rounded-full border ${user.isActive ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : 'bg-red-50 text-red-500 border-red-200'}`}>
                          {user.isActive ? 'نشط' : 'موقوف'}
                        </span>
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-1 justify-end">
                          <button onClick={() => handleToggle(user)} disabled={togglingId === user.id}
                            title={user.isActive ? 'إيقاف الحساب' : 'تفعيل الحساب'}
                            className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 transition-colors disabled:opacity-50">
                            {togglingId === user.id ? <Loader2 className="w-4 h-4 animate-spin" /> :
                              user.isActive ? <ToggleRight className="w-4 h-4 text-emerald-500" /> : <ToggleLeft className="w-4 h-4" />}
                          </button>
                          <button onClick={() => { setEditUser(user); setShowModal(true); }}
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
        </div>
      )}

      {showModal && (
        <UserModal
          user={editUser}
          roles={roles}
          onClose={() => { setShowModal(false); setEditUser(null); }}
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

  return (
    <div className="h-full overflow-y-auto bg-slate-50">
      <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">

        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-sky-500 flex items-center justify-center shadow-lg shadow-sky-500/30">
            <ShieldCheck className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-800">{"\u0627\u0644\u0623\u062f\u0648\u0627\u0631 \u0648\u0627\u0644\u0635\u0644\u0627\u062d\u064a\u0627\u062a"}</h1>
            <p className="text-xs text-slate-500">{"\u0625\u062f\u0627\u0631\u0629 \u0623\u062f\u0648\u0627\u0631 \u0627\u0644\u0646\u0638\u0627\u0645 \u0648\u0635\u0644\u0627\u062d\u064a\u0627\u062a\u0647\u0627\u060c \u0645\u0639 \u0625\u0633\u0646\u0627\u062f \u0627\u0644\u062f\u0648\u0631 \u0644\u0644\u0645\u0633\u062a\u062e\u062f\u0645 \u0645\u0646 \u0645\u0644\u0641 \u0627\u0644\u0645\u0648\u0638\u0641 \u0645\u0628\u0627\u0634\u0631\u0629"}</p>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-5 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-sky-50 border border-sky-100 text-sky-600 flex items-center justify-center shrink-0">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-800">{"\u0625\u0633\u0646\u0627\u062f \u0627\u0644\u0623\u062f\u0648\u0627\u0631 \u064a\u062a\u0645 \u0645\u0646 \u0645\u0644\u0641 \u0627\u0644\u0645\u0648\u0638\u0641"}</h2>
              <p className="text-sm text-slate-500 mt-1 leading-relaxed">
                {"\u0628\u062f\u0644 \u0625\u062f\u0627\u0631\u0629 \u0627\u0644\u0645\u0633\u062a\u062e\u062f\u0645\u064a\u0646 \u0645\u0646 \u062c\u062f\u0648\u0644 \u0645\u0646\u0641\u0635\u0644\u060c \u0627\u0641\u062a\u062d \u0633\u062c\u0644 \u0627\u0644\u0645\u0648\u0638\u0641 \u0648\u062d\u062f\u062f \u0644\u0647 \u062d\u0633\u0627\u0628 \u0627\u0644\u0646\u0638\u0627\u0645 \u0648\u0627\u0644\u062f\u0648\u0631 \u0627\u0644\u0625\u062f\u0627\u0631\u064a \u0645\u0646 \u0646\u0641\u0633 \u0627\u0644\u0635\u0641\u062d\u0629."}
              </p>
            </div>
          </div>
          <button
            onClick={() => navigate('/employees')}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-sky-500 hover:bg-sky-600 text-white rounded-xl text-sm font-semibold transition-colors"
          >
            <Users className="w-4 h-4" />
            {"\u0633\u062c\u0644\u0627\u062a \u0627\u0644\u0645\u0648\u0638\u0641\u064a\u0646"}
          </button>
        </div>

        <RolesTab />
      </div>
    </div>
  );
}
