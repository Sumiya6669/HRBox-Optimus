import React, { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  BookOpen, Plus, Trash2, Search, Pencil, Users, Library, ArrowRightLeft,
  BookCheck, AlertTriangle,
} from 'lucide-react';
import { api } from '@/api/client';
import PageContainer from '@/components/common/PageContainer';
import EmptyState from '@/components/common/EmptyState';
import ErrorState from '@/components/common/ErrorState';
import StatusBadge from '@/components/common/StatusBadge';
import FilterChips from '@/components/common/FilterChips';
import ImageUpload from '@/components/common/ImageUpload';
import SafeImage from '@/components/common/SafeImage';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { formatDate, formatNumber, pluralize } from '@/lib/format';
import { mutationErrorMessage } from '@/lib/dataErrors';
import { cn } from '@/lib/utils';

/**
 * Администрирование библиотеки.
 *
 * BUG-065: у книги было только удаление — редактировать её было нельзя. Теперь полноценный
 *   CRUD, как в магазине наград и новостях.
 * Аудит (вёрстка): названия резались по символам («Атомные прив…», «Manage Your D…») при
 *   свободном месте в карточке. Теперь min-w-0 + line-clamp-2 — текст переносится, а не
 *   обрезается на середине слова.
 * BUG-064: «3 экз.» ни к чему не вели — здесь управление выдачами: бронь → выдача → возврат.
 * Свободные экземпляры и число читателей берём из вьюхи v_books (CONVENTIONS §1).
 * BUG-072: удаление с подтверждением, во всех модалках есть «Отмена».
 * BUG-036: таблица выдач — в .table-scroll с закреплённой колонкой действий.
 */

const LOAN_FILTERS = [
  { value: 'all', label: 'Все' },
  { value: 'reserved', label: 'Забронированы' },
  { value: 'issued', label: 'На руках' },
  { value: 'returned', label: 'Возвращены' },
];

const emptyForm = () => ({
  title: '',
  author: '',
  category: '',
  description: '',
  copies: 1,
  cover_url: '',
  cover_path: '',
});

function validate(form) {
  const errors = {};
  if (!form.title.trim()) errors.title = 'Укажите название книги';
  if (!form.author.trim()) errors.author = 'Укажите автора';
  const copies = Number(form.copies);
  if (!Number.isInteger(copies) || copies < 0) errors.copies = 'Количество экземпляров — целое число от 0';
  // Обложка необязательна и загружается файлом (CONVENTIONS §10) — проверять
  // формат ссылки не нужно.
  return errors;
}

/** Книги с агрегатами: свободные экземпляры и число прочитавших. */
async function fetchBooks() {
  const { data, error } = await api.supabase.from('v_books').select('*').order('title');
  if (error) throw error;
  return data || [];
}

function CardsSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4" aria-hidden="true">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <Card key={i} className="p-4 flex gap-3 animate-pulse">
          <div className="w-12 h-16 rounded-lg bg-muted shrink-0" />
          <div className="flex-1 space-y-2 py-1">
            <div className="h-4 w-2/3 rounded bg-muted" />
            <div className="h-3 w-1/2 rounded bg-muted/60" />
            <div className="h-3 w-1/3 rounded bg-muted/60" />
          </div>
        </Card>
      ))}
    </div>
  );
}

export default function AdminLibrary() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [touched, setTouched] = useState({});
  const [pendingDelete, setPendingDelete] = useState(null);

  const [loansBook, setLoansBook] = useState(null);
  const [loanFilter, setLoanFilter] = useState('all');

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchDraft.trim().toLowerCase()), 300);
    return () => clearTimeout(timer);
  }, [searchDraft]);

  /* --------------------------------------------------------------- данные */

  const { data: books, isLoading, error, refetch } = useQuery({
    queryKey: ['admin-books'],
    queryFn: fetchBooks,
  });

  const { data: employees } = useQuery({
    queryKey: ['employees-all'],
    queryFn: () => api.entities.Employee.list('name', 1000),
  });

  const employeeById = useMemo(
    () => new Map((employees || []).map((e) => [e.id, e])),
    [employees]
  );

  const categories = useMemo(
    () => [...new Set((books || []).map((b) => b.category).filter(Boolean))].sort(),
    [books]
  );

  const filtered = useMemo(() => {
    return (books || []).filter((b) => {
      if (category !== 'all' && b.category !== category) return false;
      if (search && !`${b.title} ${b.author || ''}`.toLowerCase().includes(search)) return false;
      return true;
    });
  }, [books, category, search]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['admin-books'] });
    qc.invalidateQueries({ queryKey: ['books'] });
    qc.invalidateQueries({ queryKey: ['book-loans'] });
    qc.invalidateQueries({ queryKey: ['admin-book-loans'] });
  };

  /* -------------------------------------------------------------- мутации */

  const save = useMutation({
    mutationFn: (payload) => {
      const data = {
        title: payload.title.trim(),
        author: payload.author.trim(),
        category: payload.category.trim() || null,
        description: payload.description.trim() || null,
        copies: Number(payload.copies),
        cover_url: payload.cover_url?.trim() || null,
        cover_path: payload.cover_path?.trim() || null,
      };
      if (editing) return api.entities.Book.update(editing.id, data);
      return api.entities.Book.create(data);
    },
    onSuccess: () => {
      toast({ title: editing ? 'Книга сохранена' : 'Книга добавлена' });
      closeForm();
      invalidate();
    },
    onError: (err) => toast({
      title: 'Не удалось сохранить книгу',
      description: mutationErrorMessage(err, { 23505: 'Такая книга уже есть в каталоге' }),
      variant: 'destructive',
    }),
  });

  const remove = useMutation({
    mutationFn: (book) => api.entities.Book.delete(book.id),
    onSuccess: () => {
      setPendingDelete(null);
      toast({ title: 'Книга удалена' });
      invalidate();
    },
    onError: (err) => toast({
      title: 'Не удалось удалить книгу',
      description: mutationErrorMessage(err, {
        23503: 'По книге есть выдачи — сначала примите возвраты',
      }),
      variant: 'destructive',
    }),
  });

  /** Выдача и приём возврата: меняем статус и проставляем даты (BUG-064). */
  const updateLoan = useMutation({
    mutationFn: ({ loan, action }) => {
      const patch =
        action === 'issue'
          ? { status: 'issued', issued_at: new Date().toISOString() }
          : { status: 'returned', returned_at: new Date().toISOString() };
      return api.entities.BookLoan.update(loan.id, patch);
    },
    onSuccess: (_data, { action }) => {
      toast({ title: action === 'issue' ? 'Книга выдана' : 'Возврат принят' });
      invalidate();
    },
    onError: (err) => toast({
      title: 'Не удалось изменить выдачу',
      description: mutationErrorMessage(err),
      variant: 'destructive',
    }),
  });

  /* ------------------------------------------------------------- выдачи */

  const {
    data: loans,
    isLoading: loansLoading,
    error: loansError,
    refetch: refetchLoans,
  } = useQuery({
    queryKey: ['admin-book-loans', loansBook?.id],
    queryFn: () => api.entities.BookLoan.filter({ book_id: loansBook.id }, '-created_date'),
    enabled: !!loansBook,
  });

  const visibleLoans = useMemo(() => {
    if (loanFilter === 'all') return loans || [];
    return (loans || []).filter((l) => l.status === loanFilter);
  }, [loans, loanFilter]);

  const loanCounts = useMemo(() => {
    const map = { all: (loans || []).length };
    ['reserved', 'issued', 'returned'].forEach((s) => {
      map[s] = (loans || []).filter((l) => l.status === s).length;
    });
    return map;
  }, [loans]);

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

  // BUG-065: редактирование книги — тот же диалог, что и создание.
  const openEdit = (book) => {
    setEditing(book);
    setForm({
      title: book.title || '',
      author: book.author || '',
      category: book.category || '',
      description: book.description || '',
      copies: book.copies ?? 1,
      cover_url: book.cover_url || '',
      cover_path: book.cover_path || '',
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
    setTouched({ title: true, author: true, copies: true });
    if (!isValid) return;
    save.mutate(form);
  };

  const hasFilters = !!search || category !== 'all';

  return (
    <PageContainer
      title="Библиотека"
      description="Каталог корпоративной библиотеки, свободные экземпляры и выдачи книг сотрудникам."
      width="wide"
      actions={
        <Button onClick={openCreate} className="min-h-[40px]">
          <Plus className="w-4 h-4" aria-hidden="true" />
          Добавить книгу
        </Button>
      }
    >
      <div className="flex flex-col lg:flex-row lg:items-center gap-3 mb-4">
        <div className="relative w-full lg:max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
          <label htmlFor="admin-books-search" className="sr-only">Поиск по названию или автору</label>
          <Input
            id="admin-books-search"
            type="search"
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            placeholder="Поиск по названию или автору"
            className="pl-9 min-h-[40px]"
          />
        </div>
        {categories.length > 0 && (
          <FilterChips
            ariaLabel="Фильтр по категории"
            value={category}
            onChange={setCategory}
            options={[
              { value: 'all', label: 'Все категории', count: (books || []).length },
              ...categories.map((c) => ({
                value: c,
                label: c,
                count: (books || []).filter((b) => b.category === c).length,
              })),
            ]}
          />
        )}
      </div>

      {error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : isLoading ? (
        <CardsSkeleton />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Library}
          title={hasFilters ? 'Книги не найдены' : 'Каталог пуст'}
          description={
            hasFilters
              ? 'Измените запрос или снимите фильтр по категории.'
              : 'Добавьте первую книгу — сотрудники смогут бронировать её в разделе «Библиотека».'
          }
          actionLabel={hasFilters ? 'Сбросить фильтры' : 'Добавить книгу'}
          onAction={hasFilters ? () => { setSearchDraft(''); setCategory('all'); } : openCreate}
        />
      ) : (
        /* items-stretch: карточки одной высоты независимо от длины названия */
        <ul role="list" className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 items-stretch">
          {filtered.map((book) => {
            const available = book.available_count ?? book.copies ?? 0;
            return (
              <li key={book.id} className="h-full">
                <Card className="flex h-full flex-col p-4">
                  <div className="flex gap-3">
                    {/* Битая обложка не должна показывать «сломанную иконку» браузера. */}
                    <SafeImage
                      src={book.cover_url}
                      alt=""
                      className="w-12 h-16 shrink-0 overflow-hidden rounded-lg object-cover"
                      fallbackIcon={BookOpen}
                      fallbackClassName="bg-brand-library/15 text-brand-library"
                    />
                    {/* Вёрстка: min-w-0 + line-clamp-2 вместо усечения названия по символам */}
                    <div className="min-w-0 flex-1">
                      <h3 className="font-medium text-foreground line-clamp-2 break-words">{book.title}</h3>
                      <p className="text-xs text-muted-foreground line-clamp-1">{book.author || 'Автор не указан'}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        {book.category && (
                          <Badge variant="secondary" className="whitespace-nowrap">{book.category}</Badge>
                        )}
                        <Badge
                          variant={available > 0 ? 'success' : 'secondary'}
                          className="whitespace-nowrap"
                        >
                          {available > 0
                            ? `Свободно ${formatNumber(available)} из ${formatNumber(book.copies || 0)}`
                            : 'Все экземпляры на руках'}
                        </Badge>
                      </div>
                    </div>
                  </div>

                  {book.description && (
                    <p className="mt-3 text-sm text-muted-foreground line-clamp-2">{book.description}</p>
                  )}

                  <div className="mt-3 flex-1" />

                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1 whitespace-nowrap">
                      <Users className="w-3.5 h-3.5" aria-hidden="true" />
                      Прочитали: {formatNumber(book.readers_count || 0)}
                    </span>
                    <span className="inline-flex items-center gap-1 whitespace-nowrap">
                      <BookCheck className="w-3.5 h-3.5" aria-hidden="true" />
                      На руках: {formatNumber(book.taken_count || 0)}
                    </span>
                  </div>

                  <div className="mt-3 flex items-center gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      className="min-h-[40px]"
                      onClick={() => { setLoansBook(book); setLoanFilter('all'); }}
                      aria-label={`Выдачи книги «${book.title}»`}
                    >
                      <ArrowRightLeft className="w-4 h-4" aria-hidden="true" />
                      Выдачи
                    </Button>
                    <div className="ml-auto flex items-center gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => openEdit(book)}
                        aria-label={`Редактировать книгу «${book.title}»`}
                      >
                        <Pencil className="w-4 h-4" aria-hidden="true" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => setPendingDelete(book)}
                        aria-label={`Удалить книгу «${book.title}»`}
                      >
                        <Trash2 className="w-4 h-4" aria-hidden="true" />
                      </Button>
                    </div>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      {!error && !isLoading && filtered.length > 0 && (
        <p className="mt-3 text-sm text-muted-foreground" aria-live="polite">
          Показано {pluralize(filtered.length, 'книга', 'книги', 'книг')}
          {filtered.length !== (books || []).length ? ` из ${formatNumber((books || []).length)}` : ''}
        </p>
      )}

      {/* -------------------------------------------------- форма книги */}
      <Dialog open={formOpen} onOpenChange={(open) => (open ? setFormOpen(true) : closeForm())}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{editing ? 'Редактирование книги' : 'Новая книга'}</DialogTitle>
            <DialogDescription>
              Число экземпляров определяет, сколько сотрудников могут держать книгу на руках одновременно.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label htmlFor="book-title">Название *</Label>
              <Input
                id="book-title"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                onBlur={() => setTouched((t) => ({ ...t, title: true }))}
                aria-invalid={!!showError('title')}
                className="min-h-[40px]"
              />
              {showError('title') && (
                <p role="alert" className="mt-1 text-xs text-destructive">{showError('title')}</p>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="book-author">Автор *</Label>
                <Input
                  id="book-author"
                  value={form.author}
                  onChange={(e) => setForm({ ...form, author: e.target.value })}
                  onBlur={() => setTouched((t) => ({ ...t, author: true }))}
                  aria-invalid={!!showError('author')}
                  className="min-h-[40px]"
                />
                {showError('author') && (
                  <p role="alert" className="mt-1 text-xs text-destructive">{showError('author')}</p>
                )}
              </div>
              <div>
                <Label htmlFor="book-category">Категория</Label>
                <Input
                  id="book-category"
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  placeholder="Менеджмент, Продажи, Психология"
                  className="min-h-[40px]"
                />
              </div>
              <div>
                <Label htmlFor="book-copies">Экземпляров *</Label>
                <Input
                  id="book-copies"
                  type="number"
                  min="0"
                  value={form.copies}
                  onChange={(e) => setForm({ ...form, copies: e.target.value === '' ? '' : Number(e.target.value) })}
                  onBlur={() => setTouched((t) => ({ ...t, copies: true }))}
                  aria-invalid={!!showError('copies')}
                  className="min-h-[40px]"
                />
                {showError('copies') && (
                  <p role="alert" className="mt-1 text-xs text-destructive">{showError('copies')}</p>
                )}
              </div>
              {/* Обложка загружается файлом, а не ссылкой (CONVENTIONS §10). */}
              <ImageUpload
                id="book-cover"
                value={form.cover_url}
                path={form.cover_path}
                folder="books"
                label="Обложка книги"
                aspect="square"
                hint="Необязательно"
                onChange={({ url, path }) => setForm((f) => ({ ...f, cover_url: url, cover_path: path }))}
              />
            </div>

            <div>
              <Label htmlFor="book-description">Описание</Label>
              <Textarea
                id="book-description"
                rows={3}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" className="min-h-[40px]" onClick={closeForm}>Отмена</Button>
            <Button className="min-h-[40px]" onClick={submit} disabled={!isValid || save.isPending}>
              {save.isPending ? 'Сохранение…' : editing ? 'Сохранить' : 'Добавить'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ------------------------------------------------ выдачи по книге */}
      <Dialog open={!!loansBook} onOpenChange={(open) => !open && setLoansBook(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Выдачи книги</DialogTitle>
            <DialogDescription>
              «{loansBook?.title}» · свободно {formatNumber(loansBook?.available_count ?? 0)} из{' '}
              {formatNumber(loansBook?.copies ?? 0)}. Бронь превращается в выдачу кнопкой «Выдать»,
              возврат освобождает экземпляр.
            </DialogDescription>
          </DialogHeader>

          <FilterChips
            ariaLabel="Фильтр выдач по статусу"
            value={loanFilter}
            onChange={setLoanFilter}
            options={LOAN_FILTERS.map((f) => ({ ...f, count: loanCounts[f.value] }))}
          />

          {loansError ? (
            <ErrorState error={loansError} onRetry={refetchLoans} compact />
          ) : loansLoading ? (
            <div className="space-y-2" aria-hidden="true">
              {[0, 1, 2].map((i) => <div key={i} className="h-10 rounded bg-muted animate-pulse" />)}
            </div>
          ) : visibleLoans.length === 0 ? (
            <EmptyState
              compact
              icon={BookOpen}
              title={loanFilter === 'all' ? 'Выдач пока не было' : 'В этом статусе выдач нет'}
              description={
                loanFilter === 'all'
                  ? 'Сотрудники бронируют книги в разделе «Библиотека» — брони появятся здесь.'
                  : 'Снимите фильтр, чтобы увидеть остальные выдачи.'
              }
            />
          ) : (
            <div className="table-scroll max-h-96 overflow-y-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <caption className="sr-only">Выдачи книги</caption>
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th scope="col" className="px-3 py-2 font-medium">Сотрудник</th>
                    <th scope="col" className="px-3 py-2 font-medium">Статус</th>
                    <th scope="col" className="px-3 py-2 font-medium">Бронь</th>
                    <th scope="col" className="px-3 py-2 font-medium">Выдана</th>
                    <th scope="col" className="px-3 py-2 font-medium">Возврат</th>
                    <th scope="col" className="px-3 py-2 font-medium table-sticky-actions text-right">Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleLoans.map((loan) => {
                    const emp = employeeById.get(loan.employee_id);
                    return (
                      <tr key={loan.id} className="border-b border-border last:border-0">
                        <td className="px-3 py-2">
                          <div className="font-medium text-foreground">{emp?.name || 'Сотрудник портала'}</div>
                          {emp?.department && (
                            <div className="text-xs text-muted-foreground">{emp.department}</div>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {/* BUG-051: reserved/issued/returned — только человеческие ярлыки */}
                          <StatusBadge value={loan.status} />
                        </td>
                        <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                          {formatDate(loan.reserved_at)}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                          {loan.issued_at ? formatDate(loan.issued_at) : '—'}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                          {loan.returned_at ? formatDate(loan.returned_at) : '—'}
                        </td>
                        <td className="px-3 py-2 table-sticky-actions">
                          <div className="flex items-center justify-end gap-1">
                            {loan.status === 'reserved' && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="min-h-[40px]"
                                disabled={updateLoan.isPending}
                                onClick={() => updateLoan.mutate({ loan, action: 'issue' })}
                                aria-label={`Выдать книгу сотруднику ${emp?.name || ''}`}
                              >
                                Выдать
                              </Button>
                            )}
                            {loan.status === 'issued' && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="min-h-[40px]"
                                disabled={updateLoan.isPending}
                                onClick={() => updateLoan.mutate({ loan, action: 'return' })}
                                aria-label={`Принять возврат книги от сотрудника ${emp?.name || ''}`}
                              >
                                Принять возврат
                              </Button>
                            )}
                            {(loan.status === 'returned' || loan.status === 'cancelled') && (
                              <span className="text-xs text-muted-foreground">Действий нет</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" className="min-h-[40px]" onClick={() => setLoansBook(null)}>
              Закрыть
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ------------------------------------ подтверждение удаления книги */}
      <Dialog open={!!pendingDelete} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Удалить книгу?</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2">
                <p>
                  Книга «{pendingDelete?.title}» будет удалена из каталога вместе с историей выдач.
                  Действие нельзя отменить.
                </p>
                <p className={cn('flex items-start gap-2 text-xs')}>
                  <AlertTriangle className="w-4 h-4 shrink-0 text-warning" aria-hidden="true" />
                  Если экземпляры временно закончились — не удаляйте книгу, а поставьте 0 экземпляров.
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
              {remove.isPending ? 'Удаление…' : 'Удалить книгу'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
