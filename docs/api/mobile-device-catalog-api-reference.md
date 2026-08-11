# Mobile Device Catalog API Reference

**Audience:** Mobile application developers
**API area:** Public device catalog
**Authentication:** None
**Content type:** `application/json`

## 1. Scope

This reference defines the public APIs used by the mobile application to display the device list and device details. The contract intentionally excludes internal catalog fields, prices, department assignments, and inventory quantities.

The "Order Now" workflow is not part of this contract. It will be implemented separately as a device request form.

### Breaking list-contract change — 2026-08-11

`GET /api/app/catalog/devices` is now server-paginated. The response keeps the existing `items` field and adds `total`, `page`, and `limit`, but `items` contains only the requested page. Mobile releases must not assume that the first response contains the complete catalog.

## 2. General Rules

- No bearer token, OTP handle, or account is required.
- Only device models with `is_active = true` and `deleted_at IS NULL` are exposed.
- A missing, inactive, or deleted device produces the same `404` response.
- An empty related section is represented by an empty array, not `null`.
- `activeDiscount` is `null` when there is no currently applicable discount.
- Attachment `url` values may be relative. The mobile client must resolve relative URLs against the API origin.
- Sales-branch availability means that the branch is authorized to sell the model. It is not a real-time stock statement.

## 3. List Published Devices

`GET /api/app/catalog/devices`

### Query Parameters

| Name | Type | Required | Description |
|---|---|---:|---|
| `featured` | boolean string | No | Accepts `true` or `false`. `true` returns featured models only. |
| `category` | string | No | Exact category filter. Maximum 100 characters. |
| `search` | string | No | Case-insensitive search in names, code, and category. Maximum 100 characters. |
| `page` | positive integer | No | Requested page. Defaults to `1`. |
| `limit` | integer `1..50` | No | Items per page. Defaults to `12`. |

### Successful Response (`200`)

```json
{
  "items": [
    {
      "id": 1,
      "nameAr": "فلتر مياه سوسيف",
      "nameEn": "Sous Vide Water Filter",
      "code": "GG-WF-001",
      "category": "منزلي",
      "summary": "محطة متكاملة من ست مراحل لتنقية المياه.",
      "primaryImage": {
        "id": "main-image",
        "name": "الصورة الرئيسية",
        "url": "/uploads/devices/filter-main.jpg"
      },
      "services": ["تسليم", "تركيب", "تعليم"],
      "goldenWarrantyAvailable": true,
      "activeDiscount": {
        "label": "خصم 10%",
        "percentage": 10,
        "validUntil": "2026-08-31"
      },
      "isFeatured": true
    }
  ],
  "total": 50,
  "page": 1,
  "limit": 12
}
```

### Pagination behavior

- Results are ordered by featured status, then Arabic/fallback name, then stable device ID.
- The client has another page while `page * limit < total`.
- Changing `featured`, `category`, or `search` must clear accumulated items and restart from `page=1`.
- When loading additional pages, append items and de-duplicate by `id`.
- An empty first page is the catalog empty state. An empty page beyond the available range does not mean that the catalog itself is empty.
- Pull-to-refresh should clear accumulated items and request page 1 again.

### List Item Fields

| Field | Type | Nullable | Description |
|---|---|---:|---|
| `id` | integer | No | Stable device-model identifier. |
| `nameAr` | string | No | Arabic display name. Falls back to the legacy name when necessary. |
| `nameEn` | string | Yes | English display name. |
| `code` | string | Yes | Public model code. |
| `category` | string | Yes | Catalog category. |
| `summary` | string | Yes | Arabic short description. |
| `primaryImage` | attachment | Yes | Selected primary image, or the first valid image. |
| `services` | string[] | No | Public service values: `تسليم`, `تركيب`, `صيانة`, `تعليم`. |
| `goldenWarrantyAvailable` | boolean | No | Whether the model supports the Golden Warranty. |
| `activeDiscount` | discount | Yes | Current discount evaluated by the Damascus calendar date. |
| `isFeatured` | boolean | No | Featured-display flag. |

When more than one discount is active, the API returns the discount that ends first, then the lowest discount record ID.

## 4. Get Published Device Details

`GET /api/app/catalog/devices/{deviceId}`

`deviceId` must be a positive integer.

### Successful Response (`200`)

```json
{
  "id": 1,
  "nameAr": "فلتر غولدن غروب 5 مراحل",
  "nameEn": "Golden Group Five-Stage Filter",
  "code": "GG-RO-5",
  "category": "منزلي",
  "descriptionAr": "محطة تنقية مياه متكاملة.",
  "descriptionEn": "An integrated water purification unit.",
  "primaryImage": {
    "id": "image-1",
    "name": "Front view",
    "url": "/uploads/devices/ro-5-front.jpg"
  },
  "images": [],
  "videos": [],
  "catalogs": [
    {
      "id": "catalog-ar",
      "name": "Arabic Product Catalog",
      "url": "/uploads/devices/ro-5-catalog.pdf"
    }
  ],
  "maintenanceInterval": "6 أشهر",
  "services": ["تسليم", "تركيب", "صيانة", "تعليم"],
  "purchaseBenefits": [
    { "code": "delivery", "labelAr": "توصيل الجهاز إلى مكان التركيب", "included": true },
    { "code": "installation", "labelAr": "تركيب الجهاز", "included": true },
    { "code": "training", "labelAr": "تدريب على استخدام الجهاز", "included": true },
    { "code": "maintenance", "labelAr": "صيانة حسب العرض المقدم", "included": true }
  ],
  "availableBranches": [
    {
      "id": 2,
      "name": "فرع دمشق",
      "locationName": "دمشق",
      "address": "دمشق - كفرسوسة",
      "primaryImage": {
        "id": "branch-main",
        "name": "Branch front",
        "url": "/uploads/branches/damascus.jpg"
      }
    }
  ],
  "accessories": [
    { "id": 9, "name": "حنفية إضافية", "code": "ACC-9" }
  ],
  "activeDiscount": null,
  "warranty": {
    "standardPeriods": [
      { "months": 24, "label": "سنتان", "visits": 4 }
    ],
    "goldenAvailable": true,
    "goldenPeriods": [
      { "months": 12, "label": "سنة" }
    ]
  },
  "isFeatured": true
}
```

### Detail-Specific Fields

| Field | Type | Description |
|---|---|---|
| `descriptionAr` | string or null | Full Arabic description. |
| `descriptionEn` | string or null | Full English description. |
| `images` | attachment[] | Valid device images. |
| `videos` | attachment[] | Valid device videos. |
| `catalogs` | attachment[] | Public device catalog files configured for this model. |
| `maintenanceInterval` | string or null | Display value for the maintenance interval. |
| `purchaseBenefits` | benefit[] | Benefits derived from the model's configured supported services. |
| `availableBranches` | branch[] | Active, mobile-published branches independently configured as authorized sellers. Each card can open `GET /api/app/catalog/branches/{branchId}`. |
| `accessories` | accessory[] | Active, non-deleted compatible items classified as `Accessory`. Periodic and emergency maintenance parts are excluded. |
| `activeDiscount` | discount or null | Same discount rule as the list endpoint. |
| `warranty.standardPeriods` | warranty period[] | Standard warranty options. |
| `warranty.goldenAvailable` | boolean | Golden Warranty support flag. |
| `warranty.goldenPeriods` | warranty period[] | Golden Warranty periods; empty when Golden Warranty is unavailable. |

### Purchase Benefit Mapping

| Configured service | `code` | Arabic label |
|---|---|---|
| `تسليم` | `delivery` | `توصيل الجهاز إلى مكان التركيب` |
| `تركيب` | `installation` | `تركيب الجهاز` |
| `تعليم` | `training` | `تدريب على استخدام الجهاز` |
| `صيانة` | `maintenance` | `صيانة حسب العرض المقدم` |

The response order is delivery, installation, training, then maintenance. Only configured benefits are returned.

## 5. Shared Object Shapes

### Attachment

```ts
type Attachment = {
  id: string;
  name: string;
  url: string;
};
```

### Active Discount

```ts
type ActiveDiscount = {
  label: string;
  percentage: number; // 0..100
  validUntil: string; // YYYY-MM-DD
};
```

### Available Branch

```ts
type AvailableBranch = {
  id: number;
  name: string;
  address: string | null;
};
```

## 6. Errors

| Status | Condition | Example body |
|---:|---|---|
| `400` | Invalid filter, `page`, `limit`, or device identifier | `{ "error": "limit يجب أن يكون عدداً صحيحاً بين 1 و50" }` |
| `404` | Device is missing, inactive, or deleted | `{ "error": "الجهاز غير موجود" }` |
| `500` | Catalog could not be loaded | `{ "error": "تعذر تحميل تفاصيل الجهاز" }` |

Mobile clients should show an empty state only when page 1 succeeds with `items: []`, and a not-available state for detail `404`. A `500` response should be treated as retryable without discarding pages that were already loaded.

The standalone Branches tab and branch-detail contract are documented in `docs/api/mobile-branch-catalog-api-reference.md`.
