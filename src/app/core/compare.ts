import { DayKey, addMonthsToKey } from './day-key';
import { round2 } from './money';
import { Category, Transaction } from './models';

/**
 * Сравнение текущего месяца с прошлым: суммы, дельты и категории,
 * которые выросли сильнее всего. Считаются только подтверждённые
 * доходы и расходы — переводы между счетами не в счёт.
 */

export interface MonthPoint {
  income: number;
  expense: number;
  net: number;
}

export interface CategoryChange {
  categoryId: string;
  title: string;
  previous: number;
  current: number;
  delta: number;
}

export interface MonthComparison {
  /** «YYYY-MM». */
  month: string;
  previousMonth: string;
  current: MonthPoint;
  previous: MonthPoint;
  incomeDelta: number;
  expenseDelta: number;
  /** Прирост в долях; null — в прошлом месяце было 0, процент не определён. */
  incomePercent: number | null;
  expensePercent: number | null;
  /** Категории с наибольшим ростом расходов. */
  growth: CategoryChange[];
}

export interface CompareInput {
  transactions: readonly Transaction[];
  categories: readonly Category[];
  /** Любой день текущего месяца. */
  month: DayKey;
}

export function compareMonths(input: CompareInput): MonthComparison {
  const month = input.month.slice(0, 7);
  const previousMonth = addMonthsToKey(`${month}-01`, -1).slice(0, 7);

  const current: MonthPoint = { income: 0, expense: 0, net: 0 };
  const previous: MonthPoint = { income: 0, expense: 0, net: 0 };
  const currentByCategory = new Map<string, number>();
  const previousByCategory = new Map<string, number>();

  for (const tx of input.transactions) {
    if (tx.applied === false) {
      continue;
    }
    const prefix = tx.date.slice(0, 7);
    const isCurrent = prefix === month;
    const isPrevious = prefix === previousMonth;
    if (!isCurrent && !isPrevious) {
      continue;
    }
    if (tx.kind === 'transfer') {
      continue;
    }

    const target = isCurrent ? current : previous;
    if (tx.kind === 'income') {
      target.income += tx.amount;
    } else {
      target.expense += tx.amount;
      if (tx.categoryId) {
        const map = isCurrent ? currentByCategory : previousByCategory;
        map.set(tx.categoryId, (map.get(tx.categoryId) ?? 0) + tx.amount);
      }
    }
  }

  current.income = round2(current.income);
  current.expense = round2(current.expense);
  current.net = round2(current.income - current.expense);
  previous.income = round2(previous.income);
  previous.expense = round2(previous.expense);
  previous.net = round2(previous.income - previous.expense);

  const categoryById = new Map(input.categories.map((category) => [category.id, category]));
  const growth: CategoryChange[] = [];
  for (const [categoryId, currentAmount] of currentByCategory) {
    const before = previousByCategory.get(categoryId) ?? 0;
    const delta = round2(currentAmount - before);
    if (delta <= 0) {
      continue;
    }
    growth.push({
      categoryId,
      title: categoryById.get(categoryId)?.name ?? 'Без категории',
      previous: round2(before),
      current: round2(currentAmount),
      delta,
    });
  }
  growth.sort((a, b) => b.delta - a.delta);

  return {
    month,
    previousMonth,
    current,
    previous,
    incomeDelta: round2(current.income - previous.income),
    expenseDelta: round2(current.expense - previous.expense),
    incomePercent: percent(current.income, previous.income),
    expensePercent: percent(current.expense, previous.expense),
    growth: growth.slice(0, 3),
  };
}

function percent(current: number, previous: number): number | null {
  if (previous === 0) {
    return null;
  }
  return round2((current - previous) / previous);
}
