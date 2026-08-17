import React, { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, Heart, Star, Share2, MessageSquare, Eye, CalendarDays,
  Trash2, Newspaper, ChevronRight,
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
import { formatDate, formatNumber, pluralize, initials } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * BUG-032: «Читать далее» вело в общий список новостей — детальной страницы не было.
 * BUG-031: лайк был декоративным (менял только цвет иконки).
 * Аудит также отмечал: добавить новость в избранное было неоткуда.
 */

const MAX_COMMENT = 2000;

function DetailSkeleton() {
  return (
    <div className="space-y-4" aria-hidden="true">
      <Card className="p-6 space-y-3">
        <div className="h-7 w-2/3 rounded bg-muted animate-pulse" />
        <div className="h-4 w-1/3 rounded bg-muted animate-pulse" />
        <div className="pt-4 space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-4 rounded bg-muted animate-pulse" style={{ width: `${95 - i * 8}%` }} />
          ))}
        </div>
      </Card>
    </div>
  );
}

/** Тело новости — обычный текст: разбиваем на абзацы, React экранирует содержимое. */
function NewsBody({ body }) {
  const paragraphs = String(body || '')
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  if (!paragraphs.length) {
    return <p className="text-sm text-muted-foreground">У этой новости нет текста — только заголовок.</p>;
  }
  return (
    <div className="space-y-4 text-[15px] leading-relaxed text-muted-foreground">
      {paragraphs.map((p, i) => (
        <p key={i}>{p}</p>
      ))}
    </div>
  );
}

export default function NewsDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const viewRegistered = useRef(null);

  const [commentText, setCommentText] = useState('');
  const [commentTouched, setCommentTouched] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null);

  /* ------------------------------------------------------------------ данные */

  const {
    data: news,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['news-detail', id],
    queryFn: async () => {
      const { data, error: err } = await api.supabase.from('v_news').select('*').eq('id', id).maybeSingle();
      if (err) throw err;
      return data;
    },
    enabled: !!id,
  });

  const { data: myLike } = useQuery({
    queryKey: ['news-like', id, user?.id],
    queryFn: async () => {
      const rows = await api.entities.NewsLike.filter({ news_id: id, user_id: user.id }, null, 1);
      return rows?.length > 0;
    },
    enabled: !!id && !!user?.id,
  });

  const { data: favorite } = useQuery({
    queryKey: ['favorite', 'news', id, user?.id],
    queryFn: async () => {
      const rows = await api.entities.Favorite.filter(
        { user_id: user.id, item_type: 'news', item_id: id },
        null,
        1
      );
      return rows?.[0] || null;
    },
    enabled: !!id && !!user?.id,
  });

  const {
    data: comments,
    isLoading: commentsLoading,
    error: commentsError,
    refetch: refetchComments,
  } = useQuery({
    queryKey: ['news-comments', id],
    queryFn: () => api.entities.Comment.filter({ entity_type: 'news', entity_id: id }, 'created_date'),
    enabled: !!id,
  });

  /* -------------------------------------------------- регистрация просмотра */

  // Счётчик просмотров ведёт сервер, а не поле из интерфейса. Ref спасает от
  // двойного вызова в React.StrictMode; ошибку глотаем — чтение важнее счётчика.
  useEffect(() => {
    if (!id || !news || viewRegistered.current === id) return;
    viewRegistered.current = id;
    api.supabase.rpc('register_news_view', { p_news_id: id }).catch(() => {});
  }, [id, news]);

  /* ---------------------------------------------------------------- мутации */

  // BUG-031: рабочий лайк с оптимистичным обновлением обеих затронутых записей кэша.
  const toggleLike = useMutation({
    mutationFn: async () => {
      const { data, error: err } = await api.supabase.rpc('toggle_news_like', { p_news_id: id });
      if (err) throw err;
      return data;
    },
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: ['news-detail', id] });
      await qc.cancelQueries({ queryKey: ['news-like', id, user?.id] });
      const prevNews = qc.getQueryData(['news-detail', id]);
      const prevLiked = qc.getQueryData(['news-like', id, user?.id]);
      const nextLiked = !prevLiked;
      qc.setQueryData(['news-like', id, user?.id], nextLiked);
      if (prevNews) {
        qc.setQueryData(['news-detail', id], {
          ...prevNews,
          likes: Math.max(0, (prevNews.likes || 0) + (nextLiked ? 1 : -1)),
        });
      }
      return { prevNews, prevLiked };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.prevNews !== undefined) qc.setQueryData(['news-detail', id], ctx.prevNews);
      if (ctx?.prevLiked !== undefined) qc.setQueryData(['news-like', id, user?.id], ctx.prevLiked);
      toast({ title: 'Не удалось изменить отметку', description: err?.message, variant: 'destructive' });
    },
    onSuccess: (data) => {
      if (data && typeof data === 'object') {
        qc.setQueryData(['news-like', id, user?.id], !!data.liked);
        const current = qc.getQueryData(['news-detail', id]);
        if (current) qc.setQueryData(['news-detail', id], { ...current, likes: Number(data.likes) || 0 });
      }
    },
  });

  const toggleFavorite = useMutation({
    mutationFn: async () => {
      if (favorite) {
        await api.entities.Favorite.delete(favorite.id);
        return false;
      }
      await api.entities.Favorite.create({
        user_id: user.id,
        item_type: 'news',
        item_id: id,
        item_title: news?.title || 'Новость',
        item_image: news?.image_url || null,
        item_meta: news?.published_date ? formatDate(news.published_date) : null,
      });
      return true;
    },
    onSuccess: (added) => {
      toast({ title: added ? 'Добавлено в избранное' : 'Удалено из избранного' });
      qc.invalidateQueries({ queryKey: ['favorite', 'news', id, user?.id] });
      qc.invalidateQueries({ queryKey: ['favorites'] });
    },
    onError: (err) =>
      toast({ title: 'Не удалось изменить избранное', description: err?.message, variant: 'destructive' }),
  });

  const addComment = useMutation({
    mutationFn: (body) =>
      api.entities.Comment.create({
        entity_type: 'news',
        entity_id: id,
        user_id: user.id,
        author_name: user.full_name || user.email,
        body,
      }),
    onSuccess: () => {
      setCommentText('');
      setCommentTouched(false);
      toast({ title: 'Комментарий добавлен' });
      qc.invalidateQueries({ queryKey: ['news-comments', id] });
      qc.invalidateQueries({ queryKey: ['news-detail', id] });
    },
    onError: (err) =>
      toast({ title: 'Не удалось отправить комментарий', description: err?.message, variant: 'destructive' }),
  });

  const removeComment = useMutation({
    mutationFn: (commentId) => api.entities.Comment.delete(commentId),
    onSuccess: () => {
      setPendingDelete(null);
      toast({ title: 'Комментарий удалён' });
      qc.invalidateQueries({ queryKey: ['news-comments', id] });
      qc.invalidateQueries({ queryKey: ['news-detail', id] });
    },
    onError: (err) =>
      toast({ title: 'Не удалось удалить комментарий', description: err?.message, variant: 'destructive' }),
  });

  /* ------------------------------------------------------------- вспомогательное */

  const share = async () => {
    const url = window.location.href;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        toast({ title: 'Ссылка скопирована', description: 'Отправьте её коллегам в мессенджере или почте.' });
        return;
      }
      throw new Error('clipboard-unavailable');
    } catch {
      // Буфер обмена недоступен (нет https или запрет браузера) — показываем адрес,
      // чтобы пользователь мог скопировать его вручную, а не остался без обратной связи.
      toast({ title: 'Скопируйте ссылку вручную', description: url, variant: 'destructive' });
    }
  };

  const trimmed = commentText.trim();
  const commentInvalid = trimmed.length === 0 || trimmed.length > MAX_COMMENT;

  const breadcrumbs = (
    <nav aria-label="Хлебные крошки" className="mb-4">
      <ol className="flex items-center gap-1.5 text-sm text-muted-foreground flex-wrap">
        <li>
          <Link to="/cabinet/news" className="hover:text-foreground transition-colors">
            Новости
          </Link>
        </li>
        <li aria-hidden="true">
          <ChevronRight className="w-3.5 h-3.5" />
        </li>
        <li className="text-foreground font-medium truncate max-w-[60vw]" aria-current="page">
          {news?.title || 'Новость'}
        </li>
      </ol>
    </nav>
  );

  /* ------------------------------------------------------------------ рендер */

  if (error) {
    return (
      <PageContainer title="Новость" width="narrow">
        <ErrorState error={error} onRetry={refetch} />
      </PageContainer>
    );
  }

  if (isLoading) {
    return (
      <PageContainer title="Новость" width="narrow">
        <DetailSkeleton />
      </PageContainer>
    );
  }

  if (!news) {
    return (
      <PageContainer title="Новость" width="narrow">
        <EmptyState
          icon={Newspaper}
          title="Новость не найдена"
          description="Возможно, публикацию сняли с сайта или ссылка устарела."
          action={
            <Button asChild>
              <Link to="/cabinet/news">
                <ArrowLeft className="w-4 h-4" aria-hidden="true" />
                Ко всем новостям
              </Link>
            </Button>
          }
        />
      </PageContainer>
    );
  }

  const liked = !!myLike;
  const commentList = comments || [];

  return (
    <PageContainer title={news.title} documentTitle={news.title} width="narrow" breadcrumbs={breadcrumbs}>
      <Card className="overflow-hidden">
        {news.image_url && (
          <img src={news.image_url} alt="" className="w-full max-h-80 object-cover" />
        )}
        <div className="p-6">
          <div className="flex flex-wrap items-center gap-2 mb-3">
            {news.category && <StatusBadge value={news.category} />}
            {news.pinned && <StatusBadge value="announcement" fallback="Закреплено" />}
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground mb-5">
            <span className="inline-flex items-center gap-1.5">
              <CalendarDays className="w-3.5 h-3.5" aria-hidden="true" />
              {formatDate(news.published_date, 'long')}
            </span>
            {news.author_name && <span>Автор: {news.author_name}</span>}
            <span className="inline-flex items-center gap-1.5">
              <Eye className="w-3.5 h-3.5" aria-hidden="true" />
              {pluralize(news.views || 0, 'просмотр', 'просмотра', 'просмотров')}
            </span>
          </div>

          {news.excerpt && <p className="text-base font-medium text-foreground mb-4">{news.excerpt}</p>}

          <NewsBody body={news.body} />

          <div className="flex flex-wrap items-center gap-2 mt-6 pt-5 border-t border-border">
            <Button
              variant={liked ? 'default' : 'outline'}
              onClick={() => toggleLike.mutate()}
              disabled={toggleLike.isPending || !user?.id}
              aria-pressed={liked}
              aria-label={liked ? 'Убрать отметку «Нравится»' : 'Поставить отметку «Нравится»'}
            >
              <Heart className={cn('w-4 h-4', liked && 'fill-current')} aria-hidden="true" />
              Нравится · {formatNumber(news.likes || 0)}
            </Button>

            <Button
              variant={favorite ? 'default' : 'outline'}
              onClick={() => toggleFavorite.mutate()}
              disabled={toggleFavorite.isPending || !user?.id}
              aria-pressed={!!favorite}
            >
              <Star className={cn('w-4 h-4', favorite && 'fill-current')} aria-hidden="true" />
              {favorite ? 'В избранном' : 'В избранное'}
            </Button>

            <Button variant="outline" onClick={share} aria-label="Скопировать ссылку на новость">
              <Share2 className="w-4 h-4" aria-hidden="true" />
              Поделиться
            </Button>
          </div>
        </div>
      </Card>

      {/* ------------------------------------------------------------ комментарии */}

      <section className="mt-6" aria-labelledby="comments-heading">
        <h2 id="comments-heading" className="text-lg font-semibold text-foreground mb-3">
          Комментарии{' '}
          <span className="text-sm font-normal text-muted-foreground">({commentList.length})</span>
        </h2>

        <Card className="p-4 mb-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setCommentTouched(true);
              if (commentInvalid) return;
              addComment.mutate(trimmed);
            }}
          >
            <label htmlFor="new-comment" className="block text-sm font-medium text-foreground mb-1.5">
              Ваш комментарий
            </label>
            <Textarea
              id="new-comment"
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              onBlur={() => setCommentTouched(true)}
              placeholder="Напишите, что думаете о новости"
              aria-invalid={commentTouched && commentInvalid}
              aria-describedby={commentTouched && commentInvalid ? 'comment-error' : undefined}
              disabled={!user?.id || addComment.isPending}
            />
            {commentTouched && commentInvalid && (
              <p id="comment-error" role="alert" className="mt-1.5 text-sm text-destructive">
                {trimmed.length === 0
                  ? 'Комментарий не может быть пустым.'
                  : `Слишком длинный комментарий — максимум ${formatNumber(MAX_COMMENT)} символов.`}
              </p>
            )}
            <div className="flex items-center justify-between gap-2 mt-3">
              <span className="text-xs text-muted-foreground">
                {formatNumber(trimmed.length)} / {formatNumber(MAX_COMMENT)}
              </span>
              <Button type="submit" disabled={commentInvalid || addComment.isPending || !user?.id}>
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
            title="Комментариев пока нет"
            description="Будьте первым, кто оставит мнение об этой новости."
            compact
          />
        ) : (
          <ul className="space-y-2" role="list">
            {commentList.map((comment) => {
              const mine = comment.user_id === user?.id;
              return (
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
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground whitespace-pre-line break-words">
                          {comment.body}
                        </p>
                      </div>
                      {mine && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="text-muted-foreground hover:text-destructive shrink-0"
                          aria-label="Удалить свой комментарий"
                          onClick={() => setPendingDelete(comment)}
                        >
                          <Trash2 className="w-4 h-4" aria-hidden="true" />
                        </Button>
                      )}
                    </div>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* BUG-072: в диалоге обязательна явная кнопка «Отмена», а не только крестик. */}
      <Dialog open={!!pendingDelete} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Удалить комментарий?</DialogTitle>
            <DialogDescription>
              Комментарий исчезнет у всех сотрудников. Действие нельзя отменить.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setPendingDelete(null)}>
              Отмена
            </Button>
            <Button
              variant="destructive"
              onClick={() => removeComment.mutate(pendingDelete.id)}
              disabled={removeComment.isPending}
            >
              {removeComment.isPending ? 'Удаление…' : 'Удалить'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
