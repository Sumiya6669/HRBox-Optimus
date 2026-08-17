import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts';
import {
  BarChart3, Download, EyeOff, Printer, Search, Settings2, Table2, Users,
} from 'lucide-react';

import { api } from '@/api/client';
import EmptyState from '@/components/common/EmptyState';
import ErrorState from '@/components/common/ErrorState';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatDate, formatNumber, pluralize } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * Отчёт по опросу.
 *
 * BUG-018: вся статистика считается из реальных записей survey_responses
 * (поле answers — jsonb-массив {question_id, question_text, question_type,
 * answer_text, answer_values[]}), а не из хранимых счётчиков опроса.
 * Именно хранимые счётчики показывали «93 ответа» при пустой таблице.
 *
 * Анонимность: у анонимного опроса вкладка респондентов не рендерится вообще —
 * ни имён, ни построчных ответов, иначе анонимность мнимая.
 */

const COLORS = [
  'hsl(var(--primary))',
  'hsl(var(--info))',
  'hsl(var(--success))',
  'hsl(var(--warning))',
  'hsl(var(--brand-wallet))',
  'hsl(var(--brand-library))',
  'hsl(var(--brand-learning))',
  'hsl(var(--muted-foreground))',
];

/** Ответ на конкретный вопрос внутри записи survey_responses. */
function findAnswer(response, questionId) {
  return (response.answers || []).find((a) => a.question_id === questionId) || null;
}

/** Текст ответа для таблицы и выгрузки. */
function answerToText(answer) {
  if (!answer) return '';
  const values = (answer.answer_values || []).filter(Boolean);
  if (values.length) return values.join(', ');
  return answer.answer_text || '';
}

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

export function SurveyReport({ surveyId, sessionId = 'all', onSessionChange }) {
  const [tab, setTab] = useState('summary');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [search, setSearch] = useState('');
  const [hiddenColumns, setHiddenColumns] = useState({});
  const [showColSettings, setShowColSettings] = useState(false);

  // Опрос читаем из вьюхи: нужны effective_status и агрегаты (BUG-018/019).
  const surveyQuery = useQuery({
    queryKey: ['survey-report-survey', surveyId],
    enabled: !!surveyId,
    queryFn: async () => {
      const { data, error } = await api.supabase.from('v_surveys').select('*').eq('id', surveyId).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const sessionsQuery = useQuery({
    queryKey: ['survey-report-sessions', surveyId],
    enabled: !!surveyId,
    queryFn: () => api.entities.SurveySession.filter({ survey_id: surveyId }, '-start_date'),
  });

  const responsesQuery = useQuery({
    queryKey: ['survey-report-responses', surveyId, sessionId],
    enabled: !!surveyId,
    queryFn: () => {
      const where = { survey_id: surveyId };
      if (sessionId && sessionId !== 'all') where.session_id = sessionId;
      return api.entities.SurveyResponse.filter(where, '-date');
    },
  });

  const survey = surveyQuery.data || null;
  const sessions = useMemo(() => sessionsQuery.data || [], [sessionsQuery.data]);
  const responses = useMemo(() => responsesQuery.data || [], [responsesQuery.data]);
  const anonymous = !!survey?.anonymous;

  /**
   * Список вопросов: из карточки опроса плюс те, что встречаются в ответах,
   * но были позже удалены из конструктора — иначе часть ответов исчезала из отчёта.
   */
  const questions = useMemo(() => {
    const base = Array.isArray(survey?.questions) ? survey.questions : [];
    const known = new Set(base.map((q) => q.id));
    const extra = [];
    responses.forEach((response) => {
      (response.answers || []).forEach((answer) => {
        if (!answer?.question_id || known.has(answer.question_id)) return;
        known.add(answer.question_id);
        extra.push({
          id: answer.question_id,
          text: answer.question_text || 'Удалённый вопрос',
          type: answer.question_type || 'text',
          options: [],
          removed: true,
        });
      });
    });
    return [...base, ...extra];
  }, [survey, responses]);

  const filtered = useMemo(() => {
    let rows = responses;
    if (dateFrom) rows = rows.filter((r) => formatDate(r.date, 'iso') >= dateFrom);
    if (dateTo) rows = rows.filter((r) => formatDate(r.date, 'iso') <= dateTo);
    if (search && !anonymous) {
      const needle = search.toLowerCase();
      rows = rows.filter((r) => (r.employee_name || '').toLowerCase().includes(needle));
    }
    return rows;
  }, [responses, dateFrom, dateTo, search, anonymous]);

  /** Сводка по каждому вопросу — только из фактических ответов. */
  const summary = useMemo(
    () =>
      questions.map((question) => {
        const answers = filtered.map((r) => findAnswer(r, question.id)).filter(Boolean);

        if (question.type === 'single' || question.type === 'rating') {
          const counts = {};
          (question.options || []).forEach((option) => { counts[option] = 0; });
          answers.forEach((answer) => {
            const value = (answer.answer_values || [])[0] || answer.answer_text;
            if (value) counts[value] = (counts[value] || 0) + 1;
          });
          return {
            question,
            chart: Object.entries(counts).map(([name, value]) => ({ name, value })),
            texts: [],
            total: answers.length,
          };
        }

        if (question.type === 'multiple' || question.type === 'grid') {
          const counts = {};
          answers.forEach((answer) => {
            (answer.answer_values || []).forEach((value) => {
              if (value) counts[value] = (counts[value] || 0) + 1;
            });
          });
          return {
            question,
            chart: Object.entries(counts).map(([name, value]) => ({ name, value })),
            texts: [],
            total: answers.length,
          };
        }

        return {
          question,
          chart: [],
          texts: answers.map((a) => a.answer_text).filter(Boolean),
          total: answers.length,
        };
      }),
    [questions, filtered]
  );

  /** Приглашённые: сумма target_count по выбранной сессии (или по всем). */
  const invited = useMemo(() => {
    const pool = sessionId && sessionId !== 'all' ? sessions.filter((s) => s.id === sessionId) : sessions;
    return pool.reduce((sum, s) => sum + (s.target_count || 0), 0);
  }, [sessions, sessionId]);

  const participation = invited > 0 ? Math.min(100, Math.round((filtered.length / invited) * 100)) : null;

  const visibleQuestions = questions.filter((q) => hiddenColumns[q.id] !== true);

  const exportCSV = () => {
    const headers = ['Дата', ...(anonymous ? [] : ['Сотрудник']), ...visibleQuestions.map((q) => q.text || 'Вопрос')];
    const rows = filtered.map((r) => [
      formatDate(r.date, 'datetime'),
      // Анонимный опрос: в выгрузке автора нет вовсе.
      ...(anonymous ? [] : [r.employee_name || '—']),
      ...visibleQuestions.map((q) => answerToText(findAnswer(r, q.id))),
    ]);
    const csv = [headers, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Отчёт_${survey?.title || 'опрос'}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const error = surveyQuery.error || sessionsQuery.error || responsesQuery.error;
  const isLoading = surveyQuery.isLoading || sessionsQuery.isLoading || responsesQuery.isLoading;

  const refetchAll = () => {
    surveyQuery.refetch();
    sessionsQuery.refetch();
    responsesQuery.refetch();
  };

  if (error) return <ErrorState error={error} onRetry={refetchAll} />;
  if (isLoading) return <ReportSkeleton />;
  if (!survey) {
    return (
      <EmptyState
        icon={BarChart3}
        title="Опрос не найден"
        description="Возможно, опрос удалили. Выберите другой опрос из списка."
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* Панель фильтров */}
      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          {onSessionChange && (
            <div>
              <Label htmlFor="report-session-inline" className="text-xs">Сессия</Label>
              <select
                id="report-session-inline"
                className="mt-1 min-h-[40px] rounded-md border border-input bg-transparent px-3 text-sm"
                value={sessionId}
                onChange={(e) => onSessionChange(e.target.value === 'all' ? '' : e.target.value)}
              >
                <option value="all">Все сессии</option>
                {sessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {formatDate(s.start_date)}
                    {s.end_date ? ` — ${formatDate(s.end_date)}` : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <Label htmlFor="report-from" className="text-xs">Ответы с</Label>
            <Input
              id="report-from"
              type="date"
              className="mt-1 w-auto min-h-[40px]"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="report-to" className="text-xs">по</Label>
            <Input
              id="report-to"
              type="date"
              className="mt-1 w-auto min-h-[40px]"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </div>

          {!anonymous && (
            <div className="relative">
              <Label htmlFor="report-search" className="text-xs">Респондент</Label>
              <Search
                className="absolute left-2.5 top-[34px] w-3.5 h-3.5 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                id="report-search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Поиск по фамилии"
                className="mt-1 w-48 pl-8 min-h-[40px]"
              />
            </div>
          )}

          <div className="flex-1" />

          <Button
            size="sm"
            variant="outline"
            className="min-h-[40px]"
            onClick={exportCSV}
            disabled={filtered.length === 0}
            aria-label="Выгрузить отчёт в CSV"
          >
            <Download className="w-4 h-4" aria-hidden="true" />
            Выгрузить CSV
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="min-h-[40px]"
            onClick={() => window.print()}
            aria-label="Распечатать отчёт"
          >
            <Printer className="w-4 h-4" aria-hidden="true" />
            Печать
          </Button>
        </div>
      </Card>

      {anonymous && (
        <p className="flex items-start gap-2 rounded-lg bg-muted p-3 text-sm text-muted-foreground">
          <EyeOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          Опрос анонимный: список респондентов и построчные ответы не показываются и не выгружаются —
          доступна только сводка по всем участникам.
        </p>
      )}

      {/* Вкладки */}
      <div className="flex items-center gap-1 border-b border-border" role="tablist" aria-label="Разделы отчёта">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'summary'}
          onClick={() => setTab('summary')}
          className={cn(
            'flex min-h-[40px] items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition -mb-px',
            tab === 'summary'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          )}
        >
          <BarChart3 className="w-4 h-4" aria-hidden="true" />
          Общая сводка
        </button>
        {!anonymous && (
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'respondents'}
            onClick={() => setTab('respondents')}
            className={cn(
              'flex min-h-[40px] items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition -mb-px',
              tab === 'respondents'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            <Table2 className="w-4 h-4" aria-hidden="true" />
            Респонденты
            <Badge variant="secondary">{formatNumber(filtered.length)}</Badge>
          </button>
        )}
      </div>

      {tab === 'summary' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card className="p-4 text-center">
              <Users className="mx-auto mb-1 h-5 w-5 text-primary" aria-hidden="true" />
              <div className="text-2xl font-bold text-foreground">{formatNumber(filtered.length)}</div>
              <div className="text-xs text-muted-foreground">Получено ответов</div>
            </Card>
            <Card className="p-4 text-center">
              <BarChart3 className="mx-auto mb-1 h-5 w-5 text-info" aria-hidden="true" />
              <div className="text-2xl font-bold text-foreground">{formatNumber(questions.length)}</div>
              <div className="text-xs text-muted-foreground">Вопросов в опросе</div>
            </Card>
            <Card className="p-4 text-center">
              <div className="text-2xl font-bold text-foreground">{formatNumber(sessions.length)}</div>
              <div className="text-xs text-muted-foreground">Сессий проведено</div>
            </Card>
            <Card className="p-4 text-center">
              <div className="text-2xl font-bold text-primary">
                {participation === null ? '—' : `${participation}%`}
              </div>
              <div className="text-xs text-muted-foreground">
                {participation === null
                  ? 'Число приглашённых не задано'
                  : `Ответили ${formatNumber(filtered.length)} из ${formatNumber(invited)} приглашённых`}
              </div>
            </Card>
          </div>

          {questions.length === 0 ? (
            <EmptyState
              icon={BarChart3}
              title="В опросе нет вопросов"
              description="Добавьте вопросы в конструкторе — тогда в отчёте появится разбивка по каждому из них."
            />
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={Users}
              title="Ответов пока нет"
              description="По выбранной сессии и периоду ответы не найдены. Проверьте фильтры или дождитесь ответов сотрудников."
            />
          ) : (
            summary.map((item, index) => (
              <Card key={item.question.id} className="p-5">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">Вопрос {index + 1}</Badge>
                  <h3 className="flex-1 font-semibold text-foreground">{item.question.text}</h3>
                  {/* Вопрос удалён из конструктора, но ответы на него сохранились */}
                  {item.question.removed && <Badge variant="outline">Удалён из опроса</Badge>}
                  <Badge variant="outline">
                    {pluralize(item.total, 'ответ', 'ответа', 'ответов')}
                  </Badge>
                </div>

                {item.chart.length > 0 && (
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      {item.question.type === 'single' ? (
                        <PieChart>
                          <Pie data={item.chart} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
                            {item.chart.map((entry, i) => (
                              <Cell key={entry.name} fill={COLORS[i % COLORS.length]} />
                            ))}
                          </Pie>
                          <Tooltip />
                        </PieChart>
                      ) : (
                        <BarChart data={item.chart}>
                          <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                          <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                          <Tooltip />
                          <Bar dataKey="value" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                        </BarChart>
                      )}
                    </ResponsiveContainer>
                  </div>
                )}

                {item.chart.length === 0 && item.texts.length > 0 && (
                  <ul className="max-h-48 space-y-2 overflow-y-auto" role="list">
                    {item.texts.map((text, i) => (
                      <li key={i} className="rounded-lg bg-muted p-2 text-sm text-foreground/80" role="listitem">
                        {text}
                      </li>
                    ))}
                  </ul>
                )}

                {item.chart.length === 0 && item.texts.length === 0 && (
                  <p className="text-sm text-muted-foreground">На этот вопрос пока никто не ответил.</p>
                )}
              </Card>
            ))
          )}
        </div>
      )}

      {tab === 'respondents' && !anonymous && (
        <Card className="p-4">
          <div className="mb-3 flex items-center gap-2">
            <div className="flex-1" />
            <div className="relative">
              <Button
                size="sm"
                variant="outline"
                className="min-h-[40px]"
                aria-expanded={showColSettings}
                onClick={() => setShowColSettings((v) => !v)}
              >
                <Settings2 className="w-4 h-4" aria-hidden="true" />
                Столбцы
              </Button>
              {showColSettings && (
                <div className="absolute right-0 top-full z-50 mt-1 max-h-64 w-64 overflow-y-auto rounded-lg border border-border bg-popover p-3 shadow-lg">
                  <p className="mb-2 text-xs font-medium text-foreground">Отображаемые столбцы</p>
                  {questions.map((q) => (
                    <label key={q.id} className="flex cursor-pointer items-center gap-2 py-1 text-sm">
                      <input
                        type="checkbox"
                        checked={hiddenColumns[q.id] !== true}
                        onChange={(e) =>
                          setHiddenColumns({ ...hiddenColumns, [q.id]: !e.target.checked })
                        }
                      />
                      <span className="truncate">{q.text || 'Вопрос'}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>

          {filtered.length === 0 ? (
            <EmptyState
              icon={Users}
              title="Ответов по выбранным фильтрам нет"
              description="Сбросьте период или поиск по фамилии, чтобы увидеть все ответы."
              compact
            />
          ) : (
            <div className="table-scroll overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">Ответы респондентов на опрос «{survey.title}»</caption>
                <thead>
                  <tr className="border-b border-border text-left">
                    <th scope="col" className="px-3 py-2 font-medium text-muted-foreground">Дата</th>
                    <th scope="col" className="px-3 py-2 font-medium text-muted-foreground">Респондент</th>
                    {visibleQuestions.map((q) => (
                      <th key={q.id} scope="col" className="min-w-[150px] px-3 py-2 font-medium text-muted-foreground">
                        {q.text || 'Вопрос'}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((response) => (
                    <tr key={response.id} className="border-b border-border/50 hover:bg-muted/30">
                      <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                        {formatDate(response.date, 'datetime')}
                      </td>
                      <td className="px-3 py-2">
                        {response.employee_id ? (
                          <Link
                            to={`/admin/employees/${response.employee_id}`}
                            className="font-medium text-primary hover:underline"
                          >
                            {response.employee_name || 'Сотрудник'}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">Без автора</span>
                        )}
                      </td>
                      {visibleQuestions.map((q) => (
                        <td key={q.id} className="px-3 py-2">
                          {answerToText(findAnswer(response, q.id)) || '—'}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

export default SurveyReport;
