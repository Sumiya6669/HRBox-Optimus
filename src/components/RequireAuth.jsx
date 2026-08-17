import React from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import AccessDenied from '@/components/AccessDenied';
import BrandLoader from '@/components/common/BrandLoader';

/**
 * Гейт доступа ко всем маршрутам портала (BUG-001).
 * `roles` — минимальная требуемая роль или список ролей.
 */
export default function RequireAuth({ roles = null, children }) {
  const { isAuthenticated, isLoadingAuth, authError, hasRole } = useAuth();
  const location = useLocation();

  if (isLoadingAuth) return <BrandLoader />;

  if (authError?.type === 'user_not_registered') return <UserNotRegisteredError />;

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }

  if (roles && !hasRole(roles)) return <AccessDenied requiredRoles={roles} />;

  return children ?? <Outlet />;
}
