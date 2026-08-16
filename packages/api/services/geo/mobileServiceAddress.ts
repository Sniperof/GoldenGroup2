// ============================================================
// services/geo/mobileServiceAddress.ts
// ============================================================
// One `service_address` shape for every request arriving from the mobile app.
//
// Before this, the same address picker produced two vocabularies:
//
//   water_check      { governorate: "3", governorateId, regionId,
//                      subdistrictId, neighborhoodId, geo_unit_id,
//                      detailed_address, detailedAddress, mapLocation }
//   account_creation { governorate: 3, city_or_area, sub_area, neighborhood,
//                      detailed_address, location, labels }
//
// Three names for the same level (region / city_or_area / city), ids as a
// string in one path and an integer in the other, and labels in one only — so
// the reviewer read raw numbers on one screen and place names on the next, and
// no query could span both.
//
// Canonical form = the account_creation vocabulary (snake_case, integer ids,
// resolved labels). It wins because it already carries labels, the admin
// service already reads `labels.governorate`, and snake_case matches the rest
// of the JSON stored on `service_requests`.
//
// LEGACY ALIASES: the camelCase keys water_check used are still written. The
// admin review panel resolves geo names client-side from them and existing rows
// carry them; dropping them would break reading old and new rows alike. They
// are a compatibility layer, not a second vocabulary — write the canonical keys
// in new readers, and the aliases can be removed once the last reader moves.
// ============================================================

import type { ResolvedAddress } from './administrativeAddress.js';

/**
 * Label keys are snake_case to match the id keys beside them, and because
 * `submitted_payload.address_labels` and the admin readers already use that
 * spelling on the 21 live account_creation rows.
 */
export interface MobileAddressLabels {
  governorate: string;
  city_or_area: string | null;
  sub_area: string | null;
  neighborhood: string | null;
}

export function buildMobileAddressLabels(resolved: ResolvedAddress): MobileAddressLabels {
  return {
    governorate: resolved.labels.governorate,
    city_or_area: resolved.labels.cityOrArea,
    sub_area: resolved.labels.subArea,
    neighborhood: resolved.labels.neighborhood,
  };
}

export interface MobileServiceAddress {
  // Indexable so it satisfies the `Record<string, unknown>` the request-insert
  // services take, without erasing the named fields for readers.
  [key: string]: unknown;
  // ── Canonical ──
  governorate: number;
  city_or_area: number | null;
  sub_area: number | null;
  neighborhood: number | null;
  geo_unit_id: number;
  detailed_address: string;
  location: { lat: number; lng: number } | null;
  labels: MobileAddressLabels;
  // ── Legacy aliases (see header) ──
  governorateId: number;
  regionId: number | null;
  subdistrictId: number | null;
  neighborhoodId: number | null;
  detailedAddress: string;
  mapLocation: { lat: number; lng: number } | null;
}

/** Deepest supplied level — the unit branch resolution routes on. */
export function deepestGeoUnitId(resolved: ResolvedAddress): number {
  return resolved.ids.neighborhood
    ?? resolved.ids.subArea
    ?? resolved.ids.cityOrArea
    ?? resolved.ids.governorate;
}

export function buildMobileServiceAddress(input: {
  resolved: ResolvedAddress;
  deepestGeoUnitId?: number;
  detailedAddress: string;
  location: { lat: number; lng: number } | null;
}): MobileServiceAddress {
  const { ids } = input.resolved;
  return {
    governorate: ids.governorate,
    city_or_area: ids.cityOrArea,
    sub_area: ids.subArea,
    neighborhood: ids.neighborhood,
    geo_unit_id: input.deepestGeoUnitId ?? deepestGeoUnitId(input.resolved),
    detailed_address: input.detailedAddress,
    location: input.location,
    labels: buildMobileAddressLabels(input.resolved),

    governorateId: ids.governorate,
    regionId: ids.cityOrArea,
    subdistrictId: ids.subArea,
    neighborhoodId: ids.neighborhood,
    detailedAddress: input.detailedAddress,
    mapLocation: input.location,
  };
}
