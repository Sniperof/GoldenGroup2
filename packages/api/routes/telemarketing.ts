import { Router } from 'express';
import pool from '../db.js';
import { requirePermission } from '../middleware/permission.js';
import { getPlanningMarketingTargets } from '../services/planningMarketingTargets.js';
import {
  getCurrentEmployeeId,
  getCurrentEmployeeRole,
  getSystemRoleName,
  loadDaySchedule,
  getTeamFromSchedule,
  getTeamTelemarketerAccessEmployeeIds,
  isEmployeeSupervisorInTeam,
  canAccessTaskList,
  canGenerateForTeam,
  BRANCH_LEVEL_ACCESS_ROLES,
} from '../services/telemarketingScope.js';
import {
  CLOSES_TARGET_OUTCOMES,
  normaliseOutcomeCode,
  TelemarketingOutcomeCode,
} from '@golden-crm/shared';
import {
  buildCustomerOwnershipSelectColumns,
  buildCustomerOwnershipSql,
  mapCustomerOwnership,
} from '../services/customerOwnership.js';

const router = Router();

function getBranchId(req: any): number | null {
  const branchId = req.authContext?.actingBranchId;
  return Number.isInteger(branchId) && branchId > 0 ? branchId : null;
}

function getCallerId(req: any): number | null {
  const userId = req.authContext?.userId;
  return Number.isInteger(userId) && userId > 0 ? userId : null;
}

function isSuperAdminOrGlobal(req: any): boolean {
  if (req.authContext?.isSuperAdmin) return true;
  const grants: any[] = req.authContext?.grants || [];
  return grants.some((g: any) => g.permission === 'telemarketing.lists.view' && g.scope === 'GLOBAL');
}

function getLeadName(lead: any): string {
  return lead.name || [lead.firstName, lead.fatherName, lead.lastName].filter(Boolean).join(' ') || `#${lead.id}`;
}

function getLeadPhone(lead: any): string {
  const contacts = Array.isArray(lead.contacts) ? lead.contacts : [];
  const primary = contacts.find((contact: any) => contact?.isPrimary && contact?.number);
  const firstNumber = contacts.find((contact: any) => contact?.number);
  return primary?.number || lead.mobile || firstNumber?.number || '--';
}

function getLeadGeoUnitId(lead: any): number | null {
  const parsed = Number(lead.neighborhood);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

type MarketingVisitTeamSnapshot = {
  supervisorEmployeeId?: number | null;
  technicianEmployeeId?: number | null;
  traineeEmployeeId?: number | null;
  telemarketerEmployeeIds?: number[];
};

function getTeamSnapshotForVisit(
  schedule: { teams: any[]; solos: any[] } | null,
  teamKey: string,
): {
  supervisorEmployeeId: number | null;
  technicianEmployeeId: number | null;
  traineeEmployeeId: number | null;
  teamSnapshot: MarketingVisitTeamSnapshot | null;
} {
  if (!schedule) {
    return {
      supervisorEmployeeId: null,
      technicianEmployeeId: null,
      traineeEmployeeId: null,
      teamSnapshot: null,
    };
  }

  const teamMatch = teamKey.match(/^team_(\d+)$/);
  if (teamMatch) {
    const index = Number(teamMatch[1]);
    const team = schedule.teams[index];
    if (!team) {
      return {
        supervisorEmployeeId: null,
        technicianEmployeeId: null,
        traineeEmployeeId: null,
        teamSnapshot: null,
      };
    }

    return {
      supervisorEmployeeId: Number.isInteger(team.supervisor) ? team.supervisor : null,
      technicianEmployeeId: Number.isInteger(team.technician) ? team.technician : null,
      traineeEmployeeId: Number.isInteger(team.trainee) ? team.trainee : null,
      teamSnapshot: {
        supervisorEmployeeId: Number.isInteger(team.supervisor) ? team.supervisor : null,
        technicianEmployeeId: Number.isInteger(team.technician) ? team.technician : null,
        traineeEmployeeId: Number.isInteger(team.trainee) ? team.trainee : null,
        telemarketerEmployeeIds: Array.isArray(team.telemarketers)
          ? team.telemarketers.filter((value: any) => Number.isInteger(value))
          : [],
      },
    };
  }

  const soloMatch = teamKey.match(/^solo_(\d+)$/);
  if (soloMatch) {
    const index = Number(soloMatch[1]);
    const solo = schedule.solos[index];
    if (!solo) {
      return {
        supervisorEmployeeId: null,
        technicianEmployeeId: null,
        traineeEmployeeId: null,
        teamSnapshot: null,
      };
    }

    return {
      supervisorEmployeeId: null,
      technicianEmployeeId: Number.isInteger(solo.technician) ? solo.technician : null,
      traineeEmployeeId: Number.isInteger(solo.trainee) ? solo.trainee : null,
      teamSnapshot: {
        technicianEmployeeId: Number.isInteger(solo.technician) ? solo.technician : null,
        traineeEmployeeId: Number.isInteger(solo.trainee) ? solo.trainee : null,
        telemarketerEmployeeIds: Array.isArray(solo.telemarketers)
          ? solo.telemarketers.filter((v: any) => Number.isInteger(v))
          : [],
      },
    };
  }

  return {
    supervisorEmployeeId: null,
    technicianEmployeeId: null,
    traineeEmployeeId: null,
    teamSnapshot: null,
  };
}

async function resolveOrCreateContactTarget(
  client: any,
  lead: any,
  branchId: number,
  supervisorHrUserId: number | null,
): Promise<number | null> {
  const contactTargetId = Number(lead.contactTargetId);
  if (Number.isInteger(contactTargetId) && contactTargetId > 0) {
    return contactTargetId;
  }

  const entityId = Number(lead.id);
  if (!Number.isInteger(entityId) || entityId <= 0) return null;

  const geoUnitId = getLeadGeoUnitId(lead);

  try {
    const { rows } = await client.query(
      `
      INSERT INTO contact_targets (
        branch_id, target_type, target_id, target_stage, visit_type,
        source_type, source_id, supervisor_hr_user_id, zone_id, status
      )
      VALUES ($1, 'client', $2, 'lead', 'marketing', 'lead', $2, $3, $4, 'new')
      ON CONFLICT (branch_id, target_type, target_id, visit_type, source_type)
      DO UPDATE SET
        supervisor_hr_user_id = EXCLUDED.supervisor_hr_user_id,
        zone_id = EXCLUDED.zone_id,
        source_id = EXCLUDED.source_id,
        updated_at = NOW()
      RETURNING id
      `,
      [branchId, entityId, supervisorHrUserId || null, geoUnitId],
    );
    return rows[0]?.id ?? null;
  } catch {
    return null;
  }
}

async function resolveContactTargetFromItem(
  db: any,
  taskListId: string | undefined,
  taskListItemId: string | undefined,
): Promise<number | null> {
  if (!taskListId || !taskListItemId) return null;

  const { rows } = await db.query(
    `SELECT contact_target_id FROM telemarketing_task_list_items WHERE task_list_id = $1 AND id = $2`,
    [taskListId, taskListItemId],
  );

  const ctId = rows[0]?.contact_target_id;
  if (ctId != null) return ctId;
  return null;
}

async function loadTaskListItem(
  db: any,
  taskListId: string,
  taskListItemId: string,
): Promise<any | null> {
  const { rows } = await db.query(
    `
      SELECT
        id,
        task_list_id,
        entity_type,
        entity_id,
        contact_target_id,
        open_task_id
      FROM telemarketing_task_list_items
      WHERE task_list_id = $1
        AND id = $2
      LIMIT 1
    `,
    [taskListId, taskListItemId],
  );
  return rows[0] ?? null;
}

async function updateContactTargetLifecycle(
  db: any,
  contactTargetId: number | null,
  updates: {
    latestTaskListItemId?: string;
    latestCallOutcome?: string;
    status?: string;
    latestAppointmentId?: string;
  },
): Promise<void> {
  if (contactTargetId == null) return;

  const setClauses: string[] = ['updated_at = NOW()'];
  const params: any[] = [];
  let paramIdx = 1;

  if (updates.latestTaskListItemId !== undefined) {
    setClauses.push(`latest_task_list_item_id = $${paramIdx++}`);
    params.push(updates.latestTaskListItemId);
  }
  if (updates.latestCallOutcome !== undefined) {
    setClauses.push(`latest_call_outcome = $${paramIdx++}`);
    params.push(updates.latestCallOutcome);
  }
  if (updates.status !== undefined) {
    setClauses.push(`status = $${paramIdx++}`);
    params.push(updates.status);
  }
  if (updates.latestAppointmentId !== undefined) {
    setClauses.push(`latest_appointment_id = $${paramIdx++}`);
    params.push(updates.latestAppointmentId);
  }

  params.push(contactTargetId);
  await db.query(
    `UPDATE contact_targets SET ${setClauses.join(', ')} WHERE id = $${paramIdx}`,
    params,
  );
}

// One entry per task the user explicitly selected for this appointment.
type SelectedTask = { openTaskId: number | null; taskType: string };

async function createMarketingVisitForAppointment(
  db: any,
  params: {
    appointmentId: string;
    branchId: number | null;
    entityType: 'candidate' | 'client';
    entityId: number;
    customerName: string;
    customerAddress: string | null;
    customerMobile: string | null;
    teamKey: string;
    date: string;
    timeSlot: string;
    waterSource: string | null;
    technicianNotes: string | null;
    requestedDeviceModelId: number | null;
    requestedDeviceName: string | null;
    contactTargetId: number | null;
    taskListId: string;
    taskListItemId: string;
    createdBy: number | null;
    selectedTasks: SelectedTask[];
  },
): Promise<string | null> {
  if (params.entityType !== 'client') {
    return null;
  }

  if (params.branchId == null) {
    return null;
  }

  const schedule = await loadDaySchedule(params.date);
  const teamContext = getTeamSnapshotForVisit(schedule, params.teamKey);
  const visitId = `mv_${params.appointmentId}`;

  const { rows: visitRows } = await db.query(
    `
      INSERT INTO marketing_visits (
        id,
        branch_id,
        client_id,
        visit_type,
        status,
        scheduled_date,
        scheduled_time,
        source_type,
        source_id,
        contact_target_id,
        task_list_id,
        task_list_item_id,
        team_key,
        requested_device_model_id,
        requested_device_name,
        water_source,
        technician_notes,
        customer_name,
        customer_address,
        customer_mobile,
        supervisor_employee_id,
        technician_employee_id,
        trainee_employee_id,
        team_snapshot,
        created_by
      )
      VALUES (
        $1,$2,$3,'marketing','scheduled',$4,$5,'telemarketing_appointment',$6,$7,$8,$9,$10,
        $11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22
      )
      ON CONFLICT (source_type, source_id)
      DO UPDATE SET source_id = EXCLUDED.source_id
      RETURNING id
    `,
    [
      visitId,
      params.branchId,
      params.entityId,
      params.date,
      params.timeSlot,
      params.appointmentId,
      params.contactTargetId,
      params.taskListId,
      params.taskListItemId,
      params.teamKey,
      params.requestedDeviceModelId,
      params.requestedDeviceName,
      params.waterSource,
      params.technicianNotes,
      params.customerName,
      params.customerAddress,
      params.customerMobile,
      teamContext.supervisorEmployeeId,
      teamContext.technicianEmployeeId,
      teamContext.traineeEmployeeId,
      teamContext.teamSnapshot ? JSON.stringify(teamContext.teamSnapshot) : null,
      params.createdBy,
    ],
  );

  const marketingVisitId = visitRows[0]?.id ?? null;
  if (!marketingVisitId) {
    return null;
  }

  // Create one visit task per selected task — allows multi-task visits including
  // multiple tasks of the same type (e.g. two device_demo open tasks in one visit).
  for (let i = 0; i < params.selectedTasks.length; i++) {
    const task = params.selectedTasks[i];
    const taskType = task.taskType || 'device_demo';

    if (task.openTaskId != null) {
      // Identity is anchored to the open task instance — stable and collision-free
      // even when multiple tasks share the same task_type in one visit.
      const taskId = `${marketingVisitId}_ot${task.openTaskId}`;
      await db.query(
        `
          INSERT INTO marketing_visit_tasks (
            id,
            visit_id,
            task_type,
            status,
            result,
            cash_offer_amount,
            installment_amount,
            installment_months,
            closed_by_employee_id,
            result_notes,
            contract_id,
            completed_at,
            source_open_task_id
          )
          VALUES ($1,$2,$3,'pending',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,$4)
          ON CONFLICT (visit_id, source_open_task_id) WHERE source_open_task_id IS NOT NULL DO NOTHING
        `,
        [taskId, marketingVisitId, taskType, task.openTaskId],
      );
    } else {
      // Fallback for tasks without a linked open_task: stable id by type + position.
      const taskId = `${marketingVisitId}_${taskType}_${i}`;
      await db.query(
        `
          INSERT INTO marketing_visit_tasks (
            id,
            visit_id,
            task_type,
            status,
            result,
            cash_offer_amount,
            installment_amount,
            installment_months,
            closed_by_employee_id,
            result_notes,
            contract_id,
            completed_at,
            source_open_task_id
          )
          VALUES ($1,$2,$3,'pending',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL)
          ON CONFLICT (id) DO NOTHING
        `,
        [taskId, marketingVisitId, taskType],
      );
    }
  }

  return marketingVisitId;
}

/**
 * Verify that the current user can act on a task list item.
 * Returns the task list row if allowed, null otherwise.
 * Also sends 403 response if not allowed.
 *
 * Access rules (TM-4A):
 * - SYSTEM_ADMIN / GLOBAL scope: always allowed.
 * - ADMIN / BRANCH_MANAGER: allowed within their branch.
 * - TELEMARKETER: allowed only if in team.telemarketers[] for this date/teamKey.
 * - All other roles: denied.
 */
async function verifyTaskListAccess(req: any, res: any, taskListId: string): Promise<any | null> {
  const { rows } = await pool.query(
    `SELECT id, team_key, date, branch_id FROM telemarketing_task_lists WHERE id = $1`,
    [taskListId],
  );
  if (!rows[0]) {
    res.status(404).json({ message: 'قائمة المهام غير موجودة' });
    return null;
  }

  const taskList = rows[0];

  // Use canAccessTaskList for consistent scope logic
  const allowed = await canAccessTaskList(req.authContext, {
    teamKey: taskList.team_key,
    date: taskList.date,
    branchId: taskList.branch_id,
  });

  if (!allowed) {
    res.status(403).json({ message: 'غير مصرح بالوصول لقائمة المهام' });
    return null;
  }

  return taskList;
}

const mapTaskListRows = (rows: any[]) => {
  const taskLists = new Map<string, any>();

  rows.forEach((row) => {
    if (!taskLists.has(row.id)) {
      taskLists.set(row.id, {
        id: row.id,
        teamKey: row.teamKey,
        date: row.date,
        createdAt: row.createdAt,
        items: [],
      });
    }

    if (row.itemId) {
      taskLists.get(row.id).items.push({
        id: row.itemId,
        entityType: row.entityType,
        entityId: row.entityId,
        name: row.itemName,
        mobile: row.itemMobile,
        contactNumber: row.contactNumber,
        contactLabel: row.contactLabel,
        addressText: row.addressText,
        geoUnitId: row.geoUnitId,
        status: row.itemStatus,
        callOutcome: row.callOutcome,
        contactTargetId: row.contactTargetId ?? null,
        openTaskId: row.itemOpenTaskId ?? null,
        openTaskReason: row.itemOpenTaskReason ?? null,
        openTaskType: row.itemOpenTaskType ?? null,
        openTaskStatus: row.itemOpenTaskStatus ?? null,
        ownership: row.entityType === 'client' ? mapCustomerOwnership(row) : null,
      });
    }
  });

  return Array.from(taskLists.values());
};

// ─── GET /snapshot ───
// Scope: branch filter + team membership filter for telemarketers
router.get('/snapshot', requirePermission('telemarketing.lists.view'), async (req, res) => {
  const branchId = getBranchId(req);
  const dateParam = req.query.date as string | undefined;

  // Validate date if provided
  if (dateParam && !/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
  }

  // Determine accessible team keys for telemarketer scope
  const authContext = req.authContext;
  let accessibleTeamKeys: string[] | null = null; // null means all (admin/global)

  if (!isSuperAdminOrGlobal(req)) {
    // Check system role (from roles.name) for ADMIN / BRANCH_MANAGER
    const systemRole = await getSystemRoleName(authContext?.roleId ?? null);

    if (systemRole && BRANCH_LEVEL_ACCESS_ROLES.has(systemRole)) {
      // ADMIN and BRANCH_MANAGER: accessibleTeamKeys remains null (all teams in branch)
    } else {
      // Not a branch-level access role — check if they are a telemarketer
      const employeeId = await getCurrentEmployeeId(authContext?.userId);
      const employeeRole = employeeId != null ? await getCurrentEmployeeRole(authContext?.userId) : null;

      if (employeeRole === 'telemarketer' && employeeId != null) {
        // Telemarketer: can see assigned teams, or all branch telemarketing
        // fallback teams when no telemarketers are assigned.
        accessibleTeamKeys = [];
        const dateToCheck = dateParam || new Date().toISOString().split('T')[0];
        const schedule = await loadDaySchedule(dateToCheck);
        if (schedule) {
          for (let i = 0; i < schedule.teams.length; i++) {
            const team = schedule.teams[i];
            const accessIds = await getTeamTelemarketerAccessEmployeeIds(team, branchId);
            if (accessIds.includes(employeeId)) {
              accessibleTeamKeys.push(`team_${i}`);
            }
          }
        }
      } else if (employeeRole === 'supervisor' && employeeId != null) {
        accessibleTeamKeys = [];
        const dateToCheck = dateParam || new Date().toISOString().split('T')[0];
        const schedule = await loadDaySchedule(dateToCheck);
        if (schedule) {
          for (let i = 0; i < schedule.teams.length; i++) {
            const team = schedule.teams[i];
            if (isEmployeeSupervisorInTeam(employeeId, team)) {
              accessibleTeamKeys.push(`team_${i}`);
            }
          }
        }
      } else {
        // Roles like CUSTOMER_SERVICE_SUPERVISOR, TECHNICIAN, SUPERVISOR, etc.
        // are not allowed to see telemarketing task lists in TM-4A.
        return res.json({ taskLists: [], appointments: [], callLogs: [] });
      }
    }
  }

  // Build task list query with branch filter
  const taskListParams: any[] = [];
  let taskListWhere = '';
  let paramIdx = 1;

  if (branchId != null) {
    taskListWhere += ` WHERE tl.branch_id = $${paramIdx}`;
    taskListParams.push(branchId);
    paramIdx++;
  }

  if (accessibleTeamKeys !== null) {
    if (accessibleTeamKeys.length === 0) {
      // Telemarketer with no teams: return nothing
      return res.json({ taskLists: [], appointments: [], callLogs: [] });
    }
    const teamKeyClause = accessibleTeamKeys.map(() => `$${paramIdx++}`).join(', ');
    taskListWhere += taskListWhere ? ' AND' : ' WHERE';
    taskListWhere += ` tl.team_key IN (${teamKeyClause})`;
    taskListParams.push(...accessibleTeamKeys);
  }

  if (dateParam) {
    taskListWhere += taskListWhere ? ' AND' : ' WHERE';
    taskListWhere += ` tl.date = $${paramIdx}`;
    taskListParams.push(dateParam);
    paramIdx++;
  }

  const taskListRes = await pool.query(
    `
      SELECT
        tl.id,
        tl.team_key AS "teamKey",
        tl.date,
        tl.created_at AS "createdAt",
        tl.branch_id AS "branchId",
        i.id AS "itemId",
        i.entity_type AS "entityType",
        i.entity_id AS "entityId",
        i.name AS "itemName",
        i.mobile AS "itemMobile",
        i.contact_number AS "contactNumber",
        i.contact_label AS "contactLabel",
        i.address_text AS "addressText",
        i.geo_unit_id AS "geoUnitId",
        i.status AS "itemStatus",
        i.call_outcome AS "callOutcome",
        i.contact_target_id AS "contactTargetId",
        ot.id AS "itemOpenTaskId",
        ot.reason AS "itemOpenTaskReason",
        ot.task_type AS "itemOpenTaskType",
        ot.status AS "itemOpenTaskStatus",
        ${buildCustomerOwnershipSelectColumns()}
      FROM telemarketing_task_lists tl
      LEFT JOIN telemarketing_task_list_items i ON i.task_list_id = tl.id
      LEFT JOIN open_tasks ot ON ot.id = i.open_task_id
      LEFT JOIN clients c ON i.entity_type = 'client' AND c.id = i.entity_id
      LEFT JOIN branches b ON b.id = c.branch_id
      ${buildCustomerOwnershipSql({ clientAlias: 'c', branchNameExpression: 'b.name' })}
      ${taskListWhere}
      ORDER BY tl.date DESC, tl.created_at DESC, i.id
    `,
    taskListParams,
  );

  // Filter appointments by branch and accessible teams
  const appointmentParams: any[] = [];
  let appointmentWhere = '';
  let apParamIdx = 1;

  if (branchId != null) {
    appointmentWhere += ` WHERE branch_id = $${apParamIdx}`;
    appointmentParams.push(branchId);
    apParamIdx++;
  }

  if (dateParam) {
    appointmentWhere += appointmentWhere ? ' AND' : ' WHERE';
    appointmentWhere += ` date = $${apParamIdx}`;
    appointmentParams.push(dateParam);
    apParamIdx++;
  }

  if (accessibleTeamKeys !== null && accessibleTeamKeys.length > 0) {
    const teamKeyClause = accessibleTeamKeys.map(() => `$${apParamIdx++}`).join(', ');
    appointmentWhere += appointmentWhere ? ' AND' : ' WHERE';
    appointmentWhere += ` team_key IN (${teamKeyClause})`;
    appointmentParams.push(...accessibleTeamKeys);
  }

  const appointmentsRes = await pool.query(
    `
      SELECT
        id,
        entity_type AS "entityType",
        entity_id AS "entityId",
        customer_name AS "customerName",
        customer_address AS "customerAddress",
        customer_mobile AS "customerMobile",
        team_key AS "teamKey",
        date,
        time_slot AS "timeSlot",
        occupation,
        water_source AS "waterSource",
        notes,
        visit_tasks AS "visitTasks",
        requested_device_model_id AS "requestedDeviceModelId",
        requested_device_name AS "requestedDeviceName",
        created_at AS "createdAt",
        created_by AS "createdBy",
        contact_target_id AS "contactTargetId",
        open_task_id AS "openTaskId"
      FROM telemarketing_appointments
      ${appointmentWhere}
      ORDER BY created_at DESC
    `,
    appointmentParams,
  );

  // Filter call logs by branch and date-scoped task lists
  // Instead of filtering only by branch+team_key (which returns logs from all dates),
  // join through task_list_id to only include logs belonging to task lists for the selected date.
  const callLogParams: any[] = [];
  let callLogWhere = '';
  let clParamIdx = 1;

  if (dateParam) {
    // Scope call logs to task lists that belong to the selected date
    // This avoids returning logs from other dates that share the same branch/team_key
    const dateTaskListRes = await pool.query(
      `SELECT id FROM telemarketing_task_lists WHERE date = $1 AND branch_id = $2`,
      [dateParam, branchId],
    );
    const dateTaskListIds = dateTaskListRes.rows.map((r: any) => r.id);

    if (accessibleTeamKeys !== null) {
      // Further filter by accessible team keys
      const accessibleTaskListRes = await pool.query(
        `SELECT id FROM telemarketing_task_lists WHERE date = $1 AND branch_id = $2 AND team_key = ANY($3::varchar[])`,
        [dateParam, branchId, accessibleTeamKeys],
      );
      const accessibleIds = accessibleTaskListRes.rows.map((r: any) => r.id);
      if (accessibleIds.length === 0) {
        // No accessible task lists for this date — return no call logs
        return res.json({
          taskLists: mapTaskListRows(taskListRes.rows),
          appointments: appointmentsRes.rows,
          callLogs: [],
        });
      }
      callLogWhere += ` WHERE task_list_id = ANY($${clParamIdx++}::varchar[])`;
      callLogParams.push(accessibleIds);
    } else {
      // Admin/branch manager scope — all task lists for this branch+date
      if (dateTaskListIds.length === 0) {
        return res.json({
          taskLists: mapTaskListRows(taskListRes.rows),
          appointments: appointmentsRes.rows,
          callLogs: [],
        });
      }
      callLogWhere += ` WHERE task_list_id = ANY($${clParamIdx++}::varchar[])`;
      callLogParams.push(dateTaskListIds);
    }
  } else {
    // No date filter — use branch+team_key as before (legacy fallback)
    if (branchId != null) {
      callLogWhere += ` WHERE branch_id = $${clParamIdx}`;
      callLogParams.push(branchId);
      clParamIdx++;
    }

    if (accessibleTeamKeys !== null && accessibleTeamKeys.length > 0) {
      const teamKeyClause = accessibleTeamKeys.map(() => `$${clParamIdx++}`).join(', ');
      callLogWhere += callLogWhere ? ' AND' : ' WHERE';
      callLogWhere += ` team_key IN (${teamKeyClause})`;
      callLogParams.push(...accessibleTeamKeys);
    }
  }

  const callLogsRes = await pool.query(
    `
      SELECT
        id,
        entity_type AS "entityType",
        entity_id AS "entityId",
        task_list_id AS "taskListId",
        team_key AS "teamKey",
        outcome,
        contact_label AS "contactLabel",
        contact_number AS "contactNumber",
        notes,
        timestamp,
        called_by AS "calledBy",
        communication_method AS "communicationMethod",
        contact_target_id AS "contactTargetId"
      FROM telemarketing_call_logs
      ${callLogWhere}
      ORDER BY timestamp DESC
    `,
    callLogParams,
  );

  res.json({
    taskLists: mapTaskListRows(taskListRes.rows),
    appointments: appointmentsRes.rows,
    callLogs: callLogsRes.rows,
  });
});

// LEGACY endpoint — kept for backwards compatibility only.
// WARNING: this endpoint deletes and re-inserts all items unconditionally,
// which destroys existing call_outcome and status data. It must not be used
// by any new code path. It will be removed once all callers migrate to
// generate-from-plan. contact_target_id is explicitly set to NULL because
// legacy upsert has no way to resolve contact targets.
router.post('/task-lists/upsert', requirePermission('telemarketing.lists.generate'), async (req, res) => {
  const { id, teamKey, date, createdAt, items } = req.body;
  const branchId = getBranchId(req);

  // Scope: require branch context; deny telemarketers from upserting
  if (branchId == null) {
    return res.status(400).json({ error: 'Branch context is required' });
  }

  const generateCheck = await canGenerateForTeam(req.authContext, date, teamKey);
  if (!generateCheck.allowed) {
    return res.status(403).json({ error: generateCheck.reason || 'Not authorized' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const existing = await client.query(
      `SELECT id FROM telemarketing_task_lists WHERE team_key = $1 AND date = $2 LIMIT 1`,
      [teamKey, date],
    );

    const finalTaskListId = existing.rows[0]?.id || id;

    if (existing.rows[0]) {
      await client.query(
        `UPDATE telemarketing_task_lists SET created_at = $1 WHERE id = $2`,
        [createdAt || new Date().toISOString(), finalTaskListId],
      );
    } else {
      await client.query(
        `
          INSERT INTO telemarketing_task_lists (id, team_key, date, created_at)
          VALUES ($1,$2,$3,$4)
        `,
        [finalTaskListId, teamKey, date, createdAt || new Date().toISOString()],
      );
    }

    await client.query('DELETE FROM telemarketing_task_list_items WHERE task_list_id = $1', [finalTaskListId]);

    for (const item of items || []) {
      await client.query(
        `
          INSERT INTO telemarketing_task_list_items (
            id, task_list_id, entity_type, entity_id, name, mobile, contact_number,
            contact_label, address_text, geo_unit_id, status, call_outcome, contact_target_id
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NULL)
        `,
        [
          item.id,
          finalTaskListId,
          item.entityType,
          item.entityId,
          item.name,
          item.mobile,
          item.contactNumber || null,
          item.contactLabel || null,
          item.addressText || null,
          item.geoUnitId || null,
          item.status || 'pending',
          item.callOutcome || null,
        ],
      );
    }

    await client.query('COMMIT');
    res.json({ id: finalTaskListId, teamKey, date, createdAt: createdAt || new Date().toISOString(), items: items || [] });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
});

router.post('/task-lists/generate-from-plan', requirePermission('telemarketing.lists.generate'), async (req, res) => {
  const { date, teamKey } = req.body || {};
  const branchId = getBranchId(req);

  if (branchId == null) {
    return res.status(400).json({ error: 'A branch context is required' });
  }

  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
  }

  if (typeof teamKey !== 'string' || !/^(team|solo)_\d+$/.test(teamKey)) {
    return res.status(400).json({ error: 'teamKey must be team_X or solo_X' });
  }

  // Scope: telemarketers cannot generate task lists
  const generateCheck = await canGenerateForTeam(req.authContext, date, teamKey);
  if (!generateCheck.allowed) {
    return res.status(403).json({ error: generateCheck.reason || 'Not authorized to generate task lists' });
  }

  const targets = await getPlanningMarketingTargets({ date, teamKey, branchId });
  const leads = targets.leads;
  const supervisorHrUserId = targets.supervisorHrUserId ?? null;
  const skipped: { entityType: 'client'; entityId: number; reason: string; existingTeamKey?: string }[] = [];

  const pgClient = await pool.connect();

  try {
    await pgClient.query('BEGIN');

    const leadIds = leads.map((lead: any) => Number(lead.id)).filter((id: number) => Number.isInteger(id));

    const existingElsewhereByEntityId = leadIds.length > 0
      ? await pgClient.query(
        `
          SELECT
            i.entity_id AS "entityId",
            tl.team_key AS "teamKey",
            i.contact_target_id AS "contactTargetId"
          FROM telemarketing_task_list_items i
          JOIN telemarketing_task_lists tl ON tl.id = i.task_list_id
          WHERE tl.date = $1
            AND tl.branch_id = $2
            AND tl.team_key <> $3
            AND i.entity_type = 'client'
            AND i.entity_id = ANY($4::int[])
        `,
        [date, branchId, teamKey, leadIds],
      )
      : { rows: [] };

    const queuedElsewhereByEntityId = new Map<number, string>();
    existingElsewhereByEntityId.rows.forEach((row: any) => {
      queuedElsewhereByEntityId.set(Number(row.entityId), row.teamKey);
    });

    const leadContactTargetIds = leads
      .map((lead: any) => Number(lead.contactTargetId))
      .filter((id: number) => Number.isInteger(id) && id > 0);

    if (leadContactTargetIds.length > 0) {
      const { rows: ctRows } = await pgClient.query(
        `
          SELECT
            i.contact_target_id AS "contactTargetId",
            i.entity_id AS "entityId",
            tl.team_key AS "teamKey"
          FROM telemarketing_task_list_items i
          JOIN telemarketing_task_lists tl ON tl.id = i.task_list_id
          WHERE tl.date = $1
            AND tl.branch_id = $2
            AND tl.team_key <> $3
            AND i.contact_target_id = ANY($4::int[])
        `,
        [date, branchId, teamKey, leadContactTargetIds],
      );
      ctRows.forEach((row: any) => {
        if (!queuedElsewhereByEntityId.has(Number(row.entityId))) {
          queuedElsewhereByEntityId.set(Number(row.entityId), row.teamKey);
        }
      });
    }

    const eligibleLeads = leads.filter((lead: any) => {
      const entityId = Number(lead.id);
      const existingTeamKey = queuedElsewhereByEntityId.get(entityId);
      if (!existingTeamKey) return true;
      skipped.push({
        entityType: 'client',
        entityId,
        reason: 'already_queued_today',
        existingTeamKey,
      });
      return false;
    });

    const existingList = await pgClient.query(
      `SELECT id, created_at AS "createdAt" FROM telemarketing_task_lists WHERE team_key = $1 AND date = $2 LIMIT 1`,
      [teamKey, date],
    );

    const taskListId = existingList.rows[0]?.id || `tm_${date}_${teamKey}`;
    const createdAt = existingList.rows[0]?.createdAt || new Date().toISOString();

    if (existingList.rows[0]) {
      await pgClient.query(
        `UPDATE telemarketing_task_lists SET branch_id = $1 WHERE id = $2`,
        [branchId, taskListId],
      );
    } else {
      await pgClient.query(
        `
          INSERT INTO telemarketing_task_lists (id, team_key, date, created_at, branch_id)
          VALUES ($1,$2,$3,$4,$5)
        `,
        [taskListId, teamKey, date, createdAt, branchId],
      );
    }

    const existingItems = await pgClient.query(
      `
        SELECT
          id,
          entity_id AS "entityId",
          status,
          call_outcome AS "callOutcome",
          contact_target_id AS "contactTargetId"
        FROM telemarketing_task_list_items
        WHERE task_list_id = $1
          AND entity_type = 'client'
      `,
      [taskListId],
    );

    const existingByEntityId = new Map<number, any>();
    existingItems.rows.forEach((item: any) => {
      existingByEntityId.set(Number(item.entityId), item);
    });

    let added = 0;
    let updated = 0;
    const lifecycleUpdates: { contactTargetId: number; itemId: string }[] = [];

    for (const lead of eligibleLeads) {
      const entityId = Number(lead.id);
      const existingItem = existingByEntityId.get(entityId);
      const itemId = existingItem?.id || `${taskListId}_client_${entityId}`;
      const name = getLeadName(lead);
      const phone = getLeadPhone(lead);
      const geoUnitId = getLeadGeoUnitId(lead);
      const addressText = lead.detailedAddress || lead.referralAddressText || null;

      let contactTargetId = await resolveOrCreateContactTarget(pgClient, lead, branchId, supervisorHrUserId);

      if (contactTargetId == null) {
        skipped.push({
          entityType: 'client',
          entityId,
          reason: 'no_contact_target',
        });
        continue;
      }

      const openTaskId = lead.openTaskId ?? null;

      if (existingItem) {
        await pgClient.query(
          `
            UPDATE telemarketing_task_list_items
            SET
              name = $1,
              mobile = $2,
              contact_number = $3,
              contact_label = $4,
              address_text = $5,
              geo_unit_id = $6,
              contact_target_id = $7,
              open_task_id = $8
            WHERE id = $9
          `,
          [name, phone, phone, 'primary', addressText, geoUnitId, contactTargetId, openTaskId, itemId],
        );
        updated += 1;
      } else {
        await pgClient.query(
          `
            INSERT INTO telemarketing_task_list_items (
              id, task_list_id, entity_type, entity_id, name, mobile, contact_number,
              contact_label, address_text, geo_unit_id, status, call_outcome, contact_target_id, open_task_id
            )
            VALUES ($1,$2,'client',$3,$4,$5,$6,$7,$8,$9,'pending',NULL,$10,$11)
          `,
          [itemId, taskListId, entityId, name, phone, phone, 'primary', addressText, geoUnitId, contactTargetId, openTaskId],
        );
        added += 1;
      }

      if (openTaskId != null) {
        const tlUpdateResult = await pgClient.query(
          `UPDATE open_tasks SET status = 'in_contact_list', updated_at = NOW() WHERE id = $1 AND status = 'open'`,
          [openTaskId],
        );
        if ((tlUpdateResult as any).rowCount > 0) {
          await pgClient.query(
            `INSERT INTO task_activity_log (task_id, event_type, performed_by, role, old_value, new_value)
             VALUES ($1, 'status_change', $2, NULL, 'open', 'in_contact_list')`,
            [openTaskId, req.authContext?.userId ?? null],
          );
        }
      }

      lifecycleUpdates.push({ contactTargetId, itemId });
    }

    if (lifecycleUpdates.length > 0) {
      const ctIds = lifecycleUpdates.map(u => u.contactTargetId);
      await pgClient.query(
        `
          UPDATE contact_targets
          SET status = CASE WHEN status = 'new' THEN 'queued' ELSE status END,
              updated_at = NOW()
          WHERE id = ANY($1::int[])
        `,
        [ctIds],
      );

      for (const { contactTargetId, itemId } of lifecycleUpdates) {
        await pgClient.query(
          `
            UPDATE contact_targets
            SET latest_task_list_item_id = $1,
                updated_at = NOW()
            WHERE id = $2
          `,
          [itemId, contactTargetId],
        );
      }
    }

    await pgClient.query('COMMIT');

    return res.json({
      taskList: {
        id: taskListId,
        teamKey,
        date,
        createdAt,
      },
      counts: {
        totalTargets: leads.length,
        eligible: eligibleLeads.length,
        added,
        updated,
        skipped: skipped.length,
      },
      skipped,
      reason: targets.reason,
    });
  } catch (error) {
    await pgClient.query('ROLLBACK');
    throw error;
  } finally {
    pgClient.release();
  }
});

// ─── PATCH task list item ───
// Scope: verify user can act on this item's task list
router.patch(
  '/task-lists/:taskListId/items/:itemId',
  requirePermission('telemarketing.calls.create'),
  async (req, res) => {
    const { status, callOutcome } = req.body;

    // Verify access to the task list
    const taskList = await verifyTaskListAccess(req, res, String(req.params.taskListId));
    if (!taskList) return; // verifyTaskListAccess already sent 403/404

    const { rows } = await pool.query(
      `
        UPDATE telemarketing_task_list_items
        SET status = $1, call_outcome = $2
        WHERE task_list_id = $3 AND id = $4
        RETURNING
          id,
          task_list_id AS "taskListId",
          entity_type AS "entityType",
          entity_id AS "entityId",
          name,
          mobile,
          contact_number AS "contactNumber",
          contact_label AS "contactLabel",
          address_text AS "addressText",
          geo_unit_id AS "geoUnitId",
          status,
          call_outcome AS "callOutcome",
          contact_target_id AS "contactTargetId"
      `,
      [status, callOutcome || null, req.params.taskListId, req.params.itemId],
    );

    if (!rows[0]) {
      res.status(404).json({ message: 'عنصر القائمة غير موجود' });
      return;
    }

    res.json(rows[0]);
  },
);

// ─── POST /call-logs ───
// Scope: verify branch + team membership for telemarketers
router.post('/call-logs', requirePermission('telemarketing.calls.create'), async (req, res) => {
  const log = req.body;

  const calledBy = getCallerId(req);
  const branchId = getBranchId(req);

  if (!log.taskListId || !log.taskListItemId) {
    return res.status(400).json({
      error: 'taskListId and taskListItemId are required for telemarketing call logs',
    });
  }

  // Scope check: if taskListId provided, verify access to the parent task list
  if (log.taskListId) {
    const taskList = await verifyTaskListAccess(req, res, log.taskListId);
    if (!taskList) return; // already sent 403

    // Verify branch matches
    if (branchId != null && taskList.branch_id != null && taskList.branch_id !== branchId) {
      return res.status(403).json({ message: 'غير مصرح بتسجيل اتصال لفرع آخر' });
    }
  } else if (!isSuperAdminOrGlobal(req) && branchId == null) {
    // Non-global user without branch context and without taskListId
    return res.status(400).json({ error: 'Branch context or taskListId is required' });
  }

  // Derive contact_target_id from the task list item if taskListItemId is provided.
  let contactTargetId: number | null = null;

  if (log.taskListItemId && log.taskListId) {
    contactTargetId = await resolveContactTargetFromItem(pool, log.taskListId, log.taskListItemId);
  }

  const taskListItem = await loadTaskListItem(pool, log.taskListId, log.taskListItemId);
  if (!taskListItem) {
    return res.status(404).json({ message: 'عنصر القائمة غير موجود' });
  }
  contactTargetId = taskListItem.contact_target_id ?? null;

  const { rows } = await pool.query(
    `
      INSERT INTO telemarketing_call_logs (
        id, entity_type, entity_id, task_list_id, team_key, outcome,
        contact_label, contact_number, notes, timestamp, called_by,
        communication_method, branch_id, contact_target_id
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      RETURNING
        id,
        entity_type AS "entityType",
        entity_id AS "entityId",
        task_list_id AS "taskListId",
        team_key AS "teamKey",
        outcome,
        contact_label AS "contactLabel",
        contact_number AS "contactNumber",
        notes,
        timestamp,
        called_by AS "calledBy",
        communication_method AS "communicationMethod",
        contact_target_id AS "contactTargetId"
    `,
    [
      log.id,
      taskListItem.entity_type,
      taskListItem.entity_id,
      log.taskListId,
      log.teamKey,
      log.outcome,
      log.contactLabel || null,
      log.contactNumber || null,
      log.notes || '',
      log.timestamp || new Date().toISOString(),
      calledBy,
      log.communicationMethod || null,
      branchId,
      contactTargetId,
    ],
  );

  // Update contact_targets lifecycle based on call outcome
  if (contactTargetId != null) {
    const outcome: string = log.outcome;

    // Normalise legacy codes for lifecycle decisions
    const normalised = normaliseOutcomeCode(outcome);

    // Close outcomes: set status = closed
    if (CLOSES_TARGET_OUTCOMES.includes(normalised)) {
      await updateContactTargetLifecycle(pool, contactTargetId, {
        latestCallOutcome: outcome,
        status: 'closed',
      });
    } else if (normalised === 'booked_marketing_appointment') {
      // Booked: update latest_call_outcome but do NOT set status = booked here.
      // Appointment creation handles the status transition to booked.
      await updateContactTargetLifecycle(pool, contactTargetId, {
        latestCallOutcome: outcome,
      });
    } else {
      // All other outcomes (retry, follow-up, phone-quality): keep target active/contacted
      await pool.query(
        `
          UPDATE contact_targets
          SET latest_call_outcome = $1,
              status = CASE
                WHEN status IN ('new', 'queued', 'in_call_list') THEN 'contacted'
                ELSE status
              END,
              updated_at = NOW()
          WHERE id = $2
        `,
        [outcome, contactTargetId],
      );
    }
  }

  res.json(rows[0]);
});

// ─── POST /appointments ───
// Scope: verify branch + team membership for telemarketers
router.post('/appointments', requirePermission('telemarketing.appointments.book'), async (req, res) => {
  const appointment = req.body;

  const createdBy = getCallerId(req);
  const branchId = getBranchId(req);

  if (!appointment.taskListId || !appointment.taskListItemId) {
    return res.status(400).json({
      error: 'taskListId and taskListItemId are required for telemarketing appointments',
    });
  }

  // Scope check: if taskListId provided, verify access to the parent task list
  if (appointment.taskListId) {
    const taskList = await verifyTaskListAccess(req, res, appointment.taskListId);
    if (!taskList) return;

    if (branchId != null && taskList.branch_id != null && taskList.branch_id !== branchId) {
      return res.status(403).json({ message: 'غير مصرح بإنشاء موعد لفرع آخر' });
    }
  } else if (!isSuperAdminOrGlobal(req) && branchId == null) {
    return res.status(400).json({ error: 'Branch context or taskListId is required' });
  }

  // Derive contact_target_id from the task list item if taskListItemId is provided.
  let contactTargetId: number | null = null;

  if (appointment.taskListItemId && appointment.taskListId) {
    contactTargetId = await resolveContactTargetFromItem(pool, appointment.taskListId, appointment.taskListItemId);
  }

  const taskListItem = await loadTaskListItem(pool, appointment.taskListId, appointment.taskListItemId);
  if (!taskListItem) {
    return res.status(404).json({ message: 'عنصر القائمة غير موجود' });
  }
  contactTargetId = taskListItem.contact_target_id ?? null;

  // Appointment conflict check scoped to branch
  const conflictParams: any[] = [appointment.teamKey, appointment.date, appointment.timeSlot];
  let conflictQuery = `SELECT id FROM telemarketing_appointments WHERE team_key = $1 AND date = $2 AND time_slot = $3`;
  if (branchId != null) {
    conflictQuery += ` AND branch_id = $4`;
    conflictParams.push(branchId);
  }
  conflictQuery += ` LIMIT 1`;

  const conflict = await pool.query(conflictQuery, conflictParams);

  if (conflict.rows[0]) {
    res.status(409).json({ message: 'هذا الموعد محجوز مسبقاً للفريق في نفس الوقت.' });
    return;
  }

  // selectedOpenTasks: explicit multi-task booking payload from the frontend.
  // Each entry names a task list item + its linked open task + the task type.
  // Falls back to the single legacy open_task_id when not provided.
  const rawSelectedTasks: Array<{ openTaskId: number | null; taskType: string; taskListItemId: string }> =
    Array.isArray(appointment.selectedOpenTasks) && appointment.selectedOpenTasks.length > 0
      ? appointment.selectedOpenTasks
      : [{ openTaskId: taskListItem.open_task_id ?? null, taskType: 'device_demo', taskListItemId: appointment.taskListItemId }];

  // Primary open task is the first in the list (used for the appointment record's open_task_id).
  const primaryOpenTaskId: number | null = rawSelectedTasks[0]?.openTaskId ?? null;

  const pgClient = await pool.connect();

  try {
    await pgClient.query('BEGIN');

    const visitTaskTypes = rawSelectedTasks.map(t => t.taskType || 'device_demo');

    const { rows } = await pgClient.query(
      `
        INSERT INTO telemarketing_appointments (
          id, entity_type, entity_id, customer_name, customer_address, customer_mobile,
          team_key, date, time_slot, occupation, water_source, notes,
          visit_tasks, requested_device_model_id, requested_device_name,
          created_at, created_by, branch_id, contact_target_id, open_task_id
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
        RETURNING
          id,
          entity_type AS "entityType",
          entity_id AS "entityId",
          customer_name AS "customerName",
          customer_address AS "customerAddress",
          customer_mobile AS "customerMobile",
          team_key AS "teamKey",
          date,
          time_slot AS "timeSlot",
          occupation,
          water_source AS "waterSource",
          notes,
          visit_tasks AS "visitTasks",
          requested_device_model_id AS "requestedDeviceModelId",
          requested_device_name AS "requestedDeviceName",
          created_at AS "createdAt",
          created_by AS "createdBy",
          contact_target_id AS "contactTargetId",
          open_task_id AS "openTaskId"
      `,
      [
        appointment.id,
        taskListItem.entity_type,
        taskListItem.entity_id,
        appointment.customerName,
        appointment.customerAddress || null,
        appointment.customerMobile || null,
        appointment.teamKey,
        appointment.date,
        appointment.timeSlot,
        appointment.occupation || '',
        appointment.waterSource || '',
        appointment.notes || '',
        JSON.stringify(visitTaskTypes),
        appointment.requestedDeviceModelId || null,
        appointment.requestedDeviceName || null,
        appointment.createdAt || new Date().toISOString(),
        createdBy,
        branchId,
        contactTargetId,
        primaryOpenTaskId,
      ],
    );

    const savedAppointment = rows[0];

    // Mark ALL selected task list items as booked.
    const allSelectedItemIds = rawSelectedTasks.map(t => t.taskListItemId).filter(Boolean);
    if (allSelectedItemIds.length > 0) {
      await pgClient.query(
        `
          UPDATE telemarketing_task_list_items
          SET status = 'booked',
              call_outcome = 'booked_marketing_appointment'
          WHERE task_list_id = $1
            AND id = ANY($2::varchar[])
        `,
        [appointment.taskListId, allSelectedItemIds],
      );
    }

    // Load schedule once for team context (used for all open_task updates).
    const bookingSchedule = await loadDaySchedule(appointment.date);
    const bookingTeamContext = getTeamSnapshotForVisit(bookingSchedule, appointment.teamKey);
    const teamSnapshotJson = bookingTeamContext.teamSnapshot
      ? JSON.stringify(bookingTeamContext.teamSnapshot)
      : null;

    // Update EACH selected open task to 'scheduled' with team snapshot.
    // Unselected tasks are not touched — they remain in their current state.
    for (const task of rawSelectedTasks) {
      if (task.openTaskId != null) {
        await pgClient.query(
          `UPDATE open_tasks
           SET status = 'scheduled',
               team_snapshot = $2::jsonb,
               updated_at = NOW()
           WHERE id = $1 AND status = 'in_contact_list'`,
          [task.openTaskId, teamSnapshotJson],
        );
      }
    }

    if (contactTargetId != null) {
      await updateContactTargetLifecycle(pgClient, contactTargetId, {
        status: 'booked',
        latestAppointmentId: savedAppointment.id,
      });
    }

    const marketingVisitId = await createMarketingVisitForAppointment(pgClient, {
      appointmentId: savedAppointment.id,
      branchId,
      entityType: taskListItem.entity_type,
      entityId: taskListItem.entity_id,
      customerName: savedAppointment.customerName,
      customerAddress: savedAppointment.customerAddress || null,
      customerMobile: savedAppointment.customerMobile || null,
      teamKey: savedAppointment.teamKey,
      date: savedAppointment.date,
      timeSlot: savedAppointment.timeSlot,
      waterSource: savedAppointment.waterSource || null,
      technicianNotes: savedAppointment.notes || null,
      requestedDeviceModelId: savedAppointment.requestedDeviceModelId ?? null,
      requestedDeviceName: savedAppointment.requestedDeviceName || null,
      contactTargetId,
      taskListId: appointment.taskListId,
      taskListItemId: appointment.taskListItemId,
      createdBy,
      selectedTasks: rawSelectedTasks,
    });

    await pgClient.query('COMMIT');

    res.json({
      ...savedAppointment,
      taskListId: appointment.taskListId,
      taskListItemId: appointment.taskListItemId,
      marketingVisitId,
    });
  } catch (error) {
    await pgClient.query('ROLLBACK');
    throw error;
  } finally {
    pgClient.release();
  }
});

export default router;
