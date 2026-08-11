# Mobile Device Request API Guide

This guide is the mobile contract for creating a commercial device request through the unified service-request gateway.

## Endpoints

- `GET /api/app/service-requests/types` — confirm that `device_request` is enabled with form version `device_request.mobile.v1`.
- `GET /api/app/catalog/device-request-purposes` — active, admin-managed purposes.
- `GET /api/app/catalog/devices?page=1&limit=12` — paginated active company device models available for selection. Load further pages while `page * limit < total`, and reset to page 1 when search or catalog filters change.
- `POST /api/app/service-requests` — submit the request.

The POST call requires `Content-Type: application/json` and a UUID-valued `Idempotency-Key` header. Retrying the same body with the same key returns the original result; reusing the key with a different body is rejected.

Identification follows the shared gateway:

- Registered customer: `Authorization: Bearer <access-token>`.
- OTP visitor: `X-Visitor-Handle: <handle>` or the migration-period `handle` body field.
- Unverified visitor: `X-Device-Id: <stable-device-id>`.

## Catalog response

`GET /api/app/catalog/device-request-purposes`:

```json
{
  "items": [
    { "id": 501, "code": "device_demo", "label": "طلب عرض جهاز" }
  ]
}
```

Store and submit `id`. `code` is useful for client-side rules, while `label` is display text. Disabled purposes stop appearing for new requests; old requests keep their submitted snapshot.

## Registered customer requesting for self

```http
POST /api/app/service-requests
Authorization: Bearer <access-token>
Idempotency-Key: 7bc2e5d2-3b76-4dd1-87ec-3f40b82b8b75
Content-Type: application/json
```

```json
{
  "requestType": "device_request",
  "formVersion": "device_request.mobile.v1",
  "submissionMode": "for_self",
  "purposeId": 501,
  "deviceModelIds": [12, 18],
  "notes": "I would like to compare these two models."
}
```

The API derives requester, beneficiary, client link, and request branch from the authenticated customer's client record. Do not send requester identity fields or `branchId`.

## Visitor requesting for self

```json
{
  "requestType": "device_request",
  "formVersion": "device_request.mobile.v1",
  "submissionMode": "for_self",
  "firstName": "Visitor",
  "lastName": "Customer",
  "primaryPhone": "0999999999",
  "primaryPhoneHasWhatsapp": true,
  "purposeId": 501,
  "deviceModelIds": [],
  "notes": "I need help choosing the appropriate device."
}
```

`notes` is required when no device model is selected.

## Requesting for another person without a referrer

```json
{
  "requestType": "device_request",
  "formVersion": "device_request.mobile.v1",
  "submissionMode": "for_another",
  "referrerMode": "none",
  "firstName": "Beneficiary",
  "lastName": "Person",
  "primaryPhone": "0988888888",
  "primaryPhoneHasWhatsapp": false,
  "purposeId": 501,
  "deviceModelIds": [12],
  "notes": "Please contact the beneficiary directly."
}
```

For a registered requester, requester identity is derived from the account. For a visitor, requester name may be omitted when `referrerMode` is `none`; the verified visitor phone or stable device identity remains the submission identity. The unprefixed person fields always describe the beneficiary.

Use `referrerMode: "requester"` when the requester is also the mediator, or `referrerMode: "separate_person"` with the shared `referrerFirstName`, `referrerLastName`, `referrerPhone`, and WhatsApp fields for an independent referrer. Registered customers cannot submit a separate referrer in v1.

## Optional address

Address is context only and never selects the request branch. When supplied, send the full SmartGeo depth reached by the user:

```json
{
  "governorate": 1,
  "cityOrArea": 12,
  "subArea": 35,
  "neighborhood": 137,
  "detailedAddress": "Street and building",
  "mapLocation": { "lat": 33.5138, "lng": 36.2765 }
}
```

`governorate` is required if any address field is sent. The aliases `governorateId`, `regionId`, `subdistrictId`, and `neighborhoodId` are also accepted.

## Validation rules

- `purposeId` is required and must reference an active `device_request_purpose` item.
- `deviceModelIds` is optional, unique, and limited to 20 active company model IDs.
- `notes` is required when `deviceModelIds` is empty or the purpose code is `other`; otherwise it is optional.
- Do not send `quantity`, stock/availability fields, `branchId`, `attachments`, images, videos, or files. Undeclared fields are rejected.
- A possible duplicate does not block creation. The response may contain `possibleDuplicate: true`; mobile must not expose another customer's request details.

Successful response:

```json
{
  "publicRefNumber": "SR-20260810-0001",
  "status": "received",
  "reviewRequired": false,
  "possibleDuplicate": false
}
```

The CRM reviewer later links the beneficiary when needed. That beneficiary client determines the request branch. A device-demo task can be created only after claim and beneficiary linking, with an employee and at least one company device model.
