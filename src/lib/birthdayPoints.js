import { api } from '@/api/client';

/**
 * Поздравительное начисление баллов ко дню рождения.
 *
 * Раньше эта логика жила целиком на клиенте и писала напрямую в wallet_transactions.
 * После введения RLS такая запись разрешена только роли HR, поэтому у рядового
 * сотрудника начисление молча не срабатывало (ошибка глоталась). Теперь всё решает
 * серверная SECURITY DEFINER-функция claim_birthday_bonus():
 *   * начисляет строго в сам день рождения;
 *   * идемпотентна в пределах календарного года;
 *   * берёт размер поощрения из справочника award_reasons (код `birthday`);
 *   * одной транзакцией создаёт операцию по баллам и достижение.
 */

/** Сегодня ли день рождения (без учёта года). */
export function isBirthdayToday(birthDate, at = new Date()) {
  if (!birthDate) return false;
  const bd = typeof birthDate === 'string' ? new Date(`${birthDate.slice(0, 10)}T00:00:00`) : birthDate;
  if (Number.isNaN(bd?.getTime?.())) return false;
  return bd.getMonth() === at.getMonth() && bd.getDate() === at.getDate();
}

/**
 * Запрашивает начисление. Возвращает
 * { awarded: true, points } либо { awarded: false, reason }.
 * reason: no_employee | not_today | already_claimed | no_rule
 */
export async function claimBirthdayBonus() {
  const { data, error } = await api.supabase.rpc('claim_birthday_bonus');
  if (error) return { awarded: false, reason: 'error', error };
  return data || { awarded: false, reason: 'unknown' };
}

export default claimBirthdayBonus;
