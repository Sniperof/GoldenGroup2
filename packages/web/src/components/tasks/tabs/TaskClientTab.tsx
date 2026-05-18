import { UserRound, Phone } from 'lucide-react';
import { Card, InfoLine, TabAlert } from '../shared';

export interface TaskClientTabProps {
  task: any;
  onClientClick: (clientId: number) => void;
}

export default function TaskClientTab({ task, onClientClick }: TaskClientTabProps) {
  const client = task.clientSnapshot;

  const issues: string[] = [];
  if (!client) issues.push('بيانات الزبون غير متوفرة');
  if (!client?.mobile && !task.clientMobile) issues.push('رقم الهاتف غير متوفر');
  if (!client?.address?.detailed && !task.clientDetailedAddress) issues.push('العنوان التفصيلي غير متوفر');

  return (
    <>
      <TabAlert title="ملاحظات على بيانات الزبون" items={issues} />
      <Card title="لقطة الزبون" icon={UserRound}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-1.5">
          <InfoLine
            label="الاسم"
            value={
              <button
                onClick={() => task.clientId && onClientClick(task.clientId)}
                className="font-bold text-slate-800 hover:text-sky-700 hover:underline transition-colors"
              >
                {client?.name || task.clientName || '—'}
              </button>
            }
          />
          <InfoLine
            label="الهاتف"
            value={
              <span className="font-mono text-slate-600" dir="ltr">
                {client?.mobile || task.clientMobile || '—'}
              </span>
            }
          />
          <InfoLine label="المحافظة" value={client?.address?.governorate || task.clientGovernorate || '—'} />
          <InfoLine label="المنطقة" value={client?.address?.district || task.clientDistrict || '—'} />
          <InfoLine label="الناحية" value={client?.address?.subArea || '—'} />
          <InfoLine label="الحي" value={client?.address?.neighborhood || task.clientNeighborhood || '—'} />
          <div className="md:col-span-2">
            <InfoLine label="العنوان التفصيلي" value={client?.address?.detailed || task.clientDetailedAddress || '—'} />
          </div>
          {client?.contacts?.length > 0 && (
            <div className="md:col-span-2 mt-2 space-y-2">
              <p className="text-xs font-bold text-slate-400">أرقام التواصل</p>
              <div className="flex flex-wrap gap-2">
                {client.contacts.map((c: any, i: number) => (
                  <span key={i} className="inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-50 border border-slate-100 text-xs font-mono text-slate-700" dir="ltr">
                    <Phone className="w-3 h-3 text-slate-400" />
                    {c.number}
                    {c.label && <span className="text-slate-400 font-sans">({c.label})</span>}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </Card>
    </>
  );
}
