import React, { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Loader2, AlertCircle, CheckCircle2, UserPlus } from 'lucide-react';

import { api } from '@/api/client';
import OptimusLogo from '@/components/common/OptimusLogo';
import BrandLoader from '@/components/common/BrandLoader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ROLE_LABELS } from '@/lib/AuthContext';
import { formatDate } from '@/lib/format';

/**
 * Регистрация по ссылке-приглашению.
 *
 * Ссылку HR передаёт любым каналом: встроенная почта Supabase ограничена
 * несколькими письмами в час и для продакшена не годится, а свой SMTP
 * подключён не всегда.
 *
 * Роль приходит из самого приглашения на сервере — из формы её задать нельзя,
 * иначе по ссылке можно было бы зарегистрироваться администратором.
 */
/**
 * Обёртка объявлена НА УРОВНЕ МОДУЛЯ. Когда она была вложена в компонент,
 * при каждом рендере создавался новый тип компонента — React размонтировал
 * и заново монтировал всю форму, поэтому поле теряло фокус после каждой
 * набранной буквы.
 */
function Shell({ children }) {
  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-background">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center"><OptimusLogo size={32} /></div>
        {children}
      </div>
    </div>
  );
}

const REASONS = {
  not_found: 'Ссылка-приглашение не найдена. Проверьте, что скопировали её целиком.',
  used: 'По этой ссылке уже зарегистрировались. Если это были вы — просто войдите.',
  expired: 'Срок действия ссылки истёк. Попросите HR выпустить новую.',
  revoked: 'Приглашение отозвано. Обратитесь к HR.',
};

export default function AcceptInvite() {
  const { token } = useParams();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState(null); // null — пользователь ещё не правил поле
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const { data: invite, isLoading } = useQuery({
    queryKey: ['invitation', token],
    queryFn: () => api.users.checkInvitation(token),
    enabled: !!token,
    retry: false,
  });

  if (isLoading) return <BrandLoader />;

  if (!invite?.valid) {
    return (
      <Shell>
        <div className="text-center">
          <div className="mx-auto w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
            <AlertCircle className="w-6 h-6 text-destructive" aria-hidden="true" />
          </div>
          <h1 className="text-xl font-semibold text-foreground mb-2">Ссылка недействительна</h1>
          <p className="text-sm text-muted-foreground mb-6">
            {REASONS[invite?.reason] || 'Приглашение не удалось проверить.'}
          </p>
          <Button asChild className="w-full">
            <Link to="/login">Перейти ко входу</Link>
          </Button>
        </div>
      </Shell>
    );
  }

  if (done) {
    return (
      <Shell>
        <div className="text-center">
          <div className="mx-auto w-12 h-12 rounded-full bg-accent flex items-center justify-center mb-4">
            <CheckCircle2 className="w-6 h-6 text-primary" aria-hidden="true" />
          </div>
          <h1 className="text-xl font-semibold text-foreground mb-2">Учётная запись создана</h1>
          <p className="text-sm text-muted-foreground mb-6">
            Теперь войдите в портал, используя свой email и пароль.
          </p>
          <Button className="w-full" onClick={() => navigate('/login', { replace: true })}>
            Войти в портал
          </Button>
        </div>
      </Shell>
    );
  }

  const lockedEmail = !!invite.email;

  const onSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    const targetEmail = (invite.email || email).trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(targetEmail)) return setError('Введите корректный рабочий email');
    if (password.length < 8) return setError('Пароль должен содержать минимум 8 символов');
    if (password !== repeat) return setError('Пароли не совпадают');

    setBusy(true);
    try {
      await api.users.acceptInvitation({
        token,
        password,
        email: targetEmail,
        fullName: fullName ?? invite.full_name,
      });
      setDone(true);
    } catch (err) {
      setError(err?.message || 'Не удалось завершить регистрацию');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell>
      <h1 className="text-2xl font-bold text-foreground mb-1">Регистрация в портале</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Вас пригласили как «{ROLE_LABELS[invite.role] || invite.role}».
        {invite.expires_at && ` Ссылка действует до ${formatDate(invite.expires_at, 'long')}.`}
      </p>

      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="invite-email">Рабочий email</Label>
          <Input
            id="invite-email"
            type="email"
            autoComplete="email"
            value={invite.email || email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={lockedEmail}
            placeholder="ivanov@optimus-kz.kz"
          />
          {lockedEmail && (
            <p className="text-xs text-muted-foreground">Приглашение выписано на этот адрес.</p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="invite-name">ФИО</Label>
          <Input
            id="invite-name"
            autoComplete="name"
            value={fullName ?? invite.full_name ?? ''}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Иванов Пётр"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="invite-password">Пароль</Label>
          <Input
            id="invite-password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Минимум 8 символов"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="invite-password2">Повторите пароль</Label>
          <Input
            id="invite-password2"
            type="password"
            autoComplete="new-password"
            value={repeat}
            onChange={(e) => setRepeat(e.target.value)}
          />
        </div>

        {error && (
          <p role="alert" className="flex items-start gap-2 text-sm text-destructive">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
            {error}
          </p>
        )}

        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />
          ) : (
            <UserPlus className="w-4 h-4 mr-2" aria-hidden="true" />
          )}
          Создать учётную запись
        </Button>
      </form>

      <p className="mt-6 text-xs text-muted-foreground text-center">
        Уже зарегистрированы? <Link to="/login" className="text-primary hover:underline">Войти</Link>
      </p>
    </Shell>
  );
}
