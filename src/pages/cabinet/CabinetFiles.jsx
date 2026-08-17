import React, { useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Upload, FileText, Image as ImageIcon, Film, Archive, File, Download, Trash2, Search, FolderOpen,
} from 'lucide-react';
import PageContainer from '@/components/common/PageContainer';
import EmptyState from '@/components/common/EmptyState';
import ErrorState from '@/components/common/ErrorState';
import StatusBadge from '@/components/common/StatusBadge';
import FilterChips from '@/components/common/FilterChips';
import { useToast } from '@/components/ui/use-toast';
import { useCurrentEmployee } from '@/lib/useCurrentEmployee';
import { formatDate, formatFileSize, pluralize } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * Личные файлы сотрудника.
 *
 * Загрузка идёт напрямую в Supabase Storage через api.storage.upload
 * (файлы лежат в Supabase Storage).
 * «0 файлов · —» — висячий плейсхолдер, убран: пустое состояние показывает EmptyState.
 * Размеры — formatFileSize, даты — formatDate, категории — StatusBadge (BUG-053, BUG-051).
 * Ошибка загрузки видна пользователю: тост + ErrorState, лимит 25 МБ объяснён текстом.
 */

const ALL = 'all';
const MAX_SIZE = 25 * 1024 * 1024; // лимит бакета portal-files — 25 МБ

const CATEGORY_CONFIG = {
  document: { label: 'Документы', icon: FileText, tone: 'bg-info/10 text-info' },
  image: { label: 'Изображения', icon: ImageIcon, tone: 'bg-success/10 text-success' },
  video: { label: 'Видео', icon: Film, tone: 'bg-accent text-accent-foreground' },
  archive: { label: 'Архивы', icon: Archive, tone: 'bg-warning/10 text-warning' },
  other: { label: 'Прочее', icon: File, tone: 'bg-muted text-muted-foreground' },
};

function detectCategory(filename = '') {
  const ext = filename.split('.').pop()?.toLowerCase();
  if (['pdf', 'doc', 'docx', 'txt', 'csv', 'xls', 'xlsx', 'ppt', 'pptx'].includes(ext)) return 'document';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext)) return 'image';
  if (['mp4', 'avi', 'mov', 'webm'].includes(ext)) return 'video';
  if (['zip', 'rar', '7z', 'tar'].includes(ext)) return 'archive';
  return 'other';
}

function SkeletonList() {
  return (
    <div className="space-y-2" aria-hidden="true">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="h-16 animate-pulse rounded-xl bg-muted" />
      ))}
    </div>
  );
}

export default function CabinetFiles() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const fileRef = useRef(null);
  const { me } = useCurrentEmployee();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState(ALL);
  const [progress, setProgress] = useState(0);
  const [uploadError, setUploadError] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);

  const filesQuery = useQuery({
    queryKey: ['files', me?.id],
    queryFn: () => api.entities.UserFile.filter({ user_id: me?.id }, '-upload_date'),
    enabled: !!me?.id,
  });

  const upload = useMutation({
    mutationFn: async (file) => {
      setUploadError(null);
      setProgress(10);
      // Загрузка напрямую в storage, минуя устаревшую обёртку интеграций.
      const { file_url, path } = await api.storage.upload({ file, folder: 'user-files' });
      setProgress(70);
      const row = await api.entities.UserFile.create({
        user_id: me?.id,
        filename: file.name,
        file_url,
        file_path: path,
        file_type: file.type || 'application/octet-stream',
        size: file.size,
        category: detectCategory(file.name),
      });
      setProgress(100);
      return row;
    },
    onSuccess: (row) => {
      toast({ title: 'Файл загружен', description: `«${row.filename}» · ${formatFileSize(row.size)}` });
      qc.invalidateQueries({ queryKey: ['files', me?.id] });
      setProgress(0);
    },
    onError: (error) => {
      setUploadError(error);
      setProgress(0);
      toast({
        title: 'Не удалось загрузить файл',
        description: error?.message || 'Проверьте формат и размер файла и попробуйте снова.',
        variant: 'destructive',
      });
    },
  });

  const remove = useMutation({
    mutationFn: async (file) => {
      await api.entities.UserFile.delete(file.id);
      // Файл в хранилище удаляем следом; если объекта уже нет — операция не критична.
      if (file.file_path) await api.storage.remove(file.file_path).catch(() => null);
      return true;
    },
    onSuccess: () => {
      toast({ title: 'Файл удалён' });
      setPendingDelete(null);
      qc.invalidateQueries({ queryKey: ['files', me?.id] });
    },
    onError: (error) => {
      toast({
        title: 'Не удалось удалить файл',
        description: error?.message || 'Попробуйте ещё раз.',
        variant: 'destructive',
      });
    },
  });

  function handlePick(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > MAX_SIZE) {
      const message = `Файл «${file.name}» весит ${formatFileSize(file.size)}. Максимальный размер — ${formatFileSize(MAX_SIZE)}.`;
      setUploadError({ message });
      toast({ title: 'Файл слишком большой', description: message, variant: 'destructive' });
      return;
    }
    upload.mutate(file);
  }

  const files = filesQuery.data || [];

  const options = useMemo(() => {
    const counts = files.reduce((acc, f) => {
      const key = CATEGORY_CONFIG[f.category] ? f.category : 'other';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    return [
      { value: ALL, label: 'Все', count: files.length },
      ...Object.entries(CATEGORY_CONFIG)
        .filter(([key]) => counts[key])
        .map(([key, cfg]) => ({ value: key, label: cfg.label, count: counts[key], icon: cfg.icon })),
    ];
  }, [files]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return files.filter((f) => {
      const matchesCategory = category === ALL || (CATEGORY_CONFIG[f.category] ? f.category : 'other') === category;
      const matchesSearch = !q || f.filename?.toLowerCase().includes(q);
      return matchesCategory && matchesSearch;
    });
  }, [files, search, category]);

  const totalSize = files.reduce((sum, f) => sum + (Number(f.size) || 0), 0);

  return (
    <PageContainer
      title="Файлы"
      // Висячего «0 файлов · —» больше нет: подпись появляется, только когда файлы есть.
      description={
        files.length
          ? `${pluralize(files.length, 'файл', 'файла', 'файлов')} · ${formatFileSize(totalSize)}`
          : 'Личное хранилище: документы, изображения и архивы'
      }
      actions={
        <>
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            onChange={handlePick}
            aria-hidden="true"
            tabIndex={-1}
          />
          <Button
            className="min-h-[40px]"
            onClick={() => fileRef.current?.click()}
            disabled={upload.isPending || !me?.id}
            aria-label="Загрузить файл"
          >
            <Upload className="h-4 w-4" aria-hidden="true" />
            {upload.isPending ? 'Загрузка…' : 'Загрузить файл'}
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        {upload.isPending && (
          <Card className="p-4">
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="text-foreground">Загружаем файл…</span>
              <span className="tabular-nums text-muted-foreground">{progress}%</span>
            </div>
            <Progress value={progress} aria-label="Прогресс загрузки файла" />
          </Card>
        )}

        {uploadError && !upload.isPending && (
          <ErrorState
            error={uploadError}
            title="Файл не загружен"
            compact
            onRetry={() => {
              setUploadError(null);
              fileRef.current?.click();
            }}
          />
        )}

        {filesQuery.error ? (
          <ErrorState error={filesQuery.error} onRetry={filesQuery.refetch} />
        ) : filesQuery.isPending ? (
          <SkeletonList />
        ) : !files.length ? (
          <EmptyState
            icon={FolderOpen}
            title="Файлов пока нет"
            description={`Загрузите документы, изображения или архивы — до ${formatFileSize(MAX_SIZE)} на файл.`}
            actionLabel="Загрузить файл"
            onAction={() => fileRef.current?.click()}
          />
        ) : (
          <>
            <div className="flex flex-col gap-4 md:flex-row md:items-center">
              <div className="relative w-full max-w-md">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Поиск по имени файла"
                  aria-label="Поиск файлов"
                  className="min-h-[40px] pl-9"
                />
              </div>
            </div>

            <FilterChips options={options} value={category} onChange={setCategory} ariaLabel="Фильтр файлов по категории" />

            {!filtered.length ? (
              <EmptyState
                icon={Search}
                compact
                title="Файлы не найдены"
                description="Измените запрос или снимите фильтр по категории."
                actionLabel="Сбросить фильтры"
                onAction={() => {
                  setSearch('');
                  setCategory(ALL);
                }}
              />
            ) : (
              <ul role="list" className="space-y-2">
                {filtered.map((file) => {
                  const cfg = CATEGORY_CONFIG[file.category] || CATEGORY_CONFIG.other;
                  const Icon = cfg.icon;
                  return (
                    <li key={file.id} role="listitem">
                      <Card className="flex flex-wrap items-center gap-3 p-3">
                        <div
                          className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-lg', cfg.tone)}
                          aria-hidden="true"
                        >
                          <Icon className="h-5 w-5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium text-foreground">{file.filename}</div>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            <StatusBadge value={file.category} fallback={cfg.label} />
                            <span className="whitespace-nowrap">{formatFileSize(file.size)}</span>
                            <span className="whitespace-nowrap">{formatDate(file.upload_date)}</span>
                          </div>
                        </div>
                        {file.file_url && (
                          <Button
                            asChild
                            size="icon"
                            variant="ghost"
                            aria-label={`Скачать файл «${file.filename}»`}
                          >
                            <a href={file.file_url} target="_blank" rel="noreferrer" download>
                              <Download className="h-4 w-4" aria-hidden="true" />
                            </a>
                          </Button>
                        )}
                        <Button
                          size="icon"
                          variant="ghost"
                          className="text-muted-foreground hover:text-destructive"
                          aria-label={`Удалить файл «${file.filename}»`}
                          onClick={() => setPendingDelete(file)}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </Card>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </div>

      {/* BUG-072: удаление подтверждается диалогом с явной кнопкой «Отмена» */}
      <Dialog open={!!pendingDelete} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Удалить файл?</DialogTitle>
            <DialogDescription>
              {pendingDelete
                ? `Файл «${pendingDelete.filename}» (${formatFileSize(pendingDelete.size)}) будет удалён безвозвратно.`
                : ''}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              className="min-h-[40px]"
              onClick={() => setPendingDelete(null)}
              disabled={remove.isPending}
            >
              Отмена
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="min-h-[40px]"
              disabled={remove.isPending}
              onClick={() => pendingDelete && remove.mutate(pendingDelete)}
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              {remove.isPending ? 'Удаляем…' : 'Удалить'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
