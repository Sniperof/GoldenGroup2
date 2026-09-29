# Name Nomination Mobile Contract Repair Report

Date: 2026-08-13  
Request type: `name_nomination`  
New form version: `name_nomination.mobile.v2`  
Audience: Mobile application development team

## Executive summary

The backend contract has been revised to align the name-nomination request with
the established mobile service-request vocabulary. Four v1-only field names
have been replaced. Their meanings and validation rules have not changed.

The change is published as `name_nomination.mobile.v2` because submitted
service-request payloads are immutable and the form schema is closed. The
backend therefore rejects retired v1 keys instead of accepting undocumented
aliases.

The mobile application must discover the active version from
`GET /api/app/service-requests/types` and must not submit until the returned
`name_nomination` entry advertises `name_nomination.mobile.v2`.

## Required mobile changes

| Retired v1 key | Required v2 key | Location |
|---|---|---|
| `requesterPrimaryPhone` | `requesterPhone` | Request root |
| `requesterPrimaryPhoneHasWhatsapp` | `requesterPhoneHasWhatsapp` | Request root |
| `region` | `cityOrArea` | Each `names[]` item |
| `subdistrict` | `subArea` | Each `names[]` item |

No other name-item key was changed. Continue using `governorate`,
`neighborhood`, `occupation`, `primaryPhone`, `primaryPhoneHasWhatsapp`,
`secondaryPhone`, and `secondaryPhoneHasWhatsapp`.

`cityOrArea` and `subArea` are SmartGeo levels 2 and 3 respectively. They use
the same hierarchy and identifiers as the shared address picker; there is no
separate nomination geography hierarchy.

## Canonical v2 request example

```json
{
  "requestType": "name_nomination",
  "formVersion": "name_nomination.mobile.v2",
  "requesterFirstName": "Sara",
  "requesterLastName": "Khaled",
  "requesterPhone": "0999999999",
  "requesterPhoneHasWhatsapp": true,
  "requesterSecondaryPhone": "0988888888",
  "requesterSecondaryPhoneHasWhatsapp": false,
  "names": [
    {
      "firstName": "Ahmad",
      "lastName": "Mahmoud",
      "governorate": 1,
      "cityOrArea": 12,
      "subArea": 123,
      "neighborhood": 1234,
      "occupation": "تاجر",
      "primaryPhone": "0977777777",
      "primaryPhoneHasWhatsapp": true,
      "secondaryPhone": null,
      "secondaryPhoneHasWhatsapp": null
    }
  ]
}
```

For an authenticated customer, omit `requesterFirstName`,
`requesterLastName`, `requesterPhone`, and `requesterPhoneHasWhatsapp`. The
backend derives them from the customer account. The request-specific secondary
phone remains optional and does not update the CRM profile.

For an OTP visitor, the verified number is authoritative. `requesterPhone` may
be omitted; if supplied, it must match the verified number. For an unverified
device, requester first name and `requesterPhone` are required.

## Options endpoint

`GET /api/app/service-requests/name-nomination/options` returns this exact
shape:

```json
{
  "occupations": ["تاجر", "موظف"],
  "maxNamesPerRequest": 50,
  "dailyPerIdentity": 5,
  "dailyPerUnverifiedIp": 20
}
```

- `occupations` is an array of strings. Send the selected string itself in
  `names[].occupation`.
- Read the item limit from `maxNamesPerRequest`.
- The three numeric values are live settings and must not be hard-coded.

## Error handling contract

Resolve the machine-readable error code with:

```ts
const code = response.details?.code ?? response.error;
```

Relevant stable codes are:

| HTTP | Code | Required mobile behavior |
|---:|---|---|
| 400 | `invalid_form_payload` | Inspect `details.issues`; do not retry unchanged input. |
| 400 | `idempotency_key_required` | Send a UUID `Idempotency-Key`. |
| 400 | `invalid_idempotency_key` | Generate a supported UUID. |
| 409 | `idempotency_key_payload_mismatch` | Use a new key only for a genuinely new logical submission. |
| 409 | `unsupported_form_version` | Refresh `/types` and rebuild the form for the advertised version. |
| 429 | `daily_request_quota_reached` | Stop automatic retries and inform the user that the rolling 24-hour limit was reached. |
| 429 | `rate_limited` | Honor the `Retry-After` response header before retrying. |

`Retry-After` is guaranteed for the coarse `rate_limited` response. It is not
currently guaranteed for `daily_request_quota_reached`; that response contains
`details.windowHours = 24` and may contain `details.scope = "ip"`.

## Compatibility and rollout

1. Deploy migration `419_name_nomination_mobile_v2_keys.sql` with the backend.
2. Confirm `/types` advertises `name_nomination.mobile.v2`.
3. Release the mobile key mapper shown above.
4. Do not send retired v1 keys to a v2 backend; they receive
   `400 invalid_form_payload` with `unknown_field` issues.
5. Historical v1 request snapshots remain readable and are not rewritten.

## Backend verification

Verification completed on 2026-08-13:

- 18 targeted contract and registry tests passed.
- API TypeScript compilation completed successfully with `--noEmit`.
- Migration `419_name_nomination_mobile_v2_keys.sql` completed successfully
  inside a database transaction and was rolled back; it was not applied to the
  development database by this verification.
- `git diff --check` completed without whitespace errors.

The tests cover the v2 version, the four canonical keys, rejection of retired
keys, registry migration alignment, and validator/intake consistency.
