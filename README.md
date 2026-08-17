# Портал Optimus KZ

Корпоративный HR-портал ТОО «Optimus KZ»: кадры, обучение, цели и KPI, опросы,
отпуска, программа признания, CMS и журнал аудита.

**Стек:** React 18 + Vite 6 + Tailwind CSS + Radix UI · Supabase (PostgreSQL, Auth,
Storage, Edge Functions) · деплой на Vercel.

Проект переведён с платформы Base44 на собственную инфраструктуру. Все зависимости
`@base44/*` удалены; правило ESLint `no-restricted-imports` не даёт им вернуться.

---

## 1. Быстрый старт

```bash
npm ci
cp .env.example .env.local     # заполните значениями из Supabase → Settings → API
npm run dev
```

| Команда | Что делает |
|---|---|
| `npm run dev` | Дев-сервер Vite |
| `npm run build` | Прод-сборка в `dist/` |
| `npm run preview` | Локальный просмотр прод-сборки |
| `npm run lint` | ESLint |
| `npm test` | Юнит-тесты расчётов (`vitest`) |

---

## 2. Настройка Supabase

### 2.1. Миграции

Применяются по порядку — через Supabase CLI:

```bash
supabase link --project-ref <ваш-project-ref>
supabase db push
supabase db execute --file supabase/seed.sql   # справочники и CMS-страницы
```

или вручную в SQL Editor, строго в этом порядке:

| Файл | Содержимое |
|---|---|
| `0001_schema.sql` | Типы, 40+ таблиц, индексы, ограничения целостности |
| `0002_rls.sql` | Row Level Security: политики для всех таблиц и ролей |
| `0003_functions.sql` | Представления и RPC: агрегаты, поиск, запись на курс, покупка |
| `0004_audit.sql` | Триггеры журнала аудита, автосоздание профиля, уведомления |
| `0005_storage.sql` | Бакет `portal-files` и политики доступа к файлам |
| `seed.sql` | Филиалы, отделы, причины начисления, настройки, CMS-страницы, каталог |

### 2.2. Auth

Supabase → Authentication → Providers:

* включите **Email** (пароль + magic link);
* Site URL — адрес портала на Vercel;
* Redirect URLs — добавьте `https://<домен>/reset-password`;
* отключите **публичную регистрацию** (Allow new users to sign up), доступ выдаётся
  по приглашению из раздела «Пользователи».

Триггер `on_auth_user_created` сам создаёт строку в `profiles` с ролью `employee`
и, если email совпал с карточкой сотрудника, сразу связывает `profiles.employee_id`.

Первого администратора назначьте вручную:

```sql
update profiles set role = 'admin' where email = 'admin@optimus-kz.kz';
```

### 2.3. Edge Functions

```bash
supabase functions deploy invite-user
supabase functions deploy set-user-role
supabase functions deploy close-expired --no-verify-jwt
supabase secrets set PORTAL_URL=https://<домен> CRON_SECRET=<случайная-строка>
```

`SUPABASE_SERVICE_ROLE_KEY` доступен функциям автоматически и **никогда** не
должен попадать в переменные с префиксом `VITE_` — иначе он окажется в бандле.

### 2.4. Планировщик

`close-expired` закрывает просроченные опросы, сессии и заявки (BUG-019, BUG-041).
Повесьте её на расписание — Supabase → Database → Cron:

```sql
select cron.schedule('close-expired', '0 3 * * *', $$select close_expired_records()$$);
```

---

## 3. Деплой на Vercel

1. Импортируйте репозиторий, фреймворк определится как Vite.
2. Environment Variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_APP_URL`.
3. Deploy.

`vercel.json` уже задаёт SPA-rewrites (иначе прямой переход на `/cabinet/goals`
отдавал бы 404), кэширование ассетов и security-заголовки.

---

## 4. Модель доступа

Четыре роли с иерархией — каждая следующая включает права предыдущих:

| Роль | Доступ |
|---|---|
| `employee` | Личный кабинет: свои цели, KPI, заявки, отпуск, баллы, обучение |
| `manager` | + данные своих подчинённых (рекурсивно по `employees.manager_id`) |
| `hr` | + администрирование, кадровые данные, конфиденциальный блок `employee_private` |
| `admin` | + пользователи, роли, настройки портала, журнал аудита |

Доступ определяется **на сервере** RLS-политиками, а не интерфейсом. Портал
полностью внутренний: анонимному посетителю не доступно ничего, кроме экрана входа.

### Важно про представления

Все `v_*` объявлены `WITH (security_invoker = true)`. Без этого флага представление
выполняется с правами владельца и полностью обходит RLS базовых таблиц — сотрудник
видел бы чужие операции по баллам. Если добавляете новое представление — флаг обязателен.

Агрегаты, которые обязаны быть глобальными (например, сколько всего человек
записалось на курс), вынесены в `SECURITY DEFINER`-функции: под RLS сотрудник видел бы
только свои строки и счётчик врал бы.

---

## 5. Структура

```
src/
  api/              client.js — единый слой данных, entity.js — фабрика доступа, supabase.js
  components/
    common/         PageContainer, EmptyState, ErrorState, StatusBadge, FilterChips,
                    Pagination, RewardCard, BrandLoader, OptimusLogo
    layout/         PortalShell — сайдбар, шапка, глобальный поиск, уведомления
    surveys/        конструктор и отчёты по опросам
    ui/             shadcn/ui-компоненты
  lib/              AuthContext, format, statusLabels, dataErrors, csv, i18n, walletUtils
  pages/
    auth/           Login, ResetPassword
    company/        CompanyHome, CmsPage
    cabinet/        19 страниц личного кабинета + детальные страницы
    admin/          22 страницы администрирования
supabase/
  migrations/       0001–0005
  functions/        invite-user, set-user-role, close-expired
  seed.sql
CONVENTIONS.md      Соглашения кодовой базы — обязательны к прочтению перед правкой
```

---

## 6. Соглашения

Кратко (полностью — в [`CONVENTIONS.md`](./CONVENTIONS.md)):

* Данные — только через `api` из `@/api/client`.
* Даты, деньги, баллы, числительные, стаж, дни отпуска — только через `@/lib/format`.
  Внутренняя валюта — **баллы**, не «₸KZ»; настоящие тенге — `formatMoney`.
* Статусы в интерфейсе — только `<StatusBadge>`, никаких `active` / `published` / `scorm`.
* Каждая страница: `PageContainer` + три состояния — `ErrorState`, скелетон, `EmptyState`.
  Пустой список и ошибка доступа — **разные** состояния.
* Производные значения (статус по дате, стаж, число дней, счётчики) не хранятся,
  а вычисляются в БД или утилитой.

---

## 7. Что закрыто из аудита от 16.08.2026

Отчёт по всем 85 пунктам — в `AUDIT-OPTIMUS-KZ.md` и в комментариях кода
(каждое нетривиальное исправление помечено номером бага).

Ключевое:

* **Безопасность** — аутентификация и RBAC на сервере, зарплатные вилки вынесены
  в отдельную таблицу под HR, анонимная запись в БД невозможна, журнал аудита
  пишется триггерами и не может быть подделан приложением.
* **Достоверность цифр** — единый слой агрегатов `portal_stats()`, дедупликация
  новостей уникальным индексом, дни отпуска — генерируемая колонка, стаж и статусы
  вычисляются из данных.
* **Функциональность** — сущность `enrollments` вместо мутации карточки курса,
  рабочие опросы, CMS-страницы по слагу, глобальный поиск, детальные страницы,
  завершённый CRUD, валидация форм.
* **Целостность** — единая палитра и форматы, полная локализация RU/KZ,
  контраст ≥ 4.5, skip-link и `aria-label`, `React.lazy` по маршрутам, пагинация.
