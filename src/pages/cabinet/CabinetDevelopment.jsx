import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Award, CalendarDays, Pencil, Plus, Target, Trash2, TrendingUp, User } from 'lucide-react';

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
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/lib/AuthContext';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * Развитие компетенций (таблица development_plans).
 * BUG-074: у пустых состояний был разнобой в текстах — теперь общий EmptyState.
 * BUG-051: уровни novice/intermediate/advanced/expert выводит StatusBadge, а не английский код.
 * Аудит: модуль дублировал «Цели» — здесь только компетенции и планы развития,
 * OKR живут в разделе «Цели» (ссылка в шапке).
 */

const LEVELS = ['novice', 'intermediate', 'advanced', 'expert'];
const LEVEL_LABELS = {
  novice: 'Начальный',
  intermediate: 'Средний',
  advanced: 'Продвинутый',
  expert: 'Экспертный',
};

const STATUSES = ['active', 'completed', 'paused'];

const EMPTY_FORM = {
  title: '',
  competency: '',
  current_level: 'novice',
  target_level: 'intermediate',
  deadline: '',
  mentor: '',
  notes: '',
};

function PlansSkeleton() {
  return (
    <div className="space-y-3" aria-hidden="true">
      {[0, 1].map((i) => (
        <Card key={i} className="p-5 space-y-3">
          <div className="h-5 w-1/3 rounded bg-muted animate-pulse" />
          <div className="h-3 w-1/4 rounded bg-muted/60 animate-pulse" />
          <div className="h-2 w-full rounded bg-muted/60 animate-pulse" />
        </Card>
      ))}
    </div>
  );
}

export default function CabinetDevelopment() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { user, employeeId, isLoadingAuth } = useAuth();

  const [editing, setEditing] = useState(null); // null | 'new' | план
  const [form, setForm] = useState(EMPTY_FORM);
  const [touched, setTouched] = useState({});
  const [pendingDelete, setPendingDelete] = useState(null);
  const [status, setStatus] = useState('all');

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['cabinet-development', employeeId],
    queryFn: () => api.entities.DevelopmentPlan.filter({ employee_id: employeeId }, '-created_date'),
    enabled: !!employeeId,
  });

  const plans = data || [];

  const errors = useMemo(() => {
    const acc = {};
    if (!form.title.trim()) acc.title = 'Укажите название плана развития';
    if (!form.competency.trim()) acc.competency = 'Укажите компетенцию, которую развиваете';
    if (form.deadline && Number.isNaN(new Date(form.deadline).getTime())) acc.deadline = 'Некорректная дата';
    if (LEVELS.indexOf(form.target_level) <= LEVELS.indexOf(form.current_level)) {
      acc.target_level = 'Целевой уровень должен быть выше текущего';
    }
    return acc;
  }, [form]);

  const isValid = Object.keys(errors).length === 0;

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        title: form.title.trim(),
        competency: form.competency.trim(),
        current_level: form.current_level,
        target_level: form.target_level,
        deadline: form.deadline || null,
        mentor: form.mentor.trim() || null,
        notes: form.notes.trim() || null,
      };
      if (editing === 'new') {
        return api.entities.DevelopmentPlan.create({
          ...payload,
          employee_id: employeeId,
          employee_name: user?.full_name || null,
          progress: 0,
          status: 'active',
        });
      }
      return api.entities.DevelopmentPlan.update(editing.id, payload);
    },
    onSuccess: () => {
      toast({ title: editing === 'new' ? 'План развития добавлен' : 'План развития обновлён' });
      qc.invalidateQueries({ queryKey: ['cabinet-development', employeeId] });
      closeDialog();
    },
    onError: (e) => toast({ variant: 'destructive', title: 'Не удалось сохранить план', description: e?.message }),
  });

  const updateProgress = useMutation({
    mutationFn: ({ id, progress }) =>
      api.entities.DevelopmentPlan.update(id, {
        progress,
        status: progress >= 100 ? 'completed' : 'active',
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cabinet-development', employeeId] }),
    onError: (e) => toast({ variant: 'destructive', title: 'Не удалось обновить прогресс', description: e?.message }),
  });

  const remove = useMutation({
    mutationFn: (id) => api.entities.DevelopmentPlan.delete(id),
    onSuccess: () => {
      toast({ title: 'План развития удалён' });
      qc.invalidateQueries({ queryKey: ['cabinet-development', employeeId] });
      setPendingDelete(null);
    },
    onError: (e) => toast({ variant: 'destructive', title: 'Не удалось удалить план', description: e?.message }),
  });

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setTouched({});
    setEditing('new');
  };

  const openEdit = (plan) => {
    setForm({
      title: plan.title || '',
      competency: plan.competency || '',
      current_level: plan.current_level || 'novice',
      target_level: plan.target_level || 'intermediate',
      deadline: plan.deadline ? formatDate(plan.deadline, 'iso') : '',
      mentor: plan.mentor || '',
      notes: plan.notes || '',
    });
    setTouched({});
    setEditing(plan);
  };

  const closeDialog = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setTouched({});
  };

  const submit = (event) => {
    event.preventDefault();
    setTouched({ title: true, competency: true, target_level: true, deadline: true });
    if (!isValid) return;
    save.mutate();
  };

  const showError = (field) => (touched[field] ? errors[field] : undefined);

  const counts = useMemo(() => {
    const acc = { all: plans.length };
    for (const s of STATUSES) acc[s] = plans.filter((p) => p.status === s).length;
    return acc;
  }, [plans]);

  const visible = status === 'all' ? plans : plans.filter((p) => p.status === status);

  const filterOptions = [
    { value: 'all', label: 'Все', count: counts.all },
    ...STATUSES.filter((s) => counts[s] > 0).map((s) => ({
      value: s,
      label: { active: 'В работе', completed: 'Завершённые', paused: 'На паузе' }[s],
      count: counts[s],
    })),
  ];

  return (
    <PageContainer
      title="Развитие"
      description="Компетенции и индивидуальные планы развития: что осваиваете, с каким наставником и к какому сроку."
      actions={
        <Button onClick={openCreate} disabled={!employeeId}>
          <Plus className="w-4 h-4" aria-hidden="true" />
          Новый план развития
        </Button>
      }
    >
      {/* Разведение модулей: здесь компетенции, OKR — в «Целях». */}
      <Card className="p-4 mb-6 flex flex-wrap items-center gap-3 bg-muted/50">
        <Target className="w-5 h-5 text-primary shrink-0" aria-hidden="true" />
        <p className="text-sm text-muted-foreground flex-1 min-w-[220px]">
          Здесь — только развитие компетенций (уровень «сейчас» → «цель», наставник, срок).
          Рабочие цели и ключевые результаты (OKR) ведутся в отдельном разделе.
        </p>
        <Button asChild variant="outline" size="sm">
          <Link to="/cabinet/goals">Перейти к целям</Link>
        </Button>
      </Card>

      {error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : isLoadingAuth || (!!employeeId && isLoading) ? (
        <PlansSkeleton />
      ) : !employeeId ? (
        <EmptyState
          icon={TrendingUp}
          title="Учётная запись не связана с карточкой сотрудника"
          description="План развития ведётся по карточке сотрудника. Попросите HR-специалиста связать вашу учётную запись."
        />
      ) : plans.length === 0 ? (
        <EmptyState
          icon={TrendingUp}
          title="Планов развития пока нет"
          description="Добавьте первую компетенцию: укажите текущий и целевой уровень, наставника и срок — прогресс будет виден вам и руководителю."
          actionLabel="Новый план развития"
          onAction={openCreate}
        />
      ) : (
        <>
          <FilterChips
            options={filterOptions}
            value={status}
            onChange={setStatus}
            ariaLabel="Фильтр планов развития по статусу"
            className="mb-4"
          />

          {visible.length === 0 ? (
            <EmptyState
              title="В этом статусе планов нет"
              description="Снимите фильтр, чтобы увидеть все планы развития."
              actionLabel="Показать все"
              onAction={() => setStatus('all')}
              compact
            />
          ) : (
            <ul className="space-y-3" role="list">
              {visible.map((plan) => (
                <li key={plan.id} role="listitem">
                  <Card className="p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
                      <div className="min-w-0">
                        <h3 className="font-semibold text-foreground">{plan.title}</h3>
                        {plan.competency && (
                          <p className="text-sm text-muted-foreground mt-0.5 flex items-center gap-1">
                            <Target className="w-3.5 h-3.5" aria-hidden="true" />
                            {plan.competency}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <StatusBadge value={plan.status} />
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Изменить план «${plan.title}»`}
                          onClick={() => openEdit(plan)}
                        >
                          <Pencil className="w-4 h-4" aria-hidden="true" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Удалить план «${plan.title}»`}
                          onClick={() => setPendingDelete(plan)}
                        >
                          <Trash2 className="w-4 h-4 text-destructive" aria-hidden="true" />
                        </Button>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 mb-3">
                      {/* BUG-051: уровни — человекочитаемыми бейджами. */}
                      <StatusBadge value={plan.current_level} />
                      <span className="text-muted-foreground" aria-hidden="true">→</span>
                      <StatusBadge value={plan.target_level} />
                      {plan.mentor && (
                        <span className="text-xs text-muted-foreground flex items-center gap-1 ml-1">
                          <User className="w-3 h-3" aria-hidden="true" />
                          {plan.mentor}
                        </span>
                      )}
                      {plan.deadline && (
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <CalendarDays className="w-3 h-3" aria-hidden="true" />
                          до {formatDate(plan.deadline)}
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                      <Progress
                        value={plan.progress || 0}
                        className="flex-1 min-w-[140px]"
                        aria-label={`Прогресс: ${plan.progress || 0}%`}
                      />
                      <span className="text-sm font-semibold text-foreground tabular-nums w-12 text-right">
                        {plan.progress || 0}%
                      </span>
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          aria-label="Уменьшить прогресс на 10%"
                          disabled={updateProgress.isPending || (plan.progress || 0) <= 0}
                          onClick={() => updateProgress.mutate({ id: plan.id, progress: Math.max(0, (plan.progress || 0) - 10) })}
                        >
                          −10%
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          aria-label="Увеличить прогресс на 10%"
                          disabled={updateProgress.isPending || (plan.progress || 0) >= 100}
                          onClick={() => updateProgress.mutate({ id: plan.id, progress: Math.min(100, (plan.progress || 0) + 10) })}
                        >
                          +10%
                        </Button>
                      </div>
                    </div>

                    {plan.notes && <p className="text-xs text-muted-foreground mt-3 whitespace-pre-line">{plan.notes}</p>}

                    {plan.status === 'completed' && (
                      <p className="mt-3 flex items-center gap-2 text-sm text-success">
                        <Award className="w-4 h-4" aria-hidden="true" />
                        Компетенция освоена до уровня «{LEVEL_LABELS[plan.target_level] || plan.target_level}»
                      </p>
                    )}
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {/* Создание и редактирование */}
      <Dialog open={!!editing} onOpenChange={(next) => (next ? null : closeDialog())}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing === 'new' ? 'Новый план развития' : 'Изменить план развития'}</DialogTitle>
            <DialogDescription>
              Опишите компетенцию и цель по уровню — прогресс можно отмечать шагами по 10 %.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={submit} noValidate className="space-y-3">
            <div>
              <Label htmlFor="plan-title">Название <span className="text-destructive" aria-hidden="true">*</span></Label>
              <Input
                id="plan-title"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                onBlur={() => setTouched((t) => ({ ...t, title: true }))}
                placeholder="Например: научиться вести переговоры с сетевыми клиентами"
                aria-invalid={showError('title') ? 'true' : undefined}
                aria-describedby={showError('title') ? 'plan-title-error' : undefined}
                className={cn('min-h-[40px]', showError('title') && 'border-destructive')}
              />
              {showError('title') && (
                <p id="plan-title-error" role="alert" className="mt-1 text-sm text-destructive">{errors.title}</p>
              )}
            </div>

            <div>
              <Label htmlFor="plan-competency">Компетенция <span className="text-destructive" aria-hidden="true">*</span></Label>
              <Input
                id="plan-competency"
                value={form.competency}
                onChange={(e) => setForm({ ...form, competency: e.target.value })}
                onBlur={() => setTouched((t) => ({ ...t, competency: true }))}
                placeholder="Например: продуктовые знания"
                aria-invalid={showError('competency') ? 'true' : undefined}
                aria-describedby={showError('competency') ? 'plan-competency-error' : undefined}
                className={cn('min-h-[40px]', showError('competency') && 'border-destructive')}
              />
              {showError('competency') && (
                <p id="plan-competency-error" role="alert" className="mt-1 text-sm text-destructive">{errors.competency}</p>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label htmlFor="plan-current">Текущий уровень</Label>
                <select
                  id="plan-current"
                  className="w-full min-h-[40px] rounded-md border border-input bg-transparent px-3 text-sm"
                  value={form.current_level}
                  onChange={(e) => setForm({ ...form, current_level: e.target.value })}
                >
                  {LEVELS.map((level) => (
                    <option key={level} value={level}>{LEVEL_LABELS[level]}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="plan-target">Целевой уровень</Label>
                <select
                  id="plan-target"
                  className={cn(
                    'w-full min-h-[40px] rounded-md border border-input bg-transparent px-3 text-sm',
                    showError('target_level') && 'border-destructive'
                  )}
                  value={form.target_level}
                  onChange={(e) => setForm({ ...form, target_level: e.target.value })}
                  onBlur={() => setTouched((t) => ({ ...t, target_level: true }))}
                  aria-invalid={showError('target_level') ? 'true' : undefined}
                  aria-describedby={showError('target_level') ? 'plan-target-error' : undefined}
                >
                  {LEVELS.map((level) => (
                    <option key={level} value={level}>{LEVEL_LABELS[level]}</option>
                  ))}
                </select>
                {showError('target_level') && (
                  <p id="plan-target-error" role="alert" className="mt-1 text-sm text-destructive">{errors.target_level}</p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label htmlFor="plan-deadline">Срок</Label>
                <Input
                  id="plan-deadline"
                  type="date"
                  value={form.deadline}
                  onChange={(e) => setForm({ ...form, deadline: e.target.value })}
                  className="min-h-[40px]"
                />
              </div>
              <div>
                <Label htmlFor="plan-mentor">Наставник</Label>
                <Input
                  id="plan-mentor"
                  value={form.mentor}
                  onChange={(e) => setForm({ ...form, mentor: e.target.value })}
                  placeholder="ФИО наставника"
                  className="min-h-[40px]"
                />
              </div>
            </div>

            <div>
              <Label htmlFor="plan-notes">Заметки</Label>
              <Textarea
                id="plan-notes"
                rows={3}
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Шаги, материалы, договорённости с наставником"
              />
            </div>

            <DialogFooter className="gap-2">
              {/* BUG-072: явная кнопка «Отмена». */}
              <Button type="button" variant="outline" onClick={closeDialog}>Отмена</Button>
              <Button type="submit" disabled={!isValid || save.isPending}>
                {save.isPending ? 'Сохранение…' : 'Сохранить'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Подтверждение удаления */}
      <Dialog open={!!pendingDelete} onOpenChange={(next) => (next ? null : setPendingDelete(null))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Удалить план развития?</DialogTitle>
            <DialogDescription>
              План «{pendingDelete?.title}» будет удалён безвозвратно вместе с отмеченным прогрессом.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => setPendingDelete(null)}>Отмена</Button>
            <Button
              type="button"
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => remove.mutate(pendingDelete.id)}
            >
              {remove.isPending ? 'Удаление…' : 'Удалить'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
