import { useEffect, useMemo, useState } from 'react';
import { ArrowUpCircle, Beaker, Building2, CheckCircle2, ExternalLink, MapPin, User, AlertTriangle } from 'lucide-react';
import type { GeoUnit } from '@golden-crm/shared';
import { api } from '../../lib/api';
import Button from '../ui/Button';

function readText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function getMapLocation(request: any): { lat: number; lng: number } | null {
  const raw = request?.serviceAddress?.mapLocation
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
  const text = value == null || value === '' ? '-' : String(value);
  return (
    <div>
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="mt-1 text-sm font-semibold text-slate-800">{text}</div>
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

  const geoPath = [
    resolveGeoName(unitsById, address.governorateId ?? submitted.governorateId),
    resolveGeoName(unitsById, address.regionId ?? submitted.regionId),
    resolveGeoName(unitsById, address.subdistrictId ?? submitted.subdistrictId),
    resolveGeoName(unitsById, address.neighborhoodId ?? submitted.neighborhoodId),
  ].filter(Boolean).join(' / ');

  const mapUrl = mapLocation
    ? `https://www.openstreetmap.org/export/embed.html?bbox=${mapLocation.lng - 0.01},${mapLocation.lat - 0.005},${mapLocation.lng + 0.01},${mapLocation.lat + 0.005}&layer=mapnik&marker=${mapLocation.lat},${mapLocation.lng}`
    : null;

  return (
    <div className="space-y-4">
      <section className="rounded border border-slate-200 bg-white p-4">
        <div className="mb-4 flex items-center gap-2">
          <Beaker className="h-5 w-5 text-sky-600" />
          <h2 className="text-lg font-bold text-slate-800">بيانات طلب فحص المياه</h2>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="صاحب الطلب" value={fullName} />
          <Field label="نوع الطلب" value={request.requestTypeLabel ?? 'طلب فحص المياه'} />
          <Field label="مصدر الطلب" value={request.channelLabel} />
          <Field label="رقم الهاتف" value={primaryPhone} />
          <Field label="واتساب الرقم الأساسي" value={external.primaryPhoneHasWhatsapp ? 'نعم' : 'لا'} />
          <Field label="رقم ثانوي" value={secondaryPhone} />
          <Field label="واتساب الرقم الثانوي" value={secondaryPhone ? (external.secondaryPhoneHasWhatsapp ? 'نعم' : 'لا') : '-'} />
          <Field label="حالة الطلب" value={request.statusLabel} />
          <Field label="المستلم" value={request.reviewedByUserName ?? 'لم يتول أحد'} />
        </div>
      </section>

      <section className="rounded border border-slate-200 bg-white p-4">
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
        <section className="rounded border border-slate-200 bg-white p-4">
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
        <section className="rounded border border-slate-200 bg-white p-4">
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

      <section className="rounded border border-slate-200 bg-white p-4">
        <div className="mb-4 flex items-center gap-2">
          <User className="h-5 w-5 text-sky-600" />
          <h2 className="text-lg font-bold text-slate-800">الربط</h2>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="الزبون المرتبط" value={request.beneficiaryClientName ?? (request.beneficiaryClientId ? `#${request.beneficiaryClientId}` : 'غير مربوط بعد')} />
          <Field label="ملاحظات الطلب" value={notes || '-'} />
        </div>
        {!request.beneficiaryClientId && (
          <div className="mt-4 flex items-start gap-2 rounded bg-slate-50 p-3 text-sm text-slate-700">
            <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
            <span>قبل تحويل الطلب إلى مهمة يجب ربطه بزبون وفرع واضحين.</span>
          </div>
        )}
      </section>
    </div>
  );
}
