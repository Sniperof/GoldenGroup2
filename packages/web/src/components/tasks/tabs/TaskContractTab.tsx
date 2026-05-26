import { FileText, MapPin, Wrench } from 'lucide-react';
import { Card, InfoLine, EmptyState, formatDate, formatMoney } from '../shared';

export interface TaskContractTabProps {
  task: any;
}

/**
 * Displays contract_snapshot when present.
 * For task types that don't have a contract (device_demo, gift_delivery),
 * shows an explanatory empty state instead.
 */
export default function TaskContractTab({ task }: TaskContractTabProps) {
  const contract = task.contractSnapshot;

  if (!contract) {
    return (
      <EmptyState
        icon={FileText}
        title="لا يوجد عقد مرتبط بهذه المهمة"
        description={
          task.taskType === 'device_demo'
            ? 'مهمة عرض الجهاز ما قبل البيع — لا يُنشأ العقد إلا بعد موافقة الزبون.'
            : 'هذه المهمة لا تتطلب عقداً.'
        }
      />
    );
  }

  return (
    <div className="space-y-6">
      <Card title="بيانات العقد" icon={FileText}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-1.5">
          <InfoLine label="رقم العقد" value={<span className="font-mono">{contract.contractNumber}</span>} />
          <InfoLine label="تاريخ العقد" value={formatDate(contract.contractDate)} />
          <InfoLine label="معرف العقد" value={`#${contract.contractId}`} />
          {contract.status && <InfoLine label="حالة العقد" value={contract.status} />}
        </div>
      </Card>

      {contract.device && (
        <Card title="الجهاز" icon={Wrench}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-1.5">
            <InfoLine label="الموديل" value={contract.device.modelName || `#${contract.device.modelId}`} />
            <InfoLine label="الرقم التسلسلي" value={<span className="font-mono">{contract.device.serialNumber || '—'}</span>} />
            <InfoLine label="دورة الصيانة" value={
              contract.device.warrantyMonths && contract.device.warrantyVisits
                ? `كل ${Math.round((contract.device.warrantyMonths * 30) / contract.device.warrantyVisits)} يوم`
                : contract.device.maintenancePlan
                  ? `كل ${contract.device.maintenancePlan} أشهر`
                  : '—'
            } />
          </div>
        </Card>
      )}

      {contract.installationAddress && (
        <Card title="عنوان التركيب" icon={MapPin}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-1.5">
            <InfoLine label="المنطقة" value={contract.installationAddress.geoUnitName || '—'} />
            <div className="md:col-span-2">
              <InfoLine label="العنوان التفصيلي" value={contract.installationAddress.addressText || '—'} />
            </div>
            {contract.installationAddress.lat && contract.installationAddress.lng && (
              <>
                <InfoLine label="خط العرض" value={<span dir="ltr" className="font-mono text-xs">{contract.installationAddress.lat}</span>} />
                <InfoLine label="خط الطول" value={<span dir="ltr" className="font-mono text-xs">{contract.installationAddress.lng}</span>} />
              </>
            )}
          </div>
        </Card>
      )}

      {contract.financials && (
        <Card title="البيانات المالية" icon={FileText}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-1.5">
            <InfoLine label="نوع الدفع" value={contract.financials.paymentType === 'installment' ? 'تقسيط' : 'كاش'} />
            <InfoLine label="السعر النهائي" value={formatMoney(contract.financials.finalPrice, contract.financials.currency)} />
            <InfoLine label="الدفعة الأولى" value={formatMoney(contract.financials.downPayment, contract.financials.currency)} />
            <InfoLine label="عدد الأقساط" value={contract.financials.installmentsCount || '—'} />
          </div>
        </Card>
      )}
    </div>
  );
}
