import { DayKey, formatDayKeyShort, pluralRu } from './day-key';
import { Projection, inDays } from './projection';

/**
 * Советчик покупок: смотрит на проекцию остатков и подсказывает,
 * когда купить вещь, чтобы не уйти в минус с учётом всех остальных трат.
 */

export interface PurchaseAdvice {
  amount: number;
  /** Желаемый срок покупки или null. */
  deadline: DayKey | null;
  /** «Можно покупать уже сегодня». */
  canBuyNow: boolean;
  /**
   * Рекомендуемая дата: первый день, когда после покупки остаток
   * ни в один день горизонта не опускается ниже буфера (обычно 0).
   */
  recommendedDate: DayKey | null;
  /** Останется минимум после покупки (на худший день горизонта). */
  minBalanceAfter: number | null;
  /** Укладывается ли рекомендация в желаемый срок (null — срок не задан). */
  withinDeadline: boolean | null;
  /** Первая дата, когда сумма просто набирается, даже если после будет минус. */
  earliestAffordable: DayKey | null;
  /** Дни горизонта, когда остаток отрицательный ещё до покупки. */
  deficitDays: DayKey[];
  /** Готовое человеческое пояснение. */
  message: string;
  tone: 'good' | 'warn' | 'bad';
}

export function advisePurchase(
  projection: Projection,
  amount: number,
  options: { deadline?: DayKey | null; buffer?: number; currency?: string } = {},
): PurchaseAdvice {
  const buffer = options.buffer ?? 0;
  const currency = options.currency ?? 'RUB';
  const deadline = options.deadline ?? null;

  // Минимальный остаток от дня D до конца горизонта (суффиксные минимумы).
  // Смотрим только будущее: покупать «вчера» нельзя.
  const horizon = projection.futureKeys;
  const suffixMin = new Map<DayKey, number>();
  let running = Infinity;
  for (let i = horizon.length - 1; i >= 0; i--) {
    const key = horizon[i];
    const balance = projection.days.get(key)?.balance ?? 0;
    running = Math.min(running, balance);
    suffixMin.set(key, running);
  }

  let recommendedDate: DayKey | null = null;
  let minBalanceAfter: number | null = null;
  for (const key of horizon) {
    const min = suffixMin.get(key) ?? -Infinity;
    if (min >= amount + buffer) {
      recommendedDate = key;
      minBalanceAfter = min - amount;
      break;
    }
  }

  let earliestAffordable: DayKey | null = null;
  for (const key of horizon) {
    if ((projection.days.get(key)?.balance ?? 0) >= amount) {
      earliestAffordable = key;
      break;
    }
  }

  const deficitDays = horizon.filter((k) => (projection.days.get(k)?.balance ?? 0) < 0);
  const canBuyNow = recommendedDate !== null && recommendedDate === projection.today;
  const withinDeadline =
    deadline !== null ? (recommendedDate !== null && recommendedDate <= deadline) : null;

  return {
    amount,
    deadline,
    canBuyNow,
    recommendedDate,
    minBalanceAfter,
    withinDeadline,
    earliestAffordable,
    deficitDays,
    message: buildMessage({
      projection,
      amount,
      deadline,
      canBuyNow,
      recommendedDate,
      minBalanceAfter,
      withinDeadline,
      earliestAffordable,
      deficitDays,
      currency,
    }),
    tone: canBuyNow ? 'good' : recommendedDate !== null ? 'warn' : 'bad',
  };
}

function buildMessage(parts: {
  projection: Projection;
  amount: number;
  deadline: DayKey | null;
  canBuyNow: boolean;
  recommendedDate: DayKey | null;
  minBalanceAfter: number | null;
  withinDeadline: boolean | null;
  earliestAffordable: DayKey | null;
  deficitDays: DayKey[];
  currency: string;
}): string {
  const horizonDays = parts.projection.futureKeys.length;
  const deadlineLate =
    parts.deadline !== null &&
    parts.recommendedDate !== null &&
    parts.recommendedDate > parts.deadline;

  let message: string;
  if (parts.canBuyNow) {
    message =
      `Покупку можно сделать уже сегодня: после неё остаток ни разу ` +
      `не опустится ниже ${fmt(parts.minBalanceAfter ?? 0, parts.currency)} на горизонте прогноза.`;
  } else if (parts.recommendedDate !== null) {
    message =
      `Оптимальная дата — ${formatDayKeyShort(parts.recommendedDate)} ` +
      `(${inDays(parts.projection.today, parts.recommendedDate)}). ` +
      `Покупка в этот день не уведёт остаток в минус с учётом всех запланированных ` +
      `трат: в худший день останется ${fmt(parts.minBalanceAfter ?? 0, parts.currency)}.`;
  } else if (parts.earliestAffordable !== null) {
    message =
      `На горизонте ${horizonDays} ${pluralRu(horizonDays, 'дня', 'дней', 'дней')} ` +
      `безопасной даты нет: после покупки остаток где-то уйдёт в минус. ` +
      `Впервые сумма набирается ${formatDayKeyShort(parts.earliestAffordable)}, ` +
      `но перед этим стоит проверить планируемые траты.`;
  } else {
    message =
      `За ${horizonDays} ${pluralRu(horizonDays, 'день', 'дня', 'дней')} нужная сумма ` +
      `не набирается. Уменьшите сумму, отложите покупку или добавьте источник дохода.`;
  }

  if (deadlineLate) {
    message +=
      ` ⚠ К желаемому сроку (${formatDayKeyShort(parts.deadline!)}) накопить ` +
      `безопасно не выйдет — рекомендация позже срока.`;
  } else if (
    parts.deadline !== null &&
    parts.withinDeadline === false &&
    parts.recommendedDate === null
  ) {
    message += ` ⚠ К желаемому сроку (${formatDayKeyShort(parts.deadline)}) накопить не получится.`;
  }

  if (parts.deficitDays.length) {
    const first = parts.deficitDays[0];
    message +=
      ` Обратите внимание: без учёта этой покупки остаток уходит в минус ` +
      `${parts.deficitDays.length} ${pluralRu(parts.deficitDays.length, 'день', 'дня', 'дней')} ` +
      `(впервые ${formatDayKeyShort(first)}).`;
  }

  return message;
}

function fmt(value: number, currency: string): string {
  return value.toLocaleString('ru-RU', {
    style: 'currency',
    currency,
    maximumFractionDigits: value % 1 === 0 ? 0 : 2,
  });
}
