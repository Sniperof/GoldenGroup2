// ============================================================
// BulkActivateModal — reviewed bulk app-account activation for
// either explicitly selected clients or the current filtered set.
// ============================================================
import { useMemo, useState } from 'react';
import { X, Loader2, Users, CheckCircle2, AlertTriangle } from 'lucide-react';
import { api } from '../../lib/api';

interface BulkActivationClient {
  id: number;
  name: string;
  mobile: string | null;
}

function apiErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return 'فشل التفعيل الجماعي';
  const match = error.message.match(/^API Error \d+: ([\s\S]+)$/);
  if (!match) return error.message || 'فشل التفعيل الجماعي';
  try {
    const payload = JSON.parse(match[1]);
    return payload?.error || error.message;
  } catch {
    return error.message;
  }
}

export default function BulkActivateModal({
  open,
  onClose,
  scope,
  clients,
}: {
  open: boolean;
  onClose: () => void;
  scope: 'filtered' | 'selected';
  clients: BulkActivationClient[];
}) {
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<any | null>(null);
  const clientsById = useMemo(
    () => new Map(clients.map((client) => [client.id, client])),
    [clients],
  );

  if (!open) return null;

  async function run() {
    setBusy(true);
    setReport(null);
    try {
      const res = await api.appAccounts.bulkActivate({
        mode: 'ids',
        clientIds: clients.map((client) => client.id),
      });
      setReport(res);
    } catch (error) {
      alert(apiErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  function close() {
    setReport(null);
    onClose();
  }

  function clientLabel(clientId: number, mobile?: string | null) {
    const client = clientsById.get(Number(clientId));
    const name = client?.name || `#${clientId}`;
    const phone = mobile || client?.mobile;
    return phone ? `${name} — ${phone}` : name;
  }

  const scopeLabel = scope === 'selected'
    ? 'الزبائن المحددون يدوياً'
    : 'جميع الزبائن المطابقين للفلاتر الحالية';
  const preview = clients.slice(0, 8);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" dir="rtl">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg">
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
              <div className="rounded-lg border border-sky-100 bg-sky-50 p-3">
                <div className="text-xs font-bold text-sky-700">{scopeLabel}</div>
                <div className="mt-1 text-sm text-slate-700">
                  ستتم محاولة إنشاء حساب تطبيق لـ <b>{clients.length}</b> زبون.
                  الحساب الموجود أو الرقم غير الصالح سيُتخطى ويظهر في التقرير.
                </div>
              </div>

              <div className="max-h-48 overflow-y-auto rounded-lg border border-slate-200">
                {preview.map((client) => (
                  <div key={client.id} className="flex items-center justify-between gap-3 border-b border-slate-100 px-3 py-2 text-xs last:border-b-0">
                    <span className="font-semibold text-slate-700">{client.name}</span>
                    <span className="text-slate-400">{client.mobile || 'رقم غير متوفر'}</span>
                  </div>
                ))}
                {clients.length > preview.length && (
                  <div className="px-3 py-2 text-center text-xs font-semibold text-slate-500">
                    و{clients.length - preview.length} زبون آخر
                  </div>
                )}
              </div>

              <div className="flex gap-2">
                <button
                  onClick={run}
                  disabled={busy || clients.length === 0}
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
                <span className="text-sm font-semibold">اكتملت معالجة دفعة التفعيل</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="bg-slate-50 rounded p-2 flex justify-between"><span className="text-slate-500">مطلوب</span><b>{report.requestedCount ?? clients.length}</b></div>
                <div className="bg-emerald-50 rounded p-2 flex justify-between"><span className="text-emerald-700">أُنشئ</span><b className="text-emerald-700">{report.createdCount}</b></div>
                <div className="bg-amber-50 rounded p-2 flex justify-between"><span className="text-amber-700">له حساب</span><b className="text-amber-700">{report.skippedConflictCount}</b></div>
                <div className="bg-red-50 rounded p-2 flex justify-between"><span className="text-red-700">رقم غير صالح</span><b className="text-red-700">{report.skippedInvalidCount}</b></div>
                <div className="bg-slate-50 rounded p-2 flex justify-between"><span className="text-slate-500">غير موجود</span><b>{report.skippedMissingCount ?? 0}</b></div>
                <div className="bg-rose-50 rounded p-2 flex justify-between"><span className="text-rose-700">فشل تقني</span><b className="text-rose-700">{report.failedCount ?? 0}</b></div>
              </div>

              {(report.skippedConflict?.length > 0 || report.skippedInvalid?.length > 0 || report.skippedMissing?.length > 0 || report.failed?.length > 0) && (
                <div className="max-h-44 overflow-y-auto rounded-lg border border-slate-200 p-3 text-xs space-y-2">
                  {report.skippedConflict?.map((item: any) => (
                    <div key={`conflict-${item.clientId}`} className="text-amber-700">
                      له حساب: {clientLabel(item.clientId, item.mobile)}
                    </div>
                  ))}
                  {report.skippedInvalid?.map((item: any) => (
                    <div key={`invalid-${item.clientId}`} className="text-red-700">
                      رقم غير صالح: {clientLabel(item.clientId)}
                    </div>
                  ))}
                  {report.skippedMissing?.map((clientId: number) => (
                    <div key={`missing-${clientId}`} className="text-slate-600">
                      زبون غير موجود أو محذوف: {clientLabel(clientId)}
                    </div>
                  ))}
                  {report.failed?.map((item: any) => (
                    <div key={`failed-${item.clientId}`} className="text-rose-700">
                      تعذر التفعيل: {clientLabel(item.clientId)}
                    </div>
                  ))}
                </div>
              )}

              {report.truncated && (
                <p className="flex items-start gap-1 text-xs text-amber-700">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  تم بلوغ الحد الأقصى للدفعة (500). ضيّق الفلاتر أو حدد مجموعة أصغر ثم نفّذ مرة أخرى.
                </p>
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
