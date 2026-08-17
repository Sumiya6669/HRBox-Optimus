import React, { createContext, useState, useContext, useEffect, useCallback, useMemo } from 'react';
import { api } from '@/api/client';
import { supabase } from '@/api/supabase';

/**
 * Аутентификация портала на Supabase Auth.
 * BUG-001: раньше слоя auth не было вовсе — UI показывал «HR-админ» анонимному посетителю.
 * BUG-006: logout действительно уничтожает сессию.
 * BUG-034: роль берётся из сессии (profiles.role), а не из константы в интерфейсе.
 */

const AuthContext = createContext(null);

export const ROLES = {
  EMPLOYEE: 'employee',
  MANAGER: 'manager',
  HR: 'hr',
  ADMIN: 'admin',
};

/** Иерархия ролей: каждая следующая включает права предыдущих. */
const ROLE_RANK = { employee: 1, manager: 2, hr: 3, admin: 4 };

export const ROLE_LABELS = {
  employee: 'Сотрудник',
  manager: 'Руководитель',
  hr: 'HR-специалист',
  admin: 'Администратор',
};

export const AuthProvider = ({ children }) => {
  const [session, setSession] = useState(null);
  const [user, setUser] = useState(null);
  const [employee, setEmployee] = useState(null);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [authError, setAuthError] = useState(null);

  const loadProfile = useCallback(async (activeSession) => {
    if (!activeSession) {
      setUser(null);
      setEmployee(null);
      setAuthError(null);
      setIsLoadingAuth(false);
      return;
    }
    try {
      const profile = await api.auth.me();
      setUser(profile);
      setAuthError(null);
      // Связь User ↔ Employee (P0 из аудита): без неё личный кабинет остаётся пустым.
      if (profile?.employee_id) {
        const emp = await api.entities.Employee.get(profile.employee_id).catch(() => null);
        setEmployee(emp);
      } else if (profile?.email) {
        const found = await api.entities.Employee.filter({ email: profile.email }).catch(() => []);
        setEmployee(found?.[0] || null);
      } else {
        setEmployee(null);
      }
    } catch (error) {
      if (error?.code === 'user_not_registered') {
        setAuthError({ type: 'user_not_registered', message: error.message });
      } else {
        setAuthError({ type: 'unknown', message: error?.message || 'Не удалось загрузить профиль' });
      }
      setUser(null);
      setEmployee(null);
    } finally {
      setIsLoadingAuth(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      setSession(data?.session || null);
      loadProfile(data?.session || null);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (cancelled) return;
      setSession(nextSession);
      if (event === 'SIGNED_OUT') {
        setUser(null);
        setEmployee(null);
        setIsLoadingAuth(false);
        return;
      }
      if (event === 'TOKEN_REFRESHED') return;
      setIsLoadingAuth(true);
      loadProfile(nextSession);
    });

    return () => {
      cancelled = true;
      sub?.subscription?.unsubscribe();
    };
  }, [loadProfile]);

  const logout = useCallback(async () => {
    await api.auth.logout('/login');
  }, []);

  const role = user?.role || null;

  const hasRole = useCallback(
    (required) => {
      if (!required) return true;
      if (!role) return false;
      const list = Array.isArray(required) ? required : [required];
      const needed = Math.min(...list.map((r) => ROLE_RANK[r] ?? 99));
      return (ROLE_RANK[role] ?? 0) >= needed;
    },
    [role]
  );

  const value = useMemo(
    () => ({
      session,
      user,
      employee,
      employeeId: employee?.id || null,
      role,
      roleLabel: role ? ROLE_LABELS[role] : null,
      isAuthenticated: !!session && !!user,
      isLoadingAuth,
      authError,
      hasRole,
      isAdmin: hasRole(ROLES.ADMIN),
      isHR: hasRole(ROLES.HR),
      isManager: hasRole(ROLES.MANAGER),
      logout,
      refresh: () => loadProfile(session),
    }),
    [session, user, employee, role, isLoadingAuth, authError, hasRole, logout, loadProfile]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth должен использоваться внутри AuthProvider');
  return context;
};
