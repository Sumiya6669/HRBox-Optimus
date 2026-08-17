import React, { useId, useRef } from 'react';
import { ImagePlus } from 'lucide-react';
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
  const generatedId = useId();
  const fieldId = id || `rich-${generatedId}`;
  const hintId = `${fieldId}-hint`;

  const insertImage = () => {
    const url = window.prompt('Ссылка на изображение (https://…):');
    if (!url) return;
    const element = ref.current;
    const snippet = `\n![изображение](${url})\n`;
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
          className="w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 pr-24 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={insertImage}
          className="absolute right-1.5 top-1.5 h-8 text-xs text-muted-foreground hover:text-primary"
          aria-label="Вставить изображение по ссылке"
        >
          <ImagePlus className="w-3.5 h-3.5" aria-hidden="true" />
          Фото
        </Button>
      </div>
      {hint && (
        <p id={hintId} className="text-xs text-muted-foreground">
          Разметка: {hint}
        </p>
      )}
    </div>
  );
}

export default RichTextEditor;
