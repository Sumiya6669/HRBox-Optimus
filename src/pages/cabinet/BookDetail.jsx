import React, { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  BookOpen, ChevronRight, ArrowLeft, Users, Layers, BookMarked, CalendarDays,
} from 'lucide-react';
import { api } from '@/api/client';
import PageContainer from '@/components/common/PageContainer';
import EmptyState from '@/components/common/EmptyState';
import ErrorState from '@/components/common/ErrorState';
import StatusBadge from '@/components/common/StatusBadge';
import SafeImage from '@/components/common/SafeImage';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/lib/AuthContext';
import { formatDate, formatNumber, pluralize } from '@/lib/format';

/**
 * BUG-064: в библиотеке «3 экз.» были просто текстом — забронировать книгу
 * было негде, а карточка книги не открывалась.
 * Свободные экземпляры считает вьюха v_books, бронь оформляет RPC reserve_book
 * (там же проверка «свободных нет»), поэтому гонок за последний экземпляр нет.
 */

const ACTIVE_LOAN_STATUSES = ['reserved', 'issued'];

const LOAN_STATUS_FALLBACK = {
  reserved: 'Забронирована',
  issued: 'На руках',
  returned: 'Возвращена',
  cancelled: 'Бронь отменена',
};

function BookSkeleton() {
  return (
    <div className="space-y-4" aria-hidden="true">
      <Card className="p-6 flex gap-6">
        <div className="w-32 h-44 rounded-lg bg-muted animate-pulse shrink-0" />
        <div className="flex-1 space-y-3">
          <div className="h-6 w-2/3 rounded bg-muted animate-pulse" />
          <div className="h-4 w-1/3 rounded bg-muted animate-pulse" />
          <div className="h-20 rounded bg-muted animate-pulse" />
        </div>
      </Card>
    </div>
  );
}

function StatTile({ icon: Icon, label, value }) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 text-muted-foreground mb-2">
        <Icon className="w-4 h-4" aria-hidden="true" />
        <span className="text-xs">{label}</span>
      </div>
      <p className="text-xl font-semibold text-foreground leading-none">{value}</p>
    </Card>
  );
}

export default function BookDetail() {
  const { id } = useParams();
  const { employeeId } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [reserveError, setReserveError] = useState(null);

  const {
    data: book,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['book-detail', id],
    queryFn: async () => {
      const { data, error: err } = await api.supabase.from('v_books').select('*').eq('id', id).maybeSingle();
      if (err) throw err;
      return data;
    },
    enabled: !!id,
  });

  const {
    data: loans,
    isLoading: loansLoading,
    error: loansError,
    refetch: refetchLoans,
  } = useQuery({
    queryKey: ['book-loans', id, employeeId],
    queryFn: () => api.entities.BookLoan.filter({ book_id: id, employee_id: employeeId }, '-created_date'),
    enabled: !!id && !!employeeId,
  });

  const reserve = useMutation({
    mutationFn: async () => {
      const { data, error: err } = await api.supabase.rpc('reserve_book', { p_book_id: id });
      if (err) throw err;
      return data;
    },
    onSuccess: (loan) => {
      setReserveError(null);
      toast({
        title: 'Книга забронирована',
        description: loan?.due_date
          ? `Заберите её у HR. Вернуть до ${formatDate(loan.due_date)}.`
          : 'Заберите её у HR-службы.',
      });
      qc.invalidateQueries({ queryKey: ['book-detail', id] });
      qc.invalidateQueries({ queryKey: ['book-loans', id, employeeId] });
      qc.invalidateQueries({ queryKey: ['books'] });
    },
    onError: (err) => {
      setReserveError(err);
      toast({ title: 'Не удалось забронировать', description: err?.message, variant: 'destructive' });
    },
  });

  const breadcrumbs = (
    <nav aria-label="Хлебные крошки" className="mb-4">
      <ol className="flex items-center gap-1.5 text-sm text-muted-foreground flex-wrap">
        <li>
          <Link to="/cabinet/library" className="hover:text-foreground transition-colors">
            Библиотека
          </Link>
        </li>
        <li aria-hidden="true">
          <ChevronRight className="w-3.5 h-3.5" />
        </li>
        <li className="text-foreground font-medium truncate max-w-[60vw]" aria-current="page">
          {book?.title || 'Книга'}
        </li>
      </ol>
    </nav>
  );

  if (error) {
    return (
      <PageContainer title="Книга" width="narrow">
        <ErrorState error={error} onRetry={refetch} />
      </PageContainer>
    );
  }

  if (isLoading) {
    return (
      <PageContainer title="Книга" width="narrow">
        <BookSkeleton />
      </PageContainer>
    );
  }

  if (!book) {
    return (
      <PageContainer title="Книга" width="narrow">
        <EmptyState
          icon={BookOpen}
          title="Книга не найдена"
          description="Возможно, издание убрали из библиотеки или ссылка устарела."
          action={
            <Button asChild>
              <Link to="/cabinet/library">
                <ArrowLeft className="w-4 h-4" aria-hidden="true" />
                Ко всей библиотеке
              </Link>
            </Button>
          }
        />
      </PageContainer>
    );
  }

  const available = Number(book.available_count) || 0;
  const loanList = loans || [];
  const activeLoan = loanList.find((l) => ACTIVE_LOAN_STATUSES.includes(l.status)) || null;

  // Кнопка не должна «молча ничего не делать»: у каждого запрета есть текстовое пояснение.
  let reserveBlockReason = null;
  if (!employeeId) reserveBlockReason = 'Учётная запись не связана с карточкой сотрудника — бронь недоступна.';
  else if (activeLoan) reserveBlockReason = 'Экземпляр уже закреплён за вами.';
  else if (available <= 0) reserveBlockReason = 'Свободных экземпляров нет — дождитесь, пока книгу вернут.';

  return (
    <PageContainer title={book.title} documentTitle={book.title} width="narrow" breadcrumbs={breadcrumbs}>
      <Card className="p-6">
        <div className="flex flex-col sm:flex-row gap-6">
          {/* Обложка декоративна — название и автор выведены рядом текстом */}
          <SafeImage
            src={book.cover_url}
            alt=""
            loading="eager"
            className="w-32 h-44 rounded-lg object-cover shrink-0 self-center sm:self-start"
            fallbackIcon={BookOpen}
            fallbackClassName="bg-brand-library/15 text-brand-library"
          />

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 mb-3">
              {book.category && <StatusBadge value={book.category} fallback={book.category} />}
              <StatusBadge
                value={available > 0 ? 'active' : 'inactive'}
                fallback={available > 0 ? 'Есть в наличии' : 'Нет свободных'}
              />
            </div>

            {book.author && (
              <p className="text-sm text-muted-foreground mb-3">
                Автор: <span className="text-foreground">{book.author}</span>
              </p>
            )}

            {book.description ? (
              <div className="space-y-3 text-[15px] leading-relaxed text-muted-foreground">
                {String(book.description)
                  .replace(/\r\n/g, '\n')
                  .split(/\n{2,}/)
                  .map((p) => p.trim())
                  .filter(Boolean)
                  .map((p, i) => (
                    <p key={i}>{p}</p>
                  ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Описание книги пока не заполнено.</p>
            )}

            <div className="mt-5">
              <Button
                onClick={() => reserve.mutate()}
                disabled={!!reserveBlockReason || reserve.isPending}
                aria-describedby={reserveBlockReason ? 'reserve-hint' : undefined}
              >
                <BookMarked className="w-4 h-4" aria-hidden="true" />
                {reserve.isPending ? 'Бронируем…' : 'Забронировать'}
              </Button>
              {reserveBlockReason && (
                <p id="reserve-hint" className="mt-2 text-sm text-muted-foreground">
                  {reserveBlockReason}
                </p>
              )}
              {reserveError && !reserveBlockReason && (
                <p role="alert" className="mt-2 text-sm text-destructive">
                  {reserveError.message || 'Не удалось оформить бронь. Попробуйте ещё раз.'}
                </p>
              )}
            </div>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
        <StatTile icon={Layers} label="Всего экземпляров" value={formatNumber(book.copies || 0)} />
        <StatTile icon={BookMarked} label="Свободно сейчас" value={formatNumber(available)} />
        <StatTile icon={Users} label="Прочитали" value={formatNumber(book.readers_count || 0)} />
      </div>

      {/* --------------------------------------------------------------- мои брони */}

      <Card className="p-6 mt-4">
        <h2 className="text-lg font-semibold text-foreground mb-4">Мои брони и выдачи</h2>

        {!employeeId ? (
          <EmptyState
            icon={Users}
            title="Учётная запись не связана с карточкой сотрудника"
            description="Бронирование книг откроется после того, как HR привяжет вашу учётную запись."
            compact
          />
        ) : loansError ? (
          <ErrorState error={loansError} onRetry={refetchLoans} compact />
        ) : loansLoading ? (
          <div className="h-20 rounded-lg bg-muted animate-pulse" aria-hidden="true" />
        ) : loanList.length === 0 ? (
          <EmptyState
            icon={BookMarked}
            title="Вы ещё не брали эту книгу"
            description={
              available > 0
                ? 'Забронируйте экземпляр — он будет ждать вас у HR-службы.'
                : 'Сейчас все экземпляры на руках. Загляните позже.'
            }
            compact
          />
        ) : (
          <ul className="space-y-2" role="list">
            {loanList.map((loan) => (
              <li key={loan.id} role="listitem">
                <Card className="p-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <StatusBadge value={loan.status} fallback={LOAN_STATUS_FALLBACK[loan.status]} />
                    <p className="text-xs text-muted-foreground mt-1.5 inline-flex items-center gap-1.5">
                      <CalendarDays className="w-3.5 h-3.5" aria-hidden="true" />
                      Бронь от {formatDate(loan.reserved_at || loan.created_date)}
                      {loan.issued_at ? ` · выдана ${formatDate(loan.issued_at)}` : ''}
                      {loan.returned_at ? ` · возвращена ${formatDate(loan.returned_at)}` : ''}
                    </p>
                  </div>
                  {loan.due_date && ACTIVE_LOAN_STATUSES.includes(loan.status) && (
                    <span className="text-sm text-muted-foreground">
                      Вернуть до {formatDate(loan.due_date)}
                    </span>
                  )}
                </Card>
              </li>
            ))}
          </ul>
        )}

        {loanList.length > 0 && (
          <p className="text-xs text-muted-foreground mt-3">
            Всего по этой книге у вас {pluralize(loanList.length, 'запись', 'записи', 'записей')}.
          </p>
        )}
      </Card>
    </PageContainer>
  );
}
