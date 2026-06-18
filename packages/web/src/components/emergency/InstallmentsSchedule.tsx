import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import Button from '../ui/Button';
import Input from '../ui/Input';

export interface Installment {
  installmentNumber: number;
  dueDate: string;
  amountSyp: string;
  dueId?: number | null;   // set once confirmed + linked to dues
  status?: string;
}

interface Props {
  installableAmount: number;  // grand_total - first_payment
  initialInstallments?: Installment[];
  confirmed: boolean;
  onSave: (installments: Installment[], count: number) => Promise<void>;
  onConfirm: (rows: Installment[]) => Promise<void>;
  disabled?: boolean;
}

const inp = "w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:border-rose-400 focus:ring-2 focus:ring-rose-400/20 bg-white";

function addMonths(dateStr: string, months: number): string {
  const d = new Date(dateStr || Date.now());
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

function generate(count: number, total: number, startDate: string): Installment[] {
  if (count <= 0 || total <= 0) return [];
  const base   = Math.floor(total / count);
  const rest   = total - base * (count - 1);
  return Array.from({ length: count }, (_, i) => ({
    installmentNumber: i + 1,
    dueDate:    addMonths(startDate, i + 1),
    amountSyp:  String(i === count - 1 ? rest : base),
  }));
}

export default function InstallmentsSchedule({
  installableAmount, initialInstallments, confirmed, onSave, onConfirm, disabled,
}: Props) {
  const [count, setCount]               = useState(String(initialInstallments?.length || 3));
  const [rows, setRows]                 = useState<Installment[]>(initialInstallments ?? []);
  const [saving, setSaving]             = useState(false);
  const [confirming, setConfirming]     = useState(false);
  const [error, setError]               = useState('');

  // Auto-generate when count changes (only if not confirmed)
  const handleGenerate = () => {
    const n = Number(count);
    if (!n || n < 1) return;
    const today = new Date().toISOString().slice(0, 10);
    setRows(generate(n, installableAmount, today));
    setError('');
  };

  useEffect(() => {
    if (!initialInstallments?.length && installableAmount > 0 && Number(count) > 0) {
      handleGenerate();
    }
  }, []);

  const updateRow = (idx: number, field: 'dueDate' | 'amountSyp', val: string) => {
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, [field]: val } : r));
    setError('');
  };

  const totalEntered = rows.reduce((s, r) => s + (Number(r.amountSyp) || 0), 0);
  const diff         = totalEntered - installableAmount;
  const balanced     = Math.abs(diff) <= 1;

  const handleSave = async () => {
    setSaving(true); setError('');
    try { await onSave(rows, Number(count) || rows.length); }
    catch (e: any) { setError(e.message); }
    finally { setSaving(false); }
  };

  const handleConfirm = async () => {
    if (!balanced) { setError('يجب تعديل القيم حتى يتوازن المجموع أولاً'); return; }
    setConfirming(true); setError('');
    try { await onConfirm(rows); }
    catch (e: any) { setError(e.message); }
    finally { setConfirming(false); }
  };

  if (confirmed) {
    return (
      <div className="rounded-2xl border-2 border-emerald-200 bg-emerald-50/40 p-4">
        <div className="flex items-center gap-2 text-emerald-700 font-bold text-sm mb-3">
          <CheckCircle2 className="h-4 w-4" />
          جدول الأقساط مُعتمد — تم إنشاء الاستحقاقات
        </div>
        <div className="space-y-1.5">
          {rows.map(r => (
            <div key={r.installmentNumber}
              className="flex items-center justify-between rounded-xl border border-emerald-100 bg-white px-3 py-2 text-xs">
              <div className="flex items-center gap-2">
                <span className="font-black text-emerald-600 w-5 text-center">{r.installmentNumber}</span>
                <span className="text-slate-500">{new Date(r.dueDate).toLocaleDateString('ar-SY')}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-black text-slate-800">{Number(r.amountSyp).toLocaleString('ar-SY')} ل.س</span>
                {r.dueId && <span className="text-[9px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 rounded px-1.5 py-0.5">استحقاق #{r.dueId}</span>}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* توليد الجدول */}
      {!disabled && (
        <div className="flex items-center gap-2">
          <label className="text-xs font-bold text-slate-600 shrink-0">عدد الأقساط</label>
          <Input type="number" min={1} max={60} value={count}
            onChange={e => setCount(e.target.value)}
            inputSize="sm"
            fullWidth={false}
            className="w-20 text-center font-bold" />
          <Button variant="secondary" size="sm" onClick={handleGenerate}>
            توليد تلقائي
          </Button>
          <span className="text-xs text-slate-400">
            كل {Math.ceil(installableAmount / (Number(count) || 1)).toLocaleString('ar-SY')} ل.س / شهر
          </span>
        </div>
      )}

      {/* جدول الأقساط */}
      {rows.length > 0 && (
        <div className="rounded-2xl border border-slate-200 overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100">
                <th className="px-3 py-2 text-right font-bold text-slate-500 w-8">#</th>
                <th className="px-3 py-2 text-right font-bold text-slate-500">تاريخ الاستحقاق</th>
                <th className="px-3 py-2 text-right font-bold text-slate-500">المبلغ (ل.س)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => (
                <tr key={r.installmentNumber} className="border-b border-slate-50">
                  <td className="px-3 py-2 font-black text-slate-400">{r.installmentNumber}</td>
                  <td className="px-2 py-1.5">
                    <input type="date" value={r.dueDate}
                      onChange={e => updateRow(idx, 'dueDate', e.target.value)}
                      disabled={disabled}
                      className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs focus:outline-none focus:border-rose-400 bg-white" />
                  </td>
                  <td className="px-2 py-1.5">
                    <Input type="number" min={0} value={r.amountSyp}
                      onChange={e => updateRow(idx, 'amountSyp', e.target.value)}
                      disabled={disabled}
                      inputSize="sm"
                      className="text-left font-bold" dir="ltr" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* شريط التحقق */}
          <div className={`flex items-center justify-between px-4 py-2.5 border-t-2 text-xs font-bold ${
            balanced
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
              : 'border-amber-200 bg-amber-50 text-amber-700'
          }`}>
            <span>
              {balanced
                ? `✓ المجموع متوازن — ${totalEntered.toLocaleString('ar-SY')} ل.س`
                : `المجموع: ${totalEntered.toLocaleString('ar-SY')} / المطلوب: ${installableAmount.toLocaleString('ar-SY')} ل.س`}
            </span>
            {!balanced && (
              <span className="text-[10px]">
                فرق: {Math.abs(diff).toLocaleString('ar-SY')} ل.س ({diff > 0 ? 'زيادة' : 'نقص'})
              </span>
            )}
          </div>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />{error}
        </div>
      )}

      {/* أزرار */}
      {!disabled && rows.length > 0 && (
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={handleSave} loading={saving} className="flex-1">
            حفظ مسودة
          </Button>
          <Button
            size="sm"
            icon={CheckCircle2}
            onClick={handleConfirm}
            disabled={!balanced}
            loading={confirming}
            className="flex-1"
          >
            اعتماد الجدول وإنشاء الاستحقاقات
          </Button>
        </div>
      )}
    </div>
  );
}
