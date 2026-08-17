import React, { useDeferredValue, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import { createEntity } from "@/api/entity";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Newspaper, Search, Eye, Heart, Pin, MessageSquare, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/use-toast";
import { useAuth } from "@/lib/AuthContext";
import PageContainer from "@/components/common/PageContainer";
import EmptyState from "@/components/common/EmptyState";
import ErrorState from "@/components/common/ErrorState";
import StatusBadge from "@/components/common/StatusBadge";
import { statusLabel } from "@/lib/statusLabels";
import { formatDate, formatNumber, pluralize } from "@/lib/format";

/**
 * Лента новостей портала.
 * BUG-013: читаем только опубликованные новости из вьюхи v_news — каждая новость выводится один раз.
 * BUG-031: сердечко было декоративным. Теперь это кнопка с aria-pressed, RPC toggle_news_like
 *          и оптимистичным обновлением счётчика.
 * BUG-032: карточка и «Читать далее» ведут на /cabinet/news/:id.
 * BUG-051: категория выводится StatusBadge, а не английским кодом.
 * BUG-053: все даты — через formatDate.
 * Пагинация: серверная, по 12 записей (раньше страница тянула 50 записей и обрывала список).
 */

/**
 * v_news недоступна через api.entities (там базовая таблица news), поэтому создаём
 * доступ к вьюхе напрямую — так получаем и агрегаты (likes, comments_count),
 * и серверную пагинацию .page({ where, sort, page, pageSize }).
 */
const newsView = createEntity("v_news", { defaultSort: "-published_date" });

const PAGE_SIZE = 12;
const CATEGORIES = ["company", "product", "event", "announcement", "training"];

function NewsSkeleton() {
  return (
    <div className="space-y-3" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <Card key={i} className="p-4 animate-pulse flex gap-4">
          <div className="w-24 h-24 rounded-lg bg-muted shrink-0" />
          <div className="flex-1 space-y-3 py-1">
            <div className="h-3 w-24 bg-muted/60 rounded" />
            <div className="h-4 w-2/3 bg-muted rounded" />
            <div className="h-3 w-full bg-muted/60 rounded" />
          </div>
        </Card>
      ))}
    </div>
  );
}

export default function CabinetNews() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { user } = useAuth();
  const userId = user?.id || null;

  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [category, setCategory] = useState("all");
  const [page, setPage] = useState(1);

  const query = deferredSearch.trim();
  const where = useMemo(() => {
    const w = { status: "published", pinned: false };
    if (category !== "all") w.category = category;
    if (query) w.title = { ilike: `%${query}%` };
    return w;
  }, [category, query]);

  /* ------------------------------------------------------------ данные */

  // Закреплённые новости всегда идут первыми и показываются на первой странице.
  const pinnedQuery = useQuery({
    queryKey: ["news-pinned", category, query],
    queryFn: () =>
      newsView.filter(
        {
          status: "published",
          pinned: true,
          ...(category !== "all" ? { category } : {}),
          ...(query ? { title: { ilike: `%${query}%` } } : {}),
        },
        "-published_date"
      ),
    placeholderData: (prev) => prev, // смена фильтра не роняет список в скелетон
  });

  const pageQuery = useQuery({
    queryKey: ["news-page", where, page],
    queryFn: () => newsView.page({ where, sort: "-published_date", page, pageSize: PAGE_SIZE }),
    placeholderData: (prev) => prev, // при листании не мигаем скелетоном
  });

  // Счётчики для чипов — по всем опубликованным новостям.
  const countsQuery = useQuery({
    queryKey: ["news-category-counts"],
    queryFn: async () => {
      const { data, error } = await api.supabase.from("v_news").select("category").eq("status", "published");
      if (error) throw error;
      return data || [];
    },
  });

  // Свои лайки: какие новости уже отмечены текущим пользователем.
  const likesQuery = useQuery({
    queryKey: ["news-likes", userId],
    queryFn: () => api.entities.NewsLike.filter({ user_id: userId }),
    enabled: !!userId,
  });

  const likedIds = useMemo(
    () => new Set((likesQuery.data || []).map((l) => l.news_id)),
    [likesQuery.data]
  );

  const counts = useMemo(() => {
    const rows = countsQuery.data || [];
    const acc = { all: rows.length };
    CATEGORIES.forEach((c) => {
      acc[c] = rows.filter((r) => r.category === c).length;
    });
    return acc;
  }, [countsQuery.data]);

  /* ------------------------------------------------- лайк (BUG-031) */

  const likesKey = ["news-likes", userId];

  const toggleLike = useMutation({
    mutationFn: async (newsId) => {
      const { data, error } = await api.supabase.rpc("toggle_news_like", { p_news_id: newsId });
      if (error) throw error;
      return data;
    },
    // Оптимистичное обновление: сердечко и счётчик реагируют мгновенно.
    onMutate: async (newsId) => {
      await qc.cancelQueries({ queryKey: likesKey });
      await qc.cancelQueries({ queryKey: ["news-page"] });
      await qc.cancelQueries({ queryKey: ["news-pinned"] });

      const liked = likedIds.has(newsId);
      const prevLikes = qc.getQueryData(likesKey);
      const prevPages = qc.getQueriesData({ queryKey: ["news-page"] });
      const prevPinned = qc.getQueriesData({ queryKey: ["news-pinned"] });

      qc.setQueryData(likesKey, (old = []) =>
        liked ? old.filter((l) => l.news_id !== newsId) : [...old, { news_id: newsId, user_id: userId }]
      );
      const patchRow = (n) =>
        n.id === newsId ? { ...n, likes: Math.max(0, (n.likes || 0) + (liked ? -1 : 1)) } : n;
      qc.setQueriesData({ queryKey: ["news-page"] }, (old) =>
        old?.rows ? { ...old, rows: old.rows.map(patchRow) } : old
      );
      qc.setQueriesData({ queryKey: ["news-pinned"] }, (old) =>
        Array.isArray(old) ? old.map(patchRow) : old
      );

      return { prevLikes, prevPages, prevPinned };
    },
    onError: (err, _newsId, ctx) => {
      if (ctx?.prevLikes !== undefined) qc.setQueryData(likesKey, ctx.prevLikes);
      ctx?.prevPages?.forEach(([key, data]) => qc.setQueryData(key, data));
      ctx?.prevPinned?.forEach(([key, data]) => qc.setQueryData(key, data));
      toast({ variant: "destructive", title: "Не удалось поставить отметку", description: err?.message });
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: likesKey });
      qc.invalidateQueries({ queryKey: ["news-page"] });
      qc.invalidateQueries({ queryKey: ["news-pinned"] });
    },
  });

  /* --------------------------------------------------------- состояния */

  const error = pageQuery.error || pinnedQuery.error;
  const isLoading = pageQuery.isLoading || pinnedQuery.isLoading;
  const rows = pageQuery.data?.rows || [];
  const total = pageQuery.data?.total || 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pinned = page === 1 ? pinnedQuery.data || [] : [];
  const nothingFound = rows.length === 0 && pinned.length === 0;

  const resetTo = (updater) => {
    updater();
    setPage(1);
  };

  // Обычные функции, а не вложенные компоненты: иначе кнопка пересоздавалась бы
  // при каждом рендере и теряла фокус после клика.
  const renderLikeButton = (item) => {
    const liked = likedIds.has(item.id);
    return (
      <Button
        size="sm"
        variant="ghost"
        className="min-h-[40px] px-2 gap-1"
        aria-pressed={liked}
        aria-label={
          liked
            ? `Убрать отметку «Нравится» с новости «${item.title}»`
            : `Отметить новость «${item.title}» как понравившуюся`
        }
        onClick={() => toggleLike.mutate(item.id)}
        disabled={!userId || (toggleLike.isPending && toggleLike.variables === item.id)}
      >
        <Heart className={cn("w-4 h-4", liked && "fill-destructive text-destructive")} aria-hidden="true" />
        <span className="text-xs">{formatNumber(item.likes || 0)}</span>
      </Button>
    );
  };

  const renderMeta = (item) => (
    <div className="flex items-center gap-4 text-xs text-muted-foreground">
      <span className="flex items-center gap-1">
        <Eye className="w-3.5 h-3.5" aria-hidden="true" />
        {formatNumber(item.views || 0)}
      </span>
      <span className="flex items-center gap-1">
        <MessageSquare className="w-3.5 h-3.5" aria-hidden="true" />
        {formatNumber(item.comments_count || 0)}
      </span>
      <span className="truncate">Автор: {item.author_name || "HR"}</span>
    </div>
  );

  return (
    <PageContainer title="Новости" description="Новости и объявления компании">
      <div className="space-y-5">
        <div className="relative">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={search}
            onChange={(e) => resetTo(() => setSearch(e.target.value))}
            placeholder="Поиск по заголовкам…"
            className="pl-9"
            aria-label="Поиск новостей по заголовку"
          />
        </div>

        {/* Фильтр по категориям чипами со счётчиками (паттерн «Избранного») */}
        <div className="flex items-center gap-2 flex-wrap" role="group" aria-label="Фильтр новостей по категории">
          <Button
            size="sm"
            variant={category === "all" ? "default" : "outline"}
            className="min-h-[40px]"
            aria-pressed={category === "all"}
            onClick={() => resetTo(() => setCategory("all"))}
          >
            Все ({formatNumber(counts.all || 0)})
          </Button>
          {CATEGORIES.map((c) => (
            <Button
              key={c}
              size="sm"
              variant={category === c ? "default" : "outline"}
              className="min-h-[40px]"
              aria-pressed={category === c}
              onClick={() => resetTo(() => setCategory(c))}
            >
              {/* BUG-051: ярлык категории — из общего словаря статусов, а не код company/product */}
              {statusLabel(c)} ({formatNumber(counts[c] || 0)})
            </Button>
          ))}
        </div>

        {error ? (
          <ErrorState
            error={error}
            onRetry={() => {
              pageQuery.refetch();
              pinnedQuery.refetch();
            }}
          />
        ) : isLoading ? (
          <NewsSkeleton />
        ) : nothingFound ? (
          <EmptyState
            icon={Newspaper}
            title="Новостей не найдено"
            description="Попробуйте изменить запрос или выбрать другую категорию."
            actionLabel="Сбросить фильтры"
            onAction={() =>
              resetTo(() => {
                setSearch("");
                setCategory("all");
              })
            }
          />
        ) : (
          <>
            {/* Закреплённые — первыми */}
            {pinned.length > 0 && (
              <ul role="list" className="space-y-3">
                {pinned.map((n) => (
                  <li key={n.id} role="listitem">
                    <Card className="overflow-hidden border-warning/40">
                      <Link
                        to={`/cabinet/news/${n.id}`}
                        className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {n.image_url && (
                          <img src={n.image_url} alt="" className="w-full h-56 object-cover" />
                        )}
                      </Link>
                      <div className="p-5">
                        <div className="flex items-center gap-2 mb-2 flex-wrap">
                          <Badge variant="warning">
                            <Pin className="w-3 h-3 mr-1" aria-hidden="true" />
                            Закреплено
                          </Badge>
                          <StatusBadge value={n.category} />
                          <span className="text-xs text-muted-foreground">{formatDate(n.published_date)}</span>
                        </div>
                        <h2 className="text-xl font-bold text-foreground mb-2">
                          <Link
                            to={`/cabinet/news/${n.id}`}
                            className="hover:text-primary transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                          >
                            {n.title}
                          </Link>
                        </h2>
                        <p className="text-sm text-muted-foreground line-clamp-3">{n.excerpt || n.body}</p>
                        <div className="flex items-center justify-between gap-3 mt-4 flex-wrap">
                          {renderMeta(n)}
                          <div className="flex items-center gap-2">
                            {renderLikeButton(n)}
                            <Button asChild size="sm" variant="outline" className="min-h-[40px]">
                              <Link to={`/cabinet/news/${n.id}`}>Читать далее</Link>
                            </Button>
                          </div>
                        </div>
                      </div>
                    </Card>
                  </li>
                ))}
              </ul>
            )}

            {/* Лента */}
            <ul role="list" className="space-y-3">
              {rows.map((n) => (
                <li key={n.id} role="listitem">
                  <Card className="p-4 hover:shadow-premium transition">
                    <div className="flex gap-4">
                      {n.image_url && (
                        <Link
                          to={`/cabinet/news/${n.id}`}
                          className="shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg"
                        >
                          <img src={n.image_url} alt="" className="w-24 h-24 rounded-lg object-cover" />
                        </Link>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <StatusBadge value={n.category} />
                          <span className="text-xs text-muted-foreground">{formatDate(n.published_date)}</span>
                        </div>
                        <h3 className="font-semibold text-foreground mb-1">
                          <Link
                            to={`/cabinet/news/${n.id}`}
                            className="hover:text-primary transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                          >
                            {n.title}
                          </Link>
                        </h3>
                        <p className="text-sm text-muted-foreground line-clamp-2">{n.excerpt || n.body}</p>
                        <div className="flex items-center justify-between gap-3 mt-2 flex-wrap">
                          {renderMeta(n)}
                          <div className="flex items-center gap-2">
                            {renderLikeButton(n)}
                            <Button asChild size="sm" variant="ghost" className="min-h-[40px]">
                              <Link to={`/cabinet/news/${n.id}`}>Читать далее</Link>
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </Card>
                </li>
              ))}
            </ul>

            {/* Серверная пагинация */}
            {total > PAGE_SIZE && (
              <nav
                className="flex items-center justify-between gap-3 flex-wrap"
                aria-label="Постраничная навигация по новостям"
              >
                <p className="text-sm text-muted-foreground">
                  Страница {formatNumber(page)} из {formatNumber(totalPages)} ·{" "}
                  {pluralize(total, "новость", "новости", "новостей")}
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="min-h-[40px]"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1 || pageQuery.isFetching}
                  >
                    <ChevronLeft className="w-4 h-4" aria-hidden="true" />
                    Назад
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="min-h-[40px]"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages || pageQuery.isFetching}
                  >
                    Вперёд
                    <ChevronRight className="w-4 h-4" aria-hidden="true" />
                  </Button>
                </div>
              </nav>
            )}
          </>
        )}
      </div>
    </PageContainer>
  );
}
