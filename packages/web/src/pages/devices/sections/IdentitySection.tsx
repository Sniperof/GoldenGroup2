import { SectionShell } from './SectionShell';

interface Props {
  device: any;
}

function Field({ label, value }: { label: string; value: any }) {
  return (
    <div>
      <div className="text-[11px] text-slate-400 font-bold mb-1">{label}</div>
      <div className="text-sm text-slate-700 font-semibold break-all">{value ?? '—'}</div>
    </div>
  );
}

export function IdentitySection({ device }: Props) {
  return (
    <SectionShell id="identity" title="هوية الجهاز" subtitle="القيم القاعدية الثابتة للجهاز">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
        <Field label="الموديل" value={device?.deviceModelName} />
        <Field label="الرقم التسلسلي" value={<span className="font-mono">{device?.serialNumber || '—'}</span>} />
        <Field label="رقم الجهاز الداخلي" value={`#${device?.id ?? '—'}`} />
        <Field label="الفرع" value={device?.branchName ?? '—'} />
      </div>
    </SectionShell>
  );
}

export default IdentitySection;
