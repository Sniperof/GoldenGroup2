import type {
  MarketingVisitCancelRequest,
  MarketingVisitRescheduleRequest,
  TaskTypeConfig,
} from '@golden-crm/shared';
import { shouldAttachBranchContextHeader } from './branchContext';

export const API_BASE = '/api';

// Read token from localStorage at call time (not at import time)
function getToken(): string | null {
  return localStorage.getItem('hr_token');
}

/**
 * For super admin only: the currently-selected branch context (if any).
 * Read from localStorage to avoid a circular import with the Zustand store.
 * Non-super users never have this set, and global-only admin pages should not
 * send it because they operate outside branch context.
 */
function getBranchContextHeader(): string | null {
  try {
    if (!shouldAttachBranchContextHeader(window.location.pathname)) return null;
    const rawUser = localStorage.getItem('hr_user');
    if (!rawUser) return null;
    const user = JSON.parse(rawUser);
    if (user?.isSuperAdmin !== true) return null;
    const raw = localStorage.getItem('hr_branch_context');
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? String(n) : null;
  } catch {
    return null;
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options?.headers as Record<string, string>),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const branchCtx = getBranchContextHeader();
  if (branchCtx) headers['X-Branch-Id'] = branchCtx;

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });

  if (res.status === 401) {
    // Token expired or invalid — clear session and redirect to login
    localStorage.removeItem('hr_token');
    localStorage.removeItem('hr_user');
    window.location.href = '/login';
    throw new Error('انتهت صلاحية الجلسة — يرجى تسجيل الدخول مرة أخرى');
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API Error ${res.status}: ${text}`);
  }
  return res.json();
}

export const api = {
  dashboard: {
    get: () => request<any>('/dashboard'),
  },
  geoUnits: {
    list: () => request<any[]>('/geo-units'),
    create: (data: any) => request<any>('/geo-units', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: { name: string }) => request<any>(`/geo-units/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    updateStatus: (id: number, status: 'active' | 'inactive') => request<any>(`/geo-units/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
    delete: (id: number) => request<any>(`/geo-units/${id}`, { method: 'DELETE' }),
  },
  branches: {
    list: () => request<any[]>('/branches'),
    get: (id: number) => request<any>(`/branches/${id}`),
    create: (data: any) => request<any>('/branches', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: any) => request<any>(`/branches/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: number) => request<any>(`/branches/${id}`, { method: 'DELETE' }),
  },
  admin: {
    hrUsers: {
      list: () => request<any[]>('/admin/hr-users'),
      assignable: () => request<any[]>('/admin/hr-users/assignable'),
    },
    taskTypes: {
      list: (activeOnly = false) => {
        const qs = activeOnly ? '?activeOnly=true' : '';
        return request<TaskTypeConfig[]>(`/admin/task-types${qs}`);
      },
      update: (taskType: string, data: { planningWindowDays?: number | null; isActive?: boolean }) =>
        request<TaskTypeConfig>(`/admin/task-types/${encodeURIComponent(taskType)}`, {
          method: 'PATCH',
          body: JSON.stringify(data),
        }),
    },
    emergencyActionTypes: {
      list:   () => request<any[]>('/admin/emergency-action-types'),
      active: () => request<any[]>('/admin/emergency-action-types/active'),
      create: (data: { arabicLabel: string; description?: string; displayOrder?: number }) =>
        request<any>('/admin/emergency-action-types', { method: 'POST', body: JSON.stringify(data) }),
      update: (id: number, data: { arabicLabel?: string; description?: string; displayOrder?: number; isActive?: boolean }) =>
        request<any>(`/admin/emergency-action-types/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
      delete: (id: number) => request<any>(`/admin/emergency-action-types/${id}`, { method: 'DELETE' }),
    },
  },
  employees: {
    list: () => request<any[]>('/employees'),
    schedulePool: () => request<any[]>('/employees/schedule-pool'),
    closers: () => request<any[]>('/employees/closers'),
    get: (id: number) => request<any>(`/employees/${id}`),
    create: (data: any) => request<any>('/employees', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: any) => request<any>(`/employees/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    managerCandidates: (branchId: number, departmentId?: number) => {
      const query = new URLSearchParams({ branchId: String(branchId) });
      if (departmentId != null) query.set('departmentId', String(departmentId));
      return request<any[]>(`/employees/manager-candidates?${query.toString()}`);
    },
    upsertSystemAccount: (id: number, data: any) => request<any>(`/employees/${id}/system-account`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: number) => request<any>(`/employees/${id}`, { method: 'DELETE' }),
  },
  clients: {
    list: () => request<any[]>('/clients'),
    get: (id: number) => request<any>(`/clients/${id}`),
    smartMatch: (data: { phone?: string; mobile?: string; name?: string }) =>
      request<any>('/clients/smart-match', { method: 'POST', body: JSON.stringify(data) }),
    create: (data: any) => request<any>('/clients', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: any) => request<any>(`/clients/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: number) => request<any>(`/clients/${id}`, { method: 'DELETE' }),
    bulkDelete: (ids: number[]) => request<any>('/clients/bulk-delete', { method: 'POST', body: JSON.stringify({ ids }) }),
    // DEC-005 D29 + DEC-006 D32: contact-control surface
    setCooldown: (id: number, data: { days: number; reason: string }) =>
      request<any>(`/clients/${id}/cooldown`, { method: 'POST', body: JSON.stringify(data) }),
    clearCooldown: (id: number) =>
      request<any>(`/clients/${id}/cooldown`, { method: 'DELETE' }),
    setDoNotContact: (id: number, doNotContact: boolean) =>
      request<any>(`/clients/${id}/do-not-contact`, { method: 'PATCH', body: JSON.stringify({ doNotContact }) }),
  },
  customers: {
    getPurchaseHistory: (customerId: number) =>
      request<any>(`/customers/${customerId}/purchase-history`),
    getPartsStock: (customerId: number) =>
      request<any>(`/customers/${customerId}/parts-stock`),
    // DEC-CT-10: chronological merge of installments + payment entries.
    getStatement: (customerId: number) =>
      request<{ customerId: number; entries: any[] }>(`/customers/${customerId}/statement`),
    // Pre-offers tab — every device-demo pre-offer with its outcome.
    getPreOffers: (customerId: number) =>
      request<{ customerId: number; entries: any[]; summary: any }>(`/customers/${customerId}/pre-offers`),
  },
  customerCalls: {
    list: (customerId: number) => request<any[]>(`/customers/${customerId}/calls`),
    listByContact: (customerId: number, contactId: string) =>
      request<any[]>(`/customers/${customerId}/calls?contactId=${encodeURIComponent(contactId)}`),
    stats: (customerId: number) => request<any[]>(`/customers/${customerId}/calls/stats`),
    create: (customerId: number, data: any) =>
      request<any>(`/customers/${customerId}/calls`, { method: 'POST', body: JSON.stringify(data) }),
    update: (callId: string, data: any) =>
      request<any>(`/customers/calls/${callId}`, { method: 'PATCH', body: JSON.stringify(data) }),
  },
  candidates: {
    list: () => request<any[]>('/candidates'),
    create: (data: any) => request<any>('/candidates', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: any) => request<any>(`/candidates/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: number) => request<any>(`/candidates/${id}`, { method: 'DELETE' }),
  },
  referralSheets: {
    list: () => request<any[]>('/referral-sheets'),
    create: (data: any) => request<any>('/referral-sheets', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: any) => request<any>(`/referral-sheets/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  },
  routes: {
    list: () => request<any[]>('/routes'),
    create: (data: any) => request<any>('/routes', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: any) => request<any>(`/routes/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: number) => request<any>(`/routes/${id}`, { method: 'DELETE' }),
  },
  tasks: {
    list: () => request<any[]>('/tasks'),
    create: (data: any) => request<any>('/tasks', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: any) => request<any>(`/tasks/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: number) => request<any>(`/tasks/${id}`, { method: 'DELETE' }),
  },
  contracts: {
    list: (params?: { customerId?: number }) => {
      const qs = params?.customerId ? `?customerId=${params.customerId}` : '';
      return request<any[]>(`/contracts${qs}`);
    },
    get: (id: number) => request<any>(`/contracts/${id}`),
    create: (data: any) => request<any>('/contracts', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: any) => request<any>(`/contracts/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: number) => request<any>(`/contracts/${id}`, { method: 'DELETE' }),
    savePaymentEntries: (contractId: number, entries: any[]) =>
      request<any>(`/contracts/${contractId}/payment-entries`, { method: 'POST', body: JSON.stringify({ entries }) }),
    saveInstallments: (contractId: number, installments: any[]) =>
      request<any>(`/contracts/${contractId}/installments`, { method: 'POST', body: JSON.stringify({ installments }) }),
    confirmInstallments: (contractId: number) =>
      request<any>(`/contracts/${contractId}/installments/confirm`, { method: 'POST' }),
    toggleLineItemInstallation: (contractId: number, itemId: number, isInstalled: boolean) =>
      request<any>(`/contracts/${contractId}/line-items/${itemId}/installation`, {
        method: 'PUT',
        body: JSON.stringify({ isInstalled }),
      }),
    // DEC-CT-01 follow-up: approve / reject the draft → terminal transitions.
    approve: (contractId: number, body?: { closingEmployeeId?: number }) =>
      request<any>(`/contracts/${contractId}/approve`, {
        method: 'POST',
        body: JSON.stringify(body ?? {}),
      }),
    reject: (contractId: number, body?: { reason?: string }) =>
      request<any>(`/contracts/${contractId}/reject`, {
        method: 'POST',
        body: JSON.stringify(body ?? {}),
      }),
    // DEC-CT-14/15: fetch the legal printable HTML with the auth header
    // attached. Returns the raw HTML; callers turn it into a Blob URL so
    // it can be opened in a new tab without exposing the JWT.
    getPrintableHtml: async (contractId: number): Promise<string> => {
      const token = getToken();
      const res = await fetch(`${API_BASE}/contracts/${contractId}/printable`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`فشل تحميل النسخة القانونية (${res.status}): ${text}`);
      }
      return res.text();
    },
  },
  dues: {
    list: () => request<any[]>('/dues'),
    update: (id: number, data: any) => request<any>(`/dues/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  },
  deviceParts: {
    list: (deviceId: number) => request<any[]>(`/device-parts?deviceId=${deviceId}`),
  },
  deviceWarranties: {
    list: (deviceId: number) => request<any[]>(`/device-warranties?deviceId=${deviceId}`),
    update: (id: number, data: any) => request<any>(`/device-warranties/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  },
  installedDevices: {
    list: (params?: { customerId?: number; branchId?: number; status?: string }) => {
      const qs = new URLSearchParams();
      if (params?.customerId) qs.set('customerId', String(params.customerId));
      if (params?.branchId)   qs.set('branchId', String(params.branchId));
      if (params?.status)     qs.set('status', params.status);
      return request<any[]>(`/installed-devices?${qs}`);
    },
    get: (id: number) => request<any>(`/installed-devices/${id}`),
    update: (id: number, data: any) => request<any>(`/installed-devices/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  },
  // DEC-CT-09: device possession ledger.
  // Backend route is mounted at /api/devices/:deviceId/possession.
  devicePossession: {
    list:     (deviceId: number) => request<any[]>(`/devices/${deviceId}/possession`),
    current:  (deviceId: number) => request<any | null>(`/devices/${deviceId}/possession/current`),
    transfer: (deviceId: number, data: { holderType: string; holderId?: number | null; reason: string; notes?: string; transferAt?: string }) =>
      request<any>(`/devices/${deviceId}/possession`, { method: 'POST', body: JSON.stringify(data) }),
  },
  deviceModels: {
    list: () => request<any[]>('/device-models'),
    create: (data: any) => request<any>('/device-models', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: any) => request<any>(`/device-models/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: number) => request<any>(`/device-models/${id}`, { method: 'DELETE' }),
    getDiscounts: (deviceModelId: number) => request<any[]>(`/device-models/${deviceModelId}/discounts`),
    getAllDiscounts: (deviceModelId: number) => request<any[]>(`/device-models/${deviceModelId}/discounts/all`),
    createDiscount: (deviceModelId: number, data: any) => request<any>(`/device-models/${deviceModelId}/discounts`, { method: 'POST', body: JSON.stringify(data) }),
    updateDiscount: (deviceModelId: number, discountId: number, data: any) => request<any>(`/device-models/${deviceModelId}/discounts/${discountId}`, { method: 'PUT', body: JSON.stringify(data) }),
    deleteDiscount: (deviceModelId: number, discountId: number) => request<any>(`/device-models/${deviceModelId}/discounts/${discountId}`, { method: 'DELETE' }),
  },
  spareParts: {
    list: () => request<any[]>('/spare-parts'),
    create: (data: any) => request<any>('/spare-parts', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: any) => request<any>(`/spare-parts/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: number) => request<any>(`/spare-parts/${id}`, { method: 'DELETE' }),
  },
  maintenanceRequests: {
    list: () => request<any[]>('/maintenance-requests'),
    create: (data: any) => request<any>('/maintenance-requests', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: any) => request<any>(`/maintenance-requests/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  },
  emergencyResult: {
    get:          (taskId: number)            => request<any>(`/emergency-result/${taskId}`),
    savePreState: (taskId: number, data: any) => request<any>(`/emergency-result/${taskId}/pre-state`,  { method: 'PUT', body: JSON.stringify(data) }),
    saveActions:  (taskId: number, data: any) => request<any>(`/emergency-result/${taskId}/actions`,    { method: 'PUT', body: JSON.stringify(data) }),
    savePostState:(taskId: number, data: any) => request<any>(`/emergency-result/${taskId}/post-state`, { method: 'PUT', body: JSON.stringify(data) }),
    saveCosts:    (taskId: number, data: any) => request<any>(`/emergency-result/${taskId}/costs`,      { method: 'PUT', body: JSON.stringify(data) }),
    saveParts:          (taskId: number, parts: any[]) => request<any[]>(`/emergency-result/${taskId}/parts`, { method: 'PUT', body: JSON.stringify({ parts }) }),
    getParts:           (taskId: number)              => request<any[]>(`/emergency-result/${taskId}/parts`),
    deviceHistory:      (contractId: number)          => request<any[]>(`/emergency-result/device/${contractId}/history`),
    getPaymentEntries:  (taskId: number)              => request<any[]>(`/emergency-result/${taskId}/payment-entries`),
    savePaymentEntries: (taskId: number, entries: any[]) => request<any>(`/emergency-result/${taskId}/payment-entries`, { method: 'PUT', body: JSON.stringify({ entries }) }),
    getInstallments:    (taskId: number)              => request<any>(`/emergency-result/${taskId}/installments`),
    saveInstallments:   (taskId: number, data: any)   => request<any>(`/emergency-result/${taskId}/installments`, { method: 'PUT', body: JSON.stringify(data) }),
    confirmInstallments:(taskId: number)              => request<any>(`/emergency-result/${taskId}/installments/confirm`, { method: 'POST' }),
  },
  emergencyTickets: {
    list: (params?: { openTaskId?: number }) => {
      const qs = params?.openTaskId ? `?openTaskId=${params.openTaskId}` : '';
      return request<any[]>(`/emergency-tickets${qs}`);
    },
    create: (data: any) => request<any>('/emergency-tickets', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: any) => request<any>(`/emergency-tickets/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  },
  openTasks: {
    create: (data: any) => request<any>('/open-tasks', { method: 'POST', body: JSON.stringify(data) }),
    listByClient: (clientId: number) => request<any[]>(`/open-tasks/client/${clientId}`),
    get: (id: number) => request<any>(`/open-tasks/${id}`),
    update: (id: number, data: any) => request<any>(`/open-tasks/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    assignTeam: (id: number, data: { supervisorId?: number; technicianId?: number; traineeId?: number }) =>
      request<any>(`/open-tasks/${id}/assign-team`, { method: 'POST', body: JSON.stringify(data) }),
    /** DEC-004 D22: book a field_visit from a needs_follow_up task using its expected_date. */
    scheduleFromExpected: (id: number, data: {
      date?: string;
      timeSlot?: string;
      teamKey: string;
      notes?: string | null;
    }) => request<{ fieldVisitId: number; visitTaskIds: number[] }>(
      `/open-tasks/${id}/schedule-from-expected`,
      { method: 'POST', body: JSON.stringify(data) },
    ),
    getEmergencyResult: (id: number) => request<any>(`/open-tasks/${id}/emergency-result`),
    submitEmergencyResult: (id: number, data: any) =>
      request<any>(`/open-tasks/${id}/emergency-result`, { method: 'POST', body: JSON.stringify(data) }),
    listDeviceDemo: (params: { branchId: number; status?: string; visitStatus?: string; scheduledDate?: string; scheduled?: 'yes' | 'no'; hideSnoozed?: 'true' }) => {
      const q = new URLSearchParams({ branchId: String(params.branchId) });
      if (params.status) q.set('status', params.status);
      if (params.visitStatus) q.set('visitStatus', params.visitStatus);
      if (params.scheduledDate) q.set('scheduledDate', params.scheduledDate);
      if (params.scheduled) q.set('scheduled', params.scheduled);
      if (params.hideSnoozed) q.set('hideSnoozed', params.hideSnoozed);
      return request<any[]>(`/open-tasks/device-demo?${q}`);
    },
    getActivity: (id: number) => request<any[]>(`/open-tasks/${id}/activity`),
    addActivity: (id: number, data: any) => request<any>(`/open-tasks/${id}/activity`, { method: 'POST', body: JSON.stringify(data) }),
    getDevices: (id: number) => request<any[]>(`/open-tasks/${id}/devices`),
    addDevices: (id: number, data: any) => request<any>(`/open-tasks/${id}/devices`, { method: 'POST', body: JSON.stringify(data) }),
    getCalls: (id: number) => request<any[]>(`/open-tasks/${id}/calls`),
    exclude: (id: number, reason?: string) =>
      request<any>(`/open-tasks/${id}/exclude`, { method: 'POST', body: JSON.stringify({ reason: reason ?? null }) }),
    restore: (id: number) =>
      request<any>(`/open-tasks/${id}/restore`, { method: 'POST', body: JSON.stringify({}) }),
    bulkExclude: (taskIds: number[], reason?: string) =>
      request<{ updated: number }>('/open-tasks/bulk-exclude', { method: 'POST', body: JSON.stringify({ taskIds, reason: reason ?? null }) }),
    bulkRestore: (taskIds: number[]) =>
      request<{ updated: number }>('/open-tasks/bulk-restore', { method: 'POST', body: JSON.stringify({ taskIds }) }),
  },
  contactTargets: {
    manualClose: (taskListId: string, itemId: string, data: { reason?: string; expectedDate?: string; priority?: string }) =>
      request<{ success: boolean }>(`/telemarketing/task-lists/${encodeURIComponent(taskListId)}/items/${encodeURIComponent(itemId)}/close`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    // DEC-005 D26: manual close of a contact_target with optional cooldown activation
    close: (contactTargetId: number, data: {
      closingReason?: string;
      activateCooldown?: boolean;
      cooldownReason?: string;
      cooldownDays?: number;
    }) => request<{ contactTarget: any; cooldown: any | null }>(`/contact-targets/${contactTargetId}/close`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  },
  visits: {
    list: () => request<any[]>('/visits'),
    create: (data: any) => request<any>('/visits', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: any) => request<any>(`/visits/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  },
  schedules: {
    get: (date: string) => request<any>(`/schedules/${date}`),
    save: (date: string, data: any) => request<any>(`/schedules/${date}`, { method: 'PUT', body: JSON.stringify(data) }),
  },
  routeAssignments: {
    list: () => request<Record<string, any>>('/route-assignments'),
    get: (key: string) => request<any>(`/route-assignments/${key}`),
    save: (key: string, data: any) => request<any>(`/route-assignments/${key}`, { method: 'PUT', body: JSON.stringify(data) }),
  },
  planning: {
    assignedTasks: (date: string, teamKey: string) => {
      const query = new URLSearchParams({ date, teamKey });
      return request<any>(`/planning/assigned-tasks?${query.toString()}`);
    },
    marketingTargets: (date: string, teamKey: string, mode: 'planning' | 'assigned' = 'planning') => {
      const query = new URLSearchParams({ date, teamKey, mode });
      return request<any>(`/planning/marketing-targets?${query.toString()}`);
    },
  },
  workScopes: {
    get: (date: string, teamKey: string, branchId?: number) => {
      const qs = branchId ? `?branchId=${branchId}` : '';
      return request<any>(`/work-scopes/${encodeURIComponent(date)}/${encodeURIComponent(teamKey)}${qs}`);
    },
    create: (data: { date: string; teamKey: string; zoneIds?: number[]; scopeType?: string; branchId?: number }) =>
      request<any>('/work-scopes', { method: 'POST', body: JSON.stringify(data) }),
    activate: (id: number) =>
      request<any>(`/work-scopes/${id}/activate`, { method: 'PUT' }),
    generateTasks: (id: number) =>
      request<any>(`/work-scopes/${id}/generate-tasks`, { method: 'POST' }),
  },
  fieldVisits: {
    list: (params: { clientId?: number; date?: string }) => {
      const qs = new URLSearchParams();
      if (params.clientId) qs.append('clientId', String(params.clientId));
      if (params.date) qs.append('date', params.date);
      return request<any[]>(`/field-visits/?${qs.toString()}`);
    },
    get: (id: number) => request<any>(`/field-visits/${id}`),
    start: (id: number, data?: { lat?: number; lng?: number; accuracy?: number }) =>
      request<any>(`/field-visits/${id}/start`, { method: 'POST', body: JSON.stringify(data ?? {}) }),
    end: (id: number, data?: { lat?: number; lng?: number; accuracy?: number }) =>
      request<any>(`/field-visits/${id}/end`, { method: 'POST', body: JSON.stringify(data ?? {}) }),
    complete: (id: number) =>
      request<any>(`/field-visits/${id}/complete`, { method: 'POST' }),
    getGeo: (id: number) => request<any>(`/field-visits/${id}/geo`),
    getSource: (id: number) => request<any>(`/field-visits/${id}/source`),
    createNameCollection: (taskId: number, data: { proposed_count: number }) =>
      request<any>(`/field-visits/visit-tasks/${taskId}/name-collection`, { method: 'POST', body: JSON.stringify(data) }),
    recordNames: (ncId: number, data: { actual_count: number; notes?: string }) =>
      request<any>(`/field-visits/name-collections/${ncId}/record-names`, { method: 'PUT', body: JSON.stringify(data) }),
    getNameCollection: (ncId: number) => request<any>(`/field-visits/name-collections/${ncId}`),
    addDirectSuggestion: (taskId: number, data: { name: string; phone?: string; notes?: string }) =>
      request<any>(`/field-visits/visit-tasks/${taskId}/direct-suggestions`, { method: 'POST', body: JSON.stringify(data) }),
    listDirectSuggestions: (taskId: number) =>
      request<any[]>(`/field-visits/visit-tasks/${taskId}/direct-suggestions`),
    /** DEC-003 D7 expanded: add an in-flight visit_task to an in_progress field_visit. */
    addTask: (id: number, data: {
      taskType: string;
      openTaskId?: number;
      reason?: string;
    }) => request<{ visitTaskId: number; sequenceNo: number; openTaskId: number }>(
      `/field-visits/${id}/tasks`,
      { method: 'POST', body: JSON.stringify(data) },
    ),
  },
  marketingVisits: {
    list: (date: string, clientId?: number) => {
      const qs = new URLSearchParams();
      if (date) qs.append('date', date);
      if (clientId) qs.append('clientId', String(clientId));
      const query = qs.toString() ? `?${qs.toString()}` : '';
      return request<any[]>(`/marketing-visits${query}`);
    },
    get: (id: string) => request<any>(`/marketing-visits/${id}`),
    updateResult: (id: string, data: any) => request<any>(`/marketing-visits/${id}/result`, { method: 'PATCH', body: JSON.stringify(data) }),
    updateTaskResult: (visitId: string, taskId: string, data: any) => request<any>(`/marketing-visits/${visitId}/tasks/${taskId}/result`, { method: 'PATCH', body: JSON.stringify(data) }),
    updateStatus: (visitId: string, status: string, gps?: { lat: number; lng: number; accuracy: number | null }) =>
      request<any>(`/marketing-visits/${visitId}/status`, { method: 'PATCH', body: JSON.stringify({ status, gps: gps ?? null }) }),
    updateTaskOutcome: (visitId: string, taskId: string, data: any) =>
      request<any>(`/marketing-visits/${visitId}/tasks/${taskId}/outcome`, { method: 'PATCH', body: JSON.stringify(data) }),
    reschedule: (visitId: string, data: MarketingVisitRescheduleRequest) =>
      request<any>(`/marketing-visits/${visitId}/reschedule`, { method: 'PATCH', body: JSON.stringify(data) }),
    cancel: (visitId: string, data: MarketingVisitCancelRequest) =>
      request<any>(`/marketing-visits/${visitId}/cancel`, { method: 'PATCH', body: JSON.stringify(data) }),
    close: (visitId: string, closingNotes?: string) =>
      request<any>(`/marketing-visits/${visitId}/close`, {
        method: 'POST',
        body: JSON.stringify({ closingNotes: closingNotes ?? null }),
      }),
    linkOfferContract: (visitId: string, taskId: string, offerId: number, contractId: number) =>
      request<any>(`/marketing-visits/${visitId}/tasks/${taskId}/offers/${offerId}/contract`, {
        method: 'PATCH',
        body: JSON.stringify({ contractId }),
      }),
    updateTeam: (visitId: string, data: {
      supervisorEmployeeId?: number | null;
      technicianEmployeeId?: number | null;
      traineeEmployeeId?: number | null;
      telemarketerEmployeeIds?: number[];
    }) => request<any>(`/marketing-visits/${visitId}/team`, { method: 'PATCH', body: JSON.stringify(data) }),
  },
telemarketing: {
    snapshot: (date?: string) => {
      const qs = date ? `?date=${encodeURIComponent(date)}` : '';
      return request<{ taskLists: any[]; appointments: any[]; callLogs: any[] }>(`/telemarketing/snapshot${qs}`);
    },
    upsertTaskList: (data: any) => request<any>('/telemarketing/task-lists/upsert', { method: 'POST', body: JSON.stringify(data) }),
    generateTaskListFromPlan: (data: { date: string; teamKey: string }) => request<any>('/telemarketing/task-lists/generate-from-plan', { method: 'POST', body: JSON.stringify(data) }),
    updateTaskListItem: (taskListId: string, itemId: string, data: any) => request<any>(`/telemarketing/task-lists/${taskListId}/items/${itemId}`, { method: 'PATCH', body: JSON.stringify(data) }),
    createCallLog: (data: any) => request<any>('/telemarketing/call-logs', { method: 'POST', body: JSON.stringify(data) }),
    /** @deprecated since DEC-003 D2 — use bookVisit. Kept for callers not yet migrated. */
    createAppointment: (data: any) => request<any>('/telemarketing/appointments', { method: 'POST', body: JSON.stringify(data) }),
    /** DEC-003 D2 canonical booking endpoint — creates field_visit directly. */
    bookVisit: (data: {
      clientId?: number;
      date: string;
      timeSlot: string;
      teamKey: string;
      taskListId?: string;
      taskListItemId?: string;
      callLogId?: string | number;
      selectedOpenTasks?: Array<{ openTaskId: number; taskType: string }>;
      customerSnapshot?: Record<string, unknown> | null;
      notes?: string | null;
    }) => request<{ fieldVisitId: number; visitTaskIds: number[]; contactTargetId: number | null }>(
      '/telemarketing/book-visit',
      { method: 'POST', body: JSON.stringify(data) },
    ),
    taskTypeOptions: () => request<{ taskType: string; arabicLabel: string; taskFamily: string }[]>('/telemarketing/task-type-options'),
    createServiceTask: (data: { clientId: number; taskType: string; notes?: string; priority?: string }) =>
      request<any>('/telemarketing/service-tasks', { method: 'POST', body: JSON.stringify(data) }),
  },
  systemLists: {
    list: (params?: { category?: string; activeOnly?: boolean }) => {
      const query = new URLSearchParams();
      if (params?.category) query.append('category', params.category);
      if (params?.activeOnly) query.append('activeOnly', 'true');
      const qs = query.toString() ? `?${query.toString()}` : '';
      return request<any[]>(`/system-lists${qs}`);
    },
    getItemsByCode: (code: string) => request<any[]>(`/system-lists/${code}/items`),
    create: (data: any) => request<any>('/system-lists', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: any) => request<any>(`/system-lists/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: number) => request<any>(`/system-lists/${id}`, { method: 'DELETE' }),
  },
  departments: {
    list: (branchId?: number) => {
      const qs = branchId != null ? `?branchId=${branchId}` : '';
      return request<any[]>(`/departments${qs}`);
    },
    get: (id: number) => request<any>(`/departments/${id}`),
    create: (data: any) => request<any>('/departments', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: any) => request<any>(`/departments/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: number) => request<any>(`/departments/${id}`, { method: 'DELETE' }),
  },
};
