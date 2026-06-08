import { MapPin } from 'lucide-react';
import { PossessionHolderChip } from '../../../components/devices/PossessionHolderChip';
import { GeoPathDisplay } from '../../../components/geo/GeoPathDisplay';
import { SectionShell } from './SectionShell';

interface Props {
  device: any;
  currentPossession: any | null;
}

function PossessionEmpty({ status }: { status?: string }) {
  const reason = status === 'pending_delivery'
    ? 'الجهاز بانتظار التسليم، لذلك لا يوجد سجل حيازة مفتوح بعد.'
    : 'لم يتم فتح سجل حيازة لهذا الجهاز بعد.';
  return (
    <div className="rounded-xl border border-amber-100 bg-amber-50 px-3 py-2">
      <div className="text-xs font-bold text-amber-700">لا يوجد حائز حالي</div>
      <div className="text-[11px] text-amber-700/80 mt-0.5">{reason}</div>
    </div>
  );
}

function LocationEmpty() {
  return (
    <div className="rounded-xl border border-amber-100 bg-amber-50 px-3 py-2">
      <div className="text-xs font-bold text-amber-700">موقع الجهاز غير مكتمل</div>
      <div className="text-[11px] text-amber-700/80 mt-0.5">
        لم تحفظ منطقة أو عنوان أو إحداثيات للجهاز. غالباً يجب تعبئة بيانات الجهاز من مسودة العقد عند الاعتماد أو من نتيجة مهمة التسليم.
      </div>
    </div>
  );
}

export function CurrentHolderSection({ device, currentPossession }: Props) {
  const hasLocation = Boolean(
    device?.installationGeoUnitId
    || device?.installationAddressText
    || (device?.installationLat && device?.installationLng)
  );

  return (
    <SectionShell
      id="current-holder"
      title="الحيازة والموقع الحالي"
      subtitle="من يحوز الجهاز الآن، وأين هو فيزيائياً"
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <div className="text-[11px] text-slate-400 font-bold mb-2">الحائز الحالي</div>
          {currentPossession ? (
            <PossessionHolderChip
              holderType={currentPossession.holderType}
              reason={currentPossession.reason}
              showReason
            />
          ) : (
            <PossessionEmpty status={device?.status} />
          )}
          {currentPossession?.startAt && (
            <div className="mt-2 text-[11px] text-slate-500">
              منذ:{' '}
              <span className="font-semibold text-slate-700">
                {new Date(currentPossession.startAt).toLocaleString('ar-SY', { numberingSystem: 'latn' })}
              </span>
            </div>
          )}
        </div>

        <div>
          <div className="text-[11px] text-slate-400 font-bold mb-2 flex items-center gap-1">
            <MapPin className="w-3.5 h-3.5" /> موقع التركيب المرجعي
          </div>
          {hasLocation ? (
            <GeoPathDisplay
              geoUnitId={device?.installationGeoUnitId ?? null}
              detailedText={device?.installationAddressText ?? null}
              lat={device?.installationLat ?? null}
              lng={device?.installationLng ?? null}
            />
          ) : (
            <LocationEmpty />
          )}
        </div>
      </div>
    </SectionShell>
  );
}

export default CurrentHolderSection;
