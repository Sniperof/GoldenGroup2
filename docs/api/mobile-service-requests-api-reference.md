# Mobile Integration Guide — Water Check Service Requests

> Agent-license integration is documented separately in `docs/api/mobile-agent-license-api-reference.md`; it uses this gateway's same fail-closed registry, identity, idempotency, SmartGeo, and upload-token boundaries.

> **Endpoint:** `POST /api/app/service-requests`
> **Request type:** `water_check`
> **Active form version:** `water_check.mobile.v4`
> **Release status:** Implemented in the codebase but not yet applied to an approved environment.

This document defines the authoritative mobile contract for submitting water check service requests. The contract distinguishes among three independent parties:

- **Requester:** The person submitting the request.
- **Beneficiary:** The person whose water is to be checked at the service address.
- **Referrer:** An optional mediator or referring person. A request submitted for another person does not automatically imply that a referrer exists.

There is no confirmation-call requirement in this workflow. Each submitted request is assessed by a human reviewer in the CRM. If accepted, the reviewer links the beneficiary to a client record and may hand the request off to a `device_demo` task.

## 1. Screen Initialization

The mobile application must perform the following steps before displaying the water check form:

1. Call `GET /api/app/service-requests/types`.
2. Display the service only when `water_check` is active and its form version is `water_check.mobile.v4`.
3. If a valid customer access token is available, call `GET /api/app/me` to prefill the registered customer's data.
4. Build the address using the public administrative-area hierarchy. Submit the deepest selected geographical identifiers together with `detailedAddress`.

### Authentication and identification headers

| Submitter | Required identification |
|---|---|
| Registered customer | `Authorization: Bearer <access-token>` |
| Temporarily verified visitor | `X-Visitor-Handle: <handle>`, or `handle` in the request body during the migration period |
| Unverified device | `X-Device-Id: <stable-device-id>`; the request is rejected when this header is absent |

`Content-Type: application/json` is required in all cases.

An invalid Bearer token must never be replaced by a weaker visitor or device identity. The client must treat an authentication failure as an authentication failure and must not retry the same submission without the token.

## 2. Common Request Fields

Every submission is based on the following envelope:

```json
{
  "requestType": "water_check",
  "formVersion": "water_check.mobile.v4",
  "submissionMode": "for_self",
  "governorate": 1,
  "cityOrArea": 12,
  "subArea": 35,
  "neighborhood": 137,
  "detailedAddress": "Street, building, and floor",
  "mapLocation": {
    "lat": 33.5138,
    "lng": 36.2765
  },
  "notes": "Optional notes"
}
```

### Field rules

- `submissionMode` is required and accepts `for_self` or `for_another`.
- `referrerMode` is required only when `submissionMode` is `for_another` and accepts:
  - `none`: No referrer exists.
  - `requester`: The requester is also the referrer.
  - `separate_person`: The referrer is an independent third person.
- `detailedAddress` is required and remains editable for registered customers because it represents the service location, not a profile update.
- The complete SmartGeo selection may be sent with the shared account-form vocabulary: `governorate`, `cityOrArea`, `subArea`, and `neighborhood`. The older water-check aliases `governorateId`, `regionId`, `subdistrictId`, and `neighborhoodId` remain accepted for backward compatibility. Values are numeric `geo_units.id` identifiers, not display names.
- `mapLocation` is optional. The application must not submit `(0, 0)` as a location.
- The father's name is optional for externally submitted water-check parties. It remains required in the account-creation contract.
- A Boolean WhatsApp value is required for every submitted primary phone number.
- The father's name, secondary phone, and secondary-phone WhatsApp Boolean are
  optional. When a secondary phone is supplied without its WhatsApp Boolean,
  the request snapshot stores `secondaryPhoneHasWhatsapp: false`.
- Primary and secondary phone numbers for the same person must be different and must both be valid Syrian mobile numbers.
- Undeclared fields are rejected. The application must construct the API payload explicitly and must not submit the complete form-state object.

## 3. Party Payloads

### 3.1 Beneficiary fields

Use the unprefixed fields for the beneficiary:

```json
{
  "firstName": "Layla",
  "fatherName": "Mohammad",
  "lastName": "Al-Khatib",
  "phoneNumber": "0933333333",
  "primaryPhoneHasWhatsapp": true,
  "secondaryPhone": "0944444444",
  "secondaryPhoneHasWhatsapp": false
}
```

Required fields for a submitted beneficiary are `firstName`, `lastName`, `phoneNumber`, and `primaryPhoneHasWhatsapp`.
`fatherName`, `secondaryPhone`, and `secondaryPhoneHasWhatsapp` are optional in
every mobile service-request type. The Boolean is meaningful only when a
secondary phone exists.

### 3.2 Independent requester fields

Use the `requester` prefix when the requester is distinct from the beneficiary:

```json
{
  "requesterFirstName": "Salem",
  "requesterFatherName": "Ahmad",
  "requesterLastName": "Al-Halabi",
  "requesterPhone": "0911111111",
  "requesterPhoneHasWhatsapp": true,
  "requesterSecondaryPhone": "0922222222",
  "requesterSecondaryPhoneHasWhatsapp": false
}
```

`requesterPhone` and `requesterPhoneHasWhatsapp` are always required for a submitted requester. `requesterFirstName` and `requesterLastName` are optional only for a visitor submitting `for_another` with `referrerMode: "none"`; if either name part is sent, both are required. The stored requester snapshot then has `name: null` and `name_source: "not_provided"`.

For an OTP-verified visitor, `requesterPhone` must match the verified number. For a self-request, the beneficiary's `phoneNumber` must match the verified number.

### 3.3 Referrer identity and address fields

Referrer identity fields are valid only when `referrerMode` is `separate_person`:

```json
{
  "referrerFirstName": "Nour",
  "referrerFatherName": "Ali",
  "referrerLastName": "Omar",
  "referrerPhone": "0955555555",
  "referrerPhoneHasWhatsapp": false,
  "referrerSecondaryPhone": "0966666666",
  "referrerSecondaryPhoneHasWhatsapp": true
}
```

Required fields for a separate referrer are `referrerFirstName`, `referrerLastName`, `referrerPhone`, and `referrerPhoneHasWhatsapp`.
`referrerFatherName`, `referrerSecondaryPhone`, and
`referrerSecondaryPhoneHasWhatsapp` are optional. Omitting the last field while
sending a secondary phone stores `false`.

Whenever a referrer exists (`referrerMode` is `requester` or
`separate_person`), the mobile app must also submit the referrer's own address:

```json
{
  "referrerGovernorate": 1,
  "referrerCityOrArea": 12,
  "referrerSubArea": 123,
  "referrerNeighborhood": 1234,
  "referrerDetailedAddress": "Building 8",
  "referrerMapLocation": { "lat": 33.5138, "lng": 36.2765 }
}
```

`referrerGovernorate`, `referrerCityOrArea`, and `referrerSubArea` are required.
`referrerNeighborhood`, `referrerDetailedAddress`, and `referrerMapLocation` are
optional. The first four values are canonical IDs selected from SmartGeo and
the server validates their level, active status, and parent chain.

With `referrerMode: "requester"`, do not submit `referrerFirstName`,
`referrerLastName`, or any other referrer identity field: identity is derived
from the requester, while the six address fields above describe the mediator's
address. With `referrerMode: "none"`, remove every `referrer*` field, including
the address fields.

## 4. Supported Scenario Matrix

| Identity tier | Beneficiary | `referrerMode` | Required mobile behavior |
|---|---|---|---|
| Registered customer | Self | Not submitted | Submit the service address and optional secondary-phone override. Do not submit immutable identity fields. |
| Registered customer | Another person | `none` | Submit the beneficiary. The requester is derived from the customer account. No referrer exists. |
| Registered customer | Another person | `requester` | Submit the beneficiary and referrer address. The requester and referrer identity are derived from the same customer account. |
| Registered customer | Another person | `separate_person` | Unsupported and rejected by the server. |
| OTP visitor or unverified device | Self | Not submitted | Submit the beneficiary. The beneficiary is also the requester. No referrer exists. |
| OTP visitor or unverified device | Another person | `none` | Submit both beneficiary and requester. No referrer exists. |
| OTP visitor or unverified device | Another person | `requester` | Submit beneficiary, requester, and referrer address. The server snapshots the requester identity as the referrer. |
| OTP visitor or unverified device | Another person | `separate_person` | Submit beneficiary, requester, independent referrer identity, and referrer address. |

## 5. Detailed Submission Scenarios

### 5.1 Registered customer requesting for self

```json
{
  "requestType": "water_check",
  "formVersion": "water_check.mobile.v4",
  "submissionMode": "for_self",
  "secondaryPhone": "0944444444",
  "secondaryPhoneHasWhatsapp": true,
  "governorate": 1,
  "cityOrArea": 12,
  "subArea": 35,
  "neighborhood": 137,
  "detailedAddress": "Updated service address"
}
```

The server derives the following values from the registered client record and rejects them if they are submitted in the body:

- First name.
- Father's name.
- Last name.
- Primary mobile number.
- Primary-mobile WhatsApp status.

The mobile form must display these fields as read-only.

The customer may override the secondary phone and its WhatsApp status for this request only. This override does not update the client profile. To clear the secondary phone from the request snapshot, submit:

```json
{
  "secondaryPhone": "",
  "secondaryPhoneHasWhatsapp": false
}
```

### 5.2 Registered customer requesting for another person without a referrer

Submit:

- `submissionMode: "for_another"`.
- `referrerMode: "none"`.
- The complete beneficiary payload.
- The service address.

Do not submit `requester*` or `referrer*` identity fields. The only permitted
requester overrides are these optional fields:

- `requesterSecondaryPhone`.
- `requesterSecondaryPhoneHasWhatsapp`.

The phone may be sent without the Boolean; in that case WhatsApp support
defaults to `false`. These values affect only the stored request snapshot.

### 5.3 Registered customer acting as the referrer

Use the same payload as scenario 5.2, but submit:

```json
{
  "referrerMode": "requester",
  "referrerGovernorate": 1,
  "referrerCityOrArea": 12,
  "referrerSubArea": 123
}
```

Do not submit referrer identity fields. The server derives both requester and
referrer identity from the registered customer record and preserves the
invariant that both references represent the same client. The three required
referrer address levels must still be submitted; neighborhood, detailed address,
and map location remain optional.

### 5.4 OTP visitor or unverified device requesting for self

Submit the complete beneficiary payload and the service address. Do not submit `referrerMode`, `requester*`, or `referrer*` fields.

The server stores the beneficiary as the requester. For an OTP visitor, `phoneNumber` must match the verified mobile number.

### 5.5 OTP visitor or unverified device requesting for another person without a referrer

Submit:

- The complete beneficiary payload.
- The complete independent requester payload.
- `referrerMode: "none"`.
- The service address.

For an OTP visitor, `requesterPhone` must match the verified mobile number.

### 5.6 OTP visitor or unverified device acting as the referrer

Submit the same fields as scenario 5.5, but use:

```json
{
  "referrerMode": "requester",
  "referrerGovernorate": 1,
  "referrerCityOrArea": 12,
  "referrerSubArea": 123
}
```

Do not submit referrer identity fields. The server copies the requester identity
into the referrer snapshot, adds the submitted referrer address, and marks both
parties as representing the same person.

### 5.7 OTP visitor or unverified device using a separate referrer

Submit:

- The complete beneficiary payload.
- The complete requester payload.
- The complete referrer payload.
- The referrer's required SmartGeo address levels.
- `referrerMode: "separate_person"`.
- The service address.

The three people remain independent. The server does not infer one party's identity from another party's fields.

## 6. Successful Response

A successful submission returns HTTP `201`:

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

`reviewRequiredFlag` does not indicate that a confirmation call is required. It indicates that the request requires human assessment before operational handoff.

The `requesterAuth` value identifies the accepted submitter identity tier:

- `app_account`
- `visitor_otp`
- `device`

## 7. Error Contract

Errors follow this general structure:

```json
{
  "error": "invalid_form_payload",
  "details": {
    "code": "invalid_form_payload",
    "issues": []
  }
}
```

The mobile application must preserve the server's `error` code in telemetry, even when a localized user-facing message is displayed.

| HTTP | Error code | Required handling |
|---:|---|---|
| 400 | `invalid_form_payload` | The payload contains an undeclared field, an invalid type, or an out-of-range value. Inspect `details.issues`. |
| 400 | `submission_mode_required` | `submissionMode` is missing. |
| 400 | `referrer_mode_required` | A `for_another` request omitted `referrerMode`. |
| 400 | `referrer_mode_not_accepted` | A self-request submitted `referrerMode`. |
| 400 | `missing_person_fields` | A party payload is incomplete. Inspect `details.role` and `details.fields`. |
| 400 | `missing_referrer_address_fields` | A request with a referrer omitted governorate, city/area, or sub-area. Inspect `details.fields`. |
| 400 | `registered_requester_separate_referrer_forbidden` | A registered customer attempted to submit an independent third-party referrer. |
| 400 | `identity_fields_not_accepted` | A registered self-request submitted immutable customer identity fields. |
| 400 | `requester_fields_not_accepted` | A registered customer attempted to modify immutable requester identity fields. |
| 400 | `party_fields_not_accepted` | Requester or referrer fields were submitted for a self-request. |
| 400 | `referrer_fields_not_accepted` | Referrer fields were submitted while the selected mode does not accept them. |
| 400 | `verified_phone_does_not_match_requester` | The submitted requester phone does not match the OTP-verified phone. |
| 400 | `secondary_phone_matches_primary` | A registered customer's secondary override matches the primary phone. |
| 400 | `device_id_required` | An unverified submission omitted `X-Device-Id`. |
| 409 | `unsupported_form_version` | The mobile form version does not match the active registry version. |
| 409 | `customer_profile_incomplete` | A registered account is linked to a client record with incomplete required identity data. |
| 409 | `request_type_configuration_mismatch` | The database registry and installed handler disagree. Hide the service and emit telemetry. |
| 413 | `submitted_payload_too_large` | The immutable submitted payload exceeds the configured limit. |
| 429 | `open_request_exists` | The submitter already has an open water-check request. |
| 429 | `daily_limit_exceeded` | The submitter exceeded the daily request limit. |
| 429 | `ip_daily_limit_exceeded` | The unverified-IP safety limit was exceeded. |

When the server returns HTTP `429`, the application must not perform an automatic immediate retry. It must honor `Retry-After` when the header is present.

## 8. Account-Creation Integration

The account-creation contract was extended to ensure that an authenticated water-check form can be populated from authoritative account data.

### Required account-creation changes

- `fatherName` is required and must not be blank.
- `primaryMobileHasWhatsapp` is required and must be a real Boolean.
- `secondaryMobileHasWhatsapp` is required when `secondaryMobile` is supplied.
- `secondaryMobileHasWhatsapp` must not be `true` when no secondary mobile exists.

The account-creation response and `POST /api/app/account-requests/mine` expose these values. Historical account requests may return `null` for fields that did not exist when those records were created.

`GET /api/app/me` exposes the active client profile in the following shape.
`POST /api/app/account-requests/mine` uses the same canonical address shape for
the recovered immutable request snapshot:

```json
{
  "firstName": "Salem",
  "fatherName": "Ahmad",
  "lastName": "Al-Halabi",
  "primaryMobile": "0911111111",
  "primaryMobileHasWhatsapp": true,
  "secondaryMobile": "0922222222",
  "secondaryMobileHasWhatsapp": false,
  "address": {
    "governorateId": 1,
    "cityOrAreaId": 12,
    "subAreaId": 123,
    "neighborhoodId": 1234,
    "governorate": "Damascus",
    "cityOrArea": "Damascus",
    "subArea": "Al-Mazzeh",
    "neighborhood": "Al-Mazzeh 86",
    "detailedAddress": "Building 12, second floor",
    "mapLocation": { "lat": 33.5138, "lng": 36.2765 }
  }
}
```

For a registered customer, the mobile water-check form must:

- Display first name, father's name, last name, primary mobile, and primary-mobile WhatsApp status as read-only.
- Display the service address as editable.
- Display the secondary mobile and its WhatsApp status as editable request-level values.
- Avoid interpreting an editable secondary phone as permission to update the customer's CRM profile.

Populate the four selector levels from the IDs inside `GET /api/app/me.address`,
not from the display names:

```ts
const address = profile.address;
const requestAddress = {
  governorate: address.governorateId,
  cityOrArea: address.cityOrAreaId,
  subArea: address.subAreaId,
  neighborhood: address.neighborhoodId,
  detailedAddress: address.detailedAddress,
  mapLocation: address.mapLocation,
};
```

`addressIds` and `geoUnitId` remain temporary compatibility aliases in `me`;
the top-level `location` remains a temporary compatibility alias in `mine`.
New implementations must use the nested `address` object. `fatherName`,
`secondaryMobile`, and `secondaryMobileHasWhatsapp` are explicitly nullable
when the source record does not contain them.

Submit every non-null level selected by SmartGeo. The server validates the
complete parent chain and persists all four resolved labels and identifiers.

For the complete account API contract, see [`mobile-app-auth-api-reference.md`](./mobile-app-auth-api-reference.md).

## 9. CRM Linking and Handoff Behavior

The following CRM behavior is relevant to mobile developers because it defines the operational meaning of the submitted data:

- Requester, beneficiary, and referrer links are independent.
- A self-request links requester and beneficiary to the same client.
- `referrerMode: "requester"` preserves equality between requester and referrer links.
- A request submitted with `referrerMode: "none"` keeps `referrer_client_id` null.
- Linking the beneficiary to a client is mandatory before handoff.
- Linking the requester or referrer is optional and does not block handoff.
- The intake endpoint never creates a client automatically. Linking or creating a client is a human review decision after the request is claimed.
- An accepted request is handed off atomically and idempotently to a `device_demo` task.
- The generated task uses `source = 'service_request'` and `creation_origin = 'manual_creation'` and retains the source water-check request identifier.

## 10. Mobile Implementation Checklist

- [ ] Load the active service registry before displaying the water-check entry point.
- [ ] Submit `formVersion: "water_check.mobile.v4"`.
- [ ] Never display `separate_person` as an option for a registered customer.
- [ ] Never submit registered customer's immutable fields, even if they exist in local form state.
- [ ] Do not infer that a request for another person has a referrer.
- [ ] Remove all `referrer*` fields when `referrerMode` is `none`.
- [ ] With `referrerMode: "requester"`, send referrer address fields but no referrer identity fields.
- [ ] Whenever a referrer exists, send governorate, city/area, and sub-area for that referrer.
- [ ] Remove independent `requester*` fields when switching back to `for_self`.
- [ ] Submit an explicit Boolean for every primary phone. The secondary-phone
      WhatsApp Boolean is optional; omission means `false` when a secondary
      phone is submitted.
- [ ] Persist `X-Device-Id` across application restarts.
- [ ] Do not silently downgrade an invalid authenticated request to an unverified request.
- [ ] Do not immediately retry after HTTP `429`.
- [ ] Hide the service and emit telemetry when `request_type_configuration_mismatch` is returned.
- [ ] Treat the registered secondary-phone edit as request-specific, not as a profile update.
