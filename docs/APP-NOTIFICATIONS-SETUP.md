# App Notifications (FCM) — Setup Guide (DevOps)

> Enables real push delivery for customer-app notifications. Until this is done,
> `PUSH_PROVIDER` stays `noop`: notifications are still created, stored and shown
> in the app's inbox, but **no push reaches any handset**. Nothing here is needed
> for the rest of the app to keep working.

## What this depends on

The backend is implemented and merged (`packages/api/services/appNotifications/`).
This document is only the deployment/config side: what to create in Firebase,
which environment variables to set, which migrations to apply, and how to verify
it on QA.

"QA" below means the staging box (`golden-crm-staging`, per
[SERVER-DEPLOY.md](./SERVER-DEPLOY.md) and CLAUDE.md). If QA is a separate host in
your setup, apply the same steps there instead.

---

## Part 1 — Firebase

Assumes a Firebase account already exists and you can create projects in it.

### 1.1 Use a SEPARATE Firebase project for QA

Do not point QA at the production Firebase project. The two share nothing but the
key, and a mistake in QA data would push a real notification to a real customer's
phone with no way to recall it. One project per environment is the whole
safeguard.

### 1.2 Enable the API

In the QA project: **Build → Cloud Messaging**. Confirm the **Firebase Cloud
Messaging API (V1)** is enabled. The legacy server key is *not* used — this
integration speaks HTTP v1 only.

### 1.3 Create a service account and download its key

**Project settings → Service accounts → Generate new private key.** This
downloads a JSON file once. Treat it as a credential:

- Never commit it to git.
- Never paste it into chat or a ticket.
- Store it wherever this project's other secrets live.

If the file is ever shared in chat, rotate it before use — same rule as the Rasel
API key.

The minimum role is **Firebase Cloud Messaging API Admin**. The default
auto-generated `firebase-adminsdk` service account already has it.

### 1.4 Extract the three values we need

From the downloaded JSON:

| JSON field | Environment variable |
|---|---|
| `project_id` | `FCM_PROJECT_ID` |
| `client_email` | `FCM_CLIENT_EMAIL` |
| `private_key` | `FCM_PRIVATE_KEY` |

The server does **not** read the JSON file — only these three values. There is no
file to deploy.

### 1.5 Register the mobile apps in the same project

**Project settings → Your apps.** Add the Android app (gives
`google-services.json`) and the iOS app (gives `GoogleService-Info.plist`), then
hand both to the mobile developer. For iOS also upload the **APNs authentication
key** under **Cloud Messaging → Apple app configuration** — without it, iOS push
silently never arrives.

A QA app build wired to a different Firebase project will register tokens that the
QA server cannot deliver to, and the failure looks exactly like "push doesn't
work".

### 1.6 What to hand over, and to whom

Everything produced in Part 1 goes to one of two people. Nothing else from the
Firebase console is needed.

| Artefact | Where it comes from | Goes to | How |
|---|---|---|---|
| Service-account JSON key file | Project settings → Service accounts → Generate new private key | **DevOps** | Secret channel only (password manager / secrets store). Never chat, email or a ticket. |
| `google-services.json` | Project settings → Your apps → Android app | **Mobile dev** | Normal channel — it is not a secret, it ships inside the app. |
| `GoogleService-Info.plist` | Project settings → Your apps → iOS app | **Mobile dev** | Same. |
| APNs authentication key (`.p8`) | Apple Developer account | **Nobody** — you upload it | Cloud Messaging → Apple app configuration. It stays in Firebase. |
| `project_id` (as plain text) | The JSON, or the console header | **Both** | So each can confirm they are wired to the same project. |

DevOps reads exactly three fields out of that JSON — `project_id`,
`client_email`, `private_key` — into the environment variables in Part 3. Hand
over the **whole file** rather than the three values pasted into a message: the
private key is a long multi-line string, and re-typing or line-wrapping it is
the most common way this setup fails.

**Confirm the project before handing anything over.** The single most damaging
mistake available here is handing over the production project's key for a QA
box: it boots cleanly, passes every test, and pushes to real customers. Check
that `project_id` in the JSON is the QA project, and say so explicitly in the
handover message.

**Not needed by anyone:** the legacy Cloud Messaging *Server key* and *Sender
ID*, and the Web API key. This integration uses FCM HTTP v1 with a service
account and reads none of them.

---

## Part 2 — Database migrations

Apply in order on the QA database (they are already in `migrations/`):

| Migration | What it creates |
|---|---|
| `426_app_notifications.sql` | the inbox + device-token tables |
| `427_app_notification_outbox.sql` | status-change outbox + triggers on service requests and visits |
| `428_complaint_notification_outbox.sql` | trigger on complaint public updates |
| `429_app_notification_broadcasts.sql` | admin free-form send log + two permission keys |

```bash
pnpm run migrate
```

All four are already applied on the developer database. They are additive: no
existing column is altered or dropped.

---

## Part 3 — Environment variables

Add to the environment file the target box already uses for its process manager
(production: `/etc/golden-crm/production.env`; staging/QA: the `.env` at that
box's app directory). Never commit real values — `.env.example` holds
placeholders only.

| Variable | QA value | Notes |
|---|---|---|
| `PUSH_PROVIDER` | `fcm` | Switches delivery from the no-op logger to Firebase. Leave `noop` (or unset) on any box that must not send real push. |
| `FCM_PROJECT_ID` | *(from the service-account JSON)* | The QA project, not production. |
| `FCM_CLIENT_EMAIL` | *(from the service-account JSON)* | |
| `FCM_PRIVATE_KEY` | *(from the service-account JSON)* | See the newline note below. |
| `FCM_TIMEOUT_MS` | `10000` | Default; raise only if Firebase is consistently slow. |
| `FCM_KILL_SWITCH` | `false` | Fast off-switch — set `true` and restart to stop all delivery immediately without touching `PUSH_PROVIDER` or redeploying. |
| `NOTIF_OUTBOX_INTERVAL_S` | `20` | How often captured status changes are turned into notifications. `0` disables delivery entirely and logs a warning at boot. |
| `NOTIF_OUTBOX_BATCH` | `50` | Rows drained per pass. |

**The private key and newlines.** The JSON value contains literal `\n` escape
sequences. Put it in the env file exactly as it appears in the JSON, in double
quotes, on one line:

```
FCM_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEv...\n-----END PRIVATE KEY-----\n"
```

The app converts `\n` back to real newlines at boot. A key pasted across multiple
lines will not parse.

**Boot-time safety (already built in, nothing to configure):** the process refuses
to start if `PUSH_PROVIDER=fcm` and any of the three FCM values is missing. An
unknown `PUSH_PROVIDER` value is also a hard failure — it never silently falls
back to the no-op sender. Running `PUSH_PROVIDER=noop` in production is allowed
but prints a loud warning at boot, because that combination stores notifications
and delivers nothing.

---

## Part 4 — Applying the config

```bash
pm2 restart golden-crm-staging
pm2 logs golden-crm-staging --lines 60
```

On a healthy boot you will see the two background jobs announce themselves:

```
[outboxJob] started (every 20s, batch 50)
[notifSweepJob] started (checks every minute, runs once per day)
```

A misconfiguration crashes the process immediately with a clear message. That is
deliberate fail-fast behaviour, not a bug.

---

## Part 5 — Permissions (one-time, in the CRM)

Migration 429 creates two permission keys but grants them to **nobody**:

| Key | Meaning |
|---|---|
| `admin.app_notifications.view` | see the free-form send history |
| `admin.app_notifications.send` | compose and send a free-form notification |

Both allow `GLOBAL` and `BRANCH` scope. Until someone grants them, the page at
`/admin/app-notifications` is visible to super-admins only. Grant them from the
roles screen, per this project's usual convention.

`send` addresses thousands of customers irreversibly. It is deliberately not
bundled with `settings.manage`; grant it narrowly.

---

## Part 6 — Optional tuning (admin settings, not env)

These live in `system_settings` and are editable from the admin UI without a
restart. All have safe code defaults — **you do not need to insert any rows** for
the feature to work.

| Key | Default | Meaning |
|---|---|---|
| `notif_visit_reminder_time` | `08:00` | when the daily sweep runs |
| `notif_visit_reminder_days_before` | `0` | `0` = remind on the morning of the visit |
| `notif_maintenance_due_repeat_days` | `14` | days before the single follow-up nudge |
| `notif_warranty_expiry_days` | `30,7` | thresholds before warranty expiry |
| `notif_catchup_window_hours` | `12` | how late a missed daily sweep may still run |
| `notif_<type>_enabled` | `true` | per-type kill switch, e.g. `notif_visit_reminder_enabled` |

The per-type switch is the first thing to reach for if one notification type
turns out to be noisy — it silences that type alone, with no deploy.

---

## Part 7 — QA smoke test

Run from the QA box, in order. Steps 1–2 need no Firebase at all and are worth
doing first to isolate faults.

**1. The inbox API answers.** With a customer app token:

```bash
curl -s -H "Authorization: Bearer <app-token>" \
  "http://localhost:3001/api/app/notifications/?page=1&page_size=20"
```

Expect `200` and `{"count":0,"next":null,"previous":null,"results":[]}` for a new
account — never a `404`.

**2. A status change produces a notification.** Move any service request
belonging to a customer who has an app account to a terminal state from the CRM.
Within `NOTIF_OUTBOX_INTERVAL_S` seconds the notification appears in that
customer's inbox via the call above.

**3. Push actually leaves the box.** Sign in on a QA handset (so a token is
registered), then send a free-form notification from the CRM at
`/admin/app-notifications`: preview the audience, confirm the count, send. The
banner should appear on the handset. In the logs:

```bash
pm2 logs golden-crm-staging --lines 100 | grep -E "push:|broadcast"
```

- `[push:noop]` means `PUSH_PROVIDER` is still `noop` — Part 3 was not applied.
- `[push:fcm] auth_failed` means the service-account values are wrong.
- `[push:fcm] send_failed ... code=UNREGISTERED` means that specific handset's
  token is dead; the server deletes it automatically. Re-open the app to
  re-register.
- No push line at all means no device is registered for that customer.

**4. The daily sweep.** It runs once per day at `notif_visit_reminder_time`. To
verify without waiting, temporarily set that setting to a couple of minutes ahead
and watch for `[notifSweepJob]` in the logs.

---

## Rollback

Set `FCM_KILL_SWITCH=true` (fastest — stops delivery, keeps everything else
working) or `PUSH_PROVIDER=noop`, then restart. Both leave the inbox fully
functional; customers keep receiving notifications in-app, only the push stops.

To silence one noisy type instead of everything, use the `notif_<type>_enabled`
setting from Part 6 — no restart, no deploy.

Do not delete the deployed service-account key unless it is known to be
compromised.

---

## Logging

The adapter never logs the private key, the OAuth access token, or a full FCM
registration token — only a masked token (`abc123…7f9x`), the HTTP status, and the
provider error code. No changes to log shipping or masking are needed for this
feature.

---

## Going to production later

Repeat Parts 1, 3 and 5 against a **separate production Firebase project** and the
production env file. Do not reuse the QA service-account key. The production app
build must be registered in the production Firebase project, and the production
APNs key uploaded there.
