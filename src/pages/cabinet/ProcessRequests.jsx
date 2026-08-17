import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { AlertTriangle, ChevronRight, ClipboardList, Inbox, Sparkles, UserX } from 'lucide-react';

import { createEntity } from '@/api/entity';
import PageContainer from '@/components/common/PageContainer';
import EmptyState from '@/components/common/EmptyState';
import ErrorState from '@/components/common/ErrorState';
import StatusBadge from '@/components/common/StatusBadge';
import FilterChips from '@/components/common/FilterChips';
import Pagination from '@/components/common/Pagination';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/lib/AuthContext';
import { formatDate, formatNumber, formatPoints } from '@/lib/format';
import { statusVariant } from '@/lib/statusLabels';
import { cn } from '@/lib/utils';

/**
 * Заявки сотрудника по процессам: свои и те, что ждут его решения.
 *
 * Читаем вьюху v_process_requests — в ней уже посчитаны текущий этап,
 * просрочка, признак «ждёт моего решения» и предварительные баллы,
 * поэтому клиенту не нужно ничего досчитывать самому.
 */

const requestsView = createEntity('v_process_requests', { defaultSort: '-created_date' });

const PAGE_SIZE = 10;

const STATUS_FILTERS = [
  { value: 'in_progress', label: 'В работе' },
  { value: 'resolved', label: 'Решены' },
  { value: 'rejected', label: 'Отклонены' },
  { value: 'cancelled', label: 'Отозваны' },
];

function ListSkeleton() {
  return (
    <div className="space-y-3" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-28 animate-pulse rounded-xl bg-muted" />
      ))}
    </div>
  );
}

/** Карточка заявки в списке. */
function RequestCard({ request, showAuthor }) {
  const points = request.status === 'resolved' ? request.points_awarded : request.points_preview;

  return (
    <Card className={cn('transition-colors hover:bg-accent/40', request.is_overdue && 'border-destructive/40')}>
      <Link to={`/cabinet/processes/requests/${request.id}`} className="block min-h-[40px] p-4">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <ClipboardList className="h-5 w-5" aria-hidden="true" />
          </span>

          <div className="min-w-0 flex-1">
            <p className="font-medium text-foreground">{request.process_name || 'Заявка'}</p>
            {request.category_name && (
              <p className="mt-0.5 text-sm text-muted-foreground">{request.category_name}</p>
            )}
            {showAuthor && (
              <p className="mt-0.5 text-sm text-muted-foreground">Автор: {request.employee_name || '—'}</p>
            )}

            <div className="mt-2 flex flex-wrap items-center gap-2">
              <StatusBadge value={request.status} />
              {request.stage_name && (
                <StatusBadge
                  value={request.stage_name}
                  fallback={request.stage_name}
                  variant={statusVariant(request.stage_type)}
                />
              )}
              {request.is_overdue && <StatusBadge value="overdue" />}
              {points > 0 && (
                <Badge variant="outline" className="gap-1">
                  <Sparkles className="h-3 w-3" aria-hidden="true" />
                  {formatPoints(points)}
                </Badge>
              )}
              <span className="text-xs text-muted-foreground">{formatDate(request.created_date)}</span>
            </div>

            {request.is_overdue && request.due_date && (
              <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-destructive">
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                Срок этапа истёк {formatDate(request.due_date)}
              </p>
            )}
          </div>

          <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </div>
      </Link>
    </Card>
  );
}

export default function ProcessRequests() {
  const { employeeId, isLoadingAuth } = useAuth();

  const [tab, setTab] = useState('mine');
  const [status, setStatus] = useState('all');
  const [minePage, setMinePage] = useState(1);
  const [queuePage, setQueuePage] = useState(1);

  // Смена фильтра всегда возвращает на первую страницу.
  useEffect(() => {
    setMinePage(1);
  }, [status]);

  const mineWhere = useMemo(() => {
    const where = { employee_id: employeeId };
    if (status !== 'all') where.status = status;
    return where;
  }, [employeeId, status]);

  const mineQuery = useQuery({
    queryKey: ['process-requests', 'mine', mineWhere, minePage],
    queryFn: () => requestsView.page({ where: mineWhere, sort: '-created_date', page: minePage, pageSize: PAGE_SIZE }),
    enabled: !!employeeId,
    placeholderData: keepPreviousData,
  });

  // Счётчики чипов считает сервер — на клиенте нечего складывать.
  const countsQuery = useQuery({
    queryKey: ['process-requests', 'mine-counts', employeeId],
    queryFn: async () => {
      const base = { employee_id: employeeId };
      const [all, ...byStatus] = await Promise.all([
        requestsView.count(base),
        ...STATUS_FILTERS.map((s) => requestsView.count({ ...base, status: s.value })),
      ]);
      const counts = { all };
      STATUS_FILTERS.forEach((s, i) => {
        counts[s.value] = byStatus[i];
      });
      return counts;
    },
    enabled: !!employeeId,
  });

  const queueQuery = useQuery({
    queryKey: ['process-requests', 'queue', queuePage],
    queryFn: () =>
      requestsView.page({
        where: { awaiting_me: true },
        sort: '-created_date',
        page: queuePage,
        pageSize: PAGE_SIZE,
      }),
    placeholderData: keepPreviousData,
  });

  const counts = countsQuery.data || {};
  const mineRows = mineQuery.data?.rows || [];
  const mineTotal = mineQuery.data?.total || 0;
  const queueRows = queueQuery.data?.rows || [];
  const queueTotal = queueQuery.data?.total || 0;

  const filterOptions = [
    { value: 'all', label: 'Все', count: counts.all },
    ...STATUS_FILTERS.map((s) => ({ value: s.value, label: s.label, count: counts[s.value] })),
  ];

  const mineError = mineQuery.error || countsQuery.error;

  return (
    <PageContainer
      title="Заявки по процессам"
      description="Ваши заявки на начисление баллов и заявки коллег, ждущие вашего решения."
      actions={
        <Button asChild>
          <Link to="/cabinet/processes">
            <ClipboardList className="h-4 w-4" aria-hidden="true" />
            Подать заявку
          </Link>
        </Button>
      }
    >
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="mine">Мои заявки</TabsTrigger>
          <TabsTrigger value="queue" className="gap-2">
            Ждут моего решения
            {queueTotal > 0 && (
              <Badge variant="warning" className="px-1.5 py-0 tabular-nums">
                {formatNumber(queueTotal)}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="mine">
          {mineError ? (
            <ErrorState
              error={mineError}
              onRetry={() => {
                mineQuery.refetch();
                countsQuery.refetch();
              }}
            />
          ) : isLoadingAuth || (!!employeeId && mineQuery.isPending) ? (
            <ListSkeleton />
          ) : !employeeId ? (
            <EmptyState
              icon={UserX}
              title="Учётная запись не связана с карточкой сотрудника"
              description="Заявки подаются от имени сотрудника. Попросите HR-специалиста связать вашу учётную запись с карточкой сотрудника."
            />
          ) : (
            <div className="space-y-4">
              <FilterChips
                options={filterOptions}
                value={status}
                onChange={setStatus}
                ariaLabel="Фильтр заявок по статусу"
              />

              {!mineRows.length ? (
                <EmptyState
                  icon={ClipboardList}
                  title={status === 'all' ? 'Заявок пока нет' : 'В этом статусе заявок нет'}
                  description={
                    status === 'all'
                      ? 'Выберите процесс в каталоге и подайте первую заявку — за неё начислятся баллы.'
                      : 'Снимите фильтр, чтобы увидеть все ваши заявки.'
                  }
                  action={
                    status === 'all' ? (
                      <Button asChild>
                        <Link to="/cabinet/processes">В каталог процессов</Link>
                      </Button>
                    ) : (
                      <Button variant="outline" onClick={() => setStatus('all')}>
                        Показать все
                      </Button>
                    )
                  }
                />
              ) : (
                <>
                  <ul className="space-y-3" role="list">
                    {mineRows.map((request) => (
                      <li key={request.id} role="listitem">
                        <RequestCard request={request} />
                      </li>
                    ))}
                  </ul>
                  <Pagination
                    page={minePage}
                    pageSize={PAGE_SIZE}
                    total={mineTotal}
                    onPageChange={setMinePage}
                    isFetching={mineQuery.isFetching}
                    itemLabels={['заявка', 'заявки', 'заявок']}
                  />
                </>
              )}
            </div>
          )}
        </TabsContent>

        <TabsContent value="queue">
          {queueQuery.error ? (
            <ErrorState error={queueQuery.error} onRetry={queueQuery.refetch} />
          ) : queueQuery.isPending ? (
            <ListSkeleton />
          ) : !queueRows.length ? (
            <EmptyState
              icon={Inbox}
              title="Заявок на согласование нет"
              description="Здесь появятся заявки коллег, по которым решение принимаете вы: согласование или начисление баллов."
            />
          ) : (
            <div className="space-y-4">
              <ul className="space-y-3" role="list">
                {queueRows.map((request) => (
                  <li key={request.id} role="listitem">
                    <RequestCard request={request} showAuthor />
                  </li>
                ))}
              </ul>
              <Pagination
                page={queuePage}
                pageSize={PAGE_SIZE}
                total={queueTotal}
                onPageChange={setQueuePage}
                isFetching={queueQuery.isFetching}
                itemLabels={['заявка', 'заявки', 'заявок']}
              />
            </div>
          )}
        </TabsContent>
      </Tabs>
    </PageContainer>
  );
}
