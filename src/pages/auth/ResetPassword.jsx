import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, AlertCircle } from 'lucide-react';
import { api } from '@/api/client';
import OptimusLogo from '@/components/common/OptimusLogo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function ResetPassword() {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) return setError('Пароль должен содержать минимум 8 символов');
    if (password !== repeat) return setError('Пароли не совпадают');
    setBusy(true);
    try {
      await api.auth.updatePassword(password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err?.message || 'Не удалось сменить пароль');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-background">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center"><OptimusLogo size={32} /></div>
        <h1 className="text-2xl font-bold text-foreground mb-1">Новый пароль</h1>
        <p className="text-sm text-muted-foreground mb-6">Придумайте пароль длиной не менее 8 символов.</p>
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="pwd">Новый пароль</Label>
            <Input id="pwd" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pwd2">Повторите пароль</Label>
            <Input id="pwd2" type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} />
          </div>
          {error && (
            <p role="alert" className="flex items-start gap-2 text-sm text-destructive">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />{error}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />}
            Сохранить пароль
          </Button>
        </form>
      </div>
    </div>
  );
}
