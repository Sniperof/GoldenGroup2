# Mobile Application Contact Links API Integration Guide

> Contract version: `app-contact-links.mobile.v1`  
> Status: implementation-ready  
> Audience: mobile application developers, QA engineers, and backend integrators  
> API style: REST over HTTPS with JSON responses

## 1. Purpose

This API publishes the contact and social destinations configured by an
administrator in Golden CRM. The mobile application must use this endpoint as
the single source of truth for the following five actions:

1. Facebook;
2. Website;
3. Instagram;
4. WhatsApp;
5. Telegram.

The configuration is global. It is not branch-specific, user-specific, or
device-specific. Contact links are also independent from home-banner tap
targets; the mobile application must not derive these values from banner data.

## 2. Mobile Integration Scope

The mobile application is a read-only consumer of this feature. It must call:

```http
GET /api/app/home/contact-links
```

The mobile application must **not** call the staff administration endpoints and
must never embed staff permissions, staff tokens, or an administrative API
secret. Administrators edit the values in Golden CRM; the mobile application
only reads the resulting public projection.

## 3. Base URL and Transport Rules

Build the request from the API origin configured for the active environment:

```text
{API_BASE_URL}/api/app/home/contact-links
```

Do not hard-code a development, staging, or production hostname in application
source code. The production API origin must use HTTPS.

Request headers:

```http
Accept: application/json
Authorization: Bearer <app-access-token>   # optional
```

There is no request body and there are no supported query parameters.

Authentication is optional:

- a visitor may call the endpoint without `Authorization`;
- a signed-in customer may send the normal mobile-app Bearer token;
- if `Authorization` is present, it must use the `Bearer` scheme and contain a
  valid app access token;
- an invalid or expired supplied token produces `401`; it is never silently
  treated as a visitor session;
- `X-Branch-Id`, `X-Device-Id`, and `X-Visitor-Handle` are not required.

## 4. Successful Response

### 4.1 HTTP example

```http
GET /api/app/home/contact-links HTTP/1.1
Host: api.example.com
Accept: application/json
```

```http
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8
```

```json
{
  "links": {
    "facebook": {
      "kind": "url",
      "value": "https://www.facebook.com/goldengroupco/"
    },
    "website": {
      "kind": "url",
      "value": "https://goldengroup.example/"
    },
    "instagram": {
      "kind": "url",
      "value": "https://www.instagram.com/goldengroupco/"
    },
    "whatsapp": {
      "kind": "phone",
      "value": "+963912345687"
    },
    "telegram": {
      "kind": "phone",
      "value": "+963912345687"
    }
  },
  "updatedAt": "2026-08-16T10:21:35.482Z"
}
```

### 4.2 Formal response model

```typescript
type ContactUrl = {
  kind: "url";
  value: string;
};

type ContactPhone = {
  kind: "phone";
  value: string;
};

interface AppContactLinksResponse {
  links: {
    facebook: ContactUrl | null;
    website: ContactUrl | null;
    instagram: ContactUrl | null;
    whatsapp: ContactPhone | null;
    telegram: ContactPhone | null;
  };
  updatedAt: string; // ISO 8601 timestamp in UTC
}
```

All five platform keys are always present. Future contract versions may add
new keys, so the decoder must ignore unknown JSON properties.

## 5. Field Semantics

| JSON path | Type | Meaning | Required mobile behavior |
|---|---|---|---|
| `links.facebook` | URL object or `null` | Official Facebook destination | Show only when non-null; open `value` as HTTPS URL |
| `links.website` | URL object or `null` | Official website destination | Show only when non-null; open `value` as HTTPS URL |
| `links.instagram` | URL object or `null` | Official Instagram destination | Show only when non-null; open `value` as HTTPS URL |
| `links.whatsapp` | Phone object or `null` | WhatsApp destination in E.164 format | Show only when non-null; construct the WhatsApp action in the client |
| `links.telegram` | Phone object or `null` | Telegram contact number in E.164 format | Show only when non-null; use a tested platform-specific action or safe fallback |
| `updatedAt` | ISO 8601 string | Time at which an administrator last saved the configuration | Parse as UTC; use for local freshness comparison, not display unless required |

URL values are normalized absolute HTTPS URLs. Phone values are canonical E.164
strings: a leading `+`, a non-zero country code, and digits only. Phone values
must remain strings; never parse them as integers because the `+` prefix and
full precision are part of the contract.

## 6. Null and Visibility Rules

`null` is the only disable signal. For example:

```json
{
  "links": {
    "facebook": null,
    "website": {
      "kind": "url",
      "value": "https://goldengroup.example/"
    },
    "instagram": null,
    "whatsapp": null,
    "telegram": null
  },
  "updatedAt": "2026-08-16T10:21:35.482Z"
}
```

The mobile application must:

- hide the Facebook, Instagram, WhatsApp, and Telegram actions completely;
- show only the Website action;
- avoid empty placeholders, disabled buttons, or the text `null`;
- collapse the container when all five values are `null`;
- preserve the product-defined platform order when multiple values are shown;
- ignore unknown future keys rather than failing the entire screen.

The client must not treat a missing known key as equivalent to `null`. Missing
known keys indicate a malformed or incompatible response and should be handled
through the normal decoding/error path.

## 7. Opening Each Destination

### 7.1 Facebook, Website, and Instagram

Pass the returned URL unchanged to the application's approved external-link or
in-app-browser component. Do not append paths, tracking parameters, usernames,
or authentication data.

Recommended behavior:

1. confirm that the parsed scheme is `https` as a defensive client check;
2. attempt to open the URL;
3. if the operating system reports that no handler is available, show a short
   localized error and optionally offer to copy the URL;
4. never render the returned value as executable HTML.

### 7.2 WhatsApp

The API returns a phone number, not a prepared WhatsApp URL. If the application
uses the standard web action, remove the leading `+` and pass digits only:

```text
API value:  +963912345687
Web action: https://wa.me/963912345687
```

The application may use a native WhatsApp integration instead, provided it is
tested on every supported operating system. If WhatsApp cannot be opened, show
a localized message and offer to copy the original E.164 number. Do not alter
the country code or infer a local dialing prefix.

### 7.3 Telegram

The API intentionally returns Telegram as a phone value. It does not return a
Telegram username and the client must not fabricate a `t.me/<phone>` username
URL. Resolving a Telegram account from a phone number can depend on the user's
device, installed Telegram client, and the destination account's privacy
settings.

The mobile team must choose and test one of these product-approved behaviors:

1. use a supported native Telegram action that accepts a phone number;
2. open the device contact/share flow with the E.164 number; or
3. display/copy the number when direct account resolution is unavailable.

A failed Telegram resolution is not an API error and must not hide the other
configured contact actions.

## 8. Recommended Client Data Flow

```text
Application starts or Home becomes active
  -> render valid locally cached configuration, if available
  -> GET /api/app/home/contact-links
      -> 200: validate, persist, and render the new configuration
      -> 401 with a signed-in session: refresh/reconcile auth, then retry once
      -> 429: retain cache and retry after Retry-After
      -> network/5xx: retain cache; otherwise hide the contact section
User taps a visible action
  -> execute the platform-specific adapter
  -> if the OS cannot open it, offer a safe copy fallback
```

Do not fetch this endpoint on every widget render or every list rebuild. A
reasonable implementation is stale-while-revalidate: load the last valid value
immediately, then refresh when the Home surface opens. `updatedAt` may be used
to avoid unnecessary state updates when the returned configuration has not
changed.

The server keeps a short in-process read cache and invalidates it after a
successful administrative update. The mobile application must not assume that
`updatedAt` is an HTTP cache validator; the current endpoint does not define
`ETag`, `If-None-Match`, or `304 Not Modified` behavior.

## 9. Reference Client Pseudocode

```text
async function refreshContactLinks():
    cached = storage.read("app-contact-links.mobile.v1")
    if cached is valid:
        render(cached.links)

    try:
        response = GET("/api/app/home/contact-links", optionalAppBearerToken)

        if response.status == 200:
            model = decodeStrictKnownFieldsAndIgnoreUnknownFields(response.json)
            validateKinds(model)
            storage.write("app-contact-links.mobile.v1", model)
            render(model.links)
            return

        if response.status == 401 and a token was sent:
            reconcileOrRefreshSession()
            retry at most once, or intentionally continue as visitor
            return

        if response.status == 429:
            delay = response.header("Retry-After")
                 ?? response.json.details.retryAfterSeconds
            scheduleRetry(delay)
            return

        reportNonSensitiveDiagnostic(response.status)
    catch networkOrDecodingError:
        reportNonSensitiveDiagnostic(errorCategory)

    if cached is not valid:
        hideEntireContactSection()
```

Rendering should be data-driven:

```text
orderedPlatforms = [facebook, website, instagram, whatsapp, telegram]

for platform in orderedPlatforms:
    item = response.links[platform]
    if item == null:
        continue
    renderContactAction(platform, item)
```

## 10. Error Contract and Recovery

Error responses use this general JSON envelope:

```json
{
  "error": "Localized or stable error message",
  "details": {
    "code": "machine_readable_code"
  }
}
```

| Status | Meaning | Required client behavior |
|---|---|---|
| `200` | Configuration loaded | Validate, cache, and render |
| `401` | Supplied authorization header/token is invalid, expired, or no longer accepted | Run the normal session refresh/reconciliation flow; retry at most once. Because this endpoint is visitor-safe, the app may then retry without a token only after intentionally transitioning to visitor behavior |
| `429` | Shared public mobile read limit exceeded | Keep cached data and wait for `Retry-After` or `details.retryAfterSeconds`; do not loop immediately |
| `500` | Configuration could not be loaded or an unexpected server error occurred | Keep the last valid cache; if none exists, hide the section and allow the rest of Home to work |

Example rate-limit response:

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 37
Content-Type: application/json
```

```json
{
  "error": "Request limit exceeded. Try again later.",
  "details": {
    "code": "rate_limited",
    "retryAfterSeconds": 37
  }
}
```

The read limiter is shared by the public mobile GET surface and is keyed by
client IP. The configured limit can differ by environment; do not hard-code a
request allowance in the client.

Timeouts, DNS failures, TLS failures, malformed JSON, and schema mismatches are
client-observed failures rather than API status responses. They must follow the
same stale-cache-or-hide recovery rule and must not block the rest of the Home
screen.

## 11. Security and Privacy Requirements

- Use only the configured API origin and HTTPS in production.
- Do not send staff credentials or call `/api/admin/app-contact-links` from the
  mobile application.
- Do not log Bearer tokens.
- Avoid logging complete phone numbers in production diagnostics.
- Treat returned URLs as untrusted display data even though the server validates
  them; open them through the approved URL-launching component.
- Do not embed returned URLs into raw HTML or JavaScript.
- Do not request device contacts permission merely to display these actions.
- Do not infer a Telegram username or a local-format telephone number.

## 12. Compatibility Rules

For contract version `app-contact-links.mobile.v1`, the mobile application must:

- require the top-level `links` object and `updatedAt` string;
- require the five known keys inside `links`;
- accept each known platform value as either its documented object or `null`;
- require `kind = "url"` for Facebook, Website, and Instagram;
- require `kind = "phone"` for WhatsApp and Telegram;
- ignore unknown additional properties and unknown future platform keys;
- preserve phone values as strings;
- avoid depending on JSON property order;
- avoid depending on localized `error` text for program logic; use HTTP status
  and `details.code` when supplied.

If a known key contains an unexpected `kind`, treat that item as invalid and
hide only that action. If the entire envelope cannot be decoded, retain the
last valid cached response or hide the complete section.

## 13. QA and Acceptance Criteria

The integration is complete only when all of the following cases pass:

1. A visitor receives and renders a valid `200` response without a token.
2. A signed-in customer receives the same configuration with a valid app token.
3. An invalid supplied token produces the session recovery flow and no retry
   loop.
4. Each of the five platforms renders when configured.
5. Each platform disappears when its value is `null`.
6. The entire contact section disappears when all five values are `null`.
7. Unknown response properties do not break decoding.
8. A missing known key is detected as a contract failure.
9. Facebook, Website, and Instagram open the exact returned HTTPS URL.
10. WhatsApp uses the correct international digits without the leading `+` in
    a `wa.me` web action.
11. WhatsApp failure offers a safe copy fallback.
12. Telegram does not fabricate a username URL from the phone number.
13. Telegram resolution failure does not affect the other actions.
14. `429` respects `Retry-After` and does not create a retry storm.
15. Offline and `500` states use the last valid cache when available.
16. With no valid cache, an API failure hides only the contact section and does
    not block Home.
17. Phone values retain their leading `+` in storage and presentation.
18. Accessibility labels identify both the platform and action, for example
    `Open WhatsApp` or its approved localized equivalent.

## 14. Administrator Context (Informational Only)

Golden CRM staff manage the source configuration through:

```http
GET /api/admin/app-contact-links
PUT /api/admin/app-contact-links
```

The administrative `PUT` is a full atomic replacement and requires all five
camel-case fields:

```json
{
  "facebookUrl": "https://www.facebook.com/goldengroupco/",
  "websiteUrl": "https://goldengroup.example/",
  "instagramUrl": "https://www.instagram.com/goldengroupco/",
  "whatsappNumber": "+963912345687",
  "telegramNumber": "+963912345687"
}
```

Each value may be a valid string or `null`. Staff updates require the dedicated
GLOBAL permissions and are audit logged. This information explains the source
of the mobile data; it does not authorize the mobile application to use the
administrative surface.

## 15. Mobile Developer Delivery Checklist

- [ ] Add an environment-configured API base URL.
- [ ] Add the `AppContactLinksResponse` model and tolerant JSON decoder.
- [ ] Add a repository/client method for the GET endpoint.
- [ ] Add versioned local caching for the last valid response.
- [ ] Add stale-while-revalidate loading on the Home surface.
- [ ] Add null-driven visibility for all five actions.
- [ ] Add URL, WhatsApp, and Telegram platform adapters.
- [ ] Add safe copy/error fallbacks.
- [ ] Add `401`, `429`, network, decoding, and `5xx` recovery.
- [ ] Add unit tests for decoding, nulls, unknown keys, and action construction.
- [ ] Add integration/UI tests covering the acceptance criteria above.
- [ ] Confirm the final behavior on every supported Android and iOS version.

