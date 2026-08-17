import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Lightbulb, MessageSquare, Send, ThumbsUp } from 'lucide-react';

import { api } from '@/api/client';
import PageContainer from '@/components/common/PageContainer';
import EmptyState from '@/components/common/EmptyState';
import ErrorState from '@/components/common/ErrorState';
import StatusBadge from '@/components/common/StatusBadge';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/lib/AuthContext';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * Обратная связь HR и руководству.
 * BUG-073: страница была центрирована по-своему и имела ширину, отличную от остальных
 * (отступ слева 399 px против 289 px) — теперь это общий PageContainer width="narrow".
 * Аудит просил: опцию анонимности и историю своих обращений.
 * Хороший паттерн — три крупные карточки выбора типа — сохранён.
 */

const TYPES = [
  { value: 'idea', label: 'Идея', icon: Lightbulb, tone: 'bg-info/15 text-info', hint: 'Предложение, как сделать лучше' },
  { value: 'problem', label: 'Проблема', icon: AlertCircle, tone: 'bg-destructive/10 text-destructive', hint: 'Что-то мешает работать' },
  { value: 'gratitude', label: 'Благодарность', icon: ThumbsUp, tone: 'bg-success/15 text-success', hint: 'Спасибо коллеге или команде' },
];

const EMPTY_FORM = { type: 'idea', subject: '', body: '', anonymous: false };

function HistorySkeleton() {
  return (
    <div className="space-y-2" aria-hidden="true">
      {[0, 1].map((i) => (
        <Card key={i} className="p-4 space-y-2">
          <div className="h-4 w-1/3 rounded bg-muted animate-pulse" />
          <div className="h-3 w-2/3 rounded bg-muted/60 animate-pulse" />
        </Card>
      ))}
    </div>
  );
}

export default function CabinetFeedback() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { user, employeeId, isLoadingAuth } = useAuth();

  const [form, setForm] = useState(EMPTY_FORM);
  const [touched, setTouched] = useState({});

  const historyQuery = useQuery({
    queryKey: ['cabinet-feedback', employeeId],
    queryFn: () => api.entities.Feedback.filter({ employee_id: employeeId }, '-created_date'),
    enabled: !!employeeId,
  });

  const history = historyQuery.data || [];

  const errors = useMemo(() => {
    const acc = {};
    if (!form.subject.trim()) acc.subject = 'Укажите тему обращения';
    if (!form.body.trim()) acc.body = 'Напишите текст обращения';
    else if (form.body.trim().length < 10) acc.body = 'Слишком коротко — опишите подробнее (минимум 10 символов)';
    return acc;
  }, [form]);

  const isValid = Object.keys(errors).length === 0;

  const submit = useMutation({
    mutationFn: () => {
      const payload = {
        type: form.type,
        subject: form.subject.trim(),
        body: form.body.trim(),
        anonymous: form.anonymous,
      };
      // Анонимное обращение не содержит автора — ни id, ни ФИО (просьба аудита).
      if (!form.anonymous) {
        payload.employee_id = employeeId;
        payload.employee_name = user?.full_name || null;
      }
      return api.entities.Feedback.create(payload);
    },
    onSuccess: () => {
      toast({
        title: 'Обращение отправлено',
        description: form.anonymous
          ? 'Мы не сохранили ваше имя — обращение анонимно.'
          : 'HR-специалист ответит вам в разделе «История моих обращений».',
      });
      setForm(EMPTY_FORM);
      setTouched({});
      qc.invalidateQueries({ queryKey: ['cabinet-feedback', employeeId] });
    },
    onError: (e) => toast({ variant: 'destructive', title: 'Не удалось отправить обращение', description: e?.message }),
  });

  const handleSubmit = (event) => {
    event.preventDefault();
    setTouched({ subject: true, body: true });
    if (!isValid) return;
    submit.mutate();
  };

  const showError = (field) => (touched[field] ? errors[field] : undefined);

  return (
    <PageContainer
      title="Обратная связь"
      description="Напишите HR-отделу и руководству: предложите идею, сообщите о проблеме или поблагодарите коллегу."
      width="narrow"
    >
      <Card className="p-6">
        <form onSubmit={handleSubmit} noValidate className="space-y-5">
          <fieldset>
            <legend className="text-sm font-medium text-foreground mb-2">Тип обращения</legend>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {TYPES.map((type) => {
                const Icon = type.icon;
                const selected = form.type === type.value;
                return (
                  <button
                    key={type.value}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setForm({ ...form, type: type.value })}
                    className={cn(
                      'flex flex-col items-center gap-2 rounded-xl border-2 p-4 text-center transition min-h-[40px]',
                      selected ? 'border-primary bg-accent' : 'border-border hover:border-primary/40'
                    )}
                  >
                    <span className={cn('w-10 h-10 rounded-lg flex items-center justify-center', type.tone)}>
                      <Icon className="w-5 h-5" aria-hidden="true" />
                    </span>
                    <span className="text-sm font-medium text-foreground">{type.label}</span>
                    <span className="text-xs text-muted-foreground">{type.hint}</span>
                  </button>
                );
              })}
            </div>
          </fieldset>

          <div>
            <Label htmlFor="feedback-subject">Тема <span className="text-destructive" aria-hidden="true">*</span></Label>
            <Input
              id="feedback-subject"
              value={form.subject}
              onChange={(e) => setForm({ ...form, subject: e.target.value })}
              onBlur={() => setTouched((t) => ({ ...t, subject: true }))}
              placeholder="Кратко: о чём обращение"
              aria-invalid={showError('subject') ? 'true' : undefined}
              aria-describedby={showError('subject') ? 'feedback-subject-error' : undefined}
              className={cn('min-h-[40px]', showError('subject') && 'border-destructive')}
            />
            {showError('subject') && (
              <p id="feedback-subject-error" role="alert" className="mt-1 text-sm text-destructive">
                {errors.subject}
              </p>
            )}
          </div>

          <div>
            <Label htmlFor="feedback-body">Сообщение <span className="text-destructive" aria-hidden="true">*</span></Label>
            <Textarea
              id="feedback-body"
              rows={5}
              value={form.body}
              onChange={(e) => setForm({ ...form, body: e.target.value })}
              onBlur={() => setTouched((t) => ({ ...t, body: true }))}
              placeholder="Опишите подробно: что произошло, что предлагаете, кого благодарите."
              aria-invalid={showError('body') ? 'true' : undefined}
              aria-describedby={showError('body') ? 'feedback-body-error' : undefined}
              className={cn(showError('body') && 'border-destructive')}
            />
            {showError('body') && (
              <p id="feedback-body-error" role="alert" className="mt-1 text-sm text-destructive">
                {errors.body}
              </p>
            )}
          </div>

          <div className="flex items-start gap-3 rounded-lg bg-muted/60 p-3">
            <Checkbox
              id="feedback-anonymous"
              checked={form.anonymous}
              onCheckedChange={(checked) => setForm({ ...form, anonymous: checked === true })}
              className="mt-0.5"
            />
            <div>
              <Label htmlFor="feedback-anonymous" className="cursor-pointer">Отправить анонимно</Label>
              <p className="text-xs text-muted-foreground mt-1">
                Мы не сохраним ваше имя. Анонимные обращения не попадают в «Историю моих обращений»
                и ответ HR по ним прийти не может.
              </p>
            </div>
          </div>

          {/* Кнопка disabled при пустой форме — паттерн, который аудит похвалил. */}
          <Button type="submit" className="w-full" disabled={!isValid || submit.isPending}>
            <Send className="w-4 h-4" aria-hidden="true" />
            {submit.isPending ? 'Отправка…' : 'Отправить'}
          </Button>
        </form>
      </Card>

      <section className="mt-8">
        <h2 className="text-base font-semibold text-foreground mb-3">История моих обращений</h2>

        {historyQuery.error ? (
          <ErrorState error={historyQuery.error} onRetry={historyQuery.refetch} compact />
        ) : isLoadingAuth || (!!employeeId && historyQuery.isLoading) ? (
          <HistorySkeleton />
        ) : !employeeId ? (
          <EmptyState
            icon={MessageSquare}
            title="История недоступна"
            description="Учётная запись не связана с карточкой сотрудника, поэтому историю обращений показать не получится. Отправить обращение можно и так."
            compact
          />
        ) : history.length === 0 ? (
          <EmptyState
            icon={MessageSquare}
            title="Обращений пока нет"
            description="Отправленные не анонимно обращения появятся здесь вместе со статусом и ответом HR."
            compact
          />
        ) : (
          <ul className="space-y-2" role="list">
            {history.map((item) => (
              <li key={item.id} role="listitem">
                <Card className="p-4">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <StatusBadge value={item.type} />
                    <StatusBadge value={item.status} />
                    <span className="text-xs text-muted-foreground">{formatDate(item.created_date)}</span>
                  </div>
                  {item.subject && <p className="font-medium text-foreground">{item.subject}</p>}
                  <p className="text-sm text-muted-foreground mt-0.5 whitespace-pre-line">{item.body}</p>
                  {item.response && (
                    <div className="mt-3 rounded-lg bg-muted p-3 text-sm">
                      <p className="font-medium text-foreground mb-0.5">Ответ HR</p>
                      <p className="text-muted-foreground whitespace-pre-line">{item.response}</p>
                    </div>
                  )}
                </Card>
              </li>
            ))}
          </ul>
        )}

        <p className="mt-4 flex items-start gap-2 text-xs text-muted-foreground">
          <MessageSquare className="w-4 h-4 shrink-0" aria-hidden="true" />
          Обращения конфиденциальны и рассматриваются в течение 3 рабочих дней.
        </p>
      </section>
    </PageContainer>
  );
}
