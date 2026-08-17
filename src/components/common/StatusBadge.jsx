import React from 'react';
import { Badge } from '@/components/ui/badge';
import { statusLabel, statusVariant } from '@/lib/statusLabels';
import { cn } from '@/lib/utils';

/**
 * Единый бейдж статуса на весь портал (BUG-051, BUG-052).
 * Никогда не выводит технический код на английском.
 */
export default function StatusBadge({ value, fallback, className, variant, ...rest }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <Badge variant={variant || statusVariant(value)} className={cn('whitespace-nowrap', className)} {...rest}>
      {statusLabel(value, fallback)}
    </Badge>
  );
}
