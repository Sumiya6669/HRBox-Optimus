import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  FileText, Download, FileSignature, FileCheck, FileBadge, Search, ClipboardList,
} from 'lucide-react';
import PageContainer from '@/components/common/PageContainer';
import EmptyState from '@/components/common/EmptyState';
import ErrorState from '@/components/common/ErrorState';
import StatusBadge from '@/components/common/StatusBadge';
import { useCurrentEmployee } from '@/lib/useCurrentEmployee';
import { formatDate, pluralize } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * Кадровые документы сотрудника.
 * Раздел был полностью пуст — теперь читает hr_documents по employee_id,
 * группирует по типу, даёт скачивание и поиск.
 *
 * BUG-044: «Справка 2-НДФЛ» — российская форма; для Казахстана актуальны
 *          «Справка с места работы» и «Справка о доходах». Заказ справки ведёт
 *          в заявки с предзаполненным типом: /cabinet/requests?type=reference.
 */

/** Порядок групп и ярлыки для типов, которых нет в общем словаре статусов. */
const TYPE_ORDER = ['contract', 'order', 'statement', 'certificate', 'other'];

const TYPE_META = {
  contract: { title: 'Трудовые договоры', icon: FileSignature, fallback: 'Трудовой договор', tone: 'bg-info/10 text-info' },
  order: { title: 'Приказы', icon: FileCheck, fallback: 'Приказ', tone: 'bg-warning/10 text-warning' },
  statement: { title: 'Заявления', icon: FileText, fallback: 'Заявление', tone: 'bg-muted text-muted-foreground' },
  certificate: { title: 'Справки', icon: FileBadge, fallback: 'Справка', tone: 'bg-success/10 text-success' },
  other: { title: 'Прочие документы', icon: FileText, fallback: 'Прочее', tone: 'bg-muted text-muted-foreground' },
};

/** BUG-044: казахстанские формы справок вместо российской «2-НДФЛ». */
const REFERENCE_EXAMPLES = ['Справка с места работы', 'Справка о доходах'];

function SkeletonList() {
  return (
    <div className="space-y-3" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-16 animate-pulse rounded-xl bg-muted" />
      ))}
    </div>
  );
}

function OrderReferenceCard() {
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
            <ClipboardList className="h-5 w-5 text-primary" aria-hidden="true" />
            Заказать справку
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Нужного документа нет в списке? Оформите заявку в HR-отдел — например,{' '}
            {REFERENCE_EXAMPLES.map((example, i) => (
              <React.Fragment key={example}>
                {i > 0 ? ' или ' : ''}
                «{example}»
              </React.Fragment>
            ))}
            .
          </p>
        </div>
        <Button asChild className="min-h-[40px]">
          {/* Тип заявки предзаполняется query-параметром */}
          <Link to="/cabinet/requests?type=reference" aria-label="Заказать справку в HR-отделе">
            Заказать справку
          </Link>
        </Button>
      </div>
    </Card>
  );
}

export default function CabinetDocuments() {
  const { employeeId, isLoading: isLoadingAuth } = useCurrentEmployee();
  const [search, setSearch] = useState('');

  const { data, isPending, error, refetch } = useQuery({
    queryKey: ['hr-documents-me', employeeId],
    queryFn: () => api.entities.HRDocument.filter({ employee_id: employeeId }, '-upload_date'),
    enabled: !!employeeId,
  });

  const documents = useMemo(() => data || [], [data]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return documents;
    return documents.filter((d) => d.title?.toLowerCase().includes(q));
  }, [documents, search]);

  const groups = useMemo(() => {
    const map = new Map();
    filtered.forEach((doc) => {
      const key = TYPE_META[doc.type] ? doc.type : 'other';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(doc);
    });
    return TYPE_ORDER.filter((key) => map.has(key)).map((key) => ({ key, items: map.get(key) }));
  }, [filtered]);

  // Учётка без карточки сотрудника — понятное объяснение, а не пустой экран.
  if (!isLoadingAuth && !employeeId) {
    return (
      <PageContainer title="Кадровые документы" description="Трудовой договор, приказы, заявления и справки">
        <EmptyState
          icon={FileText}
          title="Учётная запись не связана с карточкой сотрудника"
          description="Кадровые документы хранятся в карточке сотрудника. Попросите HR-специалиста связать вашу учётную запись — после этого документы появятся здесь."
        />
      </PageContainer>
    );
  }

  return (
    <PageContainer
      title="Кадровые документы"
      description="Трудовой договор, приказы, заявления и справки"
    >
      {error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : isLoadingAuth || isPending ? (
        <SkeletonList />
      ) : !documents.length ? (
        <div className="space-y-6">
          <EmptyState
            icon={FileText}
            title="Документов пока нет"
            description="HR-отдел ещё не загрузил ваши кадровые документы. Нужный документ можно заказать заявкой."
          />
          <OrderReferenceCard />
        </div>
      ) : (
        <div className="space-y-6">
          <div className="relative max-w-md">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск по названию документа"
              aria-label="Поиск кадровых документов"
              className="min-h-[40px] pl-9"
            />
          </div>

          {!filtered.length ? (
            <EmptyState
              icon={Search}
              compact
              title="Документы не найдены"
              description="Попробуйте изменить поисковый запрос."
              actionLabel="Сбросить поиск"
              onAction={() => setSearch('')}
            />
          ) : (
            groups.map(({ key, items }) => {
              const meta = TYPE_META[key];
              const Icon = meta.icon;
              return (
                <section key={key} aria-labelledby={`docs-${key}`}>
                  <div className="mb-3 flex items-center gap-2">
                    <h2 id={`docs-${key}`} className="font-semibold text-foreground">
                      {meta.title}
                    </h2>
                    <span className="text-xs text-muted-foreground">
                      {pluralize(items.length, 'документ', 'документа', 'документов')}
                    </span>
                  </div>
                  <ul role="list" className="space-y-2">
                    {items.map((doc) => (
                      <li key={doc.id} role="listitem">
                        <Card className="flex flex-wrap items-center gap-3 p-4">
                          <div
                            className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-lg', meta.tone)}
                            aria-hidden="true"
                          >
                            <Icon className="h-5 w-5" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate font-medium text-foreground">{doc.title}</div>
                            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                              <StatusBadge value={doc.type} fallback={meta.fallback} />
                              <span className="whitespace-nowrap">{formatDate(doc.upload_date)}</span>
                            </div>
                          </div>
                          {doc.file_url ? (
                            <Button asChild variant="outline" className="min-h-[40px]">
                              <a
                                href={doc.file_url}
                                target="_blank"
                                rel="noreferrer"
                                download
                                aria-label={`Скачать документ «${doc.title}»`}
                              >
                                <Download className="h-4 w-4" aria-hidden="true" />
                                Скачать
                              </a>
                            </Button>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              Файл не приложен — запросите копию в HR-отделе
                            </span>
                          )}
                        </Card>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })
          )}

          <OrderReferenceCard />
        </div>
      )}
    </PageContainer>
  );
}
