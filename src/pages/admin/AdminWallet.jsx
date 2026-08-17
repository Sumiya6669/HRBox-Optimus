import React, { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { api } from '@/api/client';
import { createEntity } from '@/api/entity';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  Download, Plus, AlertTriangle, Link2, Search, Wallet, TrendingUp, TrendingDown, RefreshCw, HelpCircle,
} from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import PageContainer from '@/components/common/PageContainer';
import EmptyState from '@/components/common/EmptyState';
import ErrorState from '@/components/common/ErrorState';
import StatusBadge from '@/components/common/StatusBadge';
import Pagination from '@/components/common/Pagination';
import { useAuth } from '@/lib/AuthContext';
import { formatDate, formatPoints, formatSigned, formatNumber } from '@/lib/format';
import { statusLabel } from '@/lib/statusLabels';
import { mutationErrorMessage } from '@/lib/dataErrors';
import { cn } from '@/lib/utils';
import { downloadCSV } from '@/lib/csv';
import {
  MANUAL_TYPES, TRANSACTION_TYPES, DUPLICATE_HINT, getReasonLabel,
  buildTransactionCSV, buildWalletSummaryCSV, detectDuplicates,
} from '@/lib/walletUtils';

/**
 * Операции кошелька — административный реестр начислений и списаний.
 *
 * BUG-035: колонки «Филиал» и «Отдел» всегда были «—», потому что читалась
 *          базовая таблица wallet_transactions. Читаем вьюху v_wallet_transactions,
 *          где branch/department приджойнены из карточки сотрудника,
 *          а выпадающие фильтры строятся по справочникам branches / departments.
 * BUG-036: колонка «Действия» уезжала за экран уже при 1170px — таблица в .table-scroll,
 *          действия в .table-sticky-actions, второстепенные колонки скрыты до xl.
 * BUG-055: «₸KZ» не существует — внутренняя валюта это баллы (formatPoints/formatSigned).
 * BUG-081: «Филиал (ТТ)» — необъяснённая аббревиатура, теперь «Филиал / торговая точка».
 * Аудит: добавлена серверная пагинация по 50 и пояснение к метрике «Дубли».
 */

const PAGE_SIZE = 50;
// Вьюхи недоступны через api.entities (там базовые таблицы) — тот же контракт .page().
const walletView = createEntity('v_wallet_transactions', { defaultSort: '-date' });

const emptyForm = () => ({
  employee_id: '',
  amount: '',
  type: 'manual',
  reason_code: '',
  reason: '',
  date: formatDate(new Date(), 'iso'),
});

function SkeletonBlock() {
  return (
    <div className="space-y-4" aria-hidden="true">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <div key={i} className="h-24 animate-pulse rounded-xl bg-muted" />)}
      </div>
      <div className="h-24 animate-pulse rounded-xl bg-muted" />
      <div className="h-96 animate-pulse rounded-xl bg-muted" />
    </div>
  );
}

export default function AdminWallet() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { user } = useAuth();

  const [filters, setFilters] = useState({ from: '', to: '', type: '', branch: '', department: '', search: '' });
  const [page, setPage] = useState(1);
  const [addOpen, setAddOpen] = useState(false);
  const [correctTx, setCorrectTx] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [correctForm, setCorrectForm] = useState({ amount: '', reason: '' });
  const [formError, setFormError] = useState(null);

  // Смена фильтров всегда возвращает на первую страницу.
  useEffect(() => { setPage(1); }, [filters]);

  /** Условие выборки одинаково для таблицы, сводки и экспорта. */
  const where = useMemo(() => {
    const w = {};
    if (filters.from || filters.to) {
      w.date = {};
      if (filters.from) w.date.gte = filters.from;
      if (filters.to) w.date.lte = filters.to;
    }
    if (filters.type) w.type = filters.type;
    if (filters.branch) w.branch = filters.branch;
    if (filters.department) w.department = filters.department;
    if (filters.search.trim()) w.employee_name = { ilike: `%${filters.search.trim()}%` };
    return w;
  }, [filters]);

  const txQuery = useQuery({
    queryKey: ['admin-wallet-page', where, page],
    queryFn: () => walletView.page({ where, sort: '-date', page, pageSize: PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });

  // Сводка считается по всей выборке фильтра, а не по видимой странице.
  const summaryQuery = useQuery({
    queryKey: ['admin-wallet-summary', where],
    queryFn: () => walletView.filter(where, '-date', 5000),
  });

  const employeesQuery = useQuery({ queryKey: ['employees'], queryFn: () => api.entities.Employee.list('name') });
  const branchesQuery = useQuery({ queryKey: ['branches'], queryFn: () => api.entities.Branch.list('city') });
  const departmentsQuery = useQuery({ queryKey: ['departments'], queryFn: () => api.entities.Department.list('name') });
  const reasonsQuery = useQuery({ queryKey: ['award-reasons'], queryFn: () => api.entities.AwardReason.list('title') });

  const employees = employeesQuery.data || [];
  const reasons = useMemo(() => (reasonsQuery.data || []).filter((r) => r.active !== false), [reasonsQuery.data]);
  const empMap = useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees]);

  const summaryRows = summaryQuery.data || [];
  const duplicateIds = useMemo(() => detectDuplicates(summaryRows), [summaryRows]);

  const stats = useMemo(() => {
    const earned = summaryRows.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);
    const spent = Math.abs(
      summaryRows.filter((t) => t.amount < 0 && !t.is_correction).reduce((s, t) => s + t.amount, 0)
    );
    return { earned, spent, balance: summaryRows.reduce((s, t) => s + (t.amount || 0), 0) };
  }, [summaryRows]);

  const rows = txQuery.data?.rows || [];
  const total = txQuery.data?.total || 0;

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['admin-wallet-page'] });
    qc.invalidateQueries({ queryKey: ['admin-wallet-summary'] });
  };

  const createTx = useMutation({
    mutationFn: (data) => api.entities.WalletTransaction.create(data),
    onSuccess: () => {
      toast({ title: 'Операция создана' });
      invalidate();
      setAddOpen(false);
      setForm(emptyForm());
      setFormError(null);
    },
    onError: (e) => toast({
      title: 'Не удалось создать операцию',
      description: mutationErrorMessage(e, {
        23503: 'Выбранный сотрудник или причина больше не существуют — обновите страницу.',
        42501: 'Начислять баллы могут только HR-специалист и администратор.',
      }),
      variant: 'destructive',
    }),
  });

  const createCorrection = useMutation({
    mutationFn: (data) => api.entities.WalletTransaction.create(data),
    onSuccess: () => {
      toast({ title: 'Корректировка создана' });
      invalidate();
      setCorrectTx(null);
    },
    onError: (e) => toast({ title: 'Не удалось создать корректировку', description: mutationErrorMessage(e), variant: 'destructive' }),
  });

  /** Валидация ручного начисления: сотрудник обязателен, сумма не может быть нулевой. */
  const validateForm = () => {
    if (!form.employee_id) return 'Выберите сотрудника';
    const amount = Number(form.amount);
    if (!Number.isFinite(amount) || amount === 0) return 'Сумма не может быть нулевой или пустой';
    return null;
  };

  const handleAdd = () => {
    const problem = validateForm();
    setFormError(problem);
    if (problem) return;
    const emp = empMap.get(form.employee_id);
    createTx.mutate({
      employee_id: form.employee_id,
      employee_name: emp?.name || null,
      amount: Number(form.amount),
      type: form.type,
      reason_code: form.reason_code || null,
      reason: form.reason || null,
      // Очищенное поле <input type="date"> даёт '' — в date-колонку должен уйти null (22P02).
      date: form.date || null,
      branch_id: emp?.branch_id || null,
      department_id: emp?.department_id || null,
      admin_id: user?.id || null,
      admin_name: user?.full_name || user?.email || null,
    });
  };

  const handleCorrect = () => {
    const amount = Number(correctForm.amount);
    if (!correctTx || !Number.isFinite(amount) || amount === 0) return;
    const emp = empMap.get(correctTx.employee_id);
    createCorrection.mutate({
      employee_id: correctTx.employee_id,
      employee_name: correctTx.employee_name || null,
      amount,
      type: 'correction',
      reason: correctForm.reason || `Корректировка операции от ${formatDate(correctTx.date)}`,
      linked_operation_id: correctTx.id,
      is_correction: true,
      branch_id: emp?.branch_id || null,
      department_id: emp?.department_id || null,
      admin_id: user?.id || null,
      admin_name: user?.full_name || user?.email || null,
      date: formatDate(new Date(), 'iso'),
    });
  };

  /** Экспорт учитывает текущие фильтры, а не видимую страницу. */
  const handleExportTx = async () => {
    try {
      const all = await walletView.filter(where, '-date', 5000);
      downloadCSV(`wallet_transactions_${formatDate(new Date(), 'iso')}.csv`, buildTransactionCSV(all, reasons, duplicateIds));
      toast({ title: `Выгружено операций: ${formatNumber(all.length)}` });
    } catch (e) {
      toast({ title: 'Не удалось выгрузить операции', description: mutationErrorMessage(e), variant: 'destructive' });
    }
  };

  const handleExportSummary = async () => {
    try {
      const all = await walletView.filter(where, '-date', 5000);
      downloadCSV(`wallet_summary_${formatDate(new Date(), 'iso')}.csv`, buildWalletSummaryCSV(all, employees));
      toast({ title: 'Сводка по кошелькам выгружена' });
    } catch (e) {
      toast({ title: 'Не удалось выгрузить сводку', description: mutationErrorMessage(e), variant: 'destructive' });
    }
  };

  const selectCls =
    'min-h-[40px] w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus:border-primary/40';

  const error = txQuery.error || summaryQuery.error;
  const isLoading = txQuery.isPending || summaryQuery.isPending;

  const actions = (
    <>
      <Button variant="outline" onClick={handleExportSummary}>
        <Download className="mr-1 h-4 w-4" aria-hidden="true" /> Сводка по кошелькам
      </Button>
      <Button variant="outline" onClick={handleExportTx}>
        <Download className="mr-1 h-4 w-4" aria-hidden="true" /> Экспорт CSV
      </Button>
      <Button onClick={() => { setForm(emptyForm()); setFormError(null); setAddOpen(true); }}>
        <Plus className="mr-1 h-4 w-4" aria-hidden="true" /> Начислить
      </Button>
    </>
  );

  return (
    <PageContainer
      title="Операции кошелька"
      description="Начисления, списания и корректировки баллов сотрудников"
      width="wide"
      actions={actions}
    >
      {error ? (
        <ErrorState error={error} onRetry={() => { txQuery.refetch(); summaryQuery.refetch(); }} />
      ) : isLoading ? (
        <SkeletonBlock />
      ) : (
        <div className="space-y-5">
          {/* Сводка по всей выборке фильтра */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Card className="p-4">
              <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                <Wallet className="h-4 w-4" aria-hidden="true" /> Итоговый баланс
              </div>
              <div className="text-2xl font-bold text-foreground">{formatSigned(stats.balance, formatPoints)}</div>
            </Card>
            <Card className="p-4">
              <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                <TrendingUp className="h-4 w-4 text-success" aria-hidden="true" /> Начислено
              </div>
              <div className="text-2xl font-bold text-success">{formatSigned(stats.earned, formatPoints)}</div>
            </Card>
            <Card className="p-4">
              <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                <TrendingDown className="h-4 w-4 text-destructive" aria-hidden="true" /> Списано
              </div>
              <div className="text-2xl font-bold text-destructive">{formatSigned(-stats.spent, formatPoints)}</div>
            </Card>
            {/* Аудит: «Дубли: 0» — метрика без пояснения */}
            <Card className="p-4">
              <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                <AlertTriangle className="h-4 w-4 text-warning" aria-hidden="true" /> Возможные дубли
                <HelpCircle className="h-3.5 w-3.5" aria-hidden="true" />
              </div>
              <div className="text-2xl font-bold text-warning">{formatNumber(duplicateIds.size)}</div>
              <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{DUPLICATE_HINT}</p>
            </Card>
          </div>

          {/* Фильтры */}
          <Card className="p-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
              <div>
                <Label htmlFor="wallet-from" className="text-xs">С даты</Label>
                <Input id="wallet-from" type="date" value={filters.from}
                  onChange={(e) => setFilters({ ...filters, from: e.target.value })} className="min-h-[40px]" />
              </div>
              <div>
                <Label htmlFor="wallet-to" className="text-xs">По дату</Label>
                <Input id="wallet-to" type="date" value={filters.to}
                  onChange={(e) => setFilters({ ...filters, to: e.target.value })} className="min-h-[40px]" />
              </div>
              <div>
                <Label htmlFor="wallet-type" className="text-xs">Тип операции</Label>
                <select id="wallet-type" className={selectCls} value={filters.type}
                  onChange={(e) => setFilters({ ...filters, type: e.target.value })}>
                  <option value="">Все типы</option>
                  {TRANSACTION_TYPES.map((k) => (
                    <option key={k} value={k}>{statusLabel(k)}</option>
                  ))}
                </select>
              </div>
              {/* BUG-081: было «Филиал (ТТ)» */}
              <div>
                <Label htmlFor="wallet-branch" className="text-xs">Филиал / торговая точка</Label>
                <select id="wallet-branch" className={selectCls} value={filters.branch}
                  onChange={(e) => setFilters({ ...filters, branch: e.target.value })}>
                  <option value="">Все филиалы</option>
                  {(branchesQuery.data || []).map((b) => <option key={b.id} value={b.city}>{b.city}</option>)}
                </select>
              </div>
              <div>
                <Label htmlFor="wallet-dept" className="text-xs">Отдел</Label>
                <select id="wallet-dept" className={selectCls} value={filters.department}
                  onChange={(e) => setFilters({ ...filters, department: e.target.value })}>
                  <option value="">Все отделы</option>
                  {(departmentsQuery.data || []).map((d) => <option key={d.id} value={d.name}>{d.name}</option>)}
                </select>
              </div>
              <div>
                <Label htmlFor="wallet-search" className="text-xs">Сотрудник</Label>
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                  <Input id="wallet-search" value={filters.search} className="min-h-[40px] pl-8" placeholder="Поиск по ФИО"
                    onChange={(e) => setFilters({ ...filters, search: e.target.value })} />
                </div>
              </div>
            </div>
          </Card>

          {/* Реестр операций */}
          {!rows.length ? (
            <EmptyState
              icon={Wallet}
              title="Операций не найдено"
              description="Под текущие фильтры не попала ни одна операция. Сбросьте фильтры или начислите баллы вручную."
              actionLabel="Сбросить фильтры"
              onAction={() => setFilters({ from: '', to: '', type: '', branch: '', department: '', search: '' })}
            />
          ) : (
            <Card className="overflow-hidden">
              {/* BUG-036: горизонтальный скролл с индикатором + липкая колонка действий */}
              <div className="table-scroll">
                <table className="w-full text-sm">
                  <caption className="sr-only">Реестр операций по баллам сотрудников</caption>
                  <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                    <tr>
                      <th scope="col" className="px-4 py-2.5 text-left font-medium">Дата</th>
                      <th scope="col" className="px-4 py-2.5 text-left font-medium">Сотрудник</th>
                      <th scope="col" className="hidden px-4 py-2.5 text-left font-medium xl:table-cell">Филиал</th>
                      <th scope="col" className="hidden px-4 py-2.5 text-left font-medium xl:table-cell">Отдел</th>
                      <th scope="col" className="px-4 py-2.5 text-left font-medium">Тип</th>
                      <th scope="col" className="px-4 py-2.5 text-left font-medium">Причина</th>
                      <th scope="col" className="px-4 py-2.5 text-right font-medium">Сумма</th>
                      <th scope="col" className="hidden px-4 py-2.5 text-left font-medium xl:table-cell">Товар</th>
                      <th scope="col" className="hidden px-4 py-2.5 text-left font-medium xl:table-cell">Администратор</th>
                      <th scope="col" className="table-sticky-actions px-4 py-2.5 text-center font-medium">Действия</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {rows.map((t) => (
                      <tr
                        key={t.id}
                        className={cn(
                          'hover:bg-muted/40',
                          t.is_correction && 'bg-warning/5',
                          duplicateIds.has(t.id) && 'bg-warning/10'
                        )}
                      >
                        <td className="whitespace-nowrap px-4 py-2.5 text-muted-foreground">{formatDate(t.date)}</td>
                        <td className="px-4 py-2.5 font-medium text-foreground">
                          {t.employee_name || '—'}
                          {/* На узких экранах скрытые колонки показываем подстрокой */}
                          <span className="block text-xs font-normal text-muted-foreground xl:hidden">
                            {[t.branch, t.department].filter(Boolean).join(' · ') || '—'}
                          </span>
                        </td>
                        <td className="hidden px-4 py-2.5 text-muted-foreground xl:table-cell">{t.branch || '—'}</td>
                        <td className="hidden px-4 py-2.5 text-muted-foreground xl:table-cell">{t.department || '—'}</td>
                        <td className="px-4 py-2.5"><StatusBadge value={t.type} /></td>
                        <td className="px-4 py-2.5 text-muted-foreground">
                          {t.reason_code ? getReasonLabel(t.reason_code, reasons) : t.reason || t.reason_title || '—'}
                          {duplicateIds.has(t.id) && (
                            <AlertTriangle className="ml-1 inline-block h-3 w-3 text-warning" aria-label="Возможный дубль" />
                          )}
                          {t.is_correction && t.linked_operation_id && (
                            <Link2 className="ml-1 inline-block h-3 w-3 text-warning" aria-label="Связана с исходной операцией" />
                          )}
                        </td>
                        <td className={cn(
                          'whitespace-nowrap px-4 py-2.5 text-right font-bold',
                          t.amount > 0 ? 'text-success' : 'text-destructive'
                        )}>
                          {formatSigned(t.amount, (n) => formatPoints(n, { short: true }))}
                        </td>
                        <td className="hidden px-4 py-2.5 text-muted-foreground xl:table-cell">{t.item_name || '—'}</td>
                        <td className="hidden px-4 py-2.5 text-xs text-muted-foreground xl:table-cell">{t.admin_name || '—'}</td>
                        <td className="table-sticky-actions px-4 py-2.5 text-center">
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label={`Создать корректировку операции от ${formatDate(t.date)}`}
                            onClick={() => { setCorrectTx(t); setCorrectForm({ amount: String(-t.amount), reason: '' }); }}
                          >
                            <RefreshCw className="h-4 w-4 text-warning" aria-hidden="true" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="px-4 pb-4">
                <Pagination
                  page={page}
                  pageSize={PAGE_SIZE}
                  total={total}
                  onPageChange={setPage}
                  isFetching={txQuery.isFetching}
                  itemLabels={['операция', 'операции', 'операций']}
                />
              </div>
            </Card>
          )}
        </div>
      )}

      {/* Ручное начисление */}
      <Dialog open={addOpen} onOpenChange={(v) => { setAddOpen(v); if (!v) setFormError(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ручное начисление баллов</DialogTitle>
            <DialogDescription>
              Операция появится в кошельке сотрудника сразу и попадёт в журнал аудита.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label htmlFor="tx-employee">Сотрудник</Label>
              <select
                id="tx-employee"
                className={selectCls}
                value={form.employee_id}
                aria-invalid={formError === 'Выберите сотрудника'}
                onChange={(e) => setForm({ ...form, employee_id: e.target.value })}
              >
                <option value="">Выберите сотрудника</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>{e.name}{e.department ? ` — ${e.department}` : ''}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="tx-type">Тип операции</Label>
                <select id="tx-type" className={selectCls} value={form.type}
                  onChange={(e) => setForm({ ...form, type: e.target.value })}>
                  {MANUAL_TYPES.map((k) => <option key={k} value={k}>{statusLabel(k)}</option>)}
                </select>
              </div>
              <div>
                <Label htmlFor="tx-reason">Причина из справочника</Label>
                <select
                  id="tx-reason"
                  className={selectCls}
                  value={form.reason_code}
                  onChange={(e) => {
                    const reason = reasons.find((r) => r.code === e.target.value);
                    setForm((f) => ({
                      ...f,
                      reason_code: e.target.value,
                      // Подставляем рекомендованный номинал, если сумма ещё не введена вручную.
                      amount: reason?.default_points != null && !f.amount ? String(reason.default_points) : f.amount,
                    }));
                  }}
                >
                  <option value="">Без причины</option>
                  {reasons.map((r) => (
                    <option key={r.code} value={r.code}>
                      {r.title}{r.default_points != null ? ` (${r.default_points})` : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="tx-amount">Сумма в баллах (+ начисление / − списание)</Label>
                <Input
                  id="tx-amount"
                  type="number"
                  value={form.amount}
                  aria-invalid={!!formError && formError !== 'Выберите сотрудника'}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="tx-date">Дата операции</Label>
                <Input id="tx-date" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
              </div>
            </div>
            <div>
              <Label htmlFor="tx-comment">Комментарий</Label>
              <Input id="tx-comment" value={form.reason} placeholder="Дополнительное пояснение к начислению"
                onChange={(e) => setForm({ ...form, reason: e.target.value })} />
            </div>
            {formError && <p role="alert" className="text-sm text-destructive">{formError}</p>}
          </div>
          <DialogFooter>
            {/* BUG-072: в модалке обязательна явная кнопка «Отмена» */}
            <Button variant="outline" onClick={() => setAddOpen(false)}>Отмена</Button>
            <Button onClick={handleAdd} disabled={createTx.isPending || !!validateForm()}>Создать операцию</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Корректировка */}
      <Dialog open={!!correctTx} onOpenChange={(v) => !v && setCorrectTx(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Корректировка операции</DialogTitle>
            <DialogDescription>
              Исходная запись не изменяется — создаётся связанная компенсирующая операция.
            </DialogDescription>
          </DialogHeader>
          {correctTx && (
            <div className="space-y-3 py-2">
              <Card className="bg-muted/50 p-3 text-sm">
                <div className="text-muted-foreground">Исходная операция</div>
                <div className="font-medium text-foreground">
                  {correctTx.employee_name} · {formatDate(correctTx.date)} · {formatSigned(correctTx.amount, formatPoints)}
                </div>
                <div className="mt-1"><StatusBadge value={correctTx.type} /></div>
              </Card>
              <div>
                <Label htmlFor="corr-amount">Сумма корректировки (+ доначисление / − списание)</Label>
                <Input id="corr-amount" type="number" value={correctForm.amount}
                  onChange={(e) => setCorrectForm({ ...correctForm, amount: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="corr-reason">Причина корректировки</Label>
                <Input id="corr-reason" value={correctForm.reason} placeholder="Ошибочно списаны 100 баллов"
                  onChange={(e) => setCorrectForm({ ...correctForm, reason: e.target.value })} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCorrectTx(null)}>Отмена</Button>
            <Button onClick={handleCorrect} disabled={createCorrection.isPending || !Number(correctForm.amount)}>
              Создать корректировку
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
