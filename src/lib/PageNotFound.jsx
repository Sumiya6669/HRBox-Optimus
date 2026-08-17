import React from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import { FileQuestion, Home, ArrowLeft, Search } from 'lucide-react';
import PageContainer from '@/components/common/PageContainer';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

/**
 * Единственная страница 404 портала (BUG-066).
 * Раньше их было две: глобальная — на serif-шрифте, вне layout, с потерей навигации
 * и служебной запиской «AI ещё не реализовал эту страницу». Теперь это обычная
 * страница портала: та же типографика, тот же PageContainer, меню и шапка на месте.
 */
export default function PageNotFound() {
  const location = useLocation();
  const navigate = useNavigate();
  const requestedPath = `${location.pathname}${location.search}`;

  return (
    <PageContainer
      title="Страница не найдена"
      description="Такого раздела нет на портале — возможно, ссылка устарела или в адресе опечатка."
      width="narrow"
    >
      <Card className="p-8 text-center">
        <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
          <FileQuestion className="w-6 h-6 text-muted-foreground" aria-hidden="true" />
        </div>

        <p className="text-sm text-muted-foreground mb-1">Запрошенный адрес</p>
        {/* React экранирует значение — путь из адресной строки выводить безопасно. */}
        <p className="font-mono text-sm text-foreground break-all mb-6">{requestedPath}</p>

        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button asChild>
            <Link to="/">
              <Home className="w-4 h-4" aria-hidden="true" />
              На главную
            </Link>
          </Button>
          <Button variant="outline" onClick={() => navigate(-1)}>
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
            Назад
          </Button>
          <Button variant="ghost" asChild>
            <Link to="/search">
              <Search className="w-4 h-4" aria-hidden="true" />
              Поиск по порталу
            </Link>
          </Button>
        </div>
      </Card>
    </PageContainer>
  );
}
