# Mobile Geo Selector Integration Guide

This guide explains how a mobile client should implement a Smart Geo-style address selector and use the selected administrative-area IDs in:

- account creation;
- water-check service requests.

The API is the source of truth. The application displays area names, but it must submit the numeric `geo_units` IDs returned by the API. It must never submit free-text area names as replacements for those IDs.

## 1. Endpoints

All geo-selector endpoints are public and do not require a Bearer token.

```http
GET /api/public/areas
GET /api/public/areas?parent_id={id}
GET /api/public/areas/search?q={text}&limit={1..20}
```

Only active areas are returned. The legacy `activeOnly` query parameter is still accepted for compatibility but is no longer required and cannot be used to expose inactive areas.

The public mobile surface is rate-limited. Cache successful results during the current application session and avoid calling the API on every render.

## 2. Cascading selection

Use the root endpoint to load governorates:

```http
GET /api/public/areas
```

Example response:

```json
[
  {
    "id": 248,
    "name": "Damascus",
    "type": "governorate",
    "parentId": null
  }
]
```

After the user selects an item, load its direct children:

```http
GET /api/public/areas?parent_id=248
```

Repeat this operation for each administrative level:

1. `governorate`
2. `city`
3. `sub_area`
4. `neighborhood`

When a parent selection changes, clear every lower-level selection before loading the new children. For example, changing the governorate must clear the selected city, sub-area, and neighborhood.

An unknown active parent produces an empty list. A malformed `parent_id`, such as text, a negative number, or a repeated query parameter, produces HTTP `400`.

## 3. Smart search

Use the search endpoint when the user types at least two characters:

```http
GET /api/public/areas/search?q=المزة&limit=15
```

Rules:

- `q` is required and must contain 2–80 characters after trimming.
- `limit` is optional, defaults to `15`, and must be between `1` and `20`.
- Search values are treated as plain text, not SQL wildcard patterns.
- A result is omitted when it or any ancestor in its path is inactive.

Example response:

```json
{
  "items": [
    {
      "id": 137,
      "name": "المزة",
      "level": 4,
      "type": "neighborhood",
      "parentId": 35,
      "path": [
        {
          "id": 248,
          "name": "دمشق",
          "level": 1,
          "type": "governorate",
          "parentId": null
        },
        {
          "id": 2,
          "name": "دمشق",
          "level": 2,
          "type": "city",
          "parentId": 248
        },
        {
          "id": 35,
          "name": "منطقة المزة",
          "level": 3,
          "type": "sub_area",
          "parentId": 2
        },
        {
          "id": 137,
          "name": "المزة",
          "level": 4,
          "type": "neighborhood",
          "parentId": 35
        }
      ]
    }
  ]
}
```

The IDs above are illustrative. Always use IDs returned by the target environment.

Recommended mobile behavior:

- debounce search input by approximately 250–350 ms;
- cancel or ignore stale requests when a newer query is issued;
- request no more than 15 results for the normal dropdown;
- store the selected result's full `path` in screen state;
- do not perform four additional lookups after a search selection.

## 4. Mobile state model

Use one normalized selection model for both cascading selection and search:

```ts
type GeoSelection = {
  governorateId: number | null;
  regionId: number | null;
  subdistrictId: number | null;
  neighborhoodId: number | null;
};
```

Convert a search result path by level, not by array index alone:

```ts
function selectionFromPath(path: Array<{ id: number; level: number }>): GeoSelection {
  const byLevel = new Map(path.map((area) => [area.level, area.id]));
  return {
    governorateId: byLevel.get(1) ?? null,
    regionId: byLevel.get(2) ?? null,
    subdistrictId: byLevel.get(3) ?? null,
    neighborhoodId: byLevel.get(4) ?? null,
  };
}
```

The governorate is required by both account creation and water-check requests. Deeper levels are optional, but they must be contiguous:

- a neighborhood requires a sub-area;
- a sub-area requires a city/region;
- every child must belong to the submitted parent.

## 5. Account creation

Account creation requires OTP verification with purpose `account_creation`.

### Step 1: send the OTP

```http
POST /api/app/otp/send
Content-Type: application/json
```

```json
{
  "phone": "0933333333",
  "purpose": "account_creation"
}
```

### Step 2: verify the OTP

```http
POST /api/app/otp/verify
Content-Type: application/json
```

```json
{
  "phone": "0933333333",
  "code": "123456",
  "purpose": "account_creation"
}
```

Save the returned one-time `handle`. It is valid for approximately ten minutes and is consumed by a successful account request.

### Step 3: submit the account request

Map the normalized geo selection to the account contract as follows:

| Mobile selection | Account form field |
|---|---|
| `governorateId` | `governorate` |
| `regionId` | `cityOrArea` |
| `subdistrictId` | `subArea` |
| `neighborhoodId` | `neighborhood` |

```http
POST /api/app/account-requests
Content-Type: application/json
```

```json
{
  "handle": "otp-verification-handle",
  "form": {
    "firstName": "Layla",
    "fatherName": "Mohammad",
    "lastName": "Al-Khatib",
    "primaryMobile": "0933333333",
    "primaryMobileHasWhatsapp": true,
    "secondaryMobile": null,
    "secondaryMobileHasWhatsapp": false,
    "governorate": 248,
    "cityOrArea": 2,
    "subArea": 35,
    "neighborhood": 137,
    "detailedAddress": "Street, building, floor, and nearest landmark",
    "notes": null,
    "location": {
      "lat": 33.5138,
      "lng": 36.2765
    }
  }
}
```

Important rules:

- `primaryMobile` must match the OTP-verified phone.
- `fatherName` and `primaryMobileHasWhatsapp` are required.
- If `secondaryMobile` exists, `secondaryMobileHasWhatsapp` must be an explicit Boolean.
- Submit `null` for an absent lower geo level; do not submit an empty string or an area name.
- Store the successful response snapshot locally. It contains normalized phone numbers, resolved address names, `publicRefNumber`, and the pending status needed by the pending-account screen.

The server re-resolves the submitted IDs, confirms every level and parent relationship, and rejects inactive areas. A stale cached selection can therefore fail with HTTP `400`; refresh the geo data and ask the user to select the address again.

## 6. Water-check requests

Before showing the water-check entry point, call:

```http
GET /api/app/service-requests/types
```

Display the form only when `water_check` is returned as active and its form version is `water_check.mobile.v3`.

Map the normalized selection directly to the water-check fields:

| Mobile selection | Water-check field |
|---|---|
| `governorateId` | `governorateId` |
| `regionId` | `regionId` |
| `subdistrictId` | `subdistrictId` |
| `neighborhoodId` | `neighborhoodId` |

### 6.1 Unregistered user requesting for self

The current water-check flow does not require OTP. Generate one opaque device ID on the first application launch, store it in secure persistent storage, and reuse it across restarts.

```http
POST /api/app/service-requests
Content-Type: application/json
X-Device-Id: 550e8400-e29b-41d4-a716-446655440000
```

```json
{
  "requestType": "water_check",
  "formVersion": "water_check.mobile.v3",
  "submissionMode": "for_self",
  "firstName": "Layla",
  "fatherName": "Mohammad",
  "lastName": "Al-Khatib",
  "phoneNumber": "0933333333",
  "primaryPhoneHasWhatsapp": true,
  "governorateId": 248,
  "regionId": 2,
  "subdistrictId": 35,
  "neighborhoodId": 137,
  "detailedAddress": "Street, building, floor, and nearest landmark",
  "mapLocation": {
    "lat": 33.5138,
    "lng": 36.2765
  },
  "notes": null
}
```

Do not generate a new device ID for each request. The ID is not an authentication credential, but the server uses it to enforce abuse limits. Do not use IMEI or an advertising identifier.

### 6.2 Registered customer requesting for self

Use the customer access token:

```http
POST /api/app/service-requests
Authorization: Bearer <access-token>
Content-Type: application/json
```

```json
{
  "requestType": "water_check",
  "formVersion": "water_check.mobile.v3",
  "submissionMode": "for_self",
  "secondaryPhone": "0944444444",
  "secondaryPhoneHasWhatsapp": false,
  "governorateId": 248,
  "regionId": 2,
  "subdistrictId": 35,
  "neighborhoodId": 137,
  "detailedAddress": "Service location address",
  "mapLocation": null,
  "notes": null
}
```

For a registered self-request, do not submit the customer's first name, father's name, last name, primary mobile, or primary-mobile WhatsApp status. The server derives those immutable values from the linked client record. The address remains editable because it describes the service location, not a profile update.

If the Bearer token is invalid or expired, handle the authentication failure. Never retry the same request after removing the invalid token and silently downgrade the user to the device tier.

### 6.3 Successful response

A successful water-check request returns HTTP `201`:

```json
{
  "id": 84,
  "publicRefNumber": "SR-2026-000084",
  "status": "received",
  "requestType": "water_check",
  "reviewRequiredFlag": true,
  "branchResolution": {
    "status": "resolved",
    "branchId": 3
  },
  "requesterAuth": "device"
}
```

Store `publicRefNumber` for confirmation and support screens. `reviewRequiredFlag` means that human assessment is required before operational handoff; it does not necessarily mean that a confirmation call is required.

## 7. Error handling

- Use HTTP status and machine-readable error codes when a route provides them. Do not branch on localized error text.
- On HTTP `400` caused by an invalid address, discard the stale geo selection, reload the hierarchy, and ask the user to select again.
- On HTTP `401`, refresh the access token or return to login. Do not retry as an anonymous device.
- On HTTP `409 unsupported_form_version`, reload `/api/app/service-requests/types` and hide the outdated form until the application supports the active version.
- On HTTP `429`, do not retry immediately. Honor the `Retry-After` header when present.
- On HTTP `500`, show a generic retry message and preserve diagnostic context in telemetry without logging access tokens, OTP handles, or full personal payloads.

## 8. Implementation checklist

- [ ] Load governorates from `/api/public/areas`.
- [ ] Clear all descendants when a parent selection changes.
- [ ] Debounce smart search and limit it to 15 results.
- [ ] Convert the selected search `path` into IDs by `level`.
- [ ] Submit IDs, never area names.
- [ ] Keep optional lower levels as `null`, not empty strings.
- [ ] Use account-field names for account creation and water-check-field names for service requests.
- [ ] Use OTP purpose `account_creation` only for account creation.
- [ ] Use a stable `X-Device-Id` for an unregistered water-check request.
- [ ] Use Bearer authentication for a registered water-check request.
- [ ] Never downgrade an invalid authenticated request to an anonymous request.
- [ ] Refresh cached geo data after the server rejects a stale or inactive selection.
