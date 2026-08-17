import React, { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Sparkles, UserX, Workflow } from 'lucide-react';

import { api } from '@/api/client';
import PageContainer from '@/components/common/PageContainer';
import EmptyState from '@/components/common/EmptyState';
import ErrorState from '@/components/common/ErrorState';
import FileUpload from '@/components/common/FileUpload';
import ImageUpload from '@/components/common/ImageUpload';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/lib/AuthContext';
import { formatPoints } from '@/lib/format';
import { mutationErrorMessage } from '@/lib/dataErrors';
import { cn } from '@/lib/utils';

/**
 * Подача заявки по процессу.
 *
 * Форма рисуется по полям ПЕРВОГО этапа процесса: движок принимает значения
 * только для него, поля этапов согласования подделать из браузера нельзя.
 *
 * Статус заявки создаётся сервером (rpc process_submit_request) — клиент
 * никогда не пишет в process_requests напрямую.
 */

const SELECT_CLASS =
  'w-full min-h-[40px] rounded-md border border-input bg-transparent px-3 text-sm outline-none focus:border-primary/40 disabled:opacity-50';

/* ------------------------------------------------------------------ значения */

/** Пустое значение поля: одна форма для всех типов, чтобы не плодить ветвления. */
export function emptyFieldValue() {
  return { text: '', number: '', json: [], file_url: '', file_path: '', file_name: '' };
}

/** Варианты ответа поля: в БД это jsonb-массив [{ value, label, points }]. */
export function fieldOptions(field) {
  return Array.isArray(field?.options) ? field.options : [];
}

/** Подпись варианта: «предложение идеи для контента — 15 баллов». */
export function optionLabel(option) {
  const label = option?.label || option?.value || '';
  const points = Number(option?.points);
  return Number.isFinite(points) && points !== 0 ? `${label} — ${formatPoints(points)}` : label;
}

/** Заполнено ли поле — с учётом того, где хранится значение каждого типа. */
export function isFieldFilled(field, value) {
  const v = value || emptyFieldValue();
  switch (field.type) {
    case 'multiselect':
      return Array.isArray(v.json) && v.json.length > 0;
    case 'number':
      return v.number !== '' && v.number !== null && v.number !== undefined && Number.isFinite(Number(v.number));
    case 'file':
    case 'image':
      return !!v.file_url;
    default:
      return !!String(v.text ?? '').trim();
  }
}

const REQUIRED_MESSAGES = {
  select: 'Выберите вариант',
  multiselect: 'Выберите хотя бы один вариант',
  date: 'Укажите дату',
  number: 'Введите число',
  file: 'Прикрепите файл',
  image: 'Загрузите изображение',
  employee: 'Выберите сотрудника',
};

/** Проверка до отправки: обязательные поля и корректность чисел. */
export function validateFields(fields, values) {
  const errors = {};
  for (const field of fields) {
    const value = values[field.id];
    if (field.required && !isFieldFilled(field, value)) {
      errors[field.id] = REQUIRED_MESSAGES[field.type] || 'Заполните это поле';
      continue;
    }
    if (
      field.type === 'number' &&
      value?.number !== '' &&
      value?.number !== null &&
      value?.number !== undefined &&
      !Number.isFinite(Number(value.number))
    ) {
      errors[field.id] = 'Введите число';
    }
  }
  return errors;
}

/**
 * Значения в формате RPC (CONVENTIONS §11):
 * [{ field_id, value_text, value_number, value_json, file_url, file_path }]
 */
export function buildValuesPayload(fields, values) {
  const payload = [];
  for (const field of fields) {
    const value = values[field.id] || emptyFieldValue();
    if (!isFieldFilled(field, value)) continue;

    const item = { field_id: field.id };
    switch (field.type) {
      case 'multiselect':
        // В value_json уходит массив кодов вариантов — по нему движок считает баллы.
        item.value_json = value.json;
        break;
      case 'number':
        item.value_number = Number(value.number);
        break;
      case 'file':
      case 'image':
        item.file_url = value.file_url;
        item.file_path = value.file_path || null;
        // Имя файла храним в value_text, чтобы ссылка в карточке заявки была читаемой.
        if (value.file_name) item.value_text = value.file_name;
        break;
      default:
        item.value_text = String(value.text).trim();
    }
    payload.push(item);
  }
  return payload;
}

/** Сколько баллов даст текущий набор ответов (подсказка до отправки). */
export function pointsForValues(fields, values) {
  let total = 0;
  for (const field of fields) {
    if (field.type !== 'select' && field.type !== 'multiselect') continue;
    const value = values[field.id];
    if (!value) continue;
    const picked = field.type === 'select' ? (value.text ? [value.text] : []) : value.json || [];
    for (const code of picked) {
      const option = fieldOptions(field).find((o) => String(o.value) === String(code));
      const points = Number(option?.points);
      if (Number.isFinite(points)) total += points;
    }
  }
  return total;
}

/* --------------------------------------------------------------- поле формы */

/**
 * Один динамический элемент формы процесса.
 * Используется и при подаче заявки, и в панели решения на карточке заявки.
 */
export function ProcessFieldInput({
  field,
  value,
  error,
  employees = [],
  disabled = false,
  onChange,
  idPrefix = 'pf',
}) {
  const current = value || emptyFieldValue();
  const fieldId = `${idPrefix}-${field.id}`;
  const errorId = `${fieldId}-error`;
  const hintId = `${fieldId}-hint`;
  const invalid = !!error;
  const describedBy = invalid ? errorId : field.hint ? hintId : undefined;

  const patch = (part) => onChange?.({ ...current, ...part });

  const requiredMark = field.required ? (
    <span className="ml-0.5 text-destructive" aria-hidden="true">
      *
    </span>
  ) : null;

  const messages = (
    <>
      {field.hint && !invalid && (
        <p id={hintId} className="mt-1 text-xs text-muted-foreground">
          {field.hint}
        </p>
      )}
      {invalid && (
        <p id={errorId} role="alert" className="mt-1 text-sm text-destructive">
          {error}
        </p>
      )}
    </>
  );

  // Загрузчики рисуют собственную подпись — им передаём готовый label и явный id.
  if (field.type === 'file') {
    return (
      <div>
        <FileUpload
          id={fieldId}
          value={current.file_url}
          path={current.file_path}
          fileName={current.file_name}
          required={field.required}
          disabled={disabled}
          label={field.label}
          folder="process-requests"
          onChange={({ url, path, name }) =>
            patch({ file_url: url || '', file_path: path || '', file_name: name || '' })
          }
        />
        {messages}
      </div>
    );
  }

  if (field.type === 'image') {
    return (
      <div>
        <ImageUpload
          id={fieldId}
          value={current.file_url}
          path={current.file_path}
          disabled={disabled}
          aspect="wide"
          folder="process-requests"
          label={
            <>
              {field.label}
              {requiredMark}
            </>
          }
          onChange={({ url, path }) => patch({ file_url: url || '', file_path: path || '' })}
        />
        {messages}
      </div>
    );
  }

  let control = null;
  switch (field.type) {
    case 'select':
      control = (
        <select
          id={fieldId}
          className={cn(SELECT_CLASS, invalid && 'border-destructive')}
          value={current.text}
          disabled={disabled}
          aria-invalid={invalid ? 'true' : undefined}
          aria-describedby={describedBy}
          onChange={(e) => patch({ text: e.target.value })}
        >
          <option value="">Не выбрано</option>
          {fieldOptions(field).map((option) => (
            <option key={String(option.value)} value={String(option.value)}>
              {optionLabel(option)}
            </option>
          ))}
        </select>
      );
      break;

    case 'multiselect':
      control = (
        <div
          className={cn('space-y-2 rounded-md border border-input p-3', invalid && 'border-destructive')}
          role="group"
          aria-labelledby={`${fieldId}-label`}
          aria-describedby={describedBy}
        >
          {fieldOptions(field).map((option) => {
            const code = String(option.value);
            const checked = (current.json || []).some((v) => String(v) === code);
            return (
              <div key={code} className="flex min-h-[40px] items-center gap-2">
                <Checkbox
                  id={`${fieldId}-${code}`}
                  checked={checked}
                  disabled={disabled}
                  onCheckedChange={(next) => {
                    const list = (current.json || []).filter((v) => String(v) !== code);
                    patch({ json: next ? [...list, code] : list });
                  }}
                />
                <Label htmlFor={`${fieldId}-${code}`} className="cursor-pointer font-normal">
                  {optionLabel(option)}
                </Label>
              </div>
            );
          })}
          {!fieldOptions(field).length && (
            <p className="text-sm text-muted-foreground">Варианты ответа не настроены.</p>
          )}
        </div>
      );
      break;

    case 'textarea':
      control = (
        <Textarea
          id={fieldId}
          rows={4}
          value={current.text}
          disabled={disabled}
          aria-invalid={invalid ? 'true' : undefined}
          aria-describedby={describedBy}
          className={cn(invalid && 'border-destructive')}
          onChange={(e) => patch({ text: e.target.value })}
        />
      );
      break;

    case 'number':
      control = (
        <Input
          id={fieldId}
          type="number"
          value={current.number}
          disabled={disabled}
          aria-invalid={invalid ? 'true' : undefined}
          aria-describedby={describedBy}
          className={cn('min-h-[40px]', invalid && 'border-destructive')}
          onChange={(e) => patch({ number: e.target.value })}
        />
      );
      break;

    case 'date':
      control = (
        <Input
          id={fieldId}
          type="date"
          value={current.text}
          disabled={disabled}
          aria-invalid={invalid ? 'true' : undefined}
          aria-describedby={describedBy}
          className={cn('min-h-[40px]', invalid && 'border-destructive')}
          onChange={(e) => patch({ text: e.target.value })}
        />
      );
      break;

    case 'employee':
      control = (
        <select
          id={fieldId}
          className={cn(SELECT_CLASS, invalid && 'border-destructive')}
          value={current.text}
          disabled={disabled}
          aria-invalid={invalid ? 'true' : undefined}
          aria-describedby={describedBy}
          onChange={(e) => patch({ text: e.target.value })}
        >
          <option value="">Не выбран</option>
          {employees.map((employee) => (
            <option key={employee.id} value={employee.id}>
              {employee.name}
              {employee.department ? ` — ${employee.department}` : ''}
            </option>
          ))}
        </select>
      );
      break;

    default:
      control = (
        <Input
          id={fieldId}
          value={current.text}
          disabled={disabled}
          aria-invalid={invalid ? 'true' : undefined}
          aria-describedby={describedBy}
          className={cn('min-h-[40px]', invalid && 'border-destructive')}
          onChange={(e) => patch({ text: e.target.value })}
        />
      );
  }

  return (
    <div>
      <Label id={`${fieldId}-label`} htmlFor={field.type === 'multiselect' ? undefined : fieldId}>
        {field.label}
        {requiredMark}
      </Label>
      <div className="mt-1.5">{control}</div>
      {messages}
    </div>
  );
}

/* --------------------------------------------------------------- страница */

function FormSkeleton() {
  return (
    <div className="space-y-4" aria-hidden="true">
      <div className="h-4 w-24 animate-pulse rounded bg-muted" />
      <Card className="space-y-4 p-6">
        <div className="h-6 w-1/2 animate-pulse rounded bg-muted" />
        <div className="h-10 animate-pulse rounded bg-muted" />
        <div className="h-24 animate-pulse rounded bg-muted" />
        <div className="h-10 w-40 animate-pulse rounded bg-muted" />
      </Card>
    </div>
  );
}

export default function ProcessRequestForm() {
  const { processId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { employeeId, isLoadingAuth, hasRole } = useAuth();

  const [values, setValues] = useState({});
  const [chosenCategory, setChosenCategory] = useState(null);
  const [submitted, setSubmitted] = useState(false);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['process-form', processId],
    queryFn: async () => {
      const process = await api.entities.Process.get(processId);
      if (!process) return { process: null, categories: [], firstStage: null, fields: [] };

      const [categories, stages] = await Promise.all([
        api.entities.ProcessCategory.filter({ process_id: processId, is_active: true }, 'sort_order'),
        api.entities.ProcessStage.filter({ process_id: processId }, 'sort_order'),
      ]);
      const firstStage = stages[0] || null;
      const fields = firstStage
        ? await api.entities.ProcessField.filter({ stage_id: firstStage.id }, 'sort_order')
        : [];
      return { process, categories, firstStage, fields };
    },
    enabled: !!processId,
  });

  const process = data?.process || null;
  const categories = useMemo(() => data?.categories || [], [data]);
  const fields = useMemo(() => data?.fields || [], [data]);

  const needsEmployees = fields.some((f) => f.type === 'employee');
  const employeesQuery = useQuery({
    queryKey: ['employees-for-process-form'],
    queryFn: () => api.entities.Employee.list('name'),
    enabled: needsEmployees,
  });

  // Категория: из адреса (?category=…), из выбора пользователя либо единственная.
  const queryCategory = searchParams.get('category');
  const allowChoice = !!process?.allow_category_choice && categories.length > 1;
  const categoryId =
    chosenCategory ?? queryCategory ?? (categories.length === 1 ? categories[0].id : '');
  const showCategorySelect = categories.length > 0 && (allowChoice || !queryCategory);
  const selectedCategory = categories.find((c) => c.id === categoryId) || null;

  const fieldErrors = useMemo(() => validateFields(fields, values), [fields, values]);
  const categoryError = categories.length > 0 && !categoryId ? 'Выберите категорию' : null;
  const isValid = !categoryError && Object.keys(fieldErrors).length === 0;

  const points = useMemo(() => pointsForValues(fields, values), [fields, values]);

  const submit = useMutation({
    mutationFn: () =>
      api.rpc.submitProcessRequest(processId, categoryId || null, buildValuesPayload(fields, values)),
    onSuccess: (requestId) => {
      toast({
        title: 'Заявка отправлена',
        description: points > 0 ? `После согласования начислится ${formatPoints(points)}.` : undefined,
      });
      qc.invalidateQueries({ queryKey: ['process-requests'] });
      qc.invalidateQueries({ queryKey: ['admin-process-requests'] });
      navigate(`/cabinet/processes/requests/${requestId}`);
    },
    onError: (e) =>
      toast({
        variant: 'destructive',
        title: 'Не удалось отправить заявку',
        description: mutationErrorMessage(e, {
          23502: 'Заполнены не все обязательные поля — проверьте форму.',
          42501: 'Учётная запись не связана с карточкой сотрудника.',
          P0002: 'Процесс больше не опубликован — обновите страницу.',
        }),
      }),
  });

  const handleSubmit = (event) => {
    event.preventDefault();
    setSubmitted(true);
    if (!isValid) return;
    submit.mutate();
  };

  const showError = (fieldId) => (submitted ? fieldErrors[fieldId] : undefined);

  const backLink = (
    <Link
      to="/cabinet/processes"
      className="mb-4 inline-flex min-h-[40px] items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      Назад к процессам
    </Link>
  );

  const title = selectedCategory?.name || process?.name || 'Подача заявки';

  return (
    <PageContainer title={title} documentTitle={process?.name || 'Подача заявки'} width="narrow">
      {backLink}

      {error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : isLoadingAuth || isLoading ? (
        <FormSkeleton />
      ) : !employeeId ? (
        <EmptyState
          icon={UserX}
          title="Учётная запись не связана с карточкой сотрудника"
          description="Заявки подаются от имени сотрудника, поэтому подать её сейчас нельзя. Попросите HR-специалиста связать вашу учётную запись с карточкой сотрудника."
        />
      ) : !process || !process.is_active
        || (process.visible_to_role && !hasRole(process.visible_to_role)) ? (
        <EmptyState
          icon={Workflow}
          title="Процесс недоступен"
          description="Процесс не найден или снят с публикации. Вернитесь в каталог и выберите другой."
          action={
            <Button asChild>
              <Link to="/cabinet/processes">В каталог процессов</Link>
            </Button>
          }
        />
      ) : !data?.firstStage ? (
        <EmptyState
          icon={Workflow}
          title="Процесс ещё не настроен"
          description="В процессе не создано ни одного этапа, поэтому подать заявку нельзя. Сообщите HR-специалисту."
        />
      ) : (
        <Card className="p-6">
          <div className="mb-5">
            <h2 className="text-lg font-semibold text-foreground">{title}</h2>
            {process.description && (
              <p className="mt-1 text-sm text-muted-foreground">{process.description}</p>
            )}
          </div>

          <form onSubmit={handleSubmit} noValidate className="space-y-5">
            {showCategorySelect && (
              <div>
                <Label htmlFor="process-category">
                  Категория
                  <span className="ml-0.5 text-destructive" aria-hidden="true">
                    *
                  </span>
                </Label>
                <select
                  id="process-category"
                  className={cn(
                    'mt-1.5',
                    SELECT_CLASS,
                    submitted && categoryError && 'border-destructive'
                  )}
                  value={categoryId}
                  aria-invalid={submitted && categoryError ? 'true' : undefined}
                  aria-describedby={submitted && categoryError ? 'process-category-error' : undefined}
                  onChange={(e) => setChosenCategory(e.target.value)}
                >
                  <option value="">Не выбрана</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
                {submitted && categoryError && (
                  <p id="process-category-error" role="alert" className="mt-1 text-sm text-destructive">
                    {categoryError}
                  </p>
                )}
              </div>
            )}

            {fields.map((field) => (
              <ProcessFieldInput
                key={field.id}
                field={field}
                value={values[field.id]}
                error={showError(field.id)}
                employees={employeesQuery.data || []}
                disabled={submit.isPending}
                idPrefix="process-field"
                onChange={(next) => setValues((prev) => ({ ...prev, [field.id]: next }))}
              />
            ))}

            {!fields.length && (
              <p className="text-sm text-muted-foreground">
                На первом этапе нет полей для заполнения — просто отправьте заявку.
              </p>
            )}

            {points > 0 && (
              <p className="flex items-center gap-2 rounded-lg bg-success/10 px-3 py-2 text-sm text-foreground">
                <Sparkles className="h-4 w-4 text-success" aria-hidden="true" />
                За эту заявку начислится {formatPoints(points)}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button type="submit" disabled={!isValid || submit.isPending}>
                {submit.isPending ? 'Отправка…' : 'Отправить'}
              </Button>
              <Button type="button" variant="outline" asChild>
                <Link to="/cabinet/processes">Отмена</Link>
              </Button>
            </div>
          </form>
        </Card>
      )}
    </PageContainer>
  );
}
