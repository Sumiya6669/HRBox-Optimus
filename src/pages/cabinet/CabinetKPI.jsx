import React, { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/client";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Zap, TrendingUp, TrendingDown, Minus, UserX } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/AuthContext";
import PageContainer from "@/components/common/PageContainer";
import EmptyState from "@/components/common/EmptyState";
import ErrorState from "@/components/common/ErrorState";
import StatusBadge from "@/components/common/StatusBadge";
import { formatNumber } from "@/lib/format";

/**
 * KPI сотрудника.
 * Аудит: страница была пустой при 8 записях в БД — фильтр шёл по me.id (id профиля),
 * а не по employee_id. Теперь единственный источник — employeeId из AuthContext.
 * BUG-011: «пусто» и «ошибка» — разные состояния.
 * BUG-051: статусы через StatusBadge, а не английские коды.
 */

/** Процент выполнения; null, если план не задан (деление на ноль). */
function kpiPercent(kpi) {
  const target = Number(kpi?.target);
  const actual = Number(kpi?.actual);
  if (!Number.isFinite(target) || target === 0 || !Number.isFinite(actual)) return null;
  return Math.round((actual / target) * 100);
}

function KpiSkeleton() {
  return (
    <div className="space-y-6" aria-hidden="true">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[0, 1, 2, 3].map((i) => (
          <Card key={i} className="p-5 animate-pulse">
            <div className="h-3 w-24 bg-muted/60 rounded mb-3" />
            <div className="h-8 w-16 bg-muted rounded" />
          </Card>
        ))}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {[0, 1, 2, 3].map((i) => (
          <Card key={i} className="p-5 animate-pulse">
            <div className="h-4 w-40 bg-muted rounded mb-3" />
            <div className="h-3 w-28 bg-muted/60 rounded mb-4" />
            <div className="h-2 w-full bg-muted/60 rounded" />
          </Card>
        ))}
      </div>
    </div>
  );
}

export default function CabinetKPI() {
  const { employeeId, isLoadingAuth } = useAuth();

  const {
    data: kpis,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["kpi-me", employeeId],
    queryFn: () => api.entities.KPI.filter({ employee_id: employeeId }, "-created_date"),
    enabled: !!employeeId,
  });

  const list = useMemo(() => kpis || [], [kpis]);

  /** Средневзвешенное выполнение — только по KPI с заданным планом. */
  const avg = useMemo(() => {
    const scored = list.filter((k) => kpiPercent(k) !== null);
    const weightSum = scored.reduce((s, k) => s + (Number(k.weight) || 1), 0);
    if (!weightSum) return 0;
    return Math.round(
      scored.reduce((s, k) => s + kpiPercent(k) * (Number(k.weight) || 1), 0) / weightSum
    );
  }, [list]);

  const doneCount = list.filter((k) => (kpiPercent(k) ?? 0) >= 100).length;
  const inWorkCount = list.filter((k) => (kpiPercent(k) ?? 0) < 100 && k.status === "active").length;

  return (
    <PageContainer
      title="KPI"
      description="Ключевые показатели эффективности: план, факт и вес каждого показателя"
    >
      {/* Учётка без карточки сотрудника — личных данных быть не может (не ошибка). */}
      {!employeeId && !isLoadingAuth ? (
        <EmptyState
          icon={UserX}
          title="Учётная запись не связана с карточкой сотрудника"
          description="Показатели привязаны к карточке сотрудника. Обратитесь в HR, чтобы связать вашу учётную запись — после этого KPI появятся здесь."
        />
      ) : error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : isLoading || isLoadingAuth ? (
        <KpiSkeleton />
      ) : list.length === 0 ? (
        <EmptyState
          icon={Zap}
          title="KPI не назначены"
          description="Показатели назначает руководитель. Обратитесь к нему, если ожидаете KPI на текущий период."
        />
      ) : (
        <div className="space-y-6">
          {/* Сводка */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card className="p-5">
              <div className="text-xs text-muted-foreground mb-1">Среднее выполнение</div>
              <div className="text-3xl font-bold text-foreground">{formatNumber(avg)}%</div>
              <Progress value={Math.min(100, avg)} className="h-2 mt-3" />
            </Card>
            <Card className="p-5">
              <div className="text-xs text-muted-foreground mb-1">Всего показателей</div>
              <div className="text-3xl font-bold text-foreground">{formatNumber(list.length)}</div>
            </Card>
            <Card className="p-5">
              <div className="text-xs text-muted-foreground mb-1">Выполнено</div>
              <div className="text-3xl font-bold text-success">{formatNumber(doneCount)}</div>
            </Card>
            <Card className="p-5">
              <div className="text-xs text-muted-foreground mb-1">В работе</div>
              <div className="text-3xl font-bold text-warning">{formatNumber(inWorkCount)}</div>
            </Card>
          </div>

          {/* Список показателей */}
          <ul role="list" className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {list.map((k) => {
              const pct = kpiPercent(k);
              const trend = pct === null ? "flat" : pct >= 100 ? "up" : pct >= 50 ? "flat" : "down";
              const TrendIcon = trend === "up" ? TrendingUp : trend === "down" ? TrendingDown : Minus;
              const unit = k.unit ? ` ${k.unit}` : "";
              const remainder = pct === null ? null : Number(k.target) - Number(k.actual || 0);
              return (
                <li key={k.id} role="listitem">
                  <Card className="p-5 h-full">
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          {/* BUG-051: русский ярлык вместо active/approved/overdue */}
                          <StatusBadge value={k.status} />
                          <StatusBadge value={k.scope} variant="outline" />
                        </div>
                        <h3 className="font-semibold text-foreground">{k.title}</h3>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Период: {k.period || "—"}
                        </p>
                      </div>
                      <div
                        className={cn(
                          "flex items-center gap-1 text-sm font-medium shrink-0",
                          trend === "up"
                            ? "text-success"
                            : trend === "down"
                              ? "text-destructive"
                              : "text-warning"
                        )}
                      >
                        <TrendIcon className="w-4 h-4" aria-hidden="true" />
                        {pct === null ? "—" : `${formatNumber(pct)}%`}
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span className="text-muted-foreground">
                        Факт: {formatNumber(k.actual)}
                        {unit}
                      </span>
                      <span className="text-muted-foreground">
                        План: {formatNumber(k.target)}
                        {unit}
                      </span>
                    </div>
                    <Progress value={Math.min(100, pct ?? 0)} className="h-2" />
                    <div className="flex items-center justify-between mt-2 text-xs text-muted-foreground">
                      <span>Вес: {formatNumber(k.weight)}</span>
                      <span>
                        {pct === null
                          ? "План не задан"
                          : remainder <= 0
                            ? "Цель достигнута"
                            : `Осталось: ${formatNumber(remainder)}${unit}`}
                      </span>
                    </div>
                  </Card>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </PageContainer>
  );
}
