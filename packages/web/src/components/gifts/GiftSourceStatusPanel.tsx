// «وضع المصدر» — decision support inside the condition check of a referral
// gift promise. Lists the suggested names behind the promise (the name itself,
// or every name on the promised list) with what each one became, and marks the
// ones that earn the mediator purchase credit:
//   • a converted name → credit once its client is OP;
//   • a linked duplicate («اسم مكرر») → credit only for a purchase made on or
//     after the link day (the client may have bought long before).
// It never sets the condition: the check stays manual.

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Loader2 } from '../ui/icons';
import { api, type GiftSourceStatus } from '../../lib/api';

const STATE_LABELS: Record<GiftSourceStatus['names'][number]['state'], { label: string; className: string }> = {
  open: { label: 'لا يزال اسماً مقترحاً', className: 'bg-slate-100 text-slate-600' },
  rejected: { label: 'مرفوض', className: 'bg-red-50 text-red-600' },
  converted: { label: 'تحوّل لزبون', className: 'bg-sky-50 text-sky-700' },
  linked: { label: 'اسم مكرر', className: 'bg-amber-50 text-amber-700' },
};

function creditNote(item: GiftSourceStatus['names'][number]): string {
  if (item.state === 'converted') {
    return item.stage === 'OP' ? `اشترى${item.firstPurchaseOn ? ` في ${item.firstPurchaseOn}` : ''}` : `لم يشترِ بعد (${item.stage ?? 'LEAD'})`;
  }
  if (item.state === 'linked') {
    if (item.purchaseCredited) return `اشترى بعد الربط (رُبط في ${item.linkedOn ?? '—'})`;
    if (item.firstPurchaseOn) return `اشترى قبل الترشيح (${item.firstPurchaseOn})، رُبط في ${item.linkedOn ?? '—'}`;
    return `لم يشترِ بعد الربط (رُبط في ${item.linkedOn ?? '—'})`;
  }
  return '—';
}

export default function GiftSourceStatusPanel({ recordId }: { recordId: number | string }) {
  const [status, setStatus] = useState<GiftSourceStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setStatus(null);
    setError(null);
    api.gifts.records.sourceStatus(recordId)
      .then(result => { if (active) setStatus(result); })
      .catch(err => { if (active) setError(err?.message || 'تعذر تحميل وضع المصدر'); });
    return () => { active = false; };
  }, [recordId]);

  if (error) {
    return <p className="rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-700">{error}</p>;
  }
  if (!status) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> جاري تحميل وضع المصدر...
      </div>
    );
  }
  if (!status.applicable) return null;

  const { summary } = status;
  const reached = status.names.filter(item => item.state === 'converted' || item.state === 'linked');

  return (
    <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold text-slate-700">وضع المصدر</span>
        <span className="text-[11px] text-slate-400">للمساعدة في التحقق فقط، ولا يغيّر حالة الشرط</span>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
        <div><dt className="text-slate-500">الأسماء</dt><dd className="font-bold text-slate-800">{summary.names}</dd></div>
        <div><dt className="text-slate-500">تحوّلت لزبائن</dt><dd className="font-bold text-slate-800">{summary.converted}</dd></div>
        <div><dt className="text-slate-500">أسماء مكررة</dt><dd className="font-bold text-amber-700">{summary.linked}</dd></div>
        <div><dt className="text-slate-500">شراء يُحتسب للوسيط</dt><dd className="font-black text-emerald-700">{summary.purchaseCredited}</dd></div>
      </dl>
      {summary.linkedBoughtBefore > 0 && (
        <p className="rounded-md bg-amber-50 px-2 py-1.5 text-[11px] font-medium text-amber-800">
          {summary.linkedBoughtBefore} اسم مكرر لزبون اشترى قبل ترشيحه — لا يُحتسب شراؤه للوسيط.
        </p>
      )}
      {reached.length > 0 && (
        <ul className="max-h-48 divide-y divide-slate-100 overflow-y-auto rounded-md border border-slate-100">
          {reached.map(item => {
            const state = STATE_LABELS[item.state];
            return (
              <li key={item.candidateId} className="flex flex-wrap items-center justify-between gap-2 px-2 py-1.5 text-xs">
                <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                  {item.clientId ? (
                    <Link to={`/clients/${item.clientId}`} className="font-bold text-sky-700 hover:underline">
                      {item.clientName || item.name}
                    </Link>
                  ) : (
                    <span className="font-bold text-slate-800">{item.name}</span>
                  )}
                  <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${state.className}`}>{state.label}</span>
                </div>
                <span className={`flex items-center gap-1 ${item.purchaseCredited ? 'font-bold text-emerald-700' : 'text-slate-500'}`}>
                  {item.purchaseCredited && <CheckCircle2 className="h-3.5 w-3.5" />}
                  {creditNote(item)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {status.truncated && <p className="text-[11px] text-slate-400">تُعرض أول 200 اسم؛ الأرقام أعلاه تشمل الكل.</p>}
    </div>
  );
}
