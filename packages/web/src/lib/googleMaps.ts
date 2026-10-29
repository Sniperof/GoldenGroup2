// Google Maps JavaScript API loader — one script tag per page, shared by every
// map. The key comes from VITE_GOOGLE_MAPS_API_KEY (repo-root .env, see
// vite.config envDir). Every map draws on Google; only with no key, a rejected
// key or a script that will not load do callers fall back to Leaflet.
//
// The project carries no @types/google.maps, so the API surface is typed
// loosely here; callers use the few members they need.

/* eslint-disable @typescript-eslint/no-explicit-any */
export type GoogleMapsApi = any;

// `?.`: import.meta.env only exists under Vite — Node tests import this module too.
export const GOOGLE_MAPS_API_KEY: string = (import.meta.env?.VITE_GOOGLE_MAPS_API_KEY ?? '').trim();

let loading: Promise<GoogleMapsApi> | null = null;
let failure: string | null = null;
const failureListeners = new Set<(reason: string) => void>();

export function hasGoogleMapsKey(): boolean {
  return GOOGLE_MAPS_API_KEY.length > 0 && failure == null;
}

// Google is unusable for the rest of the page: it rejected the key (Google
// calls window.gm_authFailure — bad key, API not enabled, referrer not allowed,
// billing off; the map is already on screen, greyed out) or the script failed
// to load. Listeners switch to the fallback renderer.
function markUnavailable(reason: string) {
  if (failure != null) return;
  failure = reason;
  failureListeners.forEach(fn => fn(reason));
}

export function onGoogleMapsUnavailable(listener: (reason: string) => void): () => void {
  failureListeners.add(listener);
  return () => { failureListeners.delete(listener); };
}

export function loadGoogleMaps(): Promise<GoogleMapsApi> {
  const w = window as any;
  if (w.google?.maps?.Map) return Promise.resolve(w.google.maps);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const callbackName = '__goldenGoogleMapsReady';
    w[callbackName] = () => resolve(w.google.maps);
    w.gm_authFailure = () => markUnavailable('رفضت Google مفتاح الخرائط');
    const params = new URLSearchParams({
      key: GOOGLE_MAPS_API_KEY,
      v: 'weekly',
      language: 'ar',
      region: 'SY',
      loading: 'async',
      callback: callbackName,
    });
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
    script.async = true;
    script.onerror = () => {
      markUnavailable('تعذّر تحميل خرائط Google');
      reject(new Error('تعذّر تحميل خرائط Google'));
    };
    document.head.appendChild(script);
  });
  return loading;
}
