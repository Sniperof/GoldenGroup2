import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { GeoUnit, RoutePoint } from '@golden-crm/shared';
import ZoneMapCanvas from './ZoneMapCanvas';
import type { MapLine, MapPin } from './zoneMapPins';

// A route as it will run: its stations as numbered pins in route order joined
// by the route line, plus — faintly — the أحياء under its ناحية stations that
// are NOT stations themselves. Station matching is literal (see RouteManager):
// those أحياء are not served by this route, so the preview shows the gap.
// Read-only: centers are set on the geo settings form (or the zone map).

interface Props {
  points: RoutePoint[];
  geoUnits: GeoUnit[];
  name: (id: number) => string;
  height?: number;
}

const GHOST_ID_OFFSET = 1_000_000_000; // keeps ghost pin ids apart from station ids

export default function RoutePreviewMap({ points, geoUnits, name, height = 280 }: Props) {
  const [selected, setSelected] = useState<number | null>(null);

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
    const line: MapLine = {
      id: 1,
      label: 'المسار',
      active: true,
      points: stations.filter(s => s.center).map(s => [s.center!.lat, s.center!.lng] as [number, number]),
    };
    return {
      pins,
      lines: line.points.length > 1 ? [line] : [],
      stations,
      missing: stations.filter(s => !s.center),
      uncoveredCount: uncovered.length,
      uncoveredPlaced: uncovered.filter(u => u.center).length,
      fitKey: ordered.map(p => p.geoUnitId).sort((a, b) => a - b).join(','),
    };
  }, [points, geoUnits, name]);

  const selectedLabel = selected == null
    ? null
    : selected >= GHOST_ID_OFFSET
      ? `${name(selected - GHOST_ID_OFFSET)} — حي غير مضاف للمسار، لا تُسحب مهامه بهذا المسار`
      : `${view.stations.find(s => s.id === selected)?.order}. ${name(selected)}`;

  if (points.length === 0) {
    return <p className="text-xs text-slate-400">أضف محطات لتظهر على الخريطة.</p>;
  }

  return (
    <div className="space-y-2 text-xs">
      <div className="rounded-xl border border-slate-200 overflow-hidden" style={{ height }}>
        <ZoneMapCanvas
          pins={view.pins}
          lines={view.lines}
          selectedId={selected}
          onSelect={setSelected}
          fitKey={view.fitKey}
          minHeight={height}
        />
      </div>
      {selectedLabel && <p className="font-bold text-slate-700">{selectedLabel}</p>}
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
