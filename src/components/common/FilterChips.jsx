import React from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Общие фильтры-чипы со счётчиками.
 * Раньше каждая страница рисовала свой набор кнопок (BUG-025, BUG-027, BUG-033):
 * где-то это были div с onClick, где-то — кнопки без aria-pressed и без счётчиков.
 *
 * props:
 *   options  — [{ value, label, count?, icon? }]
 *   value    — выбранное значение
 *   onChange — (value) => void
 */
export default function FilterChips({ options = [], value, onChange, ariaLabel = 'Фильтры', className }) {
  if (!options.length) return null;

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)} role="group" aria-label={ariaLabel}>
      {options.map((option) => {
        const selected = option.value === value;
        const Icon = option.icon;
        return (
          <Button
            key={String(option.value)}
            type="button"
            size="sm"
            variant={selected ? 'default' : 'outline'}
            aria-pressed={selected}
            onClick={() => onChange?.(option.value)}
            className="min-h-[40px]"
          >
            {Icon && <Icon className="w-3.5 h-3.5" aria-hidden="true" />}
            {option.label}
            {typeof option.count === 'number' && (
              <span className={cn('ml-1 tabular-nums', selected ? 'opacity-90' : 'text-muted-foreground')}>
                ({option.count})
              </span>
            )}
          </Button>
        );
      })}
    </div>
  );
}
