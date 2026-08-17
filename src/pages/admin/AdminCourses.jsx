import React, { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  GraduationCap, Plus, Clock, Award, Users, Pencil, Trash2, UserPlus, BarChart3,
  Search, CalendarClock, CheckCircle2, AlertTriangle,
} from 'lucide-react';
import { api } from '@/api/client';
import PageContainer from '@/components/common/PageContainer';
import EmptyState from '@/components/common/EmptyState';
import ErrorState from '@/components/common/ErrorState';
import StatusBadge from '@/components/common/StatusBadge';
import FilterChips from '@/components/common/FilterChips';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { formatDate, formatNumber, isPast, pluralize } from '@/lib/format';
import { mutationErrorMessage } from '@/lib/dataErrors';
import { cn } from '@/lib/utils';

/**
 * Администрирование учебных курсов.
 *
 * BUG-049: курс «Продукция BASF» показывал enrolled_count = 17 при 15 сотрудниках —
 *   счётчик инкрементился при каждом клике «Записаться». Хранимые поля больше не
 *   используются: читаем вьюху v_courses, где enrolled_count / completed_count /
 *   avg_progress считаются как COUNT(DISTINCT employee_id) по таблице enrollments.
 * Аудит: «Прогресс: 47 %» не объяснял методику — теперь подписано явно
 *   «Средний прогресс по записанным».
 * BUG-051: формат курса и статус — через StatusBadge, без scorm/published в интерфейсе.
 * BUG-053: даты — formatDate. BUG-072: в модалках есть «Отмена», удаление с подтверждением.
 * BUG-036: таблицы отчёта и назначения — в .table-scroll.
 * Добавлено по аудиту: назначение курса отделу/роли пачкой, дедлайн, обязательность
 *   и отчёт по прохождению.
 */

const FORMATS = ['video', 'pdf', 'scorm', 'html', 'quiz'];
const FORMAT_LABELS = {
  video: 'Видео', pdf: 'PDF', scorm: 'SCORM-курс', html: 'Веб-курс', quiz: 'Тест',
};

const STATUSES = ['draft', 'published', 'archived'];
const STATUS_LABELS = { draft: 'Черновик', published: 'Опубликован', archived: 'В архиве' };

const ROLE_TYPES = [
  { value: 'sales', label: 'Продажи' },
  { value: 'warehouse', label: 'Склад' },
  { value: 'office', label: 'Офис' },
  { value: 'hr', label: 'HR' },
  { value: 'management', label: 'Руководство' },
];

const emptyForm = () => ({
  title: '',
  description: '',
  format: 'video',
  category: '',
  duration_minutes: 60,
  has_certificate: false,
  is_mandatory: false,
  deadline: '',
  status: 'draft',
});

function validate(form) {
  const errors = {};
  if (!form.title.trim()) errors.title = 'Укажите название курса';
  else if (form.title.trim().length < 3) errors.title = 'Название слишком короткое';
  if (!form.format) errors.format = 'Выберите формат курса';
  const duration = Number(form.duration_minutes);
  if (form.duration_minutes !== '' && (!Number.isFinite(duration) || duration <= 0)) {
    errors.duration_minutes = 'Длительность должна быть больше нуля';
  }
  return errors;
}

/** Опубликованные и черновые курсы с серверными агрегатами (CONVENTIONS §1). */
async function fetchCourses() {
  const { data, error } = await api.supabase
    .from('v_courses')
    .select('*')
    .order('is_mandatory', { ascending: false })
    .order('title');
  if (error) throw error;
  return data || [];
}

function CardsSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4" aria-hidden="true">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <Card key={i} className="p-5 space-y-3 animate-pulse">
          <div className="h-10 w-10 rounded-lg bg-muted" />
          <div className="h-4 w-2/3 rounded bg-muted" />
          <div className="h-3 w-full rounded bg-muted/60" />
          <div className="h-3 w-1/2 rounded bg-muted/60" />
        </Card>
      ))}
    </div>
  );
}

export default function AdminCourses() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [touched, setTouched] = useState({});
  const [pendingDelete, setPendingDelete] = useState(null);

  const [assignCourse, setAssignCourse] = useState(null);
  const [assignDepartment, setAssignDepartment] = useState('all');
  const [assignRole, setAssignRole] = useState('all');
  const [assignSelected, setAssignSelected] = useState(() => new Set());

  const [reportCourse, setReportCourse] = useState(null);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchDraft.trim().toLowerCase()), 300);
    return () => clearTimeout(timer);
  }, [searchDraft]);

  /* --------------------------------------------------------------- данные */

  const { data: courses, isLoading, error, refetch } = useQuery({
    queryKey: ['admin-courses'],
    queryFn: fetchCourses,
  });

  const { data: employees } = useQuery({
    queryKey: ['employees-active'],
    queryFn: () => api.entities.Employee.filter({ status: ['active', 'probation', 'on_leave'] }, 'name', 1000),
  });

  const employeeById = useMemo(
    () => new Map((employees || []).map((e) => [e.id, e])),
    [employees]
  );

  const departments = useMemo(
    () => [...new Set((employees || []).map((e) => e.department).filter(Boolean))].sort(),
    [employees]
  );

  const counts = useMemo(() => {
    const map = { all: (courses || []).length, mandatory: 0 };
    STATUSES.forEach((s) => { map[s] = 0; });
    (courses || []).forEach((c) => {
      if (map[c.status] !== undefined) map[c.status] += 1;
      if (c.is_mandatory) map.mandatory += 1;
    });
    return map;
  }, [courses]);

  const filtered = useMemo(() => {
    return (courses || []).filter((c) => {
      if (status === 'mandatory' ? !c.is_mandatory : status !== 'all' && c.status !== status) return false;
      if (search && !`${c.title} ${c.category || ''}`.toLowerCase().includes(search)) return false;
      return true;
    });
  }, [courses, status, search]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['admin-courses'] });
    qc.invalidateQueries({ queryKey: ['courses'] });
    qc.invalidateQueries({ queryKey: ['course-enrollments'] });
  };

  /* -------------------------------------------------------------- мутации */

  const save = useMutation({
    mutationFn: (payload) => {
      const data = {
        title: payload.title.trim(),
        description: payload.description.trim() || null,
        format: payload.format,
        category: payload.category.trim() || null,
        duration_minutes: payload.duration_minutes === '' ? null : Number(payload.duration_minutes),
        has_certificate: payload.has_certificate,
        is_mandatory: payload.is_mandatory,
        deadline: payload.deadline || null,
        status: payload.status,
      };
      if (editing) return api.entities.Course.update(editing.id, data);
      return api.entities.Course.create(data);
    },
    onSuccess: () => {
      toast({ title: editing ? 'Курс сохранён' : 'Курс создан' });
      closeForm();
      invalidate();
    },
    onError: (err) => toast({
      title: 'Не удалось сохранить курс',
      description: mutationErrorMessage(err, { 23505: 'Курс с таким названием уже существует' }),
      variant: 'destructive',
    }),
  });

  const remove = useMutation({
    mutationFn: (course) => api.entities.Course.delete(course.id),
    onSuccess: () => {
      setPendingDelete(null);
      toast({ title: 'Курс удалён' });
      invalidate();
    },
    onError: (err) => toast({
      title: 'Не удалось удалить курс',
      description: mutationErrorMessage(err, {
        23503: 'По курсу есть связанные записи сотрудников — сначала снимите записи',
      }),
      variant: 'destructive',
    }),
  });

  /** Назначение курса пачкой: создаём персональные записи Enrollment (BUG-004). */
  const assign = useMutation({
    mutationFn: async ({ course, employeeIds }) => {
      const existing = await api.entities.Enrollment.filter({ course_id: course.id });
      const already = new Set((existing || []).map((e) => e.employee_id));
      const rows = employeeIds
        .filter((id) => !already.has(id))
        .map((id) => ({
          employee_id: id,
          course_id: course.id,
          status: 'enrolled',
          progress: 0,
        }));
      if (!rows.length) return { created: 0, skipped: employeeIds.length };
      await api.entities.Enrollment.bulkCreate(rows);
      return { created: rows.length, skipped: employeeIds.length - rows.length };
    },
    onSuccess: ({ created, skipped }) => {
      toast({
        title: created
          ? `Курс назначен: ${pluralize(created, 'сотрудник', 'сотрудника', 'сотрудников')}`
          : 'Новых записей нет',
        description: skipped
          ? `${pluralize(skipped, 'сотрудник', 'сотрудника', 'сотрудников')} уже были записаны на курс.`
          : undefined,
      });
      closeAssign();
      invalidate();
    },
    onError: (err) => toast({
      title: 'Не удалось назначить курс',
      description: mutationErrorMessage(err, {
        23505: 'Часть выбранных сотрудников уже записана на этот курс',
      }),
      variant: 'destructive',
    }),
  });

  /* ---------------------------------------------------------------- форма */

  const errors = validate(form);
  const isValid = Object.keys(errors).length === 0;
  const showError = (field) => (touched[field] ? errors[field] : undefined);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm());
    setTouched({});
    setFormOpen(true);
  };

  const openEdit = (course) => {
    setEditing(course);
    setForm({
      title: course.title || '',
      description: course.description || '',
      format: course.format || 'video',
      category: course.category || '',
      duration_minutes: course.duration_minutes ?? '',
      has_certificate: !!course.has_certificate,
      is_mandatory: !!course.is_mandatory,
      deadline: course.deadline ? formatDate(course.deadline, 'iso') : '',
      status: course.status || 'draft',
    });
    setTouched({});
    setFormOpen(true);
  };

  const closeForm = () => {
    setFormOpen(false);
    setEditing(null);
    setForm(emptyForm());
    setTouched({});
  };

  const submit = () => {
    setTouched({ title: true, format: true, duration_minutes: true });
    if (!isValid) return;
    save.mutate(form);
  };

  /* ------------------------------------------------------ назначение курса */

  const openAssign = (course) => {
    setAssignCourse(course);
    setAssignDepartment('all');
    setAssignRole('all');
    setAssignSelected(new Set());
  };

  const closeAssign = () => {
    setAssignCourse(null);
    setAssignSelected(new Set());
  };

  const assignCandidates = useMemo(() => {
    return (employees || []).filter((e) => {
      if (assignDepartment !== 'all' && e.department !== assignDepartment) return false;
      if (assignRole !== 'all' && e.role_type !== assignRole) return false;
      return true;
    });
  }, [employees, assignDepartment, assignRole]);

  const allCandidatesSelected =
    assignCandidates.length > 0 && assignCandidates.every((e) => assignSelected.has(e.id));

  /* ------------------------------------------------- отчёт по прохождению */

  const {
    data: reportRows,
    isLoading: reportLoading,
    error: reportError,
    refetch: refetchReport,
  } = useQuery({
    queryKey: ['course-enrollments', reportCourse?.id],
    queryFn: () => api.entities.Enrollment.filter({ course_id: reportCourse.id }, '-progress'),
    enabled: !!reportCourse,
  });

  const hasFilters = !!search || status !== 'all';

  return (
    <PageContainer
      title="Курсы"
      description="Каталог обучения: назначение курсов отделам, дедлайны, обязательность и отчёт по прохождению."
      width="wide"
      actions={
        <Button onClick={openCreate} className="min-h-[40px]">
          <Plus className="w-4 h-4" aria-hidden="true" />
          Новый курс
        </Button>
      }
    >
      <div className="flex flex-col lg:flex-row lg:items-center gap-3 mb-4">
        <div className="relative w-full lg:max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
          <label htmlFor="admin-courses-search" className="sr-only">Поиск по названию курса</label>
          <Input
            id="admin-courses-search"
            type="search"
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            placeholder="Поиск по названию или категории"
            className="pl-9 min-h-[40px]"
          />
        </div>
        <FilterChips
          ariaLabel="Фильтр курсов"
          value={status}
          onChange={setStatus}
          options={[
            { value: 'all', label: 'Все', count: counts.all },
            ...STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s], count: counts[s] })),
            { value: 'mandatory', label: 'Обязательные', count: counts.mandatory },
          ]}
        />
      </div>

      {error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : isLoading ? (
        <CardsSkeleton />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={GraduationCap}
          title={hasFilters ? 'Курсы не найдены' : 'Курсов пока нет'}
          description={
            hasFilters
              ? 'Измените запрос или снимите фильтр.'
              : 'Создайте первый курс: укажите формат, длительность и при необходимости дедлайн.'
          }
          actionLabel={hasFilters ? 'Сбросить фильтры' : 'Создать курс'}
          onAction={hasFilters ? () => { setSearchDraft(''); setStatus('all'); } : openCreate}
        />
      ) : (
        /* items-stretch: карточки одной высоты, даже если подписи переносятся (BUG-063) */
        <ul role="list" className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 items-stretch">
          {filtered.map((course) => {
            const enrolled = course.enrolled_count || 0;
            const completed = course.completed_count || 0;
            const avgProgress = course.avg_progress || 0;
            const overdue = course.deadline && isPast(course.deadline);
            return (
              <li key={course.id} className="h-full">
                <Card className="flex h-full flex-col p-5">
                  <div className="mb-3 flex items-start justify-between gap-2">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-learning/10 text-brand-learning">
                      <GraduationCap className="h-5 w-5" aria-hidden="true" />
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-1">
                      {course.is_mandatory && (
                        <Badge variant="destructive" className="whitespace-nowrap">Обязательный</Badge>
                      )}
                      {/* BUG-051: статус и формат — человеческие ярлыки */}
                      <StatusBadge value={course.status} />
                      <StatusBadge value={course.format} fallback="Формат не указан" />
                    </div>
                  </div>

                  <h3 className="text-base font-semibold text-foreground line-clamp-2">{course.title}</h3>
                  {course.description && (
                    <p className="mt-1 text-sm text-muted-foreground line-clamp-2">{course.description}</p>
                  )}

                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    {course.duration_minutes ? (
                      <span className="inline-flex items-center gap-1 whitespace-nowrap">
                        <Clock className="w-3.5 h-3.5" aria-hidden="true" />
                        {formatNumber(course.duration_minutes)} мин
                      </span>
                    ) : null}
                    {course.has_certificate && (
                      <span className="inline-flex items-center gap-1 whitespace-nowrap">
                        <Award className="w-3.5 h-3.5" aria-hidden="true" />
                        С сертификатом
                      </span>
                    )}
                    {course.category && <span className="truncate">{course.category}</span>}
                  </div>

                  {course.deadline && (
                    <p className={cn(
                      'mt-2 inline-flex items-center gap-1.5 text-xs whitespace-nowrap',
                      overdue ? 'text-destructive' : 'text-muted-foreground'
                    )}>
                      <CalendarClock className="w-3.5 h-3.5" aria-hidden="true" />
                      Дедлайн: {formatDate(course.deadline)}
                      {overdue && ' — просрочен'}
                    </p>
                  )}

                  <div className="mt-4 flex-1">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <Users className="w-3.5 h-3.5" aria-hidden="true" />
                        Записано: {formatNumber(enrolled)}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                        Завершили: {formatNumber(completed)}
                      </span>
                    </div>
                    {/* Аудит: цифра прогресса без методики. Подписываем, что именно посчитано. */}
                    <div className="mt-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">Средний прогресс по записанным</span>
                        <span className="font-semibold text-foreground tabular-nums">{formatNumber(avgProgress)}%</span>
                      </div>
                      <Progress
                        value={avgProgress}
                        className="mt-1"
                        aria-label={`Средний прогресс по записанным на курс «${course.title}»: ${avgProgress}%`}
                      />
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      className="min-h-[40px]"
                      onClick={() => openAssign(course)}
                      aria-label={`Назначить курс «${course.title}» сотрудникам`}
                    >
                      <UserPlus className="w-4 h-4" aria-hidden="true" />
                      Назначить
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="min-h-[40px]"
                      onClick={() => setReportCourse(course)}
                      aria-label={`Отчёт по прохождению курса «${course.title}»`}
                    >
                      <BarChart3 className="w-4 h-4" aria-hidden="true" />
                      Отчёт
                    </Button>
                    <div className="ml-auto flex items-center gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => openEdit(course)}
                        aria-label={`Редактировать курс «${course.title}»`}
                      >
                        <Pencil className="w-4 h-4" aria-hidden="true" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => setPendingDelete(course)}
                        aria-label={`Удалить курс «${course.title}»`}
                      >
                        <Trash2 className="w-4 h-4" aria-hidden="true" />
                      </Button>
                    </div>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      {/* ------------------------------------------------------ форма курса */}
      <Dialog open={formOpen} onOpenChange={(open) => (open ? setFormOpen(true) : closeForm())}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? 'Редактирование курса' : 'Новый курс'}</DialogTitle>
            <DialogDescription>
              Записи сотрудников на курс хранятся отдельно — счётчики считаются по ним и не редактируются вручную.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label htmlFor="course-title">Название *</Label>
              <Input
                id="course-title"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                onBlur={() => setTouched((t) => ({ ...t, title: true }))}
                aria-invalid={!!showError('title')}
                className="min-h-[40px]"
              />
              {showError('title') && (
                <p role="alert" className="mt-1 text-xs text-destructive">{showError('title')}</p>
              )}
            </div>

            <div>
              <Label htmlFor="course-description">Описание</Label>
              <Textarea
                id="course-description"
                rows={3}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="course-format">Формат *</Label>
                <select
                  id="course-format"
                  className="w-full min-h-[40px] rounded-md border border-input bg-background px-3 text-sm"
                  value={form.format}
                  onChange={(e) => setForm({ ...form, format: e.target.value })}
                >
                  {FORMATS.map((f) => <option key={f} value={f}>{FORMAT_LABELS[f]}</option>)}
                </select>
              </div>
              <div>
                <Label htmlFor="course-category">Категория</Label>
                <Input
                  id="course-category"
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  placeholder="Продукты, Навыки, Охрана труда"
                  className="min-h-[40px]"
                />
              </div>
              <div>
                <Label htmlFor="course-duration">Длительность, мин</Label>
                <Input
                  id="course-duration"
                  type="number"
                  min="1"
                  value={form.duration_minutes}
                  onChange={(e) => setForm({ ...form, duration_minutes: e.target.value })}
                  onBlur={() => setTouched((t) => ({ ...t, duration_minutes: true }))}
                  aria-invalid={!!showError('duration_minutes')}
                  className="min-h-[40px]"
                />
                {showError('duration_minutes') && (
                  <p role="alert" className="mt-1 text-xs text-destructive">{showError('duration_minutes')}</p>
                )}
              </div>
              <div>
                <Label htmlFor="course-deadline">Дедлайн прохождения</Label>
                <Input
                  id="course-deadline"
                  type="date"
                  value={form.deadline}
                  onChange={(e) => setForm({ ...form, deadline: e.target.value })}
                  className="min-h-[40px]"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Дата, до которой сотрудники должны завершить курс. Можно не указывать.
                </p>
              </div>
              <div>
                <Label htmlFor="course-status">Статус</Label>
                <select
                  id="course-status"
                  className="w-full min-h-[40px] rounded-md border border-input bg-background px-3 text-sm"
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value })}
                >
                  {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                </select>
                <p className="mt-1 text-xs text-muted-foreground">
                  Записаться на курс можно только после публикации.
                </p>
              </div>
              <div className="flex flex-col justify-end gap-2 pb-1">
                <div className="flex items-center gap-2 min-h-[40px]">
                  <Checkbox
                    id="course-certificate"
                    checked={form.has_certificate}
                    onCheckedChange={(v) => setForm({ ...form, has_certificate: !!v })}
                  />
                  <Label htmlFor="course-certificate" className="font-normal">Выдавать сертификат</Label>
                </div>
                <div className="flex items-center gap-2 min-h-[40px]">
                  <Checkbox
                    id="course-mandatory"
                    checked={form.is_mandatory}
                    onCheckedChange={(v) => setForm({ ...form, is_mandatory: !!v })}
                  />
                  <Label htmlFor="course-mandatory" className="font-normal">Обязательный курс</Label>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" className="min-h-[40px]" onClick={closeForm}>Отмена</Button>
            <Button className="min-h-[40px]" onClick={submit} disabled={!isValid || save.isPending}>
              {save.isPending ? 'Сохранение…' : editing ? 'Сохранить' : 'Создать'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* -------------------------------------------- назначение сотрудникам */}
      <Dialog open={!!assignCourse} onOpenChange={(open) => !open && closeAssign()}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Назначить курс</DialogTitle>
            <DialogDescription>
              «{assignCourse?.title}» — выберите отдел или роль, отметьте сотрудников. Для каждого
              создаётся персональная запись на курс; уже записанные пропускаются.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="assign-department">Отдел</Label>
              <select
                id="assign-department"
                className="w-full min-h-[40px] rounded-md border border-input bg-background px-3 text-sm"
                value={assignDepartment}
                onChange={(e) => setAssignDepartment(e.target.value)}
              >
                <option value="all">Все отделы</option>
                {departments.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div>
              <Label htmlFor="assign-role">Роль</Label>
              <select
                id="assign-role"
                className="w-full min-h-[40px] rounded-md border border-input bg-background px-3 text-sm"
                value={assignRole}
                onChange={(e) => setAssignRole(e.target.value)}
              >
                <option value="all">Все роли</option>
                {ROLE_TYPES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
          </div>

          <div className="flex items-center justify-between gap-2">
            <span className="text-sm text-muted-foreground">
              Подходит {pluralize(assignCandidates.length, 'сотрудник', 'сотрудника', 'сотрудников')},
              выбрано {formatNumber(assignSelected.size)}
            </span>
            <Button
              size="sm"
              variant="outline"
              className="min-h-[40px]"
              disabled={assignCandidates.length === 0}
              onClick={() => {
                setAssignSelected((prev) => {
                  const next = new Set(prev);
                  if (allCandidatesSelected) assignCandidates.forEach((e) => next.delete(e.id));
                  else assignCandidates.forEach((e) => next.add(e.id));
                  return next;
                });
              }}
            >
              {allCandidatesSelected ? 'Снять выделение' : 'Выбрать всех'}
            </Button>
          </div>

          <div className="table-scroll max-h-72 overflow-y-auto rounded-lg border border-border">
            {assignCandidates.length === 0 ? (
              <EmptyState
                compact
                icon={Users}
                title="Сотрудники не найдены"
                description="Снимите фильтр по отделу или роли."
              />
            ) : (
              <table className="w-full text-sm">
                <caption className="sr-only">Сотрудники для назначения курса</caption>
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th scope="col" className="px-3 py-2 w-10"><span className="sr-only">Выбор</span></th>
                    <th scope="col" className="px-3 py-2 font-medium">Сотрудник</th>
                    <th scope="col" className="px-3 py-2 font-medium">Отдел</th>
                  </tr>
                </thead>
                <tbody>
                  {assignCandidates.map((emp) => (
                    <tr key={emp.id} className="border-b border-border last:border-0">
                      <td className="px-3 py-2">
                        <Checkbox
                          checked={assignSelected.has(emp.id)}
                          onCheckedChange={() => {
                            setAssignSelected((prev) => {
                              const next = new Set(prev);
                              if (next.has(emp.id)) next.delete(emp.id);
                              else next.add(emp.id);
                              return next;
                            });
                          }}
                          aria-label={`Выбрать сотрудника ${emp.name}`}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-medium text-foreground">{emp.name}</div>
                        {emp.position && <div className="text-xs text-muted-foreground">{emp.position}</div>}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{emp.department || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" className="min-h-[40px]" onClick={closeAssign}>Отмена</Button>
            <Button
              className="min-h-[40px]"
              disabled={assignSelected.size === 0 || assign.isPending}
              onClick={() => assign.mutate({ course: assignCourse, employeeIds: [...assignSelected] })}
            >
              {assign.isPending ? 'Назначение…' : 'Назначить курс'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ------------------------------------------- отчёт по прохождению */}
      <Dialog open={!!reportCourse} onOpenChange={(open) => !open && setReportCourse(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Отчёт по прохождению</DialogTitle>
            <DialogDescription>
              «{reportCourse?.title}» · записано {formatNumber(reportCourse?.enrolled_count || 0)},
              завершили {formatNumber(reportCourse?.completed_count || 0)},
              средний прогресс по записанным — {formatNumber(reportCourse?.avg_progress || 0)}%
            </DialogDescription>
          </DialogHeader>

          {reportError ? (
            <ErrorState error={reportError} onRetry={refetchReport} compact />
          ) : reportLoading ? (
            <div className="space-y-2" aria-hidden="true">
              {[0, 1, 2, 3].map((i) => <div key={i} className="h-10 rounded bg-muted animate-pulse" />)}
            </div>
          ) : !reportRows?.length ? (
            <EmptyState
              compact
              icon={Users}
              title="На курс никто не записан"
              description="Назначьте курс отделу или роли — записи появятся в этом отчёте."
            />
          ) : (
            <div className="table-scroll max-h-96 overflow-y-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <caption className="sr-only">Записанные на курс сотрудники</caption>
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th scope="col" className="px-3 py-2 font-medium">Сотрудник</th>
                    <th scope="col" className="px-3 py-2 font-medium">Статус</th>
                    <th scope="col" className="px-3 py-2 font-medium">Прогресс</th>
                    <th scope="col" className="px-3 py-2 font-medium">Записан</th>
                    <th scope="col" className="px-3 py-2 font-medium">Завершил</th>
                  </tr>
                </thead>
                <tbody>
                  {reportRows.map((row) => {
                    const emp = employeeById.get(row.employee_id);
                    return (
                      <tr key={row.id} className="border-b border-border last:border-0">
                        <td className="px-3 py-2">
                          <div className="font-medium text-foreground">{emp?.name || 'Сотрудник портала'}</div>
                          {emp?.department && (
                            <div className="text-xs text-muted-foreground">{emp.department}</div>
                          )}
                        </td>
                        <td className="px-3 py-2"><StatusBadge value={row.status} /></td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2 min-w-[120px]">
                            <Progress value={row.progress || 0} className="w-20" aria-hidden="true" />
                            <span className="tabular-nums text-xs text-muted-foreground">
                              {formatNumber(row.progress || 0)}%
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                          {formatDate(row.enrolled_at)}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                          {row.completed_at ? formatDate(row.completed_at) : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" className="min-h-[40px]" onClick={() => setReportCourse(null)}>
              Закрыть
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ------------------------------------- подтверждение удаления курса */}
      <Dialog open={!!pendingDelete} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Удалить курс?</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2">
                <p>
                  Курс «{pendingDelete?.title}» будет удалён вместе с записями сотрудников
                  ({pluralize(pendingDelete?.enrolled_count || 0, 'запись', 'записи', 'записей')})
                  и их прогрессом. Действие нельзя отменить.
                </p>
                <p className="flex items-start gap-2 text-xs">
                  <AlertTriangle className="w-4 h-4 shrink-0 text-warning" aria-hidden="true" />
                  Если курс нужно просто скрыть — переведите его в статус «В архиве».
                </p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" className="min-h-[40px]" onClick={() => setPendingDelete(null)}>Отмена</Button>
            <Button
              variant="destructive"
              className="min-h-[40px]"
              disabled={remove.isPending}
              onClick={() => remove.mutate(pendingDelete)}
            >
              {remove.isPending ? 'Удаление…' : 'Удалить курс'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
