import React, { createContext, useContext, useState, useEffect, useMemo } from 'react';

const dict = {
  ru: {
    // Common
    dashboard: 'Дашборд', employees: 'Сотрудники', vacancies: 'Вакансии', candidates: 'Кандидаты',
    onboarding: 'Онбординг', leave: 'Отпуска', learning: 'Обучение', motivation: 'Мотивация',
    documents: 'Документы', account: 'Личный кабинет',
    search: 'Поиск', add: 'Добавить', save: 'Сохранить', cancel: 'Отмена', close: 'Закрыть',
    status: 'Статус', all: 'Все', view: 'Открыть', edit: 'Изменить', delete: 'Удалить',
    approve: 'Согласовать', reject: 'Отклонить', pending: 'Ожидает', completed: 'Завершено',
    name: 'ФИО', position: 'Должность', branch: 'Филиал', department: 'Отдел', phone: 'Телефон',
    email: 'Email', actions: 'Действия', total: 'Всего', active: 'Работает', download: 'Скачать',
    upload: 'Загрузить', hireDate: 'Дата приёма', birthDate: 'День рождения',
    headcount: 'Численность', openVacancies: 'Открытые вакансии', pendingLeaves: 'Заявки на отпуск',
    turnover: 'Текучесть', byBranch: 'По филиалам', recruitment: 'Рекрутинг', upcoming: 'Ближайшие',
    birthdays: 'Дни рождения', anniversaries: 'Годовщины работы', onLeave: 'В отпуске',
    newCandidate: 'Новый кандидат', newVacancy: 'Новая вакансия', newEmployee: 'Новый сотрудник',
    motto: 'Будь в форме, действуй, вдохновляй!',
    loading: 'Загрузка...', confirm: 'Подтвердить', yes: 'Да', no: 'Нет',
    created: 'Создано', updated: 'Обновлено', settings: 'Настройки',

    // Nav items
    nav_news: 'Новости', nav_development: 'Развитие', nav_requests: 'Заявки',
    nav_surveys: 'Опросы', nav_feedback: 'Обратная связь', nav_goals: 'Цели',
    nav_kpi: 'KPI', nav_vacation: 'Отпуск', nav_calendar: 'Календарь',
    nav_hr_documents: 'Кадровые документы', nav_wallet: 'Кошелёк', nav_library: 'Библиотека',
    nav_store: 'Магазин наград', nav_favorites: 'Избранное', nav_files: 'Файлы',
    nav_notifications: 'Уведомления', nav_profile: 'Настройки профиля',
    nav_users: 'Пользователи', nav_departments: 'Отделы', nav_invitations: 'Приглашения',
    nav_pages: 'Страницы', nav_courses: 'Курсы', nav_achievements: 'Достижения',
    nav_audit: 'Журнал аудита', nav_overview: 'Обзор',
    nav_survey_sessions: 'Сессии опросов', nav_survey_auto: 'Автоматические опросы',
    nav_survey_reports: 'Отчёты по опросам',
    nav_wallet_ops: 'Операции кошелька', nav_wallet_reports: 'Аналитика баллов',
    nav_award_reasons: 'Причины начисления',

    // Nav sections
    section_hr: 'Управление персоналом', section_content: 'Контент',
    section_learning: 'Обучение', section_gamification: 'Геймификация',
    section_surveys: 'Опросы', section_vacation: 'Отпуска', section_system: 'Система',

    // Zones
    zone_company: 'Главная', zone_cabinet: 'Личный кабинет', zone_admin: 'Администрирование',

    // Portal shell
    nav_search: 'Поиск по меню...', global_search: 'Глобальный поиск: сотрудники, документы, курсы...',
    collapse: 'Свернуть', logout: 'Выйти', motto_label: 'Девиз',
    nothing_found: 'Ничего не найдено',

    // Admin users
    users_title: 'Пользователи', users_desc: 'Учётные записи, роли и доступ к порталу',
    users_invite: 'Пригласить пользователя', users_search: 'Поиск по имени или email',
    users_all_roles: 'Все роли', users_role_admin: 'Администратор', users_role_user: 'Сотрудник',
    users_change_role: 'Изменить роль', users_details: 'Профиль пользователя',
    users_no_users: 'Пользователи не найдены', users_joined: 'Дата регистрации',
    users_send_invite: 'Отправить', users_invite_email: 'Email приглашения',
    users_invite_role: 'Роль', users_invite_placeholder: 'user@optimus.kz',
    users_total: 'Всего пользователей', users_admins: 'Администраторы', users_regular: 'Сотрудники',
    users_role_changed: 'Роль обновлена', users_invite_sent: 'Приглашение отправлено',
    users_invite_error: 'Не удалось отправить приглашение',
    users_no_name: 'Без имени', users_company: 'Компания', users_city: 'Город',

    // Admin settings
    settings_title: 'Настройки системы', settings_desc: 'Конфигурация портала',
    settings_general: 'Общие', settings_branding: 'Брендинг', settings_notifications: 'Уведомления',
    settings_security: 'Безопасность', settings_integrations: 'Интеграции', settings_localization: 'Локализация',
    settings_company_info: 'Информация о компании', settings_company_name: 'Название',
    settings_company_brands: 'Бренды', settings_company_email: 'Email', settings_company_phone: 'Телефон',
    settings_company_address: 'Адрес', settings_timezone: 'Часовой пояс',
    settings_theme_color: 'Основной цвет', settings_dark_mode: 'Тёмная тема',
    settings_dark_mode_desc: 'Включить тёмное оформление интерфейса',
    settings_email_notif: 'Email-уведомления', settings_email_notif_desc: 'Отправлять уведомления на почту',
    settings_push_notif: 'Push-уведомления', settings_push_notif_desc: 'Браузерные push-уведомления',
    settings_inapp_notif: 'Внутренние уведомления', settings_inapp_notif_desc: 'Показывать уведомления в приложении',
    settings_daily_digest: 'Ежедневный дайджест', settings_daily_digest_desc: 'Сводка событий каждый день',
    settings_weekly_report: 'Еженедельный отчёт', settings_weekly_report_desc: 'Отчёт по активности раз в неделю',
    settings_2fa: 'Двухфакторная аутентификация', settings_2fa_desc: 'Требовать 2FA для администраторов',
    settings_password_min: 'Мин. длина пароля', settings_session_timeout: 'Тайм-аут сессии (мин)',
    settings_login_attempts: 'Макс. попыток входа',
    settings_integration_status: 'Статус', settings_connect: 'Подключить', settings_disconnect: 'Отключить',
    settings_connected: 'Подключено', settings_not_connected: 'Не подключено',
    settings_language: 'Язык интерфейса', settings_select_language: 'Выберите язык интерфейса',
    settings_russian: 'Русский', settings_kazakh: 'Қазақша',
    settings_saved: 'Настройки сохранены', settings_reset: 'Сбросить настройки',
    settings_reset_confirm: 'Сбросить все настройки к значениям по умолчанию?',
    settings_open: 'Открыть', settings_desc_general: 'Название компании, логотип, часовой пояс',
    settings_desc_branding: 'Цвета, шрифты, тёмная тема',
    settings_desc_notifications: 'Email, push, in-app уведомления',
    settings_desc_security: '2FA, сессии, политики паролей',
    settings_desc_integrations: '1C, LDAP, SSO, Telegram, Slack',
    settings_desc_localization: 'Языки: Русский, Қазақша',
    // Новые разделы навигации и страницы (аудит: BUG-078, BUG-071)
    nav_page_about: 'О компании', nav_page_vacation_policy: 'Политика отпусков',
    nav_page_ethics: 'Кодекс этики',
    section_my_work: 'Моя работа', section_knowledge: 'Знания и документы',
    section_company_life: 'Жизнь компании', section_recognition: 'Признание',
    section_personal: 'Личное',
    search_results_title: 'Результаты поиска', search_results_desc: 'Сотрудники, новости, курсы, книги и страницы портала',
    search_empty: 'Ничего не найдено. Уточните запрос.',
    error_load_title: 'Не удалось загрузить данные', retry: 'Повторить',
    read_more: 'Читать далее', back: 'Назад', comments: 'Комментарии',
    add_comment: 'Написать комментарий', send: 'Отправить',
    points: 'баллы', balance: 'Баланс', enroll: 'Записаться', continue_course: 'Продолжить',
    completed_course: 'Курс пройден', reserve_book: 'Забронировать',
    required_field: 'Обязательное поле', form_has_errors: 'Проверьте заполнение формы',
    confirm_delete: 'Удалить безвозвратно?',
    // Процессы и автоправила достижений
    nav_processes: 'Каталог процессов', nav_my_process_requests: 'Мои заявки по процессам',
    nav_process_setup: 'Настройка процессов', nav_process_requests: 'Список заявок',
    nav_achievement_rules: 'Правила достижений',
    section_processes: 'Процессы',


    // Уведомления (BUG-043: заголовки страницы не переводились)
    notifications_title: 'Уведомления',
    notifications_desc: 'Согласования, упоминания и системные сообщения портала',
    notifications_filter_all: 'Все',
    notifications_filter_unread: 'Непрочитанные',
    notifications_mark_all: 'Отметить все прочитанными',
    notifications_mark_read: 'Отметить прочитанным',
    notifications_open: 'Перейти',
    notifications_unread: 'Непрочитанное',
    notifications_empty_title: 'Уведомлений нет',
    notifications_empty_desc: 'Здесь появятся согласования заявок, упоминания и системные сообщения портала.',
    notifications_empty_unread_title: 'Непрочитанных уведомлений нет',
    notifications_empty_unread_desc: 'Вы прочитали всё. Переключитесь на «Все», чтобы посмотреть историю.',
    notifications_all_read: 'Все уведомления отмечены прочитанными',
  },
  kz: {
    // Common
    dashboard: 'Басқару тақтасы', employees: 'Қызметкерлер', vacancies: 'Бос орындар', candidates: 'Үміткерлер',
    onboarding: 'Бейімдеу', leave: 'Демалыс', learning: 'Оқыту', motivation: 'Мотивация',
    documents: 'Құжаттар', account: 'Жеке кабинет',
    search: 'Іздеу', add: 'Қосу', save: 'Сақтау', cancel: 'Бас тарту', close: 'Жабу',
    status: 'Күй', all: 'Барлығы', view: 'Ашу', edit: 'Өзгерту', delete: 'Жою',
    approve: 'Мақұлдау', reject: 'Қабылдамау', pending: 'Күтуде', completed: 'Аяқталды',
    name: 'А.ж.а.т', position: 'Лауазым', branch: 'Филиал', department: 'Бөлім', phone: 'Телефон',
    email: 'Email', actions: 'Әрекеттер', total: 'Барлығы', active: 'Жұмыс істейді', download: 'Жүктеу',
    upload: 'Жүктеу', hireDate: 'Жұмысқа қабылданған', birthDate: 'Туған күні',
    headcount: 'Қызметкерлер саны', openVacancies: 'Ашық бос орындар', pendingLeaves: 'Демалыс өтініштері',
    turnover: 'Ауысушылық', byBranch: 'Филиалдар бойынша', recruitment: 'Жұмысқа қабылдау', upcoming: 'Жақын',
    birthdays: 'Туған күндер', anniversaries: 'Жұмыс жылдықтары', onLeave: 'Демалыста',
    newCandidate: 'Жаңа үміткер', newVacancy: 'Жаңа бос орын', newEmployee: 'Жаңа қызметкер',
    motto: 'Формада бол, әрекет ет, шабыттандыр!',
    loading: 'Жүктелуде...', confirm: 'Растау', yes: 'Иә', no: 'Жоқ',
    created: 'Құрылды', updated: 'Жаңартылды', settings: 'Параметрлер',

    // Nav items
    nav_news: 'Жаңалықтар', nav_development: 'Даму', nav_requests: 'Өтініштер',
    nav_surveys: 'Сауалнамалар', nav_feedback: 'Кері байланыс', nav_goals: 'Мақсаттар',
    nav_kpi: 'KPI', nav_vacation: 'Демалыс', nav_calendar: 'Күнтізбе',
    nav_hr_documents: 'Кадрлік құжаттар', nav_wallet: 'Әмиян', nav_library: 'Кітапхана',
    nav_store: 'Марапаттар дүкені', nav_favorites: 'Таңдаулылар', nav_files: 'Файлдар',
    nav_notifications: 'Хабарламалар', nav_profile: 'Профиль параметрлері',
    nav_users: 'Пайдаланушылар', nav_departments: 'Бөлімдер', nav_invitations: 'Шақырулар',
    nav_pages: 'Беттер', nav_courses: 'Курстар', nav_achievements: 'Жетістіктер',
    nav_audit: 'Аудит журналы', nav_overview: 'Шолу',
    nav_survey_sessions: 'Сауалнама сессиялары', nav_survey_auto: 'Автоматты сауалнамалар',
    nav_survey_reports: 'Сауалнама есептері',
    nav_wallet_ops: 'Әмиян операциялары', nav_wallet_reports: 'Балл аналитикасы',
    nav_award_reasons: 'Балл себептері',

    // Nav sections
    section_hr: 'Қызметкерлерді басқару', section_content: 'Контент',
    section_learning: 'Оқыту', section_gamification: 'Геймификация',
    section_surveys: 'Сауалнамалар', section_vacation: 'Демалыстар', section_system: 'Жүйе',

    // Zones
    zone_company: 'Басты бет', zone_cabinet: 'Жеке кабинет', zone_admin: 'Әкімшілік',

    // Portal shell
    nav_search: 'Мәзір бойынша іздеу...', global_search: 'Жаһандық іздеу: қызметкерлер, құжаттар, курстар...',
    collapse: 'Жасыру', logout: 'Шығу', motto_label: 'Ұран',
    nothing_found: 'Ештеңе табылмады',

    // Admin users
    users_title: 'Пайдаланушылар', users_desc: 'Тіркелгілер, рөлдер және порталға қол жеткізу',
    users_invite: 'Пайдаланушыны шақыру', users_search: 'Аты немесе email бойынша іздеу',
    users_all_roles: 'Барлық рөлдер', users_role_admin: 'Әкімші', users_role_user: 'Қызметкер',
    users_change_role: 'Рөлді өзгерту', users_details: 'Пайдаланушы профилі',
    users_no_users: 'Пайдаланушылар табылмады', users_joined: 'Тіркеу күні',
    users_send_invite: 'Жіберу', users_invite_email: 'Шақыру email',
    users_invite_role: 'Рөл', users_invite_placeholder: 'user@optimus.kz',
    users_total: 'Барлық пайдаланушылар', users_admins: 'Әкімшілер', users_regular: 'Қызметкерлер',
    users_role_changed: 'Рөл жаңартылды', users_invite_sent: 'Шақыру жіберілді',
    users_invite_error: 'Шақыруды жіберу мүмкін болмады',
    users_no_name: 'Атысыз', users_company: 'Компания', users_city: 'Қала',

    // Admin settings
    settings_title: 'Жүйе параметрлері', settings_desc: 'Портал конфигурациясы',
    settings_general: 'Жалпы', settings_branding: 'Брендинг', settings_notifications: 'Хабарламалар',
    settings_security: 'Қауіпсіздік', settings_integrations: 'Интеграциялар', settings_localization: 'Локализация',
    settings_company_info: 'Компания ақпараты', settings_company_name: 'Атауы',
    settings_company_brands: 'Брендтар', settings_company_email: 'Email', settings_company_phone: 'Телефон',
    settings_company_address: 'Мекенжай', settings_timezone: 'Уақыт белдеуі',
    settings_theme_color: 'Негізгі түс', settings_dark_mode: 'Қараңғы тақырып',
    settings_dark_mode_desc: 'Қараңғы интерфейсті қосу',
    settings_email_notif: 'Email-хабарламалар', settings_email_notif_desc: 'Хабарламаларды поштаға жіберу',
    settings_push_notif: 'Push-хабарламалар', settings_push_notif_desc: 'Браузер push-хабарламалары',
    settings_inapp_notif: 'Ішкі хабарламалар', settings_inapp_notif_desc: 'Хабарламаларды қолданбада көрсету',
    settings_daily_digest: 'Күнделікті дайджест', settings_daily_digest_desc: 'Күн сайын оқиғалар қорытындысы',
    settings_weekly_report: 'Апта сайын есеп', settings_weekly_report_desc: 'Апта сайын белсенділік есебі',
    settings_2fa: 'Екі факторлы аутентификация', settings_2fa_desc: 'Әкімшілер үшін 2FA талап ету',
    settings_password_min: 'Пароль мин. ұзындығы', settings_session_timeout: 'Сессия уақыты (мин)',
    settings_login_attempts: 'Кіру әрекеттері макс.',
    settings_integration_status: 'Күй', settings_connect: 'Қосу', settings_disconnect: 'Ажырату',
    settings_connected: 'Қосылған', settings_not_connected: 'Қосылмаған',
    settings_language: 'Интерфейс тілі', settings_select_language: 'Интерфейс тілін таңдаңыз',
    settings_russian: 'Орысша', settings_kazakh: 'Қазақша',
    settings_saved: 'Параметрлер сақталды', settings_reset: 'Параметрді қалпына келтіру',
    settings_reset_confirm: 'Барлық параметрді әдепкі мәнге қалпына келтіру?',
    settings_open: 'Ашу', settings_desc_general: 'Компания атауы, логотип, уақыт белдеуі',
    settings_desc_branding: 'Түстер, қаріптер, қараңғы тақырып',
    settings_desc_notifications: 'Email, push, in-app хабарламалар',
    settings_desc_security: '2FA, сессиялар, пароль саясаты',
    settings_desc_integrations: '1C, LDAP, SSO, Telegram, Slack',
    settings_desc_localization: 'Тілдер: Орысша, Қазақша',
    // Жаңа навигация бөлімдері
    nav_page_about: 'Компания туралы', nav_page_vacation_policy: 'Демалыс саясаты',
    nav_page_ethics: 'Этика кодексі',
    section_my_work: 'Менің жұмысым', section_knowledge: 'Білім және құжаттар',
    section_company_life: 'Компания өмірі', section_recognition: 'Мойындау',
    section_personal: 'Жеке',
    search_results_title: 'Іздеу нәтижелері', search_results_desc: 'Қызметкерлер, жаңалықтар, курстар, кітаптар және порталдың беттері',
    search_empty: 'Ештеңе табылмады. Сұранысты нақтылаңыз.',
    error_load_title: 'Деректерді жүктеу мүмкін болмады', retry: 'Қайталау',
    read_more: 'Толығырақ', back: 'Артқа', comments: 'Пікірлер',
    add_comment: 'Пікір жазу', send: 'Жіберу',
    points: 'ұпай', balance: 'Баланс', enroll: 'Тіркелу', continue_course: 'Жалғастыру',
    completed_course: 'Курс аяқталды', reserve_book: 'Броньдау',
    required_field: 'Міндетті өріс', form_has_errors: 'Форманы тексеріңіз',
    confirm_delete: 'Біржола жою керек пе?',
    // Процесстер
    nav_processes: 'Процестер каталогы', nav_my_process_requests: 'Процесс бойынша өтініштерім',
    nav_process_setup: 'Процестерді баптау', nav_process_requests: 'Өтініштер тізімі',
    nav_achievement_rules: 'Жетістік ережелері',
    section_processes: 'Процестер',


    // Хабарламалар (BUG-043)
    notifications_title: 'Хабарламалар',
    notifications_desc: 'Келісімдер, аталымдар және портал жүйелік хабарламалары',
    notifications_filter_all: 'Барлығы',
    notifications_filter_unread: 'Оқылмағандар',
    notifications_mark_all: 'Барлығын оқылды деп белгілеу',
    notifications_mark_read: 'Оқылды деп белгілеу',
    notifications_open: 'Ашу',
    notifications_unread: 'Оқылмаған',
    notifications_empty_title: 'Хабарламалар жоқ',
    notifications_empty_desc: 'Мұнда өтініштерді келісу, аталымдар және портал жүйелік хабарламалары пайда болады.',
    notifications_empty_unread_title: 'Оқылмаған хабарламалар жоқ',
    notifications_empty_unread_desc: 'Барлығын оқып шықтыңыз. Тарихты көру үшін «Барлығы» дегенге ауысыңыз.',
    notifications_all_read: 'Барлық хабарламалар оқылды деп белгіленді',
  },
};

/* Исторически казахская локаль называлась 'kz'; канонический код языка — 'kk'. */
dict.kk = dict.kz;

const I18nContext = createContext({ lang: 'ru', setLang: () => {}, t: (k) => k, plural: (n, a) => a });

const normalizeLang = (value) => (value === 'kz' ? 'kk' : value === 'kk' || value === 'ru' ? value : 'ru');

const pluralRules = {
  ru: typeof Intl !== 'undefined' && Intl.PluralRules ? new Intl.PluralRules('ru-RU') : null,
  kk: typeof Intl !== 'undefined' && Intl.PluralRules ? new Intl.PluralRules('kk-KZ') : null,
};

export function I18nProvider({ children }) {
  const [lang, setLangState] = useState(() => {
    if (typeof localStorage !== 'undefined') return normalizeLang(localStorage.getItem('optimus_lang'));
    return 'ru';
  });

  const setLang = (value) => setLangState(normalizeLang(value));

  useEffect(() => {
    localStorage.setItem('optimus_lang', lang);
    // BUG-048: в <html> стоял lang="en" при русском и казахском контенте.
    if (typeof document !== 'undefined') document.documentElement.setAttribute('lang', lang);
  }, [lang]);

  const value = useMemo(() => {
    const t = (key, vars) => {
      let str = (dict[lang] && dict[lang][key]) || dict.ru[key] || key;
      if (vars && typeof str === 'string') {
        for (const [k, v] of Object.entries(vars)) str = str.replaceAll(`{${k}}`, String(v));
      }
      return str;
    };

    /**
     * BUG-075/077: «1 служебных записок», «1 сотрудников».
     * plural(3, ['сотрудник','сотрудника','сотрудников']) → 'сотрудника'
     */
    const plural = (count, forms) => {
      const list = Array.isArray(forms) ? forms : [forms];
      const rules = pluralRules[lang] || pluralRules.ru;
      if (!rules) return list[list.length - 1];
      const category = rules.select(Math.abs(Number(count) || 0));
      if (category === 'one') return list[0];
      if (category === 'few') return list[1] ?? list[list.length - 1];
      return list[2] ?? list[list.length - 1];
    };

    const pluralize = (count, forms) => `${count} ${plural(count, forms)}`;

    return { lang, setLang, t, plural, pluralize };
  }, [lang]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export const useI18n = () => useContext(I18nContext);