import { useState, useEffect } from 'react';
import { Users, UserRound, Wrench, Phone, MessageCircle, Truck, MapPin, ExternalLink } from 'lucide-react';
import { Card, EmptyState, TabAlert, InfoLine, formatDate, formatMoney } from '../../components/tasks/shared';
import type { TaskDetailData } from '../../components/tasks/types';
import { api } from '../../lib/api';
import type { GeoUnit } from '../../lib/types';


function buildGeoPath(geoUnitId: number | null, units: GeoUnit[]): Record<number, string> {
  if (!geoUnitId) return {};
  const map = new Map(units.map(u => [u.id, u]));
  const result: Record<number, string> = {};
  let current = map.get(geoUnitId);
  while (current) {
    result[current.level] = current.name;
    current = current.parentId != null ? map.get(current.parentId) : undefined;
  }
  return result;
}

export default function DeliveryInfoTab({ data }: { data: TaskDetailData }) {
  const { task } = data;
  const team = task.teamSnapshot;
  const snap = task.contractSnapshot;
  const client = task.clientSnapshot;

  const [geoUnits, setGeoUnits] = useState<GeoUnit[]>([]);
  useEffect(() => {
    api.geoUnits.list().then(d => setGeoUnits(Array.isArray(d) ? d : [])).catch(() => {});
  }, []);

  const issues: string[] = [];
  if (!team) issues.push('الفريق المكلف غير معيّن');
  if (!snap) issues.push('بيانات العقد غير متوفرة في لقطة المهمة');

  const device = snap?.device;
  const addr = snap?.installationAddress;
  const allContacts: any[] = client?.contacts ?? [];
  const primaryMobile = client?.mobile ?? task.clientMobile ?? null;
  const primaryContact = allContacts.find((c: any) => c.isPrimary) ?? allContacts.find((c: any) => c.number === primaryMobile);
  const primaryHasWhatsApp = primaryContact?.hasWhatsApp === true;
  const contacts = allContacts.filter((c: any) => !c.isPrimary && c.number !== primaryMobile);

  const taskTypeLabel =
    task.taskType === 'device_delivery'    ? 'تسليم جهاز' :
    task.taskType === 'device_installation'? 'تركيب جهاز' :
    task.taskType === 'device_activation'  ? 'تشغيل جهاز' : task.taskType;

  const geoPath = buildGeoPath(addr?.geoUnitId ?? null, geoUnits);

  const gpsUrl = addr?.lat && addr?.lng
    ? `https://www.google.com/maps?q=${addr.lat},${addr.lng}`
    : null;

  return (
    <div className="space-y-4" dir="rtl">
      <TabAlert title="ملاحظات" items={issues} />

      {/* ── الفريق المكلف ── */}
      <Card title="الفريق المكلف" icon={Users}>
        {team ? (
          <div className="grid gap-3 md:grid-cols-3">
            {[
              { key: 'supervisor', label: 'مشرف',  icon: UserRound, name: team.supervisor?.name,  bg: 'bg-indigo-50', text: 'text-indigo-500', badge: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
              { key: 'technician', label: 'فني',    icon: Wrench,    name: team.technician?.name,  bg: 'bg-sky-50',    text: 'text-sky-500',   badge: 'bg-sky-50 text-sky-700 border-sky-200' },
              { key: 'trainee',    label: 'متدرب',  icon: Users,     name: team.trainee?.name,     bg: 'bg-amber-50',  text: 'text-amber-500', badge: 'bg-amber-50 text-amber-700 border-amber-200' },
            ].filter(item => item.name).map(item => (
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

      {/* ── بيانات الجهاز والعقد ── */}
      <Card title="الجهاز والعقد" icon={Truck}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-1.5">
          <InfoLine label="نوع المهمة"    value={taskTypeLabel} />
          <InfoLine label="اسم الجهاز"    value={device?.modelName || snap?.deviceModelName || '—'} />
          <InfoLine label="الرقم التسلسلي" value={<span className="font-mono">{device?.serialNumber || '—'}</span>} />
          <InfoLine label="تاريخ العقد"   value={snap?.contractDate ? formatDate(snap.contractDate) : '—'} />
          <InfoLine label="رقم العقد"     value={snap?.contractNumber ? <span className="font-mono">#{snap.contractNumber}</span> : '—'} />
          <InfoLine label="نوع الدفع"     value={snap?.financials?.paymentType === 'installment' ? 'تقسيط' : snap?.financials?.paymentType === 'cash' ? 'كاش' : snap?.financials?.paymentType || '—'} />
          <InfoLine label="السعر النهائي" value={formatMoney(snap?.financials?.finalPrice, snap?.financials?.currency)} />
        </div>
      </Card>

      {/* ── بيانات التواصل ── */}
      <Card title="بيانات التواصل" icon={Phone}>
        <div className="space-y-3">
          <InfoLine label="اسم الزبون" value={<span className="font-bold text-slate-800">{client?.name || task.clientName || '—'}</span>} />

          {/* الرقم الأساسي */}
          {primaryMobile && (
            <div className="flex items-center justify-between py-1">
              <span className="text-xs text-slate-400 font-bold shrink-0">الهاتف الأساسي</span>
              <div className="flex items-center gap-2">
                <a href={`tel:${primaryMobile}`} className="font-mono text-sm text-slate-700 hover:text-sky-600 transition-colors" dir="ltr">
                  {primaryMobile}
                </a>
                {primaryHasWhatsApp ? (
                  <a
                    href={`https://wa.me/${primaryMobile.replace(/\D/g, '')}`}
                    target="_blank" rel="noreferrer"
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-bold rounded bg-emerald-50 text-emerald-600 border border-emerald-100 hover:bg-emerald-100 transition-colors"
                  >
                    <MessageCircle className="w-3 h-3" />
                    واتساب
                  </a>
                ) : (
                  <span className="text-[10px] text-slate-300 font-bold">لا واتساب</span>
                )}
              </div>
            </div>
          )}

          {/* أرقام إضافية */}
          {contacts.length > 0 && (
            <div className="border-t border-slate-100 pt-3 space-y-2">
              <p className="text-[11px] font-bold text-slate-400 mb-1">أرقام التواصل الأخرى</p>
              {contacts.map((c: any, i: number) => (
                <div key={i} className="flex items-center justify-between bg-slate-50 rounded-lg px-3 py-2 border border-slate-100">
                  <div className="flex items-center gap-2 min-w-0">
                    <Phone className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <a href={`tel:${c.number}`} className="font-mono text-sm text-slate-700 hover:text-sky-600" dir="ltr">
                      {c.number}
                    </a>
                    {c.label && (
                      <span className="text-[10px] text-slate-500 bg-white border border-slate-200 px-1.5 py-0.5 rounded font-bold">
                        {c.label}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {c.hasWhatsApp ? (
                      <a
                        href={`https://wa.me/${c.number.replace(/\D/g, '')}`}
                        target="_blank" rel="noreferrer"
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-bold rounded bg-emerald-50 text-emerald-600 border border-emerald-100 hover:bg-emerald-100 transition-colors"
                      >
                        <MessageCircle className="w-3 h-3" />
                        واتساب
                      </a>
                    ) : (
                      <span className="text-[10px] text-slate-300 font-bold">لا واتساب</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {!primaryMobile && allContacts.length === 0 && (
            <p className="text-sm text-slate-400 text-center py-3">لا توجد أرقام تواصل مسجلة</p>
          )}
        </div>
      </Card>

      {/* ── عنوان التركيب من العقد ── */}
      <Card title="عنوان التركيب (من العقد)" icon={MapPin}>
        {addr?.geoUnitId ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-x-8 gap-y-1.5">
              <InfoLine label="المحافظة" value={geoPath[1] || '—'} />
              <InfoLine label="المنطقة"  value={geoPath[2] || '—'} />
              <InfoLine label="الناحية"  value={geoPath[3] || '—'} />
              <InfoLine label="الحي"     value={geoPath[4] || '—'} />
            </div>
            {addr.addressText ? (
              <div className="bg-slate-50 rounded-lg px-3 py-2 border border-slate-100">
                <p className="text-[11px] font-bold text-slate-400 mb-1">العنوان التفصيلي</p>
                <p className="text-sm text-slate-700">{addr.addressText}</p>
              </div>
            ) : (
              <p className="text-xs text-slate-400 italic">لا يوجد عنوان تفصيلي مسجل في العقد</p>
            )}
            {gpsUrl ? (
              <a
                href={gpsUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-sky-50 border border-sky-200 text-sky-700 text-sm font-bold hover:bg-sky-100 transition-colors"
              >
                <MapPin className="w-4 h-4" />
                فتح الخريطة
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            ) : (
              <p className="text-xs text-slate-400">لم يتم تحديد موقع GPS للتركيب</p>
            )}
          </div>
        ) : (
          <EmptyState icon={MapPin} title="عنوان التركيب غير متوفر" description="لم يتم تحديد موقع تركيب في العقد." />
        )}
      </Card>
    </div>
  );
}
