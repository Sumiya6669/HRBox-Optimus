import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus, Search, Trash2, Copy, Workflow, Settings2, Layers, Tags, Inbox,
} from 'lucide-react';

import { api } from '@/api/client';
import PageContainer from '@/components/common/PageContainer';
import EmptyState from '@/components/common/EmptyState';
import ErrorState from '@/components/common/ErrorState';
import StatusBadge from '@/components/common/StatusBadge';
import FilterChips from '@/components/common/FilterChips';
import ImageUpload from '@/components/common/ImageUpload';
import SafeImage from '@/components/common/SafeImage';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { formatNumber, pluralize } from '@/lib/format';
import { mutationErrorMessage } from '@/lib/dataErrors';

/**
 * Список бизнес-процессов и точка входа в конструктор.
 *
 * Процесс — цепочка этапов («Подача заявки» → «Согласование» → «Начисление баллов»),
 * по которой сотрудник подаёт заявку, а баллы начисляются автоматически из стоимости
 * выбранного варианта ответа (см. миграцию 0007).
 *
 * Важное про удаление: process_requests.process_id объявлен `on delete restrict`,
 * поэтому процесс, по которому уже есть заявки, удалить нельзя — база вернёт 23503.
 * Такой процесс снимают с публикации, а не удаляют, иначе история заявок и начислений
 * потеряла бы источник.
 */

const STATUS_FILTERS = [
  { value: 'all', label: 'Все' },
  { value: 'published', label: 'Опубликованные' },
  { value: 'draft', label: 'Черновики' },
];

const emptyForm = () => ({
  name: '',
  description: '',
  image_url: '',
  image_path: '',
});

function CardsSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3" aria-hidden="true">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <Card key={i} className="animate-pulse space-y-3 p-4">
          <div className="h-4 w-2/3 rounded bg-muted" />
          <div className="h-3 w-full rounded bg-muted/60" />
          <div className="h-3 w-1/2 rounded bg-muted/60" />
          <div className="h-9 w-full rounded bg-muted/40" />
        </Card>
      ))}
    </div>
  );
}

/** Полное копирование процесса: этапы, поля, варианты, маршруты и категории. */
async function duplicateProcess(source) {
  const created = await api.entities.Process.create({
    name: `${source.name} (копия)`,
    description: source.description || null,
    icon: source.icon || null,
    image_url: source.image_url || null,
    // Путь в Storage намеренно не копируем: файл общий с оригиналом, и замена
    // картинки в копии не должна удалять обложку исходного процесса.
    image_path: null,
    is_active: false,
    allow_category_choice: source.allow_category_choice ?? false,
    visible_to_role: source.visible_to_role || null,
    sort_order: source.sort_order ?? 0,
  });

  const stages = await api.entities.ProcessStage.filter({ process_id: source.id }, 'sort_order');
  // Соответствие «старый этап → новый этап»: по нему переносятся поля и маршруты.
  const stageMap = new Map();
  for (const stage of stages) {
    const copy = await api.entities.ProcessStage.create({
      process_id: created.id,
      name: stage.name,
      type: stage.type,
      sort_order: stage.sort_order,
      assignee_ids: stage.assignee_ids || [],
      watcher_ids: stage.watcher_ids || [],
      assignee_role: stage.assignee_role || null,
      watcher_role: stage.watcher_role || null,
      approve_by_manager: stage.approve_by_manager ?? false,
      deadline_hours: stage.deadline_hours ?? null,
    });
    stageMap.set(stage.id, copy.id);
  }

  const stageIds = stages.map((s) => s.id);
  if (stageIds.length) {
    const fields = await api.entities.ProcessField.filter({ stage_id: stageIds }, 'sort_order');
    if (fields.length) {
      await api.entities.ProcessField.bulkCreate(
        fields.map((f) => ({
          stage_id: stageMap.get(f.stage_id),
          label: f.label,
          hint: f.hint || null,
          type: f.type,
          options: f.options || [],
          required: f.required ?? false,
          sort_order: f.sort_order,
          visible_to_role: f.visible_to_role || null,
        }))
      );
    }

    const routes = await api.entities.ProcessRoute.filter({ stage_id: stageIds }, 'sort_order');
    if (routes.length) {
      await api.entities.ProcessRoute.bulkCreate(
        routes.map((r) => ({
          stage_id: stageMap.get(r.stage_id),
          kind: r.kind,
          // Терминальные маршруты цели не имеют — иначе сработает process_routes_target_valid.
          target_stage_id: r.kind === 'next' ? stageMap.get(r.target_stage_id) || null : null,
          require_comment: r.require_comment ?? false,
          sort_order: r.sort_order,
        }))
      );
    }
  }

  const categories = await api.entities.ProcessCategory.filter({ process_id: source.id }, 'sort_order');
  if (categories.length) {
    await api.entities.ProcessCategory.bulkCreate(
      categories.map((c) => ({
        process_id: created.id,
        name: c.name,
        description: c.description || null,
        sort_order: c.sort_order,
        is_active: c.is_active ?? true,
      }))
    );
  }

  return created;
}

export default function AdminProcesses() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchDraft.trim().toLowerCase()), 300);
    return () => clearTimeout(timer);
  }, [searchDraft]);

  /* --------------------------------------------------------------- данные */

  const processesQuery = useQuery({
    queryKey: ['admin-processes'],
    queryFn: () => api.entities.Process.list('sort_order', 500),
  });

  const stagesQuery = useQuery({
    queryKey: ['admin-processes-stages'],
    queryFn: () => api.entities.ProcessStage.list('sort_order', 2000),
  });

  const categoriesQuery = useQuery({
    queryKey: ['admin-processes-categories'],
    queryFn: () => api.entities.ProcessCategory.list('sort_order', 2000),
  });

  const requestsQuery = useQuery({
    queryKey: ['admin-processes-requests-count'],
    queryFn: () =>
      api.entities.ProcessRequest.page({
        columns: 'id,process_id',
        sort: '-created_date',
        page: 1,
        pageSize: 1000,
      }),
  });

  const countsByProcess = useMemo(() => {
    const stages = new Map();
    for (const s of stagesQuery.data || []) {
      stages.set(s.process_id, (stages.get(s.process_id) || 0) + 1);
    }
    const categories = new Map();
    for (const c of categoriesQuery.data || []) {
      categories.set(c.process_id, (categories.get(c.process_id) || 0) + 1);
    }
    const requests = new Map();
    for (const r of requestsQuery.data?.rows || []) {
      requests.set(r.process_id, (requests.get(r.process_id) || 0) + 1);
    }
    return { stages, categories, requests };
  }, [stagesQuery.data, categoriesQuery.data, requestsQuery.data]);

  const all = useMemo(() => processesQuery.data || [], [processesQuery.data]);

  const filtered = useMemo(() => {
    return all.filter((p) => {
      if (statusFilter === 'published' && !p.is_active) return false;
      if (statusFilter === 'draft' && p.is_active) return false;
      if (!search) return true;
      return (
        (p.name || '').toLowerCase().includes(search) ||
        (p.description || '').toLowerCase().includes(search)
      );
    });
  }, [all, search, statusFilter]);

  const statusOptions = useMemo(
    () =>
      STATUS_FILTERS.map((option) => ({
        ...option,
        count:
          option.value === 'all'
            ? all.length
            : option.value === 'published'
              ? all.filter((p) => p.is_active).length
              : all.filter((p) => !p.is_active).length,
      })),
    [all]
  );

  /* -------------------------------------------------------------- мутации */

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['admin-processes'] });
    qc.invalidateQueries({ queryKey: ['admin-processes-stages'] });
    qc.invalidateQueries({ queryKey: ['admin-processes-categories'] });
    qc.invalidateQueries({ queryKey: ['admin-processes-requests-count'] });
  };

  const create = useMutation({
    mutationFn: (payload) => api.entities.Process.create(payload),
    onSuccess: () => {
      toast({ title: 'Процесс создан', description: 'Откройте конструктор и настройте этапы.' });
      invalidate();
      setCreateOpen(false);
      setForm(emptyForm());
      setFormError(null);
    },
    onError: (e) =>
      toast({
        title: 'Не удалось создать процесс',
        description: mutationErrorMessage(e, {
          42501: 'Создавать процессы могут только HR-специалист и администратор.',
        }),
        variant: 'destructive',
      }),
  });

  const duplicate = useMutation({
    mutationFn: (process) => duplicateProcess(process),
    onSuccess: (created) => {
      toast({
        title: 'Процесс скопирован',
        description: `Создан черновик «${created.name}» с этапами, полями и маршрутами оригинала.`,
      });
      invalidate();
    },
    onError: (e) =>
      toast({
        title: 'Не удалось скопировать процесс',
        description: mutationErrorMessage(e, {
          42501: 'Копировать процессы могут только HR-специалист и администратор.',
        }),
        variant: 'destructive',
      }),
  });

  const togglePublish = useMutation({
    mutationFn: ({ id, is_active }) => api.entities.Process.update(id, { is_active }),
    onSuccess: (_data, variables) => {
      toast({ title: variables.is_active ? 'Процесс опубликован' : 'Процесс снят с публикации' });
      invalidate();
    },
    onError: (e) =>
      toast({
        title: 'Не удалось изменить публикацию',
        description: mutationErrorMessage(e, {
          42501: 'Публиковать процессы могут только HR-специалист и администратор.',
        }),
        variant: 'destructive',
      }),
  });

  const remove = useMutation({
    mutationFn: (process) => api.entities.Process.delete(process.id),
    onSuccess: () => {
      toast({ title: 'Процесс удалён' });
      invalidate();
      setPendingDelete(null);
    },
    onError: (e) => {
      toast({
        title: 'Не удалось удалить процесс',
        description: mutationErrorMessage(e, {
          // process_requests.process_id → on delete restrict
          23503: 'По процессу есть заявки, его нельзя удалить — снимите с публикации.',
          42501: 'Удалять процессы могут только HR-специалист и администратор.',
        }),
        variant: 'destructive',
      });
      setPendingDelete(null);
    },
  });

  const submitCreate = () => {
    const name = form.name.trim();
    if (!name) {
      setFormError('Укажите название процесса');
      return;
    }
    setFormError(null);
    create.mutate({
      name,
      description: form.description.trim() || null,
      image_url: form.image_url || null,
      image_path: form.image_path || null,
      is_active: false,
      sort_order: all.length,
    });
  };

  const error =
    processesQuery.error || stagesQuery.error || categoriesQuery.error || requestsQuery.error;
  const isLoading =
    processesQuery.isPending || stagesQuery.isPending || categoriesQuery.isPending || requestsQuery.isPending;
  const hasFilters = !!search || statusFilter !== 'all';

  const retry = () => {
    processesQuery.refetch();
    stagesQuery.refetch();
    categoriesQuery.refetch();
    requestsQuery.refetch();
  };

  return (
    <PageContainer
      title="Бизнес-процессы"
      description="Конструктор заявок: этапы, поля ввода, согласующие и автоматическое начисление баллов"
      actions={
        <Button onClick={() => { setForm(emptyForm()); setFormError(null); setCreateOpen(true); }}>
          <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
          Новый процесс
        </Button>
      }
    >
      <div className="space-y-4">
        <Card className="space-y-3 p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
              placeholder="Поиск по названию или описанию"
              aria-label="Поиск процессов"
              className="min-h-[40px] pl-9"
            />
          </div>
          <FilterChips
            ariaLabel="Статус публикации"
            value={statusFilter}
            onChange={setStatusFilter}
            options={statusOptions}
          />
        </Card>

        {error ? (
          <ErrorState error={error} onRetry={retry} />
        ) : isLoading ? (
          <CardsSkeleton />
        ) : !filtered.length ? (
          hasFilters ? (
            <EmptyState
              icon={Workflow}
              title="Ничего не найдено"
              description="Под текущий поиск и фильтр не подошёл ни один процесс."
              actionLabel="Сбросить фильтры"
              onAction={() => { setSearchDraft(''); setStatusFilter('all'); }}
            />
          ) : (
            <EmptyState
              icon={Workflow}
              title="Процессов пока нет"
              description="Создайте первый процесс: он описывает, как сотрудник подаёт заявку, кто её согласует и сколько баллов начисляется автоматически."
              actionLabel="Создать процесс"
              onAction={() => { setForm(emptyForm()); setFormError(null); setCreateOpen(true); }}
            />
          )
        ) : (
          <ul role="list" className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {filtered.map((process) => {
              const stagesCount = countsByProcess.stages.get(process.id) || 0;
              const categoriesCount = countsByProcess.categories.get(process.id) || 0;
              const requestsCount = countsByProcess.requests.get(process.id) || 0;
              return (
                <li key={process.id} role="listitem">
                  <Card className="flex h-full flex-col overflow-hidden">
                    {/* Битая ссылка не должна ломать карточку — SafeImage покажет заглушку */}
                    {process.image_url ? (
                      <SafeImage
                        src={process.image_url}
                        alt=""
                        className="h-28 w-full border-b border-border object-cover"
                        fallbackIcon={Workflow}
                      />
                    ) : null}
                    <div className="flex flex-1 flex-col gap-3 p-4">
                      <div className="flex items-start justify-between gap-2">
                        <h2 className="min-w-0 text-base font-semibold text-foreground">{process.name}</h2>
                        <StatusBadge value={process.is_active ? 'published' : 'draft'} />
                      </div>

                      <p className="line-clamp-2 min-h-[2.5rem] text-sm text-muted-foreground">
                        {process.description || 'Описание не заполнено'}
                      </p>

                      <dl className="grid grid-cols-3 gap-2 text-center text-xs text-muted-foreground">
                        <div className="rounded-lg bg-muted/50 px-2 py-2">
                          <dt className="flex items-center justify-center gap-1">
                            <Layers className="h-3.5 w-3.5" aria-hidden="true" />
                            Этапы
                          </dt>
                          <dd className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">
                            {formatNumber(stagesCount)}
                          </dd>
                        </div>
                        <div className="rounded-lg bg-muted/50 px-2 py-2">
                          <dt className="flex items-center justify-center gap-1">
                            <Tags className="h-3.5 w-3.5" aria-hidden="true" />
                            Категории
                          </dt>
                          <dd className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">
                            {formatNumber(categoriesCount)}
                          </dd>
                        </div>
                        <div className="rounded-lg bg-muted/50 px-2 py-2">
                          <dt className="flex items-center justify-center gap-1">
                            <Inbox className="h-3.5 w-3.5" aria-hidden="true" />
                            Заявки
                          </dt>
                          <dd className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">
                            {formatNumber(requestsCount)}
                          </dd>
                        </div>
                      </dl>

                      <label className="flex min-h-[40px] cursor-pointer items-center gap-2 text-sm text-muted-foreground">
                        <Switch
                          checked={!!process.is_active}
                          disabled={togglePublish.isPending}
                          onCheckedChange={(value) => togglePublish.mutate({ id: process.id, is_active: value })}
                          aria-label={`Публикация процесса «${process.name}»`}
                        />
                        {process.is_active ? 'Опубликован для сотрудников' : 'Черновик, сотрудникам не виден'}
                      </label>

                      <div className="mt-auto flex items-center gap-2 pt-1">
                        <Button asChild className="flex-1">
                          <Link to={`/admin/processes/${process.id}`}>
                            <Settings2 className="mr-1 h-4 w-4" aria-hidden="true" />
                            Конструктор
                          </Link>
                        </Button>
                        <Button
                          size="icon"
                          variant="outline"
                          aria-label={`Дублировать процесс «${process.name}»`}
                          disabled={duplicate.isPending}
                          onClick={() => duplicate.mutate(process)}
                        >
                          <Copy className="h-4 w-4" aria-hidden="true" />
                        </Button>
                        <Button
                          size="icon"
                          variant="outline"
                          aria-label={`Удалить процесс «${process.name}»`}
                          onClick={() => setPendingDelete(process)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" aria-hidden="true" />
                        </Button>
                      </div>

                      {requestsCount > 0 && (
                        <p className="text-xs text-muted-foreground">
                          По процессу уже есть {formatNumber(requestsCount)}{' '}
                          {pluralize(requestsCount, 'заявка', 'заявки', 'заявок')} — удалить его нельзя,
                          можно снять с публикации.
                        </p>
                      )}
                    </div>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Создание процесса */}
      <Dialog
        open={createOpen}
        onOpenChange={(value) => { setCreateOpen(value); if (!value) setFormError(null); }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Новый процесс</DialogTitle>
            <DialogDescription>
              Процесс создаётся черновиком: сначала настройте этапы в конструкторе, потом опубликуйте.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div>
              <Label htmlFor="process-name">Название</Label>
              <Input
                id="process-name"
                value={form.name}
                placeholder="Начисление баллов за активности"
                aria-invalid={!!formError}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
              {formError && (
                <p role="alert" className="mt-1 text-xs text-destructive">{formError}</p>
              )}
            </div>
            <div>
              <Label htmlFor="process-description">Описание</Label>
              <Textarea
                id="process-description"
                rows={3}
                value={form.description}
                placeholder="Что это за заявка и для чего она нужна сотруднику"
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              />
            </div>
            <ImageUpload
              value={form.image_url}
              path={form.image_path}
              folder="processes"
              label="Изображение процесса"
              hint="Показывается в каталоге процессов личного кабинета"
              onChange={({ url, path }) => setForm((f) => ({ ...f, image_url: url, image_path: path }))}
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Отмена</Button>
            <Button onClick={submitCreate} disabled={!form.name.trim() || create.isPending}>
              {create.isPending ? 'Создание…' : 'Создать процесс'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Подтверждение удаления */}
      <Dialog open={!!pendingDelete} onOpenChange={(value) => { if (!value) setPendingDelete(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Удалить процесс?</DialogTitle>
            <DialogDescription>
              {pendingDelete
                ? `Процесс «${pendingDelete.name}» будет удалён вместе с этапами, полями, маршрутами и категориями. Отменить это действие нельзя.`
                : ''}
            </DialogDescription>
          </DialogHeader>
          {pendingDelete && (countsByProcess.requests.get(pendingDelete.id) || 0) > 0 && (
            <p role="alert" className="text-sm text-destructive">
              По процессу есть заявки, его нельзя удалить — снимите с публикации.
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDelete(null)}>Отмена</Button>
            <Button
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => remove.mutate(pendingDelete)}
            >
              {remove.isPending ? 'Удаление…' : 'Удалить'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
