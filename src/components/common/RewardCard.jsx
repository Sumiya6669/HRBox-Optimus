import React from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Gift, ShoppingBag, Loader2 } from 'lucide-react';
import { formatPoints, formatMoney, formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * Единая карточка награды магазина (BUG-026).
 * Раньше логика доступности была продублирована: в магазине «Купить» при нулевом балансе
 * молча ничего не делала, а во встроенном магазине кошелька рисовался disabled-бейдж
 * «Недостаточно». Теперь правило доступности одно и живёт здесь.
 *
 * BUG-055: цена — внутренние баллы (formatPoints). Номинал сертификата, если он задан, —
 *          настоящие тенге (formatMoney), это разные величины.
 * BUG-063: «₸KZ» переносился на вторую строку и ломал высоту карточек — цена
 *          выводится в whitespace-nowrap, сетка карточек — items-stretch.
 */

/** Единственный источник правды о том, можно ли купить награду. */
export function rewardAvailability(item, balance) {
  const price = Number(item?.price) || 0;
  const rawStock = Number(item?.stock);
  const stock = Number.isFinite(rawStock) ? rawStock : -1;
  const available = Number(balance) || 0;
  const outOfStock = stock === 0;
  const shortfall = Math.max(price - available, 0);
  return {
    price,
    stock,
    outOfStock,
    shortfall,
    canBuy: !outOfStock && shortfall === 0,
  };
}

export default function RewardCard({
  item,
  balance = 0,
  onBuy,
  isPending = false,
  disabled = false,
  className,
}) {
  const { price, stock, outOfStock, shortfall, canBuy } = rewardAvailability(item, balance);
  const nominal = item?.nominal_kzt ?? item?.value_kzt ?? null;
  const hintId = `reward-hint-${item?.id}`;
  const blocked = disabled || !canBuy;

  const hint = outOfStock
    ? 'Нет в наличии — награда закончилась'
    : shortfall > 0
      ? `Не хватает ${formatPoints(shortfall)}`
      : null;

  return (
    <Card className={cn('flex h-full flex-col p-5', className)}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-accent text-2xl" aria-hidden="true">
          {item?.icon || <Gift className="h-6 w-6 text-accent-foreground" />}
        </div>
        {stock > 0 && stock <= 5 && (
          <Badge variant="warning" className="whitespace-nowrap">
            Осталось {formatNumber(stock)}
          </Badge>
        )}
        {outOfStock && (
          <Badge variant="secondary" className="whitespace-nowrap">
            Нет в наличии
          </Badge>
        )}
      </div>

      <h3 className="text-base font-semibold text-foreground">{item?.name}</h3>
      {item?.description && (
        <p className="mt-1 flex-1 text-sm text-muted-foreground">{item.description}</p>
      )}
      {!item?.description && <div className="flex-1" />}

      <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          {/* BUG-063: цена никогда не переносится на вторую строку */}
          <div className="whitespace-nowrap text-lg font-bold text-brand-wallet">{formatPoints(price)}</div>
          {nominal != null && (
            <div className="whitespace-nowrap text-xs text-muted-foreground">
              номинал {formatMoney(nominal)}
            </div>
          )}
        </div>

        <Button
          type="button"
          size="sm"
          className="min-h-[40px]"
          disabled={blocked || isPending}
          aria-describedby={hint ? hintId : undefined}
          aria-label={`Купить награду «${item?.name}» за ${formatPoints(price)}`}
          onClick={() => onBuy?.(item)}
        >
          {isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <ShoppingBag className="h-4 w-4" aria-hidden="true" />
          )}
          Купить
        </Button>
      </div>

      {/* BUG-026: причина недоступности всегда объяснена текстом, а не молчаливым disabled */}
      {hint && (
        <p id={hintId} className="mt-2 text-xs text-muted-foreground">
          {hint}
        </p>
      )}
    </Card>
  );
}

export { RewardCard };
