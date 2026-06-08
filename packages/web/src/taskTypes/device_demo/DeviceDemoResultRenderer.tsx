import { ShoppingCart } from 'lucide-react';
import { Card, EmptyState, formatMoney } from '../../components/tasks/shared';
import type { TaskResultRendererProps } from '../../components/tasks/types';

const OFFER_TYPE_LABELS: Record<string, string> = { cash: 'كاش', installment: 'تقسيط' };
const NO_CLOSING_REASON_LABELS: Record<string, string> = {
  '': 'بدون سبب', not_closed: 'لم يتم التسكير', follow_up: 'متابعة لاحقة',
  customer_busy: 'العميل مشغول', price_issue: 'سبب سعري', other: 'أخرى',
};

function normalize(offer: any) {
  return {
    id: offer?.id,
    deviceName: offer?.deviceName || `جهاز #${offer?.deviceModelId ?? '—'}`,
    offerTypeLabel: OFFER_TYPE_LABELS[offer?.offerType] ?? offer?.offerType ?? '—',
    quantityLabel: offer?.quantity ?? '—',
    amountLabel: formatMoney(offer?.totalAmount, offer?.currency),
    discountLabel: Number(offer?.discountPercentage || 0) > 0 ? `${offer.discountPercentage}%` : '—',
    responseLabel: offer?.customerResponse === 'accepted' ? 'تم البيع'
                 : offer?.customerResponse === 'rejected' ? 'مرفوض'
                 : offer?.customerResponse === 'extension_requested' ? 'طلب مهلة' : 'بانتظار الرد',
    closingLabel: offer?.closedByEmployeeName ? `مغلق بواسطة ${offer.closedByEmployeeName}`
                : offer?.noClosingReason ? (NO_CLOSING_REASON_LABELS[offer.noClosingReason] ?? offer.noClosingReason)
                : '—',
  };
}

export default function DeviceDemoResultRenderer({ task, preOffers = [] }: TaskResultRendererProps) {
  const hasVisitOffers = Array.isArray(task.offers) && task.offers.length > 0;
  const offers = hasVisitOffers ? task.offers : preOffers;
  const rows = offers.map(normalize);

  return (
    <Card title="نتيجة المهمة — العروض" icon={ShoppingCart}>
      {rows.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="min-w-full text-right border-separate border-spacing-0">
            <thead>
              <tr className="text-xs font-bold text-slate-500">
                <th className="px-3 py-2 border-b border-slate-200">#</th>
                <th className="px-3 py-2 border-b border-slate-200">الجهاز</th>
                <th className="px-3 py-2 border-b border-slate-200">نوع العرض</th>
                <th className="px-3 py-2 border-b border-slate-200">الكمية</th>
                <th className="px-3 py-2 border-b border-slate-200">الإجمالي</th>
                <th className="px-3 py-2 border-b border-slate-200">الحسم</th>
                <th className="px-3 py-2 border-b border-slate-200">رد الزبون</th>
                <th className="px-3 py-2 border-b border-slate-200">الإغلاق</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((offer: any, i: number) => (
                <tr key={offer.id ?? i} className="text-sm text-slate-700">
                  <td className="px-3 py-3 border-b border-slate-100">{i + 1}</td>
                  <td className="px-3 py-3 border-b border-slate-100 font-medium">{offer.deviceName}</td>
                  <td className="px-3 py-3 border-b border-slate-100">{offer.offerTypeLabel}</td>
                  <td className="px-3 py-3 border-b border-slate-100">{offer.quantityLabel}</td>
                  <td className="px-3 py-3 border-b border-slate-100">{offer.amountLabel}</td>
                  <td className="px-3 py-3 border-b border-slate-100">{offer.discountLabel}</td>
                  <td className="px-3 py-3 border-b border-slate-100 text-xs">{offer.responseLabel}</td>
                  <td className="px-3 py-3 border-b border-slate-100 text-xs">{offer.closingLabel}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState icon={ShoppingCart} title="لا توجد عروض مرتبطة بعد" description="سيظهر هنا ملخص العروض التي أُثبتت للمهمة." />
      )}
    </Card>
  );
}
