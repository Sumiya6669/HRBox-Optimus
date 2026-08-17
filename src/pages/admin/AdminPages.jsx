import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  FileText, Plus, Trash2, Eye, ExternalLink, Pencil, Search, Wand2, AlertTriangle,
} from 'lucide-react';
import { api } from '@/api/client';
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
import { formatDate, formatNumber, pluralize } from '@/lib/format';
import { mutationErrorMessage } from '@/lib/dataErrors';
import { cn } from '@/lib/utils';

/**
 * CMS-страницы портала.
 *
 * BUG-008 (критично): CMS позволяла завести /about, /vacation-policy, /ethics,
 *   но публичного рендера не было — все ссылки давали 404. Теперь рендер живёт
 *   в src/pages/company/CmsPage.jsx на маршруте «/:slug», а здесь у каждой строки
 *   есть кнопка «Посмотреть» — переход на реальный адрес страницы.
 *   Черновик по этому адресу виден только администраторам (обычный сотрудник
 *   получит 404 по правилам RLS) — об этом сказано прямо в интерфейсе.
 * Слаг: в БД стоит CHECK '^[a-z0-9]+(?:-[a-z0-9]+)*$' и уникальность. Проверяем то же
 *   правило в форме, генерируем слаг из заголовка с транслитерацией кириллицы,
 *   а код 23505 переводим в «Страница с таким адресом уже существует».
 * BUG-051: статус — StatusBadge. BUG-053: даты — formatDate.
 * BUG-072: удаление только через диалог подтверждения, в модалках есть «Отмена».
 * BUG-036: таблица в .table-scroll, действия — .table-sticky-actions.
 */

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const STATUS_OPTIONS = ['draft', 'published', 'archived'];
const STATUS_LABELS = { draft: 'Черновик', published: 'Опубликована', archived: 'В архиве' };

/** Транслитерация кириллицы для слага: «Политика отпусков» → politika-otpuskov. */
const TRANSLIT = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i',
  й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't',
  у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '',
  э: 'e', ю: 'yu', я: 'ya',
  // казахские буквы — портал двуязычный
  ә: 'a', ғ: 'g', қ: 'k', ң: 'n', ө: 'o', ұ: 'u', ү: 'u', һ: 'h', і: 'i',
};

export function slugify(value = '') {
  return String(value)
    .toLowerCase()
    .split('')
    .map((ch) => (TRANSLIT[ch] !== undefined ? TRANSLIT[ch] : ch))
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/g, '');
}

const emptyForm = () => ({
  title: '',
  slug: '',
  body: '',
  status: 'draft',
  show_in_menu: false,
});

function validate(form) {
  const errors = {};
  if (!form.title.trim()) errors.title = 'Укажите заголовок страницы';
  if (!form.slug.trim()) errors.slug = 'Укажите адрес страницы';
  else if (!SLUG_RE.test(form.slug.trim())) {
    errors.slug = 'Только латиница в нижнем регистре, цифры и дефис между словами: about-company';
  }
  return errors;
}

function TableSkeleton() {
  return (
    <div className="p-4 space-y-2" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-14 rounded bg-muted animate-pulse" />
      ))}
    </div>
  );
}

export default function AdminPages() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { user } = useAuth();

  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [slugTouchedByUser, setSlugTouchedByUser] = useState(false);
  const [touched, setTouched] = useState({});
  const [pendingDelete, setPendingDelete] = useState(null);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchDraft.trim().toLowerCase()), 300);
    return () => clearTimeout(timer);
  }, [searchDraft]);

  const { data: pages, isLoading, error, refetch } = useQuery({
    queryKey: ['admin-pages'],
    queryFn: () => api.entities.Page.list('-updated_date', 500),
  });

  const counts = useMemo(() => {
    const map = { all: (pages || []).length };
    STATUS_OPTIONS.forEach((s) => {
      map[s] = (pages || []).filter((p) => p.status === s).length;
    });
    return map;
  }, [pages]);

  const filtered = useMemo(() => {
    return (pages || []).filter((p) => {
      if (status !== 'all' && p.status !== status) return false;
      if (search && !(`${p.title} ${p.slug}`.toLowerCase().includes(search))) return false;
      return true;
    });
  }, [pages, status, search]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['admin-pages'] });
    qc.invalidateQueries({ queryKey: ['pages'] });
    qc.invalidateQueries({ queryKey: ['cms-page'] });
  };

  /* -------------------------------------------------------------- мутации */

  const SLUG_HINT = {
    23505: 'Страница с таким адресом уже существует — выберите другой слаг',
    23514: 'Адрес страницы не прошёл проверку: допустимы только латиница, цифры и дефис',
  };

  const save = useMutation({
    mutationFn: (payload) => {
      const data = {
        title: payload.title.trim(),
        slug: payload.slug.trim(),
        body: payload.body,
        status: payload.status,
        show_in_menu: payload.show_in_menu,
        // Дату публикации проставляем в момент публикации, а не «на будущее».
        published_date:
          payload.status === 'published'
            ? (editing?.published_date || formatDate(new Date(), 'iso'))
            : null,
      };
      if (editing) return api.entities.Page.update(editing.id, data);
      return api.entities.Page.create({
        ...data,
        author_id: user?.id || null,
        author_name: user?.full_name || 'Администрация',
      });
    },
    onSuccess: (saved) => {
      toast({
        title: editing ? 'Страница сохранена' : 'Страница создана',
        description: saved?.slug ? `Адрес: /${saved.slug}` : undefined,
      });
      closeForm();
      invalidate();
    },
    onError: (err) => toast({
      title: 'Не удалось сохранить страницу',
      description: mutationErrorMessage(err, SLUG_HINT),
      variant: 'destructive',
    }),
  });

  const remove = useMutation({
    mutationFn: (item) => api.entities.Page.delete(item.id),
    onSuccess: () => {
      setPendingDelete(null);
      toast({ title: 'Страница удалена' });
      invalidate();
    },
    onError: (err) => toast({
      title: 'Не удалось удалить страницу',
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
    setSlugTouchedByUser(false);
    setTouched({});
    setFormOpen(true);
  };

  const openEdit = (item) => {
    setEditing(item);
    setForm({
      title: item.title || '',
      slug: item.slug || '',
      body: item.body || '',
      status: item.status || 'draft',
      show_in_menu: !!item.show_in_menu,
    });
    setSlugTouchedByUser(true); // у существующей страницы слаг не перезаписываем автоматически
    setTouched({});
    setFormOpen(true);
  };

  const closeForm = () => {
    setFormOpen(false);
    setEditing(null);
    setForm(emptyForm());
    setTouched({});
    setSlugTouchedByUser(false);
  };

  const onTitleChange = (value) => {
    setForm((prev) => ({
      ...prev,
      title: value,
      // Пока адрес не правили вручную — держим его синхронным с заголовком.
      slug: slugTouchedByUser ? prev.slug : slugify(value),
    }));
  };

  const submit = () => {
    setTouched({ title: true, slug: true });
    if (!isValid) return;
    save.mutate(form);
  };

  const hasFilters = !!search || status !== 'all';

  return (
    <PageContainer
      title="Страницы портала"
      description="CMS-страницы вроде «О компании» или «Политика отпусков». Каждая опубликованная страница открывается по своему адресу."
      width="wide"
      actions={
        <Button onClick={openCreate} className="min-h-[40px]">
          <Plus className="w-4 h-4" aria-hidden="true" />
          Новая страница
        </Button>
      }
    >
      <div className="flex flex-col lg:flex-row lg:items-center gap-3 mb-4">
        <div className="relative w-full lg:max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
          <label htmlFor="admin-pages-search" className="sr-only">Поиск по заголовку или адресу</label>
          <Input
            id="admin-pages-search"
            type="search"
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            placeholder="Поиск по заголовку или адресу"
            className="pl-9 min-h-[40px]"
          />
        </div>
        <FilterChips
          ariaLabel="Фильтр по статусу"
          value={status}
          onChange={setStatus}
          options={[
            { value: 'all', label: 'Все', count: counts.all },
            ...STATUS_OPTIONS.map((s) => ({ value: s, label: STATUS_LABELS[s], count: counts[s] })),
          ]}
        />
      </div>

      <Card className="overflow-hidden">
        {error ? (
          <div className="p-4"><ErrorState error={error} onRetry={refetch} /></div>
        ) : isLoading ? (
          <TableSkeleton />
        ) : filtered.length === 0 ? (
          <div className="p-4">
            <EmptyState
              icon={FileText}
              title={hasFilters ? 'Страницы не найдены' : 'Страниц пока нет'}
              description={
                hasFilters
                  ? 'Измените запрос или снимите фильтр по статусу.'
                  : 'Создайте страницу — после публикации она откроется по адресу вида /about и попадёт в поиск портала.'
              }
              actionLabel={hasFilters ? 'Сбросить фильтры' : 'Создать страницу'}
              onAction={hasFilters ? () => { setSearchDraft(''); setStatus('all'); } : openCreate}
            />
          </div>
        ) : (
          <div className="table-scroll">
            <table className="w-full text-sm">
              <caption className="sr-only">CMS-страницы портала</caption>
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th scope="col" className="px-4 py-3 font-medium">Страница</th>
                  <th scope="col" className="px-4 py-3 font-medium">Адрес</th>
                  <th scope="col" className="px-4 py-3 font-medium">Статус</th>
                  <th scope="col" className="px-4 py-3 font-medium">Просмотры</th>
                  <th scope="col" className="px-4 py-3 font-medium">Обновлена</th>
                  <th scope="col" className="px-4 py-3 font-medium table-sticky-actions text-right">Действия</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => {
                  const isDraft = item.status !== 'published';
                  return (
                    <tr key={item.id} className="border-b border-border last:border-0 hover:bg-accent/40 align-top">
                      <td className="px-4 py-3">
                        <div className="min-w-0">
                          <div className="font-medium text-foreground line-clamp-2">{item.title}</div>
                          {item.body && (
                            <p className="text-xs text-muted-foreground line-clamp-1">{item.body}</p>
                          )}
                          {item.show_in_menu && (
                            <span className="text-xs text-muted-foreground">Выводится в меню портала</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {/* BUG-008: адрес — рабочая ссылка, а не декоративный текст */}
                        <Link
                          to={`/${item.slug}`}
                          className="font-mono text-xs text-primary hover:underline break-all"
                        >
                          /{item.slug}
                        </Link>
                        {isDraft && (
                          <p className="mt-1 text-xs text-muted-foreground max-w-[220px]">
                            Черновик, виден только администраторам — сотрудники увидят страницу после публикации.
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3"><StatusBadge value={item.status} /></td>
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5">
                          <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                          {formatNumber(item.views || 0)}
                          <span className="sr-only">просмотров</span>
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                        {formatDate(item.updated_date)}
                      </td>
                      <td className="px-4 py-3 table-sticky-actions">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            className="min-h-[40px]"
                            asChild
                            aria-label={`Посмотреть страницу «${item.title}» по адресу /${item.slug}`}
                          >
                            <Link to={`/${item.slug}`}>
                              <ExternalLink className="w-4 h-4" aria-hidden="true" />
                              Посмотреть
                            </Link>
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label={`Редактировать страницу «${item.title}»`}
                            onClick={() => openEdit(item)}
                          >
                            <Pencil className="w-4 h-4" aria-hidden="true" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="text-muted-foreground hover:text-destructive"
                            aria-label={`Удалить страницу «${item.title}»`}
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

      {!error && !isLoading && filtered.length > 0 && (
        <p className="mt-3 text-sm text-muted-foreground" aria-live="polite">
          Показано {pluralize(filtered.length, 'страница', 'страницы', 'страниц')}
          {filtered.length !== (pages || []).length ? ` из ${formatNumber((pages || []).length)}` : ''}
        </p>
      )}

      {/* ------------------------------------------------- форма страницы */}
      <Dialog open={formOpen} onOpenChange={(open) => (open ? setFormOpen(true) : closeForm())}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? 'Редактирование страницы' : 'Новая страница'}</DialogTitle>
            <DialogDescription>
              Опубликованная страница доступна по адресу вида /about и участвует в поиске портала.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label htmlFor="page-title">Заголовок *</Label>
              <Input
                id="page-title"
                value={form.title}
                onChange={(e) => onTitleChange(e.target.value)}
                onBlur={() => setTouched((t) => ({ ...t, title: true }))}
                aria-invalid={!!showError('title')}
                className="min-h-[40px]"
              />
              {showError('title') && (
                <p role="alert" className="mt-1 text-xs text-destructive">{showError('title')}</p>
              )}
            </div>

            <div>
              <Label htmlFor="page-slug">Адрес страницы *</Label>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground shrink-0">/</span>
                <Input
                  id="page-slug"
                  value={form.slug}
                  onChange={(e) => {
                    setSlugTouchedByUser(true);
                    setForm({ ...form, slug: e.target.value });
                  }}
                  onBlur={() => setTouched((t) => ({ ...t, slug: true }))}
                  placeholder="about-company"
                  aria-invalid={!!showError('slug')}
                  aria-describedby="page-slug-hint"
                  className="min-h-[40px] font-mono"
                />
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-[40px] shrink-0"
                  onClick={() => {
                    setSlugTouchedByUser(true);
                    setForm((prev) => ({ ...prev, slug: slugify(prev.title) }));
                  }}
                  aria-label="Сгенерировать адрес из заголовка"
                >
                  <Wand2 className="w-4 h-4" aria-hidden="true" />
                  Из заголовка
                </Button>
              </div>
              <p id="page-slug-hint" className="mt-1 text-xs text-muted-foreground">
                Латиница в нижнем регистре, цифры и дефис между словами. Кириллица переводится
                в латиницу автоматически: «О компании» → o-kompanii.
              </p>
              {showError('slug') && (
                <p role="alert" className="mt-1 text-xs text-destructive">{showError('slug')}</p>
              )}
            </div>

            <div>
              <Label htmlFor="page-body">Содержимое</Label>
              <Textarea
                id="page-body"
                rows={12}
                value={form.body}
                onChange={(e) => setForm({ ...form, body: e.target.value })}
                aria-describedby="page-body-hint"
                className="font-mono text-sm"
                placeholder={'## Заголовок раздела\n\nАбзац текста с **важным** фрагментом.\n\n- первый пункт\n- второй пункт'}
              />
              {/* Подсказка описывает ровно то, что умеет разборщик в CmsPage.jsx */}
              <div id="page-body-hint" className="mt-2 rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
                <p className="font-medium text-foreground mb-1">Поддерживаемая разметка</p>
                <ul className="space-y-0.5">
                  <li><code className="font-mono">## Заголовок</code> — заголовок раздела (доступны <code className="font-mono">#</code>, <code className="font-mono">##</code>, <code className="font-mono">###</code>)</li>
                  <li><code className="font-mono">- пункт</code> — маркированный список</li>
                  <li><code className="font-mono">1. пункт</code> — нумерованный список</li>
                  <li><code className="font-mono">**жирный**</code> и <code className="font-mono">*курсив*</code></li>
                  <li><code className="font-mono">&gt; цитата</code> — выделенная цитата</li>
                  <li><code className="font-mono">---</code> — горизонтальный разделитель</li>
                  <li>Пустая строка разделяет абзацы. HTML-теги не обрабатываются и выводятся как текст.</li>
                </ul>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="page-status">Статус</Label>
                <select
                  id="page-status"
                  className="w-full min-h-[40px] rounded-md border border-input bg-background px-3 text-sm"
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value })}
                >
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                  ))}
                </select>
                {form.status !== 'published' && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Черновик виден только администраторам портала.
                  </p>
                )}
              </div>
              <div className="flex items-end gap-2 min-h-[40px] pb-2">
                <Checkbox
                  id="page-menu"
                  checked={form.show_in_menu}
                  onCheckedChange={(checked) => setForm({ ...form, show_in_menu: !!checked })}
                />
                <Label htmlFor="page-menu" className="font-normal">Показывать в меню портала</Label>
              </div>
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

      {/* ------------------------------- подтверждение удаления страницы */}
      <Dialog open={!!pendingDelete} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Удалить страницу?</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2">
                <p>
                  Страница «{pendingDelete?.title}» будет удалена, адрес{' '}
                  <span className="font-mono">/{pendingDelete?.slug}</span> перестанет открываться
                  и начнёт отдавать 404. Действие нельзя отменить.
                </p>
                <p className={cn('flex items-start gap-2 text-xs')}>
                  <AlertTriangle className="w-4 h-4 shrink-0 text-warning" aria-hidden="true" />
                  Если на страницу есть ссылки из меню или новостей — их придётся поправить вручную.
                </p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" className="min-h-[40px]" onClick={() => setPendingDelete(null)}>
              Отмена
            </Button>
            <Button
              variant="destructive"
              className="min-h-[40px]"
              onClick={() => remove.mutate(pendingDelete)}
              disabled={remove.isPending}
            >
              {remove.isPending ? 'Удаление…' : 'Удалить страницу'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
