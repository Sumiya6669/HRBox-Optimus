import React, { useEffect } from 'react';
import { cn } from '@/lib/utils';

/**
 * Единая обёртка страницы (BUG-073: «Обратная связь» имела другую ширину и отступы).
 * Заодно ставит человекочитаемый <title> вместо «cabinet/Cabinet News | YUVEMA Ecosystem» (BUG-047).
 */
export default function PageContainer({ title, documentTitle, description, actions, breadcrumbs, children, className, width = 'default' }) {
  useEffect(() => {
    const label = documentTitle || title;
    if (label) document.title = `${label} — Портал Optimus KZ`;
    return () => {
      document.title = 'Портал Optimus KZ';
    };
  }, [title, documentTitle]);

  return (
    <div
      className={cn(
        'mx-auto w-full px-4 py-6 sm:px-6 lg:px-8',
        width === 'narrow' ? 'max-w-3xl' : width === 'wide' ? 'max-w-[1600px]' : 'max-w-7xl',
        className
      )}
    >
      {breadcrumbs}
      {(title || actions) && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-6">
          <div className="min-w-0">
            {title && <h1 className="text-2xl font-bold tracking-tight text-foreground">{title}</h1>}
            {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
        </div>
      )}
      {children}
    </div>
  );
}
