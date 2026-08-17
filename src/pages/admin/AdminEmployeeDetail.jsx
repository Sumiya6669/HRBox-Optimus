import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, Mail, Phone, MapPin, Briefcase, Calendar, Cake, Shield, User,
  Pencil, Trash2, Award, Wallet, Target, Zap, CalendarDays, TrendingUp, Save,
  Lock, GraduationCap,
} from 'lucide-react';

import { api } from '@/api/client';
import PageContainer from '@/components/common/PageContainer';
import EmptyState from '@/components/common/EmptyState';
import ErrorState from '@/components/common/ErrorState';
import StatusBadge from '@/components/common/StatusBadge';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/lib/AuthContext';
import { statusLabel } from '@/lib/statusLabels';
import {
  formatDate, formatNumber, formatPoints, formatSigned, formatTenure, initials, pluralize,
} from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * Карточка сотрудника (аудит назвал экран лучшим в продукте — структура сохранена:
 * контакты, кадровые данные, баланс, достижения, планы развития, транзакции,
 * хлебные крошки и корректная 404).
 *
 * BUG-002: зарплатная вилка и заметки убраны из таблицы employees. Они лежат в
 *          employee_private и показываются отдельным блоком «Конфиденциально»
 *          только при isHR — без прав блок не рендерится вовсе.
 * BUG-021/022: стаж считается только из hire_date через formatTenure.
 * BUG-042: статус отпуска — из вьюхи v_employees (is_on_leave_now), а не из поля.
 * BUG-035: транзакции читаются из v_wallet_transactions, где заполнены филиал и отдел.
 * BUG-053: даты — только formatDate; BUG-055/056: суммы — formatPoints / formatSigned.
 * BUG-051: статусы — StatusBadge, английских кодов в интерфейсе нет.
 * BUG-072: удаление — через диалог с явной «Отмена», а не window.confirm.
 * Аудит: убрана безымянная строка с иконкой торта и «—» (пустые поля не рендерятся);
 *          добавлен блок «Записи на курсы» с прогрессом.
 */

const ROLE_TYPES = [
  { value: 'office', label: 'Офис' },
  { value: 'sales', label: 'Продажи' },
  { value: 'warehouse', label: 'Склад' },
  { value: 'hr', label: 'HR' },
  { value: 'management', label: 'Руководство' },
];

const STATUSES = [
  { value: 'active', label: 'Активен' },
  { value: 'probation', label: 'Испытательный срок' },
  { value: 'dismissed', label: 'Уволен' },
];

/** Строка «иконка + подпись + значение»; при пустом значении не рендерится вовсе. */
function InfoRow({ icon: Icon, label, value }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div className="flex items-center gap-3 text-sm">
      <Icon className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden="true" />
      <span className="text-muted-foreground">{label}:</span>
      <span className="text-foreground/80 min-w-0 truncate">{value}</span>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="space-y-4" aria-hidden="true">
      <Card className="p-6">
        <div className="flex items-center gap-4">
          <div className="w-20 h-20 rounded-full bg-muted animate-pulse" />
          <div className="flex-1 space-y-2">
            <div className="h-6 w-48 bg-muted rounded animate-pulse" />
            <div className="h-4 w-32 bg-muted/60 rounded animate-pulse" />
          </div>
        </div>
      </Card>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {[0, 1].map((i) => (
          <Card key={i} className="p-5 h-40 bg-muted/40 animate-pulse" />
        ))}
      </div>
    </div>
  );
}

export default function AdminEmployeeDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { isHR } = useAuth();

  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [form, setForm] = useState(null);
  const [privateForm, setPrivateForm] = useState({ salary_band: '', notes: '', iin: '', bank_account: '' });

  /* ------------------------------------------------------------------ данные */

  // BUG-042: вьюха даёт фактический статус отпуска и баланс баллов.
  const employeeQuery = useQuery({
    queryKey: ['admin-employee', id],
    queryFn: async () => {
      const { data, error } = await api.supabase.from('v_employees').select('*').eq('id', id).maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
    retry: false,
  });

  const employee = employeeQuery.data;
  const enabled = { enabled: !!id && !!employee };

  const balanceQuery = useQuery({
    queryKey: ['admin-employee-balance', id],
    queryFn: () => api.rpc.walletBalance(id),
    ...enabled,
  });

  // BUG-035: филиал и отдел в операциях приходят заполненными из вьюхи.
  const walletQuery = useQuery({
    queryKey: ['admin-employee-wallet', id],
    queryFn: async () => {
      const { data, error } = await api.supabase
        .from('v_wallet_transactions')
        .select('*')
        .eq('employee_id', id)
        .order('date', { ascending: false })
        .limit(10);
      if (error) throw error;
      return data || [];
    },
    ...enabled,
  });

  const achievementsQuery = useQuery({
    queryKey: ['admin-employee-achievements', id],
    queryFn: () => api.entities.Achievement.filter({ employee_id: id }, '-date'),
    ...enabled,
  });
  const goalsQuery = useQuery({
    queryKey: ['admin-employee-goals', id],
    queryFn: () => api.entities.Goal.filter({ employee_id: id }, '-created_date'),
    ...enabled,
  });
  const kpisQuery = useQuery({
    queryKey: ['admin-employee-kpis', id],
    queryFn: () => api.entities.KPI.filter({ employee_id: id }),
    ...enabled,
  });
  const leavesQuery = useQuery({
    queryKey: ['admin-employee-leaves', id],
    queryFn: () => api.entities.LeaveRequest.filter({ employee_id: id }, '-created_date'),
    ...enabled,
  });
  const devPlansQuery = useQuery({
    queryKey: ['admin-employee-dev', id],
    queryFn: () => api.entities.DevelopmentPlan.filter({ employee_id: id }, '-created_date'),
    ...enabled,
  });
  // Аудит: записи на курсы с прогрессом.
  const enrollmentsQuery = useQuery({
    queryKey: ['admin-employee-enrollments', id],
    queryFn: () => api.entities.Enrollment.filter({ employee_id: id }, '-created_date'),
    ...enabled,
  });
  const coursesQuery = useQuery({
    queryKey: ['courses-dict'],
    queryFn: () => api.entities.Course.list('title', 1000),
    ...enabled,
  });

  // BUG-002: конфиденциальные данные запрашиваются только при роли HR.
  // Таблица employee_private ключуется employee_id (колонки id в ней нет), поэтому filter, а не get.
  const privateQuery = useQuery({
    queryKey: ['admin-employee-private', id],
    queryFn: async () => {
      const rows = await api.entities.EmployeePrivate.filter({ employee_id: id });
      return rows?.[0] || null;
    },
    enabled: !!id && !!employee && isHR,
  });

  const departmentsQuery = useQuery({
    queryKey: ['departments-dict'],
    queryFn: () => api.entities.Department.list('name', 500),
  });
  const branchesQuery = useQuery({
    queryKey: ['branches-dict'],
    queryFn: () => api.entities.Branch.list('city', 500),
  });
  const managersQuery = useQuery({
    queryKey: ['managers-dict'],
    queryFn: () => api.entities.Employee.filter({ status: ['active', 'on_leave', 'probation'] }, 'name', 1000),
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
  const managerName = useMemo(() => {
    const map = new Map();
    (managersQuery.data || []).forEach((m) => map.set(m.id, m.name));
    return map;
  }, [managersQuery.data]);
  const courseTitle = useMemo(() => {
    const map = new Map();
    (coursesQuery.data || []).forEach((c) => map.set(c.id, c.title));
    return map;
  }, [coursesQuery.data]);

  useEffect(() => {
    if (!employee) return;
    setForm({
      name: employee.name || '',
      position: employee.position || '',
      department_id: employee.department_id || '',
      branch_id: employee.branch_id || '',
      email: employee.email || '',
      phone: employee.phone || '',
      role_type: employee.role_type || 'office',
      status: employee.status === 'on_leave' ? 'active' : employee.status || 'active',
      hire_date: employee.hire_date || '',
      birth_date: employee.birth_date || '',
      manager_id: employee.manager_id || '',
    });
  }, [employee]);

  useEffect(() => {
    setPrivateForm({
      salary_band: privateQuery.data?.salary_band || '',
      notes: privateQuery.data?.notes || '',
      iin: privateQuery.data?.iin || '',
      bank_account: privateQuery.data?.bank_account || '',
    });
  }, [privateQuery.data]);

  /* --------------------------------------------------------------- мутации */

  const update = useMutation({
    mutationFn: (data) =>
      api.entities.Employee.update(id, {
        name: data.name.trim(),
        position: data.position.trim() || null,
        // BUG-039: связи по идентификаторам, названия держим синхронными для отображения.
        department_id: data.department_id || null,
        branch_id: data.branch_id || null,
        department: departmentName.get(data.department_id) || null,
        branch: branchName.get(data.branch_id) || null,
        email: data.email.trim() || null,
        phone: data.phone.trim() || null,
        role_type: data.role_type,
        status: data.status,
        hire_date: data.hire_date || null,
        birth_date: data.birth_date || null,
        manager_id: data.manager_id || null,
        manager_name: managerName.get(data.manager_id) || null,
      }),
    onSuccess: () => {
      toast({ title: 'Карточка обновлена' });
      setEditOpen(false);
      qc.invalidateQueries({ queryKey: ['admin-employee', id] });
      qc.invalidateQueries({ queryKey: ['admin-employees'] });
    },
    onError: (e) => toast({ variant: 'destructive', title: 'Не удалось сохранить карточку', description: e?.message }),
  });

  // BUG-002: конфиденциальные поля пишутся в employee_private, не в employees.
  const savePrivate = useMutation({
    mutationFn: (data) =>
      api.entities.EmployeePrivate.upsert(
        {
          employee_id: id,
          salary_band: data.salary_band.trim() || null,
          notes: data.notes.trim() || null,
          iin: data.iin.trim() || null,
          bank_account: data.bank_account.trim() || null,
        },
        'employee_id'
      ),
    onSuccess: () => {
      toast({ title: 'Конфиденциальные данные сохранены' });
      qc.invalidateQueries({ queryKey: ['admin-employee-private', id] });
    },
    onError: (e) => toast({ variant: 'destructive', title: 'Не удалось сохранить данные', description: e?.message }),
  });

  const remove = useMutation({
    mutationFn: () => api.entities.Employee.delete(id),
    onSuccess: () => {
      toast({ title: 'Сотрудник удалён' });
      qc.invalidateQueries({ queryKey: ['admin-employees'] });
      navigate('/admin/employees');
    },
    onError: (e) => toast({ variant: 'destructive', title: 'Не удалось удалить сотрудника', description: e?.message }),
  });

  /* -------------------------------------------------------------- состояния */

  const breadcrumbs = (
    <nav aria-label="Хлебные крошки" className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
      <Link to="/admin/employees" className="hover:text-primary transition flex items-center gap-1">
        <ArrowLeft className="w-4 h-4" aria-hidden="true" />
        Сотрудники
      </Link>
      <span aria-hidden="true" className="text-muted-foreground/40">/</span>
      <span className="text-foreground font-medium truncate">{employee?.name || 'Карточка'}</span>
    </nav>
  );

  if (employeeQuery.error) {
    return (
      <PageContainer documentTitle="Карточка сотрудника" breadcrumbs={breadcrumbs}>
        <ErrorState error={employeeQuery.error} onRetry={employeeQuery.refetch} />
      </PageContainer>
    );
  }

  if (employeeQuery.isLoading) {
    return (
      <PageContainer documentTitle="Карточка сотрудника" breadcrumbs={breadcrumbs}>
        <DetailSkeleton />
      </PageContainer>
    );
  }

  // Корректная 404 для несуществующего ID (сохранено из прежней версии страницы).
  if (!employee) {
    return (
      <PageContainer documentTitle="Сотрудник не найден" breadcrumbs={breadcrumbs} width="narrow">
        <EmptyState
          icon={User}
          title="Сотрудник не найден"
          description="Возможно, карточка была удалена или идентификатор указан неверно."
          action={
            <Button asChild variant="outline">
              <Link to="/admin/employees">
                <ArrowLeft className="w-4 h-4" aria-hidden="true" />К списку сотрудников
              </Link>
            </Button>
          }
        />
      </PageContainer>
    );
  }

  const achievements = achievementsQuery.data || [];
  const goals = goalsQuery.data || [];
  const kpis = kpisQuery.data || [];
  const leaves = leavesQuery.data || [];
  const devPlans = devPlansQuery.data || [];
  const enrollments = enrollmentsQuery.data || [];
  const wallet = walletQuery.data || [];

  const activeGoals = goals.filter((g) => g.status === 'active');
  const pendingLeaves = leaves.filter((l) => l.status === 'pending');
  const balance = balanceQuery.data ?? employee.points_balance ?? 0;

  const tiles = [
    { icon: Wallet, label: 'Баланс', value: formatPoints(balance), tone: 'text-brand-wallet' },
    { icon: Award, label: 'Достижений', value: formatNumber(achievements.length), tone: 'text-warning' },
    { icon: Target, label: 'Активных целей', value: formatNumber(activeGoals.length), tone: 'text-success' },
    { icon: Zap, label: 'KPI', value: formatNumber(kpis.length), tone: 'text-info' },
    { icon: CalendarDays, label: 'Заявок на отпуск', value: formatNumber(pendingLeaves.length), tone: 'text-primary' },
  ];

  return (
    <PageContainer documentTitle={employee.name} breadcrumbs={breadcrumbs} width="wide">
      <div className="space-y-5">
        {/* Шапка карточки */}
        <Card className="p-6">
          <div className="flex flex-col sm:flex-row items-start gap-5">
            <Avatar className="w-20 h-20">
              <AvatarFallback className="bg-primary text-primary-foreground text-2xl font-bold">
                {initials(employee.name)}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 flex-wrap mb-1">
                <h1 className="text-2xl font-bold text-foreground">{employee.name}</h1>
                {/* BUG-042: фактический статус отпуска из вьюхи */}
                <StatusBadge value={employee.is_on_leave_now ? 'on_leave' : employee.status} />
              </div>
              {employee.position && <p className="text-sm text-muted-foreground">{employee.position}</p>}
              <div className="flex items-center gap-2 mt-3 flex-wrap">
                {departmentName.get(employee.department_id) && (
                  <Badge variant="secondary">{departmentName.get(employee.department_id)}</Badge>
                )}
                {branchName.get(employee.branch_id) && (
                  <Badge variant="secondary">{branchName.get(employee.branch_id)}</Badge>
                )}
                {employee.role_type && <StatusBadge value={employee.role_type} />}
                {employee.hire_date && (
                  <Badge variant="outline" className="flex items-center gap-1">
                    <Calendar className="w-3 h-3" aria-hidden="true" />
                    {/* BUG-021/022: стаж только из hire_date */}
                    {formatTenure(employee.hire_date)}
                  </Badge>
                )}
              </div>
            </div>
            <div className="flex gap-2 shrink-0">
              <Button variant="outline" size="sm" className="min-h-[40px]" onClick={() => setEditOpen(true)}>
                <Pencil className="w-4 h-4" aria-hidden="true" />
                Редактировать
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="text-muted-foreground hover:text-destructive"
                onClick={() => setDeleteOpen(true)}
                aria-label={`Удалить сотрудника ${employee.name}`}
              >
                <Trash2 className="w-4 h-4" aria-hidden="true" />
              </Button>
            </div>
          </div>
        </Card>

        {/* Контакты и кадровая информация */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card className="p-5 space-y-3">
            <h2 className="font-semibold text-foreground flex items-center gap-2">
              <User className="w-4 h-4 text-primary" aria-hidden="true" />
              Контактные данные
            </h2>
            <InfoRow icon={Mail} label="Email" value={employee.email} />
            <InfoRow icon={Phone} label="Телефон" value={employee.phone} />
            <InfoRow icon={MapPin} label="Филиал" value={branchName.get(employee.branch_id)} />
            <InfoRow icon={Briefcase} label="Отдел" value={departmentName.get(employee.department_id)} />
            {!employee.email && !employee.phone && !employee.branch_id && !employee.department_id && (
              <p className="text-sm text-muted-foreground">Контактные данные не заполнены.</p>
            )}
          </Card>

          <Card className="p-5 space-y-3">
            <h2 className="font-semibold text-foreground flex items-center gap-2">
              <Shield className="w-4 h-4 text-primary" aria-hidden="true" />
              Кадровая информация
            </h2>
            {/* Пустые поля не рендерятся: раньше здесь висела безымянная строка с тортом и «—» */}
            <InfoRow icon={Calendar} label="Приём" value={employee.hire_date ? formatDate(employee.hire_date) : null} />
            <InfoRow icon={Calendar} label="Стаж" value={employee.hire_date ? formatTenure(employee.hire_date) : null} />
            <InfoRow icon={Cake} label="День рождения" value={employee.birth_date ? formatDate(employee.birth_date, 'day') : null} />
            <InfoRow icon={User} label="Руководитель" value={managerName.get(employee.manager_id) || employee.manager_name} />
            <InfoRow
              icon={CalendarDays}
              label="Отпуск сейчас"
              value={employee.is_on_leave_now ? 'Да, есть согласованная заявка' : 'Нет'}
            />
            <InfoRow
              icon={Briefcase}
              label="Дней отпуска в год"
              value={employee.vacation_days_per_year ? formatNumber(employee.vacation_days_per_year) : null}
            />
          </Card>
        </div>

        {/* Показатели */}
        <ul role="list" className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {tiles.map((tile) => {
            const Icon = tile.icon;
            return (
              <li key={tile.label} role="listitem">
                <Card className="p-4 text-center h-full">
                  <Icon className={cn('w-5 h-5 mx-auto mb-1', tile.tone)} aria-hidden="true" />
                  <p className="text-lg font-bold text-foreground tabular-nums">{tile.value}</p>
                  <p className="text-[11px] text-muted-foreground">{tile.label}</p>
                </Card>
              </li>
            );
          })}
        </ul>

        {/* BUG-002: блок «Конфиденциально» рендерится только для HR и администратора */}
        {isHR && (
          <Card className="p-5 border-warning/40">
            <h2 className="font-semibold text-foreground flex items-center gap-2 mb-1">
              <Lock className="w-4 h-4 text-warning" aria-hidden="true" />
              Конфиденциально
            </h2>
            <p className="text-xs text-muted-foreground mb-4">
              Зарплатная вилка и служебные заметки хранятся отдельно (employee_private) и доступны
              только HR-специалистам и администраторам.
            </p>
            {privateQuery.error ? (
              <ErrorState error={privateQuery.error} onRetry={privateQuery.refetch} compact />
            ) : privateQuery.isLoading ? (
              <div className="h-24 rounded bg-muted animate-pulse" aria-hidden="true" />
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="private-salary">Зарплатная вилка</Label>
                    <Input
                      id="private-salary"
                      className="min-h-[40px] mt-1"
                      value={privateForm.salary_band}
                      onChange={(e) => setPrivateForm({ ...privateForm, salary_band: e.target.value })}
                      placeholder="например, B2"
                    />
                  </div>
                  <div>
                    <Label htmlFor="private-iin">ИИН</Label>
                    <Input
                      id="private-iin"
                      className="min-h-[40px] mt-1"
                      value={privateForm.iin}
                      onChange={(e) => setPrivateForm({ ...privateForm, iin: e.target.value })}
                    />
                  </div>
                </div>
                <div>
                  <Label htmlFor="private-notes">Служебные заметки</Label>
                  <Textarea
                    id="private-notes"
                    className="mt-1"
                    rows={3}
                    value={privateForm.notes}
                    onChange={(e) => setPrivateForm({ ...privateForm, notes: e.target.value })}
                  />
                </div>
                <Button onClick={() => savePrivate.mutate(privateForm)} disabled={savePrivate.isPending}>
                  <Save className="w-4 h-4" aria-hidden="true" />
                  {savePrivate.isPending ? 'Сохранение…' : 'Сохранить'}
                </Button>
              </div>
            )}
          </Card>
        )}

        {/* Достижения и планы развития */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card className="p-5">
            <h2 className="font-semibold text-foreground flex items-center gap-2 mb-3">
              <Award className="w-4 h-4 text-warning" aria-hidden="true" />
              Достижения
            </h2>
            {achievementsQuery.error ? (
              <ErrorState error={achievementsQuery.error} onRetry={achievementsQuery.refetch} compact />
            ) : achievementsQuery.isLoading ? (
              <div className="h-20 rounded bg-muted animate-pulse" aria-hidden="true" />
            ) : achievements.length === 0 ? (
              <p className="text-sm text-muted-foreground">Достижений нет.</p>
            ) : (
              <ul role="list" className="space-y-2">
                {achievements.slice(0, 5).map((a) => (
                  <li key={a.id} role="listitem" className="flex items-center gap-2 text-sm">
                    <Award className="w-4 h-4 text-warning shrink-0" aria-hidden="true" />
                    <span className="text-foreground/80 truncate flex-1">{a.title}</span>
                    <Badge variant="success">{formatSigned(a.points, (n) => formatPoints(n, { short: true }))}</Badge>
                    <span className="text-xs text-muted-foreground shrink-0">{formatDate(a.date)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="p-5">
            <h2 className="font-semibold text-foreground flex items-center gap-2 mb-3">
              <TrendingUp className="w-4 h-4 text-primary" aria-hidden="true" />
              Планы развития
            </h2>
            {devPlansQuery.error ? (
              <ErrorState error={devPlansQuery.error} onRetry={devPlansQuery.refetch} compact />
            ) : devPlansQuery.isLoading ? (
              <div className="h-20 rounded bg-muted animate-pulse" aria-hidden="true" />
            ) : devPlans.length === 0 ? (
              <p className="text-sm text-muted-foreground">Планов развития нет.</p>
            ) : (
              <ul role="list" className="space-y-3">
                {devPlans.slice(0, 5).map((p) => (
                  <li key={p.id} role="listitem">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-foreground/80 truncate flex-1">{p.title}</span>
                      <StatusBadge value={p.status} />
                      <span className="text-xs text-muted-foreground tabular-nums">{formatNumber(p.progress)}%</span>
                    </div>
                    <Progress value={p.progress || 0} className="h-1.5 mt-1" aria-label={`Прогресс плана «${p.title}»`} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        {/* Аудит: записи на курсы */}
        <Card className="p-5">
          <h2 className="font-semibold text-foreground flex items-center gap-2 mb-3">
            <GraduationCap className="w-4 h-4 text-brand-learning" aria-hidden="true" />
            Записи на курсы
          </h2>
          {enrollmentsQuery.error ? (
            <ErrorState error={enrollmentsQuery.error} onRetry={enrollmentsQuery.refetch} compact />
          ) : enrollmentsQuery.isLoading ? (
            <div className="h-20 rounded bg-muted animate-pulse" aria-hidden="true" />
          ) : enrollments.length === 0 ? (
            <p className="text-sm text-muted-foreground">Сотрудник не записан ни на один курс.</p>
          ) : (
            <ul role="list" className="space-y-3">
              {enrollments.map((e) => (
                <li key={e.id} role="listitem">
                  <div className="flex items-center gap-2 text-sm flex-wrap">
                    <span className="text-foreground/80 truncate flex-1 min-w-0">
                      {courseTitle.get(e.course_id) || 'Курс удалён'}
                    </span>
                    <StatusBadge value={e.status} />
                    <span className="text-xs text-muted-foreground tabular-nums">{formatNumber(e.progress)}%</span>
                    {e.completed_at && (
                      <span className="text-xs text-muted-foreground">завершён {formatDate(e.completed_at)}</span>
                    )}
                  </div>
                  <Progress
                    value={e.progress || 0}
                    className="h-1.5 mt-1"
                    aria-label={`Прогресс по курсу «${courseTitle.get(e.course_id) || 'курс'}»`}
                  />
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Транзакции по баллам */}
        <Card className="overflow-hidden">
          <div className="p-5 pb-3 flex items-center justify-between gap-2 flex-wrap">
            <h2 className="font-semibold text-foreground flex items-center gap-2">
              <Wallet className="w-4 h-4 text-brand-wallet" aria-hidden="true" />
              Последние операции
            </h2>
            <Link to="/admin/wallet" className="text-xs text-primary hover:underline">
              Все операции
            </Link>
          </div>
          {walletQuery.error ? (
            <div className="p-5 pt-0">
              <ErrorState error={walletQuery.error} onRetry={walletQuery.refetch} compact />
            </div>
          ) : walletQuery.isLoading ? (
            <div className="p-5 pt-0 space-y-2" aria-hidden="true">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-10 rounded bg-muted animate-pulse" />
              ))}
            </div>
          ) : wallet.length === 0 ? (
            <div className="p-5 pt-0">
              <p className="text-sm text-muted-foreground">Операций по баллам нет.</p>
            </div>
          ) : (
            <div className="table-scroll">
              <table className="w-full text-sm">
                <caption className="sr-only">Последние операции по баллам сотрудника</caption>
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th scope="col" className="px-5 py-2 font-medium">Дата</th>
                    <th scope="col" className="px-5 py-2 font-medium">Основание</th>
                    <th scope="col" className="px-5 py-2 font-medium">Тип</th>
                    <th scope="col" className="px-5 py-2 font-medium">Отдел</th>
                    <th scope="col" className="px-5 py-2 font-medium">Филиал</th>
                    <th scope="col" className="px-5 py-2 font-medium table-sticky-actions text-right">Сумма</th>
                  </tr>
                </thead>
                <tbody>
                  {wallet.map((t) => (
                    <tr key={t.id} className="border-b border-border last:border-0">
                      <td className="px-5 py-2 text-muted-foreground whitespace-nowrap">{formatDate(t.date)}</td>
                      <td className="px-5 py-2 text-foreground/80 truncate max-w-[260px]">
                        {t.reason || t.reason_title || statusLabel(t.type)}
                      </td>
                      <td className="px-5 py-2">
                        <StatusBadge value={t.type} />
                      </td>
                      <td className="px-5 py-2 text-muted-foreground truncate max-w-[140px]">{t.department || '—'}</td>
                      <td className="px-5 py-2 text-muted-foreground truncate max-w-[140px]">{t.branch || '—'}</td>
                      <td
                        className={cn(
                          'px-5 py-2 table-sticky-actions text-right font-semibold whitespace-nowrap tabular-nums',
                          t.amount >= 0 ? 'text-success' : 'text-destructive'
                        )}
                      >
                        {formatSigned(t.amount, (n) => formatPoints(n, { short: true }))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {/* Редактирование карточки */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Редактирование карточки</DialogTitle>
            <DialogDescription>
              Отдел, филиал и руководитель выбираются из справочников — связь хранится по идентификатору.
            </DialogDescription>
          </DialogHeader>
          {form && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 py-2 max-h-[60vh] overflow-y-auto pr-1">
              <div className="sm:col-span-2">
                <Label htmlFor="edit-name">ФИО</Label>
                <Input
                  id="edit-name"
                  className="min-h-[40px] mt-1"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  aria-invalid={form.name.trim().length < 2}
                  aria-describedby="edit-name-error"
                />
                {form.name.trim().length < 2 && (
                  <p id="edit-name-error" role="alert" className="text-xs text-destructive mt-1">
                    Укажите ФИО сотрудника.
                  </p>
                )}
              </div>
              <div>
                <Label htmlFor="edit-position">Должность</Label>
                <Input
                  id="edit-position"
                  className="min-h-[40px] mt-1"
                  value={form.position}
                  onChange={(e) => setForm({ ...form, position: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="edit-department">Отдел</Label>
                <select
                  id="edit-department"
                  className="mt-1 w-full min-h-[40px] rounded-md border border-input bg-background px-3 text-sm"
                  value={form.department_id}
                  onChange={(e) => setForm({ ...form, department_id: e.target.value })}
                >
                  <option value="">Не указан</option>
                  {(departmentsQuery.data || []).map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="edit-branch">Филиал</Label>
                <select
                  id="edit-branch"
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
                <Label htmlFor="edit-email">Email</Label>
                <Input
                  id="edit-email"
                  type="email"
                  className="min-h-[40px] mt-1"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="edit-phone">Телефон</Label>
                <Input
                  id="edit-phone"
                  className="min-h-[40px] mt-1"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="edit-birth">Дата рождения</Label>
                <Input
                  id="edit-birth"
                  type="date"
                  className="min-h-[40px] mt-1"
                  value={form.birth_date}
                  onChange={(e) => setForm({ ...form, birth_date: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="edit-hire">Дата приёма</Label>
                <Input
                  id="edit-hire"
                  type="date"
                  className="min-h-[40px] mt-1"
                  value={form.hire_date}
                  onChange={(e) => setForm({ ...form, hire_date: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="edit-role-type">Тип роли</Label>
                <select
                  id="edit-role-type"
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
                <Label htmlFor="edit-status">Статус</Label>
                {/* BUG-042: «В отпуске» не выставляется вручную — он следует из согласованной заявки */}
                <select
                  id="edit-status"
                  className="mt-1 w-full min-h-[40px] rounded-md border border-input bg-background px-3 text-sm"
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value })}
                >
                  {STATUSES.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="edit-manager">Руководитель</Label>
                <select
                  id="edit-manager"
                  className="mt-1 w-full min-h-[40px] rounded-md border border-input bg-background px-3 text-sm"
                  value={form.manager_id}
                  onChange={(e) => setForm({ ...form, manager_id: e.target.value })}
                >
                  <option value="">Не назначен</option>
                  {(managersQuery.data || [])
                    .filter((m) => m.id !== id)
                    .map((m) => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                </select>
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              Отмена
            </Button>
            <Button
              onClick={() => update.mutate(form)}
              disabled={!form || form.name.trim().length < 2 || update.isPending}
            >
              <Save className="w-4 h-4" aria-hidden="true" />
              {update.isPending ? 'Сохранение…' : 'Сохранить'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* BUG-072: удаление с подтверждением и явной «Отмена» */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Удалить сотрудника?</DialogTitle>
            <DialogDescription>
              Карточка «{employee.name}» будет удалена вместе с целями, KPI, заявками и операциями по
              баллам ({pluralize(wallet.length, 'операция', 'операции', 'операций')} в последних записях).
              Действие нельзя отменить.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              Отмена
            </Button>
            <Button variant="destructive" onClick={() => remove.mutate()} disabled={remove.isPending}>
              {remove.isPending ? 'Удаление…' : 'Удалить'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
