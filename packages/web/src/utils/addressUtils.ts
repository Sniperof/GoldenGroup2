import type { GeoUnit } from '@golden-crm/shared';

/**
 * Build a geographic hierarchy label from structured address fields.
 * Resolves neighborhood ID using geo units to display full hierarchy.
 */
export function buildGeoHierarchyLabel(args: {
  geoUnits?: GeoUnit[] | null;
  neighborhoodId?: string | number | null;
  governorate?: string | null;
  district?: string | null;
  fallback?: string | null;
}): string {
  const { geoUnits, neighborhoodId, governorate, district, fallback } = args;

  const parts: string[] = [];

  // Try to resolve neighborhood ID via geoUnits
  if (neighborhoodId && geoUnits && geoUnits.length > 0) {
    const nId = typeof neighborhoodId === 'string' ? parseInt(neighborhoodId, 10) : neighborhoodId;
    if (!isNaN(nId)) {
      const neighborhood = geoUnits.find((u) => u.id === nId);
      if (neighborhood) {
        // Find parent (subarea/district)
        const parent = geoUnits.find((u) => u.id === neighborhood.parentId);
        if (parent) {
          parts.push(parent.name);
          // Find grandparent (governorate)
          const grandparent = geoUnits.find((u) => u.id === parent.parentId);
          if (grandparent) {
            parts.unshift(grandparent.name);
          }
        }
        parts.push(neighborhood.name);
        if (parts.length > 0) return parts.join(' > ');
      }
    }
  }

  // Fallback to text fields if geo resolution failed
  if (governorate) parts.unshift(governorate);
  if (district) parts.push(district);
  if (parts.length > 0) return parts.join(' > ');

  // Final fallback
  return fallback || '—';
}

/**
 * Build a detailed address label.
 */
export function buildDetailedAddressLabel(args: {
  detailedAddress?: string | null;
  fallback?: string | null;
}): string {
  const { detailedAddress, fallback } = args;
  if (detailedAddress && detailedAddress.trim()) return detailedAddress;
  if (fallback && fallback.trim()) return fallback;
  return '—';
}

/**
 * Build a Google Maps URL from coordinates.
 */
export function buildMapsUrl(coords: { lat: number; lng: number } | null | undefined): string | null {
  if (!coords || typeof coords.lat !== 'number' || typeof coords.lng !== 'number') {
    return null;
  }
  return `https://www.google.com/maps?q=${coords.lat},${coords.lng}`;
}
