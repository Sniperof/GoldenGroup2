// ============================================================
// services/otp/otpSender.ts
// ============================================================
// Port/Adapter for OTP delivery (DEC-013 §6).
//
// The rest of the OTP layer (storage, expiry, attempts, handle issuance)
// is identical regardless of provider — only the delivery step swaps.
//   - now:   SimulatedOtpSender (logs the code, no external call)
//   - later: SmsOtpSender, selected by OTP_PROVIDER=sms, WITHOUT changing
//            the API contract or the mobile integration.
// ============================================================

import { OTP_PROVIDER } from '../../config/env.js';

export interface OtpSendResult {
  delivered: boolean;
  provider: string;
}

export interface OtpSender {
  readonly name: string;
  send(phone: string, code: string, purpose: string): Promise<OtpSendResult>;
}

/** Dev/staging provider: does not contact any external service. */
class SimulatedOtpSender implements OtpSender {
  readonly name = 'simulated';

  async send(phone: string, code: string, purpose: string): Promise<OtpSendResult> {
    // Intentional log so the flow is testable end-to-end without a real phone.
    console.log(`[OTP:simulated] purpose=${purpose} phone=${phone} code=${code}`);
    return { delivered: true, provider: this.name };
  }
}

let cached: OtpSender | null = null;

/**
 * Returns the configured OTP sender. Add real providers (e.g. 'sms') here;
 * the caller never changes.
 *
 * FAIL-CLOSED: no `default` branch. An unrecognised OTP_PROVIDER used to fall
 * back to the simulator, which boots cleanly, accepts every request, delivers
 * nothing, and prints live codes to the log — a typo in the deployment env
 * would look exactly like a healthy server. `config/env.ts` already rejects
 * unknown values and refuses `simulated` in production at boot; this throw is
 * the second gate for a provider added to the enum but not wired here.
 */
export function getOtpSender(): OtpSender {
  if (cached) return cached;
  switch (OTP_PROVIDER) {
    // case 'sms': cached = new SmsOtpSender(); break;   // Phase: production
    case 'simulated':
      cached = new SimulatedOtpSender();
      break;
    default:
      throw new Error(`No OTP sender adapter is installed for OTP_PROVIDER="${OTP_PROVIDER}".`);
  }
  return cached;
}
