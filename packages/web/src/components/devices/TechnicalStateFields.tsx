// ============================================================
// TechnicalStateFields — reusable CONTROLLED technical-state form.
// Mirrors the maintenance-result headings (TechStateForm) but is parent-driven
// so any task result (activation, periodic, check…) can embed it and submit the
// reading inside its own request. Constitution 01i.
//
// Value is a flat string map; buildTechnicalStatePayload() converts it to the
// camelCase payload the API expects (same keys as the emergency wizard).
// ============================================================
import type { ReactNode } from 'react';

export type TechStateForm = Record<string, string>;

const inp = 'w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-400/20 bg-white';
const sel = `${inp} appearance-none cursor-pointer`;

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="space-y-1.5 block">
      <span className="text-xs font-bold text-slate-500">{label}</span>
      {children}
    </label>
  );
}

const YESNO = [{ value: 'true', label: 'نعم' }, { value: 'false', label: 'لا' }];
const WORKS = [{ value: 'يعمل', label: 'يعمل ✓' }, { value: 'لايعمل', label: 'لا يعمل ✗' }];

export function buildTechnicalStatePayload(f: TechStateForm) {
  const num = (v?: string) => (v && v.trim() ? Number(v) : null);
  const str = (v?: string) => (v && v.trim() ? v : null);
  return {
    waterSourceType:          str(f.waterSourceType),
    waterSourceTds:           num(f.waterSourceTds),
    waterPressure:            str(f.waterPressure),
    hasPressureRegulator:     f.hasPressureRegulator === 'true' ? true : f.hasPressureRegulator === 'false' ? false : null,
    tapTdsBefore:             num(f.tapTdsBefore),
    pumpPressure:             num(f.pumpPressure),
    membraneOutputTds:        num(f.membraneOutputTds),
    membraneInputTds:         num(f.membraneInputTds),
    membraneFlow:             str(f.membraneFlow),
    flowCupSize:              num(f.flowCupSize),
    sterilizationTransformer: str(f.sterilizationTransformer),
    uvLamp:                   str(f.uvLamp),
    sterilizationSleeve:      str(f.sterilizationSleeve),
    highPressureTds:          num(f.highPressureTds),
    lowPressureSwitch:        str(f.lowPressureSwitch),
    tankTds:                  num(f.tankTds),
    valveType:                str(f.valveType),
    pumpTransformer:          str(f.pumpTransformer),
    hasFifthTap:              str(f.hasFifthTap),
    deviceConnection:         str(f.deviceConnection),
    additionalNotes:          str(f.additionalNotes),
  };
}

// True when the technician has entered at least one measurement.
export function hasAnyTechnicalReading(f: TechStateForm) {
  return Object.entries(f).some(([, v]) => v != null && String(v).trim() !== '');
}

function efficiency(f: TechStateForm): number | null {
  const i = Number(f.membraneInputTds), o = Number(f.membraneOutputTds);
  if (!i || !o || i <= 0) return null;
  return Math.round((1 - o / i) * 100);
}

export function TechnicalStateFields({
  value,
  onChange,
  hasSterilization = true,
}: {
  value: TechStateForm;
  onChange: (next: TechStateForm) => void;
  hasSterilization?: boolean;
}) {
  const f = value;
  const set = (key: string) => (v: string) => onChange({ ...f, [key]: v });

  const Sel = (key: string, opts: { value: string; label: string }[], placeholder = '— اختر —') => (
    <select value={f[key] ?? ''} onChange={(e) => set(key)(e.target.value)} className={sel}>
      <option value="">{placeholder}</option>
      {opts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
  const Num = (key: string) => (
    <input type="number" value={f[key] ?? ''} onChange={(e) => set(key)(e.target.value)} className={inp} placeholder="—" />
  );

  const eff = efficiency(f);

  return (
    <div className="space-y-5">
      {/* مصدر المياه */}
      <div>
        <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">مصدر المياه</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="نوع المصدر">{Sel('waterSourceType', [{ value: 'رئيسية', label: 'رئيسية' }, { value: 'خزان', label: 'خزان' }])}</Field>
          <Field label="العيار (ppm)">{Num('waterSourceTds')}</Field>
          <Field label="ضغط المصدر">{Sel('waterPressure', [{ value: 'قوي', label: 'قوي' }, { value: 'جيد', label: 'جيد' }, { value: 'وسط', label: 'وسط' }, { value: 'ضعيف', label: 'ضعيف' }])}</Field>
          <Field label="وجود كاسر">{Sel('hasPressureRegulator', YESNO)}</Field>
        </div>
      </div>

      {/* قراءات الجهاز */}
      <div>
        <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">قراءات الجهاز</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="عيار حنفية الجهاز (ppm)">{Num('tapTdsBefore')}</Field>
          <Field label="ضغط المضخة (bar)">{Num('pumpPressure')}</Field>
          <Field label="خرج الميمبرين (ppm)">{Num('membraneOutputTds')}</Field>
          <Field label="دخل الميمبرين (ppm)">{Num('membraneInputTds')}</Field>
          <Field label="تدفق الميمبرين">{Sel('membraneFlow', [{ value: 'جيد', label: 'جيد' }, { value: 'وسط', label: 'وسط' }, { value: 'ضعيف', label: 'ضعيف' }])}</Field>
          <Field label="فلو الكب">{Sel('flowCupSize', [{ value: '300', label: '300' }, { value: '450', label: '450' }])}</Field>
          <Field label="عيار الهاي برشر (ppm)">{Num('highPressureTds')}</Field>
          <Field label="عيار الخزان (ppm)">{Num('tankTds')}</Field>
        </div>
        {eff != null && (
          <div className="mt-2 inline-flex items-center gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-bold text-sky-700">
            كفاءة الميمبرين: {eff}%
          </div>
        )}
      </div>

      {/* التعقيم — اختياري حسب نوع الجهاز */}
      {hasSterilization && (
        <div>
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">التعقيم</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Field label="ترانس التعقيم">{Sel('sterilizationTransformer', WORKS)}</Field>
            <Field label="لمبة التعقيم">{Sel('uvLamp', WORKS)}</Field>
            <Field label="سليفة التعقيم">{Sel('sterilizationSleeve', WORKS)}</Field>
          </div>
        </div>
      )}

      {/* الضاغطات والتوصيلات */}
      <div>
        <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">الضاغطات والتوصيلات</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="لو برشر">{Sel('lowPressureSwitch', WORKS)}</Field>
          <Field label="نوع القسام">{Sel('valveType', [{ value: 'ميكانيك', label: 'ميكانيك' }, { value: 'كهرباء', label: 'كهرباء' }])}</Field>
          <Field label="ترانس مضخة">{Sel('pumpTransformer', [{ value: '3 امبير', label: '3 امبير' }, { value: '1.5 امبير', label: '1.5 امبير' }])}</Field>
          <Field label="صباب خامسة">{Sel('hasFifthTap', [{ value: 'موجود', label: 'موجود' }, { value: 'الغاء', label: 'إلغاء' }])}</Field>
          <Field label="توصيلة الجهاز">{Sel('deviceConnection', [{ value: 'تشالنجر', label: 'تشالنجر' }, { value: 'ro', label: 'RO' }])}</Field>
        </div>
      </div>

      {/* ملاحظات */}
      <Field label="ملاحظات فنية إضافية">
        <textarea value={f.additionalNotes ?? ''} onChange={(e) => set('additionalNotes')(e.target.value)} rows={2} className={`${inp} resize-none`} />
      </Field>
    </div>
  );
}
