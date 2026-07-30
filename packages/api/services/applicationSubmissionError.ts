export const APPLICATION_SUBMISSION_FAILED_MESSAGE =
  'تعذر حفظ طلب التوظيف. يرجى المحاولة مجددًا.';

type ApplicationSubmissionErrorResponse = {
  status: number;
  payload: Record<string, unknown>;
};

/**
 * Preserve deliberate 4xx service responses, but never expose database or
 * other internal error details to either application form.
 */
export function applicationSubmissionErrorResponse(
  error: unknown,
): ApplicationSubmissionErrorResponse {
  const candidate = error as {
    status?: unknown;
    payload?: unknown;
  } | null;

  if (
    typeof candidate?.status === 'number'
    && candidate.status >= 400
    && candidate.status < 500
    && candidate.payload !== null
    && typeof candidate.payload === 'object'
    && !Array.isArray(candidate.payload)
  ) {
    return {
      status: candidate.status,
      payload: candidate.payload as Record<string, unknown>,
    };
  }

  return {
    status: 500,
    payload: { error: APPLICATION_SUBMISSION_FAILED_MESSAGE },
  };
}
