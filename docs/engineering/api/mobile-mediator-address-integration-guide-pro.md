# Mobile Mediator Address Integration Guide

> **Audience:** Mobile application developers
> **Submission endpoint:** `POST /api/app/service-requests`
> **Contract status:** Implemented in the codebase; deployment requires migration `416_service_request_mediator_address_contract.sql`
> **Last updated:** 2026-08-12

## 1. Purpose

This document defines the mobile contract for collecting and submitting the
mediator's address in service requests. The mediator is represented by
`referrerMode` and is stored by the server as the request referrer.

The mediator address is independent from the service or beneficiary address.
The mobile application must therefore display and submit a dedicated address
section whenever a mediator exists, even when the requester is also the
mediator.

## 2. Affected Request Types and Form Versions

The mediator-address requirement applies to the following request types:

| Request type | Required form version |
|---|---|
| `water_check` | `water_check.mobile.v4` |
| `emergency_maintenance` | `emergency_maintenance.mobile.v2` |
| `periodic_maintenance` | `periodic_maintenance.mobile.v2` |
| `device_request` | `device_request.mobile.v2` |

The new versions are intentionally incompatible with the preceding versions
because three newly introduced fields are conditionally required.

`golden_warranty` does not accept mediator identity or mediator-address fields
in its current version. Its mediator model remains deferred. Request types that
do not declare `referrerMode`, including `name_nomination`, are also outside the
scope of this contract.

The application must call `GET /api/app/service-requests/types` and use the
`formVersion` returned for each active request type. A form must not be shown or
submitted when the locally supported version differs from the server version.

## 3. Mediator Modes

`referrerMode` is submitted only with `submissionMode: "for_another"`.

| `referrerMode` | Meaning | Mediator identity | Mediator address |
|---|---|---|---|
| `none` | No mediator exists | Forbidden | Forbidden |
| `requester` | The requester is also the mediator | Derived from the requester; `referrer*` identity fields are forbidden | Required |
| `separate_person` | The mediator is a third person | Submitted using the mediator identity fields | Required |

For `submissionMode: "for_self"`, `referrerMode` and all mediator fields are
forbidden.

A registered customer may currently select `none` or `requester`. A registered
customer cannot submit `separate_person`. OTP visitors and unverified devices
may use all three modes where the selected request type permits them.

## 4. Address Fields

The following field names are canonical. No unprefixed address aliases may be
used for the mediator.

| Field | JSON type | Requirement | Validation |
|---|---|---|---|
| `referrerGovernorate` | positive integer | Required when a mediator exists | Active SmartGeo level 1 unit |
| `referrerCityOrArea` | positive integer | Required when a mediator exists | Active SmartGeo level 2 child of the selected governorate |
| `referrerSubArea` | positive integer | Required when a mediator exists | Active SmartGeo level 3 child of the selected city or area |
| `referrerNeighborhood` | positive integer | Optional | Active SmartGeo level 4 child of the selected sub-area |
| `referrerDetailedAddress` | string | Optional | Maximum 500 characters |
| `referrerMapLocation` | object | Optional | Exactly `{ "lat": number, "lng": number }`; latitude `-90..90`, longitude `-180..180` |

The first three administrative levels must always be submitted together. The
server verifies that each supplied unit exists, is active, has the expected
level, and belongs to the preceding unit. The server stores both the IDs and a
resolved label snapshot so that request details remain understandable if the
administrative catalog changes later.

The mediator address does not determine the request branch and does not replace
the request's service address.

## 5. Building the SmartGeo Selector

Use `GET /api/public/areas` to build a cascading selector:

1. Load level 1 units for `referrerGovernorate`.
2. Load the selected governorate's children for `referrerCityOrArea`.
3. Load the selected city or area's children for `referrerSubArea`.
4. Optionally load the selected sub-area's children for
   `referrerNeighborhood`.

When a parent selection changes, clear every dependent child selection. Do not
retain IDs from the previous branch of the hierarchy.

The UI must mark governorate, city/area, and sub-area as required. Neighborhood,
detailed address, and map location must remain optional.

### 5.1 Prefilling from `me` and `mine`

Both customer-profile sources expose the same canonical `address` object:

```json
{
  "fatherName": "Ahmad",
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

Sources:

- `GET /api/app/me` returns the active linked client profile.
- `POST /api/app/account-requests/mine` returns the immutable account-request
  snapshot after OTP verification with purpose `request_status`.

`fatherName`, `secondaryMobile`, each address level, detailed address, and map
location may be `null` when the source record does not contain a value.
`secondaryMobileHasWhatsapp` is a Boolean in `me` (and is `false` when no
secondary number exists); historical `mine` snapshots may return it as `null`.

For selector prefill, use the four `*Id` properties inside `address`. Use the
un-suffixed properties only as display labels. Do not find a SmartGeo unit by
matching its displayed name.

Compatibility aliases remain temporarily available:

- `GET /api/app/me.addressIds` and `GET /api/app/me.geoUnitId` are deprecated.
- `POST /api/app/account-requests/mine.location` is a deprecated alias of
  `address.mapLocation`.

New mobile code must consume the canonical nested `address` object. Existing
code may migrate without requiring an atomic server-and-client release.

## 6. Payload Examples

### 6.1 Requester is the mediator

The requester identity is submitted or derived according to the normal party
contract. Do not duplicate it using `referrerFirstName`, `referrerPhone`, or
other mediator identity fields. Submit only the mediator address fields with
the `referrer` prefix.

```json
{
  "requestType": "periodic_maintenance",
  "formVersion": "periodic_maintenance.mobile.v2",
  "submissionMode": "for_another",
  "referrerMode": "requester",

  "firstName": "Samer",
  "lastName": "Haddad",
  "phoneNumber": "0933333333",
  "primaryPhoneHasWhatsapp": true,

  "requesterFirstName": "Nour",
  "requesterLastName": "Omar",
  "requesterPhone": "0955555555",
  "requesterPhoneHasWhatsapp": true,

  "referrerGovernorate": 1,
  "referrerCityOrArea": 12,
  "referrerSubArea": 123,
  "referrerNeighborhood": 1234,
  "referrerDetailedAddress": "Building 8, second floor",
  "referrerMapLocation": {
    "lat": 33.5138,
    "lng": 36.2765
  },

  "reasonId": 7,
  "deviceSelectionType": "catalog_model",
  "deviceModelId": 17,
  "governorate": 1,
  "cityOrArea": 12,
  "subArea": 123,
  "detailedAddress": "Maintenance service address"
}
```

For an authenticated customer, omit all `requester*` identity fields in the
example above. The server derives requester and mediator identity from the
customer account, but the `referrerGovernorate`, `referrerCityOrArea`, and
`referrerSubArea` fields remain required.

### 6.2 Separate mediator

This mode is available to visitor and unverified-device submissions. Submit
both the mediator identity and the mediator address.

```json
{
  "requestType": "emergency_maintenance",
  "formVersion": "emergency_maintenance.mobile.v2",
  "submissionMode": "for_another",
  "referrerMode": "separate_person",

  "referrerFirstName": "Lina",
  "referrerLastName": "Khalil",
  "referrerPhone": "0944444444",
  "referrerPhoneHasWhatsapp": false,
  "referrerFatherName": "Ahmad",
  "referrerSecondaryPhone": "0955555555",
  "referrerSecondaryPhoneHasWhatsapp": true,

  "referrerGovernorate": 1,
  "referrerCityOrArea": 12,
  "referrerSubArea": 123
}
```

The example is intentionally partial and shows the mediator portion of the
request. The beneficiary, requester, service-address, device, and request-type
specific fields must also satisfy the selected request type's contract.

For a separate mediator, the required identity fields are:

- `referrerFirstName`
- `referrerLastName`
- `referrerPhone`
- `referrerPhoneHasWhatsapp`

The following identity fields are always optional:

- `referrerFatherName`
- `referrerSecondaryPhone`
- `referrerSecondaryPhoneHasWhatsapp`

If `referrerSecondaryPhone` is submitted without
`referrerSecondaryPhoneHasWhatsapp`, the server accepts the request and stores
the WhatsApp flag as `false`.

### 6.3 No mediator

```json
{
  "submissionMode": "for_another",
  "referrerMode": "none"
}
```

Remove every field whose name begins with `referrer` when this mode is selected.
The server does not accept mediator address data as passive or informational
data when no mediator exists.

## 7. Client-Side Visibility and Reset Rules

The mobile form must implement the following behavior:

- Show the mediator-address section only for `requester` and
  `separate_person`.
- Show mediator identity inputs only for `separate_person`.
- Require the first three mediator address levels before enabling submission.
- When switching to `requester`, clear all mediator identity values but retain
  or request the dedicated mediator address.
- When switching to `none`, clear all mediator identity and address values.
- When switching to `for_self`, clear `referrerMode` and all `referrer*` values.
- Do not copy the service-address field names into the mediator payload. The
  mediator fields must retain the `referrer` prefix.

## 8. Relevant Error Responses

| HTTP | Error code | Meaning and required client action |
|---:|---|---|
| 400 | `missing_referrer_address_fields` | One or more required mediator address levels are missing. Read `details.fields`, focus the first missing selector, and do not retry unchanged. |
| 400 | `invalid_form_payload` | A field is undeclared, has the wrong type, exceeds its limit, or contains invalid coordinates. Read `details.issues`. |
| 400 | `referrer_fields_not_accepted` | Mediator fields were sent for `none`, or mediator identity fields were sent for `requester`. Remove the fields identified by `details.fields`. |
| 400 | `party_fields_not_accepted` | Mediator or requester fields were sent with `for_self`. Clear the party section. |
| 400 | `referrer_mode_required` | A `for_another` submission omitted `referrerMode`. |
| 400 | `referrer_mode_not_accepted` | A `for_self` submission included `referrerMode`. |
| 400 | `registered_requester_separate_referrer_forbidden` | An authenticated customer selected `separate_person`. Offer only `none` and `requester`. |
| 400 | SmartGeo validation message | A geographical unit is inactive, at the wrong level, missing, or outside the selected parent chain. Reload the affected selector hierarchy. |
| 409 | `unsupported_form_version` | The submitted form version is not active. Refresh the service-type catalog and require an application update when unsupported locally. |
| 503 | `request_type_configuration_mismatch` | The deployed registry and server handler disagree. Disable submission and report telemetry; repeated client retries cannot resolve it. |

The application should preserve the server error code and `details` object in
diagnostic telemetry while displaying a localized user-facing message.

## 9. Compatibility Checklist

- [ ] Read the active request types and versions from
  `GET /api/app/service-requests/types`.
- [ ] Support `water_check.mobile.v4`.
- [ ] Support `emergency_maintenance.mobile.v2`.
- [ ] Support `periodic_maintenance.mobile.v2`.
- [ ] Support `device_request.mobile.v2`.
- [ ] Display a dedicated mediator address for both mediator modes.
- [ ] Require governorate, city/area, and sub-area.
- [ ] Keep neighborhood, detailed address, and map location optional.
- [ ] Submit canonical SmartGeo IDs, not administrative names.
- [ ] Clear dependent geographical selections when a parent changes.
- [ ] Submit no mediator identity fields when the requester is the mediator.
- [ ] Submit no `referrer*` fields when no mediator exists or the request is for
  self.
- [ ] Keep father name, secondary phone, and secondary WhatsApp support
  optional for the beneficiary and mediator.
- [ ] Treat the mediator address and service address as distinct values.
- [ ] Preserve named server error codes in telemetry.

## 10. Server Persistence and CRM Review

The server stores the mediator address inside the immutable mediator snapshot
associated with the service request. The snapshot contains the canonical IDs,
resolved administrative labels, optional detailed address, and optional map
coordinates.

During CRM review, the employee may link the mediator to an existing client or
create a client record from the submitted mediator snapshot. The stored address
and coordinates are carried into that creation workflow. Linking remains a
human review decision; mobile submission does not automatically create or
modify a client record.
