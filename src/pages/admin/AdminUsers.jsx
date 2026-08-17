import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  UserPlus, Search, Users as UsersIcon, Mail, Link2, ChevronDown, ChevronLeft, ChevronRight,
  MailCheck, ShieldCheck, Copy, Check,
} from 'lucide-react';

import { api } from '@/api/client';
import PageContainer from '@/components/common/PageContainer';
import EmptyState from '@/components/common/EmptyState';
import ErrorState from '@/components/common/ErrorState';
import StatusBadge from '@/components/common/StatusBadge';
import FilterChips from '@/components/common/FilterChips';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/use-toast';
import { useAuth, ROLE_LABELS } from '@/lib/AuthContext';
import { formatDate, formatNumber, initials, pluralize } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * Учётные записи портала.
 *
 * BUG-011 (критично): модуль показывал «0 пользователей / Пользователи не найдены»,
 *          хотя API отвечал 401 — администратор считал, что учёток нет. Пустой список
 *          и ошибка теперь РАЗНЫЕ состояния: при ошибке рисуется ErrorState с кодом
 *          и кнопкой «Повторить».
 * BUG-071: модуль «Приглашения» дублировал этот экран. /admin/invitations редиректит
 *          сюда с ?tab=invitations, вкладка читается из query-параметра.
 * BUG-034: ролей четыре (employee / manager / hr / admin), роль меняется Edge-функцией
 *          api.users.setRole, а не прямым update по таблице profiles.
 * BUG-051: роль показывается StatusBadge, английские коды в интерфейс не попадают.
 * BUG-053: даты — только formatDate.
 * P0 аудита: связывание учётной записи с карточкой сотрудника (employee_id) — без него
 *          KPI, цели, уведомления и отпуск не видны ни сотруднику, ни руководителю.
 */

const PAGE_SIZE = 25;
const ROLES = ['employee', 'manager', 'hr', 'admin'];

/** Экранирование запроса для PostgREST-условия or: запятые и скобки ломают синтаксис. */
function sanitizeSearch(value = '') {
  return value.replace(/[,()*]/g, ' ').trim();
}

function TableSkeleton() {
  return (
    <div className="p-4 space-y-2" aria-hidden="true">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="h-12 rounded bg-muted animate-pulse" />
      ))}
    </div>
  );
}

export default function AdminUsers() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { user: currentUser } = useAuth();

  // BUG-071: активная вкладка живёт в адресе — редирект со «Приглашений» открывает нужную.
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('tab') === 'invitations' ? 'invitations' : 'users';

  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('all');
  const [page, setPage] = useState(1);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('employee');
  const [inviteTouched, setInviteTouched] = useState(false);
  // Ссылка-приглашение: открытый токен приходит один раз, дальше в базе только хеш.
  const [inviteLink, setInviteLink] = useState(null);
  const [linkCopied, setLinkCopied] = useState(false);

  const [linkTarget, setLinkTarget] = useState(null); // профиль, которому выбираем сотрудника
  const [linkEmployeeId, setLinkEmployeeId] = useState('');

  // Поиск с задержкой — сервер не дёргается на каждый символ.
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(sanitizeSearch(searchDraft));
      setPage(1);
    }, 350);
    return () => clearTimeout(timer);
  }, [searchDraft]);

  const setTab = (next) => {
    const params = new URLSearchParams(searchParams);
    if (next === 'invitations') params.set('tab', 'invitations');
    else params.delete('tab');
    setSearchParams(params, { replace: true });
  };

  const where = useMemo(() => {
    const w = {};
    if (role !== 'all') w.role = role;
    // Поиск сразу по имени и почте, но с серверной пагинацией (.page()).
    if (search) w.$or = `full_name.ilike.*${search}*,email.ilike.*${search}*`;
    return w;
  }, [role, search]);

  /* ------------------------------------------------------------------ данные */

  const usersQuery = useQuery({
    queryKey: ['admin-users', where, page],
    queryFn: () => api.entities.User.page({ where, sort: '-created_date', page, pageSize: PAGE_SIZE }),
    placeholderData: (prev) => prev,
  });

  // Счётчики для чипов считает сервер, а не длина текущей страницы.
  const countsQuery = useQuery({
    queryKey: ['admin-users-counts', search],
    queryFn: async () => {
      const base = search ? { $or: `full_name.ilike.*${search}*,email.ilike.*${search}*` } : {};
      const [all, ...byRole] = await Promise.all([
        api.entities.User.count(base),
        ...ROLES.map((r) => api.entities.User.count({ ...base, role: r })),
      ]);
      const map = { all };
      ROLES.forEach((r, i) => {
        map[r] = byRole[i];
      });
      return map;
    },
  });

  // Приглашения = профили, которые ещё ни разу не входили в портал.
  const invitesQuery = useQuery({
    queryKey: ['admin-users-invites'],
    queryFn: () => api.entities.User.filter({ last_login: null }, '-created_date', 200),
    enabled: tab === 'invitations',
  });

  // Карточки сотрудников для связывания учётной записи (P0 аудита).
  const employeesQuery = useQuery({
    queryKey: ['admin-users-employees'],
    queryFn: () =>
      api.entities.Employee.filter({ status: ['active', 'on_leave', 'probation'] }, 'name', 1000),
  });

  const employeeById = useMemo(() => {
    const map = new Map();
    (employeesQuery.data || []).forEach((e) => map.set(e.id, e));
    return map;
  }, [employeesQuery.data]);

  // Уже занятые карточки: profiles.employee_id уникален, повторная привязка упадёт на сервере.
  const takenEmployeeIds = useMemo(() => {
    const set = new Set();
    (usersQuery.data?.rows || []).forEach((u) => {
      if (u.employee_id) set.add(u.employee_id);
    });
    return set;
  }, [usersQuery.data]);

  /* --------------------------------------------------------------- мутации */

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['admin-users'] });
    qc.invalidateQueries({ queryKey: ['admin-users-counts'] });
    qc.invalidateQueries({ queryKey: ['admin-users-invites'] });
  };

  const invalidateInvites = () => qc.invalidateQueries({ queryKey: ['admin-invitation-links'] });

  const invite = useMutation({
    mutationFn: () => api.users.inviteUser(inviteEmail.trim(), inviteRole),
    onSuccess: () => {
      toast({ title: 'Приглашение отправлено', description: inviteEmail.trim() });
      setInviteEmail('');
      setInviteTouched(false);
      setInviteOpen(false);
      invalidate();
    },
    onError: (e) =>
      toast({ variant: 'destructive', title: 'Не удалось отправить приглашение', description: e?.message }),
  });

  /**
   * Ссылка-приглашение вместо письма: встроенная почта Supabase ограничена
   * несколькими письмами в час, а свой SMTP подключён не всегда. Ссылку можно
   * передать любым каналом — в мессенджере или лично при оформлении.
   */
  const createLink = useMutation({
    mutationFn: () =>
      api.users.createInvitation({
        email: inviteEmail.trim() || null,
        role: inviteRole,
      }),
    onSuccess: (data) => {
      setInviteLink(data);
      setLinkCopied(false);
      invalidateInvites();
    },
    onError: (e) =>
      toast({ variant: 'destructive', title: 'Не удалось создать ссылку', description: e?.message }),
  });

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(inviteLink.url);
      setLinkCopied(true);
      toast({ title: 'Ссылка скопирована' });
    } catch {
      toast({ variant: 'destructive', title: 'Не удалось скопировать', description: 'Выделите ссылку и скопируйте вручную.' });
    }
  };

  // BUG-034: роль меняет серверная Edge-функция (проверка прав и запись в журнал аудита).
  const changeRole = useMutation({
    mutationFn: ({ id, role: nextRole }) => api.users.setRole(id, nextRole),
    onSuccess: (_data, vars) => {
      toast({ title: 'Роль изменена', description: ROLE_LABELS[vars.role] });
      invalidate();
    },
    onError: (e) => toast({ variant: 'destructive', title: 'Не удалось изменить роль', description: e?.message }),
  });

  const linkEmployee = useMutation({
    mutationFn: ({ id, employeeId }) => api.entities.User.update(id, { employee_id: employeeId || null }),
    onSuccess: () => {
      toast({ title: 'Учётная запись связана с карточкой сотрудника' });
      setLinkTarget(null);
      setLinkEmployeeId('');
      invalidate();
    },
    onError: (e) => toast({ variant: 'destructive', title: 'Не удалось сохранить связь', description: e?.message }),
  });

  /* -------------------------------------------------------------- состояния */

  const rows = usersQuery.data?.rows || [];
  const total = usersQuery.data?.total || 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const counts = countsQuery.data;

  const roleOptions = [
    { value: 'all', label: 'Все роли', count: counts?.all },
    ...ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r], count: counts?.[r] })),
  ];

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inviteEmail.trim());
  const invites = invitesQuery.data || [];

  const resetFilters = () => {
    setSearchDraft('');
    setSearch('');
    setRole('all');
    setPage(1);
  };

  const openLinkDialog = (profile) => {
    setLinkTarget(profile);
    setLinkEmployeeId(profile.employee_id || '');
  };

  return (
    <PageContainer
      title="Пользователи"
      description="Учётные записи портала, роли и связь с карточками сотрудников."
      width="wide"
      actions={
        <Button onClick={() => setInviteOpen(true)}>
          <UserPlus className="w-4 h-4" aria-hidden="true" />
          Пригласить пользователя
        </Button>
      }
    >
      {/* BUG-071: два модуля схлопнуты в две вкладки одного экрана */}
      <Tabs value={tab} onValueChange={setTab} className="mb-4">
        <TabsList>
          <TabsTrigger value="users" className="min-h-[40px]">
            Пользователи{typeof counts?.all === 'number' ? ` (${formatNumber(counts.all)})` : ''}
          </TabsTrigger>
          <TabsTrigger value="invitations" className="min-h-[40px]">
            Приглашения{invitesQuery.data ? ` (${formatNumber(invites.length)})` : ''}
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {tab === 'users' ? (
        <>
          <div className="flex flex-col lg:flex-row lg:items-center gap-3 mb-4">
            <div className="relative w-full lg:max-w-sm">
              <Search
                className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground"
                aria-hidden="true"
              />
              <label htmlFor="admin-users-search" className="sr-only">
                Поиск по имени или email
              </label>
              <Input
                id="admin-users-search"
                type="search"
                value={searchDraft}
                onChange={(e) => setSearchDraft(e.target.value)}
                placeholder="Поиск по имени или email"
                className="pl-9 min-h-[40px]"
              />
            </div>
            <FilterChips
              options={roleOptions}
              value={role}
              onChange={(v) => {
                setRole(v);
                setPage(1);
              }}
              ariaLabel="Фильтр пользователей по роли"
            />
          </div>

          <Card className={cn('overflow-hidden', usersQuery.isFetching && !usersQuery.isLoading && 'opacity-70')}>
            {/* BUG-011: ошибка — отдельное состояние с кодом и повтором */}
            {usersQuery.error ? (
              <div className="p-4">
                <ErrorState error={usersQuery.error} onRetry={usersQuery.refetch} />
              </div>
            ) : usersQuery.isLoading ? (
              <TableSkeleton />
            ) : rows.length === 0 ? (
              <div className="p-4">
                <EmptyState
                  icon={UsersIcon}
                  title={search || role !== 'all' ? 'Ничего не найдено' : 'Пользователей пока нет'}
                  description={
                    search || role !== 'all'
                      ? 'Измените запрос или снимите фильтр по роли.'
                      : 'Пригласите первого пользователя — он получит письмо со ссылкой для входа.'
                  }
                  actionLabel={search || role !== 'all' ? 'Сбросить фильтры' : 'Пригласить пользователя'}
                  onAction={() => (search || role !== 'all' ? resetFilters() : setInviteOpen(true))}
                />
              </div>
            ) : (
              <div className="table-scroll">
                <table className="w-full text-sm">
                  <caption className="sr-only">Учётные записи портала</caption>
                  <thead>
                    <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th scope="col" className="px-4 py-3 font-medium">Пользователь</th>
                      <th scope="col" className="px-4 py-3 font-medium">Роль</th>
                      <th scope="col" className="px-4 py-3 font-medium">Карточка сотрудника</th>
                      <th scope="col" className="px-4 py-3 font-medium">Телефон</th>
                      <th scope="col" className="px-4 py-3 font-medium">Последний вход</th>
                      <th scope="col" className="px-4 py-3 font-medium">Создан</th>
                      <th scope="col" className="px-4 py-3 font-medium table-sticky-actions text-right">Действия</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((u) => {
                      const employee = u.employee_id ? employeeById.get(u.employee_id) : null;
                      const isSelf = currentUser?.id === u.id;
                      return (
                        <tr key={u.id} className="border-b border-border last:border-0 hover:bg-accent/40">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-3 min-w-0">
                              <span className="w-9 h-9 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold shrink-0">
                                {initials(u.full_name || u.email)}
                              </span>
                              <span className="min-w-0">
                                <span className="block font-medium text-foreground truncate max-w-[220px]">
                                  {u.full_name || 'Без имени'}
                                </span>
                                <span className="block text-xs text-muted-foreground truncate max-w-[220px]">
                                  {u.email}
                                </span>
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <StatusBadge value={u.role} />
                              {!u.is_active && <StatusBadge value="inactive" />}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            {employee ? (
                              <span className="text-foreground/80 truncate block max-w-[200px]">
                                {employee.name}
                                {employee.position ? ` · ${employee.position}` : ''}
                              </span>
                            ) : u.employee_id ? (
                              <span className="text-muted-foreground">Карточка недоступна</span>
                            ) : (
                              // P0 аудита: без связи пользователю не видны KPI, цели и отпуск.
                              <span className="text-warning">Не связана</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{u.phone || '—'}</td>
                          <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                            {u.last_login ? formatDate(u.last_login, 'datetime') : 'Ни разу'}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                            {formatDate(u.created_date)}
                          </td>
                          <td className="px-4 py-3 table-sticky-actions">
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                size="sm"
                                variant="ghost"
                                className="min-h-[40px]"
                                onClick={() => openLinkDialog(u)}
                                aria-label={`Связать учётную запись ${u.full_name || u.email} с карточкой сотрудника`}
                              >
                                <Link2 className="w-4 h-4" aria-hidden="true" />
                                Связать
                              </Button>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="min-h-[40px]"
                                    disabled={isSelf || changeRole.isPending}
                                    aria-label={`Изменить роль пользователя ${u.full_name || u.email}`}
                                  >
                                    Роль
                                    <ChevronDown className="w-4 h-4" aria-hidden="true" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuLabel>Назначить роль</DropdownMenuLabel>
                                  <DropdownMenuSeparator />
                                  {ROLES.map((r) => (
                                    <DropdownMenuItem
                                      key={r}
                                      disabled={u.role === r}
                                      onSelect={() => changeRole.mutate({ id: u.id, role: r })}
                                    >
                                      <ShieldCheck className="w-4 h-4" aria-hidden="true" />
                                      {ROLE_LABELS[r]}
                                    </DropdownMenuItem>
                                  ))}
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {!usersQuery.error && !usersQuery.isLoading && rows.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 mt-4">
              <p className="text-sm text-muted-foreground" aria-live="polite">
                Показаны {formatNumber((page - 1) * PAGE_SIZE + 1)}–
                {formatNumber((page - 1) * PAGE_SIZE + rows.length)} из{' '}
                {pluralize(total, 'пользователя', 'пользователей', 'пользователей')}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="min-h-[40px]"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1 || usersQuery.isFetching}
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
                  disabled={page >= pageCount || usersQuery.isFetching}
                  aria-label="Следующая страница"
                >
                  Вперёд
                  <ChevronRight className="w-4 h-4" aria-hidden="true" />
                </Button>
              </div>
            </div>
          )}
        </>
      ) : (
        /* ------------------------------------------------------- приглашения */
        <div className="space-y-4">
          <Card className="p-5">
            <h2 className="font-semibold text-foreground flex items-center gap-2 mb-1">
              <Mail className="w-5 h-5 text-primary" aria-hidden="true" />
              Пригласить в портал
            </h2>
            <p className="text-sm text-muted-foreground mb-4">
              Ссылку можно передать любым способом — в мессенджере или лично. Письмо требует
              настроенного SMTP: встроенная почта Supabase ограничена несколькими письмами в час.
              Роль изменяется позже на вкладке «Пользователи».
            </p>

            <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end mb-3">
              <div className="space-y-1.5">
                <Label htmlFor="link-email">Email (необязательно)</Label>
                <Input
                  id="link-email"
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => { setInviteEmail(e.target.value); setInviteLink(null); }}
                  placeholder="ivanov@optimus-kz.kz"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="link-role">Роль</Label>
                <select
                  id="link-role"
                  value={inviteRole}
                  onChange={(e) => { setInviteRole(e.target.value); setInviteLink(null); }}
                  className="h-10 w-full rounded-md border border-input bg-card px-3 text-sm min-h-[40px]"
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                  ))}
                </select>
              </div>
              <Button onClick={() => createLink.mutate()} disabled={createLink.isPending}>
                <Link2 className="w-4 h-4 mr-1.5" aria-hidden="true" />
                Создать ссылку
              </Button>
            </div>

            {inviteLink && (
              <div className="rounded-lg border border-border bg-muted/40 p-3 space-y-2">
                <p className="text-xs text-muted-foreground">
                  Ссылка действует до {formatDate(inviteLink.expires_at, 'long')} и сработает один раз.
                  Показывается только сейчас — потом её можно лишь выпустить заново.
                </p>
                <div className="flex gap-2">
                  <Input readOnly value={inviteLink.url} onFocus={(e) => e.target.select()} className="font-mono text-xs" />
                  <Button variant="outline" onClick={copyLink} aria-label="Скопировать ссылку">
                    {linkCopied
                      ? <Check className="w-4 h-4" aria-hidden="true" />
                      : <Copy className="w-4 h-4" aria-hidden="true" />}
                  </Button>
                </div>
              </div>
            )}

            <details className="mt-3">
              <summary className="text-sm text-muted-foreground cursor-pointer hover:text-foreground">
                Отправить письмом (нужен настроенный SMTP)
              </summary>
              <Button variant="outline" className="mt-2" onClick={() => setInviteOpen(true)}>
                <UserPlus className="w-4 h-4 mr-1.5" aria-hidden="true" />
                Отправить приглашение на почту
              </Button>
            </details>
          </Card>

          <Card className="overflow-hidden">
            {invitesQuery.error ? (
              <div className="p-4">
                <ErrorState error={invitesQuery.error} onRetry={invitesQuery.refetch} />
              </div>
            ) : invitesQuery.isLoading ? (
              <TableSkeleton />
            ) : invites.length === 0 ? (
              <div className="p-4">
                <EmptyState
                  icon={MailCheck}
                  title="Неотвеченных приглашений нет"
                  description="Все приглашённые пользователи уже входили в портал хотя бы один раз."
                  actionLabel="Пригласить пользователя"
                  onAction={() => setInviteOpen(true)}
                />
              </div>
            ) : (
              <div className="table-scroll">
                <table className="w-full text-sm">
                  <caption className="sr-only">Приглашения без первого входа</caption>
                  <thead>
                    <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th scope="col" className="px-4 py-3 font-medium">Email</th>
                      <th scope="col" className="px-4 py-3 font-medium">Имя</th>
                      <th scope="col" className="px-4 py-3 font-medium">Роль</th>
                      <th scope="col" className="px-4 py-3 font-medium">Приглашён</th>
                      <th scope="col" className="px-4 py-3 font-medium table-sticky-actions text-right">Действия</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invites.map((u) => (
                      <tr key={u.id} className="border-b border-border last:border-0 hover:bg-accent/40">
                        <td className="px-4 py-3 font-medium text-foreground truncate max-w-[260px]">{u.email}</td>
                        <td className="px-4 py-3 text-muted-foreground truncate max-w-[200px]">
                          {u.full_name || '—'}
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge value={u.role} />
                        </td>
                        <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                          {formatDate(u.created_date)}
                        </td>
                        <td className="px-4 py-3 table-sticky-actions">
                          <div className="flex justify-end">
                            <Button
                              size="sm"
                              variant="outline"
                              className="min-h-[40px]"
                              disabled={invite.isPending}
                              onClick={() => {
                                setInviteEmail(u.email);
                                setInviteRole(u.role || 'employee');
                                setInviteOpen(true);
                              }}
                              aria-label={`Отправить приглашение повторно на ${u.email}`}
                            >
                              <Mail className="w-4 h-4" aria-hidden="true" />
                              Отправить повторно
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
        </div>
      )}

      {/* Диалог приглашения (BUG-025: валидация до отправки, BUG-072: явная «Отмена») */}
      <Dialog
        open={inviteOpen}
        onOpenChange={(open) => {
          setInviteOpen(open);
          if (!open) setInviteTouched(false);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Пригласить пользователя</DialogTitle>
            <DialogDescription>
              На указанный адрес уйдёт письмо со ссылкой для входа в портал.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label htmlFor="invite-email">Email</Label>
              <Input
                id="invite-email"
                type="email"
                className="min-h-[40px] mt-1"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                onBlur={() => setInviteTouched(true)}
                aria-invalid={inviteTouched && !emailValid}
                aria-describedby="invite-email-error"
                placeholder="ivanov@optimus-kz.kz"
              />
              {inviteTouched && !emailValid && (
                <p id="invite-email-error" role="alert" className="text-xs text-destructive mt-1">
                  Введите корректный адрес электронной почты.
                </p>
              )}
            </div>
            <div>
              <Label htmlFor="invite-role">Роль</Label>
              <select
                id="invite-role"
                className="mt-1 w-full min-h-[40px] rounded-md border border-input bg-background px-3 text-sm"
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value)}
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setInviteOpen(false)}>
              Отмена
            </Button>
            <Button onClick={() => invite.mutate()} disabled={!emailValid || invite.isPending}>
              <Mail className="w-4 h-4" aria-hidden="true" />
              {invite.isPending ? 'Отправка…' : 'Отправить приглашение'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* P0 аудита: связывание учётной записи с карточкой сотрудника */}
      <Dialog open={!!linkTarget} onOpenChange={(open) => !open && setLinkTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Связать с карточкой сотрудника</DialogTitle>
            <DialogDescription>
              Без связи пользователю не видны KPI, цели, уведомления и заявки на отпуск.
              Одна карточка сотрудника может быть связана только с одной учётной записью.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              Учётная запись: <span className="text-foreground font-medium">{linkTarget?.full_name || linkTarget?.email}</span>
            </p>
            <div>
              <Label htmlFor="link-employee">Сотрудник</Label>
              {employeesQuery.error ? (
                <ErrorState error={employeesQuery.error} onRetry={employeesQuery.refetch} compact />
              ) : (
                <select
                  id="link-employee"
                  className="mt-1 w-full min-h-[40px] rounded-md border border-input bg-background px-3 text-sm"
                  value={linkEmployeeId}
                  onChange={(e) => setLinkEmployeeId(e.target.value)}
                  disabled={employeesQuery.isLoading}
                >
                  <option value="">— связь не задана —</option>
                  {(employeesQuery.data || []).map((e) => (
                    <option
                      key={e.id}
                      value={e.id}
                      disabled={takenEmployeeIds.has(e.id) && e.id !== linkTarget?.employee_id}
                    >
                      {e.name}
                      {e.position ? ` · ${e.position}` : ''}
                      {takenEmployeeIds.has(e.id) && e.id !== linkTarget?.employee_id ? ' (уже связан)' : ''}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setLinkTarget(null)}>
              Отмена
            </Button>
            <Button
              onClick={() => linkEmployee.mutate({ id: linkTarget.id, employeeId: linkEmployeeId })}
              disabled={linkEmployee.isPending || linkEmployeeId === (linkTarget?.employee_id || '')}
            >
              {linkEmployee.isPending ? 'Сохранение…' : 'Сохранить связь'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
