// Shared by both map renderers (Google, Leaflet fallback) so the pins and
// lines look the same whichever provider draws them.

export interface MapPin {
  id: number;
  lat: number;
  lng: number;
  count: number;
  title: string;
  accent: boolean; // carries personally-owned demos in the current filter
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
}

export const SYRIA_CENTER: [number, number] = [34.8, 38.5];

export const LINE_STYLE = {
  active: { color: '#ea580c', weight: 5, opacity: 0.9 },
  idle: { color: '#64748b', weight: 3, opacity: 0.5 },
};

// A centered circle with the visit count. The negative margins center it on
// the anchor point, so a renderer only has to place a zero-size box there.
export function pinHtml(pin: MapPin, selected: boolean): string {
  const size = Math.round(Math.min(56, 26 + Math.sqrt(pin.count) * 6));
  const bg = pin.accent ? '#7c3aed' : '#0284c7';
  const ring = selected ? '#f59e0b' : '#ffffff';
  return `<div style="width:${size}px;height:${size}px;margin-left:-${size / 2}px;margin-top:-${size / 2}px;border-radius:50%;background:${bg};border:3px solid ${ring};color:#fff;display:flex;align-items:center;justify-content:center;font:700 13px sans-serif;box-shadow:0 2px 6px rgba(0,0,0,.35);cursor:pointer">${pin.count}</div>`;
}

// Distinct points to fit the view to. A pin sitting on a route station would
// otherwise count twice, and two identical points fit to the max zoom.
export function fitPoints(pins: MapPin[], lines: MapLine[]): [number, number][] {
  const all = [...pins.map(p => [p.lat, p.lng] as [number, number]), ...lines.flatMap(l => l.points)];
  const seen = new Set<string>();
  return all.filter(([lat, lng]) => {
    const key = `${lat.toFixed(6)},${lng.toFixed(6)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
