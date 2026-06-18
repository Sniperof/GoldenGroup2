// DEC-CT-01/11/13/14: the contract that originated this device.
// We surface only the legal/commercial header — the deep contract view
// remains accessible via the "صفحة العقد" link.

import { useState } from 'react';
import { ExternalLink, FileText, Loader2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../../../lib/api';
import { SectionShell } from './SectionShell';
import Button from '../../../components/ui/Button';

interface Props {
  contract: any | null;
  /**
   * Kept for backwards compatibility but no longer used: the printable HTML
   * is now fetched through the authenticated `api.contracts.getPrintableHtml`
   * helper and opened as a Blob URL (DEC-CT-14/15).
   */
  apiBase?: string;
}

const CONTRACT_STATUS_LABEL: Record<string, { cls: string; label: string }> = {
  draft:     { cls: 'bg-amber-100 text-amber-700',    label: 'مسودة' },
  active:    { cls: 'bg-emerald-100 text-emerald-700', label: 'نشط' },
  completed: { cls: 'bg-sky-100 text-sky-700',        label: 'مكتمل' },
  cancelled: { cls: 'bg-rose-100 text-rose-700',      label: 'ملغى' },
  discarded: { cls: 'bg-slate-100 text-slate-500',    label: 'مرفوض' },
};

function fmt(d?: string | null) {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('ar-SY'); } catch { return d; }
}

export function LinkedContractSection({ contract }: Props) {
  const [printLoading, setPrintLoading] = useState(false);

  const openPrintable = async () => {
    if (!contract) return;
    setPrintLoading(true);
    let url: string | null = null;
    try {
      const html = await api.contracts.getPrintableHtml(contract.id);
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      url = URL.createObjectURL(blob);
      const win = window.open(url, '_blank', 'noopener,noreferrer');
      // Revoke the URL after the new tab has had a chance to load it.
      // 30s is generous; the browser holds a reference once the document loads.
      if (win) setTimeout(() => url && URL.revokeObjectURL(url), 30_000);
      else {
        URL.revokeObjectURL(url);
        alert('تعذر فتح نافذة جديدة. تأكد من السماح للنوافذ المنبثقة.');
      }
    } catch (err: any) {
      if (url) URL.revokeObjectURL(url);
      alert(err?.message ?? 'تعذر تحميل النسخة القانونية');
    } finally {
      setPrintLoading(false);
    }
  };

  if (!contract) {
    return (
      <SectionShell id="contract" title="العقد المرتبط">
        <p className="text-xs text-slate-400 italic">لا يوجد عقد مرتبط بهذا الجهاز.</p>
      </SectionShell>
    );
  }
  const st = CONTRACT_STATUS_LABEL[contract.status] ?? { cls: 'bg-slate-100 text-slate-600', label: contract.status };

  return (
    <SectionShell
      id="contract"
      title="العقد المرتبط"
      subtitle={`عقد رقم #${contract.contractNumber}`}
      actions={
        <>
          <Button
            variant="secondary"
            size="sm"
            icon={FileText}
            onClick={openPrintable}
            loading={printLoading}
          >
            النسخة القانونية
          </Button>
          <Link
            to={`/contracts/${contract.id}`}
            className="inline-flex items-center gap-1 bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold rounded-xl px-3 py-2"
          >
            <ExternalLink className="w-3.5 h-3.5" /> صفحة العقد
          </Link>
        </>
      }
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-5 text-sm">
        <div>
          <div className="text-[11px] text-slate-400 font-bold mb-1">الحالة</div>
          <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${st.cls}`}>{st.label}</span>
        </div>
        <div>
          <div className="text-[11px] text-slate-400 font-bold mb-1">تاريخ العقد</div>
          <div className="font-semibold text-slate-700">{fmt(contract.contractDate)}</div>
        </div>
        <div>
          <div className="text-[11px] text-slate-400 font-bold mb-1">طريقة الدفع</div>
          <div className="font-semibold text-slate-700">{contract.paymentType === 'cash' ? 'دفعة واحدة' : 'أقساط'}</div>
        </div>
        <div>
          <div className="text-[11px] text-slate-400 font-bold mb-1">القيمة النهائية</div>
          <div className="font-semibold text-slate-700">
            {Number(contract.finalPrice || 0).toLocaleString('ar-SY', { numberingSystem: 'latn' })} ل.س
          </div>
        </div>
        <div>
          <div className="text-[11px] text-slate-400 font-bold mb-1">موظف الإغلاق</div>
          <div className="font-semibold text-slate-700">{contract.closingEmployeeName ?? '—'}</div>
        </div>
        <div>
          <div className="text-[11px] text-slate-400 font-bold mb-1">صاحب البيعة</div>
          <div className="font-semibold text-slate-700">{contract.saleOwnerId ?? '—'}</div>
        </div>
        <div>
          <div className="text-[11px] text-slate-400 font-bold mb-1">مصدر البيع</div>
          <div className="font-semibold text-slate-700">{contract.saleSource ?? '—'}</div>
        </div>
        <div>
          <div className="text-[11px] text-slate-400 font-bold mb-1">نوع البيع</div>
          <div className="font-semibold text-slate-700">{contract.saleSubtype ?? '—'}</div>
        </div>
      </div>
    </SectionShell>
  );
}

export default LinkedContractSection;
