import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { BookOpen, Search, User, BookMarked, Library } from 'lucide-react';
import PageContainer from '@/components/common/PageContainer';
import EmptyState from '@/components/common/EmptyState';
import ErrorState from '@/components/common/ErrorState';
import StatusBadge from '@/components/common/StatusBadge';
import FilterChips from '@/components/common/FilterChips';
import { useToast } from '@/components/ui/use-toast';
import { useCurrentEmployee } from '@/lib/useCurrentEmployee';
import { formatNumber, pluralize } from '@/lib/format';

/**
 * Корпоративная библиотека.
 *
 * BUG-054: оранжевая палитра заменена на брендовые токены brand-library.
 * BUG-062: «14 чит.» накладывалось на бейдж категории — абсолютное позиционирование
 *          убрано, карточка собрана на flex с gap и min-w-0.
 * BUG-064: «3 экз.» ни к чему не вели — читаем v_books (available_count / readers_count)
 *          и бронируем книгу через rpc reserve_book; если свободных нет — disabled
 *          с пояснением, а не молчание.
 */

const ALL = 'all';

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-5" aria-hidden="true">
      {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => (
        <div key={i} className="h-72 animate-pulse rounded-xl bg-muted" />
      ))}
    </div>
  );
}

export default function CabinetLibrary() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { employeeId } = useCurrentEmployee();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState(ALL);

  // Вьюха вместо базовой таблицы: available_count и readers_count считает БД.
  const booksQuery = useQuery({
    queryKey: ['books-view'],
    queryFn: async () => {
      const { data, error } = await api.supabase.from('v_books').select('*').order('title');
      if (error) throw error;
      return data || [];
    },
  });

  // Свои брони, чтобы не предлагать забронировать то, что уже на руках.
  const loansQuery = useQuery({
    queryKey: ['book-loans-me', employeeId],
    queryFn: () => api.entities.BookLoan.filter({ employee_id: employeeId, status: ['reserved', 'issued'] }),
    enabled: !!employeeId,
  });

  const myBookIds = useMemo(
    () => new Set((loansQuery.data || []).map((l) => l.book_id)),
    [loansQuery.data]
  );

  const reserve = useMutation({
    mutationFn: async (bookId) => {
      const { data, error } = await api.supabase.rpc('reserve_book', { p_book_id: bookId });
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, bookId) => {
      const book = (booksQuery.data || []).find((b) => b.id === bookId);
      toast({
        title: 'Книга забронирована',
        description: `«${book?.title || 'Книга'}» ждёт вас в библиотеке. Срок брони — 30 дней.`,
      });
      qc.invalidateQueries({ queryKey: ['books-view'] });
      qc.invalidateQueries({ queryKey: ['book-loans-me'] });
    },
    onError: (error) => {
      toast({
        title: 'Не удалось забронировать',
        description: error?.message || 'Попробуйте ещё раз или обратитесь к библиотекарю.',
        variant: 'destructive',
      });
    },
  });

  const books = booksQuery.data || [];

  const categoryOptions = useMemo(() => {
    const counts = new Map();
    books.forEach((b) => {
      const key = b.category || 'other';
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    return [
      { value: ALL, label: 'Все книги', count: books.length },
      ...[...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([value, count]) => ({ value, label: value === 'other' ? 'Без категории' : value, count })),
    ];
  }, [books]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return books.filter((b) => {
      const matchesCategory = category === ALL || (b.category || 'other') === category;
      const matchesSearch =
        !q ||
        b.title?.toLowerCase().includes(q) ||
        b.author?.toLowerCase().includes(q);
      return matchesCategory && matchesSearch;
    });
  }, [books, search, category]);

  return (
    <PageContainer title="Библиотека" description="Корпоративная библиотека знаний: бронируйте книги онлайн">
      {booksQuery.error ? (
        <ErrorState error={booksQuery.error} onRetry={booksQuery.refetch} />
      ) : booksQuery.isPending ? (
        <SkeletonGrid />
      ) : (
        <div className="space-y-6">
          <div className="relative max-w-md">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск по названию или автору"
              aria-label="Поиск книг"
              className="min-h-[40px] pl-9"
            />
          </div>

          <FilterChips
            options={categoryOptions}
            value={category}
            onChange={setCategory}
            ariaLabel="Фильтр книг по категории"
          />

          {!filtered.length ? (
            <EmptyState
              icon={Library}
              title={books.length ? 'Книги не найдены' : 'Библиотека пуста'}
              description={
                books.length
                  ? 'Попробуйте изменить запрос или снять фильтр по категории.'
                  : 'HR-отдел ещё не добавил книги в корпоративную библиотеку.'
              }
              actionLabel={books.length ? 'Сбросить фильтры' : undefined}
              onAction={
                books.length
                  ? () => {
                      setSearch('');
                      setCategory(ALL);
                    }
                  : undefined
              }
            />
          ) : (
            <ul role="list" className="grid grid-cols-2 items-stretch gap-4 md:grid-cols-4 lg:grid-cols-5">
              {filtered.map((book) => {
                const available = Number(book.available_count) || 0;
                const readers = Number(book.readers_count) || 0;
                const mine = myBookIds.has(book.id);
                const isPending = reserve.isPending && reserve.variables === book.id;

                return (
                  <li key={book.id} role="listitem" className="h-full">
                    {/* BUG-062: карточка — flex-колонка с gap, никаких absolute-бейджей */}
                    <Card className="flex h-full flex-col overflow-hidden">
                      <Link
                        to={`/cabinet/library/${book.id}`}
                        className="group flex flex-1 flex-col focus-visible:outline-none"
                        aria-label={`Открыть карточку книги «${book.title}»`}
                      >
                        <div className="flex h-40 items-center justify-center bg-accent">
                          {book.cover_url ? (
                            <img
                              src={book.cover_url}
                              alt=""
                              className="h-full w-full object-cover transition group-hover:scale-[1.02]"
                            />
                          ) : (
                            <BookOpen className="h-10 w-10 text-brand-library" aria-hidden="true" />
                          )}
                        </div>

                        <div className="flex flex-1 flex-col gap-2 p-3">
                          <h3 className="line-clamp-2 min-w-0 text-sm font-semibold text-foreground group-hover:text-brand-library">
                            {book.title}
                          </h3>
                          {book.author && (
                            <p className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
                              <User className="h-3 w-3 shrink-0" aria-hidden="true" />
                              <span className="truncate">{book.author}</span>
                            </p>
                          )}
                          <div className="mt-auto flex flex-wrap items-center gap-2">
                            {book.category && <StatusBadge value={book.category} fallback={book.category} />}
                            <span className="whitespace-nowrap text-xs text-muted-foreground">
                              {pluralize(readers, 'читатель', 'читателя', 'читателей')}
                            </span>
                          </div>
                        </div>
                      </Link>

                      <div className="flex flex-col gap-2 border-t border-border p-3">
                        <span
                          className={
                            available > 0
                              ? 'text-xs font-medium text-brand-library'
                              : 'text-xs font-medium text-muted-foreground'
                          }
                        >
                          {available > 0
                            ? `Свободно ${formatNumber(available)} из ${formatNumber(book.copies || 0)}`
                            : 'Все экземпляры на руках'}
                        </span>
                        {mine ? (
                          <Button variant="outline" className="min-h-[40px] w-full" disabled>
                            <BookMarked className="h-4 w-4" aria-hidden="true" />
                            Уже забронирована
                          </Button>
                        ) : (
                          <Button
                            className="min-h-[40px] w-full"
                            disabled={available <= 0 || isPending || !employeeId}
                            onClick={() => reserve.mutate(book.id)}
                            aria-label={`Забронировать книгу «${book.title}»`}
                          >
                            <BookMarked className="h-4 w-4" aria-hidden="true" />
                            {isPending ? 'Бронируем…' : 'Забронировать'}
                          </Button>
                        )}
                        {/* BUG-064: причина недоступности объяснена, а не молчание */}
                        {!employeeId ? (
                          <p className="text-xs text-muted-foreground">
                            Бронирование доступно после связывания учётной записи с карточкой сотрудника.
                          </p>
                        ) : available <= 0 ? (
                          <p className="text-xs text-muted-foreground">
                            Свободных экземпляров нет — попросите библиотекаря поставить вас в очередь.
                          </p>
                        ) : null}
                      </div>
                    </Card>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </PageContainer>
  );
}
