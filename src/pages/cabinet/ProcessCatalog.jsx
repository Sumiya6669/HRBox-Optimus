import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, ClipboardList, Search, Sparkles, Workflow } from 'lucide-react';

import { api } from '@/api/client';
import PageContainer from '@/components/common/PageContainer';
import EmptyState from '@/components/common/EmptyState';
import ErrorState from '@/components/common/ErrorState';
import SafeImage from '@/components/common/SafeImage';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/lib/AuthContext';
import { formatPoints, pluralize } from '@/lib/format';

/**
 * Каталог процессов, доступных сотруднику (ТЗ §1.1).
 *
 * Показываем только опубликованные процессы. Если у процесса есть категории
 * («Обучение», «Контент», «Наставничество»), каждая ведёт сразу на форму с
 * выбранной категорией — сотруднику не приходится выбирать её дважды.
 *
 * Сколько баллов можно получить, видно до подачи заявки: берём максимальную
 * стоимость варианта ответа на первом этапе, потому что именно её сотрудник
 * и выбирает при подаче.
 */

/** Максимальная стоимость варианта среди полей первого этапа процесса. */
function maxPointsOfFields(fields) {
  let max = 0;
  for (const field of fields) {
    if (field.type !== 'select' && field.type !== 'multiselect') continue;
    const options = Array.isArray(field.options) ? field.options : [];
    for (const option of options) {
      const points = Number(option?.points);
      if (Number.isFinite(points) && points > max) max = points;
    }
  }
  return max;
}

function CatalogSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="h-64 animate-pulse rounded-xl bg-muted" />
      ))}
    </div>
  );
}

export default function ProcessCatalog() {
  const [search, setSearch] = useState('');
  const { hasRole } = useAuth();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['process-catalog'],
    queryFn: async () => {
      const processes = await api.entities.Process.filter({ is_active: true }, 'sort_order');
      if (!processes.length) return { processes: [], categoriesByProcess: {}, pointsByProcess: {} };

      const processIds = processes.map((p) => p.id);
      const [categories, stages] = await Promise.all([
        api.entities.ProcessCategory.filter({ process_id: processIds, is_active: true }, 'sort_order'),
        api.entities.ProcessStage.filter({ process_id: processIds }, 'sort_order'),
      ]);

      // Этапы приходят отсортированными, поэтому первый встреченный — он же первый по порядку.
      const firstStageByProcess = new Map();
      for (const stage of stages) {
        if (!firstStageByProcess.has(stage.process_id)) firstStageByProcess.set(stage.process_id, stage);
      }

      const firstStageIds = [...firstStageByProcess.values()].map((s) => s.id);
      const fields = firstStageIds.length
        ? await api.entities.ProcessField.filter({ stage_id: firstStageIds }, 'sort_order')
        : [];

      const fieldsByStage = {};
      for (const field of fields) {
        (fieldsByStage[field.stage_id] ||= []).push(field);
      }

      const categoriesByProcess = {};
      for (const category of categories) {
        (categoriesByProcess[category.process_id] ||= []).push(category);
      }

      const pointsByProcess = {};
      for (const [processId, stage] of firstStageByProcess) {
        pointsByProcess[processId] = maxPointsOfFields(fieldsByStage[stage.id] || []);
      }

      return { processes, categoriesByProcess, pointsByProcess };
    },
  });

  // «Видимость по роли» из конструктора: processes.visible_to_role = null — процесс виден всем.
  // RLS отдаёт все опубликованные процессы, поэтому ограничение применяем здесь.
  const processes = useMemo(
    () => (data?.processes || []).filter((p) => !p.visible_to_role || hasRole(p.visible_to_role)),
    [data, hasRole]
  );
  const categoriesByProcess = useMemo(() => data?.categoriesByProcess || {}, [data]);
  const pointsByProcess = data?.pointsByProcess || {};

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return processes;
    return processes.filter((process) => {
      const categories = categoriesByProcess[process.id] || [];
      const haystack = [process.name, process.description, ...categories.map((c) => c.name)]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [processes, categoriesByProcess, search]);

  return (
    <PageContainer
      title="Процессы"
      description="Подайте заявку и получите баллы за вклад в жизнь компании: обучение, контент, наставничество."
      actions={
        <Button variant="outline" asChild>
          <Link to="/cabinet/processes/requests">
            <ClipboardList className="h-4 w-4" aria-hidden="true" />
            Мои заявки
          </Link>
        </Button>
      }
    >
      {error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : isLoading ? (
        <CatalogSkeleton />
      ) : !processes.length ? (
        <EmptyState
          icon={Workflow}
          title="Процессов пока нет"
          description="HR-специалист ещё не опубликовал ни одного процесса. Как только это произойдёт, здесь появятся заявки, за которые начисляются баллы."
        />
      ) : (
        <div className="space-y-5">
          <div className="relative max-w-md">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск по процессам и категориям"
              aria-label="Поиск по процессам и категориям"
              className="min-h-[40px] pl-8"
            />
          </div>

          {!visible.length ? (
            <EmptyState
              title="Ничего не найдено"
              description="Под запрос не подошёл ни один процесс. Измените формулировку или сбросьте поиск."
              actionLabel="Сбросить поиск"
              onAction={() => setSearch('')}
              compact
            />
          ) : (
            <ul className="grid grid-cols-1 items-stretch gap-4 sm:grid-cols-2 lg:grid-cols-3" role="list">
              {visible.map((process) => {
                const categories = categoriesByProcess[process.id] || [];
                const maxPoints = pointsByProcess[process.id] || 0;

                return (
                  <li key={process.id} role="listitem" className="h-full">
                    <Card className="flex h-full flex-col overflow-hidden">
                      {/* Картинка процесса декоративна: название идёт заголовком ниже */}
                      <SafeImage
                        src={process.image_url}
                        alt=""
                        className="aspect-[16/9] w-full bg-muted object-cover"
                        fallbackIcon={Workflow}
                        fallbackClassName="bg-primary/10 text-primary"
                      />

                      <div className="flex flex-1 flex-col gap-3 p-4">
                        <div className="flex items-start justify-between gap-2">
                          <h2 className="font-semibold leading-snug text-foreground">{process.name}</h2>
                          {maxPoints > 0 && (
                            <Badge variant="success" className="shrink-0 gap-1">
                              <Sparkles className="h-3 w-3" aria-hidden="true" />
                              до {formatPoints(maxPoints)}
                            </Badge>
                          )}
                        </div>

                        {process.description && (
                          <p className="line-clamp-3 text-sm text-muted-foreground">{process.description}</p>
                        )}

                        <div className="mt-auto pt-1">
                          {categories.length ? (
                            <>
                              <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                {pluralize(categories.length, 'категория', 'категории', 'категорий')}
                              </p>
                              <ul className="space-y-1" role="list">
                                {categories.map((category) => (
                                  <li key={category.id} role="listitem">
                                    <Link
                                      to={`/cabinet/processes/${process.id}?category=${category.id}`}
                                      className="flex min-h-[40px] items-center justify-between gap-2 rounded-md px-2 text-sm text-foreground transition-colors hover:bg-accent"
                                    >
                                      <span className="min-w-0 truncate">{category.name}</span>
                                      <ChevronRight
                                        className="h-4 w-4 shrink-0 text-muted-foreground"
                                        aria-hidden="true"
                                      />
                                    </Link>
                                  </li>
                                ))}
                              </ul>
                            </>
                          ) : (
                            <Button asChild className="w-full">
                              <Link to={`/cabinet/processes/${process.id}`}>Подать заявку</Link>
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
