import { Users, UserRound, Wrench, ShoppingCart } from 'lucide-react';
import { Card, EmptyState, formatMoney, TabAlert } from '../../components/tasks/shared';
import type { TaskDetailData } from '../../components/tasks/types';

const OFFER_TYPE_LABELS: Record<string, string> = { cash: 'كاش', installment: 'تقسيط' };
const CUSTOMER_RESPONSE_LABELS: Record<string, { label: string; className: string }> = {
  accepted: { label: 'تم البيع', className: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
  rejected: { label: 'مرفوض', className: 'bg-rose-50 text-rose-700 border-rose-100' },
  extension_requested: { label: 'طلب مهلة', className: 'bg-amber-50 text-amber-700 border-amber-100' },
};
const NO_CLOSING_REASON_LABELS: Record<string, string> = {
  '': 'بدون سبب',
  not_closed: 'لم يتم التسكير',
  follow_up: 'متابعة لاحقة',
  customer_busy: 'العميل مشغول',
  price_issue: 'سبب سعري',
  other: 'أخرى',
};

function getCustomerResponseMeta(value: string | null | undefined) {
  if (!value) return { label: 'بانتظار الرد', className: 'bg-slate-50 text-slate-600 border-slate-100' };
  return CUSTOMER_RESPONSE_LABELS[value] ?? { label: value, className: 'bg-slate-50 text-slate-600 border-slate-100' };
}

function getClosingStateMeta(offer: any) {
  if (offer?.closedByEmployeeName) {
    return { label: 'مغلق', detail: `بواسطة ${offer.closedByEmployeeName}`, className: 'bg-emerald-50 text-emerald-700 border-emerald-100' };
  }
  if (offer?.closedByEmployeeId) {
    return { label: 'مغلق', detail: `بواسطة موظف #${offer.closedByEmployeeId}`, className: 'bg-emerald-50 text-emerald-700 border-emerald-100' };
  }
  if (offer?.noClosingReason) {
    return { label: 'غير مغلق', detail: NO_CLOSING_REASON_LABELS[offer.noClosingReason] ?? offer.noClosingReason, className: 'bg-amber-50 text-amber-700 border-amber-100' };
  }
  return { label: 'بانتظار الإغلاق', detail: '—', className: 'bg-slate-50 text-slate-600 border-slate-100' };
}

function normalizeOfferRow(offer: any) {
  const responseMeta = getCustomerResponseMeta(offer?.customerResponse);
  const closingMeta = getClosingStateMeta(offer);
  return {
    id: offer?.id,
    deviceName: offer?.deviceName || `جهاز #${offer?.deviceModelId ?? '—'}`,
    offerTypeLabel: OFFER_TYPE_LABELS[offer?.offerType] ?? offer?.offerType ?? '—',
    quantityLabel: offer?.quantity ?? '—',
    amountLabel: formatMoney(offer?.totalAmount, offer?.currency),
    discountLabel: Number(offer?.discountPercentage || 0) > 0 ? `${offer.discountPercentage}%` : '—',
    responseLabel: responseMeta.label,
    responseClassName: responseMeta.className,
    closingLabel: closingMeta.label,
    closingDetail: closingMeta.detail,
    closingClassName: closingMeta.className,
  };
}

export default function DeviceDemoOfferTab({ data }: { data: TaskDetailData }) {
  const { task, preOffers } = data;
  const team = task.teamSnapshot;

  const issues: string[] = [];
  if (!team) issues.push('الفريق المكلف غير معيّن');
  if (preOffers.length === 0) issues.push('لا توجد عروض مسبقة مسجلة');

  const offerRows = preOffers.map(normalizeOfferRow);

  return (
    <>
      <TabAlert title="ملاحظات على تفاصيل العرض" items={issues} />

      <Card title="الفريق المكلف" icon={Users}>
        {team ? (
          <div className="grid gap-3 md:grid-cols-3">
            {[
              { key: 'supervisor', label: 'مشرف', icon: UserRound, name: team.supervisor?.name, bg: 'bg-indigo-50', text: 'text-indigo-500', badge: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
              { key: 'technician', label: 'فني', icon: Wrench, name: team.technician?.name, bg: 'bg-sky-50', text: 'text-sky-500', badge: 'bg-sky-50 text-sky-700 border-sky-200' },
              { key: 'trainee', label: 'متدرب', icon: Users, name: team.trainee?.name, bg: 'bg-amber-50', text: 'text-amber-500', badge: 'bg-amber-50 text-amber-700 border-amber-200' },
            ].filter((item) => item.name).map((item) => (
              <div key={item.key} className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${item.bg}`}>
                    <item.icon className={`w-4 h-4 ${item.text}`} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-slate-500">{item.label}</p>
                    <p className="text-sm font-semibold text-slate-800 truncate">{item.name}</p>
                  </div>
                </div>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${item.badge}`}>{item.label}</span>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState icon={Users} title="لم يتم تعيين فريق لهذه المهمة" description="عند تعيين الفريق ستظهر أسماء المشرف والفني والمتدرب هنا." />
        )}
      </Card>

      <Card title="العروض المسبقة" icon={ShoppingCart}>
        {offerRows.length > 0 ? (
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
                {offerRows.map((offer: any, i: number) => (
                  <tr key={offer.id || i} className="text-sm text-slate-700">
                    <td className="px-3 py-3 border-b border-slate-100">{i + 1}</td>
                    <td className="px-3 py-3 border-b border-slate-100 font-medium">{offer.deviceName}</td>
                    <td className="px-3 py-3 border-b border-slate-100">{offer.offerTypeLabel}</td>
                    <td className="px-3 py-3 border-b border-slate-100">{offer.quantityLabel}</td>
                    <td className="px-3 py-3 border-b border-slate-100">{offer.amountLabel}</td>
                    <td className="px-3 py-3 border-b border-slate-100">{offer.discountLabel}</td>
                    <td className="px-3 py-3 border-b border-slate-100">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-lg text-xs font-bold border ${offer.responseClassName}`}>
                        {offer.responseLabel}
                      </span>
                    </td>
                    <td className="px-3 py-3 border-b border-slate-100">
                      <div className={`inline-flex flex-col gap-0.5 rounded-lg border px-2.5 py-1 text-xs font-bold ${offer.closingClassName}`}>
                        <span>{offer.closingLabel}</span>
                        <span className="font-normal opacity-80">{offer.closingDetail}</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon={ShoppingCart} title="لا توجد عروض مسبقة مسجلة" description="ستظهر العروض المسبقة هنا مع تفاصيلها." />
        )}
      </Card>
    </>
  );
}
