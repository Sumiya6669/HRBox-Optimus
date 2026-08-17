import React, { useMemo, useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Search, Users, Newspaper, GraduationCap, BookOpen, FileText, SearchX, LayoutGrid } from 'lucide-react';
import { api } from '@/api/client';
import PageContainer from '@/components/common/PageContainer';
import EmptyState from '@/components/common/EmptyState';
import ErrorState from '@/components/common/ErrorState';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { pluralize } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * BUG-010: глобальный поиск в шапке не работал ни по Enter, ни выпадающим списком —
 * страницы результатов вообще не существовало. Здесь она есть: /search?q=…
 *
 * Группировка чипами-фильтрами со счётчиками — паттерн страницы «Избранное»
 * (src/pages/cabinet/CabinetFavorites.jsx), лучший в продукте; здесь он приведён
 * к соглашениям: доступные кнопки, состояния ошибки/загрузки/пустоты.
 */

const KIND_CONFIG = {
  employee: { label: 'Сотрудники', icon: Users, tone: 'bg-primary/10 text-primary' },
  news: { label: 'Новости', icon: Newspaper, tone: 'bg-info/15 text-info' },
  course: { label: 'Курсы', icon: GraduationCap, tone: 'bg-brand-learning/15 text-brand-learning' },
  book: { label: 'Книги', icon: BookOpen, tone: 'bg-brand-library/15 text-brand-library' },
  page: { label: 'Страницы', icon: FileText, tone: 'bg-muted text-muted-foreground' },
};

const KIND_ORDER = ['employee', 'news', 'course', 'book', 'page'];

function ResultsSkeleton() {
  return (
    <div className="space-y-2" aria-hidden="true">
      {[0, 1, 2, 3, 4].map((i) => (
        <Card key={i} className="p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-muted animate-pulse" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-1/3 rounded bg-muted animate-pulse" />
            <div className="h-3 w-1/4 rounded bg-muted animate-pulse" />
          </div>
        </Card>
      ))}
    </div>
  );
}

export default function SearchResults() {
  const [searchParams, setSearchParams] = useSearchParams();
  const query = (searchParams.get('q') || '').trim();
  const [draft, setDraft] = useState(query);
  const [kind, setKind] = useState('all');

  // Адрес — источник правды: переход из шапки портала должен менять поле ввода.
  useEffect(() => {
    setDraft(query);
    setKind('all');
  }, [query]);

  const {
    data: results,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['global-search-page', query],
    queryFn: () => api.rpc.globalSearch(query, 50),
    enabled: query.length > 0,
  });

  const rows = results || [];

  const counts = useMemo(() => {
    const acc = {};
    for (const row of rows) acc[row.kind] = (acc[row.kind] || 0) + 1;
    return acc;
  }, [rows]);

  const visible = kind === 'all' ? rows : rows.filter((r) => r.kind === kind);

  const submit = (event) => {
    event.preventDefault();
    const next = draft.trim();
    setSearchParams(next ? { q: next } : {});
  };

  return (
    <PageContainer
      title="Поиск по порталу"
      description="Сотрудники, новости, курсы, книги и страницы портала — в одном списке."
    >
      <form onSubmit={submit} className="mb-6 flex flex-col sm:flex-row gap-2" role="search">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
          <label htmlFor="search-page-input" className="sr-only">
            Поисковый запрос
          </label>
          <Input
            id="search-page-input"
            type="search"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Например: отпуск, Айгуль, безопасность"
            className="pl-9 min-h-[40px]"
          />
        </div>
        <Button type="submit" disabled={!draft.trim()}>
          Найти
        </Button>
      </form>

      {!query ? (
        <EmptyState
          icon={Search}
          title="Введите запрос"
          description="Начните с фамилии коллеги, названия курса или ключевого слова из новости — поиск ищет сразу по всем разделам портала."
        />
      ) : error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : isLoading ? (
        <ResultsSkeleton />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={SearchX}
          title={`По запросу «${query}» ничего не нашлось`}
          description="Проверьте раскладку и попробуйте более короткий запрос — например, одно слово вместо целой фразы."
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 mb-4" role="group" aria-label="Фильтр результатов по типу">
            <Button
              size="sm"
              variant={kind === 'all' ? 'default' : 'outline'}
              onClick={() => setKind('all')}
              aria-pressed={kind === 'all'}
              className="min-h-[40px]"
            >
              <LayoutGrid className="w-3.5 h-3.5" aria-hidden="true" />
              Все ({rows.length})
            </Button>
            {KIND_ORDER.filter((k) => counts[k]).map((k) => {
              const cfg = KIND_CONFIG[k];
              const Icon = cfg.icon;
              return (
                <Button
                  key={k}
                  size="sm"
                  variant={kind === k ? 'default' : 'outline'}
                  onClick={() => setKind(k)}
                  aria-pressed={kind === k}
                  className="min-h-[40px]"
                >
                  <Icon className="w-3.5 h-3.5" aria-hidden="true" />
                  {cfg.label} ({counts[k]})
                </Button>
              );
            })}
          </div>

          <p className="text-sm text-muted-foreground mb-3" aria-live="polite">
            Найдено {pluralize(visible.length, 'результат', 'результата', 'результатов')} по запросу «{query}»
          </p>

          <ul className="space-y-2" role="list">
            {visible.map((row) => {
              const cfg = KIND_CONFIG[row.kind] || KIND_CONFIG.page;
              const Icon = cfg.icon;
              return (
                <li key={`${row.kind}-${row.id}`} role="listitem">
                  <Card className="transition-colors hover:bg-accent/50">
                    <Link to={row.url} className="flex items-center gap-3 p-4 min-h-[40px]">
                      <span className={cn('w-10 h-10 rounded-lg flex items-center justify-center shrink-0', cfg.tone)}>
                        <Icon className="w-5 h-5" aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium text-foreground truncate">{row.title}</span>
                        <span className="block text-xs text-muted-foreground truncate">
                          {cfg.label}
                          {row.subtitle ? ` · ${row.subtitle}` : ''}
                        </span>
                      </span>
                    </Link>
                  </Card>
                </li>
              );
            })}
          </ul>

          {visible.length === 0 && (
            <EmptyState
              icon={SearchX}
              title="В этой группе ничего нет"
              description="Снимите фильтр, чтобы увидеть все найденные материалы."
              actionLabel="Показать все"
              onAction={() => setKind('all')}
              compact
            />
          )}
        </>
      )}
    </PageContainer>
  );
}
