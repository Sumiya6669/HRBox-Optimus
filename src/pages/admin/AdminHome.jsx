import React from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Users, Briefcase, Building2, Newspaper, GraduationCap, Award, BarChart3,
  CalendarDays, Settings, ScrollText, ArrowRight, AlertTriangle, ClipboardList,
  Store, Wallet, FileText,
} from 'lucide-react';

import { api } from '@/api/client';
import PageContainer from '@/components/common/PageContainer';
import ErrorState from '@/components/common/ErrorState';
import EmptyState from '@/components/common/EmptyState';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/AuthContext';
import { formatNumber, formatDate, pluralize } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * Панель администрирования.
 *
 * BUG-014/015/016: три из шести счётчиков расходились с модулями, потому что
 *          каждая плитка считала array.length по своему запросу. Теперь все цифры
 *          приходят из api.rpc.portalStats() — того же источника, что и на главной.
 * BUG-016: «Заявок на отпуск: 3 в обзоре, 7 в модуле» — метрика подписана явно
 *          «Ожидают согласования» (leave_pending), безымянных чисел на панели нет.
 * BUG-011: ошибка загрузки показывается ErrorState, а не нулями.
 * BUG-077: числительные — через pluralize.
 * Аудит: плитки кликабельны и ведут в соответствующий модуль; добавлен блок
 *          «Требует внимания» с прямыми ссылками на просроченные заявки,
 *          необработанные обращения и опросы с истёкшим сроком.
 */

function TilesSkeleton() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4" aria-hidden="true">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <Card key={i} className="p-4 h-[116px] animate-pulse bg-muted/40" />
      ))}
    </div>
  );
}

/** adminOnly — маршрут закрыт RequireAuth роль admin, HR такую плитку не видит. */
const MODULES = [
  { label: 'Пользователи', desc: 'Учётные записи, роли и приглашения', path: '/admin/users', icon: Users, adminOnly: true },
  { label: 'Сотрудники', desc: 'Кадровый состав и карточки', path: '/admin/employees', icon: Briefcase },
  { label: 'Отделы', desc: 'Структура организации', path: '/admin/departments', icon: Building2 },
  { label: 'Новости', desc: 'Управление контентом', path: '/admin/news', icon: Newspaper },
  { label: 'Страницы', desc: 'CMS-страницы портала', path: '/admin/pages', icon: FileText },
  { label: 'Курсы', desc: 'Обучение и сертификаты', path: '/admin/courses', icon: GraduationCap },
  { label: 'Достижения', desc: 'Геймификация и награды', path: '/admin/achievements', icon: Award },
  { label: 'Магазин наград', desc: 'Товары за баллы', path: '/admin/store', icon: Store },
  { label: 'Операции кошелька', desc: 'Начисления и списания баллов', path: '/admin/wallet', icon: Wallet },
  { label: 'Опросы', desc: 'Регулярные и пульс-опросы', path: '/admin/surveys', icon: BarChart3 },
  { label: 'Отпуска', desc: 'Заявки и согласования', path: '/admin/vacation', icon: CalendarDays },
  { label: 'Настройки', desc: 'Конфигурация портала', path: '/admin/settings', icon: Settings, adminOnly: true },
  { label: 'Журнал аудита', desc: 'Действия пользователей', path: '/admin/audit', icon: ScrollText, adminOnly: true },
];

export default function AdminHome() {
  const { isAdmin } = useAuth();
  const today = formatDate(new Date(), 'iso');

  // BUG-014/015/016: единственный источник всех обзорных цифр.
  const statsQuery = useQuery({
    queryKey: ['portal-stats'],
    queryFn: () => api.rpc.portalStats(),
  });

  // Опросы с истёкшим сроком — вьюха v_surveys считает статус по датам (BUG-019).
  const expiredSurveysQuery = useQuery({
    queryKey: ['admin-expired-surveys', today],
    queryFn: async () => {
      const { data, error } = await api.supabase
        .from('v_surveys')
        .select('id, title, end_date, effective_status')
        .eq('status', 'active')
        .eq('is_expired', true)
        .order('end_date', { ascending: true })
        .limit(20);
      if (error) throw error;
      return data || [];
    },
  });

  const stats = statsQuery.data || {};
  const expiredSurveys = expiredSurveysQuery.data || [];

  // Каждая плитка подписана явно: что за число и куда ведёт (BUG-016).
  const tiles = [
    {
      label: 'Сотрудников',
      hint: 'Кроме уволенных',
      value: stats.employees_total,
      icon: Users,
      path: '/admin/employees',
      tone: 'bg-primary/10 text-primary',
    },
    {
      label: 'Отделов',
      hint: 'В справочнике',
      value: stats.departments_total,
      icon: Building2,
      path: '/admin/departments',
      tone: 'bg-success/10 text-success',
    },
    {
      label: 'Новостей опубликовано',
      hint: `Всего записей: ${formatNumber(stats.news_total ?? 0)}`,
      value: stats.news_published,
      icon: Newspaper,
      path: '/admin/news',
      tone: 'bg-warning/10 text-warning',
    },
    {
      label: 'Курсов опубликовано',
      hint: `Записей на курсы: ${formatNumber(stats.enrollments_total ?? 0)}`,
      value: stats.courses_published,
      icon: GraduationCap,
      path: '/admin/courses',
      tone: 'bg-brand-learning/10 text-brand-learning',
    },
    {
      label: 'Опросов активно',
      hint: `Всего опросов: ${formatNumber(stats.surveys_total ?? 0)}`,
      value: stats.surveys_active,
      icon: BarChart3,
      path: '/admin/surveys',
      tone: 'bg-info/10 text-info',
    },
    {
      // BUG-016: раньше здесь было безымянное «Заявок на отпуск».
      label: 'Отпуск: ожидают согласования',
      hint: `Всего заявок: ${formatNumber(stats.leave_total ?? 0)}`,
      value: stats.leave_pending,
      icon: CalendarDays,
      path: '/admin/vacation',
      tone: 'bg-destructive/10 text-destructive',
    },
  ];

  const attention = [
    {
      key: 'leave_overdue',
      count: Number(stats.leave_overdue) || 0,
      title: 'Просроченные заявки на отпуск',
      description: (n) =>
        `${pluralize(n, 'заявка', 'заявки', 'заявок')} ожидает решения, хотя отпуск уже начался.`,
      to: '/admin/vacation',
      linkLabel: 'Открыть отпуска',
      icon: CalendarDays,
    },
    {
      key: 'requests_pending',
      count: Number(stats.requests_pending) || 0,
      title: 'Служебные заявки в ожидании',
      description: (n) => `${pluralize(n, 'заявка', 'заявки', 'заявок')} не взята в работу.`,
      to: '/cabinet/requests',
      linkLabel: 'Открыть заявки',
      icon: ClipboardList,
    },
    {
      key: 'surveys_expired',
      count: expiredSurveys.length,
      title: 'Опросы с истёкшим сроком',
      description: (n) =>
        `${pluralize(n, 'опрос', 'опроса', 'опросов')} числится активным, хотя дата окончания прошла.`,
      to: '/admin/surveys',
      linkLabel: 'Открыть опросы',
      icon: BarChart3,
      details: expiredSurveys.slice(0, 3).map((s) => `${s.title} — до ${formatDate(s.end_date)}`),
    },
  ].filter((item) => item.count > 0);

  const attentionError = statsQuery.error || expiredSurveysQuery.error;

  return (
    <PageContainer
      title="Панель администрирования"
      description="Управление порталом, персоналом и контентом. Все цифры на этой странице считает сервер (portal_stats)."
      width="wide"
    >
      <div className="space-y-6">
        {/* Обзорные цифры */}
        {statsQuery.error ? (
          <ErrorState error={statsQuery.error} onRetry={statsQuery.refetch} />
        ) : statsQuery.isLoading ? (
          <TilesSkeleton />
        ) : (
          <ul role="list" className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {tiles.map((tile) => {
              const Icon = tile.icon;
              return (
                <li key={tile.label} role="listitem">
                  <Card className="h-full hover:shadow-premium transition-all duration-200">
                    {/* Аудит: счётчик кликабелен и ведёт в свой модуль */}
                    <Link
                      to={tile.path}
                      className="block h-full p-4 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className={cn('w-10 h-10 rounded-lg flex items-center justify-center mb-3', tile.tone)}>
                        <Icon className="w-5 h-5" aria-hidden="true" />
                      </span>
                      <span className="block text-2xl font-bold text-foreground tabular-nums">
                        {formatNumber(tile.value ?? 0)}
                      </span>
                      <span className="block text-xs text-muted-foreground mt-1">{tile.label}</span>
                      {tile.hint && (
                        <span className="block text-[11px] text-muted-foreground/70 mt-1">{tile.hint}</span>
                      )}
                    </Link>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}

        {/* Аудит: блок «Требует внимания» с прямыми ссылками */}
        <section aria-labelledby="admin-attention-title">
          <h2 id="admin-attention-title" className="font-semibold text-foreground mb-3 flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-warning" aria-hidden="true" />
            Требует внимания
          </h2>
          {attentionError ? (
            <ErrorState
              error={attentionError}
              onRetry={() => {
                statsQuery.refetch();
                expiredSurveysQuery.refetch();
              }}
              compact
            />
          ) : statsQuery.isLoading || expiredSurveysQuery.isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4" aria-hidden="true">
              {[0, 1, 2].map((i) => (
                <Card key={i} className="p-5 h-[132px] animate-pulse bg-muted/40" />
              ))}
            </div>
          ) : attention.length === 0 ? (
            <EmptyState
              icon={AlertTriangle}
              compact
              title="Всё в порядке"
              description="Просроченных заявок, необработанных обращений и зависших опросов нет."
            />
          ) : (
            <ul role="list" className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {attention.map((item) => {
                const Icon = item.icon;
                return (
                  <li key={item.key} role="listitem">
                    <Card className="p-5 h-full border-warning/40 flex flex-col gap-2">
                      <div className="flex items-start gap-3">
                        <span className="w-10 h-10 rounded-lg bg-warning/10 text-warning flex items-center justify-center shrink-0">
                          <Icon className="w-5 h-5" aria-hidden="true" />
                        </span>
                        <div className="min-w-0">
                          <p className="text-2xl font-bold text-foreground tabular-nums leading-none">
                            {formatNumber(item.count)}
                          </p>
                          <p className="text-sm font-medium text-foreground mt-1">{item.title}</p>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground">{item.description(item.count)}</p>
                      {item.details?.length > 0 && (
                        <ul className="text-xs text-muted-foreground/80 space-y-0.5">
                          {item.details.map((d) => (
                            <li key={d} className="truncate">
                              {d}
                            </li>
                          ))}
                        </ul>
                      )}
                      <Button asChild size="sm" variant="outline" className="mt-auto self-start min-h-[40px]">
                        <Link to={item.to}>{item.linkLabel}</Link>
                      </Button>
                    </Card>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Модули */}
        <section aria-labelledby="admin-modules-title">
          <h2 id="admin-modules-title" className="font-semibold text-foreground mb-3">
            Модули управления
          </h2>
          <ul role="list" className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {MODULES.filter((m) => !m.adminOnly || isAdmin).map((m) => {
              const Icon = m.icon;
              return (
                <li key={m.path} role="listitem">
                  <Card className="h-full hover:shadow-premium hover:border-primary/30 transition">
                    <Link
                      to={m.path}
                      className="flex items-center gap-4 p-5 group rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="w-12 h-12 rounded-xl bg-muted group-hover:bg-accent flex items-center justify-center transition shrink-0">
                        <Icon className="w-6 h-6 text-muted-foreground group-hover:text-primary transition" aria-hidden="true" />
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block font-medium text-foreground">{m.label}</span>
                        <span className="block text-xs text-muted-foreground">{m.desc}</span>
                      </span>
                      <ArrowRight
                        className="w-4 h-4 text-muted-foreground/40 group-hover:text-primary group-hover:translate-x-1 transition shrink-0"
                        aria-hidden="true"
                      />
                    </Link>
                  </Card>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </PageContainer>
  );
}
