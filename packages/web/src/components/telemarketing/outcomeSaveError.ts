const FALLBACK_OUTCOME_SAVE_ERROR = 'تعذر حفظ نتيجة التواصل. تحقق من البيانات وحاول مجدداً.';

export function getOutcomeSaveErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message.trim()) {
        return error.message;
    }

    return FALLBACK_OUTCOME_SAVE_ERROR;
}
