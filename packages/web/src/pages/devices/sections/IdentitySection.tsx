import { SectionShell } from './SectionShell';
import type { ReactNode } from 'react';

interface Props {
  device: any;
}

function MissingValue({ children }: { children: ReactNode }) {
  return (
    <div className="inline-flex flex-col gap-0.5">
      <span className="text-sm text-amber-700 font-bold">غير مسجل</span>
      <span className="text-[11px] text-slate-400 font-medium leading-relaxed">{children}</span>
    </div>
  );
}

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <div className="text-[11px] text-slate-400 font-bold mb-1">{label}</div>
      <div className="text-sm text-slate-700 font-semibold break-words">{value}</div>
    </div>
  );
}

export function IdentitySection({ device }: Props) {
  const missing = device?.missingFields ?? {};

  return (
    <SectionShell id="identity" title="هوية الجهاز" subtitle="القيم الثابتة التي تعرّف هذه الوحدة">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
        <Field
          label="الموديل"
          value={device?.deviceModelName || <MissingValue>لم يصل اسم الموديل من العقد أو سجل الجهاز.</MissingValue>}
        />
        <Field
          label="الرقم التسلسلي"
          value={
            device?.serialNumber
              ? <span className="font-mono" dir="ltr">{device.serialNumber}</span>
              : <MissingValue>{missing.serialNumber ? 'لم يتم إدخال الرقم التسلسلي عند إنشاء أو اعتماد العقد.' : 'لا يوجد رقم تسلسلي محفوظ.'}</MissingValue>
          }
        />
        <Field label="رقم الجهاز الداخلي" value={`#${device?.id ?? 'غير معروف'}`} />
        <Field
          label="الفرع"
          value={device?.branchName || <MissingValue>{missing.branchName ? 'الجهاز غير مرتبط بفرع واضح.' : 'اسم الفرع غير متاح.'}</MissingValue>}
        />
      </div>
    </SectionShell>
  );
}

export default IdentitySection;
