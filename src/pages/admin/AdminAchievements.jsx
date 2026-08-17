import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Award, Plus, Sparkles, Zap, Search, Trash2, CalendarRange, Users, Info, Hand,
} from 'lucide-react';
import { api } from '@/api/client';
import PageContainer from '@/components/common/PageContainer';
import EmptyState from '@/components/common/EmptyState';
import ErrorState from '@/components/common/ErrorState';
import StatusBadge from '@/components/common/StatusBadge';
import FilterChips from '@/components/common/FilterChips';
import ImageUpload from '@/components/common/ImageUpload';
import SafeImage from '@/components/common/SafeImage';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/lib/AuthContext';
import {
  formatDate, formatMonth, formatNumber, formatPoints, formatTenure, tenureYears, pluralize,
} from '@/lib/format';
import { mutationErrorMessage } from '@/lib/dataErrors';

/**
 * Достижения и геймификация.
 *
 * BUG-082: два разных сотрудника получили «Сотрудник месяца» за 2026-07-01. В БД теперь
 *   уникальный индекс achievements_month_uniq на (type, period) для employee_of_month —
 *   код 23505 переводим в «За этот период «Сотрудник месяца» уже назначен».
 *   Поле «Период» обязательно для этого типа и выбирается как месяц.
 * BUG-021/022: достижение «5 лет в компании» противоречило блоку годовщин на главной.
 *   Стаж больше нигде не вводится руками: он считается tenureYears/formatTenure из hire_date —
 *   тем же способом, что и на главной странице.
 * BUG-063: «₸KZ» переносилось на вторую строку и ломало высоту карточек. Баллы выводятся
 *   formatPoints() в whitespace-nowrap, сетка — items-stretch.
 * BUG-055: внутренняя валюта — баллы, никаких «₸KZ».
 * Аудит (язык): «согласование workflow» — англицизм; заменено на «автоматическое начисление».
 * Начисление баллов оформляется записью WalletTransaction с type='achievement' и reason_code.
 */

const TYPES = [
  { value: 'employee_of_month', label: 'Сотрудник месяца' },
  { value: 'tenure', label: 'За стаж' },
  { value: 'kpi', label: 'За KPI' },
  { value: 'special', label: 'Особое достижение' },
  { value: 'birthday', label: 'День рождения' },
];

const TYPE_LABEL = Object.fromEntries(TYPES.map((t) => [t.value, t.label]));

const emptyForm = () => ({
  type: 'special',
  employee_id: '',
  title: '',
  period: '', // 'YYYY-MM' из поля выбора месяца
  points: 100,
  date: formatDate(new Date(), 'iso'),
  description: '',
  reason_code: '',
  auto: false,
  rule: '',
  // Картинка достижения (миграция 0009: achievements.image_url / image_path).
  image_url: '',
  image_path: '',
});

function validate(form) {
  const errors = {};
  if (!form.title.trim()) errors.title = 'Укажите название достижения';
  if (!form.employee_id) errors.employee_id = 'Выберите сотрудника';
  if (!form.date) errors.date = 'Укажите дату';
  const points = Number(form.points);
  if (!Number.isInteger(points) || points < 0) errors.points = 'Баллы — целое число от 0';
  // BUG-082: без периода уникальность «Сотрудника месяца» проверить невозможно.
  if (form.type === 'employee_of_month' && !form.period) {
    errors.period = 'Для «Сотрудника месяца» обязательно укажите месяц';
  }
  if (form.auto && !form.rule.trim()) errors.rule = 'Опишите правило автоматического начисления';
  return errors;
}

function CardsSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4" aria-hidden="true">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <Card key={i} className="p-4 flex gap-3 animate-pulse">
          <div className="w-12 h-12 rounded-full bg-muted shrink-0" />
          <div className="flex-1 space-y-2 py-1">
            <div className="h-4 w-2/3 rounded bg-muted" />
            <div className="h-3 w-1/2 rounded bg-muted/60" />
          </div>
        </Card>
      ))}
    </div>
  );
}

export default function AdminAchievements() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { user } = useAuth();

  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [touched, setTouched] = useState({});
  const [pendingDelete, setPendingDelete] = useState(null);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchDraft.trim().toLowerCase()), 300);
    return () => clearTimeout(timer);
  }, [searchDraft]);

  /* --------------------------------------------------------------- данные */

  const { data: achievements, isLoading, error, refetch } = useQuery({
    queryKey: ['admin-achievements'],
    queryFn: () => api.entities.Achievement.list('-date', 500),
  });

  const { data: employees } = useQuery({
    queryKey: ['employees-all'],
    queryFn: () => api.entities.Employee.list('name', 1000),
  });

  const { data: reasons } = useQuery({
    queryKey: ['award-reasons'],
    queryFn: () => api.entities.AwardReason.list('title', 200),
  });

  const employeeById = useMemo(
    () => new Map((employees || []).map((e) => [e.id, e])),
    [employees]
  );

  const activeReasons = useMemo(
    () => (reasons || []).filter((r) => r.active !== false),
    [reasons]
  );

  const counts = useMemo(() => {
    const map = { all: (achievements || []).length };
    TYPES.forEach((t) => {
      map[t.value] = (achievements || []).filter((a) => a.type === t.value).length;
    });
    return map;
  }, [achievements]);

  const filtered = useMemo(() => {
    return (achievements || []).filter((a) => {
      if (typeFilter !== 'all' && a.type !== typeFilter) return false;
      if (search) {
        const emp = employeeById.get(a.employee_id);
        const haystack = `${a.title} ${a.employee_name || ''} ${emp?.name || ''}`.toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      return true;
    });
  }, [achievements, typeFilter, search, employeeById]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['admin-achievements'] });
    qc.invalidateQueries({ queryKey: ['achievements'] });
    qc.invalidateQueries({ queryKey: ['wallet-all'] });
  };

  /* -------------------------------------------------------------- мутации */

  const award = useMutation({
    mutationFn: async (payload) => {
      const emp = employeeById.get(payload.employee_id);
      const points = Number(payload.points) || 0;

      const created = await api.entities.Achievement.create({
        employee_id: payload.employee_id,
        employee_name: emp?.name || null,
        title: payload.title.trim(),
        type: payload.type,
        // Период храним первым числом месяца — так работает уникальный индекс (BUG-082).
        period: payload.period ? `${payload.period}-01` : null,
        points,
        date: payload.date,
        description: payload.description.trim() || null,
        reason_code: payload.reason_code || null,
        auto: payload.auto,
        rule: payload.auto ? payload.rule.trim() : null,
        image_url: payload.image_url || null,
        image_path: payload.image_path || null,
      });

      // Начисление баллов — отдельная операция кошелька (type='achievement').
      // amount <> 0 требует БД, поэтому нулевые достижения баллы не начисляют.
      let walletError = null;
      if (points > 0) {
        try {
          await api.entities.WalletTransaction.create({
            employee_id: payload.employee_id,
            employee_name: emp?.name || null,
            amount: points,
            type: 'achievement',
            reason: payload.title.trim(),
            reason_code: payload.reason_code || null,
            date: payload.date,
            admin_id: user?.id || null,
            admin_name: user?.full_name || null,
            // BUG-035: филиал и отдел берём по идентификаторам карточки сотрудника
            branch_id: emp?.branch_id || null,
            department_id: emp?.department_id || null,
          });
        } catch (err) {
          walletError = err;
        }
      }
      return { created, points, walletError };
    },
    onSuccess: ({ points, walletError }) => {
      if (walletError) {
        toast({
          title: 'Достижение выдано, но баллы не начислены',
          description: mutationErrorMessage(walletError),
          variant: 'destructive',
        });
      } else {
        toast({
          title: 'Достижение выдано',
          description: points > 0 ? `Начислено ${formatPoints(points)}` : 'Без начисления баллов',
        });
      }
      closeForm();
      invalidate();
    },
    onError: (err) => toast({
      title: 'Не удалось выдать достижение',
      description: mutationErrorMessage(err, {
        23505: 'За этот период «Сотрудник месяца» уже назначен',
      }),
      variant: 'destructive',
    }),
  });

  const remove = useMutation({
    mutationFn: (item) => api.entities.Achievement.delete(item.id),
    onSuccess: () => {
      setPendingDelete(null);
      toast({ title: 'Достижение отозвано' });
      invalidate();
    },
    onError: (err) => toast({
      title: 'Не удалось отозвать достижение',
      description: mutationErrorMessage(err),
      variant: 'destructive',
    }),
  });

  /* ---------------------------------------------------------------- форма */

  const errors = validate(form);
  const isValid = Object.keys(errors).length === 0;
  const showError = (field) => (touched[field] ? errors[field] : undefined);

  const openCreate = () => {
    setForm(emptyForm());
    setTouched({});
    setFormOpen(true);
  };

  const closeForm = () => {
    setFormOpen(false);
    setForm(emptyForm());
    setTouched({});
  };

  const submit = () => {
    setTouched({ title: true, employee_id: true, date: true, points: true, period: true, rule: true });
    if (!isValid) return;
    award.mutate(form);
  };

  const selectedEmployee = employeeById.get(form.employee_id) || null;

  /** Стаж выбранного сотрудника — только из hire_date (BUG-021/022). */
  const selectedTenure = selectedEmployee?.hire_date
    ? {
      label: formatTenure(selectedEmployee.hire_date),
      years: tenureYears(selectedEmployee.hire_date),
      hired: selectedEmployee.hire_date,
    }
    : null;

  const hasFilters = !!search || typeFilter !== 'all';

  return (
    <PageContainer
      title="Достижения"
      description="Награды сотрудников и начисление баллов: «Сотрудник месяца», годовщины, KPI и особые достижения."
      width="wide"
      actions={
        <>
          {/* Автоматическое награждение по условию настраивается отдельной страницей */}
          <Button variant="outline" className="min-h-[40px]" asChild>
            <Link to="/admin/achievement-rules">
              <Zap className="w-4 h-4 mr-1" aria-hidden="true" />
              Правила автоначисления
            </Link>
          </Button>
          <Button onClick={openCreate} className="min-h-[40px]">
            <Plus className="w-4 h-4" aria-hidden="true" />
            Выдать достижение
          </Button>
        </>
      }
    >
      {/* --------------------------------------- блок автоматических правил */}
      <Card className="mb-5 p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-warning/15 text-warning">
            <Zap className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h2 className="font-semibold text-foreground">Автоматические правила</h2>
            {/* Аудит: «согласование workflow» → «автоматическое начисление» */}
            <p className="mt-1 text-sm text-muted-foreground">
              Часть достижений портал выдаёт сам: годовщина работы (стаж считается по дате приёма
              в кадровой карточке), завершение обязательного курса и автоматическое начисление баллов
              по причинам ниже. Ручная выдача нужна только для исключений.
            </p>

            {activeReasons.length > 0 ? (
              <ul role="list" className="mt-3 flex flex-wrap gap-2">
                {activeReasons.map((reason) => (
                  <li key={reason.code}>
                    <Badge variant="secondary" className="whitespace-nowrap">
                      {reason.title}
                      {reason.default_points != null && (
                        <span className="ml-1 font-normal">· {formatPoints(reason.default_points)}</span>
                      )}
                    </Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-xs text-muted-foreground">
                Причины начисления не заведены — добавьте их в разделе «Причины начисления».
              </p>
            )}
          </div>
        </div>
      </Card>

      {/* ------------------------------------------------------- фильтры */}
      <div className="flex flex-col lg:flex-row lg:items-center gap-3 mb-4">
        <div className="relative w-full lg:max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
          <label htmlFor="admin-achievements-search" className="sr-only">Поиск по достижению или сотруднику</label>
          <Input
            id="admin-achievements-search"
            type="search"
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            placeholder="Поиск по названию или сотруднику"
            className="pl-9 min-h-[40px]"
          />
        </div>
        <FilterChips
          ariaLabel="Фильтр по типу достижения"
          value={typeFilter}
          onChange={setTypeFilter}
          options={[
            { value: 'all', label: 'Все', count: counts.all },
            ...TYPES.map((t) => ({ value: t.value, label: t.label, count: counts[t.value] })),
          ]}
        />
      </div>

      {/* -------------------------------------------------------- список */}
      {error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : isLoading ? (
        <CardsSkeleton />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Award}
          title={hasFilters ? 'Достижения не найдены' : 'Достижений пока нет'}
          description={
            hasFilters
              ? 'Измените запрос или снимите фильтр по типу.'
              : 'Выдайте первое достижение — баллы автоматически попадут в кошелёк сотрудника.'
          }
          actionLabel={hasFilters ? 'Сбросить фильтры' : 'Выдать достижение'}
          onAction={hasFilters ? () => { setSearchDraft(''); setTypeFilter('all'); } : openCreate}
        />
      ) : (
        /* BUG-063: items-stretch — карточки одной высоты, цена не ломает сетку */
        <ul role="list" className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 items-stretch">
          {filtered.map((item) => {
            const emp = employeeById.get(item.employee_id);
            // BUG-021/022: стаж показываем только посчитанный из hire_date
            const tenure = emp?.hire_date ? formatTenure(emp.hire_date) : null;
            return (
              <li key={item.id} className="h-full">
                <Card className="flex h-full flex-col p-4">
                  <div className="flex items-start gap-3">
                    {/* Картинка достижения (0009); если её нет или ссылка битая — символ либо иконка */}
                    <SafeImage
                      src={item.image_url}
                      alt=""
                      className="h-12 w-12 shrink-0 rounded-full border border-border object-cover"
                      fallbackIcon={Award}
                      fallbackText={item.icon || undefined}
                      fallbackClassName="bg-warning/15 text-warning text-xl"
                    />
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold text-foreground line-clamp-2">{item.title}</h3>
                      <p className="text-xs text-muted-foreground line-clamp-1">
                        {emp?.name || item.employee_name || 'Сотрудник портала'}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <StatusBadge value={item.type} fallback={TYPE_LABEL[item.type]} />
                        {/* Источник записи: rule_id проставляет apply_achievement_rules() */}
                        {item.rule_id ? (
                          <Badge variant="info" className="whitespace-nowrap">
                            <Sparkles className="w-3 h-3 mr-1" aria-hidden="true" />
                            Автоматически
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="whitespace-nowrap">
                            <Hand className="w-3 h-3 mr-1" aria-hidden="true" />
                            Вручную
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>

                  {item.description && (
                    <p className="mt-3 text-sm text-muted-foreground line-clamp-2">{item.description}</p>
                  )}

                  <div className="mt-3 flex-1 space-y-1 text-xs text-muted-foreground">
                    {item.period && (
                      <p className="inline-flex items-center gap-1.5 whitespace-nowrap">
                        <CalendarRange className="w-3.5 h-3.5" aria-hidden="true" />
                        Период: {formatMonth(item.period, 'long')}
                      </p>
                    )}
                    {item.type === 'tenure' && (
                      <p className="whitespace-nowrap">
                        Стаж по дате приёма: {tenure || 'дата приёма не указана'}
                      </p>
                    )}
                    {item.rule && <p className="line-clamp-2">Правило: {item.rule}</p>}
                  </div>

                  <div className="mt-4 flex items-end justify-between gap-3">
                    <div className="min-w-0">
                      {/* BUG-055/063: баллы, одной строкой, без переноса */}
                      <div className="whitespace-nowrap text-lg font-bold text-brand-wallet">
                        {formatPoints(item.points || 0)}
                      </div>
                      <div className="whitespace-nowrap text-xs text-muted-foreground">
                        {formatDate(item.date)}
                      </div>
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => setPendingDelete(item)}
                      aria-label={`Отозвать достижение «${item.title}»`}
                    >
                      <Trash2 className="w-4 h-4" aria-hidden="true" />
                    </Button>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      {!error && !isLoading && filtered.length > 0 && (
        <p className="mt-3 text-sm text-muted-foreground" aria-live="polite">
          Показано {pluralize(filtered.length, 'достижение', 'достижения', 'достижений')}
          {filtered.length !== (achievements || []).length
            ? ` из ${formatNumber((achievements || []).length)}`
            : ''}
        </p>
      )}

      {/* ------------------------------------------- форма выдачи награды */}
      <Dialog open={formOpen} onOpenChange={(open) => (open ? setFormOpen(true) : closeForm())}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Выдать достижение</DialogTitle>
            <DialogDescription>
              Баллы начисляются операцией кошелька с типом «Достижение» — её видно в истории сотрудника.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="ach-type">Тип достижения</Label>
                <select
                  id="ach-type"
                  className="w-full min-h-[40px] rounded-md border border-input bg-background px-3 text-sm"
                  value={form.type}
                  onChange={(e) => setForm({ ...form, type: e.target.value })}
                >
                  {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>

              <div>
                <Label htmlFor="ach-employee">Сотрудник *</Label>
                <select
                  id="ach-employee"
                  className="w-full min-h-[40px] rounded-md border border-input bg-background px-3 text-sm"
                  value={form.employee_id}
                  onChange={(e) => setForm({ ...form, employee_id: e.target.value })}
                  onBlur={() => setTouched((t) => ({ ...t, employee_id: true }))}
                  aria-invalid={!!showError('employee_id')}
                >
                  <option value="">Выберите сотрудника</option>
                  {(employees || []).map((e) => (
                    <option key={e.id} value={e.id}>{e.name}</option>
                  ))}
                </select>
                {showError('employee_id') && (
                  <p role="alert" className="mt-1 text-xs text-destructive">{showError('employee_id')}</p>
                )}
              </div>
            </div>

            {/* BUG-021/022: стаж не вводится руками — показываем расчёт из hire_date */}
            {selectedEmployee && (
              <p className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
                <Info className="w-4 h-4 shrink-0" aria-hidden="true" />
                {selectedTenure ? (
                  <span>
                    Стаж по кадровым данным: <span className="font-medium text-foreground">{selectedTenure.label}</span>{' '}
                    (дата приёма {formatDate(selectedTenure.hired)}). Тот же расчёт используется в блоке
                    годовщин на главной — не указывайте другой стаж в названии.
                  </span>
                ) : (
                  <span>У сотрудника не заполнена дата приёма — стаж посчитать нельзя.</span>
                )}
              </p>
            )}

            <div>
              <Label htmlFor="ach-title">Название *</Label>
              <Input
                id="ach-title"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                onBlur={() => setTouched((t) => ({ ...t, title: true }))}
                placeholder={form.type === 'tenure' && selectedTenure
                  ? `${selectedTenure.label} в компании`
                  : 'Сотрудник месяца'}
                aria-invalid={!!showError('title')}
                className="min-h-[40px]"
              />
              {showError('title') && (
                <p role="alert" className="mt-1 text-xs text-destructive">{showError('title')}</p>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* BUG-082: период обязателен для «Сотрудника месяца» */}
              <div>
                <Label htmlFor="ach-period">
                  Период (месяц){form.type === 'employee_of_month' ? ' *' : ''}
                </Label>
                <Input
                  id="ach-period"
                  type="month"
                  value={form.period}
                  onChange={(e) => setForm({ ...form, period: e.target.value })}
                  onBlur={() => setTouched((t) => ({ ...t, period: true }))}
                  aria-invalid={!!showError('period')}
                  aria-describedby="ach-period-hint"
                  className="min-h-[40px]"
                />
                <p id="ach-period-hint" className="mt-1 text-xs text-muted-foreground">
                  «Сотрудник месяца» может быть только один на месяц — портал не даст назначить второго.
                </p>
                {showError('period') && (
                  <p role="alert" className="mt-1 text-xs text-destructive">{showError('period')}</p>
                )}
              </div>

              <div>
                <Label htmlFor="ach-date">Дата выдачи *</Label>
                <Input
                  id="ach-date"
                  type="date"
                  value={form.date}
                  onChange={(e) => setForm({ ...form, date: e.target.value })}
                  onBlur={() => setTouched((t) => ({ ...t, date: true }))}
                  aria-invalid={!!showError('date')}
                  className="min-h-[40px]"
                />
                {showError('date') && (
                  <p role="alert" className="mt-1 text-xs text-destructive">{showError('date')}</p>
                )}
              </div>

              <div>
                <Label htmlFor="ach-reason">Причина начисления</Label>
                <select
                  id="ach-reason"
                  className="w-full min-h-[40px] rounded-md border border-input bg-background px-3 text-sm"
                  value={form.reason_code}
                  onChange={(e) => {
                    const reason = activeReasons.find((r) => r.code === e.target.value);
                    setForm((prev) => ({
                      ...prev,
                      reason_code: e.target.value,
                      // Подставляем базовое количество баллов из справочника
                      points: reason?.default_points != null ? reason.default_points : prev.points,
                    }));
                  }}
                >
                  <option value="">Без причины из справочника</option>
                  {activeReasons.map((r) => (
                    <option key={r.code} value={r.code}>
                      {r.title}{r.default_points != null ? ` (${r.default_points})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <Label htmlFor="ach-points">Баллы *</Label>
                <Input
                  id="ach-points"
                  type="number"
                  min="0"
                  value={form.points}
                  onChange={(e) => setForm({ ...form, points: e.target.value === '' ? '' : Number(e.target.value) })}
                  onBlur={() => setTouched((t) => ({ ...t, points: true }))}
                  aria-invalid={!!showError('points')}
                  aria-describedby="ach-points-hint"
                  className="min-h-[40px]"
                />
                <p id="ach-points-hint" className="mt-1 text-xs text-muted-foreground whitespace-nowrap">
                  Начислим {formatPoints(Number(form.points) || 0)}
                </p>
                {showError('points') && (
                  <p role="alert" className="mt-1 text-xs text-destructive">{showError('points')}</p>
                )}
              </div>
            </div>

            <div>
              <Label htmlFor="ach-description">Описание</Label>
              <Textarea
                id="ach-description"
                rows={2}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="За что выдано достижение"
              />
            </div>

            {/* Картинка достижения задаётся файлом, а не ссылкой (0009 + раздел 10 соглашений) */}
            <ImageUpload
              value={form.image_url}
              path={form.image_path}
              folder="achievements"
              label="Картинка достижения"
              aspect="square"
              hint="Показывается в карточке достижения; если не задана — используется иконка"
              onChange={({ url, path }) => setForm((f) => ({ ...f, image_url: url, image_path: path }))}
            />

            <div className="flex items-center gap-2 min-h-[40px]">
              <Checkbox
                id="ach-auto"
                checked={form.auto}
                onCheckedChange={(v) => setForm({ ...form, auto: !!v })}
              />
              <Label htmlFor="ach-auto" className="font-normal">Автоматическое начисление по правилу</Label>
            </div>

            {form.auto && (
              <div>
                <Label htmlFor="ach-rule">Правило *</Label>
                <Input
                  id="ach-rule"
                  value={form.rule}
                  onChange={(e) => setForm({ ...form, rule: e.target.value })}
                  onBlur={() => setTouched((t) => ({ ...t, rule: true }))}
                  placeholder="Годовщина работы: стаж по дате приёма"
                  aria-invalid={!!showError('rule')}
                  className="min-h-[40px]"
                />
                {showError('rule') && (
                  <p role="alert" className="mt-1 text-xs text-destructive">{showError('rule')}</p>
                )}
              </div>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" className="min-h-[40px]" onClick={closeForm}>Отмена</Button>
            <Button className="min-h-[40px]" onClick={submit} disabled={!isValid || award.isPending}>
              {award.isPending ? 'Выдача…' : 'Выдать достижение'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ------------------------------------------- подтверждение отзыва */}
      <Dialog open={!!pendingDelete} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Отозвать достижение?</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2">
                <p>
                  Достижение «{pendingDelete?.title}» у сотрудника{' '}
                  {employeeById.get(pendingDelete?.employee_id)?.name || pendingDelete?.employee_name || '—'}{' '}
                  будет удалено. Действие нельзя отменить.
                </p>
                <p className="flex items-start gap-2 text-xs">
                  <Users className="w-4 h-4 shrink-0 text-warning" aria-hidden="true" />
                  Ранее начисленные {formatPoints(pendingDelete?.points || 0)} останутся в кошельке:
                  чтобы их снять, сделайте корректировку в разделе «Операции кошелька».
                </p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" className="min-h-[40px]" onClick={() => setPendingDelete(null)}>Отмена</Button>
            <Button
              variant="destructive"
              className="min-h-[40px]"
              disabled={remove.isPending}
              onClick={() => remove.mutate(pendingDelete)}
            >
              {remove.isPending ? 'Удаление…' : 'Отозвать'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
