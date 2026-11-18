import { DayKey, addDaysToKey } from './day-key';
import { round2 } from './money';
import { Category, Transaction } from './models';

/**
 * «Неделя в цифрах»: доходы/расходы за последние N дней, сравнение
 * с предыдущим периодом и самая затратная категория.
 * Чистая функция — форматирование денег остаётся на компоненте.
 */

export interface DigestResult {
  from: DayKey;
  to: DayKey;
  income: number;
  expense: number;
  net: number;
  previousExpense: number;
  /** Изменение расходов к прошлому периоду (0.2 = +20%); null — сравнивать не с чем. */
  expenseChange: number | null;
  topCategory: { categoryId: string; title: string; amount: number } | null;
}

export interface DigestInput {
  transactions: readonly Transaction[];
  categories: readonly Category[];
  today: DayKey;
  /** Длина периода в днях, по умолчанию неделя. */
  days?: number;
}

export function buildDigest(input: DigestInput): DigestResult {
  const days = Math.max(1, input.days ?? 7);
  const to = input.today;
  const from = addDaysToKey(to, -(days - 1));
  const previousTo = addDaysToKey(from, -1);
  const previousFrom = addDaysToKey(previousTo, -(days - 1));

  let income = 0;
  let expense = 0;
  let previousExpense = 0;
  const byCategory = new Map<string, number>();

  for (const tx of input.transactions) {
    if (tx.applied === false || tx.kind === 'transfer') {
      continue;
    }
    const current = tx.date >= from && tx.date <= to;
    const previous = tx.date >= previousFrom && tx.date <= previousTo;
    if (!current && !previous) {
      continue;
    }

    if (tx.kind === 'income') {
      if (current) {
        income += tx.amount;
      }
      continue;
    }

    if (current) {
      expense += tx.amount;
      if (tx.categoryId) {
        byCategory.set(tx.categoryId, (byCategory.get(tx.categoryId) ?? 0) + tx.amount);
      }
    } else {
      previousExpense += tx.amount;
    }
  }

  const categoryById = new Map(input.categories.map((category) => [category.id, category]));
  let topCategory: DigestResult['topCategory'] = null;
  for (const [categoryId, amount] of byCategory) {
    if (!topCategory || amount > topCategory.amount) {
      topCategory = {
        categoryId,
        title: categoryById.get(categoryId)?.name ?? 'Без категории',
        amount: round2(amount),
      };
    }
  }

  return {
    from,
    to,
    income: round2(income),
    expense: round2(expense),
    net: round2(income - expense),
    previousExpense: round2(previousExpense),
    expenseChange:
      previousExpense > 0 ? round2((expense - previousExpense) / previousExpense) : null,
    topCategory,
  };
}
