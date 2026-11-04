// Shared by both map renderers (Google, Leaflet fallback) so the pins and
// lines look the same whichever provider draws them.

export interface MapPin {
  id: number;
  lat: number;
  lng: number;
  count: number;
  title: string;
  accent: boolean; // carries personally-owned demos in the current filter
  // 'count' (default): sized by `count`. 'station': fixed size, shows `label`
  // (the station's order on a route). 'ghost': small and faint — an area left
  // off the route (a حي under a station ناحية that is not a station itself).
  variant?: 'count' | 'station' | 'ghost' | 'candidate' | 'place'; // candidate = picked, not yet added; place = map search result
  label?: string;
}

export interface MapLine {
  id: number;
  points: [number, number][];
  label: string;
  active: boolean;
}

export interface ZoneMapProps {
  pins: MapPin[];
  lines: MapLine[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  // When set, a map click reports the clicked point instead of selecting.
  onPlace?: ((lat: number, lng: number) => void) | null;
  fitKey: string; // changes → re-fit to the pins
  // The map element's height floor (px). It must not exceed the frame the map
  // sits in, or part of the map is clipped and the fitted view lands off-screen.
  minHeight?: number;
}

export const SYRIA_CENTER: [number, number] = [34.8, 38.5];

export const LINE_STYLE = {
  active: { color: '#ea580c', weight: 5, opacity: 0.9 },
  idle: { color: '#64748b', weight: 3, opacity: 0.5 },
};

// A centered circle with the visit count. The negative margins center it on
// the anchor point, so a renderer only has to place a zero-size box there.
export function pinHtml(pin: MapPin, selected: boolean): string {
  const ring = selected ? '#f59e0b' : '#ffffff';
  if (pin.variant === 'ghost') {
    return `<div style="width:14px;height:14px;margin-left:-7px;margin-top:-7px;border-radius:50%;background:#94a3b8;opacity:.75;border:2px dashed ${selected ? '#f59e0b' : '#475569'};cursor:pointer"></div>`;
  }
  if (pin.variant === 'place') {
    return `<div style="width:18px;height:18px;margin-left:-9px;margin-top:-9px;border-radius:50%;background:#dc2626;border:3px solid #ffffff;box-shadow:0 0 0 6px rgba(220,38,38,.25),0 2px 6px rgba(0,0,0,.35);cursor:pointer"></div>`;
  }
  if (pin.variant === 'candidate') {
    return `<div style="width:30px;height:30px;margin-left:-15px;margin-top:-15px;border-radius:50%;background:#16a34a;border:3px dashed #ffffff;color:#fff;display:flex;align-items:center;justify-content:center;font:700 16px sans-serif;box-shadow:0 0 0 4px rgba(22,163,74,.3),0 2px 6px rgba(0,0,0,.35);cursor:pointer">+</div>`;
  }
  if (pin.variant === 'station') {
    return `<div style="width:28px;height:28px;margin-left:-14px;margin-top:-14px;border-radius:50%;background:#ea580c;border:3px solid ${ring};color:#fff;display:flex;align-items:center;justify-content:center;font:700 12px sans-serif;box-shadow:0 2px 6px rgba(0,0,0,.35);cursor:pointer">${pin.label ?? ''}</div>`;
  }
  const size = Math.round(Math.min(56, 26 + Math.sqrt(pin.count) * 6));
  const bg = pin.accent ? '#7c3aed' : '#0284c7';
  return `<div style="width:${size}px;height:${size}px;margin-left:-${size / 2}px;margin-top:-${size / 2}px;border-radius:50%;background:${bg};border:3px solid ${ring};color:#fff;display:flex;align-items:center;justify-content:center;font:700 13px sans-serif;box-shadow:0 2px 6px rgba(0,0,0,.35);cursor:pointer">${pin.label ?? pin.count}</div>`;
}

// Distinct points to fit the view to. With a route picked, only that route's
// line counts — the other routes drawn faintly («إظهار كل الخطوط») must not
// pull the view back out to the whole branch. A pin sitting on a route station
// would otherwise count twice, and two identical points fit to the max zoom.
export function fitPoints(pins: MapPin[], lines: MapLine[]): [number, number][] {
  const active = lines.filter(l => l.active);
  const fitLines = active.length > 0 ? active : lines;
  const all = [...pins.map(p => [p.lat, p.lng] as [number, number]), ...fitLines.flatMap(l => l.points)];
  const seen = new Set<string>();
  return all.filter(([lat, lng]) => {
    const key = `${lat.toFixed(6)},${lng.toFixed(6)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
