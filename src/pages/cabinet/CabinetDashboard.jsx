import React, { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/client";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  GraduationCap, Target, Zap, Wallet, CalendarDays, BookOpen, Award,
  ArrowRight, Clock, Newspaper, ChevronRight, AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/AuthContext";
import { useBirthdayPoints } from "@/hooks/useBirthdayPoints";
import PageContainer from "@/components/common/PageContainer";
import ErrorState from "@/components/common/ErrorState";
import StatusBadge from "@/components/common/StatusBadge";
import { formatDate, formatNumber, formatPoints, formatSigned, pluralize, leaveDays } from "@/lib/format";

/**
 * Главная личного кабинета.
 * BUG-034: приветствие берёт имя из карточки сотрудника (AuthContext), а не «сотрудник».
 *          Если учётка не связана с сотрудником — заметный баннер вместо пустых блоков.
 * BUG-075: числительные согласованы через pluralize.
 * BUG-013: новости читаются из v_news со status='published' — дублей больше нет.
 * BUG-053: все даты — formatDate.
 * BUG-055/056: баланс — formatPoints (никаких «₸KZ»), изменение — formatSigned (нет «−0»).
 * BUG-011: у каждого блока есть состояние ошибки.
 * Личные блоки фильтруются по employeeId, а не по me.id — иначе они молча пустые.
 * Скелетоны завязаны на isLoading, поэтому при прогретом кэше не мигают (ЭТАП 6 аудита).
 */

function BlockSkeleton({ rows = 3 }) {
  return (
    <div className="space-y-3 animate-pulse" aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i}>
          <div className="h-3 w-2/3 bg-muted rounded mb-2" />
          <div className="h-2 w-full bg-muted/60 rounded" />
        </div>
      ))}
    </div>
  );
}

/** Единый каркас виджета: заголовок, ссылка и обязательные три состояния. */
function Widget({
  title, icon: Icon, iconClass, to, linkLabel = "Все",
  error, isLoading, onRetry, isEmpty, emptyText, children,
}) {
  return (
    <Card className="p-5 hover:shadow-premium transition-all duration-200">
      <div className="flex items-center justify-between mb-4 gap-2">
        <h2 className="font-semibold text-foreground flex items-center gap-2">
          <Icon className={cn("w-5 h-5", iconClass)} aria-hidden="true" />
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
        <BlockSkeleton />
      ) : isEmpty ? (
        <p className="text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        children
      )}
    </Card>
  );
}

/** Процент выполнения KPI; null, если план не задан. */
function kpiPercent(kpi) {
  const target = Number(kpi?.target);
  const actual = Number(kpi?.actual);
  if (!Number.isFinite(target) || target === 0 || !Number.isFinite(actual)) return null;
  return Math.round((actual / target) * 100);
}

const QUICK_LINKS = [
  { label: "Обучение", path: "/cabinet/learning", icon: GraduationCap, color: "bg-brand-learning/10 text-brand-learning" },
  { label: "Цели", path: "/cabinet/goals", icon: Target, color: "bg-success/10 text-success" },
  { label: "KPI", path: "/cabinet/kpi", icon: Zap, color: "bg-warning/10 text-warning" },
  { label: "Кошелёк", path: "/cabinet/wallet", icon: Wallet, color: "bg-brand-wallet/10 text-brand-wallet" },
  { label: "Отпуск", path: "/cabinet/vacation", icon: CalendarDays, color: "bg-info/10 text-info" },
  { label: "Библиотека", path: "/cabinet/library", icon: BookOpen, color: "bg-brand-library/10 text-brand-library" },
];

export default function CabinetDashboard() {
  const { user, employee, employeeId, isLoadingAuth } = useAuth();
  useBirthdayPoints();

  const personal = { enabled: !!employeeId };

  const goalsQuery = useQuery({
    queryKey: ["goals-me", employeeId],
    queryFn: () => api.entities.Goal.filter({ employee_id: employeeId }, "-created_date"),
    ...personal,
  });
  const kpisQuery = useQuery({
    queryKey: ["kpi-me", employeeId],
    queryFn: () => api.entities.KPI.filter({ employee_id: employeeId }),
    ...personal,
  });
  const walletQuery = useQuery({
    queryKey: ["wallet-me", employeeId],
    queryFn: () => api.entities.WalletTransaction.filter({ employee_id: employeeId }, "-date", 100),
    ...personal,
  });
  const balanceQuery = useQuery({
    queryKey: ["wallet-balance", employeeId],
    queryFn: () => api.rpc.walletBalance(employeeId),
    ...personal,
  });
  const leavesQuery = useQuery({
    queryKey: ["leaves-me", employeeId],
    queryFn: () => api.entities.LeaveRequest.filter({ employee_id: employeeId }, "-start_date"),
    ...personal,
  });
  const requestsQuery = useQuery({
    queryKey: ["req-me", employeeId],
    queryFn: () => api.entities.ServiceRequest.filter({ employee_id: employeeId }, "-created_date"),
    ...personal,
  });
  const achievementsQuery = useQuery({
    queryKey: ["ach-me", employeeId],
    queryFn: () => api.entities.Achievement.filter({ employee_id: employeeId }, "-date"),
    ...personal,
  });

  // BUG-013: только опубликованные новости из вьюхи, три штуки, свежие сверху.
  const newsQuery = useQuery({
    queryKey: ["news-dashboard"],
    queryFn: async () => {
      const { data, error } = await api.supabase
        .from("v_news")
        .select("*")
        .eq("status", "published")
        .order("published_date", { ascending: false })
        .limit(3);
      if (error) throw error;
      return data || [];
    },
  });

  const coursesQuery = useQuery({
    queryKey: ["courses-dashboard"],
    queryFn: async () => {
      const { data, error } = await api.supabase
        .from("v_courses")
        .select("*")
        .eq("status", "published")
        .order("is_mandatory", { ascending: false })
        .limit(3);
      if (error) throw error;
      return data || [];
    },
  });

  /* ------------------------------------------------------------ расчёты */

  const goals = goalsQuery.data || [];
  const kpis = kpisQuery.data || [];
  const leaves = leavesQuery.data || [];
  const requests = requestsQuery.data || [];
  const achievements = achievementsQuery.data || [];
  const wallet = walletQuery.data || [];

  const activeGoals = goals.filter((g) => g.status === "active");
  const pendingLeaves = leaves.filter((l) => l.status === "pending").length;
  const pendingRequests = requests.filter((r) => r.status === "pending").length;

  // BUG-017: длительность отпуска считает только leaveDays.
  const usedLeaveDays = leaves
    .filter((l) => l.status === "approved")
    .reduce((s, l) => s + leaveDays(l.start_date, l.end_date), 0);
  const availableLeaveDays = Math.max(0, (employee?.vacation_days_per_year ?? 24) - usedLeaveDays);

  const avgKpi = useMemo(() => {
    const scored = kpis.filter((k) => kpiPercent(k) !== null);
    const weightSum = scored.reduce((s, k) => s + (Number(k.weight) || 1), 0);
    if (!weightSum) return 0;
    return Math.round(scored.reduce((s, k) => s + kpiPercent(k) * (Number(k.weight) || 1), 0) / weightSum);
  }, [kpis]);

  // Изменение баланса за 30 дней — BUG-056: formatSigned не показывает «−0».
  const last30 = useMemo(() => {
    const from = new Date();
    from.setDate(from.getDate() - 30);
    return wallet
      .filter((t) => new Date(t.date) >= from)
      .reduce((s, t) => s + (Number(t.amount) || 0), 0);
  }, [wallet]);

  const today = new Date();
  const hour = today.getHours();
  const greeting = hour < 6 ? "Доброй ночи" : hour < 12 ? "Доброе утро" : hour < 18 ? "Добрый день" : "Добрый вечер";
  // BUG-034: имя из карточки сотрудника, профиль — только запасной вариант.
  const displayName = employee?.name || user?.full_name || null;
  const isUnlinked = !employeeId && !isLoadingAuth;

  const pendingParts = [
    pendingLeaves > 0 && pluralize(pendingLeaves, "заявка на отпуск", "заявки на отпуск", "заявок на отпуск"),
    // BUG-075: было «1 служебных записок»
    pendingRequests > 0 && pluralize(pendingRequests, "служебная записка", "служебные записки", "служебных записок"),
  ].filter(Boolean);

  return (
    <PageContainer
      title="Личный кабинет"
      documentTitle="Личный кабинет"
      description="Ваши показатели, цели, обучение и заявки в одном месте"
      width="wide"
    >
      <div className="space-y-5">
        {/* Приветствие */}
        <div className="relative rounded-2xl overflow-hidden bg-gradient-to-br from-primary via-primary to-primary/80 p-6 text-primary-foreground shadow-premium-lg">
          <div
            className="absolute inset-0 opacity-10"
            style={{ backgroundImage: "radial-gradient(circle at 80% 50%, white 1px, transparent 1px)", backgroundSize: "32px 32px" }}
            aria-hidden="true"
          />
          <div className="relative flex items-center justify-between flex-wrap gap-4">
            <div>
              <h2 className="text-2xl font-bold">
                {greeting}
                {displayName ? `, ${displayName}` : ""}!
              </h2>
              {/* BUG-053: дата одного формата на весь портал */}
              <p className="text-primary-foreground/80 text-sm mt-1">{formatDate(today, "long")}</p>
            </div>
            {!isUnlinked && (
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <div className="text-xs text-primary-foreground/70">Баланс</div>
                  {/* BUG-055: баллы, а не несуществующая валюта «₸KZ» */}
                  <div className="text-xl font-bold">{formatPoints(balanceQuery.data ?? 0)}</div>
                  <div className="text-xs text-primary-foreground/70">
                    за 30 дней: {formatSigned(last30, (n) => formatPoints(n, { short: true }))}
                  </div>
                </div>
                <div className="w-px h-10 bg-primary-foreground/20" aria-hidden="true" />
                <div className="text-right">
                  <div className="text-xs text-primary-foreground/70">Достижений</div>
                  <div className="text-xl font-bold">{formatNumber(achievements.length)}</div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* BUG-034: несвязанная учётка — понятный баннер вместо пустых блоков */}
        {isUnlinked && (
          <div
            role="alert"
            className="flex items-start gap-3 rounded-xl border border-warning/40 bg-warning/10 px-4 py-4"
          >
            <AlertTriangle className="w-6 h-6 text-warning shrink-0" aria-hidden="true" />
            <div>
              <p className="font-semibold text-foreground">
                Ваша учётная запись не связана с карточкой сотрудника, обратитесь в HR
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                Пока связи нет, личные разделы — KPI, цели, отпуск, кошелёк и заявки — остаются недоступны.
                Общие разделы портала работают в обычном режиме.
              </p>
            </div>
          </div>
        )}

        {/* Быстрые переходы */}
        <nav aria-label="Быстрые переходы">
          <ul role="list" className="grid grid-cols-3 md:grid-cols-6 gap-3">
            {QUICK_LINKS.map((q) => {
              const Icon = q.icon;
              return (
                <li key={q.path} role="listitem">
                  <Link to={q.path} className="group block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <Card className="p-4 flex flex-col items-center gap-2 hover:shadow-premium-lg hover:border-primary/20 transition-all duration-200">
                      <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center transition-transform group-hover:scale-110", q.color)}>
                        <Icon className="w-5 h-5" aria-hidden="true" />
                      </div>
                      <span className="text-xs font-medium text-foreground/70 group-hover:text-primary transition">{q.label}</span>
                    </Card>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Ожидают внимания (BUG-075) */}
        {pendingParts.length > 0 && (
          <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-warning/10 border border-warning/40">
            <Clock className="w-5 h-5 text-warning shrink-0" aria-hidden="true" />
            <span className="text-sm text-foreground">Ожидают вашего внимания: {pendingParts.join(", ")}</span>
            <Link
              to={pendingLeaves > 0 ? "/cabinet/vacation" : "/cabinet/requests"}
              className="ml-auto text-sm text-primary font-medium hover:underline flex items-center gap-1"
            >
              Перейти <ChevronRight className="w-4 h-4" aria-hidden="true" />
            </Link>
          </div>
        )}

        {/* Личные виджеты — только для связанной учётки */}
        {!isUnlinked && (
          <>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
              <Widget
                title="Мои KPI"
                icon={Zap}
                iconClass="text-warning"
                to="/cabinet/kpi"
                error={kpisQuery.error}
                isLoading={kpisQuery.isLoading || isLoadingAuth}
                onRetry={kpisQuery.refetch}
                isEmpty={kpis.length === 0}
                emptyText="KPI не назначены — обратитесь к руководителю."
              >
                <div className="flex items-end gap-2 mb-1">
                  <div className="text-3xl font-bold text-foreground">{formatNumber(avgKpi)}%</div>
                  <div className="text-xs text-muted-foreground mb-1.5">среднее выполнение</div>
                </div>
                <Progress value={Math.min(100, avgKpi)} className="h-2 mb-4" />
                <ul role="list" className="space-y-2.5">
                  {kpis.slice(0, 3).map((k) => {
                    const pct = kpiPercent(k);
                    return (
                      <li key={k.id} role="listitem" className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground truncate flex-1">{k.title}</span>
                        <Badge variant={(pct ?? 0) >= 100 ? "success" : "secondary"} className="ml-2 shrink-0">
                          {pct === null ? "—" : `${formatNumber(pct)}%`}
                        </Badge>
                      </li>
                    );
                  })}
                </ul>
              </Widget>

              <Widget
                title="Мои цели"
                icon={Target}
                iconClass="text-success"
                to="/cabinet/goals"
                error={goalsQuery.error}
                isLoading={goalsQuery.isLoading || isLoadingAuth}
                onRetry={goalsQuery.refetch}
                isEmpty={activeGoals.length === 0}
                emptyText="Активных целей нет — создайте первую в разделе «Цели»."
              >
                <ul role="list" className="space-y-3">
                  {activeGoals.slice(0, 4).map((g) => (
                    <li key={g.id} role="listitem">
                      <div className="flex items-center justify-between text-sm mb-1">
                        <span className="text-muted-foreground truncate flex-1">{g.title}</span>
                        <span className="font-medium text-foreground ml-2">{formatNumber(g.progress)}%</span>
                      </div>
                      <Progress value={g.progress} className="h-1.5" />
                    </li>
                  ))}
                </ul>
              </Widget>

              <Widget
                title="Обучение"
                icon={GraduationCap}
                iconClass="text-brand-learning"
                to="/cabinet/learning"
                error={coursesQuery.error}
                isLoading={coursesQuery.isLoading}
                onRetry={coursesQuery.refetch}
                isEmpty={(coursesQuery.data || []).length === 0}
                emptyText="Опубликованных курсов пока нет."
              >
                <ul role="list" className="space-y-2.5">
                  {(coursesQuery.data || []).map((c) => (
                    <li key={c.id} role="listitem">
                      <Link
                        to={`/cabinet/learning/${c.id}`}
                        className="flex items-center gap-3 rounded-lg -mx-2 px-2 py-1 hover:bg-muted/50 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <div className="w-8 h-8 rounded-lg bg-brand-learning/10 text-brand-learning flex items-center justify-center shrink-0">
                          <GraduationCap className="w-4 h-4" aria-hidden="true" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-foreground truncate">{c.title}</div>
                          <div className="text-xs text-muted-foreground truncate">
                            {c.duration_minutes ? pluralize(c.duration_minutes, "минута", "минуты", "минут") : "—"}
                            {c.category ? ` · ${c.category}` : ""}
                          </div>
                        </div>
                        {/* BUG-051: формат курса человекочитаемо */}
                        <StatusBadge value={c.format} className="shrink-0" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </Widget>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
              <Widget
                title="Мой отпуск"
                icon={CalendarDays}
                iconClass="text-info"
                to="/cabinet/vacation"
                error={leavesQuery.error}
                isLoading={leavesQuery.isLoading || isLoadingAuth}
                onRetry={leavesQuery.refetch}
              >
                <div className="grid grid-cols-3 gap-3 mb-4">
                  <div className="text-center p-2 rounded-lg bg-muted/50">
                    <div className="text-2xl font-bold text-foreground">{formatNumber(availableLeaveDays)}</div>
                    <div className="text-[10px] text-muted-foreground">Доступно дней</div>
                  </div>
                  <div className="text-center p-2 rounded-lg bg-muted/50">
                    <div className="text-2xl font-bold text-foreground">{formatNumber(usedLeaveDays)}</div>
                    <div className="text-[10px] text-muted-foreground">Использовано</div>
                  </div>
                  <div className="text-center p-2 rounded-lg bg-warning/10">
                    <div className="text-2xl font-bold text-warning">{formatNumber(pendingLeaves)}</div>
                    <div className="text-[10px] text-muted-foreground">Ожидает</div>
                  </div>
                </div>
                <Link to="/cabinet/vacation" className="text-sm text-primary font-medium inline-flex items-center gap-1 hover:underline">
                  Запросить отпуск <ArrowRight className="w-4 h-4" aria-hidden="true" />
                </Link>
              </Widget>

              <Widget
                title="Достижения"
                icon={Award}
                iconClass="text-warning"
                to="/cabinet/wallet"
                linkLabel="Кошелёк"
                error={achievementsQuery.error}
                isLoading={achievementsQuery.isLoading || isLoadingAuth}
                onRetry={achievementsQuery.refetch}
                isEmpty={achievements.length === 0}
                emptyText="Достижений пока нет — они появятся после первых наград."
              >
                <ul role="list" className="flex flex-wrap gap-2">
                  {achievements.slice(0, 6).map((a) => (
                    <li
                      key={a.id}
                      role="listitem"
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-warning/10 border border-warning/30"
                    >
                      <Award className="w-3.5 h-3.5 text-warning" aria-hidden="true" />
                      <span className="text-xs font-medium text-foreground">{a.title}</span>
                      <span className="text-[10px] text-muted-foreground">{formatDate(a.date)}</span>
                    </li>
                  ))}
                </ul>
              </Widget>

              <Widget
                title="Новости"
                icon={Newspaper}
                iconClass="text-primary"
                to="/cabinet/news"
                error={newsQuery.error}
                isLoading={newsQuery.isLoading}
                onRetry={newsQuery.refetch}
                isEmpty={(newsQuery.data || []).length === 0}
                emptyText="Опубликованных новостей пока нет."
              >
                <ul role="list" className="space-y-3">
                  {(newsQuery.data || []).map((n) => (
                    <li key={n.id} role="listitem">
                      <Link
                        to={`/cabinet/news/${n.id}`}
                        className="flex gap-3 -mx-2 px-2 py-1 rounded-lg hover:bg-muted/50 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <div className="w-1 rounded-full bg-primary shrink-0" aria-hidden="true" />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-foreground truncate">{n.title}</div>
                          <div className="text-xs text-muted-foreground truncate">
                            {n.author_name || "HR"} · {formatDate(n.published_date)}
                          </div>
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              </Widget>
            </div>

            {/* Заявки */}
            <Widget
              title="Мои заявки"
              icon={Clock}
              iconClass="text-primary"
              to="/cabinet/requests"
              error={requestsQuery.error}
              isLoading={requestsQuery.isLoading || isLoadingAuth}
              onRetry={requestsQuery.refetch}
              isEmpty={requests.length === 0}
              emptyText="Служебных записок нет."
            >
              <ul role="list" className="space-y-2">
                {requests.slice(0, 4).map((r) => (
                  <li key={r.id} role="listitem">
                    <Link
                      to={`/cabinet/requests/${r.id}`}
                      className="flex items-center gap-3 -mx-2 px-2 py-1.5 rounded-lg hover:bg-muted/50 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <StatusBadge value={r.status} className="shrink-0" />
                      <span className="text-sm text-foreground truncate flex-1">{r.title}</span>
                      <span className="text-xs text-muted-foreground shrink-0">{formatDate(r.created_date)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Widget>
          </>
        )}

        {/* Новости доступны и без связи с карточкой сотрудника */}
        {isUnlinked && (
          <Widget
            title="Новости"
            icon={Newspaper}
            iconClass="text-primary"
            to="/cabinet/news"
            error={newsQuery.error}
            isLoading={newsQuery.isLoading}
            onRetry={newsQuery.refetch}
            isEmpty={(newsQuery.data || []).length === 0}
            emptyText="Опубликованных новостей пока нет."
          >
            <ul role="list" className="space-y-3">
              {(newsQuery.data || []).map((n) => (
                <li key={n.id} role="listitem">
                  <Link
                    to={`/cabinet/news/${n.id}`}
                    className="flex gap-3 -mx-2 px-2 py-1 rounded-lg hover:bg-muted/50 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <div className="w-1 rounded-full bg-primary shrink-0" aria-hidden="true" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-foreground truncate">{n.title}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {n.author_name || "HR"} · {formatDate(n.published_date)}
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </Widget>
        )}
      </div>
    </PageContainer>
  );
}
