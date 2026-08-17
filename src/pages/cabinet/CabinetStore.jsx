import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Store, ShoppingBag, Package, Wallet } from 'lucide-react';
import PageContainer from '@/components/common/PageContainer';
import EmptyState from '@/components/common/EmptyState';
import ErrorState from '@/components/common/ErrorState';
import StatusBadge from '@/components/common/StatusBadge';
import RewardCard, { rewardAvailability } from '@/components/common/RewardCard';
import { useToast } from '@/components/ui/use-toast';
import { useCurrentEmployee } from '@/lib/useCurrentEmployee';
import { formatDate, formatPoints } from '@/lib/format';

/**
 * Магазин наград.
 *
 * BUG-026: единая карточка RewardCard — одинаковая логика доступности «Купить»
 *          и в магазине, и везде, где карточка переиспользуется.
 * BUG-055: цены в баллах (formatPoints), никаких «₸KZ».
 * BUG-063: цена не переносится на вторую строку, сетка карточек — items-stretch.
 * BUG-072: перед покупкой — диалог подтверждения с явной кнопкой «Отмена».
 * Покупка выполняется сервером (rpc purchase_store_item): он проверяет баланс,
 * фиксирует цену и списывает баллы одной транзакцией.
 */

/** Статусы заказа магазина: 'issued'/'cancelled' в общем словаре нет — подставляем ярлык. */
const ORDER_STATUS_FALLBACK = {
  pending: 'Ожидает выдачи',
  issued: 'Выдано',
  cancelled: 'Отменено',
};

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="h-56 animate-pulse rounded-xl bg-muted" />
      ))}
    </div>
  );
}

export default function CabinetStore() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { employeeId, isLoading: isLoadingAuth } = useCurrentEmployee();
  const [confirmItem, setConfirmItem] = useState(null);

  const balanceQuery = useQuery({
    queryKey: ['wallet-balance', employeeId],
    queryFn: () => api.rpc.walletBalance(employeeId),
    enabled: !!employeeId,
  });

  const itemsQuery = useQuery({
    queryKey: ['store-items-active'],
    queryFn: () => api.entities.StoreItem.filter({ active: true }),
  });

  const ordersQuery = useQuery({
    queryKey: ['store-orders-me', employeeId],
    queryFn: () => api.entities.StoreOrder.filter({ employee_id: employeeId }, '-created_date'),
    enabled: !!employeeId,
  });

  const balance = balanceQuery.data ?? 0;

  const items = useMemo(
    () => [...(itemsQuery.data || [])].sort((a, b) => (a.price || 0) - (b.price || 0)),
    [itemsQuery.data]
  );

  const buy = useMutation({
    // Сервер сам проверяет баланс и остаток — клиент не считает деньги (BUG-026/038).
    mutationFn: (item) => api.rpc.purchaseStoreItem(item.id),
    onSuccess: (_result, item) => {
      setConfirmItem(null);
      toast({
        title: `Награда «${item.name}» заказана`,
        description: `Списано ${formatPoints(item.price)}. Выдачу подтвердит HR-отдел.`,
      });
      qc.invalidateQueries({ queryKey: ['wallet-balance'] });
      qc.invalidateQueries({ queryKey: ['wallet-tx'] });
      qc.invalidateQueries({ queryKey: ['wallet-totals'] });
      qc.invalidateQueries({ queryKey: ['store-items-active'] });
      qc.invalidateQueries({ queryKey: ['store-orders-me'] });
    },
    onError: (error) => {
      toast({
        title: 'Не удалось купить награду',
        description: error?.message || 'Попробуйте ещё раз или обратитесь в HR-отдел.',
        variant: 'destructive',
      });
    },
  });

  const confirmState = confirmItem ? rewardAvailability(confirmItem, balance) : null;

  if (!isLoadingAuth && !employeeId) {
    return (
      <PageContainer title="Магазин наград" description="Обменивайте накопленные баллы на награды">
        <EmptyState
          icon={Store}
          title="Магазин недоступен"
          description="Учётная запись не связана с карточкой сотрудника, поэтому баланс баллов недоступен. Обратитесь в HR-отдел."
        />
      </PageContainer>
    );
  }

  const error = itemsQuery.error || balanceQuery.error;
  const isLoading = isLoadingAuth || itemsQuery.isPending || balanceQuery.isPending;

  return (
    <PageContainer
      title="Магазин наград"
      description="Обменивайте накопленные баллы на награды"
      actions={
        <Card className="border-0 bg-brand-wallet px-4 py-3 text-white">
          <div className="text-xs text-white/80">Ваш баланс</div>
          <div className="whitespace-nowrap text-xl font-bold">{formatPoints(balance)}</div>
        </Card>
      }
    >
      {error ? (
        <ErrorState
          error={error}
          onRetry={() => {
            itemsQuery.refetch();
            balanceQuery.refetch();
          }}
        />
      ) : isLoading ? (
        <SkeletonGrid />
      ) : !items.length ? (
        <EmptyState
          icon={Store}
          title="Наград пока нет"
          description="HR-отдел ещё не добавил награды в магазин. Загляните позже — баллы никуда не денутся."
        />
      ) : (
        <div className="space-y-8">
          {/* BUG-063: items-stretch — карточки одинаковой высоты независимо от длины цены */}
          <ul role="list" className="grid grid-cols-1 items-stretch gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((item) => (
              <li key={item.id} role="listitem" className="h-full">
                <RewardCard
                  item={item}
                  balance={balance}
                  isPending={buy.isPending && buy.variables?.id === item.id}
                  onBuy={setConfirmItem}
                />
              </li>
            ))}
          </ul>

          {/* Аудит: подтверждение покупки, история заказов, статус выдачи */}
          <section aria-labelledby="store-orders">
            <h2 id="store-orders" className="mb-3 flex items-center gap-2 font-semibold text-foreground">
              <Package className="h-5 w-5 text-brand-wallet" aria-hidden="true" /> Мои заказы
            </h2>
            {ordersQuery.error ? (
              <ErrorState error={ordersQuery.error} onRetry={ordersQuery.refetch} compact />
            ) : ordersQuery.isPending ? (
              <div className="h-24 animate-pulse rounded-xl bg-muted" aria-hidden="true" />
            ) : !ordersQuery.data?.length ? (
              <EmptyState
                icon={ShoppingBag}
                compact
                title="Заказов пока нет"
                description="Купленные награды появятся здесь со статусом выдачи."
              />
            ) : (
              <ul role="list" className="space-y-2">
                {ordersQuery.data.map((order) => (
                  <li key={order.id} role="listitem">
                    <Card className="flex flex-wrap items-center gap-3 p-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent text-brand-wallet">
                        <ShoppingBag className="h-4 w-4" aria-hidden="true" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-foreground">{order.item_name}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <span>{formatDate(order.created_date)}</span>
                          {/* BUG-038: в истории показываем цену на момент покупки */}
                          <span className="whitespace-nowrap">{formatPoints(order.price_at_purchase)}</span>
                        </div>
                      </div>
                      <StatusBadge value={order.status} fallback={ORDER_STATUS_FALLBACK[order.status]} />
                    </Card>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Store className="h-4 w-4" aria-hidden="true" />
              Награды выдаёт HR-отдел в течение 3 рабочих дней после покупки.
            </p>
            <Button asChild variant="outline" className="min-h-[40px]">
              <Link to="/cabinet/wallet" aria-label="Перейти в кошелёк">
                <Wallet className="h-4 w-4" aria-hidden="true" />
                История баллов
              </Link>
            </Button>
          </Card>
        </div>
      )}

      {/* BUG-072: подтверждение покупки с обязательной кнопкой «Отмена» */}
      <Dialog open={!!confirmItem} onOpenChange={(open) => !open && setConfirmItem(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Подтвердите покупку</DialogTitle>
            <DialogDescription>
              {confirmItem
                ? `Награда «${confirmItem.name}» стоит ${formatPoints(confirmItem.price)}.`
                : ''}
            </DialogDescription>
          </DialogHeader>

          {confirmItem && (
            <dl className="space-y-2 rounded-xl border border-border p-4 text-sm">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">Баланс сейчас</dt>
                <dd className="whitespace-nowrap font-medium text-foreground">{formatPoints(balance)}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">Стоимость награды</dt>
                <dd className="whitespace-nowrap font-medium text-destructive">
                  −{formatPoints(confirmItem.price)}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3 border-t border-border pt-2">
                <dt className="text-muted-foreground">Останется после покупки</dt>
                <dd className="whitespace-nowrap font-semibold text-foreground">
                  {formatPoints(Math.max(balance - (confirmItem.price || 0), 0))}
                </dd>
              </div>
            </dl>
          )}

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              className="min-h-[40px]"
              onClick={() => setConfirmItem(null)}
              disabled={buy.isPending}
            >
              Отмена
            </Button>
            <Button
              type="button"
              className="min-h-[40px]"
              disabled={buy.isPending || !confirmState?.canBuy}
              onClick={() => confirmItem && buy.mutate(confirmItem)}
            >
              <ShoppingBag className="h-4 w-4" aria-hidden="true" />
              {buy.isPending ? 'Покупаем…' : 'Купить'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
