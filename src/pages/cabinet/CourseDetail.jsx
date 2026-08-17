import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  GraduationCap, ChevronRight, CalendarDays, Clock, Award, Users,
  CheckCircle2, AlertTriangle, ArrowLeft, Download, Play,
} from 'lucide-react';
import { api } from '@/api/client';
import PageContainer from '@/components/common/PageContainer';
import EmptyState from '@/components/common/EmptyState';
import ErrorState from '@/components/common/ErrorState';
import StatusBadge from '@/components/common/StatusBadge';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/lib/AuthContext';
import { formatDate, formatNumber, pluralize, isPast } from '@/lib/format';

/**
 * Детальная страница курса — раздел «Детальные страницы» роадмапа.
 *
 * BUG-004/005/007: раньше «Записаться» инкрементило общий объект курса и позволяло
 * записаться повторно. Здесь кнопка идемпотентна: состояние выводится из личной
 * записи (enrollments), запись делает серверная RPC enroll_in_course.
 * BUG-049: счётчики берутся из вьюхи v_courses, а не считаются на клиенте.
 */

const PROGRESS_STEP = 5;

function CourseSkeleton() {
  return (
    <div className="space-y-4" aria-hidden="true">
      <Card className="p-6 space-y-3">
        <div className="h-7 w-2/3 rounded bg-muted animate-pulse" />
        <div className="h-4 w-1/3 rounded bg-muted animate-pulse" />
        <div className="pt-4 space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-4 rounded bg-muted animate-pulse" style={{ width: `${90 - i * 12}%` }} />
          ))}
        </div>
      </Card>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[0, 1, 2].map((i) => (
          <Card key={i} className="h-24 bg-muted animate-pulse" />
        ))}
      </div>
    </div>
  );
}

function StatTile({ icon: Icon, label, value }) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 text-muted-foreground mb-2">
        <Icon className="w-4 h-4" aria-hidden="true" />
        <span className="text-xs">{label}</span>
      </div>
      <p className="text-xl font-semibold text-foreground leading-none">{value}</p>
    </Card>
  );
}

export default function CourseDetail() {
  const { id } = useParams();
  const { employeeId } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [draftProgress, setDraftProgress] = useState(0);

  const {
    data: course,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['course-detail', id],
    queryFn: async () => {
      const { data, error: err } = await api.supabase.from('v_courses').select('*').eq('id', id).maybeSingle();
      if (err) throw err;
      return data;
    },
    enabled: !!id,
  });

  const {
    data: enrollment,
    isLoading: enrollmentLoading,
    error: enrollmentError,
    refetch: refetchEnrollment,
  } = useQuery({
    queryKey: ['enrollment', id, employeeId],
    queryFn: async () => {
      const rows = await api.entities.Enrollment.filter({ employee_id: employeeId, course_id: id }, null, 1);
      return rows?.[0] || null;
    },
    enabled: !!id && !!employeeId,
  });

  // Ползунок всегда стартует от сохранённого прогресса.
  useEffect(() => {
    setDraftProgress(enrollment?.progress ?? 0);
  }, [enrollment?.progress, enrollment?.id]);

  /** Общая инвалидация: и карточка курса (агрегаты), и личная запись, и списки. */
  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['course-detail', id] });
    qc.invalidateQueries({ queryKey: ['enrollment', id, employeeId] });
    qc.invalidateQueries({ queryKey: ['courses'] });
    qc.invalidateQueries({ queryKey: ['enrollments'] });
    qc.invalidateQueries({ queryKey: ['portal-stats'] });
  };

  const enroll = useMutation({
    mutationFn: () => api.rpc.enroll(id),
    onSuccess: (result) => {
      toast({
        title: result?.already_enrolled ? 'Вы уже записаны на курс' : 'Вы записаны на курс',
        description: 'Курс появился в разделе «Обучение».',
      });
      invalidateAll();
    },
    onError: (err) => toast({ title: 'Не удалось записаться', description: err?.message, variant: 'destructive' }),
  });

  const saveProgress = useMutation({
    mutationFn: async (value) => {
      const { data, error: err } = await api.supabase.rpc('set_enrollment_progress', {
        p_course_id: id,
        p_progress: value,
      });
      if (err) throw err;
      return data;
    },
    onSuccess: (_data, value) => {
      toast({
        title: value >= 100 ? 'Курс отмечен как пройденный' : 'Прогресс сохранён',
        description: value >= 100 ? undefined : `Текущий прогресс — ${value} %.`,
      });
      invalidateAll();
    },
    onError: (err) =>
      toast({ title: 'Не удалось сохранить прогресс', description: err?.message, variant: 'destructive' }),
  });

  const breadcrumbs = (
    <nav aria-label="Хлебные крошки" className="mb-4">
      <ol className="flex items-center gap-1.5 text-sm text-muted-foreground flex-wrap">
        <li>
          <Link to="/cabinet/learning" className="hover:text-foreground transition-colors">
            Обучение
          </Link>
        </li>
        <li aria-hidden="true">
          <ChevronRight className="w-3.5 h-3.5" />
        </li>
        <li className="text-foreground font-medium truncate max-w-[60vw]" aria-current="page">
          {course?.title || 'Курс'}
        </li>
      </ol>
    </nav>
  );

  if (error) {
    return (
      <PageContainer title="Курс" width="narrow">
        <ErrorState error={error} onRetry={refetch} />
      </PageContainer>
    );
  }

  if (isLoading) {
    return (
      <PageContainer title="Курс" width="narrow">
        <CourseSkeleton />
      </PageContainer>
    );
  }

  if (!course) {
    return (
      <PageContainer title="Курс" width="narrow">
        <EmptyState
          icon={GraduationCap}
          title="Курс не найден"
          description="Возможно, курс сняли с публикации или ссылка устарела."
          action={
            <Button asChild>
              <Link to="/cabinet/learning">
                <ArrowLeft className="w-4 h-4" aria-hidden="true" />
                Ко всем курсам
              </Link>
            </Button>
          }
        />
      </PageContainer>
    );
  }

  const progress = enrollment?.progress ?? 0;
  const isCompleted = enrollment?.status === 'completed' || progress >= 100;
  const deadlinePassed = course.deadline ? isPast(course.deadline) : false;

  return (
    <PageContainer title={course.title} documentTitle={course.title} width="narrow" breadcrumbs={breadcrumbs}>
      <Card className="p-6">
        <div className="flex flex-wrap items-center gap-2 mb-4">
          {course.format && <StatusBadge value={course.format} />}
          {course.status && <StatusBadge value={course.status} />}
          {course.is_mandatory && <StatusBadge value="high" fallback="Обязательный" />}
          {course.has_certificate && <StatusBadge value="info" fallback="С сертификатом" />}
        </div>

        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm mb-5">
          {course.category && (
            <div className="flex items-center gap-2">
              <dt className="text-muted-foreground">Категория:</dt>
              <dd className="text-foreground">{course.category}</dd>
            </div>
          )}
          {course.duration_minutes ? (
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
              <dt className="sr-only">Длительность</dt>
              <dd className="text-foreground">
                {pluralize(course.duration_minutes, 'минута', 'минуты', 'минут')}
              </dd>
            </div>
          ) : null}
          {course.deadline && (
            <div className="flex items-center gap-2">
              <CalendarDays className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
              <dt className="text-muted-foreground">Пройти до:</dt>
              <dd className={deadlinePassed ? 'text-destructive font-medium' : 'text-foreground'}>
                {formatDate(course.deadline, 'long')}
                {deadlinePassed && ' — срок истёк'}
              </dd>
            </div>
          )}
        </dl>

        {course.description ? (
          <div className="space-y-3 text-[15px] leading-relaxed text-muted-foreground">
            {String(course.description)
              .replace(/\r\n/g, '\n')
              .split(/\n{2,}/)
              .map((p) => p.trim())
              .filter(Boolean)
              .map((p, i) => (
                <p key={i}>{p}</p>
              ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Описание курса пока не заполнено.</p>
        )}

        {course.is_mandatory && (
          <div className="mt-5 flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
            <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" aria-hidden="true" />
            <p className="text-foreground">
              Курс обязателен к прохождению
              {course.deadline ? ` до ${formatDate(course.deadline, 'long')}.` : '.'}
            </p>
          </div>
        )}
      </Card>

      {/* --------------------------------------------------- статистика по курсу */}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
        <StatTile
          icon={Users}
          label="Записано сотрудников"
          value={formatNumber(course.enrolled_count || 0)}
        />
        <StatTile
          icon={CheckCircle2}
          label="Завершили курс"
          value={formatNumber(course.completed_count || 0)}
        />
        <StatTile icon={Award} label="Средний прогресс" value={`${formatNumber(course.avg_progress || 0)} %`} />
      </div>

      {/* ------------------------------------------------------- моя запись на курс */}

      <Card className="p-6 mt-4">
        <h2 className="text-lg font-semibold text-foreground mb-4">Моё прохождение</h2>

        {!employeeId ? (
          <EmptyState
            icon={Users}
            title="Учётная запись не связана с карточкой сотрудника"
            description="Запись на курсы доступна после того, как HR привяжет вашу учётную запись к карточке сотрудника."
            compact
          />
        ) : enrollmentError ? (
          <ErrorState error={enrollmentError} onRetry={refetchEnrollment} compact />
        ) : enrollmentLoading ? (
          <div className="h-24 rounded-lg bg-muted animate-pulse" aria-hidden="true" />
        ) : !enrollment ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Вы ещё не записаны на этот курс. Запись идемпотентна: повторное нажатие не создаст дубль.
            </p>
            <Button
              onClick={() => enroll.mutate()}
              disabled={enroll.isPending || course.status !== 'published'}
            >
              <Play className="w-4 h-4" aria-hidden="true" />
              {enroll.isPending ? 'Записываем…' : 'Записаться'}
            </Button>
            {course.status !== 'published' && (
              <p className="text-sm text-muted-foreground">
                Курс ещё не опубликован — записаться нельзя.
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge value={enrollment.status} />
              <span className="text-sm text-muted-foreground">
                Записан(а) {formatDate(enrollment.enrolled_at || enrollment.created_date)}
              </span>
              {enrollment.completed_at && (
                <span className="text-sm text-muted-foreground">
                  · завершено {formatDate(enrollment.completed_at)}
                </span>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between text-sm mb-1.5">
                <span className="text-muted-foreground">Прогресс</span>
                <span className="font-medium text-foreground">{formatNumber(progress)} %</span>
              </div>
              <Progress value={progress} aria-label={`Прогресс по курсу: ${progress} процентов`} />
            </div>

            {isCompleted ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 rounded-lg border border-success/40 bg-success/10 p-3 text-sm">
                  <CheckCircle2 className="w-4 h-4 text-success shrink-0" aria-hidden="true" />
                  <span className="text-foreground">Курс пройден полностью.</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {/* Кнопка неактивна: повторно «проходить» пройденный курс нечего (BUG-007). */}
                  <Button disabled>
                    <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                    Курс пройден
                  </Button>
                  {enrollment.certificate_url && (
                    <Button variant="outline" asChild>
                      <a href={enrollment.certificate_url} target="_blank" rel="noreferrer">
                        <Download className="w-4 h-4" aria-hidden="true" />
                        Скачать сертификат
                      </a>
                    </Button>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {/* Прогресс задаётся с шагом 5 %, а не грубыми ±25 %. */}
                <label htmlFor="progress-range" className="block text-sm font-medium text-foreground">
                  Отметить прогресс: {formatNumber(draftProgress)} %
                </label>
                <input
                  id="progress-range"
                  type="range"
                  min={0}
                  max={100}
                  step={PROGRESS_STEP}
                  value={draftProgress}
                  onChange={(e) => setDraftProgress(Number(e.target.value))}
                  className="w-full min-h-[40px] accent-primary cursor-pointer"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={draftProgress}
                  aria-valuetext={`${draftProgress} процентов`}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    onClick={() => saveProgress.mutate(draftProgress)}
                    disabled={saveProgress.isPending || draftProgress === progress}
                  >
                    {saveProgress.isPending ? 'Сохраняем…' : 'Продолжить и сохранить'}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => saveProgress.mutate(100)}
                    disabled={saveProgress.isPending}
                  >
                    <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                    Отметить пройденным
                  </Button>
                </div>
                {draftProgress === progress && (
                  <p className="text-xs text-muted-foreground">
                    Сдвиньте ползунок, чтобы сохранить новый прогресс.
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </Card>
    </PageContainer>
  );
}
