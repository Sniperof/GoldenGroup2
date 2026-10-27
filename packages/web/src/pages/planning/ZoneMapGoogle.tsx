import { useEffect, useRef, useState } from 'react';
import { loadGoogleMaps, type GoogleMapsApi } from '../../lib/googleMaps';
import { fitPoints, LINE_STYLE, pinHtml, SYRIA_CENTER, type ZoneMapProps } from './zoneMapPins';

/* eslint-disable @typescript-eslint/no-explicit-any */

// HTML pins as an OverlayView: same look as the Leaflet pins, and no mapId
// needed (AdvancedMarkerElement requires one). The class is built after the
// API loads because OverlayView only exists then.
function createPinOverlayClass(gm: GoogleMapsApi) {
  return class PinOverlay extends gm.OverlayView {
    private div: HTMLDivElement | null = null;
    constructor(private position: any, private html: string, private title: string, private zIndex: number, private onClick: () => void) {
      super();
    }
    onAdd() {
      const div = document.createElement('div');
      div.style.position = 'absolute';
      div.style.zIndex = String(this.zIndex);
      div.title = this.title;
      div.innerHTML = this.html;
      div.addEventListener('click', e => { e.stopPropagation(); this.onClick(); });
      this.div = div;
      (this as any).getPanes().overlayMouseTarget.appendChild(div);
    }
    draw() {
      if (!this.div) return;
      const point = (this as any).getProjection().fromLatLngToDivPixel(this.position);
      if (!point) return;
      this.div.style.left = `${point.x}px`;
      this.div.style.top = `${point.y}px`;
    }
    onRemove() {
      this.div?.remove();
      this.div = null;
    }
  };
}

export default function ZoneMapGoogle({ pins, lines, selectedId, onSelect, onPlace, fitKey, onLoadError }: ZoneMapProps & { onLoadError: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const gmRef = useRef<GoogleMapsApi | null>(null);
  const mapRef = useRef<any>(null);
  const overlaysRef = useRef<any[]>([]);
  const PinRef = useRef<any>(null);
  const [ready, setReady] = useState(false);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onPlaceRef = useRef(onPlace);
  onPlaceRef.current = onPlace;
  const onLoadErrorRef = useRef(onLoadError);
  onLoadErrorRef.current = onLoadError;

  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps()
      .then(gm => {
        if (cancelled || !containerRef.current || mapRef.current) return;
        gmRef.current = gm;
        PinRef.current = createPinOverlayClass(gm);
        const map = new gm.Map(containerRef.current, {
          center: { lat: SYRIA_CENTER[0], lng: SYRIA_CENTER[1] },
          zoom: 7,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          clickableIcons: false,
          gestureHandling: 'greedy',
        });
        map.addListener('click', (e: any) => {
          if (e.latLng) onPlaceRef.current?.(e.latLng.lat(), e.latLng.lng());
        });
        mapRef.current = map;
        setReady(true);
      })
      .catch(() => { if (!cancelled) onLoadErrorRef.current(); });
    return () => {
      cancelled = true;
      overlaysRef.current.forEach(o => o.setMap(null));
      overlaysRef.current = [];
      mapRef.current = null;
    };
  }, []);

  // Crosshair while placing an area center.
  useEffect(() => {
    mapRef.current?.setOptions({ draggableCursor: onPlace ? 'crosshair' : null });
  }, [ready, onPlace]);

  // Redraw pins and lines.
  useEffect(() => {
    const gm = gmRef.current;
    const map = mapRef.current;
    const Pin = PinRef.current;
    if (!ready || !gm || !map || !Pin) return;
    overlaysRef.current.forEach(o => o.setMap(null));
    const next: any[] = [];
    lines.forEach(line => {
      if (line.points.length === 0) return;
      const style = line.active ? LINE_STYLE.active : LINE_STYLE.idle;
      const dashed = !line.active;
      const polyline = new gm.Polyline({
        path: line.points.map(([lat, lng]) => ({ lat, lng })),
        strokeColor: style.color,
        strokeWeight: style.weight,
        strokeOpacity: dashed ? 0 : style.opacity,
        icons: dashed
          ? [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: style.opacity, strokeWeight: style.weight, scale: 2 }, offset: '0', repeat: '12px' }]
          : undefined,
        map,
      });
      next.push(polyline);
    });
    pins.forEach(pin => {
      const selected = pin.id === selectedId;
      const overlay = new Pin(
        new gm.LatLng(pin.lat, pin.lng),
        pinHtml(pin, selected),
        pin.title,
        selected ? 1000 : 1,
        () => onSelectRef.current(pin.id),
      );
      overlay.setMap(map);
      next.push(overlay);
    });
    overlaysRef.current = next;
  }, [ready, pins, lines, selectedId]);

  // Fit to the pins (and lines) when the data set changes, not on every redraw.
  useEffect(() => {
    const gm = gmRef.current;
    const map = mapRef.current;
    if (!ready || !gm || !map) return;
    const pts = fitPoints(pins, lines);
    if (pts.length === 1) {
      map.setCenter({ lat: pts[0][0], lng: pts[0][1] });
      map.setZoom(12);
    } else if (pts.length > 1) {
      const bounds = new gm.LatLngBounds();
      pts.forEach(([lat, lng]) => bounds.extend({ lat, lng }));
      map.fitBounds(bounds, 30);
      gm.event.addListenerOnce(map, 'idle', () => { if (map.getZoom() > 14) map.setZoom(14); });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, fitKey]);

  return <div ref={containerRef} className="h-full w-full overflow-hidden rounded-xl" style={{ minHeight: 420 }} />;
}
