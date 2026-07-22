// ============================================================
// BulkActivateModal — bulk app-account activation for the CURRENT filtered set
// DEC-013 §2.5.10 — operates on the clients list's own filters (mode='ids'),
// no custom filters; partial-success report.
// ============================================================
import { useState } from 'react';
import { X, Loader2, Users, CheckCircle2 } from 'lucide-react';
import { api } from '../../lib/api';

export default function BulkActivateModal({
  open,
  onClose,
  clientIds,
}: {
  open: boolean;
  onClose: () => void;
  clientIds: number[];
}) {
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<any | null>(null);

  if (!open) return null;

  async function run() {
    setBusy(true);
    setReport(null);
    try {
      const res = await api.appAccounts.bulkActivate({ mode: 'ids', clientIds });
      setReport(res);
    } catch (e: any) {
      alert(e?.message ?? 'فشل التفعيل الجماعي');
    } finally {
      setBusy(false);
    }
  }

  function close() {
    setReport(null);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" dir="rtl">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-emerald-600" />
            <h3 className="text-sm font-bold text-slate-800">تفعيل حسابات جماعي</h3>
          </div>
          <button onClick={close} className="text-slate-400 hover:text-slate-600" aria-label="إغلاق">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {!report ? (
            <>
              <p className="text-sm text-slate-600">
                سيُفعَّل حساب تطبيق لـ <b className="text-slate-900">{clientIds.length}</b> زبون مطابق للفلاتر الحالية،
                باستخدام رقم كل زبون. يُتخطّى من له حساب مفعّل أو رقم غير صالح ويُبلَّغ عنه.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={run}
                  disabled={busy || clientIds.length === 0}
                  className="flex-1 text-sm bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white px-4 py-2.5 rounded flex items-center justify-center gap-2"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  تنفيذ التفعيل
                </button>
                <button onClick={close} className="text-sm bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-2.5 rounded">
                  إلغاء
                </button>
              </div>
            </>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-emerald-700">
                <CheckCircle2 className="h-5 w-5" />
                <span className="text-sm font-semibold">اكتمل التفعيل الجماعي</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="bg-slate-50 rounded p-2 flex justify-between"><span className="text-slate-500">مطابق</span><b>{report.considered}</b></div>
                <div className="bg-emerald-50 rounded p-2 flex justify-between"><span className="text-emerald-700">أُنشئ</span><b className="text-emerald-700">{report.createdCount}</b></div>
                <div className="bg-amber-50 rounded p-2 flex justify-between"><span className="text-amber-700">له حساب</span><b className="text-amber-700">{report.skippedConflictCount}</b></div>
                <div className="bg-red-50 rounded p-2 flex justify-between"><span className="text-red-700">رقم غير صالح</span><b className="text-red-700">{report.skippedInvalidCount}</b></div>
              </div>
              {report.truncated && (
                <p className="text-xs text-amber-700">تم بلوغ الحد الأقصى للدُّفعة (٥٠٠) — ضيّق الفلاتر ونفّذ ثانيةً للباقي.</p>
              )}
              <button onClick={close} className="w-full text-sm bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-2 rounded">
                إغلاق
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
