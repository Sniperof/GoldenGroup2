import { useEffect, useRef, useState } from 'react';
// Leaflet fallback renderer — used when no Google Maps key is configured or
// Google rejects the key. Leaflet touches `window` on load, so it is imported
// lazily inside the effect, same as MapPicker.
import type * as Leaflet from 'leaflet';
import { fitPoints, LINE_STYLE, pinHtml, SYRIA_CENTER, type ZoneMapProps } from './zoneMapPins';

export default function ZoneMapLeaflet({ pins, lines, selectedId, onSelect, onPlace, fitKey, minHeight = 420 }: ZoneMapProps) {
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
        ...(line.active ? LINE_STYLE.active : LINE_STYLE.idle),
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
    const pts = fitPoints(pins, lines);
    if (pts.length === 1) map.setView(pts[0], 12);
    else if (pts.length > 1) map.fitBounds(L.latLngBounds(pts), { padding: [30, 30], maxZoom: 14 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, fitKey]);

  // Leaflet adds its own classes to the map element, so React must never
  // re-render that element's className — the changing cursor lives on a wrapper.
  return (
    <div className={`h-full w-full overflow-hidden rounded-xl ${onPlace ? '[&_.leaflet-container]:cursor-crosshair' : ''}`}>
      <div ref={containerRef} className="h-full w-full" style={{ minHeight }} />
    </div>
  );
}
