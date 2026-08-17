import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  CheckCircle2, ClipboardList, Download, ExternalLink, Search, Sparkles, XCircle,
} from 'lucide-react';

import { api } from '@/api/client';
import { createEntity } from '@/api/entity';
import PageContainer from '@/components/common/PageContainer';
import EmptyState from '@/components/common/EmptyState';
import ErrorState from '@/components/common/ErrorState';
import StatusBadge from '@/components/common/StatusBadge';
import Pagination from '@/components/common/Pagination';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { formatDate, formatNumber, formatPoints } from '@/lib/format';
import { statusLabel, statusVariant } from '@/lib/statusLabels';
import { mutationErrorMessage } from '@/lib/dataErrors';
import { buildCSV, downloadCSV } from '@/lib/csv';

/**
 * Реестр заявок по процессам для HR.
 *
 * Читаем вьюху v_process_requests: в ней уже есть текущий этап, признак
 * просрочки и посчитанные баллы. Статусы отсюда не меняются — движение заявки
 * идёт только через RPC на карточке заявки.
 */

const requestsView = createEntity('v_process_requests', { defaultSort: '-created_date' });

const PAGE_SIZE = 25;
const SUMMARY_LIMIT = 5000;

const STATUSES = ['in_progress', 'resolved', 'rejected', 'cancelled'];

const EMPTY_FILTERS = { process: '', status: '', from: '', to: '', search: '' };

const SELECT_CLASS =
  'min-h-[40px] w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus:border-primary/40';

function SkeletonBlock() {
  return (
    <div className="space-y-4" aria-hidden="true">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-xl bg-muted" />
        ))}
      </div>
      <div className="h-24 animate-pulse rounded-xl bg-muted" />
      <div className="h-96 animate-pulse rounded-xl bg-muted" />
    </div>
  );
}

export default function AdminProcessRequests() {
  const { toast } = useToast();
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [page, setPage] = useState(1);

  // Смена фильтров всегда возвращает на первую страницу.
  useEffect(() => {
    setPage(1);
  }, [filters]);

  /** Условие выборки одинаково для таблицы, сводки и экспорта. */
  const where = useMemo(() => {
    const w = {};
    if (filters.process) w.process_id = filters.process;
    if (filters.status) w.status = filters.status;
    if (filters.from || filters.to) {
      w.created_date = {};
      if (filters.from) w.created_date.gte = filters.from;
      // created_date — момент времени, поэтому «по дату» включает весь день.
      if (filters.to) w.created_date.lte = `${filters.to}T23:59:59.999`;
    }
    if (filters.search.trim()) w.employee_name = { ilike: `%${filters.search.trim()}%` };
    return w;
  }, [filters]);

  const rowsQuery = useQuery({
    queryKey: ['admin-process-requests', where, page],
    queryFn: () => requestsView.page({ where, sort: '-created_date', page, pageSize: PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });

  // Сводка считается по всей выборке фильтра, а не по видимой странице.
  const summaryQuery = useQuery({
    queryKey: ['admin-process-requests-summary', where],
    queryFn: () => requestsView.filter(where, '-created_date', SUMMARY_LIMIT),
  });

  const processesQuery = useQuery({
    queryKey: ['processes-all'],
    queryFn: () => api.entities.Process.list('sort_order'),
  });

  const summaryRows = useMemo(() => summaryQuery.data || [], [summaryQuery.data]);

  const stats = useMemo(() => {
    const acc = { total: summaryRows.length, in_progress: 0, resolved: 0, rejected: 0, points: 0 };
    for (const row of summaryRows) {
      if (row.status === 'in_progress') acc.in_progress += 1;
      if (row.status === 'resolved') acc.resolved += 1;
      if (row.status === 'rejected') acc.rejected += 1;
      acc.points += Number(row.points_awarded) || 0;
    }
    return acc;
  }, [summaryRows]);

  const rows = rowsQuery.data?.rows || [];
  const total = rowsQuery.data?.total || 0;

  /** Экспорт учитывает текущие фильтры, а не видимую страницу. */
  const handleExport = async () => {
    try {
      const all = await requestsView.filter(where, '-created_date', SUMMARY_LIMIT);
      const csv = buildCSV(
        ['Дата подачи', 'Сотрудник', 'Процесс', 'Категория', 'Текущий этап', 'Статус', 'Баллы', 'Срок этапа', 'Закрыта'],
        all.map((row) => [
          formatDate(row.created_date),
          row.employee_name || '',
          row.process_name || '',
          row.category_name || '',
          row.stage_name || '',
          statusLabel(row.status),
          row.points_awarded || 0,
          row.due_date ? formatDate(row.due_date) : '',
          row.resolved_at ? formatDate(row.resolved_at) : '',
        ])
      );
      downloadCSV(`process_requests_${formatDate(new Date(), 'iso')}.csv`, csv);
      toast({ title: `Выгружено заявок: ${formatNumber(all.length)}` });
    } catch (e) {
      toast({
        variant: 'destructive',
        title: 'Не удалось выгрузить заявки',
        description: mutationErrorMessage(e),
      });
    }
  };

  const error = rowsQuery.error || summaryQuery.error;
  const isLoading = rowsQuery.isPending || summaryQuery.isPending;

  return (
    <PageContainer
      title="Заявки по процессам"
      description="Все заявки сотрудников: согласование, исполнение и автоматическое начисление баллов."
      width="wide"
      actions={
        <Button variant="outline" onClick={handleExport}>
          <Download className="h-4 w-4" aria-hidden="true" />
          Экспорт CSV
        </Button>
      }
    >
      {error ? (
        <ErrorState
          error={error}
          onRetry={() => {
            rowsQuery.refetch();
            summaryQuery.refetch();
          }}
        />
      ) : isLoading ? (
        <SkeletonBlock />
      ) : (
        <div className="space-y-5">
          {/* Сводка по всей выборке фильтра */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <Card className="p-4">
              <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                <ClipboardList className="h-4 w-4" aria-hidden="true" /> Всего заявок
              </div>
              <div className="text-2xl font-bold text-foreground">{formatNumber(stats.total)}</div>
            </Card>
            <Card className="p-4">
              <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                <ClipboardList className="h-4 w-4 text-info" aria-hidden="true" /> В работе
              </div>
              <div className="text-2xl font-bold text-info">{formatNumber(stats.in_progress)}</div>
            </Card>
            <Card className="p-4">
              <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                <CheckCircle2 className="h-4 w-4 text-success" aria-hidden="true" /> Решено
              </div>
              <div className="text-2xl font-bold text-success">{formatNumber(stats.resolved)}</div>
            </Card>
            <Card className="p-4">
              <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                <XCircle className="h-4 w-4 text-destructive" aria-hidden="true" /> Отклонено
              </div>
              <div className="text-2xl font-bold text-destructive">{formatNumber(stats.rejected)}</div>
            </Card>
            <Card className="p-4">
              <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                <Sparkles className="h-4 w-4 text-success" aria-hidden="true" /> Начислено баллов
              </div>
              <div className="text-2xl font-bold text-foreground">{formatPoints(stats.points)}</div>
            </Card>
          </div>

          {/* Фильтры */}
          <Card className="p-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
              <div>
                <Label htmlFor="pr-process" className="text-xs">Процесс</Label>
                <select
                  id="pr-process"
                  className={SELECT_CLASS}
                  value={filters.process}
                  onChange={(e) => setFilters({ ...filters, process: e.target.value })}
                >
                  <option value="">Все процессы</option>
                  {(processesQuery.data || []).map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="pr-status" className="text-xs">Статус</Label>
                <select
                  id="pr-status"
                  className={SELECT_CLASS}
                  value={filters.status}
                  onChange={(e) => setFilters({ ...filters, status: e.target.value })}
                >
                  <option value="">Все статусы</option>
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>{statusLabel(s)}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="pr-from" className="text-xs">С даты</Label>
                <Input
                  id="pr-from"
                  type="date"
                  value={filters.from}
                  className="min-h-[40px]"
                  onChange={(e) => setFilters({ ...filters, from: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="pr-to" className="text-xs">По дату</Label>
                <Input
                  id="pr-to"
                  type="date"
                  value={filters.to}
                  className="min-h-[40px]"
                  onChange={(e) => setFilters({ ...filters, to: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="pr-search" className="text-xs">Сотрудник</Label>
                <div className="relative">
                  <Search
                    className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <Input
                    id="pr-search"
                    value={filters.search}
                    className="min-h-[40px] pl-8"
                    placeholder="Поиск по ФИО"
                    onChange={(e) => setFilters({ ...filters, search: e.target.value })}
                  />
                </div>
              </div>
            </div>
          </Card>

          {/* Реестр заявок */}
          {!rows.length ? (
            <EmptyState
              icon={ClipboardList}
              title="Заявок не найдено"
              description="Под текущие фильтры не попала ни одна заявка. Сбросьте фильтры, чтобы увидеть весь реестр."
              actionLabel="Сбросить фильтры"
              onAction={() => setFilters(EMPTY_FILTERS)}
            />
          ) : (
            <Card className="overflow-hidden">
              {/* BUG-036: горизонтальный скролл + липкая колонка действий */}
              <div className="table-scroll">
                <table className="w-full text-sm">
                  <caption className="sr-only">Реестр заявок сотрудников по процессам</caption>
                  <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                    <tr>
                      <th scope="col" className="px-4 py-2.5 text-left font-medium">Подана</th>
                      <th scope="col" className="px-4 py-2.5 text-left font-medium">Сотрудник</th>
                      <th scope="col" className="px-4 py-2.5 text-left font-medium">Процесс</th>
                      <th scope="col" className="hidden px-4 py-2.5 text-left font-medium xl:table-cell">Категория</th>
                      <th scope="col" className="px-4 py-2.5 text-left font-medium">Этап</th>
                      <th scope="col" className="px-4 py-2.5 text-left font-medium">Статус</th>
                      <th scope="col" className="hidden px-4 py-2.5 text-left font-medium xl:table-cell">Срок</th>
                      <th scope="col" className="px-4 py-2.5 text-right font-medium">Баллы</th>
                      <th scope="col" className="table-sticky-actions px-4 py-2.5 text-center font-medium">
                        Действия
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {rows.map((row) => (
                      <tr key={row.id} className="hover:bg-muted/40">
                        <td className="whitespace-nowrap px-4 py-2.5 text-muted-foreground">
                          {formatDate(row.created_date)}
                        </td>
                        <td className="px-4 py-2.5 font-medium text-foreground">
                          {row.employee_name || '—'}
                          <span className="block text-xs font-normal text-muted-foreground xl:hidden">
                            {row.category_name || '—'}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-foreground">{row.process_name || '—'}</td>
                        <td className="hidden px-4 py-2.5 text-muted-foreground xl:table-cell">
                          {row.category_name || '—'}
                        </td>
                        <td className="px-4 py-2.5">
                          {row.stage_name ? (
                            <StatusBadge
                              value={row.stage_name}
                              fallback={row.stage_name}
                              variant={statusVariant(row.stage_type)}
                            />
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <StatusBadge value={row.status} />
                            {row.is_overdue && <StatusBadge value="overdue" />}
                          </div>
                        </td>
                        <td className="hidden whitespace-nowrap px-4 py-2.5 text-muted-foreground xl:table-cell">
                          {row.due_date ? formatDate(row.due_date) : '—'}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-right font-bold text-foreground">
                          {formatPoints(row.points_awarded || 0, { short: true })}
                        </td>
                        <td className="table-sticky-actions px-4 py-2.5 text-center">
                          <Button
                            asChild
                            size="icon"
                            variant="ghost"
                            aria-label={`Открыть заявку ${row.process_name || ''} — ${row.employee_name || ''}`}
                          >
                            <Link to={`/cabinet/processes/requests/${row.id}`}>
                              <ExternalLink className="h-4 w-4" aria-hidden="true" />
                            </Link>
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="px-4 pb-4">
                <Pagination
                  page={page}
                  pageSize={PAGE_SIZE}
                  total={total}
                  onPageChange={setPage}
                  isFetching={rowsQuery.isFetching}
                  itemLabels={['заявка', 'заявки', 'заявок']}
                />
              </div>
            </Card>
          )}
        </div>
      )}
    </PageContainer>
  );
}
