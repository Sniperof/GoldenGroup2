// Renders the full geographic chain of a leaf geo_unit id according to the
// constitution (docs/constitution/domains/geo-units.md §3 BR-4):
//
//   محافظة → منطقة → ناحية → حي → عنوان نصي
//
// Each level is shown as a chip with its admin label above the name, so the
// reader can tell at a glance which level corresponds to which place name.
// The detailed text address (when present) is appended below the chain.
// A lat/lng pair, when both are present, becomes a Google Maps link.
//
// This component fetches the geo_units tree once per session (via the
// process-local cache in `lib/geoUnitsCache`) and is safe to mount in many
// places without N+1 traffic.

import { useEffect, useState } from 'react';
import { ChevronLeft, MapPin } from 'lucide-react';
import { getGeoUnits, type GeoUnit } from '../../lib/geoUnitsCache';
import { buildGeoPath, geoLevelLabel } from '../../lib/geoPath';

interface Props {
  /** Leaf geo_unit id (whatever level it actually is — we walk up from here). */
  geoUnitId: number | null | undefined;
  /** Free-form text appended after the chain (BR-4 final component). */
  detailedText?: string | null;
  /** Optional coordinates → Google Maps link. */
  lat?: number | string | null;
  lng?: number | string | null;
  /** When true, render compactly on one line without the level labels. */
  compact?: boolean;
}

export function GeoPathDisplay({
  geoUnitId,
  detailedText,
  lat,
  lng,
  compact = false,
}: Props) {
  const [units, setUnits] = useState<GeoUnit[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    getGeoUnits()
      .then(rows => { if (live) setUnits(rows); })
      .catch(err => { if (live) setError(err?.message ?? 'تعذر تحميل التقسيمات الجغرافية'); });
    return () => { live = false; };
  }, []);

  const hasCoords = lat != null && lng != null && lat !== '' && lng !== '';
  const path = units ? buildGeoPath(units, geoUnitId ?? null) : [];

  // Nothing useful to show → quiet empty state.
  const hasAnything = path.length > 0 || (detailedText && detailedText.trim()) || hasCoords;
  if (!hasAnything && units) {
    return <span className="text-xs text-slate-400 italic">غير محدد</span>;
  }

  // Loading shimmer while units are in-flight.
  if (!units && !error) {
    return (
      <div className="flex items-center gap-2">
        <div className="h-5 w-20 bg-slate-100 rounded animate-pulse" />
        <div className="h-5 w-24 bg-slate-100 rounded animate-pulse" />
        <div className="h-5 w-16 bg-slate-100 rounded animate-pulse" />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {error && (
        <div className="text-[11px] text-rose-600 font-bold">{error}</div>
      )}

      {path.length > 0 && (
        compact ? (
          // Inline string form: حمص، القصير، حي البلدية
          <div className="text-sm font-semibold text-slate-700">
            {path.map(u => u.name).join('، ')}
          </div>
        ) : (
          // Chip cascade with level labels (the polished form for the device page).
          <div
            className="flex flex-wrap items-stretch gap-1.5"
            dir="rtl"
            aria-label="المسار الجغرافي الكامل"
          >
            {path.map((u, i) => (
              <div key={u.id} className="flex items-stretch gap-1.5">
                <div className="bg-sky-50 border border-sky-100 rounded-xl px-3 py-1.5 leading-tight">
                  <div className="text-[10px] text-sky-600 font-black">
                    {geoLevelLabel(u.level)}
                  </div>
                  <div className="text-sm font-bold text-slate-800">{u.name}</div>
                </div>
                {i < path.length - 1 && (
                  <div className="self-center text-slate-300" aria-hidden>
                    <ChevronLeft className="w-4 h-4" />
                  </div>
                )}
              </div>
            ))}
          </div>
        )
      )}

      {detailedText && detailedText.trim() && (
        <div className="flex items-start gap-2 text-sm text-slate-700">
          <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-1" />
          <span className="font-medium leading-relaxed">{detailedText}</span>
        </div>
      )}

      {hasCoords ? (
        <a
          href={`https://maps.google.com/?q=${lat},${lng}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-[11px] text-sky-600 hover:underline font-bold"
        >
          <MapPin className="w-3 h-3" />
          عرض على الخريطة ↗
        </a>
      ) : (path.length > 0 || (detailedText && detailedText.trim())) && (
        // Address known but no pin saved — explain instead of silently hiding the link.
        <div className="text-[11px] text-slate-400 italic">
          لا يوجد موقع مثبت على الخريطة لهذا العنوان.
        </div>
      )}
    </div>
  );
}

export default GeoPathDisplay;
