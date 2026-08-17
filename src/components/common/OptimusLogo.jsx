import React from "react";
import { cn } from "@/lib/utils";

/**
 * Логотип OPTIMUS KZ.
 *
 * `mono` — вариант в один цвет (currentColor) для размещения поверх брендовой
 * заливки: на красном фоне обычный вариант сливался, и от эмблемы оставалась
 * видна только белая точка в центре.
 *
 * @param {object} props
 * @param {string} [props.className]
 * @param {number} [props.size=28] — размер эмблемы в px
 * @param {boolean} [props.showText=true]
 * @param {boolean} [props.vertical=false] — эмблема над текстом
 * @param {boolean} [props.mono=false] — одноцветный вариант в currentColor
 */
export default function OptimusLogo({ className, size = 28, showText = true, vertical = false, mono = false }) {
  const fill = mono ? "currentColor" : "hsl(var(--primary))";
  const centerFill = mono ? "none" : "hsl(var(--card))";

  return (
    <div className={cn("flex items-center gap-2 select-none", vertical && "flex-col gap-1", className)}>
      {/* Эмблема: четыре сегмента, образующие компас */}
      <svg
        width={size}
        height={size}
        viewBox="0 0 40 40"
        fill="none"
        className="shrink-0"
        role="img"
        aria-label="OPTIMUS KZ"
      >
        <path d="M20 4 L28 16 L20 20 L12 16 Z" fill={fill} />
        <path d="M36 20 L24 28 L20 20 L24 12 Z" fill={fill} opacity="0.85" />
        <path d="M20 36 L12 24 L20 20 L28 24 Z" fill={fill} opacity="0.7" />
        <path d="M4 20 L16 12 L20 20 L16 28 Z" fill={fill} opacity="0.85" />
        {!mono && <circle cx="20" cy="20" r="3" fill={centerFill} />}
      </svg>
      {showText && (
        <div className={cn("font-extrabold tracking-tight leading-none", vertical && "text-center")}>
          <span style={{ fontSize: size * 0.42 }} className={mono ? undefined : "text-primary"}>OPTIMUS</span>
          <span style={{ fontSize: size * 0.42 }} className={mono ? "opacity-80" : "text-secondary"}>KZ</span>
        </div>
      )}
    </div>
  );
}
