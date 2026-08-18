import React, { useRef, useState } from 'react';
import { UploadCloud, Loader2, Trash2, AlertCircle, Video, FileText } from 'lucide-react';

import { api } from '@/api/client';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatFileSize } from '@/lib/format';

/**
 * Загрузка видеоурока или документа ФАЙЛОМ, а не ссылкой.
 *
 * Ссылка на внешний ролик — это чужая инфраструктура: видео переименуют,
 * закроют доступ или удалят, и обязательный курс молча перестанет открываться.
 * Поэтому файл лежит в хранилище портала, а поле ссылки оставлено как запасной
 * вариант для случаев, когда видео действительно хостится снаружи.
 *
 * Загрузка идёт в отдельный бакет course-media: у общего portal-files лимит
 * 25 МБ и нет видеоформатов в списке разрешённых типов.
 */
export default function MediaUpload({
  value,          // текущий URL
  path,           // путь в хранилище, если файл загружали через портал
  onChange,       // ({ url, path }) => void
  label = 'Материал урока',
  accept = 'video/mp4,video/webm,video/quicktime,application/pdf',
  folder = 'lessons',
  hint,
  disabled = false,
  id,
}) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [fileName, setFileName] = useState(null);

  const fieldId = id || 'media-upload';

  const upload = async (file) => {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const previousPath = path;
      const { file_url, path: newPath } = await api.storage.uploadVideo({ file, folder });
      setFileName(file.name);
      onChange?.({ url: file_url, path: newPath });
      // Старый файл убираем ПОСЛЕ успешной загрузки нового: если удалить
      // раньше и загрузка сорвётся, урок останется вообще без материала.
      if (previousPath) await api.storage.removeMedia(previousPath).catch(() => {});
    } catch (e) {
      setError(e?.message || 'Не удалось загрузить файл');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const clear = async () => {
    const previousPath = path;
    onChange?.({ url: '', path: '' });
    setFileName(null);
    if (previousPath) await api.storage.removeMedia(previousPath).catch(() => {});
  };

  const isVideo = /\.(mp4|webm|mov|ogg)(\?|$)/i.test(value || '');

  return (
    <div className="space-y-2">
      <Label htmlFor={fieldId}>{label}</Label>

      {value ? (
        <div className="space-y-2">
          {isVideo ? (
            <video src={value} controls className="max-h-64 w-full rounded-lg bg-black" />
          ) : (
            <div className="flex items-center gap-2 rounded-lg border border-border p-3 text-sm">
              <FileText className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
              <a href={value} target="_blank" rel="noreferrer" className="truncate text-primary underline">
                {fileName || 'Открыть материал'}
              </a>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()} disabled={disabled || busy}>
              <UploadCloud className="mr-1 h-4 w-4" aria-hidden="true" /> Заменить файл
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={clear} disabled={disabled || busy}>
              <Trash2 className="mr-1 h-4 w-4" aria-hidden="true" /> Убрать
            </Button>
          </div>
        </div>
      ) : (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); upload(e.dataTransfer.files?.[0]); }}
          className={cn(
            'flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 text-center transition-colors',
            dragging ? 'border-primary bg-accent' : 'border-border'
          )}
        >
          {busy ? (
            <>
              <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden="true" />
              <p className="text-sm text-muted-foreground">
                Загружаю файл. Большое видео может идти несколько минут — не закрывайте страницу.
              </p>
            </>
          ) : (
            <>
              <Video className="h-8 w-8 text-muted-foreground/60" aria-hidden="true" />
              <p className="text-sm text-foreground">Перетащите файл сюда или</p>
              <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()} disabled={disabled}>
                <UploadCloud className="mr-1 h-4 w-4" aria-hidden="true" /> Выбрать файл
              </Button>
              <p className="text-xs text-muted-foreground">
                MP4, WebM, MOV или PDF, до {formatFileSize(500 * 1024 * 1024)}
              </p>
            </>
          )}
        </div>
      )}

      <input
        ref={inputRef}
        id={fieldId}
        type="file"
        accept={accept}
        className="sr-only"
        onChange={(e) => upload(e.target.files?.[0])}
        disabled={disabled || busy}
      />

      {/* Запасной вариант — внешняя ссылка. */}
      <div>
        <Label htmlFor={`${fieldId}-url`} className="text-xs text-muted-foreground">
          …или ссылка на внешний материал
        </Label>
        <Input
          id={`${fieldId}-url`}
          className="mt-1 min-h-[40px]"
          value={value || ''}
          onChange={(e) => onChange?.({ url: e.target.value, path: '' })}
          placeholder="https://…"
          disabled={disabled || busy}
        />
      </div>

      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && (
        <p role="alert" className="flex items-center gap-1 text-xs text-destructive">
          <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" /> {error}
        </p>
      )}
    </div>
  );
}
