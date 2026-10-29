import { useState, useCallback, useEffect, useRef } from 'react';
// Leaflet touches `window` as soon as it loads, so it (and its CSS) is imported
// lazily inside the browser effect — importing this module stays safe under
// Node tests, and the map code is only downloaded when a map is shown.
import type * as Leaflet from 'leaflet';
import { Navigation, X } from './ui/icons';
import IconButton from './ui/IconButton';
import { hasGoogleMapsKey, loadGoogleMaps, onGoogleMapsUnavailable, type GoogleMapsApi } from '../lib/googleMaps';

interface MapPickerProps {
    position: [number, number] | null;
    onLocationSelect: (lat: number, lng: number) => void;
}

const SYRIA_CENTER: [number, number] = [34.8, 38.5];
const SYRIA_ZOOM = 6;
const PIN_ZOOM = 16;

// A CSS pin instead of Leaflet's default PNG marker — the default icon's image
// URLs break under bundlers, and this one needs no assets.
const PIN_HTML = '<div style="width:26px;height:26px;border-radius:50% 50% 50% 0;background:#0284c7;transform:rotate(-45deg);border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35)"></div>';

const hasPosition = (p: [number, number] | null): p is [number, number] =>
    !!p && !(p[0] === 0 && p[1] === 0);

// The picker's map, whichever engine draws it.
interface PinMap {
    setPin(p: [number, number] | null): void;
    // Pan to the pin only when it is off screen.
    reveal(p: [number, number]): void;
    focus(p: [number, number]): void;
    destroy(): void;
}

type Pick = (lat: number, lng: number) => void;

async function createGoogleMap(container: HTMLDivElement, initial: [number, number] | null, onPick: Pick): Promise<PinMap> {
    const g: GoogleMapsApi = await loadGoogleMaps();
    const toLatLng = (p: [number, number]) => ({ lat: p[0], lng: p[1] });
    const map = new g.Map(container, {
        center: toLatLng(initial ?? SYRIA_CENTER),
        zoom: initial ? PIN_ZOOM : SYRIA_ZOOM,
        mapTypeControl: true,
        streetViewControl: false,
        fullscreenControl: true,
        clickableIcons: false,
        gestureHandling: 'greedy',
        draggableCursor: 'crosshair',
    });
    map.addListener('click', (e: GoogleMapsApi) => onPick(e.latLng.lat(), e.latLng.lng()));
    let marker: GoogleMapsApi = null;
    return {
        setPin(p) {
            if (!p) {
                marker?.setMap(null);
                marker = null;
            } else if (marker) {
                marker.setPosition(toLatLng(p));
            } else {
                marker = new g.Marker({ map, position: toLatLng(p), draggable: true });
                marker.addListener('dragend', (e: GoogleMapsApi) => onPick(e.latLng.lat(), e.latLng.lng()));
            }
        },
        reveal(p) {
            if (!map.getBounds()?.contains(toLatLng(p))) {
                map.setCenter(toLatLng(p));
                map.setZoom(Math.max(map.getZoom() ?? 0, PIN_ZOOM));
            }
        },
        focus(p) {
            map.setCenter(toLatLng(p));
            map.setZoom(PIN_ZOOM);
        },
        destroy() {
            marker?.setMap(null);
            g.event.clearInstanceListeners(map);
        },
    };
}

async function createLeafletMap(container: HTMLDivElement, initial: [number, number] | null, onPick: Pick): Promise<PinMap> {
    const [mod] = await Promise.all([import('leaflet'), import('leaflet/dist/leaflet.css')]);
    const L = ((mod as { default?: typeof Leaflet }).default ?? mod) as typeof Leaflet;
    const map = L.map(container, {
        center: initial ?? SYRIA_CENTER,
        zoom: initial ? PIN_ZOOM : SYRIA_ZOOM,
        attributionControl: true,
    });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap',
    }).addTo(map);
    map.on('click', (e: Leaflet.LeafletMouseEvent) => onPick(e.latlng.lat, e.latlng.lng));
    // Modals animate in and tabs mount hidden: recompute the map size whenever
    // the container's box changes, or Leaflet renders grey tiles.
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(container);
    let marker: Leaflet.Marker | null = null;
    return {
        setPin(p) {
            if (!p) {
                marker?.remove();
                marker = null;
            } else if (marker) {
                marker.setLatLng(p);
            } else {
                const icon = L.divIcon({ className: '', html: PIN_HTML, iconSize: [26, 26], iconAnchor: [13, 26] });
                const m = L.marker(p, { icon, draggable: true }).addTo(map);
                m.on('dragend', () => {
                    const ll = m.getLatLng();
                    onPick(ll.lat, ll.lng);
                });
                marker = m;
            }
        },
        reveal(p) {
            if (!map.getBounds().contains(p)) map.setView(p, Math.max(map.getZoom(), PIN_ZOOM));
        },
        focus(p) {
            map.setView(p, PIN_ZOOM);
        },
        destroy() {
            observer.disconnect();
            map.remove();
        },
    };
}

/**
 * Location picker: click (or drag the pin) on the map to drop a pin, use the
 * device's current GPS position, or type coordinates. Draws on Google Maps;
 * Leaflet only when there is no key, Google rejects it or the script will not
 * load.
 */
export default function MapPicker({ position, onLocationSelect }: MapPickerProps) {
    const [manualLat, setManualLat] = useState(hasPosition(position) ? position[0].toFixed(6) : '');
    const [manualLng, setManualLng] = useState(hasPosition(position) ? position[1].toFixed(6) : '');
    const [locating, setLocating] = useState(false);

    const [engine, setEngine] = useState<'google' | 'leaflet'>(() => (hasGoogleMapsKey() ? 'google' : 'leaflet'));
    useEffect(() => onGoogleMapsUnavailable(() => setEngine('leaflet')), []);

    const containerRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<PinMap | null>(null);
    const [mapReady, setMapReady] = useState(false);
    // Latest callback without re-creating the map on every parent render.
    const onSelectRef = useRef(onLocationSelect);
    onSelectRef.current = onLocationSelect;

    const select = useCallback((lat: number, lng: number) => {
        setManualLat(lat.toFixed(6));
        setManualLng(lng.toFixed(6));
        onSelectRef.current(lat, lng);
    }, []);

    // Create the map once per engine; a Google failure re-runs this on Leaflet.
    useEffect(() => {
        let cancelled = false;
        let created: PinMap | null = null;
        const container = containerRef.current;
        if (!container) return;
        const create = engine === 'google' ? createGoogleMap : createLeafletMap;
        create(container, hasPosition(position) ? position : null, select).then(map => {
            created = map;
            if (cancelled) { map.destroy(); return; }
            mapRef.current = map;
            setMapReady(true);
        }).catch(() => {
            if (!cancelled && engine === 'google') setEngine('leaflet');
        });
        return () => {
            cancelled = true;
            created?.destroy();
            mapRef.current = null;
            setMapReady(false);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [engine]);

    // Keep the pin (and the coordinate inputs) in sync with the controlled position.
    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;
        if (!hasPosition(position)) {
            map.setPin(null);
            return;
        }
        setManualLat(position[0].toFixed(6));
        setManualLng(position[1].toFixed(6));
        map.setPin(position);
        map.reveal(position);
    }, [mapReady, position?.[0], position?.[1]]);

    const getCurrentLocation = useCallback(() => {
        if (!navigator.geolocation) {
            alert('المتصفح لا يدعم تحديد الموقع');
            return;
        }
        setLocating(true);
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                select(pos.coords.latitude, pos.coords.longitude);
                mapRef.current?.focus([pos.coords.latitude, pos.coords.longitude]);
                setLocating(false);
            },
            () => {
                alert('تعذّر تحديد الموقع. تأكد من صلاحيات الموقع.');
                setLocating(false);
            },
            { enableHighAccuracy: true, timeout: 10000 }
        );
    }, [select]);

    const applyManual = () => {
        const lat = parseFloat(manualLat);
        const lng = parseFloat(manualLng);
        if (!isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
            onLocationSelect(lat, lng);
            mapRef.current?.focus([lat, lng]);
        }
    };

    const clearLocation = () => {
        setManualLat('');
        setManualLng('');
        onLocationSelect(0, 0);
    };

    return (
        <div className="space-y-2">
            {/* Interactive map — click or drag the pin to choose the location */}
            <div className="rounded-xl overflow-hidden border border-slate-200 shadow-sm relative" style={{ height: 220 }}>
                {/* Tile seams: Tailwind's preflight caps img size, and fractional display
                    scaling (e.g. Windows 125%) leaves sub-pixel gaps — un-cap the tiles and
                    let neighbours overlap by half a pixel. */}
                {/* key: a fresh element per engine, so Leaflet never inherits Google's DOM. */}
                <div
                    key={engine}
                    ref={containerRef}
                    dir="ltr"
                    className="[&_img]:!max-w-none [&_img]:!max-h-none [&_.leaflet-tile]:!w-[256.5px] [&_.leaflet-tile]:!h-[256.5px]"
                    style={{ width: '100%', height: '100%' }}
                />
                {!hasPosition(position) && (
                    <div className="pointer-events-none absolute top-2 inset-x-2 z-[400] text-center">
                        <span className="inline-block rounded-lg bg-white/90 px-2.5 py-1 text-[11px] font-bold text-slate-600 shadow-sm">
                            انقر على الخريطة لوضع الدبوس، أو استخدم «موقعي الحالي»
                        </span>
                    </div>
                )}
            </div>

            {/* Controls */}
            <div className="flex items-center gap-2">
                {/* GPS button */}
                <button
                    type="button"
                    onClick={getCurrentLocation}
                    disabled={locating}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100 text-xs font-medium transition-all disabled:opacity-50 shrink-0"
                >
                    <Navigation className={`w-3.5 h-3.5 ${locating ? 'animate-pulse' : ''}`} />
                    <span>{locating ? 'جاري التحديد...' : 'موقعي الحالي'}</span>
                </button>

                {/* Lat */}
                <input
                    type="text"
                    value={manualLat}
                    onChange={e => setManualLat(e.target.value)}
                    onBlur={applyManual}
                    placeholder="Lat"
                    dir="ltr"
                    className="flex-1 min-w-0 bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-mono text-slate-700 placeholder:text-slate-300 focus:border-sky-500 focus:outline-none text-center"
                />

                {/* Lng */}
                <input
                    type="text"
                    value={manualLng}
                    onChange={e => setManualLng(e.target.value)}
                    onBlur={applyManual}
                    placeholder="Lng"
                    dir="ltr"
                    className="flex-1 min-w-0 bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-mono text-slate-700 placeholder:text-slate-300 focus:border-sky-500 focus:outline-none text-center"
                />

                {/* Clear */}
                {hasPosition(position) && (
                    <IconButton icon={X} label="مسح الموقع" variant="danger" size="sm" onClick={clearLocation} />
                )}
            </div>
        </div>
    );
}
