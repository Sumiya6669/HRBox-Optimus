import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Clock, CheckCircle2, XCircle, ArrowLeft, ArrowRight, Maximize2, AlertTriangle, RotateCcw,
} from 'lucide-react';

import { api } from '@/api/client';
import ErrorState from '@/components/common/ErrorState';
import BrandLoader from '@/components/common/BrandLoader';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { mutationErrorMessage } from '@/lib/dataErrors';
import { cn } from '@/lib/utils';

/**
 * Прохождение теста.
 *
 * Экран намеренно без бокового меню портала: во время проверки знаний нечего
 * отвлекать, и уход по случайной ссылке стоил бы человеку попытки.
 *
 * ЧТО ЗДЕСЬ ВАЖНО ПОНИМАТЬ. Правильных ответов на этой странице нет и быть не
 * может — сервер их не присылает. Всё, что знает браузер: тексты вопросов и
 * вариантов. Проверка идёт в базе по идентификаторам выбранных вариантов.
 *
 * Таймер тоже не источник правды: дедлайн вычислен на сервере и хранится в
 * попытке. Перезагрузка страницы время не обнуляет, а перевод часов на
 * компьютере ни на что не влияет — сравнивается серверная отметка.
 */

/** Оставшееся время в формате 00:00:00 — как в макете. */
function formatLeft(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = String(Math.floor(total / 3600)).padStart(2, '0');
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const s = String(total % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

/** Полоса шагов 1…N: видно, сколько осталось и где пропуски. */
function Stepper({ questions, index, answers, onGo }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-2 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground">
        Вопрос {index + 1} из {questions.length}
      </span>
      {questions.map((q, i) => {
        const answered = (answers[q.id] || []).length > 0;
        const current = i === index;
        return (
          <button
            key={q.id}
            type="button"
            onClick={() => onGo(i)}
            aria-label={`Вопрос ${i + 1}${answered ? ', отвечен' : ', без ответа'}`}
            aria-current={current ? 'true' : undefined}
            className={cn(
              'relative h-9 w-9 rounded-full text-sm font-medium transition-colors',
              current
                ? 'bg-primary text-primary-foreground'
                : answered
                  ? 'bg-success/15 text-success hover:bg-success/25'
                  : 'bg-muted text-muted-foreground hover:bg-muted/70'
            )}
          >
            {i + 1}
            {q.required && !answered && (
              <span className="absolute -right-0.5 -top-0.5 text-destructive" aria-hidden="true">*</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export default function TestRunner() {
  const { id: courseId } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState({});
  const [result, setResult] = useState(null);
  const [now, setNow] = useState(() => Date.now());
  const autoSubmitted = useRef(false);

  const courseQuery = useQuery({
    queryKey: ['course-title', courseId],
    queryFn: () => api.entities.Course.get(courseId),
  });

  // Попытка стартует один раз при открытии страницы. Повторный запуск создал бы
  // вторую попытку и сжёг лимит — поэтому staleTime бесконечный и без ретраев.
  const attemptQuery = useQuery({
    queryKey: ['test-attempt', courseId],
    queryFn: () => api.rpc.startTestAttempt(courseId),
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const data = attemptQuery.data;
  const questions = useMemo(() => data?.questions || [], [data]);
  const deadline = data?.deadline_at ? new Date(data.deadline_at).getTime() : null;

  const submitMutation = useMutation({
    mutationFn: (payload) => api.rpc.submitTestAttempt(data.attempt_id, payload),
    onSuccess: (res) => {
      setResult(res);
      qc.invalidateQueries({ queryKey: ['test-attempts', courseId] });
      qc.invalidateQueries({ queryKey: ['enrollment', courseId] });
      qc.invalidateQueries({ queryKey: ['my-courses'] });
    },
    onError: (e) => toast({
      variant: 'destructive', title: 'Не удалось отправить ответы', description: mutationErrorMessage(e),
    }),
  });

  const submit = useCallback(() => {
    if (submitMutation.isPending || result) return;
    submitMutation.mutate(answers);
  }, [answers, result, submitMutation]);

  // Тик таймера. Секунда — достаточная точность, а более частый интервал
  // просто перерисовывал бы страницу впустую.
  useEffect(() => {
    if (!deadline || result) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [deadline, result]);

  // Время вышло — отправляем что есть. Молча терять ответы человека нельзя:
  // он их дал, просто не успел нажать кнопку.
  useEffect(() => {
    if (!deadline || result || autoSubmitted.current) return;
    if (now >= deadline) {
      autoSubmitted.current = true;
      toast({ title: 'Время вышло', description: 'Отправляю ответы, которые вы успели дать.' });
      submit();
    }
  }, [now, deadline, result, submit, toast]);

  // Предупреждение при уходе со страницы: закрытая вкладка = потерянная попытка.
  useEffect(() => {
    if (result || !data) return undefined;
    const handler = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [result, data]);

  const toggle = (question, optionId) => {
    setAnswers((prev) => {
      const current = prev[question.id] || [];
      if (question.type === 'multiple') {
        return {
          ...prev,
          [question.id]: current.includes(optionId)
            ? current.filter((x) => x !== optionId)
            : [...current, optionId],
        };
      }
      return { ...prev, [question.id]: [optionId] };
    });
  };

  const unanswered = questions.filter((q) => q.required && !(answers[q.id] || []).length);
  const isLast = index >= questions.length - 1;
  const question = questions[index];

  const title = courseQuery.data?.title || 'Тестирование';

  /* ------------------------------------------------------------- состояния */

  if (attemptQuery.isPending) return <BrandLoader />;

  if (attemptQuery.error) {
    return (
      <Shell title={title}>
        <Card className="mx-auto max-w-xl p-6">
          <ErrorState
            error={attemptQuery.error}
            onRetry={null}
          />
          <Button variant="outline" className="mt-4" asChild>
            <Link to={`/cabinet/learning/${courseId}`}>
              <ArrowLeft className="mr-1 h-4 w-4" aria-hidden="true" /> Вернуться к курсу
            </Link>
          </Button>
        </Card>
      </Shell>
    );
  }

  if (result) {
    return (
      <Shell title={title}>
        <Card className="mx-auto max-w-xl space-y-4 p-6 text-center">
          <div
            className={cn(
              'mx-auto flex h-16 w-16 items-center justify-center rounded-full',
              result.passed ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive'
            )}
          >
            {result.passed
              ? <CheckCircle2 className="h-9 w-9" aria-hidden="true" />
              : <XCircle className="h-9 w-9" aria-hidden="true" />}
          </div>

          <h1 className="text-2xl font-bold text-foreground">
            {result.passed ? 'Тест сдан' : 'Тест не сдан'}
          </h1>
          <p className="text-4xl font-bold text-foreground">{result.score_percent}%</p>
          <p className="text-sm text-muted-foreground">
            Правильных ответов: {result.correct_count} из {result.total_count}. Порог сдачи —{' '}
            {result.pass_score}%.
          </p>

          {result.expired && (
            <p className="flex items-center justify-center gap-1.5 text-sm text-warning">
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
              Время вышло — засчитаны ответы, данные до окончания.
            </p>
          )}

          {/* Разбор показывается, только если это разрешено настройкой теста. */}
          {result.show_correct && Array.isArray(result.review) && (
            <div className="space-y-2 pt-2 text-left">
              <h2 className="text-sm font-medium text-foreground">Разбор ответов</h2>
              {result.review.map((r) => {
                const ok = JSON.stringify((r.correct || []).slice().sort())
                  === JSON.stringify((r.given || []).slice().sort());
                return (
                  <div key={r.question_id} className="rounded-lg border border-border p-3 text-sm">
                    <p className="mb-1 font-medium text-foreground">{r.text}</p>
                    <p className={ok ? 'text-success' : 'text-destructive'}>
                      Ваш ответ: {(r.given || []).join(', ') || '— не отвечено —'}
                    </p>
                    {!ok && (
                      <p className="text-muted-foreground">Верно: {(r.correct || []).join(', ')}</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex flex-wrap justify-center gap-2 pt-2">
            <Button asChild>
              <Link to={`/cabinet/learning/${courseId}`}>К курсу</Link>
            </Button>
            {!result.passed && (
              <Button variant="outline" onClick={() => navigate(0)}>
                <RotateCcw className="mr-1 h-4 w-4" aria-hidden="true" /> Пройти ещё раз
              </Button>
            )}
          </div>
        </Card>
      </Shell>
    );
  }

  if (!questions.length) {
    return (
      <Shell title={title}>
        <Card className="mx-auto max-w-xl p-6 text-center">
          <p className="text-sm text-muted-foreground">В тесте пока нет вопросов.</p>
          <Button variant="outline" className="mt-4" asChild>
            <Link to={`/cabinet/learning/${courseId}`}>Вернуться к курсу</Link>
          </Button>
        </Card>
      </Shell>
    );
  }

  return (
    <Shell title={data?.test?.title || title}>
      <div className="mx-auto max-w-3xl space-y-6">
        {deadline && (
          <p className={cn(
            'text-center text-sm tabular-nums',
            deadline - now < 60_000 ? 'font-semibold text-destructive' : 'text-muted-foreground'
          )}>
            Время {formatLeft(deadline - now)}
          </p>
        )}

        <Stepper questions={questions} index={index} answers={answers} onGo={setIndex} />

        <div className="space-y-4">
          <h2 className="font-semibold text-foreground">
            {question.text}
            {question.required && <span className="ml-1 text-destructive" aria-hidden="true">*</span>}
          </h2>
          {question.hint && <p className="text-sm text-muted-foreground">{question.hint}</p>}
          {question.type === 'multiple' && (
            <p className="text-xs text-muted-foreground">Можно выбрать несколько вариантов.</p>
          )}

          <fieldset className="space-y-1">
            <legend className="sr-only">{question.text}</legend>
            {(question.options || []).map((option) => {
              const checked = (answers[question.id] || []).includes(option.id);
              return (
                <label
                  key={option.id}
                  className={cn(
                    'flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 transition-colors',
                    checked ? 'bg-accent' : 'hover:bg-muted/60'
                  )}
                >
                  <input
                    type={question.type === 'multiple' ? 'checkbox' : 'radio'}
                    name={`q-${question.id}`}
                    checked={checked}
                    onChange={() => toggle(question, option.id)}
                    className="h-4 w-4 accent-[hsl(var(--primary))]"
                  />
                  <span className="text-sm text-foreground">{option.text}</span>
                </label>
              );
            })}
          </fieldset>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-4">
          <Button
            variant="outline"
            onClick={() => setIndex((i) => Math.max(0, i - 1))}
            disabled={index === 0}
          >
            <ArrowLeft className="mr-1 h-4 w-4" aria-hidden="true" /> Назад
          </Button>

          {isLast ? (
            <Button onClick={submit} disabled={submitMutation.isPending}>
              {submitMutation.isPending ? 'Отправляю…' : 'Завершить тест'}
            </Button>
          ) : (
            <Button onClick={() => setIndex((i) => Math.min(questions.length - 1, i + 1))}>
              Далее <ArrowRight className="ml-1 h-4 w-4" aria-hidden="true" />
            </Button>
          )}
        </div>

        {isLast && unanswered.length > 0 && (
          <p className="flex items-center justify-end gap-1.5 text-sm text-warning">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            Без ответа: {unanswered.length}. Они будут засчитаны как неверные.
          </p>
        )}
      </div>
    </Shell>
  );
}

/**
 * Оболочка экрана теста.
 *
 * ВАЖНО: объявлена на уровне модуля, а не внутри компонента. Вложенное
 * объявление пересоздаёт тип при каждом рендере, React размонтирует поддерево,
 * и поле теряет фокус после каждого нажатия клавиши — ровно эта ошибка уже
 * ломала форму регистрации по приглашению.
 */
function Shell({ title, children }) {
  const goFullscreen = () => {
    const el = document.documentElement;
    if (document.fullscreenElement) document.exitFullscreen?.();
    else el.requestFullscreen?.();
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="flex items-center justify-between gap-4 bg-foreground px-6 py-4 text-background">
        <h1 className="truncate text-xl font-bold">{title}</h1>
        <Button
          variant="ghost"
          size="sm"
          onClick={goFullscreen}
          className="text-background hover:bg-background/10 hover:text-background"
        >
          <Maximize2 className="mr-1 h-4 w-4" aria-hidden="true" /> Весь экран
        </Button>
      </header>
      <main className="p-6">{children}</main>
    </div>
  );
}
