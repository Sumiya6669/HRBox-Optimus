import React, { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Target, Plus, Calendar, TrendingUp, Pencil, Trash2, UserX, Minus } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/AuthContext";
import PageContainer from "@/components/common/PageContainer";
import EmptyState from "@/components/common/EmptyState";
import ErrorState from "@/components/common/ErrorState";
import StatusBadge from "@/components/common/StatusBadge";
import { formatDate, formatNumber, isPast } from "@/lib/format";

/**
 * Цели (OKR) сотрудника.
 * BUG-028: тост об успехе — только через useToast (он сам закрывается), без своих таймеров.
 * BUG-029: добавлены редактирование и удаление — раньше цель нельзя было ни изменить, ни убрать.
 * BUG-030: грубый шаг ±25 % заменён вводом прогресса 0–100 с шагом 5; быстрые шаги
 *          отключаются на границах, поэтому «+» не остаётся активным на 100 %.
 * BUG-052: статус показывает только StatusBadge — не бывает пары «completed» + «Завершено».
 * BUG-072: в каждом диалоге есть явная кнопка «Отмена».
 * BUG-025: пустой заголовок блокирует отправку и подсвечивает поле.
 */

const STATUS_FILTERS = [
  { key: "all", label: "Все" },
  { key: "active", label: "В работе" },
  { key: "completed", label: "Завершённые" },
  { key: "draft", label: "Черновики" },
  { key: "cancelled", label: "Отменённые" },
];

const PROGRESS_STEP = 5;
const EMPTY_FORM = { title: "", description: "", type: "objective", deadline: "", status: "active", progress: 0 };

/** Прогресс всегда кратен шагу и лежит в диапазоне 0–100. */
function clampProgress(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, Math.round(n / PROGRESS_STEP) * PROGRESS_STEP));
}

/** Статус выводится из прогресса: 100 % — завершено (производные значения не храним вручную). */
function statusForProgress(progress, current) {
  if (progress >= 100) return "completed";
  if (current === "completed") return "active";
  return current || "active";
}

function GoalsSkeleton() {
  return (
    <div className="space-y-3" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <Card key={i} className="p-4 animate-pulse">
          <div className="h-4 w-48 bg-muted rounded mb-3" />
          <div className="h-3 w-32 bg-muted/60 rounded mb-4" />
          <div className="h-2 w-full bg-muted/60 rounded" />
        </Card>
      ))}
    </div>
  );
}

export default function CabinetGoals() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { employee, employeeId, isLoadingAuth } = useAuth();

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editing, setEditing] = useState(null); // редактируемая цель
  const [editForm, setEditForm] = useState(EMPTY_FORM);
  const [deleting, setDeleting] = useState(null); // цель, подтверждающая удаление
  const [statusFilter, setStatusFilter] = useState("all");

  const queryKey = ["goals-me", employeeId];
  const {
    data: goals,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey,
    queryFn: () => api.entities.Goal.filter({ employee_id: employeeId }, "-created_date"),
    enabled: !!employeeId,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey });

  const create = useMutation({
    mutationFn: (data) => api.entities.Goal.create(data),
    onSuccess: () => {
      toast({ title: "Цель создана" });
      invalidate();
      setCreateOpen(false);
      setForm(EMPTY_FORM);
    },
    onError: (e) => toast({ variant: "destructive", title: "Не удалось создать цель", description: e?.message }),
  });

  const update = useMutation({
    mutationFn: ({ id, patch }) => api.entities.Goal.update(id, patch),
    onSuccess: () => {
      toast({ title: "Цель обновлена" });
      invalidate();
      setEditing(null);
    },
    onError: (e) => toast({ variant: "destructive", title: "Не удалось сохранить цель", description: e?.message }),
  });

  const removeGoal = useMutation({
    mutationFn: (id) => api.entities.Goal.delete(id),
    onSuccess: () => {
      toast({ title: "Цель удалена" });
      invalidate();
      setDeleting(null);
    },
    onError: (e) => toast({ variant: "destructive", title: "Не удалось удалить цель", description: e?.message }),
  });

  const list = useMemo(() => goals || [], [goals]);
  const counts = useMemo(
    () =>
      STATUS_FILTERS.reduce((acc, f) => {
        acc[f.key] = f.key === "all" ? list.length : list.filter((g) => g.status === f.key).length;
        return acc;
      }, {}),
    [list]
  );

  const filtered = list.filter((g) => statusFilter === "all" || g.status === statusFilter);
  const objectives = filtered.filter((g) => g.type !== "key_result");
  const keyResults = filtered.filter((g) => g.type === "key_result");

  const titleError = !form.title.trim() ? "Укажите название цели" : null;
  const editTitleError = !editForm.title.trim() ? "Укажите название цели" : null;

  const submitCreate = (e) => {
    e.preventDefault();
    if (titleError || !employeeId) return;
    create.mutate({
      employee_id: employeeId,
      employee_name: employee?.name || null,
      title: form.title.trim(),
      description: form.description.trim() || null,
      type: form.type,
      deadline: form.deadline || null,
      progress: 0,
      status: "active",
    });
  };

  const openEdit = (goal) => {
    setEditing(goal);
    setEditForm({
      title: goal.title || "",
      description: goal.description || "",
      type: goal.type || "objective",
      deadline: goal.deadline || "",
      status: goal.status || "active",
      progress: clampProgress(goal.progress),
    });
  };

  const submitEdit = (e) => {
    e.preventDefault();
    if (editTitleError || !editing) return;
    const progress = clampProgress(editForm.progress);
    update.mutate({
      id: editing.id,
      patch: {
        title: editForm.title.trim(),
        description: editForm.description.trim() || null,
        type: editForm.type,
        deadline: editForm.deadline || null,
        progress,
        status: progress >= 100 ? "completed" : editForm.status,
      },
    });
  };

  /** Быстрый шаг прогресса прямо на карточке (BUG-030). */
  const stepProgress = (goal, delta) => {
    const progress = clampProgress((goal.progress || 0) + delta);
    if (progress === goal.progress) return;
    update.mutate({ id: goal.id, patch: { progress, status: statusForProgress(progress, goal.status) } });
  };

  const renderGoalCard = (g) => {
    const overdue = g.deadline && g.status !== "completed" && isPast(g.deadline);
    const busy = update.isPending || removeGoal.isPending;
    return (
      <li key={g.id} role="listitem">
        <Card className="p-4">
          <div className="flex items-start justify-between gap-4 mb-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                {/* BUG-052: единственный источник ярлыка статуса */}
                <StatusBadge value={g.status} />
                <StatusBadge value={g.type} variant="outline" />
                {g.deadline && (
                  <span
                    className={cn(
                      "text-xs flex items-center gap-1",
                      overdue ? "text-destructive font-medium" : "text-muted-foreground"
                    )}
                  >
                    <Calendar className="w-3 h-3" aria-hidden="true" />
                    {formatDate(g.deadline)}
                    {overdue && " · просрочена"}
                  </span>
                )}
              </div>
              <h3 className="font-medium text-foreground">{g.title}</h3>
              {g.description && <p className="text-sm text-muted-foreground mt-1">{g.description}</p>}
            </div>
            <div className="flex items-start gap-1 shrink-0">
              <div className="text-2xl font-bold text-foreground mr-2">{formatNumber(g.progress)}%</div>
              <Button
                size="icon"
                variant="ghost"
                aria-label={`Редактировать цель «${g.title}»`}
                onClick={() => openEdit(g)}
                disabled={busy}
              >
                <Pencil className="w-4 h-4" aria-hidden="true" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                aria-label={`Удалить цель «${g.title}»`}
                onClick={() => setDeleting(g)}
                disabled={busy}
              >
                <Trash2 className="w-4 h-4" aria-hidden="true" />
              </Button>
            </div>
          </div>
          <Progress value={g.progress} className="h-2 mb-3" />
          <div className="flex flex-wrap items-center gap-2">
            {/* BUG-030: на границах шага кнопки отключены */}
            <Button
              size="sm"
              variant="outline"
              className="min-h-[40px]"
              onClick={() => stepProgress(g, -PROGRESS_STEP)}
              disabled={busy || (g.progress || 0) <= 0}
              aria-label={`Уменьшить прогресс цели «${g.title}» на ${PROGRESS_STEP}%`}
            >
              <Minus className="w-3.5 h-3.5" aria-hidden="true" />
              {PROGRESS_STEP}%
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="min-h-[40px]"
              onClick={() => stepProgress(g, PROGRESS_STEP)}
              disabled={busy || (g.progress || 0) >= 100}
              aria-label={`Увеличить прогресс цели «${g.title}» на ${PROGRESS_STEP}%`}
            >
              <Plus className="w-3.5 h-3.5" aria-hidden="true" />
              {PROGRESS_STEP}%
            </Button>
            <Button size="sm" variant="ghost" className="min-h-[40px]" onClick={() => openEdit(g)} disabled={busy}>
              Изменить прогресс
            </Button>
          </div>
        </Card>
      </li>
    );
  };

  return (
    <PageContainer
      title="Цели (OKR)"
      description="Ваши цели и ключевые результаты: прогресс, сроки и статус"
      actions={
        <Button onClick={() => setCreateOpen(true)} disabled={!employeeId}>
          <Plus className="w-4 h-4" aria-hidden="true" /> Новая цель
        </Button>
      }
    >
      {!employeeId && !isLoadingAuth ? (
        <EmptyState
          icon={UserX}
          title="Учётная запись не связана с карточкой сотрудника"
          description="Цели привязаны к карточке сотрудника. Обратитесь в HR, чтобы связать учётную запись."
        />
      ) : error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : isLoading || isLoadingAuth ? (
        <GoalsSkeleton />
      ) : list.length === 0 ? (
        <EmptyState
          icon={Target}
          title="Целей пока нет"
          description="Сформулируйте цель на квартал — прогресс можно будет отмечать прямо здесь."
          actionLabel="Создать цель"
          onAction={() => setCreateOpen(true)}
        />
      ) : (
        <div className="space-y-6">
          {/* Фильтр по статусу чипами со счётчиками */}
          <div className="flex items-center gap-2 flex-wrap" role="group" aria-label="Фильтр целей по статусу">
            {STATUS_FILTERS.map((f) => (
              <Button
                key={f.key}
                size="sm"
                variant={statusFilter === f.key ? "default" : "outline"}
                className="min-h-[40px]"
                aria-pressed={statusFilter === f.key}
                onClick={() => setStatusFilter(f.key)}
              >
                {f.label} ({formatNumber(counts[f.key] || 0)})
              </Button>
            ))}
          </div>

          {filtered.length === 0 ? (
            <EmptyState
              icon={Target}
              compact
              title="В этом фильтре целей нет"
              description="Выберите другой статус, чтобы увидеть остальные цели."
              actionLabel="Показать все"
              onAction={() => setStatusFilter("all")}
            />
          ) : (
            <>
              <section>
                <h2 className="font-semibold text-foreground mb-3 flex items-center gap-2">
                  <Target className="w-5 h-5 text-primary" aria-hidden="true" /> Цели
                </h2>
                {objectives.length === 0 ? (
                  <p className="text-sm text-muted-foreground">В выбранном фильтре целей нет.</p>
                ) : (
                  <ul role="list" className="space-y-3">
                    {objectives.map(renderGoalCard)}
                  </ul>
                )}
              </section>

              {keyResults.length > 0 && (
                <section>
                  <h2 className="font-semibold text-foreground mb-3 flex items-center gap-2">
                    <TrendingUp className="w-5 h-5 text-primary" aria-hidden="true" /> Ключевые результаты
                  </h2>
                  <ul role="list" className="space-y-3">
                    {keyResults.map(renderGoalCard)}
                  </ul>
                </section>
              )}
            </>
          )}
        </div>
      )}

      {/* ------------------------------------------------- создание цели */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Новая цель</DialogTitle>
            <DialogDescription>Цель появится в вашем личном кабинете сразу после сохранения.</DialogDescription>
          </DialogHeader>
          <form onSubmit={submitCreate} className="space-y-3" noValidate>
            <div>
              <Label htmlFor="goal-title">Название</Label>
              <Input
                id="goal-title"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="Увеличить продажи на 20 %"
                aria-invalid={!!titleError}
                aria-describedby={titleError ? "goal-title-error" : undefined}
              />
              {/* BUG-025: сообщение рядом с полем, кнопка отправки заблокирована */}
              {titleError && (
                <p id="goal-title-error" role="alert" className="text-xs text-destructive mt-1">
                  {titleError}
                </p>
              )}
            </div>
            <div>
              <Label htmlFor="goal-desc">Описание</Label>
              <Input
                id="goal-desc"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Необязательно"
              />
            </div>
            <div>
              <Label htmlFor="goal-type">Тип</Label>
              <select
                id="goal-type"
                className="w-full min-h-[40px] rounded-md border border-input bg-background px-3 text-sm"
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value })}
              >
                <option value="objective">Цель</option>
                <option value="key_result">Ключевой результат</option>
              </select>
            </div>
            <div>
              <Label htmlFor="goal-deadline">Дедлайн</Label>
              <Input
                id="goal-deadline"
                type="date"
                value={form.deadline}
                onChange={(e) => setForm({ ...form, deadline: e.target.value })}
              />
            </div>
            <DialogFooter className="gap-2">
              {/* BUG-072: явная «Отмена», а не только крестик */}
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                Отмена
              </Button>
              <Button type="submit" disabled={!!titleError || create.isPending}>
                {create.isPending ? "Сохранение…" : "Создать"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ------------------------------------------------- редактирование */}
      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Редактирование цели</DialogTitle>
            <DialogDescription>Измените формулировку, срок или прогресс выполнения.</DialogDescription>
          </DialogHeader>
          <form onSubmit={submitEdit} className="space-y-3" noValidate>
            <div>
              <Label htmlFor="goal-edit-title">Название</Label>
              <Input
                id="goal-edit-title"
                value={editForm.title}
                onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                aria-invalid={!!editTitleError}
                aria-describedby={editTitleError ? "goal-edit-title-error" : undefined}
              />
              {editTitleError && (
                <p id="goal-edit-title-error" role="alert" className="text-xs text-destructive mt-1">
                  {editTitleError}
                </p>
              )}
            </div>
            <div>
              <Label htmlFor="goal-edit-desc">Описание</Label>
              <Input
                id="goal-edit-desc"
                value={editForm.description}
                onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="goal-edit-type">Тип</Label>
                <select
                  id="goal-edit-type"
                  className="w-full min-h-[40px] rounded-md border border-input bg-background px-3 text-sm"
                  value={editForm.type}
                  onChange={(e) => setEditForm({ ...editForm, type: e.target.value })}
                >
                  <option value="objective">Цель</option>
                  <option value="key_result">Ключевой результат</option>
                </select>
              </div>
              <div>
                <Label htmlFor="goal-edit-status">Статус</Label>
                <select
                  id="goal-edit-status"
                  className="w-full min-h-[40px] rounded-md border border-input bg-background px-3 text-sm"
                  value={editForm.status}
                  onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}
                >
                  <option value="draft">Черновик</option>
                  <option value="active">В работе</option>
                  <option value="completed">Завершено</option>
                  <option value="cancelled">Отменено</option>
                </select>
              </div>
            </div>
            <div>
              <Label htmlFor="goal-edit-deadline">Дедлайн</Label>
              <Input
                id="goal-edit-deadline"
                type="date"
                value={editForm.deadline}
                onChange={(e) => setEditForm({ ...editForm, deadline: e.target.value })}
              />
            </div>
            {/* BUG-030: ввод прогресса 0–100 с шагом 5 вместо жёсткого ±25 % */}
            <div>
              <Label htmlFor="goal-edit-progress">Прогресс, %</Label>
              <div className="flex items-center gap-3">
                <input
                  id="goal-edit-progress"
                  type="range"
                  min={0}
                  max={100}
                  step={PROGRESS_STEP}
                  value={editForm.progress}
                  onChange={(e) => setEditForm({ ...editForm, progress: clampProgress(e.target.value) })}
                  className="flex-1 accent-primary"
                  aria-label="Прогресс выполнения цели в процентах"
                />
                <Input
                  type="number"
                  min={0}
                  max={100}
                  step={PROGRESS_STEP}
                  value={editForm.progress}
                  onChange={(e) => setEditForm({ ...editForm, progress: clampProgress(e.target.value) })}
                  className="w-24"
                  aria-label="Прогресс выполнения цели, число от 0 до 100"
                />
              </div>
            </div>
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={() => setEditing(null)}>
                Отмена
              </Button>
              <Button type="submit" disabled={!!editTitleError || update.isPending}>
                {update.isPending ? "Сохранение…" : "Сохранить"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ------------------------------------------------- удаление */}
      <Dialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Удалить цель?</DialogTitle>
            <DialogDescription>
              Цель «{deleting?.title}» будет удалена безвозвратно вместе с её прогрессом.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => setDeleting(null)}>
              Отмена
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => removeGoal.mutate(deleting.id)}
              disabled={removeGoal.isPending}
            >
              {removeGoal.isPending ? "Удаление…" : "Удалить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
