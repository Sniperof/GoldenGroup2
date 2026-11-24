// Team capability (DEC-026 D5/D6/D7). One rule, applied identically by the
// count (#1), the assignment work scope (#2) and therefore generation (#3):
//
//   D5  a team only takes task types its team type allows;
//   D6  a team takes a grain (client + effective work location + D) only when
//       it can do EVERY eligible task of that grain; one task type outside its
//       list leaves the whole grain to a team that can do it all;
//   D7  emergency_maintenance is outside the grain in both directions: it is
//       never a blocker, and it is taken on its own by a team allowed it.
//
// Tasks already committed to this team for D (assigned / in progress / in a
// generated contact target) are kept as they are: a type edit applies to the
// next save only (DEC-026 §3).

export const SEVERABLE_TASK_TYPES: ReadonlySet<string> = new Set(['emergency_maintenance']);

export interface CapabilityFacts {
  clientId: number;
  zoneId: number | null;
  taskType: string;
  /** Already committed to this team for D: kept regardless of the rule. */
  committedToTeam: boolean;
  /** Excluded for D (curation): shown in some views, never blocks a grain. */
  excluded: boolean;
}

export interface BlockedGrain {
  clientId: number;
  zoneId: number | null;
  /** Task types in the grain the team may not take. */
  blockingTaskTypes: string[];
}

export interface CapabilityResult<T> {
  kept: T[];
  /**
   * Grains this team could partly do but left whole to a capable team (D6).
   * Grains with nothing the team may take are not listed (nothing was lost).
   */
  blockedGrains: BlockedGrain[];
}

export function grainKey(clientId: number, zoneId: number | null): string {
  return `${clientId}:${zoneId ?? 'none'}`;
}

export function applyTeamCapability<T>(
  rows: T[],
  allowedTaskTypes: readonly string[],
  facts: (row: T) => CapabilityFacts,
): CapabilityResult<T> {
  const allowed = new Set(allowedTaskTypes);
  const blockers = new Map<string, Set<string>>();

  for (const row of rows) {
    const f = facts(row);
    if (f.committedToTeam || f.excluded) continue;
    if (SEVERABLE_TASK_TYPES.has(f.taskType) || allowed.has(f.taskType)) continue;
    const key = grainKey(f.clientId, f.zoneId);
    let types = blockers.get(key);
    if (!types) blockers.set(key, (types = new Set()));
    types.add(f.taskType);
  }

  const kept: T[] = [];
  const lostGrains = new Map<string, { clientId: number; zoneId: number | null }>();
  for (const row of rows) {
    const f = facts(row);
    if (f.committedToTeam) { kept.push(row); continue; }
    if (!allowed.has(f.taskType)) continue;
    if (SEVERABLE_TASK_TYPES.has(f.taskType)) { kept.push(row); continue; }
    const key = grainKey(f.clientId, f.zoneId);
    if (blockers.has(key)) {
      lostGrains.set(key, { clientId: f.clientId, zoneId: f.zoneId });
      continue;
    }
    kept.push(row);
  }

  const blockedGrains = [...lostGrains.entries()].map(([key, grain]) => ({
    ...grain,
    blockingTaskTypes: [...blockers.get(key)!].sort(),
  }));
  return { kept, blockedGrains };
}
