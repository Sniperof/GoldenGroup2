# Complaints V1 API Contract

> **Status:** implemented V1 contract
> **Domain:** independent complaints; never creates a `service_request`
> **Mobile base:** `/api/app/complaints`
> **CRM base:** `/api/complaints`

## 1. Shared codes

```ts
type ComplaintType = 'technical' | 'device' | 'general';
type ComplaintStatus =
  | 'new' | 'triaged' | 'assigned' | 'in_progress'
  | 'awaiting_complainant' | 'resolved' | 'closed'
  | 'rejected' | 'withdrawn';
type ComplaintPriority = 'critical' | 'high' | 'normal' | 'low';
type IdentitySource = 'app_account' | 'visitor_otp' | 'unverified_device' | 'staff_recorded';
type PreferredContactMethod = 'phone' | 'whatsapp' | 'sms' | 'no_preference';
```

Unknown fields are rejected. Numeric IDs are returned as JSON numbers at the API boundary.

## 2. Options

### `GET /api/app/complaints/options`

Public, rate-limited. Returns fixed type/category labels and attachment rules. It does not return employees, teams, visits, devices, permissions, or administrative result codes.

```json
{
  "types": [
    { "code": "technical", "label": "شكوى فنية" },
    { "code": "device", "label": "شكوى جهاز" },
    { "code": "general", "label": "شكوى عامة" }
  ],
  "technicalCategories": [{ "code": "execution_quality", "label": "جودة تنفيذ الخدمة" }],
  "deviceIssueTypes": [{ "code": "electrical_fault", "label": "عطل كهربائي" }],
  "attachments": {
    "acceptedMimeTypes": ["image/jpeg", "image/png", "image/webp"],
    "maxImageBytes": 10485760,
    "maxTotalBytes": 31457280,
    "maxVerifiedImages": 5,
    "maxUnverifiedImages": 2
  }
}
```

## 3. Image upload

### `POST /api/app/complaint-uploads`

Multipart field: `file`.

- Optional valid Bearer is accepted; an invalid Bearer never downgrades to visitor.
- Unauthenticated callers must send `X-Device-Id`.
- JPEG/PNG/WebP only, verified from bytes.
- The server reuses the unified media pipeline: byte inspection, WebP normalization, resize, thumbnail, checksum, and metadata/EXIF removal.
- Bytes are stored in the sharded `MEDIA_DIR` and registered in `media_files` as `visibility=private`.
- Returns a temporary, identity-bound, single-use token.

```json
{
  "uploadToken": "uuid",
  "mimeType": "image/jpeg",
  "byteSize": 245120,
  "expiresAt": "2026-08-17T14:30:00.000Z"
}
```

No CRM upload endpoint exists.

The response never includes `/m/...`, `publicId`, `storageKey`, or a public URL. The token references the private `media_files` row indirectly. On successful complaint creation, `complaint_attachments.media_file_id` is attached transactionally and ownership becomes `owner_type=complaint_attachment`.

## 4. Mobile create

### `POST /api/app/complaints`

Supports a valid App Account, a verified visitor handle, or an unverified `X-Device-Id`.

Common request fields:

| Field | Type | Required | Rule |
|---|---|---:|---|
| `formVersion` | string | yes | `complaint.mobile.v1` |
| `complaintType` | enum | conditional | Omitted for visit/device context; server derives it |
| `technicalCategory` | enum | technical | Required for technical |
| `deviceIssueType` | enum | device | Required for device |
| `otherCategoryText` | string | conditional | Required when category is `other`, max 300 |
| `description` | string | yes | Trimmed, 20–5000 characters |
| `incidentDate` | `YYYY-MM-DD` | no | Not future; visit context derives its date |
| `reportedTargetName` | string | no | Untrusted snapshot, max 200 |
| `secondaryPhone` | string | no | Complaint-specific for every identity; does not update client |
| `secondaryPhoneHasWhatsapp` | boolean | no | Optional; accepted only with `secondaryPhone` |
| `preferredContactMethod` | enum | no | Defaults to `no_preference` |
| `attachments` | array | no | `{ uploadToken }` only |
| `submissionContext` | tagged union | yes | See §4.1 |
| `visitor` | object | visitor | See §4.2 |
| `verificationHandle` | UUID | OTP visitor | Consumed only on successful create |

There is no declaration field and no audio/document/video attachment.

### 4.1 Submission contexts

```ts
type SubmissionContext =
  | { kind: 'general' }
  | { kind: 'visit'; fieldVisitId: number }
  | { kind: 'installed_device'; installedDeviceId: number }
  | { kind: 'manual_device'; deviceNumber: string; reportedLastMaintenanceDate?: string };
```

Rules:

- `visit` requires App Account, ownership check, and forces `technical`.
- `installed_device` requires App Account, ownership check, and forces `device`.
- `manual_device` requires App Account or OTP visitor and forces `device`.
- Unverified visitor supports `general` with type general/technical only; it cannot send internal IDs.

### 4.2 Visitor fields

```json
{
  "visitor": {
    "firstName": "Ahmad",
    "middleName": "Mahmoud",
    "lastName": "Haddad",
    "primaryPhone": "0933333333",
    "primaryPhoneHasWhatsapp": true,
    "governorate": 1,
    "region": 12,
    "subdistrict": null,
    "neighborhood": null,
    "detailedAddress": "قرب الساحة الرئيسية"
  }
}
```

Visitor field rules:

| Field | Required | Rule |
|---|---:|---|
| `firstName` | yes | Max 60 |
| `middleName` | no | Father's name, max 60 |
| `lastName` | yes | Max 60 |
| `primaryPhone` | yes | Normalized Syrian mobile |
| `primaryPhoneHasWhatsapp` | no | Boolean or omitted |
| `governorate` | yes | Active SmartGeo level 1 ID |
| `region` | no | Active level 2 child of governorate |
| `subdistrict` | no | Active level 3 child of region; region required when supplied |
| `neighborhood` | no | Active level 4 child of subdistrict; ancestors required when supplied |
| `detailedAddress` | no | Max 500 |

The server stores the validated SmartGeo IDs and an immutable name/path snapshot. App Account submissions must omit visitor identity/address fields. The server derives name, primary phone, client link, and Lead/FOP/OP snapshot.

Mobile address selectors reuse the public SmartGeo endpoints (`GET /api/public/areas` and `/search`) and submit IDs, not free-text administrative names.

### 4.3 Visit example

```json
{
  "formVersion": "complaint.mobile.v1",
  "submissionContext": { "kind": "visit", "fieldVisitId": 812 },
  "technicalCategory": "execution_quality",
  "description": "تم تنفيذ الخدمة بصورة غير مكتملة...",
  "preferredContactMethod": "phone",
  "attachments": [{ "uploadToken": "00000000-0000-4000-8000-000000000001" }]
}
```

### 4.4 Device example

```json
{
  "formVersion": "complaint.mobile.v1",
  "submissionContext": { "kind": "installed_device", "installedDeviceId": 44 },
  "deviceIssueType": "recurring_fault",
  "description": "العطل نفسه تكرر بعد آخر صيانة.",
  "attachments": []
}
```

### 4.5 Create response

HTTP `201`:

```json
{
  "id": 91,
  "publicRefNumber": "CMP-20260817-0001",
  "publicStatus": "received",
  "submittedAt": "2026-08-17T12:00:00.000Z",
  "reviewRequired": false,
  "possibleDuplicate": false
}
```

`reviewRequired` and `possibleDuplicate` are create acknowledgement hints only; they are not returned in later customer detail responses.

## 5. Registered user tracking

### `GET /api/app/me/complaints`

Requires an App Account Bearer token. Returns complaints submitted by this App Account, newest first. It does not trust phone matching for ownership.

```http
GET /api/app/me/complaints HTTP/1.1
Authorization: Bearer <app-account-access-token>
```

HTTP `200`:

```json
{
  "items": [
    {
      "id": 91,
      "publicRefNumber": "CMP-20260817-000001",
      "complaintType": "technical",
      "submittedAt": "2026-08-17T12:00:00.000Z",
      "description": "تم تنفيذ الخدمة بصورة غير مكتملة...",
      "publicStatus": "received",
      "timeline": [
        {
          "status": "received",
          "message": "تم استلام الشكوى",
          "createdAt": "2026-08-17T12:00:00.000Z"
        }
      ],
      "publicResolutionSummary": null,
      "attachments": [
        {
          "id": 18,
          "url": "/api/app/complaints/91/attachments/18"
        }
      ],
      "subjectContext": {
        "kind": "visit",
        "visitId": 812,
        "visitDate": "2026-08-15",
        "visitType": "maintenance",
        "teamName": null
      }
    }
  ]
}
```

### `GET /api/app/me/complaints/:id`

Requires App Account and requester ownership. Returns:

- public reference, type and submitted date;
- public status and public timeline;
- the immutable submitted description and the user's submitted images;
- safe visit/device context summary where applicable;
- current public resolution summary when resolved/closed.

It never returns priority, branch/handler assignment, duplicate flags, internal targets, internal notes, resolution notes, or audit events.

Submitted images are represented by complaint attachment IDs and protected read URLs under the complaint API. They are never represented by `/m/...` URLs.

The response object has the same item shape shown above. A missing complaint and a complaint owned by another account both return `404 complaint_not_found`; the API never confirms that another customer's complaint exists.

### 5.1 `subjectContext` contract

`subjectContext` is always present. It is a safe, immutable summary of what the complaint concerned at submission/link time. The mobile client must switch on `kind` and must tolerate nullable optional display fields.

```ts
type RegisteredSubjectContext =
  | { kind: 'general' }
  | {
      kind: 'visit';
      visitId: number;
      visitDate: string | null;       // YYYY-MM-DD
      visitType: string | null;
      teamName: string | null;
    }
  | {
      kind: 'installed_device';
      installedDeviceId: number;
      deviceName: string | null;
      serialNumber: string | null;
    }
  | {
      kind: 'manual_device';
      deviceNumber: string | null;
      deviceName: string | null;
      serialNumber: string | null;
      lastMaintenanceDate: string | null; // YYYY-MM-DD
    };
```

The registered-user response includes `visitId` or `installedDeviceId` because requester ownership has already been enforced. The app may use these IDs to navigate to that customer's visit/device page. It must not assume the referenced live record still exists; the other fields come from the complaint snapshot and remain displayable independently.

Visit example:

```json
{
  "kind": "visit",
  "visitId": 812,
  "visitDate": "2026-08-15",
  "visitType": "maintenance",
  "teamName": null
}
```

Installed-device example:

```json
{
  "kind": "installed_device",
  "installedDeviceId": 44,
  "deviceName": "جهاز غولدن",
  "serialNumber": "SN-90871"
}
```

Manual-device example:

```json
{
  "kind": "manual_device",
  "deviceNumber": "FILTER-7",
  "deviceName": null,
  "serialNumber": null,
  "lastMaintenanceDate": "2026-07-10"
}
```

Home/general context example (this also applies to a home-submitted technical complaint that is not linked to a visit):

```json
{
  "kind": "general"
}
```

Privacy rules:

- raw `context_snapshot`, branch IDs, employee IDs, team keys, and device status are never returned;
- `teamName` is returned only when a safe display name exists in the stored snapshot; otherwise it is `null`;
- live visit/device changes do not rewrite the complaint's submitted context;
- clients must use `kind`, not `complaintType`, to decide whether to render a linked visit/device card.

## 6. Visitor tracking

### `POST /api/app/complaints/tracking/otp/send`

Body: `{ publicRefNumber, phone }`. The response is deliberately neutral.

### `POST /api/app/complaints/tracking/otp/verify`

Body: `{ publicRefNumber, phone, code }`. Success returns a short-lived `trackingHandle` bound to that complaint and phone.

### `POST /api/app/complaints/tracking`

Body: `{ trackingHandle }`. Returns the same public detail shape as §5, but a visitor response omits `visitId` and `installedDeviceId`. The public reference alone is never sufficient.

```http
POST /api/app/complaints/tracking HTTP/1.1
Content-Type: application/json

{
  "trackingHandle": "00000000-0000-4000-8000-000000000099"
}
```

Visitor visit-context response excerpt:

```json
{
  "id": 91,
  "publicRefNumber": "CMP-20260817-000001",
  "complaintType": "technical",
  "publicStatus": "received",
  "subjectContext": {
    "kind": "visit",
    "visitDate": "2026-08-15",
    "visitType": "maintenance",
    "teamName": null
  }
}
```

Visitor installed-device response excerpt:

```json
{
  "subjectContext": {
    "kind": "installed_device",
    "deviceName": "جهاز غولدن",
    "serialNumber": "SN-90871"
  }
}
```

The omission of `visitId`/`installedDeviceId` is intentional. Mobile models should declare those two properties as optional when one model is shared between authenticated and visitor tracking flows.

### `GET /api/app/complaints/:complaintId/attachments/:attachmentId`

For an App Account, send the normal Bearer token. For visitor tracking, send the tracking grant in `X-Complaint-Tracking`:

```http
GET /api/app/complaints/91/attachments/18 HTTP/1.1
X-Complaint-Tracking: 00000000-0000-4000-8000-000000000099
```

The endpoint streams the normalized private image and sends `Cache-Control: private, no-store`. A missing, foreign, or unauthorized attachment returns `404 attachment_not_found`.

## 7. CRM list and detail

### `GET /api/complaints`

Requires `complaints.view_list`. Scope is translated into SQL using `handling_branch_id` and `assigned_user_id`.

Filters: reference/search, phone/name, type/category, status, priority, source, entry point, handling branch, assignee, identity source, linked visit/device, duplicate state, review required, submitted date range.

Default order: priority critical→low, then oldest first within priority.

### `GET /api/complaints/:id`

Requires `complaints.view_details` plus subject authorization. Optional sections are separately gated: attachments, audit, sensitive identity.

### `GET /api/complaints/:id/attachments/:attachmentId`

Requires `complaints.view_attachments` plus subject authorization. It loads the complaint attachment and its `media_files` row, verifies `visibility=private` and ownership, then streams the original normalized image or its thumbnail. It returns `Cache-Control: private, no-store` and never redirects to `/m`.

### `POST /api/complaints`

Requires `complaints.create_internal`. `sourceChannel` is mandatory and cannot be `mobile_app`. `enteredByUserId` comes from staff auth. No attachment fields are accepted.

CRM intake lookups are minimal projections and are always intersected with the create branch:

| Endpoint | Additional permission |
|---|---|
| `GET /api/complaints/lookups/branches` | none beyond `complaints.create_internal` |
| `GET /api/complaints/lookups/clients?branchId=` | `clients.view_list` with its GLOBAL/BRANCH/ASSIGNED scope |
| `GET /api/complaints/lookups/clients/:id?branchId=` | `clients.view_list` plus client subject authorization |
| `GET /api/complaints/lookups/clients/:id/devices?branchId=` | `clients.devices.view` |
| `GET /api/complaints/lookups/clients/:id/visits?branchId=` | `clients.visits.view` |

When `requesterClientId` is supplied, requester identity and SmartGeo address are derived by the server. Manual requesters send SmartGeo IDs selected by name in the UI; the server validates hierarchy and branch coverage. A manual device sends `deviceName` and `deviceSerialNumber`. A selected visit/device is reloaded and checked against the selected client and branch before insertion.

## 8. CRM commands

Every command loads the complaint, authorizes its subject, checks the current state, executes transactionally, and appends audit/status history. No generic status PATCH exists.

| Endpoint suffix | Permission | Allowed scope |
|---|---|---|
| `/triage` | `complaints.triage` | GLOBAL |
| `/change-type` | `complaints.change_type` | GLOBAL |
| `/change-priority` | `complaints.change_priority` | GLOBAL |
| `/assign-branch` | `complaints.assign_branch` | GLOBAL |
| `/transfer-branch` | `complaints.transfer_branch` | GLOBAL |
| `/assign-handler` | `complaints.assign_handler` | GLOBAL/BRANCH |
| `/reassign-handler` | `complaints.reassign_handler` | GLOBAL/BRANCH |
| `/start-processing` | `complaints.start_processing` | GLOBAL/BRANCH/ASSIGNED |
| `/request-information` | `complaints.request_information` | GLOBAL/BRANCH/ASSIGNED |
| `/resume-processing` | `complaints.resume_processing` | GLOBAL/BRANCH/ASSIGNED |
| `/resolve` | `complaints.resolve` | GLOBAL/BRANCH/ASSIGNED |
| `/close` | `complaints.close` | GLOBAL |
| `/reject` | `complaints.reject` | GLOBAL |
| `/withdraw` | `complaints.withdraw` | GLOBAL/BRANCH/ASSIGNED |
| `/reopen` | `complaints.reopen` | GLOBAL |
| `/review-duplicate` | `complaints.review_duplicates` | GLOBAL |
| `/public-updates` | `complaints.publish_update` | GLOBAL/BRANCH/ASSIGNED |
| `/internal-notes` | `complaints.add_internal_note` | GLOBAL/BRANCH/ASSIGNED |

Link commands use separate permissions: `link_requester`, `link_visit`, `link_device`, `link_target`, and `link_operational_work`.

## 9. Resolution payload

```json
{
  "outcome": "upheld",
  "internalResolutionNotes": "Internal investigation details...",
  "publicResolutionSummary": "تمت مراجعة الشكوى واتخاذ الإجراء المناسب."
}
```

All three fields are required. `duplicate_confirmed` additionally requires a confirmed `duplicateOfComplaintId`.

## 10. Stable errors

Representative codes:

- `invalid_form_payload`
- `complaint_type_not_allowed_for_identity`
- `complaint_context_mismatch`
- `visit_not_available`
- `device_not_available`
- `attachment_token_invalid_or_expired`
- `attachment_limit_exceeded`
- `complaint_rate_limit_exceeded`
- `invalid_status_transition`
- `complaint_scope_denied`
- `resolution_incomplete`
- `duplicate_target_required`

Mobile errors do not expose table names, entity existence outside ownership, or matching customer records.

## 11. Settings

Admin-configurable, validated and audited:

- duplicate detection enabled;
- visit/device duplicate windows (default 30 days);
- exact text duplicate window (default 24 hours);
- unverified device/IP/phone daily limits;
- verified phone/account daily limits;
- upload daily byte limit.

Changing settings affects future evaluations only and does not recompute historical complaints.

## 12. Unified media extension

Complaints use the current unified media system, with a mandatory private-media extension:

- migration adds `media_files.visibility` with `public` default and `public|private` check;
- migration allows `owner_type='complaint_attachment'`;
- `storeMedia`/an adjacent shared service accepts private storage without producing a public URL;
- `/m/:fileName` resolves the registry row and serves only `visibility=public`;
- existing device, branch, and banner media remain public and backward compatible;
- legacy `/uploads` remains supported for existing entities but is never accepted for a complaint attachment;
- private complaint reads use complaint authorization, not unguessable identifiers as access control.
