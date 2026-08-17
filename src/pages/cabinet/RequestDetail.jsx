import React, { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ChevronRight, ArrowLeft, ClipboardList, MessageSquare, CalendarDays,
  AlertTriangle, Undo2, Lock,
} from 'lucide-react';
import { api } from '@/api/client';
import PageContainer from '@/components/common/PageContainer';
import EmptyState from '@/components/common/EmptyState';
import ErrorState from '@/components/common/ErrorState';
import StatusBadge from '@/components/common/StatusBadge';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/lib/AuthContext';
import { formatDate, formatNumber, initials, isPast } from '@/lib/format';

/**
 * BUG-033: карточка служебной заявки не открывалась — из списка некуда было перейти,
 * переписку по заявке негде было вести.
 * BUG-072: у диалога подтверждения обязательна явная кнопка «Отмена».
 */

const MAX_REPLY = 2000;

function RequestSkeleton() {
  return (
    <div className="space-y-4" aria-hidden="true">
      <Card className="p-6 space-y-3">
        <div className="h-6 w-2/3 rounded bg-muted animate-pulse" />
        <div className="h-4 w-1/2 rounded bg-muted animate-pulse" />
        <div className="h-20 rounded bg-muted animate-pulse" />
      </Card>
      <Card className="h-32 bg-muted animate-pulse" />
    </div>
  );
}

/**
 * История статусов собирается из полей самой заявки — отдельной таблицы событий
 * в схеме нет, поэтому показываем только достоверные отметки времени.
 */
function buildTimeline(request) {
  const events = [];
  if (request.created_date) {
    events.push({ key: 'created', label: 'Заявка создана', date: request.created_date, status: 'pending' });
  }
  if (request.status === 'in_progress') {
    events.push({ key: 'in_progress', label: 'Заявка взята в работу', date: request.updated_date, status: 'in_progress' });
  }
  if (request.resolved_at) {
    events.push({
      key: 'resolved',
      label: request.status === 'rejected' ? 'Заявка закрыта без исполнения' : 'Заявка решена',
      date: request.resolved_at,
      status: request.status,
    });
  } else if (request.updated_date && request.updated_date !== request.created_date && request.status !== 'in_progress') {
    events.push({ key: 'updated', label: 'Последнее обновление', date: request.updated_date, status: request.status });
  }
  return events;
}

export default function RequestDetail() {
  const { id } = useParams();
  const { user, employeeId } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [reply, setReply] = useState('');
  const [replyTouched, setReplyTouched] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);

  const {
    data: request,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['service-request', id],
    queryFn: () => api.entities.ServiceRequest.get(id),
    enabled: !!id,
  });

  const {
    data: comments,
    isLoading: commentsLoading,
    error: commentsError,
    refetch: refetchComments,
  } = useQuery({
    queryKey: ['request-comments', id],
    queryFn: () => api.entities.RequestComment.filter({ request_id: id }, 'created_date'),
    enabled: !!id,
  });

  const addComment = useMutation({
    mutationFn: (body) =>
      api.entities.RequestComment.create({
        request_id: id,
        user_id: user.id,
        author_name: user.full_name || user.email,
        body,
      }),
    onSuccess: () => {
      setReply('');
      setReplyTouched(false);
      toast({ title: 'Сообщение отправлено' });
      qc.invalidateQueries({ queryKey: ['request-comments', id] });
    },
    onError: (err) =>
      toast({ title: 'Не удалось отправить сообщение', description: err?.message, variant: 'destructive' }),
  });

  /**
   * Отзыв заявки. В схеме у service_requests статуса «отозвана» нет
   * (request_status: pending / in_progress / resolved / rejected), поэтому заявка
   * закрывается как rejected с явной пометкой в поле resolution — так и в истории
   * видно, что решение принял сам автор, а не исполнитель.
   */
  const withdraw = useMutation({
    mutationFn: () =>
      api.entities.ServiceRequest.update(id, {
        status: 'rejected',
        resolution: 'Заявка отозвана автором',
        resolved_at: new Date().toISOString(),
      }),
    onSuccess: () => {
      setWithdrawOpen(false);
      toast({ title: 'Заявка отозвана' });
      qc.invalidateQueries({ queryKey: ['service-request', id] });
      qc.invalidateQueries({ queryKey: ['service-requests'] });
      qc.invalidateQueries({ queryKey: ['portal-stats'] });
    },
    onError: (err) =>
      toast({ title: 'Не удалось отозвать заявку', description: err?.message, variant: 'destructive' }),
  });

  const trimmed = reply.trim();
  const replyInvalid = trimmed.length === 0 || trimmed.length > MAX_REPLY;

  const breadcrumbs = (
    <nav aria-label="Хлебные крошки" className="mb-4">
      <ol className="flex items-center gap-1.5 text-sm text-muted-foreground flex-wrap">
        <li>
          <Link to="/cabinet/requests" className="hover:text-foreground transition-colors">
            Служебные заявки
          </Link>
        </li>
        <li aria-hidden="true">
          <ChevronRight className="w-3.5 h-3.5" />
        </li>
        <li className="text-foreground font-medium truncate max-w-[60vw]" aria-current="page">
          {request?.title || 'Заявка'}
        </li>
      </ol>
    </nav>
  );

  if (error) {
    return (
      <PageContainer title="Служебная заявка" width="narrow">
        <ErrorState error={error} onRetry={refetch} />
      </PageContainer>
    );
  }

  if (isLoading) {
    return (
      <PageContainer title="Служебная заявка" width="narrow">
        <RequestSkeleton />
      </PageContainer>
    );
  }

  if (!request) {
    return (
      <PageContainer title="Служебная заявка" width="narrow">
        <EmptyState
          icon={ClipboardList}
          title="Заявка не найдена"
          description="Заявка удалена или у вас нет прав на её просмотр."
          action={
            <Button asChild>
              <Link to="/cabinet/requests">
                <ArrowLeft className="w-4 h-4" aria-hidden="true" />
                Ко всем заявкам
              </Link>
            </Button>
          }
        />
      </PageContainer>
    );
  }

  const isAuthor = !!employeeId && request.employee_id === employeeId;
  const canWithdraw = isAuthor && request.status === 'pending';
  const overdue = request.due_date && request.status !== 'resolved' && isPast(request.due_date);
  const timeline = buildTimeline(request);
  const commentList = comments || [];

  return (
    <PageContainer
      title={request.title}
      documentTitle={request.title}
      width="narrow"
      breadcrumbs={breadcrumbs}
      actions={
        canWithdraw ? (
          <Button variant="outline" onClick={() => setWithdrawOpen(true)}>
            <Undo2 className="w-4 h-4" aria-hidden="true" />
            Отозвать заявку
          </Button>
        ) : null
      }
    >
      <Card className="p-6">
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <StatusBadge value={request.status} />
          <StatusBadge value={request.type} />
          <StatusBadge value={request.priority} fallback="Приоритет не указан" />
        </div>

        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm mb-5">
          <div className="flex items-center gap-2">
            <CalendarDays className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
            <dt className="text-muted-foreground">Создана:</dt>
            <dd className="text-foreground">{formatDate(request.created_date, 'datetime')}</dd>
          </div>
          {request.due_date && (
            <div className="flex items-center gap-2">
              <CalendarDays className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
              <dt className="text-muted-foreground">Срок:</dt>
              <dd className={overdue ? 'text-destructive font-medium' : 'text-foreground'}>
                {formatDate(request.due_date, 'long')}
                {overdue && ' — просрочено'}
              </dd>
            </div>
          )}
          {request.employee_name && (
            <div className="flex items-center gap-2">
              <dt className="text-muted-foreground">Автор:</dt>
              <dd className="text-foreground">{request.employee_name}</dd>
            </div>
          )}
          {request.resolved_at && (
            <div className="flex items-center gap-2">
              <dt className="text-muted-foreground">Закрыта:</dt>
              <dd className="text-foreground">{formatDate(request.resolved_at, 'datetime')}</dd>
            </div>
          )}
        </dl>

        {request.body ? (
          <div className="space-y-3 text-[15px] leading-relaxed text-muted-foreground">
            {String(request.body)
              .replace(/\r\n/g, '\n')
              .split(/\n{2,}/)
              .map((p) => p.trim())
              .filter(Boolean)
              .map((p, i) => (
                <p key={i}>{p}</p>
              ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Описание к заявке не приложено.</p>
        )}

        {request.resolution && (
          <div className="mt-5 rounded-lg border border-border bg-muted/40 p-4">
            <p className="text-sm font-medium text-foreground mb-1">Решение</p>
            <p className="text-sm text-muted-foreground whitespace-pre-line">{request.resolution}</p>
          </div>
        )}

        {overdue && (
          <div className="mt-5 flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
            <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" aria-hidden="true" />
            <p className="text-foreground">
              Срок исполнения прошёл {formatDate(request.due_date, 'long')}. Напомните исполнителю в переписке ниже.
            </p>
          </div>
        )}
      </Card>

      {/* ------------------------------------------------------- история статусов */}

      <Card className="p-6 mt-4">
        <h2 className="text-lg font-semibold text-foreground mb-4">История статусов</h2>
        <ol className="space-y-4" role="list">
          {timeline.map((event) => (
            <li key={event.key} className="flex items-start gap-3" role="listitem">
              <span className="mt-1.5 w-2 h-2 rounded-full bg-primary shrink-0" aria-hidden="true" />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-foreground">{event.label}</span>
                  <StatusBadge value={event.status} />
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{formatDate(event.date, 'datetime')}</p>
              </div>
            </li>
          ))}
        </ol>
      </Card>

      {/* ------------------------------------------------------------- переписка */}

      <section className="mt-4" aria-labelledby="request-comments-heading">
        <h2 id="request-comments-heading" className="text-lg font-semibold text-foreground mb-3">
          Переписка по заявке{' '}
          <span className="text-sm font-normal text-muted-foreground">({commentList.length})</span>
        </h2>

        <Card className="p-4 mb-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setReplyTouched(true);
              if (replyInvalid) return;
              addComment.mutate(trimmed);
            }}
          >
            <label htmlFor="request-reply" className="block text-sm font-medium text-foreground mb-1.5">
              Ваш ответ
            </label>
            <Textarea
              id="request-reply"
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              onBlur={() => setReplyTouched(true)}
              placeholder="Уточните детали или задайте вопрос исполнителю"
              aria-invalid={replyTouched && replyInvalid}
              aria-describedby={replyTouched && replyInvalid ? 'reply-error' : undefined}
              disabled={!user?.id || addComment.isPending}
            />
            {replyTouched && replyInvalid && (
              <p id="reply-error" role="alert" className="mt-1.5 text-sm text-destructive">
                {trimmed.length === 0
                  ? 'Сообщение не может быть пустым.'
                  : `Слишком длинное сообщение — максимум ${formatNumber(MAX_REPLY)} символов.`}
              </p>
            )}
            <div className="flex items-center justify-between gap-2 mt-3">
              <span className="text-xs text-muted-foreground">
                {formatNumber(trimmed.length)} / {formatNumber(MAX_REPLY)}
              </span>
              <Button type="submit" disabled={replyInvalid || addComment.isPending || !user?.id}>
                {addComment.isPending ? 'Отправка…' : 'Отправить'}
              </Button>
            </div>
          </form>
        </Card>

        {commentsError ? (
          <ErrorState error={commentsError} onRetry={refetchComments} compact />
        ) : commentsLoading ? (
          <div className="space-y-2" aria-hidden="true">
            {[0, 1].map((i) => (
              <Card key={i} className="p-4 h-20 bg-muted animate-pulse" />
            ))}
          </div>
        ) : commentList.length === 0 ? (
          <EmptyState
            icon={MessageSquare}
            title="Сообщений пока нет"
            description="Напишите первым — исполнитель увидит сообщение в карточке заявки."
            compact
          />
        ) : (
          <ul className="space-y-2" role="list">
            {commentList.map((comment) => (
              <li key={comment.id} role="listitem">
                <Card className="p-4">
                  <div className="flex items-start gap-3">
                    <span
                      className="w-9 h-9 rounded-full bg-muted text-muted-foreground text-xs font-semibold flex items-center justify-center shrink-0"
                      aria-hidden="true"
                    >
                      {initials(comment.author_name)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <span className="text-sm font-medium text-foreground">
                          {comment.author_name || 'Сотрудник'}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {formatDate(comment.created_date, 'datetime')}
                        </span>
                        {comment.is_internal && (
                          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                            <Lock className="w-3 h-3" aria-hidden="true" />
                            служебная заметка
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground whitespace-pre-line break-words">
                        {comment.body}
                      </p>
                    </div>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* BUG-072: подтверждение с явной кнопкой «Отмена». */}
      <Dialog open={withdrawOpen} onOpenChange={setWithdrawOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Отозвать заявку?</DialogTitle>
            <DialogDescription>
              Заявка «{request.title}» будет закрыта с пометкой «Отозвана автором». Исполнитель
              перестанет её видеть в работе. Чтобы вернуться к вопросу, придётся создать новую заявку.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setWithdrawOpen(false)}>
              Отмена
            </Button>
            <Button variant="destructive" onClick={() => withdraw.mutate()} disabled={withdraw.isPending}>
              {withdraw.isPending ? 'Отзываем…' : 'Отозвать заявку'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
