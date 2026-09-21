import { Account, Category, OperationKind, RecurringRule, Transaction } from './models';
import { DayKey, addDaysToKey, addMonthsToKey, addYearsToKey, pluralRu } from './day-key';
import { round2 } from './money';

/**
 * Проекция остатков: дневная карта «сколько денег на каждую дату».
 *
 * Точка отсчёта — фактические балансы счетов «сейчас».
 *  Будущее: остаток(D) = текущий итог + события с датой в (сегодня, D].
 *           События — будущие разовые операции и вхождения правил.
 *  Прошлое: факт уже зашит в балансах, поэтому идём от «сейчас» назад,
 *           откатывая записанные операции: остаток(D) = теперь − Δ(D, сейчас].
 */

export interface ProjectionEvent {
  /** id операции или «{ruleId}@{date}» для вхождения правила. */
  id: string;
  source: 'transaction' | 'recurring';
  kind: OperationKind;
  title: string;
  /** Сумма всегда положительная; направление определяется kind. */
  amount: number;
  /** Влияние на общий баланс: +для дохода, −для расхода, 0 для перевода. */
  signedDelta: number;
  /** Для recurring — правило, чтобы можно было «записать» операцию из календаря. */
  rule?: RecurringRule;
  /** Плановая (ещё не подтверждённая) разовая операция. */
  planned?: boolean;
}

export interface DayProjection {
  key: DayKey;
  /** Остаток на начало дня. */
  startBalance: number;
  /** Остаток на конец дня — после событий этого дня. */
  balance: number;
  events: ProjectionEvent[];
  past: boolean;
}

export interface Projection {
  today: DayKey;
  /** Фактический суммарный остаток на сейчас. */
  totalNow: number;
  /** Все ключи дней по возрастанию (прошлое + будущее). */
  keys: DayKey[];
  /** Будущее: today..horizonEnd по возрастанию (для советчика и прогнозов). */
  futureKeys: DayKey[];
  days: Map<DayKey, DayProjection>;
  /** Первый будущий день с отрицательным остатком или null. */
  firstDeficitDay: DayKey | null;
  horizonEnd: DayKey;
}

export interface ProjectionInput {
  accounts: Account[];
  transactions: Transaction[];
  rules: RecurringRule[];
  categories: Category[];
  today: DayKey;
  /** На сколько дней вперёд строить прогноз (по умолчанию 400). */
  horizonDays?: number;
  /** На сколько дней назад откатывать факт для истории (по умолчанию 90). */
  pastDays?: number;
}

/** Все вхождения правила в диапазоне [fromInclusive, toInclusive]. */
export function occurrencesOfRule(
  rule: Pick<RecurringRule, 'frequency' | 'every' | 'customUnit' | 'startDate' | 'endDate'>,
  fromInclusive: DayKey,
  toInclusive: DayKey,
): DayKey[] {
  const out: DayKey[] = [];
  const step = rule.frequency === 'custom' ? Math.max(1, rule.every || 1) : 1;
  // Каждое вхождение считается от startDate (а не от предыдущего) —
  // иначе «31-го числа» дрейфует в 28-е после короткого месяца.
  for (let occurrence = 0; occurrence < 5000; occurrence++) {
    const current = nthOccurrence(rule, step, occurrence);
    if (current > toInclusive) {
      break;
    }
    if (current >= fromInclusive && (!rule.endDate || current <= rule.endDate)) {
      out.push(current);
    }
  }
  return out;
}

/** Вхождение № occurrence (0 = стартовая дата) правила. */
function nthOccurrence(
  rule: Pick<RecurringRule, 'frequency' | 'customUnit' | 'startDate'>,
  step: number,
  occurrence: number,
): DayKey {
  switch (rule.frequency) {
    case 'weekly':
      return addDaysToKey(rule.startDate, 7 * occurrence);
    case 'monthly':
      return addMonthsToKey(rule.startDate, occurrence);
    case 'yearly':
      return addMonthsToKey(rule.startDate, 12 * occurrence);
    case 'custom':
      switch (rule.customUnit) {
        case 'days':
          return addDaysToKey(rule.startDate, step * occurrence);
        case 'weeks':
          return addDaysToKey(rule.startDate, 7 * step * occurrence);
        case 'months':
          return addMonthsToKey(rule.startDate, step * occurrence);
        case 'years':
          return addMonthsToKey(rule.startDate, 12 * step * occurrence);
        default:
          return addMonthsToKey(rule.startDate, step * occurrence);
      }
  }
}

function signedDeltaOf(kind: OperationKind, amount: number): number {
  if (kind === 'income') {
    return amount;
  }
  if (kind === 'expense') {
    return -amount;
  }
  return 0; // перевод между своими счетами общий баланс не меняет
}

export function buildProjection(input: ProjectionInput): Projection {
  const horizonDays = input.horizonDays ?? 400;
  const pastDays = input.pastDays ?? 90;
  const { today } = input;
  const horizonEnd = addDaysToKey(today, horizonDays);
  const pastStart = addDaysToKey(today, -Math.max(0, pastDays - 1));

  const categoryById = new Map(input.categories.map((c) => [c.id, c]));
  const accountById = new Map(input.accounts.map((a) => [a.id, a]));

  const totalNow = round2(input.accounts.reduce((sum, a) => sum + (a.balance || 0), 0));

  const days = new Map<DayKey, DayProjection>();

  // --- Каркас дней (сначала: события вешаются на существующие дни) ---
  for (let key = pastStart; key <= horizonEnd; key = addDaysToKey(key, 1)) {
    days.set(key, { key, startBalance: 0, balance: 0, events: [], past: key < today });
  }

  const push = (key: DayKey, event: ProjectionEvent): void => {
    days.get(key)?.events.push(event);
  };

  // --- События ---

  // Записанные операции: для прошлого и сегодняшнего дня (факт).
  // Незаподтверждённые плановые (applied=false) фактом не считаются.
  const deltaByPastDay = new Map<DayKey, number>();
  for (const tx of input.transactions) {
    if (tx.date < pastStart || tx.date > today || tx.applied === false) {
      continue;
    }
    const delta = signedDeltaOf(tx.kind, tx.amount || 0);
    push(tx.date, {
      id: tx.id,
      source: 'transaction',
      kind: tx.kind,
      title: describeTransaction(tx, categoryById, accountById),
      amount: Math.abs(tx.amount || 0),
      signedDelta: delta,
    });
    deltaByPastDay.set(tx.date, (deltaByPastDay.get(tx.date) ?? 0) + delta);
  }

  // Будущие разовые операции (строго после today — прошлые уже в балансах).
  for (const tx of input.transactions) {
    if (tx.date <= today || tx.date > horizonEnd) {
      continue;
    }
    const delta = signedDeltaOf(tx.kind, tx.amount || 0);
    push(tx.date, {
      id: tx.id,
      source: 'transaction',
      kind: tx.kind,
      title: describeTransaction(tx, categoryById, accountById),
      amount: Math.abs(tx.amount || 0),
      signedDelta: delta,
      planned: tx.applied === false,
    });
  }

  // Вхождения повторяющихся правил (строго после today).
  for (const rule of input.rules) {
    for (const key of occurrencesOfRule(rule, addDaysToKey(today, 1), horizonEnd)) {
      const delta = signedDeltaOf(rule.kind, rule.amount || 0);
      push(key, {
        id: `${rule.id}@${key}`,
        source: 'recurring',
        kind: rule.kind,
        title: rule.title?.trim() || describeRuleDefault(rule, categoryById),
        amount: Math.abs(rule.amount || 0),
        signedDelta: delta,
        rule,
      });
    }
  }

  // --- Прошлое: откатываем факт от «сейчас» назад ---
  let running = totalNow;
  const todayDeltas = deltaByPastDay.get(today) ?? 0;
  for (let key = today; ; key = addDaysToKey(key, -1)) {
    const day = days.get(key);
    if (!day) {
      break;
    }
    day.balance = running;
    running = round2(running - (deltaByPastDay.get(key) ?? 0));
    day.startBalance = running;
    if (key === pastStart) {
      break;
    }
  }

  // --- Будущее: накатываем события вперёд ---
  running = totalNow;
  const futureKeys: DayKey[] = [];
  let firstDeficitDay: DayKey | null = null;
  for (let key = today; key <= horizonEnd; key = addDaysToKey(key, 1)) {
    futureKeys.push(key);
    const day = days.get(key)!;
    if (key === today) {
      day.startBalance = round2(totalNow - todayDeltas);
      day.balance = totalNow;
      running = totalNow;
      continue;
    }
    day.startBalance = running;
    for (const event of day.events) {
      running = round2(running + event.signedDelta);
    }
    day.balance = running;
    if (running < 0 && firstDeficitDay === null) {
      firstDeficitDay = key;
    }
  }

  const keys = [...days.keys()].sort();
  return { today, totalNow, keys, futureKeys, days, firstDeficitDay, horizonEnd };
}

function categoryLabel(
  categoryId: string | undefined,
  subcategoryId: string | undefined,
  categoryById: Map<string, Category>,
): string {
  if (!categoryId) {
    return '';
  }
  const category = categoryById.get(categoryId);
  if (!category) {
    return '';
  }
  if (subcategoryId) {
    const sub = category.subcategories.find((s) => s.id === subcategoryId);
    if (sub) {
      return `${category.name} · ${sub.name}`;
    }
  }
  return category.name;
}

function describeTransaction(
  tx: Transaction,
  categoryById: Map<string, Category>,
  accountById: Map<string, Account>,
): string {
  if (tx.kind === 'transfer') {
    const from = accountById.get(tx.accountId)?.name ?? 'Счёт';
    const to = tx.toAccountId ? accountById.get(tx.toAccountId)?.name ?? 'Счёт' : '—';
    return `Перевод: ${from} → ${to}`;
  }
  const label = categoryLabel(tx.categoryId, tx.subcategoryId, categoryById);
  if (label) {
    return label;
  }
  return tx.kind === 'income' ? 'Доход' : 'Расход';
}

function describeRuleDefault(
  rule: RecurringRule,
  categoryById: Map<string, Category>,
): string {
  const label = categoryLabel(rule.categoryId, rule.subcategoryId, categoryById);
  if (label) {
    return label;
  }
  return rule.kind === 'income' ? 'Доход' : 'Расход';
}

/** Человеческое «через N дней» / «сегодня». */
export function inDays(from: DayKey, to: DayKey): string {
  const diff =
    (Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10)) -
      Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10))) / 86_400_000;
  if (diff <= 0) {
    return 'сегодня';
  }
  return `через ${diff} ${pluralRu(diff, 'день', 'дня', 'дней')}`;
}
