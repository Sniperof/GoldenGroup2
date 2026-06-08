import type { InterviewerOption } from '../../lib/types';
import { authFetch } from '../../lib/authFetch';

export async function fetchInterviewersForApplication(
  applicationId: number,
  currentInterviewerUserId?: number | null,
): Promise<InterviewerOption[]> {
  const params = new URLSearchParams({ applicationId: String(applicationId) });
  if (currentInterviewerUserId != null) {
    params.set('currentInterviewerUserId', String(currentInterviewerUserId));
  }

  const response = await authFetch(`/api/admin/interviews/interviewers?${params.toString()}`);
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      typeof payload?.error === 'string'
        ? payload.error
        : 'تعذر تحميل قائمة المقابلين المؤهلين حالياً.',
    );
  }

  return Array.isArray(payload) ? payload : [];
}
