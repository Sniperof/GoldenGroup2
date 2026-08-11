# Mobile Periodic Maintenance API

This is the implementation contract for `periodic_maintenance.mobile.v1`.
The request is an intake record for human review. It never changes the due date
of an existing periodic task.

## Discovery and options

`GET /api/app/service-requests/types` lists the type only when the registry row
and installed code handler agree on the active form version.

`GET /api/app/service-requests/periodic-maintenance/options` is public and
returns the single-select administrator-managed request reasons:

```json
{
  "reasons": [
    { "id": 12, "code": "scheduled_service_requested", "label": "..." }
  ]
}
```

`GET /api/app/service-requests/periodic-maintenance/devices` requires a valid
app bearer token. It returns only installed devices belonging to the account's
linked client. Visitors do not call this endpoint; they use the public device
catalog used by emergency maintenance.

## Submit

`POST /api/app/service-requests`

Headers:

- `Content-Type: application/json`
- `Idempotency-Key: <stable UUID or client-generated key>` — required.
- Registered customer: `Authorization: Bearer <app token>`.
- OTP visitor: use the verified visitor `handle` in the body.
- Transitional unverified intake: use the stable `X-Device-Id` header.

Common required fields:

| Field | Rule |
|---|---|
| `requestType` | exactly `periodic_maintenance` |
| `formVersion` | exactly `periodic_maintenance.mobile.v1` |
| `submissionMode` | `for_self` or `for_another` |
| `reasonId` | one active ID returned by the options endpoint |
| `deviceSelectionType` | exactly one of `registered_device`, `catalog_model`, `other` |
| `governorate` or `governorateId` | required positive ID |
| `detailedAddress` | required, maximum 500 characters |

Optional address fields are `cityOrArea`/`regionId`, `subArea`/`subdistrictId`,
`neighborhood`/`neighborhoodId`, and `mapLocation: { "lat", "lng" }`.
Party fields and `referrerMode` follow the shared mobile service-request party
contract.

Device fields:

| Selection | Required | Optional | Forbidden or server-derived |
|---|---|---|---|
| `registered_device` | `installedDeviceId` | none | authenticated `for_self` only; serial is server-derived and `serialNumber` is rejected |
| `catalog_model` | `deviceModelId` | `serialNumber` up to 100 chars | `installedDeviceId`, free-text `deviceName` |
| `other` | `deviceName` | `serialNumber` up to 100 chars | `installedDeviceId`, `deviceModelId` |

The payload is closed. In particular, do not send `attachments`, media tokens,
`problemDescription`, `safetyIndicatorCodes`, or an array of devices.

Registered-device example:

```json
{
  "requestType": "periodic_maintenance",
  "formVersion": "periodic_maintenance.mobile.v1",
  "submissionMode": "for_self",
  "reasonId": 12,
  "deviceSelectionType": "registered_device",
  "installedDeviceId": 431,
  "governorate": 1,
  "cityOrArea": 8,
  "detailedAddress": "Building 7, third floor"
}
```

Visitor catalog-device example:

```json
{
  "requestType": "periodic_maintenance",
  "formVersion": "periodic_maintenance.mobile.v1",
  "handle": "00000000-0000-4000-8000-000000000001",
  "submissionMode": "for_self",
  "firstName": "Ali",
  "lastName": "Ahmad",
  "phoneNumber": "09xxxxxxxx",
  "reasonId": 12,
  "deviceSelectionType": "catalog_model",
  "deviceModelId": 9,
  "serialNumber": "OPTIONAL-SERIAL",
  "governorate": 1,
  "detailedAddress": "Near the main square"
}
```

Successful creation returns HTTP 201 with `publicRefNumber`, `status`,
`reviewRequired`, and `possibleDuplicate`. Repeating the same idempotency key
returns the same result. If the selected registered device already has an
active periodic request, the response identifies that existing request with
`activeRequestExists: true` rather than creating another one.

Important named errors include:

- `periodic_maintenance_reason_required` / `periodic_maintenance_reason_not_found`
- `registered_device_selection_forbidden`
- `serial_number_not_accepted_for_registered_device`
- `installed_device_not_found`, `device_model_not_found`, `device_name_required`
- `missing_required_fields` for the required address
- `invalid_form_payload` with `unknownFields` for undeclared fields
- `unsupported_form_version`, `idempotency_key_required`, and quota/rate-limit errors

## Review outcome

The mobile client does not create or reschedule an `open_task`. A reviewer links
the beneficiary and intended installed device. If that external client/device
is not yet registered, it must be registered through its separate workflow
while this request remains `in_review`.

- Eligible device with no active periodic task: a new task is created and the
  request becomes `promoted`.
- Active periodic task: the existing task is unchanged and the request is
  closed as `resolved_at_intake` using an administrator-managed reason.
- Ineligible request: it becomes `rejected` using an administrator-managed
  reason.

The task always uses the installed device's registered branch and location. An
address mismatch therefore requires confirmation of the registered location or
completion of a separate device-transfer workflow before handoff.
