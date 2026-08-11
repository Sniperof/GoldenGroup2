import { useEffect, useMemo, useState } from 'react';
import { ArrowUpCircle, Beaker, CheckCircle2, ExternalLink, Link2, MapPin, User, AlertTriangle } from 'lucide-react';
import type { GeoUnit } from '@golden-crm/shared';
import { api } from '../../lib/api';
import Button from '../ui/Button';

function readText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * The geo path, preferring the labels snapshotted on the request at submit
 * time over a live lookup of the ids. The snapshot is what the customer
 * actually picked; a live lookup silently rewrites history when the geo tree
 * is renamed or reorganised later. Falls back to id resolution for rows
 * written before the labels were stored.
 */
function getGeoPath(address: any, submitted: any, unitsById: Map<number, string>): string {
  const labels = address?.labels;
  if (labels && typeof labels === 'object') {
    const fromLabels = [labels.governorate, labels.city_or_area, labels.sub_area, labels.neighborhood]
      .map(readText).filter(Boolean);
    if (fromLabels.length) return fromLabels.join(' / ');
  }
  return [
    resolveGeoName(unitsById, address?.governorateId ?? address?.governorate ?? submitted?.governorateId),
    resolveGeoName(unitsById, address?.regionId ?? address?.city_or_area ?? submitted?.regionId),
    resolveGeoName(unitsById, address?.subdistrictId ?? address?.sub_area ?? submitted?.subdistrictId),
    resolveGeoName(unitsById, address?.neighborhoodId ?? address?.neighborhood ?? submitted?.neighborhoodId),
  ].filter(Boolean).join(' / ');
}

function getMapLocation(request: any): { lat: number; lng: number } | null {
  const raw = request?.serviceAddress?.mapLocation
    ?? request?.serviceAddress?.location
    ?? request?.submittedPayload?.data?.mapLocation
    ?? request?.beneficiaryExternal?.clientCompatible?.gpsCoordinates
    ?? request?.requesterExternal?.clientCompatible?.gpsCoordinates;
  if (!raw || typeof raw !== 'object') return null;
  const lat = Number((raw as any).lat);
  const lng = Number((raw as any).lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat === 0 && lng === 0) return null;
  return { lat, lng };
}

function resolveGeoName(unitsById: Map<number, string>, value: unknown): string {
  const id = Number(value);
  return Number.isInteger(id) && unitsById.has(id) ? unitsById.get(id)! : '';
}

function Field({ label, value }: { label: string; value: unknown }) {
  const empty = value == null || value === '';
  const text = empty ? '—' : String(value);
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/70 px-3.5 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`mt-1 text-sm font-semibold ${empty ? 'text-slate-300' : 'text-slate-800'}`}>{empty ? 'غير متوفر' : text}</div>
    </div>
  );
}

function LinkStatus({
  clientId,
  clientName,
  required = false,
}: {
  clientId: number | null | undefined;
  clientName?: string | null;
  required?: boolean;
}) {
  const linked = !!clientId;
  return (
    <div className={`flex flex-wrap items-center gap-2 rounded-xl border px-3.5 py-3 ${
      linked
        ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
        : required
          ? 'border-amber-200 bg-amber-50 text-amber-800'
          : 'border-slate-200 bg-slate-50 text-slate-600'
    }`}>
      {linked ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <Link2 className="h-4 w-4 shrink-0" />}
      <div>
        <div className="text-[11px] font-bold uppercase tracking-wide opacity-75">حالة الربط بسجل زبون</div>
        <div className="mt-0.5 text-sm font-bold">
          {linked
            ? `مرتبط: ${clientName ?? `الزبون #${clientId}`}`
            : required
              ? 'غير مرتبط — الربط مطلوب قبل التحويل إلى مهمة'
              : 'غير مرتبط — الربط اختياري'}
        </div>
      </div>
    </div>
  );
}

const TASK_STATUS_LABELS: Record<string, string> = {
  open: 'مفتوحة',
  scheduled: 'مجدولة',
  in_progress: 'قيد التنفيذ',
  completed: 'مكتملة',
  cancelled: 'ملغاة',
  closed: 'مغلقة',
};

const TASK_PRIORITY_LABELS: Record<string, string> = {
  high: 'عالية',
  medium: 'متوسطة',
  low: 'منخفضة',
  Normal: 'عادية',
  normal: 'عادية',
};

function labelFromMap(labels: Record<string, string>, value: unknown): string {
  if (value == null || value === '') return '-';
  const key = String(value);
  return labels[key] ?? key;
}

type HandoffControls = {
  permissionDenied: boolean;
  missing: string[];
  onOpenTask: (id: number) => void;
};

export default function WaterCheckRequestDetailPanel({
  request,
  handoff,
}: {
  request: any;
  handoff?: HandoffControls;
}) {
  const [geoUnits, setGeoUnits] = useState<GeoUnit[]>([]);

  useEffect(() => {
    let mounted = true;
    api.geoUnits.names()
      .then((rows) => {
        if (mounted) setGeoUnits(rows as GeoUnit[]);
      })
      .catch(() => {
        if (mounted) setGeoUnits([]);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const unitsById = useMemo(
    () => new Map(geoUnits.map((unit) => [unit.id, unit.name])),
    [geoUnits],
  );

  const external = request.beneficiaryExternal ?? request.requesterExternal ?? {};
  const submitted = request.submittedPayload?.data ?? {};
  const address = request.serviceAddress ?? {};
  const mapLocation = getMapLocation(request);
  const firstName = readText(external.firstName) || readText(submitted.firstName);
  const lastName = readText(external.lastName) || readText(submitted.lastName);
  const fullName = readText(external.name)
    || [firstName, readText(external.fatherName) || readText(submitted.fatherName), lastName].filter(Boolean).join(' ');
  const primaryPhone = readText(external.primary_phone) || readText(submitted.phoneNumber);
  const secondaryPhone = readText(external.secondary_phone) || readText(submitted.secondaryPhone);
  const notes = readText(external.notes) || readText(submitted.notes);
  const detailedAddress = readText(address.detailedAddress)
    || readText(address.detailed_address)
    || readText(submitted.detailedAddress);

  const geoPath = getGeoPath(address, submitted, unitsById);

  const mediator = (request.referrerExternal && typeof request.referrerExternal === 'object') ? request.referrerExternal : null;
  const requester = (request.requesterExternal && typeof request.requesterExternal === 'object') ? request.requesterExternal : {};
  const requesterName = readText(requester.name)
    || [readText(requester.firstName), readText(requester.fatherName), readText(requester.lastName)].filter(Boolean).join(' ');
  const requesterPhone = readText(requester.primary_phone);
  const requesterSecondaryPhone = readText(requester.secondary_phone);
  const mediatorName = mediator
    ? (readText(mediator.name) || [readText(mediator.firstName), readText(mediator.lastName)].filter(Boolean).join(' '))
    : '';
  const mediatorGeoPath = mediator
    ? [
        resolveGeoName(unitsById, mediator.governorateId),
        resolveGeoName(unitsById, mediator.regionId),
        resolveGeoName(unitsById, mediator.subdistrictId),
        resolveGeoName(unitsById, mediator.neighborhoodId),
      ].filter(Boolean).join(' / ')
    : '';

  const mapUrl = mapLocation
    ? `https://www.openstreetmap.org/export/embed.html?bbox=${mapLocation.lng - 0.01},${mapLocation.lat - 0.005},${mapLocation.lng + 0.01},${mapLocation.lat + 0.005}&layer=mapnik&marker=${mapLocation.lat},${mapLocation.lng}`
    : null;

  return (
    <div className="space-y-4">
      {request.submissionType === 'refer_a_candidate' && (
        <section className="rounded-2xl border border-sky-200 bg-sky-50/40 p-4 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <User className="h-5 w-5 text-sky-600" />
            <h2 className="text-lg font-bold text-slate-800">مقدم الطلب</h2>
          </div>
          <div className="mb-3">
            <LinkStatus clientId={request.requesterClientId} clientName={request.requesterClientName} />
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="الاسم" value={requesterName} />
            <Field label="الهاتف الأساسي" value={requesterPhone ? `${requesterPhone}${requester.primaryPhoneHasWhatsapp ? ' · واتساب' : ''}` : ''} />
            <Field label="الهاتف الثانوي" value={requesterSecondaryPhone ? `${requesterSecondaryPhone}${requester.secondaryPhoneHasWhatsapp ? ' · واتساب' : ''}` : ''} />
            <Field label="مصدر الهوية" value={requester.name_source === 'client_record' ? 'سجل الزبون' : 'بيانات مقدمة'} />
          </div>
        </section>
      )}

      <section className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Beaker className="h-5 w-5 text-sky-600" />
          <h2 className="text-lg font-bold text-slate-800">
            {request.submissionType === 'refer_a_candidate' ? 'المستفيد وبيانات التواصل' : 'مقدم الطلب والمستفيد'}
          </h2>
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
            request.submissionType === 'refer_a_candidate'
              ? 'bg-amber-100 text-amber-700'
              : 'bg-slate-100 text-slate-600'
          }`}>
            {request.submissionType === 'refer_a_candidate' ? 'طلب لعنوان شخص آخر' : 'طلب لعنواني'}
          </span>
        </div>
        <div className="space-y-4">
          <LinkStatus
            clientId={request.beneficiaryClientId}
            clientName={request.beneficiaryClientName}
            required
          />
          <div className="grid gap-3 md:grid-cols-2">
            <Field label={request.submissionType === 'refer_a_candidate' ? 'المستفيد من الفحص' : 'الزبون مقدم الطلب'} value={fullName} />
            <Field label="نوع الطلب (لمن؟)" value={request.submissionType === 'refer_a_candidate' ? 'لعنوان شخص آخر' : 'لعنواني'} />
          </div>

          <div>
            <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">التواصل</div>
            <div className="grid gap-3 md:grid-cols-2">
              <Field
                label="رقم الهاتف الأساسي"
                value={primaryPhone ? `${primaryPhone}${external.primaryPhoneHasWhatsapp ? ' · واتساب' : ''}` : ''}
              />
              <Field
                label="رقم ثانوي"
                value={secondaryPhone ? `${secondaryPhone}${external.secondaryPhoneHasWhatsapp ? ' · واتساب' : ''}` : ''}
              />
              <Field label="ملاحظات الطلب" value={notes} />
            </div>
          </div>
        </div>
      </section>

      {mediator && (
        <section className="rounded-2xl border border-amber-200 bg-amber-50/40 p-4 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <User className="h-5 w-5 text-amber-600" />
            <h2 className="text-lg font-bold text-slate-800">الوسيط (المُحيل)</h2>
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">طلب لشخص آخر</span>
          </div>
          <div className="mb-3">
            <LinkStatus clientId={request.referrerClientId} clientName={request.referrerClientName} />
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="اسم الوسيط" value={mediatorName} />
            <Field label="رقم الهاتف" value={readText(mediator.primary_phone)} />
            <Field label="الهاتف الثانوي" value={readText(mediator.secondary_phone)} />
            <Field label="واتساب" value={mediator.primaryPhoneHasWhatsapp ? 'نعم' : 'لا'} />
            <Field label="المهنة" value={readText(mediator.occupation)} />
            <Field label="المسار الجغرافي" value={mediatorGeoPath} />
            <Field label="العنوان التفصيلي" value={readText(mediator.detailedAddress)} />
            <Field label="ملاحظات الوسيط" value={readText(mediator.notes)} />
            <Field label="وافق على مشاركة بياناته" value={mediator.awarenessOrConsent ? 'نعم' : 'لا'} />
          </div>
          <div className="mt-3 rounded bg-white/60 p-2 text-xs text-amber-800">
            {request.referrerClientId
              ? 'الوسيط مربوط بسجل زبون، وسيُسنَد كمُحيل رسمي (referrer_type=Client) عند إنشاء سجل المستفيد.'
              : 'اربط الوسيط بسجل زبون من تبويب «الربط»؛ عندها يُسنَد كمُحيل رسمي للمستفيد (وإلا يُسجَّل كمُحيل بالاسم فقط).'}
          </div>
        </section>
      )}

      <section className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <MapPin className="h-5 w-5 text-sky-600" />
          <h2 className="text-lg font-bold text-slate-800">العنوان والتغطية</h2>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="المسار الجغرافي" value={geoPath || request.branchResolutionGeoUnitName} />
          <Field label="العنوان التفصيلي" value={detailedAddress} />
          <Field label="الفرع المرتبط" value={request.branchName ?? 'غير محدد'} />
          <Field label="حالة ربط الفرع" value={request.branchResolutionLabel} />
        </div>
        {request.branchResolutionStatus && request.branchResolutionStatus !== 'resolved' && (
          <div className="mt-4 flex items-start gap-2 rounded bg-amber-50 p-3 text-sm text-amber-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{request.branchResolutionReason ?? 'يحتاج الطلب إلى مراجعة ربط الفرع.'}</span>
          </div>
        )}
      </section>

      {mapUrl && (
        <section className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-700">
            <MapPin className="h-4 w-4 text-sky-600" />
            موقع الخريطة
          </div>
          <div className="h-56 overflow-hidden rounded border border-slate-200">
            <iframe
              src={mapUrl}
              className="h-full w-full border-0"
              title="موقع طلب فحص المياه"
              loading="lazy"
            />
          </div>
        </section>
      )}

      {handoff && (
        <section className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <ArrowUpCircle className="h-5 w-5 text-sky-600" />
            <h2 className="text-lg font-bold text-slate-800">التحويل إلى مهمة عرض جهاز</h2>
          </div>

          {request.linkedOpenTaskId ? (
            <div className="rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div className="flex items-center gap-2 font-semibold">
                  <CheckCircle2 className="h-4 w-4 text-emerald-700" />
                  تم تحويل الطلب إلى مهمة عرض جهاز #{request.linkedOpenTaskId}
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={ExternalLink}
                  onClick={() => handoff.onOpenTask(Number(request.linkedOpenTaskId))}
                >
                  فتح المهمة
                </Button>
              </div>
              <div className="mt-3 grid gap-3 border-t border-emerald-200 pt-3 md:grid-cols-3">
                <Field label="نوع المهمة" value="عرض جهاز" />
                <Field label="حالة المهمة" value={labelFromMap(TASK_STATUS_LABELS, request.linkedOpenTaskStatus ?? 'open')} />
                <Field label="الأولوية" value={labelFromMap(TASK_PRIORITY_LABELS, request.linkedOpenTaskPriority)} />
                <Field
                  label="تاريخ الإنشاء"
                  value={request.linkedOpenTaskCreatedAt ? new Date(request.linkedOpenTaskCreatedAt).toLocaleString('ar-SY') : '-'}
                />
                <Field label="الفرع" value={request.branchName ?? '-'} />
                <Field label="الزبون" value={request.beneficiaryClientName ?? (request.beneficiaryClientId ? `#${request.beneficiaryClientId}` : '-')} />
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {handoff.missing.length > 0 && (
                <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                  <div className="mb-1 font-semibold">لا يمكن إنشاء المهمة قبل إكمال:</div>
                  <ul className="list-disc space-y-1 pr-5">
                    {handoff.missing.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}
              {handoff.permissionDenied && handoff.missing.length === 0 && (
                <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                  لا تملك صلاحية إنشاء مهمة ضمن فرع هذا الطلب.
                </div>
              )}
              {!handoff.permissionDenied && handoff.missing.length === 0 && (
                <div className="rounded border border-sky-200 bg-sky-50 p-3 text-sm text-sky-800">
                  الطلب جاهز لإنشاء مهمة عرض جهاز من شريط التحكم.
                </div>
              )}
            </div>
          )}
        </section>
      )}

    </div>
  );
}
