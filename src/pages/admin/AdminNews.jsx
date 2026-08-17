import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Newspaper, Plus, Pin, PinOff, Eye, Heart, MessageSquare, Search, Pencil, Trash2,
  ExternalLink, Send, ChevronLeft, ChevronRight, CalendarClock,
} from 'lucide-react';
import { api } from '@/api/client';
import { createEntity } from '@/api/entity';
import PageContainer from '@/components/common/PageContainer';
import EmptyState from '@/components/common/EmptyState';
import ErrorState from '@/components/common/ErrorState';
import StatusBadge from '@/components/common/StatusBadge';
import FilterChips from '@/components/common/FilterChips';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/lib/AuthContext';
import { formatDate, formatNumber, daysBetween, pluralize } from '@/lib/format';
import { mutationErrorMessage } from '@/lib/dataErrors';
import { cn } from '@/lib/utils';

/**
 * Администрирование новостей.
 *
 * BUG-013: записи задваивались (12 карточек = 6 уникальных новостей ×2). В БД стоит
 *          уникальный индекс news_title_date_uniq на (lower(title), published_date);
 *          код 23505 переводим в понятную фразу, а не в текст Postgres.
 * BUG-051: статусы и категории выводятся StatusBadge, без английских кодов.
 * BUG-053: все даты — через formatDate.
 * BUG-072: в каждой модалке есть кнопка «Отмена», удаление — с подтверждением.
 * BUG-036: таблица в .table-scroll, колонка действий — .table-sticky-actions.
 * BUG-011: ошибка загрузки показывается ErrorState, а не пустым списком.
 *
 * Аудит просил: предпросмотр новости, планирование публикации и массовые операции.
 * Счётчики лайков и комментариев берём из вьюхи v_news (CONVENTIONS §1) —
 * в таблице news таких полей нет вовсе.
 */

/** v_news недоступна через api.entities (там базовая таблица) — заводим доступ к вьюхе. */
const newsView = createEntity('v_news', { defaultSort: '-published_date' });

const PAGE_SIZE = 20;

const STATUS_OPTIONS = ['draft', 'scheduled', 'published', 'archived'];
const CATEGORY_OPTIONS = ['company', 'product', 'event', 'announcement', 'training'];

const STATUS_LABELS = {
  draft: 'Черновик',
  scheduled: 'Запланировано',
  published: 'Опубликовано',
  archived: 'В архиве',
};

const CATEGORY_LABELS = {
  company: 'Компания',
  product: 'Продукты',
  event: 'События',
  announcement: 'Объявление',
  training: 'Обучение',
};

const emptyForm = () => ({
  title: '',
  body: '',
  excerpt: '',
  category: 'company',
  image_url: '',
  published_date: formatDate(new Date(), 'iso'),
  pinned: false,
  status: 'draft',
});

/** Валидация формы до отправки (BUG-025): сообщения привязаны к полям. */
function validate(form) {
  const errors = {};
  if (!form.title.trim()) errors.title = 'Укажите заголовок новости';
  else if (form.title.trim().length < 3) errors.title = 'Заголовок слишком короткий';
  if (!form.body.trim()) errors.body = 'Добавьте текст новости';
  if (!form.category) errors.category = 'Выберите категорию';
  if (!form.published_date) errors.published_date = 'Укажите дату публикации';
  // Планирование: дата отложенной публикации должна быть в будущем.
  if (form.status === 'scheduled' && form.published_date && daysBetween(new Date(), form.published_date) <= 0) {
    errors.published_date = 'Для отложенной публикации выберите будущую дату';
  }
  if (form.image_url && !/^https?:\/\//i.test(form.image_url)) {
    errors.image_url = 'Ссылка должна начинаться с http:// или https://';
  }
  return errors;
}

function TableSkeleton() {
  return (
    <div className="p-4 space-y-2" aria-hidden="true">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="h-14 rounded bg-muted animate-pulse" />
      ))}
    </div>
  );
}

export default function AdminNews() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { user } = useAuth();

  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [category, setCategory] = useState('all');
  const [page, setPage] = useState(1);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [touched, setTouched] = useState({});
  const [pendingDelete, setPendingDelete] = useState(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [selected, setSelected] = useState(() => new Set());

  // Поиск с задержкой — сервер не дёргается на каждый символ.
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchDraft.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(timer);
  }, [searchDraft]);

  const where = useMemo(() => {
    const w = {};
    if (search) w.title = { ilike: `%${search}%` };
    if (status !== 'all') w.status = status;
    if (category !== 'all') w.category = category;
    return w;
  }, [search, status, category]);

  /* --------------------------------------------------------------- данные */

  const { data: pageData, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['admin-news', search, status, category, page],
    // Серверная пагинация по 20 записей (BUG-013: раньше страница тянула весь список).
    queryFn: () => newsView.page({ where, sort: '-published_date', page, pageSize: PAGE_SIZE }),
    placeholderData: (prev) => prev,
  });

  const { data: counts } = useQuery({
    queryKey: ['admin-news-counts', search],
    queryFn: async () => {
      const base = search ? { title: { ilike: `%${search}%` } } : {};
      const [total, ...rest] = await Promise.all([
        newsView.count(base),
        ...STATUS_OPTIONS.map((s) => newsView.count({ ...base, status: s })),
        ...CATEGORY_OPTIONS.map((c) => newsView.count({ ...base, category: c })),
      ]);
      const map = { all: total };
      STATUS_OPTIONS.forEach((s, i) => { map[`status:${s}`] = rest[i]; });
      CATEGORY_OPTIONS.forEach((c, i) => { map[`category:${c}`] = rest[STATUS_OPTIONS.length + i]; });
      return map;
    },
  });

  const rows = pageData?.rows || [];
  const total = pageData?.total || 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['admin-news'] });
    qc.invalidateQueries({ queryKey: ['admin-news-counts'] });
    qc.invalidateQueries({ queryKey: ['news'] });
    qc.invalidateQueries({ queryKey: ['news-page'] });
  };

  /* -------------------------------------------------------------- мутации */

  // BUG-013: дубль по (заголовок, дата) отбивается базой — показываем это по-русски.
  const DUPLICATE_HINT = { 23505: 'Новость с таким заголовком и датой уже существует' };

  const save = useMutation({
    mutationFn: (payload) => {
      const data = {
        title: payload.title.trim(),
        body: payload.body.trim(),
        excerpt: payload.excerpt.trim() || null,
        category: payload.category,
        image_url: payload.image_url.trim() || null,
        published_date: payload.published_date,
        pinned: payload.pinned,
        status: payload.status,
      };
      if (editing) return api.entities.News.update(editing.id, data);
      return api.entities.News.create({
        ...data,
        author_id: user?.id || null,
        author_name: user?.full_name || 'HR-служба',
      });
    },
    onSuccess: () => {
      toast({ title: editing ? 'Новость обновлена' : 'Новость создана' });
      closeForm();
      invalidate();
    },
    onError: (err) => toast({
      title: 'Не удалось сохранить новость',
      description: mutationErrorMessage(err, DUPLICATE_HINT),
      variant: 'destructive',
    }),
  });

  const togglePin = useMutation({
    mutationFn: (item) => api.entities.News.update(item.id, { pinned: !item.pinned }),
    onSuccess: (_data, item) => {
      toast({ title: item.pinned ? 'Закрепление снято' : 'Новость закреплена' });
      invalidate();
    },
    onError: (err) => toast({
      title: 'Не удалось изменить закрепление',
      description: mutationErrorMessage(err),
      variant: 'destructive',
    }),
  });

  const remove = useMutation({
    mutationFn: (item) => api.entities.News.delete(item.id),
    onSuccess: () => {
      setPendingDelete(null);
      toast({ title: 'Новость удалена' });
      invalidate();
    },
    onError: (err) => toast({
      title: 'Не удалось удалить новость',
      description: mutationErrorMessage(err),
      variant: 'destructive',
    }),
  });

  /** Массовые операции (аудит): закрепление, публикация и удаление пачкой. */
  const bulk = useMutation({
    mutationFn: async ({ action, ids }) => {
      if (action === 'delete') {
        await Promise.all(ids.map((id) => api.entities.News.delete(id)));
        return ids.length;
      }
      const patch =
        action === 'pin' ? { pinned: true }
          : action === 'unpin' ? { pinned: false }
            : { status: 'published' };
      await Promise.all(ids.map((id) => api.entities.News.update(id, patch)));
      return ids.length;
    },
    onSuccess: (count, { action }) => {
      const titles = {
        pin: 'Закреплено',
        unpin: 'Снято закрепление',
        publish: 'Опубликовано',
        delete: 'Удалено',
      };
      toast({ title: `${titles[action]}: ${pluralize(count, 'новость', 'новости', 'новостей')}` });
      setSelected(new Set());
      setBulkDeleteOpen(false);
      invalidate();
    },
    onError: (err) => toast({
      title: 'Массовая операция не выполнена',
      description: mutationErrorMessage(err, DUPLICATE_HINT),
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
    setEditing(item);
    setForm({
      title: item.title || '',
      body: item.body || '',
      excerpt: item.excerpt || '',
      category: item.category || 'company',
      image_url: item.image_url || '',
      published_date: formatDate(item.published_date, 'iso'),
      pinned: !!item.pinned,
      status: item.status || 'draft',
    });
    setTouched({});
    setFormOpen(true);
  };

  const closeForm = () => {
    setFormOpen(false);
    setEditing(null);
    setTouched({});
    setForm(emptyForm());
  };

  const submit = () => {
    setTouched({ title: true, body: true, category: true, published_date: true, image_url: true });
    if (!isValid) return;
    save.mutate(form);
  };

  /* ------------------------------------------------------------ выделение */

  const pageIds = rows.map((r) => r.id);
  const allSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const selectedIds = [...selected];

  const toggleAll = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return next;
    });
  };

  const toggleOne = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const resetFilters = () => {
    setSearchDraft('');
    setStatus('all');
    setCategory('all');
    setPage(1);
  };

  const hasFilters = !!search || status !== 'all' || category !== 'all';

  return (
    <PageContainer
      title="Новости"
      description="Публикации портала: черновики, отложенная публикация, закрепление и массовые операции."
      width="wide"
      actions={
        <Button onClick={openCreate} className="min-h-[40px]">
          <Plus className="w-4 h-4" aria-hidden="true" />
          Создать новость
        </Button>
      }
    >
      {/* ------------------------------------------------------ фильтры */}
      <div className="space-y-3 mb-4">
        <div className="relative w-full lg:max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
          <label htmlFor="admin-news-search" className="sr-only">Поиск по заголовку новости</label>
          <Input
            id="admin-news-search"
            type="search"
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            placeholder="Поиск по заголовку"
            className="pl-9 min-h-[40px]"
          />
        </div>

        <FilterChips
          ariaLabel="Фильтр по статусу"
          value={status}
          onChange={(v) => { setStatus(v); setPage(1); }}
          options={[
            { value: 'all', label: 'Все статусы', count: counts?.all },
            ...STATUS_OPTIONS.map((s) => ({
              value: s,
              label: STATUS_LABELS[s],
              count: counts?.[`status:${s}`],
            })),
          ]}
        />

        <FilterChips
          ariaLabel="Фильтр по категории"
          value={category}
          onChange={(v) => { setCategory(v); setPage(1); }}
          options={[
            { value: 'all', label: 'Все категории', count: counts?.all },
            ...CATEGORY_OPTIONS.map((c) => ({
              value: c,
              label: CATEGORY_LABELS[c],
              count: counts?.[`category:${c}`],
            })),
          ]}
        />
      </div>

      {/* ------------------------------------- панель массовых операций */}
      {selectedIds.length > 0 && (
        <Card className="mb-4 flex flex-wrap items-center gap-2 p-3" role="region" aria-label="Массовые операции">
          <span className="text-sm font-medium text-foreground mr-2">
            Выбрано {pluralize(selectedIds.length, 'новость', 'новости', 'новостей')}
          </span>
          <Button
            size="sm"
            variant="outline"
            className="min-h-[40px]"
            disabled={bulk.isPending}
            onClick={() => bulk.mutate({ action: 'pin', ids: selectedIds })}
          >
            <Pin className="w-4 h-4" aria-hidden="true" />
            Закрепить
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="min-h-[40px]"
            disabled={bulk.isPending}
            onClick={() => bulk.mutate({ action: 'unpin', ids: selectedIds })}
          >
            <PinOff className="w-4 h-4" aria-hidden="true" />
            Снять закрепление
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="min-h-[40px]"
            disabled={bulk.isPending}
            onClick={() => bulk.mutate({ action: 'publish', ids: selectedIds })}
          >
            <Send className="w-4 h-4" aria-hidden="true" />
            Опубликовать
          </Button>
          <Button
            size="sm"
            variant="destructive"
            className="min-h-[40px]"
            disabled={bulk.isPending}
            onClick={() => setBulkDeleteOpen(true)}
          >
            <Trash2 className="w-4 h-4" aria-hidden="true" />
            Удалить
          </Button>
          <Button size="sm" variant="ghost" className="min-h-[40px]" onClick={() => setSelected(new Set())}>
            Снять выделение
          </Button>
        </Card>
      )}

      {/* ------------------------------------------------------- таблица */}
      <Card className={cn('overflow-hidden', isFetching && !isLoading && 'opacity-70 transition-opacity')}>
        {error ? (
          <div className="p-4"><ErrorState error={error} onRetry={refetch} /></div>
        ) : isLoading ? (
          <TableSkeleton />
        ) : rows.length === 0 ? (
          <div className="p-4">
            <EmptyState
              icon={Newspaper}
              title={hasFilters ? 'Новости не найдены' : 'Новостей пока нет'}
              description={
                hasFilters
                  ? 'Измените запрос или снимите фильтры по статусу и категории.'
                  : 'Создайте первую новость — она появится в ленте портала после публикации.'
              }
              actionLabel={hasFilters ? 'Сбросить фильтры' : 'Создать новость'}
              onAction={hasFilters ? resetFilters : openCreate}
            />
          </div>
        ) : (
          <div className="table-scroll">
            <table className="w-full text-sm">
              <caption className="sr-only">Новости портала</caption>
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th scope="col" className="px-4 py-3 w-10">
                    <Checkbox
                      checked={allSelected}
                      onCheckedChange={toggleAll}
                      aria-label="Выбрать все новости на странице"
                    />
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">Новость</th>
                  <th scope="col" className="px-4 py-3 font-medium">Категория</th>
                  <th scope="col" className="px-4 py-3 font-medium">Статус</th>
                  <th scope="col" className="px-4 py-3 font-medium">Дата публикации</th>
                  <th scope="col" className="px-4 py-3 font-medium">Отклик</th>
                  <th scope="col" className="px-4 py-3 font-medium table-sticky-actions text-right">Действия</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((item) => {
                  const scheduled = item.status === 'scheduled';
                  return (
                    <tr key={item.id} className="border-b border-border last:border-0 hover:bg-accent/40">
                      <td className="px-4 py-3 align-top">
                        <Checkbox
                          checked={selected.has(item.id)}
                          onCheckedChange={() => toggleOne(item.id)}
                          aria-label={`Выбрать новость «${item.title}»`}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-start gap-2 min-w-0">
                          {item.pinned && (
                            <Pin className="w-3.5 h-3.5 mt-1 shrink-0 text-warning" aria-hidden="true" />
                          )}
                          <div className="min-w-0">
                            <div className="font-medium text-foreground line-clamp-2">{item.title}</div>
                            <p className="text-xs text-muted-foreground line-clamp-1">
                              {item.excerpt || item.body}
                            </p>
                            {item.pinned && <span className="sr-only">Закреплённая новость</span>}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {/* BUG-051: категория — бейджем, а не кодом company/product */}
                        <StatusBadge value={item.category} fallback="Без категории" />
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge value={item.status} />
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                        <span className="inline-flex items-center gap-1.5">
                          {scheduled && <CalendarClock className="w-3.5 h-3.5" aria-hidden="true" />}
                          {formatDate(item.published_date)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        <div className="flex items-center gap-3 whitespace-nowrap">
                          <span className="inline-flex items-center gap-1" title="Просмотры">
                            <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                            {formatNumber(item.views || 0)}
                            <span className="sr-only">просмотров</span>
                          </span>
                          {/* Лайки и комментарии — реальные агрегаты из v_news */}
                          <span className="inline-flex items-center gap-1" title="Лайки">
                            <Heart className="w-3.5 h-3.5" aria-hidden="true" />
                            {formatNumber(item.likes || 0)}
                            <span className="sr-only">лайков</span>
                          </span>
                          <span className="inline-flex items-center gap-1" title="Комментарии">
                            <MessageSquare className="w-3.5 h-3.5" aria-hidden="true" />
                            {formatNumber(item.comments_count || 0)}
                            <span className="sr-only">комментариев</span>
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 table-sticky-actions">
                        <div className="flex items-center justify-end gap-1">
                          {/* Предпросмотр: карточка новости в кабинете */}
                          <Button size="icon" variant="ghost" asChild aria-label={`Предпросмотр новости «${item.title}»`}>
                            <Link to={`/cabinet/news/${item.id}`}>
                              <ExternalLink className="w-4 h-4" aria-hidden="true" />
                            </Link>
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label={item.pinned ? `Снять закрепление с «${item.title}»` : `Закрепить «${item.title}»`}
                            onClick={() => togglePin.mutate(item)}
                            disabled={togglePin.isPending}
                          >
                            {item.pinned
                              ? <PinOff className="w-4 h-4" aria-hidden="true" />
                              : <Pin className="w-4 h-4" aria-hidden="true" />}
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label={`Редактировать новость «${item.title}»`}
                            onClick={() => openEdit(item)}
                          >
                            <Pencil className="w-4 h-4" aria-hidden="true" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="text-muted-foreground hover:text-destructive"
                            aria-label={`Удалить новость «${item.title}»`}
                            onClick={() => setPendingDelete(item)}
                          >
                            <Trash2 className="w-4 h-4" aria-hidden="true" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ----------------------------------------------------- пагинация */}
      {!error && !isLoading && rows.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 mt-4">
          <p className="text-sm text-muted-foreground" aria-live="polite">
            Показаны {formatNumber((page - 1) * PAGE_SIZE + 1)}–{formatNumber((page - 1) * PAGE_SIZE + rows.length)} из{' '}
            {pluralize(total, 'новости', 'новостей', 'новостей')}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="min-h-[40px]"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || isFetching}
              aria-label="Предыдущая страница"
            >
              <ChevronLeft className="w-4 h-4" aria-hidden="true" />
              Назад
            </Button>
            <span className="text-sm text-muted-foreground">
              Страница {formatNumber(page)} из {formatNumber(pageCount)}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="min-h-[40px]"
              onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              disabled={page >= pageCount || isFetching}
              aria-label="Следующая страница"
            >
              Вперёд
              <ChevronRight className="w-4 h-4" aria-hidden="true" />
            </Button>
          </div>
        </div>
      )}

      {/* --------------------------------------------- форма новости */}
      <Dialog open={formOpen} onOpenChange={(open) => (open ? setFormOpen(true) : closeForm())}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? 'Редактирование новости' : 'Новая новость'}</DialogTitle>
            <DialogDescription>
              Заголовок и дата публикации вместе должны быть уникальными — портал не показывает
              одну и ту же новость дважды.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label htmlFor="news-title">Заголовок *</Label>
              <Input
                id="news-title"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                onBlur={() => setTouched((t) => ({ ...t, title: true }))}
                aria-invalid={!!showError('title')}
                aria-describedby={showError('title') ? 'news-title-error' : undefined}
                className="min-h-[40px]"
              />
              {showError('title') && (
                <p id="news-title-error" role="alert" className="mt-1 text-xs text-destructive">
                  {showError('title')}
                </p>
              )}
            </div>

            <div>
              <Label htmlFor="news-body">Текст новости *</Label>
              <Textarea
                id="news-body"
                rows={6}
                value={form.body}
                onChange={(e) => setForm({ ...form, body: e.target.value })}
                onBlur={() => setTouched((t) => ({ ...t, body: true }))}
                aria-invalid={!!showError('body')}
                aria-describedby={showError('body') ? 'news-body-error' : undefined}
              />
              {showError('body') && (
                <p id="news-body-error" role="alert" className="mt-1 text-xs text-destructive">
                  {showError('body')}
                </p>
              )}
            </div>

            <div>
              <Label htmlFor="news-excerpt">Краткое описание</Label>
              <Textarea
                id="news-excerpt"
                rows={2}
                value={form.excerpt}
                onChange={(e) => setForm({ ...form, excerpt: e.target.value })}
                placeholder="Одно-два предложения для карточки в ленте"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="news-category">Категория *</Label>
                <select
                  id="news-category"
                  className="w-full min-h-[40px] rounded-md border border-input bg-background px-3 text-sm"
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                >
                  {CATEGORY_OPTIONS.map((c) => (
                    <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
                  ))}
                </select>
              </div>

              <div>
                <Label htmlFor="news-status">Статус</Label>
                <select
                  id="news-status"
                  className="w-full min-h-[40px] rounded-md border border-input bg-background px-3 text-sm"
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value })}
                >
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                  ))}
                </select>
              </div>

              <div>
                <Label htmlFor="news-date">Дата публикации *</Label>
                <Input
                  id="news-date"
                  type="date"
                  value={form.published_date}
                  onChange={(e) => setForm({ ...form, published_date: e.target.value })}
                  onBlur={() => setTouched((t) => ({ ...t, published_date: true }))}
                  aria-invalid={!!showError('published_date')}
                  aria-describedby="news-date-hint"
                  className="min-h-[40px]"
                />
                <p id="news-date-hint" className="mt-1 text-xs text-muted-foreground">
                  Для отложенной публикации выберите статус «Запланировано» и будущую дату.
                </p>
                {showError('published_date') && (
                  <p role="alert" className="mt-1 text-xs text-destructive">{showError('published_date')}</p>
                )}
              </div>

              <div>
                <Label htmlFor="news-image">Ссылка на изображение</Label>
                <Input
                  id="news-image"
                  value={form.image_url}
                  onChange={(e) => setForm({ ...form, image_url: e.target.value })}
                  onBlur={() => setTouched((t) => ({ ...t, image_url: true }))}
                  placeholder="https://…"
                  aria-invalid={!!showError('image_url')}
                  className="min-h-[40px]"
                />
                {showError('image_url') && (
                  <p role="alert" className="mt-1 text-xs text-destructive">{showError('image_url')}</p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 min-h-[40px]">
              <Checkbox
                id="news-pinned"
                checked={form.pinned}
                onCheckedChange={(checked) => setForm({ ...form, pinned: !!checked })}
              />
              <Label htmlFor="news-pinned" className="font-normal">Закрепить вверху ленты</Label>
            </div>
          </div>

          <DialogFooter className="gap-2">
            {/* BUG-072: явная кнопка «Отмена», а не только крестик */}
            <Button variant="outline" onClick={closeForm} className="min-h-[40px]">Отмена</Button>
            <Button onClick={submit} disabled={!isValid || save.isPending} className="min-h-[40px]">
              {save.isPending ? 'Сохранение…' : editing ? 'Сохранить' : 'Создать'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ------------------------------------ подтверждение удаления */}
      <Dialog open={!!pendingDelete} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Удалить новость?</DialogTitle>
            <DialogDescription>
              Новость «{pendingDelete?.title}» от {formatDate(pendingDelete?.published_date)} будет удалена
              вместе с лайками и комментариями. Действие нельзя отменить.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" className="min-h-[40px]" onClick={() => setPendingDelete(null)}>Отмена</Button>
            <Button
              variant="destructive"
              className="min-h-[40px]"
              onClick={() => remove.mutate(pendingDelete)}
              disabled={remove.isPending}
            >
              {remove.isPending ? 'Удаление…' : 'Удалить'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------------------------- подтверждение массового удаления */}
      <Dialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Удалить выбранные новости?</DialogTitle>
            <DialogDescription>
              Будет удалено {pluralize(selectedIds.length, 'новость', 'новости', 'новостей')} вместе с лайками
              и комментариями. Действие нельзя отменить.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" className="min-h-[40px]" onClick={() => setBulkDeleteOpen(false)}>Отмена</Button>
            <Button
              variant="destructive"
              className="min-h-[40px]"
              disabled={bulk.isPending}
              onClick={() => bulk.mutate({ action: 'delete', ids: selectedIds })}
            >
              {bulk.isPending ? 'Удаление…' : 'Удалить'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
