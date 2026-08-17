import { statusLabel } from '@/lib/statusLabels';
import { formatDate } from '@/lib/format';
import { buildCSV } from '@/lib/csv';

/**
 * Утилиты программы баллов.
 *
 * BUG-037: «Топ-10 позиций каталога» читал несуществующее поле — считаем по
 *          store_orders (item_name / price_at_purchase) либо по списаниям из
 *          v_wallet_transactions, группируя по названию товара, а не по item_id.
 * BUG-055: внутренняя валюта — баллы, форматирование только через @/lib/format.
 * BUG-080: «Burn rate» переименован в «Доля списаний, %» (spendShare).
 * BUG-084: динамика по месяцам строится непрерывным рядом и не заходит в будущее.
 */

/** Категории причин начисления — человекочитаемо (технические коды прячем, BUG-069). */
export const REASON_CATEGORY_LABELS = {
  work: 'Работа',
  social: 'Социальное',
  training: 'Обучение',
  milestone: 'События и вехи',
  other: 'Прочее',
};

/** Типы операций кошелька — enum схемы wallet_transactions.type. Подписи даёт StatusBadge. */
export const TRANSACTION_TYPES = ['achievement', 'manual', 'workflow', 'training', 'tenure', 'spend', 'correction'];

/** Типы, доступные для ручного начисления администратором. */
export const MANUAL_TYPES = ['manual', 'achievement', 'workflow', 'training', 'tenure'];

/** Причины по умолчанию — используются только для сидирования пустого справочника. */
export const DEFAULT_REASONS = [
  { code: 'mentoring', title: 'Наставничество', category: 'work', default_points: 500 },
  { code: 'contest', title: 'Конкурс', category: 'work', default_points: 1000 },
  { code: 'tenure', title: 'Выслуга лет', category: 'milestone', default_points: 2000 },
  { code: 'birthday', title: 'День рождения', category: 'milestone', default_points: 1000 },
  { code: 'training', title: 'Обучение', category: 'training', default_points: 300 },
  { code: 'teambuilding', title: 'Тимбилдинг', category: 'social', default_points: 300 },
  { code: 'performance', title: 'Результативность', category: 'work', default_points: 1500 },
  { code: 'initiative', title: 'Инициатива', category: 'work', default_points: 800 },
  { code: 'purchase', title: 'Покупка в магазине', category: 'other', default_points: null },
  { code: 'other', title: 'Другое', category: 'other', default_points: null },
];

/** Название причины по коду; технический код в интерфейс не попадает. */
export function getReasonLabel(code, reasons) {
  if (!code) return '';
  const r = (reasons || []).find((x) => x.code === code);
  return r ? r.title : statusLabel(code, code);
}

/* --------------------------------------------------------------------- CSV */

export function buildTransactionCSV(transactions, reasons, duplicateIds) {
  const headers = [
    'Дата', 'Сотрудник', 'Филиал / торговая точка', 'Отдел', 'Тип операции',
    'Причина', 'Комментарий', 'Сумма, баллы', 'Товар', 'Администратор',
    'Корректировка', 'Связанная операция', 'Возможный дубль',
  ];
  const dupes = duplicateIds || new Set();
  const rows = (transactions || []).map((t) => [
    formatDate(t.date),
    t.employee_name || '',
    t.branch || '',
    t.department || '',
    statusLabel(t.type, t.type),
    t.reason_code ? getReasonLabel(t.reason_code, reasons) : t.reason_title || '',
    t.reason || '',
    t.amount ?? 0,
    t.item_name || '',
    t.admin_name || '',
    t.is_correction ? 'Да' : '',
    t.linked_operation_id || '',
    dupes.has(t.id) ? 'Да' : '',
  ]);
  return buildCSV(headers, rows);
}

export function buildWalletSummaryCSV(transactions, employees) {
  const empMap = new Map((employees || []).map((e) => [e.id, e]));
  const byEmp = new Map();
  (transactions || []).forEach((t) => {
    if (!t.employee_id) return;
    if (!byEmp.has(t.employee_id)) {
      const emp = empMap.get(t.employee_id);
      byEmp.set(t.employee_id, {
        name: t.employee_name || emp?.name || '',
        branch: t.branch || emp?.branch || '',
        department: t.department || emp?.department || '',
        balance: 0, earned: 0, spent: 0, count: 0, lastDate: '',
      });
    }
    const row = byEmp.get(t.employee_id);
    row.balance += t.amount || 0;
    if (t.amount > 0) row.earned += t.amount;
    else row.spent += Math.abs(t.amount);
    row.count += 1;
    if (!t.date || t.date > row.lastDate) row.lastDate = t.date;
  });
  const headers = [
    'Сотрудник', 'Филиал / торговая точка', 'Отдел', 'Баланс, баллы',
    'Начислено, баллы', 'Списано, баллы', 'Операций', 'Последняя операция',
  ];
  const rows = [...byEmp.values()].map((r) => [
    r.name, r.branch, r.department, r.balance, r.earned, r.spent, r.count, formatDate(r.lastDate),
  ]);
  return buildCSV(headers, rows);
}

/* -------------------------------------------------------------------- дубли */

/**
 * Дублем считаются две НЕкорректирующие операции по одному сотруднику
 * с одинаковой суммой и причиной, созданные с разницей менее 5 секунд, —
 * это признак повторной отправки формы, а не двух настоящих начислений.
 */
export const DUPLICATE_WINDOW_MS = 5000;

export const DUPLICATE_HINT =
  'Дубль — две операции одному сотруднику с одинаковой суммой и причиной, созданные с разницей менее 5 секунд (повторная отправка формы).';

export function detectDuplicates(transactions) {
  const seen = new Map();
  const duplicates = new Set();
  const sorted = [...(transactions || [])].sort(
    (a, b) => (a.created_date || '').localeCompare(b.created_date || '')
  );
  for (const t of sorted) {
    if (t.is_correction) continue;
    const key = `${t.employee_id}|${t.amount}|${t.reason_code || t.reason || ''}`;
    const prev = seen.get(key);
    if (prev) {
      const diff = Math.abs(
        new Date(t.created_date || t.date || '').getTime() -
          new Date(prev.created_date || prev.date || '').getTime()
      );
      if (diff < DUPLICATE_WINDOW_MS) {
        duplicates.add(t.id);
        duplicates.add(prev.id);
      }
    }
    seen.set(key, t);
  }
  return duplicates;
}

/* ----------------------------------------------------------------- аналитика */

const monthKey = (value) => (typeof value === 'string' ? value.slice(0, 7) : '');

/** Непрерывный ряд месяцев [from..to] включительно, обе границы — 'YYYY-MM'. */
function monthRange(from, to) {
  const out = [];
  let [y, m] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

/**
 * BUG-037: топ позиций каталога.
 * Приоритет — таблица store_orders (там есть item_name и зафиксированная цена
 * price_at_purchase), при её отсутствии — списания кошелька по названию товара.
 */
export function calculateTopItems(orders, spendTransactions, limit = 10) {
  const map = new Map();
  const add = (name, points) => {
    if (!name) return;
    if (!map.has(name)) map.set(name, { name, count: 0, points: 0 });
    const item = map.get(name);
    item.count += 1;
    item.points += Math.abs(Number(points) || 0);
  };

  if ((orders || []).length) {
    (orders || [])
      .filter((o) => o.status !== 'cancelled')
      .forEach((o) => add(o.item_name, o.price_at_purchase));
  } else {
    (spendTransactions || [])
      .filter((t) => t.type === 'spend' && !t.is_correction)
      .forEach((t) => add(t.item_name || t.reason_title || t.reason, t.amount));
  }

  return [...map.values()].sort((a, b) => b.count - a.count || b.points - a.points).slice(0, limit);
}

/** Разрез по произвольному измерению (department / branch). */
function groupByDimension(txns, field, emptyLabel) {
  const map = new Map();
  (txns || []).forEach((t) => {
    const key = t[field] || emptyLabel;
    if (!map.has(key)) {
      map.set(key, { key, balance: 0, earned: 0, spent: 0, count: 0, employees: new Set() });
    }
    const d = map.get(key);
    d.balance += t.amount || 0;
    if (t.amount > 0) d.earned += t.amount;
    else if (!t.is_correction) d.spent += Math.abs(t.amount);
    d.count += 1;
    if (t.employee_id) d.employees.add(t.employee_id);
  });
  return [...map.values()]
    .map((d) => ({
      key: d.key,
      balance: d.balance,
      earned: d.earned,
      spent: d.spent,
      count: d.count,
      employeeCount: d.employees.size,
      avgBalance: d.employees.size > 0 ? Math.round(d.balance / d.employees.size) : 0,
    }))
    .sort((a, b) => b.earned - a.earned);
}

/** Суммарные показатели периода — используются и для сравнения периодов. */
export function calculateTotals(transactions) {
  const txns = transactions || [];
  const totalEarned = txns.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const totalSpent = Math.abs(
    txns.filter((t) => t.amount < 0 && !t.is_correction).reduce((s, t) => s + t.amount, 0)
  );
  // BUG-080: это доля списаний от начислений, а не «burn rate».
  const spendShare = totalEarned > 0 ? Math.round((totalSpent / totalEarned) * 100) : 0;
  const activeEmployeeIds = new Set(txns.map((t) => t.employee_id).filter(Boolean));
  return {
    totalEarned,
    totalSpent,
    spendShare,
    activeUsersCount: activeEmployeeIds.size,
    totalTransactions: txns.length,
  };
}

/**
 * Полный набор метрик страницы аналитики.
 * @param {Array} transactions — строки v_wallet_transactions
 * @param {Array} employees    — карточки сотрудников (для доли активных)
 * @param {Object} opts        — { orders, now }
 */
export function calculateWalletMetrics(transactions, employees, opts = {}) {
  const txns = transactions || [];
  const emps = employees || [];
  const now = opts.now || new Date();

  const totals = calculateTotals(txns);
  const activeUsersPercent = emps.length > 0 ? Math.round((totals.activeUsersCount / emps.length) * 100) : 0;

  const topItems = calculateTopItems(opts.orders, txns);

  // BUG-084: непрерывный ряд месяцев без «провала в ноль» на будущих точках.
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const monthMap = new Map();
  txns.forEach((t) => {
    const month = monthKey(t.date);
    if (!month || month > currentMonth) return; // будущие месяцы не рисуем
    if (!monthMap.has(month)) monthMap.set(month, { month, earned: 0, spent: 0 });
    const m = monthMap.get(month);
    if (t.amount > 0) m.earned += t.amount;
    else if (!t.is_correction) m.spent += Math.abs(t.amount);
  });
  const monthKeys = [...monthMap.keys()].sort();
  const monthlyDynamics = monthKeys.length
    ? monthRange(monthKeys[0], monthKeys[monthKeys.length - 1]).map(
        (month) => monthMap.get(month) || { month, earned: 0, spent: 0 }
      )
    : [];

  const departmentStats = groupByDimension(txns, 'department', 'Без отдела');
  const branchStats = groupByDimension(txns, 'branch', 'Без филиала');

  const reasonMap = new Map();
  txns
    .filter((t) => t.amount > 0 && t.reason_code)
    .forEach((t) => {
      if (!reasonMap.has(t.reason_code)) {
        reasonMap.set(t.reason_code, { code: t.reason_code, count: 0, points: 0 });
      }
      const r = reasonMap.get(t.reason_code);
      r.count += 1;
      r.points += t.amount;
    });
  const reasonRating = [...reasonMap.values()].sort((a, b) => b.count - a.count);

  const adminMap = new Map();
  txns
    .filter((t) => t.admin_name && t.type !== 'spend')
    .forEach((t) => {
      if (!adminMap.has(t.admin_name)) adminMap.set(t.admin_name, { admin: t.admin_name, count: 0, points: 0 });
      const a = adminMap.get(t.admin_name);
      a.count += 1;
      a.points += Math.abs(t.amount);
    });
  const adminWorkload = [...adminMap.values()].sort((a, b) => b.count - a.count);

  return {
    ...totals,
    activeUsersPercent,
    totalEmployees: emps.length,
    topItems,
    monthlyDynamics,
    departmentStats,
    branchStats,
    reasonRating,
    adminWorkload,
  };
}
