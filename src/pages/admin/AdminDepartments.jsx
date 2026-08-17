import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Building2, Plus, User, Pencil, Trash2, ArrowRight } from 'lucide-react';

import { api } from '@/api/client';
import PageContainer from '@/components/common/PageContainer';
import EmptyState from '@/components/common/EmptyState';
import ErrorState from '@/components/common/ErrorState';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { pluralize } from '@/lib/format';

/**
 * Справочник отделов.
 *
 * BUG-039: сумма по отделам давала 14 при 15 сотрудниках, потому что численность
 *          считалась по строковому названию. Читаем вьюху v_departments —
 *          employees_count там считается по department_id.
 * BUG-077: «1 сотрудников» — числительные через pluralize.
 * BUG-040: демо-отдел «авыавы» скрыт: is_sample = false по умолчанию,
 *          показать можно переключателем.
 * BUG-072: в каждой модалке есть явная кнопка «Отмена», удаление — с подтверждением.
 * Аудит: карточка отдела кликабельна и ведёт в отфильтрованный список сотрудников.
 */

const EMPTY_FORM = { name: '', head_id: '', parent_id: '' };

function CardsSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" aria-hidden="true">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <Card key={i} className="p-5 h-[136px] animate-pulse bg-muted/40" />
      ))}
    </div>
  );
}

export default function AdminDepartments() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [showSample, setShowSample] = useState(false); // BUG-040
  const [editing, setEditing] = useState(null); // null | 'new' | объект отдела
  const [form, setForm] = useState(EMPTY_FORM);
  const [touched, setTouched] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null);

  /* ------------------------------------------------------------------ данные */

  // BUG-039: численность берём из вьюхи, а не считаем на клиенте.
  const departmentsQuery = useQuery({
    queryKey: ['admin-departments', showSample],
    queryFn: async () => {
      let query = api.supabase.from('v_departments').select('*').order('name');
      if (!showSample) query = query.eq('is_sample', false);
      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },
  });

  const employeesQuery = useQuery({
    queryKey: ['departments-heads'],
    queryFn: () =>
      api.entities.Employee.filter({ status: ['active', 'on_leave', 'probation'] }, 'name', 1000),
  });

  const departments = departmentsQuery.data || [];
  const employees = employeesQuery.data || [];

  const employeeById = useMemo(() => {
    const map = new Map();
    employees.forEach((e) => map.set(e.id, e));
    return map;
  }, [employees]);

  /* --------------------------------------------------------------- мутации */

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['admin-departments'] });
    qc.invalidateQueries({ queryKey: ['departments-dict'] });
    qc.invalidateQueries({ queryKey: ['portal-stats'] });
  };

  const buildPayload = (data) => ({
    name: data.name.trim(),
    head_id: data.head_id || null,
    // Денормализованное имя руководителя держим синхронным с карточкой сотрудника.
    head_name: data.head_id ? employeeById.get(data.head_id)?.name || null : null,
    parent_id: data.parent_id || null,
  });

  const save = useMutation({
    mutationFn: (data) =>
      editing === 'new'
        ? api.entities.Department.create(buildPayload(data))
        : api.entities.Department.update(editing.id, buildPayload(data)),
    onSuccess: () => {
      toast({ title: editing === 'new' ? 'Отдел создан' : 'Отдел обновлён' });
      setEditing(null);
      setForm(EMPTY_FORM);
      setTouched(false);
      invalidate();
    },
    onError: (e) => toast({ variant: 'destructive', title: 'Не удалось сохранить отдел', description: e?.message }),
  });

  const remove = useMutation({
    mutationFn: (department) => api.entities.Department.delete(department.id),
    onSuccess: () => {
      toast({ title: 'Отдел удалён' });
      setPendingDelete(null);
      invalidate();
    },
    onError: (e) => toast({ variant: 'destructive', title: 'Не удалось удалить отдел', description: e?.message }),
  });

  /* ------------------------------------------------------------- валидация */

  const nameTaken = departments.some(
    (d) => d.name.trim().toLowerCase() === form.name.trim().toLowerCase() && d.id !== editing?.id
  );
  const nameValid = form.name.trim().length >= 2 && !nameTaken;

  const openCreate = () => {
    setEditing('new');
    setForm(EMPTY_FORM);
    setTouched(false);
  };

  const openEdit = (department) => {
    setEditing(department);
    setForm({
      name: department.name || '',
      head_id: department.head_id || '',
      parent_id: department.parent_id || '',
    });
    setTouched(false);
  };

  return (
    <PageContainer
      title="Отделы"
      description="Структура организации. Численность считается по связи department_id."
      actions={
        <>
          <div className="flex items-center gap-2 mr-1">
            {/* BUG-040 */}
            <Switch id="departments-sample" checked={showSample} onCheckedChange={setShowSample} />
            <Label htmlFor="departments-sample" className="cursor-pointer">Показывать демо-данные</Label>
          </div>
          <Button onClick={openCreate}>
            <Plus className="w-4 h-4" aria-hidden="true" />
            Новый отдел
          </Button>
        </>
      }
    >
      {departmentsQuery.error ? (
        <ErrorState error={departmentsQuery.error} onRetry={departmentsQuery.refetch} />
      ) : departmentsQuery.isLoading ? (
        <CardsSkeleton />
      ) : departments.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="Отделов пока нет"
          description="Создайте первый отдел — он появится в фильтрах сотрудников и в карточках."
          actionLabel="Новый отдел"
          onAction={openCreate}
        />
      ) : (
        <ul role="list" className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {departments.map((d) => {
            const head = d.head_id ? employeeById.get(d.head_id) : null;
            const parent = departments.find((p) => p.id === d.parent_id);
            return (
              <li key={d.id} role="listitem">
                <Card className="h-full flex flex-col hover:shadow-premium transition">
                  {/* Аудит: карточка кликабельна и ведёт в отфильтрованный список сотрудников */}
                  <Link
                    to={`/admin/employees?department=${d.id}`}
                    className="flex items-start gap-3 p-5 group rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={`Сотрудники отдела «${d.name}»`}
                  >
                    <span className="w-10 h-10 rounded-lg bg-success/10 text-success flex items-center justify-center shrink-0">
                      <Building2 className="w-5 h-5" aria-hidden="true" />
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block font-semibold text-foreground truncate group-hover:text-primary transition">
                        {d.name}
                      </span>
                      {/* BUG-039 + BUG-077 */}
                      <span className="block text-xs text-muted-foreground">
                        {pluralize(d.employees_count || 0, 'сотрудник', 'сотрудника', 'сотрудников')}
                      </span>
                      {parent && (
                        <span className="block text-xs text-muted-foreground/80 truncate">
                          Входит в «{parent.name}»
                        </span>
                      )}
                    </span>
                    <ArrowRight
                      className="w-4 h-4 text-muted-foreground/40 group-hover:text-primary group-hover:translate-x-1 transition shrink-0"
                      aria-hidden="true"
                    />
                  </Link>

                  <div className="mt-auto flex items-center justify-between gap-2 px-5 py-3 border-t border-border">
                    <span className="flex items-center gap-2 text-sm text-muted-foreground min-w-0">
                      <User className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                      <span className="truncate">
                        {head?.name || d.head_name || 'Руководитель не назначен'}
                      </span>
                    </span>
                    <span className="flex items-center gap-1 shrink-0">
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => openEdit(d)}
                        aria-label={`Изменить отдел «${d.name}»`}
                      >
                        <Pencil className="w-4 h-4" aria-hidden="true" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => setPendingDelete(d)}
                        aria-label={`Удалить отдел «${d.name}»`}
                      >
                        <Trash2 className="w-4 h-4" aria-hidden="true" />
                      </Button>
                    </span>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      {/* Создание и изменение (BUG-025: валидация, BUG-072: явная «Отмена») */}
      <Dialog open={!!editing} onOpenChange={(open) => { if (!open) { setEditing(null); setTouched(false); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing === 'new' ? 'Новый отдел' : 'Изменить отдел'}</DialogTitle>
            <DialogDescription>
              Руководитель выбирается из карточек сотрудников — связь хранится в head_id.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label htmlFor="dept-name">Название</Label>
              <Input
                id="dept-name"
                className="min-h-[40px] mt-1"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                onBlur={() => setTouched(true)}
                placeholder="Продажи"
                aria-invalid={touched && !nameValid}
                aria-describedby="dept-name-error"
              />
              {touched && !nameValid && (
                <p id="dept-name-error" role="alert" className="text-xs text-destructive mt-1">
                  {nameTaken ? 'Отдел с таким названием уже существует.' : 'Название должно содержать минимум 2 символа.'}
                </p>
              )}
            </div>
            <div>
              <Label htmlFor="dept-head">Руководитель</Label>
              {employeesQuery.error ? (
                <ErrorState error={employeesQuery.error} onRetry={employeesQuery.refetch} compact />
              ) : (
                <select
                  id="dept-head"
                  className="mt-1 w-full min-h-[40px] rounded-md border border-input bg-background px-3 text-sm"
                  value={form.head_id}
                  onChange={(e) => setForm({ ...form, head_id: e.target.value })}
                  disabled={employeesQuery.isLoading}
                >
                  <option value="">Не назначен</option>
                  {employees.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                      {e.position ? ` · ${e.position}` : ''}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div>
              <Label htmlFor="dept-parent">Вышестоящий отдел</Label>
              <select
                id="dept-parent"
                className="mt-1 w-full min-h-[40px] rounded-md border border-input bg-background px-3 text-sm"
                value={form.parent_id}
                onChange={(e) => setForm({ ...form, parent_id: e.target.value })}
              >
                <option value="">Нет</option>
                {departments
                  .filter((d) => d.id !== editing?.id)
                  .map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
              </select>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setEditing(null)}>
              Отмена
            </Button>
            <Button
              onClick={() => {
                setTouched(true);
                if (nameValid) save.mutate(form);
              }}
              disabled={!nameValid || save.isPending}
            >
              {save.isPending ? 'Сохранение…' : editing === 'new' ? 'Создать' : 'Сохранить'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Подтверждение удаления */}
      <Dialog open={!!pendingDelete} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Удалить отдел?</DialogTitle>
            <DialogDescription>
              Отдел «{pendingDelete?.name}» будет удалён.{' '}
              {pendingDelete?.employees_count > 0
                ? `${pluralize(pendingDelete.employees_count, 'сотрудник', 'сотрудника', 'сотрудников')} останется без отдела — привязку придётся задать заново.`
                : 'Сотрудников в отделе нет.'}{' '}
              Действие нельзя отменить.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setPendingDelete(null)}>
              Отмена
            </Button>
            <Button variant="destructive" onClick={() => remove.mutate(pendingDelete)} disabled={remove.isPending}>
              {remove.isPending ? 'Удаление…' : 'Удалить'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
