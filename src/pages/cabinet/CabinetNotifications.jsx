import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell, Check, ChevronRight } from 'lucide-react';

import { api } from '@/api/client';
import PageContainer from '@/components/common/PageContainer';
import EmptyState from '@/components/common/EmptyState';
import ErrorState from '@/components/common/ErrorState';
import StatusBadge from '@/components/common/StatusBadge';
import FilterChips from '@/components/common/FilterChips';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/lib/AuthContext';
import { useI18n } from '@/lib/i18n';
import { formatRelative } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * BUG-027: страница показывала «0 уведомлений» при пяти записях в базе —
 * фильтровали по id сотрудника, а notifications.user_id ссылается на profiles.id.
 * BUG-043: заголовки и подписи не переводились — теперь через ключи useI18n.
 */

function NotificationsSkeleton() {
  return (
    <div className="space-y-2" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <Card key={i} className="p-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-muted animate-pulse" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-1/3 rounded bg-muted animate-pulse" />
            <div className="h-3 w-1/2 rounded bg-muted/60 animate-pulse" />
          </div>
        </Card>
      ))}
    </div>
  );
}

export default function CabinetNotifications() {
  const { t } = useI18n();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { user } = useAuth();
  const [filter, setFilter] = useState('all');

  // BUG-027: фильтр по user.id (profiles.id) — так же, как это делает RLS-политика.
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['cabinet-notifications', user?.id],
    queryFn: () => api.entities.Notification.filter({ user_id: user.id }, '-date'),
    enabled: !!user?.id,
  });

  const notifications = data || [];
  const unreadCount = useMemo(() => notifications.filter((n) => !n.read).length, [notifications]);

  const markRead = useMutation({
    mutationFn: (id) => api.entities.Notification.update(id, { read: true }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cabinet-notifications', user?.id] }),
    onError: (e) => toast({ variant: 'destructive', title: e?.message || 'Не удалось обновить уведомление' }),
  });

  const markAll = useMutation({
    mutationFn: () =>
      Promise.all(
        notifications.filter((n) => !n.read).map((n) => api.entities.Notification.update(n.id, { read: true }))
      ),
    onSuccess: () => {
      toast({ title: t('notifications_all_read') });
      qc.invalidateQueries({ queryKey: ['cabinet-notifications', user?.id] });
    },
    onError: (e) => toast({ variant: 'destructive', title: e?.message || 'Не удалось обновить уведомления' }),
  });

  const visible = filter === 'unread' ? notifications.filter((n) => !n.read) : notifications;

  const filterOptions = [
    { value: 'all', label: t('notifications_filter_all'), count: notifications.length },
    { value: 'unread', label: t('notifications_filter_unread'), count: unreadCount },
  ];

  return (
    <PageContainer
      title={t('notifications_title')}
      description={t('notifications_desc')}
      actions={
        unreadCount > 0 ? (
          <Button variant="outline" onClick={() => markAll.mutate()} disabled={markAll.isPending}>
            <Check className="w-4 h-4" aria-hidden="true" />
            {t('notifications_mark_all')}
          </Button>
        ) : null
      }
    >
      {error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : isLoading ? (
        <NotificationsSkeleton />
      ) : notifications.length === 0 ? (
        <EmptyState
          icon={Bell}
          title={t('notifications_empty_title')}
          description={t('notifications_empty_desc')}
        />
      ) : (
        <>
          <FilterChips
            options={filterOptions}
            value={filter}
            onChange={setFilter}
            ariaLabel={t('notifications_title')}
            className="mb-4"
          />

          {visible.length === 0 ? (
            <EmptyState
              icon={Check}
              title={t('notifications_empty_unread_title')}
              description={t('notifications_empty_unread_desc')}
              actionLabel={t('notifications_filter_all')}
              onAction={() => setFilter('all')}
              compact
            />
          ) : (
            <ul className="space-y-2" role="list">
              {visible.map((item) => (
                <li key={item.id} role="listitem">
                  <Card className={cn('p-4', !item.read && 'border-primary/40 bg-accent/40')}>
                    <div className="flex items-start gap-3">
                      <span className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                        <Bell className="w-4 h-4" aria-hidden="true" />
                      </span>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-foreground">{item.title}</span>
                          {/* BUG-051: тип уведомления — бейджем, а не кодом на английском. */}
                          <StatusBadge value={item.type} />
                          {!item.read && (
                            <span className="text-xs text-primary">{t('notifications_unread')}</span>
                          )}
                        </div>
                        {item.body && <p className="text-sm text-muted-foreground mt-0.5">{item.body}</p>}
                        <p className="text-xs text-muted-foreground mt-1">{formatRelative(item.date)}</p>

                        {item.link && (
                          <Button asChild variant="link" size="sm" className="px-0 mt-1">
                            <Link to={item.link} onClick={() => !item.read && markRead.mutate(item.id)}>
                              {t('notifications_open')}
                              <ChevronRight className="w-4 h-4" aria-hidden="true" />
                            </Link>
                          </Button>
                        )}
                      </div>

                      {!item.read && (
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={`${t('notifications_mark_read')}: ${item.title}`}
                          disabled={markRead.isPending}
                          onClick={() => markRead.mutate(item.id)}
                        >
                          <Check className="w-4 h-4" aria-hidden="true" />
                        </Button>
                      )}
                    </div>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </PageContainer>
  );
}
