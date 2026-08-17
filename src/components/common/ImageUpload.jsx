import React, { useCallback, useRef, useState } from 'react';
import { ImagePlus, Loader2, Trash2, AlertCircle, Link2 } from 'lucide-react';

import { api } from '@/api/client';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatFileSize } from '@/lib/format';

/**
 * Загрузка изображения файлом вместо ссылки.
 *
 * Раньше обложки новостей, книг, событий и фото сотрудников задавались вводом URL:
 * это требовало где-то отдельно разместить картинку и давало битые изображения,
 * как только внешний адрес переставал отвечать. Теперь файл кладётся в Supabase
 * Storage, а рядом с `*_url` хранится `*_path` — чтобы при замене или удалении
 * убрать и сам объект из бакета.
 *
 * @param {string}   value      текущий URL изображения
 * @param {string}   path       путь текущего объекта в Storage (если он оттуда)
 * @param {function} onChange   ({ url, path }) => void
 * @param {string}   folder     папка в бакете
 * @param {string}   label
 * @param {string}   hint
 * @param {'wide'|'square'|'avatar'} aspect  пропорции превью
 * @param {boolean}  allowUrl   показать поле «или вставьте ссылку»
 * @param {number}   maxBytes
 */
export default function ImageUpload({
  value,
  path,
  onChange,
  folder = 'images',
  label = 'Изображение',
  hint,
  aspect = 'wide',
  allowUrl = false,
  maxBytes = 5 * 1024 * 1024,
  disabled = false,
  id,
  className,
}) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [urlMode, setUrlMode] = useState(false);
  const [urlDraft, setUrlDraft] = useState('');

  const fieldId = id || `image-upload-${label.replace(/\s+/g, '-').toLowerCase()}`;

  const upload = useCallback(
    async (file) => {
      if (!file) return;
      setError(null);
      setBusy(true);
      try {
        const previousPath = path;
        const { file_url, path: newPath } = await api.storage.uploadImage({ file, folder, maxBytes });
        onChange?.({ url: file_url, path: newPath });
        // Старый файл убираем только после успешной загрузки нового.
        if (previousPath && previousPath !== newPath) {
          api.storage.remove(previousPath).catch(() => {});
        }
      } catch (e) {
        setError(e?.message || 'Не удалось загрузить изображение');
      } finally {
        setBusy(false);
      }
    },
    [folder, maxBytes, onChange, path]
  );

  const onDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    if (disabled || busy) return;
    const file = e.dataTransfer?.files?.[0];
    if (file) upload(file);
  };

  const clear = () => {
    setError(null);
    if (path) api.storage.remove(path).catch(() => {});
    onChange?.({ url: '', path: '' });
  };

  const applyUrl = () => {
    const trimmed = urlDraft.trim();
    if (!trimmed) return;
    onChange?.({ url: trimmed, path: '' });
    setUrlDraft('');
    setUrlMode(false);
  };

  const previewClass =
    aspect === 'avatar'
      ? 'w-24 h-24 rounded-full'
      : aspect === 'square'
        ? 'w-32 h-32 rounded-lg'
        : 'w-full aspect-[16/9] rounded-lg';

  return (
    <div className={cn('space-y-2', className)}>
      <Label htmlFor={fieldId}>{label}</Label>

      {value ? (
        <div className="flex items-start gap-3">
          <img
            src={value}
            alt=""
            className={cn('object-cover border border-border bg-muted shrink-0', previewClass)}
            onError={(e) => {
              e.currentTarget.style.opacity = '0.35';
            }}
          />
          <div className="flex flex-col gap-2 min-w-0">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled || busy}
              onClick={() => inputRef.current?.click()}
            >
              {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" /> : <ImagePlus className="w-4 h-4 mr-2" aria-hidden="true" />}
              Заменить
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled || busy}
              onClick={clear}
              className="text-destructive hover:text-destructive"
            >
              <Trash2 className="w-4 h-4 mr-2" aria-hidden="true" />
              Удалить
            </Button>
          </div>
        </div>
      ) : (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn(
            'rounded-lg border border-dashed transition',
            dragging ? 'border-primary bg-accent' : 'border-border bg-card/50',
            aspect === 'wide' ? 'p-6' : 'p-4'
          )}
        >
          <div className="flex flex-col items-center text-center gap-2">
            <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
              <ImagePlus className="w-5 h-5 text-muted-foreground" aria-hidden="true" />
            </div>
            <p className="text-sm text-foreground">Перетащите файл сюда или выберите на диске</p>
            <p className="text-xs text-muted-foreground">
              PNG, JPEG, WebP или SVG, до {formatFileSize(maxBytes)}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-1"
              disabled={disabled || busy}
              onClick={() => inputRef.current?.click()}
            >
              {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" /> : null}
              {busy ? 'Загрузка…' : 'Выбрать файл'}
            </Button>

            {allowUrl && !urlMode && (
              <button
                type="button"
                className="text-xs text-muted-foreground hover:text-foreground underline mt-1"
                onClick={() => setUrlMode(true)}
              >
                или вставить ссылку
              </button>
            )}
          </div>

          {allowUrl && urlMode && (
            <div className="flex gap-2 mt-3">
              <Input
                value={urlDraft}
                onChange={(e) => setUrlDraft(e.target.value)}
                placeholder="https://…"
                aria-label="Ссылка на изображение"
              />
              <Button type="button" variant="outline" size="sm" onClick={applyUrl}>
                <Link2 className="w-4 h-4 mr-1.5" aria-hidden="true" />
                Применить
              </Button>
            </div>
          )}
        </div>
      )}

      <input
        ref={inputRef}
        id={fieldId}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif"
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
