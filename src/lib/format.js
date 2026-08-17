/**
 * Единые форматтеры портала.
 * BUG-053: в продукте было три формата дат («20 июля», «2026-07-28», «15.03.2024»),
 * иногда на одной странице. Здесь один источник правды.
 * BUG-055: валюта «₸KZ» не существует — внутренние баллы называются «баллы» / «O-коины».
 * BUG-075/077: числительные согласуются через Intl.PluralRules.
 */

export const TIMEZONE = 'Asia/Almaty'; // BUG-045: Казахстан с 01.03.2024 весь в UTC+5.

const RU_MONTHS = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

/** Безопасный разбор даты: принимает Date, ISO-строку, 'YYYY-MM-DD'. */
export function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Единый формат даты для интерфейса: 16.08.2026
 * variant: 'short' → 16.08.2026 · 'long' → 16 августа 2026 · 'day' → 16 августа
 *          'datetime' → 16.08.2026, 14:30 · 'iso' → 2026-08-16 (только для API/атрибутов)
 */
export function formatDate(value, variant = 'short') {
  const date = toDate(value);
  if (!date) return '—';
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  switch (variant) {
    case 'long':
      return `${date.getDate()} ${RU_MONTHS[date.getMonth()]} ${yyyy}`;
    case 'day':
      return `${date.getDate()} ${RU_MONTHS[date.getMonth()]}`;
    case 'datetime': {
      const hh = String(date.getHours()).padStart(2, '0');
      const min = String(date.getMinutes()).padStart(2, '0');
      return `${dd}.${mm}.${yyyy}, ${hh}:${min}`;
    }
    case 'iso':
      return `${yyyy}-${mm}-${dd}`;
    default:
      return `${dd}.${mm}.${yyyy}`;
  }
}

const RU_MONTHS_NOM = [
  'январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
  'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь',
];

/**
 * Подпись месяца для графиков и группировок: принимает Date, ISO-дату или 'YYYY-MM'.
 * formatMonth('2026-08') → 'авг 2026' · formatMonth('2026-08', 'long') → 'август 2026'
 */
export function formatMonth(value, variant = 'short') {
  const normalized = typeof value === 'string' && /^\d{4}-\d{2}$/.test(value) ? `${value}-01` : value;
  const date = toDate(normalized);
  if (!date) return '—';
  const name = RU_MONTHS_NOM[date.getMonth()];
  if (variant === 'long') return `${name} ${date.getFullYear()}`;
  return `${name.slice(0, 3)} ${date.getFullYear()}`;
}

/** Диапазон дат одной строкой: 10.08.2026 — 17.08.2026 */
export function formatDateRange(start, end) {
  const s = formatDate(start);
  const e = formatDate(end);
  if (s === '—' && e === '—') return '—';
  if (s === e) return s;
  return `${s} — ${e}`;
}

/** «сегодня», «вчера», «3 дня назад», иначе дата. */
export function formatRelative(value) {
  const date = toDate(value);
  if (!date) return '—';
  const days = daysBetween(date, new Date());
  if (days === 0) return 'сегодня';
  if (days === 1) return 'вчера';
  if (days > 1 && days < 7) return `${days} ${plural(days, 'день', 'дня', 'дней')} назад`;
  return formatDate(date);
}

/* -------------------------------------------------------------- числительные */

const pluralRules = typeof Intl !== 'undefined' && Intl.PluralRules ? new Intl.PluralRules('ru-RU') : null;

/**
 * plural(1, 'сотрудник', 'сотрудника', 'сотрудников') → 'сотрудник'
 * BUG-075: «1 служебных записок», BUG-077: «1 сотрудников».
 */
export function plural(count, one, few, many) {
  const n = Math.abs(Number(count) || 0);
  if (pluralRules) {
    const category = pluralRules.select(n);
    if (category === 'one') return one;
    if (category === 'few') return few;
    return many;
  }
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

/** pluralize(3, 'день','дня','дней') → '3 дня' */
export function pluralize(count, one, few, many) {
  return `${formatNumber(count)} ${plural(count, one, few, many)}`;
}

/* --------------------------------------------------------------------- числа */

export function formatNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('ru-RU').format(n);
}

/**
 * Внутренняя валюта портала — баллы, а не тенге (BUG-055).
 * formatPoints(2000) → '2 000 баллов'
 * formatPoints(2000, { short: true }) → '2 000 Б'
 */
export function formatPoints(value, { short = false } = {}) {
  const n = Number(value) || 0;
  const num = formatNumber(n);
  if (short) return `${num} Б`;
  return `${num} ${plural(n, 'балл', 'балла', 'баллов')}`;
}

/** Настоящие деньги — тенге, отдельным форматтером, чтобы не путать с баллами. */
export function formatMoney(value, currency = 'KZT') {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n);
}

/** BUG-056: «−0» в блоке «Потрачено». */
export function formatSigned(value, formatter = formatNumber) {
  const n = Number(value) || 0;
  if (n === 0) return formatter(0);
  return `${n > 0 ? '+' : '−'}${formatter(Math.abs(n))}`;
}

export function formatFileSize(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return '0 КБ';
  const units = ['Б', 'КБ', 'МБ', 'ГБ'];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/* ---------------------------------------------------------------------- даты */

/** Число календарных дней между двумя датами (без учёта времени). */
export function daysBetween(a, b) {
  const d1 = toDate(a);
  const d2 = toDate(b);
  if (!d1 || !d2) return 0;
  const u1 = Date.UTC(d1.getFullYear(), d1.getMonth(), d1.getDate());
  const u2 = Date.UTC(d2.getFullYear(), d2.getMonth(), d2.getDate());
  return Math.round((u2 - u1) / 86400000);
}

/**
 * BUG-017: один и тот же период 10.08 → 17.08 показывался и как «8 дн.», и как «7 дн.».
 * Единственная разрешённая функция расчёта длительности отпуска — включая обе границы.
 */
export function leaveDays(startDate, endDate) {
  const start = toDate(startDate);
  const end = toDate(endDate);
  if (!start || !end) return 0;
  const diff = daysBetween(start, end);
  return diff < 0 ? 0 : diff + 1;
}

/** Стаж в компании, посчитанный из hire_date (BUG-021, BUG-022). */
export function tenureYears(hireDate, at = new Date()) {
  const start = toDate(hireDate);
  const now = toDate(at);
  if (!start || !now) return 0;
  let years = now.getFullYear() - start.getFullYear();
  const beforeAnniversary =
    now.getMonth() < start.getMonth() ||
    (now.getMonth() === start.getMonth() && now.getDate() < start.getDate());
  if (beforeAnniversary) years -= 1;
  return Math.max(0, years);
}

export function formatTenure(hireDate, at = new Date()) {
  const years = tenureYears(hireDate, at);
  if (years <= 0) return 'менее года';
  return pluralize(years, 'год', 'года', 'лет');
}

/** Дата в прошлом относительно «сегодня» (BUG-019, BUG-024, BUG-041). */
export function isPast(value, at = new Date()) {
  const date = toDate(value);
  if (!date) return false;
  return daysBetween(date, at) > 0;
}

export function isToday(value, at = new Date()) {
  const date = toDate(value);
  if (!date) return false;
  return daysBetween(date, at) === 0;
}

/** Ближайший день рождения без учёта года (для блока «Дни рождения»). */
export function daysUntilBirthday(birthDate, at = new Date()) {
  const bd = toDate(birthDate);
  const now = toDate(at);
  if (!bd || !now) return null;
  const thisYear = new Date(now.getFullYear(), bd.getMonth(), bd.getDate());
  const target = daysBetween(now, thisYear) >= 0 ? thisYear : new Date(now.getFullYear() + 1, bd.getMonth(), bd.getDate());
  return daysBetween(now, target);
}

export function initials(name) {
  if (!name) return '—';
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() || '')
    .join('') || '—';
}
