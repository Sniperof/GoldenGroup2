import { useState, useEffect } from 'react';
import { Loader2, CheckCircle2, AlertCircle, Truck, ClipboardList, MapPin, ExternalLink } from 'lucide-react';
import { api } from '../../lib/api';
import { formatDate } from '../../components/tasks/shared';
import GeoSmartSearch from '../../components/GeoSmartSearch';
import type { GeoSelection } from '../../components/GeoSmartSearch';
import type { GeoUnit } from '../../lib/types';

const OUTCOME_OPTIONS = [
  { value: 'delivered_successfully', label: 'تم التسليم بنجاح' },
  { value: 'customer_not_available', label: 'الزبون غير متوفر' },
  { value: 'wrong_address',          label: 'عنوان خاطئ' },
  { value: 'refused_delivery',       label: 'رفض الاستلام' },
];

const CONDITION_OPTIONS = [
  { value: 'perfect',              label: 'سليم وممتاز' },
  { value: 'minor_damage',         label: 'ضرر طفيف' },
  { value: 'missing_accessories',  label: 'نقص ملحقات' },
];

const OUTCOME_LABELS: Record<string, string> = {
  delivered_successfully: 'تم التسليم بنجاح',
  customer_not_available: 'الزبون غير متوفر',
  wrong_address:          'عنوان خاطئ',
  refused_delivery:       'رفض الاستلام',
};

const CONDITION_LABELS: Record<string, string> = {
  perfect:             'سليم وممتاز',
  minor_damage:        'ضرر طفيف',
  missing_accessories: 'نقص ملحقات',
};

const EMPTY_GEO: GeoSelection = { govId: '', regionId: '', subId: '', neighborhoodId: '' };

interface DeliveryResultFormProps {
  taskId: number;
  readOnly?: boolean;
  onSaved?: () => void;
}

export default function DeliveryResultForm({ taskId, readOnly = false, onSaved }: DeliveryResultFormProps) {
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState<any>(null);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [geoUnits, setGeoUnits] = useState<GeoUnit[]>([]);

  const [outcome, setOutcome] = useState('');
  const [serialNumber, setSerialNumber] = useState('');
  const [deliveryCondition, setDeliveryCondition] = useState('');
  const [geoAddress, setGeoAddress] = useState<GeoSelection>(EMPTY_GEO);
  const [detailedAddress, setDetailedAddress] = useState('');
  const [deliveryLat, setDeliveryLat] = useState('');
  const [deliveryLng, setDeliveryLng] = useState('');
  const [actualDeliveryDate, setActualDeliveryDate] = useState(
    new Date().toISOString().slice(0, 10)
  );
  const [customerAcknowledged, setCustomerAcknowledged] = useState(false);
  const [notes, setNotes] = useState('');

  useEffect(() => {
    Promise.all([
      api.openTasks.getDeliveryResult(taskId).catch(() => null),
      api.geoUnits.list().catch(() => []),
    ]).then(([resultData, geoData]) => {
      setSaved(resultData);
      setGeoUnits(Array.isArray(geoData) ? geoData : []);
    }).finally(() => setLoading(false));
  }, [taskId]);

  const isSuccess = outcome === 'delivered_successfully';
  const hasNewAddress = geoAddress.neighborhoodId || detailedAddress || deliveryLat;

  const buildAddressText = () => {
    const parts: string[] = [];
    const findName = (id: string) => geoUnits.find(u => u.id.toString() === id)?.name ?? '';
    if (geoAddress.govId)          parts.push(findName(geoAddress.govId));
    if (geoAddress.regionId)       parts.push(findName(geoAddress.regionId));
    if (geoAddress.subId)          parts.push(findName(geoAddress.subId));
    if (geoAddress.neighborhoodId) parts.push(findName(geoAddress.neighborhoodId));
    if (detailedAddress.trim())    parts.push(detailedAddress.trim());
    return parts.join(' - ') || null;
  };

  const handleSubmit = async () => {
    if (!outcome) { setError('يرجى اختيار نتيجة التسليم'); return; }
    if (isSuccess && !serialNumber.trim()) { setError('الرقم التسلسلي مطلوب عند نجاح التسليم'); return; }
    if (isSuccess && !deliveryCondition) { setError('حالة الجهاز مطلوبة عند نجاح التسليم'); return; }
    if (hasNewAddress && !geoAddress.neighborhoodId) {
      setError('يجب تحديد الحي على الأقل عند توثيق عنوان تسليم مختلف');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const addressText = buildAddressText();
      const lat = deliveryLat ? parseFloat(deliveryLat) : null;
      const lng = deliveryLng ? parseFloat(deliveryLng) : null;

      const result = await api.openTasks.saveDeliveryResult(taskId, {
        outcome,
        serialNumber: serialNumber.trim() || null,
        deliveryCondition: deliveryCondition || null,
        deliveryAddress: addressText,
        deliveryLat: lat,
        deliveryLng: lng,
        actualDeliveryDate: actualDeliveryDate || null,
        customerAcknowledged,
        notes: notes.trim() || null,
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

  const openEditForm = () => {
    if (!saved) return;
    setOutcome(saved.outcome ?? '');
    setSerialNumber(saved.serialNumber ?? '');
    setDeliveryCondition(saved.deliveryCondition ?? '');
    setActualDeliveryDate(saved.actualDeliveryDate ?? new Date().toISOString().slice(0, 10));
    setCustomerAcknowledged(saved.customerAcknowledged ?? false);
    setNotes(saved.notes ?? '');
    setGeoAddress(EMPTY_GEO);
    setDetailedAddress('');
    setDeliveryLat(saved.deliveryLat ? String(saved.deliveryLat) : '');
    setDeliveryLng(saved.deliveryLng ? String(saved.deliveryLng) : '');
    setShowForm(true);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10 text-slate-400">
        <Loader2 className="w-6 h-6 animate-spin ml-2" />
        <span className="text-sm">جارٍ التحميل...</span>
      </div>
    );
  }

  // ─── عرض النتيجة المحفوظة ───────────────────────────────────────────────
  if (saved && !showForm) {
    const isSuccessOutcome = saved.outcome === 'delivered_successfully';
    const gpsUrl = saved.deliveryLat && saved.deliveryLng
      ? `https://www.google.com/maps?q=${saved.deliveryLat},${saved.deliveryLng}`
      : null;

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
                <p className="text-xs text-slate-400">{formatDate(saved.actualDeliveryDate || saved.createdAt)}</p>
              </div>
            </div>
            {!readOnly && (
              <button onClick={openEditForm} className="text-xs text-slate-500 hover:text-sky-600 border border-slate-200 hover:border-sky-300 px-3 py-1.5 rounded-lg transition-colors">
                تعديل
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2 border-t border-slate-100 pt-4 text-sm">
            {saved.serialNumber && (
              <div className="flex justify-between"><span className="text-xs text-slate-400 font-bold">الرقم التسلسلي</span><span className="font-mono">{saved.serialNumber}</span></div>
            )}
            {saved.deliveryCondition && (
              <div className="flex justify-between"><span className="text-xs text-slate-400 font-bold">حالة الجهاز</span><span>{CONDITION_LABELS[saved.deliveryCondition] ?? saved.deliveryCondition}</span></div>
            )}
            <div className="flex justify-between">
              <span className="text-xs text-slate-400 font-bold">إقرار الزبون</span>
              <span className={`text-xs font-bold px-2 py-0.5 rounded ${saved.customerAcknowledged ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' : 'bg-slate-100 text-slate-500 border border-slate-200'}`}>
                {saved.customerAcknowledged ? 'موقع' : 'غير موقع'}
              </span>
            </div>
            {saved.deliveredByName && (
              <div className="flex justify-between"><span className="text-xs text-slate-400 font-bold">مسلّم من</span><span>{saved.deliveredByName}</span></div>
            )}
            {saved.deliveryAddress && (
              <div className="md:col-span-2">
                <span className="text-xs text-slate-400 font-bold block mb-1">عنوان التسليم الفعلي</span>
                <p className="text-sm text-slate-700 bg-slate-50 rounded-lg px-3 py-2 border border-slate-100">{saved.deliveryAddress}</p>
              </div>
            )}
            {gpsUrl && (
              <div className="md:col-span-2">
                <a href={gpsUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-sky-50 border border-sky-200 text-sky-700 text-xs font-bold hover:bg-sky-100 transition-colors">
                  <MapPin className="w-3.5 h-3.5" />
                  فتح الخريطة
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            )}
            {saved.notes && (
              <div className="md:col-span-2">
                <span className="text-xs text-slate-400 font-bold block mb-1">ملاحظات</span>
                <p className="text-sm text-slate-700 bg-slate-50 rounded-lg p-2.5 border border-slate-100">{saved.notes}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ─── نموذج التسجيل ──────────────────────────────────────────────────────
  if (!readOnly || showForm) {
    return (
      <div className="space-y-4" dir="rtl">
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <h3 className="text-base font-bold text-slate-800 mb-5 flex items-center gap-2">
            <ClipboardList className="w-5 h-5 text-sky-500" />
            {saved ? 'تعديل نتيجة التسليم' : 'تسجيل نتيجة التسليم'}
          </h3>

          <div className="space-y-5">
            {/* النتيجة */}
            <div>
              <label className="block text-xs font-bold text-slate-600 mb-2">نتيجة الزيارة <span className="text-rose-500">*</span></label>
              <div className="grid grid-cols-2 gap-2">
                {OUTCOME_OPTIONS.map(opt => (
                  <button key={opt.value} type="button" onClick={() => setOutcome(opt.value)}
                    className={`px-3 py-2.5 rounded-xl border text-sm font-bold text-right transition-colors ${outcome === opt.value ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'}`}>
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* حقول النجاح */}
            {isSuccess && (
              <>
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1.5">الرقم التسلسلي <span className="text-rose-500">*</span></label>
                  <input type="text" value={serialNumber} onChange={e => setSerialNumber(e.target.value)}
                    placeholder="أدخل الرقم التسلسلي المكتوب على الجهاز" dir="ltr"
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1.5">حالة الجهاز عند التسليم <span className="text-rose-500">*</span></label>
                  <div className="flex gap-2">
                    {CONDITION_OPTIONS.map(opt => (
                      <button key={opt.value} type="button" onClick={() => setDeliveryCondition(opt.value)}
                        className={`flex-1 px-3 py-2 rounded-xl border text-xs font-bold transition-colors ${deliveryCondition === opt.value ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'}`}>
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1.5">تاريخ التسليم الفعلي</label>
                  <input type="date" value={actualDeliveryDate} onChange={e => setActualDeliveryDate(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" dir="ltr" />
                </div>

                <label className="flex items-center gap-3 cursor-pointer">
                  <input type="checkbox" checked={customerAcknowledged} onChange={e => setCustomerAcknowledged(e.target.checked)} className="w-4 h-4 accent-indigo-600" />
                  <span className="text-sm font-bold text-slate-700">إقرار الزبون / التوقيع على الاستلام</span>
                </label>
              </>
            )}

            {/* عنوان التسليم الفعلي — GeoSmart */}
            <div className="border border-slate-200 rounded-xl p-4 space-y-3 bg-slate-50/50">
              <p className="text-xs font-bold text-slate-600 flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-sky-500" />
                عنوان التسليم الفعلي
                <span className="text-slate-400 font-normal">(اختياري — إن اختلف عن عنوان العقد)</span>
              </p>
              <GeoSmartSearch
                geoUnits={geoUnits}
                value={geoAddress}
                onChange={setGeoAddress}
                placeholder="ابحث عن الحي أو المنطقة..."
                minSelectableLevel={4}
                required={false}
              />
              {geoAddress.neighborhoodId && (
                <>
                  <input type="text" value={detailedAddress} onChange={e => setDetailedAddress(e.target.value)}
                    placeholder="العنوان التفصيلي (الشارع، المبنى، الطابق...)"
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white" />
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 mb-1">خط العرض (Lat)</label>
                      <input type="number" step="any" value={deliveryLat} onChange={e => setDeliveryLat(e.target.value)}
                        placeholder="مثال: 33.510"
                        className="w-full rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white" dir="ltr" />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 mb-1">خط الطول (Lng)</label>
                      <input type="number" step="any" value={deliveryLng} onChange={e => setDeliveryLng(e.target.value)}
                        placeholder="مثال: 36.291"
                        className="w-full rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white" dir="ltr" />
                    </div>
                  </div>
                  {deliveryLat && deliveryLng && (
                    <a
                      href={`https://www.google.com/maps?q=${deliveryLat},${deliveryLng}`}
                      target="_blank" rel="noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs text-sky-600 font-bold hover:underline"
                    >
                      <ExternalLink className="w-3 h-3" />
                      معاينة على الخريطة
                    </a>
                  )}
                </>
              )}
            </div>

            {/* ملاحظات */}
            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1.5">ملاحظات (اختياري)</label>
              <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
                placeholder="سبب الرفض، ملاحظات الفني، أي تفاصيل إضافية..."
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none" />
            </div>

            {error && (
              <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-xl px-4 py-3 text-sm">{error}</div>
            )}

            {outcome && (
              <div className={`rounded-xl p-3 text-xs font-bold border ${isSuccess ? 'bg-emerald-50 border-emerald-100 text-emerald-700' : outcome === 'refused_delivery' ? 'bg-rose-50 border-rose-100 text-rose-700' : 'bg-amber-50 border-amber-100 text-amber-700'}`}>
                {isSuccess && 'ستُغلق المهمة كمكتملة وينشئ النظام تلقائياً مهمة تركيب الجهاز.'}
                {outcome === 'customer_not_available' && 'ستُغلق المهمة كمكتملة وتُنشأ مهمة تسليم جديدة للمتابعة.'}
                {outcome === 'wrong_address' && 'ستُغلق المهمة كمكتملة وتُنشأ مهمة تسليم جديدة. يُرجى تحديث عنوان الزبون.'}
                {outcome === 'refused_delivery' && 'ستُغلق المهمة كمكتملة. قرار الاستمرار أو الإلغاء يعود للمشرف.'}
              </div>
            )}

            <div className="flex gap-3 pt-1">
              <button onClick={handleSubmit} disabled={submitting || !outcome}
                className="flex-1 py-2.5 bg-indigo-600 text-white rounded-xl font-bold text-sm hover:bg-indigo-500 disabled:opacity-50 flex items-center justify-center gap-2 transition-colors">
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Truck className="w-4 h-4" />}
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
      <Truck className="w-12 h-12 mx-auto mb-3 opacity-30" />
      <p className="text-base font-bold">لم يتم تسجيل نتيجة بعد</p>
      <p className="text-xs mt-1">تُسجَّل النتيجة من قِبل الفني الميداني أثناء الزيارة</p>
    </div>
  );
}
