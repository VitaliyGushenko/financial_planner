import { normalizeForMatch } from './bank-rules';
import { DayKey, addMonthsToKey, diffInDays } from './day-key';
import { Category, Transaction } from './models';
import { round2 } from './money';

/**
 * Поиск регулярных платежей по истории.
 *
 * Смотрим группы «тип + мерчант + счёт»: минимум 3 операции в разных месяцах,
 * примерно одинаковые суммы и день месяца. Это кандидаты на правило повторения,
 * а не автоматическое создание — пользователь подтверждает.
 */

export interface RecurringSuggestion {
  id: string;
  title: string;
  kind: 'income' | 'expense';
  amount: number;
  categoryId?: string;
  subcategoryId?: string;
  accountId: string;
  day: number;
  occurrences: number;
  lastDate: DayKey;
  nextDate: DayKey;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function nextMonthlyDate(lastDate: DayKey, today: DayKey): DayKey {
  let next = addMonthsToKey(lastDate, 1);
  for (let guard = 0; guard < 120 && next <= today; guard += 1) {
    next = addMonthsToKey(next, 1);
  }
  return next;
}

export function detectRecurring(
  transactions: readonly Transaction[],
  _categories: readonly Category[],
  today: DayKey,
  limit = 5,
): RecurringSuggestion[] {
  const groups = new Map<string, Transaction[]>();

  for (const tx of transactions) {
    if (tx.applied === false || tx.kind === 'transfer') {
      continue;
    }
    const merchant = (tx.merchant || tx.note || '').trim();
    if (!merchant) {
      continue;
    }
    const key = `${tx.kind}|${normalizeForMatch(merchant)}|${tx.accountId}`;
    const list = groups.get(key) ?? [];
    list.push(tx);
    groups.set(key, list);
  }

  const suggestions: RecurringSuggestion[] = [];

  for (const [key, items] of groups) {
    if (items.length < 3) {
      continue;
    }
    const dates = [...new Set(items.map((tx) => tx.date))].sort();
    const months = new Set(dates.map((date) => date.slice(0, 7)));
    if (months.size < 3) {
      continue;
    }

    // Интервалы должны быть примерно месячными (25–35 дней).
    let monthly = true;
    for (let i = 1; i < dates.length; i += 1) {
      const gap = diffInDays(dates[i], dates[i - 1]);
      if (gap < 25 || gap > 35) {
        monthly = false;
        break;
      }
    }
    if (!monthly) {
      continue;
    }

    const amounts = items.map((tx) => Math.abs(tx.amount));
    const amount = round2(median(amounts));
    if (amount <= 0) {
      continue;
    }
    const tolerance = Math.max(amount * 0.3, 2);
    if (amounts.some((value) => Math.abs(value - amount) > tolerance)) {
      continue;
    }

    const days = dates.map((date) => Number(date.slice(8, 10)));
    const spread = Math.max(...days) - Math.min(...days);
    if (spread > 4) {
      continue;
    }

    const last = items.reduce((latest, tx) => (tx.date > latest.date ? tx : latest), items[0]);
    const merchant = (last.merchant || last.note || '').trim();
    if (!merchant) {
      continue;
    }

    // Самая частая категория среди этих операций.
    const pairs = new Map<string, { count: number; categoryId?: string; subcategoryId?: string }>();
    for (const tx of items) {
      const pairKey = `${tx.categoryId ?? ''}|${tx.subcategoryId ?? ''}`;
      const entry = pairs.get(pairKey) ?? {
        count: 0,
        categoryId: tx.categoryId,
        subcategoryId: tx.subcategoryId,
      };
      entry.count += 1;
      pairs.set(pairKey, entry);
    }
    const best = [...pairs.values()].sort((a, b) => b.count - a.count)[0];

    suggestions.push({
      id: key,
      title: merchant.length > 48 ? merchant.slice(0, 45).trim() : merchant,
      kind: last.kind === 'income' ? 'income' : 'expense',
      amount,
      categoryId: best?.categoryId,
      subcategoryId: best?.subcategoryId,
      accountId: last.accountId,
      day: Number(last.date.slice(8, 10)),
      occurrences: items.length,
      lastDate: last.date,
      nextDate: nextMonthlyDate(last.date, today),
    });
  }

  return suggestions
    .sort((a, b) => b.occurrences - a.occurrences || b.lastDate.localeCompare(a.lastDate))
    .slice(0, limit);
}
