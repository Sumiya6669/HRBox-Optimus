import React from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import AccessDenied from '@/components/AccessDenied';
import BrandLoader from '@/components/common/BrandLoader';

/**
 * Гейт доступа ко всем маршрутам портала (BUG-001).
 *
 * `roles`   — минимальная требуемая роль или список ролей;
 * `section` — ключ раздела из src/lib/sections.js.
 *
 * Проверять роль и раздел нужно именно здесь, а не только в меню. Скрытый пункт
 * меню не закрывает страницу: адрес можно набрать руками, и раньше так и
 * получалось — пункта нет, а экран открывается.
 */
export default function RequireAuth({ roles = null, section = null, children }) {
  const { isAuthenticated, isLoadingAuth, authError, hasRole, canAccess } = useAuth();
  const location = useLocation();

  if (isLoadingAuth) return <BrandLoader />;

  if (authError?.type === 'user_not_registered') return <UserNotRegisteredError />;

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }

  if (roles && !hasRole(roles)) return <AccessDenied requiredRoles={roles} />;

  if (section && !canAccess(section)) return <AccessDenied section={section} />;

  return children ?? <Outlet />;
}
