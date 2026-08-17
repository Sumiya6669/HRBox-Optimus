import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, Check, Download, MapPin, Users } from 'lucide-react';

import { api } from '@/api/client';
import PageContainer from '@/components/common/PageContainer';
import EmptyState from '@/components/common/EmptyState';
import ErrorState from '@/components/common/ErrorState';
import StatusBadge from '@/components/common/StatusBadge';
import SafeImage from '@/components/common/SafeImage';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/lib/AuthContext';
import { formatDate, formatDateRange, isPast, pluralize, toDate } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * Календарь корпоративных событий.
 * BUG-023: виджет главной и календарь брали события из разных источников — «День рождения
 *          компании» приходился то на 1 марта, то на 1 сентября. Единственный источник —
 *          таблица events, ничего не захардкожено.
 * BUG-024: прошедшие даты показывались как предстоящие — по умолчанию только date >= сегодня,
 *          прошедшие открываются переключателем.
 * Аудит: добавлены регистрация на событие и экспорт в .ics.
 */

/**
 * Заголовки групп по месяцам в именительном падеже.
 * formatDate даёт родительный («16 августа»), для заголовка нужен именительный.
 */
const MONTH_TITLES = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
];

/* ------------------------------------------------------------------- iCal */

/** Экранирование по RFC 5545: запятые, точки с запятой и переносы строк. */
function icsEscape(value = '') {
  return String(value).replace(/([\\;,])/g, '\\$1').replace(/\r?\n/g, '\\n');
}

/** Дата в формате iCal (YYYYMMDD) — это формат файла, не интерфейса. */
function icsDate(value) {
  return formatDate(value, 'iso').replace(/-/g, '');
}

function icsTimestamp(at = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${at.getUTCFullYear()}${pad(at.getUTCMonth() + 1)}${pad(at.getUTCDate())}` +
    `T${pad(at.getUTCHours())}${pad(at.getUTCMinutes())}${pad(at.getUTCSeconds())}Z`
  );
}

function buildIcs(event) {
  const start = toDate(event.date);
  const finish = toDate(event.end_date || event.date);
  // В iCal DTEND для событий «на весь день» указывается следующим днём (граница исключается).
  const exclusiveEnd = new Date(finish.getFullYear(), finish.getMonth(), finish.getDate() + 1);

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Optimus KZ//Портал//RU',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${event.id}@optimus-portal`,
    `DTSTAMP:${icsTimestamp()}`,
    `DTSTART;VALUE=DATE:${icsDate(start)}`,
    `DTEND;VALUE=DATE:${icsDate(exclusiveEnd)}`,
    `SUMMARY:${icsEscape(event.title)}`,
    event.description ? `DESCRIPTION:${icsEscape(event.description)}` : null,
    event.location ? `LOCATION:${icsEscape(event.location)}` : null,
    'END:VEVENT',
    'END:VCALENDAR',
  ]
    .filter(Boolean)
    .join('\r\n');
}

function downloadIcs(event) {
  const blob = new Blob([buildIcs(event)], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${event.title.replace(/[^\wа-яА-ЯёЁ-]+/g, '_').slice(0, 60) || 'event'}.ics`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/* ---------------------------------------------------------------- скелетон */

function CalendarSkeleton() {
  return (
    <div className="space-y-3" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <Card key={i} className="p-4 flex items-center gap-4">
          <div className="w-12 h-12 rounded-lg bg-muted animate-pulse" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-1/3 rounded bg-muted animate-pulse" />
            <div className="h-3 w-1/4 rounded bg-muted/60 animate-pulse" />
          </div>
        </Card>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ экран */

export default function CabinetCalendar() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { employeeId } = useAuth();
  const [showPast, setShowPast] = useState(false);

  const today = formatDate(new Date(), 'iso');

  // BUG-024: по умолчанию только предстоящие события (фильтр gte поддерживает слой api).
  const eventsQuery = useQuery({
    queryKey: ['cabinet-events', showPast ? 'all' : today],
    queryFn: () =>
      showPast
        ? api.entities.Event.list('date')
        : api.entities.Event.filter({ date: { gte: today } }, 'date'),
  });

  const registrationsQuery = useQuery({
    queryKey: ['cabinet-event-registrations'],
    queryFn: () => api.entities.EventRegistration.list(),
  });

  const events = eventsQuery.data || [];
  const registrations = registrationsQuery.data || [];

  const error = eventsQuery.error || registrationsQuery.error;
  const isLoading = eventsQuery.isLoading || registrationsQuery.isLoading;

  const registrationStats = useMemo(() => {
    const acc = {};
    for (const reg of registrations) {
      if (!acc[reg.event_id]) acc[reg.event_id] = { count: 0, mine: null };
      acc[reg.event_id].count += 1;
      if (employeeId && reg.employee_id === employeeId) acc[reg.event_id].mine = reg;
    }
    return acc;
  }, [registrations, employeeId]);

  const groups = useMemo(() => {
    const map = new Map();
    for (const event of events) {
      const date = toDate(event.date);
      if (!date) continue;
      const key = `${date.getFullYear()}-${date.getMonth()}`;
      if (!map.has(key)) map.set(key, { year: date.getFullYear(), month: date.getMonth(), items: [] });
      map.get(key).items.push(event);
    }
    return Array.from(map.values());
  }, [events]);

  const register = useMutation({
    mutationFn: (eventId) => api.entities.EventRegistration.create({ event_id: eventId, employee_id: employeeId }),
    onSuccess: () => {
      toast({ title: 'Вы записаны на событие' });
      qc.invalidateQueries({ queryKey: ['cabinet-event-registrations'] });
    },
    onError: (e) => toast({ variant: 'destructive', title: 'Не удалось записаться', description: e?.message }),
  });

  const unregister = useMutation({
    mutationFn: (registrationId) => api.entities.EventRegistration.delete(registrationId),
    onSuccess: () => {
      toast({ title: 'Участие отменено' });
      qc.invalidateQueries({ queryKey: ['cabinet-event-registrations'] });
    },
    onError: (e) => toast({ variant: 'destructive', title: 'Не удалось отменить участие', description: e?.message }),
  });

  const refetchAll = () => {
    eventsQuery.refetch();
    registrationsQuery.refetch();
  };

  return (
    <PageContainer
      title="Календарь"
      description="Корпоративные события и мероприятия компании."
      actions={
        <div className="flex items-center gap-2">
          <Switch id="show-past-events" checked={showPast} onCheckedChange={setShowPast} />
          <Label htmlFor="show-past-events" className="cursor-pointer">Показать прошедшие</Label>
        </div>
      }
    >
      {error ? (
        <ErrorState error={error} onRetry={refetchAll} />
      ) : isLoading ? (
        <CalendarSkeleton />
      ) : events.length === 0 ? (
        <EmptyState
          icon={CalendarDays}
          title={showPast ? 'Событий нет' : 'Предстоящих событий нет'}
          description={
            showPast
              ? 'В календаре компании пока нет ни одного события. Их добавляет HR-специалист.'
              : 'Ближайшие мероприятия появятся здесь. Включите «Показать прошедшие», чтобы увидеть историю.'
          }
        />
      ) : (
        <div className="space-y-8">
          {groups.map((group) => (
            <section key={`${group.year}-${group.month}`}>
              <h2 className="font-semibold text-foreground mb-3">
                {MONTH_TITLES[group.month]} {group.year}
              </h2>
              <ul className="space-y-3" role="list">
                {group.items.map((event) => {
                  const stats = registrationStats[event.id] || { count: 0, mine: null };
                  const past = isPast(event.end_date || event.date);
                  const day = toDate(event.date);
                  return (
                    <li key={event.id} role="listitem">
                      <Card className={cn('p-4', past && 'opacity-70')}>
                        <div className="flex items-start gap-4">
                          <div className="text-center shrink-0 w-12">
                            <div className="text-2xl font-bold text-foreground leading-none">{day?.getDate()}</div>
                            <div className="text-[11px] uppercase text-muted-foreground mt-1">
                              {MONTH_TITLES[day?.getMonth()]?.slice(0, 3)}
                            </div>
                          </div>

                          {/* Фото события показываем, только если оно задано (events.photo_url) */}
                          {event.photo_url && (
                            <SafeImage
                              src={event.photo_url}
                              alt=""
                              className="hidden h-20 w-32 shrink-0 rounded-lg object-cover sm:block"
                            />
                          )}

                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2 mb-1">
                              <StatusBadge value={event.type} />
                              {past && <StatusBadge value="completed" />}
                            </div>
                            <h3 className="font-medium text-foreground">{event.title}</h3>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {event.end_date && event.end_date !== event.date
                                ? formatDateRange(event.date, event.end_date)
                                : formatDate(event.date, 'long')}
                            </p>
                            {event.location && (
                              <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                                <MapPin className="w-3 h-3" aria-hidden="true" />
                                {event.location}
                              </p>
                            )}
                            {event.description && (
                              <p className="text-sm text-muted-foreground mt-1">{event.description}</p>
                            )}

                            <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
                              <Users className="w-3 h-3" aria-hidden="true" />
                              {pluralize(stats.count, 'участник', 'участника', 'участников')}
                            </p>

                            <div className="flex flex-wrap items-center gap-2 mt-3">
                              {employeeId && !past && (
                                stats.mine ? (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={unregister.isPending}
                                    onClick={() => unregister.mutate(stats.mine.id)}
                                  >
                                    <Check className="w-4 h-4" aria-hidden="true" />
                                    Отменить участие
                                  </Button>
                                ) : (
                                  <Button
                                    size="sm"
                                    disabled={register.isPending}
                                    onClick={() => register.mutate(event.id)}
                                  >
                                    Пойду
                                  </Button>
                                )
                              )}
                              <Button
                                size="sm"
                                variant="outline"
                                aria-label={`Скачать «${event.title}» в календарь (.ics)`}
                                onClick={() => downloadIcs(event)}
                              >
                                <Download className="w-4 h-4" aria-hidden="true" />
                                В календарь (.ics)
                              </Button>
                            </div>
                          </div>
                        </div>
                      </Card>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </PageContainer>
  );
}
