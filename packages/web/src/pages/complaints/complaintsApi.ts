import { authFetch } from '../../lib/authFetch';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await authFetch(`/api/complaints${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'تعذر تنفيذ العملية');
  return body;
}

export const complaintsApi = {
  list: (query: URLSearchParams) => request<any>(`?${query.toString()}`),
  detail: (id: string | number) => request<any>(`/${id}`),
  create: (body: unknown) => request<any>('', { method: 'POST', body: JSON.stringify(body) }),
  context: (kind: 'visit'|'device', id: string|number) => request<any>(`/context/${kind}/${id}`),
  createBranches: () => request<{items:any[]}>('/lookups/branches'),
  clientOptions: (branchId:number,search='') => request<{items:any[]}>(`/lookups/clients?branchId=${branchId}&search=${encodeURIComponent(search)}`),
  clientOption: (clientId:number,branchId:number) => request<any>(`/lookups/clients/${clientId}?branchId=${branchId}`),
  clientDevices: (clientId:number,branchId:number) => request<{items:any[]}>(`/lookups/clients/${clientId}/devices?branchId=${branchId}`),
  clientVisits: (clientId:number,branchId:number) => request<{items:any[]}>(`/lookups/clients/${clientId}/visits?branchId=${branchId}`),
  command: (id: string | number, action: string, body: unknown = {}) => request<any>(`/${id}/${action}`, { method: 'POST', body: JSON.stringify(body) }),
  changePriority: (id: string | number, priority: string) => request<any>(`/${id}/change-priority`, { method: 'PATCH', body: JSON.stringify({ priority }) }),
  openAttachment: async (id:string|number,attachmentId:string|number) => {
    const response=await authFetch(`/api/complaints/${id}/attachments/${attachmentId}`);
    if(!response.ok)throw new Error('تعذر فتح صورة الشكوى');
    const url=URL.createObjectURL(await response.blob());window.open(url,'_blank','noopener,noreferrer');setTimeout(()=>URL.revokeObjectURL(url),60_000);
  },
};
