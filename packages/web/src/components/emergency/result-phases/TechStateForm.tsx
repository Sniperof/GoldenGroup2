import { useState } from 'react';
import { AlertCircle, ArrowLeft, ArrowRight, ChevronRight, Loader2, Save } from 'lucide-react';
import { api } from '../../../lib/api';
import DSSelect from '../../ui/Select';
import Card from '../../ui/Card';
import Badge from '../../ui/Badge';

// ── Field helpers ─────────────────────────────────────────────────────────────

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="block text-xs font-bold text-slate-600">{label}</label>
      {children}
      {hint && <p className="text-xs text-slate-400">{hint}</p>}
    </div>
  );
}

const inp = "w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:border-rose-400 focus:ring-2 focus:ring-rose-400/20 bg-white";
const sel = `${inp} appearance-none cursor-pointer`;

function NumInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return <input type="number" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder ?? '—'} className={inp} />;
}

function Select({ value, onChange, options, placeholder }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; placeholder?: string }) {
  return (
    <DSSelect
      value={value}
      onChange={onChange}
      placeholder={placeholder ?? '— اختر —'}
      className="w-full"
      options={options}
    />
  );
}

function BoolSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Select value={value} onChange={onChange} options={[
      { value: 'يعمل', label: 'يعمل ✓' },
      { value: 'لايعمل', label: 'لا يعمل ✗' },
    ]} />
  );
}

// ── Efficiency badge ──────────────────────────────────────────────────────────

function EfficiencyBadge({ inlet, outlet }: { inlet: string; outlet: string }) {
  const i = parseFloat(inlet), o = parseFloat(outlet);
  if (!i || !o || o === 0) return null;
  const eff = Math.round((1 - i / o) * 100);
  const label = eff >= 90 ? 'ممتازة' : eff >= 75 ? 'جيدة' : eff >= 60 ? 'مقبولة' : 'ضعيفة';
  const cls = eff >= 90 ? 'bg-emerald-50 text-emerald-700 border-emerald-300 ring-emerald-100'
    : eff >= 75 ? 'bg-sky-50 text-sky-700 border-sky-300 ring-sky-100'
    : eff >= 60 ? 'bg-amber-50 text-amber-700 border-amber-300 ring-amber-100'
    : 'bg-red-50 text-red-700 border-red-300 ring-red-100';
  return (
    <div className={`flex items-center gap-3 rounded-2xl border-2 px-4 py-3 ring-4 ${cls}`}>
      <div className="text-center">
        <div className="text-2xl font-black leading-none">{eff}%</div>
        <div className="text-xs font-bold mt-0.5 opacity-70">{label}</div>
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xs font-bold mb-0.5">كفاءة الميمبرين</div>
        <div className="text-xs opacity-60 font-mono ltr">
          (1 − {i} / {o}) × 100
        </div>
        <div className="text-xs opacity-60 mt-0.5">
          دخل: <span className="font-bold">{i} ppm</span> · خرج: <span className="font-bold">{o} ppm</span>
        </div>
      </div>
    </div>
  );
}

// ── Comparison row (for post-state vs pre-state) ──────────────────────────────

function CompareRow({ label, before, after }: { label: string; before?: any; after?: any }) {
  if (before == null && after == null) return null;
  const changed = before != null && after != null && String(before) !== String(after);
  return (
    <div className={`flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-xs border ${changed ? 'bg-amber-50 border-amber-200' : 'bg-slate-50 border-slate-100'}`}>
      <span className="font-bold text-slate-500">{label}</span>
      <div className="flex items-center gap-2">
        {before != null && <span className="text-slate-400 line-through">{before}</span>}
        {changed && <ChevronRight className="h-3 w-3 text-slate-400" />}
        {after != null && <span className={`font-bold ${changed ? 'text-amber-700' : 'text-slate-700'}`}>{after}</span>}
      </div>
    </div>
  );
}

// ── Main form ─────────────────────────────────────────────────────────────────

interface Props {
  phase: 'pre' | 'post';
  taskId: number;
  initialData?: any;
  preData?: any; // for post-phase: show comparison
  readOnly?: boolean;
  onSaved: () => void;
  onNext?: () => void;
  onBack?: () => void;
}

type F = Record<string, string>;

function toStr(v: any) { return v != null ? String(v) : ''; }

function initForm(d?: any): F {
  if (!d) return {};
  return {
    waterSourceType:          toStr(d.waterSourceType),
    waterSourceTds:           toStr(d.waterSourceTds),
    waterPressure:            toStr(d.waterPressure),
    hasPressureRegulator:     d.hasPressureRegulator === true ? 'true' : d.hasPressureRegulator === false ? 'false' : '',
    tapTdsBefore:             toStr(d.tapTdsBefore),
    pumpPressure:             toStr(d.pumpPressure),
    membraneOutputTds:        toStr(d.membraneOutputTds),
    membraneInputTds:         toStr(d.membraneInputTds),
    membraneFlow:             toStr(d.membraneFlow),
    flowCupSize:              toStr(d.flowCupSize),
    sterilizationTransformer: toStr(d.sterilizationTransformer),
    uvLamp:                   toStr(d.uvLamp),
    sterilizationSleeve:      toStr(d.sterilizationSleeve),
    highPressureTds:          toStr(d.highPressureTds),
    lowPressureSwitch:        toStr(d.lowPressureSwitch),
    tankTds:                  toStr(d.tankTds),
    valveType:                toStr(d.valveType),
    pumpTransformer:          toStr(d.pumpTransformer),
    hasFifthTap:              toStr(d.hasFifthTap),
    deviceConnection:         toStr(d.deviceConnection),
    additionalNotes:          toStr(d.additionalNotes),
  };
}

export default function TechStateForm({ phase, taskId, initialData, preData, readOnly = false, onSaved, onNext, onBack }: Props) {
  const [f, setF] = useState<F>(() => initForm(initialData));
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  const set = (key: string) => (val: string) => setF(prev => ({ ...prev, [key]: val }));

  const buildPayload = () => ({
    waterSourceType:          f.waterSourceType          || null,
    waterSourceTds:           f.waterSourceTds           ? Number(f.waterSourceTds)     : null,
    waterPressure:            f.waterPressure            || null,
    hasPressureRegulator:     f.hasPressureRegulator === 'true' ? true : f.hasPressureRegulator === 'false' ? false : null,
    tapTdsBefore:             f.tapTdsBefore             ? Number(f.tapTdsBefore)        : null,
    pumpPressure:             f.pumpPressure             ? Number(f.pumpPressure)        : null,
    membraneOutputTds:        f.membraneOutputTds        ? Number(f.membraneOutputTds)   : null,
    membraneInputTds:         f.membraneInputTds         ? Number(f.membraneInputTds)    : null,
    membraneFlow:             f.membraneFlow             || null,
    flowCupSize:              f.flowCupSize              ? Number(f.flowCupSize)         : null,
    sterilizationTransformer: f.sterilizationTransformer || null,
    uvLamp:                   f.uvLamp                   || null,
    sterilizationSleeve:      f.sterilizationSleeve      || null,
    highPressureTds:          f.highPressureTds          ? Number(f.highPressureTds)     : null,
    lowPressureSwitch:        f.lowPressureSwitch        || null,
    tankTds:                  f.tankTds                  ? Number(f.tankTds)             : null,
    valveType:                f.valveType                || null,
    pumpTransformer:          f.pumpTransformer          || null,
    hasFifthTap:              f.hasFifthTap              || null,
    deviceConnection:         f.deviceConnection         || null,
    additionalNotes:          f.additionalNotes          || null,
  });

  const handleSave = async (andNext = false) => {
    setSaving(true); setError('');
    try {
      const save = phase === 'pre' ? api.emergencyResult.savePreState : api.emergencyResult.savePostState;
      await save(taskId, buildPayload());
      onSaved();
      if (andNext && onNext) onNext();
    } catch (err: any) { setError(err.message || 'فشل الحفظ'); }
    finally { setSaving(false); }
  };

  const title = phase === 'pre' ? 'الحالة الفنية قبل الصيانة' : 'الحالة الفنية بعد الصيانة';

  return (
    <Card padding="none" className="overflow-hidden" dir="rtl">
      {/* Header */}
      <div className="px-5 py-3.5 border-b border-slate-100 bg-rose-50/50 flex items-center justify-between">
        <h3 className="font-bold text-slate-800 text-base">{title}</h3>
        {initialData && <Badge variant="success" size="sm">محفوظة ✓</Badge>}
      </div>

      {/* Comparison strip (post phase only) */}
      {phase === 'post' && preData && (
        <div className="px-5 pt-4 pb-0">
          <p className="text-xs font-bold text-slate-500 mb-2">مقارنة مع ما قبل الصيانة:</p>
          <div className="grid grid-cols-2 gap-1.5">
            <CompareRow label="عيار مصدر المياه" before={preData.waterSourceTds} after={f.waterSourceTds ? Number(f.waterSourceTds) : undefined} />
            <CompareRow label="عيار حنفية الجهاز" before={preData.tapTdsBefore} after={f.tapTdsBefore ? Number(f.tapTdsBefore) : undefined} />
            <CompareRow label="خرج الميمبرين" before={preData.membraneOutputTds} after={f.membraneOutputTds ? Number(f.membraneOutputTds) : undefined} />
            <CompareRow label="ضغط المضخة" before={preData.pumpPressure} after={f.pumpPressure ? Number(f.pumpPressure) : undefined} />
            {preData.membraneInputTds && preData.membraneOutputTds && f.membraneInputTds && f.membraneOutputTds && (() => {
              const before = Math.round((1 - preData.membraneInputTds / preData.membraneOutputTds) * 100);
              const after  = Math.round((1 - Number(f.membraneInputTds) / Number(f.membraneOutputTds)) * 100);
              return <CompareRow label="كفاءة الميمبرين" before={`${before}%`} after={`${after}%`} />;
            })()}
          </div>
        </div>
      )}

      <div className="p-5 space-y-5">
        {/* === Section: مصدر المياه === */}
        <div>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">مصدر المياه</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field label="نوع المصدر">
              <Select value={f.waterSourceType ?? ''} onChange={set('waterSourceType')} options={[
                { value: 'رئيسية', label: 'رئيسية' }, { value: 'خزان', label: 'خزان' },
              ]} />
            </Field>
            <Field label="العيار (ppm)">
              <NumInput value={f.waterSourceTds ?? ''} onChange={set('waterSourceTds')} placeholder="0" />
            </Field>
            <Field label="ضغط المصدر">
              <Select value={f.waterPressure ?? ''} onChange={set('waterPressure')} options={[
                { value: 'قوي', label: 'قوي' }, { value: 'جيد', label: 'جيد' },
                { value: 'وسط', label: 'وسط' }, { value: 'ضعيف', label: 'ضعيف' },
              ]} />
            </Field>
            <Field label="وجود كاسر">
              <Select value={f.hasPressureRegulator ?? ''} onChange={set('hasPressureRegulator')} options={[
                { value: 'true', label: 'نعم' }, { value: 'false', label: 'لا' },
              ]} />
            </Field>
          </div>
        </div>

        {/* === Section: قراءات الجهاز === */}
        <div>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">قراءات الجهاز</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field label="عيار حنفية الجهاز (ppm)">
              <NumInput value={f.tapTdsBefore ?? ''} onChange={set('tapTdsBefore')} />
            </Field>
            <Field label="ضغط المضخة (bar)">
              <NumInput value={f.pumpPressure ?? ''} onChange={set('pumpPressure')} />
            </Field>
            <Field label="خرج الميمبرين (ppm)">
              <NumInput value={f.membraneOutputTds ?? ''} onChange={set('membraneOutputTds')} />
            </Field>
            <Field label="دخل الميمبرين (ppm)">
              <NumInput value={f.membraneInputTds ?? ''} onChange={set('membraneInputTds')} />
            </Field>
            <Field label="تدفق الميمبرين">
              <Select value={f.membraneFlow ?? ''} onChange={set('membraneFlow')} options={[
                { value: 'جيد', label: 'جيد' }, { value: 'وسط', label: 'وسط' }, { value: 'ضعيف', label: 'ضعيف' },
              ]} />
            </Field>
            <Field label="فلو الكب">
              <Select value={f.flowCupSize ?? ''} onChange={set('flowCupSize')} options={[
                { value: '300', label: '300' }, { value: '450', label: '450' },
              ]} />
            </Field>
            <Field label="عيار الهاي برشر (ppm)">
              <NumInput value={f.highPressureTds ?? ''} onChange={set('highPressureTds')} />
            </Field>
            <Field label="عيار الخزان (ppm)">
              <NumInput value={f.tankTds ?? ''} onChange={set('tankTds')} />
            </Field>
          </div>

          {/* Efficiency auto-calculated */}
          {f.membraneInputTds && f.membraneOutputTds && (
            <div className="mt-3">
              <EfficiencyBadge inlet={f.membraneInputTds} outlet={f.membraneOutputTds} />
            </div>
          )}
        </div>

        {/* === Section: التعقيم === */}
        <div>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">التعقيم</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Field label="ترانس التعقيم">
              <BoolSelect value={f.sterilizationTransformer ?? ''} onChange={set('sterilizationTransformer')} />
            </Field>
            <Field label="لمبة التعقيم">
              <BoolSelect value={f.uvLamp ?? ''} onChange={set('uvLamp')} />
            </Field>
            <Field label="سليفة التعقيم">
              <BoolSelect value={f.sterilizationSleeve ?? ''} onChange={set('sterilizationSleeve')} />
            </Field>
          </div>
        </div>

        {/* === Section: الضاغطات === */}
        <div>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">الضاغطات والتوصيلات</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field label="لو برشر">
              <BoolSelect value={f.lowPressureSwitch ?? ''} onChange={set('lowPressureSwitch')} />
            </Field>
            <Field label="نوع القسام">
              <Select value={f.valveType ?? ''} onChange={set('valveType')} options={[
                { value: 'ميكانيك', label: 'ميكانيك' }, { value: 'كهرباء', label: 'كهرباء' },
              ]} />
            </Field>
            <Field label="ترانس مضخة">
              <Select value={f.pumpTransformer ?? ''} onChange={set('pumpTransformer')} options={[
                { value: '3 امبير', label: '3 امبير' }, { value: '1.5 امبير', label: '1.5 امبير' },
              ]} />
            </Field>
            <Field label="صباب خامسة">
              <Select value={f.hasFifthTap ?? ''} onChange={set('hasFifthTap')} options={[
                { value: 'موجود', label: 'موجود' }, { value: 'الغاء', label: 'إلغاء' },
              ]} />
            </Field>
            <Field label="توصيلة الجهاز">
              <Select value={f.deviceConnection ?? ''} onChange={set('deviceConnection')} options={[
                { value: 'تشالنجر', label: 'تشالنجر' }, { value: 'ro', label: 'RO' },
              ]} />
            </Field>
          </div>
        </div>

        {/* === ملاحظات === */}
        <Field label="ملاحظات إضافية">
          <textarea value={f.additionalNotes ?? ''} onChange={e => set('additionalNotes')(e.target.value)}
            rows={3} placeholder="أي ملاحظات تقنية إضافية..."
            disabled={readOnly}
            className={`${inp} resize-none`} />
        </Field>

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-xs font-bold text-red-700">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />{error}
          </div>
        )}

        {/* Actions */}
        {!readOnly && (
          <div className="flex gap-2 pt-1">
            {onBack && (
              <button type="button" onClick={onBack}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-50 transition-colors">
                <ArrowRight className="h-4 w-4" /> السابق
              </button>
            )}
            <button type="button" onClick={() => handleSave(false)} disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-xl border border-rose-300 bg-rose-50 px-4 py-2.5 text-sm font-bold text-rose-700 hover:bg-rose-100 disabled:opacity-60 transition-colors">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              حفظ
            </button>
            {onNext && (
              <button type="button" onClick={() => handleSave(true)} disabled={saving}
                className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-rose-500 disabled:opacity-60 transition-colors shadow-sm">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                حفظ والانتقال للتالي
                <ArrowLeft className="h-4 w-4" />
              </button>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
