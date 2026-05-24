import { useState, useEffect } from 'react';
import { Loader2, CheckCircle2, AlertCircle, Truck } from 'lucide-react';
import { api } from '../../lib/api';
import { formatDate } from '../../components/tasks/shared';
import type { TaskResultRendererProps } from '../../components/tasks/types';

const OUTCOME_LABELS: Record<string, string> = {
  delivered_successfully: 'تم التسليم بنجاح',
  customer_not_available: 'الزبون غير متوفر',
  wrong_address:          'عنوان خاطئ',
  refused_delivery:       'رفض الاستلام',
};

const CONDITION_LABELS: Record<string, string> = {
  perfect:              'سليم وممتاز',
  minor_damage:         'ضرر طفيف',
  missing_accessories:  'نقص ملحقات',
};

export default function DeliveryResultRenderer({ task }: TaskResultRendererProps) {
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<any>(null);

  useEffect(() => {
    setLoading(true);
    api.openTasks.getDeliveryResult(task.id)
      .then(data => setResult(data))
      .catch(() => setResult(null))
      .finally(() => setLoading(false));
  }, [task.id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10 text-slate-400">
        <Loader2 className="w-5 h-5 animate-spin ml-2" />
        <span className="text-sm">جارٍ تحميل النتيجة...</span>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="text-center py-12 text-slate-400" dir="rtl">
        <Truck className="w-12 h-12 mx-auto mb-3 opacity-30" />
        <p className="text-base font-bold">لم يتم تسجيل نتيجة بعد</p>
        <p className="text-xs mt-1">تُسجَّل النتيجة من قِبل الفني الميداني أثناء الزيارة</p>
      </div>
    );
  }

  const isSuccess = result.outcome === 'delivered_successfully';

  return (
    <div className="space-y-4" dir="rtl">
      <div className={`bg-white rounded-xl border p-5 shadow-sm ${isSuccess ? 'border-emerald-200' : 'border-amber-200'}`}>
        <div className="flex items-center gap-3 mb-4">
          <div className={`w-10 h-10 rounded-full flex items-center justify-center ${isSuccess ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-600'}`}>
            {isSuccess ? <CheckCircle2 className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
          </div>
          <div>
            <h3 className="font-bold text-slate-800">{OUTCOME_LABELS[result.outcome] ?? result.outcome}</h3>
            <p className="text-xs text-slate-400">{formatDate(result.actualDeliveryDate || result.createdAt)}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2 border-t border-slate-100 pt-4">
          {result.serialNumber && (
            <div className="flex justify-between items-center py-1">
              <span className="text-xs text-slate-400 font-bold">الرقم التسلسلي</span>
              <span className="font-mono text-slate-700">{result.serialNumber}</span>
            </div>
          )}
          {result.deliveryCondition && (
            <div className="flex justify-between items-center py-1">
              <span className="text-xs text-slate-400 font-bold">حالة الجهاز</span>
              <span className="text-slate-700">{CONDITION_LABELS[result.deliveryCondition] ?? result.deliveryCondition}</span>
            </div>
          )}
          {result.deliveryAddress && (
            <div className="md:col-span-2 flex flex-col gap-1 py-1">
              <span className="text-xs text-slate-400 font-bold">عنوان التسليم الفعلي</span>
              <span className="text-slate-700 text-sm">{result.deliveryAddress}</span>
            </div>
          )}
          <div className="flex justify-between items-center py-1">
            <span className="text-xs text-slate-400 font-bold">إقرار الزبون</span>
            <span className={`text-xs font-bold px-2 py-0.5 rounded ${result.customerAcknowledged ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' : 'bg-slate-100 text-slate-500 border border-slate-200'}`}>
              {result.customerAcknowledged ? 'موقع' : 'غير موقع'}
            </span>
          </div>
          {result.deliveredByName && (
            <div className="flex justify-between items-center py-1">
              <span className="text-xs text-slate-400 font-bold">مسلّم من</span>
              <span className="text-slate-700">{result.deliveredByName}</span>
            </div>
          )}
          {result.notes && (
            <div className="md:col-span-2 pt-1">
              <span className="text-xs text-slate-400 font-bold block mb-1">ملاحظات</span>
              <p className="text-sm text-slate-700 bg-slate-50 rounded-lg p-2.5 border border-slate-100">{result.notes}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
