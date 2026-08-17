import React, { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { FileBarChart } from 'lucide-react';

import { api } from '@/api/client';
import PageContainer from '@/components/common/PageContainer';
import EmptyState from '@/components/common/EmptyState';
import ErrorState from '@/components/common/ErrorState';
import StatusBadge from '@/components/common/StatusBadge';
import SurveyReport from '@/components/surveys/SurveyReport';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { formatDateRange, pluralize } from '@/lib/format';

/**
 * BUG-070: раздел назывался «Отчёт по обратной связи», хотя это отчётность по опросам,
 * а «Обратная связь» — отдельный модуль кабинета (таблица feedback). Переименован
 * в «Отчёты по опросам», ключ nav_survey_reports поправлен в обоих словарях i18n.
 *
 * Пустое состояние «выберите объект» аудит похвалил — оно сохранено и дополнено
 * выбором конкретной сессии.
 */

function ReportSkeleton() {
  return (
    <div className="space-y-4" aria-hidden="true">
      <Card className="h-16 animate-pulse bg-muted/40" />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[0, 1, 2, 3].map((i) => (
          <Card key={i} className="h-24 animate-pulse bg-muted/40" />
        ))}
      </div>
      <Card className="h-64 animate-pulse bg-muted/40" />
    </div>
  );
}

export default function AdminSurveyReports() {
  const [params, setParams] = useSearchParams();
  const surveyId = params.get('surveyId') || '';
  const sessionId = params.get('sessionId') || '';

  // BUG-018/019: список опросов — из вьюхи, со счётчиками и статусом по датам.
  const surveysQuery = useQuery({
    queryKey: ['admin-surveys-for-reports'],
    queryFn: async () => {
      const { data, error } = await api.supabase
        .from('v_surveys')
        .select('*')
        .order('created_date', { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const sessionsQuery = useQuery({
    queryKey: ['admin-report-sessions', surveyId],
    enabled: !!surveyId,
    queryFn: () => api.entities.SurveySession.filter({ survey_id: surveyId }, '-start_date'),
  });

  const surveys = useMemo(() => surveysQuery.data || [], [surveysQuery.data]);
  const sessions = sessionsQuery.data || [];
  const selected = surveys.find((s) => s.id === surveyId) || null;

  const setSurvey = (value) => {
    setParams(value ? { surveyId: value } : {});
  };

  const setSession = (value) => {
    const next = { surveyId };
    if (value) next.sessionId = value;
    setParams(next);
  };

  return (
    <PageContainer
      title="Отчёты по опросам"
      description="Сводка ответов и выгрузка по каждому опросу и каждой его сессии. Все цифры считаются из полученных ответов."
      width="wide"
    >
      {surveysQuery.error ? (
        <ErrorState error={surveysQuery.error} onRetry={surveysQuery.refetch} />
      ) : surveysQuery.isLoading ? (
        <ReportSkeleton />
      ) : surveys.length === 0 ? (
        <EmptyState
          icon={FileBarChart}
          title="Отчитываться пока не по чему"
          description="В портале ещё нет опросов. Создайте опрос в разделе «Опросы» — отчёт появится сразу после первых ответов."
        />
      ) : (
        <div className="space-y-5">
          <Card className="p-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="report-survey">Опрос</Label>
                <select
                  id="report-survey"
                  className="mt-1 w-full min-h-[40px] rounded-md border border-input bg-transparent px-3 text-sm"
                  value={surveyId}
                  onChange={(e) => setSurvey(e.target.value)}
                >
                  <option value="">— выберите опрос —</option>
                  {surveys.map((s) => (
                    <option key={s.id} value={s.id}>{s.title}</option>
                  ))}
                </select>
              </div>

              <div>
                <Label htmlFor="report-session">Сессия</Label>
                <select
                  id="report-session"
                  className="mt-1 w-full min-h-[40px] rounded-md border border-input bg-transparent px-3 text-sm"
                  value={sessionId}
                  disabled={!surveyId || sessionsQuery.isLoading}
                  onChange={(e) => setSession(e.target.value)}
                >
                  <option value="">Все сессии</option>
                  {sessions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {formatDateRange(s.start_date, s.end_date)}
                    </option>
                  ))}
                </select>
                {surveyId && !sessionsQuery.isLoading && sessions.length === 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    У опроса нет сессий — показаны все ответы.
                  </p>
                )}
              </div>
            </div>

            {selected && (
              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
                <StatusBadge value={selected.type} />
                <StatusBadge value={selected.effective_status} />
                {selected.anonymous && <StatusBadge value="anonymous" />}
                <span className="text-xs text-muted-foreground">
                  {pluralize(selected.questions_count || 0, 'вопрос', 'вопроса', 'вопросов')}
                  {' · '}
                  {pluralize(selected.responses_count || 0, 'ответ', 'ответа', 'ответов')} всего
                </span>
              </div>
            )}
          </Card>

          {/* Похвалённый аудитом empty state «выберите объект» сохранён */}
          {!surveyId ? (
            <EmptyState
              icon={FileBarChart}
              title="Выберите опрос"
              description="Выберите опрос из списка выше — и при необходимости конкретную сессию, чтобы увидеть сводку ответов."
            />
          ) : (
            /* Выбор сессии живёт на странице — в отчёт передаём уже выбранное значение */
            <SurveyReport surveyId={surveyId} sessionId={sessionId || 'all'} />
          )}
        </div>
      )}
    </PageContainer>
  );
}
