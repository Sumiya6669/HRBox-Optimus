/**
 * Человеческие сообщения об ошибках мутаций.
 *
 * Аудит: при нарушении уникального индекса или RLS-политики пользователь видел
 * сырой текст Postgres («duplicate key value violates unique constraint …»),
 * а иногда вообще ничего. Здесь коды переводятся в понятные фразы, а страница
 * может уточнить формулировку для своего случая (BUG-013, BUG-008, BUG-082).
 */

export const PG_UNIQUE_VIOLATION = '23505';
export const PG_FOREIGN_KEY_VIOLATION = '23503';
export const PG_NOT_NULL_VIOLATION = '23502';
export const PG_CHECK_VIOLATION = '23514';
export const PG_INSUFFICIENT_PRIVILEGE = '42501';
// BUG-020: серверные триггеры портала (например validate_survey_session) сигналят 22023.
export const PG_INVALID_PARAMETER = '22023';

const GENERIC = {
  [PG_UNIQUE_VIOLATION]: 'Такая запись уже существует',
  [PG_FOREIGN_KEY_VIOLATION]: 'Есть связанные записи — сначала удалите или отвяжите их',
  [PG_NOT_NULL_VIOLATION]: 'Не заполнено обязательное поле',
  [PG_CHECK_VIOLATION]: 'Значение не проходит проверку базы данных',
  [PG_INSUFFICIENT_PRIVILEGE]: 'Недостаточно прав для этой операции',
  [PG_INVALID_PARAMETER]: 'Недопустимое значение: операция отклонена правилом базы данных',
};

/**
 * mutationErrorMessage(error, { 23505: 'Новость с таким заголовком и датой уже существует' })
 * @param {{code?: string, status?: number, message?: string}} error
 * @param {Record<string, string>} overrides — уточнения по коду для конкретной страницы
 */
export function mutationErrorMessage(error, overrides = {}) {
  const code = error?.code ? String(error.code) : null;
  if (code && overrides[code]) return overrides[code];
  if (code && GENERIC[code]) return GENERIC[code];
  if (error?.status === 401 || error?.status === 403 || error?.isForbidden) {
    return GENERIC[PG_INSUFFICIENT_PRIVILEGE];
  }
  return error?.message || 'Не удалось выполнить операцию. Попробуйте ещё раз.';
}

/** Ошибка — нарушение уникальности (дубль). */
export function isDuplicateError(error) {
  return String(error?.code || '') === PG_UNIQUE_VIOLATION;
}

export default mutationErrorMessage;
