// Features temporarily hidden from the UI (code kept; flip to true to restore).
export const HIDDEN_FEATURES_ENABLED = {
    /** «تقييم المهام» page (/tasks/evaluation-lab) + its sidebar entry. */
    taskEvaluationLab: false,
    /** Floating quick-actions button (bottom-left) and its menu. */
    quickActionsFab: false,
    /** «خدمات ما بعد البيع» task-group list (/tasks/group/after-sale-services)
     *  + its sidebar entry. Task detail pages (/…/:id) stay reachable. */
    afterSaleServicesTasks: false,
} as const;
