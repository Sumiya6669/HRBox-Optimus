import React, { useState, useMemo, useEffect } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { api } from '@/api/client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { History, Search, Download, ChevronDown, ChevronRight, ShieldCheck } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import PageContainer from '@/components/common/PageContainer';
import EmptyState from '@/components/common/EmptyState';
import ErrorState from '@/components/common/ErrorState';
import StatusBadge from '@/components/common/StatusBadge';
import FilterChips from '@/components/common/FilterChips';
import Pagination from '@/components/common/Pagination';
import { entityLabel, statusLabel, fieldLabel } from '@/lib/statusLabels';
import { formatDate, formatNumber } from '@/lib/format';
import { mutationErrorMessage } from '@/lib/dataErrors';
import { buildCSV, downloadCSV } from '@/lib/csv';
import { cn } from '@/lib/utils';

/**
 * Журнал аудита.
 *
 * BUG-009: журнал не фиксировал реальные действия — за сессию было 5 операций,
 *          а записей оставалось 8 засеянных. Теперь пишет триггер БД
 *          (0004_audit.sql), таблица audit_logs доступна только на чтение.
 * BUG-067: «Экспорт» был стилизован как фильтр-чип и стоял в ряду фильтров —
 *          вынесен в правый верхний угол как вторичная кнопка страницы.
 * BUG-068: в интерфейсе показывались внутренние имена сущностей (Auth,
 *          WalletTransaction, User, LeaveRequest) — теперь entityLabel().
 * Добавлены: раскрытие записи с читаемым diff'ом из changes, поиск,
 * фильтры по действию / сущности / диапазону дат и серверная пагинация по 50.
 */

const PAGE_SIZE = 50;

const ACTIONS = ['create', 'update', 'delete', 'login', 'logout', 'invite', 'approve', 'reject', 'export'];

/** Сущности, за которыми следит триггер аудита (0004_audit.sql) + события входа. */
const ENTITY_TYPES = [
  'Auth', 'employees', 'employee_private', 'profiles', 'departments', 'branches',
  'news', 'pages', 'courses', 'enrollments', 'books', 'book_loans',
  'goals', 'kpis', 'development_plans', 'leave_requests', 'service_requests',
  'hr_documents', 'onboarding_tasks', 'surveys', 'survey_sessions',
  'achievements', 'store_items', 'store_orders', 'wallet_transactions',
  'award_reasons', 'vacancies', 'candidates', 'settings', 'feedback',
];

/** Значение поля в diff'е — понятным текстом, а не сырым JSON. */
function renderValue(value) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Да' : 'Нет';
  if (typeof value === 'number') return formatNumber(value);
  if (typeof value === 'object') return JSON.stringify(value);
  const str = String(value);
  if (/^\d{4}-\d{2}-\d{2}T/.test(str)) return formatDate(str, 'datetime');
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return formatDate(str);
  // Технические коды статусов подменяем ярлыками (BUG-051/052).
  return statusLabel(str, str);
}

/** Раскрытие изменений: {поле: {from, to}} для update, полная строка для create/delete. */
function ChangesTable({ changes }) {
  const entries = Object.entries(changes || {}).filter(([key]) => !['id', 'created_date', 'updated_date'].includes(key));
  if (!entries.length) {
    return <p className="text-sm text-muted-foreground">Детали изменения не сохранены.</p>;
  }
  const isDiff = entries.some(([, v]) => v && typeof v === 'object' && !Array.isArray(v) && ('from' in v || 'to' in v));

  return (
    <div className="table-scroll rounded-lg border border-border">
      <table className="w-full text-sm">
        <caption className="sr-only">Изменённые поля записи</caption>
        <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
          <tr>
            <th scope="col" className="px-3 py-2 text-left font-medium">Поле</th>
            <th scope="col" className="px-3 py-2 text-left font-medium">{isDiff ? 'Было' : 'Значение'}</th>
            {isDiff && <th scope="col" className="px-3 py-2 text-left font-medium">Стало</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {entries.map(([key, value]) => {
            const diff = value && typeof value === 'object' && !Array.isArray(value) && ('from' in value || 'to' in value);
            return (
              <tr key={key}>
                <th scope="row" className="px-3 py-2 text-left font-medium text-foreground">{fieldLabel(key)}</th>
                <td className="px-3 py-2 text-muted-foreground">{renderValue(diff ? value.from : value)}</td>
                {isDiff && <td className="px-3 py-2 text-foreground">{renderValue(diff ? value.to : '')}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SkeletonBlock() {
  return (
    <div className="space-y-2" aria-hidden="true">
      {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-muted" />)}
    </div>
  );
}

export default function AdminAudit() {
  const { toast } = useToast();
  const [search, setSearch] = useState('');
  const [action, setAction] = useState('all');
  const [entityType, setEntityType] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState(() => new Set());

  useEffect(() => { setPage(1); }, [search, action, entityType, from, to]);

  const where = useMemo(() => {
    const w = {};
    if (action !== 'all') w.action = action;
    if (entityType !== 'all') w.entity_type = entityType;
    if (from || to) {
      w.date = {};
      if (from) w.date.gte = `${from}T00:00:00`;
      if (to) w.date.lte = `${to}T23:59:59`;
    }
    const q = search.trim();
    if (q) w.$or = `user_name.ilike.*${q}*,user_email.ilike.*${q}*,description.ilike.*${q}*`;
    return w;
  }, [search, action, entityType, from, to]);

  const logsQuery = useQuery({
    queryKey: ['audit-logs', where, page],
    queryFn: () => api.entities.AuditLog.page({ where, sort: '-date', page, pageSize: PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });

  const rows = logsQuery.data?.rows || [];
  const total = logsQuery.data?.total || 0;

  const toggleExpanded = (id) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  /** Экспорт учитывает все текущие фильтры, а не только видимую страницу. */
  const handleExport = async () => {
    try {
      const all = await api.entities.AuditLog.filter(where, '-date', 5000);
      const headers = ['Дата и время', 'Пользователь', 'Email', 'Действие', 'Объект', 'ID объекта', 'Описание', 'Изменения'];
      const csvRows = all.map((l) => [
        formatDate(l.date, 'datetime'),
        l.user_name || '',
        l.user_email || '',
        statusLabel(l.action, l.action),
        entityLabel(l.entity_type),
        l.entity_id || '',
        l.description || '',
        l.changes ? JSON.stringify(l.changes) : '',
      ]);
      downloadCSV(`audit_log_${formatDate(new Date(), 'iso')}.csv`, buildCSV(headers, csvRows));
      toast({ title: `Выгружено записей: ${formatNumber(all.length)}` });
    } catch (e) {
      toast({ title: 'Не удалось выгрузить журнал', description: mutationErrorMessage(e), variant: 'destructive' });
    }
  };

  const hasFilters = !!search.trim() || action !== 'all' || entityType !== 'all' || !!from || !!to;

  const resetFilters = () => {
    setSearch(''); setAction('all'); setEntityType('all'); setFrom(''); setTo('');
  };

  const selectCls =
    'min-h-[40px] w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus:border-primary/40';

  // BUG-067: экспорт — вторичная кнопка в правом верхнем углу, а не чип в ряду фильтров.
  const actions = (
    <Button variant="outline" onClick={handleExport} disabled={logsQuery.isPending || !!logsQuery.error}>
      <Download className="mr-1 h-4 w-4" aria-hidden="true" /> Экспорт в CSV
    </Button>
  );

  return (
    <PageContainer
      title="Журнал аудита"
      description="Действия пользователей фиксирует триггер базы данных — записи нельзя изменить или удалить"
      width="wide"
      actions={actions}
    >
      <div className="space-y-4">
        <Card className="space-y-3 p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="sm:col-span-2">
              <Label htmlFor="audit-search" className="text-xs">Поиск</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input
                  id="audit-search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Пользователь, email или описание действия"
                  className="min-h-[40px] pl-9"
                />
              </div>
            </div>
            <div>
              <Label htmlFor="audit-from" className="text-xs">С даты</Label>
              <Input id="audit-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="min-h-[40px]" />
            </div>
            <div>
              <Label htmlFor="audit-to" className="text-xs">По дату</Label>
              <Input id="audit-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="min-h-[40px]" />
            </div>
            <div className="sm:col-span-2">
              {/* BUG-068: в списке — человекочитаемые названия сущностей */}
              <Label htmlFor="audit-entity" className="text-xs">Объект</Label>
              <select id="audit-entity" className={selectCls} value={entityType} onChange={(e) => setEntityType(e.target.value)}>
                <option value="all">Все объекты</option>
                {[...ENTITY_TYPES]
                  .sort((a, b) => entityLabel(a).localeCompare(entityLabel(b), 'ru'))
                  .map((t) => <option key={t} value={t}>{entityLabel(t)}</option>)}
              </select>
            </div>
            {hasFilters && (
              <div className="flex items-end">
                <Button variant="ghost" onClick={resetFilters} className="min-h-[40px]">Сбросить фильтры</Button>
              </div>
            )}
          </div>
          <FilterChips
            ariaLabel="Фильтр по типу действия"
            value={action}
            onChange={setAction}
            options={[
              { value: 'all', label: 'Все действия' },
              ...ACTIONS.map((a) => ({ value: a, label: statusLabel(a, a) })),
            ]}
          />
        </Card>

        {logsQuery.error ? (
          <ErrorState error={logsQuery.error} onRetry={logsQuery.refetch} />
        ) : logsQuery.isPending ? (
          <SkeletonBlock />
        ) : !rows.length ? (
          <EmptyState
            icon={History}
            title="Записей не найдено"
            description={
              hasFilters
                ? 'Под текущие фильтры не попала ни одна запись журнала.'
                : 'Журнал пока пуст. Записи появятся автоматически при первых действиях пользователей.'
            }
            actionLabel={hasFilters ? 'Сбросить фильтры' : undefined}
            onAction={hasFilters ? resetFilters : undefined}
          />
        ) : (
          <Card className="overflow-hidden">
            <ul role="list" className="divide-y divide-border">
              {rows.map((log) => {
                const isOpen = expanded.has(log.id);
                return (
                  <li key={log.id} role="listitem">
                    <div className="flex items-start gap-3 p-4">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent" aria-hidden="true">
                        <ShieldCheck className="h-4 w-4 text-primary" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-foreground">{log.user_name || 'Система'}</span>
                          <StatusBadge value={log.action} />
                          {/* BUG-068 */}
                          <span className="text-xs text-muted-foreground">· {entityLabel(log.entity_type)}</span>
                        </div>
                        {log.description && <p className="mt-0.5 text-sm text-muted-foreground">{log.description}</p>}
                        {log.user_email && <p className="mt-0.5 text-xs text-muted-foreground">{log.user_email}</p>}
                      </div>
                      <div className="shrink-0 text-right text-xs text-muted-foreground">
                        {formatDate(log.date, 'datetime')}
                      </div>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-expanded={isOpen}
                        aria-label={isOpen ? 'Свернуть детали записи' : 'Показать детали записи'}
                        onClick={() => toggleExpanded(log.id)}
                      >
                        {isOpen
                          ? <ChevronDown className="h-4 w-4" aria-hidden="true" />
                          : <ChevronRight className="h-4 w-4" aria-hidden="true" />}
                      </Button>
                    </div>
                    {isOpen && (
                      <div className={cn('border-t border-border bg-muted/30 p-4')}>
                        <div className="mb-3 grid grid-cols-1 gap-2 text-xs text-muted-foreground sm:grid-cols-3">
                          <div>Объект: <span className="text-foreground">{entityLabel(log.entity_type)}</span></div>
                          <div>Идентификатор: <span className="font-mono text-foreground">{log.entity_id || '—'}</span></div>
                          <div>Время: <span className="text-foreground">{formatDate(log.date, 'datetime')}</span></div>
                        </div>
                        <ChangesTable changes={log.changes} />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            <div className="px-4 pb-4">
              <Pagination
                page={page}
                pageSize={PAGE_SIZE}
                total={total}
                onPageChange={setPage}
                isFetching={logsQuery.isFetching}
                itemLabels={['запись', 'записи', 'записей']}
              />
            </div>
          </Card>
        )}
      </div>
    </PageContainer>
  );
}
