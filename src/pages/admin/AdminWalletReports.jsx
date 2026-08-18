import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  TrendingUp, TrendingDown, Activity, Percent, Users, Building2, Award,
  Clock, ShoppingBag, Download, BarChart3, Wallet, Tags, FileSpreadsheet, Trophy,
} from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import PageContainer from '@/components/common/PageContainer';
import EmptyState from '@/components/common/EmptyState';
import ErrorState from '@/components/common/ErrorState';
import FilterChips from '@/components/common/FilterChips';
import { formatDate, formatMonth, formatNumber, formatPoints, formatSigned } from '@/lib/format';
import { mutationErrorMessage } from '@/lib/dataErrors';
import { cn } from '@/lib/utils';
import { downloadWorkbook } from '@/lib/xlsx';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, Legend,
} from 'recharts';

/**
 * Аналитика программы баллов.
 *
 * ГЛАВНОЕ ИЗМЕНЕНИЕ. Раньше все цифры на этой странице считались в браузере из
 * выборки последних 5000 операций. Пока история была короткой, они совпадали с
 * правдой; дальше отчёт начал бы тихо занижать итоги — без единой ошибки на
 * экране, что хуже явного сбоя. Именно на это жаловались: «часть требуемых
 * показателей невозможно получить из системы в автоматическом и достоверном
 * виде». Теперь всё считает СУБД по ВСЕЙ истории (`wallet_analytics`), одним
 * запросом — поэтому цифры между разрезами заведомо сходятся между собой.
 *
 * Что добавлено по требованиям HR:
 *   • разбивка пополнений по причинам И по категориям причин;
 *   • разбивка трат по товарам И по категориям товаров;
 *   • «Остаток на руках» — обязательство компании перед сотрудниками;
 *   • выгрузка в Excel: и сводка по всем разрезам, и полная история операций
 *     со всеми связями (сотрудник, отдел, филиал, причина, товар, кто провёл).
 *
 * BUG-037: топ позиций каталога берётся из store_orders (цена зафиксирована на
 *          момент покупки), а не из текущего прайса.
 * BUG-054: цвета графиков — только токены темы.
 * BUG-080: метрика называется «Доля списаний, %», не «Burn rate».
 * BUG-084: динамика — непрерывная ломаная без будущих точек.
 */

// Цвета графиков берём из CSS-переменных темы (BUG-054).
const COLOR_PRIMARY = 'hsl(var(--primary))';
const COLOR_SUCCESS = 'hsl(var(--success))';
const COLOR_DESTRUCTIVE = 'hsl(var(--destructive))';
const COLOR_MUTED = 'hsl(var(--muted-foreground))';

/** Человеческие названия категорий причин — в базе они хранятся кодами. */
const REASON_CATEGORY_LABELS = {
  work: 'Рабочие достижения',
  social: 'Корпоративная жизнь',
  training: 'Обучение и наставничество',
  milestone: 'Стаж и юбилеи',
  other: 'Прочее',
};

/** Типы операций — тоже коды, показывать их пользователю нельзя. */
const TYPE_LABELS = {
  achievement: 'Достижения',
  manual: 'Ручное начисление',
  workflow: 'Согласованные заявки',
  training: 'Обучение',
  tenure: 'За стаж',
  spend: 'Покупки в магазине',
  correction: 'Корректировки',
};

const reasonCategoryLabel = (code) => REASON_CATEGORY_LABELS[code] || REASON_CATEGORY_LABELS.other;
const typeLabel = (code) => TYPE_LABELS[code] || code || '—';

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

/**
 * Универсальная таблица разреза. Все разрезы устроены одинаково: строка —
 * название, дальше числовые колонки. Раньше каждый рисовался своей разметкой,
 * из-за чего они расходились по оформлению и по выравниванию чисел.
 */
function BreakdownTable({ caption, nameHeader, rows, columns, total }) {
  if (!rows.length) return null;
  return (
    <div className="table-scroll">
      <table className="w-full text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
          <tr>
            <th scope="col" className="px-3 py-2 text-left font-medium">{nameHeader}</th>
            {columns.map((c) => (
              <th key={c.key} scope="col" className={cn('px-3 py-2 text-right font-medium', c.hideOnSmall && 'hidden xl:table-cell')}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row, i) => (
            <tr key={row.__key ?? i} className="hover:bg-muted/40">
              <td className="px-3 py-2.5 font-medium text-foreground">{row.__name}</td>
              {columns.map((c) => (
                <td key={c.key} className={cn('px-3 py-2.5 text-right tabular-nums', c.className?.(row), c.hideOnSmall && 'hidden xl:table-cell')}>
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {total && (
          <tfoot className="border-t-2 border-border bg-muted/30 font-semibold">
            <tr>
              <td className="px-3 py-2.5">Итого</td>
              {columns.map((c) => (
                <td key={c.key} className={cn('px-3 py-2.5 text-right tabular-nums', c.hideOnSmall && 'hidden xl:table-cell')}>
                  {c.total ? c.total(rows) : ''}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

export default function AdminWalletReports() {
  const { toast } = useToast();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [compare, setCompare] = useState(false);
  const [dimension, setDimension] = useState('department');
  const [spendView, setSpendView] = useState('item');
  const [earnView, setEarnView] = useState('reason');
  const [exporting, setExporting] = useState(false);

  const prev = useMemo(() => previousPeriod(from, to), [from, to]);
  const canCompare = !!prev;

  const statsQuery = useQuery({
    queryKey: ['wallet-analytics', from, to],
    queryFn: () => api.rpc.walletAnalytics({ from, to }),
  });

  const prevStatsQuery = useQuery({
    queryKey: ['wallet-analytics-prev', prev?.from, prev?.to],
    queryFn: () => api.rpc.walletAnalytics({ from: prev.from, to: prev.to }),
    enabled: compare && canCompare,
  });

  const ledgerCountQuery = useQuery({
    queryKey: ['wallet-ledger-count', from, to],
    queryFn: () => api.rpc.walletLedgerCount({ from, to }),
  });

  const stats = useMemo(() => statsQuery.data || {}, [statsQuery.data]);
  const totals = stats.totals || {};
  const prevTotals = compare ? prevStatsQuery.data?.totals : null;

  const byReason = stats.by_reason || [];
  const byReasonCategory = stats.by_reason_category || [];
  const byItem = stats.by_item || [];
  const byItemCategory = stats.by_item_category || [];
  const byType = stats.by_type || [];
  const byDepartment = stats.by_department || [];
  const byBranch = stats.by_branch || [];
  const byMonth = stats.by_month || [];
  const byAdmin = stats.by_admin || [];
  const topEarners = stats.top_earners || [];
  const topSpenders = stats.top_spenders || [];

  const dimensionRows = dimension === 'branch' ? byBranch : byDepartment;
  const dimensionTitle = dimension === 'branch' ? 'филиалам' : 'подразделениям';

  const monthlyData = useMemo(
    () => (stats.by_month || []).map((m) => ({ ...m, label: formatMonth(m.month) })),
    [stats]
  );

  const topItemsChart = useMemo(
    () => (stats.by_item || []).slice(0, 10)
      .map((i) => ({ name: i.item_name, count: Number(i.purchases), points: Number(i.amount) })),
    [stats]
  );

  /** Дельта к предыдущему периоду — понятная подпись вместо «сырых» процентов. */
  const renderDelta = (current, previous, { invert = false, suffix = '' } = {}) => {
    if (previous === null || previous === undefined) return null;
    const diff = Number(current) - Number(previous);
    const good = invert ? diff <= 0 : diff >= 0;
    return (
      <div className={cn('mt-1 text-[11px] font-medium', diff === 0 ? 'text-muted-foreground' : good ? 'text-success' : 'text-destructive')}>
        {formatSigned(diff)}{suffix} к прошлому периоду ({formatNumber(previous)}{suffix})
      </div>
    );
  };

  const periodLabel = from || to
    ? `${from ? formatDate(from) : 'с начала'} — ${to ? formatDate(to) : 'по сегодня'}`
    : 'за всё время';

  /** Сводка по всем разрезам: отдельный лист на каждый — так с ней и работают. */
  const handleExportSummary = async () => {
    setExporting(true);
    try {
      await downloadWorkbook(`Баллы_сводка_${formatDate(new Date(), 'iso')}`, [
        {
          name: 'Итоги',
          rows: [
            { Показатель: 'Период', Значение: periodLabel },
            { Показатель: 'Начислено, баллы', Значение: Number(totals.earned || 0) },
            { Показатель: 'Списано, баллы', Значение: Number(totals.spent || 0) },
            { Показатель: 'Остаток на руках, баллы', Значение: Number(totals.outstanding || 0) },
            { Показатель: 'Доля списаний, %', Значение: Number(totals.spend_share || 0) },
            { Показатель: 'Операций начисления', Значение: Number(totals.earn_operations || 0) },
            { Показатель: 'Операций списания', Значение: Number(totals.spend_operations || 0) },
            { Показатель: 'Участников программы', Значение: Number(totals.participants || 0) },
            { Показатель: 'Из них тратили баллы', Значение: Number(totals.spenders || 0) },
            { Показатель: 'Сотрудников с ненулевым балансом', Значение: Number(totals.holders || 0) },
            { Показатель: 'Средний баланс, баллы', Значение: Number(totals.avg_balance || 0) },
            { Показатель: 'Отчёт сформирован', Значение: formatDate(stats.generated_at, 'long') },
          ],
        },
        {
          name: 'Причины начисления',
          rows: byReason.map((r) => ({
            Причина: r.title,
            Код: r.code,
            Категория: reasonCategoryLabel(r.category),
            Баллы: Number(r.amount),
            Операций: Number(r.operations),
            Сотрудников: Number(r.employees),
          })),
        },
        {
          name: 'Категории начислений',
          rows: byReasonCategory.map((c) => ({
            Категория: reasonCategoryLabel(c.category),
            Баллы: Number(c.amount),
            Операций: Number(c.operations),
          })),
        },
        {
          name: 'Типы операций',
          rows: byType.map((t) => ({
            'Тип операции': typeLabel(t.type),
            Баллы: Number(t.amount),
            Операций: Number(t.operations),
          })),
        },
        {
          name: 'Покупки по товарам',
          rows: byItem.map((i) => ({
            Товар: i.item_name,
            Категория: i.item_category,
            'Покупок, шт.': Number(i.purchases),
            'Потрачено баллов': Number(i.amount),
            Покупателей: Number(i.employees),
          })),
        },
        {
          name: 'Категории покупок',
          rows: byItemCategory.map((c) => ({
            Категория: c.category,
            'Покупок, шт.': Number(c.purchases),
            'Потрачено баллов': Number(c.amount),
          })),
        },
        {
          name: 'Подразделения',
          rows: byDepartment.map((d) => ({
            Подразделение: d.name,
            Начислено: Number(d.earned),
            Списано: Number(d.spent),
            Остаток: Number(d.earned) - Number(d.spent),
            Сотрудников: Number(d.employees),
          })),
        },
        {
          name: 'Филиалы',
          rows: byBranch.map((b) => ({
            Филиал: b.name,
            Начислено: Number(b.earned),
            Списано: Number(b.spent),
            Остаток: Number(b.earned) - Number(b.spent),
            Сотрудников: Number(b.employees),
          })),
        },
        {
          name: 'Динамика по месяцам',
          rows: byMonth.map((m) => ({
            Месяц: m.month,
            Начислено: Number(m.earned),
            Списано: Number(m.spent),
            Разница: Number(m.earned) - Number(m.spent),
          })),
        },
        {
          name: 'Кто начислял',
          rows: byAdmin.map((a) => ({
            Администратор: a.admin_name,
            Операций: Number(a.operations),
            'Сумма баллов': Number(a.amount),
            Сотрудников: Number(a.employees),
          })),
        },
        {
          name: 'Топ получателей',
          rows: topEarners.map((e) => ({
            Сотрудник: e.name,
            'Начислено баллов': Number(e.amount),
            Операций: Number(e.operations),
          })),
        },
        {
          name: 'Топ покупателей',
          rows: topSpenders.map((s) => ({
            Сотрудник: s.name,
            'Потрачено баллов': Number(s.amount),
            Покупок: Number(s.operations),
          })),
        },
      ]);
      toast({ title: 'Сводка выгружена в Excel' });
    } catch (e) {
      toast({ title: 'Не удалось выгрузить сводку', description: mutationErrorMessage(e), variant: 'destructive' });
    } finally {
      setExporting(false);
    }
  };

  /**
   * Полная история операций. Грузится страницами: одним запросом большая
   * история упрётся в таймаут и пользователь получит ошибку вместо отчёта.
   */
  const handleExportLedger = async () => {
    setExporting(true);
    try {
      const rows = await api.rpc.walletLedgerAll({ from, to });
      if (!rows.length) {
        toast({ title: 'За выбранный период операций нет', variant: 'destructive' });
        return;
      }
      await downloadWorkbook(`Баллы_операции_${formatDate(new Date(), 'iso')}`, [
        {
          name: 'История операций',
          rows: rows.map((r) => ({
            Дата: r.date,
            Сотрудник: r.employee_name,
            Подразделение: r.department,
            Филиал: r.branch,
            Направление: r.direction,
            Баллы: Number(r.amount),
            'Тип операции': typeLabel(r.type),
            Причина: r.reason_title,
            'Категория причины': reasonCategoryLabel(r.reason_category),
            Товар: r.item_name || '',
            'Категория товара': r.item_name ? r.item_category : '',
            'Кто провёл': r.admin_name || 'Система / автоматика',
            'ID операции': r.operation_id,
          })),
        },
      ]);
      toast({ title: `Выгружено операций: ${formatNumber(rows.length)}` });
    } catch (e) {
      toast({ title: 'Не удалось выгрузить историю', description: mutationErrorMessage(e), variant: 'destructive' });
    } finally {
      setExporting(false);
    }
  };

  const error = statsQuery.error;
  const isLoading = statsQuery.isPending;
  const pointsTooltip = (value, name) => [formatPoints(value), name];

  const actions = (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" onClick={handleExportSummary} disabled={isLoading || !!error || exporting}>
        <FileSpreadsheet className="mr-1 h-4 w-4" aria-hidden="true" /> Сводка в Excel
      </Button>
      <Button variant="outline" onClick={handleExportLedger} disabled={isLoading || !!error || exporting}>
        <Download className="mr-1 h-4 w-4" aria-hidden="true" />
        Все операции{typeof ledgerCountQuery.data === 'number' ? ` (${formatNumber(ledgerCountQuery.data)})` : ''}
      </Button>
    </div>
  );

  return (
    <PageContainer
      title="Аналитика программы баллов"
      description="Начисления, траты и остатки — считаются на сервере по всей истории операций"
      width="wide"
      actions={actions}
    >
      {error ? (
        <ErrorState error={error} onRetry={() => statsQuery.refetch()} />
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
                ? `Период: ${periodLabel}`
                : 'Период не задан — показаны данные за всё время. Сравнение доступно, когда указаны обе даты.'}
              {compare && prev && ` · сравнение с ${formatDate(prev.from)} — ${formatDate(prev.to)}`}
              {stats.generated_at && ` · данные на ${formatDate(stats.generated_at, 'long')}`}
            </p>
          </Card>

          {/* Итоговые показатели */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <MetricCard
              icon={TrendingUp}
              iconClass="text-success"
              label="Начислено"
              valueClass="text-success"
              value={formatSigned(Number(totals.earned || 0), formatPoints)}
              hint={`${formatNumber(totals.earn_operations || 0)} операций`}
              delta={renderDelta(totals.earned || 0, prevTotals?.earned)}
            />
            <MetricCard
              icon={TrendingDown}
              iconClass="text-destructive"
              label="Списано"
              valueClass="text-destructive"
              value={formatSigned(-Number(totals.spent || 0), formatPoints)}
              hint={`${formatNumber(totals.spend_operations || 0)} покупок`}
              delta={renderDelta(totals.spent || 0, prevTotals?.spent)}
            />
            {/* Остаток на руках — обязательство компании. Считается по всей истории. */}
            <MetricCard
              icon={Wallet}
              iconClass="text-warning"
              label="Остаток на руках"
              valueClass="text-foreground"
              value={formatPoints(Number(totals.outstanding || 0))}
              hint={`У ${formatNumber(totals.holders || 0)} сотрудников · в среднем ${formatNumber(totals.avg_balance || 0)}`}
            />
            {/* BUG-080: было «Burn rate — доля использованных от начисленных» */}
            <MetricCard
              icon={Percent}
              iconClass="text-primary"
              label="Доля списаний, %"
              valueClass="text-primary"
              value={`${formatNumber(totals.spend_share || 0)}%`}
              hint="Сколько процентов начисленных баллов сотрудники уже потратили"
              delta={renderDelta(totals.spend_share || 0, prevTotals?.spend_share, { suffix: '%' })}
            />
            <MetricCard
              icon={Users}
              iconClass="text-info"
              label="Участники"
              valueClass="text-info"
              value={formatNumber(totals.participants || 0)}
              hint={`${formatNumber(totals.spenders || 0)} из них тратили баллы`}
              delta={renderDelta(totals.participants || 0, prevTotals?.participants)}
            />
          </div>

          {/* Пополнения: по причинам и по категориям причин */}
          <Card className="p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="flex items-center gap-2 font-semibold text-foreground">
                <Award className="h-5 w-5 text-primary" aria-hidden="true" /> За что начисляли баллы
              </h2>
              <FilterChips
                ariaLabel="Разрез начислений"
                value={earnView}
                onChange={setEarnView}
                options={[
                  { value: 'reason', label: 'По причинам', count: byReason.length },
                  { value: 'category', label: 'По категориям', count: byReasonCategory.length },
                  { value: 'type', label: 'По типу операции', count: byType.length },
                ]}
              />
            </div>
            {earnView === 'reason' && (
              <BreakdownTable
                caption="Начисления в разрезе причин"
                nameHeader="Причина начисления"
                rows={byReason.map((r) => ({ ...r, __key: r.code, __name: r.title }))}
                total
                columns={[
                  { key: 'category', label: 'Категория', render: (r) => reasonCategoryLabel(r.category) },
                  { key: 'amount', label: 'Баллы', className: () => 'font-bold text-success', render: (r) => formatSigned(Number(r.amount)), total: (rows) => formatSigned(rows.reduce((s, r) => s + Number(r.amount), 0)) },
                  { key: 'operations', label: 'Операций', render: (r) => formatNumber(r.operations), total: (rows) => formatNumber(rows.reduce((s, r) => s + Number(r.operations), 0)) },
                  { key: 'employees', label: 'Сотрудников', hideOnSmall: true, render: (r) => formatNumber(r.employees) },
                ]}
              />
            )}
            {earnView === 'category' && (
              <BreakdownTable
                caption="Начисления в разрезе категорий причин"
                nameHeader="Категория"
                rows={byReasonCategory.map((c) => ({ ...c, __key: c.category, __name: reasonCategoryLabel(c.category) }))}
                total
                columns={[
                  { key: 'amount', label: 'Баллы', className: () => 'font-bold text-success', render: (c) => formatSigned(Number(c.amount)), total: (rows) => formatSigned(rows.reduce((s, r) => s + Number(r.amount), 0)) },
                  { key: 'operations', label: 'Операций', render: (c) => formatNumber(c.operations), total: (rows) => formatNumber(rows.reduce((s, r) => s + Number(r.operations), 0)) },
                  {
                    key: 'share',
                    label: 'Доля',
                    render: (c) => {
                      const sum = byReasonCategory.reduce((s, r) => s + Number(r.amount), 0);
                      return sum ? `${((Number(c.amount) / sum) * 100).toFixed(1)}%` : '—';
                    },
                  },
                ]}
              />
            )}
            {earnView === 'type' && (
              <BreakdownTable
                caption="Операции в разрезе типов"
                nameHeader="Тип операции"
                rows={byType.map((t) => ({ ...t, __key: t.type, __name: typeLabel(t.type) }))}
                columns={[
                  { key: 'amount', label: 'Баллы', className: (t) => (Number(t.amount) >= 0 ? 'font-bold text-success' : 'font-bold text-destructive'), render: (t) => formatSigned(Number(t.amount)) },
                  { key: 'operations', label: 'Операций', render: (t) => formatNumber(t.operations) },
                ]}
              />
            )}
            {((earnView === 'reason' && !byReason.length)
              || (earnView === 'category' && !byReasonCategory.length)
              || (earnView === 'type' && !byType.length)) && (
              <EmptyState
                compact
                icon={Award}
                title="Начислений за период не было"
                description="Измените диапазон дат или начислите баллы — разбивка появится автоматически."
              />
            )}
          </Card>

          {/* Траты: по товарам и по категориям товаров */}
          <Card className="p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="flex items-center gap-2 font-semibold text-foreground">
                <ShoppingBag className="h-5 w-5 text-destructive" aria-hidden="true" /> На что тратили баллы
              </h2>
              <FilterChips
                ariaLabel="Разрез трат"
                value={spendView}
                onChange={setSpendView}
                options={[
                  { value: 'item', label: 'По товарам', count: byItem.length },
                  { value: 'category', label: 'По категориям', count: byItemCategory.length },
                ]}
              />
            </div>
            {spendView === 'item' && byItem.length ? (
              <BreakdownTable
                caption="Покупки в разрезе позиций каталога"
                nameHeader="Товар"
                rows={byItem.map((i) => ({ ...i, __key: i.item_name, __name: i.item_name }))}
                total
                columns={[
                  { key: 'cat', label: 'Категория', render: (i) => i.item_category },
                  { key: 'purchases', label: 'Покупок', render: (i) => formatNumber(i.purchases), total: (rows) => formatNumber(rows.reduce((s, r) => s + Number(r.purchases), 0)) },
                  { key: 'amount', label: 'Баллы', className: () => 'font-bold text-destructive', render: (i) => formatSigned(-Number(i.amount)), total: (rows) => formatSigned(-rows.reduce((s, r) => s + Number(r.amount), 0)) },
                  { key: 'employees', label: 'Покупателей', hideOnSmall: true, render: (i) => formatNumber(i.employees) },
                ]}
              />
            ) : null}
            {spendView === 'category' && byItemCategory.length ? (
              <BreakdownTable
                caption="Покупки в разрезе категорий каталога"
                nameHeader="Категория товара"
                rows={byItemCategory.map((c) => ({ ...c, __key: c.category, __name: c.category }))}
                total
                columns={[
                  { key: 'purchases', label: 'Покупок', render: (c) => formatNumber(c.purchases), total: (rows) => formatNumber(rows.reduce((s, r) => s + Number(r.purchases), 0)) },
                  { key: 'amount', label: 'Баллы', className: () => 'font-bold text-destructive', render: (c) => formatSigned(-Number(c.amount)), total: (rows) => formatSigned(-rows.reduce((s, r) => s + Number(r.amount), 0)) },
                  {
                    key: 'share',
                    label: 'Доля',
                    render: (c) => {
                      const sum = byItemCategory.reduce((s, r) => s + Number(r.amount), 0);
                      return sum ? `${((Number(c.amount) / sum) * 100).toFixed(1)}%` : '—';
                    },
                  },
                ]}
              />
            ) : null}
            {!byItem.length && (
              <EmptyState
                compact
                icon={ShoppingBag}
                title="Покупок пока не было"
                description="Как только сотрудники начнут тратить баллы в магазине наград, здесь появится разбивка."
              />
            )}
          </Card>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            {/* BUG-037: топ позиций каталога — из store_orders */}
            <Card className="p-5">
              <h2 className="mb-4 flex items-center gap-2 font-semibold text-foreground">
                <Tags className="h-5 w-5 text-primary" aria-hidden="true" /> Топ-10 позиций каталога
              </h2>
              {topItemsChart.length ? (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={topItemsChart} layout="vertical" margin={{ left: 20, right: 24, bottom: 16 }}>
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
                  icon={Tags}
                  title="Покупок пока не было"
                  description="Рейтинг появится после первых покупок в магазине наград."
                />
              )}
            </Card>

            {/* BUG-084: динамика по месяцам */}
            <Card className="p-5">
              <h2 className="mb-1 flex items-center gap-2 font-semibold text-foreground">
                <Activity className="h-5 w-5 text-info" aria-hidden="true" /> Динамика по месяцам
              </h2>
              <p className="mb-4 text-xs text-muted-foreground">
                Только месяцы, в которых были операции — линия не проваливается в ноль.
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
                <Building2 className="h-5 w-5 text-info" aria-hidden="true" /> Баллы по {dimensionTitle}
              </h2>
              <FilterChips
                ariaLabel="Разрез аналитики"
                value={dimension}
                onChange={setDimension}
                options={[
                  { value: 'department', label: 'По подразделениям', count: byDepartment.length },
                  { value: 'branch', label: 'По филиалам', count: byBranch.length },
                ]}
              />
            </div>
            {dimensionRows.length ? (
              <BreakdownTable
                caption={`Показатели программы баллов в разрезе ${dimensionTitle}`}
                nameHeader={dimension === 'branch' ? 'Филиал / торговая точка' : 'Подразделение'}
                rows={dimensionRows.map((d) => ({ ...d, __key: d.name, __name: d.name }))}
                total
                columns={[
                  { key: 'earned', label: 'Начислено', className: () => 'text-success', render: (d) => formatSigned(Number(d.earned)), total: (rows) => formatSigned(rows.reduce((s, r) => s + Number(r.earned), 0)) },
                  { key: 'spent', label: 'Списано', className: () => 'text-destructive', render: (d) => formatSigned(-Number(d.spent)), total: (rows) => formatSigned(-rows.reduce((s, r) => s + Number(r.spent), 0)) },
                  {
                    key: 'rest',
                    label: 'Разница',
                    className: (d) => (Number(d.earned) - Number(d.spent) >= 0 ? 'font-bold text-success' : 'font-bold text-destructive'),
                    render: (d) => formatSigned(Number(d.earned) - Number(d.spent)),
                    total: (rows) => formatSigned(rows.reduce((s, r) => s + Number(r.earned) - Number(r.spent), 0)),
                  },
                  { key: 'employees', label: 'Сотрудников', hideOnSmall: true, render: (d) => formatNumber(d.employees) },
                ]}
              />
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
            {/* Топ сотрудников */}
            <Card className="p-5">
              <h2 className="mb-4 flex items-center gap-2 font-semibold text-foreground">
                <Trophy className="h-5 w-5 text-primary" aria-hidden="true" /> Кто получил и потратил больше всех
              </h2>
              {topEarners.length ? (
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                  <div>
                    <h3 className="mb-2 text-xs font-medium uppercase text-muted-foreground">Начислено</h3>
                    <ul role="list" className="space-y-1.5">
                      {topEarners.slice(0, 10).map((e, i) => (
                        <li key={e.employee_id} className="flex items-center gap-2 text-sm">
                          <span className="w-4 text-xs text-muted-foreground">{i + 1}</span>
                          <span className="flex-1 truncate text-foreground">{e.name || '—'}</span>
                          <span className="whitespace-nowrap font-medium text-success tabular-nums">
                            {formatSigned(Number(e.amount))}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <h3 className="mb-2 text-xs font-medium uppercase text-muted-foreground">Потрачено</h3>
                    {topSpenders.length ? (
                      <ul role="list" className="space-y-1.5">
                        {topSpenders.slice(0, 10).map((s, i) => (
                          <li key={s.employee_id} className="flex items-center gap-2 text-sm">
                            <span className="w-4 text-xs text-muted-foreground">{i + 1}</span>
                            <span className="flex-1 truncate text-foreground">{s.name || '—'}</span>
                            <span className="whitespace-nowrap font-medium text-destructive tabular-nums">
                              {formatSigned(-Number(s.amount))}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-muted-foreground">Покупок за период не было.</p>
                    )}
                  </div>
                </div>
              ) : (
                <EmptyState compact icon={Trophy} title="Нет операций за период" description="Рейтинг появится после первых начислений." />
              )}
            </Card>

            {/* Кто проводил операции */}
            <Card className="p-5">
              <h2 className="mb-4 flex items-center gap-2 font-semibold text-foreground">
                <Clock className="h-5 w-5 text-info" aria-hidden="true" /> Кто проводил операции
              </h2>
              {byAdmin.length ? (
                <BreakdownTable
                  caption="Количество операций по администраторам"
                  nameHeader="Администратор"
                  rows={byAdmin.map((a) => ({ ...a, __key: a.admin_name, __name: a.admin_name }))}
                  columns={[
                    { key: 'operations', label: 'Операций', render: (a) => formatNumber(a.operations) },
                    { key: 'amount', label: 'Сумма', className: (a) => (Number(a.amount) >= 0 ? 'font-bold text-success' : 'font-bold text-destructive'), render: (a) => formatSigned(Number(a.amount)) },
                    { key: 'employees', label: 'Сотрудников', hideOnSmall: true, render: (a) => formatNumber(a.employees) },
                  ]}
                />
              ) : (
                <EmptyState
                  compact
                  icon={Clock}
                  title="Операций не было"
                  description="За выбранный период начислений и списаний не создавали."
                />
              )}
            </Card>
          </div>
        </div>
      )}
    </PageContainer>
  );
}
