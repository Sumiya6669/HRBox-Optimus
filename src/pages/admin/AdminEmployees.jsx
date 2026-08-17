import React, { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Search, Plus, Download, Users as UsersIcon, ChevronLeft, ChevronRight, ArrowRight,
} from 'lucide-react';

import { api } from '@/api/client';
import { createEntity } from '@/api/entity';
import PageContainer from '@/components/common/PageContainer';
import EmptyState from '@/components/common/EmptyState';
import ErrorState from '@/components/common/ErrorState';
import StatusBadge from '@/components/common/StatusBadge';
import FilterChips from '@/components/common/FilterChips';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { statusLabel } from '@/lib/statusLabels';
import { formatDate, formatNumber, formatPoints, formatTenure, initials, pluralize } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * Кадровый состав.
 *
 * BUG-039: сотрудник числился в «Отдел продаж», а справочник содержал «Продажи» —
 *          связь идёт по department_id / branch_id, фильтры строятся по справочникам
 *          departments / branches (id → name), а не по строковым названиям.
 * BUG-040: тестовые записи («Аааа Аааа») скрыты по умолчанию — фильтр is_sample = false,
 *          переключатель «Показывать демо-данные» выключен.
 * BUG-042: статус «В отпуске» больше не независимое поле: фактический отпуск берётся
 *          из вьюхи v_employees (is_on_leave_now), она же даёт points_balance.
 * BUG-053: даты — только formatDate, стаж — только formatTenure (BUG-021/022).
 * BUG-002: зарплатная вилка и заметки не показываются — они в employee_private под роль HR.
 * BUG-036: таблица в .table-scroll, колонка действий — .table-sticky-actions.
 * BUG-011: ошибка загрузки — ErrorState, а не «Сотрудники не найдены».
 */

// v_employees недоступна через api.entities (там базовая таблица employees).
const employeesView = createEntity('v_employees', { defaultSort: 'name' });

const PAGE_SIZE = 25;

const ROLE_TYPES = [
  { value: 'office', label: 'Офис' },
  { value: 'sales', label: 'Продажи' },
  { value: 'warehouse', label: 'Склад' },
  { value: 'hr', label: 'HR' },
  { value: 'management', label: 'Руководство' },
];

const EMPTY_FORM = {
  name: '',
  position: '',
  department_id: '',
  branch_id: '',
  email: '',
  phone: '',
  role_type: 'office',
  status: 'active',
  hire_date: '',
};

/** Экранирование запроса для PostgREST-условия or. */
function sanitizeSearch(value = '') {
  return value.replace(/[,()*]/g, ' ').trim();
}

/** CSV для Excel: разделитель «;», BOM в начале, кавычки удвоены. */
function toCsv(rows) {
  const headers = ['ФИО', 'Должность', 'Отдел', 'Филиал', 'Статус', 'Дата приёма', 'Стаж', 'Email', 'Телефон', 'Баллы'];
  const escape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [headers.map(escape).join(';')];
  rows.forEach((r) => {
    lines.push(
      [
        r.name,
        r.position,
        r.departmentName,
        r.branchName,
        r.statusLabel,
        r.hire_date ? formatDate(r.hire_date) : '',
        r.hire_date ? formatTenure(r.hire_date) : '',
        r.email,
        r.phone,
        formatNumber(r.points_balance || 0),
      ]
        .map(escape)
        .join(';')
    );
  });
  return `﻿${lines.join('\r\n')}`;
}

function TableSkeleton() {
  return (
    <div className="p-4 space-y-2" aria-hidden="true">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="h-12 rounded bg-muted animate-pulse" />
      ))}
    </div>
  );
}

export default function AdminEmployees() {
  const { toast } = useToast();
  const qc = useQueryClient();

  // Переход с карточки отдела: /admin/employees?department=<id> (BUG-039).
  const [searchParams, setSearchParams] = useSearchParams();
  const departmentId = searchParams.get('department') || 'all';
  const branchId = searchParams.get('branch') || 'all';

  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [showSample, setShowSample] = useState(false); // BUG-040
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [touched, setTouched] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(sanitizeSearch(searchDraft));
      setPage(1);
    }, 350);
    return () => clearTimeout(timer);
  }, [searchDraft]);

  const setParam = (key, value) => {
    const params = new URLSearchParams(searchParams);
    if (!value || value === 'all') params.delete(key);
    else params.set(key, value);
    setSearchParams(params, { replace: true });
    setPage(1);
  };

  /* ------------------------------------------------------------ справочники */

  const departmentsQuery = useQuery({
    queryKey: ['departments-dict'],
    queryFn: () => api.entities.Department.list('name', 500),
  });
  const branchesQuery = useQuery({
    queryKey: ['branches-dict'],
    queryFn: () => api.entities.Branch.list('city', 500),
  });

  const departmentName = useMemo(() => {
    const map = new Map();
    (departmentsQuery.data || []).forEach((d) => map.set(d.id, d.name));
    return map;
  }, [departmentsQuery.data]);

  const branchName = useMemo(() => {
    const map = new Map();
    (branchesQuery.data || []).forEach((b) => map.set(b.id, b.city));
    return map;
  }, [branchesQuery.data]);

  /* ----------------------------------------------------------------- запрос */

  const where = useMemo(() => {
    const w = {};
    if (!showSample) w.is_sample = false; // BUG-040
    if (departmentId !== 'all') w.department_id = departmentId; // BUG-039
    if (branchId !== 'all') w.branch_id = branchId;
    if (status === 'on_leave') w.is_on_leave_now = true; // BUG-042: фактический отпуск
    else if (status !== 'all') w.status = status;
    if (search) w.$or = `name.ilike.*${search}*,email.ilike.*${search}*,position.ilike.*${search}*`;
    return w;
  }, [showSample, departmentId, branchId, status, search]);

  const listQuery = useQuery({
    queryKey: ['admin-employees', where, page],
    queryFn: () => employeesView.page({ where, sort: 'name', page, pageSize: PAGE_SIZE }),
    placeholderData: (prev) => prev,
  });

  // Счётчики чипов считает сервер, а не длина текущей страницы.
  const countsQuery = useQuery({
    queryKey: ['admin-employees-counts', showSample, departmentId, branchId, search],
    queryFn: async () => {
      const base = { ...where };
      delete base.status;
      delete base.is_on_leave_now;
      const [all, active, onLeave, probation, dismissed] = await Promise.all([
        employeesView.count(base),
        employeesView.count({ ...base, status: 'active' }),
        employeesView.count({ ...base, is_on_leave_now: true }),
        employeesView.count({ ...base, status: 'probation' }),
        employeesView.count({ ...base, status: 'dismissed' }),
      ]);
      return { all, active, on_leave: onLeave, probation, dismissed };
    },
  });

  /* --------------------------------------------------------------- мутации */

  const create = useMutation({
    mutationFn: (data) =>
      api.entities.Employee.create({
        ...data,
        // Денормализованные названия оставляем синхронными со справочником (BUG-039).
        department: departmentName.get(data.department_id) || null,
        branch: branchName.get(data.branch_id) || null,
        department_id: data.department_id || null,
        branch_id: data.branch_id || null,
        hire_date: data.hire_date || null,
        email: data.email.trim() || null,
      }),
    onSuccess: (created) => {
      toast({ title: 'Сотрудник добавлен', description: created?.name });
      setCreateOpen(false);
      setForm(EMPTY_FORM);
      setTouched(false);
      qc.invalidateQueries({ queryKey: ['admin-employees'] });
      qc.invalidateQueries({ queryKey: ['admin-employees-counts'] });
      qc.invalidateQueries({ queryKey: ['admin-departments'] });
      qc.invalidateQueries({ queryKey: ['portal-stats'] });
    },
    onError: (e) => toast({ variant: 'destructive', title: 'Не удалось добавить сотрудника', description: e?.message }),
  });

  /* ---------------------------------------------------------------- экспорт */

  const exportCsv = async () => {
    setExporting(true);
    try {
      const rows = await employeesView.filter(where, 'name', 1000);
      const prepared = rows.map((r) => ({
        ...r,
        departmentName: departmentName.get(r.department_id) || r.department || '',
        branchName: branchName.get(r.branch_id) || r.branch || '',
        // BUG-051: в выгрузку тоже уходит человекочитаемый статус, а не код active/on_leave
        statusLabel: statusLabel(r.is_on_leave_now ? 'on_leave' : r.status),
      }));
      const blob = new Blob([toCsv(prepared)], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `employees-${formatDate(new Date(), 'iso')}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      toast({ title: 'Экспорт готов', description: pluralize(prepared.length, 'запись', 'записи', 'записей') });
    } catch (e) {
      toast({ variant: 'destructive', title: 'Не удалось выгрузить список', description: e?.message });
    } finally {
      setExporting(false);
    }
  };

  /* -------------------------------------------------------------- состояния */

  const rows = listQuery.data?.rows || [];
  const total = listQuery.data?.total || 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const counts = countsQuery.data;

  const statusOptions = [
    { value: 'all', label: 'Все', count: counts?.all },
    { value: 'active', label: 'Работают', count: counts?.active },
    { value: 'on_leave', label: 'В отпуске', count: counts?.on_leave },
    { value: 'probation', label: 'Испытательный срок', count: counts?.probation },
    { value: 'dismissed', label: 'Уволены', count: counts?.dismissed },
  ];

  const hasFilters = !!search || status !== 'all' || departmentId !== 'all' || branchId !== 'all';

  const resetFilters = () => {
    setSearchDraft('');
    setSearch('');
    setStatus('all');
    setSearchParams(new URLSearchParams(), { replace: true });
    setPage(1);
  };

  const formValid = form.name.trim().length > 1 && form.position.trim().length > 1 && !!form.department_id;

  return (
    <PageContainer
      title="Сотрудники"
      description="Кадровый состав: поиск, фильтры по справочникам отделов и филиалов, экспорт."
      width="wide"
      actions={
        <>
          <div className="flex items-center gap-2 mr-1">
            {/* BUG-040: демо-данные скрыты по умолчанию */}
            <Switch id="employees-sample" checked={showSample} onCheckedChange={(v) => { setShowSample(v); setPage(1); }} />
            <Label htmlFor="employees-sample" className="cursor-pointer">Показывать демо-данные</Label>
          </div>
          <Button variant="outline" onClick={exportCsv} disabled={exporting || listQuery.isLoading}>
            <Download className="w-4 h-4" aria-hidden="true" />
            {exporting ? 'Выгрузка…' : 'Экспорт CSV'}
          </Button>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="w-4 h-4" aria-hidden="true" />
            Новый сотрудник
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 mb-4">
        <div className="flex flex-col lg:flex-row lg:items-center gap-3">
          <div className="relative w-full lg:max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
            <label htmlFor="admin-employees-search" className="sr-only">
              Поиск по имени, email или должности
            </label>
            <Input
              id="admin-employees-search"
              type="search"
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
              placeholder="Поиск по имени, email или должности"
              className="pl-9 min-h-[40px]"
            />
          </div>

          {/* BUG-039: фильтры строятся по справочникам, значение — id, подпись — название */}
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="filter-department" className="sr-only">Отдел</label>
            <select
              id="filter-department"
              className="min-h-[40px] rounded-md border border-input bg-background px-3 text-sm"
              value={departmentId}
              onChange={(e) => setParam('department', e.target.value)}
            >
              <option value="all">Все отделы</option>
              {(departmentsQuery.data || []).map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>

            <label htmlFor="filter-branch" className="sr-only">Филиал</label>
            <select
              id="filter-branch"
              className="min-h-[40px] rounded-md border border-input bg-background px-3 text-sm"
              value={branchId}
              onChange={(e) => setParam('branch', e.target.value)}
            >
              <option value="all">Все филиалы</option>
              {(branchesQuery.data || []).map((b) => (
                <option key={b.id} value={b.id}>{b.city}</option>
              ))}
            </select>
          </div>
        </div>

        <FilterChips
          options={statusOptions}
          value={status}
          onChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
          ariaLabel="Фильтр сотрудников по статусу"
        />
      </div>

      <Card className={cn('overflow-hidden', listQuery.isFetching && !listQuery.isLoading && 'opacity-70')}>
        {listQuery.error ? (
          <div className="p-4">
            <ErrorState error={listQuery.error} onRetry={listQuery.refetch} />
          </div>
        ) : listQuery.isLoading ? (
          <TableSkeleton />
        ) : rows.length === 0 ? (
          <div className="p-4">
            <EmptyState
              icon={UsersIcon}
              title={hasFilters ? 'Сотрудники не найдены' : 'Сотрудников пока нет'}
              description={
                hasFilters
                  ? 'Измените запрос или снимите фильтры по отделу, филиалу и статусу.'
                  : 'Добавьте первую карточку сотрудника — она станет доступна в модулях портала.'
              }
              actionLabel={hasFilters ? 'Сбросить фильтры' : 'Новый сотрудник'}
              onAction={() => (hasFilters ? resetFilters() : setCreateOpen(true))}
            />
          </div>
        ) : (
          <div className="table-scroll">
            <table className="w-full text-sm">
              <caption className="sr-only">Список сотрудников</caption>
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th scope="col" className="px-4 py-3 font-medium">Сотрудник</th>
                  <th scope="col" className="px-4 py-3 font-medium">Должность</th>
                  <th scope="col" className="px-4 py-3 font-medium">Отдел</th>
                  <th scope="col" className="px-4 py-3 font-medium">Филиал</th>
                  <th scope="col" className="px-4 py-3 font-medium">Статус</th>
                  <th scope="col" className="px-4 py-3 font-medium">Приём</th>
                  <th scope="col" className="px-4 py-3 font-medium">Стаж</th>
                  <th scope="col" className="px-4 py-3 font-medium text-right">Баллы</th>
                  <th scope="col" className="px-4 py-3 font-medium table-sticky-actions text-right">Действия</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id} className="border-b border-border last:border-0 hover:bg-accent/40">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="w-9 h-9 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold shrink-0">
                          {initials(e.name)}
                        </span>
                        <span className="min-w-0">
                          <span className="block font-medium text-foreground truncate max-w-[220px]">{e.name}</span>
                          <span className="block text-xs text-muted-foreground truncate max-w-[220px]">
                            {e.email || '—'}
                          </span>
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground truncate max-w-[180px]">{e.position || '—'}</td>
                    <td className="px-4 py-3 text-muted-foreground truncate max-w-[160px]">
                      {departmentName.get(e.department_id) || '—'}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground truncate max-w-[140px]">
                      {branchName.get(e.branch_id) || '—'}
                    </td>
                    <td className="px-4 py-3">
                      {/* BUG-042: показываем фактический статус отпуска из вьюхи */}
                      <StatusBadge value={e.is_on_leave_now ? 'on_leave' : e.status} />
                      {e.status === 'on_leave' && !e.is_on_leave_now && (
                        <span className="block text-[11px] text-muted-foreground mt-1">
                          нет согласованной заявки
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{formatDate(e.hire_date)}</td>
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                      {e.hire_date ? formatTenure(e.hire_date) : '—'}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap tabular-nums text-foreground/80">
                      {formatPoints(e.points_balance || 0, { short: true })}
                    </td>
                    <td className="px-4 py-3 table-sticky-actions">
                      <div className="flex justify-end">
                        <Button asChild size="sm" variant="ghost" className="min-h-[40px]">
                          <Link to={`/admin/employees/${e.id}`} aria-label={`Открыть карточку сотрудника ${e.name}`}>
                            Открыть
                            <ArrowRight className="w-4 h-4" aria-hidden="true" />
                          </Link>
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {!listQuery.error && !listQuery.isLoading && rows.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 mt-4">
          <p className="text-sm text-muted-foreground" aria-live="polite">
            Показаны {formatNumber((page - 1) * PAGE_SIZE + 1)}–{formatNumber((page - 1) * PAGE_SIZE + rows.length)} из{' '}
            {pluralize(total, 'сотрудника', 'сотрудников', 'сотрудников')}
          </p>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="min-h-[40px]"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || listQuery.isFetching}
              aria-label="Предыдущая страница"
            >
              <ChevronLeft className="w-4 h-4" aria-hidden="true" />
              Назад
            </Button>
            <span className="text-sm text-muted-foreground">
              Страница {formatNumber(page)} из {formatNumber(pageCount)}
            </span>
            <Button
              size="sm"
              variant="outline"
              className="min-h-[40px]"
              onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              disabled={page >= pageCount || listQuery.isFetching}
              aria-label="Следующая страница"
            >
              Вперёд
              <ChevronRight className="w-4 h-4" aria-hidden="true" />
            </Button>
          </div>
        </div>
      )}

      {/* Создание карточки (BUG-025: валидация, BUG-072: явная «Отмена») */}
      <Dialog open={createOpen} onOpenChange={(open) => { setCreateOpen(open); if (!open) setTouched(false); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Новый сотрудник</DialogTitle>
            <DialogDescription>
              Отдел и филиал выбираются из справочников — карточка связывается по идентификатору.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 py-2">
            <div className="sm:col-span-2">
              <Label htmlFor="emp-name">ФИО</Label>
              <Input
                id="emp-name"
                className="min-h-[40px] mt-1"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                onBlur={() => setTouched(true)}
                aria-invalid={touched && form.name.trim().length < 2}
                aria-describedby="emp-name-error"
              />
              {touched && form.name.trim().length < 2 && (
                <p id="emp-name-error" role="alert" className="text-xs text-destructive mt-1">
                  Укажите ФИО сотрудника.
                </p>
              )}
            </div>
            <div>
              <Label htmlFor="emp-position">Должность</Label>
              <Input
                id="emp-position"
                className="min-h-[40px] mt-1"
                value={form.position}
                onChange={(e) => setForm({ ...form, position: e.target.value })}
                onBlur={() => setTouched(true)}
                aria-invalid={touched && form.position.trim().length < 2}
              />
            </div>
            <div>
              <Label htmlFor="emp-department">Отдел</Label>
              <select
                id="emp-department"
                className="mt-1 w-full min-h-[40px] rounded-md border border-input bg-background px-3 text-sm"
                value={form.department_id}
                onChange={(e) => setForm({ ...form, department_id: e.target.value })}
                aria-invalid={touched && !form.department_id}
              >
                <option value="">Выберите отдел</option>
                {(departmentsQuery.data || []).map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="emp-branch">Филиал</Label>
              <select
                id="emp-branch"
                className="mt-1 w-full min-h-[40px] rounded-md border border-input bg-background px-3 text-sm"
                value={form.branch_id}
                onChange={(e) => setForm({ ...form, branch_id: e.target.value })}
              >
                <option value="">Не указан</option>
                {(branchesQuery.data || []).map((b) => (
                  <option key={b.id} value={b.id}>{b.city}</option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="emp-role-type">Тип роли</Label>
              <select
                id="emp-role-type"
                className="mt-1 w-full min-h-[40px] rounded-md border border-input bg-background px-3 text-sm"
                value={form.role_type}
                onChange={(e) => setForm({ ...form, role_type: e.target.value })}
              >
                {ROLE_TYPES.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="emp-email">Email</Label>
              <Input
                id="emp-email"
                type="email"
                className="min-h-[40px] mt-1"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="emp-phone">Телефон</Label>
              <Input
                id="emp-phone"
                className="min-h-[40px] mt-1"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="emp-hire-date">Дата приёма</Label>
              <Input
                id="emp-hire-date"
                type="date"
                className="min-h-[40px] mt-1"
                value={form.hire_date}
                onChange={(e) => setForm({ ...form, hire_date: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="emp-status">Статус</Label>
              {/* BUG-042: «В отпуске» вручную не выставляется — он выводится из согласованной заявки */}
              <select
                id="emp-status"
                className="mt-1 w-full min-h-[40px] rounded-md border border-input bg-background px-3 text-sm"
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
              >
                <option value="active">Активен</option>
                <option value="probation">Испытательный срок</option>
                <option value="dismissed">Уволен</option>
              </select>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Отмена
            </Button>
            <Button
              onClick={() => {
                setTouched(true);
                if (formValid) create.mutate(form);
              }}
              disabled={!formValid || create.isPending}
            >
              {create.isPending ? 'Сохранение…' : 'Добавить'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
