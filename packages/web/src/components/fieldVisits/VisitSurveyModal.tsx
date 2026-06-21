// ============================================================
// VisitSurveyModal.tsx — DEC-007 D42/D43/D44 visit survey UI
// ============================================================
// 11 mandatory fields. A "تخطي الاستبيان" toggle reveals a skip_reason
// dropdown sourced from system_lists category=survey_skip_reasons.
// area_evaluation dropdown is sourced from area_evaluation_options.
// ============================================================

import { useEffect, useState } from 'react';
import { X, ClipboardCheck, Save, SkipForward } from 'lucide-react';
import IconButton from '../ui/IconButton';
import { api } from '../../lib/api';
import Select from '../ui/Select';
import Input from '../ui/Input';

interface Props {
  visitId: number;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

interface SystemListItem {
  id?: number;
  value: string;
}

const EMPTY_FORM = {
  householdMembersCount: '',
  drinkingWaterSource: '',
  tdsTestResult: '',
  hardnessTestDrops: '',
  demoKitTdsResult: '',
  customerOpinionWaterSource: '',
  customerOpinionDemoKit: '',
  customerOpinionPurificationIdea: '',
  customerPurchaseIntent: 'yes' as 'yes' | 'no',
  expectedPaymentMethod: '',
  areaEvaluation: '',
};

export default function VisitSurveyModal({ visitId, open, onClose, onSaved }: Props) {
  const [areaEvalOptions, setAreaEvalOptions] = useState<SystemListItem[]>([]);
  const [skipReasons, setSkipReasons] = useState<SystemListItem[]>([]);
  const [skipMode, setSkipMode] = useState(false);
  const [skipReason, setSkipReason] = useState('');
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load lookups once
  useEffect(() => {
    if (!open) return;
    void (async () => {
      try {
        const [ae, sr] = await Promise.all([
          api.systemLists.list({ category: 'area_evaluation_options', activeOnly: true }),
          api.systemLists.list({ category: 'survey_skip_reasons', activeOnly: true }),
        ]);
        setAreaEvalOptions(ae);
        setSkipReasons(sr);
      } catch (e) {
        console.error('VisitSurveyModal lookups failed', e);
      }
    })();
  }, [open]);

  // Hydrate from existing survey row if present
  useEffect(() => {
    if (!open) return;
    setError(null);
    void (async () => {
      const existing = await api.fieldVisits.getSurvey(visitId);
      if (existing) {
        if (existing.isSkipped) {
          setSkipMode(true);
          setSkipReason(existing.skipReason ?? '');
        } else {
          setSkipMode(false);
          setForm({
            householdMembersCount: String(existing.householdMembersCount ?? ''),
            drinkingWaterSource: existing.drinkingWaterSource ?? '',
            tdsTestResult: String(existing.tdsTestResult ?? ''),
            hardnessTestDrops: String(existing.hardnessTestDrops ?? ''),
            demoKitTdsResult: String(existing.demoKitTdsResult ?? ''),
            customerOpinionWaterSource: existing.customerOpinionWaterSource ?? '',
            customerOpinionDemoKit: existing.customerOpinionDemoKit ?? '',
            customerOpinionPurificationIdea: existing.customerOpinionPurificationIdea ?? '',
            customerPurchaseIntent: existing.customerPurchaseIntent ? 'yes' : 'no',
            expectedPaymentMethod: existing.expectedPaymentMethod ?? '',
            areaEvaluation: existing.areaEvaluation ?? '',
          });
        }
      } else {
        setSkipMode(false);
        setForm(EMPTY_FORM);
        setSkipReason('');
      }
    })();
  }, [open, visitId]);

  function setField<K extends keyof typeof EMPTY_FORM>(key: K, value: string) {
    setForm((prev) => ({ ...prev, [key]: value as any }));
  }

  async function save() {
    setError(null);
    if (skipMode) {
      if (!skipReason.trim()) {
        setError('سبب التخطي مطلوب');
        return;
      }
      setBusy(true);
      try {
        await api.fieldVisits.skipSurvey(visitId, skipReason.trim());
        onSaved();
        onClose();
      } catch (e: any) {
        setError(e?.message ?? 'فشل حفظ التخطي');
      } finally {
        setBusy(false);
      }
      return;
    }
    // Full-fill validation
    const required: (keyof typeof EMPTY_FORM)[] = [
      'householdMembersCount', 'drinkingWaterSource', 'tdsTestResult',
      'hardnessTestDrops', 'demoKitTdsResult',
      'customerOpinionWaterSource', 'customerOpinionDemoKit',
      'customerOpinionPurificationIdea', 'expectedPaymentMethod', 'areaEvaluation',
    ];
    const missing = required.filter((k) => !String(form[k]).trim());
    if (missing.length > 0) {
      setError(`حقول مفقودة: ${missing.length}`);
      return;
    }
    setBusy(true);
    try {
      await api.fieldVisits.saveSurvey(visitId, {
        householdMembersCount: Number(form.householdMembersCount),
        drinkingWaterSource: form.drinkingWaterSource.trim(),
        tdsTestResult: Number(form.tdsTestResult),
        hardnessTestDrops: Number(form.hardnessTestDrops),
        demoKitTdsResult: Number(form.demoKitTdsResult),
        customerOpinionWaterSource: form.customerOpinionWaterSource.trim(),
        customerOpinionDemoKit: form.customerOpinionDemoKit.trim(),
        customerOpinionPurificationIdea: form.customerOpinionPurificationIdea.trim(),
        customerPurchaseIntent: form.customerPurchaseIntent === 'yes',
        expectedPaymentMethod: form.expectedPaymentMethod.trim(),
        areaEvaluation: form.areaEvaluation,
      });
      onSaved();
      onClose();
    } catch (e: any) {
      setError(e?.message ?? 'فشل حفظ الاستبيان');
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        <header className="flex items-center justify-between px-5 py-3 border-b border-slate-200 bg-slate-50">
          <div className="flex items-center gap-2">
            <ClipboardCheck className="w-4 h-4 text-emerald-700" />
            <h2 className="text-sm font-bold text-slate-800">استبيان الزيارة</h2>
          </div>
          <IconButton icon={X} label="إغلاق" size="sm" onClick={onClose} />
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {error && (
            <div className="rounded-md bg-red-50 border border-red-200 p-2 text-xs font-bold text-red-700">
              {error}
            </div>
          )}

          <label className="flex items-center gap-2 text-xs font-bold text-slate-700">
            <input
              type="checkbox"
              checked={skipMode}
              onChange={(e) => setSkipMode(e.target.checked)}
            />
            تخطي الاستبيان
          </label>

          {skipMode ? (
            <div>
              <label className="block text-[11px] font-bold text-slate-600 mb-1">سبب التخطي</label>
              <Select
                value={skipReason}
                onChange={setSkipReason}
                placeholder="اختر سبباً"
                ariaLabel="سبب التخطي"
                className="w-full"
                options={skipReasons.map(r => ({ value: r.value, label: r.value }))}
              />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <NumberField label="عدد أفراد العائلة" value={form.householdMembersCount} onChange={(v) => setField('householdMembersCount', v)} />
              <TextField label="مصدر مياه الشرب" value={form.drinkingWaterSource} onChange={(v) => setField('drinkingWaterSource', v)} />
              <NumberField label="فحص TDS (ppm)" value={form.tdsTestResult} onChange={(v) => setField('tdsTestResult', v)} />
              <NumberField label="فحص الكلس (عدد النقاط)" value={form.hardnessTestDrops} onChange={(v) => setField('hardnessTestDrops', v)} />
              <NumberField label="نتيجة Demo Kit (ppm)" value={form.demoKitTdsResult} onChange={(v) => setField('demoKitTdsResult', v)} />
              <TextField label="رأي الزبون بمصدر مياهه" value={form.customerOpinionWaterSource} onChange={(v) => setField('customerOpinionWaterSource', v)} />
              <TextField label="رأي الزبون بنتيجة Demo Kit" value={form.customerOpinionDemoKit} onChange={(v) => setField('customerOpinionDemoKit', v)} />
              <TextField label="تقييم فكرة أجهزة التنقية" value={form.customerOpinionPurificationIdea} onChange={(v) => setField('customerOpinionPurificationIdea', v)} />
              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">رغبة الشراء</label>
                <Select<'yes' | 'no'>
                  value={form.customerPurchaseIntent}
                  onChange={v => setField('customerPurchaseIntent', v)}
                  ariaLabel="رغبة الشراء"
                  className="w-full"
                  options={[
                    { value: 'yes', label: 'نعم' },
                    { value: 'no', label: 'لا' },
                  ]}
                />
              </div>
              <TextField label="طريقة الدفع المتوقعة" value={form.expectedPaymentMethod} onChange={(v) => setField('expectedPaymentMethod', v)} />
              <div className="col-span-2">
                <label className="block text-[11px] font-bold text-slate-600 mb-1">تقييم المنطقة</label>
                <Select
                  value={form.areaEvaluation}
                  onChange={v => setField('areaEvaluation', v)}
                  placeholder="اختر تقييماً"
                  ariaLabel="تقييم المنطقة"
                  className="w-full"
                  options={areaEvalOptions.map(r => ({ value: r.value, label: r.value }))}
                />
              </div>
            </div>
          )}
        </div>

        <footer className="flex justify-end gap-2 px-5 py-3 border-t border-slate-200 bg-slate-50">
          <button
            onClick={onClose}
            disabled={busy}
            className="px-3 py-1.5 rounded-md text-xs font-bold border border-slate-300 text-slate-700 bg-white hover:bg-slate-100"
          >
            إلغاء
          </button>
          <button
            onClick={() => void save()}
            disabled={busy}
            className="px-3 py-1.5 rounded-md text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-700 inline-flex items-center gap-1"
          >
            {skipMode ? <SkipForward className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
            {skipMode ? 'تأكيد التخطي' : 'حفظ الاستبيان'}
          </button>
        </footer>
      </div>
    </div>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <Input
      label={label}
      type="number"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      inputSize="sm"
    />
  );
}

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <Input
      label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      inputSize="sm"
    />
  );
}
