import { useAuthStore } from './useAuthStore';

export function usePermissions() {
  const permissions = useAuthStore(s => s.permissions);
  const hasPermission = useAuthStore(s => s.hasPermission);
  const hasAnyPermission = useAuthStore(s => s.hasAnyPermission);
  return { permissions, hasPermission, hasAnyPermission };
}
