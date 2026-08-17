import React, { useState } from 'react';
import {
  ListChecks, Loader2, Plus, Save, Settings2, Sparkles, X,
} from 'lucide-react';

import { api } from '@/api/client';
import QuestionEditor from '@/components/surveys/QuestionEditor';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/use-toast';
import { statusLabel } from '@/lib/statusLabels';
import { cn } from '@/lib/utils';

/**
 * Конструктор опроса.
 *
 * BUG-051: тип опроса выбирается из значений check-ограничения таблицы surveys
 *   (regular / pulse / 360 / icsi), а подписи берутся из общего словаря статусов.
 *   Раньше в списке типов был «Анонимный» — такого типа в БД нет, сохранение падало
 *   с ошибкой 23514; анонимность — это отдельный флаг anonymous.
 * BUG-018: статус «Активен» недоступен, пока в опросе нет ни одного заполненного вопроса —
 *   это же требует check-ограничение surveys_active_needs_questions.
 * AI-генерация ходит в Supabase Edge Function `ai-generate`, которой может не быть:
 *   вызов обёрнут в try/catch, вместо белого экрана — понятное сообщение. Ручной сценарий
 *   создания вопросов работает без AI.
 */

/** Значения check-ограничения surveys.type. */
const SURVEY_TYPES = ['regular', 'pulse', '360', 'icsi'];
/** Значения enum survey_status. */
const SURVEY_STATUSES = ['draft', 'active', 'closed', 'archived'];

const newQuestion = (blockName = '') => ({
  id: Math.random().toString(36).slice(2, 11),
  text: '',
  description: '',
  type: 'single',
  options: ['', ''],
  display_variant: 'list',
  block_name: blockName,
  required: true,
});

const emptyForm = () => ({
  title: '',
  description: '',
  type: 'regular',
  status: 'draft',
  category: '',
  start_date: '',
  end_date: '',
  anonymous: false,
  questions: [newQuestion()],
});

/** Вопрос считается заполненным, если у него есть текст. */
const isFilled = (question) => Boolean((question.text || '').trim());

export function SurveyConstructor({ initial, onSave, onCancel, isSaving = false }) {
  const { toast } = useToast();
  const [tab, setTab] = useState('questions');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  const [errors, setErrors] = useState({});
  const [form, setForm] = useState(() => {
    if (!initial) return emptyForm();
    return {
      ...emptyForm(),
      ...initial,
      start_date: initial.start_date || '',
      end_date: initial.end_date || '',
      category: initial.category || '',
      description: initial.description || '',
      questions: Array.isArray(initial.questions) && initial.questions.length
        ? initial.questions
        : [newQuestion()],
    };
  });

  const update = (patch) => setForm((prev) => ({ ...prev, ...patch }));

  const filledQuestions = form.questions.filter(isFilled);
  const canPublish = filledQuestions.length > 0;

  const addQuestion = () => update({ questions: [...form.questions, newQuestion()] });

  const addBlock = () => {
    const name = window.prompt('Название блока вопросов:', 'Новый раздел');
    if (name) update({ questions: [...form.questions, newQuestion(name)] });
  };

  const updateQuestion = (index, question) => {
    const questions = [...form.questions];
    questions[index] = question;
    update({ questions });
  };

  const deleteQuestion = (index) => update({ questions: form.questions.filter((_, i) => i !== index) });

  /** Генерация вопросов ИИ — необязательный сценарий: функции может не быть в проекте. */
  const aiGenerate = async () => {
    if (!form.title.trim()) {
      setTab('params');
      setErrors({ title: 'Укажите название опроса — по нему генерируются вопросы' });
      return;
    }
    setAiLoading(true);
    setAiError('');
    try {
      const result = await api.integrations.Core.InvokeLLM({
        prompt: `Сгенерируй 5 вопросов для опроса типа «${form.type}» на тему «${form.title}». ${
          form.description ? `Контекст: ${form.description}.` : ''
        } Верни JSON-массив вопросов вида {text, type (single/multiple/text/rating), options}.`,
        response_json_schema: {
          type: 'object',
          properties: {
            questions: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  text: { type: 'string' },
                  type: { type: 'string' },
                  options: { type: 'array', items: { type: 'string' } },
                },
              },
            },
          },
        },
      });

      const generated = (result?.questions || []).map((q) => ({
        ...newQuestion(),
        text: q.text || '',
        type: ['single', 'multiple', 'text', 'rating'].includes(q.type) ? q.type : 'single',
        options: q.options?.length ? q.options : ['', ''],
        display_variant: q.type === 'rating' ? 'stars' : 'list',
      }));

      if (!generated.length) {
        setAiError('AI не вернул вопросов — добавьте их вручную.');
        return;
      }
      update({ questions: [...form.questions, ...generated] });
      toast({ title: `Сгенерировано ${generated.length} вопросов`, description: 'Проверьте формулировки перед сохранением.' });
    } catch (e) {
      // Функция ai-generate может быть не развёрнута — это не должно ронять конструктор.
      setAiError(
        e?.message?.includes('ai-generate')
          ? e.message
          : 'AI-генерация недоступна: функция ai-generate не развёрнута'
      );
      toast({
        variant: 'destructive',
        title: 'AI-генерация недоступна',
        description: 'Функция ai-generate не развёрнута. Добавьте вопросы вручную — это основной сценарий.',
      });
    } finally {
      setAiLoading(false);
    }
  };

  const validate = () => {
    const next = {};
    if (!form.title.trim()) next.title = 'Укажите название опроса';
    else if (form.title.trim().length < 3) next.title = 'Название слишком короткое';
    if (!SURVEY_TYPES.includes(form.type)) next.type = 'Выберите тип опроса';
    if (form.start_date && form.end_date && form.end_date < form.start_date) {
      next.end_date = 'Дата окончания не может быть раньше даты начала';
    }
    // BUG-018: активный опрос обязан содержать вопросы — иначе БД вернёт 23514.
    if (form.status === 'active' && !canPublish) {
      next.status = 'Нельзя активировать опрос без вопросов';
    }
    if (!canPublish && form.status !== 'draft') {
      next.questions = 'Добавьте хотя бы один вопрос с текстом';
    }
    setErrors(next);
    return next;
  };

  const handleSave = () => {
    const found = validate();
    if (Object.keys(found).length > 0) {
      // Переводим пользователя на вкладку, где действительно есть ошибка (BUG-025).
      if (found.title || found.type || found.status || found.end_date) setTab('params');
      else setTab('questions');
      return;
    }
    // В базу уходят только заполненные вопросы: пустые заготовки не нужны никому.
    onSave({ ...form, questions: filledQuestions });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1 border-b border-border" role="tablist" aria-label="Разделы конструктора">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'questions'}
          onClick={() => setTab('questions')}
          className={cn(
            'flex min-h-[40px] items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition -mb-px',
            tab === 'questions'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          )}
        >
          <ListChecks className="w-4 h-4" aria-hidden="true" />
          Вопросы
          <Badge variant="secondary">{form.questions.length}</Badge>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'params'}
          onClick={() => setTab('params')}
          className={cn(
            'flex min-h-[40px] items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition -mb-px',
            tab === 'params'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          )}
        >
          <Settings2 className="w-4 h-4" aria-hidden="true" />
          Параметры
        </button>
      </div>

      {tab === 'questions' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" className="min-h-[40px]" onClick={addQuestion}>
              <Plus className="w-4 h-4" aria-hidden="true" />
              Добавить вопрос
            </Button>
            <Button type="button" size="sm" variant="outline" className="min-h-[40px]" onClick={addBlock}>
              <Plus className="w-4 h-4" aria-hidden="true" />
              Добавить блок
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="min-h-[40px]"
              onClick={aiGenerate}
              disabled={aiLoading}
              aria-label="Сгенерировать вопросы с помощью AI"
            >
              {aiLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
              ) : (
                <Sparkles className="w-4 h-4" aria-hidden="true" />
              )}
              Сгенерировать (AI)
            </Button>
          </div>

          {aiError && (
            <p role="alert" className="rounded-lg bg-destructive/5 p-2 text-sm text-destructive">
              {aiError}
            </p>
          )}
          {errors.questions && (
            <p role="alert" className="text-sm text-destructive">{errors.questions}</p>
          )}

          <div className="max-h-[50vh] space-y-3 overflow-y-auto pr-1">
            {form.questions.map((question, index) => (
              <QuestionEditor
                key={question.id}
                question={question}
                index={index}
                onChange={(next) => updateQuestion(index, next)}
                onDelete={() => deleteQuestion(index)}
              />
            ))}
            {form.questions.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Вопросов нет. Добавьте первый вопрос — без вопросов опрос нельзя активировать.
              </p>
            )}
          </div>
        </div>
      )}

      {tab === 'params' && (
        <div className="space-y-4">
          <div>
            <Label htmlFor="survey-title">Название опроса *</Label>
            <Input
              id="survey-title"
              className="mt-1 min-h-[40px]"
              value={form.title}
              placeholder="Например: Удовлетворённость условиями труда"
              aria-invalid={errors.title ? 'true' : undefined}
              aria-describedby={errors.title ? 'survey-title-error' : undefined}
              onChange={(e) => update({ title: e.target.value })}
            />
            {errors.title && (
              <p id="survey-title-error" role="alert" className="mt-1 text-xs text-destructive">
                {errors.title}
              </p>
            )}
          </div>

          <div>
            <Label htmlFor="survey-description">Описание</Label>
            <Textarea
              id="survey-description"
              className="mt-1"
              rows={2}
              value={form.description}
              placeholder="Цель и контекст опроса — их увидит сотрудник"
              onChange={(e) => update({ description: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label htmlFor="survey-type">Тип опроса</Label>
              <select
                id="survey-type"
                className="mt-1 w-full min-h-[40px] rounded-md border border-input bg-transparent px-3 text-sm"
                value={form.type}
                onChange={(e) => update({ type: e.target.value })}
              >
                {SURVEY_TYPES.map((value) => (
                  <option key={value} value={value}>{statusLabel(value)}</option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="survey-category">Категория</Label>
              <Input
                id="survey-category"
                className="mt-1 min-h-[40px]"
                value={form.category}
                placeholder="HR, обучение, культура"
                onChange={(e) => update({ category: e.target.value })}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label htmlFor="survey-start">Дата начала</Label>
              <Input
                id="survey-start"
                type="date"
                className="mt-1 min-h-[40px]"
                value={form.start_date}
                onChange={(e) => update({ start_date: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="survey-end">Дата окончания</Label>
              <Input
                id="survey-end"
                type="date"
                className="mt-1 min-h-[40px]"
                value={form.end_date}
                aria-invalid={errors.end_date ? 'true' : undefined}
                onChange={(e) => update({ end_date: e.target.value })}
              />
              {errors.end_date && (
                <p role="alert" className="mt-1 text-xs text-destructive">{errors.end_date}</p>
              )}
              {/* BUG-019: после этой даты опрос считается завершённым автоматически */}
              <p className="mt-1 text-xs text-muted-foreground">
                После этой даты опрос автоматически считается завершённым.
              </p>
            </div>
          </div>

          <div>
            <Label htmlFor="survey-status">Статус</Label>
            <select
              id="survey-status"
              className="mt-1 w-full min-h-[40px] rounded-md border border-input bg-transparent px-3 text-sm"
              value={form.status}
              aria-invalid={errors.status ? 'true' : undefined}
              aria-describedby={!canPublish ? 'survey-status-hint' : undefined}
              onChange={(e) => update({ status: e.target.value })}
            >
              {SURVEY_STATUSES.map((value) => (
                <option key={value} value={value} disabled={value === 'active' && !canPublish}>
                  {statusLabel(value)}
                </option>
              ))}
            </select>
            {!canPublish && (
              <p id="survey-status-hint" className="mt-1 text-xs text-muted-foreground">
                Нельзя активировать опрос без вопросов — сначала добавьте хотя бы один вопрос с текстом.
              </p>
            )}
            {errors.status && (
              <p role="alert" className="mt-1 text-xs text-destructive">{errors.status}</p>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Switch
              id="survey-anonymous"
              checked={!!form.anonymous}
              onCheckedChange={(value) => update({ anonymous: value })}
              aria-label="Анонимный опрос"
            />
            <Label htmlFor="survey-anonymous" className="cursor-pointer text-sm">
              Анонимный опрос — ответы не привязываются к сотруднику
            </Label>
          </div>
        </div>
      )}

      {/* BUG-072: «Отмена» — явная кнопка, а не только крестик */}
      <div className="flex items-center justify-between border-t border-border pt-3">
        <Button type="button" variant="outline" className="min-h-[40px]" onClick={onCancel}>
          <X className="w-4 h-4" aria-hidden="true" />
          Отмена
        </Button>
        <Button
          type="button"
          className="min-h-[40px]"
          onClick={handleSave}
          disabled={!form.title.trim() || isSaving}
        >
          <Save className="w-4 h-4" aria-hidden="true" />
          {isSaving ? 'Сохранение…' : 'Сохранить'}
        </Button>
      </div>
    </div>
  );
}

export default SurveyConstructor;
