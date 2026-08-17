import React, { useId, useRef, useState } from 'react';
import { AlertCircle, ImagePlus, Loader2, Upload } from 'lucide-react';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Простое поле с markdown-подобной разметкой.
 *
 * Раньше здесь стоял react-quill: пакет удалён из package.json (WYSIWYG тянул за собой
 * innerHTML и собственные стили, а разметку всё равно разбирает наш парсер).
 * Теперь это обычная textarea с подсказкой по разметке — те же правила, что понимает
 * разборщик CMS-страниц в src/pages/company/CmsPage.jsx:
 *   **жирный**, *курсив*, «- » список, «1. » нумерованный список, «# » заголовок,
 *   «> » цитата, «---» разделитель, ![alt](url) — картинка.
 * Никакого dangerouslySetInnerHTML: текст рендерится React-элементами.
 */

const HINT = '**жирный**, *курсив*, «- » — список, «# » — заголовок';

export function RichTextEditor({
  value,
  onChange,
  placeholder,
  rows = 3,
  className,
  id,
  hint = HINT,
  'aria-invalid': ariaInvalid,
}) {
  const ref = useRef(null);
  const fileRef = useRef(null);
  const generatedId = useId();
  const fieldId = id || `rich-${generatedId}`;
  const hintId = `${fieldId}-hint`;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  /** Вставка markdown-картинки в позицию курсора. */
  const insertSnippet = (url, alt = 'изображение') => {
    const element = ref.current;
    // Скобки в подписи сломали бы разбор ![alt](url) — заменяем их пробелами.
    const safeAlt = String(alt).replace(/[[\]()]/g, ' ').trim() || 'изображение';
    const snippet = `\n![${safeAlt}](${url})\n`;
    const start = element?.selectionStart ?? (value || '').length;
    const end = element?.selectionEnd ?? start;
    const next = `${(value || '').slice(0, start)}${snippet}${(value || '').slice(end)}`;
    onChange(next);
    // Возвращаем курсор за вставленную ссылку, чтобы можно было писать дальше.
    requestAnimationFrame(() => {
      if (!element) return;
      element.focus();
      element.selectionStart = start + snippet.length;
      element.selectionEnd = start + snippet.length;
    });
  };

  const insertImage = () => {
    const url = window.prompt('Ссылка на изображение (https://…):');
    if (!url) return;
    setError(null);
    insertSnippet(url);
  };

  /**
   * Загрузка картинки файлом: кладём её в Storage и вставляем готовую разметку
   * с публичным адресом — заказчику не нужно искать, где разместить файл.
   */
  const uploadImage = async (file) => {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const { file_url } = await api.storage.uploadImage({ file, folder: 'surveys' });
      insertSnippet(file_url, file.name.replace(/\.[^.]+$/, '') || 'изображение');
    } catch (e) {
      setError(e?.message || 'Не удалось загрузить изображение');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={cn('space-y-1', className)}>
      <div className="relative">
        <textarea
          id={fieldId}
          ref={ref}
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={rows}
          aria-invalid={ariaInvalid}
          aria-describedby={hint ? hintId : undefined}
          className="w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 pr-40 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        <div className="absolute right-1.5 top-1.5 flex gap-1">
          {/* Файлом — основной способ; ссылка остаётся для уже размещённых картинок */}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
            className="h-8 text-xs text-muted-foreground hover:text-primary"
            aria-label="Загрузить изображение файлом"
          >
            {busy ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Upload className="w-3.5 h-3.5" aria-hidden="true" />
            )}
            Файл
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={insertImage}
            className="h-8 text-xs text-muted-foreground hover:text-primary"
            aria-label="Вставить изображение по ссылке"
          >
            <ImagePlus className="w-3.5 h-3.5" aria-hidden="true" />
            Ссылка
          </Button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif"
          className="sr-only"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) uploadImage(file);
          }}
        />
      </div>
      {error && (
        <p role="alert" className="flex items-start gap-1.5 text-xs text-destructive">
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
          {error}
        </p>
      )}
      {hint && (
        <p id={hintId} className="text-xs text-muted-foreground">
          Разметка: {hint}
        </p>
      )}
    </div>
  );
}

export default RichTextEditor;
