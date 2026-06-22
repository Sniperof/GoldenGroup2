import { Router } from 'express';
import pool from '../db.js';
import { requirePermission } from '../middleware/permission.js';
import { getPlanningMarketingTargets, getAssignedLeadsForTeam } from '../services/planningMarketingTargets.js';
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
import { getSystemSettingNumber } from '../services/systemSettings.js';
import { bookVisit, BookingError } from '../services/visitBooking.js';
import {
  claimContactTarget,
  ContactTargetLockError,
  markContactTargetFirstContact,
} from '../services/contactTargetLocks.js';

// DEC-005 D29: outcomes that auto-activate cooldown on the client. After
// DEC-006 D39 the 4 "not interested" variants are unified into not_interested.
const AUTO_COOLDOWN_OUTCOMES = new Set<TelemarketingOutcomeCode>([
  'not_interested',
]);

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
  const parsed = Number(lead.effectiveZoneId ?? lead.workLocationGeoUnitId ?? lead.neighborhood);
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
  date: string,
  teamKey: string,
): Promise<number | null> {
  const contactTargetId = Number(lead.contactTargetId);
  if (Number.isInteger(contactTargetId) && contactTargetId > 0) {
    return contactTargetId;
  }

  const entityId = Number(lead.id);
  if (!Number.isInteger(entityId) || entityId <= 0) return null;

  const geoUnitId = getLeadGeoUnitId(lead);
  const visitType = typeof lead.contactTargetVisitType === 'string' && lead.contactTargetVisitType
    ? lead.contactTargetVisitType
    : 'marketing';

  try {
    const { rows } = await client.query(
      `
      INSERT INTO contact_targets (
        branch_id, target_type, target_id, target_stage, visit_type,
        source_type, source_id, supervisor_hr_user_id, zone_id, status,
        date, team_key, work_location_geo_unit_id
      )
      VALUES ($1, 'client', $2, 'lead', $5, 'lead', $2, $3, $4, 'new', $6::date, $7, $4)
      ON CONFLICT (branch_id, target_type, target_id, work_location_geo_unit_id, date)
      WHERE work_location_geo_unit_id IS NOT NULL
      DO UPDATE SET
        supervisor_hr_user_id = EXCLUDED.supervisor_hr_user_id,
        zone_id = EXCLUDED.zone_id,
        visit_type = EXCLUDED.visit_type,
        source_id = EXCLUDED.source_id,
        team_key = EXCLUDED.team_key,
        updated_at = NOW()
      RETURNING id
      `,
      [branchId, entityId, supervisorHrUserId || null, geoUnitId, visitType, date, teamKey],
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

/**
 * When a contact_target closes WITHOUT a booking, return all associated
 * open_tasks that are still in 'in_scheduling' back to their last_waiting_status.
 *
 * Per task-lifecycle-analysis.md §6.4 (Q11/Q12):
 *   "نتيجة الاتصال (رفض/إلغاء/خطأ) → المهمة → last_waiting_status"
 *
 * Does NOT touch tasks that were already booked (status = 'scheduled').
 * The performedBy parameter is used for activity log (pass null for auto-close).
 */
async function returnTasksToWaiting(
  db: any,
  contactTargetId: number,
  performedBy: number | null,
  eventNote: string,
): Promise<void> {
  // Find all open_tasks linked to this contact_target through task_list_items
  // that are still in 'in_scheduling' (not yet booked/scheduled).
  const { rows: taskRows } = await db.query(
    `SELECT DISTINCT ot.id, COALESCE(ot.last_waiting_status, 'open') AS restore_status
       FROM telemarketing_task_list_items tli
       JOIN open_tasks ot ON ot.id = tli.open_task_id
      WHERE tli.contact_target_id = $1
        AND ot.status = 'in_scheduling'`,
    [contactTargetId],
  );

  if (taskRows.length === 0) return;

  const taskIds = taskRows.map((r: any) => Number(r.id));

  await db.query(
    `UPDATE open_tasks
        SET status     = COALESCE(last_waiting_status, 'open'),
            updated_at = NOW()
      WHERE id = ANY($1::int[])
        AND status = 'in_scheduling'`,
    [taskIds],
  );

  // Activity log
  for (const row of taskRows) {
    await db.query(
      `INSERT INTO task_activity_log (task_id, event_type, performed_by, role, old_value, new_value, reason)
       VALUES ($1, 'status_change', $2, NULL, 'in_scheduling', $3, $4)`,
      [row.id, performedBy, row.restore_status, eventNote],
    );
  }
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
): Promise<number | null> {
  if (params.entityType !== 'client') {
    return null;
  }

  if (params.branchId == null) {
    return null;
  }

  const schedule = await loadDaySchedule(params.date);
  const teamContext = getTeamSnapshotForVisit(schedule, params.teamKey);

  const POST_SALE_TYPES = ['device_delivery', 'device_installation', 'device_activation'];
  const isPostSale = params.selectedTasks.length > 0 &&
    params.selectedTasks.every(t => POST_SALE_TYPES.includes(t.taskType));
  const visitFamily = isPostSale ? 'service' : 'marketing';

  const customerSnapshot = {
    name: params.customerName,
    address: params.customerAddress,
    mobile: params.customerMobile,
    contactTargetId: params.contactTargetId,
    taskListId: params.taskListId,
    taskListItemId: params.taskListItemId,
    teamKey: params.teamKey,
    requestedDeviceModelId: params.requestedDeviceModelId,
    requestedDeviceName: params.requestedDeviceName,
    waterSource: params.waterSource,
  };

  const { rows: visitRows } = await db.query(
    `
      INSERT INTO field_visits (
        visit_type,
        visit_family,
        branch_id,
        client_id,
        status,
        scheduled_date,
        scheduled_time,
        source_legacy_type,
        source_legacy_id,
        team_snapshot,
        customer_snapshot,
        field_notes,
        created_by
      )
      VALUES (
        'marketing', $1, $2, $3, 'scheduled', $4, $5,
        'telemarketing_appointment', $6, $7, $8, $9, $10
      )
      ON CONFLICT (source_legacy_type, source_legacy_id)
      DO UPDATE SET updated_at = NOW()
      RETURNING id
    `,
    [
      visitFamily,
      params.branchId,
      params.entityId,
      params.date,
      params.timeSlot,
      params.appointmentId,
      teamContext.teamSnapshot ? JSON.stringify(teamContext.teamSnapshot) : null,
      JSON.stringify(customerSnapshot),
      params.technicianNotes,
      params.createdBy,
    ],
  );

  const fieldVisitId: number | null = visitRows[0]?.id ?? null;
  if (!fieldVisitId) {
    return null;
  }

  // Create one visit_task per selected task — allows multi-task visits including
  // multiple tasks of the same type (e.g. two device_demo open tasks in one visit).
  for (let i = 0; i < params.selectedTasks.length; i++) {
    const task = params.selectedTasks[i];
    const taskType = task.taskType || 'device_demo';
    const taskFamily = POST_SALE_TYPES.includes(taskType) ? 'service' : 'marketing';

    if (task.openTaskId != null) {
      const legacyId = `fv${fieldVisitId}_ot${task.openTaskId}`;
      await db.query(
        `
          INSERT INTO visit_tasks (
            field_visit_id,
            source_open_task_id,
            task_type,
            task_family,
            sequence_no,
            status,
            source_legacy_type,
            source_legacy_id
          )
          VALUES ($1, $2, $3, $4, $5, 'pending', 'telemarketing_visit_task', $6)
          ON CONFLICT (source_legacy_type, source_legacy_id) DO NOTHING
        `,
        [fieldVisitId, task.openTaskId, taskType, taskFamily, i + 1, legacyId],
      );
    } else {
      const legacyId = `fv${fieldVisitId}_${taskType}_${i}`;
      await db.query(
        `
          INSERT INTO visit_tasks (
            field_visit_id,
            source_open_task_id,
            task_type,
            task_family,
            sequence_no,
            status,
            source_legacy_type,
            source_legacy_id
          )
          VALUES ($1, NULL, $2, $3, $4, 'pending', 'telemarketing_visit_task', $5)
          ON CONFLICT (source_legacy_type, source_legacy_id) DO NOTHING
        `,
        [fieldVisitId, taskType, taskFamily, i + 1, legacyId],
      );
    }
  }

  return fieldVisitId;
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
        lockedByHrUserId: row.lockedByHrUserId ?? null,
        lockedByHrUserName: row.lockedByHrUserName ?? null,
        openTaskId: row.itemOpenTaskId ?? null,
        openTaskReason: row.itemOpenTaskReason ?? null,
        openTaskType: row.itemOpenTaskType ?? null,
        openTaskStatus: row.itemOpenTaskStatus ?? null,
        openTaskExpectedDate: row.itemOpenTaskExpectedDate ?? null,
        openTaskExpectedTime: row.itemOpenTaskExpectedTime ?? null,
        ownership: row.entityType === 'client' ? mapCustomerOwnership(row) : null,
      });
    }
  });

  return Array.from(taskLists.values());
};

/**
 * @swagger
 * components:
 *   schemas:
 *     TelemarketingTaskListItem:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *         taskListId:
 *           type: string
 *         entityType:
 *           type: string
 *         entityId:
 *           type: integer
 *         name:
 *           type: string
 *         mobile:
 *           type: string
 *         contactNumber:
 *           type: string
 *         contactLabel:
 *           type: string
 *         addressText:
 *           type: string
 *         geoUnitId:
 *           type: integer
 *         status:
 *           type: string
 *         callOutcome:
 *           type: string
 *         contactTargetId:
 *           type: integer
 *     TelemarketingTaskList:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *         teamKey:
 *           type: string
 *         date:
 *           type: string
 *         createdAt:
 *           type: string
 *           format: date-time
 *         items:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/TelemarketingTaskListItem'
 */

/**
 * @swagger
 * /api/telemarketing/snapshot:
 *   get:
 *     tags: [Telemarketing]
 *     summary: Retrieve telemarketing snapshot of task lists
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: true
 *         description: Branch context ID
 *       - in: query
 *         name: date
 *         schema:
 *           type: string
 *         required: false
 *         description: Date in YYYY-MM-DD format
 *       - in: query
 *         name: branchId
 *         schema:
 *           type: integer
 *         required: false
 *         description: Filter by branch ID
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         required: false
 *         description: Search term
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *         required: false
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         required: false
 *         description: Number of items per page
 *     responses:
 *       200:
 *         description: Success
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/TelemarketingTaskList'
 *       400:
 *         description: Bad Request
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal Server Error
 */
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
        // Local calendar date (NOT UTC) — toISOString() is a day behind before the UTC offset.
        const dateToCheck = dateParam || (() => {
          const d = new Date();
          return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        })();
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
        // Local calendar date (NOT UTC) — toISOString() is a day behind before the UTC offset.
        const dateToCheck = dateParam || (() => {
          const d = new Date();
          return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        })();
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
        ct.locked_by_hr_user_id AS "lockedByHrUserId",
        lock_hu.name AS "lockedByHrUserName",
        ot.id AS "itemOpenTaskId",
        ot.reason AS "itemOpenTaskReason",
        ot.task_type AS "itemOpenTaskType",
        ot.status AS "itemOpenTaskStatus",
        ot.expected_date::text AS "itemOpenTaskExpectedDate",
        ot.expected_time AS "itemOpenTaskExpectedTime",
        ${buildCustomerOwnershipSelectColumns()}
      FROM telemarketing_task_lists tl
      LEFT JOIN telemarketing_task_list_items i ON i.task_list_id = tl.id
      LEFT JOIN open_tasks ot ON ot.id = i.open_task_id
      LEFT JOIN contact_targets ct ON ct.id = i.contact_target_id
      LEFT JOIN hr_users lock_hu ON lock_hu.id = ct.locked_by_hr_user_id
      LEFT JOIN clients c ON i.entity_type = 'client' AND c.id = i.entity_id
      LEFT JOIN branches b ON b.id = c.branch_id
      ${buildCustomerOwnershipSql({ clientAlias: 'c', branchNameExpression: 'b.name' })}
      ${taskListWhere}
      ORDER BY tl.date DESC, tl.created_at DESC, i.id
    `,
    taskListParams,
  );

  // Filter appointments by branch and accessible teams
  // Plan 2026-06-10 Phase 2.4 — legacy telemarketing_appointments query
  // removed. The snapshot now reads exclusively from field_visits (modern
  // source). Historic legacy rows were migrated in Phase 0 as 'cancelled'
  // field_visits, and the status filter below (active statuses only) keeps
  // them out of the workspace by design — they're 17+ days old and were
  // never executed.

  const fieldVisitAppointmentParams: any[] = [];
  const fieldVisitAppointmentWhere: string[] = [];
  let fvParamIdx = 1;

  if (branchId != null) {
    fieldVisitAppointmentWhere.push(`fv.branch_id = $${fvParamIdx++}`);
    fieldVisitAppointmentParams.push(branchId);
  }

  if (dateParam) {
    fieldVisitAppointmentWhere.push(`fv.scheduled_date = $${fvParamIdx++}`);
    fieldVisitAppointmentParams.push(dateParam);
  }

  if (accessibleTeamKeys !== null && accessibleTeamKeys.length > 0) {
    fieldVisitAppointmentWhere.push(`fv.team_snapshot->>'teamKey' = ANY($${fvParamIdx++}::varchar[])`);
    fieldVisitAppointmentParams.push(accessibleTeamKeys);
  }

  const fieldVisitWhere = fieldVisitAppointmentWhere.length > 0
    ? `WHERE ${fieldVisitAppointmentWhere.join(' AND ')}`
    : '';

  const fieldVisitAppointmentsRes = await pool.query(
    `
      SELECT
        ('fv_' || fv.id::text) AS id,
        'client' AS "entityType",
        fv.client_id AS "entityId",
        COALESCE(fv.customer_snapshot->>'name', c.name, '') AS "customerName",
        COALESCE(fv.customer_snapshot->>'addressText', fv.customer_snapshot->>'address', '') AS "customerAddress",
        COALESCE(fv.customer_snapshot->>'mobile', c.mobile, '') AS "customerMobile",
        fv.team_snapshot->>'teamKey' AS "teamKey",
        fv.scheduled_date::text AS date,
        substring(COALESCE(fv.scheduled_time, '') from 1 for 5) AS "timeSlot",
        COALESCE(fv.customer_snapshot->>'occupation', '') AS occupation,
        COALESCE(fv.customer_snapshot->>'waterSource', '') AS "waterSource",
        COALESCE(fv.telemarketer_notes, fv.field_notes, '') AS notes,
        COALESCE(
          json_agg(DISTINCT vt.task_type) FILTER (WHERE vt.id IS NOT NULL),
          '[]'::json
        ) AS "visitTasks",
        NULL::int AS "requestedDeviceModelId",
        NULL::varchar AS "requestedDeviceName",
        fv.created_at AS "createdAt",
        fv.created_by AS "createdBy",
        ct.id AS "contactTargetId",
        MIN(vt.source_open_task_id) AS "openTaskId",
        fv.origin_id AS "taskListItemId",
        tl.id AS "taskListId",
        fv.id::text AS "marketingVisitId"
      FROM field_visits fv
      JOIN clients c ON c.id = fv.client_id
      LEFT JOIN visit_tasks vt ON vt.field_visit_id = fv.id
      LEFT JOIN contact_targets ct ON ct.latest_visit_id = fv.id
      LEFT JOIN LATERAL (
        SELECT id
        FROM telemarketing_task_lists tl_match
        WHERE tl_match.team_key = fv.team_snapshot->>'teamKey'
          AND tl_match.branch_id = fv.branch_id
          AND tl_match.date::date <= fv.scheduled_date
        ORDER BY tl_match.date::date DESC, tl_match.created_at DESC
        LIMIT 1
      ) tl ON TRUE
      ${fieldVisitWhere}
        ${fieldVisitWhere ? 'AND' : 'WHERE'} fv.origin_type = 'telemarketing'
        AND fv.visit_type = 'marketing'
        AND fv.status IN ('scheduled','in_progress','ended','completed')
      GROUP BY fv.id, c.id, ct.id, tl.id
      ORDER BY fv.created_at DESC
    `,
    fieldVisitAppointmentParams,
  );

  // Plan 2026-06-10 Phase 2.4 — single source of truth (field_visits);
  // legacy merge/dedupe logic removed.
  const appointmentRows = fieldVisitAppointmentsRes.rows;

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
          appointments: appointmentRows,
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
          appointments: appointmentRows,
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
    appointments: appointmentRows,
    callLogs: callLogsRes.rows,
  });
});

// LEGACY endpoint — kept for backwards compatibility only.
// WARNING: this endpoint deletes and re-inserts all items unconditionally,
// which destroys existing call_outcome and status data. It must not be used
// by any new code path. It will be removed once all callers migrate to
// generate-from-plan. contact_target_id is explicitly set to NULL because
// legacy upsert has no way to resolve contact targets.
/**
 * @swagger
 * /api/telemarketing/task-lists/upsert:
 *   post:
 *     tags: [Telemarketing]
 *     summary: Upsert a telemarketing task list (Legacy)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: true
 *         description: Branch context ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               id:
 *                 type: string
 *               teamKey:
 *                 type: string
 *               date:
 *                 type: string
 *               createdAt:
 *                 type: string
 *               items:
 *                 type: array
 *                 items:
 *                   type: object
 *     responses:
 *       200:
 *         description: Success
 *       400:
 *         description: Bad Request
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       500:
 *         description: Internal Server Error
 */
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

/**
 * @swagger
 * /api/telemarketing/task-lists/generate-from-plan:
 *   post:
 *     tags: [Telemarketing]
 *     summary: Generate a task list from today's planning
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: true
 *         description: Branch context ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               date:
 *                 type: string
 *                 description: Date in YYYY-MM-DD format
 *               teamKey:
 *                 type: string
 *                 description: Team key
 *     responses:
 *       200:
 *         description: Success
 *       400:
 *         description: Bad Request
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       500:
 *         description: Internal Server Error
 */
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

  // Query assigned tasks directly by assigned_team_key + assigned_for_date instead of
  // re-deriving zone_ids. This ensures every assigned task is included regardless of
  // whether the manager narrowed the route slice after the sync ran.
  const targets = await getAssignedLeadsForTeam({ date, teamKey, branchId });
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
            i.contact_target_id AS "contactTargetId",
            i.open_task_id AS "openTaskId"
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

    const queuedElsewhereByContextKey = new Map<string, string>();
    existingElsewhereByEntityId.rows.forEach((row: any) => {
      const contactTargetId = Number(row.contactTargetId);
      const openTaskId = Number(row.openTaskId);
      if (Number.isInteger(contactTargetId) && contactTargetId > 0) {
        queuedElsewhereByContextKey.set(`ct:${contactTargetId}`, row.teamKey);
      }
      if (Number.isInteger(openTaskId) && openTaskId > 0) {
        queuedElsewhereByContextKey.set(`task:${openTaskId}`, row.teamKey);
      }
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
        const contactTargetId = Number(row.contactTargetId);
        if (Number.isInteger(contactTargetId) && contactTargetId > 0 && !queuedElsewhereByContextKey.has(`ct:${contactTargetId}`)) {
          queuedElsewhereByContextKey.set(`ct:${contactTargetId}`, row.teamKey);
        }
      });
    }

    const seenLeadKeys = new Set<string>();
    const eligibleLeads = leads.filter((lead: any) => {
      const entityId = Number(lead.id);
      const openTaskId = lead.openTaskId != null ? Number(lead.openTaskId) : null;
      const leadKey = openTaskId != null ? `task:${openTaskId}` : `client:${entityId}`;
      if (seenLeadKeys.has(leadKey)) {
        return false;
      }
      seenLeadKeys.add(leadKey);

      const contactTargetId = Number(lead.contactTargetId);
      const existingTeamKey =
        (Number.isInteger(contactTargetId) && contactTargetId > 0
          ? queuedElsewhereByContextKey.get(`ct:${contactTargetId}`)
          : undefined)
        ?? (openTaskId != null ? queuedElsewhereByContextKey.get(`task:${openTaskId}`) : undefined);
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
          contact_target_id AS "contactTargetId",
          open_task_id AS "openTaskId"
        FROM telemarketing_task_list_items
        WHERE task_list_id = $1
          AND entity_type = 'client'
      `,
      [taskListId],
    );

    const existingByTaskOrEntity = new Map<string, any>();
    existingItems.rows.forEach((item: any) => {
      const openTaskId = item.openTaskId != null ? Number(item.openTaskId) : null;
      const entityId = Number(item.entityId);
      const key = openTaskId != null ? `task:${openTaskId}` : `client:${entityId}`;
      existingByTaskOrEntity.set(key, item);
    });

    let added = 0;
    let updated = 0;
    const lifecycleUpdates: { contactTargetId: number; itemId: string }[] = [];

    for (const lead of eligibleLeads) {
      const entityId = Number(lead.id);
      const openTaskId = lead.openTaskId ?? null;
      const existingItem = existingByTaskOrEntity.get(
        openTaskId != null ? `task:${openTaskId}` : `client:${entityId}`,
      );
      const itemId = existingItem?.id || (
        openTaskId != null
          ? `${taskListId}_task_${openTaskId}`
          : `${taskListId}_client_${entityId}`
      );
      const name = getLeadName(lead);
      const phone = getLeadPhone(lead);
      const geoUnitId = getLeadGeoUnitId(lead);
      const addressText = lead.detailedAddress || lead.referralAddressText || null;

      let contactTargetId = await resolveOrCreateContactTarget(pgClient, lead, branchId, supervisorHrUserId, date, teamKey);

      if (contactTargetId == null) {
        skipped.push({
          entityType: 'client',
          entityId,
          reason: 'no_contact_target',
        });
        continue;
      }

      // DEC-009 لبنة 9 / R-6 — a CLOSED contact is frozen: do NOT attach a NEW task
      // to it. (A new task for an already-booked contact belongs to the visit layer,
      // D7 cascading, not the planning list.) Existing linked items are still refreshed.
      if (!existingItem) {
        const { rows: ctStatusRows } = await pgClient.query(
          `SELECT status FROM contact_targets WHERE id = $1`,
          [contactTargetId],
        );
        if (ctStatusRows[0]?.status === 'closed') {
          skipped.push({ entityType: 'client', entityId, reason: 'contact_target_closed' });
          continue;
        }
      }

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
        const linkStatus = existingItem?.status != null && ['booked', 'closed', 'completed'].includes(String(existingItem.status))
          ? 'closed'
          : existingItem?.status === 'excluded'
            ? 'excluded'
            : existingItem?.status != null && ['queued', 'in_call_list'].includes(String(existingItem.status))
              ? 'queued'
              : 'ready';

        await pgClient.query(
          `
            INSERT INTO contact_target_open_tasks (
              contact_target_id, open_task_id, branch_id, team_key, date, link_status
            )
            VALUES ($1, $2, $3, $4, $5::date, $6)
            ON CONFLICT (contact_target_id, open_task_id, date)
            DO UPDATE SET
              branch_id = EXCLUDED.branch_id,
              team_key = EXCLUDED.team_key,
              link_status = EXCLUDED.link_status,
              updated_at = NOW()
          `,
          [contactTargetId, openTaskId, branchId, teamKey, date, linkStatus],
        );

        await pgClient.query(
          `UPDATE open_tasks
              SET contact_target_id = $1,
                  updated_at = NOW()
            WHERE id = $2
              AND branch_id = $3
              AND contact_target_id IS DISTINCT FROM $1`,
          [contactTargetId, openTaskId, branchId],
        );

        const tlUpdateResult = await pgClient.query(
          `UPDATE open_tasks SET status = 'in_scheduling', updated_at = NOW() WHERE id = $1 AND status = 'assigned'`,
          [openTaskId],
        );
        if ((tlUpdateResult as any).rowCount > 0) {
          await pgClient.query(
            `INSERT INTO task_activity_log (task_id, event_type, performed_by, role, old_value, new_value)
             VALUES ($1, 'status_change', $2, NULL, 'assigned', 'in_scheduling')`,
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
/**
 * @swagger
 * /api/telemarketing/task-lists/{taskListId}/items/{itemId}:
 *   patch:
 *     tags: [Telemarketing]
 *     summary: Update a task list item status/outcome
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: true
 *         description: Branch context ID
 *       - in: path
 *         name: taskListId
 *         schema:
 *           type: string
 *         required: true
 *         description: Task List ID
 *       - in: path
 *         name: itemId
 *         schema:
 *           type: string
 *         required: true
 *         description: Item ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               status:
 *                 type: string
 *               callOutcome:
 *                 type: string
 *     responses:
 *       200:
 *         description: Success
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/TelemarketingTaskListItem'
 *       400:
 *         description: Bad Request
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Not Found
 *       500:
 *         description: Internal Server Error
 */
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

router.post('/contact-targets/:id/claim', requirePermission('telemarketing.calls.create'), async (req, res) => {
  try {
    const contactTargetId = Number(req.params.id);
    const callerId = getCallerId(req);
    if (!Number.isInteger(contactTargetId) || contactTargetId <= 0) {
      return res.status(400).json({ error: 'contactTargetId غير صالح' });
    }
    if (callerId == null) {
      return res.status(401).json({ error: 'لا يمكن تحديد المستخدم الحالي' });
    }

    await claimContactTarget(pool, contactTargetId, callerId);

    const { rows } = await pool.query(
      `SELECT ct.locked_by_hr_user_id AS "lockedByHrUserId",
              hu.name AS "lockedByHrUserName",
              ct.locked_at AS "lockedAt"
         FROM contact_targets ct
         LEFT JOIN hr_users hu ON hu.id = ct.locked_by_hr_user_id
        WHERE ct.id = $1`,
      [contactTargetId],
    );

    return res.json(rows[0] ?? { lockedByHrUserId: callerId, lockedByHrUserName: null, lockedAt: null });
  } catch (err: any) {
    if (err instanceof ContactTargetLockError) {
      return res.status(err.statusCode).json({ error: err.message, ownerName: err.ownerName });
    }
    console.error('[telemarketing] contact-target claim failed:', err);
    return res.status(500).json({ error: err?.message ?? 'فشل قفل جهة الاتصال' });
  }
});

router.get('/customer/:customerId/all-targets-today', requirePermission('telemarketing.lists.view'), async (req, res) => {
  try {
    const customerId = Number(req.params.customerId);
    const branchId = getBranchId(req);
    const dateParam = typeof req.query.date === 'string' && req.query.date
      ? String(req.query.date).slice(0, 10)
      : new Date().toISOString().slice(0, 10);

    if (!Number.isInteger(customerId) || customerId <= 0) {
      return res.status(400).json({ error: 'customerId غير صالح' });
    }
    if (branchId == null) {
      return res.status(400).json({ error: 'Branch context required' });
    }

    const { rows } = await pool.query(
      `
        SELECT
          ct.id,
          ct.target_id AS "customerId",
          ct.team_key AS "teamKey",
          ct.date::text AS date,
          ct.status,
          ct.visit_type AS "visitType",
          ct.latest_call_outcome AS "latestCallOutcome",
          ct.latest_visit_id AS "latestVisitId",
          ct.closing_reason AS "closingReason",
          ct.closed_at AS "closedAt",
          ct.work_location_geo_unit_id AS "workLocationGeoUnitId",
          gu.name AS "workLocationName",
          ct.locked_by_hr_user_id AS "lockedByHrUserId",
          lock_hu.name AS "lockedByHrUserName",
          ct.first_contacted_by_hr_user_id AS "firstContactedByHrUserId",
          first_hu.name AS "firstContactedByHrUserName",
          fv.status AS "visitStatus",
          fv.scheduled_date::text AS "visitDate",
          fv.scheduled_time AS "visitTime",
          COALESCE(task_counts.task_count, 0)::int AS "taskCount",
          latest_call.outcome AS "latestTelemarketingOutcome",
          latest_call.timestamp AS "latestCallAt"
        FROM contact_targets ct
        LEFT JOIN geo_units gu ON gu.id = ct.work_location_geo_unit_id
        LEFT JOIN hr_users lock_hu ON lock_hu.id = ct.locked_by_hr_user_id
        LEFT JOIN hr_users first_hu ON first_hu.id = ct.first_contacted_by_hr_user_id
        LEFT JOIN field_visits fv ON fv.id = ct.latest_visit_id
        LEFT JOIN LATERAL (
          SELECT COUNT(DISTINCT ctot.open_task_id) AS task_count
            FROM contact_target_open_tasks ctot
           WHERE ctot.contact_target_id = ct.id
        ) task_counts ON TRUE
        LEFT JOIN LATERAL (
          SELECT tcl.outcome, tcl.timestamp
            FROM telemarketing_call_logs tcl
           WHERE tcl.contact_target_id = ct.id
           ORDER BY tcl.timestamp DESC
           LIMIT 1
        ) latest_call ON TRUE
        WHERE ct.branch_id = $1
          AND ct.target_type = 'client'
          AND ct.target_id = $2
          AND ct.date = $3::date
        ORDER BY
          CASE WHEN ct.status = 'closed' THEN 1 ELSE 0 END,
          ct.team_key NULLS LAST,
          ct.id
      `,
      [branchId, customerId, dateParam],
    );

    return res.json({ customerId, date: dateParam, items: rows });
  } catch (err: any) {
    console.error('[telemarketing] all-targets-today failed:', err);
    return res.status(500).json({ error: err?.message ?? 'فشل تحميل وعي جهات الاتصال' });
  }
});

/**
 * @swagger
 * /api/telemarketing/call-logs:
 *   post:
 *     tags: [Telemarketing]
 *     summary: Log a telemarketing call
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: true
 *         description: Branch context ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               taskListId:
 *                 type: string
 *               taskListItemId:
 *                 type: string
 *               entityType:
 *                 type: string
 *               entityId:
 *                 type: integer
 *               teamKey:
 *                 type: string
 *               outcome:
 *                 type: string
 *               contactLabel:
 *                 type: string
 *               contactNumber:
 *                 type: string
 *               notes:
 *                 type: string
 *               communicationMethod:
 *                 type: string
 *     responses:
 *       200:
 *         description: Success
 *       400:
 *         description: Bad Request
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal Server Error
 */
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

  try {
    await claimContactTarget(pool, contactTargetId, calledBy);
  } catch (err: any) {
    if (err instanceof ContactTargetLockError) {
      return res.status(err.statusCode).json({ error: err.message, ownerName: err.ownerName });
    }
    throw err;
  }

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
    await markContactTargetFirstContact(pool, contactTargetId, calledBy);

    // Normalise legacy codes for lifecycle decisions
    const normalised = normaliseOutcomeCode(outcome);

    // ── DEC-005 D26: auto-close branch is now dead by design.
    // CLOSES_TARGET_OUTCOMES is empty after Phase 2; contact_targets are closed
    // manually via POST /contact-targets/:id/close or by the end-of-day CRON.
    if (CLOSES_TARGET_OUTCOMES.includes(normalised)) {
      // Defensive branch retained in case a future outcome flips closesContactTarget back to true.
      await updateContactTargetLifecycle(pool, contactTargetId, {
        latestCallOutcome: outcome,
        status: 'closed',
      });
      await returnTasksToWaiting(pool, contactTargetId, calledBy, `إغلاق تلقائي بنتيجة: ${outcome}`);
    } else if (normalised === 'booked_marketing_appointment') {
      // The call result itself means the contact happened. The later visit
      // booking step closes the target with closing_reason='booked' if it
      // succeeds, but a booking failure must not leave the target as queued.
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

    // ── DEC-005 D29: auto-activate cooldown on not_interested ─────────────
    // Sits OUTSIDE the close branches so the cooldown fires even when the
    // close branch is dead. The contact_target itself stays open until manual
    // close — this matches DEC-005 D26 (no auto-close on rejection outcomes).
    if (AUTO_COOLDOWN_OUTCOMES.has(normalised) && taskListItem.entity_type === 'client') {
      const days = await getSystemSettingNumber('default_cooldown_days', 7);
      await pool.query(
        `UPDATE clients
            SET cooldown_until  = CURRENT_DATE + ($1 || ' days')::INTERVAL,
                cooldown_reason = $2,
                cooldown_set_by = $3,
                cooldown_set_at = NOW()
          WHERE id = $4
            -- preserve a longer existing cooldown if one is already in effect
            AND (cooldown_until IS NULL OR cooldown_until < CURRENT_DATE + ($1 || ' days')::INTERVAL)`,
        [days, `تفعيل تلقائي بنتيجة: ${outcome}`, calledBy ?? null, taskListItem.entity_id],
      );
    }
  }

  res.json(rows[0]);
});

/**
 * @swagger
 * /api/telemarketing/appointments:
 *   post:
 *     tags: [Telemarketing]
 *     summary: Book an appointment
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: true
 *         description: Branch context ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               taskListId:
 *                 type: string
 *               taskListItemId:
 *                 type: string
 *               entityType:
 *                 type: string
 *               entityId:
 *                 type: integer
 *               teamKey:
 *                 type: string
 *               date:
 *                 type: string
 *               timeSlot:
 *                 type: string
 *               technicianNotes:
 *                 type: string
 *               requestedDeviceModelId:
 *                 type: integer
 *               requestedDeviceName:
 *                 type: string
 *               selectedOpenTasks:
 *                 type: array
 *                 items:
 *                   type: object
 *     responses:
 *       200:
 *         description: Success
 *       400:
 *         description: Bad Request
 *       401:
 *         description: Unauthorized
 *       409:
 *         description: Conflict
 *       500:
 *         description: Internal Server Error
 */
// ============================================================================
// POST /telemarketing/book-visit — DEC-003 D2 canonical booking endpoint
// ============================================================================
// Replaces /telemarketing/appointments. Writes directly to field_visits +
// visit_tasks via the shared visitBooking service. The legacy /appointments
// endpoint below stays operational until Phase 8 to avoid breaking clients
// that haven't migrated yet (PR4: dual-state during transition).
router.post('/book-visit', requirePermission('telemarketing.appointments.book'), async (req, res) => {
  try {
    const body = req.body ?? {};
    const branchId = getBranchId(req);
    const performedByUserId = getCallerId(req);

    if (branchId == null) {
      return res.status(400).json({ error: 'Branch context required' });
    }

    // Resolve clientId from the task list item (so callers can supply taskListItemId
    // instead of restating the client).
    let clientId = Number(body.clientId);
    let contactTargetId: number | null = null;
    let taskListItem: any = null;
    if (body.taskListId && body.taskListItemId) {
      taskListItem = await loadTaskListItem(pool, body.taskListId, body.taskListItemId);
      if (!taskListItem) {
        return res.status(404).json({ error: 'عنصر القائمة غير موجود' });
      }
      contactTargetId = taskListItem.contact_target_id ?? null;
      if (!Number.isInteger(clientId) || clientId <= 0) {
        clientId = Number(taskListItem.entity_id);
      }
    }
    if (!Number.isInteger(clientId) || clientId <= 0) {
      return res.status(400).json({ error: 'clientId مطلوب أو taskListItemId يحلّ مكانه' });
    }

    const selectedTasks: Array<{ openTaskId: number; taskType: string }> = Array.isArray(body.selectedOpenTasks)
      ? body.selectedOpenTasks.map((t: any) => ({
          openTaskId: Number(t.openTaskId),
          taskType: String(t.taskType ?? 'device_demo'),
        }))
      : [];

    try {
      await claimContactTarget(pool, contactTargetId, performedByUserId);
    } catch (err: any) {
      if (err instanceof ContactTargetLockError) {
        return res.status(err.statusCode).json({ error: err.message, ownerName: err.ownerName });
      }
      throw err;
    }

    const result = await bookVisit({
      branchId,
      clientId,
      scheduledDate: String(body.date ?? ''),
      scheduledTime: String(body.timeSlot ?? ''),
      teamKey: String(body.teamKey ?? ''),
      // DEC-003 D3: origin_type = 'telemarketing'; origin_id = call_log id if known,
      // else the task list item id (still traceable to the campaign).
      originType: 'telemarketing',
      originId: body.callLogId ?? body.taskListItemId ?? null,
      selectedTasks,
      performedByUserId,
      customerSnapshot: body.customerSnapshot ?? null,
      telemarketerNotes: body.notes ?? null,
    });

    // Close the contact_target if one was attached (DEC-005 D26 + D23)
    if (contactTargetId != null) {
      await pool.query(
        `UPDATE contact_targets
            SET status         = 'closed',
                closing_reason = 'booked',
                latest_visit_id = $1,
                latest_call_outcome = COALESCE(latest_call_outcome, 'booked_marketing_appointment'),
                closed_at      = NOW(),
                updated_at     = NOW()
          WHERE id = $2`,
        [result.fieldVisitId, contactTargetId],
      );
    }

    // Mark task list items as booked (legacy compatibility for the workspace)
    if (taskListItem && body.taskListId && body.taskListItemId) {
      await pool.query(
        `UPDATE telemarketing_task_list_items
            SET status = 'booked',
                call_outcome = 'booked_marketing_appointment'
          WHERE task_list_id = $1
            AND id = $2`,
        [body.taskListId, body.taskListItemId],
      );
    }

    return res.json({
      fieldVisitId: result.fieldVisitId,
      visitTaskIds: result.visitTaskIds,
      contactTargetId,
    });
  } catch (err: any) {
    if (err instanceof BookingError) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    console.error('[book-visit] failed', err);
    return res.status(500).json({ error: err?.message ?? 'فشل حجز الزيارة' });
  }
});

// ─── Legacy POST /telemarketing/appointments — retired 2026-06-10 (Phase 1.3)
// Plan: docs/constitution/plans/2026-06-10-telemarketing-appointments-migration.md
// Replaced by /telemarketing/book-visit (DEC-003 D2). All writes to the legacy
// telemarketing_appointments table now go away. The original handler (~335
// lines) is preserved in git history one commit prior to this paragraph.
router.post('/appointments', requirePermission('telemarketing.appointments.book'), async (_req, res) => {
  res.status(410).json({
    error: 'هذا المسار مُعطَّل — استخدم POST /api/telemarketing/book-visit بدلاً عنه (DEC-003 D2)',
  });
});

/**
 * @swagger
 * /api/telemarketing/task-lists/{taskListId}/items/{itemId}/close:
 *   post:
 *     tags: [Telemarketing]
 *     summary: Manually close a task list item
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: true
 *         description: Branch context ID
 *       - in: path
 *         name: taskListId
 *         schema:
 *           type: string
 *         required: true
 *         description: Task List ID
 *       - in: path
 *         name: itemId
 *         schema:
 *           type: string
 *         required: true
 *         description: Item ID
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reason:
 *                 type: string
 *               expectedDate:
 *                 type: string
 *               priority:
 *                 type: string
 *     responses:
 *       200:
 *         description: Success
 *       400:
 *         description: Bad Request
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Not Found
 *       500:
 *         description: Internal Server Error
 */
router.post(
  '/task-lists/:taskListId/items/:itemId/close',
  requirePermission('telemarketing.calls.create'),
  async (req, res) => {
    try {
      const taskListId = String(req.params.taskListId);
      const itemId = String(req.params.itemId);
      const { reason, expectedDate, priority } = req.body ?? {};
      const performedBy = getCallerId(req);
      const branchId = getBranchId(req);

      const taskList = await verifyTaskListAccess(req, res, taskListId);
      if (!taskList) return;
      if (branchId != null && taskList.branch_id != null && taskList.branch_id !== branchId) {
        return res.status(403).json({ error: 'غير مصرح' });
      }

      const item = await loadTaskListItem(pool, taskListId, itemId);
      if (!item) return res.status(404).json({ error: 'العنصر غير موجود' });

      const contactTargetId: number | null = item.contact_target_id ?? null;
      try {
        await claimContactTarget(pool, contactTargetId, performedBy);
      } catch (err: any) {
        if (err instanceof ContactTargetLockError) {
          return res.status(err.statusCode).json({ error: err.message, ownerName: err.ownerName });
        }
        throw err;
      }

      const pgClient = await pool.connect();
      try {
        await pgClient.query('BEGIN');

        // 1. Mark task_list_item as manually closed
        await pgClient.query(
          `UPDATE telemarketing_task_list_items
              SET status = 'called', call_outcome = 'manual_close'
            WHERE task_list_id = $1 AND id = $2`,
          [taskListId, itemId],
        );

        // 2. Close contact_target
        if (contactTargetId != null) {
          await updateContactTargetLifecycle(pgClient, contactTargetId, {
            latestCallOutcome: 'manual_close',
            status: 'closed',
          });
          await pgClient.query(
            `UPDATE contact_targets
                SET closing_reason = 'manual_telemarketer',
                    closed_by = $1,
                    closed_at = COALESCE(closed_at, NOW()),
                    updated_at = NOW()
              WHERE id = $2`,
            [performedBy, contactTargetId],
          );

          // 3. Return associated tasks to waiting
          await returnTasksToWaiting(
            pgClient,
            contactTargetId,
            performedBy,
            reason ? `إغلاق يدوي — ${reason}` : 'إغلاق يدوي من التلمارك',
          );
        }

        // 4. Apply optional task updates (expectedDate / priority)
        if (item.open_task_id != null && (expectedDate || priority)) {
          const setClauses: string[] = ['updated_at = NOW()'];
          const taskParams: any[] = [];
          let paramIdx = 1;

          if (expectedDate && typeof expectedDate === 'string') {
            setClauses.push(`expected_date = $${paramIdx++}`);
            taskParams.push(expectedDate);
          }
          if (priority && ['high', 'medium', 'low'].includes(priority)) {
            setClauses.push(`priority = $${paramIdx++}`);
            taskParams.push(priority);
          }
          taskParams.push(item.open_task_id);
          await pgClient.query(
            `UPDATE open_tasks SET ${setClauses.join(', ')} WHERE id = $${paramIdx}`,
            taskParams,
          );
        }

        await pgClient.query('COMMIT');
        return res.json({ success: true, contactTargetId });
      } catch (err) {
        await pgClient.query('ROLLBACK');
        throw err;
      } finally {
        pgClient.release();
      }
    } catch (err: any) {
      console.error('[telemarketing] manual close error:', err);
      return res.status(500).json({ error: err.message || 'فشل الإغلاق اليدوي' });
    }
  },
);

/**
 * @swagger
 * /api/telemarketing/task-type-options:
 *   get:
 *     tags: [Telemarketing]
 *     summary: Retrieve active task types for options dropdown
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: true
 *         description: Branch context ID
 *       - in: query
 *         name: branchId
 *         schema:
 *           type: integer
 *         required: false
 *         description: Filter by branch ID
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         required: false
 *         description: Search term
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *         required: false
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         required: false
 *         description: Number of items per page
 *     responses:
 *       200:
 *         description: Success
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   taskType:
 *                     type: string
 *                   arabicLabel:
 *                     type: string
 *                   taskFamily:
 *                     type: string
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal Server Error
 */
router.get('/task-type-options', requirePermission('telemarketing.calls.create'), async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT task_type AS "taskType", arabic_label AS "arabicLabel", task_family AS "taskFamily"
         FROM task_type_config
        WHERE is_active = TRUE
        ORDER BY display_order ASC, task_type ASC`,
    );
    return res.json(rows);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/telemarketing/service-tasks:
 *   post:
 *     tags: [Telemarketing]
 *     summary: Create a service task
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: true
 *         description: Branch context ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               clientId:
 *                 type: integer
 *               taskType:
 *                 type: string
 *               notes:
 *                 type: string
 *               priority:
 *                 type: string
 *     responses:
 *       201:
 *         description: Created
 *       400:
 *         description: Bad Request
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal Server Error
 */
router.post('/service-tasks', requirePermission('telemarketing.calls.create'), async (req, res) => {
  try {
    const branchId = getBranchId(req);
    const createdBy = getCallerId(req);
    const { clientId, taskType, notes, priority } = req.body ?? {};

    if (!branchId) return res.status(400).json({ error: 'Branch context required' });
    if (!clientId || !Number.isInteger(Number(clientId))) {
      return res.status(400).json({ error: 'clientId is required' });
    }
    if (!taskType || typeof taskType !== 'string') {
      return res.status(400).json({ error: 'taskType is required' });
    }

    // Resolve task_family from task_type_config
    const { rows: ttcRows } = await pool.query(
      `SELECT task_family FROM task_type_config WHERE task_type = $1 AND is_active = TRUE`,
      [taskType],
    );
    if (!ttcRows[0]) {
      return res.status(400).json({ error: `نوع المهمة "${taskType}" غير معرّف أو معطّل` });
    }
    const taskFamily = ttcRows[0].task_family;

    const { rows } = await pool.query(
      `INSERT INTO open_tasks
         (client_id, branch_id, task_type, task_family, reason, status,
          priority, source, notes, created_by, origin)
       VALUES ($1, $2, $3, $4, 'service_request', 'open',
               $5, 'telemarketing', $6, $7, 'telemarketing_call')
       RETURNING id, task_type AS "taskType", status, created_at AS "createdAt"`,
      [
        Number(clientId),
        branchId,
        taskType,
        taskFamily,
        ['high', 'medium', 'low'].includes(priority) ? priority : null,
        notes || null,
        createdBy,
      ],
    );

    return res.status(201).json(rows[0]);
  } catch (err: any) {
    console.error('[telemarketing] service task create error:', err);
    return res.status(500).json({ error: err.message || 'فشل إنشاء المهمة' });
  }
});

export default router;
