// Google Maps JavaScript API loader — one script tag per page, shared by every
// map. The key comes from VITE_GOOGLE_MAPS_API_KEY (repo-root .env, see
// vite.config envDir). No key → callers fall back to their Leaflet renderer.
//
// The project carries no @types/google.maps, so the API surface is typed
// loosely here; callers use the few members they need.

/* eslint-disable @typescript-eslint/no-explicit-any */
export type GoogleMapsApi = any;

export const GOOGLE_MAPS_API_KEY: string = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? '').trim();

let loading: Promise<GoogleMapsApi> | null = null;
let authFailed = false;
const authFailureListeners = new Set<() => void>();

export function hasGoogleMapsKey(): boolean {
  return GOOGLE_MAPS_API_KEY.length > 0 && !authFailed;
}

// Google calls window.gm_authFailure when it rejects the key (bad key, API not
// enabled, referrer not allowed, billing off). The map is already on screen,
// greyed out — listeners switch to the fallback renderer.
export function onGoogleMapsAuthFailure(listener: () => void): () => void {
  authFailureListeners.add(listener);
  return () => { authFailureListeners.delete(listener); };
}

export function loadGoogleMaps(): Promise<GoogleMapsApi> {
  const w = window as any;
  if (w.google?.maps?.Map) return Promise.resolve(w.google.maps);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const callbackName = '__goldenGoogleMapsReady';
    w[callbackName] = () => resolve(w.google.maps);
    w.gm_authFailure = () => {
      authFailed = true;
      authFailureListeners.forEach(fn => fn());
    };
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
      loading = null;
      reject(new Error('تعذّر تحميل خرائط Google'));
    };
    document.head.appendChild(script);
  });
  return loading;
}
