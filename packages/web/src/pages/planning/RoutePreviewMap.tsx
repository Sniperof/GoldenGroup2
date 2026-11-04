import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { GeoUnit, RoutePoint } from '@golden-crm/shared';
import { hasGoogleMapsKey } from '../../lib/googleMaps';
import { computeRoadRoute, formatDistance, formatDuration, type RoadRoute } from '../../lib/googleRoutes';
import ZoneMapCanvas from './ZoneMapCanvas';
import type { MapLine, MapPin } from './zoneMapPins';

// A route as it will run: its stations as numbered pins in route order joined
// by the route line, plus — faintly — the أحياء under its ناحية stations that
// are NOT stations themselves. Station matching is literal (see RouteManager):
// those أحياء are not served by this route, so the preview shows the gap.
// Read-only: centers are set on the geo settings form (or the zone map).
//
// Road route (Google Routes API, shortest, no traffic): `roadMode="auto"`
// computes it as soon as the preview opens (read-only preview — one request);
// `roadMode="button"` waits for a click (the builder, where stations change
// often). A computed road is dropped as soon as the stations change.

interface Props {
  points: RoutePoint[];
  geoUnits: GeoUnit[];
  name: (id: number) => string;
  height?: number;
  roadMode?: 'auto' | 'button';
  // Builder: the area picked (tree or search) but not added yet — a «+» pin.
  candidateId?: number | null;
  // Map search result (Geocoding): a red pin the map fits to.
  place?: { label: string; lat: number; lng: number } | null;
}

const GHOST_ID_OFFSET = 1_000_000_000; // keeps ghost pin ids apart from station ids

const CANDIDATE_ID_OFFSET = 2_000_000_000;
const PLACE_ID = 3_000_000_000;

export default function RoutePreviewMap({ points, geoUnits, name, height = 280, roadMode = 'button', candidateId = null, place = null }: Props) {
  const [selected, setSelected] = useState<number | null>(null);
  const [road, setRoad] = useState<{ key: string; route: RoadRoute } | null>(null);
  const [roadLoading, setRoadLoading] = useState(false);
  const [roadError, setRoadError] = useState<string | null>(null);

  const view = useMemo(() => {
    const byId = new Map(geoUnits.map(u => [u.id, u]));
    const ordered = [...points].sort((a, b) => a.order - b.order);
    const stationIds = new Set(ordered.map(p => p.geoUnitId));

    const stations = ordered.map((p, i) => ({
      id: p.geoUnitId,
      order: i + 1,
      center: byId.get(p.geoUnitId)?.center ?? null,
    }));
    const uncovered = ordered
      .filter(p => p.level === 3)
      .flatMap(p => geoUnits.filter(u => u.parentId === p.geoUnitId && !stationIds.has(u.id)));

    const pins: MapPin[] = [
      // Faint pins first so the numbered stations draw on top of them.
      ...uncovered.filter(u => u.center).map(u => ({
        id: GHOST_ID_OFFSET + u.id,
        lat: u.center!.lat,
        lng: u.center!.lng,
        count: 0,
        title: `${u.name} — حي غير مضاف للمسار`,
        accent: false,
        variant: 'ghost' as const,
      })),
      ...stations.filter(s => s.center).map(s => ({
        id: s.id,
        lat: s.center!.lat,
        lng: s.center!.lng,
        count: 0,
        title: `${s.order}. ${name(s.id)}`,
        accent: false,
        variant: 'station' as const,
        label: String(s.order),
      })),
    ];
    const candidate = candidateId != null && !stationIds.has(candidateId) ? byId.get(candidateId) : undefined;
    if (candidate?.center) {
      pins.push({
        id: CANDIDATE_ID_OFFSET + candidate.id,
        lat: candidate.center.lat,
        lng: candidate.center.lng,
        count: 0,
        title: `${candidate.name} — لم تُضَف بعد`,
        accent: false,
        variant: 'candidate',
      });
    }
    if (place) {
      pins.push({ id: PLACE_ID, lat: place.lat, lng: place.lng, count: 0, title: place.label, accent: false, variant: 'place' });
    }
    const placed = stations.filter(s => s.center);
    const straight = placed.map(s => [s.center!.lat, s.center!.lng] as [number, number]);
    return {
      pins,
      placed,
      straight,
      // Identity of what a road route was computed for: the placed stations, in order.
      roadKey: JSON.stringify(straight),
      stations,
      missing: stations.filter(s => !s.center),
      uncoveredCount: uncovered.length,
      uncoveredPlaced: uncovered.filter(u => u.center).length,
      fitKey: `${ordered.map(p => p.geoUnitId).sort((a, b) => a - b).join(',')}|${candidate?.center ? candidate.id : ''}|${place ? `${place.lat},${place.lng}` : ''}`,
      candidate: candidate ?? null,
    };
  }, [points, geoUnits, name, candidateId, place]);

  const canRoad = hasGoogleMapsKey() && view.straight.length >= 2;
  const currentRoad = road?.key === view.roadKey ? road.route : null;
  const line: MapLine = { id: 1, label: 'المسار', active: true, points: currentRoad?.path ?? view.straight };
  const lines = line.points.length > 1 ? [line] : [];

  const computeRoad = async (signal?: AbortSignal) => {
    const key = view.roadKey;
    setRoadLoading(true);
    setRoadError(null);
    try {
      const route = await computeRoadRoute(view.straight, signal);
      setRoad({ key, route });
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') setRoadError((err as Error)?.message || 'تعذّر حساب المسار');
    } finally {
      setRoadLoading(false);
    }
  };

  // Stations changed → the computed road no longer applies.
  useEffect(() => { setRoadError(null); }, [view.roadKey]);

  useEffect(() => {
    if (roadMode !== 'auto' || !canRoad) return;
    const ctrl = new AbortController();
    void computeRoad(ctrl.signal);
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roadMode, canRoad, view.roadKey]);

  const selectedLabel = selected == null
    ? null
    : selected === PLACE_ID
      ? place?.label ?? null
    : selected >= CANDIDATE_ID_OFFSET
      ? `${name(selected - CANDIDATE_ID_OFFSET)} — مختارة، لم تُضَف للمسار بعد`
    : selected >= GHOST_ID_OFFSET
      ? `${name(selected - GHOST_ID_OFFSET)} — حي غير مضاف للمسار، لا تُسحب مهامه بهذا المسار`
      : `${view.stations.find(s => s.id === selected)?.order}. ${name(selected)}`;

  return (
    <div className="space-y-2 text-xs">
      {points.length === 0 && <p className="text-slate-400">أضف محطات لتظهر على الخريطة بترتيبها.</p>}
      {view.candidate && !view.candidate.center && (
        <p className="text-amber-700">«{view.candidate.name}» بلا مركز على الخريطة — لا يظهر لها دبوس.</p>
      )}
      <div className="rounded-xl border border-slate-200 overflow-hidden" style={{ height }}>
        <ZoneMapCanvas
          pins={view.pins}
          lines={lines}
          selectedId={selected}
          onSelect={setSelected}
          fitKey={view.fitKey}
          minHeight={height}
        />
      </div>
      {selectedLabel && <p className="font-bold text-slate-700">{selectedLabel}</p>}
      {canRoad && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 space-y-1">
          {currentRoad ? (
            <>
              <p className="font-bold text-slate-700">
                على الطرق: {formatDistance(currentRoad.distanceMeters)} · {formatDuration(currentRoad.durationSec)} قيادة
              </p>
              <p className="text-slate-500 leading-relaxed">
                {currentRoad.legs.map((leg, i) => `${view.placed[i]?.order} ← ${view.placed[i + 1]?.order}: ${formatDistance(leg.distanceMeters)}`).join(' · ')}
              </p>
              <p className="text-[11px] text-slate-400">
                أقصر مسار على الطرق بلا ازدحام، بين مراكز المناطق — تقدير لطول الخط لا مسار الفريق باباً بباب.
                {view.missing.length > 0 && ' المحطات التي بلا مركز غير داخلة في الحساب.'}
              </p>
            </>
          ) : roadLoading ? (
            <p className="text-slate-500">جارٍ حساب المسار على الطرق…</p>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <p className="text-slate-500">{roadError ? `تعذّر الحساب: ${roadError}` : 'الخط الظاهر مستقيم بين المحطات.'}</p>
              <button type="button" onClick={() => void computeRoad()} className="shrink-0 rounded-lg bg-orange-600 px-2.5 py-1 font-bold text-white hover:bg-orange-500">
                {roadError ? 'إعادة المحاولة' : 'احسب على الطرق'}
              </button>
            </div>
          )}
        </div>
      )}
      <p className="text-slate-500">
        {view.stations.length - view.missing.length} من {view.stations.length} محطة على الخريطة
        {view.uncoveredCount > 0 && ` · ${view.uncoveredCount} حي غير مضاف تحت نواحي المسار (الباهتة على الخريطة${view.uncoveredPlaced < view.uncoveredCount ? `، ${view.uncoveredPlaced} منها لها مركز` : ''})`}
      </p>
      {view.missing.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800">
          <p className="font-bold">محطات بلا مركز — لا تظهر على الخريطة ويُرسم الخط بدونها:</p>
          <p className="mt-0.5">{view.missing.map(s => `${s.order}. ${name(s.id)}`).join('، ')}</p>
          <Link to="/geo" className="mt-1 inline-block font-bold text-sky-700 hover:underline">
            حدّد المراكز من المستويات الإدارية
          </Link>
        </div>
      )}
    </div>
  );
}
