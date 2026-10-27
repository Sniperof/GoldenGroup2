// Road route through a list of points, via the Google Routes API (computeRoutes).
//
// Always the same kind of route, so a route's distance doesn't drift between
// previews: TRAFFIC_UNAWARE (usual road speeds, no live traffic, no departure
// time) and the SHORTER_DISTANCE reference route when Google offers one that
// differs from its default. Points are area centers, so the result is an
// estimate of the route's length, not the crew's door-to-door path.
//
// Results are not stored (Google's terms limit caching route results); the
// caller computes on demand.

import { GOOGLE_MAPS_API_KEY } from './googleMaps';

export interface RoadLeg { distanceMeters: number; durationSec: number }
export interface RoadRoute {
  path: [number, number][];
  distanceMeters: number;
  durationSec: number;
  legs: RoadLeg[]; // one per consecutive pair of input points
}

// 10 intermediate waypoints per request keeps the request in the basic tier;
// longer routes are split into overlapping chunks (end of one = start of next).
const MAX_POINTS_PER_REQUEST = 12;

export function chunkPoints<T>(points: T[], size = MAX_POINTS_PER_REQUEST): T[][] {
  if (points.length <= size) return [points];
  const chunks: T[][] = [];
  for (let start = 0; start < points.length - 1; start += size - 1) {
    chunks.push(points.slice(start, start + size));
  }
  return chunks;
}

// Google's encoded polyline format → [lat, lng] pairs.
export function decodePolyline(encoded: string): [number, number][] {
  const out: [number, number][] = [];
  let index = 0, lat = 0, lng = 0;
  while (index < encoded.length) {
    for (const axis of [0, 1]) {
      let result = 0, shift = 0, byte: number;
      do {
        byte = encoded.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (axis === 0) lat += delta; else lng += delta;
    }
    out.push([lat / 1e5, lng / 1e5]);
  }
  return out;
}

const seconds = (d: string | undefined) => Number(String(d ?? '0s').replace('s', '')) || 0;
const latLng = ([latitude, longitude]: [number, number]) => ({ location: { latLng: { latitude, longitude } } });

async function computeChunk(points: [number, number][], signal?: AbortSignal): Promise<RoadRoute> {
  const res = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': GOOGLE_MAPS_API_KEY,
      'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline,routes.legs.distanceMeters,routes.legs.duration,routes.routeLabels',
    },
    body: JSON.stringify({
      origin: latLng(points[0]),
      destination: latLng(points[points.length - 1]),
      intermediates: points.slice(1, -1).map(latLng),
      travelMode: 'DRIVE',
      routingPreference: 'TRAFFIC_UNAWARE',
      requestedReferenceRoutes: ['SHORTER_DISTANCE'],
      languageCode: 'ar',
      units: 'METRIC',
    }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error?.message || `Routes API ${res.status}`);
  const routes: any[] = body?.routes ?? [];
  const route = routes.find(r => (r.routeLabels ?? []).includes('SHORTER_DISTANCE')) ?? routes[0];
  if (!route) throw new Error('لم يُعثر على طريق بين هذه المحطات');
  return {
    path: decodePolyline(route.polyline?.encodedPolyline ?? ''),
    distanceMeters: Number(route.distanceMeters ?? 0),
    durationSec: seconds(route.duration),
    legs: (route.legs ?? []).map((l: any) => ({ distanceMeters: Number(l.distanceMeters ?? 0), durationSec: seconds(l.duration) })),
  };
}

export async function computeRoadRoute(points: [number, number][], signal?: AbortSignal): Promise<RoadRoute> {
  if (!GOOGLE_MAPS_API_KEY) throw new Error('لا يوجد مفتاح خرائط Google');
  if (points.length < 2) throw new Error('يلزم محطتان على الأقل');
  const parts = await Promise.all(chunkPoints(points).map(chunk => computeChunk(chunk, signal)));
  return {
    // Chunks share their joining point; drop its duplicate from the path.
    path: parts.flatMap((p, i) => (i === 0 ? p.path : p.path.slice(1))),
    distanceMeters: parts.reduce((s, p) => s + p.distanceMeters, 0),
    durationSec: parts.reduce((s, p) => s + p.durationSec, 0),
    legs: parts.flatMap(p => p.legs),
  };
}

export function formatDistance(meters: number): string {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} كم` : `${Math.round(meters)} م`;
}

export function formatDuration(sec: number): string {
  const total = Math.round(sec / 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h > 0 ? `${h} س ${m} د` : `${m} د`;
}
