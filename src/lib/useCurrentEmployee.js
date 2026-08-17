import { useAuth } from '@/lib/AuthContext';

/**
 * Текущий пользователь и связанный с ним сотрудник.
 * Единая точка правды: и роль, и карточка сотрудника берутся из AuthContext,
 * поэтому шапка, профиль и личные разделы больше не противоречат друг другу (BUG-034).
 */
export function useCurrentEmployee() {
  const { user, employee, isLoadingAuth, role, roleLabel } = useAuth();
  return {
    me: user,
    employee,
    // Раньше здесь был фолбэк на me.id — из-за него фильтры молча возвращали пустоту.
    employeeId: employee?.id || null,
    role,
    roleLabel,
    isLinked: !!employee,
    isLoading: isLoadingAuth,
  };
}

export default useCurrentEmployee;
