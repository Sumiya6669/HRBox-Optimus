import React from 'react';
import { Inbox } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Единый паттерн пустого состояния: иконка + заголовок + пояснение + действие (BUG-074).
 * Раньше тон и пунктуация отличались на каждой странице.
 */
export default function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  actionLabel,
  onAction,
  className,
  compact = false,
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center rounded-xl border border-dashed border-border bg-card/50',
        compact ? 'py-8 px-4' : 'py-14 px-6',
        className
      )}
    >
      <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-4">
        <Icon className="w-6 h-6 text-muted-foreground" aria-hidden="true" />
      </div>
      <h3 className="text-base font-semibold text-foreground mb-1">{title}</h3>
      {description && <p className="text-sm text-muted-foreground max-w-sm mb-4">{description}</p>}
      {action ?? (actionLabel && onAction ? <Button onClick={onAction}>{actionLabel}</Button> : null)}
    </div>
  );
}
