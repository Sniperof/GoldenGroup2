import { shouldAttachBranchContextHeader } from './branchContext';

const API_BASE = '/api';

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
  },
  employees: {
    list: () => request<any[]>('/employees'),
    schedulePool: () => request<any[]>('/employees/schedule-pool'),
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
    list: () => request<any[]>('/contracts'),
    create: (data: any) => request<any>('/contracts', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: any) => request<any>(`/contracts/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: number) => request<any>(`/contracts/${id}`, { method: 'DELETE' }),
  },
  dues: {
    list: () => request<any[]>('/dues'),
    update: (id: number, data: any) => request<any>(`/dues/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  },
  deviceModels: {
    list: () => request<any[]>('/device-models'),
    create: (data: any) => request<any>('/device-models', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: any) => request<any>(`/device-models/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: number) => request<any>(`/device-models/${id}`, { method: 'DELETE' }),
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
  emergencyTickets: {
    list: () => request<any[]>('/emergency-tickets'),
    create: (data: any) => request<any>('/emergency-tickets', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: any) => request<any>(`/emergency-tickets/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
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
    marketingTargets: (date: string, teamKey: string) => {
      const query = new URLSearchParams({ date, teamKey });
      return request<any>(`/planning/marketing-targets?${query.toString()}`);
    },
  },
  telemarketing: {
    snapshot: () => request<{ taskLists: any[]; appointments: any[]; callLogs: any[] }>('/telemarketing/snapshot'),
    upsertTaskList: (data: any) => request<any>('/telemarketing/task-lists/upsert', { method: 'POST', body: JSON.stringify(data) }),
    updateTaskListItem: (taskListId: string, itemId: string, data: any) => request<any>(`/telemarketing/task-lists/${taskListId}/items/${itemId}`, { method: 'PATCH', body: JSON.stringify(data) }),
    createCallLog: (data: any) => request<any>('/telemarketing/call-logs', { method: 'POST', body: JSON.stringify(data) }),
    createAppointment: (data: any) => request<any>('/telemarketing/appointments', { method: 'POST', body: JSON.stringify(data) }),
  },
  systemLists: {
    list: (params?: { category?: string; activeOnly?: boolean }) => {
      const query = new URLSearchParams();
      if (params?.category) query.append('category', params.category);
      if (params?.activeOnly) query.append('activeOnly', 'true');
      const qs = query.toString() ? `?${query.toString()}` : '';
      return request<any[]>(`/system-lists${qs}`);
    },
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
