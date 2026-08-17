import React, { useRef, useState } from 'react';
import { Paperclip, Loader2, Trash2, AlertCircle, FileText } from 'lucide-react';

import { api } from '@/api/client';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { formatFileSize } from '@/lib/format';

/**
 * Загрузка произвольного файла (не изображения) — например, «Файл по результату
 * работы» в форме заявки процесса.
 */
export default function FileUpload({
  value,
  path,
  fileName,
  onChange,
  folder = 'attachments',
  label = 'Файл',
  hint,
  required = false,
  disabled = false,
  maxBytes = 25 * 1024 * 1024,
  id,
  className,
}) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [dragging, setDragging] = useState(false);

  const fieldId = id || `file-upload-${label.replace(/\s+/g, '-').toLowerCase()}`;

  const upload = async (file) => {
    if (!file) return;
    setError(null);
    if (file.size > maxBytes) {
      setError(`Файл слишком большой: ${formatFileSize(file.size)} при лимите ${formatFileSize(maxBytes)}`);
      return;
    }
    setBusy(true);
    try {
      const previousPath = path;
      const { file_url, path: newPath } = await api.storage.upload({ file, folder });
      onChange?.({ url: file_url, path: newPath, name: file.name, size: file.size });
      if (previousPath && previousPath !== newPath) {
        api.storage.remove(previousPath).catch(() => {});
      }
    } catch (e) {
      setError(e?.message || 'Не удалось загрузить файл');
    } finally {
      setBusy(false);
    }
  };

  const clear = () => {
    setError(null);
    if (path) api.storage.remove(path).catch(() => {});
    onChange?.({ url: '', path: '', name: '', size: 0 });
  };

  return (
    <div className={cn('space-y-2', className)}>
      <Label htmlFor={fieldId}>
        {label}
        {required && <span className="text-destructive ml-0.5" aria-hidden="true">*</span>}
      </Label>

      {value ? (
        <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-3">
          <FileText className="w-5 h-5 text-muted-foreground shrink-0" aria-hidden="true" />
          <a
            href={value}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-primary hover:underline truncate flex-1 min-w-0"
          >
            {fileName || 'Загруженный файл'}
          </a>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Удалить файл"
            disabled={disabled || busy}
            onClick={clear}
            className="text-destructive hover:text-destructive shrink-0"
          >
            <Trash2 className="w-4 h-4" aria-hidden="true" />
          </Button>
        </div>
      ) : (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (disabled || busy) return;
            const file = e.dataTransfer?.files?.[0];
            if (file) upload(file);
          }}
          className={cn(
            'rounded-lg border border-dashed p-4 transition',
            dragging ? 'border-primary bg-accent' : 'border-border bg-card/50'
          )}
        >
          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled || busy}
              onClick={() => inputRef.current?.click()}
            >
              {busy ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />
              ) : (
                <Paperclip className="w-4 h-4 mr-2" aria-hidden="true" />
              )}
              {busy ? 'Загрузка…' : 'Выбрать файл'}
            </Button>
            <span className="text-xs text-muted-foreground">
              или перетащите сюда, до {formatFileSize(maxBytes)}
            </span>
          </div>
        </div>
      )}

      <input
        ref={inputRef}
        id={fieldId}
        type="file"
        className="sr-only"
        disabled={disabled || busy}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) upload(file);
        }}
      />

      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && (
        <p role="alert" className="flex items-start gap-1.5 text-xs text-destructive">
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
          {error}
        </p>
      )}
    </div>
  );
}
