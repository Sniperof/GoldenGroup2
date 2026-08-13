# Rasel OTP — Setup Guide (DevOps)

> Enables real SMS delivery for customer-app OTP (`/api/app/otp/send`). Until this is done, `OTP_PROVIDER` stays `simulated` everywhere and no real SMS is sent — nothing here is required for the app to keep working as it does today.

## What this depends on

The backend adapter is already implemented (`packages/api/services/otp/raselOtpSender.ts`) and merged. This document is only the deployment/config side: which environment variables to set, where, and how to switch a box over to real Rasel sending.

## Prerequisite — rotate the API key

A real Rasel API key was shared in a chat during the provider handoff and must be treated as compromised. **Before setting up any environment**, ask Rasel to rotate/reissue the key. Do not reuse the value that was shared in chat, anywhere, ever — not even in QA.

## Environment variables

Add these to the environment file the target box already uses for its process manager (production: `/etc/golden-crm/production.env`, loaded by PM2 per [SERVER-DEPLOY.md](./SERVER-DEPLOY.md); staging/QA: the `.env` file at that box's app directory, per the project's staging conventions). Never commit real values to git — `.env.example` only has placeholders.

| Variable | QA/staging value | Notes |
|---|---|---|
| `OTP_PROVIDER` | `sms` | Switches the OTP layer from the simulator to Rasel. Leave as `simulated` (or unset) on any box that should NOT send real SMS. |
| `RASEL_API_KEY` | *(the rotated key, from Rasel)* | Never in git, never in logs. Get it from whoever holds the Rasel account after rotation. |
| `RASEL_SENDER_ID` | *(from Rasel dashboard)* | Confirm the exact value with Rasel — it is account-specific. |
| `RASEL_BASE_URL` | `https://raselsms.com` | Default; only change if Rasel says otherwise. |
| `RASEL_SEND_PATH` | `/api/v2/messages/send` | Default (provider-supplied v2 contract). Confirm in the Rasel dashboard before production — their public docs still reference v1. |
| `RASEL_CHANNEL` | `local_sms` | Default. |
| `RASEL_TIMEOUT_MS` | `10000` | Default; raise only if Rasel is consistently slow. |
| `RASEL_TRIAL_MODE` | `true` | **Keep `true` for QA.** While Rasel's account is in trial, delivery is only accepted for one whitelisted number; this flag blocks every other number server-side before any network call, so QA never wastes trial quota. |
| `RASEL_TRIAL_ALLOWED_TO` | `963987223900` | The one number Rasel allows during trial. Confirm this hasn't changed with Rasel before a QA run. |
| `RASEL_KILL_SWITCH` | `false` | Fast off-switch — set to `true` and restart to stop all real sending immediately (e.g. Rasel outage, suspected abuse) without touching `OTP_PROVIDER` or redeploying. |

Boot-time safety (already built in, nothing to configure): the process refuses to start if `OTP_PROVIDER=sms` and either `RASEL_API_KEY` or `RASEL_SENDER_ID` is missing, and it refuses to start in `NODE_ENV=production` with `RASEL_TRIAL_MODE=true`.

## Applying the config

```bash
# edit the box's env file, then reload the process that reads it
pm2 restart <process-name>   # e.g. golden-crm-staging on the QA box
pm2 logs <process-name> --lines 50
```

A successful boot with `OTP_PROVIDER=sms` prints nothing special — silence is success. A misconfiguration (missing key/sender id, or trial mode in production) crashes the process immediately with a clear message in the PM2 logs; that is deliberate fail-fast behavior, not a bug.

## QA smoke test

Run this only against the whitelisted trial number, from the QA box:

```bash
curl -X POST http://localhost:<port>/api/app/otp/send \
  -H 'Content-Type: application/json' \
  -d '{"phone":"0987223900","purpose":"login"}'
```

(`0987223900` is the local form of the trial number `963987223900`.) Expect `200` with `sent: true` and a real SMS to arrive on that number. Any other number returns `503` with `details.code = "sms_provider_unavailable"` by design (trial-mode block) — that is not a bug, it means the guard is working.

## Rollback

Set `RASEL_KILL_SWITCH=true` (fastest, no code/endpoint change) or `OTP_PROVIDER=simulated` (only outside production — refused there on purpose) and restart the process. Do not delete the deployed secret unless the key itself is known to be compromised.

## Logging

The adapter never logs the OTP code, the API key, the `X-API-Key` header, or a full phone number — only a masked phone (`+963 *** *** XXX`), provider status, and provider tracking IDs. No changes needed to log shipping/masking config on account of this feature.
