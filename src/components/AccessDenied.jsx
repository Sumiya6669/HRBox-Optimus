import React from 'react';
import { Link } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth, ROLE_LABELS } from '@/lib/AuthContext';

export default function AccessDenied({ requiredRoles }) {
  const { roleLabel } = useAuth();
  const list = (Array.isArray(requiredRoles) ? requiredRoles : [requiredRoles])
    .filter(Boolean)
    .map((r) => ROLE_LABELS[r] || r)
    .join(', ');

  return (
    <div className="min-h-[60vh] flex items-center justify-center p-6">
      <div className="max-w-md w-full text-center">
        <div className="mx-auto w-14 h-14 rounded-full bg-accent flex items-center justify-center mb-4">
          <ShieldAlert className="w-7 h-7 text-primary" aria-hidden="true" />
        </div>
        <h1 className="text-xl font-semibold text-foreground mb-2">Недостаточно прав</h1>
        <p className="text-sm text-muted-foreground mb-1">
          Раздел доступен ролям: <span className="font-medium text-foreground">{list || '—'}</span>.
        </p>
        <p className="text-sm text-muted-foreground mb-6">
          Ваша текущая роль: <span className="font-medium text-foreground">{roleLabel || 'не определена'}</span>.
        </p>
        <Button asChild>
          <Link to="/cabinet">Вернуться в личный кабинет</Link>
        </Button>
      </div>
    </div>
  );
}
