import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { useAuth } from '@/lib/AuthContext';
import { claimBirthdayBonus, isBirthdayToday } from '@/lib/birthdayPoints';
import { formatPoints } from '@/lib/format';
import { useToast } from '@/components/ui/use-toast';

/**
 * Разово за сессию проверяет, положено ли сотруднику поздравительное начисление.
 * Вся проверка прав и защита от повторов — на сервере (claim_birthday_bonus).
 */
export function useBirthdayPoints() {
  const { employee } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const attempted = useRef(false);

  useEffect(() => {
    if (attempted.current) return;
    if (!employee?.id || !isBirthdayToday(employee.birth_date)) return;

    attempted.current = true;
    let cancelled = false;

    claimBirthdayBonus().then((result) => {
      if (cancelled || !result?.awarded) return;
      toast({
        title: 'С днём рождения! 🎂',
        description: `Вам начислено ${formatPoints(result.points)}.`,
      });
      queryClient.invalidateQueries({ queryKey: ['wallet-balance'] });
      queryClient.invalidateQueries({ queryKey: ['wallet-tx'] });
    });

    return () => {
      cancelled = true;
    };
  }, [employee?.id, employee?.birth_date, toast, queryClient]);
}

export default useBirthdayPoints;
