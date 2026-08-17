import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Newspaper, CalendarDays, Cake, Sparkles, GraduationCap,
  BarChart3, Users, ChevronRight, UserPlus,
} from 'lucide-react';

import { api } from '@/api/client';
import PageContainer from '@/components/common/PageContainer';
import EmptyState from '@/components/common/EmptyState';
import ErrorState from '@/components/common/ErrorState';
import StatusBadge from '@/components/common/StatusBadge';
import FilterChips from '@/components/common/FilterChips';
import OptimusLogo from '@/components/common/OptimusLogo';
import SafeImage from '@/components/common/SafeImage';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  formatDate, formatNumber, pluralize, tenureYears, formatTenure,
  daysUntilBirthday, initials, toDate,
} from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * Главная портала.
 *
 * BUG-013: новости выводились дважды — читаем вьюху v_news со status='published'
 *          (лимит 6), без ручной склейки списков.
 * BUG-014/015: счётчики новостей и опросов расходились с админкой — ВСЕ обзорные
 *          цифры берутся из api.rpc.portalStats(), никаких array.length.
 * BUG-023/024: блок «События» показывал прошедшие даты и не совпадал с календарём —
 *          единственный источник это таблица events с фильтром date >= сегодня,
 *          сортировкой по возрастанию; события ведут в /cabinet/calendar.
 * BUG-021/022: стаж и годовщины считаются только из hire_date через
 *          tenureYears/formatTenure — тем же способом, что и в достижениях.
 * BUG-032: «Читать далее» ведёт на /cabinet/news/:id, а не в список.
 * BUG-040: во всех витринных запросах стоит is_sample = false — тестовый
 *          «Аааа Аааа» и демо-новости на главную не попадают.
 * BUG-050: прогресс обучения берётся из portalStats (learning_progress,
 *          enrollments_total, enrollments_completed), а не считается на клиенте.
 * BUG-053: даты — только formatDate.
 * Аудит: дни рождения / годовщины / новички объединены в одну ленту «Люди» с чипами.
 */

const NEWS_LIMIT = 6;
const PEOPLE_LIMIT = 5;
const ANNIVERSARY_WINDOW_DAYS = 30;

/* ------------------------------------------------------------------ утилиты */

/** Дата ближайшей годовщины события (день рождения, приём на работу) — без года. */
function nextAnniversary(value, at = new Date()) {
  const days = daysUntilBirthday(value, at);
  if (days === null) return null;
  return new Date(at.getFullYear(), at.getMonth(), at.getDate() + days);
}

/* ---------------------------------------------------------------- скелетоны */

function TilesSkeleton() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <Card key={i} className="p-4 h-[88px] animate-pulse bg-muted/40" />
      ))}
    </div>
  );
}

function ListSkeleton({ rows = 3 }) {
  return (
    <div className="space-y-3" aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-muted animate-pulse shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-2/3 rounded bg-muted animate-pulse" />
            <div className="h-2 w-1/3 rounded bg-muted/60 animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Каркас виджета с обязательными тремя состояниями (BUG-011). */
function Widget({
  title, icon: Icon, iconClass, to, linkLabel = 'Все',
  error, isLoading, onRetry, isEmpty, emptyText, children,
}) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-2 mb-4">
        <h2 className="font-semibold text-foreground flex items-center gap-2">
          <Icon className={cn('w-5 h-5', iconClass)} aria-hidden="true" />
          {title}
        </h2>
        {to && (
          <Link to={to} className="text-xs text-primary hover:underline shrink-0">
            {linkLabel}
          </Link>
        )}
      </div>
      {error ? (
        <ErrorState error={error} onRetry={onRetry} compact />
      ) : isLoading ? (
        <ListSkeleton />
      ) : isEmpty ? (
        <p className="text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        children
      )}
    </Card>
  );
}

/* -------------------------------------------------------------------- экран */

export default function CompanyHome() {
  const [peopleTab, setPeopleTab] = useState('birthdays');

  const today = formatDate(new Date(), 'iso');

  // BUG-014/015: единственный источник обзорных цифр.
  const statsQuery = useQuery({
    queryKey: ['portal-stats'],
    queryFn: () => api.rpc.portalStats(),
  });

  // BUG-013 + BUG-040: опубликованные новости из вьюхи, без демо-данных, ровно 6 записей.
  const newsQuery = useQuery({
    queryKey: ['home-news'],
    queryFn: async () => {
      const { data, error } = await api.supabase
        .from('v_news')
        .select('*')
        .eq('status', 'published')
        .eq('is_sample', false)
        .order('pinned', { ascending: false })
        .order('published_date', { ascending: false })
        .limit(NEWS_LIMIT);
      if (error) throw error;
      return data || [];
    },
  });

  // BUG-023/024: только предстоящие события из таблицы events, по возрастанию даты.
  const eventsQuery = useQuery({
    queryKey: ['home-events', today],
    queryFn: () => api.entities.Event.filter({ date: { gte: today }, is_sample: false }, 'date', 4),
  });

  // BUG-040: демо-карточки сотрудников не попадают в ленту «Люди».
  const peopleQuery = useQuery({
    queryKey: ['home-people'],
    queryFn: () =>
      api.entities.Employee.filter(
        { is_sample: false, status: ['active', 'on_leave', 'probation'] },
        'name',
        500
      ),
  });

  const surveysQuery = useQuery({
    queryKey: ['home-surveys'],
    queryFn: async () => {
      const { data, error } = await api.supabase
        .from('v_surveys')
        .select('*')
        .eq('effective_status', 'active')
        .eq('is_sample', false)
        .order('end_date', { ascending: true })
        .limit(2);
      if (error) throw error;
      return data || [];
    },
  });

  const stats = statsQuery.data || {};
  const news = newsQuery.data || [];
  const pinned = news.find((n) => n.pinned) || news[0] || null;
  const restNews = news.filter((n) => n.id !== pinned?.id);

  const employees = useMemo(() => peopleQuery.data || [], [peopleQuery.data]);

  /* ------------------------------------------------------- лента «Люди» */

  const birthdays = useMemo(
    () =>
      employees
        .filter((e) => e.birth_date)
        .map((e) => ({ ...e, days: daysUntilBirthday(e.birth_date), at: nextAnniversary(e.birth_date) }))
        .filter((e) => e.days !== null)
        .sort((a, b) => a.days - b.days)
        .slice(0, PEOPLE_LIMIT),
    [employees]
  );

  // BUG-021/022: годовщина = ближайшая дата приёма; число лет считает tenureYears
  // на дату самой годовщины, поэтому «14 лет» и достижение «5 лет» больше не спорят.
  const anniversaries = useMemo(
    () =>
      employees
        .filter((e) => e.hire_date)
        .map((e) => {
          const at = nextAnniversary(e.hire_date);
          return { ...e, days: daysUntilBirthday(e.hire_date), at, years: tenureYears(e.hire_date, at) };
        })
        .filter((e) => e.days !== null && e.days <= ANNIVERSARY_WINDOW_DAYS && e.years >= 1)
        .sort((a, b) => a.days - b.days)
        .slice(0, PEOPLE_LIMIT),
    [employees]
  );

  const newHires = useMemo(
    () =>
      employees
        .filter((e) => e.hire_date)
        .sort((a, b) => (toDate(b.hire_date)?.getTime() || 0) - (toDate(a.hire_date)?.getTime() || 0))
        .slice(0, PEOPLE_LIMIT),
    [employees]
  );

  const peopleTabs = [
    { value: 'birthdays', label: 'Дни рождения', count: birthdays.length, icon: Cake },
    { value: 'anniversaries', label: 'Годовщины', count: anniversaries.length, icon: Sparkles },
    { value: 'hires', label: 'Новые сотрудники', count: newHires.length, icon: UserPlus },
  ];

  const peopleRows =
    peopleTab === 'birthdays' ? birthdays : peopleTab === 'anniversaries' ? anniversaries : newHires;

  const peopleEmptyText =
    peopleTab === 'birthdays'
      ? 'Ближайших дней рождения нет.'
      : peopleTab === 'anniversaries'
        ? 'В ближайший месяц годовщин приёма нет.'
        : 'Новых сотрудников пока нет.';

  /* ------------------------------------------------------------ обзорные плитки */

  const tiles = [
    {
      label: 'Сотрудников',
      value: stats.employees_total,
      icon: Users,
      to: '/admin/employees',
      tone: 'bg-primary/10 text-primary',
    },
    {
      label: 'Новостей',
      value: stats.news_published,
      icon: Newspaper,
      to: '/cabinet/news',
      tone: 'bg-warning/10 text-warning',
    },
    {
      label: 'Курсов',
      value: stats.courses_published,
      icon: GraduationCap,
      to: '/cabinet/learning',
      tone: 'bg-brand-learning/10 text-brand-learning',
    },
    {
      label: 'Активных опросов',
      value: stats.surveys_active,
      icon: BarChart3,
      to: '/cabinet/surveys',
      tone: 'bg-info/10 text-info',
    },
  ];

  const learningProgress = Number(stats.learning_progress) || 0;
  const enrollmentsTotal = Number(stats.enrollments_total) || 0;
  const enrollmentsCompleted = Number(stats.enrollments_completed) || 0;

  return (
    <PageContainer documentTitle="Главная" width="wide">
      <div className="space-y-5">
        {/* Баннер */}
        <section className="relative rounded-2xl overflow-hidden bg-gradient-to-br from-primary via-primary to-primary/80 p-6 md:p-8 text-primary-foreground shadow-premium-lg">
          <div
            className="absolute inset-0 opacity-10"
            aria-hidden="true"
            style={{
              backgroundImage: 'radial-gradient(circle at 20% 50%, white 1px, transparent 1px)',
              backgroundSize: '24px 24px',
            }}
          />
          <div className="absolute right-6 top-6 hidden md:block opacity-20" aria-hidden="true">
            <OptimusLogo size={80} showText={false} />
          </div>
          <div className="relative">
            <Badge className="bg-primary-foreground/20 text-primary-foreground border-0 mb-3">Главное</Badge>
            <h1 className="text-2xl md:text-3xl font-bold mb-2">Корпоративный портал Optimus KZ</h1>
            <p className="text-primary-foreground/80 max-w-xl text-sm md:text-base">
              Официальный дилер BASF и Tikkurila в Казахстане. Новости, обучение, цели и развитие в одном месте.
            </p>
            <div className="flex flex-wrap gap-3 mt-5">
              <Button asChild variant="secondary" className="min-h-[40px]">
                <Link to="/cabinet">В личный кабинет</Link>
              </Button>
              <Button
                asChild
                variant="outline"
                className="min-h-[40px] bg-primary-foreground/10 text-primary-foreground border-primary-foreground/30 hover:bg-primary-foreground/20 hover:text-primary-foreground"
              >
                <Link to="/cabinet/learning">К обучению</Link>
              </Button>
            </div>
          </div>
        </section>

        {/* Обзорные цифры — только из portalStats (BUG-014/015) */}
        {statsQuery.error ? (
          <ErrorState error={statsQuery.error} onRetry={statsQuery.refetch} compact />
        ) : statsQuery.isLoading ? (
          <TilesSkeleton />
        ) : (
          <ul role="list" className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {tiles.map((tile) => {
              const Icon = tile.icon;
              return (
                <li key={tile.label} role="listitem">
                  <Card className="hover:shadow-premium transition-all duration-200">
                    <Link
                      to={tile.to}
                      className="flex items-center gap-3 p-4 min-h-[40px] rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className={cn('w-10 h-10 rounded-xl flex items-center justify-center shrink-0', tile.tone)}>
                        <Icon className="w-5 h-5" aria-hidden="true" />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-2xl font-bold text-foreground tabular-nums">
                          {formatNumber(tile.value ?? 0)}
                        </span>
                        <span className="block text-xs text-muted-foreground">{tile.label}</span>
                      </span>
                    </Link>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
          {/* Левая колонка: новости и опросы */}
          <div className="lg:col-span-2 space-y-5">
            {newsQuery.error ? (
              <ErrorState error={newsQuery.error} onRetry={newsQuery.refetch} />
            ) : newsQuery.isLoading ? (
              <Card className="p-5">
                <ListSkeleton rows={4} />
              </Card>
            ) : news.length === 0 ? (
              <EmptyState
                icon={Newspaper}
                title="Новостей пока нет"
                description="Как только редакция опубликует первую новость, она появится здесь."
              />
            ) : (
              <>
                {/* Главная новость */}
                {pinned && (
                  <Card className="overflow-hidden">
                    {pinned.image_url && (
                      <Link to={`/cabinet/news/${pinned.id}`} className="block">
                        <SafeImage src={pinned.image_url} alt="" className="w-full h-48 object-cover" />
                      </Link>
                    )}
                    <div className="p-5">
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        {pinned.pinned && <Badge variant="warning">Закреплено</Badge>}
                        <StatusBadge value={pinned.category} />
                        <span className="text-xs text-muted-foreground">{formatDate(pinned.published_date)}</span>
                      </div>
                      <h2 className="text-xl font-bold text-foreground mb-2">
                        <Link
                          to={`/cabinet/news/${pinned.id}`}
                          className="hover:text-primary transition rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {pinned.title}
                        </Link>
                      </h2>
                      <p className="text-sm text-muted-foreground line-clamp-3">{pinned.excerpt || pinned.body}</p>
                      <div className="flex items-center justify-between gap-3 mt-4 flex-wrap">
                        <span className="text-xs text-muted-foreground">Автор: {pinned.author_name || 'HR'}</span>
                        {/* BUG-032: «Читать далее» открывает саму новость */}
                        <Button asChild size="sm" variant="outline" className="min-h-[40px]">
                          <Link to={`/cabinet/news/${pinned.id}`}>Читать далее</Link>
                        </Button>
                      </div>
                    </div>
                  </Card>
                )}

                {/* Остальные новости */}
                {restNews.length > 0 && (
                  <section>
                    <div className="flex items-center justify-between mb-3">
                      <h2 className="font-semibold text-foreground flex items-center gap-2">
                        <Newspaper className="w-5 h-5 text-primary" aria-hidden="true" />
                        Новости компании
                      </h2>
                      <Link to="/cabinet/news" className="text-sm text-primary hover:underline">
                        Все новости
                      </Link>
                    </div>
                    <ul role="list" className="space-y-3">
                      {restNews.map((n) => (
                        <li key={n.id} role="listitem">
                          <Card className="hover:shadow-premium transition-all duration-200">
                            <Link
                              to={`/cabinet/news/${n.id}`}
                              className="flex gap-4 p-4 group rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              <span className="w-1 rounded-full bg-primary shrink-0" aria-hidden="true" />
                              <span className="flex-1 min-w-0">
                                <span className="flex items-center gap-2 mb-1 flex-wrap">
                                  <StatusBadge value={n.category} />
                                  <span className="text-xs text-muted-foreground">{formatDate(n.published_date)}</span>
                                </span>
                                <span className="block font-medium text-foreground truncate group-hover:text-primary transition">
                                  {n.title}
                                </span>
                                <span className="block text-sm text-muted-foreground line-clamp-1 mt-0.5">
                                  {n.excerpt || n.body}
                                </span>
                              </span>
                              <ChevronRight
                                className="w-5 h-5 text-muted-foreground/40 group-hover:text-primary transition shrink-0 self-center"
                                aria-hidden="true"
                              />
                            </Link>
                          </Card>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              </>
            )}

            {/* Активные опросы */}
            <Widget
              title="Активные опросы"
              icon={BarChart3}
              iconClass="text-info"
              to="/cabinet/surveys"
              error={surveysQuery.error}
              isLoading={surveysQuery.isLoading}
              onRetry={surveysQuery.refetch}
              isEmpty={(surveysQuery.data || []).length === 0}
              emptyText="Сейчас активных опросов нет."
            >
              <ul role="list" className="grid sm:grid-cols-2 gap-3">
                {(surveysQuery.data || []).map((s) => (
                  <li key={s.id} role="listitem">
                    <Card className="p-4 h-full">
                      <StatusBadge value={s.type} className="mb-2" />
                      <h3 className="font-medium text-foreground mb-1">{s.title}</h3>
                      <p className="text-sm text-muted-foreground line-clamp-2">{s.description}</p>
                      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground mt-3">
                        <span>{pluralize(s.responses_count || 0, 'ответ', 'ответа', 'ответов')}</span>
                        {s.end_date && <span>до {formatDate(s.end_date)}</span>}
                      </div>
                    </Card>
                  </li>
                ))}
              </ul>
            </Widget>
          </div>

          {/* Правая колонка */}
          <div className="space-y-5">
            {/* BUG-023/024: события только из таблицы events, только предстоящие */}
            <Widget
              title="События"
              icon={CalendarDays}
              iconClass="text-primary"
              to="/cabinet/calendar"
              linkLabel="Календарь"
              error={eventsQuery.error}
              isLoading={eventsQuery.isLoading}
              onRetry={eventsQuery.refetch}
              isEmpty={(eventsQuery.data || []).length === 0}
              emptyText="Предстоящих событий нет."
            >
              <ul role="list" className="space-y-2">
                {(eventsQuery.data || []).map((e) => (
                  <li key={e.id} role="listitem">
                    <Link
                      to="/cabinet/calendar"
                      className="flex gap-3 items-center rounded-lg p-1 min-h-[40px] hover:bg-accent/50 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      aria-label={`Событие «${e.title}» ${formatDate(e.date, 'long')} — открыть календарь`}
                    >
                      <span className="w-10 h-10 rounded-lg bg-accent flex flex-col items-center justify-center shrink-0">
                        <span className="text-[10px] text-primary font-bold uppercase">
                          {formatDate(e.date, 'day').split(' ')[1]?.slice(0, 3)}
                        </span>
                        <span className="text-sm font-bold text-primary leading-none">
                          {toDate(e.date)?.getDate()}
                        </span>
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm font-medium text-foreground truncate">{e.title}</span>
                        <span className="block text-xs text-muted-foreground truncate">
                          {e.location || formatDate(e.date)}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Widget>

            {/* Аудит: единая лента «Люди» вместо трёх отдельных блоков */}
            <Card className="p-5">
              <h2 className="font-semibold text-foreground flex items-center gap-2 mb-3">
                <Users className="w-5 h-5 text-primary" aria-hidden="true" />
                Люди
              </h2>
              <FilterChips
                options={peopleTabs}
                value={peopleTab}
                onChange={setPeopleTab}
                ariaLabel="Лента людей: дни рождения, годовщины, новые сотрудники"
                className="mb-4"
              />
              {peopleQuery.error ? (
                <ErrorState error={peopleQuery.error} onRetry={peopleQuery.refetch} compact />
              ) : peopleQuery.isLoading ? (
                <ListSkeleton />
              ) : peopleRows.length === 0 ? (
                <p className="text-sm text-muted-foreground">{peopleEmptyText}</p>
              ) : (
                <ul role="list" className="space-y-2">
                  {peopleRows.map((e) => (
                    <li key={e.id} role="listitem" className="flex items-center gap-2">
                      {/* Фото сотрудника, иначе — инициалы */}
                      <SafeImage
                        src={e.photo_url}
                        alt=""
                        className="w-8 h-8 rounded-full object-cover shrink-0"
                        fallbackText={initials(e.name)}
                        fallbackClassName="bg-accent text-primary text-xs"
                      />
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm font-medium text-foreground truncate">{e.name}</span>
                        <span className="block text-xs text-muted-foreground truncate">
                          {peopleTab === 'birthdays' && formatDate(e.at, 'day')}
                          {/* BUG-021/022: годы считает tenureYears на дату годовщины */}
                          {peopleTab === 'anniversaries' &&
                            `${formatDate(e.at, 'day')} · ${pluralize(e.years, 'год', 'года', 'лет')} в компании`}
                          {peopleTab === 'hires' &&
                            `${e.position || 'Сотрудник'} · ${formatTenure(e.hire_date)}`}
                        </span>
                      </span>
                      {peopleTab !== 'hires' && e.days <= 7 && (
                        <Badge variant="info" className="text-[10px]">
                          {e.days === 0 ? 'сегодня' : 'скоро'}
                        </Badge>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            {/* BUG-050: прогресс обучения — из portalStats */}
            <Card className="p-5">
              <h2 className="font-semibold text-foreground flex items-center gap-2 mb-4">
                <GraduationCap className="w-5 h-5 text-brand-learning" aria-hidden="true" />
                Прогресс обучения
              </h2>
              {statsQuery.error ? (
                <ErrorState error={statsQuery.error} onRetry={statsQuery.refetch} compact />
              ) : statsQuery.isLoading ? (
                <ListSkeleton rows={2} />
              ) : (
                <div className="flex items-center gap-4">
                  <div className="relative w-16 h-16 shrink-0">
                    <svg className="w-16 h-16 -rotate-90" viewBox="0 0 36 36" aria-hidden="true">
                      <circle cx="18" cy="18" r="15" fill="none" stroke="hsl(var(--muted))" strokeWidth="3" />
                      <circle
                        cx="18"
                        cy="18"
                        r="15"
                        fill="none"
                        stroke="hsl(var(--primary))"
                        strokeWidth="3"
                        strokeDasharray={`${learningProgress * 0.94} 100`}
                        strokeLinecap="round"
                      />
                    </svg>
                    <span className="absolute inset-0 flex items-center justify-center text-sm font-bold text-foreground">
                      {formatNumber(learningProgress)}%
                    </span>
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm text-muted-foreground">Средний прогресс по записям на курсы</p>
                    <p className="text-lg font-bold text-foreground">
                      {formatNumber(enrollmentsCompleted)} из{' '}
                      {pluralize(enrollmentsTotal, 'записи', 'записей', 'записей')} завершено
                    </p>
                    <Link to="/cabinet/learning" className="text-xs text-primary hover:underline">
                      Перейти к обучению
                    </Link>
                  </div>
                </div>
              )}
            </Card>
          </div>
        </div>
      </div>
    </PageContainer>
  );
}
