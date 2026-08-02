// ============================================================
// services/deviceClass.ts
// ============================================================
// Classifies the device behind a web request as desktop / mobile / tablet.
//
// This is a DISCIPLINE control, not a security boundary. Every signal it reads
// is supplied by the client and can be changed there — "Request desktop site"
// in any mobile browser flips the User-Agent with one tap. It stops the people
// who are not trying to evade it, which is the whole intent; nothing else may
// be built on top of it.
//
// Why a client hint is needed at all: since iPadOS 13 an iPad reports the exact
// same User-Agent as Safari on a Mac. Server-side the two are indistinguishable,
// so an iPad cannot be recognised from headers alone. The web app resolves that
// one ambiguity by measuring multi-touch support in the browser and sending the
// result in `X-Device-Class`.
//
// Trust model between the two signals:
//   - The UA decides on its own whenever it is unambiguous (phones, Android
//     tablets, declared iPads). A client hint cannot override it — otherwise
//     the hint would be a way to *gain* access, not just to disambiguate.
//   - The hint is consulted ONLY for the desktop-or-iPad ambiguity.
//   - A missing hint resolves to `desktop`. This is the known bypass, chosen
//     deliberately: the alternative locks out every user during rollout and on
//     any client that fails to send it.
// ============================================================

export type DeviceClass = 'desktop' | 'mobile' | 'tablet';

/** Header the web app sets from its own measurement. */
export const DEVICE_CLASS_HEADER = 'x-device-class';

function normalizeHint(raw: unknown): DeviceClass | null {
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return value === 'desktop' || value === 'mobile' || value === 'tablet' ? value : null;
}

/**
 * Classifies from the User-Agent alone.
 * Returns `null` for the desktop-or-iPad ambiguity, which only the client hint
 * can resolve.
 */
export function classifyUserAgent(userAgent: string): DeviceClass | null {
  const ua = (userAgent || '').toLowerCase();
  if (!ua) return null;

  // Declared tablets. Older iPads still say "ipad"; Android tablets are the
  // Android UAs that omit the "mobile" token.
  if (ua.includes('ipad')) return 'tablet';
  if (ua.includes('android')) return ua.includes('mobile') ? 'mobile' : 'tablet';
  if (ua.includes('silk') || ua.includes('kindle') || ua.includes('playbook')) return 'tablet';

  // Phones and phone-like handhelds.
  if (
    ua.includes('iphone') || ua.includes('ipod') ||
    ua.includes('windows phone') || ua.includes('iemobile') ||
    ua.includes('blackberry') || ua.includes('opera mini') ||
    ua.includes('mobile')
  ) {
    return 'mobile';
  }

  // "Macintosh" is the ambiguous case: a Mac, or an iPad since iPadOS 13.
  if (ua.includes('macintosh')) return null;

  // Everything else that names a desktop OS is unambiguous.
  if (ua.includes('windows') || ua.includes('x11') || ua.includes('linux') || ua.includes('cros')) {
    return 'desktop';
  }
  return null;
}

/**
 * Final classification from both signals. Pure — `headers` is a plain lookup so
 * this is testable without a request object.
 */
export function classifyDevice(headers: {
  userAgent?: string | null;
  deviceClassHint?: string | null;
}): { deviceClass: DeviceClass; source: 'user_agent' | 'client_hint' | 'fallback' } {
  const fromUa = classifyUserAgent(headers.userAgent ?? '');
  if (fromUa) return { deviceClass: fromUa, source: 'user_agent' };

  const hint = normalizeHint(headers.deviceClassHint);
  if (hint) return { deviceClass: hint, source: 'client_hint' };

  return { deviceClass: 'desktop', source: 'fallback' };
}
