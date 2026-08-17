-- =====================================================================
-- Миграция 0007: конструктор бизнес-процессов и заявок.
--
-- Реализует раздел 1.1 технического задания: «Автоматическое начисление
-- корпоративной валюты через заявку и согласование».
--
-- Процесс — это цепочка этапов трёх типов:
--   collect  «Сбор информации» — поля ввода, которые заполняет заявитель;
--   approve  «Согласование»    — ответственные принимают или отклоняют;
--   execute  «Исполнение»      — начисление баллов и закрытие заявки.
--
-- Ключевое требование: у варианта ответа может быть своя стоимость в баллах
-- («предложение идеи для контента — 15 баллов»), и при прохождении заявки
-- баллы начисляются автоматически, без ручной операции в кошельке.
-- =====================================================================

-- ------------------------------------------------------------ типы

do $$ begin
  create type process_stage_type as enum ('collect', 'approve', 'execute');
exception when duplicate_object then null; end $$;

do $$ begin
  create type process_field_type as enum
    ('select', 'multiselect', 'text', 'textarea', 'number', 'date', 'file', 'image', 'employee');
exception when duplicate_object then null; end $$;

do $$ begin
  create type process_route_kind as enum ('next', 'reject', 'resolve');
exception when duplicate_object then null; end $$;

do $$ begin
  create type process_request_status as enum
    ('draft', 'in_progress', 'rejected', 'resolved', 'cancelled');
exception when duplicate_object then null; end $$;

-- --------------------------------------------------------- процессы

create table if not exists processes (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  description   text,
  icon          text,
  image_url     text,
  image_path    text,
  is_active     boolean not null default false,
  -- «Разрешить самостоятельный выбор категории» с первого этапа конструктора
  allow_category_choice boolean not null default false,
  -- Кому процесс виден в каталоге: null — всем сотрудникам
  visible_to_role app_role,
  sort_order    integer not null default 0,
  created_by    uuid references profiles (id) on delete set null,
  created_date  timestamptz not null default now(),
  updated_date  timestamptz not null default now()
);

-- Категории процесса: «Обучение (рецензии, тренинги, мастер-классы, наставничество)»
create table if not exists process_categories (
  id           uuid primary key default gen_random_uuid(),
  process_id   uuid not null references processes (id) on delete cascade,
  name         text not null,
  description  text,
  sort_order   integer not null default 0,
  is_active    boolean not null default true,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now()
);
create index if not exists process_categories_process_idx on process_categories (process_id, sort_order);

-- ------------------------------------------------------------ этапы

create table if not exists process_stages (
  id            uuid primary key default gen_random_uuid(),
  process_id    uuid not null references processes (id) on delete cascade,
  name          text not null,
  type          process_stage_type not null default 'collect',
  sort_order    integer not null default 0,

  -- Согласование и исполнение: «Ответственные (любой из)» и «Наблюдатели».
  -- Массивы, потому что в конструкторе это списки людей, а не одна ссылка.
  assignee_ids  uuid[] not null default '{}',
  watcher_ids   uuid[] not null default '{}',
  -- «Группы ответственных» — роль целиком (например, все HR)
  assignee_role app_role,
  watcher_role  app_role,

  -- «Согласование руководителем подающего заявку»
  approve_by_manager boolean not null default false,
  -- «Установить дедлайн», в рабочих часах от попадания заявки на этап
  deadline_hours integer check (deadline_hours is null or deadline_hours > 0),

  created_date  timestamptz not null default now(),
  updated_date  timestamptz not null default now(),
  unique (process_id, sort_order) deferrable initially deferred
);
create index if not exists process_stages_process_idx on process_stages (process_id, sort_order);

-- ------------------------------------------------------ поля ввода

create table if not exists process_fields (
  id           uuid primary key default gen_random_uuid(),
  stage_id     uuid not null references process_stages (id) on delete cascade,
  label        text not null,
  hint         text,
  type         process_field_type not null default 'text',
  /*
   * Варианты для select/multiselect:
   *   [{ "value": "idea", "label": "предложение идеи для контента", "points": 15 }]
   * Поле points и делает начисление автоматическим: движок берёт стоимость
   * выбранного варианта, а не просит согласующего вводить число руками.
   */
  options      jsonb not null default '[]'::jsonb,
  required     boolean not null default false,
  sort_order   integer not null default 0,
  -- «Видимость полей»: кому поле показывается на следующих этапах
  visible_to_role app_role,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  constraint process_fields_options_valid
    check (type not in ('select', 'multiselect') or jsonb_typeof(options) = 'array')
);
create index if not exists process_fields_stage_idx on process_fields (stage_id, sort_order);

-- -------------------------------------------------------- маршруты

create table if not exists process_routes (
  id              uuid primary key default gen_random_uuid(),
  stage_id        uuid not null references process_stages (id) on delete cascade,
  kind            process_route_kind not null default 'next',
  -- Для kind='next' — куда идёт заявка дальше
  target_stage_id uuid references process_stages (id) on delete cascade,
  -- «Ввод решения обяз»: требовать комментарий при переходе
  require_comment boolean not null default false,
  sort_order      integer not null default 0,
  created_date    timestamptz not null default now(),
  updated_date    timestamptz not null default now(),
  -- «Следующий этап» обязан указывать цель; «Считать отклонённой» и
  -- «Считать решённой» — терминальные и цели не имеют.
  constraint process_routes_target_valid check (
    (kind = 'next' and target_stage_id is not null) or
    (kind <> 'next' and target_stage_id is null)
  ),
  constraint process_routes_no_self_loop check (target_stage_id is distinct from stage_id)
);
create index if not exists process_routes_stage_idx on process_routes (stage_id, sort_order);

-- --------------------------------------------------------- заявки

create table if not exists process_requests (
  id               uuid primary key default gen_random_uuid(),
  process_id       uuid not null references processes (id) on delete restrict,
  process_name     text,
  category_id      uuid references process_categories (id) on delete set null,
  category_name    text,
  employee_id      uuid not null references employees (id) on delete cascade,
  employee_name    text,
  current_stage_id uuid references process_stages (id) on delete set null,
  status           process_request_status not null default 'in_progress',
  -- Сколько баллов начислено по заявке (итог этапа «Исполнение»)
  points_awarded   integer not null default 0,
  transaction_id   uuid references wallet_transactions (id) on delete set null,
  due_date         timestamptz,
  resolved_at      timestamptz,
  created_date     timestamptz not null default now(),
  updated_date     timestamptz not null default now()
);
create index if not exists process_requests_employee_idx on process_requests (employee_id, created_date desc);
create index if not exists process_requests_stage_idx on process_requests (current_stage_id) where status = 'in_progress';
create index if not exists process_requests_status_idx on process_requests (status, created_date desc);

-- Значения полей заявки
create table if not exists process_request_values (
  id           uuid primary key default gen_random_uuid(),
  request_id   uuid not null references process_requests (id) on delete cascade,
  field_id     uuid not null references process_fields (id) on delete cascade,
  stage_id     uuid not null references process_stages (id) on delete cascade,
  -- Денормализованная подпись поля: конструктор могут переименовать позже,
  -- а заявка должна остаться читаемой такой, какой её подавали.
  field_label  text,
  value_text   text,
  value_number numeric(14, 2),
  value_json   jsonb,
  file_url     text,
  file_path    text,
  created_date timestamptz not null default now(),
  unique (request_id, field_id)
);
create index if not exists process_request_values_request_idx on process_request_values (request_id);

-- История: кто, когда и с каким решением двигал заявку
create table if not exists process_request_history (
  id           bigserial primary key,
  request_id   uuid not null references process_requests (id) on delete cascade,
  stage_id     uuid references process_stages (id) on delete set null,
  stage_name   text,
  actor_id     uuid references profiles (id) on delete set null,
  actor_name   text,
  action       text not null check (action in
                 ('submitted', 'approved', 'rejected', 'executed', 'commented', 'cancelled')),
  comment      text,
  created_date timestamptz not null default now()
);
create index if not exists process_request_history_request_idx on process_request_history (request_id, created_date);

-- ------------------------------------------- автообновление updated_date

do $$
declare t text;
begin
  foreach t in array array[
    'processes','process_categories','process_stages','process_fields',
    'process_routes','process_requests'
  ] loop
    execute format('drop trigger if exists trg_%1$s_updated on %1$I', t);
    execute format('create trigger trg_%1$s_updated before update on %1$I
                    for each row execute function set_updated_date()', t);
  end loop;
end $$;

-- Аудит изменений конструктора и движения заявок.
do $$
declare t text;
begin
  foreach t in array array['processes','process_stages','process_fields','process_routes','process_requests'] loop
    execute format('drop trigger if exists trg_%1$s_audit on %1$I', t);
    execute format('create trigger trg_%1$s_audit after insert or update or delete on %1$I
                    for each row execute function audit_trigger()', t);
  end loop;
end $$;
