# Mobile My Devices API Reference

**Audience:** Mobile application developers
**Feature:** "أجهزتي" (My Devices) screen — DEC-017
**Authentication:** Required — `Authorization: Bearer <app-token>`
**Content type:** `application/json`

## 1. Ownership Boundary

This endpoint returns **every** `installed_devices` row where `customer_id` equals the authenticated account's linked client record — regardless of device status. There is no status filter.

This is intentionally broader than the device-picker endpoints used inside service-request forms (`/api/app/service-requests/{emergency-maintenance,periodic-maintenance}/devices` and `/golden-warranty/devices`, see [mobile-service-requests-api-reference.md](mobile-service-requests-api-reference.md) and [mobile-golden-warranty-api-reference.md](mobile-golden-warranty-api-reference.md)): those exclude `returned`/`disposed`, or filter to golden-warranty-eligible active devices, because they exist to let the customer pick a device for a specific request type. This endpoint is a full record screen — a device that was retrieved, had its contract cancelled, or is otherwise inactive must still appear, with its status clearly labeled, rather than silently disappear. See `docs/constitution/decisions/DEC-017-app-devices-and-visits.md` D-AV6.

## 2. List My Devices

`GET /api/app/me/devices`

No query parameters.

### Successful Response (`200`)

```json
{
  "items": [
    {
      "id": 13,
      "deviceModelId": 1,
      "deviceName": "فلتر جولدن جروب 7 مراحل ونص",
      "serialNumber": "123232",
      "status": "installed",
      "contractId": 13,
      "installationAddressText": "جديد",
      "deliveryDate": "2026-08-01",
      "installationDate": "2026-08-01",
      "warrantyType": "contract",
      "warrantyStatus": "active",
      "warrantyEndDate": "2027-06-21"
    }
  ]
}
```

Devices are ordered newest-first (`created_at DESC`). An empty result is returned as `{ "items": [] }`.

### List Item Fields

| Field | Type | Nullable | Description |
|---|---|---:|---|
| `id` | integer | No | Installed-device identifier. |
| `deviceModelId` | integer | Yes | Catalog model ID. Null for a legacy/external device with no catalog link. |
| `deviceName` | string | Yes | Display name — device's own recorded name, else the catalog model's Arabic/English name, else the external device name. |
| `serialNumber` | string | Yes | Serial number, when recorded. |
| `status` | string | No | One of the 11 values in §3. Shown as-is — the app owns how it labels each status, there is no server-side simplification for devices (contrast with visit status, §3 of the visits reference). |
| `contractId` | integer | No | The contract this device was delivered under. |
| `installationAddressText` | string | Yes | Free-text installation address, when recorded. |
| `deliveryDate` | date (`YYYY-MM-DD`) | Yes | Date the device was delivered to the customer. |
| `installationDate` | date (`YYYY-MM-DD`) | Yes | Date the device was installed. |
| `warrantyType` | `"contract"` \| `"golden"` | Yes | Type of the device's most relevant warranty row (§4). `null` when the device has no warranty row at all. |
| `warrantyStatus` | `"pending"` \| `"active"` \| `"cancelled"` \| `"expired"` | Yes | Status of that same warranty row. |
| `warrantyEndDate` | date (`YYYY-MM-DD`) | Yes | End date of that same warranty row. `null` while `pending` (not yet started). |

## 3. Device Status Values

```text
registered | pending_delivery | delivered | installed | active
faulty | in_workshop | ready | out_of_service | retrieved | contract_cancelled
```

`contract_cancelled` means the device's owning contract was cancelled — the device is permanently out of service and dropped from periodic-maintenance generation. It is a terminal state distinct from `retrieved` (device physically taken back, eligible for reissue) and `out_of_service` (temporarily disconnected). The app should still show these devices in the list (§1) with a clearly non-active label; do not hide them.

## 4. Which Warranty Row Is Shown

A device can have more than one `device_warranties` row over its lifetime (a `contract` warranty, later superseded by a `golden` one, per the unified warranty model — DEC-CT-16/17). This endpoint surfaces exactly one, chosen as: the row with `status = 'active'` if one exists, otherwise the most recently created row. This mirrors "one active warranty at a time" — there is never more than one `active` row per device to disambiguate.

Warranty **payment** history (`device_warranty_payments`) is financial detail and is never returned here (DEC-017 §5 — out of scope).

## 5. Errors

| Status | Condition | Example body |
|---:|---|---|
| `401` | Missing or invalid app bearer token | `{ "error": "غير مصرح: يلزم تسجيل الدخول" }` |
| `500` | Unexpected failure | `{ "error": "تعذّر إتمام العملية. حاول لاحقاً." }` |

A `500` response should be treated as retryable. There is no `404` — an account with zero devices gets `{ "items": [] }`, not an error.
