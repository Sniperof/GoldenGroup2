import type { PoolClient } from 'pg';
import type { EmployeeRole } from '@golden-crm/shared';

export type { EmployeeRole };

export interface ApplicationPolicyState {
  currentStage: string;
  isEscalated: boolean;
}

export const ESCALATED_ASSISTANT_ERROR =
  'تم تصعيد الطلب للإدارة، ولا يمكن لمساعد الموارد البشرية استكماله.';

export const FINAL_DECISION_MANAGER_ONLY_ERROR =
  'القرار النهائي على الطلب من صلاحية مدير الموارد البشرية فقط.';

export async function fetchApplicationPolicyState(
  client: PoolClient,
  applicationId: number | string,
): Promise<ApplicationPolicyState | null> {
  const { rows } = await client.query(
    `SELECT current_stage AS "currentStage",
      is_escalated AS "isEscalated"
     FROM job_applications
     WHERE id = $1`,
    [applicationId],
  );

  return rows[0] ?? null;
}

export function getApplicationProcessingBlockReason(
  userRole: string | undefined,
  state: ApplicationPolicyState,
): string | null {
  if (userRole !== 'HR_ASSISTANT') return null;
  if (state.isEscalated) return ESCALATED_ASSISTANT_ERROR;
  if (state.currentStage === 'Final Decision') return FINAL_DECISION_MANAGER_ONLY_ERROR;
  return null;
}

export function deriveEmployeeRoleFromVacancyTitle(title: string | null | undefined): EmployeeRole | null {
  const normalized = (title ?? '').trim().toLowerCase();
  if (!normalized) return null;

  if (
    normalized.includes('مشرفة') ||
    normalized.includes('مشرف') ||
    normalized.includes('supervisor')
  ) {
    return 'supervisor';
  }

  if (
    normalized.includes('تيلماركتر') ||
    normalized.includes('telemarketer') ||
    normalized.includes('مسوق هاتفي')
  ) {
    return 'telemarketer';
  }

  if (
    normalized.includes('فني') ||
    normalized.includes('technician')
  ) {
    return 'technician';
  }

  return null;
}

export function getEmployeeAvatar(name: string, photoUrl: string | null | undefined): string {
  if (photoUrl?.trim()) return photoUrl.trim();
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=0ea5e9&color=fff`;
}
