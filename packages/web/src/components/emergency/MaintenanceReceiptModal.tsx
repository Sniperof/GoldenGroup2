import { Download, Loader2, MessageCircle, Printer, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

// ── Receipt HTML builder ──────────────────────────────────────────────────────

function buildReceiptHtml(data: ReceiptData): string {
  const {
    taskId, taskDate, clientName, clientPhone, contractRef,
    parts, paymentEntries, transportFee, assemblyFee, discountPct, grandTotal,
    paymentType, totalPaidSyp, finalDecision, decisionLabel, closingEmployeeName,
  } = data;

  const DECISION_COLOR: Record<string, string> = {
    resolved:      '#059669',
    unresolved:    '#dc2626',
    needs_followup:'#7c3aed',
    cancelled:     '#64748b',
  };
  const decisionColor = DECISION_COLOR[finalDecision] ?? '#334155';

  const partsRows = parts.length > 0
    ? parts.map(p => `
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9">${p.partNameSnapshot}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;text-align:center">${p.quantity}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;text-align:left;direction:ltr">${Number(p.unitPrice).toLocaleString('ar-SY')}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;text-align:left;direction:ltr;font-weight:bold">${Number(p.lineTotal).toLocaleString('ar-SY')}</td>
        </tr>`).join('')
    : `<tr><td colspan="4" style="padding:12px;text-align:center;color:#94a3b8">لا توجد قطع مستبدلة</td></tr>`;

  const payLine = (label: string, value: string) =>
    `<div style="display:flex;justify-content:space-between;padding:6px 0;font-size:13px">
       <span style="color:#64748b">${label}</span><strong style="color:#0f172a">${value}</strong>
     </div>`;

  const METHOD_LABELS: Record<string, string> = { hand: 'يد بيد', transfer: 'حوالة', barter: 'مقايضة' };
  const payTypeLabel: Record<string, string> = { cash: 'كاش', installment: 'تقسيط' };

  // Compute discount from actual subtotal (not reverse-engineering from grandTotal)
  const subtotal = parts.reduce((s: number, p: any) => s + Number(p.lineTotal || 0), 0) + transportFee + assemblyFee;
  const discountAmt = discountPct > 0 ? Math.round(subtotal * discountPct / 100) : 0;

  const entryRows = paymentEntries.length > 0
    ? paymentEntries.map((e: any, i: number) => {
        let desc = METHOD_LABELS[e.method] ?? e.method;
        if (e.method === 'transfer' && e.transferCompanyName) desc += ` — ${e.transferCompanyName}`;
        if (e.method === 'barter' && e.barterDescription) desc += ` (${e.barterDescription})`;
        const amtStr = e.currency === 'usd' && e.exchangeRate
          ? `$${Number(e.amountValue).toLocaleString()} × ${Number(e.exchangeRate).toLocaleString()} = ${Number(e.amountSyp).toLocaleString('ar-SY')} ل.س`
          : `${Number(e.amountSyp).toLocaleString('ar-SY')} ل.س`;
        return payLine(`الدفعة ${i + 1} — ${desc}`, amtStr);
      }).join('')
    : payLine('طريقة الدفع', '—');

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <title>وصل صيانة طوارئ #${taskId}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: 'Segoe UI', Arial, sans-serif; margin: 0; padding: 24px; background: #f8fafc; color: #0f172a; }
    .card { max-width: 720px; margin: 0 auto; background: white; border: 1px solid #e2e8f0; border-radius: 18px; overflow: hidden; box-shadow: 0 12px 30px rgba(15,23,42,.09); }
    .header { background: linear-gradient(135deg, #be123c, #9f1239); color: white; padding: 22px 28px; }
    .header h1 { margin: 0 0 4px; font-size: 20px; letter-spacing: -.3px; }
    .header p { margin: 0; opacity: .85; font-size: 12px; }
    .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 20px; padding: 20px 28px; border-bottom: 1px solid #f1f5f9; }
    .meta-item .label { font-size: 11px; color: #94a3b8; font-weight: bold; text-transform: uppercase; letter-spacing: .5px; }
    .meta-item .value { font-size: 14px; font-weight: 700; color: #0f172a; margin-top: 3px; }
    .section { padding: 18px 28px; border-bottom: 1px solid #f1f5f9; }
    .section h2 { margin: 0 0 14px; font-size: 13px; font-weight: 800; color: #334155; text-transform: uppercase; letter-spacing: .5px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    thead th { background: #f8fafc; padding: 9px 12px; text-align: right; font-size: 11px; color: #64748b; font-weight: 700; }
    .cost-line { display: flex; justify-content: space-between; padding: 7px 0; font-size: 13px; border-bottom: 1px dashed #f1f5f9; }
    .cost-line span { color: #64748b; }
    .cost-line strong { color: #0f172a; direction: ltr; }
    .total-line { display: flex; justify-content: space-between; padding: 12px 0 4px; font-size: 16px; font-weight: 900; color: #059669; border-top: 2px solid #d1fae5; margin-top: 6px; }
    .decision-badge { display: inline-flex; align-items:center; padding: 8px 18px; border-radius: 20px; font-size: 14px; font-weight: 900; color: white; background: ${finalDecision ? decisionColor : '#94a3b8'}; }
    .decision-pending { display:inline-block; padding:8px 18px; border-radius:20px; font-size:13px; font-weight:700; color:#94a3b8; border:2px dashed #e2e8f0; }
    .footer { padding: 16px 28px; display: flex; justify-content: space-between; color: #94a3b8; font-size: 11px; }
    .sig-line { border-top: 2px dashed #e2e8f0; margin-top: 10px; padding-top: 8px; text-align: center; font-size: 11px; color: #94a3b8; letter-spacing:.5px; }
    @media print { body { background: white; padding: 0; } .card { box-shadow: none; border: none; border-radius: 0; } }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <h1>وصل صيانة طوارئ</h1>
      <p>رقم المهمة: #${taskId} · ${new Date(taskDate || Date.now()).toLocaleDateString('ar-SY')}</p>
    </div>

    <div class="meta">
      <div class="meta-item"><div class="label">الزبون</div><div class="value">${clientName || '—'}</div></div>
      <div class="meta-item"><div class="label">رقم العقد</div><div class="value">${contractRef || `#${taskId}`}</div></div>
      <div class="meta-item"><div class="label">الهاتف</div><div class="value">${clientPhone || '—'}</div></div>
      <div class="meta-item"><div class="label">تاريخ الصيانة</div><div class="value">${new Date(taskDate || Date.now()).toLocaleDateString('ar-SY')}</div></div>
    </div>

    <div class="section">
      <h2>القطع المستبدلة</h2>
      <table>
        <thead><tr><th>اسم القطعة</th><th style="text-align:center">الكمية</th><th style="text-align:left">سعر الوحدة (ل.س)</th><th style="text-align:left">الإجمالي (ل.س)</th></tr></thead>
        <tbody>${partsRows}</tbody>
      </table>
    </div>

    <div class="section">
      <h2>التكاليف</h2>
      <div class="cost-line"><span>قطع الغيار</span><strong>${parts.reduce((s: number, p: any) => s + Number(p.lineTotal||0), 0).toLocaleString('ar-SY')} ل.س</strong></div>
      ${transportFee > 0 ? `<div class="cost-line"><span>أجور مواصلات وخدمة</span><strong>${transportFee.toLocaleString('ar-SY')} ل.س</strong></div>` : ''}
      ${assemblyFee > 0 ? `<div class="cost-line"><span>أجور فك وتركيب</span><strong>${assemblyFee.toLocaleString('ar-SY')} ل.س</strong></div>` : ''}
      ${discountPct > 0 ? `<div class="cost-line"><span>الحسم (${discountPct}%)</span><strong style="color:#d97706">− ${discountAmt.toLocaleString('ar-SY')} ل.س</strong></div>` : ''}
      <div class="total-line"><span>الإجمالي الواجب دفعه</span><strong>${grandTotal.toLocaleString('ar-SY')} ل.س</strong></div>
    </div>

    <div class="section">
      <h2>تفاصيل الدفع</h2>
      ${payLine('نوع الدفع', payTypeLabel[paymentType] || '—')}
      ${entryRows}
      ${totalPaidSyp > 0 ? payLine('إجمالي المدفوع', `${totalPaidSyp.toLocaleString('ar-SY')} ل.س`) : ''}
    </div>

    <div class="section" style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:16px">
      <div>
        <h2 style="margin-bottom:10px">القرار النهائي</h2>
        ${finalDecision
          ? `<div class="decision-badge">${decisionLabel}</div>`
          : `<div class="decision-pending">لم يُحدد بعد</div>`
        }
      </div>
      <div style="text-align:center;min-width:180px">
        <div style="font-size:11px;color:#94a3b8;font-weight:bold;margin-bottom:6px;letter-spacing:.5px">موظف التسكير</div>
        <div style="font-weight:900;font-size:16px;color:#0f172a;min-height:24px">${closingEmployeeName || '—'}</div>
        <div class="sig-line">التوقيع والختم</div>
      </div>
    </div>

    <div class="footer">
      <span>إيصال قابل للطباعة أو الحفظ كـ PDF · Golden CRM</span>
      <span>${new Date().toLocaleString('ar-SY')}</span>
    </div>
  </div>
</body>
</html>`;
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface ReceiptData {
  taskId: number;
  taskDate: string | null;
  clientName: string | null;
  clientPhone: string | null;
  contractRef: string | null;
  parts: any[];
  paymentEntries: any[];
  transportFee: number;
  assemblyFee: number;
  discountPct: number;
  grandTotal: number;
  paymentType: string;
  totalPaidSyp: number;
  finalDecision: string;
  decisionLabel: string;
  closingEmployeeName: string | null;
}

const DECISION_LABELS: Record<string, string> = {
  resolved:      'تمت المعالجة ✓',
  unresolved:    'لم تُحل',
  needs_followup:'تحتاج متابعة',
  cancelled:     'ملغاة',
};

// ── Modal ─────────────────────────────────────────────────────────────────────

interface Props {
  taskId: number;
  isOpen: boolean;
  onClose: () => void;
}

export default function MaintenanceReceiptModal({ taskId, isOpen, onClose }: Props) {
  const [receiptData, setReceiptData] = useState<ReceiptData | null>(null);
  const [loading, setLoading]         = useState(true);

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    Promise.all([
      api.emergencyResult.getParts(taskId),
      api.emergencyResult.get(taskId),
      api.emergencyResult.getPaymentEntries(taskId),
    ]).then(([parts, result, entries]) => {
      const costs = result.phases?.costs ?? {};
      const meta  = result.taskMeta ?? {};
      const totalPaidSyp = entries.reduce((s: number, e: any) => s + (Number(e.amountSyp) || 0), 0);
      setReceiptData({
        taskId,
        taskDate:            meta.taskDate ?? null,
        clientName:          meta.clientName ?? null,
        clientPhone:         meta.clientPhone ?? null,
        contractRef:         meta.contractRef ?? null,
        parts,
        paymentEntries:      entries,
        transportFee:        Number(costs.transportFee) || 0,
        assemblyFee:         Number(costs.assemblyFee)  || 0,
        discountPct:         Number(costs.discountPercentage) || 0,
        grandTotal:          Number(costs.totalCost) || 0,
        paymentType:         costs.paymentType ?? '',
        totalPaidSyp,
        finalDecision:       costs.finalDecision ?? '',
        decisionLabel:       DECISION_LABELS[costs.finalDecision ?? ''] ?? costs.finalDecision ?? '',
        closingEmployeeName: costs.closingEmployeeName ?? null,
      });
    }).catch(() => {}).finally(() => setLoading(false));
  }, [isOpen, taskId]);

  if (!isOpen) return null;

  const html = (!loading && receiptData) ? buildReceiptHtml(receiptData) : '';

  const handlePrint = () => {
    const win = window.open('', '_blank', 'width=800,height=900');
    if (!win) return;
    win.document.write(html);
    win.document.close();
    win.onload = () => { win.focus(); win.print(); };
  };

  const handleDownload = () => {
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `maintenance-receipt-${taskId}.html`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const whatsappText = receiptData ? [
    `*وصل صيانة طوارئ #${taskId}*`,
    receiptData.clientName  ? `الزبون: ${receiptData.clientName}` : '',
    receiptData.contractRef ? `العقد: ${receiptData.contractRef}` : '',
    '',
    `الإجمالي: ${receiptData.grandTotal.toLocaleString('ar-SY')} ل.س`,
    receiptData.totalPaidSyp > 0 ? `المدفوع: ${receiptData.totalPaidSyp.toLocaleString('ar-SY')} ل.س` : '',
    '',
    `القرار: ${receiptData.decisionLabel}`,
    receiptData.closingEmployeeName ? `موظف التسكير: ${receiptData.closingEmployeeName}` : '',
    '',
    `التاريخ: ${new Date().toLocaleDateString('ar-SY')}`,
  ].filter(Boolean).join('\n') : '';

  const handleWhatsapp = () => {
    const url = `https://wa.me/?text=${encodeURIComponent(whatsappText)}`;
    window.open(url, '_blank');
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/60 p-3" dir="rtl">
      <div className="w-full max-w-2xl overflow-hidden rounded-3xl bg-white shadow-2xl flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 bg-rose-50/50 px-6 py-4 shrink-0">
          <div>
            <h3 className="text-base font-black text-slate-800">وصل الصيانة</h3>
            <p className="mt-0.5 text-xs text-slate-500">مهمة #{taskId}</p>
          </div>
          <button onClick={onClose} className="rounded-xl p-2 text-slate-400 hover:bg-white hover:text-slate-600 transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Preview */}
        <div className="flex-1 overflow-y-auto bg-slate-100 p-4">
          {loading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-rose-500" />
            </div>
          ) : (
            <iframe
              srcDoc={html}
              className="w-full rounded-2xl border border-slate-200 shadow-sm bg-white"
              style={{ height: '60vh', minHeight: 400 }}
              title="وصل الصيانة"
            />
          )}
        </div>

        {/* Actions */}
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 px-6 py-4 shrink-0 bg-slate-50">
          <button onClick={handleDownload} disabled={loading}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition-colors">
            <Download className="h-4 w-4" /> تنزيل HTML
          </button>
          <button onClick={handleWhatsapp} disabled={loading || !whatsappText}
            className="inline-flex items-center gap-2 rounded-xl border border-green-300 bg-green-50 px-4 py-2 text-sm font-bold text-green-700 hover:bg-green-100 disabled:opacity-50 transition-colors">
            <MessageCircle className="h-4 w-4" /> مشاركة واتساب
          </button>
          <button onClick={handlePrint} disabled={loading}
            className="inline-flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2 text-sm font-bold text-white hover:bg-rose-500 disabled:opacity-50 shadow-sm transition-colors">
            <Printer className="h-4 w-4" /> طباعة / PDF
          </button>
        </div>
      </div>
    </div>
  );
}
