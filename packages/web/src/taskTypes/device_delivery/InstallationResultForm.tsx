import { useState, useEffect } from 'react';
import { Loader2, CheckCircle2, AlertCircle, Wrench, ClipboardList } from 'lucide-react';
import { api } from '../../lib/api';
import { formatDate } from '../../components/tasks/shared';

const OUTCOME_OPTIONS = [
  { value: 'installed_successfully', label: 'تم التركيب بنجاح' },
  { value: 'installation_incomplete', label: 'تركيب غير مكتمل' },
  { value: 'site_not_ready', label: 'الموقع غير جاهز' },
];

const OUTCOME_LABELS: Record<string, string> = {
  installed_successfully: 'تم التركيب بنجاح',
  installation_incomplete: 'تركيب غير مكتمل',
  site_not_ready: 'الموقع غير جاهز',
};

const WATER_SOURCE_OPTIONS = [
  { value: 'public_network', label: 'شبكة عامة' },
  { value: 'well', label: 'بئر' },
  { value: 'tank', label: 'خزان' },
  { value: 'surface', label: 'سطحي' },
  { value: 'other', label: 'أخرى' },
];

const WATER_SOURCE_LABELS: Record<string, string> = {
  public_network: 'شبكة عامة', well: 'بئر', tank: 'خزان', surface: 'سطحي', other: 'أخرى',
};

const PIPE_TYPE_OPTIONS = [
  { value: 'plastic', label: 'بلاستيك' },
  { value: 'metal', label: 'معدنية' },
];

const ACCESSORIES_OPTIONS = [
  { value: 'filters', label: 'فلاتر' },
  { value: 'base', label: 'قاعدة' },
  { value: 'faucet', label: 'صنبور' },
  { value: 'pipes', label: 'أنابيب' },
  { value: 'pressure_tank', label: 'خزان ضغط' },
  { value: 'pump', label: 'طلمبة' },
];

const ACCESSORIES_LABELS: Record<string, string> = {
  filters: 'فلاتر', base: 'قاعدة', faucet: 'صنبور', pipes: 'أنابيب',
  pressure_tank: 'خزان ضغط', pump: 'طلمبة',
};

interface InstallationResultFormProps {
  taskId: number;
  readOnly?: boolean;
  onSaved?: () => void;
}

export default function InstallationResultForm({ taskId, readOnly = false, onSaved }: InstallationResultFormProps) {
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState<any>(null);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [outcome, setOutcome] = useState('');
  const [waterSourceType, setWaterSourceType] = useState('');
  const [pipeType, setPipeType] = useState('');
  const [pipeLengthMeters, setPipeLengthMeters] = useState('');
  const [electricalConnection, setElectricalConnection] = useState(false);
  const [wallMountingDone, setWallMountingDone] = useState(false);
  const [selectedAccessories, setSelectedAccessories] = useState<string[]>([]);
  const [installationStartDate, setInstallationStartDate] = useState('');
  const [installationEndDate, setInstallationEndDate] = useState('');
  const [technicalNotes, setTechnicalNotes] = useState('');

  useEffect(() => {
    api.openTasks.getInstallationResult(taskId)
      .then(data => setSaved(data))
      .catch(() => setSaved(null))
      .finally(() => setLoading(false));
  }, [taskId]);

  const isSuccess = outcome === 'installed_successfully';

  const toggleAccessory = (val: string) =>
    setSelectedAccessories(prev => prev.includes(val) ? prev.filter(a => a !== val) : [...prev, val]);

  const openEditForm = () => {
    if (!saved) return;
    setOutcome(saved.outcome ?? '');
    setWaterSourceType(saved.waterSourceType ?? '');
    setPipeType(saved.pipeType ?? '');
    setPipeLengthMeters(saved.pipeLengthMeters != null ? String(saved.pipeLengthMeters) : '');
    setElectricalConnection(saved.electricalConnection ?? false);
    setWallMountingDone(saved.wallMountingDone ?? false);
    setSelectedAccessories(Array.isArray(saved.installedAccessories) ? saved.installedAccessories : []);
    setInstallationStartDate(saved.installationStartDate ?? '');
    setInstallationEndDate(saved.installationEndDate ?? '');
    setTechnicalNotes(saved.technicalNotes ?? '');
    setShowForm(true);
  };

  const handleSubmit = async () => {
    if (!outcome) { setError('يرجى اختيار نتيجة التركيب'); return; }
    if (isSuccess && !waterSourceType) { setError('مصدر المياه مطلوب عند نجاح التركيب'); return; }

    setSubmitting(true);
    setError(null);
    try {
      const result = await api.openTasks.saveInstallationResult(taskId, {
        outcome,
        waterSourceType: waterSourceType || null,
        pipeType: pipeType || null,
        pipeLengthMeters: pipeLengthMeters ? parseFloat(pipeLengthMeters) : null,
        electricalConnection,
        wallMountingDone,
        installedAccessories: selectedAccessories,
        installationStartDate: installationStartDate || null,
        installationEndDate: installationEndDate || null,
        technicalNotes: technicalNotes.trim() || null,
      });
      setSaved(result.result);
      setShowForm(false);
      onSaved?.();
    } catch (err: any) {
      setError(err.message || 'فشل في حفظ النتيجة');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10 text-slate-400">
        <Loader2 className="w-6 h-6 animate-spin ml-2" />
        <span className="text-sm">جارٍ التحميل...</span>
      </div>
    );
  }

  // ── عرض النتيجة المحفوظة ─────────────────────────────────────────────────
  if (saved && !showForm) {
    const isSuccessOutcome = saved.outcome === 'installed_successfully';
    const accessories: string[] = Array.isArray(saved.installedAccessories) ? saved.installedAccessories : [];

    return (
      <div className="space-y-4" dir="rtl">
        <div className={`bg-white rounded-xl border p-5 shadow-sm ${isSuccessOutcome ? 'border-emerald-200' : 'border-amber-200'}`}>
          <div className="flex items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center ${isSuccessOutcome ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-600'}`}>
                {isSuccessOutcome ? <CheckCircle2 className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
              </div>
              <div>
                <h3 className="font-bold text-slate-800">{OUTCOME_LABELS[saved.outcome] ?? saved.outcome}</h3>
                <p className="text-xs text-slate-400">{formatDate(saved.installationEndDate || saved.createdAt)}</p>
              </div>
            </div>
            {!readOnly && (
              <button onClick={openEditForm} className="text-xs text-slate-500 hover:text-sky-600 border border-slate-200 hover:border-sky-300 px-3 py-1.5 rounded-lg transition-colors">
                تعديل
              </button>
            )}
          </div>

          {isSuccessOutcome && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2 border-t border-slate-100 pt-4">
              {saved.waterSourceType && (
                <div className="flex justify-between"><span className="text-xs text-slate-400 font-bold">مصدر المياه</span><span>{WATER_SOURCE_LABELS[saved.waterSourceType] ?? saved.waterSourceType}</span></div>
              )}
              {saved.pipeType && (
                <div className="flex justify-between"><span className="text-xs text-slate-400 font-bold">نوع التمديدات</span><span>{saved.pipeType === 'plastic' ? 'بلاستيك' : 'معدنية'}</span></div>
              )}
              {saved.pipeLengthMeters != null && (
                <div className="flex justify-between"><span className="text-xs text-slate-400 font-bold">طول التمديد</span><span>{saved.pipeLengthMeters} متر</span></div>
              )}
              <div className="flex justify-between">
                <span className="text-xs text-slate-400 font-bold">توصيل كهرباء</span>
                <span className={`text-xs font-bold px-2 py-0.5 rounded ${saved.electricalConnection ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' : 'bg-slate-100 text-slate-500 border border-slate-200'}`}>
                  {saved.electricalConnection ? 'نعم' : 'لا'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-xs text-slate-400 font-bold">تثبيت بالحائط</span>
                <span className={`text-xs font-bold px-2 py-0.5 rounded ${saved.wallMountingDone ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' : 'bg-slate-100 text-slate-500 border border-slate-200'}`}>
                  {saved.wallMountingDone ? 'نعم' : 'لا'}
                </span>
              </div>
              {saved.installationStartDate && (
                <div className="flex justify-between"><span className="text-xs text-slate-400 font-bold">بدء التركيب</span><span>{formatDate(saved.installationStartDate)}</span></div>
              )}
              {saved.installationEndDate && (
                <div className="flex justify-between"><span className="text-xs text-slate-400 font-bold">إنهاء التركيب</span><span>{formatDate(saved.installationEndDate)}</span></div>
              )}
              {accessories.length > 0 && (
                <div className="md:col-span-2">
                  <span className="text-xs text-slate-400 font-bold block mb-1.5">الملحقات المتركبة</span>
                  <div className="flex flex-wrap gap-1.5">
                    {accessories.map((a: string) => (
                      <span key={a} className="text-xs bg-sky-50 text-sky-700 border border-sky-100 px-2 py-0.5 rounded font-bold">
                        {ACCESSORIES_LABELS[a] ?? a}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {saved.technicalNotes && (
            <div className={`${isSuccessOutcome ? 'mt-3 border-t border-slate-100 pt-3' : ''}`}>
              <span className="text-xs text-slate-400 font-bold block mb-1">ملاحظات فنية</span>
              <p className="text-sm text-slate-700 bg-slate-50 rounded-lg p-2.5 border border-slate-100">{saved.technicalNotes}</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── نموذج التسجيل ────────────────────────────────────────────────────────
  if (!readOnly || showForm) {
    return (
      <div className="space-y-4" dir="rtl">
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <h3 className="text-base font-bold text-slate-800 mb-5 flex items-center gap-2">
            <ClipboardList className="w-5 h-5 text-amber-500" />
            {saved ? 'تعديل نتيجة التركيب' : 'تسجيل نتيجة التركيب'}
          </h3>

          <div className="space-y-5">
            {/* النتيجة */}
            <div>
              <label className="block text-xs font-bold text-slate-600 mb-2">نتيجة الزيارة <span className="text-rose-500">*</span></label>
              <div className="grid grid-cols-3 gap-2">
                {OUTCOME_OPTIONS.map(opt => (
                  <button key={opt.value} type="button" onClick={() => setOutcome(opt.value)}
                    className={`px-3 py-2.5 rounded-xl border text-sm font-bold text-center transition-colors ${outcome === opt.value ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'}`}>
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* حقول النجاح */}
            {isSuccess && (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1.5">مصدر المياه <span className="text-rose-500">*</span></label>
                    <select value={waterSourceType} onChange={e => setWaterSourceType(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                      <option value="">اختر مصدر المياه</option>
                      {WATER_SOURCE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1.5">نوع التمديدات</label>
                    <select value={pipeType} onChange={e => setPipeType(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                      <option value="">اختر النوع</option>
                      {PIPE_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1.5">طول التمديد (متر)</label>
                    <input type="number" min="0" step="0.5" value={pipeLengthMeters} onChange={e => setPipeLengthMeters(e.target.value)}
                      placeholder="مثال: 3.5"
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" dir="ltr" />
                  </div>
                </div>

                <div className="flex gap-6">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={electricalConnection} onChange={e => setElectricalConnection(e.target.checked)} className="w-4 h-4 accent-indigo-600" />
                    <span className="text-sm font-bold text-slate-700">توصيل كهرباء</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={wallMountingDone} onChange={e => setWallMountingDone(e.target.checked)} className="w-4 h-4 accent-indigo-600" />
                    <span className="text-sm font-bold text-slate-700">تثبيت بالحائط</span>
                  </label>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-2">الملحقات المتركبة</label>
                  <div className="flex flex-wrap gap-2">
                    {ACCESSORIES_OPTIONS.map(opt => (
                      <button key={opt.value} type="button" onClick={() => toggleAccessory(opt.value)}
                        className={`px-3 py-1.5 rounded-xl border text-xs font-bold transition-colors ${selectedAccessories.includes(opt.value) ? 'bg-sky-600 text-white border-sky-600' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'}`}>
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1.5">تاريخ بدء التركيب</label>
                    <input type="date" value={installationStartDate} onChange={e => setInstallationStartDate(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" dir="ltr" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1.5">تاريخ إنهاء التركيب</label>
                    <input type="date" value={installationEndDate} onChange={e => setInstallationEndDate(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" dir="ltr" />
                  </div>
                </div>
              </>
            )}

            {/* ملاحظات — تظهر دائماً */}
            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1.5">ملاحظات فنية {!isSuccess && <span className="text-slate-400">(سبب الفشل أو تفاصيل المشكلة)</span>}</label>
              <textarea value={technicalNotes} onChange={e => setTechnicalNotes(e.target.value)} rows={3}
                placeholder={isSuccess ? 'ملاحظات فنية اختيارية...' : 'اذكر سبب عدم إكمال التركيب أو وصف حالة الموقع...'}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none" />
            </div>

            {error && (
              <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-xl px-4 py-3 text-sm">{error}</div>
            )}

            {outcome && (
              <div className={`rounded-xl p-3 text-xs font-bold border ${isSuccess ? 'bg-emerald-50 border-emerald-100 text-emerald-700' : 'bg-amber-50 border-amber-100 text-amber-700'}`}>
                {isSuccess && 'ستُغلق المهمة كمكتملة وينشئ النظام تلقائياً مهمة تشغيل الجهاز.'}
                {outcome === 'installation_incomplete' && 'ستُغلق المهمة كمكتملة وتُنشأ مهمة تركيب جديدة للمتابعة.'}
                {outcome === 'site_not_ready' && 'ستُغلق المهمة كمكتملة وتُنشأ مهمة تركيب جديدة بعد جاهزية الموقع.'}
              </div>
            )}

            <div className="flex gap-3 pt-1">
              <button onClick={handleSubmit} disabled={submitting || !outcome}
                className="flex-1 py-2.5 bg-indigo-600 text-white rounded-xl font-bold text-sm hover:bg-indigo-500 disabled:opacity-50 flex items-center justify-center gap-2 transition-colors">
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wrench className="w-4 h-4" />}
                {submitting ? 'جارٍ الحفظ...' : 'حفظ النتيجة'}
              </button>
              {saved && (
                <button type="button" onClick={() => { setShowForm(false); setError(null); }}
                  className="px-4 py-2.5 border border-slate-200 text-slate-600 rounded-xl font-bold text-sm hover:bg-slate-50 transition-colors">
                  إلغاء
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="text-center py-12 text-slate-400">
      <Wrench className="w-12 h-12 mx-auto mb-3 opacity-30" />
      <p className="text-base font-bold">لم يتم تسجيل نتيجة بعد</p>
      <p className="text-xs mt-1">تُسجَّل النتيجة من قِبل الفني الميداني أثناء الزيارة</p>
    </div>
  );
}
