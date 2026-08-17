import React from 'react';
import { GripVertical, Plus, Trash2, X } from 'lucide-react';

import RichTextEditor from '@/components/surveys/RichTextEditor';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

/**
 * Редактор одного вопроса опроса.
 * Структура вопроса совпадает с тем, что читает прохождение опроса в кабинете
 * (src/pages/cabinet/CabinetSurveys.jsx): { id, text, description, type, options,
 * display_variant, block_name, required }.
 *
 * BUG-051: типы вопросов и варианты отображения подписаны по-русски.
 * a11y: у каждого поля есть подпись, у иконочных кнопок — aria-label, размер ≥ 40 px.
 */

const QUESTION_TYPES = [
  { value: 'single', label: 'Один из списка' },
  { value: 'multiple', label: 'Несколько из списка' },
  { value: 'text', label: 'Свободный ответ' },
  { value: 'grid', label: 'Сетка (оценка по строкам)' },
  { value: 'rating', label: 'Оценка' },
];

const DISPLAY_VARIANTS = [
  { value: 'list', label: 'Список' },
  { value: 'dropdown', label: 'Выпадающий список' },
  { value: 'stars', label: 'Звёзды' },
  { value: 'scale', label: 'Шкала' },
];

/** Для этих типов вопроса нужны варианты ответа. */
const TYPES_WITH_OPTIONS = ['single', 'multiple', 'grid'];

export function QuestionEditor({ question, index, onChange, onDelete }) {
  const hasOptions = TYPES_WITH_OPTIONS.includes(question.type);
  const options = question.options || [];
  const fieldPrefix = `question-${question.id}`;

  const update = (patch) => onChange({ ...question, ...patch });

  const addOption = () => update({ options: [...options, ''] });
  const editOption = (i, value) => {
    const next = [...options];
    next[i] = value;
    update({ options: next });
  };
  const removeOption = (i) => update({ options: options.filter((_, j) => j !== i) });

  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2 border-b border-border pb-2">
        <GripVertical className="h-4 w-4 text-muted-foreground/40" aria-hidden="true" />
        <Badge variant="secondary">Вопрос {index + 1}</Badge>
        {question.block_name && <Badge variant="outline">{question.block_name}</Badge>}
        <div className="flex-1" />
        <div className="flex items-center gap-2">
          <Switch
            id={`${fieldPrefix}-required`}
            checked={question.required !== false}
            onCheckedChange={(value) => update({ required: value })}
            aria-label={`Вопрос ${index + 1} обязателен для ответа`}
          />
          <Label htmlFor={`${fieldPrefix}-required`} className="cursor-pointer text-xs text-muted-foreground">
            Обязательный
          </Label>
        </div>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="min-h-[40px] min-w-[40px] text-destructive hover:text-destructive"
          onClick={onDelete}
          aria-label={`Удалить вопрос ${index + 1}`}
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>

      <div>
        <Label htmlFor={`${fieldPrefix}-text`} className="text-xs">Текст вопроса *</Label>
        <RichTextEditor
          id={`${fieldPrefix}-text`}
          className="mt-1"
          value={question.text}
          onChange={(value) => update({ text: value })}
          placeholder="Введите текст вопроса"
          rows={2}
        />
      </div>

      <div>
        <Label htmlFor={`${fieldPrefix}-description`} className="text-xs">Пояснение (необязательно)</Label>
        <RichTextEditor
          id={`${fieldPrefix}-description`}
          className="mt-1"
          value={question.description}
          onChange={(value) => update({ description: value })}
          placeholder="Уточнение к вопросу"
          rows={2}
          hint={null}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <Label htmlFor={`${fieldPrefix}-type`} className="text-xs">Тип вопроса</Label>
          <select
            id={`${fieldPrefix}-type`}
            className="mt-1 w-full min-h-[40px] rounded-md border border-input bg-transparent px-3 text-sm"
            value={question.type}
            onChange={(e) => update({ type: e.target.value })}
          >
            {QUESTION_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor={`${fieldPrefix}-variant`} className="text-xs">Вариант отображения</Label>
          <select
            id={`${fieldPrefix}-variant`}
            className="mt-1 w-full min-h-[40px] rounded-md border border-input bg-transparent px-3 text-sm"
            value={question.display_variant || 'list'}
            onChange={(e) => update({ display_variant: e.target.value })}
          >
            {DISPLAY_VARIANTS.map((d) => (
              <option key={d.value} value={d.value}>{d.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <Label htmlFor={`${fieldPrefix}-block`} className="text-xs">Блок / раздел</Label>
        <Input
          id={`${fieldPrefix}-block`}
          className="mt-1 min-h-[40px]"
          value={question.block_name || ''}
          placeholder="Например: «Общие вопросы»"
          onChange={(e) => update({ block_name: e.target.value })}
        />
      </div>

      {hasOptions && (
        <fieldset>
          <legend className="text-xs font-medium text-foreground">
            {question.type === 'grid' ? 'Строки для оценки' : 'Варианты ответа'}
          </legend>
          <div className="mt-1 space-y-1.5">
            {options.map((option, i) => (
              <div key={i} className="flex gap-2">
                <Input
                  value={option}
                  className="min-h-[40px] text-sm"
                  placeholder={`Вариант ${i + 1}`}
                  aria-label={`Вариант ответа ${i + 1} на вопрос ${index + 1}`}
                  onChange={(e) => editOption(i, e.target.value)}
                />
                {options.length > 2 && (
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="min-h-[40px] min-w-[40px] text-destructive hover:text-destructive"
                    onClick={() => removeOption(i)}
                    aria-label={`Удалить вариант ${i + 1}`}
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </Button>
                )}
              </div>
            ))}
            <Button type="button" size="sm" variant="outline" className="min-h-[40px]" onClick={addOption}>
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              Добавить вариант
            </Button>
          </div>
        </fieldset>
      )}
    </div>
  );
}

export default QuestionEditor;
