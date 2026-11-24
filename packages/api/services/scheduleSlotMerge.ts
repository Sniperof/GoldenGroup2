// Branch-isolation merge for the shared day_schedules row (GAP-DS-005).
//
// Since DEC-026 phase 2 every team carries an explicit key, so the merge is by
// key, not by array position. A branch-scoped editor receives other branches'
// teams as `{ key, locked: true }` placeholders. On save, foreign teams are
// always restored from the STORED row, whatever the payload says; a payload
// that tries to write a team under a foreign key is a conflict, never a silent
// overwrite. Removing an own team cannot shift anyone else.

import type { ScheduledTeam } from './daySchedule.js';

export function isLockedSlot(slot: any): boolean {
  return Boolean(slot) && typeof slot === 'object' && slot.locked === true;
}

export interface ScheduleTeamMergeResult {
  /** First foreign key the payload tried to overwrite. */
  conflictKey: string | null;
  merged: ScheduledTeam[];
}

/**
 * @param proposed own teams from the payload (placeholders already removed)
 * @param stored   teams currently stored for the day
 * @param isVisible whether the viewer owns a stored team
 */
export function mergeScheduledTeams(
  proposed: ScheduledTeam[],
  stored: ScheduledTeam[],
  isVisible: (team: ScheduledTeam) => boolean,
): ScheduleTeamMergeResult {
  const proposedByKey = new Map(proposed.map(team => [team.key, team]));
  const storedKeys = new Set(stored.map(team => team.key));
  const merged: ScheduledTeam[] = [];

  for (const team of stored) {
    if (!isVisible(team)) {
      if (proposedByKey.has(team.key)) return { conflictKey: team.key, merged };
      merged.push(team);
      continue;
    }
    const replacement = proposedByKey.get(team.key);
    if (replacement) merged.push(replacement); // own team kept (possibly edited)
    // own team absent from the payload: removed by its editor
  }

  for (const team of proposed) {
    if (!storedKeys.has(team.key)) merged.push(team);
  }

  return { conflictKey: null, merged };
}
