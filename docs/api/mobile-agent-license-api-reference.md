# Mobile Agent License Request API

- Endpoint: `POST /api/app/service-requests`
- Request type: `agent_license`
- Form version: `agent_license.mobile.v1`
- Mobile-only, server-derived `self_only`; do not send `submissionMode`.
- Accepts app customer, OTP visitor handle, or unverified `X-Device-Id`.
- Requires a UUID `Idempotency-Key`.
- Allows one open request per submitted primary mobile number.

Approval completes the review with `completed`; it does not create an operational license or an `open_task`.

## Optional uploads

Upload each file to `POST /api/app/service-requests/media` as multipart field `file`, then use the returned `uploadToken`.

- Up to 5 JPEG/PNG/WebP photos, 10MB each.
- Up to 5 PDF documents, 10MB each.
- No video in this form.
- Tokens are temporary, identity-bound, and single-use.

## Fields

| Field | Type | Required | Rule |
|---|---|---:|---|
| `requestType` | string | yes | `agent_license` |
| `formVersion` | string | yes | `agent_license.mobile.v1` |
| `handle` | UUID | OTP only | Consumed on success |
| `firstName` | string | yes | Max 60 |
| `middleName` | string | no | Max 60 |
| `lastName` | string | yes | Max 60 |
| `idNumber` | string | no | Max 40; duplicate is review-only |
| `birthDate` | `YYYY-MM-DD` | yes | Valid past date; no minimum age |
| `primaryMobileNumber` | Syrian mobile | yes | Must match app/OTP identity when verified |
| `primaryMobileHasWhatsapp` | boolean | no | Omission stores `null` |
| `secondaryMobileNumber` | Syrian mobile | no | Must differ from primary |
| `secondaryMobileHasWhatsapp` | boolean | no | Only with secondary number; omission stores `null` |
| `hasCommercialRegistration` | boolean | yes | — |
| `commercialRegistrationNumber` | string | conditional | Required only when registration exists |
| `businessActivityType` | string | yes | Max 160 |
| `yearsOfExperience` | integer | yes | 0–100 |
| `previousExperience` | string | no | Max 2,000 |
| `currentJobDescription` | string | no | Max 2,000 |
| `governorate` | integer | yes | Active SmartGeo level 1 ID |
| `region` | integer | no | Active child level 2 ID |
| `subdistrict` | integer | no | Active child level 3 ID |
| `neighborhood` | integer | no | Active child level 4 ID |
| `detailedAddress` | string | no | Max 500 |
| `locationCoordinates` | object | no | `{ "lat": number, "lng": number }` |
| `additionalNotes` | string | no | Max 2,000 |
| `attachments` | array | no | `{ uploadToken, category: "photo" | "document" }` |

Unknown fields are rejected. `activityType` and a second experience-years field are not declared.

```json
{
  "requestType": "agent_license",
  "formVersion": "agent_license.mobile.v1",
  "firstName": "Omar",
  "lastName": "Haddad",
  "birthDate": "1990-04-15",
  "primaryMobileNumber": "0933333333",
  "hasCommercialRegistration": true,
  "commercialRegistrationNumber": "CR-12345",
  "businessActivityType": "Retail water-treatment equipment",
  "yearsOfExperience": 6,
  "governorate": 1,
  "attachments": [
    { "uploadToken": "00000000-0000-4000-8000-000000000001", "category": "document" }
  ]
}
```

HTTP 201 returns `publicRefNumber`, `status`, `reviewRequired`, `possibleDuplicate`, and `branchResolution`.
