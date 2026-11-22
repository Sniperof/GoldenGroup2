// Branch-isolation merge for the shared day_schedules row (GAP-DS-005).
//
// The array index IS the team identity (team_N / solo_N). A branch-scoped
// editor receives other branches' slots as `{ locked: true }` placeholders and
// must send them back at the same index. The merge is decided by STORED
// ownership, not by what the payload claims: a payload that shifts, truncates
// or writes over a foreign position is a conflict, never a silent delete.

export function isLockedSlot(slot: any): boolean {
  return Boolean(slot) && typeof slot === 'object' && slot.locked === true;
}

export interface ScheduleSlotMergeResult {
  /** Index of the first foreign position the payload did not preserve. */
  conflictIndex: number | null;
  merged: any[];
}

export function mergeScheduleSlots(
  proposed: any[],
  stored: any[],
  isSolo: boolean,
  isVisible: (slot: any, isSolo: boolean) => boolean,
): ScheduleSlotMergeResult {
  const merged: any[] = [];
  const length = Math.max(proposed.length, stored.length);
  for (let i = 0; i < length; i += 1) {
    const storedSlot = stored[i];
    const proposedSlot = proposed[i];
    const isForeign = storedSlot != null
      && !isLockedSlot(storedSlot)
      && !isVisible(storedSlot, isSolo);
    if (isForeign) {
      if (!isLockedSlot(proposedSlot)) return { conflictIndex: i, merged };
      merged.push(storedSlot);
      continue;
    }
    // An own/empty trailing slot the editor removed. Any foreign slot after it
    // would have failed above, so dropping it never shifts a foreign team.
    if (i >= proposed.length) continue;
    if (isLockedSlot(proposedSlot)) {
      // Placeholder over a slot that is no longer foreign: keep what is stored.
      merged.push(storedSlot ?? (isSolo ? { technician: null } : { supervisor: null, technician: null }));
      continue;
    }
    merged.push(proposedSlot);
  }
  return { conflictIndex: null, merged };
}
