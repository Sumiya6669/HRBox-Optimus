/**
 * BUG-051/052/068: в русском интерфейсе торчали технические английские статусы
 * (active, completed, published, draft, pulse, scorm…) и внутренние имена сущностей.
 * Здесь единый словарь ярлыков и вариантов бейджей.
 */

export const STATUS = {
  // Общие статусы
  active: { label: 'Активен', variant: 'success' },
  inactive: { label: 'Неактивен', variant: 'secondary' },
  draft: { label: 'Черновик', variant: 'secondary' },
  published: { label: 'Опубликовано', variant: 'success' },
  scheduled: { label: 'Запланировано', variant: 'info' },
  archived: { label: 'В архиве', variant: 'outline' },
  closed: { label: 'Завершён', variant: 'secondary' },
  completed: { label: 'Завершено', variant: 'success' },
  in_progress: { label: 'В работе', variant: 'info' },
  pending: { label: 'Ожидает', variant: 'warning' },
  approved: { label: 'Согласовано', variant: 'success' },
  rejected: { label: 'Отклонено', variant: 'destructive' },
  resolved: { label: 'Решено', variant: 'success' },
  overdue: { label: 'Просрочено', variant: 'destructive' },
  paused: { label: 'Приостановлено', variant: 'secondary' },
  expired: { label: 'Срок истёк', variant: 'destructive' },
  cancelled: { label: 'Отменено', variant: 'outline' },

  // Сотрудник
  on_leave: { label: 'В отпуске', variant: 'info' },
  probation: { label: 'Испытательный срок', variant: 'warning' },
  dismissed: { label: 'Уволен', variant: 'outline' },

  // BUG-064: выдачи книг (book_loans) и заказы магазина наград (store_orders)
  reserved: { label: 'Забронирована', variant: 'warning' },
  issued: { label: 'Выдано', variant: 'success' },
  returned: { label: 'Возвращена', variant: 'secondary' },
  enrolled: { label: 'Записан', variant: 'info' },

  // Категории новостей
  company: { label: 'Компания', variant: 'default' },
  product: { label: 'Продукты', variant: 'info' },
  event: { label: 'События', variant: 'warning' },
  announcement: { label: 'Объявление', variant: 'destructive' },
  training: { label: 'Обучение', variant: 'success' },

  // Формат курса
  video: { label: 'Видео', variant: 'info' },
  pdf: { label: 'PDF', variant: 'secondary' },
  scorm: { label: 'SCORM-курс', variant: 'secondary' },
  html: { label: 'Веб-курс', variant: 'secondary' },
  quiz: { label: 'Тест', variant: 'warning' },

  // Типы опросов
  regular: { label: 'Регулярный', variant: 'default' },
  pulse: { label: 'Пульс-опрос', variant: 'info' },
  '360': { label: 'Оценка 360°', variant: 'warning' },
  icsi: { label: 'Индекс удовлетворённости', variant: 'secondary' },
  anonymous: { label: 'Анонимный', variant: 'secondary' },

  // Типы заявок / отпусков
  vacation: { label: 'Ежегодный отпуск', variant: 'info' },
  sick: { label: 'Больничный', variant: 'warning' },
  personal: { label: 'Отпуск за свой счёт', variant: 'secondary' },
  unpaid: { label: 'Без сохранения оплаты', variant: 'secondary' },
  document: { label: 'Документы', variant: 'info' },
  equipment: { label: 'Оборудование', variant: 'secondary' },
  access: { label: 'Доступы', variant: 'warning' },
  reference: { label: 'Справка', variant: 'info' },
  other: { label: 'Прочее', variant: 'outline' },

  // Приоритеты
  low: { label: 'Низкий', variant: 'secondary' },
  medium: { label: 'Средний', variant: 'warning' },
  high: { label: 'Высокий', variant: 'destructive' },

  // Уровни компетенций
  novice: { label: 'Начальный', variant: 'secondary' },
  intermediate: { label: 'Средний', variant: 'info' },
  advanced: { label: 'Продвинутый', variant: 'warning' },
  expert: { label: 'Экспертный', variant: 'success' },

  // Вакансии / кандидаты
  open: { label: 'Открыта', variant: 'success' },
  on_hold: { label: 'На паузе', variant: 'warning' },
  new: { label: 'Новый', variant: 'info' },
  screening: { label: 'Скрининг', variant: 'secondary' },
  interview: { label: 'Собеседование', variant: 'warning' },
  offer: { label: 'Оффер', variant: 'info' },
  hired: { label: 'Принят', variant: 'success' },

  // Кошелёк
  achievement: { label: 'Достижение', variant: 'success' },
  manual: { label: 'Ручное начисление', variant: 'info' },
  workflow: { label: 'Автоначисление', variant: 'secondary' },
  tenure: { label: 'За стаж', variant: 'success' },
  spend: { label: 'Списание', variant: 'destructive' },
  correction: { label: 'Корректировка', variant: 'warning' },
  purchase: { label: 'Покупка', variant: 'destructive' },

  // Роли
  employee: { label: 'Сотрудник', variant: 'secondary' },
  manager: { label: 'Руководитель', variant: 'info' },
  hr: { label: 'HR-специалист', variant: 'warning' },
  admin: { label: 'Администратор', variant: 'destructive' },
  user: { label: 'Сотрудник', variant: 'secondary' },

  // Действия журнала аудита
  create: { label: 'Создание', variant: 'success' },
  update: { label: 'Изменение', variant: 'info' },
  delete: { label: 'Удаление', variant: 'destructive' },
  login: { label: 'Вход', variant: 'secondary' },
  logout: { label: 'Выход', variant: 'secondary' },
  invite: { label: 'Приглашение', variant: 'info' },
  // Ключ `approve` объявлен ниже, в блоке типов этапов процесса: дублировать его
  // здесь нельзя — второе объявление молча затирало первое (no-dupe-keys).
  reject: { label: 'Отклонение', variant: 'destructive' },
  export: { label: 'Экспорт', variant: 'outline' },

  // Триггеры автоопросов
  schedule: { label: 'По расписанию', variant: 'info' },
  onboarding: { label: 'При онбординге', variant: 'success' },
  birthday: { label: 'В день рождения', variant: 'warning' },
  monthly_pulse: { label: 'Ежемесячный пульс', variant: 'info' },

  // Типы событий
  teambuilding: { label: 'Тимбилдинг', variant: 'info' },
  corporate: { label: 'Корпоратив', variant: 'warning' },
  holiday: { label: 'Праздник', variant: 'success' },

  // Типы кадровых документов
  contract: { label: 'Трудовой договор', variant: 'info' },
  order: { label: 'Приказ', variant: 'warning' },
  statement: { label: 'Заявление', variant: 'secondary' },

  // Прочее
  objective: { label: 'Цель', variant: 'default' },
  key_result: { label: 'Ключевой результат', variant: 'secondary' },
  sales: { label: 'Продажи', variant: 'info' },
  warehouse: { label: 'Склад', variant: 'secondary' },
  office: { label: 'Офис', variant: 'secondary' },
  management: { label: 'Руководство', variant: 'warning' },
  work: { label: 'Рабочие достижения', variant: 'info' },
  social: { label: 'Социальные', variant: 'success' },
  milestone: { label: 'Юбилеи и вехи', variant: 'warning' },
  image: { label: 'Изображение', variant: 'info' },
  archive: { label: 'Архив', variant: 'secondary' },
  info: { label: 'Информация', variant: 'info' },
  success: { label: 'Успешно', variant: 'success' },
  warning: { label: 'Внимание', variant: 'warning' },
  system: { label: 'Системное', variant: 'secondary' },
  mention: { label: 'Упоминание', variant: 'info' },
  // BUG-043/BUG-027: тип уведомления «approval» показывался кодом на английском.
  approval: { label: 'Согласование', variant: 'warning' },
  // Типы обращений в «Обратной связи» (таблица feedback).
  idea: { label: 'Идея', variant: 'info' },
  problem: { label: 'Проблема', variant: 'destructive' },
  gratitude: { label: 'Благодарность', variant: 'success' },
  news: { label: 'Новость', variant: 'default' },
  course: { label: 'Курс', variant: 'info' },
  book: { label: 'Книга', variant: 'warning' },
  offline: { label: 'Очно', variant: 'info' },
  online: { label: 'Онлайн', variant: 'secondary' },
  employee_of_month: { label: 'Сотрудник месяца', variant: 'warning' },
  special: { label: 'Особое достижение', variant: 'info' },
  kpi: { label: 'За KPI', variant: 'success' },
  initiative: { label: 'Инициатива', variant: 'info' },
  performance: { label: 'Результативность', variant: 'success' },
  contest: { label: 'Конкурс', variant: 'warning' },
  mentoring: { label: 'Наставничество', variant: 'info' },

  // Конструктор процессов: типы этапов
  collect: { label: 'Сбор информации', variant: 'info' },
  approve: { label: 'Согласование', variant: 'warning' },
  execute: { label: 'Исполнение', variant: 'success' },

  // Статусы заявок по процессам
  in_progress_request: { label: 'В работе', variant: 'info' },

  // Типы маршрутов
  next: { label: 'Следующий этап', variant: 'info' },
  reject_route: { label: 'При отклонении', variant: 'destructive' },
  resolve: { label: 'Считать решённой', variant: 'success' },

  // Типы полей конструктора
  select: { label: 'Выбор из вариантов', variant: 'secondary' },
  multiselect: { label: 'Несколько вариантов', variant: 'secondary' },
  textarea: { label: 'Многострочный текст', variant: 'secondary' },
  number: { label: 'Число', variant: 'secondary' },
  date: { label: 'Дата', variant: 'secondary' },
  file: { label: 'Файл', variant: 'secondary' },

  // Периодичность автоправил
  once: { label: 'Один раз', variant: 'secondary' },
  yearly: { label: 'Раз в год', variant: 'info' },
  monthly: { label: 'Раз в месяц', variant: 'warning' },
};

/** Параметры условий автоматического награждения (ТЗ §1.2). */
export const ACHIEVEMENT_PARAMS = {
  tenure_months: 'Стаж работы в месяцах',
  tenure_years: 'Стаж работы в годах',
  courses_completed: 'Завершённых курсов',
  books_read: 'Прочитанных книг',
  points_total: 'Накоплено баллов',
  surveys_answered: 'Пройдено опросов',
  goals_completed: 'Достигнуто целей',
  birthday_today: 'День рождения сегодня',
};

/** Операторы сравнения в условиях. */
export const COMPARISON_OPERATORS = {
  gt: 'Больше',
  gte: 'Больше или равно',
  lt: 'Меньше',
  lte: 'Меньше или равно',
  eq: 'Равно',
};

/** Типы полей ввода в конструкторе процессов. */
export const PROCESS_FIELD_TYPES = {
  select: 'Выбор из вариантов',
  multiselect: 'Несколько вариантов',
  text: 'Текст',
  textarea: 'Многострочный текст',
  number: 'Число',
  date: 'Дата',
  file: 'Файл',
  image: 'Изображение',
  employee: 'Сотрудник',
};

/** Типы этапов процесса. */
export const PROCESS_STAGE_TYPES = {
  collect: 'Сбор информации',
  approve: 'Согласование',
  execute: 'Исполнение',
};

/** BUG-068: человекочитаемые названия сущностей вместо Auth / WalletTransaction / LeaveRequest. */
export const ENTITY_LABELS = {
  Auth: 'Аутентификация',
  User: 'Пользователь',
  Profile: 'Пользователь',
  profiles: 'Пользователь',
  Employee: 'Сотрудник',
  employees: 'Сотрудник',
  employee_private: 'Конфиденциальные данные сотрудника',
  News: 'Новость',
  news: 'Новость',
  Course: 'Курс',
  courses: 'Курс',
  enrollments: 'Запись на курс',
  Book: 'Книга',
  books: 'Книга',
  book_loans: 'Выдача книги',
  Goal: 'Цель',
  goals: 'Цель',
  KPI: 'KPI',
  kpis: 'KPI',
  LeaveRequest: 'Заявка на отпуск',
  leave_requests: 'Заявка на отпуск',
  ServiceRequest: 'Служебная заявка',
  service_requests: 'Служебная заявка',
  Survey: 'Опрос',
  surveys: 'Опрос',
  survey_sessions: 'Сессия опроса',
  survey_responses: 'Ответ на опрос',
  WalletTransaction: 'Операция по баллам',
  wallet_transactions: 'Операция по баллам',
  StoreItem: 'Товар магазина наград',
  store_items: 'Товар магазина наград',
  store_orders: 'Заказ в магазине наград',
  Achievement: 'Достижение',
  achievements: 'Достижение',
  Department: 'Отдел',
  departments: 'Отдел',
  Page: 'Страница',
  pages: 'Страница',
  Notification: 'Уведомление',
  notifications: 'Уведомление',
  Settings: 'Настройки портала',
  settings: 'Настройки портала',
  AuditLog: 'Журнал аудита',
  audit_logs: 'Журнал аудита',
  processes: 'Процесс',
  process_stages: 'Этап процесса',
  process_fields: 'Поле процесса',
  process_routes: 'Маршрут процесса',
  process_requests: 'Заявка по процессу',
  achievement_rules: 'Правило достижения',
  Favorite: 'Избранное',
  favorites: 'Избранное',
  Event: 'Событие',
  events: 'Событие',
  DevelopmentPlan: 'План развития',
  development_plans: 'План развития',
  HRDocument: 'Кадровый документ',
  hr_documents: 'Кадровый документ',
  UserFile: 'Файл',
  user_files: 'Файл',
  feedback: 'Обращение',
  AwardReason: 'Причина начисления',
  award_reasons: 'Причина начисления',
};

/**
 * BUG-068 (журнал аудита): в diff'е изменений торчали имена колонок БД.
 * Человекочитаемые названия полей для раскрытия записи аудита.
 */
export const FIELD_LABELS = {
  active: 'Активность',
  address: 'Адрес',
  amount: 'Сумма, баллы',
  admin_name: 'Администратор',
  approver_name: 'Согласующий',
  birth_date: 'Дата рождения',
  body: 'Текст',
  branch: 'Филиал',
  branch_id: 'Филиал',
  category: 'Категория',
  code: 'Код',
  copies: 'Экземпляров',
  decided_at: 'Дата решения',
  default_points: 'Номинал по умолчанию',
  department: 'Отдел',
  department_id: 'Отдел',
  description: 'Описание',
  email: 'Email',
  employee_id: 'Сотрудник',
  employee_name: 'Сотрудник',
  end_date: 'Дата окончания',
  format: 'Формат',
  full_name: 'ФИО',
  hire_date: 'Дата приёма',
  is_mandatory: 'Обязательный',
  is_correction: 'Корректировка',
  item_name: 'Товар',
  key: 'Ключ',
  locale: 'Язык интерфейса',
  manager_name: 'Руководитель',
  name: 'Название',
  notes: 'Примечание',
  phone: 'Телефон',
  points: 'Баллы',
  position: 'Должность',
  price: 'Цена',
  price_at_purchase: 'Цена на момент покупки',
  progress: 'Прогресс',
  published_date: 'Дата публикации',
  reason: 'Комментарий',
  reason_code: 'Причина',
  role: 'Роль',
  role_type: 'Тип роли',
  slug: 'Адрес страницы',
  start_date: 'Дата начала',
  status: 'Статус',
  stock: 'Остаток',
  title: 'Название',
  type: 'Тип',
  value: 'Значение',
  vacation_days_per_year: 'Дней отпуска в году',
};

export function fieldLabel(value) {
  if (!value) return '—';
  return FIELD_LABELS[value] ?? String(value);
}

/** Ярлык статуса; если неизвестен — возвращает исходное значение, а не «undefined». */
export function statusLabel(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback ?? '—';
  return STATUS[value]?.label ?? fallback ?? String(value);
}

export function statusVariant(value) {
  return STATUS[value]?.variant ?? 'secondary';
}

export function entityLabel(value) {
  if (!value) return '—';
  return ENTITY_LABELS[value] ?? String(value);
}
