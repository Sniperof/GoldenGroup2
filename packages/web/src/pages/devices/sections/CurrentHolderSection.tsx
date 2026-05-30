// DEC-CT-09: current holder + installation location (the device's
// "fixed" address, distinct from possession which is dynamic).
//
// The location block follows the geo-units constitution (BR-4):
// محافظة → منطقة → ناحية → حي → عنوان نصي. The chain is built from
// `installationGeoUnitId` by walking the parent chain via `GeoPathDisplay`.

import { MapPin } from 'lucide-react';
import { PossessionHolderChip } from '../../../components/devices/PossessionHolderChip';
import { GeoPathDisplay } from '../../../components/geo/GeoPathDisplay';
import { SectionShell } from './SectionShell';

interface Props {
  device: any;
  currentPossession: any | null;
}

export function CurrentHolderSection({ device, currentPossession }: Props) {
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
            <span className="text-xs text-slate-400 italic">لا يوجد سجل حيازة مفتوح.</span>
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
          <GeoPathDisplay
            geoUnitId={device?.installationGeoUnitId ?? null}
            detailedText={device?.installationAddressText ?? null}
            lat={device?.installationLat ?? null}
            lng={device?.installationLng ?? null}
          />
        </div>
      </div>
    </SectionShell>
  );
}

export default CurrentHolderSection;
