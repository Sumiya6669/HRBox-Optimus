/**
 * Каталог разделов портала — единый источник правды для прав доступа.
 *
 * Раньше доступ был размазан по трём местам: маршрут в App.jsx, пункт меню в
 * PortalShell.jsx и проверка внутри самой страницы. Они расходились: пункт меню
 * пропадал, а маршрут открывался по прямой ссылке. Теперь у раздела один ключ,
 * и по нему работают и меню, и роутер, и экран настройки прав.
 *
 * `minRole` — жёсткий пол, ниже которого раздел не открывается НИКОГДА, даже
 * если администратор поставит галочку. Это защита от случая «выдал сотруднику
 * доступ к аудиту, а RLS его всё равно не пускает» — вместо пустого экрана с
 * ошибкой человек просто не увидит раздел. Настройка прав работает ВНУТРИ
 * этого пола, а не поверх него.
 */

export const SECTION_GROUPS = [
  { key: 'company', title: 'Компания' },
  { key: 'cabinet', title: 'Личный кабинет' },
  { key: 'admin_hr', title: 'Администрирование · Персонал' },
  { key: 'admin_content', title: 'Администрирование · Контент и обучение' },
  { key: 'admin_process', title: 'Администрирование · Процессы' },
  { key: 'admin_points', title: 'Администрирование · Баллы и признание' },
  { key: 'admin_surveys', title: 'Администрирование · Опросы' },
  { key: 'admin_system', title: 'Администрирование · Система' },
];

/**
 * key      — ключ в таблице role_permissions;
 * title    — как раздел называется в настройке прав;
 * group    — группа в матрице прав;
 * minRole  — минимальная роль, ниже которой раздел недоступен всегда;
 * locked   — раздел нельзя выключить для указанных ролей (защита от самоблокировки).
 */
export const SECTIONS = [
  { key: 'company.home', title: 'Главная и страницы компании', group: 'company', minRole: 'employee' },

  { key: 'cabinet.dashboard', title: 'Сводка кабинета', group: 'cabinet', minRole: 'employee', locked: ['employee', 'manager', 'hr', 'admin'] },
  { key: 'cabinet.requests', title: 'Заявки', group: 'cabinet', minRole: 'employee' },
  { key: 'cabinet.processes', title: 'Процессы и мои заявки', group: 'cabinet', minRole: 'employee' },
  { key: 'cabinet.goals', title: 'Цели', group: 'cabinet', minRole: 'employee' },
  { key: 'cabinet.kpi', title: 'KPI', group: 'cabinet', minRole: 'employee' },
  { key: 'cabinet.development', title: 'Развитие', group: 'cabinet', minRole: 'employee' },
  { key: 'cabinet.vacation', title: 'Отпуск', group: 'cabinet', minRole: 'employee' },
  { key: 'cabinet.learning', title: 'Обучение и курсы', group: 'cabinet', minRole: 'employee' },
  { key: 'cabinet.library', title: 'Библиотека', group: 'cabinet', minRole: 'employee' },
  { key: 'cabinet.documents', title: 'HR-документы', group: 'cabinet', minRole: 'employee' },
  { key: 'cabinet.files', title: 'Файлы', group: 'cabinet', minRole: 'employee' },
  { key: 'cabinet.news', title: 'Новости', group: 'cabinet', minRole: 'employee' },
  { key: 'cabinet.calendar', title: 'Календарь', group: 'cabinet', minRole: 'employee' },
  { key: 'cabinet.surveys', title: 'Опросы', group: 'cabinet', minRole: 'employee' },
  { key: 'cabinet.feedback', title: 'Обратная связь', group: 'cabinet', minRole: 'employee' },
  { key: 'cabinet.wallet', title: 'Баллы и кошелёк', group: 'cabinet', minRole: 'employee' },
  { key: 'cabinet.store', title: 'Магазин наград', group: 'cabinet', minRole: 'employee' },
  { key: 'cabinet.favorites', title: 'Избранное', group: 'cabinet', minRole: 'employee' },
  { key: 'cabinet.notifications', title: 'Уведомления', group: 'cabinet', minRole: 'employee' },
  { key: 'cabinet.profile', title: 'Профиль', group: 'cabinet', minRole: 'employee', locked: ['employee', 'manager', 'hr', 'admin'] },

  { key: 'admin.overview', title: 'Сводка администрирования', group: 'admin_hr', minRole: 'hr' },
  { key: 'admin.employees', title: 'Сотрудники', group: 'admin_hr', minRole: 'hr' },
  { key: 'admin.departments', title: 'Подразделения и филиалы', group: 'admin_hr', minRole: 'hr' },
  { key: 'admin.users', title: 'Пользователи и доступы', group: 'admin_hr', minRole: 'admin', locked: ['admin'] },
  { key: 'admin.permissions', title: 'Права доступа', group: 'admin_hr', minRole: 'admin', locked: ['admin'] },

  { key: 'admin.news', title: 'Управление новостями', group: 'admin_content', minRole: 'hr' },
  { key: 'admin.pages', title: 'Страницы портала', group: 'admin_content', minRole: 'hr' },
  { key: 'admin.files', title: 'Файловое хранилище', group: 'admin_content', minRole: 'hr' },
  { key: 'admin.courses', title: 'Курсы', group: 'admin_content', minRole: 'hr' },
  { key: 'admin.library', title: 'Библиотека', group: 'admin_content', minRole: 'hr' },

  { key: 'admin.processes', title: 'Конструктор процессов', group: 'admin_process', minRole: 'hr' },
  { key: 'admin.process_requests', title: 'Очередь согласования', group: 'admin_process', minRole: 'hr' },

  { key: 'admin.achievements', title: 'Достижения', group: 'admin_points', minRole: 'hr' },
  { key: 'admin.achievement_rules', title: 'Автоправила достижений', group: 'admin_points', minRole: 'hr' },
  { key: 'admin.store', title: 'Каталог магазина', group: 'admin_points', minRole: 'hr' },
  { key: 'admin.wallet', title: 'Операции с баллами', group: 'admin_points', minRole: 'hr' },
  { key: 'admin.wallet_reports', title: 'Аналитика по баллам', group: 'admin_points', minRole: 'hr' },
  { key: 'admin.award_reasons', title: 'Справочник причин', group: 'admin_points', minRole: 'hr' },

  { key: 'admin.surveys', title: 'Опросы', group: 'admin_surveys', minRole: 'hr' },
  { key: 'admin.survey_sessions', title: 'Запуски опросов', group: 'admin_surveys', minRole: 'hr' },
  { key: 'admin.survey_auto', title: 'Автоопросы', group: 'admin_surveys', minRole: 'hr' },
  { key: 'admin.survey_reports', title: 'Отчёты по опросам', group: 'admin_surveys', minRole: 'hr' },

  { key: 'admin.vacation', title: 'График отпусков', group: 'admin_system', minRole: 'hr' },
  { key: 'admin.settings', title: 'Настройки портала', group: 'admin_system', minRole: 'admin', locked: ['admin'] },
  { key: 'admin.audit', title: 'Журнал действий', group: 'admin_system', minRole: 'admin' },
];

export const SECTION_BY_KEY = Object.fromEntries(SECTIONS.map((s) => [s.key, s]));

/** Разделы группы — в порядке объявления, чтобы матрица не «прыгала». */
export function sectionsByGroup(groupKey) {
  return SECTIONS.filter((s) => s.group === groupKey);
}

/** Раздел заблокирован для роли — галочку показываем, но выключить нельзя. */
export function isSectionLocked(sectionKey, role) {
  const section = SECTION_BY_KEY[sectionKey];
  return !!section?.locked?.includes(role);
}

/** Иерархия ролей: каждая следующая включает права предыдущих. */
export const ROLE_RANK = { employee: 1, manager: 2, hr: 3, admin: 4 };

/**
 * Доступен ли раздел роли с учётом настроенных прав. Чистая функция — её же
 * используют и меню, и роутер, и тесты, чтобы решение было ровно одно.
 *
 * @param sectionKey  ключ раздела; пустой означает «раздел не размечен» → доступен
 * @param role        роль пользователя
 * @param permissions карта {ключ: boolean} или null, если права ещё не загружены
 */
export function evaluateAccess(sectionKey, role, permissions) {
  if (!sectionKey) return true;
  const section = SECTION_BY_KEY[sectionKey];

  // Жёсткий пол роли: администратор не может выдать сотруднику раздел, куда его
  // всё равно не пустит база. Иначе вместо экрана человек увидит ошибку доступа.
  if (section?.minRole && (ROLE_RANK[role] ?? 0) < ROLE_RANK[section.minRole]) return false;

  // Права ещё не загрузились — не мигаем «нет доступа» на полсекунды.
  if (!permissions) return true;

  // Нет записи = «разрешено на уровне роли». Иначе каждый новый раздел в коде
  // оказался бы закрыт для всех до первого сохранения настроек — включая
  // администратора, который эти настройки и правит.
  const explicit = permissions[sectionKey];
  return explicit === undefined ? true : explicit === true;
}
