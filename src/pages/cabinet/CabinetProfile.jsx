import React, { useEffect, useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Briefcase, Building2, CalendarDays, Mail, MapPin, Phone, Save, Shield } from 'lucide-react';

import { api } from '@/api/client';
import PageContainer from '@/components/common/PageContainer';
import ErrorState from '@/components/common/ErrorState';
import ImageUpload from '@/components/common/ImageUpload';
import SafeImage from '@/components/common/SafeImage';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/lib/AuthContext';
import { useI18n } from '@/lib/i18n';
import { formatDate, formatTenure, initials } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * BUG-034: профиль показывал роль «Сотрудник», аватар «U» и два пустых бейджа «—»,
 * хотя в шапке портала было «HR-админ»: данные брались из отдельного запроса и
 * не совпадали с сессией. Теперь единственный источник — useAuth()
 * (profiles + карточка сотрудника), роль — roleLabel.
 */

const LANGUAGES = [
  { value: 'ru', label: 'Русский' },
  { value: 'kk', label: 'Қазақша' },
];

const MIN_PASSWORD = 8;

function ProfileSkeleton() {
  return (
    <div className="space-y-4" aria-hidden="true">
      <Card className="p-6 flex items-center gap-4">
        <div className="w-20 h-20 rounded-full bg-muted animate-pulse" />
        <div className="flex-1 space-y-2">
          <div className="h-5 w-1/3 rounded bg-muted animate-pulse" />
          <div className="h-3 w-1/4 rounded bg-muted/60 animate-pulse" />
        </div>
      </Card>
      <Card className="p-6 space-y-3">
        <div className="h-4 w-1/4 rounded bg-muted animate-pulse" />
        <div className="h-10 w-full rounded bg-muted/60 animate-pulse" />
        <div className="h-10 w-full rounded bg-muted/60 animate-pulse" />
      </Card>
    </div>
  );
}

/** Строка «поле: значение» — не рендерится вовсе, если значения нет (BUG-034). */
function InfoRow({ icon: Icon, label, value }) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-2 text-sm">
      <Icon className="w-4 h-4 mt-0.5 text-muted-foreground shrink-0" aria-hidden="true" />
      <span className="text-muted-foreground">{label}:</span>
      <span className="text-foreground font-medium">{value}</span>
    </div>
  );
}

export default function CabinetProfile() {
  const { toast } = useToast();
  const { user, employee, employeeId, roleLabel, isLoadingAuth, authError, refresh } = useAuth();
  const { lang, setLang } = useI18n();

  const [form, setForm] = useState({ full_name: '', phone: '' });
  const [touched, setTouched] = useState({});
  const [passwords, setPasswords] = useState({ next: '', repeat: '' });
  const [passwordTouched, setPasswordTouched] = useState(false);

  useEffect(() => {
    if (!user) return;
    setForm({
      full_name: user.full_name || employee?.name || '',
      phone: user.phone || employee?.phone || '',
    });
  }, [user, employee]);

  const errors = useMemo(() => {
    const acc = {};
    if (!form.full_name.trim()) acc.full_name = 'Укажите ФИО';
    else if (form.full_name.trim().length < 3) acc.full_name = 'Слишком короткое имя';
    if (form.phone && !/^[\d\s+()-]{6,20}$/.test(form.phone.trim())) acc.phone = 'Телефон в формате +7 700 000 00 00';
    return acc;
  }, [form]);

  const isValid = Object.keys(errors).length === 0;

  const passwordErrors = useMemo(() => {
    const acc = {};
    if (passwords.next.length > 0 && passwords.next.length < MIN_PASSWORD) {
      acc.next = `Минимальная длина пароля — ${MIN_PASSWORD} символов`;
    }
    if (passwords.repeat && passwords.next !== passwords.repeat) acc.repeat = 'Пароли не совпадают';
    return acc;
  }, [passwords]);

  const canChangePassword =
    passwords.next.length >= MIN_PASSWORD && passwords.next === passwords.repeat;

  const saveProfile = useMutation({
    mutationFn: async () => {
      await api.auth.updateMe({
        full_name: form.full_name.trim(),
        phone: form.phone.trim() || null,
      });
      // RLS разрешает править контакты собственной карточки сотрудника.
      if (employeeId) {
        await api.entities.Employee.update(employeeId, { phone: form.phone.trim() || null });
      }
    },
    onSuccess: async () => {
      toast({ title: 'Профиль сохранён' });
      await refresh();
    },
    onError: (e) => toast({ variant: 'destructive', title: 'Не удалось сохранить профиль', description: e?.message }),
  });

  /**
   * Фото профиля сохраняется сразу после загрузки файла: ImageUpload уже положил
   * его в Storage и вернул путь — записываем в карточку и url, и path, иначе при
   * следующей замене старый файл останется в бакете «сиротой».
   */
  const savePhoto = useMutation({
    mutationFn: ({ url, path }) =>
      api.entities.Employee.update(employeeId, {
        photo_url: url || null,
        photo_path: path || null,
      }),
    onSuccess: async (_data, { url }) => {
      toast({ title: url ? 'Фото обновлено' : 'Фото удалено' });
      await refresh();
    },
    onError: (e) => toast({ variant: 'destructive', title: 'Не удалось сохранить фото', description: e?.message }),
  });

  const changeLocale = useMutation({
    mutationFn: (locale) => api.auth.updateMe({ locale }),
    onSuccess: async (_data, locale) => {
      setLang(locale);
      toast({ title: 'Язык интерфейса изменён' });
      await refresh();
    },
    onError: (e) => toast({ variant: 'destructive', title: 'Не удалось сменить язык', description: e?.message }),
  });

  const changePassword = useMutation({
    mutationFn: () => api.auth.updatePassword(passwords.next),
    onSuccess: () => {
      toast({ title: 'Пароль изменён', description: 'Используйте новый пароль при следующем входе.' });
      setPasswords({ next: '', repeat: '' });
      setPasswordTouched(false);
    },
    onError: (e) => toast({ variant: 'destructive', title: 'Не удалось изменить пароль', description: e?.message }),
  });

  if (authError) {
    return (
      <PageContainer title="Настройки профиля" width="narrow">
        <ErrorState error={authError} onRetry={refresh} />
      </PageContainer>
    );
  }

  if (isLoadingAuth || !user) {
    return (
      <PageContainer title="Настройки профиля" width="narrow">
        <ProfileSkeleton />
      </PageContainer>
    );
  }

  const displayName = user.full_name || employee?.name || user.email;
  const photoUrl = employee?.photo_url || null;
  const email = user.email || user.auth_email;

  return (
    <PageContainer
      title="Настройки профиля"
      description="Личные данные, контакты, язык интерфейса и пароль."
      width="narrow"
    >
      {/* Шапка профиля: только реальные данные, пустых бейджей «—» больше нет (BUG-034). */}
      <Card className="p-6">
        <div className="flex flex-col sm:flex-row items-start gap-4">
          {/* Фото — файлом (CONVENTIONS §10). Без карточки сотрудника менять его некуда. */}
          {employeeId ? (
            <ImageUpload
              id="profile-photo"
              value={photoUrl}
              path={employee?.photo_path}
              folder="avatars"
              label="Фото профиля"
              aspect="avatar"
              hint="JPG, PNG или WebP. Без фото показываются инициалы."
              disabled={savePhoto.isPending}
              className="w-full shrink-0 sm:w-64"
              onChange={({ url, path }) => savePhoto.mutate({ url, path })}
            />
          ) : (
            <SafeImage
              src={photoUrl}
              alt=""
              loading="eager"
              className="w-20 h-20 rounded-full object-cover shrink-0"
              fallbackText={initials(displayName)}
              fallbackClassName="bg-primary text-primary-foreground text-2xl"
            />
          )}

          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-bold text-foreground">{displayName}</h2>
            <div className="flex flex-wrap items-center gap-2 mt-2">
              {/* Роль — одна точка правды: roleLabel из сессии. */}
              {roleLabel && <Badge variant="secondary">{roleLabel}</Badge>}
              {employee?.position && <Badge>{employee.position}</Badge>}
            </div>

            <div className="mt-3 space-y-1.5">
              <InfoRow icon={Mail} label="Email" value={email} />
              <InfoRow icon={Phone} label="Телефон" value={employee?.phone || user.phone} />
              <InfoRow icon={Briefcase} label="Должность" value={employee?.position} />
              <InfoRow icon={Building2} label="Отдел" value={employee?.department} />
              <InfoRow icon={MapPin} label="Филиал" value={employee?.branch || user.city} />
              <InfoRow
                icon={CalendarDays}
                label="В компании с"
                value={employee?.hire_date ? `${formatDate(employee.hire_date, 'long')} · ${formatTenure(employee.hire_date)}` : null}
              />
            </div>
          </div>
        </div>

        {!employeeId && (
          <p className="mt-4 rounded-lg bg-muted p-3 text-sm text-muted-foreground">
            Учётная запись пока не связана с карточкой сотрудника, поэтому должность, отдел и филиал
            не показываются. Попросите HR-специалиста связать её — личные разделы портала заполнятся автоматически.
          </p>
        )}
      </Card>

      {/* Личные данные */}
      <Card className="p-6 mt-4">
        <h3 className="font-semibold text-foreground mb-4">Личные данные</h3>
        <form
          noValidate
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            setTouched({ full_name: true, phone: true });
            if (!isValid) return;
            saveProfile.mutate();
          }}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="profile-name">ФИО <span className="text-destructive" aria-hidden="true">*</span></Label>
              <Input
                id="profile-name"
                value={form.full_name}
                onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                onBlur={() => setTouched((t) => ({ ...t, full_name: true }))}
                aria-invalid={touched.full_name && errors.full_name ? 'true' : undefined}
                aria-describedby={touched.full_name && errors.full_name ? 'profile-name-error' : undefined}
                className={cn('min-h-[40px]', touched.full_name && errors.full_name && 'border-destructive')}
              />
              {touched.full_name && errors.full_name && (
                <p id="profile-name-error" role="alert" className="mt-1 text-sm text-destructive">{errors.full_name}</p>
              )}
            </div>

            <div>
              <Label htmlFor="profile-phone">Телефон</Label>
              <Input
                id="profile-phone"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                onBlur={() => setTouched((t) => ({ ...t, phone: true }))}
                placeholder="+7 700 000 00 00"
                aria-invalid={touched.phone && errors.phone ? 'true' : undefined}
                aria-describedby={touched.phone && errors.phone ? 'profile-phone-error' : undefined}
                className={cn('min-h-[40px]', touched.phone && errors.phone && 'border-destructive')}
              />
              {touched.phone && errors.phone && (
                <p id="profile-phone-error" role="alert" className="mt-1 text-sm text-destructive">{errors.phone}</p>
              )}
            </div>

            <div>
              <Label htmlFor="profile-email">Email</Label>
              <Input id="profile-email" value={email || ''} disabled className="min-h-[40px]" />
              <p className="mt-1 text-xs text-muted-foreground">Email меняет администратор портала.</p>
            </div>

            {employee?.hire_date && (
              <div>
                <Label htmlFor="profile-tenure">Стаж в компании</Label>
                <Input id="profile-tenure" value={formatTenure(employee.hire_date)} disabled className="min-h-[40px]" />
              </div>
            )}
          </div>

          <Button type="submit" disabled={!isValid || saveProfile.isPending}>
            <Save className="w-4 h-4" aria-hidden="true" />
            {saveProfile.isPending ? 'Сохранение…' : 'Сохранить'}
          </Button>
        </form>
      </Card>

      {/* Язык интерфейса */}
      <Card className="p-6 mt-4">
        <h3 className="font-semibold text-foreground mb-1">Язык интерфейса</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Выбор сохраняется в профиле и применяется на всех устройствах.
        </p>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Язык интерфейса">
          {LANGUAGES.map((option) => {
            const selected = (user.locale === 'kz' ? 'kk' : user.locale || lang) === option.value;
            return (
              <Button
                key={option.value}
                type="button"
                variant={selected ? 'default' : 'outline'}
                aria-pressed={selected}
                disabled={changeLocale.isPending}
                onClick={() => changeLocale.mutate(option.value)}
              >
                {option.label}
              </Button>
            );
          })}
        </div>
      </Card>

      {/* Безопасность */}
      <Card className="p-6 mt-4">
        <h3 className="font-semibold text-foreground flex items-center gap-2 mb-4">
          <Shield className="w-5 h-5 text-primary" aria-hidden="true" />
          Смена пароля
        </h3>
        <form
          noValidate
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            setPasswordTouched(true);
            if (!canChangePassword) return;
            changePassword.mutate();
          }}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="password-new">Новый пароль</Label>
              <Input
                id="password-new"
                type="password"
                autoComplete="new-password"
                value={passwords.next}
                onChange={(e) => setPasswords({ ...passwords, next: e.target.value })}
                aria-invalid={passwordTouched && passwordErrors.next ? 'true' : undefined}
                aria-describedby="password-new-hint"
                className={cn('min-h-[40px]', passwordTouched && passwordErrors.next && 'border-destructive')}
              />
              <p id="password-new-hint" className="mt-1 text-xs text-muted-foreground">
                Не короче {MIN_PASSWORD} символов.
              </p>
              {passwordTouched && passwordErrors.next && (
                <p role="alert" className="mt-1 text-sm text-destructive">{passwordErrors.next}</p>
              )}
            </div>

            <div>
              <Label htmlFor="password-repeat">Повторите пароль</Label>
              <Input
                id="password-repeat"
                type="password"
                autoComplete="new-password"
                value={passwords.repeat}
                onChange={(e) => setPasswords({ ...passwords, repeat: e.target.value })}
                aria-invalid={passwordTouched && passwordErrors.repeat ? 'true' : undefined}
                aria-describedby={passwordTouched && passwordErrors.repeat ? 'password-repeat-error' : undefined}
                className={cn('min-h-[40px]', passwordTouched && passwordErrors.repeat && 'border-destructive')}
              />
              {passwordTouched && passwordErrors.repeat && (
                <p id="password-repeat-error" role="alert" className="mt-1 text-sm text-destructive">
                  {passwordErrors.repeat}
                </p>
              )}
            </div>
          </div>

          <Button type="submit" variant="outline" disabled={!canChangePassword || changePassword.isPending}>
            {changePassword.isPending ? 'Сохранение…' : 'Изменить пароль'}
          </Button>
        </form>
      </Card>
    </PageContainer>
  );
}
