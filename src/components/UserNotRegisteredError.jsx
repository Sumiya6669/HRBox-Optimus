import React from 'react';
import { ShieldAlert, LogOut, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import OptimusLogo from '@/components/common/OptimusLogo';
import { useAuth } from '@/lib/AuthContext';

/**
 * Учётная запись прошла аутентификацию, но не привязана к порталу
 * (в profiles нет записи или она не связана с карточкой сотрудника).
 * Экран был на английском («Access Restricted») и без единого действия —
 * пользователь застревал на нём. Теперь это русскоязычный экран в стиле портала
 * с рабочей кнопкой выхода (BUG-006: logout действительно уничтожает сессию).
 */
export default function UserNotRegisteredError({ email }) {
  const { logout, user, session } = useAuth();
  const shownEmail = email || user?.auth_email || user?.email || session?.user?.email || null;

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4 py-10">
      <Card className="w-full max-w-md p-8 text-center">
        <OptimusLogo size={32} className="justify-center mb-6" />

        <div className="w-12 h-12 rounded-full bg-warning/15 flex items-center justify-center mx-auto mb-4">
          <ShieldAlert className="w-6 h-6 text-warning" aria-hidden="true" />
        </div>

        <h1 className="text-xl font-bold text-foreground mb-2">Доступ к порталу не открыт</h1>
        <p className="text-sm text-muted-foreground mb-6">
          Ваша учётная запись не привязана к порталу Optimus KZ. Чтобы получить доступ,
          обратитесь в HR-службу — там подтвердят вашу карточку сотрудника и выдадут права.
        </p>

        {shownEmail && (
          <p className="text-sm text-muted-foreground mb-6">
            Вход выполнен под адресом{' '}
            <span className="font-medium text-foreground break-all">{shownEmail}</span>
          </p>
        )}

        <div className="rounded-lg border border-border bg-muted/40 p-4 text-left text-sm text-muted-foreground mb-6">
          <p className="font-medium text-foreground mb-2">Что можно сделать</p>
          <ul className="list-disc list-inside space-y-1">
            <li>Проверить, что вы вошли под рабочим адресом почты</li>
            <li>Написать в HR-службу и попросить привязать учётную запись</li>
            <li>Выйти и войти заново после того, как доступ откроют</li>
          </ul>
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-2">
          <Button variant="outline" asChild className="w-full sm:w-auto">
            <a href="mailto:hr@optimus-kz.kz">
              <Mail className="w-4 h-4" aria-hidden="true" />
              Написать в HR
            </a>
          </Button>
          <Button onClick={() => logout()} className="w-full sm:w-auto">
            <LogOut className="w-4 h-4" aria-hidden="true" />
            Выйти
          </Button>
        </div>
      </Card>
    </div>
  );
}
