import { DayKey, addMonthsToKey } from './day-key';
import { round2 } from './money';
import { Category, CategoryKind, Transaction } from './models';

/**
 * Сравнение двух месяцев: суммы, дельты, проценты и полный разбор
 * по каждой статье расходов и доходов (включая подкатегории).
 * Считаются только подтверждённые операции — переводы между счетами не в счёт.
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

/** Сравнение по подкатегории внутри выбранной категории за два месяца. */
export interface SubcategoryComparisonItem {
  subcategoryId: string;
  title: string;
  monthA: number;
  monthB: number;
  delta: number;
  percent: number | null;
}

/** Детальное сравнение одной статьи (категории) дохода или расхода за 2 месяца. */
export interface CategoryComparisonItem {
  categoryId: string;
  title: string;
  icon?: string;
  kind: CategoryKind;
  /** Сумма в базовом месяце (Месяц А). */
  monthA: number;
  /** Сумма в сравниваемом месяце (Месяц Б). */
  monthB: number;
  /** Разница: monthB − monthA. */
  delta: number;
  /** Относительное изменение (monthB − monthA) / monthA; null если monthA === 0. */
  percent: number | null;
  /** Доля категории в общей сумме доходов/расходов месяца А (0…1). */
  shareA: number;
  /** Доля категории в общей сумме доходов/расходов месяца Б (0…1). */
  shareB: number;
  /** Отношение к максимуму среди всех категорий этого типа (для ширины прогресс-баров, 0…1). */
  barRatioA: number;
  barRatioB: number;
  /** Количество операций в месяце А и Б. */
  txCountA: number;
  txCountB: number;
  /** Для дохода рост (delta > 0) — хорошо; для расхода снижение (delta < 0) — хорошо. */
  tone: 'good' | 'bad' | 'neutral';
  /** Детализация по подкатегориям, если они использовались. */
  subcategories: SubcategoryComparisonItem[];
}

export interface DetailedMonthComparison {
  /** Базовый месяц «YYYY-MM» (с чем сравниваем, например Октябрь). */
  monthA: string;
  /** Целевой месяц «YYYY-MM» (который анализируем, например Ноябрь). */
  monthB: string;
  pointA: MonthPoint & { savingsRate: number };
  pointB: MonthPoint & { savingsRate: number };
  incomeDelta: number;
  expenseDelta: number;
  netDelta: number;
  incomePercent: number | null;
  expensePercent: number | null;
  /** Все статьи расходов, где в месяце А или Б были траты. */
  expenseCategories: CategoryComparisonItem[];
  /** Все статьи доходов, где в месяце А или Б были поступления. */
  incomeCategories: CategoryComparisonItem[];
  /** Короткие автоматические выводы по итогам сравнения двух месяцев. */
  insights: string[];
}

export interface DetailedCompareInput {
  transactions: readonly Transaction[];
  categories: readonly Category[];
  /** Базовый месяц «YYYY-MM» (или «YYYY-MM-DD»). */
  monthA: string;
  /** Сравниваемый месяц «YYYY-MM» (или «YYYY-MM-DD»). */
  monthB: string;
}

interface CategoryBucket {
  amountA: number;
  amountB: number;
  countA: number;
  countB: number;
  subcategories: Map<string, { amountA: number; amountB: number }>;
}

/**
 * Детальное сравнение любых двух выбранных месяцев по всем статьям
 * расходов и доходов, включая подкатегории.
 */
export function compareTwoMonths(input: DetailedCompareInput): DetailedMonthComparison {
  const monthA = input.monthA.slice(0, 7);
  const monthB = input.monthB.slice(0, 7);

  let incomeA = 0;
  let expenseA = 0;
  let incomeB = 0;
  let expenseB = 0;

  const expenseBuckets = new Map<string, CategoryBucket>();
  const incomeBuckets = new Map<string, CategoryBucket>();

  const ensureBucket = (map: Map<string, CategoryBucket>, id: string): CategoryBucket => {
    let b = map.get(id);
    if (!b) {
      b = { amountA: 0, amountB: 0, countA: 0, countB: 0, subcategories: new Map() };
      map.set(id, b);
    }
    return b;
  };

  for (const tx of input.transactions) {
    if (tx.applied === false || tx.kind === 'transfer') {
      continue;
    }
    const prefix = tx.date.slice(0, 7);
    const isA = prefix === monthA;
    const isB = prefix === monthB;
    if (!isA && !isB) {
      continue;
    }

    const amount = Math.abs(tx.amount || 0);
    if (amount === 0) {
      continue;
    }

    if (tx.kind === 'income') {
      if (isA) incomeA += amount;
      if (isB) incomeB += amount;
      const catId = tx.categoryId || '__uncategorized_income__';
      const bucket = ensureBucket(incomeBuckets, catId);
      if (isA) {
        bucket.amountA += amount;
        bucket.countA += 1;
      }
      if (isB) {
        bucket.amountB += amount;
        bucket.countB += 1;
      }
      if (tx.subcategoryId) {
        const sub = bucket.subcategories.get(tx.subcategoryId) ?? { amountA: 0, amountB: 0 };
        if (isA) sub.amountA += amount;
        if (isB) sub.amountB += amount;
        bucket.subcategories.set(tx.subcategoryId, sub);
      }
    } else {
      if (isA) expenseA += amount;
      if (isB) expenseB += amount;
      const catId = tx.categoryId || '__uncategorized_expense__';
      const bucket = ensureBucket(expenseBuckets, catId);
      if (isA) {
        bucket.amountA += amount;
        bucket.countA += 1;
      }
      if (isB) {
        bucket.amountB += amount;
        bucket.countB += 1;
      }
      if (tx.subcategoryId) {
        const sub = bucket.subcategories.get(tx.subcategoryId) ?? { amountA: 0, amountB: 0 };
        if (isA) sub.amountA += amount;
        if (isB) sub.amountB += amount;
        bucket.subcategories.set(tx.subcategoryId, sub);
      }
    }
  }

  incomeA = round2(incomeA);
  expenseA = round2(expenseA);
  incomeB = round2(incomeB);
  expenseB = round2(expenseB);

  const netA = round2(incomeA - expenseA);
  const netB = round2(incomeB - expenseB);
  const savingsRateA = incomeA > 0 ? round2((incomeA - expenseA) / incomeA) : 0;
  const savingsRateB = incomeB > 0 ? round2((incomeB - expenseB) / incomeB) : 0;

  const categoryById = new Map(input.categories.map((c) => [c.id, c]));

  const buildItems = (
    buckets: Map<string, CategoryBucket>,
    kind: CategoryKind,
    totalA: number,
    totalB: number,
  ): CategoryComparisonItem[] => {
    let maxVal = 0;
    for (const b of buckets.values()) {
      maxVal = Math.max(maxVal, round2(b.amountA), round2(b.amountB));
    }

    const items: CategoryComparisonItem[] = [];
    for (const [categoryId, b] of buckets.entries()) {
      const mA = round2(b.amountA);
      const mB = round2(b.amountB);
      if (mA === 0 && mB === 0) {
        continue;
      }
      const delta = round2(mB - mA);
      const cat = categoryById.get(categoryId);
      const subNameById = new Map((cat?.subcategories ?? []).map((s) => [s.id, s.name]));

      const subcategories: SubcategoryComparisonItem[] = [];
      for (const [subId, subVal] of b.subcategories.entries()) {
        const sA = round2(subVal.amountA);
        const sB = round2(subVal.amountB);
        if (sA === 0 && sB === 0) continue;
        subcategories.push({
          subcategoryId: subId,
          title: subNameById.get(subId) ?? 'Подкатегория',
          monthA: sA,
          monthB: sB,
          delta: round2(sB - sA),
          percent: percent(sB, sA),
        });
      }
      subcategories.sort((x, y) => Math.max(y.monthA, y.monthB) - Math.max(x.monthA, x.monthB));

      let tone: 'good' | 'bad' | 'neutral' = 'neutral';
      if (delta !== 0) {
        if (kind === 'income') {
          tone = delta > 0 ? 'good' : 'bad';
        } else {
          tone = delta < 0 ? 'good' : 'bad';
        }
      }

      items.push({
        categoryId,
        title: cat?.name ?? 'Без категории',
        icon: cat?.icon,
        kind,
        monthA: mA,
        monthB: mB,
        delta,
        percent: percent(mB, mA),
        shareA: totalA > 0 ? round2(mA / totalA) : 0,
        shareB: totalB > 0 ? round2(mB / totalB) : 0,
        barRatioA: maxVal > 0 ? round2(mA / maxVal) : 0,
        barRatioB: maxVal > 0 ? round2(mB / maxVal) : 0,
        txCountA: b.countA,
        txCountB: b.countB,
        tone,
        subcategories,
      });
    }

    // По умолчанию сортируем по наибольшему абсолютному отклонению, затем по сумме.
    items.sort((a, b) => {
      const diffDelta = Math.abs(b.delta) - Math.abs(a.delta);
      if (diffDelta !== 0) return diffDelta;
      return Math.max(b.monthA, b.monthB) - Math.max(a.monthA, a.monthB);
    });
    return items;
  };

  const expenseCategories = buildItems(expenseBuckets, 'expense', expenseA, expenseB);
  const incomeCategories = buildItems(incomeBuckets, 'income', incomeA, incomeB);

  return {
    monthA,
    monthB,
    pointA: { income: incomeA, expense: expenseA, net: netA, savingsRate: savingsRateA },
    pointB: { income: incomeB, expense: expenseB, net: netB, savingsRate: savingsRateB },
    incomeDelta: round2(incomeB - incomeA),
    expenseDelta: round2(expenseB - expenseA),
    netDelta: round2(netB - netA),
    incomePercent: percent(incomeB, incomeA),
    expensePercent: percent(expenseB, expenseA),
    expenseCategories,
    incomeCategories,
    insights: [],
  };
}

/** Список доступных для выбора месяцев («YYYY-MM»), от новых к старым. */
export function availableComparisonMonths(
  transactions: readonly Transaction[],
  today: DayKey,
  minMonths = 12,
): string[] {
  const set = new Set<string>();
  const currentMonth = today.slice(0, 7);
  for (let i = 0; i < minMonths; i++) {
    set.add(addMonthsToKey(`${currentMonth}-01`, -i).slice(0, 7));
  }
  for (const tx of transactions) {
    if (tx.applied === false || tx.kind === 'transfer') continue;
    if (tx.date && tx.date.length >= 7) {
      set.add(tx.date.slice(0, 7));
    }
  }
  return [...set].sort((a, b) => b.localeCompare(a));
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
