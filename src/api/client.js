import { supabase } from './supabase';
import { createEntity, DataError } from './entity';

/**
 * Слой доступа к данным портала Optimus KZ.
 * Единый слой данных портала поверх Supabase,
 * где действуют серверные RLS-политики и триггеры аудита.
 */

const entities = {
  Achievement: createEntity('achievements', { defaultSort: '-date' }),
  AuditLog: createEntity('audit_logs', { defaultSort: '-date' }),
  AutoSurvey: createEntity('auto_surveys', { defaultSort: '-created_date' }),
  Award: createEntity('awards', { defaultSort: '-date' }),
  AwardReason: createEntity('award_reasons'),
  Book: createEntity('books'),
  BookLoan: createEntity('book_loans', { defaultSort: '-created_date' }),
  Branch: createEntity('branches'),
  Candidate: createEntity('candidates'),
  Course: createEntity('courses'),
  Comment: createEntity('comments', { defaultSort: '-created_date' }),
  Department: createEntity('departments'),
  DevelopmentPlan: createEntity('development_plans', { defaultSort: '-created_date' }),
  Employee: createEntity('employees'),
  EmployeePrivate: createEntity('employee_private'),
  Enrollment: createEntity('enrollments', { defaultSort: '-created_date' }),
  Event: createEntity('events', { defaultSort: 'date' }),
  EventRegistration: createEntity('event_registrations'),
  Favorite: createEntity('favorites', { defaultSort: '-date' }),
  Feedback: createEntity('feedback', { defaultSort: '-created_date' }),
  Goal: createEntity('goals', { defaultSort: '-created_date' }),
  HRDocument: createEntity('hr_documents', { defaultSort: '-upload_date' }),
  KPI: createEntity('kpis'),
  LeaveRequest: createEntity('leave_requests', { defaultSort: '-created_date' }),
  NewsLike: createEntity('news_likes'),
  News: createEntity('news', { defaultSort: '-published_date' }),
  Notification: createEntity('notifications', { defaultSort: '-date' }),
  OnboardingTask: createEntity('onboarding_tasks'),
  Page: createEntity('pages', { defaultSort: '-updated_date' }),
  Invitation: createEntity('invitations', { defaultSort: '-created_date' }),
  Process: createEntity('processes', { defaultSort: 'sort_order' }),
  ProcessCategory: createEntity('process_categories', { defaultSort: 'sort_order' }),
  ProcessStage: createEntity('process_stages', { defaultSort: 'sort_order' }),
  ProcessField: createEntity('process_fields', { defaultSort: 'sort_order' }),
  ProcessRoute: createEntity('process_routes', { defaultSort: 'sort_order' }),
  ProcessRequest: createEntity('process_requests', { defaultSort: '-created_date' }),
  ProcessRequestValue: createEntity('process_request_values'),
  ProcessRequestHistory: createEntity('process_request_history', { defaultSort: 'created_date' }),
  AchievementRule: createEntity('achievement_rules', { defaultSort: '-created_date' }),
  RequestComment: createEntity('request_comments', { defaultSort: 'created_date' }),
  ServiceRequest: createEntity('service_requests', { defaultSort: '-created_date' }),
  // BUG-085: первичный ключ настроек — key, а не id.
  Settings: createEntity('settings', { idColumn: 'key' }),
  StoreItem: createEntity('store_items'),
  StoreOrder: createEntity('store_orders', { defaultSort: '-created_date' }),
  Survey: createEntity('surveys', { defaultSort: '-created_date' }),
  SurveyResponse: createEntity('survey_responses', { defaultSort: '-date' }),
  SurveySession: createEntity('survey_sessions', { defaultSort: '-start_date' }),
  Training: createEntity('trainings'),
  TrainingCompletion: createEntity('training_completions'),
  User: createEntity('profiles'),
  UserFile: createEntity('user_files', { defaultSort: '-upload_date' }),
  Vacancy: createEntity('vacancies'),
  WalletTransaction: createEntity('wallet_transactions', { defaultSort: '-date' }),
};

/* ------------------------------------------------------------------ auth */

let cachedProfile = null;
let cachedProfileFor = null;

const auth = {
  /** Текущий пользователь портала (profiles + роль). Бросает DataError, если сессии нет. */
  async me() {
    const { data: sessionData } = await supabase.auth.getSession();
    const session = sessionData?.session;
    if (!session) throw new DataError('Сессия не найдена', { status: 401 });

    if (cachedProfileFor === session.user.id && cachedProfile) return cachedProfile;

    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', session.user.id)
      .maybeSingle();
    if (error) throw new DataError(error.message, { status: error.status, code: error.code });
    if (!data) throw new DataError('Пользователь не зарегистрирован в портале', { status: 403, code: 'user_not_registered' });

    cachedProfile = { ...data, auth_email: session.user.email };
    cachedProfileFor = session.user.id;
    return cachedProfile;
  },

  async signInWithPassword(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new DataError(translateAuthError(error.message), { status: error.status });
    cachedProfile = null;
    cachedProfileFor = null;
    return data;
  },

  async signUp({ email, password, fullName }) {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } },
    });
    if (error) throw new DataError(translateAuthError(error.message), { status: error.status });
    return data;
  },

  async sendMagicLink(email) {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/` },
    });
    if (error) throw new DataError(translateAuthError(error.message), { status: error.status });
    return true;
  },

  async resetPassword(email) {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) throw new DataError(translateAuthError(error.message), { status: error.status });
    return true;
  },

  async updatePassword(password) {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw new DataError(translateAuthError(error.message), { status: error.status });
    return true;
  },

  /** BUG-006: рабочий выход — сессия действительно уничтожается. */
  async logout(redirectTo = '/login') {
    cachedProfile = null;
    cachedProfileFor = null;
    try {
      await supabase.auth.signOut();
    } finally {
      if (typeof window !== 'undefined') window.location.assign(redirectTo);
    }
  },

  async updateMe(patch) {
    const { data: sessionData } = await supabase.auth.getSession();
    const uid = sessionData?.session?.user?.id;
    if (!uid) throw new DataError('Сессия не найдена', { status: 401 });
    const { data, error } = await supabase.from('profiles').update(patch).eq('id', uid).select('*').single();
    if (error) throw new DataError(error.message, { status: error.status, code: error.code });
    cachedProfile = null;
    cachedProfileFor = null;
    return data;
  },

  onAuthStateChange(callback) {
    return supabase.auth.onAuthStateChange((event, session) => {
      cachedProfile = null;
      cachedProfileFor = null;
      callback(event, session);
    });
  },
};

function translateAuthError(message = '') {
  const m = message.toLowerCase();
  // Сетевой сбой Supabase-клиент отдаёт как «Failed to fetch» — по-английски и без объяснения.
  if (m.includes('failed to fetch') || m.includes('networkerror') || m.includes('load failed')) {
    return 'Не удалось связаться с сервером. Проверьте подключение к интернету и попробуйте снова.';
  }
  if (m.includes('invalid login credentials')) return 'Неверный email или пароль';
  if (m.includes('email not confirmed')) return 'Email не подтверждён — проверьте почту';
  if (m.includes('user already registered')) return 'Пользователь с таким email уже существует';
  if (m.includes('password should be at least')) return 'Пароль слишком короткий (минимум 8 символов)';
  if (m.includes('rate limit') || m.includes('too many')) return 'Слишком много попыток, попробуйте позже';
  return message || 'Ошибка аутентификации';
}


/**
 * Разбор ошибки Edge-функции.
 *
 * supabase-js прячет ответ функции в error.context (это Response), а сам отдаёт
 * невнятное «Failed to send a request to the Edge Function». Читаем тело:
 * сначала как JSON, потом как текст — иначе настоящая причина отказа теряется
 * и пользователь видит бессмысленную общую фразу.
 */
async function edgeFunctionError(error, fallback) {
  const status = error?.context?.status ?? error?.status ?? null;
  try {
    const body = await error.context?.clone()?.json();
    if (body?.error) return new DataError(body.error, { status });
  } catch { /* тело не JSON — пробуем текстом */ }
  try {
    const text = await error.context?.clone()?.text();
    if (text && text.length < 400) return new DataError(text, { status });
  } catch { /* тело недоступно */ }
  if (status === 404) {
    return new DataError('Серверная функция не развёрнута в проекте Supabase', { status });
  }
  return new DataError(fallback, { status });
}

/* ----------------------------------------------------------------- users */

const users = {
  /**
   * Приглашение письмом. Требует настроенного SMTP в Supabase: встроенный
   * почтовик ограничен несколькими письмами в час. Если письмо уйти не может,
   * возвращаем понятный совет воспользоваться ссылкой-приглашением.
   */
  async inviteUser(email, role = 'employee') {
    const { data, error } = await supabase.functions.invoke('invite-user', {
      body: { email, role, redirect_to: window.location.origin },
    });
    if (error) {
      throw await edgeFunctionError(
        error,
        'Функция отправки писем недоступна. Воспользуйтесь кнопкой «Создать ссылку» — ' +
          'её можно передать любым способом.'
      );
    }
    if (data?.error) throw new DataError(data.error, { status: 400 });
    return data;
  },
  /**
   * Ссылка-приглашение. Открытый токен возвращается ровно один раз —
   * в базе хранится только его хеш, «подсмотреть» ссылку позже нельзя.
   */
  async createInvitation({ email, role = 'employee', fullName, days = 14, employeeId } = {}) {
    const { data, error } = await supabase.rpc('create_invitation', {
      p_email: email?.trim() || null,
      p_role: role,
      p_full_name: fullName?.trim() || null,
      p_days: days,
      p_employee_id: employeeId || null,
    });
    if (error) throw new DataError(error.message || 'Не удалось создать приглашение', { status: error.status, code: error.code });
    return { ...data, url: `${window.location.origin}/invite/${data.token}` };
  },

  async revokeInvitation(id) {
    const { error } = await supabase.rpc('revoke_invitation', { p_id: id });
    if (error) throw new DataError(error.message, { status: error.status, code: error.code });
    return true;
  },

  /** Проверка ссылки до входа: валидна ли и на кого выписана. */
  async checkInvitation(token) {
    const { data, error } = await supabase.rpc('check_invitation', { p_token: token });
    if (error) throw new DataError(error.message, { status: error.status, code: error.code });
    return data || { valid: false };
  },

  /** Регистрация по ссылке. Роль берётся из приглашения на сервере. */
  async acceptInvitation({ token, password, email, fullName }) {
    const { data, error } = await supabase.functions.invoke('accept-invite', {
      body: { token, password, email, full_name: fullName },
    });
    if (error) throw await edgeFunctionError(error, 'Не удалось завершить регистрацию');
    if (data?.error) throw new DataError(data.error, { status: 400 });
    return data;
  },

  async setRole(userId, role) {
    const { data, error } = await supabase.functions.invoke('set-user-role', { body: { userId, role } });
    if (error) throw new DataError(error.message || 'Не удалось изменить роль', { status: error.status });
    return data;
  },
  list: (sort, limit) => entities.User.list(sort, limit),
};

/* ---------------------------------------------------------------- storage */

const BUCKET = 'portal-files';

const storage = {
  async upload({ file, folder = 'uploads' }) {
    const { data: sessionData } = await supabase.auth.getSession();
    const uid = sessionData?.session?.user?.id;
    if (!uid) throw new DataError('Требуется вход в систему', { status: 401 });
    const safeName = file.name.replace(/[^\w.-]+/g, '_');
    const path = `${folder}/${uid}/${Date.now()}-${safeName}`;
    const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: file.type || 'application/octet-stream',
    });
    if (error) throw new DataError(error.message || 'Не удалось загрузить файл', { status: error.status });
    const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
    return { file_url: pub.publicUrl, path };
  },
  /**
   * Загрузка изображения с проверкой типа и размера.
   * Возвращает { file_url, path } — путь нужен, чтобы при замене картинки
   * удалить старый объект и не засорять бакет «сиротами».
   */
  async uploadImage({ file, folder = 'images', maxBytes = 5 * 1024 * 1024 }) {
    if (!file) throw new DataError('Файл не выбран', { status: 400 });
    if (!file.type?.startsWith('image/')) {
      throw new DataError('Можно загрузить только изображение (PNG, JPEG, WebP, SVG)', { status: 400 });
    }
    if (file.size > maxBytes) {
      throw new DataError(
        `Файл слишком большой: ${(file.size / 1024 / 1024).toFixed(1)} МБ при лимите ${Math.round(maxBytes / 1024 / 1024)} МБ`,
        { status: 400 }
      );
    }
    return storage.upload({ file, folder });
  },

  async remove(path) {
    const { error } = await supabase.storage.from(BUCKET).remove([path]);
    if (error) throw new DataError(error.message, { status: error.status });
    return true;
  },
};

/* ----------------------------------------------------------- integrations */

const integrations = {
  Core: {
    /** Загрузка файла в Supabase Storage. */
    UploadFile: ({ file, folder }) => storage.upload({ file, folder }),
    /** Генерация через LLM вынесена в Edge-функцию; при её отсутствии — понятная ошибка, а не белый экран. */
    async InvokeLLM(payload) {
      const { data, error } = await supabase.functions.invoke('ai-generate', { body: payload });
      if (error) throw new DataError('AI-генерация недоступна: не развёрнута функция ai-generate', { status: error.status });
      return data;
    },
  },
};

/* ------------------------------------------------------------------- rpc */

const rpc = {
  /** BUG-014/015/016: единый источник всех счётчиков портала. */
  async portalStats() {
    const { data, error } = await supabase.rpc('portal_stats');
    if (error) throw new DataError(error.message, { status: error.status, code: error.code });
    return data || {};
  },
  /** BUG-010: глобальный поиск по сотрудникам, новостям, курсам, книгам, страницам. */
  async globalSearch(query, limit = 20) {
    const { data, error } = await supabase.rpc('global_search', { q: query, max_results: limit });
    if (error) throw new DataError(error.message, { status: error.status, code: error.code });
    return data || [];
  },
  /** BUG-003/004: атомарная идемпотентная запись на курс. */
  async enroll(courseId) {
    const { data, error } = await supabase.rpc('enroll_in_course', { p_course_id: courseId });
    if (error) throw new DataError(error.message, { status: error.status, code: error.code });
    return data;
  },
  /** Покупка в магазине наград: проверка баланса и списание одной транзакцией. */
  async purchaseStoreItem(itemId) {
    const { data, error } = await supabase.rpc('purchase_store_item', { p_item_id: itemId });
    if (error) throw new DataError(error.message, { status: error.status, code: error.code });
    return data;
  },
  /** Подача заявки по процессу: значения полей первого этапа. */
  async submitProcessRequest(processId, categoryId, values) {
    const { data, error } = await supabase.rpc('process_submit_request', {
      p_process_id: processId,
      p_category_id: categoryId ?? null,
      p_values: values ?? [],
    });
    if (error) throw new DataError(error.message, { status: error.status, code: error.code });
    return data;
  },

  /** Проведение заявки по маршруту: согласование, отклонение, исполнение. */
  async decideProcessRequest(requestId, routeId, comment, values) {
    const { data, error } = await supabase.rpc('process_decide', {
      p_request_id: requestId,
      p_route_id: routeId,
      p_comment: comment ?? null,
      p_values: values ?? [],
    });
    if (error) throw new DataError(error.message, { status: error.status, code: error.code });
    return data;
  },

  /** Отзыв собственной заявки. */
  async cancelProcessRequest(requestId, comment) {
    const { error } = await supabase.rpc('process_cancel_request', {
      p_request_id: requestId,
      p_comment: comment ?? null,
    });
    if (error) throw new DataError(error.message, { status: error.status, code: error.code });
    return true;
  },

  /** Кто попадёт под правило достижения, если запустить его сейчас. */
  async previewAchievementRule(param, operator, threshold) {
    const { data, error } = await supabase.rpc('preview_achievement_rule', {
      p_param: param,
      p_operator: operator,
      p_threshold: threshold,
    });
    if (error) throw new DataError(error.message, { status: error.status, code: error.code });
    return data || [];
  },

  /** Запуск автоправил достижений (кнопка «Проверить сейчас» в админке). */
  async applyAchievementRules(ruleId = null) {
    const { data, error } = await supabase.rpc('apply_achievement_rules', { p_rule_id: ruleId });
    if (error) throw new DataError(error.message, { status: error.status, code: error.code });
    return data || {};
  },

  /**
   * Счётчики просмотров — «выстрелил и забыл»: сбой не должен ломать страницу.
   *
   * Важно: supabase.rpc() возвращает построитель запроса. Он thenable, но метода
   * .catch() у него нет — вызов вида rpc(...).catch(...) падает с
   * «rpc(...).catch is not a function» и роняет весь рендер. Поэтому оборачиваем
   * в Promise.resolve.
   */
  registerNewsView(newsId) {
    if (!newsId) return Promise.resolve();
    return Promise.resolve(supabase.rpc('register_news_view', { p_news_id: newsId })).catch(() => {});
  },

  registerPageView(slug) {
    if (!slug) return Promise.resolve();
    return Promise.resolve(supabase.rpc('register_page_view', { p_slug: slug })).catch(() => {});
  },

  /** Баланс кошелька сотрудника, посчитанный на сервере. */
  async walletBalance(employeeId) {
    const { data, error } = await supabase.rpc('wallet_balance', { p_employee_id: employeeId });
    if (error) throw new DataError(error.message, { status: error.status, code: error.code });
    return data ?? 0;
  },
};

export const api = { entities, auth, users, storage, integrations, rpc, supabase };
export { DataError };
export default api;
