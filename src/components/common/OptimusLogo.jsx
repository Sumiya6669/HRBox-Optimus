import React from 'react';
import { cn } from '@/lib/utils';
import {
  LOGO_TRANSFORM,
  LOGO_VIEWBOX,
  MARK_VIEWBOX,
  PATH_PRIMARY,
  PATH_SECONDARY,
  PATH_MARK,
} from '@/components/common/logoPaths';

const LOGO_RATIO = 2374 / 430; // пропорции полного логотипа
const MARK_RATIO = 491 / 430;  // пропорции знака

/**
 * Фирменный логотип Optimus KZ.
 *
 * Контуры получены трассировкой официального логотипа (см. logoPaths.js),
 * поэтому знак совпадает с оригиналом — треугольник с вписанной звездой.
 *
 * @param {object} props
 * @param {number} [props.size=28] — высота логотипа в px
 * @param {boolean} [props.showText=true] — со словом «OPTIMUS KZ» или только знак
 * @param {boolean} [props.mono=false] — одноцветный вариант в currentColor,
 *        для размещения поверх брендовой заливки (на красном фоне обычный вариант сливается)
 * @param {boolean} [props.vertical=false] — знак над надписью
 * @param {string} [props.className]
 */
export default function OptimusLogo({
  size = 28,
  showText = true,
  mono = false,
  vertical = false,
  className,
  ...rest
}) {
  const primaryFill = mono ? 'currentColor' : '#D8393C';
  const secondaryFill = mono ? 'currentColor' : '#9B9B9B';

  const mark = (
    <svg
      width={size * MARK_RATIO}
      height={size}
      viewBox={MARK_VIEWBOX}
      className="shrink-0"
      role="img"
      aria-label="Optimus KZ"
      focusable="false"
    >
      <g transform={LOGO_TRANSFORM}>
        <path fill={primaryFill} d={PATH_MARK} />
      </g>
    </svg>
  );

  // Вертикальная компоновка: знак сверху, полный логотип внизу не нужен —
  // используем знак и уменьшенную надпись под ним.
  if (vertical) {
    return (
      <div className={cn('flex flex-col items-center gap-1.5 select-none', className)} {...rest}>
        {mark}
        <svg
          width={size * 1.9 * LOGO_RATIO * 0.42}
          height={size * 0.42}
          viewBox="553 0 1821 430"
          role="presentation"
          aria-hidden="true"
          focusable="false"
        >
          <g transform={LOGO_TRANSFORM}>
            <path fill={primaryFill} d={PATH_PRIMARY} />
            <path fill={secondaryFill} d={PATH_SECONDARY} />
          </g>
        </svg>
      </div>
    );
  }

  if (!showText) {
    return <span className={cn('inline-flex select-none', className)} {...rest}>{mark}</span>;
  }

  return (
    <span className={cn('inline-flex items-center select-none', className)} {...rest}>
      <svg
        width={size * LOGO_RATIO}
        height={size}
        viewBox={LOGO_VIEWBOX}
        role="img"
        aria-label="Optimus KZ"
        focusable="false"
      >
        <g transform={LOGO_TRANSFORM}>
          <path fill={primaryFill} d={PATH_PRIMARY} />
          <path fill={secondaryFill} d={PATH_SECONDARY} />
        </g>
      </svg>
    </span>
  );
}
