-- =====================================================================
-- Миграция 0015: уроки курса, прохождение и тестирование.
--
-- Раньше «курс» был одной карточкой с описанием: ни уроков, ни материалов, ни
-- проверки знаний. Прогресс в enrollments был числом, которое некому было
-- посчитать — его выставляли вручную, и он ничего не значил.
--
-- Теперь:
--   • курс состоит из уроков (видео, документ, текст, ссылка);
--   • прохождение урока фиксируется отдельно, и прогресс курса СЧИТАЕТСЯ из них;
--   • к курсу можно прикрепить тест с ограничением времени, порогом сдачи и
--     числом попыток;
--   • результат теста проверяет СЕРВЕР.
--
-- ГЛАВНОЕ ПРО ТЕСТЫ. Правильные ответы не отдаются в браузер вообще — ни в
-- каком виде. Если бы вопросы приходили обычной выборкой, флаг «верно» лежал бы
-- в ответе API, и любой сотрудник увидел бы ключ в консоли разработчика за
-- десять секунд. Поэтому вопросы выдаёт функция, которая этот флаг вырезает, а
-- проверка ответов идёт целиком в базе.
-- =====================================================================

-- ------------------------------------------------------------------ уроки

create table if not exists course_lessons (
  id               uuid primary key default gen_random_uuid(),
  course_id        uuid not null references courses(id) on delete cascade,
  position         integer not null default 1,
  title            text not null,
  description      text,
  type             text not null default 'video'
                     check (type in ('video', 'pdf', 'text', 'link')),
  video_url        text,
  video_path       text,          -- путь в хранилище, чтобы файл можно было удалить
  content          text,          -- для типа text
  duration_seconds integer check (duration_seconds is null or duration_seconds > 0),
  required         boolean not null default true,
  created_date     timestamptz not null default now(),
  updated_date     timestamptz not null default now()
);

create index if not exists course_lessons_course_idx on course_lessons (course_id, position);

comment on column course_lessons.required is
  'Необязательные уроки не влияют на процент прохождения курса.';

alter table course_lessons enable row level security;
alter table course_lessons force row level security;

drop policy if exists course_lessons_read on course_lessons;
create policy course_lessons_read on course_lessons
  for select using (
    is_authenticated() and exists (
      select 1 from courses c
       where c.id = course_lessons.course_id
         and (c.status = 'published' or is_hr())
    )
  );

drop policy if exists course_lessons_write on course_lessons;
create policy course_lessons_write on course_lessons
  using (is_hr()) with check (is_hr());

drop trigger if exists trg_course_lessons_updated on course_lessons;
create trigger trg_course_lessons_updated
  before update on course_lessons
  for each row execute function set_updated_date();

-- --------------------------------------------------------- прохождение урока

create table if not exists lesson_progress (
  id               uuid primary key default gen_random_uuid(),
  lesson_id        uuid not null references course_lessons(id) on delete cascade,
  course_id        uuid not null references courses(id) on delete cascade,
  employee_id      uuid not null references employees(id) on delete cascade,
  status           text not null default 'in_progress'
                     check (status in ('in_progress', 'completed')),
  position_seconds integer not null default 0,
  completed_at     timestamptz,
  created_date     timestamptz not null default now(),
  updated_date     timestamptz not null default now(),
  unique (lesson_id, employee_id)
);

create index if not exists lesson_progress_employee_idx on lesson_progress (employee_id, course_id);

alter table lesson_progress enable row level security;
alter table lesson_progress force row level security;

drop policy if exists lesson_progress_read on lesson_progress;
create policy lesson_progress_read on lesson_progress
  for select using (owns_employee(employee_id) or is_hr());

-- Писать может только сам сотрудник про себя. Иначе один человек мог бы
-- «закрыть» обязательный курс за другого.
drop policy if exists lesson_progress_write on lesson_progress;
create policy lesson_progress_write on lesson_progress
  using (owns_employee(employee_id)) with check (owns_employee(employee_id));

drop trigger if exists trg_lesson_progress_updated on lesson_progress;
create trigger trg_lesson_progress_updated
  before update on lesson_progress
  for each row execute function set_updated_date();

-- ------------------------------------------------------------------- тесты

create table if not exists course_tests (
  id                  uuid primary key default gen_random_uuid(),
  course_id           uuid not null unique references courses(id) on delete cascade,
  title               text not null,
  description         text,
  time_limit_minutes  integer check (time_limit_minutes is null or time_limit_minutes > 0),
  pass_score          integer not null default 80 check (pass_score between 1 and 100),
  attempts_limit      integer check (attempts_limit is null or attempts_limit > 0),
  shuffle_questions   boolean not null default false,
  show_correct        boolean not null default false,
  active              boolean not null default true,
  created_date        timestamptz not null default now(),
  updated_date        timestamptz not null default now()
);

comment on column course_tests.attempts_limit is 'null — попытки не ограничены';
comment on column course_tests.show_correct is
  'Показывать ли верные ответы после сдачи. По умолчанию нет: иначе первый сдавший разошлёт ключ остальным.';

alter table course_tests enable row level security;
alter table course_tests force row level security;

drop policy if exists course_tests_read on course_tests;
create policy course_tests_read on course_tests
  for select using (is_authenticated());

drop policy if exists course_tests_write on course_tests;
create policy course_tests_write on course_tests
  using (is_hr()) with check (is_hr());

drop trigger if exists trg_course_tests_updated on course_tests;
create trigger trg_course_tests_updated
  before update on course_tests for each row execute function set_updated_date();

create table if not exists test_questions (
  id           uuid primary key default gen_random_uuid(),
  test_id      uuid not null references course_tests(id) on delete cascade,
  position     integer not null default 1,
  text         text not null,
  hint         text,
  type         text not null default 'single' check (type in ('single', 'multiple')),
  points       integer not null default 1 check (points > 0),
  required     boolean not null default true,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now()
);

create index if not exists test_questions_test_idx on test_questions (test_id, position);

alter table test_questions enable row level security;
alter table test_questions force row level security;

-- Сами формулировки вопросов не секрет — секрет в том, какой вариант верный.
drop policy if exists test_questions_read on test_questions;
create policy test_questions_read on test_questions
  for select using (is_authenticated());

drop policy if exists test_questions_write on test_questions;
create policy test_questions_write on test_questions
  using (is_hr()) with check (is_hr());

drop trigger if exists trg_test_questions_updated on test_questions;
create trigger trg_test_questions_updated
  before update on test_questions for each row execute function set_updated_date();

create table if not exists test_options (
  id           uuid primary key default gen_random_uuid(),
  question_id  uuid not null references test_questions(id) on delete cascade,
  position     integer not null default 1,
  text         text not null,
  is_correct   boolean not null default false,
  created_date timestamptz not null default now()
);

create index if not exists test_options_question_idx on test_options (question_id, position);

alter table test_options enable row level security;
alter table test_options force row level security;

-- КЛЮЧЕВОЕ МЕСТО. Таблицу вариантов сотрудник не читает вообще: в ней лежит
-- флаг is_correct. Варианты приходят через start_test_attempt(), которая этот
-- флаг вырезает. Читать напрямую может только HR — из конструктора теста.
drop policy if exists test_options_read on test_options;
create policy test_options_read on test_options
  for select using (is_hr());

drop policy if exists test_options_write on test_options;
create policy test_options_write on test_options
  using (is_hr()) with check (is_hr());

create table if not exists test_attempts (
  id            uuid primary key default gen_random_uuid(),
  test_id       uuid not null references course_tests(id) on delete cascade,
  course_id     uuid not null references courses(id) on delete cascade,
  employee_id   uuid not null references employees(id) on delete cascade,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  deadline_at   timestamptz,           -- фиксируем на сервере, а не считаем в браузере
  score_percent integer,
  correct_count integer,
  total_count   integer,
  passed        boolean,
  answers       jsonb,                 -- что человек выбрал, для разбора
  created_date  timestamptz not null default now()
);

create index if not exists test_attempts_employee_idx on test_attempts (employee_id, test_id, started_at desc);
create index if not exists test_attempts_course_idx on test_attempts (course_id, finished_at desc);

alter table test_attempts enable row level security;
alter table test_attempts force row level security;

drop policy if exists test_attempts_read on test_attempts;
create policy test_attempts_read on test_attempts
  for select using (owns_employee(employee_id) or is_hr());

-- Писать попытки напрямую нельзя: и старт, и проверка идут только через
-- функции. Иначе можно было бы вписать себе passed = true одним запросом.
drop policy if exists test_attempts_write on test_attempts;
create policy test_attempts_write on test_attempts
  for update using (is_hr()) with check (is_hr());

-- ------------------------------------------------------- пересчёт прогресса

/**
 * Прогресс курса = доля пройденных ОБЯЗАТЕЛЬНЫХ уроков.
 *
 * Считается триггером, а не клиентом. Клиентский подсчёт означал бы, что цифра
 * зависит от того, дождался ли браузер ответа, — и «100 %» появлялось бы у
 * человека, который просто быстро пролистал уроки.
 *
 * Курс считается завершённым, когда пройдены все обязательные уроки И сдан
 * тест, если он к курсу привязан. Без второго условия обязательное обучение
 * закрывалось бы простым открытием страниц.
 */
create or replace function recalc_course_progress(p_employee uuid, p_course uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total     integer;
  v_done      integer;
  v_progress  integer;
  v_has_test  boolean;
  v_passed    boolean;
  v_status    text;
begin
  select count(*) into v_total
    from course_lessons where course_id = p_course and required;

  select count(*) into v_done
    from lesson_progress lp
    join course_lessons cl on cl.id = lp.lesson_id and cl.required
   where lp.employee_id = p_employee
     and lp.course_id = p_course
     and lp.status = 'completed';

  v_progress := case when v_total = 0 then 0
                     else least(100, round(v_done * 100.0 / v_total))::integer end;

  select exists (select 1 from course_tests where course_id = p_course and active)
    into v_has_test;

  select exists (
    select 1 from test_attempts
     where employee_id = p_employee and course_id = p_course and passed
  ) into v_passed;

  v_status := case
    when v_total > 0 and v_done >= v_total and (not v_has_test or v_passed) then 'completed'
    when v_done > 0 or v_passed then 'in_progress'
    else 'enrolled'
  end;

  insert into enrollments (employee_id, course_id, status, progress, completed_at)
  values (p_employee, p_course, v_status, v_progress,
          case when v_status = 'completed' then now() end)
  on conflict (employee_id, course_id) do update
    set status = excluded.status,
        progress = excluded.progress,
        -- Дату завершения не перетираем: если человек потом пересдаёт тест,
        -- первоначальная дата прохождения важнее последней.
        completed_at = coalesce(enrollments.completed_at, excluded.completed_at),
        updated_date = now();
end;
$$;

create or replace function trg_recalc_progress()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform recalc_course_progress(
    coalesce(new.employee_id, old.employee_id),
    coalesce(new.course_id, old.course_id)
  );
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_lesson_progress_recalc on lesson_progress;
create trigger trg_lesson_progress_recalc
  after insert or update or delete on lesson_progress
  for each row execute function trg_recalc_progress();

-- ------------------------------------------------- отметка о просмотре урока

/**
 * Отметить урок пройденным (или обновить позицию просмотра).
 *
 * Отдельная функция, потому что employee_id нельзя брать из запроса: иначе
 * можно было бы отметить урок за коллегу. Он определяется по текущей сессии.
 */
create or replace function complete_lesson(
  p_lesson_id uuid,
  p_completed boolean default true,
  p_position_seconds integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee uuid;
  v_course   uuid;
begin
  select p.employee_id into v_employee from profiles p where p.id = auth.uid();
  if v_employee is null then
    raise exception 'Учётная запись не связана с карточкой сотрудника — прогресс сохранять некуда'
      using errcode = '42501';
  end if;

  select course_id into v_course from course_lessons where id = p_lesson_id;
  if v_course is null then
    raise exception 'Урок не найден' using errcode = 'P0002';
  end if;

  insert into lesson_progress (lesson_id, course_id, employee_id, status, position_seconds, completed_at)
  values (
    p_lesson_id, v_course, v_employee,
    case when p_completed then 'completed' else 'in_progress' end,
    greatest(coalesce(p_position_seconds, 0), 0),
    case when p_completed then now() end
  )
  on conflict (lesson_id, employee_id) do update
    set status = case when p_completed then 'completed' else lesson_progress.status end,
        position_seconds = greatest(excluded.position_seconds, lesson_progress.position_seconds),
        completed_at = coalesce(lesson_progress.completed_at, excluded.completed_at),
        updated_date = now();

  return (
    select jsonb_build_object('progress', e.progress, 'status', e.status)
      from enrollments e
     where e.employee_id = v_employee and e.course_id = v_course
  );
end;
$$;

-- ------------------------------------------------------- прохождение теста

/**
 * Начать попытку. Возвращает вопросы БЕЗ признака правильности.
 *
 * Дедлайн вычисляется здесь и хранится в базе. Если бы таймер жил только в
 * браузере, его хватило бы обойти перезагрузкой страницы.
 */
create or replace function start_test_attempt(p_course_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee uuid;
  v_test     course_tests%rowtype;
  v_used     integer;
  v_attempt  uuid;
  v_deadline timestamptz;
  v_questions jsonb;
begin
  select p.employee_id into v_employee from profiles p where p.id = auth.uid();
  if v_employee is null then
    raise exception 'Учётная запись не связана с карточкой сотрудника'
      using errcode = '42501';
  end if;

  select * into v_test from course_tests where course_id = p_course_id and active;
  if v_test.id is null then
    raise exception 'К этому курсу не привязан активный тест' using errcode = 'P0002';
  end if;

  -- Считаем только ЗАВЕРШЁННЫЕ попытки: брошенная на середине не должна
  -- сжигать лимит, иначе упавший интернет стоил бы человеку попытки.
  select count(*) into v_used
    from test_attempts
   where test_id = v_test.id and employee_id = v_employee and finished_at is not null;

  if v_test.attempts_limit is not null and v_used >= v_test.attempts_limit then
    raise exception 'Попытки закончились: использовано % из %', v_used, v_test.attempts_limit
      using errcode = '42501';
  end if;

  v_deadline := case when v_test.time_limit_minutes is not null
                     then now() + make_interval(mins => v_test.time_limit_minutes) end;

  insert into test_attempts (test_id, course_id, employee_id, deadline_at)
  values (v_test.id, p_course_id, v_employee, v_deadline)
  returning id into v_attempt;

  -- Ключевое: в выборке вариантов НЕТ is_correct.
  select jsonb_agg(q order by q.position) into v_questions
    from (
      select tq.id, tq.position, tq.text, tq.hint, tq.type, tq.required,
             coalesce((
               select jsonb_agg(jsonb_build_object('id', o.id, 'text', o.text) order by o.position)
                 from test_options o where o.question_id = tq.id
             ), '[]'::jsonb) as options
        from test_questions tq
       where tq.test_id = v_test.id
       order by case when v_test.shuffle_questions then random() end, tq.position
    ) q;

  return jsonb_build_object(
    'attempt_id', v_attempt,
    'test', jsonb_build_object(
      'id', v_test.id,
      'title', v_test.title,
      'description', v_test.description,
      'time_limit_minutes', v_test.time_limit_minutes,
      'pass_score', v_test.pass_score,
      'attempts_limit', v_test.attempts_limit,
      'attempts_used', v_used
    ),
    'deadline_at', v_deadline,
    'questions', coalesce(v_questions, '[]'::jsonb)
  );
end;
$$;

/**
 * Завершить попытку и проверить ответы.
 *
 * p_answers — {"<id вопроса>": ["<id варианта>", ...]}.
 *
 * Проверка целиком на сервере. Для вопроса с одним верным ответом засчитывается
 * точное совпадение; для вопроса с несколькими — множество выбранного должно
 * совпасть с множеством верного полностью. Частичный балл не начисляется
 * сознательно: «угадал два из трёх» в проверке знаний по технике безопасности
 * не должно считаться половиной успеха.
 */
create or replace function submit_test_attempt(p_attempt_id uuid, p_answers jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee   uuid;
  v_attempt    test_attempts%rowtype;
  v_test       course_tests%rowtype;
  v_total      integer := 0;
  v_correct    integer := 0;
  v_score      integer;
  v_passed     boolean;
  v_expired    boolean := false;
  q            record;
  v_given      uuid[];
  v_right      uuid[];
begin
  select p.employee_id into v_employee from profiles p where p.id = auth.uid();

  -- Проверку «свой ли это» нельзя делать сравнением с возможным NULL:
  -- `employee_id <> null` даёт NULL, а не true, и условие тихо не срабатывает.
  -- Пользователь без карточки сотрудника прошёл бы мимо проверки и смог бы
  -- завершить чужую попытку, зная её идентификатор.
  if v_employee is null then
    raise exception 'Учётная запись не связана с карточкой сотрудника'
      using errcode = '42501';
  end if;

  select * into v_attempt from test_attempts where id = p_attempt_id;
  if v_attempt.id is null then
    raise exception 'Попытка не найдена' using errcode = 'P0002';
  end if;
  if v_attempt.employee_id is distinct from v_employee then
    raise exception 'Это чужая попытка' using errcode = '42501';
  end if;
  if v_attempt.finished_at is not null then
    raise exception 'Попытка уже завершена' using errcode = '42501';
  end if;

  select * into v_test from course_tests where id = v_attempt.test_id;

  -- Время вышло — ответы принимаем, но фиксируем факт. Обнулять результат
  -- нечестно: человек мог ответить на всё и не успеть нажать «Завершить».
  if v_attempt.deadline_at is not null and now() > v_attempt.deadline_at + interval '30 seconds' then
    v_expired := true;
  end if;

  for q in
    select tq.id, tq.type from test_questions tq where tq.test_id = v_test.id
  loop
    v_total := v_total + 1;

    -- Ответ приводим к массиву ЯВНО. Пропущенный вопрос приходит из браузера
    -- как null, а не как пустой список, и jsonb_array_elements_text на скаляре
    -- падает — вместе с ней падала бы вся отправка теста, обнуляя работу
    -- человека. Одиночный ответ (строка вместо массива) тоже принимаем.
    select coalesce(array_agg(value::uuid), '{}')
      into v_given
      from jsonb_array_elements_text(
             case jsonb_typeof(p_answers -> q.id::text)
               when 'array'  then p_answers -> q.id::text
               when 'string' then jsonb_build_array(p_answers -> q.id::text)
               else '[]'::jsonb
             end
           )
     where value ~ '^[0-9a-fA-F-]{36}$';   -- мусор в списке молча отбрасываем

    select coalesce(array_agg(o.id), '{}')
      into v_right
      from test_options o where o.question_id = q.id and o.is_correct;

    -- Сравнение множеств, а не массивов: порядок выбора значения не имеет.
    if array_length(v_right, 1) is not null
       and v_given @> v_right and v_right @> v_given then
      v_correct := v_correct + 1;
    end if;
  end loop;

  v_score := case when v_total = 0 then 0 else round(v_correct * 100.0 / v_total)::integer end;
  v_passed := v_score >= v_test.pass_score;

  update test_attempts
     set finished_at = now(),
         score_percent = v_score,
         correct_count = v_correct,
         total_count = v_total,
         passed = v_passed,
         answers = p_answers
   where id = p_attempt_id;

  perform recalc_course_progress(v_employee, v_attempt.course_id);

  return jsonb_build_object(
    'score_percent', v_score,
    'correct_count', v_correct,
    'total_count', v_total,
    'pass_score', v_test.pass_score,
    'passed', v_passed,
    'expired', v_expired,
    'show_correct', v_test.show_correct,
    -- Верные ответы отдаём ТОЛЬКО если это разрешено настройкой теста и
    -- попытка уже закрыта — то есть повлиять на результат ими нельзя.
    'review', case when v_test.show_correct then (
      select jsonb_agg(jsonb_build_object(
               'question_id', tq.id,
               'text', tq.text,
               'correct', (select jsonb_agg(o.text order by o.position)
                             from test_options o where o.question_id = tq.id and o.is_correct),
               'given', (select jsonb_agg(o.text order by o.position)
                           from test_options o
                          where o.question_id = tq.id
                            and o.id::text in (
                              select value from jsonb_array_elements_text(
                                case jsonb_typeof(p_answers -> tq.id::text)
                                  when 'array'  then p_answers -> tq.id::text
                                  when 'string' then jsonb_build_array(p_answers -> tq.id::text)
                                  else '[]'::jsonb
                                end)
                            ))
             ) order by tq.position)
        from test_questions tq where tq.test_id = v_test.id
    ) end
  );
end;
$$;

-- --------------------------------------------------------------- метрики HR

/**
 * Сводка по обучению: сколько назначено, сколько идёт, сколько завершено,
 * как сдают тесты. Считает СУБД по всем записям — на клиенте это неизбежно
 * превратилось бы в подсчёт по первой странице выборки.
 */
create or replace function course_stats(p_course_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_result jsonb;
begin
  if not is_hr() then
    raise exception 'Статистика обучения доступна HR и администратору'
      using errcode = '42501';
  end if;

  with enr as (
    select e.* from enrollments e
     where p_course_id is null or e.course_id = p_course_id
  ),
  att as (
    select a.* from test_attempts a
     where a.finished_at is not null
       and (p_course_id is null or a.course_id = p_course_id)
  )
  select jsonb_build_object(
    'totals', jsonb_build_object(
      'enrolled',    (select count(*) from enr),
      'in_progress', (select count(*) from enr where status = 'in_progress'),
      'completed',   (select count(*) from enr where status = 'completed'),
      'not_started', (select count(*) from enr where status = 'enrolled'),
      'avg_progress',(select coalesce(round(avg(progress)), 0) from enr),
      'completion_rate', (select case when count(*) = 0 then 0
                                 else round(count(*) filter (where status = 'completed') * 100.0 / count(*), 1) end
                            from enr),
      'attempts',    (select count(*) from att),
      'passed',      (select count(*) from att where passed),
      'pass_rate',   (select case when count(*) = 0 then 0
                                  else round(count(*) filter (where passed) * 100.0 / count(*), 1) end
                        from att),
      'avg_score',   (select coalesce(round(avg(score_percent)), 0) from att)
    ),
    'by_course', coalesce((
      select jsonb_agg(row_to_json(c) order by c.enrolled desc)
        from (
          select co.id, co.title,
                 count(e.*)                                        as enrolled,
                 count(e.*) filter (where e.status = 'completed')   as completed,
                 coalesce(round(avg(e.progress)), 0)                as avg_progress,
                 (select coalesce(round(avg(a.score_percent)), 0)
                    from test_attempts a
                   where a.course_id = co.id and a.finished_at is not null) as avg_score,
                 (select count(*) from course_lessons cl where cl.course_id = co.id) as lessons
            from courses co
            left join enrollments e on e.course_id = co.id
           where p_course_id is null or co.id = p_course_id
           group by co.id, co.title
        ) c
    ), '[]'::jsonb),
    'generated_at', now()
  ) into v_result;

  return v_result;
end;
$$;

-- --------------------------------------------------------------- права
revoke all on function
  complete_lesson(uuid, boolean, integer),
  start_test_attempt(uuid),
  submit_test_attempt(uuid, jsonb),
  course_stats(uuid),
  recalc_course_progress(uuid, uuid)
from public, anon;

grant execute on function
  complete_lesson(uuid, boolean, integer),
  start_test_attempt(uuid),
  submit_test_attempt(uuid, jsonb),
  course_stats(uuid)
to authenticated;

-- ------------------------------------------------------ хранилище для видео
--
-- Отдельный бакет: у portal-files лимит 25 МБ и нет видеоформатов в списке
-- разрешённых типов — видеоурок туда просто не загрузится.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'course-media',
  'course-media',
  true,
  524288000, -- 500 МБ
  array['video/mp4','video/webm','video/ogg','video/quicktime','application/pdf']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists course_media_insert on storage.objects;
create policy course_media_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'course-media' and is_hr());

drop policy if exists course_media_select on storage.objects;
create policy course_media_select on storage.objects
  for select to authenticated
  using (bucket_id = 'course-media');

drop policy if exists course_media_delete on storage.objects;
create policy course_media_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'course-media' and is_hr());
