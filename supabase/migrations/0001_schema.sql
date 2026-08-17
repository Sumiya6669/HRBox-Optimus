-- =====================================================================
-- Optimus KZ — корпоративный портал. Схема данных.
-- Миграция 0001: типы, таблицы, индексы, ограничения целостности.
--
-- Ключевые решения по итогам аудита:
--  * BUG-002 — salary_band и notes вынесены в employee_private под роль HR.
--  * BUG-013 — уникальный индекс на (title, published_date) в news.
--  * BUG-004 — сущность enrollments вместо инкремента enrolled_count.
--  * BUG-039 — связи по department_id / branch_id, а не по строковым названиям.
--  * BUG-040 — флаг is_sample для отделения демо-данных от продакшена.
--  * BUG-082 — уникальность (type, period) в achievements.
--  * BUG-018/019 — статус опроса и счётчик ответов вычисляются, а не хранятся.
-- =====================================================================

create extension if not exists "pgcrypto";
create extension if not exists "pg_trgm";
create extension if not exists "unaccent";

-- ---------------------------------------------------------------- ENUM-типы

do $$ begin
  create type app_role as enum ('employee', 'manager', 'hr', 'admin');
exception when duplicate_object then null; end $$;

do $$ begin
  create type employee_status as enum ('active', 'on_leave', 'probation', 'dismissed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type request_status as enum ('pending', 'in_progress', 'resolved', 'rejected');
exception when duplicate_object then null; end $$;

do $$ begin
  create type leave_status as enum ('pending', 'approved', 'rejected', 'cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type publish_status as enum ('draft', 'published', 'scheduled', 'archived');
exception when duplicate_object then null; end $$;

do $$ begin
  create type survey_status as enum ('draft', 'active', 'closed', 'archived');
exception when duplicate_object then null; end $$;

do $$ begin
  create type audit_action as enum ('create', 'update', 'delete', 'login', 'logout', 'invite', 'approve', 'reject', 'export');
exception when duplicate_object then null; end $$;

-- ------------------------------------------------------------- справочники

create table if not exists branches (
  id           uuid primary key default gen_random_uuid(),
  city         text not null unique,
  address      text,
  timezone     text not null default 'Asia/Almaty',   -- BUG-045: РК полностью в UTC+5
  is_sample    boolean not null default false,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now()
);

create table if not exists departments (
  id           uuid primary key default gen_random_uuid(),
  name         text not null unique,
  head_name    text,
  head_id      uuid,
  parent_id    uuid references departments (id) on delete set null,
  is_sample    boolean not null default false,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now()
);

-- --------------------------------------------------------------- сотрудники

create table if not exists employees (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  position      text,
  branch_id     uuid references branches (id) on delete set null,
  department_id uuid references departments (id) on delete set null,
  -- Денормализованные названия оставлены только для отображения; источник правды — *_id.
  branch        text,
  department    text,
  status        employee_status not null default 'active',
  role_type     text check (role_type in ('sales', 'warehouse', 'office', 'hr', 'management')),
  hire_date     date,
  birth_date    date,
  email         text unique,
  phone         text,
  photo_url     text,
  manager_id    uuid references employees (id) on delete set null,
  manager_name  text,
  vacation_days_per_year int not null default 24,
  is_sample     boolean not null default false,
  created_date  timestamptz not null default now(),
  updated_date  timestamptz not null default now()
);

create index if not exists employees_department_idx on employees (department_id);
create index if not exists employees_branch_idx on employees (branch_id);
create index if not exists employees_manager_idx on employees (manager_id);
create index if not exists employees_name_trgm on employees using gin (name gin_trgm_ops);

-- BUG-002: зарплатная вилка и служебные заметки — отдельная таблица под роль HR.
create table if not exists employee_private (
  employee_id  uuid primary key references employees (id) on delete cascade,
  salary_band  text,
  notes        text,
  iin          text,
  bank_account text,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now()
);

alter table departments
  add constraint departments_head_fk foreign key (head_id) references employees (id) on delete set null
  not valid;

-- ------------------------------------------------------- профили и роли

create table if not exists profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  email        text not null,
  full_name    text,
  phone        text,
  role         app_role not null default 'employee',
  employee_id  uuid unique references employees (id) on delete set null,
  company_name text default 'Optimus KZ',
  city         text,
  locale       text not null default 'ru' check (locale in ('ru', 'kk')),
  is_active    boolean not null default true,
  last_login   timestamptz,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now()
);

create index if not exists profiles_role_idx on profiles (role);
create index if not exists profiles_employee_idx on profiles (employee_id);

-- ------------------------------------------------------------------ контент

create table if not exists news (
  id             uuid primary key default gen_random_uuid(),
  title          text not null,
  body           text,
  excerpt        text,
  category       text check (category in ('company', 'product', 'event', 'announcement', 'training')),
  image_url      text,
  author_id      uuid references profiles (id) on delete set null,
  author_name    text,
  published_date date not null default current_date,
  pinned         boolean not null default false,
  status         publish_status not null default 'draft',
  views          integer not null default 0 check (views >= 0),
  is_sample      boolean not null default false,
  created_date   timestamptz not null default now(),
  updated_date   timestamptz not null default now()
);

-- BUG-013: каждая новость выводилась дважды — 12 записей = 6 уникальных ×2.
create unique index if not exists news_title_date_uniq on news (lower(title), published_date);
create index if not exists news_published_idx on news (status, published_date desc);
create index if not exists news_title_trgm on news using gin (title gin_trgm_ops);

-- BUG-031: лайк был декоративным. Теперь это отдельная таблица, счётчик — агрегат.
create table if not exists news_likes (
  news_id      uuid not null references news (id) on delete cascade,
  user_id      uuid not null references profiles (id) on delete cascade,
  created_date timestamptz not null default now(),
  primary key (news_id, user_id)
);

-- BUG-032: детальная страница новости с комментариями.
create table if not exists comments (
  id           uuid primary key default gen_random_uuid(),
  entity_type  text not null check (entity_type in ('news', 'course', 'book', 'event', 'page')),
  entity_id    uuid not null,
  user_id      uuid not null references profiles (id) on delete cascade,
  author_name  text,
  body         text not null check (length(btrim(body)) > 0),
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now()
);
create index if not exists comments_entity_idx on comments (entity_type, entity_id, created_date);

-- BUG-008: CMS-страницы отдавали 404 — теперь у них есть публичный рендер по слагу.
create table if not exists pages (
  id             uuid primary key default gen_random_uuid(),
  title          text not null,
  slug           text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  body           text,
  status         publish_status not null default 'draft',
  published_date date,
  author_id      uuid references profiles (id) on delete set null,
  author_name    text,
  views          integer not null default 0,
  show_in_menu   boolean not null default false,
  is_sample      boolean not null default false,
  created_date   timestamptz not null default now(),
  updated_date   timestamptz not null default now()
);

create table if not exists events (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  type         text check (type in ('teambuilding', 'corporate', 'holiday', 'training')),
  date         date not null,
  end_date     date,
  location     text,
  branch_id    uuid references branches (id) on delete set null,
  description  text,
  photo_url    text,
  is_sample    boolean not null default false,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  constraint events_period_valid check (end_date is null or end_date >= date)
);
create index if not exists events_date_idx on events (date);

create table if not exists event_registrations (
  id           uuid primary key default gen_random_uuid(),
  event_id     uuid not null references events (id) on delete cascade,
  employee_id  uuid not null references employees (id) on delete cascade,
  created_date timestamptz not null default now(),
  unique (event_id, employee_id)
);

-- ------------------------------------------------------------------ обучение

create table if not exists courses (
  id               uuid primary key default gen_random_uuid(),
  title            text not null,
  description      text,
  format           text check (format in ('video', 'pdf', 'scorm', 'html', 'quiz')),
  category         text,
  duration_minutes integer check (duration_minutes is null or duration_minutes > 0),
  has_certificate  boolean not null default false,
  status           publish_status not null default 'draft',
  is_mandatory     boolean not null default false,
  deadline         date,
  is_sample        boolean not null default false,
  created_date     timestamptz not null default now(),
  updated_date     timestamptz not null default now()
);
create index if not exists courses_title_trgm on courses using gin (title gin_trgm_ops);

-- BUG-004/005/049: персональная запись на курс вместо мутации общей карточки.
create table if not exists enrollments (
  id            uuid primary key default gen_random_uuid(),
  employee_id   uuid not null references employees (id) on delete cascade,
  course_id     uuid not null references courses (id) on delete cascade,
  status        text not null default 'enrolled' check (status in ('enrolled', 'in_progress', 'completed', 'cancelled')),
  progress      integer not null default 0 check (progress between 0 and 100),
  enrolled_at   timestamptz not null default now(),
  completed_at  timestamptz,
  certificate_url text,
  created_date  timestamptz not null default now(),
  updated_date  timestamptz not null default now(),
  unique (employee_id, course_id)   -- идемпотентность: повторное «Записаться» не создаёт дубль
);
create index if not exists enrollments_course_idx on enrollments (course_id);
create index if not exists enrollments_employee_idx on enrollments (employee_id);

create table if not exists books (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  author        text,
  category      text,
  description   text,
  copies        integer not null default 1 check (copies >= 0),
  cover_url     text,
  is_sample     boolean not null default false,
  created_date  timestamptz not null default now(),
  updated_date  timestamptz not null default now()
);
create index if not exists books_title_trgm on books using gin (title gin_trgm_ops);

-- BUG-064: «3 экз.» ни к чему не вели — добавлена выдача книг.
create table if not exists book_loans (
  id           uuid primary key default gen_random_uuid(),
  book_id      uuid not null references books (id) on delete cascade,
  employee_id  uuid not null references employees (id) on delete cascade,
  status       text not null default 'reserved' check (status in ('reserved', 'issued', 'returned', 'cancelled')),
  reserved_at  timestamptz not null default now(),
  issued_at    timestamptz,
  returned_at  timestamptz,
  due_date     date,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now()
);
create unique index if not exists book_loans_active_uniq
  on book_loans (book_id, employee_id)
  where status in ('reserved', 'issued');

create table if not exists trainings (
  id             uuid primary key default gen_random_uuid(),
  title          text not null,
  type           text check (type in ('offline', 'online')),
  category       text,
  date           date,
  trainer        text,
  description    text,
  duration_hours numeric(5, 1),
  is_sample      boolean not null default false,
  created_date   timestamptz not null default now(),
  updated_date   timestamptz not null default now()
);

create table if not exists training_completions (
  id             uuid primary key default gen_random_uuid(),
  employee_id    uuid not null references employees (id) on delete cascade,
  training_id    uuid references trainings (id) on delete set null,
  training_title text,
  date_completed date not null default current_date,
  created_date   timestamptz not null default now(),
  unique (employee_id, training_id)
);

-- ------------------------------------------------------- цели, KPI, развитие

create table if not exists goals (
  id            uuid primary key default gen_random_uuid(),
  employee_id   uuid not null references employees (id) on delete cascade,
  employee_name text,
  title         text not null check (length(btrim(title)) > 0),
  description   text,
  type          text not null default 'objective' check (type in ('objective', 'key_result')),
  parent_id     uuid references goals (id) on delete cascade,
  deadline      date,
  progress      integer not null default 0 check (progress between 0 and 100),
  status        text not null default 'active' check (status in ('draft', 'active', 'completed', 'cancelled')),
  created_by    uuid references profiles (id) on delete set null,
  created_date  timestamptz not null default now(),
  updated_date  timestamptz not null default now()
);
create index if not exists goals_employee_idx on goals (employee_id);

create table if not exists kpis (
  id           uuid primary key default gen_random_uuid(),
  employee_id  uuid not null references employees (id) on delete cascade,
  title        text not null,
  scope        text,
  period       text,
  target       numeric(14, 2),
  actual       numeric(14, 2),
  unit         text,
  weight       numeric(5, 2) not null default 1,
  status       text not null default 'active' check (status in ('draft', 'active', 'approved', 'overdue')),
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now()
);
create index if not exists kpis_employee_idx on kpis (employee_id);

create table if not exists development_plans (
  id            uuid primary key default gen_random_uuid(),
  employee_id   uuid not null references employees (id) on delete cascade,
  employee_name text,
  title         text not null,
  competency    text,
  current_level text check (current_level in ('novice', 'intermediate', 'advanced', 'expert')),
  target_level  text check (target_level in ('novice', 'intermediate', 'advanced', 'expert')),
  deadline      date,
  mentor        text,
  notes         text,
  progress      integer not null default 0 check (progress between 0 and 100),
  status        text not null default 'active' check (status in ('active', 'completed', 'paused')),
  created_date  timestamptz not null default now(),
  updated_date  timestamptz not null default now()
);
create index if not exists development_plans_employee_idx on development_plans (employee_id);

-- ------------------------------------------------------------------- отпуска

create table if not exists leave_requests (
  id             uuid primary key default gen_random_uuid(),
  employee_id    uuid not null references employees (id) on delete cascade,
  employee_name  text,
  type           text not null default 'vacation' check (type in ('vacation', 'sick', 'personal', 'unpaid')),
  start_date     date not null,
  end_date       date not null,
  -- BUG-017: длительность считается один раз и в одном месте — это генерируемая колонка.
  days           integer generated always as ((end_date - start_date) + 1) stored,
  notes          text,
  status         leave_status not null default 'pending',
  approver_id    uuid references profiles (id) on delete set null,
  approver_name  text,
  decided_at     timestamptz,
  created_date   timestamptz not null default now(),
  updated_date   timestamptz not null default now(),
  constraint leave_period_valid check (end_date >= start_date)
);
create index if not exists leave_employee_idx on leave_requests (employee_id);
create index if not exists leave_status_idx on leave_requests (status, start_date);

-- --------------------------------------------------------------- заявки, HR

create table if not exists service_requests (
  id            uuid primary key default gen_random_uuid(),
  employee_id   uuid not null references employees (id) on delete cascade,
  employee_name text,
  title         text not null check (length(btrim(title)) > 0),
  body          text,
  type          text not null default 'other' check (type in ('document', 'equipment', 'access', 'reference', 'other')),
  priority      text not null default 'medium' check (priority in ('low', 'medium', 'high')),
  status        request_status not null default 'pending',
  resolution    text,
  assignee_id   uuid references profiles (id) on delete set null,
  due_date      date,
  resolved_at   timestamptz,
  created_date  timestamptz not null default now(),
  updated_date  timestamptz not null default now()
);
create index if not exists service_requests_employee_idx on service_requests (employee_id);
create index if not exists service_requests_status_idx on service_requests (status, created_date desc);

-- BUG-033: карточка заявки не открывалась — теперь есть переписка по заявке.
create table if not exists request_comments (
  id           uuid primary key default gen_random_uuid(),
  request_id   uuid not null references service_requests (id) on delete cascade,
  user_id      uuid not null references profiles (id) on delete cascade,
  author_name  text,
  body         text not null check (length(btrim(body)) > 0),
  is_internal  boolean not null default false,
  created_date timestamptz not null default now()
);
create index if not exists request_comments_request_idx on request_comments (request_id, created_date);

create table if not exists hr_documents (
  id            uuid primary key default gen_random_uuid(),
  employee_id   uuid not null references employees (id) on delete cascade,
  employee_name text,
  title         text not null,
  type          text not null default 'other' check (type in ('contract', 'order', 'statement', 'certificate', 'other')),
  file_url      text,
  file_path     text,
  upload_date   date not null default current_date,
  uploaded_by   uuid references profiles (id) on delete set null,
  created_date  timestamptz not null default now(),
  updated_date  timestamptz not null default now()
);
create index if not exists hr_documents_employee_idx on hr_documents (employee_id);

create table if not exists user_files (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references profiles (id) on delete cascade,
  filename     text not null,
  file_url     text,
  file_path    text,
  file_type    text,
  size         bigint not null default 0,
  category     text not null default 'other' check (category in ('document', 'image', 'video', 'archive', 'other')),
  upload_date  date not null default current_date,
  created_date timestamptz not null default now()
);
create index if not exists user_files_user_idx on user_files (user_id);

create table if not exists onboarding_tasks (
  id             uuid primary key default gen_random_uuid(),
  employee_id    uuid not null references employees (id) on delete cascade,
  employee_name  text,
  role_type      text check (role_type in ('sales', 'warehouse', 'office', 'hr', 'management')),
  task           text not null,
  mentor_name    text,
  completed      boolean not null default false,
  completed_date date,
  due_date       date,
  sort_order     integer not null default 0,
  created_date   timestamptz not null default now(),
  updated_date   timestamptz not null default now()
);
create index if not exists onboarding_employee_idx on onboarding_tasks (employee_id);

-- ------------------------------------------------------------------- опросы

create table if not exists surveys (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  description   text,
  type          text not null default 'regular' check (type in ('regular', 'pulse', '360', 'icsi')),
  status        survey_status not null default 'draft',
  category      text,
  start_date    date,
  end_date      date,
  anonymous     boolean not null default false,
  questions     jsonb not null default '[]'::jsonb,
  is_sample     boolean not null default false,
  created_by    uuid references profiles (id) on delete set null,
  created_date  timestamptz not null default now(),
  updated_date  timestamptz not null default now(),
  -- BUG-018: опрос нельзя опубликовать без вопросов.
  constraint surveys_active_needs_questions
    check (status <> 'active' or jsonb_array_length(questions) > 0)
);
create index if not exists surveys_status_idx on surveys (status, end_date);

create table if not exists survey_sessions (
  id                uuid primary key default gen_random_uuid(),
  survey_id         uuid not null references surveys (id) on delete cascade,
  survey_title      text,
  start_date        date not null default current_date,
  end_date          date,
  status            survey_status not null default 'draft',
  target_count      integer not null default 0,
  anonymous         boolean not null default false,
  created_date      timestamptz not null default now(),
  updated_date      timestamptz not null default now(),
  constraint survey_sessions_period_valid check (end_date is null or end_date >= start_date)
);
create index if not exists survey_sessions_survey_idx on survey_sessions (survey_id);

create table if not exists survey_responses (
  id            uuid primary key default gen_random_uuid(),
  survey_id     uuid not null references surveys (id) on delete cascade,
  session_id    uuid references survey_sessions (id) on delete cascade,
  survey_title  text,
  employee_id   uuid references employees (id) on delete set null,
  employee_name text,
  answers       jsonb not null default '[]'::jsonb,
  date          timestamptz not null default now(),
  created_date  timestamptz not null default now()
);
create index if not exists survey_responses_survey_idx on survey_responses (survey_id);
create index if not exists survey_responses_session_idx on survey_responses (session_id);
-- Один ответ на сессию от одного сотрудника (для неанонимных опросов).
create unique index if not exists survey_responses_once
  on survey_responses (session_id, employee_id)
  where employee_id is not null;

create table if not exists auto_surveys (
  id            uuid primary key default gen_random_uuid(),
  survey_id     uuid not null references surveys (id) on delete cascade,
  survey_title  text,
  trigger_type  text not null check (trigger_type in ('schedule', 'onboarding', 'birthday', 'tenure', 'monthly_pulse')),
  schedule_date date,
  trigger_event text,
  target_count  integer not null default 0,
  active        boolean not null default true,
  last_run      timestamptz,
  next_run      timestamptz,
  created_date  timestamptz not null default now(),
  updated_date  timestamptz not null default now()
);

-- ---------------------------------------------------- геймификация и кошелёк

create table if not exists award_reasons (
  id           uuid primary key default gen_random_uuid(),
  code         text not null unique,
  title        text not null,
  category     text not null default 'other' check (category in ('work', 'social', 'training', 'milestone', 'other')),
  description  text,
  default_points integer,
  active       boolean not null default true,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now()
);

create table if not exists achievements (
  id            uuid primary key default gen_random_uuid(),
  employee_id   uuid not null references employees (id) on delete cascade,
  employee_name text,
  title         text not null,
  type          text not null default 'special' check (type in ('employee_of_month', 'tenure', 'special', 'kpi', 'birthday')),
  period        date,
  points        integer not null default 0,
  date          date not null default current_date,
  auto          boolean not null default false,
  rule          text,
  description   text,
  reason_code   text references award_reasons (code) on delete set null,
  icon          text,
  is_sample     boolean not null default false,
  created_date  timestamptz not null default now(),
  updated_date  timestamptz not null default now()
);
-- BUG-082: два разных сотрудника получили «Сотрудник месяца» за один период.
create unique index if not exists achievements_month_uniq
  on achievements (type, period)
  where type = 'employee_of_month' and period is not null;
create index if not exists achievements_employee_idx on achievements (employee_id);

create table if not exists store_items (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  description  text,
  price        integer not null check (price >= 0),   -- цена во внутренних баллах
  icon         text,
  category     text,
  stock        integer not null default -1,           -- -1 = не ограничено
  active       boolean not null default true,
  is_sample    boolean not null default false,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now()
);

create table if not exists store_orders (
  id            uuid primary key default gen_random_uuid(),
  item_id       uuid not null references store_items (id) on delete restrict,
  item_name     text not null,
  -- BUG-038: цена фиксируется в момент покупки, иначе история расходится с каталогом.
  price_at_purchase integer not null check (price_at_purchase >= 0),
  employee_id   uuid not null references employees (id) on delete cascade,
  employee_name text,
  status        text not null default 'pending' check (status in ('pending', 'issued', 'cancelled')),
  transaction_id uuid,
  created_date  timestamptz not null default now(),
  updated_date  timestamptz not null default now()
);

create table if not exists wallet_transactions (
  id            uuid primary key default gen_random_uuid(),
  employee_id   uuid not null references employees (id) on delete cascade,
  employee_name text,
  amount        integer not null check (amount <> 0),
  type          text not null check (type in ('achievement', 'manual', 'workflow', 'training', 'tenure', 'spend', 'correction')),
  reason        text,
  reason_code   text references award_reasons (code) on delete set null,
  date          date not null default current_date,
  admin_id      uuid references profiles (id) on delete set null,
  admin_name    text,
  -- BUG-035: колонки «Филиал» и «Отдел» в операциях всегда были пустыми.
  branch_id     uuid references branches (id) on delete set null,
  department_id uuid references departments (id) on delete set null,
  item_id       uuid references store_items (id) on delete set null,
  item_name     text,
  is_correction boolean not null default false,
  linked_operation_id uuid references wallet_transactions (id) on delete set null,
  created_date  timestamptz not null default now()
);
create index if not exists wallet_employee_idx on wallet_transactions (employee_id, date desc);
create index if not exists wallet_date_idx on wallet_transactions (date desc);

create table if not exists awards (
  id            uuid primary key default gen_random_uuid(),
  employee_id   uuid not null references employees (id) on delete cascade,
  employee_name text,
  type          text check (type in ('employee_of_month', 'tenure', 'special', 'kpi')),
  description   text,
  date          date not null default current_date,
  created_date  timestamptz not null default now()
);

-- ---------------------------------------------------------------- рекрутинг

create table if not exists vacancies (
  id                uuid primary key default gen_random_uuid(),
  title             text not null,
  department_id     uuid references departments (id) on delete set null,
  branch_id         uuid references branches (id) on delete set null,
  department        text,
  branch            text,
  status            text not null default 'open' check (status in ('open', 'on_hold', 'closed')),
  description       text,
  requirements      text,
  salary_range      text,
  assigned_recruiter text,
  is_sample         boolean not null default false,
  created_date      timestamptz not null default now(),
  updated_date      timestamptz not null default now()
);

create table if not exists candidates (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  vacancy_id    uuid references vacancies (id) on delete set null,
  vacancy_title text,
  phone         text,
  email         text,
  notes         text,
  rating        integer check (rating between 0 and 5),
  status        text not null default 'new' check (status in ('new', 'screening', 'interview', 'offer', 'hired', 'rejected')),
  is_sample     boolean not null default false,
  created_date  timestamptz not null default now(),
  updated_date  timestamptz not null default now()
);
create index if not exists candidates_vacancy_idx on candidates (vacancy_id);

-- ------------------------------------------------- уведомления и избранное

create table if not exists notifications (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references profiles (id) on delete cascade,
  title        text not null,
  body         text,
  type         text not null default 'info' check (type in ('info', 'success', 'warning', 'approval', 'mention', 'system')),
  link         text,
  read         boolean not null default false,
  date         timestamptz not null default now(),
  created_date timestamptz not null default now()
);
create index if not exists notifications_user_idx on notifications (user_id, read, date desc);

create table if not exists favorites (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references profiles (id) on delete cascade,
  item_type    text not null check (item_type in ('news', 'course', 'book', 'event', 'page')),
  item_id      uuid not null,
  item_title   text,
  item_image   text,
  item_meta    text,
  date         timestamptz not null default now(),
  created_date timestamptz not null default now(),
  -- BUG-079: в избранном лежала новость, которой нет в базе.
  unique (user_id, item_type, item_id)
);
create index if not exists favorites_user_idx on favorites (user_id);

create table if not exists feedback (
  id            uuid primary key default gen_random_uuid(),
  employee_id   uuid references employees (id) on delete set null,
  employee_name text,
  type          text not null default 'other' check (type in ('idea', 'problem', 'gratitude', 'other')),
  subject       text,
  body          text not null check (length(btrim(body)) > 0),
  anonymous     boolean not null default false,
  status        request_status not null default 'pending',
  response      text,
  created_date  timestamptz not null default now(),
  updated_date  timestamptz not null default now()
);

-- -------------------------------------------------- настройки и журнал аудита

-- BUG-085: сущности Settings в приложении не существовало — сохранять было некуда.
create table if not exists settings (
  key          text primary key,
  value        jsonb not null default '{}'::jsonb,
  updated_by   uuid references profiles (id) on delete set null,
  updated_date timestamptz not null default now()
);

-- BUG-009: журнал аудита не фиксировал реальные действия.
create table if not exists audit_logs (
  id           bigserial primary key,
  user_id      uuid references profiles (id) on delete set null,
  user_name    text,
  user_email   text,
  action       audit_action not null,
  entity_type  text not null,
  entity_id    text,
  description  text,
  changes      jsonb,
  ip_address   inet,
  date         timestamptz not null default now()
);
create index if not exists audit_date_idx on audit_logs (date desc);
create index if not exists audit_entity_idx on audit_logs (entity_type, date desc);
create index if not exists audit_user_idx on audit_logs (user_id, date desc);

-- --------------------------------------------- автообновление updated_date

create or replace function set_updated_date()
returns trigger
language plpgsql
as $$
begin
  new.updated_date := now();
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'branches','departments','employees','employee_private','profiles','news','comments','pages',
    'events','courses','enrollments','books','book_loans','trainings','goals','kpis',
    'development_plans','leave_requests','service_requests','hr_documents','onboarding_tasks',
    'surveys','survey_sessions','auto_surveys','award_reasons','achievements','store_items',
    'store_orders','vacancies','candidates','feedback'
  ] loop
    execute format('drop trigger if exists trg_%1$s_updated on %1$I', t);
    execute format('create trigger trg_%1$s_updated before update on %1$I
                    for each row execute function set_updated_date()', t);
  end loop;
end $$;
