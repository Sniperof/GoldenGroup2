import { useEffect, useRef, useState } from 'react';
import { Loader2, Search, X } from './ui/icons';
import MapPicker from './MapPicker';
import { hasGoogleMapsKey, loadGoogleMaps, onGoogleMapsAuthFailure, type GoogleMapsApi } from '../lib/googleMaps';
import { geocodeSearch, type GeocodeResult } from '../lib/googleGeocode';

// Center of a ناحية / حي on a Google map: click the map or drag the pin. The
// built-in search (Google Geocoding) moves the map to a typed place. With no
// center yet, the map first focuses on the likely area by itself — the unit's
// name with its parents (`focusTerms`, most specific first), widening to the
// parents only when the full name is not found — without setting anything:
// the user still clicks the exact point. No key or a rejected key → the
// Leaflet MapPicker.

type Center = { lat: number; lng: number } | null;

interface Props {
    value: Center;
    onChange: (c: Center) => void;
    // e.g. ['القصور', 'مدينة بانياس', 'منطقة بانياس', 'طرطوس']
    focusTerms: string[];
    height?: number;
}

const SYRIA_CENTER = { lat: 34.8, lng: 38.5 };
const PIN_ZOOM = 16;
const AREA_ZOOM = 14;

export default function GeoCenterPicker({ value, onChange, focusTerms, height = 420 }: Props) {
    const [failed, setFailed] = useState(!hasGoogleMapsKey());
    useEffect(() => onGoogleMapsAuthFailure(() => setFailed(true)), []);

    if (failed) {
        return (
            <MapPicker
                position={value ? [value.lat, value.lng] : null}
                onLocationSelect={(lat, lng) => onChange(lat === 0 && lng === 0 ? null : { lat, lng })}
            />
        );
    }
    return <GooglePicker value={value} onChange={onChange} focusTerms={focusTerms} height={height} />;
}

function GooglePicker({ value, onChange, focusTerms, height }: Required<Props>) {
    const containerRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<GoogleMapsApi>(null);
    const markerRef = useRef<GoogleMapsApi>(null);
    const gRef = useRef<GoogleMapsApi>(null);
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;
    const [ready, setReady] = useState(false);

    const [query, setQuery] = useState('');
    const [results, setResults] = useState<GeocodeResult[] | null>(null);
    const [searching, setSearching] = useState(false);
    const [searchError, setSearchError] = useState<string | null>(null);
    const [focusNote, setFocusNote] = useState<string | null>(null);

    // Create the map once.
    useEffect(() => {
        let cancelled = false;
        loadGoogleMaps().then(g => {
            if (cancelled || !containerRef.current || mapRef.current) return;
            gRef.current = g;
            const map = new g.Map(containerRef.current, {
                center: value ?? SYRIA_CENTER,
                zoom: value ? PIN_ZOOM : 7,
                mapTypeControl: true,
                streetViewControl: false,
                fullscreenControl: true,
                clickableIcons: false,
                gestureHandling: 'greedy',
                draggableCursor: 'crosshair',
            });
            map.addListener('click', (e: GoogleMapsApi) => onChangeRef.current({ lat: e.latLng.lat(), lng: e.latLng.lng() }));
            mapRef.current = map;
            setReady(true);
        }).catch(() => { /* the auth-failure listener switches to the fallback */ });
        return () => {
            cancelled = true;
            markerRef.current?.setMap(null);
            markerRef.current = null;
            mapRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Pin follows the controlled value; draggable.
    useEffect(() => {
        const map = mapRef.current;
        const g = gRef.current;
        if (!ready || !map || !g) return;
        if (!value) {
            markerRef.current?.setMap(null);
            markerRef.current = null;
            return;
        }
        if (!markerRef.current) {
            const marker = new g.Marker({ map, position: value, draggable: true });
            marker.addListener('dragend', (e: GoogleMapsApi) => onChangeRef.current({ lat: e.latLng.lat(), lng: e.latLng.lng() }));
            markerRef.current = marker;
        } else {
            markerRef.current.setPosition(value);
        }
        if (!map.getBounds()?.contains(value)) map.panTo(value);
    }, [ready, value?.lat, value?.lng]);

    // No center yet: focus on the likely area (does not set the center).
    const focusKey = focusTerms.filter(Boolean).join('،');
    useEffect(() => {
        if (!ready || value) return;
        const terms = focusTerms.map(t => t.trim()).filter(Boolean);
        if (terms.length === 0) return;
        const ctrl = new AbortController();
        const timer = setTimeout(async () => {
            // Full name first, then drop the most specific term until something is found.
            for (let i = 0; i < terms.length; i++) {
                const q = terms.slice(i).join('، ');
                try {
                    const [hit] = await geocodeSearch(q, ctrl.signal);
                    if (hit && mapRef.current) {
                        mapRef.current.setCenter({ lat: hit.lat, lng: hit.lng });
                        mapRef.current.setZoom(i === 0 ? AREA_ZOOM : Math.max(AREA_ZOOM - 2 * i, 9));
                        setFocusNote(i === 0 ? `تركيز تقريبي على «${terms[0]}»` : `لم يُعثر على «${terms[0]}» — تركيز على «${terms[i]}»`);
                        return;
                    }
                } catch {
                    return; // aborted or search unavailable: stay on the default view
                }
            }
        }, 700);
        return () => { clearTimeout(timer); ctrl.abort(); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ready, focusKey, !!value]);

    const runSearch = async () => {
        const q = query.trim();
        if (q.length < 2) return;
        setSearching(true);
        setSearchError(null);
        try {
            setResults(await geocodeSearch(q));
        } catch (err) {
            setSearchError((err as Error)?.message || 'تعذّر البحث');
        } finally {
            setSearching(false);
        }
    };
    const goTo = (r: GeocodeResult) => {
        mapRef.current?.setCenter({ lat: r.lat, lng: r.lng });
        mapRef.current?.setZoom(AREA_ZOOM + 1);
        setFocusNote(`على الخريطة: ${r.label}`);
        setResults(null);
    };

    return (
        <div className="space-y-2">
            <div className="relative">
                <Search className="absolute right-3 top-2.5 w-4 h-4 text-slate-400" />
                <input
                    value={query}
                    onChange={e => { setQuery(e.target.value); setResults(null); }}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void runSearch(); } }}
                    placeholder={focusTerms.filter(Boolean).length ? `ابحث على الخريطة… مثلاً: ${focusTerms.filter(Boolean).join('، ')}` : 'ابحث على الخريطة…'}
                    className="w-full rounded-lg border border-slate-200 bg-white py-2 pr-9 pl-20 text-sm focus:border-sky-500 focus:ring-1 focus:ring-sky-500 focus:outline-none"
                />
                <button
                    type="button"
                    onClick={() => void runSearch()}
                    disabled={searching || query.trim().length < 2}
                    className="absolute left-1.5 top-1.5 flex items-center gap-1 rounded-md bg-sky-600 px-2.5 py-1 text-xs font-bold text-white hover:bg-sky-500 disabled:opacity-40"
                >
                    {searching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'بحث'}
                </button>
                {(results || searchError) && (
                    <div className="absolute inset-x-0 top-full z-30 mt-1 max-h-60 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
                        {searchError && <p className="px-3 py-2 text-xs text-rose-600">تعذّر البحث: {searchError}</p>}
                        {results?.length === 0 && <p className="px-3 py-2 text-xs text-slate-400">لم يجد Google مكاناً بهذا الاسم في سوريا.</p>}
                        {results?.map((r, i) => (
                            <button key={i} type="button" onClick={() => goTo(r)} className="block w-full truncate px-3 py-2 text-right text-sm text-slate-700 hover:bg-sky-50">
                                {r.label}
                            </button>
                        ))}
                    </div>
                )}
            </div>

            <div className="relative overflow-hidden rounded-xl border border-slate-200 shadow-sm" style={{ height }}>
                <div ref={containerRef} dir="ltr" style={{ width: '100%', height: '100%' }} />
                {!ready && (
                    <div className="absolute inset-0 flex items-center justify-center bg-slate-50 text-xs text-slate-400">
                        <Loader2 className="w-4 h-4 animate-spin ml-1" /> تحميل الخريطة…
                    </div>
                )}
                {ready && !value && (
                    <div className="pointer-events-none absolute top-2 inset-x-2 text-center">
                        <span className="inline-block rounded-lg bg-white/95 px-2.5 py-1 text-[11px] font-bold text-slate-600 shadow-sm">
                            انقر على الخريطة لوضع المركز{focusNote ? ` · ${focusNote}` : ''}
                        </span>
                    </div>
                )}
            </div>

            <div className="flex items-center justify-between text-xs">
                <span className="text-slate-500" dir="ltr">
                    {value ? `${value.lat.toFixed(5)}, ${value.lng.toFixed(5)}` : '—'}
                </span>
                {value && (
                    <button type="button" onClick={() => onChange(null)} className="flex items-center gap-1 font-bold text-slate-500 hover:text-red-600">
                        <X className="w-3.5 h-3.5" /> إزالة المركز
                    </button>
                )}
            </div>
        </div>
    );
}
