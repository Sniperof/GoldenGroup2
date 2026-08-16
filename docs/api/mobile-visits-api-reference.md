# Mobile My Visits API Reference

**Audience:** Mobile application developers
**Feature:** "زياراتي" (My Visits) screen — DEC-017
**Authentication:** Required — `Authorization: Bearer <app-token>`
**Content type:** `application/json`

## 1. Scope Boundary

This endpoint returns every `field_visits` row where `client_id` equals the authenticated account's linked client record. It is read-only — there is no cancel, reschedule, or edit action for the customer (DEC-017 D-AV1).

There is deliberately **no lead-window filter** in this query (no `scheduled_date <= today + 1` condition). The one-day-ahead visibility customers experience is an emergent property of how visits get scheduled project-wide — the same lead-time discipline already applied to `contact_targets`/`needs_follow_up` tasks (`docs/constitution/domains/tasks.md` §"نافذة قبلية") — not something this endpoint enforces itself. A field-initiated instant visit (`origin_type = 'field_initiated'`, created directly `in_progress`, DEC-011) simply appears the moment it exists, with no special-case handling. See `docs/constitution/decisions/DEC-017-app-devices-and-visits.md` D-AV4.

## 2. List My Visits

`GET /api/app/me/visits`

No query parameters.

### Successful Response (`200`)

```json
{
  "items": [
    {
      "id": "33",
      "visitType": "mixed",
      "scheduledDate": "2026-07-30",
      "scheduledTime": "13:00",
      "supervisorName": "سعاد زيتون",
      "technicianName": "سعيد البنا",
      "deviceNames": null,
      "status": "completed"
    }
  ]
}
```

Visits are ordered newest-first (`scheduled_date DESC`, nulls last). An empty result is returned as `{ "items": [] }`.

### List Item Fields

| Field | Type | Nullable | Description |
|---|---|---:|---|
| `id` | string | No | Field-visit identifier (`bigint`, serialized as a string). |
| `visitType` | `"marketing"` \| `"service"` \| `"mixed"` | No | Visit type. |
| `scheduledDate` | date (`YYYY-MM-DD`) | Yes | Scheduled visit date. `null` only for legacy/edge-case rows. |
| `scheduledTime` | string | Yes | Free-text scheduled time (e.g. `"13:00"`). |
| `supervisorName` | string | Yes | Name of the visit's current supervisor. `null` if none is assigned. Never a phone number (DEC-017 D-AV3). |
| `technicianName` | string | Yes | Name of the visit's current technician. `null` if none is assigned. Never a phone number. |
| `deviceNames` | string[] | Yes | Distinct device names this visit concerns, derived from its `visit_tasks` (§3). `null` when the visit has no task linked to a resolvable device (e.g. a pure marketing/survey visit). |
| `status` | `"scheduled"` \| `"in_progress"` \| `"completed"` \| `"not_completed"` \| `"cancelled"` | No | Customer-facing status — see §4 for the mapping from the 7 internal states. |

## 3. Team Identity: Current, Not Original

`supervisorName`/`technicianName` reflect the visit's **current effective team**, not the team originally assigned. If a visit's team was reassigned mid-flight (a replacement/backup team took over), the reassignment override wins:

```text
effective_supervisor = reassigned_supervisor_id  (fallback: team_snapshot.supervisorEmployeeId)
effective_technician = reassigned_technician_id  (fallback: team_snapshot.technicianEmployeeId)
```

Both supervisor and technician names are always shown together when present — never just one. The trainee, when a visit's team includes one, is never surfaced to the customer; neither is any employee phone number. This is a deliberate DEC-017 product decision (D-AV3): identity is normally scope-bound and hidden from the widest-reach surface (per `docs/constitution/domains/branch-scope-and-visibility-standard.md`), but the customer app explicitly overrides that default for trust-building — showing the name, never the phone.

## 4. Visit Status Mapping

The visit lifecycle has 7 internal states (DEC-004). This endpoint collapses them to 5 customer-facing values, applied at the response boundary (not as a SQL filter — every visit is still returned):

| Internal state(s) | Customer-facing `status` | Meaning shown to the customer |
|---|---|---|
| `scheduled` | `scheduled` | مجدولة |
| `in_progress`, `ended` | `in_progress` | قيد التنفيذ |
| `completed`, `closed` | `completed` | منتهية |
| `not_completed` | `not_completed` | لم تكتمل — الفريق حضر ولم يُنفَّذ شيء |
| `cancelled` | `cancelled` | ملغاة |

`not_completed` is kept distinct rather than folded into `completed`, so the customer understands the team showed up but nothing was executed (e.g. customer absent, location closed) — as opposed to a normal completion.

## 5. Device Linkage

Each visit's `deviceNames` is computed from its `visit_tasks` rows: `visit_tasks.contract_id → installed_devices.contract_id → device_models`. A visit can list more than one device name if it contains tasks for more than one contract. Marketing-only or survey-only visits, whose tasks carry no `contract_id`, return `deviceNames: null`.

## 6. Get One Visit's Detail

`GET /api/app/me/visits/{id}`

Opened by tapping a visit from the list (§2). Returns the same visit-level fields as the list, plus a per-task breakdown and (when cancelled) the cancellation reason label.

### Successful Response (`200`)

```json
{
  "id": "33",
  "visitType": "mixed",
  "scheduledDate": "2026-07-30",
  "scheduledTime": "13:00",
  "supervisorName": "سعاد زيتون",
  "technicianName": "سعيد البنا",
  "status": "completed",
  "cancellationReasonLabel": null,
  "tasks": [
    {
      "id": "27",
      "taskType": "device_demo",
      "deviceId": 13,
      "deviceName": "فلتر جولدن جروب 7 مراحل ونص",
      "deviceSerialNumber": "123232",
      "decisionLabel": "تم تأجيل الموعد",
      "reasonLabel": null
    },
    {
      "id": "28",
      "taskType": "device_delivery",
      "deviceId": 13,
      "deviceName": "فلتر جولدن جروب 7 مراحل ونص",
      "deviceSerialNumber": "123232",
      "decisionLabel": "تم التسليم بنجاح",
      "reasonLabel": null
    }
  ]
}
```

### Detail Fields (beyond the list, §2)

| Field | Type | Nullable | Description |
|---|---|---:|---|
| `cancellationReasonLabel` | string | Yes | Label of the visit's structured cancellation reason. Present only when `status = "cancelled"`; `null` otherwise, even if a reason happens to be stored. Never the free-text `cancellation_notes`. |
| `tasks` | Task[] | No | One entry per `visit_tasks` row, ordered by `sequence_no`. Empty array for a visit with no tasks yet. |

### Task Object

| Field | Type | Nullable | Description |
|---|---|---:|---|
| `id` | string | No | Visit-task identifier. |
| `taskType` | string | No | e.g. `device_demo`, `device_delivery`, `device_installation`, `device_activation`, `emergency_maintenance`, `periodic_maintenance`, `device_checkup`, `device_retrieval`, `device_return`, `device_transfer`, `device_disconnection`, `gift_delivery`, `golden_warranty_offer`, `golden_warranty_card_delivery`, `installment_collection`. Not a closed set — the project adds task types in code over time. |
| `deviceId` | integer | Yes | The device this task concerns, when its contract resolves to one. Lets the app link to that device's own page in "أجهزتي". |
| `deviceName` | string | Yes | Same name-resolution chain as the devices endpoint. |
| `deviceSerialNumber` | string | Yes | Serial number, when recorded — the disambiguator when a customer owns two devices of the same model. |
| `decisionLabel` | string | Yes | Arabic label for the task's outcome, resolved from a fixed dictionary keyed by `(taskType, internal final_decision)`. `null` when the task has no result yet, **or** when its `(taskType, final_decision)` pair isn't in the dictionary (logged server-side, never surfaced as an error). |
| `reasonLabel` | string | Yes | Best-effort label for the task's structured reason, resolved by matching the internal `reason_code` against `system_lists.value` (preferring `metadata.label` when present). `null` when there is no reason code or no match — never the raw internal code. |

Never present on a task: `closing_notes` (free text written by the field team for internal record-keeping — DEC-017 D-AV8).

### Why `decisionLabel` Can Legitimately Be `null` Alongside a Real Outcome

Unlike `status` (§4, a small fixed set with total dictionary coverage), a task's internal `final_decision` vocabulary is **open-ended and per-task-type** — defined as TypeScript literal unions scattered across `services/visitTaskResultReflection.ts` and `routes/emergencyResult.ts`, not a single database enum. The mapping in `routes/appVisits.ts` (`TASK_DECISION_LABELS`) is a hand-maintained mirror of every `(taskType, final_decision)` pair that exists in code today. When the business adds a new task type or a new decision value, this dictionary does not update itself — the task simply shows no `decisionLabel` (with a server-side warning log) until someone extends the dictionary. This is an accepted, known tradeoff (DEC-017 D-AV8), not a bug to work around client-side.

## 7. Errors

| Status | Condition | Example body | Endpoint |
|---:|---|---|---|
| `400` | Non-numeric or non-positive visit id | `{ "error": "معرف الزيارة غير صالح" }` | Detail only |
| `401` | Missing or invalid app bearer token | `{ "error": "غير مصرح: يلزم تسجيل الدخول" }` | Both |
| `404` | Visit id doesn't exist, or belongs to another customer — the two cases are indistinguishable by design, so a guessed id never confirms another customer's visit exists | `{ "error": "الزيارة غير موجودة" }` | Detail only |
| `500` | Unexpected failure | `{ "error": "تعذّر إتمام العملية. حاول لاحقاً." }` | Both |

A `500` response should be treated as retryable. The list endpoint never returns `404` — an account with zero visits gets `{ "items": [] }`, not an error.

## 8. Not Yet Available

Submitting a complaint against a visit's team after completion is deferred to a later phase (DEC-017 D-AV7); when built, it will reuse `service_requests` as a new `request_type` (same pattern as `account_creation`, DEC-013), not this endpoint.
