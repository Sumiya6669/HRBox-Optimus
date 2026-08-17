import React, { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ChevronRight, FileText, Plus } from 'lucide-react';

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
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/lib/AuthContext';
import { daysBetween, formatDate, formatRelative, pluralize, toDate } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * Служебные заявки сотрудника.
 * BUG-025: пустая форма молча ничего не отправляла — теперь полная валидация.
 * BUG-033: карточка заявки не открывалась — теперь это ссылка на /cabinet/requests/:id.
 * BUG-044: примеры справок переписаны под Казахстан (2-НДФЛ — российская форма).
 * BUG-072: в модалке есть явная кнопка «Отмена».
 */

const TYPES = [
  { value: 'reference', label: 'Справка' },
  { value: 'document', label: 'Документы' },
  { value: 'equipment', label: 'Оборудование' },
  { value: 'access', label: 'Доступы' },
  { value: 'other', label: 'Прочее' },
];

const PRIORITIES = [
  { value: 'low', label: 'Низкий' },
  { value: 'medium', label: 'Средний' },
  { value: 'high', label: 'Высокий' },
];

const STATUS_ORDER = ['pending', 'in_progress', 'resolved', 'rejected'];

/** BUG-044: казахстанские формы вместо российской «2-НДФЛ». */
const TITLE_EXAMPLES = [
  'Справка с места работы',
  'Справка о доходах',
  'Копия трудового договора',
  'Справка для банка',
];

const EMPTY_FORM = { title: '', body: '', type: 'other', priority: 'medium' };

/** SLA: сколько рабочих дней заявка ждёт ответа (выходные не считаем). */
function workdaysWaiting(createdDate) {
  const created = toDate(createdDate);
  if (!created) return 0;
  const calendarDays = Math.max(0, daysBetween(created, new Date()));
  let workdays = 0;
  for (let i = 1; i <= calendarDays; i += 1) {
    const day = new Date(created.getFullYear(), created.getMonth(), created.getDate() + i);
    const weekday = day.getDay();
    if (weekday !== 0 && weekday !== 6) workdays += 1;
  }
  return workdays;
}

const SLA_WORKDAYS = 3;

function RequestsSkeleton() {
  return (
    <div className="space-y-3" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <Card key={i} className="p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-muted animate-pulse" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-1/3 rounded bg-muted animate-pulse" />
            <div className="h-3 w-1/4 rounded bg-muted/60 animate-pulse" />
          </div>
        </Card>
      ))}
    </div>
  );
}

export default function CabinetRequests() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { user, employeeId, isLoadingAuth } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [touched, setTouched] = useState({});
  const [status, setStatus] = useState('all');

  // Предзаполнение типа из адреса: /cabinet/requests?type=reference со страницы «Кадровые документы».
  const presetType = searchParams.get('type');
  useEffect(() => {
    if (!presetType) return;
    if (!TYPES.some((t) => t.value === presetType)) return;
    setForm((prev) => ({ ...prev, type: presetType }));
    setOpen(true);
    const next = new URLSearchParams(searchParams);
    next.delete('type');
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetType]);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['cabinet-requests', employeeId],
    queryFn: () => api.entities.ServiceRequest.filter({ employee_id: employeeId }, '-created_date'),
    enabled: !!employeeId,
  });

  const requests = data || [];

  const create = useMutation({
    mutationFn: (payload) =>
      api.entities.ServiceRequest.create({
        title: payload.title.trim(),
        body: payload.body.trim(),
        type: payload.type,
        priority: payload.priority,
        employee_id: employeeId,
        employee_name: user?.full_name || null,
        status: 'pending',
      }),
    onSuccess: () => {
      toast({ title: 'Заявка отправлена', description: 'HR-специалист получит её в работу.' });
      qc.invalidateQueries({ queryKey: ['cabinet-requests', employeeId] });
      closeDialog();
    },
    onError: (e) => toast({ variant: 'destructive', title: 'Не удалось отправить заявку', description: e?.message }),
  });

  const errors = useMemo(() => {
    const acc = {};
    if (!form.title.trim()) acc.title = 'Укажите тему заявки';
    else if (form.title.trim().length < 4) acc.title = 'Тема слишком короткая — минимум 4 символа';
    if (!form.body.trim()) acc.body = 'Опишите, что именно нужно сделать';
    else if (form.body.trim().length < 10) acc.body = 'Описание слишком короткое — минимум 10 символов';
    if (!TYPES.some((t) => t.value === form.type)) acc.type = 'Выберите тип заявки';
    return acc;
  }, [form]);

  const isValid = Object.keys(errors).length === 0;

  const counts = useMemo(() => {
    const acc = { all: requests.length };
    for (const key of STATUS_ORDER) acc[key] = requests.filter((r) => r.status === key).length;
    return acc;
  }, [requests]);

  const visible = status === 'all' ? requests : requests.filter((r) => r.status === status);

  const closeDialog = () => {
    setOpen(false);
    setForm(EMPTY_FORM);
    setTouched({});
  };

  const submit = (event) => {
    event.preventDefault();
    // BUG-025: раньше «Отправить» при пустой форме молча ничего не делало.
    setTouched({ title: true, body: true, type: true });
    if (!isValid) return;
    create.mutate(form);
  };

  const showError = (field) => (touched[field] ? errors[field] : undefined);

  const filterOptions = [
    { value: 'all', label: 'Все', count: counts.all },
    ...STATUS_ORDER.filter((s) => counts[s] > 0).map((s) => ({
      value: s,
      label: { pending: 'Ожидают', in_progress: 'В работе', resolved: 'Решены', rejected: 'Отклонены' }[s],
      count: counts[s],
    })),
  ];

  return (
    <PageContainer
      title="Заявки"
      description="Служебные записки и обращения в HR: справки, документы, доступы и оборудование."
      actions={
        <Button onClick={() => setOpen(true)} disabled={!employeeId}>
          <Plus className="w-4 h-4" aria-hidden="true" />
          Новая заявка
        </Button>
      }
    >
      {error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : isLoadingAuth || (!!employeeId && isLoading) ? (
        <RequestsSkeleton />
      ) : !employeeId ? (
        <EmptyState
          icon={FileText}
          title="Учётная запись не связана с карточкой сотрудника"
          description="Заявки подаются от имени сотрудника. Попросите HR-специалиста связать вашу учётную запись с карточкой."
        />
      ) : requests.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="Заявок пока нет"
          description="Здесь появятся ваши обращения в HR: справка с места работы, копия трудового договора, доступ к системе или заявка на оборудование."
          actionLabel="Создать заявку"
          onAction={() => setOpen(true)}
        />
      ) : (
        <>
          <FilterChips
            options={filterOptions}
            value={status}
            onChange={setStatus}
            ariaLabel="Фильтр заявок по статусу"
            className="mb-4"
          />

          {visible.length === 0 ? (
            <EmptyState
              title="В этом статусе заявок нет"
              description="Снимите фильтр, чтобы увидеть все ваши заявки."
              actionLabel="Показать все"
              onAction={() => setStatus('all')}
              compact
            />
          ) : (
            <ul className="space-y-3" role="list">
              {visible.map((request) => {
                const waiting = request.status === 'pending' ? workdaysWaiting(request.created_date) : 0;
                const isSlaBreached = waiting > SLA_WORKDAYS;
                return (
                  <li key={request.id} role="listitem">
                    <Card className={cn('transition-colors hover:bg-accent/40', isSlaBreached && 'border-warning/50')}>
                      {/* BUG-033: карточка теперь открывает детальную страницу заявки. */}
                      <Link to={`/cabinet/requests/${request.id}`} className="block p-4 min-h-[40px]">
                        <div className="flex items-start gap-3">
                          <span className="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                            <FileText className="w-5 h-5" aria-hidden="true" />
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="font-medium text-foreground">{request.title}</p>
                            {request.body && (
                              <p className="text-sm text-muted-foreground mt-0.5 line-clamp-2">{request.body}</p>
                            )}
                            <div className="flex flex-wrap items-center gap-2 mt-2">
                              <StatusBadge value={request.status} />
                              <StatusBadge value={request.type} />
                              <StatusBadge value={request.priority} />
                              <span className="text-xs text-muted-foreground">
                                {formatDate(request.created_date)}
                              </span>
                            </div>
                            {isSlaBreached && (
                              <p className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-warning/15 px-2 py-1 text-xs text-foreground">
                                <AlertTriangle className="w-3.5 h-3.5 text-warning" aria-hidden="true" />
                                Ожидает дольше обычного — {pluralize(waiting, 'рабочий день', 'рабочих дня', 'рабочих дней')}
                              </p>
                            )}
                            {request.resolution && (
                              <p className="mt-2 rounded-lg bg-muted p-2 text-sm text-muted-foreground">
                                <span className="font-medium text-foreground">Резолюция: </span>
                                {request.resolution}
                              </p>
                            )}
                          </div>
                          <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 mt-1" aria-hidden="true" />
                        </div>
                      </Link>
                    </Card>
                  </li>
                );
              })}
            </ul>
          )}

          <p className="text-xs text-muted-foreground mt-4">
            Последнее обновление списка: {formatRelative(requests[0]?.updated_date || requests[0]?.created_date)}
          </p>
        </>
      )}

      <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : closeDialog())}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Новая заявка</DialogTitle>
            <DialogDescription>
              Опишите, что нужно сделать. Например: {TITLE_EXAMPLES.join(', ').toLowerCase()}.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={submit} noValidate className="space-y-3">
            <div>
              <Label htmlFor="request-title">Тема <span className="text-destructive" aria-hidden="true">*</span></Label>
              <Input
                id="request-title"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                onBlur={() => setTouched((t) => ({ ...t, title: true }))}
                placeholder={TITLE_EXAMPLES[0]}
                aria-invalid={showError('title') ? 'true' : undefined}
                aria-describedby={showError('title') ? 'request-title-error' : undefined}
                className={cn('min-h-[40px]', showError('title') && 'border-destructive')}
              />
              {showError('title') && (
                <p id="request-title-error" role="alert" className="mt-1 text-sm text-destructive">
                  {errors.title}
                </p>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label htmlFor="request-type">Тип заявки <span className="text-destructive" aria-hidden="true">*</span></Label>
                <select
                  id="request-type"
                  className="w-full min-h-[40px] rounded-md border border-input bg-transparent px-3 text-sm"
                  value={form.type}
                  onChange={(e) => setForm({ ...form, type: e.target.value })}
                >
                  {TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="request-priority">Приоритет</Label>
                <select
                  id="request-priority"
                  className="w-full min-h-[40px] rounded-md border border-input bg-transparent px-3 text-sm"
                  value={form.priority}
                  onChange={(e) => setForm({ ...form, priority: e.target.value })}
                >
                  {PRIORITIES.map((p) => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <Label htmlFor="request-body">Описание <span className="text-destructive" aria-hidden="true">*</span></Label>
              <Textarea
                id="request-body"
                rows={4}
                value={form.body}
                onChange={(e) => setForm({ ...form, body: e.target.value })}
                onBlur={() => setTouched((t) => ({ ...t, body: true }))}
                placeholder="Например: нужна справка с места работы для посольства, два экземпляра."
                aria-invalid={showError('body') ? 'true' : undefined}
                aria-describedby={showError('body') ? 'request-body-error' : undefined}
                className={cn(showError('body') && 'border-destructive')}
              />
              {showError('body') && (
                <p id="request-body-error" role="alert" className="mt-1 text-sm text-destructive">
                  {errors.body}
                </p>
              )}
            </div>

            <DialogFooter className="gap-2">
              {/* BUG-072: явная кнопка «Отмена», а не только крестик. */}
              <Button type="button" variant="outline" onClick={closeDialog}>
                Отмена
              </Button>
              <Button type="submit" disabled={!isValid || create.isPending}>
                {create.isPending ? 'Отправка…' : 'Отправить'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
