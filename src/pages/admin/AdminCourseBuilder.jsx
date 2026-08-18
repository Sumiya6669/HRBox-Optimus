import React, { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, Plus, Trash2, ChevronUp, ChevronDown, Save, Video, FileText, Link2,
  ClipboardCheck, GraduationCap, Users, CheckCircle2, Percent, Info, Pencil,
} from 'lucide-react';

import { api } from '@/api/client';
import PageContainer from '@/components/common/PageContainer';
import EmptyState from '@/components/common/EmptyState';
import ErrorState from '@/components/common/ErrorState';
import MediaUpload from '@/components/common/MediaUpload';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { mutationErrorMessage } from '@/lib/dataErrors';
import { formatNumber } from '@/lib/format';
import { useFormDraft } from '@/lib/useFormDraft';
import { cn } from '@/lib/utils';

/**
 * Конструктор курса: уроки, материалы и итоговый тест.
 *
 * Раньше курс был карточкой с описанием — наполнять его было нечем. Здесь
 * собирается программа: уроки с видео, документами или текстом, и тест с
 * порогом сдачи, ограничением времени и числом попыток.
 *
 * Видео грузится ФАЙЛОМ в хранилище портала. Ссылка на внешний ролик — чужая
 * инфраструктура: его переименуют или закроют доступ, и обязательный курс
 * молча перестанет открываться.
 */

const LESSON_TYPES = [
  { value: 'video', label: 'Видео', icon: Video },
  { value: 'pdf', label: 'Документ', icon: FileText },
  { value: 'text', label: 'Текст', icon: FileText },
  { value: 'link', label: 'Ссылка', icon: Link2 },
];

const EMPTY_LESSON = {
  title: '', description: '', type: 'video',
  video_url: '', video_path: '', content: '', required: true,
};

function MetricCard({ icon: Icon, label, value, hint, className }) {
  return (
    <Card className="p-4">
      <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="h-4 w-4" aria-hidden="true" /> {label}
      </div>
      <div className={cn('text-2xl font-bold text-foreground', className)}>{value}</div>
      {hint && <div className="mt-1 text-[11px] text-muted-foreground">{hint}</div>}
    </Card>
  );
}

export default function AdminCourseBuilder() {
  const { id } = useParams();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [tab, setTab] = useState('lessons');
  // Черновик урока переживает перезагрузку страницы: форма длинная, и потерять
  // её из-за случайного обновления вкладки особенно обидно, когда видео уже
  // загружено. Ключ включает id курса — черновики разных курсов не смешиваются.
  const [lessonDraft, setLessonDraft, clearLessonDraft] = useFormDraft(`lesson:${id}`, null);

  /* ------------------------------------------------------------------ данные */

  const courseQuery = useQuery({
    queryKey: ['course', id],
    queryFn: () => api.entities.Course.get(id),
  });

  const lessonsQuery = useQuery({
    queryKey: ['course-lessons', id],
    queryFn: () => api.entities.CourseLesson.filter({ course_id: id }, 'position', 200),
  });

  const testQuery = useQuery({
    queryKey: ['course-test-admin', id],
    queryFn: async () => {
      const rows = await api.entities.CourseTest.filter({ course_id: id });
      return rows[0] || null;
    },
  });

  const statsQuery = useQuery({
    queryKey: ['course-stats', id],
    queryFn: () => api.rpc.courseStats(id),
  });

  const lessons = useMemo(() => lessonsQuery.data || [], [lessonsQuery.data]);
  const test = testQuery.data;
  const totals = statsQuery.data?.totals || {};

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['course-lessons', id] });
    qc.invalidateQueries({ queryKey: ['course-stats', id] });
  };

  /* ----------------------------------------------------------------- уроки */

  const saveLesson = useMutation({
    mutationFn: async (draft) => {
      const payload = {
        course_id: id,
        title: draft.title.trim(),
        description: draft.description?.trim() || null,
        type: draft.type,
        video_url: draft.video_url || null,
        video_path: draft.video_path || null,
        content: draft.content?.trim() || null,
        required: !!draft.required,
      };
      if (draft.id) return api.entities.CourseLesson.update(draft.id, payload);
      // Новый урок встаёт в конец программы: вставка в середину почти всегда
      // означает, что человек хотел именно «добавить», а не «вклинить».
      const position = (lessons[lessons.length - 1]?.position || 0) + 1;
      return api.entities.CourseLesson.create({ ...payload, position });
    },
    onSuccess: () => {
      clearLessonDraft();
      invalidate();
      toast({ title: 'Урок сохранён' });
    },
    onError: (e) => toast({
      variant: 'destructive', title: 'Не удалось сохранить урок', description: mutationErrorMessage(e),
    }),
  });

  const deleteLesson = useMutation({
    mutationFn: async (lesson) => {
      await api.entities.CourseLesson.delete(lesson.id);
      // Файл из хранилища убираем следом, иначе бакет копит «сирот»,
      // за которые проект платит местом.
      if (lesson.video_path) await api.storage.removeMedia(lesson.video_path).catch(() => {});
    },
    onSuccess: () => { invalidate(); toast({ title: 'Урок удалён' }); },
    onError: (e) => toast({
      variant: 'destructive', title: 'Не удалось удалить урок', description: mutationErrorMessage(e),
    }),
  });

  /** Перестановка уроков: меняем позиции двух соседей местами. */
  const moveLesson = useMutation({
    mutationFn: async ({ index, delta }) => {
      const a = lessons[index];
      const b = lessons[index + delta];
      if (!a || !b) return null;
      await api.entities.CourseLesson.update(a.id, { position: b.position });
      await api.entities.CourseLesson.update(b.id, { position: a.position });
      return true;
    },
    onSuccess: invalidate,
    onError: (e) => toast({
      variant: 'destructive', title: 'Не удалось изменить порядок', description: mutationErrorMessage(e),
    }),
  });

  const error = courseQuery.error || lessonsQuery.error;

  return (
    <PageContainer
      title={courseQuery.data?.title || 'Курс'}
      description="Программа курса, материалы и итоговый тест"
      width="wide"
      actions={
        <Button variant="outline" asChild>
          <Link to="/admin/courses">
            <ArrowLeft className="mr-1 h-4 w-4" aria-hidden="true" /> К списку курсов
          </Link>
        </Button>
      }
    >
      {error ? (
        <ErrorState error={error} onRetry={() => { courseQuery.refetch(); lessonsQuery.refetch(); }} />
      ) : (
        <div className="space-y-5">
          {/* Метрики прохождения — считает база по всем записям */}
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
            <MetricCard
              icon={Users} label="Записано"
              value={formatNumber(totals.enrolled || 0)}
              hint={`${formatNumber(totals.not_started || 0)} ещё не приступали`}
            />
            <MetricCard
              icon={GraduationCap} label="В процессе"
              value={formatNumber(totals.in_progress || 0)}
            />
            <MetricCard
              icon={CheckCircle2} label="Завершили"
              value={formatNumber(totals.completed || 0)}
              className="text-success"
              hint={`${totals.completion_rate || 0}% от записанных`}
            />
            <MetricCard
              icon={Percent} label="Средний прогресс"
              value={`${formatNumber(totals.avg_progress || 0)}%`}
            />
            <MetricCard
              icon={ClipboardCheck} label="Сдача теста"
              value={`${totals.pass_rate || 0}%`}
              hint={`${formatNumber(totals.passed || 0)} из ${formatNumber(totals.attempts || 0)} попыток · средний балл ${totals.avg_score || 0}%`}
            />
          </div>

          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              <TabsTrigger value="lessons" className="min-h-[40px]">
                Уроки ({formatNumber(lessons.length)})
              </TabsTrigger>
              <TabsTrigger value="test" className="min-h-[40px]">
                Итоговый тест{test ? '' : ' — не создан'}
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {tab === 'lessons' ? (
            <Card>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border p-4">
                <h2 className="font-semibold text-foreground">Программа курса</h2>
                <Button onClick={() => setLessonDraft({ ...EMPTY_LESSON })}>
                  <Plus className="mr-1 h-4 w-4" aria-hidden="true" /> Добавить урок
                </Button>
              </div>

              {lessonsQuery.isPending ? (
                <div className="space-y-2 p-4" aria-hidden="true">
                  {[0, 1, 2].map((i) => <div key={i} className="h-14 animate-pulse rounded bg-muted" />)}
                </div>
              ) : !lessons.length ? (
                <div className="p-4">
                  <EmptyState
                    icon={Video}
                    title="Уроков пока нет"
                    description="Добавьте первый урок — видео, документ или текст. Порядок уроков задаётся стрелками."
                    actionLabel="Добавить урок"
                    onAction={() => setLessonDraft({ ...EMPTY_LESSON })}
                  />
                </div>
              ) : (
                <ol className="divide-y divide-border">
                  {lessons.map((lesson, i) => {
                    const Icon = LESSON_TYPES.find((t) => t.value === lesson.type)?.icon || Video;
                    return (
                      <li key={lesson.id} className="flex items-center gap-3 p-3 hover:bg-muted/40">
                        <span className="w-7 text-right text-sm text-muted-foreground tabular-nums">{i + 1}</span>
                        <Icon className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-foreground">{lesson.title}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {LESSON_TYPES.find((t) => t.value === lesson.type)?.label}
                            {lesson.required ? ' · обязательный' : ' · необязательный'}
                            {lesson.video_url ? '' : ' · материал не прикреплён'}
                          </p>
                        </div>
                        <div className="flex shrink-0 gap-1">
                          <Button
                            variant="ghost" size="icon"
                            onClick={() => moveLesson.mutate({ index: i, delta: -1 })}
                            disabled={i === 0 || moveLesson.isPending}
                            aria-label={`Переместить «${lesson.title}» выше`}
                          >
                            <ChevronUp className="h-4 w-4" aria-hidden="true" />
                          </Button>
                          <Button
                            variant="ghost" size="icon"
                            onClick={() => moveLesson.mutate({ index: i, delta: 1 })}
                            disabled={i === lessons.length - 1 || moveLesson.isPending}
                            aria-label={`Переместить «${lesson.title}» ниже`}
                          >
                            <ChevronDown className="h-4 w-4" aria-hidden="true" />
                          </Button>
                          <Button
                            variant="ghost" size="icon"
                            onClick={() => setLessonDraft({ ...lesson })}
                            aria-label={`Редактировать «${lesson.title}»`}
                          >
                            <Pencil className="h-4 w-4" aria-hidden="true" />
                          </Button>
                          <Button
                            variant="ghost" size="icon"
                            onClick={() => deleteLesson.mutate(lesson)}
                            disabled={deleteLesson.isPending}
                            aria-label={`Удалить «${lesson.title}»`}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" aria-hidden="true" />
                          </Button>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
            </Card>
          ) : (
            <TestEditor courseId={id} test={test} onSaved={() => {
              qc.invalidateQueries({ queryKey: ['course-test-admin', id] });
              qc.invalidateQueries({ queryKey: ['course-stats', id] });
            }} />
          )}
        </div>
      )}

      {/* Диалог урока */}
      <Dialog open={!!lessonDraft} onOpenChange={(open) => !open && clearLessonDraft()}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{lessonDraft?.id ? 'Редактирование урока' : 'Новый урок'}</DialogTitle>
            <DialogDescription>
              Обязательные уроки формируют процент прохождения курса. Необязательные — дополнительные материалы.
            </DialogDescription>
          </DialogHeader>

          {lessonDraft && (
            <div className="space-y-4 py-2">
              <div>
                <Label htmlFor="lesson-title">Название урока<span className="text-destructive"> *</span></Label>
                <Input
                  id="lesson-title"
                  className="mt-1 min-h-[40px]"
                  value={lessonDraft.title}
                  onChange={(e) => setLessonDraft((d) => ({ ...d, title: e.target.value }))}
                  placeholder="Урок 1. Знакомство с Excel"
                />
              </div>

              <div>
                <Label htmlFor="lesson-desc">Описание</Label>
                <Input
                  id="lesson-desc"
                  className="mt-1 min-h-[40px]"
                  value={lessonDraft.description || ''}
                  onChange={(e) => setLessonDraft((d) => ({ ...d, description: e.target.value }))}
                />
              </div>

              <div>
                <Label htmlFor="lesson-type">Тип материала</Label>
                <select
                  id="lesson-type"
                  className="mt-1 min-h-[40px] w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={lessonDraft.type}
                  onChange={(e) => setLessonDraft((d) => ({ ...d, type: e.target.value }))}
                >
                  {LESSON_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>

              {lessonDraft.type === 'text' ? (
                <div>
                  <Label htmlFor="lesson-content">Текст урока</Label>
                  <textarea
                    id="lesson-content"
                    rows={8}
                    className="mt-1 w-full rounded-md border border-input bg-background p-3 text-sm"
                    value={lessonDraft.content || ''}
                    onChange={(e) => setLessonDraft((d) => ({ ...d, content: e.target.value }))}
                  />
                </div>
              ) : (
                <MediaUpload
                  id="lesson-media"
                  label={lessonDraft.type === 'link' ? 'Ссылка на материал' : 'Файл урока'}
                  value={lessonDraft.video_url}
                  path={lessonDraft.video_path}
                  onChange={({ url, path }) => setLessonDraft((d) => ({ ...d, video_url: url, video_path: path }))}
                />
              )}

              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={!!lessonDraft.required}
                  onCheckedChange={(v) => setLessonDraft((d) => ({ ...d, required: !!v }))}
                />
                Обязательный урок — влияет на процент прохождения
              </label>
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={clearLessonDraft}>Отмена</Button>
            <Button
              onClick={() => saveLesson.mutate(lessonDraft)}
              disabled={!lessonDraft?.title?.trim() || saveLesson.isPending}
            >
              <Save className="mr-1 h-4 w-4" aria-hidden="true" />
              {saveLesson.isPending ? 'Сохраняю…' : 'Сохранить урок'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}

/* ------------------------------------------------------------ редактор теста */

const EMPTY_QUESTION = { text: '', type: 'single', required: true, options: ['', '', '', ''], correct: [] };

function TestEditor({ courseId, test, onSaved }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  // Тот же приём для вопроса: варианты ответа набирать заново — долго.
  const [draft, setDraft, clearDraft] = useFormDraft(`question:${courseId}`, null);

  const questionsQuery = useQuery({
    queryKey: ['test-questions', test?.id],
    queryFn: () => api.entities.TestQuestion.filter({ test_id: test.id }, 'position', 200),
    enabled: !!test?.id,
  });

  // Ключ включает состав вопросов: иначе после добавления вопроса варианты
  // остались бы от прежнего набора, и новый вопрос выглядел бы пустым.
  const questionIds = (questionsQuery.data || []).map((q) => q.id).join(',');
  const optionsQuery = useQuery({
    queryKey: ['test-options', test?.id, questionIds],
    queryFn: () => api.entities.TestOption.filter(
      { question_id: questionIds.split(',') }, 'position', 1000
    ),
    enabled: !!test?.id && !!questionIds,
  });

  const questions = questionsQuery.data || [];
  const optionsByQuestion = useMemo(() => {
    const map = new Map();
    (optionsQuery.data || []).forEach((o) => {
      if (!map.has(o.question_id)) map.set(o.question_id, []);
      map.get(o.question_id).push(o);
    });
    return map;
  }, [optionsQuery.data]);

  const createTest = useMutation({
    mutationFn: () => api.entities.CourseTest.create({
      course_id: courseId,
      title: 'Итоговый тест',
      pass_score: 80,
      time_limit_minutes: 15,
      attempts_limit: 3,
    }),
    onSuccess: () => { onSaved(); toast({ title: 'Тест создан' }); },
    onError: (e) => toast({
      variant: 'destructive', title: 'Не удалось создать тест', description: mutationErrorMessage(e),
    }),
  });

  const updateTest = useMutation({
    mutationFn: (patch) => api.entities.CourseTest.update(test.id, patch),
    onSuccess: () => { onSaved(); toast({ title: 'Настройки теста сохранены' }); },
    onError: (e) => toast({
      variant: 'destructive', title: 'Не удалось сохранить', description: mutationErrorMessage(e),
    }),
  });

  const saveQuestion = useMutation({
    mutationFn: async (q) => {
      const filled = q.options.map((t, i) => ({ text: t.trim(), index: i })).filter((o) => o.text);
      if (filled.length < 2) throw new Error('Нужно минимум два варианта ответа');
      if (!q.correct.length) throw new Error('Отметьте хотя бы один верный вариант');

      let questionId = q.id;
      const payload = {
        test_id: test.id,
        text: q.text.trim(),
        type: q.type,
        required: !!q.required,
      };

      if (questionId) {
        await api.entities.TestQuestion.update(questionId, payload);
        // Варианты пересоздаём целиком: сопоставлять старые с новыми по тексту
        // ненадёжно — правка формулировки выглядела бы как удаление и добавление.
        const old = optionsByQuestion.get(questionId) || [];
        await Promise.all(old.map((o) => api.entities.TestOption.delete(o.id)));
      } else {
        const position = (questions[questions.length - 1]?.position || 0) + 1;
        const created = await api.entities.TestQuestion.create({ ...payload, position });
        questionId = created.id;
      }

      await Promise.all(filled.map((o, i) => api.entities.TestOption.create({
        question_id: questionId,
        position: i + 1,
        text: o.text,
        is_correct: q.correct.includes(o.index),
      })));
      return questionId;
    },
    onSuccess: () => {
      clearDraft();
      qc.invalidateQueries({ queryKey: ['test-questions', test?.id] });
      qc.invalidateQueries({ queryKey: ['test-options'] });
      toast({ title: 'Вопрос сохранён' });
    },
    onError: (e) => toast({
      variant: 'destructive', title: 'Не удалось сохранить вопрос', description: mutationErrorMessage(e),
    }),
  });

  const deleteQuestion = useMutation({
    mutationFn: (q) => api.entities.TestQuestion.delete(q.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['test-questions', test?.id] });
      qc.invalidateQueries({ queryKey: ['test-options'] });
      toast({ title: 'Вопрос удалён' });
    },
    onError: (e) => toast({
      variant: 'destructive', title: 'Не удалось удалить', description: mutationErrorMessage(e),
    }),
  });

  const openEdit = (q) => {
    const opts = optionsByQuestion.get(q.id) || [];
    setDraft({
      id: q.id,
      text: q.text,
      type: q.type,
      required: q.required,
      options: opts.map((o) => o.text),
      correct: opts.map((o, i) => (o.is_correct ? i : null)).filter((i) => i !== null),
    });
  };

  if (!test) {
    return (
      <Card className="p-4">
        <EmptyState
          icon={ClipboardCheck}
          title="Итогового теста нет"
          description="Создайте тест, чтобы проверять знания после прохождения уроков. Курс будет считаться завершённым только после сдачи."
          actionLabel="Создать тест"
          onAction={() => createTest.mutate()}
        />
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="space-y-4 p-4">
        <h2 className="font-semibold text-foreground">Настройки теста</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div>
            <Label htmlFor="test-title">Название</Label>
            <Input
              id="test-title" className="mt-1 min-h-[40px]" defaultValue={test.title}
              onBlur={(e) => e.target.value !== test.title && updateTest.mutate({ title: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="test-pass">Порог сдачи, %</Label>
            <Input
              id="test-pass" type="number" min={1} max={100} className="mt-1 min-h-[40px]"
              defaultValue={test.pass_score}
              onBlur={(e) => updateTest.mutate({ pass_score: Number(e.target.value) || 80 })}
            />
          </div>
          <div>
            <Label htmlFor="test-time">Ограничение времени, мин</Label>
            <Input
              id="test-time" type="number" min={1} className="mt-1 min-h-[40px]"
              defaultValue={test.time_limit_minutes ?? ''}
              placeholder="без ограничения"
              onBlur={(e) => updateTest.mutate({ time_limit_minutes: e.target.value ? Number(e.target.value) : null })}
            />
          </div>
          <div>
            <Label htmlFor="test-attempts">Кол-во попыток</Label>
            <Input
              id="test-attempts" type="number" min={1} className="mt-1 min-h-[40px]"
              defaultValue={test.attempts_limit ?? ''}
              placeholder="не ограничено"
              onBlur={(e) => updateTest.mutate({ attempts_limit: e.target.value ? Number(e.target.value) : null })}
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-5">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={test.shuffle_questions}
              onCheckedChange={(v) => updateTest.mutate({ shuffle_questions: !!v })}
            />
            Перемешивать вопросы
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={test.show_correct}
              onCheckedChange={(v) => updateTest.mutate({ show_correct: !!v })}
            />
            Показывать верные ответы после сдачи
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={test.active}
              onCheckedChange={(v) => updateTest.mutate({ active: !!v })}
            />
            Тест активен
          </label>
        </div>

        <div className="flex gap-2 rounded-lg border border-info/40 bg-info/5 p-3 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-info" aria-hidden="true" />
          <p>
            Верные ответы никогда не отправляются в браузер сотрудника — проверка идёт на сервере.
            Показ разбора после сдачи по умолчанию выключен: иначе первый сдавший разошлёт ключ остальным.
            Вопрос засчитывается только при полном совпадении ответа — частичный балл не начисляется.
          </p>
        </div>
      </Card>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border p-4">
          <h2 className="font-semibold text-foreground">Вопросы ({formatNumber(questions.length)})</h2>
          <Button onClick={() => setDraft({ ...EMPTY_QUESTION, options: ['', '', '', ''], correct: [] })}>
            <Plus className="mr-1 h-4 w-4" aria-hidden="true" /> Добавить вопрос
          </Button>
        </div>

        {!questions.length ? (
          <div className="p-4">
            <EmptyState
              compact icon={ClipboardCheck}
              title="Вопросов пока нет"
              description="Тест без вопросов сотрудникам не показывается."
            />
          </div>
        ) : (
          <ol className="divide-y divide-border">
            {questions.map((q, i) => {
              const opts = optionsByQuestion.get(q.id) || [];
              return (
                <li key={q.id} className="flex items-start gap-3 p-3 hover:bg-muted/40">
                  <span className="w-7 text-right text-sm text-muted-foreground tabular-nums">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">{q.text}</p>
                    <p className="text-xs text-muted-foreground">
                      {q.type === 'multiple' ? 'несколько верных' : 'один верный'} ·{' '}
                      {formatNumber(opts.length)} вариантов ·{' '}
                      верных: {formatNumber(opts.filter((o) => o.is_correct).length)}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(q)} aria-label={`Редактировать вопрос ${i + 1}`}>
                      <Pencil className="h-4 w-4" aria-hidden="true" />
                    </Button>
                    <Button
                      variant="ghost" size="icon"
                      onClick={() => deleteQuestion.mutate(q)}
                      disabled={deleteQuestion.isPending}
                      aria-label={`Удалить вопрос ${i + 1}`}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" aria-hidden="true" />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </Card>

      {/* Диалог вопроса */}
      <Dialog open={!!draft} onOpenChange={(open) => !open && clearDraft()}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{draft?.id ? 'Редактирование вопроса' : 'Новый вопрос'}</DialogTitle>
            <DialogDescription>
              Отметьте верные варианты галочкой слева. Пустые строки не сохраняются.
            </DialogDescription>
          </DialogHeader>

          {draft && (
            <div className="space-y-4 py-2">
              <div>
                <Label htmlFor="q-text">Текст вопроса<span className="text-destructive"> *</span></Label>
                <Input
                  id="q-text" className="mt-1 min-h-[40px]"
                  value={draft.text}
                  onChange={(e) => setDraft((d) => ({ ...d, text: e.target.value }))}
                  placeholder="С какой периодичностью выбирается «Сотрудник года»?"
                />
              </div>

              <div>
                <Label htmlFor="q-type">Тип ответа</Label>
                <select
                  id="q-type"
                  className="mt-1 min-h-[40px] w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={draft.type}
                  onChange={(e) => setDraft((d) => ({
                    ...d,
                    type: e.target.value,
                    // При переходе к одиночному ответу оставляем один верный:
                    // иначе тест стал бы несдаваемым — совпасть с двумя «верными»
                    // при одном выборе невозможно.
                    correct: e.target.value === 'single' ? d.correct.slice(0, 1) : d.correct,
                  }))}
                >
                  <option value="single">Один верный вариант</option>
                  <option value="multiple">Несколько верных вариантов</option>
                </select>
              </div>

              <div className="space-y-2">
                <Label>Варианты ответа</Label>
                {draft.options.map((opt, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Checkbox
                      checked={draft.correct.includes(i)}
                      onCheckedChange={() => setDraft((d) => {
                        const has = d.correct.includes(i);
                        if (d.type === 'single') return { ...d, correct: has ? [] : [i] };
                        return { ...d, correct: has ? d.correct.filter((x) => x !== i) : [...d.correct, i] };
                      })}
                      aria-label={`Вариант ${i + 1} верный`}
                    />
                    <Input
                      className="min-h-[40px]"
                      value={opt}
                      onChange={(e) => setDraft((d) => {
                        const options = [...d.options];
                        options[i] = e.target.value;
                        return { ...d, options };
                      })}
                      placeholder={`Вариант ${i + 1}`}
                    />
                    <Button
                      variant="ghost" size="icon"
                      onClick={() => setDraft((d) => ({
                        ...d,
                        options: d.options.filter((_, x) => x !== i),
                        correct: d.correct.filter((x) => x !== i).map((x) => (x > i ? x - 1 : x)),
                      }))}
                      disabled={draft.options.length <= 2}
                      aria-label={`Удалить вариант ${i + 1}`}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </div>
                ))}
                <Button
                  variant="outline" size="sm"
                  onClick={() => setDraft((d) => ({ ...d, options: [...d.options, ''] }))}
                >
                  <Plus className="mr-1 h-4 w-4" aria-hidden="true" /> Ещё вариант
                </Button>
              </div>
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={clearDraft}>Отмена</Button>
            <Button
              onClick={() => saveQuestion.mutate(draft)}
              disabled={!draft?.text?.trim() || saveQuestion.isPending}
            >
              <Save className="mr-1 h-4 w-4" aria-hidden="true" />
              {saveQuestion.isPending ? 'Сохраняю…' : 'Сохранить вопрос'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
