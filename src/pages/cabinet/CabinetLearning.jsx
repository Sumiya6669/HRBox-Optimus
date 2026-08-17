import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  GraduationCap,
  BookOpen,
  Search,
  Clock,
  Award,
  PlayCircle,
  FileText,
  Monitor,
  CalendarClock,
  AlertTriangle,
  ArrowRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/use-toast";
import { useAuth } from "@/lib/AuthContext";
import PageContainer from "@/components/common/PageContainer";
import EmptyState from "@/components/common/EmptyState";
import ErrorState from "@/components/common/ErrorState";
import StatusBadge from "@/components/common/StatusBadge";
import SafeImage from "@/components/common/SafeImage";
import { formatDate, formatNumber, isPast, pluralize } from "@/lib/format";

/**
 * Каталог обучения.
 * BUG-003/004/005: «Записаться» больше не мутирует общий объект курса и не инкрементит
 *   enrolled_count — запись создаётся RPC enroll_in_course (идемпотентно, на сервере).
 * BUG-049: счётчики берутся из вьюхи v_courses (агрегаты по enrollments), а не из поля таблицы.
 * Сценарий 7 аудита: кнопка заблокирована на время мутации — четыре клика больше не дают
 *   четыре записи/инкремента.
 * BUG-051: формат курса (video/pdf/scorm/quiz/html) выводится через StatusBadge.
 * BUG-071: вкладка «Библиотека» убрана — она дублировала раздел /cabinet/library.
 */

const formatIcon = { video: PlayCircle, pdf: FileText, scorm: Monitor, html: Monitor, quiz: Award };

const FILTERS = [
  { key: "all", label: "Все" },
  { key: "mandatory", label: "Обязательные" },
  { key: "mine", label: "Мои" },
  { key: "completed", label: "Завершённые" },
];

/** Опубликованные курсы с серверными агрегатами (CONVENTIONS §1: вьюха вместо таблицы). */
async function fetchCourses() {
  const { data, error } = await api.supabase
    .from("v_courses")
    .select("*")
    .eq("status", "published")
    .order("is_mandatory", { ascending: false })
    .order("title");
  if (error) throw error;
  return data || [];
}

function CoursesSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" aria-hidden="true">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <Card key={i} className="overflow-hidden animate-pulse">
          <div className="h-32 bg-muted" />
          <div className="p-4 space-y-3">
            <div className="h-4 w-40 bg-muted rounded" />
            <div className="h-3 w-full bg-muted/60 rounded" />
            <div className="h-9 w-full bg-muted/60 rounded" />
          </div>
        </Card>
      ))}
    </div>
  );
}

export default function CabinetLearning() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { employeeId, isLoadingAuth } = useAuth();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");

  const {
    data: courses,
    isLoading: coursesLoading,
    error: coursesError,
    refetch: refetchCourses,
  } = useQuery({ queryKey: ["courses-published"], queryFn: fetchCourses });

  const {
    data: enrollments,
    isLoading: enrollmentsLoading,
    error: enrollmentsError,
    refetch: refetchEnrollments,
  } = useQuery({
    queryKey: ["enrollments-me", employeeId],
    queryFn: () => api.entities.Enrollment.filter({ employee_id: employeeId }),
    enabled: !!employeeId,
  });

  /** Быстрый доступ к своей записи по курсу. */
  const enrollmentByCourse = useMemo(() => {
    const map = new Map();
    (enrollments || []).forEach((e) => {
      if (e.status !== "cancelled") map.set(e.course_id, e);
    });
    return map;
  }, [enrollments]);

  const enroll = useMutation({
    mutationFn: (courseId) => api.rpc.enroll(courseId),
    onSuccess: (result) => {
      toast({
        title: result?.already_enrolled ? "Вы уже записаны на этот курс" : "Вы записаны на курс",
        description: "Курс появился в разделе «Мои».",
      });
      // Агрегаты v_courses и список записей пересчитываются на сервере — обновляем кэш.
      qc.invalidateQueries({ queryKey: ["courses-published"] });
      qc.invalidateQueries({ queryKey: ["enrollments-me", employeeId] });
    },
    onError: (e) =>
      toast({ variant: "destructive", title: "Не удалось записаться на курс", description: e?.message }),
  });

  const list = useMemo(() => courses || [], [courses]);

  const matchesSearch = (c) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return c.title?.toLowerCase().includes(q) || c.description?.toLowerCase().includes(q);
  };

  const matchesFilter = (c, key) => {
    const enrollment = enrollmentByCourse.get(c.id);
    if (key === "mandatory") return !!c.is_mandatory;
    if (key === "mine") return !!enrollment;
    if (key === "completed") return enrollment?.status === "completed" || (enrollment?.progress ?? 0) >= 100;
    return true;
  };

  const counts = useMemo(
    () =>
      FILTERS.reduce((acc, f) => {
        acc[f.key] = list.filter((c) => matchesFilter(c, f.key)).length;
        return acc;
      }, {}),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [list, enrollmentByCourse]
  );

  const filtered = list.filter((c) => matchesSearch(c) && matchesFilter(c, filter));

  const error = coursesError || enrollmentsError;
  const isLoading = coursesLoading || (!!employeeId && enrollmentsLoading) || isLoadingAuth;

  return (
    <PageContainer
      title="Обучение"
      description="Корпоративные курсы: запись, прогресс и сроки прохождения"
    >
      <div className="space-y-5">
        {/* Учётка без карточки сотрудника — записаться нельзя (BUG-034) */}
        {!employeeId && !isLoadingAuth && (
          <div
            role="alert"
            className="flex items-start gap-3 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3"
          >
            <AlertTriangle className="w-5 h-5 text-warning shrink-0 mt-0.5" aria-hidden="true" />
            <p className="text-sm text-foreground">
              Ваша учётная запись не связана с карточкой сотрудника, обратитесь в HR — до этого запись
              на курсы недоступна.
            </p>
          </div>
        )}

        {/* BUG-071: библиотека — отдельный раздел, здесь только ссылка на него */}
        <Link
          to="/cabinet/library"
          className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Card className="p-4 flex items-center gap-3 hover:shadow-premium transition">
            <div className="w-10 h-10 rounded-lg bg-brand-library/10 flex items-center justify-center shrink-0">
              <BookOpen className="w-5 h-5 text-brand-library" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-medium text-foreground">Корпоративная библиотека</div>
              <div className="text-sm text-muted-foreground">Книги и бронирование экземпляров</div>
            </div>
            <ArrowRight className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
          </Card>
        </Link>

        <div className="flex flex-wrap items-center gap-3 justify-between">
          <div className="flex items-center gap-2 flex-wrap" role="group" aria-label="Фильтр курсов">
            {FILTERS.map((f) => (
              <Button
                key={f.key}
                size="sm"
                variant={filter === f.key ? "default" : "outline"}
                className="min-h-[40px]"
                aria-pressed={filter === f.key}
                onClick={() => setFilter(f.key)}
              >
                {f.label} ({formatNumber(counts[f.key] || 0)})
              </Button>
            ))}
          </div>
          <div className="relative w-full sm:w-64">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск курсов…"
              className="pl-9"
              aria-label="Поиск курсов"
            />
          </div>
        </div>

        {error ? (
          <ErrorState
            error={error}
            onRetry={() => {
              refetchCourses();
              if (employeeId) refetchEnrollments();
            }}
          />
        ) : isLoading ? (
          <CoursesSkeleton />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={GraduationCap}
            title={list.length === 0 ? "Курсов пока нет" : "Курсы не найдены"}
            description={
              list.length === 0
                ? "Как только HR опубликует курсы, они появятся в этом разделе."
                : "Попробуйте изменить запрос или снять фильтр."
            }
            actionLabel={list.length === 0 ? undefined : "Сбросить фильтры"}
            onAction={
              list.length === 0
                ? undefined
                : () => {
                    setSearch("");
                    setFilter("all");
                  }
            }
          />
        ) : (
          <ul role="list" className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((c) => {
              const Icon = formatIcon[c.format] || PlayCircle;
              const enrollment = enrollmentByCourse.get(c.id);
              const progress = enrollment?.progress ?? 0;
              const isDone = enrollment?.status === "completed" || progress >= 100;
              const deadlineOverdue = c.deadline && !isDone && isPast(c.deadline);
              // Блокируем только ту карточку, по которой идёт запись (сценарий 7 аудита).
              const isEnrolling = enroll.isPending && enroll.variables === c.id;

              return (
                <li key={c.id} role="listitem">
                  <Card className="overflow-hidden flex flex-col h-full hover:shadow-premium transition">
                    {/* Кликабельная карточка — ссылка, а не div с onClick (a11y) */}
                    <Link
                      to={`/cabinet/learning/${c.id}`}
                      className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {/* Обложка курса; если её нет или ссылка битая — иконка формата */}
                      <SafeImage
                        src={c.cover_url}
                        alt=""
                        className="h-32 w-full object-cover"
                        fallbackIcon={Icon}
                        fallbackClassName="bg-brand-learning/10 text-brand-learning/60"
                      />
                    </Link>
                    <div className="p-4 flex-1 flex flex-col">
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        {/* BUG-051: «scorm» и «quiz» — только человекочитаемо */}
                        <StatusBadge value={c.format} />
                        {c.is_mandatory && <Badge variant="warning">Обязательный</Badge>}
                        {c.has_certificate && (
                          <Badge variant="success">
                            <Award className="w-3 h-3 mr-1" aria-hidden="true" />
                            Сертификат
                          </Badge>
                        )}
                      </div>
                      <h3 className="font-semibold text-foreground mb-1">
                        <Link
                          to={`/cabinet/learning/${c.id}`}
                          className="hover:text-primary transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                        >
                          {c.title}
                        </Link>
                      </h3>
                      <p className="text-sm text-muted-foreground line-clamp-2 mb-3 flex-1">{c.description}</p>

                      <div className="flex items-center gap-3 text-xs text-muted-foreground mb-2 flex-wrap">
                        {c.duration_minutes ? (
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" aria-hidden="true" />
                            {pluralize(c.duration_minutes, "минута", "минуты", "минут")}
                          </span>
                        ) : null}
                        {c.category && <span>{c.category}</span>}
                        <span>{pluralize(c.enrolled_count || 0, "участник", "участника", "участников")}</span>
                      </div>

                      {/* Дедлайн: просроченный помечаем явно (BUG-024/041 — статус из даты) */}
                      {c.deadline && (
                        <div
                          className={cn(
                            "flex items-center gap-1 text-xs mb-3",
                            deadlineOverdue ? "text-destructive font-medium" : "text-muted-foreground"
                          )}
                        >
                          <CalendarClock className="w-3 h-3" aria-hidden="true" />
                          Срок: {formatDate(c.deadline)}
                          {deadlineOverdue && " · просрочен"}
                        </div>
                      )}

                      {/* Прогресс — персональный, из своей записи, а не из общего avg_progress */}
                      {enrollment && (
                        <div className="mb-3">
                          <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                            <span>Ваш прогресс</span>
                            <span className="font-medium text-foreground">{formatNumber(progress)}%</span>
                          </div>
                          <Progress value={progress} className="h-1.5" />
                        </div>
                      )}

                      {isDone ? (
                        <Button size="sm" variant="outline" className="w-full min-h-[40px]" disabled>
                          Курс пройден
                        </Button>
                      ) : enrollment ? (
                        <Button asChild size="sm" className="w-full min-h-[40px]">
                          <Link to={`/cabinet/learning/${c.id}`}>Продолжить</Link>
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          className="w-full min-h-[40px]"
                          onClick={() => enroll.mutate(c.id)}
                          disabled={!employeeId || enroll.isPending}
                        >
                          {isEnrolling ? "Записываем…" : "Записаться"}
                        </Button>
                      )}
                    </div>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </PageContainer>
  );
}
