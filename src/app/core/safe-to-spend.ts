import { DayKey, addDaysToKey, diffInDays } from './day-key';
import { round2 } from './money';
import { Projection } from './projection';

/**
 * «Безопасно потратить сегодня».
 *
 * Если потратить X сегодня, все будущие остатки уменьшатся на X. Значит,
 * потолок — минимальный остаток на горизонте (и текущие деньги на счетах,
 * ведь потратить можно только то, что уже есть). Из результата вычитается
 * резерв, если пользователь хочет оставить подушку.
 *
 * Чистая функция поверх готовой проекции — тестируется без Firebase.
 */

export interface SafeToSpendOptions {
  /** Неприкосновенная подушка: сколько оставить на счетах. */
  reserve?: number;
}

export interface SafeToSpendResult {
  /** Сколько можно потратить сегодня. */
  amount: number;
  /** Самый низкий остаток на горизонте и дата. */
  minBalance: number;
  minBalanceDate: DayKey;
  /** Ближайший доход (правило или плановая операция), если он вообще есть. */
  nextIncomeDate: DayKey | null;
  daysToIncome: number | null;
  /** Сколько денег придёт и уйдёт на горизонте — для подписи «что учтено». */
  incomeAhead: number;
  expenseAhead: number;
  /** Горизонт расчёта в днях (может быть урезан концом проекции). */
  horizonDays: number;
}

export function safeToSpend(
  projection: Projection,
  horizonDays = 30,
  options: SafeToSpendOptions = {},
): SafeToSpendResult {
  const wantedEnd = addDaysToKey(projection.today, Math.max(0, horizonDays));
  const end = wantedEnd < projection.horizonEnd ? wantedEnd : projection.horizonEnd;

  let minBalance = projection.totalNow;
  let minBalanceDate = projection.today;
  let nextIncomeDate: DayKey | null = null;
  let incomeAhead = 0;
  let expenseAhead = 0;

  for (const key of projection.futureKeys) {
    const day = projection.days.get(key);
    if (day && !nextIncomeDate && day.events.some((event) => event.kind === 'income' && event.signedDelta > 0)) {
      nextIncomeDate = key;
    }
    if (key > end) {
      continue;
    }
    if (!day) {
      continue;
    }
    if (day.balance < minBalance) {
      minBalance = day.balance;
      minBalanceDate = key;
    }
    for (const event of day.events) {
      if (event.signedDelta > 0) {
        incomeAhead += event.signedDelta;
      } else if (event.signedDelta < 0) {
        expenseAhead += -event.signedDelta;
      }
    }
  }

  const reserve = options.reserve ?? 0;
  const available = Math.min(projection.totalNow, minBalance) - reserve;

  return {
    amount: round2(Math.max(0, available)),
    minBalance: round2(minBalance),
    minBalanceDate,
    nextIncomeDate,
    daysToIncome: nextIncomeDate ? diffInDays(nextIncomeDate, projection.today) : null,
    incomeAhead: round2(incomeAhead),
    expenseAhead: round2(expenseAhead),
    horizonDays,
  };
}
