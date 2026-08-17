import React, { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { api } from '@/api/client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Plus, Trash2, Pencil, Award, Search } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import PageContainer from '@/components/common/PageContainer';
import EmptyState from '@/components/common/EmptyState';
import ErrorState from '@/components/common/ErrorState';
import StatusBadge from '@/components/common/StatusBadge';
import FilterChips from '@/components/common/FilterChips';
import Pagination from '@/components/common/Pagination';
import { formatNumber, formatPoints, formatSigned } from '@/lib/format';
import { mutationErrorMessage } from '@/lib/dataErrors';
import { REASON_CATEGORY_LABELS, DEFAULT_REASONS } from '@/lib/walletUtils';

/**
 * Справочник причин начисления баллов.
 *
 * BUG-069: технические коды (mentoring, contest, tenure) выводились моноширинным
 *          шрифтом первой колонкой. Теперь первой идёт человекочитаемое название,
 *          а коды прячутся под переключатель «Показать технические поля».
 * Аудит: 30 записей без пагинации и поиска — добавлены .page() по 20 и поиск,
 *        а также полный CRUD (default_points и описание раньше не редактировались).
 * `code` — логический ключ, на который ссылаются wallet_transactions.reason_code,
 * поэтому при редактировании он неизменяем.
 */

const PAGE_SIZE = 20;
const CATEGORIES = Object.keys(REASON_CATEGORY_LABELS);

const emptyForm = () => ({
  code: '',
  title: '',
  category: 'work',
  description: '',
  default_points: '',
  active: true,
});

function SkeletonBlock() {
  return (
    <div className="space-y-3" aria-hidden="true">
      {[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-14 animate-pulse rounded-xl bg-muted" />)}
    </div>
  );
}

export default function AdminAwardReasons() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [showTechnical, setShowTechnical] = useState(false); // BUG-069
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState(null);
  const [deleteItem, setDeleteItem] = useState(null);

  useEffect(() => { setPage(1); }, [search, categoryFilter]);

  const where = useMemo(() => {
    const w = {};
    if (categoryFilter !== 'all') w.category = categoryFilter;
    const q = search.trim();
    // Поиск по названию и описанию; технический код тоже ищется, но не показывается.
    if (q) w.$or = `title.ilike.*${q}*,description.ilike.*${q}*,code.ilike.*${q}*`;
    return w;
  }, [search, categoryFilter]);

  const listQuery = useQuery({
    queryKey: ['award-reasons-page', where, page],
    queryFn: () => api.entities.AwardReason.page({ where, sort: 'title', page, pageSize: PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });

  const rows = listQuery.data?.rows || [];
  const total = listQuery.data?.total || 0;

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['award-reasons-page'] });
    qc.invalidateQueries({ queryKey: ['award-reasons'] });
  };

  const save = useMutation({
    mutationFn: (payload) =>
      editItem
        ? api.entities.AwardReason.update(editItem.id, payload)
        : api.entities.AwardReason.create(payload),
    onSuccess: () => {
      toast({ title: editItem ? 'Причина обновлена' : 'Причина добавлена' });
      invalidate();
      setOpen(false);
      setEditItem(null);
      setForm(emptyForm());
      setFormError(null);
    },
    onError: (e) => toast({
      title: 'Не удалось сохранить причину',
      description: mutationErrorMessage(e, {
        23505: 'Причина с таким кодом уже есть в справочнике — выберите другой код.',
        42501: 'Изменять справочник причин могут только HR-специалист и администратор.',
      }),
      variant: 'destructive',
    }),
  });

  const remove = useMutation({
    mutationFn: (id) => api.entities.AwardReason.delete(id),
    onSuccess: () => {
      toast({ title: 'Причина удалена' });
      invalidate();
      setDeleteItem(null);
    },
    onError: (e) => {
      // 23503: на код причины ссылаются транзакции — удалять нельзя, только деактивировать.
      toast({
        title: 'Не удалось удалить причину',
        description: mutationErrorMessage(e, {
          23503: 'На эту причину уже ссылаются операции по баллам. Удалить её нельзя — снимите флаг «активна».',
          42501: 'Изменять справочник причин могут только HR-специалист и администратор.',
        }),
        variant: 'destructive',
      });
      setDeleteItem(null);
    },
  });

  const seed = useMutation({
    mutationFn: () => api.entities.AwardReason.bulkCreate(DEFAULT_REASONS),
    onSuccess: () => { toast({ title: 'Справочник заполнен стандартными причинами' }); invalidate(); },
    onError: (e) => toast({ title: 'Не удалось заполнить справочник', description: mutationErrorMessage(e), variant: 'destructive' }),
  });

  const openCreate = () => { setEditItem(null); setForm(emptyForm()); setFormError(null); setOpen(true); };

  const openEdit = (r) => {
    setEditItem(r);
    setForm({
      code: r.code,
      title: r.title || '',
      category: r.category || 'other',
      description: r.description || '',
      default_points: r.default_points ?? '',
      active: r.active ?? true,
    });
    setFormError(null);
    setOpen(true);
  };

  const validate = () => {
    if (!editItem && !/^[a-z0-9_]+$/.test(form.code.trim())) {
      return 'Код обязателен: латиница в нижнем регистре, цифры и подчёркивание';
    }
    if (!form.title.trim()) return 'Укажите название причины';
    if (form.default_points !== '' && !Number.isFinite(Number(form.default_points))) {
      return 'Номинал по умолчанию должен быть числом';
    }
    return null;
  };

  const handleSave = () => {
    const problem = validate();
    setFormError(problem);
    if (problem) return;
    const payload = {
      title: form.title.trim(),
      category: form.category,
      description: form.description.trim() || null,
      default_points: form.default_points === '' ? null : Number(form.default_points),
      active: form.active,
    };
    // code — логический ключ, при редактировании не передаём вовсе.
    if (!editItem) payload.code = form.code.trim();
    save.mutate(payload);
  };

  const selectCls =
    'min-h-[40px] w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus:border-primary/40';

  const actions = (
    <Button onClick={openCreate}>
      <Plus className="mr-1 h-4 w-4" aria-hidden="true" /> Добавить причину
    </Button>
  );

  const hasFilters = !!search.trim() || categoryFilter !== 'all';

  return (
    <PageContainer
      title="Справочник причин начисления"
      description="Стандартные основания для начисления баллов — используются в кошельке и аналитике"
      actions={actions}
    >
      <div className="space-y-4">
        {/* Поиск, фильтр категорий и переключатель технических полей */}
        <Card className="space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-56 flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Поиск по названию или описанию"
                aria-label="Поиск причин начисления"
                className="min-h-[40px] pl-9"
              />
            </div>
            {/* BUG-069: технические коды по умолчанию скрыты */}
            <label className="flex min-h-[40px] cursor-pointer items-center gap-2 text-sm text-muted-foreground">
              <Switch checked={showTechnical} onCheckedChange={setShowTechnical} aria-label="Показать технические поля" />
              Показать технические поля
            </label>
          </div>
          <FilterChips
            ariaLabel="Категории причин"
            value={categoryFilter}
            onChange={setCategoryFilter}
            options={[
              { value: 'all', label: 'Все категории' },
              ...CATEGORIES.map((c) => ({ value: c, label: REASON_CATEGORY_LABELS[c] })),
            ]}
          />
        </Card>

        {listQuery.error ? (
          <ErrorState error={listQuery.error} onRetry={listQuery.refetch} />
        ) : listQuery.isPending ? (
          <SkeletonBlock />
        ) : !rows.length ? (
          hasFilters ? (
            <EmptyState
              icon={Award}
              title="Ничего не найдено"
              description="Под текущий поиск и фильтр категорий не подошла ни одна причина."
              actionLabel="Сбросить фильтры"
              onAction={() => { setSearch(''); setCategoryFilter('all'); }}
            />
          ) : (
            <EmptyState
              icon={Award}
              title="Справочник пуст"
              description="Без причин начисления аналитика по баллам не собирается. Заполните справочник стандартным набором или добавьте свою причину."
              actionLabel="Заполнить стандартными причинами"
              onAction={() => seed.mutate()}
            />
          )
        ) : (
          <Card className="overflow-hidden">
            <div className="table-scroll">
              <table className="w-full text-sm">
                <caption className="sr-only">Справочник причин начисления баллов</caption>
                <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                  <tr>
                    {/* BUG-069: первая колонка — человекочитаемое название */}
                    <th scope="col" className="px-4 py-2.5 text-left font-medium">Название</th>
                    <th scope="col" className="px-4 py-2.5 text-left font-medium">Категория</th>
                    <th scope="col" className="px-4 py-2.5 text-right font-medium">Номинал</th>
                    <th scope="col" className="hidden px-4 py-2.5 text-left font-medium xl:table-cell">Описание</th>
                    {showTechnical && (
                      <th scope="col" className="px-4 py-2.5 text-left font-medium">Код (техн.)</th>
                    )}
                    <th scope="col" className="px-4 py-2.5 text-center font-medium">Статус</th>
                    <th scope="col" className="table-sticky-actions px-4 py-2.5 text-center font-medium">Действия</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((r) => (
                    <tr key={r.id} className="hover:bg-muted/40">
                      <td className="px-4 py-2.5 font-medium text-foreground">
                        {r.title}
                        <span className="block text-xs font-normal text-muted-foreground xl:hidden">
                          {r.description || '—'}
                        </span>
                      </td>
                      <td className="px-4 py-2.5"><StatusBadge value={r.category} fallback={REASON_CATEGORY_LABELS[r.category]} /></td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right text-muted-foreground">
                        {r.default_points == null
                          ? '—'
                          : formatSigned(r.default_points, (n) => formatPoints(n, { short: true }))}
                      </td>
                      <td className="hidden max-w-xs truncate px-4 py-2.5 text-xs text-muted-foreground xl:table-cell">
                        {r.description || '—'}
                      </td>
                      {showTechnical && (
                        <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{r.code}</td>
                      )}
                      <td className="px-4 py-2.5 text-center">
                        <StatusBadge value={r.active ? 'active' : 'inactive'} />
                      </td>
                      <td className="table-sticky-actions px-4 py-2.5 text-center">
                        <div className="flex justify-center gap-1">
                          <Button size="icon" variant="ghost" aria-label={`Редактировать причину «${r.title}»`} onClick={() => openEdit(r)}>
                            <Pencil className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                          </Button>
                          <Button size="icon" variant="ghost" aria-label={`Удалить причину «${r.title}»`} onClick={() => setDeleteItem(r)}>
                            <Trash2 className="h-4 w-4 text-destructive" aria-hidden="true" />
                          </Button>
                        </div>
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
                isFetching={listQuery.isFetching}
                itemLabels={['причина', 'причины', 'причин']}
              />
            </div>
          </Card>
        )}

        {!listQuery.error && !listQuery.isPending && rows.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Всего в справочнике: {formatNumber(total)}
          </p>
        )}
      </div>

      {/* Создание / редактирование */}
      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setEditItem(null); setFormError(null); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editItem ? 'Редактирование причины' : 'Новая причина начисления'}</DialogTitle>
            <DialogDescription>
              {editItem
                ? 'Код причины изменить нельзя: на него ссылаются уже созданные операции по баллам.'
                : 'Код — логический ключ причины, он попадёт в операции по баллам и в аналитику.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="reason-title">Название</Label>
                <Input
                  id="reason-title"
                  value={form.title}
                  placeholder="Наставничество"
                  aria-invalid={formError === 'Укажите название причины'}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="reason-code">Код (техническое поле)</Label>
                <Input
                  id="reason-code"
                  value={form.code}
                  placeholder="mentoring"
                  disabled={!!editItem}
                  className="font-mono"
                  onChange={(e) => setForm({ ...form, code: e.target.value })}
                />
                {editItem && <p className="mt-1 text-xs text-muted-foreground">Неизменяем после создания</p>}
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="reason-category">Категория</Label>
                <select
                  id="reason-category"
                  className={selectCls}
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                >
                  {CATEGORIES.map((c) => <option key={c} value={c}>{REASON_CATEGORY_LABELS[c]}</option>)}
                </select>
              </div>
              <div>
                <Label htmlFor="reason-points">Номинал по умолчанию, баллы</Label>
                <Input
                  id="reason-points"
                  type="number"
                  value={form.default_points}
                  placeholder="Не задан"
                  onChange={(e) => setForm({ ...form, default_points: e.target.value })}
                />
              </div>
            </div>
            <div>
              <Label htmlFor="reason-desc">Описание</Label>
              <Textarea
                id="reason-desc"
                rows={2}
                value={form.description}
                placeholder="Когда и за что начисляется"
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </div>
            <label className="flex min-h-[40px] cursor-pointer items-center gap-2 text-sm">
              <Switch checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v })} aria-label="Причина активна" />
              Причина активна и доступна для выбора
            </label>
            {formError && <p role="alert" className="text-sm text-destructive">{formError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Отмена</Button>
            <Button onClick={handleSave} disabled={save.isPending || !!validate()}>
              {editItem ? 'Сохранить' : 'Создать'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Подтверждение удаления */}
      <Dialog open={!!deleteItem} onOpenChange={(v) => !v && setDeleteItem(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Удалить причину?</DialogTitle>
            <DialogDescription>
              «{deleteItem?.title}» будет удалена из справочника. Если на неё уже ссылаются операции
              по баллам, база данных откажет в удалении — в этом случае просто снимите флаг «активна».
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteItem(null)}>Отмена</Button>
            <Button variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate(deleteItem.id)}>
              Удалить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
