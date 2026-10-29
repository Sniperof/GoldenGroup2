// Free-text place search on the map (Google Geocoding API). Used on request
// only — the user presses «ابحث على الخريطة» — to move the map to a place that
// is not (or not yet) a geo unit with a center. Results are not stored.
// (Places API is not enabled on the key; Geocoding is.)

import { GOOGLE_MAPS_API_KEY } from './googleMaps';

export interface GeocodeResult {
  label: string;
  lat: number;
  lng: number;
}

export async function geocodeSearch(query: string, signal?: AbortSignal): Promise<GeocodeResult[]> {
  if (!GOOGLE_MAPS_API_KEY) throw new Error('لا يوجد مفتاح خرائط Google');
  const params = new URLSearchParams({
    address: query,
    language: 'ar',
    region: 'sy',
    components: 'country:SY',
    key: GOOGLE_MAPS_API_KEY,
  });
  const res = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?${params}`, { signal });
  if (!res.ok) throw new Error(`تعذّر البحث (${res.status})`);
  const body = await res.json();
  if (body.status === 'ZERO_RESULTS') return [];
  if (body.status !== 'OK') throw new Error(body.error_message || body.status);
  const results: { formatted_address: string; geometry: { location: { lat: number; lng: number } } }[] = body.results ?? [];
  return results.slice(0, 5).map(r => ({
    label: String(r.formatted_address),
    lat: Number(r.geometry.location.lat),
    lng: Number(r.geometry.location.lng),
  }));
}
