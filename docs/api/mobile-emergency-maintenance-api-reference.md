# Mobile Emergency Maintenance API — v1

This is the mobile integration contract for `emergency_maintenance`. It extends the existing SERVICE REQUEST gateway; it is not a separate request model.

## Base contract

- Discover active types with `GET /api/app/service-requests/types`. Submit only when `emergency_maintenance` is returned, using its exact `formVersion`.
- Create through `POST /api/app/service-requests` with JSON.
- Send a new UUID in `Idempotency-Key` for each logical submission. Reuse the same key and identical body after a timeout. The same key with a changed body returns `409 idempotency_key_payload_mismatch`.
- A customer sends `Authorization: Bearer <accessToken>`.
- A visitor sends a one-time OTP `handle`, or a stable `X-Device-Id` without OTP. Never downgrade to visitor mode after an invalid bearer token.

## Device selection

Authenticated self-service can list only its own installed devices:

```http
GET /api/app/service-requests/emergency-maintenance/devices
Authorization: Bearer <accessToken>
```

Submit one of:

| `deviceSelectionType` | Required fields | Rule |
|---|---|---|
| `registered_device` | `installedDeviceId` | Authenticated `for_self` only; ownership is verified server-side. |
| `catalog_model` | `deviceModelId`, optional `serialNumber` | Model comes from `GET /api/app/catalog/devices`. |
| `other` | `deviceName`, optional `serialNumber` | Employee must later map it to a Device Management model before creating an external installed device. |

Guests and `for_another` submissions must never see or select another client's registered devices.

## Media

Upload each attachment before creating the request:

```http
POST /api/app/service-requests/media
Content-Type: multipart/form-data
Authorization: Bearer <accessToken>   # customer, when applicable
X-Device-Id: <stable-device-uuid>     # unverified visitor, when applicable

file=<binary>
handle=<otp-handle>                    # OTP visitor only
```

JPEG, PNG, and WebP images are accepted up to 10 MB each. Video must be valid MP4, up to 25 MB and at most 8 seconds; audio is preserved. The server inspects binary content and derives MIME type and duration.

The response contains an opaque `uploadToken`. The final request accepts at most five images and one video. Tokens are identity-bound, expire after two hours, and are consumed atomically by a successful request.

Load the admin-managed safety and attachment vocabularies with `GET /api/app/service-requests/emergency-maintenance/options`. Use returned `code` values in `safetyIndicatorCodes` and attachment `category`; display the returned labels instead of hard-coding them.

## Address

All four SmartGeo levels are accepted:

```json
{
  "governorate": 1,
  "cityOrArea": 12,
  "subArea": 123,
  "neighborhood": 1234,
  "detailedAddress": "Building 12, second floor",
  "mapLocation": { "lat": 33.5138, "lng": 36.2765 }
}
```

Aliases `governorateId`, `regionId`, `subdistrictId`, and `neighborhoodId` are also accepted. The hierarchy must be valid. This address is an immutable request snapshot and never moves a registered device.

## Authenticated customer: own registered device

```http
POST /api/app/service-requests
Authorization: Bearer <accessToken>
Idempotency-Key: 819a58ee-97b6-4e7c-b489-a3fd603d07e8
Content-Type: application/json
```

```json
{
  "requestType": "emergency_maintenance",
  "formVersion": "emergency_maintenance.mobile.v1",
  "submissionMode": "for_self",
  "deviceSelectionType": "registered_device",
  "installedDeviceId": 481,
  "problemDescription": "The pump stopped and water is leaking below the unit.",
  "safetyIndicatorCodes": ["water_leak"],
  "governorate": 1,
  "cityOrArea": 12,
  "subArea": 123,
  "neighborhood": 1234,
  "detailedAddress": "Building 12, second floor",
  "attachments": [
    { "uploadToken": "4ba9f14f-857f-4b15-97fa-9a8fef4e7e89", "category": "device_overview" }
  ]
}
```

Customer identity is derived from the account. Do not send editable first name, last name, or primary phone for `for_self`.

## Request for another person

```json
{
  "requestType": "emergency_maintenance",
  "formVersion": "emergency_maintenance.mobile.v1",
  "submissionMode": "for_another",
  "referrerMode": "requester",
  "firstName": "Samer",
  "lastName": "Haddad",
  "phoneNumber": "0933333333",
  "primaryPhoneHasWhatsapp": true,
  "deviceSelectionType": "catalog_model",
  "deviceModelId": 17,
  "problemDescription": "The device displays an alarm and does not start.",
  "governorate": 1,
  "cityOrArea": 12,
  "subArea": 123,
  "neighborhood": 1234,
  "detailedAddress": "Shop 4"
}
```

An unauthenticated `for_another` request requires `requesterPhone` and its WhatsApp flag. With `referrerMode: "none"`, requester first and last name may both be omitted; the stored requester name is then explicitly `null`. If the requester is also the referrer, requester first and last name remain required. A registered requester uses server-side identity and may choose only `referrerMode: "none"` or `"requester"`.

## Visitor with an unlisted device

```json
{
  "requestType": "emergency_maintenance",
  "formVersion": "emergency_maintenance.mobile.v1",
  "submissionMode": "for_self",
  "handle": "<otp-handle>",
  "firstName": "Lina",
  "lastName": "Saleh",
  "phoneNumber": "0944444444",
  "primaryPhoneHasWhatsapp": false,
  "deviceSelectionType": "other",
  "deviceName": "Unknown countertop purifier",
  "serialNumber": "X-1002",
  "problemDescription": "Strong vibration and unusual noise.",
  "governorate": 1,
  "cityOrArea": 12,
  "detailedAddress": "Near the main square"
}
```

## Success and errors

```json
{
  "publicRefNumber": "SR-20260809-0007",
  "status": "received",
  "reviewRequired": true
}
```

Mobile intake starts at `received`. Duplicate detection flags rather than silently merging or rejecting, and the duplicate decision remains an admin concern. Tracking and push notifications are deferred beyond v1.

| HTTP | `error` | Mobile action |
|---|---|---|
| 400 | `invalid_form_payload` | Fix `details.issues`; undeclared keys are rejected. |
| 400 | `idempotency_key_required` / `invalid_idempotency_key` | Send a valid UUID header for every emergency-maintenance submission. |
| 400 | `invalid_address_hierarchy` | Re-select SmartGeo hierarchy. |
| 400 | `invalid_safety_indicator_codes` | Refresh the admin-managed list. |
| 400 | `attachment_token_invalid_or_expired` | Upload media again. |
| 401 | `invalid_token` | Refresh/login; do not downgrade identity. |
| 403 | `registered_device_selection_forbidden` | Registered devices are authenticated self-service only. |
| 404 | `installed_device_not_found` | Refresh the owned-device list. |
| 409 | `idempotency_key_payload_mismatch` | Use a new key only for a genuinely new submission. |
| 409 | `unsupported_form_version` | Refresh `GET /types`. |
| 413 | `submitted_payload_too_large` | Reduce submitted content. |
| 422 | `video_duration_exceeded` | Trim video to 8 seconds or less. |
| 429 | `rate_limited` / `daily_request_quota_reached` | Respect `Retry-After`. |
| 503 | `request_type_configuration_mismatch` | Disable submission and report configuration drift. |

Do not send free-text `safetyIndicators`. Send admin-issued `safetyIndicatorCodes` only.
