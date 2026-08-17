# Соглашения кодовой базы портала Optimus KZ

Документ обязателен к прочтению перед правкой любой страницы. Проект переведён
с Base44 на **Supabase + Vercel**; часть кода ещё написана по старым правилам.

## 1. Данные

```js
import { api } from '@/api/client';

api.entities.Employee.list('-created_date', 50)
api.entities.Goal.filter({ employee_id: id }, '-created_date')
api.entities.Goal.page({ where, sort: '-created_date', page: 1, pageSize: 25 }) // → { rows, total }
api.entities.Goal.create({...}) / .update(id, {...}) / .delete(id) / .get(id) / .count(where)

api.auth.me() / api.auth.logout() / api.auth.updateMe({...})
api.rpc.portalStats() / api.rpc.globalSearch(q) / api.rpc.enroll(courseId)
api.rpc.purchaseStoreItem(itemId) / api.rpc.walletBalance(employeeId)
api.storage.upload({ file, folder })
```

**Запрещено:** `base44`, `@base44/sdk`, `@/api/base44Client`, `appParams`.

Ошибки — экземпляры `DataError` с полями `status`, `code`, `isForbidden`.

### Представления вместо хранимых счётчиков

Для агрегатов читайте **вьюхи**, а не базовые таблицы:

| Вместо | Используйте | Что даёт |
|---|---|---|
| `courses` | `createEntity('v_courses')` через `api.entities.Course` → **читать `v_courses` напрямую нельзя из api.entities**; используйте `api.supabase.from('v_courses')` | `enrolled_count`, `completed_count`, `avg_progress` |
| `surveys` | `api.supabase.from('v_surveys')` | `effective_status`, `responses_count`, `questions_count`, `is_expired` |
| `news` | `api.supabase.from('v_news')` | `likes`, `comments_count` |
| `books` | `api.supabase.from('v_books')` | `available_count`, `readers_count` |
| `employees` | `api.supabase.from('v_employees')` | `is_on_leave_now`, `tenure_years`, `points_balance` |
| `leave_requests` | `api.supabase.from('v_leave_requests')` | `is_overdue`, `age_days` |
| `wallet_transactions` | `api.supabase.from('v_wallet_transactions')` | заполненные `branch`, `department` |
| `departments` | `api.supabase.from('v_departments')` | `employees_count` |

Пример чтения вьюхи:

```js
const { data, error } = await api.supabase.from('v_courses').select('*').order('title');
if (error) throw error;
```

### Счётчики на дашбордах

Все обзорные цифры берутся **только** из `api.rpc.portalStats()` (BUG-014/015/016).
Не считайте `array.length` из отдельных запросов для показателей на плитках.

## 2. Текущий пользователь

```js
import { useAuth } from '@/lib/AuthContext';
const { user, employee, employeeId, role, roleLabel, isAdmin, isHR, isManager, hasRole } = useAuth();
```

`employeeId` может быть `null` (учётка не связана с карточкой сотрудника) —
в этом случае показывайте понятное сообщение, а не пустой экран.
**Не используйте** `me.id` как `employee_id`.

## 3. Форматирование — только через `@/lib/format`

```js
import { formatDate, formatDateRange, formatRelative, formatNumber, formatPoints,
         formatMoney, formatSigned, formatFileSize, plural, pluralize,
         leaveDays, tenureYears, formatTenure, isPast, daysUntilBirthday, initials } from '@/lib/format';
```

* Даты: `formatDate(v)` → `16.08.2026`, `formatDate(v,'long')` → `16 августа 2026`.
  Свои `toLocaleDateString`, `split('T')`, `slice(0,10)` — запрещены (BUG-053).
* Дни отпуска: **только** `leaveDays(start, end)` (BUG-017).
* Стаж: **только** `tenureYears` / `formatTenure` из `hire_date` (BUG-021/022).
* Внутренняя валюта — баллы: `formatPoints(n)`. **Никаких «₸KZ»** (BUG-055).
  Настоящие деньги — `formatMoney(n)`.
* Числительные: `pluralize(n, 'сотрудник','сотрудника','сотрудников')` (BUG-075/077).
* Знак: `formatSigned(n)` — не бывает «−0» (BUG-056).

## 4. Статусы и названия сущностей

```js
import StatusBadge from '@/components/common/StatusBadge';
import { statusLabel, entityLabel } from '@/lib/statusLabels';

<StatusBadge value={item.status} />
```

Технические коды (`active`, `published`, `scorm`, `pulse`, `WalletTransaction`)
в интерфейсе показывать нельзя (BUG-051/052/068).

## 5. Обязательные состояния страницы

```jsx
import PageContainer from '@/components/common/PageContainer';
import EmptyState from '@/components/common/EmptyState';
import ErrorState from '@/components/common/ErrorState';

const { data, isLoading, error, refetch } = useQuery({ ... });

return (
  <PageContainer title="Заголовок раздела" description="Пояснение">
    {error ? <ErrorState error={error} onRetry={refetch} />
     : isLoading ? <SkeletonБлок/>
     : !data?.length ? <EmptyState title="…" description="…" actionLabel="…" onAction={…} />
     : <Список/>}
  </PageContainer>
);
```

`ErrorState` обязателен везде, где раньше при ошибке показывался пустой список (BUG-011).
Каждая страница обёрнута в `PageContainer` — он же ставит человекочитаемый `<title>` (BUG-047, BUG-073).

## 6. Формы

* Валидация до отправки, сообщения об ошибке рядом с полем, `aria-invalid`,
  `role="alert"` у текста ошибки (BUG-025).
* Кнопка отправки `disabled` при незаполненной форме и во время запроса.
* В каждой модалке — явная кнопка «Отмена», а не только крестик (BUG-072).
* Тост об успехе — через `useToast` из `@/components/ui/use-toast` (он уже автозакрывается).

## 7. Доступность

* Каждая иконочная кнопка — с `aria-label`; декоративные иконки — `aria-hidden="true"`.
* Минимальный размер интерактивных элементов — 40 px (класс `min-h-[40px]`).
* Кликабельные карточки — `<Link>` или `<button>`, не `div` с `onClick`.
* Списки карточек — `role="list"` / `role="listitem"` там, где это список.
* Таблицы — в `.table-scroll`, колонка действий — `.table-sticky-actions` (BUG-036).

## 8. Локализация

```js
import { useI18n } from '@/lib/i18n';
const { t, lang, plural, pluralize } = useI18n();
```

Новые строки добавляйте в оба словаря `ru` и `kz` в `src/lib/i18n.jsx`.
Хардкод русского текста в новых компонентах допустим только там, где ключ уже
существует и переиспользуется, — иначе заводите ключ (BUG-043).

## 9. Что нельзя делать

* Хранить производные значения (статус по дате, стаж, число дней, счётчики) —
  их считает БД или утилита.
* Мутировать общий объект вместо создания персональной записи (BUG-004).
* Показывать «0 записей», когда пришла ошибка (BUG-011).
* Использовать фиолетовую и оранжевую палитры: акценты — `brand-wallet`,
  `brand-library`, `brand-learning` из Tailwind-конфига (BUG-054).
