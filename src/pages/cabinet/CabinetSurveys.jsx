import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, ArrowRight, BarChart3, CheckCircle2, ClipboardCheck, Clock, EyeOff, Send, Star,
} from 'lucide-react';

import { api } from '@/api/client';
import PageContainer from '@/components/common/PageContainer';
import EmptyState from '@/components/common/EmptyState';
import ErrorState from '@/components/common/ErrorState';
import StatusBadge from '@/components/common/StatusBadge';
import SafeImage from '@/components/common/SafeImage';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/lib/AuthContext';
import { formatDate, pluralize } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * BUG-007: страница опросов была полностью пустой при четырёх опросах в базе —
 * список строился из пересечения survey_sessions и surveys, а всё, что не прошло
 * фильтр «questions.length > 0», молча исчезало вместе с пустым состоянием.
 *
 * Теперь источник правды — вьюха v_surveys (BUG-019: статус считается по датам,
 * просроченный опрос больше не «Активен»), а у страницы есть все три состояния.
 */

/** Варианты отображения вопроса из конструктора (QuestionEditor). */
const STARS_MAX = 5;
const SCALE_MAX = 10;

function renderRichText(text) {
  if (!text) return null;
  // Конструктор опросов хранит картинки в markdown-подобном виде ![alt](url).
  const parts = String(text).split(/(!\[.*?\]\(.*?\))/g);
  return parts.map((part, i) => {
    const match = part.match(/!\[(.*?)\]\((.*?)\)/);
    if (match) {
      return (
        <SafeImage key={i} src={match[2]} alt={match[1] || ''} className="max-w-full rounded-lg my-2" />
      );
    }
    return <span key={i}>{part}</span>;
  });
}

/** Ответ на вопрос считается данным, если в нём есть текст или выбранные значения. */
function isAnswered(question, answer) {
  if (!answer) return false;
  if (question.type === 'text') return Boolean(answer.text && answer.text.trim());
  if (question.type === 'grid') {
    const rows = question.options || [];
    if (!rows.length) return false;
    return rows.every((_, i) => Boolean((answer.values || [])[i]));
  }
  return (answer.values || []).filter(Boolean).length > 0;
}

function SurveysSkeleton() {
  return (
    <div className="space-y-3" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <Card key={i} className="p-5">
          <div className="h-4 w-24 rounded bg-muted animate-pulse mb-3" />
          <div className="h-5 w-1/2 rounded bg-muted animate-pulse mb-2" />
          <div className="h-3 w-2/3 rounded bg-muted/60 animate-pulse" />
        </Card>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ вопрос */

function QuestionField({ question, answer, onChange }) {
  const values = answer?.values || [];
  const variant = question.display_variant || 'list';
  const options = question.options || [];

  if (question.type === 'text') {
    return (
      <Textarea
        id={`q-${question.id}`}
        rows={4}
        value={answer?.text || ''}
        onChange={(e) => onChange({ text: e.target.value, values: [] })}
        placeholder="Ваш ответ…"
      />
    );
  }

  if (question.type === 'single' && variant === 'dropdown') {
    return (
      <select
        id={`q-${question.id}`}
        className="w-full min-h-[40px] rounded-md border border-input bg-transparent px-3 text-sm"
        value={values[0] || ''}
        onChange={(e) => onChange({ values: e.target.value ? [e.target.value] : [], text: e.target.value })}
      >
        <option value="">— выберите вариант —</option>
        {options.map((opt, i) => (
          <option key={i} value={opt}>{opt}</option>
        ))}
      </select>
    );
  }

  if (question.type === 'single') {
    return (
      <div className="space-y-2" role="radiogroup" aria-labelledby={`q-label-${question.id}`}>
        {options.map((opt, i) => {
          const checked = values[0] === opt;
          return (
            <button
              key={i}
              type="button"
              role="radio"
              aria-checked={checked}
              onClick={() => onChange({ values: [opt], text: opt })}
              className={cn(
                'w-full min-h-[40px] text-left rounded-lg border p-3 text-sm transition flex items-center gap-3',
                checked ? 'border-primary bg-accent' : 'border-border hover:border-primary/40'
              )}
            >
              <span
                className={cn(
                  'w-4 h-4 rounded-full border-2 shrink-0',
                  checked ? 'border-primary bg-primary' : 'border-muted-foreground/30'
                )}
                aria-hidden="true"
              />
              {opt}
            </button>
          );
        })}
      </div>
    );
  }

  if (question.type === 'multiple') {
    return (
      <div className="space-y-2">
        {options.map((opt, i) => {
          const checked = values.includes(opt);
          return (
            <button
              key={i}
              type="button"
              role="checkbox"
              aria-checked={checked}
              onClick={() =>
                onChange({
                  values: checked ? values.filter((v) => v !== opt) : [...values, opt],
                })
              }
              className={cn(
                'w-full min-h-[40px] text-left rounded-lg border p-3 text-sm transition flex items-center gap-3',
                checked ? 'border-primary bg-accent' : 'border-border hover:border-primary/40'
              )}
            >
              <span
                className={cn(
                  'w-4 h-4 rounded border-2 shrink-0 flex items-center justify-center',
                  checked ? 'border-primary bg-primary' : 'border-muted-foreground/30'
                )}
                aria-hidden="true"
              >
                {checked && <CheckCircle2 className="w-3 h-3 text-primary-foreground" />}
              </span>
              {opt}
            </button>
          );
        })}
      </div>
    );
  }

  if (question.type === 'rating') {
    // «stars» — привычные пять звёзд, «scale» — шкала до 10 (NPS-подобная).
    const max = variant === 'scale' ? SCALE_MAX : STARS_MAX;
    const current = Number(values[0]) || 0;

    if (variant === 'scale') {
      return (
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
            <button
              key={n}
              type="button"
              aria-label={`Оценка ${n} из ${max}`}
              aria-pressed={current === n}
              onClick={() => onChange({ values: [String(n)], text: String(n) })}
              className={cn(
                'min-h-[40px] min-w-[40px] rounded-lg border text-sm font-medium transition',
                current === n ? 'border-primary bg-primary text-primary-foreground' : 'border-border hover:border-primary/40'
              )}
            >
              {n}
            </button>
          ))}
        </div>
      );
    }

    return (
      <div className="flex items-center gap-1">
        {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
          <button
            key={n}
            type="button"
            aria-label={`Оценка ${n} из ${max}`}
            aria-pressed={current === n}
            onClick={() => onChange({ values: [String(n)], text: String(n) })}
            className="min-h-[40px] min-w-[40px] flex items-center justify-center"
          >
            <Star
              className={cn('w-7 h-7 transition', n <= current ? 'fill-warning text-warning' : 'text-muted-foreground/30')}
              aria-hidden="true"
            />
          </button>
        ))}
        {current > 0 && <span className="ml-2 text-sm font-medium text-foreground">{current} / {max}</span>}
      </div>
    );
  }

  if (question.type === 'grid') {
    // Сетка: каждая строка оценивается по шкале 1…5.
    return (
      <div className="space-y-3">
        {options.map((row, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <span className="text-sm flex-1 min-w-[140px]">{row}</span>
            <div className="flex gap-1">
              {Array.from({ length: STARS_MAX }, (_, k) => k + 1).map((n) => {
                const checked = String(values[i]) === String(n);
                return (
                  <button
                    key={n}
                    type="button"
                    aria-label={`${row}: оценка ${n} из ${STARS_MAX}`}
                    aria-pressed={checked}
                    onClick={() => {
                      const next = [...values];
                      next[i] = String(n);
                      onChange({ values: next, text: next.map((v, j) => `${options[j]}: ${v || '—'}`).join('; ') });
                    }}
                    className={cn(
                      'min-h-[40px] min-w-[40px] rounded-lg border text-sm transition',
                      checked ? 'border-primary bg-primary text-primary-foreground' : 'border-border hover:border-primary/40'
                    )}
                  >
                    {n}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return null;
}

/* --------------------------------------------------------- прохождение опроса */

function SurveyRunner({ survey, session, employeeId, employeeName, onExit }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const questions = Array.isArray(survey.questions) ? survey.questions : [];

  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState({});
  const [error, setError] = useState('');

  const question = questions[step];
  const answer = answers[question?.id];
  const required = question?.required !== false;

  const setAnswer = (patch) => {
    setError('');
    setAnswers((prev) => ({ ...prev, [question.id]: { ...(prev[question.id] || {}), ...patch } }));
  };

  const submit = useMutation({
    mutationFn: () => {
      const payload = {
        survey_id: survey.id,
        session_id: session?.id || null,
        survey_title: survey.title,
        answers: questions.map((q) => {
          const a = answers[q.id] || {};
          return {
            question_id: q.id,
            question_text: q.text,
            question_type: q.type,
            answer_text: a.text || '',
            answer_values: (a.values || []).filter(Boolean),
          };
        }),
      };
      // Анонимный опрос: автор не передаётся вообще, иначе анонимность мнимая.
      if (!survey.anonymous) {
        payload.employee_id = employeeId;
        payload.employee_name = employeeName;
      }
      return api.entities.SurveyResponse.create(payload);
    },
    onSuccess: () => {
      toast({ title: 'Ответы отправлены', description: 'Спасибо за участие в опросе!' });
      qc.invalidateQueries({ queryKey: ['cabinet-survey-responses'] });
      qc.invalidateQueries({ queryKey: ['cabinet-surveys-active'] });
      onExit();
    },
    onError: (e) => {
      // Уникальный индекс (session_id, employee_id): повторное прохождение запрещено в БД.
      toast({
        variant: 'destructive',
        title: 'Не удалось отправить ответы',
        description: e?.code === '23505' ? 'Вы уже проходили этот опрос.' : e?.message,
      });
    },
  });

  const goNext = () => {
    if (required && !isAnswered(question, answer)) {
      setError('Это обязательный вопрос — ответьте, чтобы продолжить.');
      return;
    }
    setError('');
    setStep((s) => Math.min(s + 1, questions.length - 1));
  };

  const handleSubmit = () => {
    const missing = questions.findIndex((q) => q.required !== false && !isAnswered(q, answers[q.id]));
    if (missing >= 0) {
      setStep(missing);
      setError('Это обязательный вопрос — ответьте, чтобы отправить опрос.');
      return;
    }
    submit.mutate();
  };

  if (!question) {
    return (
      <EmptyState
        icon={BarChart3}
        title="В опросе нет вопросов"
        description="Опрос ещё не заполнен HR-специалистом. Загляните позже."
        actionLabel="Вернуться к списку"
        onAction={onExit}
      />
    );
  }

  const isLast = step === questions.length - 1;
  const progress = Math.round(((step + 1) / questions.length) * 100);

  return (
    <div className="space-y-4">
      <Button variant="ghost" onClick={onExit} className="px-2">
        <ArrowLeft className="w-4 h-4" aria-hidden="true" />
        Назад к списку опросов
      </Button>

      <Card className="p-5">
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <StatusBadge value={survey.type} />
          {survey.anonymous && <StatusBadge value="anonymous" />}
          {survey.end_date && (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Clock className="w-3 h-3" aria-hidden="true" />
              до {formatDate(survey.end_date)}
            </span>
          )}
        </div>
        <h2 className="text-xl font-semibold text-foreground">{survey.title}</h2>
        {survey.description && <p className="text-sm text-muted-foreground mt-1">{survey.description}</p>}

        {survey.anonymous && (
          <p className="mt-3 flex items-start gap-2 rounded-lg bg-muted p-3 text-sm text-muted-foreground">
            <EyeOff className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
            Опрос анонимный: ваше имя и табельные данные не сохраняются вместе с ответами —
            HR увидит только сводку по всем участникам.
          </p>
        )}

        <div className="mt-4">
          <div className="flex items-center justify-between text-sm mb-1">
            <span className="font-medium text-foreground">Вопрос {step + 1} из {questions.length}</span>
            <span className="text-muted-foreground">{progress}%</span>
          </div>
          <Progress value={progress} aria-label={`Пройдено ${progress}%`} />
        </div>
      </Card>

      <Card className="p-5">
        {question.block_name && (
          <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">{question.block_name}</p>
        )}
        <div id={`q-label-${question.id}`} className="font-medium text-foreground">
          {renderRichText(question.text)}
          {required && <span className="text-destructive ml-1" aria-hidden="true">*</span>}
        </div>
        {question.description && (
          <p className="text-sm text-muted-foreground mt-1">{renderRichText(question.description)}</p>
        )}
        {required && <p className="sr-only">Обязательный вопрос</p>}

        <div className="mt-4" aria-invalid={error ? 'true' : undefined}>
          <QuestionField question={question} answer={answer} onChange={setAnswer} />
        </div>

        {error && (
          <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>
        )}
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          variant="outline"
          onClick={() => { setError(''); setStep((s) => Math.max(0, s - 1)); }}
          disabled={step === 0}
        >
          <ArrowLeft className="w-4 h-4" aria-hidden="true" />
          Назад
        </Button>

        {isLast ? (
          <Button onClick={handleSubmit} disabled={submit.isPending}>
            <Send className="w-4 h-4" aria-hidden="true" />
            {submit.isPending ? 'Отправка…' : 'Отправить ответы'}
          </Button>
        ) : (
          <Button onClick={goNext}>
            Далее
            <ArrowRight className="w-4 h-4" aria-hidden="true" />
          </Button>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ страница */

export default function CabinetSurveys() {
  const { user, employeeId, isLoadingAuth } = useAuth();
  const [active, setActive] = useState(null); // { survey, session }

  // BUG-019: активность опроса определяет вьюха (effective_status), а не поле status.
  const surveysQuery = useQuery({
    queryKey: ['cabinet-surveys-active'],
    queryFn: async () => {
      const { data, error } = await api.supabase
        .from('v_surveys')
        .select('*')
        .eq('effective_status', 'active')
        .order('end_date', { ascending: true, nullsFirst: false });
      if (error) throw error;
      return data || [];
    },
  });

  const sessionsQuery = useQuery({
    queryKey: ['cabinet-survey-sessions'],
    queryFn: () => api.entities.SurveySession.filter({ status: 'active' }),
  });

  const responsesQuery = useQuery({
    queryKey: ['cabinet-survey-responses', employeeId],
    queryFn: () => api.entities.SurveyResponse.filter({ employee_id: employeeId }, '-date'),
    enabled: !!employeeId,
  });

  const surveys = surveysQuery.data || [];
  const sessions = sessionsQuery.data || [];
  const responses = responsesQuery.data || [];

  const error = surveysQuery.error || sessionsQuery.error || responsesQuery.error;
  const isLoading =
    isLoadingAuth || surveysQuery.isLoading || sessionsQuery.isLoading || (!!employeeId && responsesQuery.isLoading);

  const { available, passed } = useMemo(() => {
    const passedSurveyIds = new Set(responses.map((r) => r.survey_id));
    const passedSessionIds = new Set(responses.map((r) => r.session_id).filter(Boolean));

    const availableList = surveys
      .filter((s) => (s.questions_count || 0) > 0)
      .map((s) => ({ survey: s, session: sessions.find((x) => x.survey_id === s.id) || null }))
      .filter(({ survey, session }) => !passedSurveyIds.has(survey.id) && !(session && passedSessionIds.has(session.id)));

    const passedList = responses.map((r) => ({
      response: r,
      survey: surveys.find((s) => s.id === r.survey_id) || null,
    }));

    return { available: availableList, passed: passedList };
  }, [surveys, sessions, responses]);

  const refetchAll = () => {
    surveysQuery.refetch();
    sessionsQuery.refetch();
    if (employeeId) responsesQuery.refetch();
  };

  if (active) {
    return (
      <PageContainer title="Прохождение опроса" documentTitle={active.survey.title} width="narrow">
        <SurveyRunner
          survey={active.survey}
          session={active.session}
          employeeId={employeeId}
          employeeName={user?.full_name}
          onExit={() => setActive(null)}
        />
      </PageContainer>
    );
  }

  return (
    <PageContainer
      title="Опросы"
      description="Опросы и голосования, доступные вам прямо сейчас. Пройденный опрос повторно не открывается."
      width="narrow"
    >
      {error ? (
        <ErrorState error={error} onRetry={refetchAll} />
      ) : isLoading ? (
        <SurveysSkeleton />
      ) : !employeeId ? (
        <EmptyState
          icon={ClipboardCheck}
          title="Учётная запись не связана с карточкой сотрудника"
          description="Опросы адресуются сотрудникам. Попросите HR-специалиста связать вашу учётную запись с карточкой в разделе «Сотрудники»."
        />
      ) : available.length === 0 && passed.length === 0 ? (
        <EmptyState
          icon={BarChart3}
          title="Доступных опросов нет"
          description="Как только HR запустит новый опрос, он появится здесь — мы пришлём уведомление."
        />
      ) : (
        <div className="space-y-8">
          <section>
            <h2 className="text-base font-semibold text-foreground mb-3">
              Доступные опросы {available.length > 0 && <span className="text-muted-foreground">({available.length})</span>}
            </h2>
            {available.length === 0 ? (
              <EmptyState
                icon={CheckCircle2}
                title="Доступных опросов нет"
                description="Вы прошли все активные опросы. Новые появятся здесь автоматически."
                compact
              />
            ) : (
              <ul className="space-y-3" role="list">
                {available.map(({ survey, session }) => (
                  <li key={survey.id} role="listitem">
                    <Card className="p-5">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2 mb-2">
                            <StatusBadge value={survey.type} />
                            {survey.anonymous && <StatusBadge value="anonymous" />}
                            {survey.end_date && (
                              <span className="text-xs text-muted-foreground flex items-center gap-1">
                                <Clock className="w-3 h-3" aria-hidden="true" />
                                до {formatDate(survey.end_date)}
                              </span>
                            )}
                          </div>
                          <h3 className="font-semibold text-foreground">{survey.title}</h3>
                          {survey.description && (
                            <p className="text-sm text-muted-foreground mt-1">{survey.description}</p>
                          )}
                          <p className="text-xs text-muted-foreground mt-2">
                            {pluralize(survey.questions_count || 0, 'вопрос', 'вопроса', 'вопросов')}
                            {' · '}
                            {pluralize(survey.responses_count || 0, 'ответ', 'ответа', 'ответов')} получено
                          </p>
                        </div>
                        <Button onClick={() => setActive({ survey, session })}>
                          Пройти опрос
                          <ArrowRight className="w-4 h-4" aria-hidden="true" />
                        </Button>
                      </div>
                    </Card>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {passed.length > 0 && (
            <section>
              <h2 className="text-base font-semibold text-foreground mb-3">
                Пройденные опросы <span className="text-muted-foreground">({passed.length})</span>
              </h2>
              <ul className="space-y-2" role="list">
                {passed.map(({ response, survey }) => (
                  <li key={response.id} role="listitem">
                    <Card className="p-4 flex items-start gap-3">
                      <span className="w-9 h-9 rounded-lg bg-success/15 text-success flex items-center justify-center shrink-0">
                        <CheckCircle2 className="w-5 h-5" aria-hidden="true" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-foreground">
                          {response.survey_title || survey?.title || 'Опрос'}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Пройден {formatDate(response.date, 'long')}
                        </p>
                      </div>
                      <StatusBadge value="completed" />
                    </Card>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground mt-3">
                Повторно пройти опрос нельзя: один ответ на сотрудника хранится в базе.
                Если вы ошиблись — напишите HR через раздел «Обратная связь».
              </p>
            </section>
          )}
        </div>
      )}
    </PageContainer>
  );
}
