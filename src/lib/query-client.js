import { QueryClient } from '@tanstack/react-query';

/*
 * ЭТАП 6 аудита: Course и Book перезапрашивались при каждом входе на страницу,
 * кеша не было, а скелетоны держались ~3 с даже при прогретых данных.
 */
export const queryClientInstance = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 60_000,
      gcTime: 10 * 60_000,
      retry: (failureCount, error) => {
        // Ошибку прав повторять бессмысленно — показываем её пользователю сразу.
        if (error?.isForbidden || error?.status === 401 || error?.status === 403) return false;
        return failureCount < 2;
      },
    },
    mutations: { retry: 0 },
  },
});

export default queryClientInstance;
