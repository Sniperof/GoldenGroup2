# Mobile Name Nomination API

## Discovery and submission

Discover the active contract with `GET /api/app/service-requests/types`. The entry is:

- `requestType`: `name_nomination`
- `formVersion`: `name_nomination.mobile.v2`
- `submissionModes`: `nomination` (server-derived; do not send `submissionMode`)
- tiers: authenticated customer, OTP visitor, or unverified device

Submit with `POST /api/app/service-requests`, a UUID `Idempotency-Key`, and `X-Device-Id` when unauthenticated and not using an OTP handle.
Load the active occupation vocabulary and live request limits from `GET /api/app/service-requests/name-nomination/options`.

```json
{
  "requestType": "name_nomination",
  "formVersion": "name_nomination.mobile.v2",
  "requesterFirstName": "سارة",
  "requesterLastName": "خالد",
  "requesterPhone": "0999999999",
  "requesterPhoneHasWhatsapp": true,
  "requesterSecondaryPhone": "0988888888",
  "requesterSecondaryPhoneHasWhatsapp": false,
  "names": [
    {
      "firstName": "أحمد",
      "lastName": "محمود",
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

For an authenticated customer, omit `requesterFirstName`, `requesterLastName`, `requesterPhone`, and `requesterPhoneHasWhatsapp`; the server derives them from the account. An optional request-specific secondary phone is accepted and does not update the CRM profile.

For an OTP visitor, `requesterFirstName` is required and the verified phone is authoritative. `requesterPhone` may be omitted; when supplied it must match the verified phone. For an unverified device, requester first name and `requesterPhone` are required.

## Name fields

Every item requires `firstName`, `governorate`, and `primaryPhone`. `lastName`, `cityOrArea`, `subArea`, `neighborhood`, `occupation`, both WhatsApp flags, and the secondary phone are optional. `secondaryPhoneHasWhatsapp` is forbidden without `secondaryPhone`. Geography values are active SmartGeo IDs and must form a contiguous parent chain. `cityOrArea` and `subArea` are respectively SmartGeo levels 2 and 3; they are not a separate hierarchy.

The maximum item count and both daily ceilings are server settings. Duplicate phones do not reject intake. Attachments, consent fields, detailed address, referral controls, and free-text notes are not accepted.

## Response and status

The creation response contains only the request-level result:

```json
{
  "publicRefNumber": "SR-20260812-0001",
  "status": "received",
  "reviewRequired": false,
  "possibleDuplicate": false
}
```

The mobile application must never expose per-name decisions, exclusion reasons, candidate IDs, or branch-resolution details. Overall terminal display overlays are:

- `promoted`: `تمت معالجة الطلب وتحويل أسماء مقترحة`
- `resolved_at_intake`: `تمت مراجعة الطلب دون اعتماد أسماء`

HTTP `400` covers undeclared fields, invalid phones, invalid SmartGeo chains, inactive occupations, and item-count overflow. HTTP `429` means the configured identity or unverified-IP daily ceiling was reached. Reuse of an idempotency key with a different payload returns HTTP `409`.

## Options response

`GET /api/app/service-requests/name-nomination/options` returns:

```json
{
  "occupations": ["تاجر", "موظف"],
  "maxNamesPerRequest": 50,
  "dailyPerIdentity": 5,
  "dailyPerUnverifiedIp": 20
}
```

`occupations` contains strings. Submit the selected string itself in
`names[].occupation`. The three limit values are live server settings and must
not be hard-coded by the mobile application.

## Stable error codes

The mobile application must resolve a machine-readable code as follows:

```ts
const code = response.details?.code ?? response.error;
```

| HTTP | Code | Meaning |
|---:|---|---|
| 400 | `invalid_form_payload` | The body contains an undeclared or invalid field. |
| 400 | `idempotency_key_required` | The UUID `Idempotency-Key` header is missing. |
| 400 | `invalid_idempotency_key` | The header is not a supported UUID. |
| 409 | `idempotency_key_payload_mismatch` | The same key was reused with a different body. |
| 409 | `unsupported_form_version` | Refresh `/types` and submit the advertised version. |
| 429 | `daily_request_quota_reached` | The rolling 24-hour identity or unverified-IP ceiling was reached. |
| 429 | `rate_limited` | The coarse public gateway limit was reached. Honor `Retry-After`. |

`Retry-After` is currently guaranteed for `rate_limited`. A
`daily_request_quota_reached` response includes `details.windowHours = 24` and
may include `details.scope = "ip"`; it does not currently promise a
`Retry-After` header.

## v1 to v2 migration

Version `name_nomination.mobile.v2` replaces four v1-only keys. The server does
not accept them as aliases because the submitted payload is an immutable,
closed contract.

| Retired v1 key | Required v2 key |
|---|---|
| `requesterPrimaryPhone` | `requesterPhone` |
| `requesterPrimaryPhoneHasWhatsapp` | `requesterPhoneHasWhatsapp` |
| `names[].region` | `names[].cityOrArea` |
| `names[].subdistrict` | `names[].subArea` |
