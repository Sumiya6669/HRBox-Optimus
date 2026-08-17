import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { api } from '@/api/client';
import { createEntity } from '@/api/entity';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import {
  Wallet, TrendingUp, TrendingDown, Award, Store, ChevronLeft, ChevronRight, HelpCircle, Coins,
} from 'lucide-react';
import PageContainer from '@/components/common/PageContainer';
import EmptyState from '@/components/common/EmptyState';
import ErrorState from '@/components/common/ErrorState';
import StatusBadge from '@/components/common/StatusBadge';
import { useCurrentEmployee } from '@/lib/useCurrentEmployee';
import { formatDate, formatPoints, formatNumber, formatSigned, formatMoney, pluralize } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * Кошелёк сотрудника.
 *
 * BUG-054: фиолетовая палитра заменена на брендовые токены brand-wallet.
 * BUG-055: «₸KZ» не существует — внутренняя валюта это баллы (formatPoints),
 *          настоящие деньги (номинал сертификата) — formatMoney.
 * BUG-056: «−0» в блоке «Потрачено» — только formatSigned.
 * BUG-071: встроенный магазин наград убран, остался переход в единый /cabinet/store.
 * Баланс считает сервер (rpc wallet_balance), операции читаются из вьюхи
 * v_wallet_transactions с серверной пагинацией по 20 записей.
 */

const PAGE_SIZE = 20;

// Вьюху нельзя читать через api.entities (там базовые таблицы) — берём тот же
// контракт .page() поверх v_wallet_transactions: branch/department уже заполнены (BUG-035).
const walletView = createEntity('v_wallet_transactions', { defaultSort: '-date' });

function SkeletonBlock() {
  return (
    <div className="space-y-6" aria-hidden="true">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-32 animate-pulse rounded-xl bg-muted" />
        ))}
      </div>
      <div className="space-y-2">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="h-16 animate-pulse rounded-xl bg-muted" />
        ))}
      </div>
    </div>
  );
}

export default function CabinetWallet() {
  const { employeeId, isLoading: isLoadingAuth } = useCurrentEmployee();
  const [page, setPage] = useState(1);

  // Баланс — только с сервера, без досчёта на клиенте.
  const balanceQuery = useQuery({
    queryKey: ['wallet-balance', employeeId],
    queryFn: () => api.rpc.walletBalance(employeeId),
    enabled: !!employeeId,
  });

  // Суммы «начислено / потрачено» за всё время: тянем только колонку amount.
  const totalsQuery = useQuery({
    queryKey: ['wallet-totals', employeeId],
    queryFn: async () => {
      const { data, error } = await api.supabase
        .from('v_wallet_transactions')
        .select('amount')
        .eq('employee_id', employeeId);
      if (error) throw error;
      return data || [];
    },
    enabled: !!employeeId,
  });

  const txQuery = useQuery({
    queryKey: ['wallet-tx', employeeId, page],
    queryFn: () => walletView.page({ where: { employee_id: employeeId }, sort: '-date', page, pageSize: PAGE_SIZE }),
    enabled: !!employeeId,
    placeholderData: keepPreviousData,
  });

  const achievementsQuery = useQuery({
    queryKey: ['achievements-me', employeeId],
    queryFn: () => api.entities.Achievement.filter({ employee_id: employeeId }, '-date'),
    enabled: !!employeeId,
  });

  // Аудит: сотруднику непонятно, за что начисляют баллы.
  const reasonsQuery = useQuery({
    queryKey: ['award-reasons-active'],
    queryFn: () => api.entities.AwardReason.filter({ active: true }),
  });

  const storeQuery = useQuery({
    queryKey: ['store-items-active'],
    queryFn: () => api.entities.StoreItem.filter({ active: true }),
  });

  const balance = balanceQuery.data ?? 0;

  const { earned, spent } = useMemo(() => {
    const rows = totalsQuery.data || [];
    return {
      earned: rows.filter((r) => r.amount > 0).reduce((s, r) => s + r.amount, 0),
      spent: rows.filter((r) => r.amount < 0).reduce((s, r) => s + Math.abs(r.amount), 0),
    };
  }, [totalsQuery.data]);

  // Ближайшая награда, до которой ещё нужно накопить.
  const nextReward = useMemo(() => {
    const items = (storeQuery.data || []).filter((i) => i.stock !== 0);
    const affordable = [...items].sort((a, b) => (b.price || 0) - (a.price || 0)).find((i) => (i.price || 0) <= balance);
    const upcoming = [...items].sort((a, b) => (a.price || 0) - (b.price || 0)).find((i) => (i.price || 0) > balance);
    return { affordable, upcoming };
  }, [storeQuery.data, balance]);

  const rows = txQuery.data?.rows || [];
  const total = txQuery.data?.total || 0;
  const pagesCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const error = balanceQuery.error || txQuery.error || totalsQuery.error;
  const isLoading = isLoadingAuth || balanceQuery.isPending || txQuery.isPending;

  if (!isLoadingAuth && !employeeId) {
    return (
      <PageContainer title="Кошелёк" description="Баллы за достижения и участие в жизни компании">
        <EmptyState
          icon={Wallet}
          title="Кошелёк недоступен"
          description="Учётная запись не связана с карточкой сотрудника, поэтому баллы начислять некому. Обратитесь в HR-отдел, чтобы связать профиль."
        />
      </PageContainer>
    );
  }

  return (
    <PageContainer title="Кошелёк" description="Баллы за достижения и участие в жизни компании">
      {error ? (
        <ErrorState
          error={error}
          onRetry={() => {
            balanceQuery.refetch();
            totalsQuery.refetch();
            txQuery.refetch();
          }}
        />
      ) : isLoading ? (
        <SkeletonBlock />
      ) : (
        <div className="space-y-6">
          {/* Баланс и итоги */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Card className="border-0 bg-brand-wallet p-6 text-white">
              <div className="mb-4 flex items-center justify-between">
                <Wallet className="h-8 w-8 text-white/80" aria-hidden="true" />
                <span className="rounded-full bg-white/20 px-3 py-1 text-xs font-semibold">Баллы</span>
              </div>
              <div className="text-4xl font-bold">{formatNumber(balance)}</div>
              <div className="mt-1 text-sm text-white/80">Текущий баланс · {formatPoints(balance)}</div>
            </Card>

            <Card className="p-5">
              <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                <TrendingUp className="h-4 w-4 text-success" aria-hidden="true" /> Начислено
              </div>
              <div className="text-3xl font-bold text-success">{formatSigned(earned)}</div>
              <div className="mt-1 text-xs text-muted-foreground">за всё время</div>
            </Card>

            {/* BUG-056: при нулевых тратах здесь показывалось «−0» */}
            <Card className="p-5">
              <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                <TrendingDown className="h-4 w-4 text-destructive" aria-hidden="true" /> Потрачено
              </div>
              <div className="text-3xl font-bold text-destructive">{formatSigned(-spent)}</div>
              <div className="mt-1 text-xs text-muted-foreground">в магазине наград</div>
            </Card>
          </div>

          {/* BUG-071: вместо встроенного магазина — карточка-ссылка на единый раздел */}
          <Card className="p-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent text-brand-wallet">
                  <Store className="h-5 w-5" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-base font-semibold text-foreground">Магазин наград</h2>
                  <p className="text-sm text-muted-foreground">
                    Доступно {formatPoints(balance)}
                    {nextReward.affordable ? ` · например, «${nextReward.affordable.name}»` : ''}
                  </p>
                </div>
              </div>
              <Button asChild className="min-h-[40px]">
                <Link to="/cabinet/store" aria-label="Перейти в магазин наград">Перейти в магазин</Link>
              </Button>
            </div>

            {nextReward.upcoming && (
              <div className="mt-4 rounded-xl border border-border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium text-foreground">
                    До награды «{nextReward.upcoming.name}»
                  </span>
                  <span className="whitespace-nowrap text-sm text-muted-foreground">
                    {formatPoints(balance)} из {formatPoints(nextReward.upcoming.price)}
                  </span>
                </div>
                <Progress
                  value={Math.min(100, Math.round((balance / (nextReward.upcoming.price || 1)) * 100))}
                  className="mt-2"
                  aria-label={`Прогресс до награды «${nextReward.upcoming.name}»`}
                />
                <p className="mt-2 text-xs text-muted-foreground">
                  Не хватает {formatPoints((nextReward.upcoming.price || 0) - balance)}
                  {/* Номинал сертификата — настоящие деньги, а не баллы (BUG-055) */}
                  {nextReward.upcoming.nominal_kzt != null
                    ? ` · номинал награды ${formatMoney(nextReward.upcoming.nominal_kzt)}`
                    : ''}
                </p>
              </div>
            )}
          </Card>

          {/* Аудит: непонятно, за что начисляются баллы */}
          <Card className="p-5">
            <h2 className="mb-1 flex items-center gap-2 text-base font-semibold text-foreground">
              <HelpCircle className="h-5 w-5 text-brand-wallet" aria-hidden="true" />
              За что начисляются баллы
            </h2>
            <p className="mb-4 text-sm text-muted-foreground">
              Баллы начисляет HR-отдел по одному из действующих правил.
            </p>
            {reasonsQuery.error ? (
              <ErrorState error={reasonsQuery.error} onRetry={reasonsQuery.refetch} compact />
            ) : reasonsQuery.isPending ? (
              <div className="h-24 animate-pulse rounded-xl bg-muted" aria-hidden="true" />
            ) : !reasonsQuery.data?.length ? (
              <EmptyState
                icon={Coins}
                compact
                title="Правила начисления не заданы"
                description="HR-отдел ещё не опубликовал список причин начисления баллов."
              />
            ) : (
              <ul role="list" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {reasonsQuery.data.map((reason) => (
                  <li key={reason.id} role="listitem" className="rounded-xl border border-border p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-foreground">{reason.title}</span>
                      <StatusBadge value={reason.category} />
                      {reason.default_points != null && (
                        <span className="whitespace-nowrap text-xs font-semibold text-brand-wallet">
                          {formatSigned(reason.default_points, formatPoints)}
                        </span>
                      )}
                    </div>
                    {reason.description && (
                      <p className="mt-1 text-xs text-muted-foreground">{reason.description}</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* История операций */}
            <section aria-labelledby="wallet-history">
              <h2 id="wallet-history" className="mb-3 font-semibold text-foreground">
                История операций
              </h2>
              {!rows.length ? (
                <EmptyState
                  icon={Wallet}
                  title="Операций пока нет"
                  description="Здесь появятся начисления за достижения и списания в магазине наград."
                />
              ) : (
                <>
                  <ul role="list" className="space-y-2">
                    {rows.map((t) => (
                      <li key={t.id} role="listitem">
                        <Card className="flex items-center gap-3 p-3">
                          <div
                            className={cn(
                              'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
                              t.amount > 0 ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive'
                            )}
                            aria-hidden="true"
                          >
                            {t.amount > 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium text-foreground">
                              {t.item_name || t.reason || t.reason_title || 'Операция по баллам'}
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                              <span>{formatDate(t.date)}</span>
                              <StatusBadge value={t.type} />
                              {t.department && <span className="truncate">{t.department}</span>}
                            </div>
                          </div>
                          <div
                            className={cn(
                              'whitespace-nowrap text-sm font-bold',
                              t.amount > 0 ? 'text-success' : 'text-destructive'
                            )}
                          >
                            {formatSigned(t.amount)}
                          </div>
                        </Card>
                      </li>
                    ))}
                  </ul>

                  {/* Серверная пагинация по 20 записей */}
                  {pagesCount > 1 && (
                    <div className="mt-4 flex items-center justify-between gap-3">
                      <span className="text-xs text-muted-foreground">
                        Страница {formatNumber(page)} из {formatNumber(pagesCount)} · всего{' '}
                        {pluralize(total, 'операция', 'операции', 'операций')}
                      </span>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="icon"
                          aria-label="Предыдущая страница операций"
                          disabled={page <= 1 || txQuery.isFetching}
                          onClick={() => setPage((p) => Math.max(1, p - 1))}
                        >
                          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                        </Button>
                        <Button
                          variant="outline"
                          size="icon"
                          aria-label="Следующая страница операций"
                          disabled={page >= pagesCount || txQuery.isFetching}
                          onClick={() => setPage((p) => Math.min(pagesCount, p + 1))}
                        >
                          <ChevronRight className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </section>

            {/* Достижения */}
            <section aria-labelledby="wallet-achievements">
              <h2 id="wallet-achievements" className="mb-3 flex items-center gap-2 font-semibold text-foreground">
                <Award className="h-5 w-5 text-brand-wallet" aria-hidden="true" /> Достижения
              </h2>
              {achievementsQuery.error ? (
                <ErrorState error={achievementsQuery.error} onRetry={achievementsQuery.refetch} compact />
              ) : achievementsQuery.isPending ? (
                <div className="h-32 animate-pulse rounded-xl bg-muted" aria-hidden="true" />
              ) : !achievementsQuery.data?.length ? (
                <EmptyState
                  icon={Award}
                  title="Достижений пока нет"
                  description="Достижения появляются автоматически: за стаж, KPI и участие в корпоративных активностях."
                />
              ) : (
                <ul role="list" className="grid grid-cols-2 gap-3">
                  {achievementsQuery.data.map((a) => (
                    <li key={a.id} role="listitem">
                      <Card className="h-full p-4 text-center">
                        <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-accent">
                          <Award className="h-6 w-6 text-brand-wallet" aria-hidden="true" />
                        </div>
                        <div className="text-sm font-medium text-foreground">{a.title}</div>
                        <div className="mt-0.5 whitespace-nowrap text-xs font-semibold text-brand-wallet">
                          {/* Числительные согласует formatPoints, руками их склонять нельзя */}
                          {formatSigned(a.points, formatPoints)}
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">{formatDate(a.date)}</div>
                        <div className="mt-2 flex justify-center">
                          <StatusBadge value={a.type} />
                        </div>
                      </Card>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </div>
      )}
    </PageContainer>
  );
}
