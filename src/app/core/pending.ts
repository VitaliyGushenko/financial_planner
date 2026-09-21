import { Category, OperationKind, RecurringRule, Transaction } from './models';
import { DayKey, addDaysToKey } from './day-key';
import { occurrencesOfRule } from './projection';

/**
 * Платежи, ожидающие подтверждения: дата наступила, но пользователь ещё
 * не подтвердил, что деньги реально пришли или были потрачены.
 *  - плановые разовые операции (applied = false, дата <= сегодня);
 *  - вхождения правил, по которым ещё нет записанной операции.
 */

export interface PendingItem {
  /** «tx:{id}» или «rule:{ruleId}@{date}». */
  id: string;
  kind: 'transaction' | 'recurring';
  date: DayKey;
  title: string;
  kindOf: OperationKind;
  amount: number;
  /** Для разовой плановой операции. */
  txId?: string;
  /** Для вхождения правила. */
  ruleId?: string;
}

export interface PendingInput {
  transactions: Transaction[];
  rules: RecurringRule[];
  categories: Category[];
  today: DayKey;
  /** Как далеко назад смотреть по датам (по умолчанию 90 дней). */
  windowDays?: number;
}

export function collectPending(input: PendingInput): PendingItem[] {
  const windowStart = addDaysToKey(input.today, -(input.windowDays ?? 90) + 1);
  const categoryById = new Map(input.categories.map((c) => [c.id, c]));
  const items: PendingItem[] = [];

  const label = (categoryId?: string, subcategoryId?: string): string => {
    const category = categoryId ? categoryById.get(categoryId) : undefined;
    if (!category) {
      return '';
    }
    const sub = category.subcategories.find((s) => s.id === subcategoryId);
    return sub ? `${category.name} · ${sub.name}` : category.name;
  };
  const fallbackTitle = (kind: OperationKind): string =>
    kind === 'income' ? 'Доход' : kind === 'expense' ? 'Расход' : 'Перевод';

  // Плановые разовые операции, чья дата наступила.
  for (const tx of input.transactions) {
    if (tx.applied === false && tx.date <= input.today) {
      items.push({
        id: `tx:${tx.id}`,
        kind: 'transaction',
        date: tx.date,
        title:
          (tx.kind === 'transfer'
            ? 'Перевод'
            : label(tx.categoryId, tx.subcategoryId)) || fallbackTitle(tx.kind),
        kindOf: tx.kind,
        amount: tx.amount,
        txId: tx.id,
      });
    }
  }

  // Вхождения правил без подтверждённой операции.
  const confirmed = new Set(
    input.transactions.filter((t) => t.ruleId).map((t) => `${t.ruleId}@${t.date}`),
  );
  for (const rule of input.rules) {
    for (const date of occurrencesOfRule(rule, windowStart, input.today)) {
      if (confirmed.has(`${rule.id}@${date}`)) {
        continue;
      }
      if (rule.skippedDates?.includes(date)) {
        continue;
      }
      items.push({
        id: `rule:${rule.id}@${date}`,
        kind: 'recurring',
        date,
        title: rule.title?.trim() || label(rule.categoryId, rule.subcategoryId) || fallbackTitle(rule.kind),
        kindOf: rule.kind,
        amount: rule.amount,
        ruleId: rule.id,
      });
    }
  }

  return items.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
}
