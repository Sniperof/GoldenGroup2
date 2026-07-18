// ============================================================
// ClientAppAccountCard — app-account status + actions on a client's detail page
// DEC-013 §2.5.10 — direct create / suspend / reactivate from the client record
// ============================================================
import { useCallback, useEffect, useState } from 'react';
import { Smartphone, Loader2, UserCheck, PauseCircle, PlayCircle } from 'lucide-react';
import { api } from '../../lib/api';
import { usePermissions } from '../../hooks/usePermissions';

const STATUS_LABEL: Record<string, string> = { active: 'مفعّل', suspended: 'موقوف' };
const STATUS_COLOR: Record<string, string> = {
  active: 'bg-green-100 text-green-700',
  suspended: 'bg-amber-100 text-amber-700',
};
const SOURCE_LABEL: Record<string, string> = {
  account_creation: 'بطلب الزبون',
  admin: 'إنشاء مباشر',
  admin_bulk: 'تفعيل جماعي',
  water_test_request: 'طلب فحص مياه',
  device_request: 'طلب جهاز',
  maintenance_request: 'طلب صيانة',
  referral_request: 'إحالة',
  golden_warranty_request: 'كفالة ذهبية',
};

export default function ClientAppAccountCard({ clientId }: { clientId: number }) {
  const { hasPermission } = usePermissions();
  const canView = hasPermission('app_accounts.view');
  const canCreate = hasPermission('app_accounts.create_direct');
  const canSuspend = hasPermission('app_accounts.suspend');
  const canReactivate = hasPermission('app_accounts.reactivate');

  const [account, setAccount] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.appAccounts.forClient(clientId);
      setAccount(res.account);
    } catch {
      setAccount(null);
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    if (canView) load();
    else setLoading(false);
  }, [canView, load]);

  if (!canView) return null;

  async function act(fn: () => Promise<any>, okMsg: string) {
    setBusy(true);
    try {
      await fn();
      await load();
      alert(okMsg);
    } catch (e: any) {
      alert(e?.message ?? 'فشل تنفيذ الإجراء');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <Smartphone className="h-5 w-5 text-blue-600" />
        <h3 className="text-sm font-bold text-slate-800">حساب التطبيق</h3>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-4 text-slate-400">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : account ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-500">الحالة</span>
            <span className={`text-xs px-2 py-0.5 rounded ${STATUS_COLOR[account.status] ?? ''}`}>
              {STATUS_LABEL[account.status] ?? account.status}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-500">رقم الدخول</span>
            <span className="text-sm font-mono text-slate-800" dir="ltr">{account.primary_mobile}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-500">مصدر الإنشاء</span>
            <span className="text-sm text-slate-700">{SOURCE_LABEL[account.created_source] ?? account.created_source}</span>
          </div>
          {account.status === 'suspended' && account.suspended_reason && (
            <div className="text-xs text-amber-700 bg-amber-50 rounded p-2">سبب الإيقاف: {account.suspended_reason}</div>
          )}

          <div className="flex gap-2 pt-1">
            {account.status === 'active' && canSuspend && (
              <button
                disabled={busy}
                onClick={() => {
                  const reason = prompt('سبب إيقاف الحساب:');
                  if (reason && reason.trim()) act(() => api.appAccounts.suspend(account.id, reason.trim()), 'تم إيقاف الحساب');
                }}
                className="text-xs bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-white px-3 py-1.5 rounded flex items-center gap-1"
              >
                <PauseCircle className="h-4 w-4" /> إيقاف
              </button>
            )}
            {account.status === 'suspended' && canReactivate && (
              <button
                disabled={busy}
                onClick={() => act(() => api.appAccounts.reactivate(account.id), 'تم إعادة تفعيل الحساب')}
                className="text-xs bg-green-600 hover:bg-green-700 disabled:opacity-40 text-white px-3 py-1.5 rounded flex items-center gap-1"
              >
                <PlayCircle className="h-4 w-4" /> إعادة تفعيل
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-slate-500">لا يوجد حساب تطبيق مرتبط بهذا الزبون.</p>
          {canCreate && (
            <button
              disabled={busy}
              onClick={() => {
                if (confirm('إنشاء وتفعيل حساب تطبيق مباشر لهذا الزبون باستخدام رقمه الرئيسي؟')) {
                  act(() => api.appAccounts.createDirect(clientId), 'تم إنشاء الحساب وتفعيله');
                }
              }}
              className="text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white px-4 py-2 rounded flex items-center gap-1.5"
            >
              <UserCheck className="h-4 w-4" /> تفعيل حساب مباشر
            </button>
          )}
        </div>
      )}
    </div>
  );
}
