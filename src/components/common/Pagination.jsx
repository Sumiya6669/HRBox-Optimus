import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatNumber, pluralize } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * Единая панель серверной пагинации (аудит: пагинации не было ни в одном списке —
 * при росте данных страницы тянули всё разом).
 *
 * props:
 *   page, pageSize, total — текущее состояние
 *   onPageChange(nextPage)
 *   isFetching — блокирует кнопки во время запроса
 *   itemLabels — [одна, две, пять] для склонения: ['операция','операции','операций']
 */
export default function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  isFetching = false,
  itemLabels = ['запись', 'записи', 'записей'],
  className,
}) {
  const pagesCount = Math.max(1, Math.ceil((total || 0) / (pageSize || 1)));
  if (pagesCount <= 1) return null;

  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-3 pt-4', className)}>
      <span className="text-xs text-muted-foreground">
        Страница {formatNumber(page)} из {formatNumber(pagesCount)} · всего{' '}
        {pluralize(total, itemLabels[0], itemLabels[1], itemLabels[2])}
      </span>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="icon"
          aria-label="Предыдущая страница"
          disabled={page <= 1 || isFetching}
          onClick={() => onPageChange(Math.max(1, page - 1))}
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          aria-label="Следующая страница"
          disabled={page >= pagesCount || isFetching}
          onClick={() => onPageChange(Math.min(pagesCount, page + 1))}
        >
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
