// ============================================================
// GoldenWarrantyCardDeliveryModal — routine VIP-card handover.
// Constitution: 02b §13.6 + DEC-CT-17.
//
// Hands the customer the VIP card proving golden-warranty enrolment. Activates
// nothing (warranty is already effective from the offer receipt); just stamps the
// delivery task. Calls POST /device-warranties/golden/:warrantyId/card-delivery.
// ============================================================
import { useEffect, useState } from 'react';
import { CreditCard, Loader2, X } from 'lucide-react';
import { api } from '../../lib/api';

export default function GoldenWarrantyCardDeliveryModal({
  taskId,
  deviceId,
  onClose,
  onSaved,
}: {
  taskId: number;
  deviceId?: number | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [warranty, setWarranty] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!deviceId) { setLoading(false); return; }
    api.deviceWarranties.list(Number(deviceId))
      .then((ws: any[]) => {
        const golden = Array.isArray(ws)
          ? ws.find((w) => w.warrantyType === 'golden' && w.status === 'active')
          : null;
        setWarranty(golden ?? null);
      })
      .catch(() => setWarranty(null))
      .finally(() => setLoading(false));
  }, [deviceId]);

  async function submit() {
    if (!warranty) { setError('لا توجد كفالة ذهبية فعّالة على هذا الجهاز'); return; }
    setError(null);
    setSaving(true);
    try {
      await api.deviceWarranties.cardDelivery(warranty.id, { taskId });
      onSaved();
    } catch (err: any) {
      setError(err?.message ?? 'فشل تسجيل تسليم الكرت');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" dir="rtl">
      <div className="w-full max-w-lg rounded-xl border border-amber-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-amber-200 bg-amber-50 px-5 py-4">
          <div className="flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-amber-600" />
            <h2 className="text-base font-black text-amber-900">تسليم كرت الكفالة الذهبية — مهمة #{taskId}</h2>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-white hover:text-slate-700">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-5">
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-amber-500" /></div>
          ) : (
            <>
              {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
              {warranty ? (
                <div className="rounded-lg border border-amber-100 bg-amber-50/50 p-4 text-sm text-amber-900 space-y-1">
                  <p className="font-bold">كفالة ذهبية فعّالة</p>
                  <p>من {warranty.startDate ?? '—'} حتى {warranty.endDate ?? '—'}</p>
                  {warranty.cardDeliveryTaskId && (
                    <p className="text-xs text-amber-700">سبق تسجيل تسليم كرت لهذه الكفالة — سيُحدَّث المرجع.</p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-slate-500">لا توجد كفالة ذهبية فعّالة على هذا الجهاز.</p>
              )}
              <p className="text-xs text-slate-500">
                تسليم الكرت إجراء روتيني يُثبت تسلّم الزبون للكفالة ولا يغيّر سريانها.
              </p>
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4">
          <button onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50">
            إلغاء
          </button>
          <button onClick={submit} disabled={saving || !warranty}
            className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-bold text-white hover:bg-amber-500 disabled:opacity-60">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            تأكيد تسليم الكرت
          </button>
        </div>
      </div>
    </div>
  );
}
