# Mobile Name Nomination API

## Discovery and submission

Discover the active contract with `GET /api/app/service-requests/types`. The entry is:

- `requestType`: `name_nomination`
- `formVersion`: `name_nomination.mobile.v1`
- `submissionModes`: `nomination` (server-derived; do not send `submissionMode`)
- tiers: authenticated customer, OTP visitor, or unverified device

Submit with `POST /api/app/service-requests`, a UUID `Idempotency-Key`, and `X-Device-Id` when unauthenticated and not using an OTP handle.
Load the active occupation vocabulary and live request limits from `GET /api/app/service-requests/name-nomination/options`.

```json
{
  "requestType": "name_nomination",
  "formVersion": "name_nomination.mobile.v1",
  "requesterFirstName": "سارة",
  "requesterLastName": "خالد",
  "requesterPrimaryPhone": "0999999999",
  "requesterPrimaryPhoneHasWhatsapp": true,
  "requesterSecondaryPhone": "0988888888",
  "requesterSecondaryPhoneHasWhatsapp": false,
  "names": [
    {
      "firstName": "أحمد",
      "lastName": "محمود",
      "governorate": 1,
      "region": 12,
      "subdistrict": 123,
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

For an authenticated customer, omit `requesterFirstName`, `requesterLastName`, `requesterPrimaryPhone`, and `requesterPrimaryPhoneHasWhatsapp`; the server derives them from the account. An optional request-specific secondary phone is accepted and does not update the CRM profile.

For an OTP visitor, `requesterFirstName` is required and the verified phone is authoritative. `requesterPrimaryPhone` may be omitted; when supplied it must match the verified phone. For an unverified device, requester first name and primary phone are required.

## Name fields

Every item requires `firstName`, `governorate`, and `primaryPhone`. `lastName`, `region`, `subdistrict`, `neighborhood`, `occupation`, both WhatsApp flags, and the secondary phone are optional. `secondaryPhoneHasWhatsapp` is forbidden without `secondaryPhone`. Geography values are active SmartGeo IDs and must form a contiguous parent chain.

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
