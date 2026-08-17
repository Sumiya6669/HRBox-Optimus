import React, { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, ArrowLeft, CalendarDays, CheckCircle2, ClipboardList,
  History, Sparkles, Undo2, User,
} from 'lucide-react';

import { api } from '@/api/client';
import { createEntity } from '@/api/entity';
import PageContainer from '@/components/common/PageContainer';
import EmptyState from '@/components/common/EmptyState';
import ErrorState from '@/components/common/ErrorState';
import StatusBadge from '@/components/common/StatusBadge';
import SafeImage from '@/components/common/SafeImage';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/lib/AuthContext';
import { formatDate, formatNumber, formatPoints } from '@/lib/format';
import { statusVariant } from '@/lib/statusLabels';
import { mutationErrorMessage } from '@/lib/dataErrors';
import { cn } from '@/lib/utils';
import {
  ProcessFieldInput, buildValuesPayload, fieldOptions, optionLabel, validateFields,
} from '@/pages/cabinet/ProcessRequestForm';

/**
 * Карточка заявки по процессу.
 *
 * Решение по этапу принимается ТОЛЬКО через rpc process_decide: клиент никогда
 * не пишет статус в process_requests — иначе заявитель мог бы сам себе
 * «согласовать» заявку и начислить баллы.
 */

const requestsView = createEntity('v_process_requests', { defaultSort: '-created_date' });

/** Действия истории: словарь статусов знает не все, поэтому даём подписи-фолбэки. */
const HISTORY_ACTIONS = {
  submitted: 'Заявка подана',
  approved: 'Согласовано',
  rejected: 'Отклонено',
  executed: 'Исполнено',
  commented: 'Комментарий',
  cancelled: 'Заявка отозвана',
};

/** Подпись кнопки маршрута: она же объясняет, что произойдёт с заявкой. */
function routeLabel(route, stage) {
  if (route.kind === 'reject') return 'Отклонить';
  if (route.kind === 'resolve') return 'Начислить и закрыть';
  return stage?.type === 'approve' ? 'Согласовать' : 'Далее';
}

function DetailSkeleton() {
  return (
    <div className="space-y-4" aria-hidden="true">
      <Card className="space-y-3 p-6">
        <div className="h-6 w-2/3 animate-pulse rounded bg-muted" />
        <div className="h-4 w-1/2 animate-pulse rounded bg-muted" />
        <div className="h-20 animate-pulse rounded bg-muted" />
      </Card>
      <Card className="h-40 animate-pulse bg-muted" />
    </div>
  );
}

/** Строка «поле → значение» с человеческими подписями вариантов. */
function ValueRow({ value, field, employeeName }) {
  const label = value.field_label || field?.label || 'Поле';
  const type = field?.type;

  let content = null;

  if (value.file_url) {
    content =
      type === 'image' ? (
        <a href={value.file_url} target="_blank" rel="noreferrer" className="inline-block">
          <SafeImage
            src={value.file_url}
            alt={value.value_text || label}
            className="max-h-40 rounded-lg border border-border object-cover"
          />
        </a>
      ) : (
        <a href={value.file_url} target="_blank" rel="noreferrer" className="text-primary hover:underline">
          {value.value_text || 'Скачать файл'}
        </a>
      );
  } else if (type === 'multiselect') {
    const codes = Array.isArray(value.value_json) ? value.value_json : [];
    const labels = codes.map((code) => {
      const option = fieldOptions(field).find((o) => String(o.value) === String(code));
      return option ? optionLabel(option) : String(code);
    });
    content = labels.length ? labels.join(', ') : '—';
  } else if (type === 'select') {
    const option = fieldOptions(field).find((o) => String(o.value) === String(value.value_text));
    content = option ? optionLabel(option) : value.value_text || '—';
  } else if (type === 'employee') {
    content = employeeName || value.value_text || '—';
  } else if (type === 'date') {
    content = formatDate(value.value_text);
  } else if (value.value_number !== null && value.value_number !== undefined) {
    content = formatNumber(value.value_number);
  } else {
    content = value.value_text || '—';
  }

  return (
    <div className="grid grid-cols-1 gap-1 py-3 sm:grid-cols-3 sm:gap-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-sm text-foreground sm:col-span-2 sm:whitespace-pre-line">{content}</dd>
    </div>
  );
}

export default function ProcessRequestDetail() {
  const { id } = useParams();
  const { employeeId, isLoadingAuth } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [decisionValues, setDecisionValues] = useState({});
  const [touched, setTouched] = useState({});
  const [comment, setComment] = useState('');
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelComment, setCancelComment] = useState('');

  const requestQuery = useQuery({
    queryKey: ['process-request', id],
    queryFn: () => requestsView.get(id),
    enabled: !!id,
  });

  const request = requestQuery.data || null;

  const detailsQuery = useQuery({
    queryKey: ['process-request-details', id, request?.process_id, request?.current_stage_id],
    enabled: !!request,
    queryFn: async () => {
      const [values, history, stages] = await Promise.all([
        api.entities.ProcessRequestValue.filter({ request_id: id }),
        api.entities.ProcessRequestHistory.filter({ request_id: id }, 'created_date'),
        api.entities.ProcessStage.filter({ process_id: request.process_id }, 'sort_order'),
      ]);
      const stageIds = stages.map((s) => s.id);
      const [fields, routes] = await Promise.all([
        stageIds.length ? api.entities.ProcessField.filter({ stage_id: stageIds }, 'sort_order') : [],
        request.current_stage_id
          ? api.entities.ProcessRoute.filter({ stage_id: request.current_stage_id }, 'sort_order')
          : [],
      ]);
      return { values, history, stages, fields, routes };
    },
  });

  const values = useMemo(() => detailsQuery.data?.values || [], [detailsQuery.data]);
  const history = detailsQuery.data?.history || [];
  const stages = useMemo(() => detailsQuery.data?.stages || [], [detailsQuery.data]);
  const fields = useMemo(() => detailsQuery.data?.fields || [], [detailsQuery.data]);
  const routes = detailsQuery.data?.routes || [];

  const fieldById = useMemo(() => new Map(fields.map((f) => [f.id, f])), [fields]);
  const stageOrder = useMemo(() => new Map(stages.map((s) => [s.id, s.sort_order ?? 0])), [stages]);
  const currentStage = stages.find((s) => s.id === request?.current_stage_id) || null;
  const currentStageFields = useMemo(
    () => fields.filter((f) => f.stage_id === request?.current_stage_id),
    [fields, request?.current_stage_id]
  );

  // Список сотрудников нужен только там, где есть поля типа «Сотрудник».
  const needsEmployees = fields.some((f) => f.type === 'employee');
  const employeesQuery = useQuery({
    queryKey: ['employees-for-process-request'],
    queryFn: () => api.entities.Employee.list('name'),
    enabled: needsEmployees && !!detailsQuery.data,
  });
  const employeeById = useMemo(
    () => new Map((employeesQuery.data || []).map((e) => [e.id, e])),
    [employeesQuery.data]
  );

  // Значения показываем в порядке этапов и полей конструктора.
  const sortedValues = useMemo(
    () =>
      [...values].sort((a, b) => {
        const stageDiff = (stageOrder.get(a.stage_id) ?? 0) - (stageOrder.get(b.stage_id) ?? 0);
        if (stageDiff !== 0) return stageDiff;
        return (fieldById.get(a.field_id)?.sort_order ?? 0) - (fieldById.get(b.field_id)?.sort_order ?? 0);
      }),
    [values, stageOrder, fieldById]
  );

  const decisionErrors = useMemo(
    () => validateFields(currentStageFields, decisionValues),
    [currentStageFields, decisionValues]
  );

  const canDecide = !!request?.awaiting_me && request?.status === 'in_progress';
  const isAuthor = !!employeeId && request?.employee_id === employeeId;
  const canCancel = isAuthor && request?.status === 'in_progress';

  const decide = useMutation({
    mutationFn: (route) =>
      api.rpc.decideProcessRequest(
        id,
        route.id,
        comment.trim() || null,
        buildValuesPayload(currentStageFields, decisionValues)
      ),
    onSuccess: (result) => {
      const points = Number(result?.points) || 0;
      toast({
        title:
          result?.status === 'rejected'
            ? 'Заявка отклонена'
            : result?.status === 'resolved'
              ? 'Заявка решена'
              : 'Заявка передана на следующий этап',
        description: points > 0 ? `Сотруднику начислено ${formatPoints(points)}.` : undefined,
      });
      setComment('');
      setDecisionValues({});
      setTouched({});
      invalidate();
    },
    onError: (e) =>
      toast({
        variant: 'destructive',
        title: 'Не удалось провести заявку',
        description: mutationErrorMessage(e, {
          23502: 'Заполните обязательные поля и комментарий к решению.',
          42501: 'Вы не назначены ответственным на текущем этапе.',
          22023: 'Заявка уже закрыта — обновите страницу.',
        }),
      }),
  });

  const cancel = useMutation({
    mutationFn: () => api.rpc.cancelProcessRequest(id, cancelComment.trim() || null),
    onSuccess: () => {
      setCancelOpen(false);
      setCancelComment('');
      toast({ title: 'Заявка отозвана' });
      invalidate();
    },
    onError: (e) =>
      toast({
        variant: 'destructive',
        title: 'Не удалось отозвать заявку',
        description: mutationErrorMessage(e, {
          42501: 'Отозвать заявку может только её автор.',
          22023: 'Заявка уже закрыта — обновите страницу.',
        }),
      }),
  });

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['process-request', id] });
    qc.invalidateQueries({ queryKey: ['process-request-details', id] });
    qc.invalidateQueries({ queryKey: ['process-requests'] });
    qc.invalidateQueries({ queryKey: ['admin-process-requests'] });
    qc.invalidateQueries({ queryKey: ['wallet-balance'] });
    qc.invalidateQueries({ queryKey: ['portal-stats'] });
  }

  const routeDisabled = (route) =>
    decide.isPending ||
    cancel.isPending ||
    (route.require_comment && !comment.trim()) ||
    (route.kind !== 'reject' && Object.keys(decisionErrors).length > 0);

  const error = requestQuery.error || detailsQuery.error;
  const isLoading = isLoadingAuth || requestQuery.isPending || (!!request && detailsQuery.isPending);
  const points = request?.status === 'resolved' ? request?.points_awarded : request?.points_preview;

  return (
    <PageContainer
      title={request?.process_name || 'Заявка'}
      documentTitle="Заявка по процессу"
      description={request?.category_name || undefined}
      width="narrow"
    >
      <Link
        to="/cabinet/processes/requests"
        className="mb-4 inline-flex min-h-[40px] items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Назад к заявкам
      </Link>

      {error ? (
        <ErrorState
          error={error}
          onRetry={() => {
            requestQuery.refetch();
            detailsQuery.refetch();
          }}
        />
      ) : isLoading ? (
        <DetailSkeleton />
      ) : !request ? (
        <EmptyState
          icon={ClipboardList}
          title="Заявка не найдена"
          description="Заявка удалена или у вас нет прав на её просмотр."
          action={
            <Button asChild>
              <Link to="/cabinet/processes/requests">К списку заявок</Link>
            </Button>
          }
        />
      ) : (
        <div className="space-y-4">
          {/* Шапка заявки */}
          <Card className="p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-lg font-semibold text-foreground">{request.process_name || 'Заявка'}</h2>
                {request.category_name && (
                  <p className="mt-0.5 text-sm text-muted-foreground">{request.category_name}</p>
                )}
                <p className="mt-1 inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                  <User className="h-3.5 w-3.5" aria-hidden="true" />
                  {request.employee_name || '—'}
                </p>
              </div>
              {canCancel && (
                <Button variant="outline" onClick={() => setCancelOpen(true)} disabled={cancel.isPending}>
                  <Undo2 className="h-4 w-4" aria-hidden="true" />
                  Отозвать заявку
                </Button>
              )}
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <StatusBadge value={request.status} />
              {request.stage_name && (
                <StatusBadge
                  value={request.stage_name}
                  fallback={request.stage_name}
                  variant={statusVariant(request.stage_type)}
                />
              )}
              {request.is_overdue && <StatusBadge value="overdue" />}
              {points > 0 && (
                <Badge variant="success" className="gap-1">
                  <Sparkles className="h-3 w-3" aria-hidden="true" />
                  {request.status === 'resolved' ? 'Начислено ' : 'Ожидается '}
                  {formatPoints(points)}
                </Badge>
              )}
            </div>

            <dl className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-muted-foreground">Подана</dt>
                <dd className="text-foreground">{formatDate(request.created_date)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Срок этапа</dt>
                <dd className={cn('text-foreground', request.is_overdue && 'text-destructive')}>
                  {request.due_date ? formatDate(request.due_date, 'datetime') : '—'}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Закрыта</dt>
                <dd className="text-foreground">
                  {request.resolved_at ? formatDate(request.resolved_at) : '—'}
                </dd>
              </div>
            </dl>
          </Card>

          {/* Заполненные значения: подписи берём сохранённые, конструктор мог их переименовать */}
          <Card className="p-6">
            <h3 className="mb-2 flex items-center gap-2 font-semibold text-foreground">
              <ClipboardList className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              Данные заявки
            </h3>
            {!sortedValues.length ? (
              <p className="text-sm text-muted-foreground">В заявке нет заполненных полей.</p>
            ) : (
              <dl className="divide-y divide-border">
                {sortedValues.map((value) => {
                  const field = fieldById.get(value.field_id);
                  const employee =
                    field?.type === 'employee' ? employeeById.get(value.value_text) : null;
                  return (
                    <ValueRow
                      key={value.id}
                      value={value}
                      field={field}
                      employeeName={employee?.name}
                    />
                  );
                })}
              </dl>
            )}
          </Card>

          {/* Панель решения — только ответственному на текущем этапе */}
          {canDecide && (
            <Card className="border-primary/40 p-6">
              <h3 className="mb-1 flex items-center gap-2 font-semibold text-foreground">
                <CheckCircle2 className="h-4 w-4 text-primary" aria-hidden="true" />
                Ваше решение
              </h3>
              <p className="mb-4 text-sm text-muted-foreground">
                Этап «{currentStage?.name || request.stage_name}». Решение изменит статус заявки и, если
                этап завершающий, начислит баллы автору.
              </p>

              <div className="space-y-5">
                {currentStageFields.map((field) => (
                  <ProcessFieldInput
                    key={field.id}
                    field={field}
                    value={decisionValues[field.id]}
                    error={touched[field.id] ? decisionErrors[field.id] : undefined}
                    employees={employeesQuery.data || []}
                    disabled={decide.isPending}
                    idPrefix="decision-field"
                    onChange={(next) => {
                      setDecisionValues((prev) => ({ ...prev, [field.id]: next }));
                      setTouched((prev) => ({ ...prev, [field.id]: true }));
                    }}
                  />
                ))}

                <div>
                  <Label htmlFor="decision-comment">
                    Комментарий
                    {routes.some((r) => r.require_comment) && (
                      <span className="ml-0.5 text-destructive" aria-hidden="true">
                        *
                      </span>
                    )}
                  </Label>
                  <Textarea
                    id="decision-comment"
                    rows={3}
                    value={comment}
                    disabled={decide.isPending}
                    placeholder="Поясните решение — комментарий увидит автор заявки"
                    className="mt-1.5"
                    onChange={(e) => setComment(e.target.value)}
                  />
                </div>

                {Object.keys(decisionErrors).length > 0 && (
                  <p role="alert" className="text-sm text-destructive">
                    Заполните обязательные поля этапа, чтобы продолжить.
                  </p>
                )}

                {!routes.length ? (
                  <p className="text-sm text-muted-foreground">
                    Для этого этапа не настроено ни одного перехода — обратитесь к HR-специалисту.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {routes.map((route) => (
                      <Button
                        key={route.id}
                        type="button"
                        variant={route.kind === 'reject' ? 'destructive' : 'default'}
                        className={cn(
                          route.kind === 'resolve' && 'bg-success text-success-foreground hover:bg-success/90'
                        )}
                        disabled={routeDisabled(route)}
                        onClick={() => decide.mutate(route)}
                      >
                        {decide.isPending ? 'Отправка…' : routeLabel(route, currentStage)}
                      </Button>
                    ))}
                  </div>
                )}

                {routes.some((r) => r.require_comment) && !comment.trim() && (
                  <p className="text-xs text-muted-foreground">
                    Для части решений комментарий обязателен.
                  </p>
                )}
              </div>
            </Card>
          )}

          {/* История движения заявки */}
          <Card className="p-6">
            <h3 className="mb-3 flex items-center gap-2 font-semibold text-foreground">
              <History className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              История
            </h3>
            {!history.length ? (
              <p className="text-sm text-muted-foreground">Записей пока нет.</p>
            ) : (
              <ol className="space-y-4" role="list">
                {history.map((item) => (
                  <li key={item.id} role="listitem" className="flex gap-3">
                    <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary" aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge value={item.action} fallback={HISTORY_ACTIONS[item.action]} />
                        {item.stage_name && (
                          <span className="text-sm text-foreground">{item.stage_name}</span>
                        )}
                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                          <CalendarDays className="h-3 w-3" aria-hidden="true" />
                          {formatDate(item.created_date, 'datetime')}
                        </span>
                      </div>
                      <p className="mt-0.5 text-sm text-muted-foreground">{item.actor_name || '—'}</p>
                      {item.comment && (
                        <p className="mt-1 rounded-lg bg-muted p-2 text-sm text-foreground">{item.comment}</p>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>
      )}

      {/* Отзыв заявки автором */}
      <Dialog open={cancelOpen} onOpenChange={(open) => (open ? setCancelOpen(true) : setCancelOpen(false))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Отозвать заявку?</DialogTitle>
            <DialogDescription>
              Заявка закроется без начисления баллов. Восстановить её будет нельзя — при необходимости
              подайте новую.
            </DialogDescription>
          </DialogHeader>

          <div className="py-2">
            <Label htmlFor="cancel-comment">Причина (необязательно)</Label>
            <Textarea
              id="cancel-comment"
              rows={3}
              value={cancelComment}
              className="mt-1.5"
              placeholder="Например: ошибся в категории, подам заново"
              onChange={(e) => setCancelComment(e.target.value)}
            />
          </div>

          <DialogFooter className="gap-2">
            {/* BUG-072: явная кнопка «Отмена», а не только крестик */}
            <Button variant="outline" onClick={() => setCancelOpen(false)} disabled={cancel.isPending}>
              Отмена
            </Button>
            <Button variant="destructive" onClick={() => cancel.mutate()} disabled={cancel.isPending}>
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
              {cancel.isPending ? 'Отзываем…' : 'Отозвать заявку'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
