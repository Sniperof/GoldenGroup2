import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { User, UserPlus, ShieldCheck, Edit2, Building2, ToggleLeft, ToggleRight, Loader2 } from 'lucide-react';
import { useRoleStore } from '../../hooks/useRoleStore';
import type { HrUser } from '../../hooks/useRoleStore';
import { usePermissions } from '../../hooks/usePermissions';
import { useAuthStore } from '../../hooks/useAuthStore';
import { useBranchContextStore } from '../../hooks/useBranchContextStore';
import BranchScopeIndicator from '../../components/BranchScopeIndicator';
import PageHeader from '../../components/ui/PageHeader';
import Button from '../../components/ui/Button';
import SmartTable from '../../components/SmartTable';
import type { ColumnDef } from '../../components/SmartTable';
import { UserModal, UserBranchAssignmentsModal } from './Roles';

/**
 * Standalone Users page (split out of the combined Roles & Users admin page).
 * Records-section treatment (branch-scope standard): GLOBAL sees all users, BRANCH
 * sees its branch's users; the external branch filter narrows the list. Creating a
 * user is BRANCH-level only — the add button is disabled until a specific branch is
 * picked (the server pins the new user to that branch). Roles stay GLOBAL-only.
 */
export default function Users() {
  const { roles, hrUsers, loading, fetchRoles, fetchHrUsers, updateHrUser } = useRoleStore();
  const { hasPermission } = usePermissions();
  const getPermissionScope = useAuthStore(s => s.getPermissionScope);
  const branchContextId = useBranchContextStore(s => s.branchId);

  const [showModal, setShowModal] = useState(false);
  const [editUser, setEditUser] = useState<HrUser | null>(null);
  const [branchUser, setBranchUser] = useState<HrUser | null>(null);
  const [togglingId, setTogglingId] = useState<number | null>(null);

  const canView = hasPermission('admin.users.view_list');
  const canManageRoleUsers = hasPermission('admin.roles.users.manage');
  const canViewBranchAssignments = hasPermission('users.branch_assignments.view');
  const canManageBranchAssignments = hasPermission('users.branch_assignments.manage');

  // Add rule (§5): a GLOBAL operator on "all branches" has no branch to own the new
  // user, so creation is blocked until a branch is picked (the server requires it too).
  const isGlobalView = getPermissionScope('admin.users.view_list') === 'GLOBAL';
  const mustPickBranch = isGlobalView && branchContextId == null;

  useEffect(() => { fetchRoles(); }, [fetchRoles]);
  // Re-fetch when the external branch filter changes (server narrows via X-Branch-Id).
  useEffect(() => { fetchHrUsers(); }, [fetchHrUsers, branchContextId]);

  if (!canView) {
    return <Navigate to="/" replace />;
  }

  async function handleToggle(user: HrUser) {
    setTogglingId(user.id);
    try { await updateHrUser(user.id, { isActive: !user.isActive }); }
    finally { setTogglingId(null); }
  }

  const roleMap = Object.fromEntries(roles.map(r => [r.id, r]));

  const columns: ColumnDef<HrUser>[] = [
    {
      key: 'name', label: 'المستخدم', sortable: true,
      render: (user) => (
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-sky-100 flex items-center justify-center shrink-0">
            <User className="w-4 h-4 text-sky-600" />
          </div>
          <span className="font-semibold text-slate-800">{user.name}</span>
        </div>
      ),
    },
    {
      key: 'username', label: 'اسم الدخول', sortable: true,
      render: (user) => <span className="text-slate-500 font-mono text-xs">{user.username}</span>,
    },
    {
      key: 'role', label: 'الدور', sortable: true,
      getValue: (user) => {
        const role = user.roleId ? roleMap[user.roleId] : null;
        return role?.displayName || user.roleDisplayName || '';
      },
      render: (user) => {
        const role = user.roleId ? roleMap[user.roleId] : null;
        const readOnlySystemRoleName = !role && user.roleDisplayName ? user.roleDisplayName : null;
        if (role) return (
          <span className="inline-flex items-center gap-1 text-xs bg-sky-50 text-sky-700 border border-sky-100 rounded-full px-2.5 py-1 font-medium">
            <ShieldCheck className="w-3 h-3" />{role.displayName}
          </span>
        );
        if (readOnlySystemRoleName) return (
          <span className="inline-flex items-center gap-1 text-xs bg-amber-50 text-amber-700 border border-amber-200 rounded-full px-2.5 py-1 font-medium">
            <ShieldCheck className="w-3 h-3" />{readOnlySystemRoleName}
          </span>
        );
        return <span className="text-xs text-slate-400 italic">بدون دور</span>;
      },
    },
    {
      key: 'branchName', label: 'الفرع', sortable: true,
      getValue: (user) => user.branchName || '',
      render: (user) => user.branchName
        ? <span className="inline-flex items-center gap-1 text-xs bg-slate-50 text-slate-600 border border-slate-200 rounded-full px-2.5 py-1 font-medium"><Building2 className="w-3 h-3" />{user.branchName}</span>
        : <span className="text-xs text-slate-400 italic">—</span>,
    },
    {
      key: 'isActive', label: 'الحالة', sortable: true,
      getValue: (user) => (user.isActive ? 1 : 0),
      render: (user) => (
        <span className={`text-xs font-medium px-2 py-1 rounded-full border ${user.isActive ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : 'bg-red-50 text-red-500 border-red-200'}`}>
          {user.isActive ? 'نشط' : 'موقوف'}
        </span>
      ),
    },
  ];

  return (
    <div className="h-full overflow-y-auto bg-slate-50">
      <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">

        {/* Header */}
        <PageHeader
          title="المستخدمون"
          subtitle="حسابات النظام ضمن نطاقك. الإضافة تتم على مستوى فرع محدد."
          icon={
            <div className="w-10 h-10 rounded-xl bg-sky-500 flex items-center justify-center shadow-lg shadow-sky-500/30">
              <User className="w-5 h-5 text-white" />
            </div>
          }
          actions={canManageRoleUsers && (
            <Button
              icon={UserPlus}
              onClick={() => { setEditUser(null); setShowModal(true); }}
              disabled={mustPickBranch}
              title={mustPickBranch ? 'اختر فرعاً أولاً لإضافة مستخدم' : undefined}
            >
              {mustPickBranch ? 'اختر فرعاً لإضافة مستخدم' : 'مستخدم جديد'}
            </Button>
          )}
        >
          <BranchScopeIndicator />
        </PageHeader>

        {loading && <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-sky-400" /></div>}

        {!loading && (
          <SmartTable<HrUser>
            title="قائمة المستخدمين"
            icon={User}
            data={hrUsers}
            columns={columns}
            getId={(u) => u.id}
            searchKeys={['name', 'username', 'branchName']}
            searchPlaceholder="بحث بالاسم أو اسم الدخول أو الفرع..."
            filters={[
              { key: 'isActive', label: 'كل الحالات', options: [
                { value: 'true', label: 'نشط' },
                { value: 'false', label: 'موقوف' },
              ] },
            ]}
            defaultSortKey="name"
            defaultSortDir="asc"
            emptyIcon={User}
            emptyMessage="لا يوجد مستخدمون ضمن هذا النطاق"
            actions={(user) => (
              <div className="flex items-center gap-1 justify-end">
                {canViewBranchAssignments && (
                  <button onClick={() => setBranchUser(user)} className="p-1.5 rounded-lg text-slate-400 hover:bg-sky-50 hover:text-sky-600 transition-colors" title="الفروع المسموحة">
                    <Building2 className="w-4 h-4" />
                  </button>
                )}
                <button onClick={() => handleToggle(user)} disabled={!canManageRoleUsers || togglingId === user.id}
                  title={user.isActive ? 'إيقاف الحساب' : 'تفعيل الحساب'}
                  className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 transition-colors disabled:opacity-50">
                  {togglingId === user.id ? <Loader2 className="w-4 h-4 animate-spin" /> :
                    user.isActive ? <ToggleRight className="w-4 h-4 text-emerald-500" /> : <ToggleLeft className="w-4 h-4" />}
                </button>
                <button onClick={() => { setEditUser(user); setShowModal(true); }} disabled={!canManageRoleUsers}
                  className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors" title="تعديل">
                  <Edit2 className="w-4 h-4" />
                </button>
              </div>
            )}
          />
        )}

        {showModal && canManageRoleUsers && (
          <UserModal user={editUser} roles={roles} onClose={() => { setShowModal(false); setEditUser(null); }} />
        )}
        {branchUser && (
          <UserBranchAssignmentsModal user={branchUser} readOnly={!canManageBranchAssignments} onClose={() => setBranchUser(null)} />
        )}
      </div>
    </div>
  );
}
