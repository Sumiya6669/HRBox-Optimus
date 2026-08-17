import React, { useEffect, useState } from 'react';
import { ImageOff } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * Картинка, которая не ломает вёрстку.
 *
 * Раньше обложки и фото выводились обычным `<img src={item.cover_url}>`: если ссылка
 * протухла (а до перехода на загрузку файлом почти все картинки были внешними),
 * браузер рисовал «сломанную иконку» и alt-текст поверх карточки. Теперь при ошибке
 * загрузки — и когда `src` пустой — показываем аккуратную заглушку того же размера:
 * иконку или инициалы (для аватаров).
 *
 * @param {string}   src           адрес изображения (может быть пустым)
 * @param {string}   alt           описание; для чисто декоративных обложек — ''
 * @param {string}   className     классы размера и скругления — применяются и к заглушке
 * @param {Function} fallbackIcon  иконка-заглушка (компонент lucide-react)
 * @param {string}   fallbackText  текст заглушки вместо иконки — например, инициалы
 * @param {string}   fallbackClassName  доп. классы заглушки
 * @param {'lazy'|'eager'} loading  по умолчанию ленивая загрузка — для списков карточек
 */
export default function SafeImage({
  src,
  alt = '',
  className,
  fallbackIcon: FallbackIcon = ImageOff,
  fallbackText,
  fallbackClassName,
  loading = 'lazy',
  ...rest
}) {
  const [failed, setFailed] = useState(false);

  // Сброс при смене адреса: иначе после замены картинки заглушка осталась бы навсегда.
  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (!src || failed) {
    return (
      <div
        className={cn(
          'flex items-center justify-center bg-muted text-muted-foreground',
          className,
          fallbackClassName
        )}
        // Заглушка декоративна, если и сама картинка была декоративной.
        role={alt ? 'img' : undefined}
        aria-label={alt || undefined}
        aria-hidden={alt ? undefined : 'true'}
      >
        {fallbackText ? (
          <span className="font-semibold leading-none select-none">{fallbackText}</span>
        ) : (
          <FallbackIcon className="w-1/3 h-1/3 max-w-6 max-h-6 min-w-4 min-h-4" aria-hidden="true" />
        )}
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      loading={loading}
      className={className}
      onError={() => setFailed(true)}
      {...rest}
    />
  );
}
