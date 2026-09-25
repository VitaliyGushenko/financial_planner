import { Category, OperationKind, Transaction } from './models';
import { DayKey, diffInDays } from './day-key';
import { Projection } from './projection';

/**
 * Агрегаторы для страницы «Аналитика». Считаются только подтверждённые
 * операции (applied !== false); переводы между своими счетами не являются
 * ни доходом, ни расходом и в суммы не попадают.
 */

export interface CategoryTotal {
  categoryId: string;
  title: string;
  amount: number;
  /** Доля от общих расходов за период, 0…1. */
  share: number;
}

export interface MonthTotals {
  /** «YYYY-MM». */
  month: string;
  income: number;
  expense: number;
}

export interface StatsResult {
  income: number;
  expense: number;
  net: number;
  /** Дней в периоде (включая границы). */
  daysCount: number;
  /** Средние расходы в день. */
  avgPerDay: number;
  /** Расходы по категориям, по убыванию суммы. */
  byCategory: CategoryTotal[];
  byMonth: MonthTotals[];
}

export interface StatsInput {
  transactions: Transaction[];
  categories: Category[];
  from: DayKey;
  to: DayKey;
}

function inPeriod(tx: Transaction, from: DayKey, to: DayKey): boolean {
  return tx.applied !== false && tx.date >= from && tx.date <= to;
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function buildStats(input: StatsInput): StatsResult {
  const categoryById = new Map(input.categories.map((c) => [c.id, c]));
  let income = 0;
  let expense = 0;
  const byCategory = new Map<string, number>();
  const byMonth = new Map<string, MonthTotals>();

  for (const tx of input.transactions) {
    if (!inPeriod(tx, input.from, input.to) || tx.kind === 'transfer') {
      continue;
    }
    const amount = Math.abs(tx.amount || 0);
    if (tx.kind === 'income') {
      income += amount;
    } else {
      expense += amount;
    }
    const month = tx.date.slice(0, 7);
    const totals = byMonth.get(month) ?? { month, income: 0, expense: 0 };
    if (tx.kind === 'income') {
      totals.income = round2(totals.income + amount);
    } else {
      totals.expense = round2(totals.expense + amount);
      // Структура расходов — только расходные категории.
      const categoryId = tx.categoryId || '__expense__';
      byCategory.set(categoryId, round2((byCategory.get(categoryId) || 0) + amount));
    }
    byMonth.set(month, totals);
  }

  const expenseTotal = expense || 0;
  const categories: CategoryTotal[] = [...byCategory.entries()]
    .map(([categoryId, amount]) => {
      const cat = categoryById.get(categoryId);
      const title = cat?.name ?? 'Без категории';
      return {
        categoryId,
        title,
        amount,
        share: expenseTotal > 0 && amount > 0 ? amount / expenseTotal : 0,
      };
    })
    .sort((a, b) => b.amount - a.amount);

  const daysCount = Math.max(1, diffInDays(input.to, input.from) + 1);

  return {
    income: round2(income),
    expense: round2(expense),
    net: round2(income - expense),
    daysCount,
    avgPerDay: round2(expense / daysCount),
    byCategory: categories,
    byMonth: [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month)),
  };
}

/** Доходы/расходы по месяцам за последние n месяцев (включая текущий). */
export function lastMonths(today: DayKey, n: number): MonthTotals[] {
  const out: MonthTotals[] = [];
  const [y, m] = today.split('-').map(Number);
  for (let i = n - 1; i >= 0; i--) {
    const total = y * 12 + (m - 1) - i;
    const ny = Math.floor(total / 12);
    const nm = (total % 12 + 12) % 12 + 1;
    out.push({ month: `${ny}-${String(nm).padStart(2, '0')}`, income: 0, expense: 0 });
  }
  return out;
}

/** Заполняет заранее созданные месяцы суммами операций. */
export function fillMonths(months: MonthTotals[], transactions: Transaction[]): MonthTotals[] {
  const index = new Map(months.map((m) => [m.month, m]));
  for (const tx of transactions) {
    if (tx.applied === false || tx.kind === 'transfer') {
      continue;
    }
    const totals = index.get(tx.date.slice(0, 7));
    if (!totals) {
      continue;
    }
    const amount = Math.abs(tx.amount || 0);
    if (tx.kind === 'income') {
      totals.income = round2(totals.income + amount);
    } else if (tx.kind === 'expense') {
      totals.expense = round2(totals.expense + amount);
    }
  }
  return months;
}

export interface BalanceSeries {
  labels: string[];
  /** Факт: дни строго раньше today (остальные — null для разрыва линии). */
  fact: (number | null)[];
  /** Прогноз: дни начиная с today (до него — null). */
  forecast: (number | null)[];
  todayIndex: number;
}

/** Ряд баланса из проекции: факт за прошлое + прогноз на будущее. */
export function balanceSeries(projection: Projection): BalanceSeries {
  const labels: string[] = [];
  const fact: (number | null)[] = [];
  const forecast: (number | null)[] = [];
  let todayIndex = 0;
  let joined = false;
  projection.keys.forEach((key) => {
    const day = projection.days.get(key);
    if (!day) {
      return;
    }
    labels.push(key);
    if (key < projection.today) {
      fact.push(day.balance);
      forecast.push(null);
    } else {
      // Первую точку прогноза дублируем из факта, чтобы линии соединились.
      if (!joined && fact.length > 0 && fact[fact.length - 1] !== null) {
        forecast.push(fact[fact.length - 1]);
        fact.push(null);
        labels.push(labels[labels.length - 1]);
        joined = true;
      }
      fact.push(null);
      forecast.push(day.balance);
      todayIndex = forecast.length - 1;
    }
  });
  return { labels, fact, forecast, todayIndex };
}

/** Периоды для сегмента выбора: from/to по ключу периода. */
export type StatsPeriod = 'month' | 'prev' | 'quarter' | 'year' | 'custom';

export function periodRange(period: StatsPeriod, today: DayKey): { from: DayKey; to: DayKey } {
  const [y, m, d] = today.split('-').map(Number);
  const monthStart = `${y}-${String(m).padStart(2, '0')}-01`;
  const prevMonthEnd = addDays(monthStart, -1);
  switch (period) {
    case 'month':
      return { from: monthStart, to: today };
    case 'prev': {
      const prevStart = monthShift(monthStart, -1);
      return { from: prevStart, to: prevMonthEnd };
    }
    case 'quarter':
      return { from: monthShift(monthStart, -3), to: today };
    case 'year':
      return { from: monthShift(monthStart, -12), to: today };
    case 'custom':
      return { from: today, to: today };
  }
}

function addDays(key: DayKey, days: number): DayKey {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days, 12)).toISOString().slice(0, 10);
}

function monthShift(key: DayKey, months: number): DayKey {
  const [y, m, d] = key.split('-').map(Number);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12 + 12) % 12 + 1;
  return `${ny}-${String(nm).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export const KIND_LABELS: Record<OperationKind, string> = {
  income: 'Доход',
  expense: 'Расход',
  transfer: 'Перевод',
};
