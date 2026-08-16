// ============================================================
// services/otp/raselOtpSender.ts
// ============================================================
// OtpSender adapter for the Rasel SMS API (provider handoff:
// rasel-otp-backend-integration.md). Selected via OTP_PROVIDER=sms.
//
// Never logs: the OTP code, RASEL_API_KEY, the X-API-Key header value, or a
// full phone number. Only masked phone + provider tracking ids are safe to
// log (matches the DevOps handoff's "safe log fields" list).
// ============================================================

import {
  RASEL_BASE_URL,
  RASEL_SEND_PATH,
  RASEL_API_KEY,
  RASEL_CHANNEL,
  RASEL_SENDER_ID,
  RASEL_TIMEOUT_MS,
  RASEL_TRIAL_MODE,
  RASEL_TRIAL_ALLOWED_TO,
  RASEL_KILL_SWITCH,
} from '../../config/env.js';
import type { OtpSender, OtpSendResult } from './otpSender.js';

interface RaselMessageBody {
  success?: boolean;
  requestId?: string;
  status?: string;
  tracking?: { messageId?: string; usageId?: string };
}

interface RaselResult {
  to?: string;
  status?: number;
  ok?: boolean;
  body?: RaselMessageBody;
}

// The live API returns RaselMessageBody's fields directly at the top level
// (confirmed 2026-08-13 via a direct curl against /api/v2/messages/send) — the
// nested `{ok, results: [{ok, body}]}` wrapper from the vendor handoff doc was
// never observed live. Both are accepted: RaselMessageBody covers the real
// shape, `ok`/`results` stay optional for the documented-but-unconfirmed one.
interface RaselResponse extends RaselMessageBody {
  ok?: boolean;
  results?: RaselResult[];
}

function providerError(code: 'sms_provider_failed' | 'sms_provider_unavailable', message: string) {
  return Object.assign(new Error(message), { code });
}

/** Local system phone format is 09XXXXXXXX (see utils/contactValidation.ts). */
function toRaselFormat(localPhone: string): string {
  return `963${localPhone.slice(1)}`;
}

function maskPhone(raselPhone: string): string {
  return `+${raselPhone.slice(0, 3)} *** *** ${raselPhone.slice(-3)}`;
}

export class RaselOtpSender implements OtpSender {
  readonly name = 'rasel';

  async send(phone: string, code: string, purpose: string): Promise<OtpSendResult> {
    const to = toRaselFormat(phone);
    const masked = maskPhone(to);

    if (RASEL_KILL_SWITCH) {
      console.warn(`[OTP:rasel] kill_switch_active purpose=${purpose} phone=${masked}`);
      throw providerError('sms_provider_unavailable', 'تعذّر إرسال رسالة التحقق حالياً');
    }

    if (RASEL_TRIAL_MODE && to !== RASEL_TRIAL_ALLOWED_TO) {
      console.warn(`[OTP:rasel] trial_mode_blocked purpose=${purpose} phone=${masked}`);
      throw providerError('sms_provider_unavailable', 'تعذّر إرسال رسالة التحقق حالياً');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), RASEL_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(`${RASEL_BASE_URL}${RASEL_SEND_PATH}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': RASEL_API_KEY as string,
        },
        body: JSON.stringify({
          channel: RASEL_CHANNEL,
          messageType: 'otp',
          to,
          sender: { id: RASEL_SENDER_ID },
          content: { otpCode: code },
        }),
        signal: controller.signal,
      });
    } catch (err) {
      console.error(`[OTP:rasel] network_error purpose=${purpose} phone=${masked}`, (err as Error).name);
      throw providerError('sms_provider_unavailable', 'تعذّر إرسال رسالة التحقق حالياً');
    } finally {
      clearTimeout(timer);
    }

    let parsed: RaselResponse;
    try {
      parsed = await response.json();
    } catch {
      console.error(`[OTP:rasel] invalid_response purpose=${purpose} phone=${masked} httpStatus=${response.status}`);
      throw providerError('sms_provider_failed', 'تعذّر إرسال رسالة التحقق حالياً');
    }

    // Nested (documented) shape wins if present; otherwise `parsed` itself IS
    // the message body (the real, observed shape — see RaselResponse above).
    const nested = parsed.results?.[0];
    const body: RaselMessageBody = nested ? (nested.body ?? {}) : parsed;
    const wrapperOk = nested ? parsed.ok === true && nested.ok === true : true;
    const succeeded = response.ok && wrapperOk && body.success === true;

    if (!succeeded) {
      console.error(
        `[OTP:rasel] send_rejected purpose=${purpose} phone=${masked} ` +
        `httpStatus=${response.status} bodyStatus=${body.status}`,
      );
      throw providerError('sms_provider_failed', 'تعذّر إرسال رسالة التحقق حالياً');
    }

    console.log(
      `[OTP:rasel] sent purpose=${purpose} phone=${masked} requestId=${body.requestId} ` +
      `status=${body.status}`,
    );

    return {
      delivered: true,
      provider: this.name,
      providerRequestId: body.requestId,
      providerStatus: body.status,
      providerMessageId: body.tracking?.messageId,
      providerUsageId: body.tracking?.usageId,
    };
  }
}
