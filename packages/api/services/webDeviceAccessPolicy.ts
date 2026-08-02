// ============================================================
// services/webDeviceAccessPolicy.ts
// ============================================================
// "Which roles may use the staff web app from a phone or tablet."
//
// The criterion is the role's TEAM SLOT (`roles.team_slot_type`), not its name:
// a supervisor or technician role created next year inherits the rule with no
// code change, which is the point. The allowed slots live in an admin setting
// rather than in code so the coupling is DECLARED — deriving it from "any
// non-empty slot" would silently grant mobile access the day someone adds a
// TELEMARKETER-slot role for scheduling reasons.
//
// Deliberate decisions, all the operator's:
//   - Tablets are restricted alongside phones.
//   - There is NO exemption, not even for the super admin. Once enabled, the
//     setting cannot be turned off from a phone or tablet by anyone — the
//     escape hatches are any desktop, or updating the setting row directly in
//     the database. Operations must know the second one before enable day.
//   - Empty setting = feature off, so shipping it changes nothing until an
//     admin opts in.
// ============================================================

import { getSystemSettingString } from './systemSettings.js';
import type { DeviceClass } from './deviceClass.js';

/** Admin setting: comma-separated team slots allowed on restricted devices. */
export const WEB_LOGIN_ALLOWED_SLOTS_KEY = 'web_login_allowed_team_slots';

/**
 * Device classes the policy governs. Desktop is never restricted — the rule
 * exists to push office work onto a desktop, so the desktop is the escape.
 */
export const RESTRICTED_DEVICE_CLASSES: DeviceClass[] = ['mobile', 'tablet'];

export const WEB_DEVICE_BLOCKED_CODE = 'device_not_permitted';
export const WEB_DEVICE_BLOCKED_MESSAGE =
  'عذراً، لا يمكن تسجيل الدخول من الهاتف أو الجهاز اللوحي. يرجى استخدام الحاسوب للدخول إلى النظام.';

export interface WebDeviceDecision {
  /** True when the feature is switched on, whatever the outcome — for logging. */
  enforced: boolean;
  /** Null means allowed. A discriminated union narrows badly under this
   *  project's non-strict tsconfig, so the refusal is a nullable field. */
  blocked: { code: string; message: string } | null;
}

/** Parses the setting. Blank/absent yields an empty list, i.e. feature off. */
export function parseAllowedSlots(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
}

/**
 * The decision itself. Pure, so every branch is testable without a DB or a
 * request.
 *
 * Order matters: the empty-allow-list check comes first so that a system with
 * the feature switched off never depends on device detection at all.
 */
export function decideWebDeviceAccess(input: {
  deviceClass: DeviceClass;
  teamSlotType: string | null | undefined;
  allowedSlots: string[];
}): WebDeviceDecision {
  if (input.allowedSlots.length === 0) {
    return { enforced: false, blocked: null };
  }
  if (!RESTRICTED_DEVICE_CLASSES.includes(input.deviceClass)) {
    return { enforced: true, blocked: null };
  }
  const slot = (input.teamSlotType ?? '').trim().toUpperCase();
  if (slot && input.allowedSlots.includes(slot)) {
    return { enforced: true, blocked: null };
  }
  return {
    enforced: true,
    blocked: { code: WEB_DEVICE_BLOCKED_CODE, message: WEB_DEVICE_BLOCKED_MESSAGE },
  };
}

/** Loads the configured slots (cached 60s by the settings service). */
export async function loadAllowedTeamSlots(): Promise<string[]> {
  return parseAllowedSlots(await getSystemSettingString(WEB_LOGIN_ALLOWED_SLOTS_KEY, ''));
}
