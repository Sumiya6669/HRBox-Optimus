import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Award, Plus, Search, Trash2, Pencil, Zap, PlayCircle, Users, Info, AlertTriangle, Clock,
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
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { formatDate, formatNumber, formatPoints, pluralize } from '@/lib/format';
import { ACHIEVEMENT_PARAMS, COMPARISON_OPERATORS } from '@/lib/statusLabels';
import { mutationErrorMessage } from '@/lib/dataErrors';

/**
 * Правила достижений — «Автоматическое награждение по условию» (ТЗ §1.2).
 *
 * У правила включается тумблер «Автоматическое награждение», задаётся условие
 * (параметр → оператор → значение), и портал сам выдаёт достижение и бонус в баллах
 * всем, кто под условие подпадает, без участия HR.
 * Пример из ТЗ: «Выслуга лет Июнь», 20 баллов, «Стаж работы в месяцах» больше 13.
 *
 * Источник правды — миграция 0009_achievement_rules.sql:
 *   • achievement_rules с ограничением achievement_rules_condition_valid:
 *     автоправило без параметра и оператора сохранить нельзя (код 23514);
 *   • apply_achievement_rules(rule_id) — идемпотентная выдача (уникальный индекс
 *     achievements_rule_period_uniq не даст выдать одно правило дважды за период);
 *   • preview_achievement_rule(param, operator, threshold) — предпросмотр списка.
 *
 * Штатно правила запускает планировщик (Edge Function apply-achievements),
 * кнопки на странице — принудительный запуск «прямо сейчас».
 */

const TYPES = [
  { value: 'employee_of_month', label: 'Сотрудник месяца' },
  { value: 'tenure', label: 'За стаж' },
  { value: 'kpi', label: 'За KPI' },
  { value: 'special', label: 'Особое достижение' },
  { value: 'birthday', label: 'День рождения' },
];

const PERIODS = [
  { value: 'once', label: 'Один раз', hint: 'Правило сработает для сотрудника единожды за всё время.' },
  { value: 'yearly', label: 'Раз в год', hint: 'Правило может сработать для сотрудника один раз в календарный год.' },
  { value: 'monthly', label: 'Раз в месяц', hint: 'Правило может сработать для сотрудника один раз в календарный месяц.' },
];

/** Параметр «день рождения сегодня» — условие-флаг, порога у него нет. */
const FLAG_PARAM = 'birthday_today';

const emptyForm = () => ({
  title: '',
  description: '',
  type: 'special',
  points: 0,
  reason_code: '',
  image_url: '',
  image_path: '',
  auto_award: false,
  param: '',
  operator: 'gt',
  threshold: '',
  period: 'once',
  is_active: true,
});

/** Значения правила → поля формы (числа приводим к строкам для input). */
function formFromRule(rule) {
  return {
    title: rule.title || '',
    description: rule.description || '',
    type: rule.type || 'special',
    points: rule.points ?? 0,
    reason_code: rule.reason_code || '',
    image_url: rule.image_url || '',
    image_path: rule.image_path || '',
    auto_award: !!rule.auto_award,
    param: rule.param || '',
    operator: rule.operator || 'gt',
    threshold: rule.threshold === null || rule.threshold === undefined ? '' : String(Number(rule.threshold)),
    period: rule.period || 'once',
    is_active: rule.is_active !== false,
  };
}

/** Условие человеческим текстом: «Стаж работы в месяцах больше 13». */
function conditionText(rule) {
  if (!rule?.param) return null;
  if (rule.param === FLAG_PARAM) return 'Сегодня день рождения';
  if (!rule.operator) return null;
  // Пустой порог — условие ещё не дописано, «больше 0» показывать нельзя.
  if (rule.threshold === null || rule.threshold === undefined || rule.threshold === '') return null;
  const paramLabel = ACHIEVEMENT_PARAMS[rule.param] || rule.param;
  const operatorLabel = (COMPARISON_OPERATORS[rule.operator] || rule.operator).toLowerCase();
  return `${paramLabel} ${operatorLabel} ${formatNumber(rule.threshold)}`;
}

function validate(form) {
  const errors = {};
  if (!form.title.trim()) errors.title = 'Укажите название достижения';
  const points = Number(form.points);
  if (!Number.isInteger(points) || points < 0) errors.points = 'Бонус — целое число от 0';
  // Ограничение achievement_rules_condition_valid: автоправило без условия не сохранится.
  if (form.auto_award) {
    if (!form.param) errors.param = 'Выберите параметр условия';
    if (!form.operator) errors.operator = 'Выберите условие сравнения';
    if (form.param !== FLAG_PARAM) {
      if (form.threshold === '' || !Number.isFinite(Number(form.threshold))) {
        errors.threshold = 'Укажите значение для сравнения';
      }
    }
  }
  return errors;
}

function CardsSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3" aria-hidden="true">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <Card key={i} className="animate-pulse space-y-3 p-4">
          <div className="flex gap-3">
            <div className="h-12 w-12 shrink-0 rounded-lg bg-muted" />
            <div className="flex-1 space-y-2 py-1">
              <div className="h-4 w-2/3 rounded bg-muted" />
              <div className="h-3 w-1/2 rounded bg-muted/60" />
            </div>
          </div>
          <div className="h-3 w-full rounded bg-muted/60" />
          <div className="h-9 w-full rounded bg-muted/40" />
        </Card>
      ))}
    </div>
  );
}

export default function AdminAchievementRules() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');
  const [modeFilter, setModeFilter] = useState('all');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [touched, setTouched] = useState({});
  const [pendingDelete, setPendingDelete] = useState(null);
  // null | { rule } | { all: true } — подтверждение принудительного запуска.
  const [pendingApply, setPendingApply] = useState(null);
  const [previewRows, setPreviewRows] = useState(null);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchDraft.trim().toLowerCase()), 300);
    return () => clearTimeout(timer);
  }, [searchDraft]);

  /* --------------------------------------------------------------- данные */

  const rulesQuery = useQuery({
    queryKey: ['admin-achievement-rules'],
    queryFn: () => api.entities.AchievementRule.list('-created_date', 500),
  });

  const reasonsQuery = useQuery({
    queryKey: ['award-reasons'],
    queryFn: () => api.entities.AwardReason.list('title', 200),
  });

  const activeReasons = useMemo(
    () => (reasonsQuery.data || []).filter((r) => r.active !== false),
    [reasonsQuery.data]
  );

  const all = useMemo(() => rulesQuery.data || [], [rulesQuery.data]);

  const filtered = useMemo(() => {
    return all.filter((rule) => {
      if (modeFilter === 'auto' && !rule.auto_award) return false;
      if (modeFilter === 'manual' && rule.auto_award) return false;
      if (!search) return true;
      const haystack = `${rule.title || ''} ${rule.description || ''} ${conditionText(rule) || ''}`.toLowerCase();
      return haystack.includes(search);
    });
  }, [all, modeFilter, search]);

  const filterOptions = useMemo(
    () => [
      { value: 'all', label: 'Все', count: all.length },
      { value: 'auto', label: 'Автоматические', count: all.filter((r) => r.auto_award).length },
      { value: 'manual', label: 'Ручные', count: all.filter((r) => !r.auto_award).length },
    ],
    [all]
  );

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['admin-achievement-rules'] });
    qc.invalidateQueries({ queryKey: ['admin-achievements'] });
    qc.invalidateQueries({ queryKey: ['achievements'] });
    qc.invalidateQueries({ queryKey: ['wallet-all'] });
  };

  /* -------------------------------------------------------------- мутации */

  // Ограничение БД achievement_rules_condition_valid отдаёт 23514 — переводим его.
  const CONDITION_ERRORS = {
    23514: 'Для автоматического награждения нужно задать условие',
    42501: 'Менять правила достижений могут только HR-специалист и администратор.',
  };

  const save = useMutation({
    mutationFn: ({ id, payload }) =>
      (id ? api.entities.AchievementRule.update(id, payload) : api.entities.AchievementRule.create(payload)),
    onSuccess: (_data, variables) => {
      toast({ title: variables.id ? 'Правило сохранено' : 'Правило создано' });
      closeForm();
      invalidate();
    },
    onError: (e) =>
      toast({
        title: 'Не удалось сохранить правило',
        description: mutationErrorMessage(e, CONDITION_ERRORS),
        variant: 'destructive',
      }),
  });

  const patch = useMutation({
    mutationFn: ({ id, values }) => api.entities.AchievementRule.update(id, values),
    onSuccess: () => invalidate(),
    onError: (e) =>
      toast({
        title: 'Не удалось изменить правило',
        description: mutationErrorMessage(e, CONDITION_ERRORS),
        variant: 'destructive',
      }),
  });

  const remove = useMutation({
    mutationFn: (rule) => api.entities.AchievementRule.delete(rule.id),
    onSuccess: () => {
      setPendingDelete(null);
      toast({
        title: 'Правило удалено',
        description: 'Ранее выданные по нему достижения и баллы остались у сотрудников.',
      });
      invalidate();
    },
    onError: (e) => {
      toast({
        title: 'Не удалось удалить правило',
        description: mutationErrorMessage(e, CONDITION_ERRORS),
        variant: 'destructive',
      });
    },
  });

  const preview = useMutation({
    mutationFn: ({ param, operator, threshold }) =>
      // Для «дня рождения» порога нет: сравниваем признак с единицей — так же,
      // как это делает apply_achievement_rules().
      api.rpc.previewAchievementRule(
        param,
        param === FLAG_PARAM ? 'eq' : operator,
        param === FLAG_PARAM ? 1 : Number(threshold)
      ),
    onSuccess: (rows) => setPreviewRows(rows || []),
    onError: (e) => {
      setPreviewRows(null);
      toast({
        title: 'Не удалось построить предпросмотр',
        description: mutationErrorMessage(e),
        variant: 'destructive',
      });
    },
  });

  const applyRules = useMutation({
    mutationFn: (rule) => api.rpc.applyAchievementRules(rule?.id ?? null),
    onSuccess: (result) => {
      setPendingApply(null);
      const rules = Number(result?.rules_processed) || 0;
      const checked = Number(result?.employees_checked) || 0;
      const awarded = Number(result?.achievements_awarded) || 0;
      toast({
        title: awarded > 0 ? `Выдано ${pluralize(awarded, 'достижение', 'достижения', 'достижений')}` : 'Новых награждений нет',
        description: `Обработано ${pluralize(rules, 'правило', 'правила', 'правил')}, `
          + `проверено ${pluralize(checked, 'сотрудник', 'сотрудника', 'сотрудников')}, `
          + `выдано ${pluralize(awarded, 'достижение', 'достижения', 'достижений')}.`,
      });
      invalidate();
    },
    onError: (e) => {
      setPendingApply(null);
      toast({
        title: 'Не удалось запустить проверку',
        description: mutationErrorMessage(e, {
          42501: 'Запускать автоначисление могут только HR-специалист и администратор.',
        }),
        variant: 'destructive',
      });
    },
  });

  /* ---------------------------------------------------------------- форма */

  const errors = validate(form);
  const isValid = Object.keys(errors).length === 0;
  const showError = (field) => (touched[field] ? errors[field] : undefined);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm());
    setTouched({});
    setPreviewRows(null);
    preview.reset();
    setFormOpen(true);
  };

  const openEdit = (rule) => {
    setEditing(rule);
    setForm(formFromRule(rule));
    setTouched({});
    setPreviewRows(null);
    preview.reset();
    setFormOpen(true);
  };

  const closeForm = () => {
    setFormOpen(false);
    setEditing(null);
    setForm(emptyForm());
    setTouched({});
    setPreviewRows(null);
    preview.reset();
  };

  const submit = () => {
    setTouched({ title: true, points: true, param: true, operator: true, threshold: true });
    if (!isValid) return;
    const auto = form.auto_award;
    save.mutate({
      id: editing?.id,
      payload: {
        title: form.title.trim(),
        description: form.description.trim() || null,
        type: form.type,
        points: Number(form.points) || 0,
        reason_code: form.reason_code || null,
        image_url: form.image_url || null,
        image_path: form.image_path || null,
        auto_award: auto,
        // Условие сохраняем только для автоправила: у ручного оно ни на что не влияет.
        param: auto ? form.param : null,
        // У «дня рождения» селект оператора выключен и остаётся со значением по умолчанию,
        // поэтому оператор нормализуем так же, как это делает предпросмотр, — «равно 1».
        operator: auto ? (form.param === FLAG_PARAM ? 'eq' : form.operator) : null,
        threshold: auto && form.param !== FLAG_PARAM && form.threshold !== '' ? Number(form.threshold) : null,
        period: form.period,
        is_active: form.is_active,
      },
    });
  };

  const canPreview = !!form.param && (form.param === FLAG_PARAM || form.threshold !== '');
  const periodHint = PERIODS.find((p) => p.value === form.period)?.hint;

  const error = rulesQuery.error;
  const isLoading = rulesQuery.isPending;
  const hasFilters = !!search || modeFilter !== 'all';

  return (
    <PageContainer
      title="Правила достижений"
      description="Автоматическое награждение по условию: портал сам выдаёт достижение и бонус в баллах всем, кто попадает под заданное условие."
      width="wide"
      actions={
        <>
          <Button variant="outline" className="min-h-[40px]" asChild>
            <Link to="/admin/achievements">
              <Award className="mr-1 h-4 w-4" aria-hidden="true" />
              Выданные достижения
            </Link>
          </Button>
          <Button
            variant="outline"
            className="min-h-[40px]"
            onClick={() => setPendingApply({ all: true })}
            disabled={applyRules.isPending}
          >
            <PlayCircle className="mr-1 h-4 w-4" aria-hidden="true" />
            Проверить все правила
          </Button>
          <Button className="min-h-[40px]" onClick={openCreate}>
            <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
            Новое правило
          </Button>
        </>
      }
    >
      {/* ------------------------------------------------ как это работает */}
      <Card className="mb-5 p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-warning/15 text-warning">
            <Zap className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0 space-y-2 text-sm text-muted-foreground">
            <h2 className="font-semibold text-foreground">Как работает автоматическое награждение</h2>
            <p>
              У правила включается тумблер «Автоматическое награждение» и задаётся условие:
              параметр, сравнение и значение. Например, «Выслуга лет Июнь» с бонусом 20 баллов
              и условием «Стаж работы в месяцах больше 13» — достижение и баллы получат все,
              у кого стаж превысил 13 месяцев, без участия HR.
            </p>
            <p>
              Проверку выполняет планировщик (Edge Function <span className="font-mono text-xs">apply-achievements</span>) —
              обычно раз в сутки. Кнопки «Проверить и наградить сейчас» запускают ту же проверку принудительно.
              Повторно одному человеку правило не выдаётся: за это отвечает периодичность
              («Один раз», «Раз в год», «Раз в месяц»).
            </p>
            <p>
              Перед включением автоначисления посмотрите предпросмотр «Кто попадёт под условие»:
              баллы начисляются реально, отменить их можно только вручную корректировкой кошелька.
            </p>
          </div>
        </div>
      </Card>

      {/* --------------------------------------------------------- фильтры */}
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative w-full lg:max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <label htmlFor="rules-search" className="sr-only">Поиск по названию или условию</label>
          <Input
            id="rules-search"
            type="search"
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            placeholder="Поиск по названию, описанию или условию"
            className="min-h-[40px] pl-9"
          />
        </div>
        <FilterChips
          ariaLabel="Фильтр правил по способу выдачи"
          value={modeFilter}
          onChange={setModeFilter}
          options={filterOptions}
        />
      </div>

      {/* ---------------------------------------------------------- список */}
      {error ? (
        <ErrorState error={error} onRetry={rulesQuery.refetch} />
      ) : isLoading ? (
        <CardsSkeleton />
      ) : !filtered.length ? (
        <EmptyState
          icon={Zap}
          title={hasFilters ? 'Правила не найдены' : 'Правил пока нет'}
          description={
            hasFilters
              ? 'Под текущий поиск и фильтр не подошло ни одно правило.'
              : 'Создайте первое правило: например, «Выслуга лет» с бонусом 20 баллов и условием «Стаж работы в месяцах больше 13».'
          }
          actionLabel={hasFilters ? 'Сбросить фильтры' : 'Создать правило'}
          onAction={hasFilters ? () => { setSearchDraft(''); setModeFilter('all'); } : openCreate}
        />
      ) : (
        <ul role="list" className="grid grid-cols-1 items-stretch gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((rule) => {
            const condition = conditionText(rule);
            return (
              <li key={rule.id} role="listitem" className="h-full">
                <Card className="flex h-full flex-col gap-3 p-4">
                  <div className="flex items-start gap-3">
                    {/* Картинка правила; без неё и при битой ссылке — символ либо иконка */}
                    <SafeImage
                      src={rule.image_url}
                      alt=""
                      className="h-12 w-12 shrink-0 rounded-lg border border-border object-cover"
                      fallbackIcon={Award}
                      fallbackText={rule.icon || undefined}
                      fallbackClassName="bg-warning/15 text-xl text-warning"
                    />
                    <div className="min-w-0 flex-1">
                      <h3 className="line-clamp-2 font-semibold text-foreground">{rule.title}</h3>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <StatusBadge value={rule.type} />
                        <StatusBadge value={rule.period} />
                        {rule.auto_award ? (
                          <Badge variant="info" className="whitespace-nowrap">
                            <Zap className="mr-1 h-3 w-3" aria-hidden="true" />
                            Автоматически
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="whitespace-nowrap">Вручную</Badge>
                        )}
                      </div>
                    </div>
                  </div>

                  <p className="line-clamp-2 min-h-[2.5rem] text-sm text-muted-foreground">
                    {rule.description || 'Описание не заполнено'}
                  </p>

                  <div className="space-y-1 text-xs text-muted-foreground">
                    <p className="whitespace-nowrap text-base font-bold text-brand-wallet">
                      {formatPoints(rule.points || 0)}
                    </p>
                    <p>
                      Условие:{' '}
                      <span className="text-foreground">{condition || 'не задано'}</span>
                    </p>
                    <p className="inline-flex items-center gap-1.5">
                      <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                      {rule.last_run
                        ? `Последний запуск: ${formatDate(rule.last_run, 'datetime')}`
                        : 'Ещё ни разу не запускалось'}
                    </p>
                  </div>

                  <div className="space-y-2 rounded-lg bg-muted/40 p-3">
                    <label className="flex min-h-[40px] cursor-pointer items-center gap-2 text-sm text-muted-foreground">
                      <Switch
                        checked={!!rule.auto_award}
                        disabled={patch.isPending}
                        onCheckedChange={(value) => patch.mutate({ id: rule.id, values: { auto_award: value } })}
                        aria-label={`Автоматическое награждение по правилу «${rule.title}»`}
                      />
                      Автоматическое награждение
                    </label>
                    <label className="flex min-h-[40px] cursor-pointer items-center gap-2 text-sm text-muted-foreground">
                      <Switch
                        checked={rule.is_active !== false}
                        disabled={patch.isPending}
                        onCheckedChange={(value) => patch.mutate({ id: rule.id, values: { is_active: value } })}
                        aria-label={`Активность правила «${rule.title}»`}
                      />
                      {rule.is_active !== false ? 'Правило активно' : 'Правило выключено'}
                    </label>
                  </div>

                  <div className="mt-auto flex items-center gap-2 pt-1">
                    <Button
                      variant="outline"
                      className="min-h-[40px] flex-1"
                      onClick={() => setPendingApply({ rule })}
                      disabled={applyRules.isPending || !rule.auto_award || rule.is_active === false}
                    >
                      <PlayCircle className="mr-1 h-4 w-4" aria-hidden="true" />
                      Проверить и наградить
                    </Button>
                    <Button
                      size="icon"
                      variant="outline"
                      className="min-h-[40px]"
                      aria-label={`Изменить правило «${rule.title}»`}
                      onClick={() => openEdit(rule)}
                    >
                      <Pencil className="h-4 w-4" aria-hidden="true" />
                    </Button>
                    <Button
                      size="icon"
                      variant="outline"
                      className="min-h-[40px]"
                      aria-label={`Удалить правило «${rule.title}»`}
                      onClick={() => setPendingDelete(rule)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" aria-hidden="true" />
                    </Button>
                  </div>

                  {rule.auto_award && !condition && (
                    <p role="alert" className="text-xs text-destructive">
                      Для автоматического награждения нужно задать условие — правило не сработает.
                    </p>
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      {!error && !isLoading && filtered.length > 0 && (
        <p className="mt-3 text-sm text-muted-foreground" aria-live="polite">
          Показано {pluralize(filtered.length, 'правило', 'правила', 'правил')}
          {filtered.length !== all.length ? ` из ${formatNumber(all.length)}` : ''}
        </p>
      )}

      {/* ------------------------------------------ создание / изменение */}
      <Dialog open={formOpen} onOpenChange={(open) => (open ? setFormOpen(true) : closeForm())}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? 'Изменить правило' : 'Новое правило достижения'}</DialogTitle>
            <DialogDescription>
              Бонус начисляется операцией кошелька в момент выдачи достижения — её видно в истории сотрудника.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label htmlFor="rule-title">Название *</Label>
              <Input
                id="rule-title"
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                onBlur={() => setTouched((t) => ({ ...t, title: true }))}
                placeholder="Выслуга лет Июнь"
                aria-invalid={!!showError('title')}
                className="min-h-[40px]"
              />
              {showError('title') && (
                <p role="alert" className="mt-1 text-xs text-destructive">{showError('title')}</p>
              )}
            </div>

            <div>
              <Label htmlFor="rule-description">Описание</Label>
              <Textarea
                id="rule-description"
                rows={2}
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="За что выдаётся достижение"
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="rule-type">Тип достижения</Label>
                <select
                  id="rule-type"
                  className="w-full min-h-[40px] rounded-md border border-input bg-background px-3 text-sm"
                  value={form.type}
                  onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
                >
                  {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>

              <div>
                <Label htmlFor="rule-points">Бонус в баллах *</Label>
                <Input
                  id="rule-points"
                  type="number"
                  min="0"
                  value={form.points}
                  onChange={(e) => setForm((f) => ({ ...f, points: e.target.value === '' ? '' : Number(e.target.value) }))}
                  onBlur={() => setTouched((t) => ({ ...t, points: true }))}
                  aria-invalid={!!showError('points')}
                  aria-describedby="rule-points-hint"
                  className="min-h-[40px]"
                />
                <p id="rule-points-hint" className="mt-1 whitespace-nowrap text-xs text-muted-foreground">
                  Начислим {formatPoints(Number(form.points) || 0)}
                </p>
                {showError('points') && (
                  <p role="alert" className="mt-1 text-xs text-destructive">{showError('points')}</p>
                )}
              </div>

              <div className="sm:col-span-2">
                <Label htmlFor="rule-reason">Причина начисления</Label>
                <select
                  id="rule-reason"
                  className="w-full min-h-[40px] rounded-md border border-input bg-background px-3 text-sm"
                  value={form.reason_code}
                  onChange={(e) => {
                    const reason = activeReasons.find((r) => r.code === e.target.value);
                    setForm((f) => ({
                      ...f,
                      reason_code: e.target.value,
                      // Номинал из справочника подставляем как значение по умолчанию.
                      points: reason?.default_points != null ? reason.default_points : f.points,
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
            </div>

            <ImageUpload
              value={form.image_url}
              path={form.image_path}
              folder="achievements"
              label="Картинка достижения"
              aspect="square"
              hint="Показывается в карточке достижения у сотрудника"
              onChange={({ url, path }) => setForm((f) => ({ ...f, image_url: url, image_path: path }))}
            />

            {/* ------------------------------ автоматическое награждение */}
            <div className="space-y-3 rounded-lg border border-border p-3">
              <label className="flex min-h-[40px] cursor-pointer items-center gap-2 text-sm">
                <Switch
                  checked={form.auto_award}
                  onCheckedChange={(value) => setForm((f) => ({ ...f, auto_award: value }))}
                  aria-label="Автоматическое награждение"
                />
                <span className="font-medium text-foreground">Автоматическое награждение</span>
              </label>
              <p className="text-xs text-muted-foreground">
                Портал сам выдаст достижение и бонус всем, кто попадает под условие, без участия HR.
              </p>

              {form.auto_award && (
                <div className="space-y-3 border-t border-border pt-3">
                  <h3 className="text-sm font-medium text-foreground">Условие награждения</h3>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div>
                      <Label htmlFor="rule-param">Параметр *</Label>
                      <select
                        id="rule-param"
                        className="w-full min-h-[40px] rounded-md border border-input bg-background px-3 text-sm"
                        value={form.param}
                        onChange={(e) => {
                          const param = e.target.value;
                          setPreviewRows(null);
                          // У «дня рождения» порога нет — очищаем значение.
                          setForm((f) => ({ ...f, param, threshold: param === FLAG_PARAM ? '' : f.threshold }));
                        }}
                        onBlur={() => setTouched((t) => ({ ...t, param: true }))}
                        aria-invalid={!!showError('param')}
                      >
                        <option value="">Выберите параметр</option>
                        {Object.entries(ACHIEVEMENT_PARAMS).map(([value, label]) => (
                          <option key={value} value={value}>{label}</option>
                        ))}
                      </select>
                      {showError('param') && (
                        <p role="alert" className="mt-1 text-xs text-destructive">{showError('param')}</p>
                      )}
                    </div>

                    <div>
                      <Label htmlFor="rule-operator">Условие *</Label>
                      <select
                        id="rule-operator"
                        className="w-full min-h-[40px] rounded-md border border-input bg-background px-3 text-sm"
                        value={form.operator}
                        onChange={(e) => {
                          setPreviewRows(null);
                          setForm((f) => ({ ...f, operator: e.target.value }));
                        }}
                        onBlur={() => setTouched((t) => ({ ...t, operator: true }))}
                        aria-invalid={!!showError('operator')}
                        disabled={form.param === FLAG_PARAM}
                      >
                        {Object.entries(COMPARISON_OPERATORS).map(([value, label]) => (
                          <option key={value} value={value}>{label}</option>
                        ))}
                      </select>
                      {showError('operator') && (
                        <p role="alert" className="mt-1 text-xs text-destructive">{showError('operator')}</p>
                      )}
                    </div>

                    {/* У «дня рождения сегодня» порога не бывает — поле скрыто */}
                    {form.param !== FLAG_PARAM && (
                      <div>
                        <Label htmlFor="rule-threshold">Значение *</Label>
                        <Input
                          id="rule-threshold"
                          type="number"
                          value={form.threshold}
                          onChange={(e) => {
                            setPreviewRows(null);
                            setForm((f) => ({ ...f, threshold: e.target.value }));
                          }}
                          onBlur={() => setTouched((t) => ({ ...t, threshold: true }))}
                          placeholder="13"
                          aria-invalid={!!showError('threshold')}
                          className="min-h-[40px]"
                        />
                        {showError('threshold') && (
                          <p role="alert" className="mt-1 text-xs text-destructive">{showError('threshold')}</p>
                        )}
                      </div>
                    )}
                  </div>

                  <p className="text-xs text-muted-foreground">
                    Получится:{' '}
                    <span className="text-foreground">
                      {conditionText({ param: form.param, operator: form.operator, threshold: form.threshold })
                        || 'условие не задано'}
                    </span>
                  </p>

                  {/* ------------------------------------- предпросмотр */}
                  <div className="space-y-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="min-h-[40px]"
                      disabled={!canPreview || preview.isPending}
                      onClick={() => preview.mutate({ param: form.param, operator: form.operator, threshold: form.threshold })}
                    >
                      <Users className="mr-1 h-4 w-4" aria-hidden="true" />
                      {preview.isPending ? 'Считаем…' : 'Кто попадёт под условие'}
                    </Button>

                    {previewRows && (
                      previewRows.length === 0 ? (
                        <p className="rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">
                          Сейчас под условие не попадает ни один сотрудник. Достижение будет выдано,
                          как только у кого-то значение параметра совпадёт с условием.
                        </p>
                      ) : (
                        <div className="rounded-lg border border-border">
                          <p className="border-b border-border px-3 py-2 text-xs text-muted-foreground">
                            Под условие попадает{' '}
                            {pluralize(previewRows.length, 'сотрудник', 'сотрудника', 'сотрудников')}
                          </p>
                          <ul role="list" className="max-h-48 overflow-y-auto">
                            {previewRows.map((row) => (
                              <li
                                key={row.employee_id}
                                role="listitem"
                                className="flex items-center justify-between gap-3 border-b border-border px-3 py-2 text-sm last:border-b-0"
                              >
                                <span className="min-w-0 truncate text-foreground">{row.employee_name}</span>
                                <span className="shrink-0 tabular-nums text-muted-foreground">
                                  {form.param === FLAG_PARAM
                                    ? 'день рождения сегодня'
                                    : formatNumber(row.current_value)}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* ---------------------------------------------- периодичность */}
            <div>
              <Label htmlFor="rule-period">Периодичность</Label>
              <select
                id="rule-period"
                className="w-full min-h-[40px] rounded-md border border-input bg-background px-3 text-sm"
                value={form.period}
                onChange={(e) => setForm((f) => ({ ...f, period: e.target.value }))}
                aria-describedby="rule-period-hint"
              >
                {PERIODS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
              <p id="rule-period-hint" className="mt-1 flex items-start gap-1.5 text-xs text-muted-foreground">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {periodHint} Это защита от повторной выдачи достижения одному и тому же человеку.
              </p>
            </div>

            <label className="flex min-h-[40px] cursor-pointer items-center gap-2 text-sm text-muted-foreground">
              <Switch
                checked={form.is_active}
                onCheckedChange={(value) => setForm((f) => ({ ...f, is_active: value }))}
                aria-label="Правило активно"
              />
              {form.is_active ? 'Правило активно' : 'Правило выключено — проверка его пропустит'}
            </label>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" className="min-h-[40px]" onClick={closeForm}>Отмена</Button>
            <Button className="min-h-[40px]" onClick={submit} disabled={!isValid || save.isPending}>
              {save.isPending ? 'Сохранение…' : editing ? 'Сохранить' : 'Создать правило'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ------------------------------- подтверждение запуска начисления */}
      <Dialog open={!!pendingApply} onOpenChange={(open) => { if (!open) setPendingApply(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Проверить и наградить сейчас?</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2">
                <p>
                  {pendingApply?.rule
                    ? `Правило «${pendingApply.rule.title}» будет применено ко всем работающим сотрудникам прямо сейчас.`
                    : 'Все активные автоправила будут применены ко всем работающим сотрудникам прямо сейчас.'}
                </p>
                <p className="flex items-start gap-2 text-xs">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
                  Достижения будут выданы, а баллы — начислены реально. Отменить начисление
                  можно только вручную: корректировкой в разделе «Операции кошелька».
                </p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" className="min-h-[40px]" onClick={() => setPendingApply(null)}>Отмена</Button>
            <Button
              className="min-h-[40px]"
              disabled={applyRules.isPending}
              onClick={() => applyRules.mutate(pendingApply?.rule || null)}
            >
              {applyRules.isPending ? 'Проверяем…' : 'Проверить и наградить'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ------------------------------------------ подтверждение удаления */}
      <Dialog open={!!pendingDelete} onOpenChange={(open) => { if (!open) setPendingDelete(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Удалить правило?</DialogTitle>
            <DialogDescription>
              {pendingDelete
                ? `Правило «${pendingDelete.title}» будет удалено, и портал перестанет выдавать это достижение автоматически. Ранее выданные достижения и начисленные баллы останутся у сотрудников.`
                : ''}
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
              {remove.isPending ? 'Удаление…' : 'Удалить'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
