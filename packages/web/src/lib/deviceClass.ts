/**
 * Device class reported to the API in `X-Device-Class`.
 *
 * Only ONE case actually needs the browser's help: since iPadOS 13 an iPad
 * sends the exact same User-Agent as Safari on a Mac, so the server cannot tell
 * them apart from headers. The discriminator is touch — a Mac has no
 * multi-touch screen, an iPad does.
 *
 * The server classifies phones and Android tablets from the User-Agent itself
 * and ignores this header for them, so a tampered value cannot be used to gain
 * access; it can only resolve the Mac-or-iPad ambiguity. That, and simply not
 * sending the header, are the known ways around the rule — accepted, because
 * this is a discipline control, not a security boundary.
 */
export type DeviceClass = 'desktop' | 'mobile' | 'tablet';

export const DEVICE_CLASS_HEADER = 'X-Device-Class';

export function detectDeviceClass(): DeviceClass {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return 'desktop';

  const ua = navigator.userAgent || '';
  const lower = ua.toLowerCase();

  if (lower.includes('ipad')) return 'tablet';
  if (lower.includes('android')) return lower.includes('mobile') ? 'mobile' : 'tablet';
  if (/iphone|ipod|windows phone|iemobile|blackberry|opera mini/.test(lower)) return 'mobile';

  // iPadOS 13+ masquerading as a Mac: real Macs report maxTouchPoints 0.
  const touchPoints = typeof navigator.maxTouchPoints === 'number' ? navigator.maxTouchPoints : 0;
  if (lower.includes('macintosh') && touchPoints > 1) return 'tablet';

  if (lower.includes('mobile')) return 'mobile';
  return 'desktop';
}

/** Cached once per page load — the device does not change mid-session. */
let cached: DeviceClass | null = null;

export function deviceClassHeader(): Record<string, string> {
  if (cached === null) cached = detectDeviceClass();
  return { [DEVICE_CLASS_HEADER]: cached };
}

/** Server code for "this device may not be used", and where the message is
 *  parked for the login screen to pick up after the redirect. */
export const DEVICE_BLOCK_CODE = 'device_not_permitted';
export const DEVICE_BLOCK_MESSAGE_KEY = 'hr_device_block_message';

/**
 * Returns the Arabic reason when a 403 is the device policy, else null.
 * Reads a clone so the caller's normal error path can still consume the body.
 */
export async function readDeviceBlock(res: Response): Promise<string | null> {
  try {
    const parsed = await res.clone().json();
    if (parsed?.details?.code !== DEVICE_BLOCK_CODE) return null;
    return typeof parsed.error === 'string' && parsed.error
      ? parsed.error
      : 'عذراً، لا يمكن تسجيل الدخول من هذا الجهاز. يرجى استخدام الحاسوب.';
  } catch {
    return null;
  }
}
