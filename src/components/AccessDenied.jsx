import React from 'react';
import { Link } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth, ROLE_LABELS } from '@/lib/AuthContext';
import { SECTION_BY_KEY } from '@/lib/sections';

/**
 * Отказ в доступе. Причин две, и они разные для человека:
 *   • роль просто не подходит для раздела — тут ничего не сделать;
 *   • раздел выключен администратором для этой роли — это настройка, и её можно
 *     попросить изменить.
 * Раньше показывался один и тот же текст про роли, из-за чего во втором случае
 * человек шёл выяснять «почему мне не дали роль», хотя роль была правильная.
 */
export default function AccessDenied({ requiredRoles, section }) {
  const { roleLabel } = useAuth();
  const list = (Array.isArray(requiredRoles) ? requiredRoles : [requiredRoles])
    .filter(Boolean)
    .map((r) => ROLE_LABELS[r] || r)
    .join(', ');

  const sectionTitle = section ? SECTION_BY_KEY[section]?.title || section : null;

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="w-full max-w-md text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-accent">
          <ShieldAlert className="h-7 w-7 text-primary" aria-hidden="true" />
        </div>
        <h1 className="mb-2 text-xl font-semibold text-foreground">Раздел недоступен</h1>

        {sectionTitle ? (
          <p className="mb-1 text-sm text-muted-foreground">
            Раздел <span className="font-medium text-foreground">«{sectionTitle}»</span> закрыт
            для вашей роли в настройках прав доступа.
          </p>
        ) : (
          <p className="mb-1 text-sm text-muted-foreground">
            Раздел доступен ролям: <span className="font-medium text-foreground">{list || '—'}</span>.
          </p>
        )}

        <p className="mb-6 text-sm text-muted-foreground">
          Ваша текущая роль: <span className="font-medium text-foreground">{roleLabel || 'не определена'}</span>.
          {sectionTitle && ' Доступ открывает администратор портала.'}
        </p>
        <Button asChild>
          <Link to="/cabinet">Вернуться в личный кабинет</Link>
        </Button>
      </div>
    </div>
  );
}
