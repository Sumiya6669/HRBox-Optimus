import React, { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, Save, RotateCcw, Lock, Info, Check, X } from 'lucide-react';

import { api } from '@/api/client';
import PageContainer from '@/components/common/PageContainer';
import ErrorState from '@/components/common/ErrorState';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/components/ui/use-toast';
import { useAuth, ROLE_LABELS } from '@/lib/AuthContext';
import { mutationErrorMessage } from '@/lib/dataErrors';
import { SECTIONS, SECTION_GROUPS, sectionsByGroup, isSectionLocked } from '@/lib/sections';
import { cn } from '@/lib/utils';

/**
 * Настройка прав доступа: какая роль какие разделы видит.
 *
 * Раньше это было зашито в код — чтобы закрыть раздел, требовалась правка и
 * деплой. Теперь администратор отмечает галочки прямо здесь.
 *
 * ЧЕСТНО О ГРАНИЦАХ, и об этом прямо написано на экране: матрица управляет
 * видимостью разделов и маршрутами. Она НЕ заменяет права на сами данные —
 * их решают политики RLS в базе. Закрывать доступ к зарплатам настройкой
 * интерфейса нельзя: её слишком легко обойти прямым запросом.
 *
 * Две защиты от «выстрела в ногу»:
 *   • раздел с minRole выше роли просто не показывается в её колонке — иначе
 *     галочка была бы обманом: доступ дан, а база всё равно откажет;
 *   • разделы «Пользователи», «Права доступа» и «Настройки» для администратора
 *     заблокированы — сняв их, права было бы уже не вернуть.
 */

const ROLES = ['employee', 'manager', 'hr', 'admin'];
const ROLE_RANK = { employee: 1, manager: 2, hr: 3, admin: 4 };

/** Раздел вообще применим к роли? Ниже пола minRole он недоступен всегда. */
function isApplicable(section, role) {
  const floor = section.minRole ? ROLE_RANK[section.minRole] : 1;
  return (ROLE_RANK[role] ?? 0) >= floor;
}

function MatrixSkeleton() {
  return (
    <div className="space-y-2 p-4" aria-hidden="true">
      {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => <div key={i} className="h-10 animate-pulse rounded bg-muted" />)}
    </div>
  );
}

export default function AdminPermissions() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { refresh } = useAuth();

  // Черновик: { role: { sectionKey: boolean } }. Сохраняется целиком по кнопке,
  // а не по каждой галочке — иначе на матрице в 46 строк уходили бы сотни
  // запросов, и половина настроек терялась бы при обрыве связи.
  const [draft, setDraft] = useState(null);

  const permsQuery = useQuery({
    queryKey: ['role-permissions'],
    queryFn: () => api.entities.RolePermission.list('section_key', 500),
  });

  /** Текущее состояние из базы в виде { role: { key: bool } }. */
  const saved = useMemo(() => {
    const map = {};
    ROLES.forEach((r) => { map[r] = {}; });
    (permsQuery.data || []).forEach((row) => {
      if (!map[row.role]) map[row.role] = {};
      map[row.role][row.section_key] = row.allowed;
    });
    // Разделы, которых ещё нет в базе, по умолчанию открыты в пределах роли.
    ROLES.forEach((role) => {
      SECTIONS.forEach((s) => {
        if (map[role][s.key] === undefined) map[role][s.key] = isApplicable(s, role);
      });
    });
    return map;
  }, [permsQuery.data]);

  // Черновик заполняем ОДИН раз, при первой загрузке. Синхронизировать его с
  // каждым ответом сервера нельзя: react-query перезапрашивает данные при
  // возврате фокуса на вкладку, и наполовину заполненная матрица молча
  // сбрасывалась бы в исходное состояние. После сохранения черновик сбрасываем
  // явно — там это и нужно.
  useEffect(() => {
    if (permsQuery.data && draft === null) setDraft(structuredClone(saved));
  }, [permsQuery.data, saved, draft]);

  const current = draft || saved;

  const dirtyRoles = useMemo(() => {
    if (!draft) return [];
    return ROLES.filter((role) => SECTIONS.some((s) => draft[role]?.[s.key] !== saved[role]?.[s.key]));
  }, [draft, saved]);

  const toggle = (role, key) => {
    if (isSectionLocked(key, role)) return;
    setDraft((prev) => {
      const next = structuredClone(prev || saved);
      next[role][key] = !next[role][key];
      return next;
    });
  };

  /** Отметить/снять всю группу разом — иначе настройка отдела из 8 разделов утомляет. */
  const toggleGroup = (role, groupKey, value) => {
    setDraft((prev) => {
      const next = structuredClone(prev || saved);
      sectionsByGroup(groupKey).forEach((s) => {
        if (!isApplicable(s, role) || isSectionLocked(s.key, role)) return;
        next[role][s.key] = value;
      });
      return next;
    });
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      // Сохраняем только изменённые роли: лишние записи в журнале действий
      // мешают потом понять, кто что реально менял.
      for (const role of dirtyRoles) {
        const payload = {};
        SECTIONS.forEach((s) => {
          if (!isApplicable(s, role)) return;
          payload[s.key] = !!current[role][s.key];
        });
        await api.rpc.setRolePermissions(role, payload);
      }
      return dirtyRoles.length;
    },
    onSuccess: async (count) => {
      setDraft(null); // перечитаем из базы: так видно, что именно применилось
      await qc.invalidateQueries({ queryKey: ['role-permissions'] });
      // Своя роль тоже могла измениться — перечитываем права текущей сессии,
      // иначе меню осталось бы прежним до перезагрузки страницы.
      await refresh();
      toast({ title: count ? `Права сохранены (ролей: ${count})` : 'Изменений не было' });
    },
    onError: (e) => toast({
      title: 'Не удалось сохранить права',
      description: mutationErrorMessage(e),
      variant: 'destructive',
    }),
  });

  const actions = (
    <div className="flex flex-wrap gap-2">
      <Button
        variant="outline"
        onClick={() => setDraft(structuredClone(saved))}
        disabled={!dirtyRoles.length || saveMutation.isPending}
      >
        <RotateCcw className="mr-1 h-4 w-4" aria-hidden="true" /> Отменить
      </Button>
      <Button onClick={() => saveMutation.mutate()} disabled={!dirtyRoles.length || saveMutation.isPending}>
        <Save className="mr-1 h-4 w-4" aria-hidden="true" />
        {saveMutation.isPending ? 'Сохраняю…' : 'Сохранить изменения'}
      </Button>
    </div>
  );

  return (
    <PageContainer
      title="Права доступа"
      description="Какие разделы портала видит каждая роль"
      width="wide"
      actions={actions}
    >
      {permsQuery.error ? (
        <ErrorState error={permsQuery.error} onRetry={() => permsQuery.refetch()} />
      ) : (
        <div className="space-y-5">
          {/* Прямо на экране объясняем, что эта настройка делает, а что нет. */}
          <Card className="flex gap-3 border-info/40 bg-info/5 p-4">
            <Info className="mt-0.5 h-5 w-5 shrink-0 text-info" aria-hidden="true" />
            <div className="space-y-1.5 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">Что настраивает эта таблица</p>
              <p>
                Галочка открывает или закрывает <strong>раздел портала</strong>: пункт меню и сам
                экран. Права на данные — кто чью зарплату или заявку может прочитать — задаются
                политиками в базе и этой таблицей не меняются. Закрывать доступ к данным настройкой
                интерфейса нельзя: её можно обойти прямым запросом.
              </p>
              <p>
                Пустая ячейка вместо галочки означает, что раздел роли недоступен в принципе —
                например, журнал действий сотруднику. Замок{' '}
                <Lock className="inline h-3 w-3" aria-hidden="true" /> — раздел нельзя закрыть, иначе
                администратор потеряет возможность вернуть права обратно.
              </p>
            </div>
          </Card>

          {dirtyRoles.length > 0 && (
            <Card className="border-warning/40 bg-warning/5 p-3 text-sm text-foreground">
              Есть несохранённые изменения:{' '}
              <strong>{dirtyRoles.map((r) => ROLE_LABELS[r]).join(', ')}</strong>.
              Нажмите «Сохранить изменения», чтобы применить.
            </Card>
          )}

          {permsQuery.isPending ? (
            <Card><MatrixSkeleton /></Card>
          ) : (
            SECTION_GROUPS.map((group) => {
              const items = sectionsByGroup(group.key);
              if (!items.length) return null;
              return (
                <Card key={group.key} className="overflow-hidden">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/30 px-4 py-3">
                    <h2 className="flex items-center gap-2 font-semibold text-foreground">
                      <ShieldCheck className="h-4 w-4 text-primary" aria-hidden="true" /> {group.title}
                    </h2>
                    <span className="text-xs text-muted-foreground">
                      {items.length} {items.length === 1 ? 'раздел' : 'разделов'}
                    </span>
                  </div>

                  <div className="table-scroll">
                    <table className="w-full text-sm">
                      <caption className="sr-only">Доступ ролей к разделам группы «{group.title}»</caption>
                      <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                        <tr>
                          <th scope="col" className="px-4 py-2 text-left font-medium">Раздел</th>
                          {ROLES.map((role) => (
                            <th key={role} scope="col" className="px-3 py-2 text-center font-medium">
                              <div>{ROLE_LABELS[role]}</div>
                              <div className="mt-1 flex justify-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => toggleGroup(role, group.key, true)}
                                  className="rounded p-0.5 text-success hover:bg-success/10"
                                  aria-label={`Открыть все разделы группы «${group.title}» для роли «${ROLE_LABELS[role]}»`}
                                  title="Открыть все"
                                >
                                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => toggleGroup(role, group.key, false)}
                                  className="rounded p-0.5 text-destructive hover:bg-destructive/10"
                                  aria-label={`Закрыть все разделы группы «${group.title}» для роли «${ROLE_LABELS[role]}»`}
                                  title="Закрыть все"
                                >
                                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                                </button>
                              </div>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {items.map((section) => (
                          <tr key={section.key} className="hover:bg-muted/40">
                            <th scope="row" className="px-4 py-2.5 text-left font-medium text-foreground">
                              {section.title}
                              <span className="ml-2 font-mono text-[10px] font-normal text-muted-foreground">
                                {section.key}
                              </span>
                            </th>
                            {ROLES.map((role) => {
                              const applicable = isApplicable(section, role);
                              const locked = isSectionLocked(section.key, role);
                              const checked = !!current[role]?.[section.key];
                              const changed = draft && draft[role]?.[section.key] !== saved[role]?.[section.key];
                              return (
                                <td
                                  key={role}
                                  className={cn('px-3 py-2.5 text-center', changed && 'bg-warning/10')}
                                >
                                  {!applicable ? (
                                    <span className="text-muted-foreground" title="Роль не подходит для этого раздела">—</span>
                                  ) : locked ? (
                                    <span
                                      className="inline-flex items-center gap-1 text-success"
                                      title="Раздел нельзя закрыть: иначе права будет не вернуть"
                                    >
                                      <Check className="h-4 w-4" aria-hidden="true" />
                                      <Lock className="h-3 w-3" aria-hidden="true" />
                                      <span className="sr-only">Всегда открыт</span>
                                    </span>
                                  ) : (
                                    <Checkbox
                                      checked={checked}
                                      onCheckedChange={() => toggle(role, section.key)}
                                      aria-label={`${section.title} — ${ROLE_LABELS[role]}`}
                                    />
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              );
            })
          )}
        </div>
      )}
    </PageContainer>
  );
}
