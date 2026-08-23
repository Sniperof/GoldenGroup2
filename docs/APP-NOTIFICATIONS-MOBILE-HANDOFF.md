# App Notifications — Mobile Handoff (Flutter)

> **Audience:** the Flutter developer who owns `lib/features/notifications/`.
> **Backend status:** implemented and running on QA. Every endpoint below is live.
> **Source of truth for the decisions:** `docs/constitution/decisions/DEC-019-app-notifications.md`.

This document is the counterpart to the compatibility report you produced
(`mobile-notifications-api-reference.md`). We built to that contract. Where we
deviated, it is listed explicitly in §1 — those are the only changes you need to
make. Everything else in your report still holds exactly as written.

---

## 1. Changes you need to make (six items)

Five of these were already listed as "optional improvements" in your own report.
They stopped being optional because the backend now emits things the current app
cannot parse: not emitting them would mean building the feature and hiding most
of it.

### 1.1 Endpoint prefix — `/api/app/notifications/...`

**Change:** one line in `shared/constants/api_endpoints.dart`.

| Your report | What we built |
|---|---|
| `GET /notifications/` | `GET /api/app/notifications/` |
| `POST /notifications/register-token/` | `POST /api/app/notifications/register-token/` |
| `DELETE /notifications/register-token/` | `DELETE /api/app/notifications/register-token/` |
| `PATCH /notifications/{id}/mark-read/` | `PATCH /api/app/notifications/{id}/mark-read/` |

**Why we did not keep the root path:** our rate limiter and app-auth layer are
mounted on the `/api/app` prefix, deliberately, so that no future app route can
be added without inheriting them. A route at `/notifications/` would have had
**zero** rate limiting. Your report already flagged this move as acceptable at a
cost of one line.

Everything else about these four endpoints matches your report exactly:
snake_case fields, `id` as a string, the DRF envelope `{count, next, previous,
results}`, 1-indexed `page` + `page_size`, newest-first, empty list as `200`.

### 1.2 Nine new `data.type` wire values

**Change:** add the mappings in `domain/enums/notification_type.dart`.

Your `fromWire` currently recognises `service_request_status_changed` and maps
everything else to `unknown`. The backend now emits ten values:

| `data.type` | When it is sent | `data.destination` | `destination_id` |
|---|---|---|---|
| `service_request_status_changed` | request reached `promoted` / `completed` / `rejected` / `cancelled` | **none — see §1.5** | — (id in `data.service_request_id`) |
| `visit_scheduled` | a visit was booked for the customer | `visit` | visit id |
| `visit_cancelled` | a booked visit was cancelled | `visit` | visit id |
| `visit_completed` | the visit was closed out | `visit` | visit id |
| `visit_reminder` | morning of the visit (admin-configurable) | `visit` | visit id |
| `maintenance_due` | periodic maintenance fell due (+ one nudge later) | `device` | installed device id |
| `warranty_expiring` | 30 days, then 7 days before expiry (configurable) | `warranty` | device id |
| `warranty_activated` | a warranty was activated | `warranty` | device id |
| `complaint_update` | a public update was published on the customer's complaint | `complaint` | complaint id |
| `general` with `destination: service_request_form` | an administrator invites the customer to submit a request | `service_request_form` | **request_type slug** |
| `general` | free-form message sent by an administrator | *(varies or absent)* | *(varies or absent)* |

`general` is the one your report said had **no** wire value today. It now has
one, literally `general`, and it is not optional: the admin free-form composer is
built and shipping, so without this mapping those messages render as `unknown`.

### 1.3 Three new `data.destination` values — `visit`, `complaint`, `service_request_form`

**Change:** two entries in `NotificationDestinationResolver` +
`NotificationDestinationRoute`.

`visit` should open the visit detail screen you already built for DEC-017
("زياراتي"), with `destination_id` as the visit id. This is the highest-value one
in the whole set: half the catalog points at it, and until it lands those six
notification types open the notifications list instead of the visit.

`complaint` should open the complaint detail/tracking screen with
`destination_id` as the complaint id. Lower priority than `visit` — a complaint
update's body text is self-contained, so landing on the inbox is a degraded
experience rather than a broken one.

`service_request_form` is the one that should be **cheapest of all**, and it is
different in kind from every other destination: its `destination_id` is a
**request_type slug** (`water_check`, `periodic_maintenance`, `device_request`,
`emergency_maintenance`, `golden_warranty`, `name_nomination`,
`agent_license`), not a numeric row id. It should open the **intake form** for
that request type — the same target a home banner's `target_request_type`
already opens today. So there is no new screen to build: build
`ServiceRequestArgs` from the slug and route to the flow you already have.

This exists because the app has **no "my requests" and no "request details"
screen**: `/service-request` takes `ServiceRequestArgs` and *is* the intake
flow. So "here is your request" has nowhere to land, while "submit this request"
does. Which also means §1.5 below is not really a deep-link bug — see the note
there.

We send the correct destination value **today**, before you ship this. Your
existing fallback (unknown destination → notifications list) handles it safely in
the meantime. We deliberately did not encode your gap into our payload.

### 1.4 Re-register on `onTokenRefresh`

**Change:** call your existing `register-token` path from inside the
`onTokenRefresh` listener you already subscribe to.

Your report notes the stream is subscribed but not wired to a re-registration
call. The consequence is not cosmetic: when FCM rotates a device token, that
handset goes **silent** until the next sign-in, which can be months. The backend
deletes tokens that FCM reports as `UNREGISTERED`, so the dead row is cleaned up
— but nothing replaces it until the app re-registers.

### 1.5 Decide what `service_request` should mean (§E.3 of your report)

**Change:** yours to decide — we are not working around it.

You flagged that `NotificationDestinationRoute` passes `destination_id` as the
route `extra` while `/service-request` casts `state.extra` to
`ServiceRequestArgs`. Now that we know `/service-request` is the intake flow and
there is no request-details screen, this is not a wiring slip — the destination
has no valid target. Two ways out, your call:

1. Build a request-details screen and route `service_request` + the request id to
   it. This is what `service_request_status_changed` wants ("your request is now
   completed" → open the request).
2. Tell us there will be no such screen, and we will stop sending a
   `destination` on that notification so it stays in the inbox instead of
   pointing at a route that cannot accept it.

**What we did in the meantime (2026-08-18):** we stopped sending a
`destination` on `service_request_status_changed` entirely. It now lands in the
inbox and nowhere else, because `service_request` is the one destination your app
*recognises* — so unlike `visit` and `complaint`, which fall back harmlessly, it
would attempt the `ServiceRequestArgs` cast and fail at runtime. The request id
still travels as `data.service_request_id`, a plain key you preserve and ignore,
so turning the deep link back on is one line on our side once you answer.

You do not need to add defensive handling for it — nothing sends it today.

### 1.6 Nothing else changes

Pagination, optimistic mark-as-read with rollback, the FCM foreground/background/
terminated handling, the local Android notification, the unread-count
approximation, token registration on sign-in and unregistration on sign-out —
all unchanged. Do not rebuild any of it.

---

## 2. What the backend guarantees

These are commitments, not implementation details — you can rely on them.

**One `data` map.** The map inside `GET /notifications/` and the map inside the
FCM `data` block are the same map, plus `notification_id` on the push side. A tap
navigates identically whether it came from the inbox or the banner.

**`notification_id` is always in the FCM data block** and is the server-side
notification id — the one `PATCH .../mark-read/` expects. Never the FCM
`messageId`.

**The `notification` block is always present** with `title` and `body`, so the OS
renders something in background/terminated state. We never send data-only
messages. Android messages go out with `priority: HIGH` and iOS with
`apns-priority: 10`, so a "your technician arrives today" alert is not deferred
by Doze.

**`type` is only ever inside `data`.** There is no top-level `type`, `title` or
`body` field on the list item, exactly as your report specifies.

**Mark-read is idempotent** and has its own generous rate-limit bucket. We sized
it specifically because your client fires mark-read per tapped notification and
swallows failures silently: on the shared mutation limit, a customer clearing
thirty notifications would have been throttled invisibly, and users behind
carrier NAT would have throttled each other.

**Unknown ids and other users' ids both return `404`** — indistinguishable by
design, so the endpoint cannot be used to probe for valid ids.

**Push failure never fails a request.** The stored notification is the source of
truth; the inbox always reflects reality even when delivery fails.

---

## 3. Things that will look like bugs and are not

**A customer with two phones gets the notification twice.** One customer record
can own more than one active app account (e.g. a shop owner and their manager).
Household-scoped events (visits, devices, warranties, service requests) go to
every active account on the record, because those accounts already see the same
devices and visits in the app.

**A complaint update goes to exactly one account** — the person who filed it,
even when other accounts share the customer record. That is deliberate: someone
else's complaint about a technician is not their relatives' business.

**A complaint filed by a visitor never notifies.** Visitors (OTP or unverified
device) have no account to deliver to; they track by reference number, as
designed in DEC-018.

**No notification when a complaint is first submitted.** The intake confirmation
is suppressed on purpose — the person is looking at your success screen at that
exact moment.

**A visit that is completed and then closed thanks the customer once.** Both are
internal steps of one customer-visible fact.

**`general` notifications may have no destination at all.** An administrator can
send an informational message that points nowhere. Your existing fallback to the
notifications list is the correct behaviour.

**English-locale users receive complaint updates in Arabic.** The text is written
by staff for that specific complaint and has exactly one authored version; we
quote it rather than machine-paraphrase it. Only the title is localized.

---

## 4. QA testing

Point the app at the QA API base URL and sign in as a customer with an app
account. Then:

1. **Registration** — sign in, confirm the app POSTs `register-token`. Ask the
   backend team to confirm a row exists for your `device_id`.
2. **Inbox** — the list, pagination past page 1, pull-to-refresh, empty state.
3. **Mark-read** — tap a notification; confirm it stays read after a refresh.
4. **Push** — ask the backend team to send a free-form notification from the CRM
   (`/admin/app-notifications`) targeted at your customer record. Verify it in
   foreground, background, and terminated states.
5. **Navigation** — after §1.3 ships, verify `visit` and `complaint` deep links.
6. **Sign-out** — confirm `DELETE register-token` fires and that no further push
   arrives on that handset.

For push to work at all on QA, the app build must be registered in the **QA
Firebase project** (see the DevOps handoff) — a build wired to a different
Firebase project will register tokens the QA server cannot deliver to.

---

## 5. Open question for you

Your report asked whether we would emit a `general` type. We do — the wire value
is `general`. If your enum already reserves that identifier for something else,
tell us now and we will change ours; it is a one-line change on our side and a
much larger one on yours after release.
