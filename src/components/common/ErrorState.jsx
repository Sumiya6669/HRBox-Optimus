import React from 'react';
import { AlertTriangle, RefreshCw, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * BUG-011: «0 пользователей» вместо ошибки доступа — админ думал, что пользователей нет.
 * Ошибку теперь видно явно, с кодом и возможностью повторить.
 */
export default function ErrorState({ error, onRetry, title, className, compact = false }) {
  const forbidden = error?.isForbidden || error?.status === 401 || error?.status === 403;
  const Icon = forbidden ? ShieldAlert : AlertTriangle;
  const heading = title || (forbidden ? 'Ошибка доступа' : 'Не удалось загрузить данные');
  const message = forbidden
    ? 'У текущей учётной записи нет прав на этот раздел или сессия истекла. Войдите заново или обратитесь к администратору.'
    : error?.message || 'Попробуйте обновить страницу. Если ошибка повторяется — сообщите администратору портала.';

  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center text-center rounded-xl border border-destructive/30 bg-destructive/5',
        compact ? 'py-8 px-4' : 'py-12 px-6',
        className
      )}
    >
      <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
        <Icon className="w-6 h-6 text-destructive" aria-hidden="true" />
      </div>
      <h3 className="text-base font-semibold text-foreground mb-1">{heading}</h3>
      <p className="text-sm text-muted-foreground max-w-md mb-2">{message}</p>
      {(error?.status || error?.code) && (
        <p className="text-xs font-mono text-muted-foreground mb-4">
          код: {error.code || error.status}
        </p>
      )}
      {onRetry && (
        <Button variant="outline" onClick={onRetry}>
          <RefreshCw className="w-4 h-4 mr-2" aria-hidden="true" />
          Повторить
        </Button>
      )}
    </div>
  );
}
