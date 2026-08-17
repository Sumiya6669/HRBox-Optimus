import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { createEntity } from '@/api/entity';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Check, X, CalendarDays, AlertTriangle, Users, ListChecks } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import PageContainer from '@/components/common/PageContainer';
import EmptyState from '@/components/common/EmptyState';
import ErrorState from '@/components/common/ErrorState';
import StatusBadge from '@/components/common/StatusBadge';
import FilterChips from '@/components/common/FilterChips';
import { useAuth } from '@/lib/AuthContext';
import { formatDateRange, formatDate, formatNumber, leaveDays, pluralize } from '@/lib/format';
import { mutationErrorMessage } from '@/lib/dataErrors';
import { cn } from '@/lib/utils';

/**
 * График отпусков — согласование заявок HR-отделом.
 *
 * BUG-016: «3 заявки в обзоре против 7 в модуле» — метрики теперь подписаны явно
 *          (Ожидают согласования / Согласовано / Отклонено / Всего).
 * BUG-017: один период показывался как «8 дн.» и «7 дн.». Длительность считает
 *          только leaveDays(start, end); в БД это генерируемая колонка days.
 * BUG-041: заявки висели «Ожидает» неделями. Читаем вьюху v_leave_requests
 *          (is_overdue, age_days): просроченные помечаются и поднимаются наверх,
 *          есть фильтр «Только просроченные».
 * Аудит: безымянная кнопка «×» заменена на кнопку с aria-label и подтверждением
 *        с обязательной причиной; добавлены массовое согласование и проверка
 *        пересечений отпусков внутри отдела.
 */

const leaveView = createEntity('v_leave_requests', { defaultSort: '-created_date' });

const STATUS_FILTERS = [
  { value: 'pending', label: 'Ожидают согласования' },
  { value: 'approved', label: 'Согласовано' },
  { value: 'rejected', label: 'Отклонено' },
  { value: 'all', label: 'Все заявки' },
];

function SkeletonBlock() {
  return (
    <div className="space-y-4" aria-hidden="true">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <div key={i} className="h-24 animate-pulse rounded-xl bg-muted" />)}
      </div>
      {[0, 1, 2, 3].map((i) => <div key={i} className="h-24 animate-pulse rounded-xl bg-muted" />)}
    </div>
  );
}

export default function AdminVacation() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { user } = useAuth();

  const [statusFilter, setStatusFilter] = useState('pending');
  const [onlyOverdue, setOnlyOverdue] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [rejectTarget, setRejectTarget] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [approveTarget, setApproveTarget] = useState(null); // одиночное согласование с проверкой пересечений
  const [bulkOpen, setBulkOpen] = useState(false);

  const leavesQuery = useQuery({
    queryKey: ['admin-leaves'],
    queryFn: () => leaveView.list('-created_date', 1000),
  });

  const employeesQuery = useQuery({ queryKey: ['employees'], queryFn: () => api.entities.Employee.list('name') });

  const empMap = useMemo(
    () => new Map((employeesQuery.data || []).map((e) => [e.id, e])),
    [employeesQuery.data]
  );

  const leaves = leavesQuery.data || [];

  // BUG-016: явные, а не догадливые подписи метрик.
  const stats = useMemo(() => ({
    pending: leaves.filter((l) => l.status === 'pending').length,
    approved: leaves.filter((l) => l.status === 'approved').length,
    rejected: leaves.filter((l) => l.status === 'rejected').length,
    overdue: leaves.filter((l) => l.is_overdue).length,
    total: leaves.length,
  }), [leaves]);

  const visible = useMemo(() => {
    const list = leaves.filter((l) => {
      if (statusFilter !== 'all' && l.status !== statusFilter) return false;
      if (onlyOverdue && !l.is_overdue) return false;
      return true;
    });
    // BUG-041: просроченные всегда сверху, дальше — по давности заявки.
    return [...list].sort((a, b) => {
      if (!!b.is_overdue !== !!a.is_overdue) return b.is_overdue ? 1 : -1;
      return (b.age_days || 0) - (a.age_days || 0);
    });
  }, [leaves, statusFilter, onlyOverdue]);

  const pendingVisible = visible.filter((l) => l.status === 'pending');
  const selectedList = pendingVisible.filter((l) => selected.has(l.id));

  const toggleSelected = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected((prev) =>
      prev.size === pendingVisible.length ? new Set() : new Set(pendingVisible.map((l) => l.id))
    );
  };

  const decide = useMutation({
    mutationFn: async ({ ids, status, reason }) => {
      const list = Array.isArray(ids) ? ids : [ids];
      for (const id of list) {
        const request = leaves.find((l) => l.id === id);
        const patch = {
          status,
          approver_id: user?.id || null,
          approver_name: user?.full_name || user?.email || 'HR-отдел',
          decided_at: new Date().toISOString(),
        };
        // Отдельной колонки под причину отказа в схеме нет — дописываем её в notes
        // отмеченным блоком, чтобы сотрудник увидел причину в своей заявке.
        if (status === 'rejected' && reason) {
          patch.notes = [request?.notes, `Причина отклонения: ${reason}`].filter(Boolean).join('\n\n');
        }
        await api.entities.LeaveRequest.update(id, patch);
      }
      return list.length;
    },
    onSuccess: (count, vars) => {
      toast({
        title: vars.status === 'approved'
          ? `Согласовано заявок: ${formatNumber(count)}`
          : `Отклонено заявок: ${formatNumber(count)}`,
      });
      qc.invalidateQueries({ queryKey: ['admin-leaves'] });
      setSelected(new Set());
      setRejectTarget(null);
      setRejectReason('');
      setApproveTarget(null);
      setBulkOpen(false);
    },
    onError: (e) => toast({
      title: 'Не удалось изменить статус заявки',
      description: mutationErrorMessage(e, {
        42501: 'Согласовывать отпуска могут руководитель, HR-специалист и администратор.',
      }),
      variant: 'destructive',
    }),
  });

  /**
   * Топ-1 функция из аудита: перед согласованием показываем, кто из того же отдела
   * уже в отпуске в эти даты. Пересечение считает БД: start_date <= end и end_date >= start.
   */
  const overlapQuery = useQuery({
    queryKey: ['leave-overlaps', approveTarget?.id],
    enabled: !!approveTarget,
    queryFn: async () => {
      const { data, error } = await api.supabase
        .from('leave_requests')
        .select('id, employee_id, employee_name, start_date, end_date, type')
        .eq('status', 'approved')
        .lte('start_date', approveTarget.end_date)
        .gte('end_date', approveTarget.start_date);
      if (error) throw error;
      const targetDept = empMap.get(approveTarget.employee_id)?.department_id ?? null;
      return (data || []).filter((row) => {
        if (row.employee_id === approveTarget.employee_id) return false;
        const dept = empMap.get(row.employee_id)?.department_id ?? null;
        return targetDept !== null && dept === targetDept;
      });
    },
  });

  const employeeDepartment = (id) => empMap.get(id)?.department || null;

  const error = leavesQuery.error;
  const isLoading = leavesQuery.isPending;

  return (
    <PageContainer
      title="График отпусков"
      description="Согласование заявок на отпуск, больничный и отгулы"
      width="wide"
    >
      {error ? (
        <ErrorState error={error} onRetry={leavesQuery.refetch} />
      ) : isLoading ? (
        <SkeletonBlock />
      ) : (
        <div className="space-y-5">
          {/* BUG-016: метрики с однозначными подписями */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              { key: 'pending', label: 'Ожидают согласования', value: stats.pending, tone: 'text-warning', filter: 'pending' },
              { key: 'approved', label: 'Согласовано', value: stats.approved, tone: 'text-success', filter: 'approved' },
              { key: 'rejected', label: 'Отклонено', value: stats.rejected, tone: 'text-destructive', filter: 'rejected' },
              { key: 'total', label: 'Всего заявок', value: stats.total, tone: 'text-foreground', filter: 'all' },
            ].map((card) => (
              <Card key={card.key} className="p-0">
                <button
                  type="button"
                  onClick={() => { setStatusFilter(card.filter); setOnlyOverdue(false); }}
                  aria-pressed={statusFilter === card.filter && !onlyOverdue}
                  className={cn(
                    'flex min-h-[40px] w-full flex-col items-start rounded-xl p-4 text-left transition hover:bg-muted/50',
                    statusFilter === card.filter && !onlyOverdue && 'ring-2 ring-primary ring-offset-2 ring-offset-background'
                  )}
                >
                  <span className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                    <CalendarDays className="h-4 w-4" aria-hidden="true" /> {card.label}
                  </span>
                  <span className={cn('text-2xl font-bold', card.tone)}>{formatNumber(card.value)}</span>
                </button>
              </Card>
            ))}
          </div>

          {/* Фильтры */}
          <div className="flex flex-wrap items-center gap-2">
            <FilterChips
              ariaLabel="Фильтр по статусу заявки"
              value={statusFilter}
              onChange={setStatusFilter}
              options={STATUS_FILTERS.map((f) => ({
                ...f,
                count: f.value === 'all' ? stats.total : stats[f.value],
              }))}
            />
            {/* BUG-041 */}
            <Button
              type="button"
              size="sm"
              variant={onlyOverdue ? 'destructive' : 'outline'}
              aria-pressed={onlyOverdue}
              onClick={() => setOnlyOverdue((v) => !v)}
              className="min-h-[40px]"
            >
              <AlertTriangle className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
              Только просроченные ({formatNumber(stats.overdue)})
            </Button>
          </div>

          {/* Панель массовых действий */}
          {!!pendingVisible.length && (
            <Card className="flex flex-wrap items-center gap-3 p-3">
              <label className="flex min-h-[40px] cursor-pointer items-center gap-2 text-sm">
                <Checkbox
                  checked={selected.size > 0 && selected.size === pendingVisible.length}
                  onCheckedChange={toggleAll}
                  aria-label="Выбрать все заявки на странице"
                />
                Выбрать все ожидающие ({formatNumber(pendingVisible.length)})
              </label>
              <span className="text-sm text-muted-foreground">
                Выбрано: {formatNumber(selectedList.length)}
              </span>
              <div className="ml-auto flex gap-2">
                <Button
                  size="sm"
                  className="min-h-[40px]"
                  disabled={!selectedList.length || decide.isPending}
                  onClick={() => setBulkOpen(true)}
                >
                  <ListChecks className="mr-1 h-4 w-4" aria-hidden="true" /> Согласовать выбранные
                </Button>
              </div>
            </Card>
          )}

          {/* Список заявок */}
          {!visible.length ? (
            <EmptyState
              icon={CalendarDays}
              title="Заявок нет"
              description={
                onlyOverdue
                  ? 'Просроченных заявок нет — все обращения обработаны в срок.'
                  : 'Под выбранный фильтр не попала ни одна заявка на отпуск.'
              }
              actionLabel="Показать все заявки"
              onAction={() => { setStatusFilter('all'); setOnlyOverdue(false); }}
            />
          ) : (
            <ul role="list" className="space-y-2">
              {visible.map((l) => (
                <li key={l.id} role="listitem">
                  <Card className={cn('flex flex-wrap items-center gap-4 p-4', l.is_overdue && 'border-destructive/40 bg-destructive/5')}>
                    {l.status === 'pending' && (
                      <Checkbox
                        checked={selected.has(l.id)}
                        onCheckedChange={() => toggleSelected(l.id)}
                        aria-label={`Выбрать заявку сотрудника ${l.employee_name}`}
                      />
                    )}
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent" aria-hidden="true">
                      <CalendarDays className="h-5 w-5 text-primary" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-foreground">{l.employee_name}</span>
                        {/* BUG-«Отпуск / По семейным»: тип — enum схемы через StatusBadge */}
                        <StatusBadge value={l.type} />
                        <StatusBadge value={l.status} />
                        {l.is_overdue && (
                          <Badge variant="destructive" className="gap-1">
                            <AlertTriangle className="h-3 w-3" aria-hidden="true" /> Просрочено
                          </Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {/* BUG-017: длительность только через leaveDays */}
                        {formatDateRange(l.start_date, l.end_date)} ·{' '}
                        {pluralize(leaveDays(l.start_date, l.end_date), 'календарный день', 'календарных дня', 'календарных дней')}
                        {employeeDepartment(l.employee_id) ? ` · ${employeeDepartment(l.employee_id)}` : ''}
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        Подана {formatDate(l.created_date)}
                        {l.age_days > 0 ? ` · ${pluralize(l.age_days, 'день', 'дня', 'дней')} в работе` : ''}
                        {l.approver_name && l.status !== 'pending' ? ` · решение: ${l.approver_name}` : ''}
                      </div>
                      {l.notes && <p className="mt-1 whitespace-pre-line text-xs text-muted-foreground">{l.notes}</p>}
                    </div>
                    {l.status === 'pending' && (
                      <div className="flex shrink-0 gap-2">
                        <Button
                          size="sm"
                          className="min-h-[40px]"
                          aria-label={`Согласовать заявку сотрудника ${l.employee_name}`}
                          onClick={() => setApproveTarget(l)}
                        >
                          <Check className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Согласовать
                        </Button>
                        {/* Раньше здесь был безымянный «×» без подсказки */}
                        <Button
                          size="sm"
                          variant="outline"
                          className="min-h-[40px]"
                          aria-label="Отклонить заявку"
                          onClick={() => { setRejectTarget(l); setRejectReason(''); }}
                        >
                          <X className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Отклонить
                        </Button>
                      </div>
                    )}
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Согласование одной заявки с проверкой пересечений */}
      <Dialog open={!!approveTarget} onOpenChange={(v) => !v && setApproveTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Согласовать заявку?</DialogTitle>
            <DialogDescription>
              {approveTarget && (
                <>
                  {approveTarget.employee_name} · {formatDateRange(approveTarget.start_date, approveTarget.end_date)} ·{' '}
                  {pluralize(leaveDays(approveTarget.start_date, approveTarget.end_date), 'календарный день', 'календарных дня', 'календарных дней')}
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <h3 className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
              <Users className="h-4 w-4 text-muted-foreground" aria-hidden="true" /> Пересечения внутри отдела
            </h3>
            {overlapQuery.isPending ? (
              <div className="h-16 animate-pulse rounded-lg bg-muted" aria-hidden="true" />
            ) : overlapQuery.error ? (
              <ErrorState error={overlapQuery.error} onRetry={overlapQuery.refetch} compact />
            ) : !overlapQuery.data?.length ? (
              <p className="rounded-lg bg-success/10 p-3 text-sm text-foreground">
                В эти даты никто из отдела не в отпуске — конфликтов нет.
              </p>
            ) : (
              <div className="rounded-lg bg-warning/10 p-3">
                <p className="mb-2 text-sm font-medium text-foreground">
                  В эти даты уже в отпуске: {pluralize(overlapQuery.data.length, 'сотрудник', 'сотрудника', 'сотрудников')}
                </p>
                <ul role="list" className="space-y-1">
                  {overlapQuery.data.map((o) => (
                    <li key={o.id} role="listitem" className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">{o.employee_name}</span>
                      <StatusBadge value={o.type} />
                      <span>{formatDateRange(o.start_date, o.end_date)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApproveTarget(null)}>Отмена</Button>
            <Button
              disabled={decide.isPending}
              onClick={() => decide.mutate({ ids: approveTarget.id, status: 'approved' })}
            >
              Согласовать
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Массовое согласование */}
      <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Согласовать выбранные заявки?</DialogTitle>
            <DialogDescription>
              Будет согласовано {pluralize(selectedList.length, 'заявка', 'заявки', 'заявок')}.
              Пересечения по отделам не проверяются при массовом действии — проверьте список.
            </DialogDescription>
          </DialogHeader>
          <ul role="list" className="max-h-56 space-y-1 overflow-y-auto py-2">
            {selectedList.map((l) => (
              <li key={l.id} role="listitem" className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium text-foreground">{l.employee_name}</span>
                <StatusBadge value={l.type} />
                <span className="text-xs text-muted-foreground">{formatDateRange(l.start_date, l.end_date)}</span>
              </li>
            ))}
          </ul>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkOpen(false)}>Отмена</Button>
            <Button
              disabled={decide.isPending || !selectedList.length}
              onClick={() => decide.mutate({ ids: selectedList.map((l) => l.id), status: 'approved' })}
            >
              Согласовать {formatNumber(selectedList.length)}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Отклонение с обязательной причиной */}
      <Dialog open={!!rejectTarget} onOpenChange={(v) => !v && setRejectTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Отклонить заявку?</DialogTitle>
            <DialogDescription>
              {rejectTarget && (
                <>
                  {rejectTarget.employee_name} · {formatDateRange(rejectTarget.start_date, rejectTarget.end_date)}.
                  Причина отправится сотруднику вместе с уведомлением.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <Label htmlFor="reject-reason">Причина отклонения</Label>
            <Textarea
              id="reject-reason"
              rows={3}
              value={rejectReason}
              placeholder="Например: на эти даты уже согласован отпуск двух коллег из отдела"
              aria-invalid={!rejectReason.trim()}
              onChange={(e) => setRejectReason(e.target.value)}
            />
            {!rejectReason.trim() && (
              <p role="alert" className="mt-1 text-xs text-muted-foreground">
                Причина обязательна — без неё сотрудник не поймёт решение.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectTarget(null)}>Отмена</Button>
            <Button
              variant="destructive"
              disabled={decide.isPending || !rejectReason.trim()}
              onClick={() => decide.mutate({ ids: rejectTarget.id, status: 'rejected', reason: rejectReason.trim() })}
            >
              Отклонить заявку
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
