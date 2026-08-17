import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, ArrowDown, ArrowLeft, ArrowUp, Check, CornerDownRight, Eye, GitBranch,
  Info, Layers, ListTree, Plus, Save, Tags, Trash2, X,
} from 'lucide-react';

import { api } from '@/api/client';
import PageContainer from '@/components/common/PageContainer';
import ErrorState from '@/components/common/ErrorState';
import EmptyState from '@/components/common/EmptyState';
import StatusBadge from '@/components/common/StatusBadge';
import ImageUpload from '@/components/common/ImageUpload';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { ROLE_LABELS } from '@/lib/AuthContext';
import { PROCESS_FIELD_TYPES, PROCESS_STAGE_TYPES } from '@/lib/statusLabels';
import { formatNumber, pluralize } from '@/lib/format';
import { mutationErrorMessage } from '@/lib/dataErrors';

/**
 * Конструктор бизнес-процесса.
 *
 * Процесс собирается локально и сохраняется одной явной кнопкой «Сохранить»:
 * иначе каждое нажатие на стрелку «вверх» било бы в базу и оставляло процесс
 * в полусобранном состоянии, а сотрудники видели бы черновик в каталоге.
 *
 * Тонкие места, ради которых здесь столько кода:
 *  • process_stages имеет unique (process_id, sort_order) deferrable initially deferred.
 *    PostgREST шлёт каждый запрос отдельной транзакцией, поэтому «обмен местами»
 *    двух этапов в лоб даёт 23505. Порядок пишется в два прохода: сначала все
 *    существующие этапы уезжают в свободный диапазон, затем получают финальные номера.
 *  • process_routes_target_valid: у маршрута «Следующий этап» цель обязательна,
 *    у «Считать отклонённой»/«Считать решённой» цели быть не должно.
 *  • process_routes_no_self_loop: этап не может ссылаться сам на себя.
 *  • assignee_ids / watcher_ids — это profiles.id (учётные записи), а не employees.id.
 *
 * Баллы живут в вариантах ответа поля: {"value":…,"label":…,"points":15}.
 * Именно они делают начисление автоматическим — движок берёт стоимость выбранного
 * варианта при закрытии заявки, руками в кошельке ничего вводить не нужно.
 */

/* ------------------------------------------------------------- константы */

const SECTIONS = [
  { id: 'description', label: 'Описание', icon: Info },
  { id: 'stages', label: 'Этапы процесса', icon: Layers },
  { id: 'categories', label: 'Категории процесса', icon: Tags },
  { id: 'visibility', label: 'Видимость полей', icon: Eye },
  { id: 'diagram', label: 'Диаграмма', icon: GitBranch },
];

const ROLE_OPTIONS = [
  { value: '', label: 'Не задано' },
  ...Object.entries(ROLE_LABELS).map(([value, label]) => ({ value, label })),
];

const ROUTE_KINDS = {
  next: 'Следующий этап',
  reject: 'При отклонении',
  resolve: 'Считать решённой',
};

/** Цвет номера этапа: сбор — синий, согласование — жёлтый, исполнение — зелёный. */
const STAGE_TONE = {
  collect: 'bg-blue-500/15 text-blue-600 border-blue-500/40',
  approve: 'bg-yellow-500/20 text-yellow-700 border-yellow-500/40',
  execute: 'bg-green-500/15 text-green-600 border-green-500/40',
};

const SELECT_CLS =
  'min-h-[40px] w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus:border-primary/40';

/** Типы этапов, на которых заполняются поля ввода. */
const FIELD_STAGES = ['collect', 'execute'];
/** Типы этапов, у которых есть ответственные и наблюдатели. */
const ACTOR_STAGES = ['approve', 'execute'];
const OPTION_TYPES = ['select', 'multiselect'];

/* -------------------------------------------------------------- утилиты */

let tempCounter = 0;
/** Временный идентификатор новой записи — в базу он не попадает. */
const tempId = (prefix) => `new-${prefix}-${++tempCounter}`;
const isNew = (id) => typeof id === 'string' && id.startsWith('new-');

/** Уникальный код варианта: движок сверяет value_text со значением `value`. */
const optionValue = () => `opt_${Math.random().toString(36).slice(2, 10)}`;

const personLabel = (user) => user?.full_name || user?.email || 'Без имени';

/** Проекция ответа сервера в редактируемое состояние конструктора. */
function buildDraft(data) {
  const { process, stages, fields, routes, categories } = data;
  return {
    process: {
      id: process.id,
      name: process.name || '',
      description: process.description || '',
      image_url: process.image_url || '',
      image_path: process.image_path || '',
      is_active: !!process.is_active,
      allow_category_choice: !!process.allow_category_choice,
      visible_to_role: process.visible_to_role || '',
    },
    stages: stages.map((stage, index) => ({
      id: stage.id,
      name: stage.name || '',
      type: stage.type || 'collect',
      sort_order: index,
      assignee_ids: stage.assignee_ids || [],
      watcher_ids: stage.watcher_ids || [],
      assignee_role: stage.assignee_role || '',
      watcher_role: stage.watcher_role || '',
      approve_by_manager: !!stage.approve_by_manager,
      deadline_hours: stage.deadline_hours ?? null,
      fields: fields
        .filter((f) => f.stage_id === stage.id)
        .map((f, i) => ({
          id: f.id,
          label: f.label || '',
          type: f.type || 'text',
          required: !!f.required,
          options: Array.isArray(f.options) ? f.options : [],
          visible_to_role: f.visible_to_role || '',
          sort_order: i,
        })),
      routes: routes
        .filter((r) => r.stage_id === stage.id)
        .map((r, i) => ({
          id: r.id,
          kind: r.kind,
          target_stage_id: r.target_stage_id || '',
          require_comment: !!r.require_comment,
          sort_order: i,
        })),
    })),
    categories: categories.map((c, index) => ({
      id: c.id,
      name: c.name || '',
      description: c.description || '',
      is_active: c.is_active ?? true,
      sort_order: index,
    })),
  };
}

/** Перестановка элемента массива с пересчётом номеров. */
function moveItem(list, index, direction) {
  const target = index + direction;
  if (target < 0 || target >= list.length) return list;
  const next = [...list];
  [next[index], next[target]] = [next[target], next[index]];
  return next.map((item, i) => ({ ...item, sort_order: i }));
}

/** Проблемы настройки: их список показываем и не даём с ними публиковать процесс. */
function collectProblems(draft) {
  if (!draft) return [];
  const problems = [];
  if (!draft.process.name.trim()) problems.push('Укажите название процесса.');
  if (!draft.stages.length) {
    problems.push('В процессе должен быть хотя бы один этап.');
    return problems;
  }

  draft.stages.forEach((stage, index) => {
    const title = `Этап ${index + 1}${stage.name.trim() ? ` «${stage.name.trim()}»` : ''}`;
    if (!stage.name.trim()) problems.push(`${title}: укажите название этапа.`);

    if (ACTOR_STAGES.includes(stage.type)) {
      const hasActor =
        (stage.assignee_ids?.length || 0) > 0 || !!stage.assignee_role || stage.approve_by_manager;
      if (!hasActor) {
        problems.push(
          `${title}: назначьте ответственных, группу ответственных или согласование руководителем — иначе заявка встанет.`
        );
      }
    }

    stage.fields.forEach((field) => {
      const fieldTitle = field.label.trim() ? `«${field.label.trim()}»` : 'без названия';
      if (!field.label.trim()) problems.push(`${title}: у поля ввода не заполнено название.`);
      if (OPTION_TYPES.includes(field.type) && !field.options.length) {
        problems.push(`${title}: у поля ${fieldTitle} нет ни одного варианта ответа.`);
      }
    });

    const isLast = index === draft.stages.length - 1;
    if (!isLast && !stage.routes.length) {
      problems.push(`${title}: добавьте маршрут — иначе заявка не пойдёт дальше.`);
    }

    stage.routes.forEach((route) => {
      if (route.kind === 'next' && !route.target_stage_id) {
        problems.push(`${title}: у маршрута «Следующий этап» не выбран целевой этап.`);
      }
      if (route.kind === 'next' && route.target_stage_id === stage.id) {
        problems.push(`${title}: маршрут ссылается на сам этап — выберите другой целевой этап.`);
      }
    });
  });

  draft.categories.forEach((category, index) => {
    if (!category.name.trim()) problems.push(`Категория ${index + 1}: укажите название.`);
  });

  return problems;
}

/** Понятный текст серверной ошибки сохранения. */
function saveErrorMessage(error) {
  const raw = String(error?.message || '');
  if (raw.includes('process_routes_target_valid')) {
    return 'Маршрут «Следующий этап» обязан указывать целевой этап, а «Считать отклонённой» и «Считать решённой» цели иметь не должны.';
  }
  if (raw.includes('process_routes_no_self_loop')) {
    return 'Этап не может ссылаться сам на себя — выберите другой целевой этап.';
  }
  return mutationErrorMessage(error, {
    23505: 'Конфликт порядка этапов. Обновите страницу и повторите перестановку.',
    23514: 'Значение не проходит проверку базы данных — проверьте маршруты и дедлайны этапов.',
    42501: 'Менять конструктор процессов могут только HR-специалист и администратор.',
  });
}

/* ---------------------------------------------------------- подкомпоненты */

/** Выбор роли (группы) — пустое значение означает «не задано». */
function RoleSelect({ id, label, value, onChange, hint }) {
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <select id={id} className={SELECT_CLS} value={value || ''} onChange={(e) => onChange(e.target.value)}>
        {ROLE_OPTIONS.map((option) => (
          <option key={option.value || 'none'} value={option.value}>{option.label}</option>
        ))}
      </select>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Мультивыбор учётных записей: assignee_ids и watcher_ids хранят profiles.id. */
function PeoplePicker({ id, label, users, value, onChange, hint }) {
  const [query, setQuery] = useState('');
  const selected = value || [];
  const byId = useMemo(() => new Map((users || []).map((u) => [u.id, u])), [users]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = (users || []).filter((u) => {
      if (!q) return true;
      return personLabel(u).toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q);
    });
    return list.slice(0, 60);
  }, [users, query]);

  const toggle = (userId) => {
    onChange(selected.includes(userId) ? selected.filter((v) => v !== userId) : [...selected, userId]);
  };

  return (
    <div>
      <Label htmlFor={`${id}-search`}>{label}</Label>

      {selected.length > 0 && (
        <ul role="list" className="mb-2 mt-1 flex flex-wrap gap-1.5">
          {selected.map((userId) => (
            <li key={userId} role="listitem">
              <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/60 py-1 pl-2 pr-1 text-xs">
                {personLabel(byId.get(userId)) || 'Удалённая учётная запись'}
                <button
                  type="button"
                  className="rounded-full p-0.5 text-muted-foreground hover:text-destructive"
                  aria-label={`Убрать ${personLabel(byId.get(userId))}`}
                  onClick={() => toggle(userId)}
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <Input
        id={`${id}-search`}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Поиск по имени или email"
        className="min-h-[40px]"
      />

      <div className="mt-2 max-h-44 overflow-y-auto rounded-md border border-border">
        {visible.length === 0 ? (
          <p className="px-3 py-2 text-xs text-muted-foreground">Никого не найдено</p>
        ) : (
          visible.map((user) => (
            <label
              key={user.id}
              className="flex min-h-[40px] cursor-pointer items-center gap-2 border-b border-border/60 px-3 py-1.5 text-sm last:border-b-0 hover:bg-muted/50"
            >
              <Checkbox
                checked={selected.includes(user.id)}
                onCheckedChange={() => toggle(user.id)}
                aria-label={`Выбрать ${personLabel(user)}`}
              />
              <span className="min-w-0 flex-1 truncate">{personLabel(user)}</span>
              {user.role && <StatusBadge value={user.role} className="text-[10px]" />}
            </label>
          ))
        )}
      </div>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Редактор вариантов ответа с баллами — сердце автоматического начисления. */
function OptionsEditor({ field, onPatch }) {
  const [draftLabel, setDraftLabel] = useState('');

  const patchOption = (index, patch) => {
    onPatch({ options: field.options.map((o, i) => (i === index ? { ...o, ...patch } : o)) });
  };

  const addOption = () => {
    const label = draftLabel.trim();
    if (!label) return;
    onPatch({ options: [...field.options, { value: optionValue(), label, points: 0 }] });
    setDraftLabel('');
  };

  return (
    <div className="rounded-lg border border-dashed border-border bg-muted/30 p-3">
      <p className="mb-2 text-xs font-medium text-foreground">Варианты ответа</p>

      {field.options.length === 0 ? (
        <p className="mb-2 text-xs text-destructive" role="alert">
          Нужен хотя бы один вариант, иначе поле нечем заполнить.
        </p>
      ) : (
        <ul role="list" className="mb-2 space-y-1.5">
          {field.options.map((option, index) => (
            <li key={option.value || index} role="listitem" className="flex flex-wrap items-center gap-2">
              <span className="inline-flex flex-1 min-w-48 items-center gap-1 rounded-full border border-border bg-background py-1 pl-1 pr-2">
                <button
                  type="button"
                  className="rounded-full p-1 text-muted-foreground hover:text-destructive"
                  aria-label={`Удалить вариант «${option.label}»`}
                  onClick={() => onPatch({ options: field.options.filter((_, i) => i !== index) })}
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
                <input
                  value={option.label || ''}
                  onChange={(e) => patchOption(index, { label: e.target.value })}
                  aria-label={`Текст варианта ${index + 1}`}
                  className="w-full bg-transparent text-sm outline-none"
                  placeholder="Текст варианта"
                />
              </span>
              <span className="flex items-center gap-1.5">
                <Label htmlFor={`opt-points-${field.id}-${index}`} className="text-xs text-muted-foreground">
                  Баллы
                </Label>
                <Input
                  id={`opt-points-${field.id}-${index}`}
                  type="number"
                  inputMode="numeric"
                  value={option.points ?? 0}
                  onChange={(e) =>
                    patchOption(index, { points: e.target.value === '' ? 0 : Number(e.target.value) })
                  }
                  className="min-h-[40px] w-24"
                />
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={draftLabel}
          onChange={(e) => setDraftLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addOption();
            }
          }}
          placeholder="Например: предложение идеи для контента"
          aria-label="Текст нового варианта"
          className="min-h-[40px] flex-1 min-w-48"
        />
        <Button type="button" variant="outline" size="sm" className="min-h-[40px]" onClick={addOption} disabled={!draftLabel.trim()}>
          <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
          Добавить вариант
        </Button>
      </div>

      <p className="mt-2 text-xs text-muted-foreground">
        Баллы варианта начислятся автоматически при закрытии заявки.
      </p>
    </div>
  );
}

/** Карточка одного этапа: название, тип, поля ввода, ответственные, маршруты. */
function StageCard({ stage, index, stages, users, handlers, allowCategoryChoice }) {
  const isFirst = index === 0;
  const isLast = index === stages.length - 1;
  const [newRoute, setNewRoute] = useState({ kind: 'next', target: '' });

  const patch = (value) => handlers.patchStage(stage.id, value);
  const otherStages = stages.filter((s) => s.id !== stage.id);

  const canAddRoute = newRoute.kind !== 'next' || !!newRoute.target;

  const addRoute = () => {
    if (!canAddRoute) return;
    handlers.addRoute(stage.id, {
      kind: newRoute.kind,
      // Терминальные маршруты цели не имеют — этого требует process_routes_target_valid.
      target_stage_id: newRoute.kind === 'next' ? newRoute.target : '',
    });
    setNewRoute({ kind: 'next', target: '' });
  };

  const stageName = (id) => {
    const found = stages.findIndex((s) => s.id === id);
    return found < 0 ? 'этап удалён' : `${found + 1}) ${stages[found].name || 'Без названия'}`;
  };

  return (
    <Card id={`stage-card-${stage.id}`} className="scroll-mt-24 p-4">
      <div className="flex flex-wrap items-start gap-3">
        <span
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-sm font-semibold ${STAGE_TONE[stage.type] || STAGE_TONE.collect}`}
          aria-hidden="true"
        >
          {index + 1}
        </span>
        <div className="grid min-w-0 flex-1 grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor={`stage-name-${stage.id}`}>Название этапа</Label>
            <Input
              id={`stage-name-${stage.id}`}
              value={stage.name}
              placeholder="Подача заявки"
              className="min-h-[40px]"
              aria-invalid={!stage.name.trim()}
              onChange={(e) => patch({ name: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor={`stage-type-${stage.id}`}>Тип этапа</Label>
            <select
              id={`stage-type-${stage.id}`}
              className={SELECT_CLS}
              value={stage.type}
              onChange={(e) => patch({ type: e.target.value })}
            >
              {Object.entries(PROCESS_STAGE_TYPES).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* ------------------------------------------------ поля ввода данных */}
      {FIELD_STAGES.includes(stage.type) && (
        <section className="mt-4" aria-label={`Поля ввода данных этапа ${index + 1}`}>
          <h4 className="mb-2 text-sm font-semibold text-foreground">Поля ввода данных</h4>

          {stage.fields.length === 0 ? (
            <p className="mb-2 text-sm text-muted-foreground">
              Полей пока нет: заявитель ничего не заполняет на этом этапе.
            </p>
          ) : (
            <div className="table-scroll">
              <table className="w-full text-sm">
                <caption className="sr-only">Поля ввода этапа «{stage.name || 'без названия'}»</caption>
                <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-3 py-2 text-left font-medium">Название поля</th>
                    <th scope="col" className="px-3 py-2 text-left font-medium">Тип поля</th>
                    <th scope="col" className="px-3 py-2 text-center font-medium">Обяз</th>
                    <th scope="col" className="table-sticky-actions px-3 py-2 text-center font-medium">Действия</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {stage.fields.map((field, fieldIndex) => (
                    <React.Fragment key={field.id}>
                      <tr>
                        <td className="px-3 py-2 align-top">
                          <Input
                            value={field.label}
                            placeholder="Вид активности"
                            aria-label={`Название поля ${fieldIndex + 1}`}
                            aria-invalid={!field.label.trim()}
                            className="min-h-[40px]"
                            onChange={(e) => handlers.patchField(stage.id, field.id, { label: e.target.value })}
                          />
                        </td>
                        <td className="px-3 py-2 align-top">
                          <select
                            className={SELECT_CLS}
                            value={field.type}
                            aria-label={`Тип поля ${fieldIndex + 1}`}
                            onChange={(e) => handlers.patchField(stage.id, field.id, { type: e.target.value })}
                          >
                            {Object.entries(PROCESS_FIELD_TYPES).map(([value, label]) => (
                              <option key={value} value={value}>{label}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-2 text-center align-middle">
                          <Switch
                            checked={field.required}
                            aria-label={`Поле «${field.label || fieldIndex + 1}» обязательно`}
                            onCheckedChange={(value) => handlers.patchField(stage.id, field.id, { required: value })}
                          />
                        </td>
                        <td className="table-sticky-actions px-3 py-2 text-center align-middle">
                          <div className="flex justify-center gap-1">
                            <Button
                              size="icon"
                              variant="ghost"
                              aria-label={`Поднять поле «${field.label || fieldIndex + 1}»`}
                              disabled={fieldIndex === 0}
                              onClick={() => handlers.moveField(stage.id, fieldIndex, -1)}
                            >
                              <ArrowUp className="h-4 w-4" aria-hidden="true" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              aria-label={`Опустить поле «${field.label || fieldIndex + 1}»`}
                              disabled={fieldIndex === stage.fields.length - 1}
                              onClick={() => handlers.moveField(stage.id, fieldIndex, 1)}
                            >
                              <ArrowDown className="h-4 w-4" aria-hidden="true" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              aria-label={`Удалить поле «${field.label || fieldIndex + 1}»`}
                              onClick={() => handlers.removeField(stage.id, field.id)}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" aria-hidden="true" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                      {OPTION_TYPES.includes(field.type) && (
                        <tr>
                          <td colSpan={4} className="px-3 pb-3">
                            <OptionsEditor
                              field={field}
                              onPatch={(value) => handlers.patchField(stage.id, field.id, value)}
                            />
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-2 min-h-[40px]"
            onClick={() => handlers.addField(stage.id)}
          >
            <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
            Добавить поле ввода
          </Button>

          {isFirst && (
            <label className="mt-3 flex min-h-[40px] cursor-pointer items-center gap-2 text-sm text-muted-foreground">
              <Switch
                checked={allowCategoryChoice}
                onCheckedChange={handlers.setAllowCategoryChoice}
                aria-label="Разрешить самостоятельный выбор категории"
              />
              Разрешить самостоятельный выбор категории
            </label>
          )}
        </section>
      )}

      {/* ------------------------------------------- ответственные и сроки */}
      {ACTOR_STAGES.includes(stage.type) && (
        <section className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2" aria-label={`Ответственные этапа ${index + 1}`}>
          <PeoplePicker
            id={`assignees-${stage.id}`}
            label="Ответственные (любой из)"
            users={users}
            value={stage.assignee_ids}
            onChange={(value) => patch({ assignee_ids: value })}
            hint="Решение принимает любой из выбранных сотрудников."
          />
          <PeoplePicker
            id={`watchers-${stage.id}`}
            label="Наблюдатели"
            users={users}
            value={stage.watcher_ids}
            onChange={(value) => patch({ watcher_ids: value })}
            hint="Видят заявку и получают уведомления, но решение не принимают."
          />
          <RoleSelect
            id={`assignee-role-${stage.id}`}
            label="Группы ответственных"
            value={stage.assignee_role}
            onChange={(value) => patch({ assignee_role: value })}
            hint="Роль целиком: например, все HR-специалисты."
          />
          <RoleSelect
            id={`watcher-role-${stage.id}`}
            label="Группы наблюдателей"
            value={stage.watcher_role}
            onChange={(value) => patch({ watcher_role: value })}
          />

          <label className="flex min-h-[40px] cursor-pointer items-center gap-2 text-sm text-muted-foreground">
            <Switch
              checked={stage.approve_by_manager}
              onCheckedChange={(value) => patch({ approve_by_manager: value })}
              aria-label="Согласование руководителем подающего заявку"
            />
            Согласование руководителем подающего заявку
          </label>

          <div className="flex flex-wrap items-end gap-3">
            <label className="flex min-h-[40px] cursor-pointer items-center gap-2 text-sm text-muted-foreground">
              <Switch
                checked={stage.deadline_hours != null}
                onCheckedChange={(value) => patch({ deadline_hours: value ? 24 : null })}
                aria-label="Установить дедлайн"
              />
              Установить дедлайн
            </label>
            {stage.deadline_hours != null && (
              <div>
                <Label htmlFor={`deadline-${stage.id}`}>Часов на этап</Label>
                <Input
                  id={`deadline-${stage.id}`}
                  type="number"
                  min={1}
                  value={stage.deadline_hours}
                  className="min-h-[40px] w-28"
                  onChange={(e) => {
                    const hours = Number(e.target.value);
                    patch({ deadline_hours: Number.isFinite(hours) && hours > 0 ? Math.round(hours) : 1 });
                  }}
                />
              </div>
            )}
          </div>
        </section>
      )}

      {/* ------------------------------------------------------- маршруты */}
      <section className="mt-4" aria-label={`Маршруты этапа ${index + 1}`}>
        <h4 className="mb-2 text-sm font-semibold text-foreground">Маршруты</h4>

        {stage.routes.length === 0 ? (
          <p className="mb-2 text-sm text-muted-foreground">
            {isLast
              ? 'Маршрутов нет: с этого этапа заявка никуда не идёт.'
              : 'Маршрутов нет — заявка застрянет на этом этапе.'}
          </p>
        ) : (
          <div className="table-scroll">
            <table className="w-full text-sm">
              <caption className="sr-only">Маршруты этапа «{stage.name || 'без названия'}»</caption>
              <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                <tr>
                  <th scope="col" className="px-3 py-2 text-left font-medium">Тип маршрута</th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">Этап</th>
                  <th scope="col" className="px-3 py-2 text-center font-medium">Ввод решения обяз</th>
                  <th scope="col" className="table-sticky-actions px-3 py-2 text-center font-medium">Действия</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {stage.routes.map((route) => (
                  <tr key={route.id}>
                    <td className="px-3 py-2">{ROUTE_KINDS[route.kind]}</td>
                    <td className="px-3 py-2">
                      {route.kind === 'next' ? (
                        <span className="inline-flex items-center gap-1.5">
                          <CornerDownRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                          {stageName(route.target_stage_id)}
                        </span>
                      ) : route.kind === 'reject' ? (
                        <span className="inline-flex items-center gap-1.5 text-destructive">
                          <X className="h-4 w-4" aria-hidden="true" />
                          Считать отклонённой
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-green-600">
                          <Check className="h-4 w-4" aria-hidden="true" />
                          Считать решённой
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <Switch
                        checked={route.require_comment}
                        aria-label={`Требовать комментарий для маршрута «${ROUTE_KINDS[route.kind]}»`}
                        onCheckedChange={(value) => handlers.patchRoute(stage.id, route.id, { require_comment: value })}
                      />
                    </td>
                    <td className="table-sticky-actions px-3 py-2 text-center">
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Удалить маршрут «${ROUTE_KINDS[route.kind]}»`}
                        onClick={() => handlers.removeRoute(stage.id, route.id)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" aria-hidden="true" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-3 rounded-lg border border-dashed border-border p-3">
          <p className="mb-2 text-xs font-medium text-foreground">Добавить новый маршрут:</p>
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-48 flex-1">
              <Label htmlFor={`route-kind-${stage.id}`}>Тип маршрута</Label>
              <select
                id={`route-kind-${stage.id}`}
                className={SELECT_CLS}
                value={newRoute.kind}
                onChange={(e) => setNewRoute({ kind: e.target.value, target: '' })}
              >
                {Object.entries(ROUTE_KINDS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
            <div className="min-w-48 flex-1">
              <Label htmlFor={`route-target-${stage.id}`}>Этап</Label>
              <select
                id={`route-target-${stage.id}`}
                className={SELECT_CLS}
                value={newRoute.kind === 'next' ? newRoute.target : newRoute.kind}
                disabled={newRoute.kind !== 'next'}
                onChange={(e) => setNewRoute((r) => ({ ...r, target: e.target.value }))}
              >
                {newRoute.kind === 'next' ? (
                  <>
                    <option value="">Выберите этап</option>
                    {otherStages.map((s) => (
                      <option key={s.id} value={s.id}>
                        {stages.indexOf(s) + 1}) {s.name || 'Без названия'}
                      </option>
                    ))}
                  </>
                ) : newRoute.kind === 'reject' ? (
                  <option value="reject">Считать отклонённой</option>
                ) : (
                  <option value="resolve">Считать решённой</option>
                )}
              </select>
            </div>
            <Button type="button" variant="outline" className="min-h-[40px]" onClick={addRoute} disabled={!canAddRoute}>
              <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
              Добавить маршрут
            </Button>
          </div>
          {newRoute.kind === 'next' && !newRoute.target && (
            <p className="mt-2 text-xs text-muted-foreground">
              У маршрута «Следующий этап» целевой этап обязателен; у «Считать отклонённой» и
              «Считать решённой» цели нет.
            </p>
          )}
        </div>
      </section>

      {/* ------------------------------------------- перестановка и удаление */}
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <Button
          size="icon"
          variant="outline"
          aria-label={`Поднять этап «${stage.name || index + 1}»`}
          disabled={isFirst}
          onClick={() => handlers.moveStage(index, -1)}
        >
          <ArrowUp className="h-4 w-4" aria-hidden="true" />
        </Button>
        <Button
          size="icon"
          variant="outline"
          aria-label={`Опустить этап «${stage.name || index + 1}»`}
          disabled={isLast}
          onClick={() => handlers.moveStage(index, 1)}
        >
          <ArrowDown className="h-4 w-4" aria-hidden="true" />
        </Button>
        <Button
          variant="outline"
          className="ml-auto min-h-[40px] text-destructive"
          onClick={() => handlers.requestStageDelete(stage)}
        >
          <Trash2 className="mr-1 h-4 w-4" aria-hidden="true" />
          Удалить весь этап
        </Button>
      </div>
    </Card>
  );
}

/** Схема процесса: этапы блоками и стрелки маршрутов между ними. */
function ProcessDiagram({ stages }) {
  if (!stages.length) {
    return (
      <p className="text-sm text-muted-foreground">
        Диаграмма появится, когда в процессе будет хотя бы один этап.
      </p>
    );
  }

  const indexById = new Map(stages.map((s, i) => [s.id, i]));

  return (
    <div className="space-y-1">
      {stages.map((stage, index) => (
        <div key={stage.id}>
          <div className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 ${STAGE_TONE[stage.type] || STAGE_TONE.collect}`}>
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-current text-xs font-semibold" aria-hidden="true">
              {index + 1}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">{stage.name || 'Без названия'}</span>
              <span className="block text-xs opacity-80">{PROCESS_STAGE_TYPES[stage.type]}</span>
            </span>
          </div>

          <ul role="list" className="ml-6 border-l border-dashed border-border pl-4">
            {stage.routes.length === 0 ? (
              <li role="listitem" className="py-2 text-xs text-muted-foreground">
                {index === stages.length - 1 ? 'Финальный этап' : 'Маршрутов нет — заявка остановится здесь'}
              </li>
            ) : (
              stage.routes.map((route) => {
                const targetIndex = indexById.get(route.target_stage_id);
                return (
                  <li role="listitem" key={route.id} className="flex items-center gap-2 py-2 text-xs">
                    <ArrowDown className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                    {route.kind === 'next' ? (
                      <span className="rounded-full border border-border bg-muted/60 px-2 py-1">
                        {targetIndex == null
                          ? 'Этап удалён'
                          : `${targetIndex + 1}) ${stages[targetIndex].name || 'Без названия'}`}
                      </span>
                    ) : route.kind === 'reject' ? (
                      <span className="rounded-full border border-destructive/40 bg-destructive/10 px-2 py-1 text-destructive">
                        Отклонена
                      </span>
                    ) : (
                      <span className="rounded-full border border-green-500/40 bg-green-500/10 px-2 py-1 text-green-700">
                        Решена
                      </span>
                    )}
                    {route.require_comment && (
                      <span className="text-muted-foreground">с обязательным комментарием</span>
                    )}
                  </li>
                );
              })
            )}
          </ul>
        </div>
      ))}
    </div>
  );
}

function BuilderSkeleton() {
  return (
    <div className="space-y-4" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <Card key={i} className="animate-pulse space-y-3 p-4">
          <div className="h-4 w-1/3 rounded bg-muted" />
          <div className="h-24 w-full rounded bg-muted/50" />
        </Card>
      ))}
    </div>
  );
}

/* ------------------------------------------------------- сохранение пачкой */

/**
 * Пишет весь конструктор пачкой запросов.
 * Порядок важен: сначала удаления (маршруты → поля → этапы), затем сдвиг порядка
 * этапов в свободный диапазон, создание новых этапов и только потом финальные номера.
 */
async function persistDraft({ draft, removed }) {
  const processId = draft.process.id;

  await api.entities.Process.update(processId, {
    name: draft.process.name.trim(),
    description: draft.process.description.trim() || null,
    image_url: draft.process.image_url || null,
    image_path: draft.process.image_path || null,
    is_active: draft.process.is_active,
    allow_category_choice: draft.process.allow_category_choice,
    visible_to_role: draft.process.visible_to_role || null,
  });

  await Promise.all(removed.routes.map((id) => api.entities.ProcessRoute.delete(id)));
  await Promise.all(removed.fields.map((id) => api.entities.ProcessField.delete(id)));
  await Promise.all(removed.stages.map((id) => api.entities.ProcessStage.delete(id)));
  await Promise.all(removed.categories.map((id) => api.entities.ProcessCategory.delete(id)));

  const kept = draft.stages.filter((s) => !isNew(s.id));
  const fresh = draft.stages.filter((s) => isNew(s.id));

  const stagePayload = (stage) => ({
    name: stage.name.trim() || 'Без названия',
    type: stage.type,
    sort_order: stage.sort_order,
    // На этапе «Сбор информации» ответственных не бывает — не оставляем мусорных прав.
    assignee_ids: ACTOR_STAGES.includes(stage.type) ? stage.assignee_ids : [],
    watcher_ids: ACTOR_STAGES.includes(stage.type) ? stage.watcher_ids : [],
    assignee_role: ACTOR_STAGES.includes(stage.type) ? stage.assignee_role || null : null,
    watcher_role: ACTOR_STAGES.includes(stage.type) ? stage.watcher_role || null : null,
    approve_by_manager: ACTOR_STAGES.includes(stage.type) ? stage.approve_by_manager : false,
    deadline_hours: stage.deadline_hours ?? null,
  });

  // unique (process_id, sort_order): освобождаем целевые номера, прежде чем занимать их.
  await Promise.all(
    kept.map((stage, i) => api.entities.ProcessStage.update(stage.id, { sort_order: 1000 + i }))
  );

  const idMap = new Map();
  const created = await Promise.all(
    fresh.map((stage) => api.entities.ProcessStage.create({ ...stagePayload(stage), process_id: processId }))
  );
  fresh.forEach((stage, i) => idMap.set(stage.id, created[i].id));

  await Promise.all(kept.map((stage) => api.entities.ProcessStage.update(stage.id, stagePayload(stage))));

  const realStageId = (id) => idMap.get(id) || id;

  const fieldJobs = [];
  const routeJobs = [];
  for (const stage of draft.stages) {
    const stageId = realStageId(stage.id);

    stage.fields.forEach((field, i) => {
      const payload = {
        label: field.label.trim() || 'Без названия',
        type: field.type,
        options: OPTION_TYPES.includes(field.type)
          ? field.options.map((o) => ({ value: o.value, label: o.label, points: Number(o.points) || 0 }))
          : [],
        required: field.required,
        sort_order: i,
        visible_to_role: field.visible_to_role || null,
      };
      fieldJobs.push(
        isNew(field.id)
          ? api.entities.ProcessField.create({ ...payload, stage_id: stageId })
          : api.entities.ProcessField.update(field.id, { ...payload, stage_id: stageId })
      );
    });

    stage.routes.forEach((route, i) => {
      const payload = {
        kind: route.kind,
        // Пустая цель не должна уехать в uuid-колонку как '' (22P02): отправляем null,
        // тогда сработает понятная проверка process_routes_target_valid.
        target_stage_id: route.kind === 'next' ? realStageId(route.target_stage_id) || null : null,
        require_comment: route.require_comment,
        sort_order: i,
      };
      routeJobs.push(
        isNew(route.id)
          ? api.entities.ProcessRoute.create({ ...payload, stage_id: stageId })
          : api.entities.ProcessRoute.update(route.id, { ...payload, stage_id: stageId })
      );
    });
  }
  await Promise.all(fieldJobs);
  await Promise.all(routeJobs);

  await Promise.all(
    draft.categories.map((category, i) => {
      const payload = {
        name: category.name.trim() || 'Без названия',
        description: category.description.trim() || null,
        is_active: category.is_active,
        sort_order: i,
      };
      return isNew(category.id)
        ? api.entities.ProcessCategory.create({ ...payload, process_id: processId })
        : api.entities.ProcessCategory.update(category.id, payload);
    })
  );
}

/* ------------------------------------------------------------- страница */

export default function AdminProcessBuilder() {
  const { id } = useParams();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [draft, setDraft] = useState(null);
  const [removed, setRemoved] = useState({ stages: [], fields: [], routes: [], categories: [] });
  const [dirty, setDirty] = useState(false);
  const [stageToDelete, setStageToDelete] = useState(null);
  const [categoryToDelete, setCategoryToDelete] = useState(null);

  /* ------------------------------------------------------------- данные */

  const query = useQuery({
    queryKey: ['process-builder', id],
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const process = await api.entities.Process.get(id);
      if (!process) throw new Error('Процесс не найден или удалён');
      const [stages, categories] = await Promise.all([
        api.entities.ProcessStage.filter({ process_id: id }, 'sort_order'),
        api.entities.ProcessCategory.filter({ process_id: id }, 'sort_order'),
      ]);
      const stageIds = stages.map((s) => s.id);
      const [fields, routes] = stageIds.length
        ? await Promise.all([
            api.entities.ProcessField.filter({ stage_id: stageIds }, 'sort_order'),
            api.entities.ProcessRoute.filter({ stage_id: stageIds }, 'sort_order'),
          ])
        : [[], []];
      return { process, stages, categories, fields, routes };
    },
  });

  const usersQuery = useQuery({
    queryKey: ['process-builder-users'],
    staleTime: 5 * 60 * 1000,
    queryFn: () => api.entities.User.list('full_name', 1000),
  });

  useEffect(() => {
    if (!query.data) return;
    setDraft(buildDraft(query.data));
    setRemoved({ stages: [], fields: [], routes: [], categories: [] });
    setDirty(false);
  }, [query.data]);

  // Предупреждение при уходе со страницы с несохранёнными правками.
  useEffect(() => {
    if (!dirty) return undefined;
    const handler = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const update = useCallback((updater) => {
    setDraft((prev) => (prev ? updater(prev) : prev));
    setDirty(true);
  }, []);

  /* ------------------------------------------------------------ действия */

  const patchProcess = (patch) => update((d) => ({ ...d, process: { ...d.process, ...patch } }));

  const patchStage = useCallback(
    (stageId, patch) =>
      update((d) => ({
        ...d,
        stages: d.stages.map((s) => (s.id === stageId ? { ...s, ...patch } : s)),
      })),
    [update]
  );

  const mapStage = useCallback(
    (stageId, mapper) =>
      update((d) => ({ ...d, stages: d.stages.map((s) => (s.id === stageId ? mapper(s) : s)) })),
    [update]
  );

  const handlers = useMemo(
    () => ({
      patchStage,
      setAllowCategoryChoice: (value) =>
        update((d) => ({ ...d, process: { ...d.process, allow_category_choice: value } })),

      addField: (stageId) =>
        mapStage(stageId, (s) => ({
          ...s,
          fields: [
            ...s.fields,
            {
              id: tempId('field'),
              label: '',
              type: 'text',
              required: false,
              options: [],
              visible_to_role: '',
              sort_order: s.fields.length,
            },
          ],
        })),

      patchField: (stageId, fieldId, patch) =>
        mapStage(stageId, (s) => ({
          ...s,
          fields: s.fields.map((f) => (f.id === fieldId ? { ...f, ...patch } : f)),
        })),

      moveField: (stageId, index, direction) =>
        mapStage(stageId, (s) => ({ ...s, fields: moveItem(s.fields, index, direction) })),

      removeField: (stageId, fieldId) => {
        if (!isNew(fieldId)) setRemoved((r) => ({ ...r, fields: [...r.fields, fieldId] }));
        mapStage(stageId, (s) => ({
          ...s,
          fields: s.fields.filter((f) => f.id !== fieldId).map((f, i) => ({ ...f, sort_order: i })),
        }));
      },

      addRoute: (stageId, { kind, target_stage_id }) =>
        mapStage(stageId, (s) => ({
          ...s,
          routes: [
            ...s.routes,
            {
              id: tempId('route'),
              kind,
              target_stage_id: kind === 'next' ? target_stage_id : '',
              require_comment: kind === 'reject',
              sort_order: s.routes.length,
            },
          ],
        })),

      patchRoute: (stageId, routeId, patch) =>
        mapStage(stageId, (s) => ({
          ...s,
          routes: s.routes.map((r) => (r.id === routeId ? { ...r, ...patch } : r)),
        })),

      removeRoute: (stageId, routeId) => {
        if (!isNew(routeId)) setRemoved((r) => ({ ...r, routes: [...r.routes, routeId] }));
        mapStage(stageId, (s) => ({
          ...s,
          routes: s.routes.filter((r) => r.id !== routeId).map((r, i) => ({ ...r, sort_order: i })),
        }));
      },

      moveStage: (index, direction) =>
        update((d) => ({ ...d, stages: moveItem(d.stages, index, direction) })),

      requestStageDelete: (stage) => setStageToDelete(stage),
    }),
    [mapStage, patchStage, update]
  );

  const addStage = () =>
    update((d) => ({
      ...d,
      stages: [
        ...d.stages,
        {
          id: tempId('stage'),
          name: '',
          type: d.stages.length === 0 ? 'collect' : 'approve',
          sort_order: d.stages.length,
          assignee_ids: [],
          watcher_ids: [],
          assignee_role: '',
          watcher_role: '',
          approve_by_manager: false,
          deadline_hours: null,
          fields: [],
          routes: [],
        },
      ],
    }));

  const confirmStageDelete = () => {
    const stage = stageToDelete;
    if (!stage) return;
    // Удаление этапа уносит его поля и маршруты, а также маршруты других этапов,
    // которые на него ссылались: в базе target_stage_id объявлен on delete cascade.
    setRemoved((r) => ({
      ...r,
      stages: isNew(stage.id) ? r.stages : [...r.stages, stage.id],
      routes: [
        ...r.routes,
        ...(draft?.stages || [])
          .flatMap((s) => s.routes)
          .filter((route) => route.target_stage_id === stage.id && !isNew(route.id))
          .map((route) => route.id),
      ],
    }));
    update((d) => ({
      ...d,
      stages: d.stages
        .filter((s) => s.id !== stage.id)
        .map((s, i) => ({
          ...s,
          sort_order: i,
          routes: s.routes
            .filter((route) => route.target_stage_id !== stage.id)
            .map((route, ri) => ({ ...route, sort_order: ri })),
        })),
    }));
    setStageToDelete(null);
  };

  const addCategory = () =>
    update((d) => ({
      ...d,
      categories: [
        ...d.categories,
        { id: tempId('category'), name: '', description: '', is_active: true, sort_order: d.categories.length },
      ],
    }));

  const patchCategory = (categoryId, patch) =>
    update((d) => ({
      ...d,
      categories: d.categories.map((c) => (c.id === categoryId ? { ...c, ...patch } : c)),
    }));

  const moveCategory = (index, direction) =>
    update((d) => ({ ...d, categories: moveItem(d.categories, index, direction) }));

  const confirmCategoryDelete = () => {
    const category = categoryToDelete;
    if (!category) return;
    if (!isNew(category.id)) setRemoved((r) => ({ ...r, categories: [...r.categories, category.id] }));
    update((d) => ({
      ...d,
      categories: d.categories.filter((c) => c.id !== category.id).map((c, i) => ({ ...c, sort_order: i })),
    }));
    setCategoryToDelete(null);
  };

  /* ---------------------------------------------------------- сохранение */

  const problems = useMemo(() => collectProblems(draft), [draft]);

  const save = useMutation({
    mutationFn: () => persistDraft({ draft, removed }),
    onSuccess: async () => {
      toast({ title: 'Процесс сохранён' });
      setDirty(false);
      setRemoved({ stages: [], fields: [], routes: [], categories: [] });
      await qc.invalidateQueries({ queryKey: ['process-builder', id] });
      qc.invalidateQueries({ queryKey: ['admin-processes'] });
      qc.invalidateQueries({ queryKey: ['admin-processes-stages'] });
      qc.invalidateQueries({ queryKey: ['admin-processes-categories'] });
    },
    onError: (e) =>
      toast({
        title: 'Не удалось сохранить процесс',
        description: saveErrorMessage(e),
        variant: 'destructive',
      }),
  });

  const handleSave = () => {
    if (!draft) return;
    if (draft.process.is_active && problems.length) {
      toast({
        title: 'Процесс нельзя опубликовать',
        description: 'Сначала исправьте ошибки настройки или снимите публикацию.',
        variant: 'destructive',
      });
      return;
    }
    save.mutate();
  };

  const handlePublishToggle = (value) => {
    if (value && problems.length) {
      toast({
        title: 'Публикация недоступна',
        description: 'В настройке процесса есть ошибки — исправьте их и попробуйте снова.',
        variant: 'destructive',
      });
      return;
    }
    patchProcess({ is_active: value });
  };

  const scrollTo = (elementId) => {
    document.getElementById(elementId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const resetDraft = () => {
    if (!query.data) return;
    setDraft(buildDraft(query.data));
    setRemoved({ stages: [], fields: [], routes: [], categories: [] });
    setDirty(false);
  };

  /* ------------------------------------------------------------- рендер */

  const allFields = useMemo(
    () =>
      (draft?.stages || []).flatMap((stage, index) =>
        stage.fields.map((field) => ({ ...field, stageId: stage.id, stageIndex: index, stageName: stage.name }))
      ),
    [draft]
  );

  return (
    <PageContainer
      width="wide"
      title={draft?.process.name || 'Конструктор процесса'}
      documentTitle="Конструктор процесса"
      description="Этапы, поля ввода, ответственные, маршруты и категории заявки"
      breadcrumbs={
        <Button variant="ghost" asChild className="mb-3 -ml-2">
          <Link to="/admin/processes">
            <ArrowLeft className="mr-1 h-4 w-4" aria-hidden="true" />
            Все процессы
          </Link>
        </Button>
      }
      actions={
        draft ? (
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge value={draft.process.is_active ? 'published' : 'draft'} />
            {dirty && (
              <span className="inline-flex items-center gap-1 rounded-full border border-yellow-500/40 bg-yellow-500/10 px-2.5 py-1 text-xs text-yellow-700">
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                Есть несохранённые изменения
              </span>
            )}
            {dirty && (
              <Button variant="outline" className="min-h-[40px]" onClick={resetDraft} disabled={save.isPending}>
                Отменить изменения
              </Button>
            )}
            <Button className="min-h-[40px]" onClick={handleSave} disabled={save.isPending || !dirty}>
              <Save className="mr-1 h-4 w-4" aria-hidden="true" />
              {save.isPending ? 'Сохранение…' : 'Сохранить'}
            </Button>
          </div>
        ) : null
      }
    >
      {query.error ? (
        <ErrorState error={query.error} onRetry={query.refetch} />
      ) : query.isPending || !draft ? (
        <BuilderSkeleton />
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
          {/* ------------------------------------------- левая навигация */}
          <nav className="lg:sticky lg:top-20 lg:self-start" aria-label="Разделы конструктора">
            <Card className="p-2">
              <ul role="list" className="space-y-0.5">
                {SECTIONS.map((section) => {
                  const Icon = section.icon;
                  return (
                    <li key={section.id} role="listitem">
                      <button
                        type="button"
                        onClick={() => scrollTo(`section-${section.id}`)}
                        className="flex min-h-[40px] w-full items-center gap-2 rounded-md px-3 text-left text-sm text-foreground hover:bg-muted"
                      >
                        <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                        {section.label}
                      </button>

                      {section.id === 'stages' && (
                        <ul role="list" className="mb-1 ml-6 space-y-0.5 border-l border-border pl-2">
                          {draft.stages.length === 0 ? (
                            <li role="listitem" className="px-2 py-1.5 text-xs text-muted-foreground">
                              Этапов пока нет
                            </li>
                          ) : (
                            draft.stages.map((stage, index) => (
                              <li key={stage.id} role="listitem">
                                <button
                                  type="button"
                                  onClick={() => scrollTo(`stage-card-${stage.id}`)}
                                  className="flex min-h-[40px] w-full items-center gap-2 rounded-md px-2 text-left text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                                >
                                  <span
                                    className={`h-2.5 w-2.5 shrink-0 rounded-full border ${STAGE_TONE[stage.type] || STAGE_TONE.collect}`}
                                    aria-hidden="true"
                                  />
                                  <span className="truncate">
                                    {index + 1}) {stage.name || 'Без названия'}
                                  </span>
                                </button>
                              </li>
                            ))
                          )}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>

              <div className="mt-2 border-t border-border p-2">
                {problems.length > 0 && (
                  <p className="mb-2 text-xs text-destructive">
                    {formatNumber(problems.length)}{' '}
                    {pluralize(problems.length, 'проблема', 'проблемы', 'проблем')} в настройке
                  </p>
                )}
                <Button className="min-h-[40px] w-full" onClick={handleSave} disabled={save.isPending || !dirty}>
                  <Save className="mr-1 h-4 w-4" aria-hidden="true" />
                  {save.isPending ? 'Сохранение…' : 'Сохранить'}
                </Button>
              </div>
            </Card>
          </nav>

          {/* ------------------------------------------------ содержимое */}
          <div className="min-w-0 space-y-8">
            {/* Описание */}
            <section id="section-description" className="scroll-mt-24">
              <h2 className="mb-3 text-lg font-semibold text-foreground">Описание</h2>
              <Card className="space-y-4 p-4">
                <div>
                  <Label htmlFor="process-name">Название</Label>
                  <Input
                    id="process-name"
                    value={draft.process.name}
                    className="min-h-[40px]"
                    aria-invalid={!draft.process.name.trim()}
                    onChange={(e) => patchProcess({ name: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="process-description">Описание</Label>
                  <Textarea
                    id="process-description"
                    rows={3}
                    value={draft.process.description}
                    onChange={(e) => patchProcess({ description: e.target.value })}
                  />
                </div>
                <ImageUpload
                  value={draft.process.image_url}
                  path={draft.process.image_path}
                  folder="processes"
                  label="Изображение процесса"
                  hint="Файл загружается сразу; остальные правки применятся по кнопке «Сохранить»."
                  onChange={({ url, path }) => patchProcess({ image_url: url, image_path: path })}
                />
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <label className="flex min-h-[40px] cursor-pointer items-center gap-2 text-sm text-muted-foreground">
                    <Switch
                      checked={draft.process.is_active}
                      onCheckedChange={handlePublishToggle}
                      aria-label="Опубликовать процесс"
                    />
                    {draft.process.is_active ? 'Опубликован для сотрудников' : 'Черновик, сотрудникам не виден'}
                  </label>
                  <RoleSelect
                    id="process-visible-role"
                    label="Видимость по роли"
                    value={draft.process.visible_to_role}
                    onChange={(value) => patchProcess({ visible_to_role: value })}
                    hint="Не задано — процесс виден всем сотрудникам."
                  />
                </div>

                {problems.length > 0 && (
                  <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                    <p className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold text-foreground">
                      <AlertTriangle className="h-4 w-4 text-destructive" aria-hidden="true" />
                      Процесс нельзя опубликовать
                    </p>
                    <ul role="list" className="list-inside list-disc space-y-1 text-sm text-muted-foreground">
                      {problems.map((problem) => (
                        <li role="listitem" key={problem}>{problem}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </Card>
            </section>

            {/* Этапы */}
            <section id="section-stages" className="scroll-mt-24">
              <h2 className="mb-3 text-lg font-semibold text-foreground">Этапы процесса</h2>
              <div className="space-y-4">
                {draft.stages.length === 0 ? (
                  <EmptyState
                    icon={ListTree}
                    title="Этапов пока нет"
                    description="Первый этап обычно «Подача заявки» с полями ввода, дальше идут согласование и начисление баллов."
                    actionLabel="Добавить этап"
                    onAction={addStage}
                  />
                ) : (
                  draft.stages.map((stage, index) => (
                    <StageCard
                      key={stage.id}
                      stage={stage}
                      index={index}
                      stages={draft.stages}
                      users={usersQuery.data || []}
                      handlers={handlers}
                      allowCategoryChoice={draft.process.allow_category_choice}
                    />
                  ))
                )}

                <Button variant="outline" className="min-h-[40px]" onClick={addStage}>
                  <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
                  Добавить этап
                </Button>
              </div>
            </section>

            {/* Категории */}
            <section id="section-categories" className="scroll-mt-24">
              <h2 className="mb-1 text-lg font-semibold text-foreground">Категории процесса</h2>
              <p className="mb-3 text-sm text-muted-foreground">
                Категория становится заголовком формы для сотрудника — например,
                «Обучение (рецензии, тренинги, мастер-классы, наставничество)».
              </p>
              <Card className="space-y-3 p-4">
                {draft.categories.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Категорий нет: сотрудник подаёт заявку без выбора направления.
                  </p>
                ) : (
                  <ul role="list" className="space-y-3">
                    {draft.categories.map((category, index) => (
                      <li
                        role="listitem"
                        key={category.id}
                        className="grid grid-cols-1 gap-2 rounded-lg border border-border p-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto]"
                      >
                        <div>
                          <Label htmlFor={`category-name-${category.id}`}>Название</Label>
                          <Input
                            id={`category-name-${category.id}`}
                            value={category.name}
                            className="min-h-[40px]"
                            aria-invalid={!category.name.trim()}
                            onChange={(e) => patchCategory(category.id, { name: e.target.value })}
                          />
                        </div>
                        <div>
                          <Label htmlFor={`category-description-${category.id}`}>Описание</Label>
                          <Input
                            id={`category-description-${category.id}`}
                            value={category.description}
                            className="min-h-[40px]"
                            onChange={(e) => patchCategory(category.id, { description: e.target.value })}
                          />
                        </div>
                        <div className="flex flex-wrap items-end gap-2">
                          <label className="flex min-h-[40px] cursor-pointer items-center gap-2 text-sm text-muted-foreground">
                            <Switch
                              checked={category.is_active}
                              onCheckedChange={(value) => patchCategory(category.id, { is_active: value })}
                              aria-label={`Категория «${category.name || index + 1}» активна`}
                            />
                            Активна
                          </label>
                          <Button
                            size="icon"
                            variant="outline"
                            aria-label={`Поднять категорию «${category.name || index + 1}»`}
                            disabled={index === 0}
                            onClick={() => moveCategory(index, -1)}
                          >
                            <ArrowUp className="h-4 w-4" aria-hidden="true" />
                          </Button>
                          <Button
                            size="icon"
                            variant="outline"
                            aria-label={`Опустить категорию «${category.name || index + 1}»`}
                            disabled={index === draft.categories.length - 1}
                            onClick={() => moveCategory(index, 1)}
                          >
                            <ArrowDown className="h-4 w-4" aria-hidden="true" />
                          </Button>
                          <Button
                            size="icon"
                            variant="outline"
                            aria-label={`Удалить категорию «${category.name || index + 1}»`}
                            onClick={() => setCategoryToDelete(category)}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" aria-hidden="true" />
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}

                <Button variant="outline" className="min-h-[40px]" onClick={addCategory}>
                  <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
                  Добавить категорию
                </Button>
              </Card>
            </section>

            {/* Видимость полей */}
            <section id="section-visibility" className="scroll-mt-24">
              <h2 className="mb-1 text-lg font-semibold text-foreground">Видимость полей</h2>
              <p className="mb-3 text-sm text-muted-foreground">
                Кому поле показывается на последующих этапах. «Не задано» — видно всем участникам заявки.
              </p>
              <Card className="p-0">
                {allFields.length === 0 ? (
                  <p className="p-4 text-sm text-muted-foreground">
                    В процессе пока нет ни одного поля ввода.
                  </p>
                ) : (
                  <div className="table-scroll">
                    <table className="w-full text-sm">
                      <caption className="sr-only">Видимость полей процесса по ролям</caption>
                      <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                        <tr>
                          <th scope="col" className="px-4 py-2.5 text-left font-medium">Этап</th>
                          <th scope="col" className="px-4 py-2.5 text-left font-medium">Поле</th>
                          <th scope="col" className="px-4 py-2.5 text-left font-medium">Тип</th>
                          <th scope="col" className="px-4 py-2.5 text-left font-medium">Кому видно</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {allFields.map((field) => (
                          <tr key={field.id}>
                            <td className="px-4 py-2.5 text-muted-foreground">
                              {field.stageIndex + 1}) {field.stageName || 'Без названия'}
                            </td>
                            <td className="px-4 py-2.5 font-medium text-foreground">
                              {field.label || 'Без названия'}
                            </td>
                            <td className="px-4 py-2.5 text-muted-foreground">
                              {PROCESS_FIELD_TYPES[field.type]}
                            </td>
                            <td className="px-4 py-2.5">
                              <select
                                className={SELECT_CLS}
                                value={field.visible_to_role || ''}
                                aria-label={`Кому видно поле «${field.label || 'без названия'}»`}
                                onChange={(e) =>
                                  handlers.patchField(field.stageId, field.id, { visible_to_role: e.target.value })
                                }
                              >
                                {ROLE_OPTIONS.map((option) => (
                                  <option key={option.value || 'none'} value={option.value}>{option.label}</option>
                                ))}
                              </select>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            </section>

            {/* Диаграмма */}
            <section id="section-diagram" className="scroll-mt-24">
              <h2 className="mb-3 text-lg font-semibold text-foreground">Диаграмма</h2>
              <Card className="p-4">
                <ProcessDiagram stages={draft.stages} />
                <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border pt-3 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5">
                    <span className={`h-3 w-3 rounded-full border ${STAGE_TONE.collect}`} aria-hidden="true" />
                    {PROCESS_STAGE_TYPES.collect}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className={`h-3 w-3 rounded-full border ${STAGE_TONE.approve}`} aria-hidden="true" />
                    {PROCESS_STAGE_TYPES.approve}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className={`h-3 w-3 rounded-full border ${STAGE_TONE.execute}`} aria-hidden="true" />
                    {PROCESS_STAGE_TYPES.execute}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-3 w-3 rounded-full border border-destructive/40 bg-destructive/10" aria-hidden="true" />
                    Отклонена
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-3 w-3 rounded-full border border-green-500/40 bg-green-500/10" aria-hidden="true" />
                    Решена
                  </span>
                </div>
              </Card>
            </section>
          </div>
        </div>
      )}

      {/* Подтверждение удаления этапа */}
      <Dialog open={!!stageToDelete} onOpenChange={(value) => { if (!value) setStageToDelete(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Удалить этап?</DialogTitle>
            <DialogDescription>
              {stageToDelete
                ? `Этап «${stageToDelete.name || 'без названия'}» будет удалён вместе с полями ввода и маршрутами, которые на него ведут. Изменение применится при сохранении.`
                : ''}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStageToDelete(null)}>Отмена</Button>
            <Button variant="destructive" onClick={confirmStageDelete}>Удалить этап</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Подтверждение удаления категории */}
      <Dialog open={!!categoryToDelete} onOpenChange={(value) => { if (!value) setCategoryToDelete(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Удалить категорию?</DialogTitle>
            <DialogDescription>
              {categoryToDelete
                ? `Категория «${categoryToDelete.name || 'без названия'}» будет удалена при сохранении. У уже поданных заявок название категории сохранится в самой заявке.`
                : ''}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCategoryToDelete(null)}>Отмена</Button>
            <Button variant="destructive" onClick={confirmCategoryDelete}>Удалить категорию</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
