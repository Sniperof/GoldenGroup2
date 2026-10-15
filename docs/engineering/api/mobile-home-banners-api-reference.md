# Mobile Home Banners API Reference

> Contract version: `app-home-banners.mobile.v1`
> Status: implementation-ready
> Audience: mobile application developers, QA engineers, and backend integrators
> Authentication: optional; supported for visitors and signed-in customers
> Content type: `application/json`

---

## 1. What This Endpoint Is

The home screen shows a horizontal slider of images. Each image stays on screen for a configured number of seconds, then advances to the next. Tapping an image may open a device page, open a service-request form, open an external link, or do nothing — the server tells you which.

Administrators control the images, their order, their rotation speed, their publish window, and their tap targets from the web portal. **You must not hardcode banners, their order, or their durations.**

### What the server already guarantees

The endpoint returns only slides that are publishable *right now*. You do **not** need to implement any of the following — they are applied server-side before the response is built:

| Rule | Handled by |
|---|---|
| Disabled banners are hidden | Server |
| Banners scheduled to start later are hidden | Server |
| Expired banners are hidden | Server |
| Display order | Server (array order) |
| A banner pointing at a device that was deactivated in the catalog is dropped | Server |
| A banner pointing at a request type the app can no longer open is dropped | Server |

The last two checks are performed when the response is built. A target can still
become unavailable after the list is fetched, so the app must handle a failed
navigation gracefully. Render `items` in the order given and do not repeat the
server's publication filters in the client.

---

## 2. Endpoint

```http
GET /api/app/home/banners
```

No query parameters.

Build the request from the API origin configured for the active environment:

```text
{API_BASE_URL}/api/app/home/banners
```

Do not hard-code development, staging, or production hostnames. The production
API origin must use HTTPS. The request has no body. Send:

```http
Accept: application/json
Authorization: Bearer <app-access-token>   # optional
```

`X-Branch-Id`, `X-Device-Id`, and `X-Visitor-Handle` are not required.

### Authentication

The `Authorization` header is **optional**:

| Caller | Header | Result |
|---|---|---|
| Visitor (not signed in) | Omit the header entirely | `200` with the slides for visitors |
| Signed-in customer | `Authorization: Bearer <app-access-token>` | `200` with the slides for customers |
| Any caller | Header present but expired/invalid | `401` |

> **Important:** a present-but-invalid token is **not** silently downgraded to a visitor. If your token has expired, this endpoint returns `401` like every other app endpoint — refresh the token and retry. Do not send an empty or placeholder `Authorization` header.

Today every banner is configured for **all** viewers, so signed-in and visitor callers receive the same list. The audience mechanism exists server-side and may be enabled later; build against the response, not against that assumption.

---

## 3. Response

### `200 OK`

```json
{
  "items": [
    {
      "id": 11,
      "titleAr": "عرض الفلتر السباعي",
      "imageUrl": "/m/aB3xK9pQmN2v.webp",
      "displaySeconds": 6,
      "target": { "kind": "device", "deviceId": 1 }
    },
    {
      "id": 12,
      "titleAr": "اطلب صيانة الآن",
      "imageUrl": "/m/7hQ2LmNpX4Rt.webp",
      "displaySeconds": 4,
      "target": {
        "kind": "service_request",
        "requestType": "emergency_maintenance",
        "labelAr": "طلب صيانة طارئة"
      }
    },
    {
      "id": 13,
      "titleAr": null,
      "imageUrl": "/m/Kd9wPz3VnQ7b.webp",
      "displaySeconds": 5,
      "target": { "kind": "none" }
    }
  ]
}
```

An empty slider is returned as `{ "items": [] }` — hide the slider area entirely, do not render a placeholder.

### Formal response model

```typescript
type BannerTarget =
  | { kind: "none" }
  | { kind: "device"; deviceId: number }
  | { kind: "service_request"; requestType: string; labelAr: string }
  | { kind: "external_url"; url: string };

interface MobileHomeBanner {
  id: number;
  titleAr: string | null;
  imageUrl: string;
  displaySeconds: number;
  target: BannerTarget;
}

interface MobileHomeBannersResponse {
  items: MobileHomeBanner[];
}
```

### Banner item fields

| Field | Type | Nullable | Description |
|---|---|---:|---|
| `id` | integer | No | Banner identifier. Use it as the list key and for analytics; it is not needed for any other call. |
| `titleAr` | string | Yes | Optional Arabic caption. When `null`, render the image with no text overlay. Never substitute a default caption. |
| `imageUrl` | string | No | Server-relative image path. See §5. |
| `displaySeconds` | integer | No | How long this slide stays on screen before auto-advancing. Always between 2 and 60. See §4. |
| `target` | object | No | What tapping the slide does. Always present; see §6. |

---

## 4. Rotation Behaviour

`displaySeconds` is **per slide**, not per slider. Slide 1 may show for 6 seconds and slide 2 for 4 seconds in the same rotation. Read the value from each item as you advance; do not take the first item's value and apply it to all.

Recommended behaviour:

- Auto-advance after `displaySeconds`, looping back to the first slide after the last.
- If the user swipes manually, restart the timer for the newly shown slide using **that** slide's `displaySeconds`.
- Pause the timer when the app is backgrounded or the home screen is not visible; resume on return.
- With exactly one item, render it statically and skip the timer entirely.

---

## 5. Images

`imageUrl` is a **server-relative path**. Build the absolute URL by prefixing your configured API base origin:

```
https://<api-host>/m/aB3xK9pQmN2v.webp
```

Use the same origin you use for API calls. Do not hardcode a host, and do not assume the path always begins with `/m/` — a small number of older banners still carry `/uploads/...` paths. Both are valid and both are served by the same host. Treat `imageUrl` as an opaque path: prefix it and load it.

### Format and sizing

New images are WebP, at most 2048px on the long edge, with all metadata stripped. Banners are authored at a wide aspect ratio (roughly 16:9). Render with a fixed aspect-ratio container and center-crop; do not letterbox and do not distort.

### Caching

New `/m/` image URLs are **immutable**: an image is never modified in place. If
an administrator replaces a banner's picture, the response carries a new
`imageUrl` with a new identifier. The `/m/` media route sends:

```
Cache-Control: public, max-age=31536000, immutable
```

This means you should let the platform HTTP cache do its job (`URLSession`/`OkHttp` defaults, Coil, Glide, SDWebImage, `CachedNetworkImage` — all honour this). A `/m/` image can be served from cache for a year.

Legacy `/uploads/...` assets remain valid but are served through the older
static-file route and do not carry the same explicit one-year immutable
guarantee. Respect the actual response headers for those assets. Do not rewrite
a legacy path into `/m/`.

Do **not** append cache-busting query strings (`?v=123`, `?t=<timestamp>`). Doing so defeats the cache and forces a re-download on every home-screen open.

No authentication is required to fetch an image, so a plain `<Image>`/`AsyncImage` widget works without attaching headers.

---

## 6. Tap Targets

`target.kind` is a discriminator with exactly four values. **Switch on it exhaustively, and treat an unrecognised value as non-tappable** — new kinds may be added later, and an older app build must degrade to "image only" rather than crash or misroute.

### `kind: "none"`

```json
{ "kind": "none" }
```

Decorative slide. Render the image with **no** tap handler and no visual affordance suggesting it is tappable.

### `kind: "device"`

```json
{ "kind": "device", "deviceId": 1 }
```

Open the **public catalog device page** for `deviceId`.

> **Critical:** `deviceId` is a **catalog model id** (the same id used by `GET /api/app/catalog/devices/{deviceId}`), **not** an installed device belonging to the signed-in customer, and **not** a serial number. A banner is shown to every user including visitors, so it can only ever point at a product in the public catalog. Never route it into the "My Devices" screen.

Fetch details with:

```
GET /api/app/catalog/devices/{deviceId}
```

See [mobile-device-catalog-api-reference.md](mobile-device-catalog-api-reference.md). The server has already verified the device is active and visible before including the banner, but still handle a `404` gracefully (it can occur if the device is deactivated between your list fetch and the tap) — return the user to the home screen with a brief message rather than showing an empty page.

### `kind: "service_request"`

```json
{
  "kind": "service_request",
  "requestType": "emergency_maintenance",
  "labelAr": "طلب صيانة طارئة"
}
```

Open the **intake form** for `requestType`, pre-selected, exactly as if the user had chosen that type from the requests list.

`requestType` is always one of the values returned by `GET /api/app/service-requests/types` — the server filters the banner list against that same source, so a type that is no longer executable never reaches you. Route it through your existing per-type form logic; do not build a second routing table for banners.

`labelAr` is the same Arabic label the requests list shows for that type. Use it for a confirmation screen title or an interstitial; it saves you a lookup. It is informational — never send it back to the server.

Some request types require a signed-in customer while others accept visitors. That gating is defined by `submitterTiers` in `GET /api/app/service-requests/types` and is **not** repeated in the banner payload. If a visitor taps a banner for a customer-only type, apply your existing sign-in flow, then continue to the form. See [mobile-service-requests-api-reference.md](mobile-service-requests-api-reference.md).

### `kind: "external_url"`

```json
{ "kind": "external_url", "url": "https://example.com/campaign" }
```

Open in the system browser (or an in-app browser tab). The URL is always `https`. Do not render it inside a bare WebView that shares session state with the app.

---

## 7. Errors and Rate Limiting

| Status | Meaning | What the app should do |
|---|---|---|
| `200` | Success (possibly `{"items": []}`) | Render, or hide the slider when empty |
| `401` | Bearer token present but invalid/expired | Refresh the token and retry once; if refresh fails, sign the user out |
| `429` | Per-IP read limit exceeded (`details.code = "rate_limited"`) | Keep the cached slider and wait for `Retry-After` or `details.retryAfterSeconds`; never retry immediately in a loop |
| `500` | Unexpected server error | Keep showing the previously cached slider; never block the home screen |

Error bodies follow the standard app shape:

```json
{ "error": "تعذّر إتمام العملية. حاول لاحقاً.", "details": { "code": "internal_error" } }
```

The `error` string is Arabic and safe to display. Prefer branching on `details.code` when present.

The public mobile read limit is configured per environment and shared with
other public mobile GET endpoints. Do not hard-code a request allowance. Network
timeouts, DNS/TLS failures, malformed JSON, and schema mismatches follow the
same stale-cache-or-hide recovery rule.

---

## 8. Recommended Client Behaviour

**The slider is decorative — it must never block or delay the home screen.** Load it alongside the rest of the home content, not before it.

1. On home-screen load, call the endpoint.
2. Cache the last successful response locally (the payload is small — a few hundred bytes).
3. On failure of any kind, render the cached response. If there is no cache, render no slider at all. Do not show an error banner or a retry button in place of the slider.
4. Re-fetch on each home-screen appearance, or on a short interval (5–10 minutes) if your home screen is long-lived. The payload is cheap; the images are cached separately and permanently by URL.
5. Do not persist images yourself — the HTTP cache already does this correctly (§5).

Because the response is server-filtered by time, a slide can disappear or appear between two fetches without anything else changing. That is expected behaviour for a scheduled campaign, not an error.

The API uses a short 60-second in-process read cache and clears it after a
successful administrative write. The current contract does not expose an
`updatedAt` value and does not define `ETag`, `If-None-Match`, or `304 Not
Modified`; the client must treat each `200` body as the complete current list.

### Reference client flow

```text
Home becomes visible
  -> render the last valid cached payload, if available
  -> GET /api/app/home/banners
      -> 200: decode, replace cache, and render items in server order
      -> 401 with a token: refresh/reconcile the session and retry once
      -> 429: retain cache and schedule a retry after Retry-After
      -> network/5xx/decode failure: retain cache; otherwise hide the slider

Visible slide changes
  -> cancel the previous timer
  -> if item count > 1, start a timer using this item's displaySeconds

Banner is tapped
  -> switch on target.kind
  -> use the existing catalog/request routing layer or safe URL launcher
  -> handle unavailable targets without affecting Home
```

## 9. Compatibility and Security Rules

- Require the top-level `items` array but accept it when empty.
- Require all documented fields on each item; `titleAr` alone may be `null`.
- Ignore unknown JSON properties and unknown future top-level fields.
- Do not depend on JSON property order.
- Treat an unknown `target.kind` as `none` for forward compatibility.
- Do not perform client-side sorting or publication-window filtering.
- Use HTTP status and `details.code` for program logic, not localized error text.
- Use only the configured API/media origin and HTTPS in production.
- Do not attach staff credentials to the mobile request or image request.
- Do not log Bearer tokens or complete external target URLs in production diagnostics.
- Open external URLs through the approved system/in-app-browser component; do
  not inject them into raw HTML or a privileged WebView.
- Do not call `/api/admin/app-home-banners` from the mobile application.

---

## 10. QA and Acceptance Criteria

The integration is complete only when all of the following cases pass:

1. A visitor can load banners without an authorization header.
2. A signed-in customer can load banners with a valid app Bearer token.
3. A supplied invalid token triggers session recovery without a retry loop.
4. `{ "items": [] }` removes the slider without leaving blank vertical space.
5. Items render in the exact order returned by the server.
6. Every slide uses its own `displaySeconds` value.
7. Manual swiping restarts the timer for the newly visible slide.
8. A single slide does not start an unnecessary rotation timer.
9. Backgrounding the app or leaving Home pauses or cancels the active timer.
10. `titleAr: null` renders without a caption or invented fallback text.
11. Both `/m/...` and legacy `/uploads/...` image paths resolve against the API origin.
12. A `device` target opens the public catalog model, never an installed device.
13. A `service_request` target uses the existing request-type/form router and
    applies the existing submitter-tier authentication flow.
14. An `external_url` target opens only through the approved HTTPS launcher.
15. A `none` or unknown target kind is non-tappable.
16. A target that becomes unavailable after fetch fails gracefully and returns
    the user to a usable Home screen.
17. `429` respects the server retry delay and does not create a request storm.
18. Offline and `5xx` states use the last valid cached payload when available.
19. With no valid cache, banner failure hides only the slider and never blocks Home.
20. Unknown response properties do not break decoding.

## 11. Mobile Developer Delivery Checklist

- [ ] Call `GET /api/app/home/banners` without requiring a signed-in user.
- [ ] Send `Authorization` only when a valid token exists; never send an empty header.
- [ ] Render `items` in the exact order received — no client-side sorting.
- [ ] Use each item's own `displaySeconds` for its rotation interval.
- [ ] Prefix `imageUrl` with the API base origin; do not assume the `/m/` prefix.
- [ ] Do not add cache-busting parameters to image URLs.
- [ ] Handle `titleAr: null` by rendering no caption.
- [ ] Switch exhaustively on `target.kind`; unknown kinds render as non-tappable.
- [ ] Route `kind: "device"` to the **catalog** device page, never to "My Devices".
- [ ] Route `kind: "service_request"` through the existing intake-form routing by `requestType`.
- [ ] Open `kind: "external_url"` in the system browser.
- [ ] Hide the slider entirely when `items` is empty or the request fails with no cache.
- [ ] Pause auto-advance when the screen is not visible.
- [ ] Add unit tests for decoding, target discrimination, URL construction, and timers.
- [ ] Add integration/UI tests for empty, cached, offline, and target-navigation states.
- [ ] Validate the final behavior on every supported Android and iOS version.

---

## 12. Administrator Context (Informational Only)

Golden CRM staff manage banner records through authenticated administration
endpoints under:

```http
/api/admin/app-home-banners
```

Staff can create, replace, reorder, activate/deactivate, schedule, and delete
banners. The administration surface validates that device and service-request
targets are resolvable and invalidates the public read cache after successful
writes. These endpoints require the dedicated GLOBAL view/manage permissions.
This context explains where the mobile data originates; it does not authorize
the mobile application to use the administration API.

## 13. Related References

- [mobile-device-catalog-api-reference.md](mobile-device-catalog-api-reference.md) — device pages opened by `kind: "device"`
- [mobile-service-requests-api-reference.md](mobile-service-requests-api-reference.md) — intake forms opened by `kind: "service_request"`, and `submitterTiers` gating
- [mobile-app-auth-api-reference.md](mobile-app-auth-api-reference.md) — obtaining and refreshing the app access token
