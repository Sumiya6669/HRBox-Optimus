import React from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Mail, Phone, Building2, MapPin, CalendarDays, ArrowLeft, Briefcase, ExternalLink } from 'lucide-react';

import { api } from '@/api/client';
import { useAuth } from '@/lib/AuthContext';
import PageContainer from '@/components/common/PageContainer';
import ErrorState from '@/components/common/ErrorState';
import StatusBadge from '@/components/common/StatusBadge';
import SafeImage from '@/components/common/SafeImage';
import PageNotFound from '@/lib/PageNotFound';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { formatDate, formatTenure, initials } from '@/lib/format';

/**
 * Карточка коллеги в корпоративном справочнике.
 *
 * Зачем нужна: глобальный поиск находит сотрудников, но раньше вёл на /admin/employees/:id —
 * маршрут за ролью HR, и рядовой сотрудник получал «Доступ запрещён» по клику на коллегу.
 * Здесь только публичные контактные данные; зарплатная вилка и служебные заметки
 * живут в отдельной таблице employee_private под ролью HR (BUG-002) и сюда не попадают.
 */

function Row({ icon: Icon, label, value }) {
  if (!value) return null; // пустых строк с прочерком быть не должно
  return (
    <div className="flex items-start gap-3 py-2">
      <Icon className="w-4 h-4 mt-0.5 text-muted-foreground shrink-0" aria-hidden="true" />
      <div className="min-w-0">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-sm text-foreground break-words">{value}</div>
      </div>
    </div>
  );
}

export default function PersonCard() {
  const { id } = useParams();
  const { isHR } = useAuth();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['person', id],
    queryFn: async () => {
      const { data: row, error: err } = await api.supabase
        .from('v_employees')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (err) throw err;
      return row;
    },
    enabled: !!id,
  });

  if (error) {
    return (
      <PageContainer title="Карточка сотрудника">
        <ErrorState error={error} onRetry={refetch} />
      </PageContainer>
    );
  }

  if (isLoading) {
    return (
      <PageContainer title="Карточка сотрудника">
        <div className="h-64 rounded-xl bg-muted animate-pulse" />
      </PageContainer>
    );
  }

  if (!data) return <PageNotFound />;

  return (
    <PageContainer
      title={data.name}
      documentTitle={data.name}
      description={data.position || 'Сотрудник Optimus KZ'}
      breadcrumbs={
        <Button variant="ghost" size="sm" asChild className="mb-2 -ml-2">
          <Link to="/cabinet"><ArrowLeft className="w-4 h-4 mr-1" aria-hidden="true" /> В кабинет</Link>
        </Button>
      }
      actions={
        isHR ? (
          <Button variant="outline" asChild>
            <Link to={`/admin/employees/${data.id}`}>
              Полная карточка <ExternalLink className="w-4 h-4 ml-1.5" aria-hidden="true" />
            </Link>
          </Button>
        ) : null
      }
      width="narrow"
    >
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-start gap-4 mb-4">
            {/* Фото сотрудника; без него и при битой ссылке — инициалы */}
            <SafeImage
              src={data.photo_url}
              alt=""
              loading="eager"
              className="w-16 h-16 rounded-full object-cover shrink-0"
              fallbackText={initials(data.name)}
              fallbackClassName="bg-primary text-primary-foreground text-lg"
            />
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-foreground">{data.name}</h2>
              {data.position && <p className="text-sm text-muted-foreground">{data.position}</p>}
              <div className="flex flex-wrap gap-1.5 mt-2">
                <StatusBadge value={data.is_on_leave_now ? 'on_leave' : data.status} />
                {data.role_type && <StatusBadge value={data.role_type} />}
              </div>
            </div>
          </div>

          <div className="divide-y divide-border">
            <Row icon={Mail} label="Email" value={data.email ? <a className="text-primary hover:underline" href={`mailto:${data.email}`}>{data.email}</a> : null} />
            <Row icon={Phone} label="Телефон" value={data.phone ? <a className="text-primary hover:underline" href={`tel:${data.phone}`}>{data.phone}</a> : null} />
            <Row icon={Building2} label="Отдел" value={data.department} />
            <Row icon={MapPin} label="Филиал" value={data.branch} />
            <Row icon={Briefcase} label="Руководитель" value={data.manager_name} />
            <Row
              icon={CalendarDays}
              label="В компании"
              value={data.hire_date ? `${formatTenure(data.hire_date)} · с ${formatDate(data.hire_date, 'long')}` : null}
            />
          </div>
        </CardContent>
      </Card>
    </PageContainer>
  );
}
