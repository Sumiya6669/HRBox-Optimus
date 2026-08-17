import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  BarChart3, Clock, FileBarChart, Pencil, Play, Plus, Trash2, Users, Layers, AlertTriangle,
} from 'lucide-react';

import { api } from '@/api/client';
import PageContainer from '@/components/common/PageContainer';
import EmptyState from '@/components/common/EmptyState';
import ErrorState from '@/components/common/ErrorState';
import StatusBadge from '@/components/common/StatusBadge';
import FilterChips from '@/components/common/FilterChips';
import SurveyConstructor from '@/components/surveys/SurveyConstructor';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { formatDate, formatDateRange, pluralize } from '@/lib/format';
import { mutationErrorMessage } from '@/lib/dataErrors';

/**
 * Администрирование опросов.
 *
 * BUG-018: опрос со статусом «Активен» и нулём вопросов показывал «Ответов: 93»,
 *          хотя survey_responses пуста. Теперь все счётчики берутся из вьюхи
 *          v_surveys (responses_count — реальный агрегат, questions_count — длина jsonb),
 *          а публикация пустого опроса запрещена ещё и на клиенте: БД её отклоняет
 *          check-ограничением surveys_active_needs_questions (код 23514).
 * BUG-019: «Активные» опросы с дедлайном 05.08 и 15.08 при сегодняшнем 16.08.
 *          Показываем effective_status (считается по датам в самой вьюхе), просрочку —
 *          отдельной пометкой.
 * BUG-040: демонстрационный мусор («ааааааааааа») скрыт фильтром is_sample = false.
 * BUG-051: типы и статусы — только через StatusBadge, без английских кодов.
 * BUG-072: удаление и создание сессии — через модалку с явной кнопкой «Отмена».
 */

const STATUS_FILTERS = [
  { value: 'all', label: 'Все' },
  { value: 'draft', label: 'Черновики' },
  { value: 'active', label: 'Активные' },
  { value: 'closed', label: 'Завершённые' },
  { value: 'archived', label: 'В архиве' },
];

/** Поля вьюхи, которых нет в таблице surveys: в UPDATE/INSERT их слать нельзя. */
const VIEW_ONLY_FIELDS = ['effective_status', 'responses_count', 'questions_count', 'is_expired'];

/** Пустая строка из <input type="date"> — это NULL, а не дата. */
const emptyToNull = (value) => (value === '' || value === undefined ? null : value);

/** Готовит запись опроса к записи в таблицу surveys. */
function toSurveyPayload(form) {
  const payload = { ...form };
  VIEW_ONLY_FIELDS.forEach((field) => delete payload[field]);
  delete payload.id;
  delete payload.created_date;
  delete payload.updated_date;
  payload.start_date = emptyToNull(payload.start_date);
  payload.end_date = emptyToNull(payload.end_date);
  payload.questions = Array.isArray(payload.questions) ? payload.questions : [];
  return payload;
}

function SurveysSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" aria-hidden="true">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <Card key={i} className="p-5">
          <div className="h-5 w-32 rounded bg-muted animate-pulse mb-3" />
          <div className="h-5 w-2/3 rounded bg-muted animate-pulse mb-2" />
          <div className="h-3 w-full rounded bg-muted/60 animate-pulse mb-4" />
          <div className="h-8 w-full rounded bg-muted/40 animate-pulse" />
        </Card>
      ))}
    </div>
  );
}

export default function AdminSurveys() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const [statusFilter, setStatusFilter] = useState('all');
  const [showSamples, setShowSamples] = useState(false); // BUG-040
  const [constructorOpen, setConstructorOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [sessionFor, setSessionFor] = useState(null);
  const [sessionForm, setSessionForm] = useState({ start_date: '', end_date: '', target_count: '' });
  const [sessionErrors, setSessionErrors] = useState({});

  // BUG-018/019: источник правды — вьюха, а не таблица surveys.
  const surveysQuery = useQuery({
    queryKey: ['admin-surveys'],
    queryFn: async () => {
      const { data, error } = await api.supabase
        .from('v_surveys')
        .select('*')
        .order('created_date', { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const surveys = surveysQuery.data || [];

  const visible = useMemo(() => {
    const bySample = surveys.filter((s) => (showSamples ? true : !s.is_sample));
    if (statusFilter === 'all') return bySample;
    return bySample.filter((s) => s.effective_status === statusFilter);
  }, [surveys, statusFilter, showSamples]);

  const filterOptions = useMemo(() => {
    const pool = surveys.filter((s) => (showSamples ? true : !s.is_sample));
    return STATUS_FILTERS.map((option) => ({
      ...option,
      count:
        option.value === 'all'
          ? pool.length
          : pool.filter((s) => s.effective_status === option.value).length,
    }));
  }, [surveys, showSamples]);

  const sampleCount = surveys.filter((s) => s.is_sample).length;

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['admin-surveys'] });
    qc.invalidateQueries({ queryKey: ['admin-survey-sessions'] });
    qc.invalidateQueries({ queryKey: ['cabinet-surveys-active'] });
  };

  const onMutationError = (title) => (error) =>
    toast({
      variant: 'destructive',
      title,
      description: mutationErrorMessage(error, {
        // BUG-018: check-ограничение surveys_active_needs_questions.
        23514: 'Нельзя активировать опрос без вопросов',
        22023: 'Недопустимый статус опроса',
      }),
    });

  const saveSurvey = useMutation({
    mutationFn: ({ id, form }) =>
      id
        ? api.entities.Survey.update(id, toSurveyPayload(form))
        : api.entities.Survey.create(toSurveyPayload(form)),
    onSuccess: (_data, variables) => {
      toast({ title: variables.id ? 'Опрос обновлён' : 'Опрос создан' });
      invalidate();
      setConstructorOpen(false);
      setEditing(null);
    },
    onError: onMutationError('Не удалось сохранить опрос'),
  });

  const changeStatus = useMutation({
    mutationFn: ({ id, status }) => api.entities.Survey.update(id, { status }),
    onSuccess: (_data, variables) => {
      toast({ title: variables.status === 'active' ? 'Опрос активирован' : 'Статус опроса изменён' });
      invalidate();
    },
    onError: onMutationError('Не удалось изменить статус опроса'),
  });

  const removeSurvey = useMutation({
    mutationFn: (id) => api.entities.Survey.delete(id),
    onSuccess: () => {
      toast({ title: 'Опрос удалён' });
      invalidate();
      setDeleting(null);
    },
    onError: onMutationError('Не удалось удалить опрос'),
  });

  const createSession = useMutation({
    mutationFn: ({ survey, form }) =>
      api.entities.SurveySession.create({
        survey_id: survey.id,
        survey_title: survey.title,
        start_date: form.start_date,
        end_date: emptyToNull(form.end_date),
        // BUG-020: активная сессия допустима только у активного опроса — это же проверяет триггер.
        status: 'active',
        target_count: Number(form.target_count) || 0,
        anonymous: !!survey.anonymous,
      }),
    onSuccess: () => {
      toast({ title: 'Сессия запущена', description: 'Опрос доступен сотрудникам в личном кабинете.' });
      qc.invalidateQueries({ queryKey: ['admin-survey-sessions'] });
      qc.invalidateQueries({ queryKey: ['cabinet-survey-sessions'] });
      closeSessionDialog();
    },
    onError: (error) =>
      toast({
        variant: 'destructive',
        title: 'Не удалось создать сессию',
        // BUG-020: триггер validate_survey_session бросает 22023.
        description: mutationErrorMessage(error, {
          22023: 'Нельзя запустить сессию: опрос не активирован',
          23514: 'Дата окончания не может быть раньше даты начала',
        }),
      }),
  });

  const openNew = () => {
    setEditing(null);
    setConstructorOpen(true);
  };

  const openEdit = (survey) => {
    setEditing(survey);
    setConstructorOpen(true);
  };

  const openSessionDialog = (survey) => {
    setSessionFor(survey);
    setSessionErrors({});
    setSessionForm({
      start_date: formatDate(new Date(), 'iso'),
      end_date: survey.end_date || '',
      target_count: '',
    });
  };

  const closeSessionDialog = () => {
    setSessionFor(null);
    setSessionErrors({});
    setSessionForm({ start_date: '', end_date: '', target_count: '' });
  };

  const submitSession = () => {
    const errors = {};
    if (!sessionForm.start_date) errors.start_date = 'Укажите дату начала сессии';
    if (sessionForm.end_date && sessionForm.end_date < sessionForm.start_date) {
      errors.end_date = 'Дата окончания не может быть раньше даты начала';
    }
    const target = Number(sessionForm.target_count);
    if (sessionForm.target_count !== '' && (!Number.isFinite(target) || target < 0)) {
      errors.target_count = 'Число приглашённых не может быть отрицательным';
    }
    setSessionErrors(errors);
    if (Object.keys(errors).length) return;
    createSession.mutate({ survey: sessionFor, form: sessionForm });
  };

  return (
    <PageContainer
      title="Опросы"
      description="Конструктор опросов, публикация и запуск сессий. Счётчики ответов приходят из базы, а не из карточки опроса."
      width="wide"
      actions={
        <Button onClick={openNew} className="min-h-[40px]">
          <Plus className="w-4 h-4" aria-hidden="true" />
          Создать опрос
        </Button>
      }
    >
      {surveysQuery.error ? (
        <ErrorState error={surveysQuery.error} onRetry={surveysQuery.refetch} />
      ) : surveysQuery.isLoading ? (
        <SurveysSkeleton />
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <FilterChips
              options={filterOptions}
              value={statusFilter}
              onChange={setStatusFilter}
              ariaLabel="Фильтр опросов по статусу"
            />
            {/* BUG-040: демонстрационные опросы («ааааааааааа») по умолчанию скрыты */}
            <div className="flex items-center gap-2">
              <Switch
                id="show-samples"
                checked={showSamples}
                onCheckedChange={setShowSamples}
                aria-label="Показывать демонстрационные опросы"
              />
              <Label htmlFor="show-samples" className="text-sm text-muted-foreground cursor-pointer">
                Показывать демо-данные
                {sampleCount > 0 && <span className="ml-1 tabular-nums">({sampleCount})</span>}
              </Label>
            </div>
          </div>

          {visible.length === 0 ? (
            <EmptyState
              icon={BarChart3}
              title={surveys.length === 0 ? 'Опросов пока нет' : 'По этому фильтру опросов нет'}
              description={
                surveys.length === 0
                  ? 'Создайте первый опрос: добавьте вопросы в конструкторе и активируйте его, чтобы он появился у сотрудников.'
                  : 'Измените фильтр статуса или включите показ демо-данных.'
              }
              actionLabel={surveys.length === 0 ? 'Создать опрос' : undefined}
              onAction={surveys.length === 0 ? openNew : undefined}
            />
          ) : (
            <ul className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" role="list">
              {visible.map((survey) => {
                const questionsCount = survey.questions_count || 0;
                const noQuestions = questionsCount === 0;
                const isActive = survey.effective_status === 'active';
                const hintId = `survey-hint-${survey.id}`;

                return (
                  <li key={survey.id} role="listitem">
                    <Card className="flex h-full flex-col p-5">
                      <div className="flex flex-wrap items-center gap-2 mb-3">
                        {/* BUG-051: тип и статус — человекочитаемыми бейджами */}
                        <StatusBadge value={survey.type} />
                        {/* BUG-019: статус считает вьюха по датам, а не поле status */}
                        <StatusBadge value={survey.effective_status} />
                        {survey.anonymous && <StatusBadge value="anonymous" />}
                        {/* BUG-040: демо-запись видно сразу, её нельзя спутать с рабочим опросом */}
                        {survey.is_sample && <Badge variant="outline">Демо-данные</Badge>}
                      </div>

                      <h3 className="font-semibold text-foreground">{survey.title}</h3>
                      {survey.description && (
                        <p className="mt-1 text-sm text-muted-foreground line-clamp-2">{survey.description}</p>
                      )}

                      <dl className="mt-3 space-y-1 text-xs text-muted-foreground">
                        <div className="flex items-center gap-1.5">
                          <Layers className="w-3.5 h-3.5" aria-hidden="true" />
                          <dt className="sr-only">Вопросов</dt>
                          <dd>{pluralize(questionsCount, 'вопрос', 'вопроса', 'вопросов')}</dd>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Users className="w-3.5 h-3.5" aria-hidden="true" />
                          <dt className="sr-only">Получено ответов</dt>
                          {/* BUG-018: реальный агрегат из survey_responses */}
                          <dd>{pluralize(survey.responses_count || 0, 'ответ', 'ответа', 'ответов')} получено</dd>
                        </div>
                        {(survey.start_date || survey.end_date) && (
                          <div className="flex items-center gap-1.5">
                            <Clock className="w-3.5 h-3.5" aria-hidden="true" />
                            <dt className="sr-only">Период проведения</dt>
                            <dd>{formatDateRange(survey.start_date, survey.end_date)}</dd>
                          </div>
                        )}
                      </dl>

                      {/* BUG-019: просроченный опрос помечен явно */}
                      {survey.is_expired && (
                        <p className="mt-3 flex items-start gap-2 rounded-lg bg-destructive/5 p-2 text-xs text-destructive">
                          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
                          Срок опроса истёк {formatDate(survey.end_date)} — сотрудникам он больше не показывается.
                        </p>
                      )}

                      {/* BUG-018: причина недоступности публикации объяснена текстом */}
                      {noQuestions && !isActive && (
                        <p id={hintId} className="mt-3 text-xs text-muted-foreground">
                          Нельзя активировать опрос без вопросов — добавьте хотя бы один в конструкторе.
                        </p>
                      )}

                      <div className="mt-auto flex flex-wrap items-center gap-1 pt-4 border-t border-border">
                        <Button
                          size="sm"
                          variant="outline"
                          className="min-h-[40px]"
                          onClick={() => navigate(`/admin/survey-reports?surveyId=${survey.id}`)}
                          aria-label={`Отчёт по опросу «${survey.title}»`}
                        >
                          <FileBarChart className="w-3.5 h-3.5" aria-hidden="true" />
                          Отчёт
                        </Button>

                        <Button
                          size="sm"
                          variant="outline"
                          className="min-h-[40px]"
                          disabled={!isActive}
                          onClick={() => openSessionDialog(survey)}
                          aria-label={`Запустить сессию опроса «${survey.title}»`}
                          title={isActive ? undefined : 'Сессию можно запустить только у активного опроса'}
                        >
                          <Play className="w-3.5 h-3.5" aria-hidden="true" />
                          Сессия
                        </Button>

                        {!isActive && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="min-h-[40px]"
                            // BUG-018: кнопка выключена, пока в опросе нет вопросов
                            disabled={noQuestions || changeStatus.isPending}
                            aria-describedby={noQuestions ? hintId : undefined}
                            onClick={() => changeStatus.mutate({ id: survey.id, status: 'active' })}
                            aria-label={`Активировать опрос «${survey.title}»`}
                          >
                            Активировать
                          </Button>
                        )}

                        {isActive && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="min-h-[40px]"
                            disabled={changeStatus.isPending}
                            onClick={() => changeStatus.mutate({ id: survey.id, status: 'closed' })}
                            aria-label={`Завершить опрос «${survey.title}»`}
                          >
                            Завершить
                          </Button>
                        )}

                        <div className="flex-1" />

                        <Button
                          size="icon"
                          variant="ghost"
                          className="min-h-[40px] min-w-[40px]"
                          onClick={() => openEdit(survey)}
                          aria-label={`Изменить опрос «${survey.title}»`}
                        >
                          <Pencil className="w-4 h-4" aria-hidden="true" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="min-h-[40px] min-w-[40px] text-destructive hover:text-destructive"
                          onClick={() => setDeleting(survey)}
                          aria-label={`Удалить опрос «${survey.title}»`}
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

      {/* Конструктор опроса */}
      <Dialog
        open={constructorOpen}
        onOpenChange={(open) => {
          setConstructorOpen(open);
          if (!open) setEditing(null);
        }}
      >
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? 'Редактирование опроса' : 'Новый опрос'}</DialogTitle>
            <DialogDescription>
              Опрос становится доступен сотрудникам только в статусе «Активен» и только при наличии вопросов.
            </DialogDescription>
          </DialogHeader>
          <SurveyConstructor
            initial={editing}
            isSaving={saveSurvey.isPending}
            onSave={(form) => saveSurvey.mutate({ id: editing?.id, form })}
            onCancel={() => {
              setConstructorOpen(false);
              setEditing(null);
            }}
          />
        </DialogContent>
      </Dialog>

      {/* Запуск сессии (BUG-072: есть явная «Отмена») */}
      <Dialog open={!!sessionFor} onOpenChange={(open) => !open && closeSessionDialog()}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Новая сессия опроса</DialogTitle>
            <DialogDescription>
              Сессия — это волна опроса: период и число приглашённых сотрудников.
            </DialogDescription>
          </DialogHeader>

          {sessionFor && (
            <div className="space-y-3">
              <div className="rounded-lg bg-muted p-3">
                <p className="text-sm font-medium text-foreground">{sessionFor.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {pluralize(sessionFor.questions_count || 0, 'вопрос', 'вопроса', 'вопросов')}
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="session-start">Дата начала *</Label>
                  <Input
                    id="session-start"
                    type="date"
                    className="mt-1 min-h-[40px]"
                    value={sessionForm.start_date}
                    aria-invalid={sessionErrors.start_date ? 'true' : undefined}
                    aria-describedby={sessionErrors.start_date ? 'session-start-error' : undefined}
                    onChange={(e) => setSessionForm({ ...sessionForm, start_date: e.target.value })}
                  />
                  {sessionErrors.start_date && (
                    <p id="session-start-error" role="alert" className="mt-1 text-xs text-destructive">
                      {sessionErrors.start_date}
                    </p>
                  )}
                </div>
                <div>
                  <Label htmlFor="session-end">Дата окончания</Label>
                  <Input
                    id="session-end"
                    type="date"
                    className="mt-1 min-h-[40px]"
                    value={sessionForm.end_date}
                    aria-invalid={sessionErrors.end_date ? 'true' : undefined}
                    aria-describedby={sessionErrors.end_date ? 'session-end-error' : undefined}
                    onChange={(e) => setSessionForm({ ...sessionForm, end_date: e.target.value })}
                  />
                  {sessionErrors.end_date && (
                    <p id="session-end-error" role="alert" className="mt-1 text-xs text-destructive">
                      {sessionErrors.end_date}
                    </p>
                  )}
                </div>
              </div>

              <div>
                <Label htmlFor="session-target">Сколько сотрудников приглашено</Label>
                <Input
                  id="session-target"
                  type="number"
                  min="0"
                  className="mt-1 min-h-[40px]"
                  value={sessionForm.target_count}
                  placeholder="0"
                  aria-invalid={sessionErrors.target_count ? 'true' : undefined}
                  aria-describedby="session-target-hint"
                  onChange={(e) => setSessionForm({ ...sessionForm, target_count: e.target.value })}
                />
                <p id="session-target-hint" className="mt-1 text-xs text-muted-foreground">
                  Это знаменатель прогресса «Ответили N из M приглашённых».
                </p>
                {sessionErrors.target_count && (
                  <p role="alert" className="mt-1 text-xs text-destructive">{sessionErrors.target_count}</p>
                )}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" className="min-h-[40px]" onClick={closeSessionDialog}>
              Отмена
            </Button>
            <Button
              className="min-h-[40px]"
              disabled={!sessionForm.start_date || createSession.isPending}
              onClick={submitSession}
            >
              {createSession.isPending ? 'Запуск…' : 'Запустить сессию'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Подтверждение удаления (BUG-072) */}
      <Dialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Удалить опрос?</DialogTitle>
            <DialogDescription>
              Опрос «{deleting?.title}» будет удалён вместе со всеми сессиями и ответами
              ({pluralize(deleting?.responses_count || 0, 'ответ', 'ответа', 'ответов')}). Действие необратимо.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" className="min-h-[40px]" onClick={() => setDeleting(null)}>
              Отмена
            </Button>
            <Button
              variant="destructive"
              className="min-h-[40px]"
              disabled={removeSurvey.isPending}
              onClick={() => removeSurvey.mutate(deleting.id)}
            >
              {removeSurvey.isPending ? 'Удаление…' : 'Удалить'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
