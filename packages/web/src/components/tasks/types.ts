import type { ComponentType, ReactNode } from 'react';

/**
 * The data shape passed to all task detail components.
 * Tasks loaded from API have all these fields.
 */
export interface TaskDetailData {
  task: any;       // OpenTask + joined fields (clientSnapshot, contractSnapshot, etc.)
  activity: any[]; // task_activity_log entries
  calls: any[];    // call entries
  devices: any[];  // open_task_devices entries
  preOffers: any[]; // open_task_pre_offers entries (used by device_demo)
}

/**
 * Props passed to a custom result renderer for a task type.
 * Each task type's result UI receives the full task and result-specific data.
 */
export interface TaskResultRendererProps {
  task: any;
  preOffers?: any[];
}

/**
 * Definition of an extra tab contributed by a task type.
 */
export interface ExtraTabDef {
  id: string;
  label: string;
  icon?: ComponentType<{ className?: string }>;
  /** Render the tab content given the full task data. */
  render: (data: TaskDetailData) => ReactNode;
}

/**
 * A task type extension provides task-type-specific UI on top of the base template.
 */
export interface TaskTypeExtension {
  /** Extra cards appended below the 4 base cards in the Overview tab. */
  overviewExtraCards?: (data: TaskDetailData) => ReactNode;
  /** Extra tabs inserted between base tabs and the Result tab. */
  extraTabs?: ExtraTabDef[];
  /** Renderer for the Result tab content. If omitted, only base summary is shown. */
  ResultRenderer?: ComponentType<TaskResultRendererProps>;
}
