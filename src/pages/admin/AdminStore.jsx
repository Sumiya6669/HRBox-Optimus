import React, { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus, Trash2, Pencil, Store, Search, PackageCheck, ShoppingBag, AlertTriangle,
} from 'lucide-react';
import { api } from '@/api/client';
import PageContainer from '@/components/common/PageContainer';
import EmptyState from '@/components/common/EmptyState';
import ErrorState from '@/components/common/ErrorState';
import StatusBadge from '@/components/common/StatusBadge';
import FilterChips from '@/components/common/FilterChips';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { formatDate, formatNumber, formatPoints, pluralize } from '@/lib/format';
import { mutationErrorMessage } from '@/lib/dataErrors';

/**
 * Магазин наград: каталог и заказы.
 *
 * BUG-055: «₸KZ» — несуществующее обозначение. Внутренняя валюта портала — баллы,
 *   поэтому все суммы выводятся formatPoints().
 * BUG-063: длинная цена переносилась на вторую строку и ломала высоту карточек —
 *   цена в whitespace-nowrap, сетка карточек — items-stretch.
 * BUG-038: в истории покупок цена расходилась с каталогом. На вкладке «Заказы»
 *   показываем price_at_purchase — цену, зафиксированную в момент покупки.
 * BUG-072: удаление с подтверждением, в модалках есть «Отмена».
 * BUG-036: таблица заказов — в .table-scroll с закреплённой колонкой действий.
 * Остаток: -1 означает «без ограничения» — в интерфейсе так и подписано, а не «-1».
 */

const ORDER_FILTERS = [
  { value: 'all', label: 'Все' },
  { value: 'pending', label: 'Ожидают выдачи' },
  { value: 'issued', label: 'Выданы' },
  { value: 'cancelled', label: 'Отменены' },
];

const emptyForm = () => ({
  name: '',
  description: '',
  price: 0,
  icon: '🎁',
  category: '',
  unlimited: true,
  stock: 0,
  active: true,
});

function validate(form) {
  const errors = {};
  if (!form.name.trim()) errors.name = 'Укажите название награды';
  const price = Number(form.price);
  if (!Number.isInteger(price) || price < 0) errors.price = 'Цена — целое число баллов, не меньше нуля';
  if (!form.unlimited) {
    const stock = Number(form.stock);
    if (!Number.isInteger(stock) || stock < 0) errors.stock = 'Остаток — целое число от нуля';
  }
  return errors;
}

/** Понятная подпись остатка вместо технической «-1». */
function stockLabel(stock) {
  const value = Number(stock);
  if (!Number.isFinite(value) || value < 0) return 'Без ограничения';
  if (value === 0) return 'Нет в наличии';
  return `Осталось ${formatNumber(value)}`;
}

function CardsSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4" aria-hidden="true">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <Card key={i} className="p-5 space-y-3 animate-pulse">
          <div className="h-10 w-10 rounded-lg bg-muted" />
          <div className="h-4 w-2/3 rounded bg-muted" />
          <div className="h-3 w-1/2 rounded bg-muted/60" />
        </Card>
      ))}
    </div>
  );
}

export default function AdminStore() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [tab, setTab] = useState('catalog');
  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');
  const [orderStatus, setOrderStatus] = useState('all');

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [touched, setTouched] = useState({});
  const [pendingDelete, setPendingDelete] = useState(null);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchDraft.trim().toLowerCase()), 300);
    return () => clearTimeout(timer);
  }, [searchDraft]);

  /* --------------------------------------------------------------- данные */

  const { data: items, isLoading, error, refetch } = useQuery({
    queryKey: ['admin-store-items'],
    queryFn: () => api.entities.StoreItem.list('name', 500),
  });

  const {
    data: orders,
    isLoading: ordersLoading,
    error: ordersError,
    refetch: refetchOrders,
  } = useQuery({
    queryKey: ['admin-store-orders'],
    queryFn: () => api.entities.StoreOrder.list('-created_date', 500),
  });

  const filteredItems = useMemo(() => {
    if (!search) return items || [];
    return (items || []).filter((i) =>
      `${i.name} ${i.category || ''}`.toLowerCase().includes(search)
    );
  }, [items, search]);

  const orderCounts = useMemo(() => {
    const map = { all: (orders || []).length };
    ['pending', 'issued', 'cancelled'].forEach((s) => {
      map[s] = (orders || []).filter((o) => o.status === s).length;
    });
    return map;
  }, [orders]);

  const visibleOrders = useMemo(() => {
    if (orderStatus === 'all') return orders || [];
    return (orders || []).filter((o) => o.status === orderStatus);
  }, [orders, orderStatus]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['admin-store-items'] });
    qc.invalidateQueries({ queryKey: ['admin-store-orders'] });
    qc.invalidateQueries({ queryKey: ['store-items'] });
    qc.invalidateQueries({ queryKey: ['store-orders'] });
  };

  /* -------------------------------------------------------------- мутации */

  const save = useMutation({
    mutationFn: (payload) => {
      const data = {
        name: payload.name.trim(),
        description: payload.description.trim() || null,
        price: Number(payload.price),
        icon: payload.icon.trim() || null,
        category: payload.category.trim() || null,
        // -1 в БД означает «не ограничено» (см. store_items.stock)
        stock: payload.unlimited ? -1 : Number(payload.stock),
        active: payload.active,
      };
      if (editing) return api.entities.StoreItem.update(editing.id, data);
      return api.entities.StoreItem.create(data);
    },
    onSuccess: () => {
      toast({ title: editing ? 'Награда обновлена' : 'Награда добавлена' });
      closeForm();
      invalidate();
    },
    onError: (err) => toast({
      title: 'Не удалось сохранить награду',
      description: mutationErrorMessage(err, { 23505: 'Награда с таким названием уже есть в каталоге' }),
      variant: 'destructive',
    }),
  });

  const remove = useMutation({
    mutationFn: (item) => api.entities.StoreItem.delete(item.id),
    onSuccess: () => {
      setPendingDelete(null);
      toast({ title: 'Награда удалена' });
      invalidate();
    },
    onError: (err) => toast({
      title: 'Не удалось удалить награду',
      description: mutationErrorMessage(err, {
        23503: 'По награде есть заказы — снимите её с публикации вместо удаления',
      }),
      variant: 'destructive',
    }),
  });

  const issueOrder = useMutation({
    mutationFn: (order) => api.entities.StoreOrder.update(order.id, { status: 'issued' }),
    onSuccess: () => {
      toast({ title: 'Заказ отмечен как выданный' });
      invalidate();
    },
    onError: (err) => toast({
      title: 'Не удалось обновить заказ',
      description: mutationErrorMessage(err),
      variant: 'destructive',
    }),
  });

  /* ---------------------------------------------------------------- форма */

  const errors = validate(form);
  const isValid = Object.keys(errors).length === 0;
  const showError = (field) => (touched[field] ? errors[field] : undefined);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm());
    setTouched({});
    setFormOpen(true);
  };

  const openEdit = (item) => {
    const unlimited = Number(item.stock) < 0;
    setEditing(item);
    setForm({
      name: item.name || '',
      description: item.description || '',
      price: item.price ?? 0,
      icon: item.icon || '🎁',
      category: item.category || '',
      unlimited,
      stock: unlimited ? 0 : (item.stock ?? 0),
      active: item.active ?? true,
    });
    setTouched({});
    setFormOpen(true);
  };

  const closeForm = () => {
    setFormOpen(false);
    setEditing(null);
    setForm(emptyForm());
    setTouched({});
  };

  const submit = () => {
    setTouched({ name: true, price: true, stock: true });
    if (!isValid) return;
    save.mutate(form);
  };

  return (
    <PageContainer
      title="Магазин наград"
      description="Каталог наград за баллы и заказы сотрудников. Внутренняя валюта портала — баллы."
      width="wide"
      actions={
        tab === 'catalog' ? (
          <Button onClick={openCreate} className="min-h-[40px]">
            <Plus className="w-4 h-4" aria-hidden="true" />
            Добавить награду
          </Button>
        ) : null
      }
    >
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="catalog" className="min-h-[40px]">
            Каталог ({formatNumber((items || []).length)})
          </TabsTrigger>
          <TabsTrigger value="orders" className="min-h-[40px]">
            Заказы ({formatNumber((orders || []).length)})
          </TabsTrigger>
        </TabsList>

        {/* ------------------------------------------------------ каталог */}
        <TabsContent value="catalog">
          <div className="relative w-full lg:max-w-sm mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
            <label htmlFor="admin-store-search" className="sr-only">Поиск по названию награды</label>
            <Input
              id="admin-store-search"
              type="search"
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
              placeholder="Поиск по названию или категории"
              className="pl-9 min-h-[40px]"
            />
          </div>

          {error ? (
            <ErrorState error={error} onRetry={refetch} />
          ) : isLoading ? (
            <CardsSkeleton />
          ) : filteredItems.length === 0 ? (
            <EmptyState
              icon={Store}
              title={search ? 'Награды не найдены' : 'Каталог пуст'}
              description={
                search
                  ? 'Измените поисковый запрос.'
                  : 'Добавьте первую награду — сотрудники смогут обменять на неё накопленные баллы.'
              }
              actionLabel={search ? 'Сбросить поиск' : 'Добавить награду'}
              onAction={search ? () => setSearchDraft('') : openCreate}
            />
          ) : (
            /* BUG-063: items-stretch — карточки одной высоты, цена не переносится */
            <ul role="list" className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 items-stretch">
              {filteredItems.map((item) => (
                <li key={item.id} className="h-full">
                  <Card className="flex h-full flex-col p-5">
                    <div className="flex items-start justify-between gap-2">
                      <div
                        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-accent text-2xl"
                        aria-hidden="true"
                      >
                        {item.icon || <ShoppingBag className="h-6 w-6 text-accent-foreground" />}
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => openEdit(item)}
                          aria-label={`Редактировать награду «${item.name}»`}
                        >
                          <Pencil className="w-4 h-4" aria-hidden="true" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="text-muted-foreground hover:text-destructive"
                          onClick={() => setPendingDelete(item)}
                          aria-label={`Удалить награду «${item.name}»`}
                        >
                          <Trash2 className="w-4 h-4" aria-hidden="true" />
                        </Button>
                      </div>
                    </div>

                    <h3 className="mt-3 text-base font-semibold text-foreground line-clamp-2">{item.name}</h3>
                    {item.description && (
                      <p className="mt-1 text-sm text-muted-foreground line-clamp-2">{item.description}</p>
                    )}

                    <div className="mt-3 flex-1" />

                    <div className="flex flex-wrap items-end justify-between gap-2">
                      {/* BUG-055: цена в баллах, BUG-063: без переноса строки */}
                      <div className="whitespace-nowrap text-lg font-bold text-brand-wallet">
                        {formatPoints(item.price || 0)}
                      </div>
                      <div className="flex flex-wrap items-center justify-end gap-1.5">
                        {item.category && (
                          <Badge variant="secondary" className="whitespace-nowrap">{item.category}</Badge>
                        )}
                        <Badge
                          variant={item.active ? 'success' : 'secondary'}
                          className="whitespace-nowrap"
                        >
                          {item.active ? 'В продаже' : 'Скрыта'}
                        </Badge>
                      </div>
                    </div>
                    <p className="mt-2 whitespace-nowrap text-xs text-muted-foreground">
                      Остаток: {stockLabel(item.stock)}
                    </p>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        {/* ------------------------------------------------------- заказы */}
        <TabsContent value="orders">
          <div className="mb-4">
            <FilterChips
              ariaLabel="Фильтр заказов по статусу"
              value={orderStatus}
              onChange={setOrderStatus}
              options={ORDER_FILTERS.map((f) => ({ ...f, count: orderCounts[f.value] }))}
            />
          </div>

          <Card className="overflow-hidden">
            {ordersError ? (
              <div className="p-4"><ErrorState error={ordersError} onRetry={refetchOrders} /></div>
            ) : ordersLoading ? (
              <div className="p-4 space-y-2" aria-hidden="true">
                {[0, 1, 2, 3].map((i) => <div key={i} className="h-12 rounded bg-muted animate-pulse" />)}
              </div>
            ) : visibleOrders.length === 0 ? (
              <div className="p-4">
                <EmptyState
                  icon={PackageCheck}
                  title={orderStatus === 'all' ? 'Заказов пока нет' : 'В этом статусе заказов нет'}
                  description={
                    orderStatus === 'all'
                      ? 'Заказы появляются, когда сотрудник обменивает баллы на награду.'
                      : 'Снимите фильтр, чтобы увидеть остальные заказы.'
                  }
                  actionLabel={orderStatus === 'all' ? undefined : 'Показать все'}
                  onAction={orderStatus === 'all' ? undefined : () => setOrderStatus('all')}
                />
              </div>
            ) : (
              <div className="table-scroll">
                <table className="w-full text-sm">
                  <caption className="sr-only">Заказы магазина наград</caption>
                  <thead>
                    <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th scope="col" className="px-4 py-3 font-medium">Награда</th>
                      <th scope="col" className="px-4 py-3 font-medium">Сотрудник</th>
                      <th scope="col" className="px-4 py-3 font-medium">Цена на момент покупки</th>
                      <th scope="col" className="px-4 py-3 font-medium">Дата заказа</th>
                      <th scope="col" className="px-4 py-3 font-medium">Статус</th>
                      <th scope="col" className="px-4 py-3 font-medium table-sticky-actions text-right">Действия</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleOrders.map((order) => (
                      <tr key={order.id} className="border-b border-border last:border-0 hover:bg-accent/40">
                        <td className="px-4 py-3">
                          <span className="font-medium text-foreground line-clamp-2">{order.item_name}</span>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {order.employee_name || 'Сотрудник портала'}
                        </td>
                        {/* BUG-038: цена зафиксирована в момент покупки и не меняется вслед за каталогом */}
                        <td className="px-4 py-3 whitespace-nowrap font-medium text-foreground">
                          {formatPoints(order.price_at_purchase || 0)}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                          {formatDate(order.created_date)}
                        </td>
                        <td className="px-4 py-3"><StatusBadge value={order.status} /></td>
                        <td className="px-4 py-3 table-sticky-actions">
                          <div className="flex items-center justify-end gap-1">
                            {order.status === 'pending' ? (
                              <Button
                                size="sm"
                                variant="outline"
                                className="min-h-[40px]"
                                disabled={issueOrder.isPending}
                                onClick={() => issueOrder.mutate(order)}
                                aria-label={`Отметить заказ «${order.item_name}» как выданный`}
                              >
                                <PackageCheck className="w-4 h-4" aria-hidden="true" />
                                Выдано
                              </Button>
                            ) : (
                              <span className="text-xs text-muted-foreground">Действий нет</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {!ordersError && !ordersLoading && visibleOrders.length > 0 && (
            <p className="mt-3 text-sm text-muted-foreground" aria-live="polite">
              Показано {pluralize(visibleOrders.length, 'заказ', 'заказа', 'заказов')}
            </p>
          )}
        </TabsContent>
      </Tabs>

      {/* ------------------------------------------------- форма награды */}
      <Dialog open={formOpen} onOpenChange={(open) => (open ? setFormOpen(true) : closeForm())}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{editing ? 'Редактирование награды' : 'Новая награда'}</DialogTitle>
            <DialogDescription>
              Цена указывается во внутренних баллах портала — это не тенге.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="sm:col-span-2">
                <Label htmlFor="store-name">Название *</Label>
                <Input
                  id="store-name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  onBlur={() => setTouched((t) => ({ ...t, name: true }))}
                  aria-invalid={!!showError('name')}
                  className="min-h-[40px]"
                />
                {showError('name') && (
                  <p role="alert" className="mt-1 text-xs text-destructive">{showError('name')}</p>
                )}
              </div>
              <div>
                <Label htmlFor="store-icon">Значок</Label>
                <Input
                  id="store-icon"
                  value={form.icon}
                  onChange={(e) => setForm({ ...form, icon: e.target.value })}
                  placeholder="🎁"
                  className="min-h-[40px]"
                />
              </div>
            </div>

            <div>
              <Label htmlFor="store-description">Описание</Label>
              <Textarea
                id="store-description"
                rows={2}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="store-price">Цена в баллах *</Label>
                <Input
                  id="store-price"
                  type="number"
                  min="0"
                  value={form.price}
                  onChange={(e) => setForm({ ...form, price: e.target.value === '' ? '' : Number(e.target.value) })}
                  onBlur={() => setTouched((t) => ({ ...t, price: true }))}
                  aria-invalid={!!showError('price')}
                  aria-describedby="store-price-hint"
                  className="min-h-[40px]"
                />
                <p id="store-price-hint" className="mt-1 whitespace-nowrap text-xs text-muted-foreground">
                  Сотрудник заплатит {formatPoints(Number(form.price) || 0)}
                </p>
                {showError('price') && (
                  <p role="alert" className="mt-1 text-xs text-destructive">{showError('price')}</p>
                )}
              </div>
              <div>
                <Label htmlFor="store-category">Категория</Label>
                <Input
                  id="store-category"
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  placeholder="Мерч, Сертификаты, Отгулы"
                  className="min-h-[40px]"
                />
              </div>
            </div>

            {/* Управление остатком: вместо технической «-1» — понятный переключатель */}
            <div className="rounded-lg border border-border p-3 space-y-2">
              <div className="flex items-center gap-2 min-h-[40px]">
                <Checkbox
                  id="store-unlimited"
                  checked={form.unlimited}
                  onCheckedChange={(v) => setForm({ ...form, unlimited: !!v })}
                />
                <Label htmlFor="store-unlimited" className="font-normal">Количество не ограничено</Label>
              </div>
              {!form.unlimited && (
                <div>
                  <Label htmlFor="store-stock">Остаток, шт.</Label>
                  <Input
                    id="store-stock"
                    type="number"
                    min="0"
                    value={form.stock}
                    onChange={(e) => setForm({ ...form, stock: e.target.value === '' ? '' : Number(e.target.value) })}
                    onBlur={() => setTouched((t) => ({ ...t, stock: true }))}
                    aria-invalid={!!showError('stock')}
                    aria-describedby="store-stock-hint"
                    className="min-h-[40px]"
                  />
                  <p id="store-stock-hint" className="mt-1 text-xs text-muted-foreground">
                    При каждой покупке остаток уменьшается на единицу. Ноль — награду купить нельзя.
                  </p>
                  {showError('stock') && (
                    <p role="alert" className="mt-1 text-xs text-destructive">{showError('stock')}</p>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 min-h-[40px]">
              <Checkbox
                id="store-active"
                checked={form.active}
                onCheckedChange={(v) => setForm({ ...form, active: !!v })}
              />
              <Label htmlFor="store-active" className="font-normal">Показывать награду в магазине</Label>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" className="min-h-[40px]" onClick={closeForm}>Отмена</Button>
            <Button className="min-h-[40px]" onClick={submit} disabled={!isValid || save.isPending}>
              {save.isPending ? 'Сохранение…' : editing ? 'Сохранить' : 'Создать'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* --------------------------------- подтверждение удаления награды */}
      <Dialog open={!!pendingDelete} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Удалить награду?</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2">
                <p>
                  Награда «{pendingDelete?.name}» ({formatPoints(pendingDelete?.price || 0)}) исчезнет
                  из магазина. Действие нельзя отменить.
                </p>
                <p className="flex items-start gap-2 text-xs">
                  <AlertTriangle className="w-4 h-4 shrink-0 text-warning" aria-hidden="true" />
                  Если по награде уже были заказы, удаление не пройдёт — снимите её с публикации,
                  чтобы сохранить историю покупок.
                </p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" className="min-h-[40px]" onClick={() => setPendingDelete(null)}>Отмена</Button>
            <Button
              variant="destructive"
              className="min-h-[40px]"
              disabled={remove.isPending}
              onClick={() => remove.mutate(pendingDelete)}
            >
              {remove.isPending ? 'Удаление…' : 'Удалить награду'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
