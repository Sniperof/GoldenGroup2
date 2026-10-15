# Mobile Branch Catalog API Reference

**Audience:** Mobile application developers
**Feature:** Standalone Branches tab and branch details
**Authentication:** None
**Content type:** `application/json`

## 1. Publication Boundary

A branch is public only when both conditions are true:

```text
status = active
mobileVisible = true
```

The same boundary is applied to the Branches tab, branch details, device-to-branch links, and the devices returned inside branch details. Hidden, inactive, and unknown branches are indistinguishable through the public detail endpoint.

Only contacts assigned to the `customer_service` department are public. Contact labels, department identifiers, HR contacts, management contacts, accounting contacts, and internal branch coverage are never returned.

## 2. List Published Branches

`GET /api/app/catalog/branches`

### Query Parameters

| Name | Type | Required | Description |
|---|---|---:|---|
| `search` | string | No | Case-insensitive search in branch name, detailed address, and location name. Maximum 100 characters. |
| `geoUnitId` | positive integer | No | Exact primary geographic-unit filter. |

### Successful Response (`200`)

```json
{
  "items": [
    {
      "id": 2,
      "name": "فرع دمشق",
      "description": "فرع الشركة الرئيسي في دمشق.",
      "locationName": "دمشق",
      "address": "الحميدية",
      "primaryImage": {
        "id": "branch-main",
        "name": "واجهة الفرع",
        "url": "/uploads/branches/damascus.jpg"
      },
      "mapLocation": {
        "latitude": 33.5138,
        "longitude": 36.2765
      }
    }
  ]
}
```

Branches are ordered by the dashboard-defined `mobileDisplayOrder`, then name, then ID. An empty result is returned as `{ "items": [] }`.

### List Item Fields

| Field | Type | Nullable | Description |
|---|---|---:|---|
| `id` | integer | No | Stable branch identifier and navigation argument. |
| `name` | string | No | Public branch name. |
| `description` | string | Yes | Public mobile description. |
| `locationName` | string | Yes | Primary geographic-unit name. |
| `address` | string | Yes | Detailed branch address. |
| `primaryImage` | attachment | Yes | Configured primary image, or the first valid image. |
| `mapLocation` | map location | Yes | Coordinates when both latitude and longitude are configured. |

Selecting a card should navigate to the branch details screen using its `id`.

## 3. Get Published Branch Details

`GET /api/app/catalog/branches/{branchId}`

`branchId` must be a positive integer.

### Successful Response (`200`)

```json
{
  "id": 2,
  "name": "فرع دمشق",
  "description": "فرع الشركة الرئيسي في دمشق.",
  "locationName": "دمشق",
  "address": "الحميدية",
  "primaryImage": {
    "id": "branch-main",
    "name": "واجهة الفرع",
    "url": "/uploads/branches/damascus.jpg"
  },
  "images": [
    {
      "id": "branch-main",
      "name": "واجهة الفرع",
      "url": "/uploads/branches/damascus.jpg"
    }
  ],
  "mapLocation": {
    "latitude": 33.5138,
    "longitude": 36.2765
  },
  "contacts": [
    { "type": "mobile", "value": "09xxxxxxxx" },
    { "type": "phone", "value": "011xxxxxxx" }
  ],
  "devices": []
}
```

### Detail Fields

| Field | Type | Description |
|---|---|---|
| `images` | attachment[] | Full valid branch image gallery. Maximum configured gallery size is 20. |
| `contacts` | contact[] | Valid `customer_service` contacts only. Supported types are `mobile`, `phone`, `email`, and `website`. |
| `devices` | PublicDeviceListItem[] | Active, non-deleted devices actively assigned for sale in this branch. |

The device object is the same object returned by `GET /api/app/catalog/devices`. Its Golden Warranty and active discount fields therefore follow the device catalog contract.

## 4. Shared Object Shapes

```ts
type Attachment = {
  id: string;
  name: string;
  url: string;
};

type MapLocation = {
  latitude: number;  // -90..90
  longitude: number; // -180..180
};

type PublicBranchContact = {
  type: 'mobile' | 'phone' | 'email' | 'website';
  value: string;
};
```

Attachment URLs may be relative and should be resolved against the API origin. `primaryImage` and `mapLocation` are `null` when unavailable; arrays are always returned as arrays.

## 5. Mobile Navigation Contract

```text
Branches tab
  -> GET /api/app/catalog/branches
  -> select branch ID
Branch details
  -> GET /api/app/catalog/branches/{branchId}
  -> select device ID
Device details
  -> GET /api/app/catalog/devices/{deviceId}
```

Device details also return `availableBranches`. Selecting one of those branch cards must open the same branch details screen and endpoint.

## 6. Errors

| Status | Condition | Example body |
|---:|---|---|
| `400` | Invalid branch ID, search length, or geographic-unit ID | `{ "error": "معرف الفرع غير صالح" }` |
| `404` | Branch is missing, inactive, or not published for mobile | `{ "error": "الفرع غير موجود" }` |
| `500` | Branch catalog could not be loaded | `{ "error": "تعذر تحميل تفاصيل الفرع" }` |

The list screen should show an empty state for `{ "items": [] }`. Detail `404` should show a not-available state. A `500` response should be treated as retryable.
