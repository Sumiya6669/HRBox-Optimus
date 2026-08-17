import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Calendar, Clock, Info, Pencil, Plus, Trash2, Users, Zap } from 'lucide-react';

import { api } from '@/api/client';
import PageContainer from '@/components/common/PageContainer';
import EmptyState from '@/components/common/EmptyState';
import ErrorState from '@/components/common/ErrorState';
import StatusBadge from '@/components/common/StatusBadge';
import FilterChips from '@/components/common/FilterChips';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { formatDate, formatNumber } from '@/lib/format';
import { statusLabel } from '@/lib/statusLabels';
import { mutationErrorMessage } from '@/lib/dataErrors';

/**
 * Автоматические опросы (таблица auto_surveys).
 *
 * Аудит: раздел был пуст — функционал невозможно было проверить. Здесь полноценный CRUD
 * над правилами автозапуска: опрос, тип триггера, дата/событие, число приглашённых,
 * включение и отметки о запусках (last_run / next_run).
 *
 * ВАЖНО: сам запуск выполняет серверная задача (Supabase Scheduled Functions +
 * функция close_expired_records в БД). Интерфейс только хранит правила — об этом
 * прямо сказано пользователю, чтобы не создавать ложного впечатления, что расписание
 * уже работает само.
 *
 * BUG-051: типы триггеров показываются через StatusBadge, а не кодами schedule/tenure.
 * BUG-072: удаление — через модалку с кнопкой «Отмена».
 */

/** Значения trigger_type из check-ограничения таблицы auto_surveys. */
const TRIGGER_TYPES = ['schedule', 'onboarding', 'birthday', 'tenure', 'monthly_pulse'];

const TRIGGER_HINTS = {
  schedule: 'Разовый запуск в указанную дату.',
  onboarding: 'Запускается, когда в компанию выходит новый сотрудник.',
  birthday: 'Запускается в день рождения сотрудника.',
  tenure: 'Запускается к годовщине приёма на работу.',
  monthly_pulse: 'Повторяется каждый месяц.',
};

const STATE_FILTERS = [
  { value: 'all', label: 'Все' },
  { value: 'active', label: 'Включённые' },
  { value: 'inactive', label: 'Выключенные' },
];

const EMPTY_FORM = {
  survey_id: '',
  trigger_type: 'schedule',
  schedule_date: '',
  trigger_event: '',
  target_count: '',
  active: true,
};

const emptyToNull = (value) => (value === '' || value === undefined ? null : value);

function AutoSurveysSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <Card key={i} className="p-5">
          <div className="h-5 w-32 rounded bg-muted animate-pulse mb-3" />
          <div className="h-5 w-2/3 rounded bg-muted animate-pulse mb-3" />
          <div className="h-3 w-1/2 rounded bg-muted/60 animate-pulse" />
        </Card>
      ))}
    </div>
  );
}

export default function AdminAutoSurveys() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [stateFilter, setStateFilter] = useState('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [errors, setErrors] = useState({});
  const [deleting, setDeleting] = useState(null);

  const rulesQuery = useQuery({
    queryKey: ['auto-surveys'],
    queryFn: () => api.entities.AutoSurvey.list('-created_date'),
  });

  // Правило автозапуска имеет смысл только для активного опроса с вопросами.
  const surveysQuery = useQuery({
    queryKey: ['admin-surveys-for-auto'],
    queryFn: async () => {
      const { data, error } = await api.supabase.from('v_surveys').select('*').order('title');
      if (error) throw error;
      return data || [];
    },
  });

  const rules = rulesQuery.data || [];
  const surveys = surveysQuery.data || [];
  const activeSurveys = surveys.filter((s) => s.effective_status === 'active' && (s.questions_count || 0) > 0);

  const visible = useMemo(() => {
    if (stateFilter === 'all') return rules;
    return rules.filter((r) => (stateFilter === 'active' ? r.active : !r.active));
  }, [rules, stateFilter]);

  const filterOptions = STATE_FILTERS.map((option) => ({
    ...option,
    count:
      option.value === 'all'
        ? rules.length
        : rules.filter((r) => (option.value === 'active' ? r.active : !r.active)).length,
  }));

  const invalidate = () => qc.invalidateQueries({ queryKey: ['auto-surveys'] });

  const errorToast = (title) => (error) =>
    toast({
      variant: 'destructive',
      title,
      description: mutationErrorMessage(error, {
        23514: 'Недопустимый тип триггера — выберите значение из списка',
        23503: 'Выбранный опрос удалён — выберите другой',
        22023: 'Недопустимое значение поля',
      }),
    });

  const save = useMutation({
    mutationFn: ({ id, data }) => {
      const survey = surveys.find((s) => s.id === data.survey_id);
      const payload = {
        survey_id: data.survey_id,
        survey_title: survey?.title || editing?.survey_title || '',
        trigger_type: data.trigger_type,
        // Дата запуска нужна только расписанию, событие — остальным триггерам.
        schedule_date: data.trigger_type === 'schedule' ? emptyToNull(data.schedule_date) : null,
        trigger_event: data.trigger_type === 'schedule' ? null : emptyToNull(data.trigger_event),
        target_count: Number(data.target_count) || 0,
        active: !!data.active,
      };
      return id ? api.entities.AutoSurvey.update(id, payload) : api.entities.AutoSurvey.create(payload);
    },
    onSuccess: (_data, variables) => {
      toast({ title: variables.id ? 'Правило обновлено' : 'Правило создано' });
      invalidate();
      closeDialog();
    },
    onError: errorToast('Не удалось сохранить правило'),
  });

  const toggle = useMutation({
    mutationFn: ({ id, active }) => api.entities.AutoSurvey.update(id, { active }),
    onSuccess: (_data, variables) => {
      toast({ title: variables.active ? 'Правило включено' : 'Правило выключено' });
      invalidate();
    },
    onError: errorToast('Не удалось изменить правило'),
  });

  const remove = useMutation({
    mutationFn: (id) => api.entities.AutoSurvey.delete(id),
    onSuccess: () => {
      toast({ title: 'Правило удалено' });
      invalidate();
      setDeleting(null);
    },
    onError: errorToast('Не удалось удалить правило'),
  });

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setErrors({});
    setDialogOpen(true);
  };

  const openEdit = (rule) => {
    setEditing(rule);
    setForm({
      survey_id: rule.survey_id || '',
      trigger_type: rule.trigger_type || 'schedule',
      schedule_date: rule.schedule_date || '',
      trigger_event: rule.trigger_event || '',
      target_count: rule.target_count === null || rule.target_count === undefined ? '' : String(rule.target_count),
      active: !!rule.active,
    });
    setErrors({});
    setDialogOpen(true);
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setEditing(null);
    setForm(EMPTY_FORM);
    setErrors({});
  };

  const submit = () => {
    const next = {};
    if (!form.survey_id) next.survey_id = 'Выберите опрос';
    // Валидация: расписание без даты запускать нечему.
    if (form.trigger_type === 'schedule' && !form.schedule_date) {
      next.schedule_date = 'Для запуска по расписанию нужна дата';
    }
    const target = Number(form.target_count);
    if (form.target_count !== '' && (!Number.isFinite(target) || target < 0)) {
      next.target_count = 'Число приглашённых не может быть отрицательным';
    }
    setErrors(next);
    if (Object.keys(next).length) return;
    save.mutate({ id: editing?.id, data: form });
  };

  const error = rulesQuery.error || surveysQuery.error;
  const isLoading = rulesQuery.isLoading || surveysQuery.isLoading;

  return (
    <PageContainer
      title="Автоматические опросы"
      description="Правила автозапуска опросов: по дате, при онбординге, ко дню рождения, к годовщине или ежемесячно."
      width="wide"
      actions={
        <Button onClick={openCreate} className="min-h-[40px]">
          <Plus className="w-4 h-4" aria-hidden="true" />
          Создать правило
        </Button>
      }
    >
      {/* Честное объяснение: интерфейс хранит правила, запускает их сервер. */}
      <Card className="mb-5 flex items-start gap-3 border-info/30 bg-info/5 p-4">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-info" aria-hidden="true" />
        <div className="text-sm text-muted-foreground">
          <p className="font-medium text-foreground">Запуск выполняет серверная задача, а не эта страница</p>
          <p className="mt-1">
            Здесь хранятся только правила. Фактический автозапуск и закрытие просроченных опросов делает
            задача по расписанию в Supabase (Scheduled Functions), которая вызывает функцию БД
            <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">close_expired_records</code>.
            Пока задача не настроена администратором, поля «Последний запуск» и «Следующий запуск»
            останутся пустыми.
          </p>
        </div>
      </Card>

      {error ? (
        <ErrorState
          error={error}
          onRetry={() => {
            rulesQuery.refetch();
            surveysQuery.refetch();
          }}
        />
      ) : isLoading ? (
        <AutoSurveysSkeleton />
      ) : (
        <div className="space-y-5">
          <FilterChips
            options={filterOptions}
            value={stateFilter}
            onChange={setStateFilter}
            ariaLabel="Фильтр правил автозапуска"
          />

          {visible.length === 0 ? (
            <EmptyState
              icon={Zap}
              title={rules.length === 0 ? 'Правил автозапуска пока нет' : 'По этому фильтру правил нет'}
              description={
                rules.length === 0
                  ? 'Создайте правило, чтобы опрос запускался автоматически: например, пульс-опрос каждый месяц или анкета новичка при онбординге.'
                  : 'Измените фильтр, чтобы увидеть остальные правила.'
              }
              actionLabel={rules.length === 0 ? 'Создать правило' : undefined}
              onAction={rules.length === 0 ? openCreate : undefined}
            />
          ) : (
            <ul className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" role="list">
              {visible.map((rule) => {
                const survey = surveys.find((s) => s.id === rule.survey_id);
                return (
                  <li key={rule.id} role="listitem">
                    <Card className="flex h-full flex-col p-5">
                      <div className="mb-3 flex flex-wrap items-center gap-2">
                        {/* BUG-051: тип триггера — человекочитаемым бейджем */}
                        <StatusBadge value={rule.trigger_type} />
                        <StatusBadge value={rule.active ? 'active' : 'inactive'} />
                        <div className="flex-1" />
                        <Switch
                          checked={!!rule.active}
                          disabled={toggle.isPending}
                          onCheckedChange={(value) => toggle.mutate({ id: rule.id, active: value })}
                          aria-label={
                            rule.active
                              ? `Выключить правило «${rule.survey_title || ''}»`
                              : `Включить правило «${rule.survey_title || ''}»`
                          }
                        />
                      </div>

                      <h3 className="font-semibold text-foreground">
                        {rule.survey_title || survey?.title || 'Опрос удалён'}
                      </h3>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {TRIGGER_HINTS[rule.trigger_type] || 'Правило автозапуска'}
                      </p>

                      <dl className="mt-3 space-y-1 text-xs text-muted-foreground">
                        {rule.schedule_date && (
                          <div className="flex items-center gap-1.5">
                            <Calendar className="w-3.5 h-3.5" aria-hidden="true" />
                            <dt className="sr-only">Дата запуска</dt>
                            <dd>Запуск {formatDate(rule.schedule_date)}</dd>
                          </div>
                        )}
                        {rule.trigger_event && (
                          <div className="flex items-center gap-1.5">
                            <Zap className="w-3.5 h-3.5" aria-hidden="true" />
                            <dt className="sr-only">Событие</dt>
                            <dd>{rule.trigger_event}</dd>
                          </div>
                        )}
                        <div className="flex items-center gap-1.5">
                          <Users className="w-3.5 h-3.5" aria-hidden="true" />
                          <dt className="sr-only">Приглашённых</dt>
                          <dd>Приглашённых: {formatNumber(rule.target_count || 0)}</dd>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Clock className="w-3.5 h-3.5" aria-hidden="true" />
                          <dt className="sr-only">Последний запуск</dt>
                          <dd>
                            Последний запуск: {rule.last_run ? formatDate(rule.last_run, 'datetime') : 'ещё не выполнялся'}
                          </dd>
                        </div>
                        {rule.next_run && (
                          <div className="flex items-center gap-1.5">
                            <Clock className="w-3.5 h-3.5" aria-hidden="true" />
                            <dt className="sr-only">Следующий запуск</dt>
                            <dd>Следующий запуск: {formatDate(rule.next_run, 'datetime')}</dd>
                          </div>
                        )}
                      </dl>

                      <div className="mt-auto flex items-center gap-1 pt-4 border-t border-border">
                        <Button
                          size="sm"
                          variant="outline"
                          className="min-h-[40px]"
                          onClick={() => openEdit(rule)}
                          aria-label={`Изменить правило «${rule.survey_title || ''}»`}
                        >
                          <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                          Изменить
                        </Button>
                        <div className="flex-1" />
                        <Button
                          size="icon"
                          variant="ghost"
                          className="min-h-[40px] min-w-[40px] text-destructive hover:text-destructive"
                          onClick={() => setDeleting(rule)}
                          aria-label={`Удалить правило «${rule.survey_title || ''}»`}
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
        </div>
      )}

      {/* Создание / редактирование правила */}
      <Dialog open={dialogOpen} onOpenChange={(open) => (open ? setDialogOpen(true) : closeDialog())}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? 'Изменение правила' : 'Новое правило автозапуска'}</DialogTitle>
            <DialogDescription>
              Правило описывает, какой опрос и по какому событию должна запустить серверная задача.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div>
              <Label htmlFor="auto-survey">Опрос *</Label>
              <select
                id="auto-survey"
                className="mt-1 w-full min-h-[40px] rounded-md border border-input bg-transparent px-3 text-sm"
                value={form.survey_id}
                aria-invalid={errors.survey_id ? 'true' : undefined}
                onChange={(e) => setForm({ ...form, survey_id: e.target.value })}
              >
                <option value="">— выберите опрос —</option>
                {activeSurveys.map((s) => (
                  <option key={s.id} value={s.id}>{s.title}</option>
                ))}
                {/* При редактировании опрос мог быть закрыт — оставляем его в списке */}
                {editing?.survey_id && !activeSurveys.some((s) => s.id === editing.survey_id) && (
                  <option value={editing.survey_id}>
                    {editing.survey_title || 'Текущий опрос'} (не активен)
                  </option>
                )}
              </select>
              {activeSurveys.length === 0 && !editing && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Активных опросов с вопросами нет — сначала создайте и активируйте опрос.
                </p>
              )}
              {errors.survey_id && (
                <p role="alert" className="mt-1 text-xs text-destructive">{errors.survey_id}</p>
              )}
            </div>

            <div>
              <Label htmlFor="auto-trigger">Тип триггера *</Label>
              <select
                id="auto-trigger"
                className="mt-1 w-full min-h-[40px] rounded-md border border-input bg-transparent px-3 text-sm"
                value={form.trigger_type}
                onChange={(e) => setForm({ ...form, trigger_type: e.target.value })}
              >
                {TRIGGER_TYPES.map((value) => (
                  <option key={value} value={value}>{statusLabel(value)}</option>
                ))}
              </select>
              <p className="mt-1 text-xs text-muted-foreground">{TRIGGER_HINTS[form.trigger_type]}</p>
            </div>

            {form.trigger_type === 'schedule' ? (
              <div>
                <Label htmlFor="auto-date">Дата запуска *</Label>
                <Input
                  id="auto-date"
                  type="date"
                  className="mt-1 min-h-[40px]"
                  value={form.schedule_date}
                  aria-invalid={errors.schedule_date ? 'true' : undefined}
                  aria-describedby={errors.schedule_date ? 'auto-date-error' : undefined}
                  onChange={(e) => setForm({ ...form, schedule_date: e.target.value })}
                />
                {errors.schedule_date && (
                  <p id="auto-date-error" role="alert" className="mt-1 text-xs text-destructive">
                    {errors.schedule_date}
                  </p>
                )}
              </div>
            ) : (
              <div>
                <Label htmlFor="auto-event">Описание события</Label>
                <Input
                  id="auto-event"
                  className="mt-1 min-h-[40px]"
                  value={form.trigger_event}
                  placeholder="Например: через 30 дней после выхода"
                  onChange={(e) => setForm({ ...form, trigger_event: e.target.value })}
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Подсказка для HR: при каком именно условии серверная задача запустит опрос.
                </p>
              </div>
            )}

            <div>
              <Label htmlFor="auto-target">Сколько сотрудников приглашается</Label>
              <Input
                id="auto-target"
                type="number"
                min="0"
                placeholder="0"
                className="mt-1 min-h-[40px]"
                value={form.target_count}
                aria-invalid={errors.target_count ? 'true' : undefined}
                onChange={(e) => setForm({ ...form, target_count: e.target.value })}
              />
              {errors.target_count && (
                <p role="alert" className="mt-1 text-xs text-destructive">{errors.target_count}</p>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Switch
                id="auto-active"
                checked={form.active}
                onCheckedChange={(value) => setForm({ ...form, active: value })}
                aria-label="Правило включено"
              />
              <Label htmlFor="auto-active" className="text-sm cursor-pointer">
                Правило включено
              </Label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" className="min-h-[40px]" onClick={closeDialog}>
              Отмена
            </Button>
            <Button
              className="min-h-[40px]"
              disabled={
                !form.survey_id ||
                (form.trigger_type === 'schedule' && !form.schedule_date) ||
                save.isPending
              }
              onClick={submit}
            >
              {save.isPending ? 'Сохранение…' : 'Сохранить'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Удаление правила (BUG-072) */}
      <Dialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Удалить правило?</DialogTitle>
            <DialogDescription>
              Правило автозапуска для опроса «{deleting?.survey_title}» будет удалено. Сам опрос и его ответы
              останутся на месте.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" className="min-h-[40px]" onClick={() => setDeleting(null)}>
              Отмена
            </Button>
            <Button
              variant="destructive"
              className="min-h-[40px]"
              disabled={remove.isPending}
              onClick={() => remove.mutate(deleting.id)}
            >
              {remove.isPending ? 'Удаление…' : 'Удалить'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
