import React, { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  GraduationCap, ArrowLeft, Play, FileText, Link2, CheckCircle2, Circle,
  Video, ClipboardCheck, CalendarDays, RotateCcw, Award, AlertTriangle, Lock,
} from 'lucide-react';

import { api } from '@/api/client';
import PageContainer from '@/components/common/PageContainer';
import EmptyState from '@/components/common/EmptyState';
import ErrorState from '@/components/common/ErrorState';
import SafeImage from '@/components/common/SafeImage';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/lib/AuthContext';
import { mutationErrorMessage } from '@/lib/dataErrors';
import { formatDate, formatNumber, pluralize } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * Прохождение курса: слева список уроков, справа материал.
 *
 * Раньше страница курса была карточкой с описанием и кнопкой «Записаться» —
 * ни уроков, ни материалов, ни отметки о просмотре. Прогресс был числом,
 * которое некому было посчитать.
 *
 * Теперь урок отмечается пройденным, а процент курса пересчитывает БАЗА по
 * обязательным урокам. Считать его в браузере нельзя: цифра зависела бы от
 * того, дождалась ли страница ответа, и «100 %» появлялось бы у человека,
 * который просто пролистал уроки.
 *
 * BUG-004/005/007: кнопка записи идемпотентна, состояние выводится из личной
 * записи в enrollments, а не из общего объекта курса.
 */

const LESSON_ICONS = { video: Video, pdf: FileText, text: FileText, link: Link2 };

/** Кольцо прогресса в шапке — как в макете: процент внутри круга. */
function ProgressRing({ value = 0, size = 56 }) {
  const stroke = 4;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (Math.min(100, Math.max(0, value)) / 100) * circumference;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle
          cx={size / 2} cy={size / 2} r={radius} fill="none"
          stroke="hsl(var(--border))" strokeWidth={stroke}
        />
        <circle
          cx={size / 2} cy={size / 2} r={radius} fill="none"
          stroke="hsl(var(--primary))" strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={circumference} strokeDashoffset={offset}
          className="transition-[stroke-dashoffset] duration-500"
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-xs font-semibold text-foreground">
        {Math.round(value)}%
      </span>
    </div>
  );
}

function CourseSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_1fr]" aria-hidden="true">
      <Card className="space-y-2 p-4">
        {[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-12 animate-pulse rounded bg-muted" />)}
      </Card>
      <Card className="h-96 animate-pulse bg-muted" />
    </div>
  );
}

export default function CourseDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { employeeId } = useAuth();

  const [activeId, setActiveId] = useState(null);
  const [started, setStarted] = useState(false);

  const courseQuery = useQuery({
    queryKey: ['course', id],
    queryFn: async () => {
      const { data, error } = await api.supabase.from('v_courses').select('*').eq('id', id).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const lessonsQuery = useQuery({
    queryKey: ['course-lessons', id],
    queryFn: () => api.entities.CourseLesson.filter({ course_id: id }, 'position', 200),
  });

  const testQuery = useQuery({
    queryKey: ['course-test', id],
    queryFn: async () => {
      const rows = await api.entities.CourseTest.filter({ course_id: id, active: true });
      return rows[0] || null;
    },
  });

  const progressQuery = useQuery({
    queryKey: ['lesson-progress', id, employeeId],
    queryFn: () => api.entities.LessonProgress.filter({ course_id: id, employee_id: employeeId }, null, 500),
    enabled: !!employeeId,
  });

  const enrollmentQuery = useQuery({
    queryKey: ['enrollment', id, employeeId],
    queryFn: async () => {
      const rows = await api.entities.Enrollment.filter({ course_id: id, employee_id: employeeId });
      return rows[0] || null;
    },
    enabled: !!employeeId,
  });

  const attemptsQuery = useQuery({
    queryKey: ['test-attempts', id, employeeId],
    queryFn: () => api.entities.TestAttempt.filter({ course_id: id, employee_id: employeeId }, '-started_at', 50),
    enabled: !!employeeId,
  });

  const course = courseQuery.data;
  const lessons = useMemo(() => lessonsQuery.data || [], [lessonsQuery.data]);
  const test = testQuery.data;
  const enrollment = enrollmentQuery.data;

  const doneIds = useMemo(
    () => new Set((progressQuery.data || []).filter((p) => p.status === 'completed').map((p) => p.lesson_id)),
    [progressQuery.data]
  );

  // Первый непройденный урок — на нём и открываем курс: возвращаясь через
  // неделю, человек продолжает с места остановки, а не с начала.
  useEffect(() => {
    if (activeId || !lessons.length) return;
    const next = lessons.find((l) => !doneIds.has(l.id)) || lessons[0];
    setActiveId(next.id);
  }, [lessons, doneIds, activeId]);

  useEffect(() => { setStarted(false); }, [activeId]);

  const active = lessons.find((l) => l.id === activeId) || null;
  const activeIndex = lessons.findIndex((l) => l.id === activeId);

  const requiredTotal = lessons.filter((l) => l.required).length;
  const requiredDone = lessons.filter((l) => l.required && doneIds.has(l.id)).length;
  const progress = enrollment?.progress ?? (requiredTotal ? Math.round((requiredDone / requiredTotal) * 100) : 0);

  const finishedAttempts = (attemptsQuery.data || []).filter((a) => a.finished_at);
  const bestAttempt = finishedAttempts.reduce(
    (best, a) => (!best || (a.score_percent ?? 0) > (best.score_percent ?? 0) ? a : best),
    null
  );
  const testPassed = finishedAttempts.some((a) => a.passed);
  const attemptsLeft = test?.attempts_limit == null
    ? null
    : Math.max(0, test.attempts_limit - finishedAttempts.length);

  const lessonsDone = requiredTotal > 0 && requiredDone >= requiredTotal;

  const completeMutation = useMutation({
    mutationFn: (lessonId) => api.rpc.completeLesson(lessonId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lesson-progress', id] });
      qc.invalidateQueries({ queryKey: ['enrollment', id] });
      qc.invalidateQueries({ queryKey: ['my-courses'] });
    },
    onError: (e) => toast({
      variant: 'destructive', title: 'Не удалось отметить урок', description: mutationErrorMessage(e),
    }),
  });

  const enrollMutation = useMutation({
    mutationFn: () => api.rpc.enroll(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['enrollment', id] });
      toast({ title: 'Вы записаны на курс' });
    },
    onError: (e) => toast({
      variant: 'destructive', title: 'Не удалось записаться', description: mutationErrorMessage(e),
    }),
  });

  /** Открыть урок и сразу зафиксировать начало — иначе прогресс теряется при уходе со страницы. */
  const startLesson = () => {
    setStarted(true);
    if (active && !doneIds.has(active.id)) {
      // Для видео отметка о прохождении ставится по окончании ролика (onEnded),
      // для остальных материалов — сразу: «открыл» и есть «прошёл».
      if (active.type !== 'video') completeMutation.mutate(active.id);
    }
  };

  const goNext = () => {
    if (activeIndex >= 0 && activeIndex < lessons.length - 1) setActiveId(lessons[activeIndex + 1].id);
  };

  const error = courseQuery.error || lessonsQuery.error;
  const isLoading = courseQuery.isPending || lessonsQuery.isPending;

  if (error) {
    return (
      <PageContainer title="Курс" width="wide">
        <ErrorState error={error} onRetry={() => { courseQuery.refetch(); lessonsQuery.refetch(); }} />
      </PageContainer>
    );
  }

  if (!isLoading && !course) {
    return (
      <PageContainer title="Курс" width="wide">
        <EmptyState
          icon={GraduationCap}
          title="Курс не найден"
          description="Возможно, он снят с публикации или ссылка устарела."
          actionLabel="К списку курсов"
          onAction={() => navigate('/cabinet/learning')}
        />
      </PageContainer>
    );
  }

  return (
    <PageContainer
      title={course?.title || 'Курс'}
      description={course?.description}
      width="wide"
      actions={
        <Button variant="outline" asChild>
          <Link to="/cabinet/learning">
            <ArrowLeft className="mr-1 h-4 w-4" aria-hidden="true" /> К обучению
          </Link>
        </Button>
      }
    >
      {isLoading ? (
        <CourseSkeleton />
      ) : (
        <div className="space-y-4">
          {/* Шапка курса: кольцо прогресса и статус — как в макете */}
          <Card className="flex flex-wrap items-center gap-4 p-4">
            <ProgressRing value={progress} />
            <div className="min-w-0 flex-1">
              <h2 className="truncate font-semibold text-foreground">{course?.title}</h2>
              <p className="text-sm text-muted-foreground">
                {formatNumber(requiredDone)} из {formatNumber(requiredTotal)}{' '}
                {pluralize(requiredTotal, 'обязательный урок', 'обязательных урока', 'обязательных уроков')}
                {test ? ' · есть итоговый тест' : ''}
              </p>
            </div>
            {!enrollment && (
              <Button onClick={() => enrollMutation.mutate()} disabled={enrollMutation.isPending}>
                {enrollMutation.isPending ? 'Записываю…' : 'Записаться на курс'}
              </Button>
            )}
            {enrollment?.status === 'completed' && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-success/10 px-3 py-1.5 text-sm font-medium text-success">
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Курс пройден
              </span>
            )}
          </Card>

          {!lessons.length ? (
            <EmptyState
              icon={GraduationCap}
              title="В курсе пока нет уроков"
              description="Материалы ещё готовятся. Как только их добавят, курс появится здесь целиком."
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_1fr]">
              {/* Список уроков */}
              <Card className="overflow-hidden">
                <div className="border-b border-border bg-muted/30 px-4 py-3 text-sm font-medium text-foreground">
                  Программа курса
                </div>
                <ol className="max-h-[600px] overflow-y-auto p-2">
                  {lessons.map((lesson, i) => {
                    const Icon = LESSON_ICONS[lesson.type] || Video;
                    const done = doneIds.has(lesson.id);
                    const isActive = lesson.id === activeId;
                    return (
                      <li key={lesson.id}>
                        <button
                          type="button"
                          onClick={() => setActiveId(lesson.id)}
                          aria-current={isActive ? 'true' : undefined}
                          className={cn(
                            'flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors',
                            isActive ? 'bg-accent' : 'hover:bg-muted/60'
                          )}
                        >
                          <span
                            className={cn(
                              'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border',
                              done ? 'border-success bg-success/10 text-success' : 'border-border text-muted-foreground'
                            )}
                          >
                            {done
                              ? <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                              : <Icon className="h-3.5 w-3.5" aria-hidden="true" />}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className={cn('block text-sm', isActive ? 'font-medium text-foreground' : 'text-foreground')}>
                              {String(i + 1).padStart(2, '0')}. {lesson.title}
                            </span>
                            {!lesson.required && (
                              <span className="text-xs text-muted-foreground">необязательный</span>
                            )}
                          </span>
                        </button>
                      </li>
                    );
                  })}

                  {/* Итоговый тест — последним пунктом программы */}
                  {test && (
                    <li className="mt-1 border-t border-border pt-1">
                      <button
                        type="button"
                        onClick={() => setActiveId('__test__')}
                        aria-current={activeId === '__test__' ? 'true' : undefined}
                        className={cn(
                          'flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors',
                          activeId === '__test__' ? 'bg-accent' : 'hover:bg-muted/60'
                        )}
                      >
                        <span className={cn(
                          'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border',
                          testPassed ? 'border-success bg-success/10 text-success' : 'border-border text-muted-foreground'
                        )}>
                          {testPassed
                            ? <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                            : <ClipboardCheck className="h-3.5 w-3.5" aria-hidden="true" />}
                        </span>
                        <span className="min-w-0 flex-1 text-sm text-foreground">
                          Итоговый тест
                          <span className="block text-xs text-muted-foreground">{test.title}</span>
                        </span>
                      </button>
                    </li>
                  )}
                </ol>
              </Card>

              {/* Материал урока */}
              <Card className="p-5">
                {activeId === '__test__' ? (
                  <TestPane
                    test={test}
                    courseId={id}
                    lessonsDone={lessonsDone}
                    requiredTotal={requiredTotal}
                    requiredDone={requiredDone}
                    attemptsLeft={attemptsLeft}
                    bestAttempt={bestAttempt}
                    testPassed={testPassed}
                  />
                ) : active ? (
                  <LessonPane
                    lesson={active}
                    index={activeIndex}
                    total={lessons.length}
                    done={doneIds.has(active.id)}
                    started={started}
                    onStart={startLesson}
                    onComplete={() => completeMutation.mutate(active.id)}
                    onNext={activeIndex < lessons.length - 1 ? goNext : null}
                    busy={completeMutation.isPending}
                    course={course}
                  />
                ) : null}
              </Card>
            </div>
          )}
        </div>
      )}
    </PageContainer>
  );
}

/* ------------------------------------------------------------------ урок */

function LessonPane({ lesson, index, total, done, started, onStart, onComplete, onNext, busy, course }) {
  const Icon = LESSON_ICONS[lesson.type] || Video;

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2">
        <Icon className="mt-1 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-foreground">
            {String(index + 1).padStart(2, '0')}. {lesson.title}
          </h2>
          <p className="text-xs text-muted-foreground">
            Урок {index + 1} из {total} · тип материала:{' '}
            {{ video: 'видео', pdf: 'документ', text: 'текст', link: 'ссылка' }[lesson.type] || lesson.type}
          </p>
        </div>
      </div>

      {lesson.description && <p className="text-sm text-muted-foreground">{lesson.description}</p>}

      {/* До нажатия «Начать» тяжёлое видео не грузится: иначе открытие курса на
          мобильном интернете съедало бы трафик на все уроки подряд. */}
      {!started ? (
        <div className="space-y-4">
          <div className="flex items-center justify-center rounded-lg border border-border bg-muted/40 py-10">
            {course?.cover_url
              ? <SafeImage src={course.cover_url} alt="" className="max-h-40 rounded" />
              : <Icon className="h-16 w-16 text-muted-foreground/40" aria-hidden="true" />}
          </div>
          <Button className="w-full" size="lg" onClick={onStart} disabled={busy}>
            <Play className="mr-1 h-4 w-4" aria-hidden="true" />
            {done ? 'Открыть заново' : 'Начать'}
          </Button>
        </div>
      ) : (
        <LessonContent lesson={lesson} onEnded={onComplete} />
      )}

      <dl className="grid grid-cols-2 gap-4 border-t border-border pt-4 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">Статус</dt>
          <dd className={cn('font-medium', done ? 'text-success' : 'text-foreground')}>
            {done ? 'Пройден' : 'Не пройден'}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Обязательность</dt>
          <dd className="font-medium text-foreground">
            {lesson.required ? 'Обязательный урок' : 'Необязательный'}
          </dd>
        </div>
      </dl>

      {started && (
        <div className="flex flex-wrap gap-2">
          {!done && (
            <Button variant="outline" onClick={onComplete} disabled={busy}>
              <CheckCircle2 className="mr-1 h-4 w-4" aria-hidden="true" />
              {busy ? 'Сохраняю…' : 'Отметить пройденным'}
            </Button>
          )}
          {onNext && <Button onClick={onNext}>Следующий урок</Button>}
        </div>
      )}
    </div>
  );
}

/** Сам материал: плеер, документ, текст или ссылка. */
function LessonContent({ lesson, onEnded }) {
  if (lesson.type === 'video' && lesson.video_url) {
    return (
      <video
        key={lesson.id}
        src={lesson.video_url}
        controls
        controlsList="nodownload"
        className="w-full rounded-lg bg-black"
        // Отметка ставится по факту досмотра, а не по нажатию «Начать»:
        // иначе курс закрывался бы открытием страницы.
        onEnded={onEnded}
      >
        Ваш браузер не воспроизводит видео.{' '}
        <a href={lesson.video_url} download>Скачать файл</a>
      </video>
    );
  }
  if (lesson.type === 'pdf' && lesson.video_url) {
    return (
      <object data={lesson.video_url} type="application/pdf" className="h-[600px] w-full rounded-lg border border-border">
        <p className="p-4 text-sm text-muted-foreground">
          Документ не открывается во встроенном просмотрщике.{' '}
          <a className="text-primary underline" href={lesson.video_url} target="_blank" rel="noreferrer">
            Открыть в новой вкладке
          </a>
        </p>
      </object>
    );
  }
  if (lesson.type === 'link' && lesson.video_url) {
    return (
      <Button asChild variant="outline">
        <a href={lesson.video_url} target="_blank" rel="noreferrer">
          <Link2 className="mr-1 h-4 w-4" aria-hidden="true" /> Открыть материал
        </a>
      </Button>
    );
  }
  if (lesson.content) {
    return <div className="prose prose-sm max-w-none whitespace-pre-wrap text-foreground">{lesson.content}</div>;
  }
  return (
    <EmptyState
      compact
      icon={AlertTriangle}
      title="Материал не загружен"
      description="К уроку ещё не прикрепили файл или текст. Сообщите об этом HR."
    />
  );
}

/* ------------------------------------------------------------------ тест */

function TestPane({ test, courseId, lessonsDone, requiredTotal, requiredDone, attemptsLeft, bestAttempt, testPassed }) {
  if (!test) return null;
  const noAttemptsLeft = attemptsLeft === 0;

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2">
        <ClipboardCheck className="mt-1 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
        <div>
          <h2 className="text-lg font-semibold text-foreground">{test.title}</h2>
          <p className="text-xs text-muted-foreground">Итоговый тест по курсу</p>
        </div>
      </div>

      {test.description && <p className="text-sm text-muted-foreground">{test.description}</p>}

      <dl className="grid grid-cols-2 gap-4 rounded-lg border border-border bg-muted/30 p-4 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-muted-foreground">Порог сдачи</dt>
          <dd className="font-semibold text-foreground">{test.pass_score}%</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Ограничение времени</dt>
          <dd className="font-semibold text-foreground">
            {test.time_limit_minutes ? `${test.time_limit_minutes} мин` : 'без ограничения'}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Кол-во попыток</dt>
          <dd className="font-semibold text-foreground">
            {test.attempts_limit == null ? 'не ограничено' : `осталось ${formatNumber(attemptsLeft)} из ${test.attempts_limit}`}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Лучший результат</dt>
          <dd className={cn('font-semibold', testPassed ? 'text-success' : 'text-foreground')}>
            {bestAttempt ? `${bestAttempt.score_percent}%` : '—'}
          </dd>
        </div>
      </dl>

      {testPassed && (
        <div className="flex items-center gap-2 rounded-lg border border-success/40 bg-success/5 p-3 text-sm text-foreground">
          <Award className="h-5 w-5 shrink-0 text-success" aria-hidden="true" />
          Тест сдан {bestAttempt?.finished_at ? `· ${formatDate(bestAttempt.finished_at, 'long')}` : ''}
        </div>
      )}

      {/* Тест открывается только после уроков: иначе «проверка знаний»
          проверяет способность угадывать, а не то, что человек изучил. */}
      {!lessonsDone ? (
        <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/5 p-3 text-sm text-muted-foreground">
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
          <span>
            Тест откроется после прохождения всех обязательных уроков — сейчас пройдено{' '}
            <strong className="text-foreground">{requiredDone} из {requiredTotal}</strong>.
          </span>
        </div>
      ) : noAttemptsLeft && !testPassed ? (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-muted-foreground">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
          Попытки закончились. Обратитесь к HR, чтобы получить дополнительную.
        </div>
      ) : (
        <Button size="lg" className="w-full" asChild>
          <Link to={`/cabinet/learning/${courseId}/test`}>
            {testPassed
              ? <><RotateCcw className="mr-1 h-4 w-4" aria-hidden="true" /> Пройти ещё раз</>
              : <><Play className="mr-1 h-4 w-4" aria-hidden="true" /> Начать тестирование</>}
          </Link>
        </Button>
      )}

      {test.attempts_limit != null && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
          Брошенная попытка не сжигает лимит — считаются только завершённые.
        </p>
      )}
    </div>
  );
}
