import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { createEntity } from '@/api/entity';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  TrendingUp, TrendingDown, Activity, Percent, Users, Building2, Award,
  Clock, ShoppingBag, Download, BarChart3,
} from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import PageContainer from '@/components/common/PageContainer';
import EmptyState from '@/components/common/EmptyState';
import ErrorState from '@/components/common/ErrorState';
import FilterChips from '@/components/common/FilterChips';
import { formatDate, formatMonth, formatNumber, formatPoints, formatSigned } from '@/lib/format';
import { mutationErrorMessage } from '@/lib/dataErrors';
import { cn } from '@/lib/utils';
import { buildCSV, downloadCSV } from '@/lib/csv';
import { calculateWalletMetrics, calculateTotals, getReasonLabel } from '@/lib/walletUtils';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, Legend,
} from 'recharts';

/**
 * Аналитика программы баллов.
 *
 * BUG-037: «Топ-10 позиций каталога» читал несуществующее поле и всегда писал
 *          «Нет данных о покупках». Топ считается по store_orders
 *          (item_name / price_at_purchase), при их отсутствии — по списаниям
 *          из v_wallet_transactions, сгруппированным по названию позиции.
 * BUG-054: цвета графиков — только токены темы, никаких фиолетовых и оранжевых.
 * BUG-080: «Burn rate» — англицизм и неверная подпись; метрика называется
 *          «Доля списаний, %».
 * BUG-084: график динамики использовал сплайн и «проваливался в ноль» на текущем
 *          месяце. Теперь непрерывная ломаная type="monotone" без будущих точек,
 *          с маркерами, подписанными осями и tooltip'ом в баллах.
 */

// Цвета графиков берём из CSS-переменных темы (BUG-054).
const COLOR_PRIMARY = 'hsl(var(--primary))';
const COLOR_SUCCESS = 'hsl(var(--success))';
const COLOR_DESTRUCTIVE = 'hsl(var(--destructive))';
const COLOR_MUTED = 'hsl(var(--muted-foreground))';

const walletView = createEntity('v_wallet_transactions', { defaultSort: '-date' });

/** Предыдущий период той же длительности — для сравнения «период к периоду». */
function previousPeriod(from, to) {
  if (!from || !to) return null;
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  const lengthMs = end.getTime() - start.getTime();
  const prevEnd = new Date(start.getTime() - 86400000);
  const prevStart = new Date(prevEnd.getTime() - lengthMs);
  return { from: formatDate(prevStart, 'iso'), to: formatDate(prevEnd, 'iso') };
}

function SkeletonBlock() {
  return (
    <div className="space-y-5" aria-hidden="true">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <div key={i} className="h-24 animate-pulse rounded-xl bg-muted" />)}
      </div>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {[0, 1].map((i) => <div key={i} className="h-80 animate-pulse rounded-xl bg-muted" />)}
      </div>
    </div>
  );
}

/** Плитка показателя с необязательной дельтой к прошлому периоду. */
function MetricCard({ icon: Icon, iconClass, label, value, valueClass, hint, delta }) {
  return (
    <Card className="p-4">
      <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className={cn('h-4 w-4', iconClass)} aria-hidden="true" /> {label}
      </div>
      <div className={cn('text-2xl font-bold', valueClass)}>{value}</div>
      {hint && <div className="mt-1 text-[11px] text-muted-foreground">{hint}</div>}
      {delta}
    </Card>
  );
}

export default function AdminWalletReports() {
  const { toast } = useToast();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [compare, setCompare] = useState(false);
  const [dimension, setDimension] = useState('department');

  const where = useMemo(() => {
    const w = {};
    if (from || to) {
      w.date = {};
      if (from) w.date.gte = from;
      if (to) w.date.lte = to;
    }
    return w;
  }, [from, to]);

  const prev = useMemo(() => previousPeriod(from, to), [from, to]);
  const canCompare = !!prev;

  const txQuery = useQuery({
    queryKey: ['wallet-reports-tx', where],
    queryFn: () => walletView.filter(where, '-date', 5000),
  });

  const prevTxQuery = useQuery({
    queryKey: ['wallet-reports-tx-prev', prev],
    queryFn: () => walletView.filter({ date: { gte: prev.from, lte: prev.to } }, '-date', 5000),
    enabled: compare && canCompare,
  });

  // BUG-037: источник правды по покупкам — store_orders с зафиксированной ценой.
  const ordersQuery = useQuery({
    queryKey: ['wallet-reports-orders', from, to],
    queryFn: () => {
      const w = {};
      if (from) w.created_date = { ...(w.created_date || {}), gte: `${from}T00:00:00` };
      if (to) w.created_date = { ...(w.created_date || {}), lte: `${to}T23:59:59` };
      return api.entities.StoreOrder.filter(w, '-created_date', 5000);
    },
  });

  const employeesQuery = useQuery({ queryKey: ['employees'], queryFn: () => api.entities.Employee.list('name') });
  const reasonsQuery = useQuery({ queryKey: ['award-reasons'], queryFn: () => api.entities.AwardReason.list('title') });

  const txns = txQuery.data || [];
  const metrics = useMemo(
    () => calculateWalletMetrics(txns, employeesQuery.data || [], { orders: ordersQuery.data || [] }),
    [txns, employeesQuery.data, ordersQuery.data]
  );
  const prevTotals = useMemo(
    () => (compare && prevTxQuery.data ? calculateTotals(prevTxQuery.data) : null),
    [compare, prevTxQuery.data]
  );

  const dimensionStats = dimension === 'branch' ? metrics.branchStats : metrics.departmentStats;
  const dimensionTitle = dimension === 'branch' ? 'филиалам' : 'подразделениям';

  /** Дельта к предыдущему периоду — понятная подпись вместо «сырых» процентов. */
  const renderDelta = (current, previous, { invert = false, suffix = '' } = {}) => {
    if (previous === null || previous === undefined) return null;
    const diff = current - previous;
    const good = invert ? diff <= 0 : diff >= 0;
    return (
      <div className={cn('mt-1 text-[11px] font-medium', diff === 0 ? 'text-muted-foreground' : good ? 'text-success' : 'text-destructive')}>
        {formatSigned(diff)}{suffix} к прошлому периоду ({formatNumber(previous)}{suffix})
      </div>
    );
  };

  const handleExport = () => {
    try {
      const headers = ['Раздел', 'Показатель', 'Значение'];
      const rows = [
        ['Итоги', 'Начислено, баллы', metrics.totalEarned],
        ['Итоги', 'Списано, баллы', metrics.totalSpent],
        ['Итоги', 'Доля списаний, %', metrics.spendShare],
        ['Итоги', 'Активных сотрудников', metrics.activeUsersCount],
        ['Итоги', 'Всего сотрудников', metrics.totalEmployees],
        ['Итоги', 'Операций', metrics.totalTransactions],
        ...metrics.monthlyDynamics.flatMap((m) => [
          ['Динамика по месяцам', `${formatMonth(m.month, 'long')} · начислено`, m.earned],
          ['Динамика по месяцам', `${formatMonth(m.month, 'long')} · списано`, m.spent],
        ]),
        ...metrics.departmentStats.map((d) => [`Отделы`, d.key, d.balance]),
        ...metrics.branchStats.map((b) => [`Филиалы`, b.key, b.balance]),
        ...metrics.topItems.map((i) => ['Топ позиций каталога', i.name, i.count]),
        ...metrics.reasonRating.map((r) => [
          'Причины начисления', getReasonLabel(r.code, reasonsQuery.data), r.points,
        ]),
      ];
      downloadCSV(`wallet_report_${formatDate(new Date(), 'iso')}.csv`, buildCSV(headers, rows));
      toast({ title: 'Отчёт выгружен в CSV' });
    } catch (e) {
      toast({ title: 'Не удалось выгрузить отчёт', description: mutationErrorMessage(e), variant: 'destructive' });
    }
  };

  const error = txQuery.error || ordersQuery.error;
  const isLoading = txQuery.isPending || ordersQuery.isPending;

  const pointsTooltip = (value, name) => [formatPoints(value), name];
  const monthlyData = metrics.monthlyDynamics.map((m) => ({ ...m, label: formatMonth(m.month) }));

  const actions = (
    <Button variant="outline" onClick={handleExport} disabled={isLoading || !!error}>
      <Download className="mr-1 h-4 w-4" aria-hidden="true" /> Экспорт CSV
    </Button>
  );

  return (
    <PageContainer
      title="Аналитика программы баллов"
      description="Вовлечённость, динамика начислений и эффективность магазина наград"
      width="wide"
      actions={actions}
    >
      {error ? (
        <ErrorState error={error} onRetry={() => { txQuery.refetch(); ordersQuery.refetch(); }} />
      ) : isLoading ? (
        <SkeletonBlock />
      ) : (
        <div className="space-y-5">
          {/* Период и сравнение */}
          <Card className="flex flex-wrap items-end gap-3 p-4">
            <div>
              <Label htmlFor="rep-from" className="text-xs">С даты</Label>
              <Input id="rep-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="min-h-[40px]" />
            </div>
            <div>
              <Label htmlFor="rep-to" className="text-xs">По дату</Label>
              <Input id="rep-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="min-h-[40px]" />
            </div>
            <Button
              variant={compare ? 'default' : 'outline'}
              aria-pressed={compare}
              disabled={!canCompare}
              onClick={() => setCompare((v) => !v)}
            >
              <BarChart3 className="mr-1 h-4 w-4" aria-hidden="true" />
              Сравнить с прошлым периодом
            </Button>
            {(from || to) && (
              <Button variant="ghost" onClick={() => { setFrom(''); setTo(''); setCompare(false); }}>
                Сбросить период
              </Button>
            )}
            <p className="w-full text-xs text-muted-foreground">
              {from || to
                ? `Период: ${formatDate(from) === '—' ? 'с начала' : formatDate(from)} — ${formatDate(to) === '—' ? 'по сегодня' : formatDate(to)}`
                : 'Период не задан — показаны данные за всё время. Сравнение доступно, когда указаны обе даты.'}
              {compare && prev && ` · сравнение с ${formatDate(prev.from)} — ${formatDate(prev.to)}`}
            </p>
          </Card>

          {/* Итоговые показатели */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              icon={TrendingUp}
              iconClass="text-success"
              label="Начислено"
              valueClass="text-success"
              value={formatSigned(metrics.totalEarned, formatPoints)}
              delta={renderDelta(metrics.totalEarned, prevTotals?.totalEarned)}
            />
            <MetricCard
              icon={TrendingDown}
              iconClass="text-destructive"
              label="Списано"
              valueClass="text-destructive"
              value={formatSigned(-metrics.totalSpent, formatPoints)}
              delta={renderDelta(metrics.totalSpent, prevTotals?.totalSpent)}
            />
            {/* BUG-080: было «Burn rate — доля использованных от начисленных» */}
            <MetricCard
              icon={Percent}
              iconClass="text-primary"
              label="Доля списаний, %"
              valueClass="text-primary"
              value={`${formatNumber(metrics.spendShare)}%`}
              hint="Сколько процентов начисленных баллов сотрудники уже потратили"
              delta={renderDelta(metrics.spendShare, prevTotals?.spendShare, { suffix: '%' })}
            />
            <MetricCard
              icon={Users}
              iconClass="text-info"
              label="Активные участники"
              valueClass="text-info"
              value={`${formatNumber(metrics.activeUsersPercent)}%`}
              hint={`${formatNumber(metrics.activeUsersCount)} из ${formatNumber(metrics.totalEmployees)} сотрудников имели операции`}
              delta={renderDelta(metrics.activeUsersCount, prevTotals?.activeUsersCount)}
            />
          </div>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            {/* BUG-037: топ позиций каталога */}
            <Card className="p-5">
              <h2 className="mb-4 flex items-center gap-2 font-semibold text-foreground">
                <ShoppingBag className="h-5 w-5 text-primary" aria-hidden="true" /> Топ-10 позиций каталога
              </h2>
              {metrics.topItems.length ? (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={metrics.topItems} layout="vertical" margin={{ left: 20, right: 24, bottom: 16 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
                    <XAxis
                      type="number"
                      tick={{ fontSize: 11, fill: COLOR_MUTED }}
                      allowDecimals={false}
                      label={{ value: 'Покупок, шт.', position: 'insideBottom', offset: -8, fill: COLOR_MUTED, fontSize: 11 }}
                    />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: COLOR_MUTED }} width={130} />
                    <Tooltip
                      cursor={{ fill: 'hsl(var(--muted))' }}
                      formatter={(value, name, item) => [
                        `${formatNumber(value)} шт. · ${formatPoints(item?.payload?.points || 0)}`,
                        'Куплено',
                      ]}
                    />
                    <Bar dataKey="count" name="Покупок" fill={COLOR_PRIMARY} radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <EmptyState
                  compact
                  icon={ShoppingBag}
                  title="Покупок пока не было"
                  description="Как только сотрудники начнут тратить баллы в магазине наград, здесь появится рейтинг позиций."
                />
              )}
            </Card>

            {/* BUG-084: динамика по месяцам */}
            <Card className="p-5">
              <h2 className="mb-1 flex items-center gap-2 font-semibold text-foreground">
                <Activity className="h-5 w-5 text-info" aria-hidden="true" /> Динамика по месяцам
              </h2>
              <p className="mb-4 text-xs text-muted-foreground">
                Только завершившиеся и текущий месяц — будущие точки не рисуются, поэтому линия не уходит в ноль.
              </p>
              {monthlyData.length ? (
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={monthlyData} margin={{ left: 4, right: 16, bottom: 16 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 11, fill: COLOR_MUTED }}
                      label={{ value: 'Месяц', position: 'insideBottom', offset: -8, fill: COLOR_MUTED, fontSize: 11 }}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: COLOR_MUTED }}
                      width={64}
                      tickFormatter={(v) => formatNumber(v)}
                      label={{ value: 'Баллы', angle: -90, position: 'insideLeft', fill: COLOR_MUTED, fontSize: 11 }}
                    />
                    <Tooltip formatter={pointsTooltip} labelFormatter={(l) => `Месяц: ${l}`} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Line
                      type="monotone" dataKey="earned" name="Начислено"
                      stroke={COLOR_SUCCESS} strokeWidth={2}
                      dot={{ r: 3, fill: COLOR_SUCCESS }} activeDot={{ r: 5 }} connectNulls
                    />
                    <Line
                      type="monotone" dataKey="spent" name="Списано"
                      stroke={COLOR_DESTRUCTIVE} strokeWidth={2}
                      dot={{ r: 3, fill: COLOR_DESTRUCTIVE }} activeDot={{ r: 5 }} connectNulls
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <EmptyState
                  compact
                  icon={Activity}
                  title="Нет операций за период"
                  description="Измените диапазон дат — за выбранный период начислений и списаний не было."
                />
              )}
            </Card>
          </div>

          {/* Разрез по отделам / филиалам */}
          <Card className="p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="flex items-center gap-2 font-semibold text-foreground">
                <Building2 className="h-5 w-5 text-info" aria-hidden="true" /> Баланс и активность по {dimensionTitle}
              </h2>
              <FilterChips
                ariaLabel="Разрез аналитики"
                value={dimension}
                onChange={setDimension}
                options={[
                  { value: 'department', label: 'По отделам', count: metrics.departmentStats.length },
                  { value: 'branch', label: 'По филиалам', count: metrics.branchStats.length },
                ]}
              />
            </div>
            {dimensionStats.length ? (
              <div className="table-scroll">
                <table className="w-full text-sm">
                  <caption className="sr-only">Показатели программы баллов в разрезе {dimensionTitle}</caption>
                  <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                    <tr>
                      <th scope="col" className="px-3 py-2 text-left font-medium">
                        {dimension === 'branch' ? 'Филиал / торговая точка' : 'Отдел'}
                      </th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">Баланс</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">Начислено</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">Списано</th>
                      <th scope="col" className="hidden px-3 py-2 text-right font-medium xl:table-cell">Сотрудников</th>
                      <th scope="col" className="hidden px-3 py-2 text-right font-medium xl:table-cell">Средний баланс</th>
                      <th scope="col" className="hidden px-3 py-2 text-right font-medium xl:table-cell">Операций</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {dimensionStats.map((d) => (
                      <tr key={d.key} className="hover:bg-muted/40">
                        <td className="px-3 py-2.5 font-medium text-foreground">{d.key}</td>
                        <td className={cn('px-3 py-2.5 text-right font-bold', d.balance >= 0 ? 'text-success' : 'text-destructive')}>
                          {formatSigned(d.balance)}
                        </td>
                        <td className="px-3 py-2.5 text-right text-success">{formatSigned(d.earned)}</td>
                        <td className="px-3 py-2.5 text-right text-destructive">{formatSigned(-d.spent)}</td>
                        <td className="hidden px-3 py-2.5 text-right text-muted-foreground xl:table-cell">{formatNumber(d.employeeCount)}</td>
                        <td className="hidden px-3 py-2.5 text-right text-muted-foreground xl:table-cell">{formatNumber(d.avgBalance)}</td>
                        <td className="hidden px-3 py-2.5 text-right text-muted-foreground xl:table-cell">{formatNumber(d.count)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState
                compact
                icon={Building2}
                title="Разрез пуст"
                description="За выбранный период операций по этому измерению не было."
              />
            )}
          </Card>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            {/* Рейтинг причин начисления */}
            <Card className="p-5">
              <h2 className="mb-4 flex items-center gap-2 font-semibold text-foreground">
                <Award className="h-5 w-5 text-primary" aria-hidden="true" /> Рейтинг причин начисления
              </h2>
              {metrics.reasonRating.length ? (
                <ul role="list" className="space-y-2">
                  {metrics.reasonRating.map((r, i) => {
                    const maxCount = metrics.reasonRating[0].count || 1;
                    return (
                      <li key={r.code} role="listitem" className="flex items-center gap-3">
                        <span className="w-5 text-xs font-medium text-muted-foreground">{i + 1}</span>
                        <span className="w-36 truncate text-sm text-foreground">
                          {getReasonLabel(r.code, reasonsQuery.data)}
                        </span>
                        <div className="h-6 flex-1 overflow-hidden rounded-full bg-muted">
                          <div
                            className="flex h-full items-center justify-end rounded-full bg-primary pr-2"
                            style={{ width: `${Math.max(6, (r.count / maxCount) * 100)}%` }}
                          >
                            <span className="text-[10px] font-bold text-primary-foreground">{formatNumber(r.count)}</span>
                          </div>
                        </div>
                        <span className="w-24 whitespace-nowrap text-right text-xs text-muted-foreground">
                          {formatSigned(r.points, (n) => formatPoints(n, { short: true }))}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <EmptyState
                  compact
                  icon={Award}
                  title="Причины не заполнены"
                  description="Начисления за период сделаны без указания причины из справочника."
                />
              )}
            </Card>

            {/* Нагрузка администраторов */}
            <Card className="p-5">
              <h2 className="mb-4 flex items-center gap-2 font-semibold text-foreground">
                <Clock className="h-5 w-5 text-info" aria-hidden="true" /> Нагрузка HR-администраторов
              </h2>
              {metrics.adminWorkload.length ? (
                <div className="table-scroll">
                  <table className="w-full text-sm">
                    <caption className="sr-only">Количество операций по администраторам</caption>
                    <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                      <tr>
                        <th scope="col" className="px-3 py-2 text-left font-medium">Администратор</th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">Операций</th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">Сумма</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {metrics.adminWorkload.map((a) => (
                        <tr key={a.admin} className="hover:bg-muted/40">
                          <td className="px-3 py-2.5 font-medium text-foreground">{a.admin}</td>
                          <td className="px-3 py-2.5 text-right text-muted-foreground">{formatNumber(a.count)}</td>
                          <td className="px-3 py-2.5 text-right font-bold text-foreground">{formatPoints(a.points)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState
                  compact
                  icon={Clock}
                  title="Ручных начислений не было"
                  description="За выбранный период администраторы не создавали операций вручную."
                />
              )}
            </Card>
          </div>
        </div>
      )}
    </PageContainer>
  );
}
