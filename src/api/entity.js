import { supabase } from './supabase';

/**
 * Ошибка доступа/запроса к данным.
 * Отличает «пусто» от «нет прав» — BUG-011: раньше 401 выглядел как пустой список.
 */
export class DataError extends Error {
  constructor(message, { status, code, details, table } = {}) {
    super(message);
    this.name = 'DataError';
    this.status = status ?? null;
    this.code = code ?? null;
    this.details = details ?? null;
    this.table = table ?? null;
    this.isForbidden = code === '42501' || status === 401 || status === 403;
  }
}

function wrap(error, table) {
  if (!error) return null;
  const status = error.status ?? (error.code === '42501' ? 403 : null);
  const human =
    error.code === '42501'
      ? 'Недостаточно прав для этой операции'
      : error.code === '23505'
        ? 'Такая запись уже существует'
        : error.message || 'Ошибка обращения к базе данных';
  return new DataError(human, { status, code: error.code, details: error.details, table });
}

/**
 * Разбирает сортировку вида '-created_date' → { column, ascending:false }.
 */
function parseSort(sort) {
  if (!sort) return null;
  const desc = sort.startsWith('-');
  return { column: desc ? sort.slice(1) : sort, ascending: !desc };
}

/**
 * Применяет объект-фильтр к запросу.
 * Поддерживает:
 *   { status: 'active' }                 → eq
 *   { status: ['active','draft'] }       → in
 *   { id: null }                         → is null
 *   { date: { gte: '2026-01-01' } }      → операторы gt/gte/lt/lte/neq/like/ilike/in/is
 *   { $or: 'full_name.ilike.*ан*,email.ilike.*ан*' } → PostgREST-условие «или»
 *      (нужно для поиска сразу по нескольким колонкам с серверной пагинацией)
 */
function applyFilter(query, where = {}) {
  for (const [key, value] of Object.entries(where)) {
    if (value === undefined) continue;
    if (key === '$or') {
      query = query.or(Array.isArray(value) ? value.join(',') : value);
    } else if (value === null) {
      query = query.is(key, null);
    } else if (Array.isArray(value)) {
      query = query.in(key, value);
    } else if (typeof value === 'object' && !(value instanceof Date)) {
      for (const [op, opValue] of Object.entries(value)) {
        if (typeof query[op] === 'function') query = query[op](key, opValue);
      }
    } else {
      query = query.eq(key, value);
    }
  }
  return query;
}

const DEFAULT_LIMIT = 1000;

/**
 * Фабрика доступа к таблице. Повторяет форму (list/filter/get/create/update/delete),
 * чтобы страницы портала не пришлось переписывать целиком, но работает поверх Supabase,
 * где действуют серверные RLS-политики (BUG-001, BUG-002, BUG-003).
 */
export function createEntity(table, options = {}) {
  // idColumn — для таблиц, где первичный ключ не `id` (BUG-085: settings.key).
  const { select = '*', defaultSort = null, idColumn = 'id' } = options;

  const runList = async ({ where, sort, limit, offset, columns } = {}) => {
    let query = supabase.from(table).select(columns || select);
    query = applyFilter(query, where || {});
    const parsed = parseSort(sort || defaultSort);
    if (parsed) query = query.order(parsed.column, { ascending: parsed.ascending, nullsFirst: false });
    if (typeof offset === 'number' && typeof limit === 'number') {
      query = query.range(offset, offset + limit - 1);
    } else {
      query = query.limit(limit ?? DEFAULT_LIMIT);
    }
    const { data, error } = await query;
    if (error) throw wrap(error, table);
    return data || [];
  };

  return {
    table,

    /** list(sort, limit)  */
    list: (sort, limit) => runList({ sort, limit }),

    /** filter(where, sort, limit)  */
    filter: (where, sort, limit) => runList({ where, sort, limit }),

    /** Серверная пагинация: page начинается с 1. Возвращает { rows, total }. */
    async page({ where = {}, sort = null, page = 1, pageSize = 25, columns } = {}) {
      const from = (page - 1) * pageSize;
      let query = supabase.from(table).select(columns || select, { count: 'exact' });
      query = applyFilter(query, where);
      const parsed = parseSort(sort || defaultSort);
      if (parsed) query = query.order(parsed.column, { ascending: parsed.ascending, nullsFirst: false });
      const { data, error, count } = await query.range(from, from + pageSize - 1);
      if (error) throw wrap(error, table);
      return { rows: data || [], total: count ?? 0, page, pageSize };
    },

    async get(id) {
      if (!id) return null;
      const { data, error } = await supabase.from(table).select(select).eq(idColumn, id).maybeSingle();
      if (error) throw wrap(error, table);
      return data;
    },

    async count(where = {}) {
      let query = supabase.from(table).select(idColumn, { count: 'exact', head: true });
      query = applyFilter(query, where);
      const { error, count } = await query;
      if (error) throw wrap(error, table);
      return count ?? 0;
    },

    async create(payload) {
      const { data, error } = await supabase.from(table).insert(payload).select(select).single();
      if (error) throw wrap(error, table);
      return data;
    },

    async bulkCreate(rows) {
      if (!rows?.length) return [];
      const { data, error } = await supabase.from(table).insert(rows).select(select);
      if (error) throw wrap(error, table);
      return data || [];
    },

    async update(id, payload) {
      const { data, error } = await supabase.from(table).update(payload).eq(idColumn, id).select(select).single();
      if (error) throw wrap(error, table);
      return data;
    },

    async delete(id) {
      const { error } = await supabase.from(table).delete().eq(idColumn, id);
      if (error) throw wrap(error, table);
      return true;
    },

    /** Идемпотентная вставка по уникальному ключу — используется, например, для записи на курс. */
    async upsert(payload, onConflict) {
      const { data, error } = await supabase
        .from(table)
        .upsert(payload, { onConflict, ignoreDuplicates: false })
        .select(select)
        .single();
      if (error) throw wrap(error, table);
      return data;
    },
  };
}

export { wrap as wrapDataError };
