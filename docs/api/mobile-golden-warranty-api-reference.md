# Mobile Golden Warranty Request API

This document describes `golden_warranty.mobile.v1`. A request asks staff to review and create a `golden_warranty_offer` task. It does not activate a warranty and never carries a price.

## Authentication

The intake accepts one of three identities:

- Customer: `Authorization: Bearer <app-token>`.
- OTP visitor: a valid visitor `handle` in the JSON body.
- Unverified device: no bearer token or handle, with a stable `X-Device-Id` header.

Every submission requires `Idempotency-Key`. Unverified submissions are review flagged and subject to device/IP quotas. The public response contains only the public request reference, status, and review flags.

## Eligible choices

Authenticated self-service users must load their installed-device choices:

`GET /api/app/service-requests/golden-warranty/devices`

The response includes only active installed devices whose active model supports golden warranty and has at least one configured period. Each item carries its own `goldenWarrantyPeriods` array. Informational `hasActiveWarranty` and `hasActiveGoldenWarrantyOffer` flags do not block submission; staff resolve those requests during review.

Visitors and all `for_another` flows load visitor-safe models:

`GET /api/app/service-requests/golden-warranty/models`

Each model is active, golden-warranty eligible, and carries its own non-empty `goldenWarrantyPeriods` array:

```json
{
  "items": [
    {
      "id": 12,
      "deviceName": "Example model",
      "goldenWarrantyPeriods": [
        { "months": 12, "label": "12 months" },
        { "months": 24, "label": "24 months" }
      ]
    }
  ]
}
```

The selected `requestedWarrantyMonths` must exist in the selected device/model item. Never combine a period obtained from a different model.

## Submit for self as an authenticated customer

`POST /api/app/service-requests`

Headers:

```http
Authorization: Bearer <app-token>
Idempotency-Key: <stable-uuid-or-random-key>
Content-Type: application/json
```

Body:

```json
{
  "requestType": "golden_warranty",
  "formVersion": "golden_warranty.mobile.v1",
  "submissionMode": "for_self",
  "installedDeviceId": 41,
  "requestedWarrantyMonths": 24,
  "beneficiaryContactConsentConfirmed": true,
  "notes": "Optional request note"
}
```

The customer identity and registered device/model/serial are derived server-side. Do not send beneficiary identity fields, `deviceModelId`, or `serialNumber` in this flow.

## Submit for another person

This flow is available to customers, OTP visitors, and unverified devices. The requester is not automatically a referrer, so there is no `referrerMode` field.

```json
{
  "requestType": "golden_warranty",
  "formVersion": "golden_warranty.mobile.v1",
  "submissionMode": "for_another",
  "firstName": "Beneficiary",
  "lastName": "Name",
  "phoneNumber": "0930000000",
  "primaryPhoneHasWhatsapp": true,
  "requesterFirstName": "Requester",
  "requesterLastName": "Name",
  "requesterPhone": "0940000000",
  "requesterPhoneHasWhatsapp": false,
  "deviceModelId": 12,
  "serialNumber": "OPTIONAL-SERIAL",
  "requestedWarrantyMonths": 12,
  "beneficiaryContactConsentConfirmed": true
}
```

For an authenticated requester, requester identity comes from the account; only requester secondary-contact override fields may be sent. For an OTP visitor, `requesterPhone` must match the verified phone when it is supplied.

## Visitor self submission

A visitor or unverified device cannot claim ownership of a registered installed-device record. Send beneficiary identity, `deviceModelId`, and an optional serial number instead:

```json
{
  "requestType": "golden_warranty",
  "formVersion": "golden_warranty.mobile.v1",
  "submissionMode": "for_self",
  "firstName": "Customer",
  "lastName": "Name",
  "phoneNumber": "0930000000",
  "primaryPhoneHasWhatsapp": true,
  "deviceModelId": 12,
  "requestedWarrantyMonths": 12,
  "beneficiaryContactConsentConfirmed": true,
  "handle": "<otp-visitor-handle-if-used>"
}
```

## Success response

```json
{
  "publicRefNumber": "SR-20260811-0001",
  "status": "received",
  "reviewRequired": true,
  "possibleDuplicate": false
}
```

## Important errors

- `idempotency_key_required`: missing `Idempotency-Key`.
- `beneficiary_contact_consent_required`: consent was not explicitly confirmed.
- `eligible_installed_device_not_found`: the authenticated self-service device is absent, inactive, not owned, or not eligible.
- `golden_warranty_device_model_not_found`: the public model is absent, inactive, or not eligible.
- `requested_warranty_period_not_supported`: the submitted months are not present in that model's periods.
- `installed_device_id_not_accepted`: visitor or `for_another` tried to submit a registered device ID.
- `device_model_id_not_accepted`: authenticated `for_self` tried to override the registered device model.
- `referrer_mode_not_accepted`: this request type does not turn the requester into a referrer.
- `daily_request_quota_reached` / `rate_limited`: requester-device or IP quota reached.

## Lifecycle

Staff claim the request, link the beneficiary and actual installed device, then either resolve/reject it with a structured reason or create the offer task. Task creation changes the request to `promoted`, sets `closedAt`, and links `linkedOpenTaskId`. The locked device and requested months are enforced again when the offer result is recorded. A later task activation, reschedule, refusal, or cancellation never changes the closed request.
