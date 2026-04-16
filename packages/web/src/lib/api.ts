const API_BASE = '/api';

// Read token from localStorage at call time (not at import time)
function getToken(): string | null {
  return localStorage.getItem('hr_token');
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options?.headers as Record<string, string>),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

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

/** Response envelope returned by all paginated list endpoints. */
export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface PageParams {
  page?: number;
  limit?: number;
  search?: string;
}

function buildPageQuery(params: PageParams): string {
  const q = new URLSearchParams();
  if (params.page !== undefined) q.set('page', String(params.page));
  if (params.limit !== undefined) q.set('limit', String(params.limit));
  if (params.search?.trim()) q.set('search', params.search.trim());
  const qs = q.toString();
  return qs ? `?${qs}` : '';
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
    create: (data: any) => request<any>('/branches', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: any) => request<any>(`/branches/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: number) => request<any>(`/branches/${id}`, { method: 'DELETE' }),
  },
  employees: {
    list: () => request<any[]>('/employees'),
    listPaged: (params: PageParams) => request<PaginatedResult<any>>(`/employees${buildPageQuery(params)}`),
    get: (id: number) => request<any>(`/employees/${id}`),
    create: (data: any) => request<any>('/employees', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: any) => request<any>(`/employees/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    upsertSystemAccount: (id: number, data: any) => request<any>(`/employees/${id}/system-account`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: number) => request<any>(`/employees/${id}`, { method: 'DELETE' }),
  },
  clients: {
    list: () => request<any[]>('/clients'),
    listPaged: (params: PageParams) => request<PaginatedResult<any>>(`/clients${buildPageQuery(params)}`),
    get: (id: number) => request<any>(`/clients/${id}`),
    create: (data: any) => request<any>('/clients', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: any) => request<any>(`/clients/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: number) => request<any>(`/clients/${id}`, { method: 'DELETE' }),
    bulkDelete: (ids: number[]) => request<any>('/clients/bulk-delete', { method: 'POST', body: JSON.stringify({ ids }) }),
  },
  candidates: {
    list: () => request<any[]>('/candidates'),
    listPaged: (params: PageParams) => request<PaginatedResult<any>>(`/candidates${buildPageQuery(params)}`),
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
    listPaged: (params: PageParams) => request<PaginatedResult<any>>(`/contracts${buildPageQuery(params)}`),
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
};
