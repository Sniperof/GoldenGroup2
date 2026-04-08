import { type ReactNode } from 'react';
import { useAuthStore } from '../hooks/useAuthStore';

interface PermissionGateProps {
  /** Single permission key — user must have this permission */
  permission?: string;
  /** Multiple keys — user must have AT LEAST ONE (OR logic) */
  anyOf?: string[];
  /** Content to render if denied (default: nothing) */
  fallback?: ReactNode;
  children: ReactNode;
}

export default function PermissionGate({ permission, anyOf, fallback = null, children }: PermissionGateProps) {
  const hasPermission = useAuthStore(s => s.hasPermission);
  const hasAnyPermission = useAuthStore(s => s.hasAnyPermission);

  // Dev mode fallback: if no auth data exists, allow everything
  const hasAuthData = localStorage.getItem('hr_user') !== null;
  if (!hasAuthData) {
    return <>{children}</>;
  }

  const allowed = permission
    ? hasPermission(permission)
    : anyOf
      ? hasAnyPermission(...anyOf)
      : true;

  return allowed ? <>{children}</> : <>{fallback}</>;
}
