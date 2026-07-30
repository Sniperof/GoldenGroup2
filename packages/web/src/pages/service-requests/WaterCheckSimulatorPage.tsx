import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Beaker, CheckCircle2, MapPin, Send } from 'lucide-react';
import type { GeoUnit } from '@golden-crm/shared';
import { api } from '../../lib/api';
import { useAuthStore } from '../../hooks/useAuthStore';
import Input from '../../components/ui/Input';
import Select from '../../components/ui/Select';
import PageHeader from '../../components/ui/PageHeader';
import MapPicker from '../../components/MapPicker';

type SubmissionMode = 'for_self' | 'for_another';

interface FormState {
  submissionMode: SubmissionMode;
  firstName: string;
  lastName: string;
  phoneNumber: string;
  primaryPhoneHasWhatsapp: boolean;
  secondaryPhone: string;
  secondaryPhoneHasWhatsapp: boolean;
  governorateId: number | null;
  regionId: number | null;
  subdistrictId: number | null;
  neighborhoodId: number | null;
  detailedAddress: string;
  mapLocation: { lat: number; lng: number } | null;
  notes: string;

  // Mediator (وسيط) — only when submissionMode === 'for_another'. Data is
  // captured ONLY after the mediator opts in (shareMediatorData).
  shareMediatorData: boolean;
  mediatorFirstName: string;
  mediatorLastName: string;
  mediatorPhone: string;
  mediatorPhoneHasWhatsapp: boolean;
  mediatorOccupation: string;
  mediatorGovernorateId: number | null;
  mediatorRegionId: number | null;
  mediatorSubdistrictId: number | null;
  mediatorNeighborhoodId: number | null;
  mediatorDetailedAddress: string;
  mediatorNotes: string;
}

const BRANCH_RESOLUTION_LABELS: Record<string, string> = {
  resolved: 'تم ربط الطلب بفرع تلقائياً',
  ambiguous: 'يحتاج مراجعة: أكثر من فرع يغطي المنطقة',
  no_coverage: 'يحتاج مراجعة: لا توجد تغطية فرع مطابقة',
  missing_geo: 'يحتاج مراجعة: الموقع الجغرافي غير كاف',
  not_applicable: 'غير مطبق',
};

function getUserField(user: unknown, keys: string[]): string {
  if (!user || typeof user !== 'object') return '';
  const record = user as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function isValidPhone(value: string): boolean {
  return /^\d{10}$/.test(value.replace(/\D/g, ''));
}

function optionList(items: GeoUnit[], placeholder: string) {
  return [
    { value: 0, label: placeholder },
    ...items.map((item) => ({ value: item.id, label: item.name })),
  ];
}

export default function WaterCheckSimulatorPage() {
  const navigate = useNavigate();
  const authUser = useAuthStore((s) => s.user);
  const [geoUnits, setGeoUnits] = useState<GeoUnit[]>([]);
  const [loadingGeo, setLoadingGeo] = useState(true);
  const [occupations, setOccupations] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<any | null>(null);
  const [form, setForm] = useState<FormState>({
    submissionMode: 'for_self',
    firstName: getUserField(authUser, ['firstName', 'first_name']),
    lastName: getUserField(authUser, ['lastName', 'last_name']),
    phoneNumber: getUserField(authUser, ['mobile', 'phone', 'phoneNumber']),
    primaryPhoneHasWhatsapp: true,
    secondaryPhone: '',
    secondaryPhoneHasWhatsapp: false,
    governorateId: null,
    regionId: null,
    subdistrictId: null,
    neighborhoodId: null,
    detailedAddress: getUserField(authUser, ['detailedAddress', 'address']),
    mapLocation: null,
    notes: '',
    shareMediatorData: false,
    mediatorFirstName: '',
    mediatorLastName: '',
    mediatorPhone: '',
    mediatorPhoneHasWhatsapp: false,
    mediatorOccupation: '',
    mediatorGovernorateId: null,
    mediatorRegionId: null,
    mediatorSubdistrictId: null,
    mediatorNeighborhoodId: null,
    mediatorDetailedAddress: '',
    mediatorNotes: '',
  });

  useEffect(() => {
    let mounted = true;
    setLoadingGeo(true);
    api.geoUnits.names()
      .then((rows) => {
        if (mounted) setGeoUnits(rows as GeoUnit[]);
      })
      .catch((err) => {
        if (mounted) setError(err?.message ?? 'تعذر تحميل المناطق');
      })
      .finally(() => {
        if (mounted) setLoadingGeo(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    api.systemLists.list({ category: 'occupation', activeOnly: true })
      .then((rows: any[]) => {
        if (mounted) setOccupations((Array.isArray(rows) ? rows : []).map((r) => String(r.value)).filter(Boolean));
      })
      .catch(() => { if (mounted) setOccupations([]); });
    return () => { mounted = false; };
  }, []);

  const governorates = useMemo(
    () => geoUnits.filter((unit) => unit.level === 1),
    [geoUnits],
  );
  const regions = useMemo(
    () => geoUnits.filter((unit) => unit.parentId === form.governorateId && unit.level === 2),
    [geoUnits, form.governorateId],
  );
  const subdistricts = useMemo(
    () => geoUnits.filter((unit) => unit.parentId === form.regionId && unit.level === 3),
    [geoUnits, form.regionId],
  );
  const neighborhoods = useMemo(
    () => geoUnits.filter((unit) => unit.parentId === form.subdistrictId && unit.level === 4),
    [geoUnits, form.subdistrictId],
  );

  const mediatorRegions = useMemo(
    () => geoUnits.filter((unit) => unit.parentId === form.mediatorGovernorateId && unit.level === 2),
    [geoUnits, form.mediatorGovernorateId],
  );
  const mediatorSubdistricts = useMemo(
    () => geoUnits.filter((unit) => unit.parentId === form.mediatorRegionId && unit.level === 3),
    [geoUnits, form.mediatorRegionId],
  );
  const mediatorNeighborhoods = useMemo(
    () => geoUnits.filter((unit) => unit.parentId === form.mediatorSubdistrictId && unit.level === 4),
    [geoUnits, form.mediatorSubdistrictId],
  );

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function setSubmissionMode(mode: SubmissionMode) {
    setForm((current) => {
      if (mode === current.submissionMode) return current;
      if (mode === 'for_another') {
        // Beneficiary is a different person → clear the pre-filled identity.
        return { ...current, submissionMode: mode, firstName: '', lastName: '', phoneNumber: '' };
      }
      // Back to "for self" → drop mediator data and restore submitter as beneficiary.
      return {
        ...current,
        submissionMode: mode,
        shareMediatorData: false,
        mediatorFirstName: '', mediatorLastName: '', mediatorPhone: '', mediatorPhoneHasWhatsapp: false,
        mediatorOccupation: '',
        mediatorGovernorateId: null, mediatorRegionId: null, mediatorSubdistrictId: null, mediatorNeighborhoodId: null,
        mediatorDetailedAddress: '', mediatorNotes: '',
        firstName: getUserField(authUser, ['firstName', 'first_name']),
        lastName: getUserField(authUser, ['lastName', 'last_name']),
        phoneNumber: getUserField(authUser, ['mobile', 'phone', 'phoneNumber']),
      };
    });
  }

  function setShareMediatorData(share: boolean) {
    setForm((current) => {
      if (!share) {
        return {
          ...current,
          shareMediatorData: false,
          mediatorFirstName: '', mediatorLastName: '', mediatorPhone: '',
          mediatorOccupation: '', mediatorAddress: '', mediatorNotes: '',
        };
      }
      // Opt-in → prefill from the logged-in submitter (editable).
      return {
        ...current,
        shareMediatorData: true,
        mediatorFirstName: current.mediatorFirstName || getUserField(authUser, ['firstName', 'first_name']),
        mediatorLastName: current.mediatorLastName || getUserField(authUser, ['lastName', 'last_name']),
        mediatorPhone: current.mediatorPhone || getUserField(authUser, ['mobile', 'phone', 'phoneNumber']),
      };
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setResult(null);

    const missing: string[] = [];
    if (!form.firstName.trim()) missing.push('الاسم الأول');
    if (!form.lastName.trim()) missing.push('الكنية');
    if (!form.phoneNumber.trim()) missing.push('رقم الهاتف');
    if (!form.governorateId) missing.push('المحافظة');
    if (!form.detailedAddress.trim()) missing.push('العنوان التفصيلي');
    if (missing.length > 0) {
      setError(`الحقول المطلوبة: ${missing.join('، ')}`);
      return;
    }

    if (!isValidPhone(form.phoneNumber)) {
      setError('رقم الهاتف يجب أن يتكون من 10 أرقام.');
      return;
    }
    if (form.secondaryPhone.trim() && !isValidPhone(form.secondaryPhone)) {
      setError('الرقم الثانوي يجب أن يتكون من 10 أرقام.');
      return;
    }
    if (form.submissionMode === 'for_another' && form.shareMediatorData) {
      const mMissing: string[] = [];
      if (!form.mediatorFirstName.trim()) mMissing.push('اسم الوسيط الأول');
      if (!form.mediatorLastName.trim()) mMissing.push('كنية الوسيط');
      if (!form.mediatorPhone.trim()) mMissing.push('رقم هاتف الوسيط');
      if (!form.mediatorGovernorateId) mMissing.push('محافظة الوسيط');
      if (mMissing.length > 0) {
        setError(`حقول الوسيط المطلوبة: ${mMissing.join('، ')}`);
        return;
      }
      if (!isValidPhone(form.mediatorPhone)) {
        setError('رقم هاتف الوسيط يجب أن يتكون من 10 أرقام.');
        return;
      }
    }

    setSubmitting(true);
    try {
      const response = await api.serviceRequests.createWaterCheck({
        ...form,
        applicationSource: 'water_check_simulator',
      });
      setResult(response);
    } catch (err: any) {
      setError(err?.message ?? 'فشل إرسال الطلب');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl p-4" dir="rtl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <PageHeader
          title="محاكاة طلب فحص المياه"
          icon={<Beaker className="h-6 w-6 text-sky-600" />}
        />
        <button
          type="button"
          onClick={() => navigate('/service-requests/water-check')}
          className="inline-flex items-center gap-1.5 rounded border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          <ArrowRight className="h-4 w-4" />
          جدول الاستقبال
        </button>
      </div>

      <form onSubmit={handleSubmit} className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <section className="rounded border border-slate-200 bg-white p-4">
          {/* Submission path — for self or on behalf of another person */}
          <div className="mb-4">
            <div className="mb-2 text-base font-semibold text-slate-700">لمن هذا الطلب؟</div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setSubmissionMode('for_self')}
                className={`rounded-lg border px-4 py-2 text-sm font-semibold transition-colors ${
                  form.submissionMode === 'for_self'
                    ? 'border-sky-500 bg-sky-50 text-sky-700'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                الطلب لنفسي
              </button>
              <button
                type="button"
                onClick={() => setSubmissionMode('for_another')}
                className={`rounded-lg border px-4 py-2 text-sm font-semibold transition-colors ${
                  form.submissionMode === 'for_another'
                    ? 'border-sky-500 bg-sky-50 text-sky-700'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                الطلب لشخص آخر
              </button>
            </div>
          </div>

          <div className="mb-2 text-sm font-bold text-slate-500">
            {form.submissionMode === 'for_another' ? 'بيانات صاحب الطلب (المستفيد)' : 'بياناتك'}
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Input
              label="الاسم الأول"
              required
              value={form.firstName}
              onChange={(event) => setField('firstName', event.target.value)}
            />
            <Input
              label="الكنية"
              required
              value={form.lastName}
              onChange={(event) => setField('lastName', event.target.value)}
            />
            <div className="space-y-2">
              <Input
                label="رقم الهاتف"
                required
                value={form.phoneNumber}
                onChange={(event) => setField('phoneNumber', event.target.value)}
                dir="ltr"
              />
              <label className="flex items-center gap-2 text-sm text-slate-600">
                <input
                  type="checkbox"
                  checked={form.primaryPhoneHasWhatsapp}
                  onChange={(event) => setField('primaryPhoneHasWhatsapp', event.target.checked)}
                />
                الرقم لديه واتساب
              </label>
            </div>
            <div className="space-y-2">
              <Input
                label="رقم ثانوي"
                value={form.secondaryPhone}
                onChange={(event) => setField('secondaryPhone', event.target.value)}
                dir="ltr"
              />
              <label className="flex items-center gap-2 text-sm text-slate-600">
                <input
                  type="checkbox"
                  checked={form.secondaryPhoneHasWhatsapp}
                  onChange={(event) => setField('secondaryPhoneHasWhatsapp', event.target.checked)}
                  disabled={!form.secondaryPhone.trim()}
                />
                الرقم الثانوي لديه واتساب
              </label>
            </div>

            <div>
              <label className="mb-1.5 block text-base font-semibold text-slate-700">
                المحافظة <span className="ms-1 text-red-500">*</span>
              </label>
              <Select<number>
                value={form.governorateId ?? 0}
                onChange={(value) => setForm((current) => ({
                  ...current,
                  governorateId: value || null,
                  regionId: null,
                  subdistrictId: null,
                  neighborhoodId: null,
                }))}
                options={optionList(governorates, loadingGeo ? 'جاري التحميل...' : 'اختر المحافظة')}
                disabled={loadingGeo}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-base font-semibold text-slate-700">المنطقة</label>
              <Select<number>
                value={form.regionId ?? 0}
                onChange={(value) => setForm((current) => ({
                  ...current,
                  regionId: value || null,
                  subdistrictId: null,
                  neighborhoodId: null,
                }))}
                options={optionList(regions, 'اختر المنطقة')}
                disabled={!form.governorateId || regions.length === 0}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-base font-semibold text-slate-700">الناحية</label>
              <Select<number>
                value={form.subdistrictId ?? 0}
                onChange={(value) => setForm((current) => ({
                  ...current,
                  subdistrictId: value || null,
                  neighborhoodId: null,
                }))}
                options={optionList(subdistricts, 'اختر الناحية')}
                disabled={!form.regionId || subdistricts.length === 0}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-base font-semibold text-slate-700">الحي</label>
              <Select<number>
                value={form.neighborhoodId ?? 0}
                onChange={(value) => setField('neighborhoodId', value || null)}
                options={optionList(neighborhoods, 'اختر الحي')}
                disabled={!form.subdistrictId || neighborhoods.length === 0}
              />
            </div>
          </div>

          <div className="mt-4 grid gap-4">
            <label className="block">
              <span className="mb-1.5 block text-base font-semibold text-slate-700">
                العنوان التفصيلي <span className="ms-1 text-red-500">*</span>
              </span>
              <textarea
                value={form.detailedAddress}
                onChange={(event) => setField('detailedAddress', event.target.value)}
                rows={3}
                className="w-full rounded border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none focus:border-sky-500"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-base font-semibold text-slate-700">ملاحظات</span>
              <textarea
                value={form.notes}
                onChange={(event) => setField('notes', event.target.value)}
                rows={3}
                className="w-full rounded border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none focus:border-sky-500"
              />
            </label>
          </div>

          {form.submissionMode === 'for_another' && (
            <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50/50 p-4">
              <div className="mb-1 text-base font-semibold text-slate-700">بيانات الوسيط</div>
              <p className="mb-3 text-sm text-slate-500">
                أنت مُرسِل هذا الطلب نيابةً عن شخص آخر، لذا تُعتبر وسيطاً لهذا الزبون. يمكنك اختيار مشاركة بياناتك.
              </p>
              <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                <input
                  type="checkbox"
                  checked={form.shareMediatorData}
                  onChange={(event) => setShareMediatorData(event.target.checked)}
                />
                أوافق على مشاركة بياناتي كوسيط
              </label>

              {form.shareMediatorData && (
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <Input
                    label="الاسم الأول"
                    required
                    value={form.mediatorFirstName}
                    onChange={(event) => setField('mediatorFirstName', event.target.value)}
                  />
                  <Input
                    label="الكنية"
                    required
                    value={form.mediatorLastName}
                    onChange={(event) => setField('mediatorLastName', event.target.value)}
                  />
                  <div className="space-y-2">
                    <Input
                      label="رقم الهاتف"
                      required
                      value={form.mediatorPhone}
                      onChange={(event) => setField('mediatorPhone', event.target.value)}
                      dir="ltr"
                    />
                    <label className="flex items-center gap-2 text-sm text-slate-600">
                      <input
                        type="checkbox"
                        checked={form.mediatorPhoneHasWhatsapp}
                        onChange={(event) => setField('mediatorPhoneHasWhatsapp', event.target.checked)}
                      />
                      الرقم لديه واتساب
                    </label>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-base font-semibold text-slate-700">المهنة</label>
                    <Select
                      value={form.mediatorOccupation}
                      onChange={(value) => setField('mediatorOccupation', value)}
                      ariaLabel="مهنة الوسيط"
                      options={[{ value: '', label: 'اختر المهنة' }, ...occupations.map((o) => ({ value: o, label: o }))]}
                    />
                  </div>

                  <div>
                    <label className="mb-1.5 block text-base font-semibold text-slate-700">
                      المحافظة <span className="ms-1 text-red-500">*</span>
                    </label>
                    <Select<number>
                      value={form.mediatorGovernorateId ?? 0}
                      onChange={(value) => setForm((current) => ({
                        ...current,
                        mediatorGovernorateId: value || null,
                        mediatorRegionId: null,
                        mediatorSubdistrictId: null,
                        mediatorNeighborhoodId: null,
                      }))}
                      options={optionList(governorates, loadingGeo ? 'جاري التحميل...' : 'اختر المحافظة')}
                      disabled={loadingGeo}
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-base font-semibold text-slate-700">المنطقة</label>
                    <Select<number>
                      value={form.mediatorRegionId ?? 0}
                      onChange={(value) => setForm((current) => ({
                        ...current,
                        mediatorRegionId: value || null,
                        mediatorSubdistrictId: null,
                        mediatorNeighborhoodId: null,
                      }))}
                      options={optionList(mediatorRegions, 'اختر المنطقة')}
                      disabled={!form.mediatorGovernorateId || mediatorRegions.length === 0}
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-base font-semibold text-slate-700">الناحية</label>
                    <Select<number>
                      value={form.mediatorSubdistrictId ?? 0}
                      onChange={(value) => setForm((current) => ({
                        ...current,
                        mediatorSubdistrictId: value || null,
                        mediatorNeighborhoodId: null,
                      }))}
                      options={optionList(mediatorSubdistricts, 'اختر الناحية')}
                      disabled={!form.mediatorRegionId || mediatorSubdistricts.length === 0}
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-base font-semibold text-slate-700">الحي</label>
                    <Select<number>
                      value={form.mediatorNeighborhoodId ?? 0}
                      onChange={(value) => setField('mediatorNeighborhoodId', value || null)}
                      options={optionList(mediatorNeighborhoods, 'اختر الحي')}
                      disabled={!form.mediatorSubdistrictId || mediatorNeighborhoods.length === 0}
                    />
                  </div>

                  <label className="block md:col-span-2">
                    <span className="mb-1.5 block text-base font-semibold text-slate-700">العنوان التفصيلي</span>
                    <textarea
                      value={form.mediatorDetailedAddress}
                      onChange={(event) => setField('mediatorDetailedAddress', event.target.value)}
                      rows={2}
                      className="w-full rounded border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none focus:border-sky-500"
                    />
                  </label>
                  <label className="block md:col-span-2">
                    <span className="mb-1.5 block text-base font-semibold text-slate-700">ملاحظات الوسيط</span>
                    <textarea
                      value={form.mediatorNotes}
                      onChange={(event) => setField('mediatorNotes', event.target.value)}
                      rows={2}
                      className="w-full rounded border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none focus:border-sky-500"
                    />
                  </label>
                </div>
              )}
            </div>
          )}
        </section>

        <aside className="space-y-4">
          <section className="rounded border border-slate-200 bg-white p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-700">
              <MapPin className="h-4 w-4 text-sky-600" />
              موقع الخريطة
            </div>
            <MapPicker
              position={form.mapLocation ? [form.mapLocation.lat, form.mapLocation.lng] : null}
              onLocationSelect={(lat, lng) => setField('mapLocation', lat === 0 && lng === 0 ? null : { lat, lng })}
            />
          </section>

          <section className="rounded border border-slate-200 bg-white p-4">
            {error && (
              <div className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            )}
            {result && (
              <div className="mb-3 space-y-2 rounded bg-emerald-50 px-3 py-3 text-sm text-emerald-800">
                <div className="flex items-center gap-2 font-semibold">
                  <CheckCircle2 className="h-4 w-4" />
                  تم إرسال الطلب
                </div>
                <div dir="ltr" className="font-mono text-xs">{result.publicRefNumber}</div>
                <div>{BRANCH_RESOLUTION_LABELS[result.branchResolution?.status] ?? result.branchResolution?.status}</div>
              </div>
            )}
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex w-full items-center justify-center gap-2 rounded bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Send className="h-4 w-4" />
              {submitting ? 'جاري الإرسال...' : 'إرسال الطلب'}
            </button>
            {result && (
              <button
                type="button"
                onClick={() => navigate(`/service-requests/${result.id}`)}
                className="mt-2 inline-flex w-full items-center justify-center rounded border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                فتح الطلب
              </button>
            )}
          </section>
        </aside>
      </form>
    </div>
  );
}
