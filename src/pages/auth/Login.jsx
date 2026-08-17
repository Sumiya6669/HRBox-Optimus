import React, { useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Loader2, LogIn, Mail, AlertCircle, CheckCircle2 } from 'lucide-react';
import { api } from '@/api/client';
import { useAuth } from '@/lib/AuthContext';
import OptimusLogo from '@/components/common/OptimusLogo';
import BrandLoader from '@/components/common/BrandLoader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const MODES = {
  PASSWORD: 'password',
  MAGIC: 'magic',
  FORGOT: 'forgot',
};

export default function Login() {
  const { isAuthenticated, isLoadingAuth } = useAuth();
  const location = useLocation();
  const [mode, setMode] = useState(MODES.PASSWORD);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);

  if (isLoadingAuth) return <BrandLoader />;
  if (isAuthenticated) return <Navigate to={location.state?.from || '/'} replace />;

  const validate = () => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return 'Введите корректный email';
    if (mode === MODES.PASSWORD && password.length < 8) return 'Пароль должен содержать минимум 8 символов';
    return null;
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    try {
      if (mode === MODES.PASSWORD) {
        await api.auth.signInWithPassword(email.trim(), password);
        // Дальше сработает onAuthStateChange и редирект произойдёт через isAuthenticated.
      } else if (mode === MODES.MAGIC) {
        await api.auth.sendMagicLink(email.trim());
        setNotice('Ссылка для входа отправлена на почту. Она действует 1 час.');
      } else {
        await api.auth.resetPassword(email.trim());
        setNotice('Если такой пользователь существует, письмо со сбросом пароля уже отправлено.');
      }
    } catch (err) {
      setError(err?.message || 'Не удалось выполнить вход');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-background">
      {/* Брендовая колонка */}
      <div className="hidden lg:flex flex-col justify-between bg-primary text-primary-foreground p-12">
        <OptimusLogo size={34} mono />
        <div>
          <h1 className="text-4xl font-extrabold leading-tight mb-4">Корпоративный портал</h1>
          <p className="text-lg opacity-90 max-w-md">
            Кадры, обучение, цели и KPI, опросы, отпуска и программа баллов — в одном рабочем месте.
          </p>
        </div>
        <p className="text-sm opacity-75">
          ТОО «Optimus KZ» — официальный дилер BASF и Tikkurila в Казахстане.
        </p>
      </div>

      {/* Форма */}
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="lg:hidden mb-8 flex justify-center">
            <OptimusLogo size={32} />
          </div>

          <h2 className="text-2xl font-bold text-foreground mb-1">
            {mode === MODES.FORGOT ? 'Восстановление доступа' : 'Вход в портал'}
          </h2>
          <p className="text-sm text-muted-foreground mb-6">
            {mode === MODES.FORGOT
              ? 'Укажите рабочий email — пришлём ссылку для смены пароля.'
              : mode === MODES.MAGIC
                ? 'Пришлём одноразовую ссылку для входа без пароля.'
                : 'Используйте рабочий email Optimus KZ.'}
          </p>

          <form onSubmit={onSubmit} noValidate className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="login-email">Рабочий email</Label>
              <Input
                id="login-email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="ivanov@optimus-kz.kz"
                aria-invalid={!!error}
                aria-describedby={error ? 'login-error' : undefined}
              />
            </div>

            {mode === MODES.PASSWORD && (
              <div className="space-y-1.5">
                <Label htmlFor="login-password">Пароль</Label>
                <Input
                  id="login-password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Минимум 8 символов"
                />
              </div>
            )}

            {error && (
              <p id="login-error" role="alert" className="flex items-start gap-2 text-sm text-destructive">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
                {error}
              </p>
            )}
            {notice && (
              <p role="status" className="flex items-start gap-2 text-sm text-foreground">
                <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-[hsl(var(--success))]" aria-hidden="true" />
                {notice}
              </p>
            )}

            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />
              ) : mode === MODES.PASSWORD ? (
                <LogIn className="w-4 h-4 mr-2" aria-hidden="true" />
              ) : (
                <Mail className="w-4 h-4 mr-2" aria-hidden="true" />
              )}
              {mode === MODES.PASSWORD ? 'Войти' : mode === MODES.MAGIC ? 'Прислать ссылку' : 'Сбросить пароль'}
            </Button>
          </form>

          <div className="mt-6 flex flex-col gap-2 text-sm">
            {mode !== MODES.PASSWORD && (
              <button type="button" className="text-primary hover:underline text-left" onClick={() => { setMode(MODES.PASSWORD); setError(null); setNotice(null); }}>
                Войти по паролю
              </button>
            )}
            {mode !== MODES.MAGIC && (
              <button type="button" className="text-primary hover:underline text-left" onClick={() => { setMode(MODES.MAGIC); setError(null); setNotice(null); }}>
                Войти по ссылке на почту
              </button>
            )}
            {mode !== MODES.FORGOT && (
              <button type="button" className="text-muted-foreground hover:underline text-left" onClick={() => { setMode(MODES.FORGOT); setError(null); setNotice(null); }}>
                Забыли пароль?
              </button>
            )}
          </div>

          {/* Портал внутренний: публичных страниц нет, ссылка «О компании» вела бы на редирект. */}
          <p className="mt-8 text-xs text-muted-foreground">
            Нет учётной записи? Обратитесь к HR — доступ выдаётся по приглашению.
          </p>
        </div>
      </div>
    </div>
  );
}
