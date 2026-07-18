// ============================================================
// BulkActivateModal — bulk app-account activation from the clients list
// DEC-013 §2.5.10 — filter (governorate/classification) → partial-success report
// ============================================================
import { useState } from 'react';
import { X, Loader2, Users, CheckCircle2 } from 'lucide-react';
import { api } from '../../lib/api';
import Select from '../ui/Select';

interface GeoLike { id: number; name: string; level: number }

export default function BulkActivateModal({
  open,
  onClose,
  geoUnits,
}: {
  open: boolean;
  onClose: () => void;
  geoUnits: GeoLike[];
}) {
  const [governorate, setGovernorate] = useState('');
  const [classification, setClassification] = useState('');
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<any | null>(null);

  if (!open) return null;

  const govOptions = [
    { value: '', label: 'كل المحافظات' },
    ...geoUnits.filter((g) => g.level === 1).map((g) => ({ value: String(g.id), label: g.name })),
  ];

  async function run() {
    if (!confirm('تنفيذ التفعيل الجماعي للزبائن المطابقين؟ (يُنشأ حساب مفعّل لكل زبون له رقم صالح وبلا حساب مفعّل)')) return;
    setBusy(true);
    setReport(null);
    try {
      const res = await api.appAccounts.bulkActivate({
        mode: 'filter',
        filter: {
          governorate: governorate ? Number(governorate) : undefined,
          classification: classification || undefined,
        },
      });
      setReport(res);
    } catch (e: any) {
      alert(e?.message ?? 'فشل التفعيل الجماعي');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" dir="rtl">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-blue-600" />
            <h3 className="text-sm font-bold text-slate-800">تفعيل حسابات جماعي</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600" aria-label="إغلاق">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {!report ? (
            <>
              <p className="text-sm text-slate-500">
                اختر الفلاتر لتحديد الزبائن. يُفعّل النظام حساباً لكل زبون مطابق له رقم صالح ولا يملك حساباً مفعّلاً؛ ويتخطّى الباقي ويُبلّغ عنه.
              </p>
              <div>
                <label className="text-xs font-semibold text-slate-600 mb-1 block">المحافظة</label>
                <Select value={governorate} onChange={setGovernorate} size="sm" ariaLabel="المحافظة" options={govOptions} />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-600 mb-1 block">التصنيف</label>
                <Select
                  value={classification}
                  onChange={setClassification}
                  size="sm"
                  ariaLabel="التصنيف"
                  options={[
                    { value: '', label: 'كل التصنيفات' },
                    { value: 'OP', label: 'OP (لديه جهاز)' },
                    { value: 'FOP', label: 'FOP' },
                    { value: 'Lead', label: 'Lead (مرشّح)' },
                  ]}
                />
              </div>
              <button
                onClick={run}
                disabled={busy}
                className="w-full text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white px-4 py-2.5 rounded flex items-center justify-center gap-2"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Users className="h-4 w-4" />}
                تنفيذ التفعيل الجماعي
              </button>
            </>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-green-700">
                <CheckCircle2 className="h-5 w-5" />
                <span className="text-sm font-semibold">اكتمل التفعيل الجماعي</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="bg-slate-50 rounded p-2 flex justify-between"><span className="text-slate-500">مطابق</span><b>{report.considered}</b></div>
                <div className="bg-green-50 rounded p-2 flex justify-between"><span className="text-green-700">أُنشئ</span><b className="text-green-700">{report.createdCount}</b></div>
                <div className="bg-amber-50 rounded p-2 flex justify-between"><span className="text-amber-700">له حساب</span><b className="text-amber-700">{report.skippedConflictCount}</b></div>
                <div className="bg-red-50 rounded p-2 flex justify-between"><span className="text-red-700">رقم غير صالح</span><b className="text-red-700">{report.skippedInvalidCount}</b></div>
              </div>
              {report.truncated && (
                <p className="text-xs text-amber-700">تم بلوغ الحد الأقصى للدُّفعة — ضيّق الفلاتر ونفّذ ثانيةً للباقي.</p>
              )}
              <button onClick={onClose} className="w-full text-sm bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-2 rounded">
                إغلاق
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
