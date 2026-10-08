import { ShoppingCart } from '../../components/ui/icons';
import DataTable from '../../components/ui/DataTable';
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
        <DataTable minWidth={720}>
          <DataTable.Head>
            <DataTable.Row>
              <DataTable.Th>#</DataTable.Th>
              <DataTable.Th>الجهاز</DataTable.Th>
              <DataTable.Th>نوع العرض</DataTable.Th>
              <DataTable.Th>الكمية</DataTable.Th>
              <DataTable.Th>الإجمالي</DataTable.Th>
              <DataTable.Th>الحسم</DataTable.Th>
              <DataTable.Th>رد الزبون</DataTable.Th>
              <DataTable.Th>الإغلاق</DataTable.Th>
            </DataTable.Row>
          </DataTable.Head>
          <DataTable.Body>
            {rows.map((offer: any, i: number) => (
              <DataTable.Row key={offer.id ?? i}>
                <DataTable.Td>{i + 1}</DataTable.Td>
                <DataTable.Td className="font-medium text-slate-800">{offer.deviceName}</DataTable.Td>
                <DataTable.Td>{offer.offerTypeLabel}</DataTable.Td>
                <DataTable.Td>{offer.quantityLabel}</DataTable.Td>
                <DataTable.Td>{offer.amountLabel}</DataTable.Td>
                <DataTable.Td>{offer.discountLabel}</DataTable.Td>
                <DataTable.Td className="text-xs">{offer.responseLabel}</DataTable.Td>
                <DataTable.Td className="text-xs">{offer.closingLabel}</DataTable.Td>
              </DataTable.Row>
            ))}
          </DataTable.Body>
        </DataTable>
      ) : (
        <EmptyState icon={ShoppingCart} title="لا توجد عروض مرتبطة بعد" description="سيظهر هنا ملخص العروض التي أُثبتت للمهمة." />
      )}
    </Card>
  );
}
