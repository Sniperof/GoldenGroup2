import { useEffect, useState } from 'react';
import { hasGoogleMapsKey, onGoogleMapsAuthFailure } from '../../lib/googleMaps';
import ZoneMapGoogle from './ZoneMapGoogle';
import ZoneMapLeaflet from './ZoneMapLeaflet';
import type { ZoneMapProps } from './zoneMapPins';

export type { MapLine, MapPin } from './zoneMapPins';

// The zone map draws on Google Maps when VITE_GOOGLE_MAPS_API_KEY is set.
// Without a key — or when Google rejects it or the script fails to load —
// the same pins and lines are drawn on Leaflet, so the study never goes blank.
export default function ZoneMapCanvas(props: ZoneMapProps) {
  const [googleFailed, setGoogleFailed] = useState<string | null>(null);
  const useGoogle = hasGoogleMapsKey() && googleFailed == null;

  useEffect(() => onGoogleMapsAuthFailure(() => setGoogleFailed('رفضت Google مفتاح الخرائط')), []);

  return (
    <div className="relative h-full w-full">
      {useGoogle
        ? <ZoneMapGoogle {...props} onLoadError={() => setGoogleFailed('تعذّر تحميل خرائط Google')} />
        : <ZoneMapLeaflet {...props} />}
      {googleFailed && (
        <div className="absolute top-2 right-2 z-[1000] rounded-md bg-white/90 px-2 py-1 text-[11px] text-amber-700 border border-amber-200">
          {googleFailed} — تُعرض الخريطة البديلة
        </div>
      )}
    </div>
  );
}
