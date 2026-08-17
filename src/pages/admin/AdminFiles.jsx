import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Upload, Search, Download, Trash2, FileText, Image as ImageIcon, Film, Archive,
  File as FileIcon, FolderOpen, ChevronLeft, ChevronRight, LayoutGrid,
} from 'lucide-react';
import { api } from '@/api/client';
import PageContainer from '@/components/common/PageContainer';
import EmptyState from '@/components/common/EmptyState';
import ErrorState from '@/components/common/ErrorState';
import StatusBadge from '@/components/common/StatusBadge';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/lib/AuthContext';
import { formatDate, formatFileSize, formatNumber, pluralize } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * Файловый менеджер администратора.
 * Аудит: в живом меню пункт «Файлы» показывал заглушку «Модуль в разработке»,
 * хотя личный раздел /cabinet/files давно работал. Здесь — общий список файлов
 * портала с серверной пагинацией (.page), поиском, фильтром по категории,
 * загрузкой и удалением с подтверждением.
 */

const PAGE_SIZE = 25;

const CATEGORIES = [
  { key: 'document', label: 'Документы', icon: FileText },
  { key: 'image', label: 'Изображения', icon: ImageIcon },
  { key: 'video', label: 'Видео', icon: Film },
  { key: 'archive', label: 'Архивы', icon: Archive },
  { key: 'other', label: 'Прочее', icon: FileIcon },
];

const CATEGORY_ICON = {
  document: FileText,
  image: ImageIcon,
  video: Film,
  archive: Archive,
  other: FileIcon,
};

const CATEGORY_LABEL = {
  document: 'Документ',
  image: 'Изображение',
  video: 'Видео',
  archive: 'Архив',
  other: 'Прочее',
};

/** Категория по расширению — то же правило, что в личном разделе файлов. */
function detectCategory(filename = '') {
  const ext = filename.split('.').pop()?.toLowerCase();
  if (['pdf', 'doc', 'docx', 'txt', 'rtf', 'xls', 'xlsx', 'ppt', 'pptx', 'csv'].includes(ext)) return 'document';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) return 'image';
  if (['mp4', 'avi', 'mov', 'webm', 'mkv'].includes(ext)) return 'video';
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return 'archive';
  return 'other';
}

function TableSkeleton() {
  return (
    <div className="p-4 space-y-2" aria-hidden="true">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="h-12 rounded bg-muted animate-pulse" />
      ))}
    </div>
  );
}

export default function AdminFiles() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const fileInputRef = useRef(null);

  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [page, setPage] = useState(1);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [uploading, setUploading] = useState(false);

  // Поиск с задержкой: страница не дёргает сервер на каждый символ.
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchDraft.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(timer);
  }, [searchDraft]);

  const baseWhere = useMemo(() => {
    const where = {};
    if (search) where.filename = { ilike: `%${search}%` };
    return where;
  }, [search]);

  const where = useMemo(
    () => (category === 'all' ? baseWhere : { ...baseWhere, category }),
    [baseWhere, category]
  );

  const {
    data: pageData,
    isLoading,
    error,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ['admin-files', search, category, page],
    queryFn: () =>
      api.entities.UserFile.page({ where, sort: '-upload_date', page, pageSize: PAGE_SIZE }),
    placeholderData: (prev) => prev,
  });

  // Счётчики для чипов считает сервер (count), а не длина текущей страницы.
  const { data: counts } = useQuery({
    queryKey: ['admin-files-counts', search],
    queryFn: async () => {
      const [total, ...byCategory] = await Promise.all([
        api.entities.UserFile.count(baseWhere),
        ...CATEGORIES.map((c) => api.entities.UserFile.count({ ...baseWhere, category: c.key })),
      ]);
      const map = { all: total };
      CATEGORIES.forEach((c, i) => {
        map[c.key] = byCategory[i];
      });
      return map;
    },
  });

  // Владельцы файлов: user_files хранит только user_id (профили доступны роли HR).
  const { data: profiles } = useQuery({
    queryKey: ['admin-files-owners'],
    queryFn: () => api.entities.User.list('full_name', 1000),
  });

  const ownerById = useMemo(() => {
    const map = new Map();
    (profiles || []).forEach((p) => map.set(p.id, p.full_name || p.email));
    return map;
  }, [profiles]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['admin-files'] });
    qc.invalidateQueries({ queryKey: ['admin-files-counts'] });
    qc.invalidateQueries({ queryKey: ['files'] });
  };

  const upload = useMutation({
    mutationFn: async (file) => {
      const { file_url, path } = await api.storage.upload({ file, folder: 'admin-files' });
      return api.entities.UserFile.create({
        user_id: user.id,
        filename: file.name,
        file_url,
        file_path: path,
        file_type: file.type || 'application/octet-stream',
        size: file.size,
        category: detectCategory(file.name),
        upload_date: formatDate(new Date(), 'iso'),
      });
    },
    onMutate: () => setUploading(true),
    onSettled: () => setUploading(false),
    onSuccess: (created) => {
      toast({ title: 'Файл загружен', description: created?.filename });
      setPage(1);
      invalidate();
    },
    onError: (err) => toast({ title: 'Не удалось загрузить файл', description: err?.message, variant: 'destructive' }),
  });

  const remove = useMutation({
    mutationFn: async (file) => {
      await api.entities.UserFile.delete(file.id);
      // Сам объект в хранилище удаляем следом; если его уже нет — запись всё равно снята.
      if (file.file_path) await api.storage.remove(file.file_path).catch(() => {});
      return true;
    },
    onSuccess: () => {
      setPendingDelete(null);
      toast({ title: 'Файл удалён' });
      invalidate();
    },
    onError: (err) => toast({ title: 'Не удалось удалить файл', description: err?.message, variant: 'destructive' }),
  });

  const rows = pageData?.rows || [];
  const total = pageData?.total || 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <PageContainer
      title="Файлы портала"
      description="Все загруженные файлы сотрудников: поиск, фильтр по категории, загрузка и удаление."
      width="wide"
      actions={
        <>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            aria-hidden="true"
            tabIndex={-1}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) upload.mutate(file);
              e.target.value = '';
            }}
          />
          <Button onClick={() => fileInputRef.current?.click()} disabled={uploading}>
            <Upload className="w-4 h-4" aria-hidden="true" />
            {uploading ? 'Загрузка…' : 'Загрузить файл'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col lg:flex-row lg:items-center gap-3 mb-4">
        <div className="relative w-full lg:max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
          <label htmlFor="admin-files-search" className="sr-only">
            Поиск по имени файла
          </label>
          <Input
            id="admin-files-search"
            type="search"
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            placeholder="Поиск по имени файла"
            className="pl-9 min-h-[40px]"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Фильтр по категории">
          <Button
            size="sm"
            variant={category === 'all' ? 'default' : 'outline'}
            onClick={() => {
              setCategory('all');
              setPage(1);
            }}
            aria-pressed={category === 'all'}
            className="min-h-[40px]"
          >
            <LayoutGrid className="w-3.5 h-3.5" aria-hidden="true" />
            Все ({formatNumber(counts?.all ?? 0)})
          </Button>
          {CATEGORIES.map((c) => {
            const Icon = c.icon;
            return (
              <Button
                key={c.key}
                size="sm"
                variant={category === c.key ? 'default' : 'outline'}
                onClick={() => {
                  setCategory(c.key);
                  setPage(1);
                }}
                aria-pressed={category === c.key}
                className="min-h-[40px]"
              >
                <Icon className="w-3.5 h-3.5" aria-hidden="true" />
                {c.label} ({formatNumber(counts?.[c.key] ?? 0)})
              </Button>
            );
          })}
        </div>
      </div>

      <Card className={cn('overflow-hidden', isFetching && !isLoading && 'opacity-70 transition-opacity')}>
        {error ? (
          <div className="p-4">
            <ErrorState error={error} onRetry={refetch} />
          </div>
        ) : isLoading ? (
          <TableSkeleton />
        ) : rows.length === 0 ? (
          <div className="p-4">
            <EmptyState
              icon={FolderOpen}
              title={search || category !== 'all' ? 'Ничего не найдено' : 'Файлов пока нет'}
              description={
                search || category !== 'all'
                  ? 'Измените запрос или снимите фильтр по категории.'
                  : 'Загрузите первый файл — он появится в этом списке и станет доступен по прямой ссылке.'
              }
              actionLabel={search || category !== 'all' ? 'Сбросить фильтры' : 'Загрузить файл'}
              onAction={() => {
                if (search || category !== 'all') {
                  setSearchDraft('');
                  setCategory('all');
                  setPage(1);
                } else {
                  fileInputRef.current?.click();
                }
              }}
            />
          </div>
        ) : (
          <div className="table-scroll">
            <table className="w-full text-sm">
              <caption className="sr-only">Файлы портала</caption>
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th scope="col" className="px-4 py-3 font-medium">Файл</th>
                  <th scope="col" className="px-4 py-3 font-medium">Категория</th>
                  <th scope="col" className="px-4 py-3 font-medium">Размер</th>
                  <th scope="col" className="px-4 py-3 font-medium">Владелец</th>
                  <th scope="col" className="px-4 py-3 font-medium">Загружен</th>
                  <th scope="col" className="px-4 py-3 font-medium table-sticky-actions text-right">Действия</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((file) => {
                  const Icon = CATEGORY_ICON[file.category] || FileIcon;
                  return (
                    <tr key={file.id} className="border-b border-border last:border-0 hover:bg-accent/40">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2 min-w-0">
                          <Icon className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden="true" />
                          <span className="font-medium text-foreground truncate max-w-[280px]" title={file.filename}>
                            {file.filename}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge value={file.category} fallback={CATEGORY_LABEL[file.category] || 'Прочее'} />
                      </td>
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                        {formatFileSize(file.size)}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground truncate max-w-[200px]">
                        {ownerById.get(file.user_id) || '—'}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                        {formatDate(file.upload_date)}
                      </td>
                      <td className="px-4 py-3 table-sticky-actions">
                        <div className="flex items-center justify-end gap-1">
                          {file.file_url && (
                            <Button size="icon" variant="ghost" asChild aria-label={`Скачать файл ${file.filename}`}>
                              <a href={file.file_url} target="_blank" rel="noreferrer" download>
                                <Download className="w-4 h-4" aria-hidden="true" />
                              </a>
                            </Button>
                          )}
                          <Button
                            size="icon"
                            variant="ghost"
                            className="text-muted-foreground hover:text-destructive"
                            aria-label={`Удалить файл ${file.filename}`}
                            onClick={() => setPendingDelete(file)}
                          >
                            <Trash2 className="w-4 h-4" aria-hidden="true" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {!error && !isLoading && rows.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 mt-4">
          {/* «из 1 файла», «из 5 файлов» — формы согласуются через pluralize (BUG-075/077) */}
          <p className="text-sm text-muted-foreground" aria-live="polite">
            Показаны {formatNumber((page - 1) * PAGE_SIZE + 1)}–{formatNumber((page - 1) * PAGE_SIZE + rows.length)} из{' '}
            {pluralize(total, 'файла', 'файлов', 'файлов')}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="min-h-[40px]"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || isFetching}
              aria-label="Предыдущая страница"
            >
              <ChevronLeft className="w-4 h-4" aria-hidden="true" />
              Назад
            </Button>
            <span className="text-sm text-muted-foreground">
              Страница {formatNumber(page)} из {formatNumber(pageCount)}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="min-h-[40px]"
              onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              disabled={page >= pageCount || isFetching}
              aria-label="Следующая страница"
            >
              Вперёд
              <ChevronRight className="w-4 h-4" aria-hidden="true" />
            </Button>
          </div>
        </div>
      )}

      {/* BUG-072: подтверждение удаления с явной кнопкой «Отмена». */}
      <Dialog open={!!pendingDelete} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Удалить файл?</DialogTitle>
            <DialogDescription>
              Файл «{pendingDelete?.filename}» ({formatFileSize(pendingDelete?.size)}) будет удалён из
              хранилища портала. Ссылки на него перестанут работать. Действие нельзя отменить.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setPendingDelete(null)}>
              Отмена
            </Button>
            <Button
              variant="destructive"
              onClick={() => remove.mutate(pendingDelete)}
              disabled={remove.isPending}
            >
              {remove.isPending ? 'Удаление…' : 'Удалить'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
