import { useEffect, useRef, useState } from 'react';
// Leaflet touches `window` on load — imported lazily inside the effect, same
// as MapPicker. Kept behind this one component so the map provider (Google
// once the key is in place) can be swapped without touching the study page.
import type * as Leaflet from 'leaflet';

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

interface Props {
  pins: MapPin[];
  lines: MapLine[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  // When set, a map click reports the clicked point instead of selecting.
  onPlace?: ((lat: number, lng: number) => void) | null;
  fitKey: string; // changes → re-fit to the pins
}

const SYRIA_CENTER: [number, number] = [34.8, 38.5];

function pinHtml(pin: MapPin, selected: boolean): string {
  const size = Math.round(Math.min(56, 26 + Math.sqrt(pin.count) * 6));
  const bg = pin.accent ? '#7c3aed' : '#0284c7';
  const ring = selected ? '#f59e0b' : '#ffffff';
  return `<div style="width:${size}px;height:${size}px;margin-left:-${size / 2}px;margin-top:-${size / 2}px;border-radius:50%;background:${bg};border:3px solid ${ring};color:#fff;display:flex;align-items:center;justify-content:center;font:700 13px sans-serif;box-shadow:0 2px 6px rgba(0,0,0,.35)">${pin.count}</div>`;
}

export default function ZoneMapCanvas({ pins, lines, selectedId, onSelect, onPlace, fitKey }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const leafletRef = useRef<typeof Leaflet | null>(null);
  const mapRef = useRef<Leaflet.Map | null>(null);
  const layerRef = useRef<Leaflet.LayerGroup | null>(null);
  const [ready, setReady] = useState(false);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onPlaceRef = useRef(onPlace);
  onPlaceRef.current = onPlace;

  useEffect(() => {
    let cancelled = false;
    let observer: ResizeObserver | null = null;
    Promise.all([import('leaflet'), import('leaflet/dist/leaflet.css')]).then(([mod]) => {
      if (cancelled || !containerRef.current || mapRef.current) return;
      const L = ((mod as { default?: typeof Leaflet }).default ?? mod) as typeof Leaflet;
      leafletRef.current = L;
      const map = L.map(containerRef.current, { center: SYRIA_CENTER, zoom: 7 });
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap',
      }).addTo(map);
      map.on('click', (e: Leaflet.LeafletMouseEvent) => onPlaceRef.current?.(e.latlng.lat, e.latlng.lng));
      layerRef.current = L.layerGroup().addTo(map);
      mapRef.current = map;
      observer = new ResizeObserver(() => map.invalidateSize());
      observer.observe(containerRef.current);
      setReady(true);
    });
    return () => {
      cancelled = true;
      observer?.disconnect();
      mapRef.current?.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  // Redraw pins and lines.
  useEffect(() => {
    const L = leafletRef.current;
    const layer = layerRef.current;
    if (!ready || !L || !layer) return;
    layer.clearLayers();
    lines.forEach(line => {
      if (line.points.length === 0) return;
      L.polyline(line.points, {
        color: line.active ? '#ea580c' : '#64748b',
        weight: line.active ? 5 : 3,
        opacity: line.active ? 0.9 : 0.5,
        dashArray: line.active ? undefined : '6 6',
      }).bindTooltip(line.label, { sticky: true }).addTo(layer);
    });
    pins.forEach(pin => {
      L.marker([pin.lat, pin.lng], {
        icon: L.divIcon({ html: pinHtml(pin, pin.id === selectedId), className: '', iconSize: [0, 0] }),
        title: pin.title,
        zIndexOffset: pin.id === selectedId ? 1000 : 0,
      })
        .on('click', () => onSelectRef.current(pin.id))
        .addTo(layer);
    });
  }, [ready, pins, lines, selectedId]);

  // Fit to the pins (and lines) when the data set changes, not on every redraw.
  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    if (!ready || !L || !map) return;
    const pts: [number, number][] = [
      ...pins.map(p => [p.lat, p.lng] as [number, number]),
      ...lines.flatMap(l => l.points),
    ];
    if (pts.length === 1) map.setView(pts[0], 13);
    else if (pts.length > 1) map.fitBounds(L.latLngBounds(pts), { padding: [30, 30], maxZoom: 14 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, fitKey]);

  // Leaflet adds its own classes to the map element, so React must never
  // re-render that element's className — the changing cursor lives on a wrapper.
  return (
    <div className={`h-full w-full overflow-hidden rounded-xl ${onPlace ? '[&_.leaflet-container]:cursor-crosshair' : ''}`}>
      <div ref={containerRef} className="h-full w-full" style={{ minHeight: 420 }} />
    </div>
  );
}
