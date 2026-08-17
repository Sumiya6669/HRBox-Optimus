import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Newspaper, GraduationCap, BookOpen, CalendarDays, FileText, Star, Trash2, Heart, AlertTriangle,
} from 'lucide-react';
import PageContainer from '@/components/common/PageContainer';
import EmptyState from '@/components/common/EmptyState';
import ErrorState from '@/components/common/ErrorState';
import StatusBadge from '@/components/common/StatusBadge';
import FilterChips from '@/components/common/FilterChips';
import SafeImage from '@/components/common/SafeImage';
import { useToast } from '@/components/ui/use-toast';
import { useCurrentEmployee } from '@/lib/useCurrentEmployee';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * Избранное.
 *
 * BUG-079: в избранном лежала новость, которой нет в базе новостей. Теперь favorites
 *          ссылается на item_id (с уникальностью), а страница проверяет, существует ли
 *          объект: удалённый показывается как «Объект удалён» с кнопкой убрать из
 *          избранного, а не битой ссылкой.
 * Ссылки ведут на реальные детальные страницы разделов.
 * Фильтр-чипы вынесены в общий компонент FilterChips и переиспользуются другими страницами.
 */

const ALL = 'all';

const TYPE_CONFIG = {
  news: { label: 'Новости', icon: Newspaper, tone: 'bg-info/10 text-info' },
  course: { label: 'Курсы', icon: GraduationCap, tone: 'bg-accent text-brand-learning' },
  book: { label: 'Книги', icon: BookOpen, tone: 'bg-accent text-brand-library' },
  event: { label: 'События', icon: CalendarDays, tone: 'bg-warning/10 text-warning' },
  page: { label: 'Страницы', icon: FileText, tone: 'bg-muted text-muted-foreground' },
};

const ENTITY_BY_TYPE = {
  news: () => api.entities.News,
  course: () => api.entities.Course,
  book: () => api.entities.Book,
  event: () => api.entities.Event,
  page: () => api.entities.Page,
};

/** Реальные адреса детальных страниц разделов. */
function buildLink(type, record) {
  switch (type) {
    case 'news':
      return `/cabinet/news/${record.id}`;
    case 'course':
      return `/cabinet/learning/${record.id}`;
    case 'book':
      return `/cabinet/library/${record.id}`;
    case 'page':
      return record.slug ? `/${record.slug}` : null;
    case 'event':
      return '/cabinet/calendar';
    default:
      return null;
  }
}

function SkeletonList() {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-28 animate-pulse rounded-xl bg-muted" />
      ))}
    </div>
  );
}

export default function CabinetFavorites() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { me } = useCurrentEmployee();
  const [filter, setFilter] = useState(ALL);

  const favoritesQuery = useQuery({
    queryKey: ['favorites', me?.id],
    queryFn: () => api.entities.Favorite.filter({ user_id: me?.id }, '-date'),
    enabled: !!me?.id,
  });

  const favorites = useMemo(() => favoritesQuery.data || [], [favoritesQuery.data]);

  // Ключ зависит от состава избранного, чтобы проверка существования переиспользовала кэш.
  const targetsKey = useMemo(
    () => favorites.map((f) => `${f.item_type}:${f.item_id}`).sort().join('|'),
    [favorites]
  );

  // BUG-079: проверяем, что объект избранного ещё существует (и доступен пользователю).
  const targetsQuery = useQuery({
    queryKey: ['favorites-targets', me?.id, targetsKey],
    enabled: favorites.length > 0,
    queryFn: async () => {
      const byType = favorites.reduce((acc, f) => {
        if (!ENTITY_BY_TYPE[f.item_type]) return acc;
        (acc[f.item_type] ||= []).push(f.item_id);
        return acc;
      }, {});
      const found = {};
      await Promise.all(
        Object.entries(byType).map(async ([type, ids]) => {
          const rows = await ENTITY_BY_TYPE[type]().filter({ id: ids }, null, ids.length);
          rows.forEach((row) => {
            found[`${type}:${row.id}`] = row;
          });
        })
      );
      return found;
    },
  });

  const remove = useMutation({
    mutationFn: (id) => api.entities.Favorite.delete(id),
    onSuccess: () => {
      toast({ title: 'Удалено из избранного' });
      qc.invalidateQueries({ queryKey: ['favorites', me?.id] });
    },
    onError: (error) => {
      toast({
        title: 'Не удалось удалить',
        description: error?.message || 'Попробуйте ещё раз.',
        variant: 'destructive',
      });
    },
  });

  const options = useMemo(() => {
    const counts = favorites.reduce((acc, f) => {
      acc[f.item_type] = (acc[f.item_type] || 0) + 1;
      return acc;
    }, {});
    return [
      { value: ALL, label: 'Все', count: favorites.length, icon: Star },
      ...Object.entries(TYPE_CONFIG)
        .filter(([key]) => counts[key])
        .map(([key, cfg]) => ({ value: key, label: cfg.label, count: counts[key], icon: cfg.icon })),
    ];
  }, [favorites]);

  const filtered = favorites.filter((f) => filter === ALL || f.item_type === filter);
  const targets = targetsQuery.data || {};
  const isLoading = favoritesQuery.isPending || (favorites.length > 0 && targetsQuery.isPending);
  const error = favoritesQuery.error || targetsQuery.error;

  return (
    <PageContainer title="Избранное" description="Материалы, которые вы сохранили">
      {error ? (
        <ErrorState
          error={error}
          onRetry={() => {
            favoritesQuery.refetch();
            targetsQuery.refetch();
          }}
        />
      ) : isLoading ? (
        <SkeletonList />
      ) : !favorites.length ? (
        <EmptyState
          icon={Heart}
          title="В избранном пусто"
          description="Добавляйте новости, курсы и книги в избранное — они соберутся здесь."
          action={
            <Button asChild className="min-h-[40px]">
              <Link to="/cabinet/news">Перейти к новостям</Link>
            </Button>
          }
        />
      ) : (
        <div className="space-y-6">
          <FilterChips options={options} value={filter} onChange={setFilter} ariaLabel="Фильтр избранного по типу" />

          {!filtered.length ? (
            <EmptyState
              icon={Star}
              compact
              title="Ничего не найдено"
              description="В этой категории пока нет сохранённых материалов."
              actionLabel="Показать все"
              onAction={() => setFilter(ALL)}
            />
          ) : (
            <ul role="list" className="grid grid-cols-1 items-stretch gap-4 md:grid-cols-2">
              {filtered.map((f) => {
                const cfg = TYPE_CONFIG[f.item_type] || TYPE_CONFIG.news;
                const Icon = cfg.icon;
                const record = targets[`${f.item_type}:${f.item_id}`];
                const link = record ? buildLink(f.item_type, record) : null;
                const title = record?.title || f.item_title || 'Без названия';

                return (
                  <li key={f.id} role="listitem" className="h-full">
                    <Card className={cn('flex h-full items-start gap-3 p-4', !record && 'border-dashed')}>
                      {f.item_image && record ? (
                        <SafeImage src={f.item_image} alt="" className="h-16 w-16 shrink-0 rounded-lg object-cover" />
                      ) : (
                        <div
                          className={cn(
                            'flex h-16 w-16 shrink-0 items-center justify-center rounded-lg',
                            record ? cfg.tone : 'bg-muted text-muted-foreground'
                          )}
                        >
                          {record ? (
                            <Icon className="h-7 w-7" aria-hidden="true" />
                          ) : (
                            <AlertTriangle className="h-7 w-7" aria-hidden="true" />
                          )}
                        </div>
                      )}

                      <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <StatusBadge value={f.item_type} fallback={cfg.label} className="w-fit" />

                        {record && link ? (
                          <Link
                            to={link}
                            className="line-clamp-2 font-medium text-foreground hover:text-primary"
                          >
                            {title}
                          </Link>
                        ) : (
                          <>
                            <span className="line-clamp-2 font-medium text-muted-foreground line-through">
                              {title}
                            </span>
                            {/* BUG-079: битой ссылки больше нет — объясняем, что объекта нет */}
                            <span className="text-xs text-destructive">
                              Объект удалён или больше не доступен
                            </span>
                          </>
                        )}

                        {record && f.item_meta && (
                          <p className="truncate text-xs text-muted-foreground">{f.item_meta}</p>
                        )}

                        <div className="mt-auto flex items-center justify-between gap-2 pt-2">
                          <span className="text-xs text-muted-foreground">{formatDate(f.date)}</span>
                          {record ? (
                            <Button
                              size="icon"
                              variant="ghost"
                              className="text-muted-foreground hover:text-destructive"
                              aria-label={`Убрать «${title}» из избранного`}
                              disabled={remove.isPending}
                              onClick={() => remove.mutate(f.id)}
                            >
                              <Trash2 className="h-4 w-4" aria-hidden="true" />
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              className="min-h-[40px]"
                              aria-label={`Убрать «${title}» из избранного`}
                              disabled={remove.isPending}
                              onClick={() => remove.mutate(f.id)}
                            >
                              <Trash2 className="h-4 w-4" aria-hidden="true" />
                              Убрать из избранного
                            </Button>
                          )}
                        </div>
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
