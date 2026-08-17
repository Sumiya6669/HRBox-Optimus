import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle, CalendarDays, FileBarChart, Layers, Play, Plus, Square, Trash2, Users,
} from 'lucide-react';

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
import { Progress } from '@/components/ui/progress';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { formatDate, formatDateRange, formatNumber, isPast, pluralize } from '@/lib/format';
import { mutationErrorMessage } from '@/lib/dataErrors';

/**
 * Сессии (волны) опросов.
 *
 * BUG-020: сессия «Активна» была привязана к опросу в статусе «Черновик».
 *          В БД это запрещает триггер validate_survey_session (ошибка 22023);
 *          на клиенте кнопка запуска выключена, пока опрос не активирован,
 *          а серверная ошибка переводится в человеческий текст.
 * Прогресс «0 / 5» ничего не объяснял: теперь подпись «Ответили N из M приглашённых»,
 *          где M — target_count сессии, а N — реальное число survey_responses.
 * BUG-019: просроченные сессии помечены явно, статус — через StatusBadge.
 */

const STATUS_FILTERS = [
  { value: 'all', label: 'Все' },
  { value: 'draft', label: 'Черновики' },
  { value: 'active', label: 'Активные' },
  { value: 'closed', label: 'Завершённые' },
];

const emptyToNull = (value) => (value === '' || value === undefined ? null : value);

const EMPTY_FORM = { survey_id: '', start_date: '', end_date: '', target_count: '' };

function SessionsSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <Card key={i} className="p-5">
          <div className="h-5 w-24 rounded bg-muted animate-pulse mb-3" />
          <div className="h-5 w-2/3 rounded bg-muted animate-pulse mb-3" />
          <div className="h-2 w-full rounded bg-muted/60 animate-pulse mb-4" />
          <div className="h-8 w-full rounded bg-muted/40 animate-pulse" />
        </Card>
      ))}
    </div>
  );
}

export default function AdminSurveySessions() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const [statusFilter, setStatusFilter] = useState('all');
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [errors, setErrors] = useState({});
  const [deleting, setDeleting] = useState(null);
  const [closing, setClosing] = useState(null);

  const sessionsQuery = useQuery({
    queryKey: ['admin-survey-sessions'],
    queryFn: () => api.entities.SurveySession.list('-start_date'),
  });

  // BUG-019/018: список опросов читаем из вьюхи — нужны effective_status и questions_count.
  const surveysQuery = useQuery({
    queryKey: ['admin-surveys-for-sessions'],
    queryFn: async () => {
      const { data, error } = await api.supabase
        .from('v_surveys')
        .select('*')
        .order('title');
      if (error) throw error;
      return data || [];
    },
  });

  const sessions = useMemo(() => sessionsQuery.data || [], [sessionsQuery.data]);
  const surveys = surveysQuery.data || [];
  const activeSurveys = surveys.filter((s) => s.effective_status === 'active' && (s.questions_count || 0) > 0);

  /**
   * Реальное число ответов по каждой сессии: считаем в БД, а не по хранимому полю.
   * Именно из-за хранимых счётчиков в аудите и появились «93 ответа» при пустой таблице.
   */
  const responseCountsQuery = useQuery({
    queryKey: ['admin-survey-session-responses', sessions.map((s) => s.id).join(',')],
    enabled: sessions.length > 0,
    queryFn: async () => {
      const entries = await Promise.all(
        sessions.map(async (session) => [
          session.id,
          await api.entities.SurveyResponse.count({ session_id: session.id }),
        ])
      );
      return Object.fromEntries(entries);
    },
  });

  const responseCounts = responseCountsQuery.data || {};

  const visible = useMemo(() => {
    if (statusFilter === 'all') return sessions;
    return sessions.filter((s) => s.status === statusFilter);
  }, [sessions, statusFilter]);

  const filterOptions = STATUS_FILTERS.map((option) => ({
    ...option,
    count: option.value === 'all' ? sessions.length : sessions.filter((s) => s.status === option.value).length,
  }));

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['admin-survey-sessions'] });
    qc.invalidateQueries({ queryKey: ['admin-survey-session-responses'] });
    qc.invalidateQueries({ queryKey: ['cabinet-survey-sessions'] });
  };

  /** BUG-020: 22023 — триггер validate_survey_session. */
  const SESSION_ERRORS = {
    22023: 'Нельзя запустить сессию: опрос не активирован',
    23514: 'Дата окончания не может быть раньше даты начала',
    23503: 'Опрос удалён — выберите другой',
  };

  const create = useMutation({
    mutationFn: (data) => {
      const survey = surveys.find((s) => s.id === data.survey_id);
      return api.entities.SurveySession.create({
        survey_id: data.survey_id,
        survey_title: survey?.title || '',
        start_date: data.start_date,
        end_date: emptyToNull(data.end_date),
        status: 'active',
        target_count: Number(data.target_count) || 0,
        anonymous: !!survey?.anonymous,
      });
    },
    onSuccess: () => {
      toast({ title: 'Сессия запущена' });
      invalidate();
      setCreateOpen(false);
      setForm(EMPTY_FORM);
      setErrors({});
    },
    onError: (error) =>
      toast({
        variant: 'destructive',
        title: 'Не удалось создать сессию',
        description: mutationErrorMessage(error, SESSION_ERRORS),
      }),
  });

  const changeStatus = useMutation({
    mutationFn: ({ id, status }) => api.entities.SurveySession.update(id, { status }),
    onSuccess: (_data, variables) => {
      toast({ title: variables.status === 'closed' ? 'Сессия закрыта' : 'Сессия запущена' });
      invalidate();
      setClosing(null);
    },
    onError: (error) =>
      toast({
        variant: 'destructive',
        title: 'Не удалось изменить статус сессии',
        description: mutationErrorMessage(error, SESSION_ERRORS),
      }),
  });

  const remove = useMutation({
    mutationFn: (id) => api.entities.SurveySession.delete(id),
    onSuccess: () => {
      toast({ title: 'Сессия удалена' });
      invalidate();
      setDeleting(null);
    },
    onError: (error) =>
      toast({
        variant: 'destructive',
        title: 'Не удалось удалить сессию',
        description: mutationErrorMessage(error),
      }),
  });

  const openCreate = () => {
    setForm({ ...EMPTY_FORM, start_date: formatDate(new Date(), 'iso') });
    setErrors({});
    setCreateOpen(true);
  };

  const submitCreate = () => {
    const next = {};
    if (!form.survey_id) next.survey_id = 'Выберите активный опрос';
    if (!form.start_date) next.start_date = 'Укажите дату начала';
    if (form.end_date && form.end_date < form.start_date) {
      next.end_date = 'Дата окончания не может быть раньше даты начала';
    }
    const target = Number(form.target_count);
    if (form.target_count !== '' && (!Number.isFinite(target) || target < 0)) {
      next.target_count = 'Число приглашённых не может быть отрицательным';
    }
    setErrors(next);
    if (Object.keys(next).length) return;
    create.mutate(form);
  };

  const error = sessionsQuery.error || surveysQuery.error;
  const isLoading = sessionsQuery.isLoading || surveysQuery.isLoading;

  return (
    <PageContainer
      title="Сессии опросов"
      description="Волны опросов: период проведения, число приглашённых и реальное число полученных ответов."
      width="wide"
      actions={
        <Button onClick={openCreate} className="min-h-[40px]">
          <Plus className="w-4 h-4" aria-hidden="true" />
          Создать сессию
        </Button>
      }
    >
      {error ? (
        <ErrorState
          error={error}
          onRetry={() => {
            sessionsQuery.refetch();
            surveysQuery.refetch();
          }}
        />
      ) : isLoading ? (
        <SessionsSkeleton />
      ) : (
        <div className="space-y-5">
          <FilterChips
            options={filterOptions}
            value={statusFilter}
            onChange={setStatusFilter}
            ariaLabel="Фильтр сессий по статусу"
          />

          {visible.length === 0 ? (
            <EmptyState
              icon={Layers}
              title={sessions.length === 0 ? 'Сессий опросов пока нет' : 'По этому фильтру сессий нет'}
              description={
                sessions.length === 0
                  ? 'Сессия запускает активный опрос на выбранный период. Создайте первую, чтобы сотрудники увидели опрос в личном кабинете.'
                  : 'Измените фильтр статуса, чтобы увидеть другие сессии.'
              }
              actionLabel={sessions.length === 0 ? 'Создать сессию' : undefined}
              onAction={sessions.length === 0 ? openCreate : undefined}
            />
          ) : (
            <ul className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" role="list">
              {visible.map((session) => {
                const survey = surveys.find((s) => s.id === session.survey_id);
                const surveyActive = survey?.effective_status === 'active';
                const answered = responseCounts[session.id] ?? 0;
                const invited = session.target_count || 0;
                const percent = invited > 0 ? Math.min(100, Math.round((answered / invited) * 100)) : 0;
                // BUG-019: просроченная сессия помечается по дате, а не по хранимому статусу.
                const expired = session.status === 'active' && session.end_date && isPast(session.end_date);
                const hintId = `session-hint-${session.id}`;

                return (
                  <li key={session.id} role="listitem">
                    <Card className="flex h-full flex-col p-5">
                      <div className="flex flex-wrap items-center gap-2 mb-3">
                        <StatusBadge value={session.status} />
                        {expired && <StatusBadge value="expired" />}
                        {session.anonymous && <StatusBadge value="anonymous" />}
                      </div>

                      <h3 className="font-semibold text-foreground">
                        {session.survey_title || survey?.title || 'Опрос удалён'}
                      </h3>

                      <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                        <CalendarDays className="w-3.5 h-3.5" aria-hidden="true" />
                        {formatDateRange(session.start_date, session.end_date)}
                      </p>

                      {/* Прогресс с объяснением, откуда берётся знаменатель */}
                      <div className="mt-4">
                        <div className="flex items-center justify-between text-xs mb-1.5">
                          <span className="flex items-center gap-1.5 text-muted-foreground">
                            <Users className="w-3.5 h-3.5" aria-hidden="true" />
                            {responseCountsQuery.isLoading
                              ? 'Считаем ответы…'
                              : `Ответили ${formatNumber(answered)} из ${formatNumber(invited)} приглашённых`}
                          </span>
                          <span className="tabular-nums text-muted-foreground">{percent}%</span>
                        </div>
                        <Progress
                          value={percent}
                          aria-label={`Ответили ${answered} из ${invited} приглашённых`}
                        />
                        {invited === 0 && (
                          <p className="mt-1.5 text-xs text-muted-foreground">
                            Число приглашённых не задано — укажите его при создании сессии, иначе процент не считается.
                          </p>
                        )}
                      </div>

                      {/* BUG-020: объясняем, почему кнопка запуска недоступна */}
                      {session.status !== 'active' && !surveyActive && (
                        <p id={hintId} className="mt-3 flex items-start gap-2 rounded-lg bg-muted p-2 text-xs text-muted-foreground">
                          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
                          Нельзя запустить сессию: опрос не активирован. Активируйте опрос в разделе «Опросы».
                        </p>
                      )}

                      <div className="mt-auto flex flex-wrap items-center gap-1 pt-4 border-t border-border">
                        <Button
                          size="sm"
                          variant="outline"
                          className="min-h-[40px]"
                          onClick={() =>
                            navigate(`/admin/survey-reports?surveyId=${session.survey_id}&sessionId=${session.id}`)
                          }
                          aria-label={`Отчёт по сессии «${session.survey_title || ''}»`}
                        >
                          <FileBarChart className="w-3.5 h-3.5" aria-hidden="true" />
                          Отчёт
                        </Button>

                        {session.status === 'active' ? (
                          <Button
                            size="sm"
                            variant="outline"
                            className="min-h-[40px]"
                            onClick={() => setClosing(session)}
                            aria-label="Закрыть сессию вручную"
                          >
                            <Square className="w-3.5 h-3.5" aria-hidden="true" />
                            Закрыть
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            className="min-h-[40px]"
                            // BUG-020: запуск недоступен, пока опрос не активен
                            disabled={!surveyActive || changeStatus.isPending}
                            aria-describedby={!surveyActive ? hintId : undefined}
                            onClick={() => changeStatus.mutate({ id: session.id, status: 'active' })}
                            aria-label="Запустить сессию"
                          >
                            <Play className="w-3.5 h-3.5" aria-hidden="true" />
                            Запустить
                          </Button>
                        )}

                        <div className="flex-1" />

                        <Button
                          size="icon"
                          variant="ghost"
                          className="min-h-[40px] min-w-[40px] text-destructive hover:text-destructive"
                          onClick={() => setDeleting(session)}
                          aria-label={`Удалить сессию опроса «${session.survey_title || ''}»`}
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

      {/* Создание сессии */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Новая сессия</DialogTitle>
            <DialogDescription>
              В списке — только активные опросы с вопросами: сессию у черновика база данных не примет.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div>
              <Label htmlFor="session-survey">Опрос *</Label>
              <select
                id="session-survey"
                className="mt-1 w-full min-h-[40px] rounded-md border border-input bg-transparent px-3 text-sm"
                value={form.survey_id}
                aria-invalid={errors.survey_id ? 'true' : undefined}
                aria-describedby={errors.survey_id ? 'session-survey-error' : undefined}
                onChange={(e) => setForm({ ...form, survey_id: e.target.value })}
              >
                <option value="">— выберите опрос —</option>
                {activeSurveys.map((s) => (
                  <option key={s.id} value={s.id}>{s.title}</option>
                ))}
              </select>
              {activeSurveys.length === 0 && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Активных опросов с вопросами нет. Сначала добавьте вопросы и активируйте опрос в разделе «Опросы».
                </p>
              )}
              {errors.survey_id && (
                <p id="session-survey-error" role="alert" className="mt-1 text-xs text-destructive">
                  {errors.survey_id}
                </p>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label htmlFor="new-session-start">Дата начала *</Label>
                <Input
                  id="new-session-start"
                  type="date"
                  className="mt-1 min-h-[40px]"
                  value={form.start_date}
                  aria-invalid={errors.start_date ? 'true' : undefined}
                  onChange={(e) => setForm({ ...form, start_date: e.target.value })}
                />
                {errors.start_date && (
                  <p role="alert" className="mt-1 text-xs text-destructive">{errors.start_date}</p>
                )}
              </div>
              <div>
                <Label htmlFor="new-session-end">Дата окончания</Label>
                <Input
                  id="new-session-end"
                  type="date"
                  className="mt-1 min-h-[40px]"
                  value={form.end_date}
                  aria-invalid={errors.end_date ? 'true' : undefined}
                  onChange={(e) => setForm({ ...form, end_date: e.target.value })}
                />
                {errors.end_date && (
                  <p role="alert" className="mt-1 text-xs text-destructive">{errors.end_date}</p>
                )}
              </div>
            </div>

            <div>
              <Label htmlFor="new-session-target">Сколько сотрудников приглашено</Label>
              <Input
                id="new-session-target"
                type="number"
                min="0"
                placeholder="0"
                className="mt-1 min-h-[40px]"
                value={form.target_count}
                aria-invalid={errors.target_count ? 'true' : undefined}
                aria-describedby="new-session-target-hint"
                onChange={(e) => setForm({ ...form, target_count: e.target.value })}
              />
              <p id="new-session-target-hint" className="mt-1 text-xs text-muted-foreground">
                Знаменатель прогресса «Ответили N из M приглашённых».
              </p>
              {errors.target_count && (
                <p role="alert" className="mt-1 text-xs text-destructive">{errors.target_count}</p>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" className="min-h-[40px]" onClick={() => setCreateOpen(false)}>
              Отмена
            </Button>
            <Button
              className="min-h-[40px]"
              disabled={!form.survey_id || !form.start_date || create.isPending}
              onClick={submitCreate}
            >
              {create.isPending ? 'Создание…' : 'Создать'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Закрытие сессии вручную */}
      <Dialog open={!!closing} onOpenChange={(open) => !open && setClosing(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Закрыть сессию?</DialogTitle>
            <DialogDescription>
              Сессия «{closing?.survey_title}» перестанет показываться сотрудникам, уже отправленные ответы
              сохранятся ({pluralize(responseCounts[closing?.id] || 0, 'ответ', 'ответа', 'ответов')}).
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" className="min-h-[40px]" onClick={() => setClosing(null)}>
              Отмена
            </Button>
            <Button
              className="min-h-[40px]"
              disabled={changeStatus.isPending}
              onClick={() => changeStatus.mutate({ id: closing.id, status: 'closed' })}
            >
              {changeStatus.isPending ? 'Закрытие…' : 'Закрыть сессию'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Удаление сессии (BUG-072) */}
      <Dialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Удалить сессию?</DialogTitle>
            <DialogDescription>
              Сессия «{deleting?.survey_title}» будет удалена вместе с полученными ответами
              ({pluralize(responseCounts[deleting?.id] || 0, 'ответ', 'ответа', 'ответов')}). Действие необратимо.
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
