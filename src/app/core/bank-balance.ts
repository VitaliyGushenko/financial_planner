import { Transaction } from './models';
import { round2 } from './money';

/**
 * Сверка баланса с банком по последнему уведомлению.
 *
 * В пуше есть `OSTATOK` — остаток сразу после операции. Если после этого
 * в приложении были ещё операции, ожидаемый остаток = OSTATOK + их сумма.
 * Расхождение показывает, что баланс в приложении и в банке разошлись.
 */

export interface BankMark {
  amount: number;
  /** Момент из текста уведомления (локальное время телефона). */
  at: Date;
  /** Ключ дня «YYYY-MM-DD» из уведомления. */
  dateKey: string;
  transactionId: string;
}

export interface Reconciliation {
  mark: BankMark;
  /** Ожидаемый остаток с учётом операций после уведомления. */
  expected: number;
  /** Текущий остаток в приложении. */
  current: number;
  /** current − expected. Положительное — в приложении больше, чем в банке. */
  drift: number;
  /** Сумма операций после отметки (со знаком). */
  after: number;
  /** В тот же день есть операции без времени — порядок мог быть другим. */
  sameDayAmbiguous: boolean;
}

export function parseBankBalance(rawText?: string): number | null {
  const match = /OSTATOK\s+([0-9]+(?:[.,][0-9]{1,2})?)\s+BYN/i.exec(rawText ?? '');
  if (!match) {
    return null;
  }
  const value = Number(match[1].replace(',', '.'));
  return Number.isFinite(value) ? value : null;
}

export function parseBankDate(rawText?: string): { at: Date; dateKey: string } | null {
  const match =
    /DATA\s+(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/i.exec(rawText ?? '');
  if (!match) {
    return null;
  }
  const [, day, month, year, hour, minute, second] = match;
  const at = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  );
  if (Number.isNaN(at.getTime())) {
    return null;
  }
  return { at, dateKey: `${year}-${month}-${day}` };
}

/** Последнее банковское уведомление с OSTATOK по счёту. */
export function latestBankMark(
  transactions: readonly Transaction[],
  accountId: string,
): BankMark | null {
  let best: BankMark | null = null;
  for (const tx of transactions) {
    if (tx.accountId !== accountId || tx.source !== 'bank') {
      continue;
    }
    const amount = parseBankBalance(tx.rawText);
    if (amount == null) {
      continue;
    }
    const parsed = parseBankDate(tx.rawText);
    const at = parsed?.at ?? new Date(`${tx.date}T23:59:59`);
    if (Number.isNaN(at.getTime())) {
      continue;
    }
    if (!best || at.getTime() > best.at.getTime()) {
      best = {
        amount,
        at,
        dateKey: parsed?.dateKey ?? tx.date,
        transactionId: tx.id,
      };
    }
  }
  return best;
}

export function accountDelta(tx: Transaction, accountId: string): number {
  if (tx.kind === 'transfer') {
    if (tx.accountId === accountId) {
      return -tx.amount;
    }
    if (tx.toAccountId === accountId) {
      return tx.amount;
    }
    return 0;
  }
  if (tx.accountId !== accountId) {
    return 0;
  }
  return tx.kind === 'income' ? tx.amount : -tx.amount;
}

function txMoment(tx: Transaction): Date | null {
  const raw = tx.createdAt as { toDate?: () => Date } | Date | null | undefined;
  if (raw instanceof Date) {
    return raw;
  }
  if (raw && typeof raw.toDate === 'function') {
    return raw.toDate();
  }
  return null;
}

function isAfter(tx: Transaction, mark: BankMark): boolean {
  const moment = txMoment(tx);
  if (moment) {
    return moment.getTime() > mark.at.getTime();
  }
  return tx.date > mark.dateKey;
}

export function reconcileAccount(
  currentBalance: number,
  mark: BankMark,
  transactions: readonly Transaction[],
  accountId: string,
): Reconciliation {
  let after = 0;
  let sameDayAmbiguous = false;

  for (const tx of transactions) {
    if (tx.applied === false) {
      continue;
    }
    if (tx.id === mark.transactionId) {
      continue;
    }
    if (tx.date < mark.dateKey) {
      continue;
    }
    if (!isAfter(tx, mark)) {
      if (tx.date === mark.dateKey && !txMoment(tx)) {
        sameDayAmbiguous = true;
      }
      continue;
    }
    after += accountDelta(tx, accountId);
  }

  const expected = round2(mark.amount + after);
  const current = round2(currentBalance);
  return {
    mark,
    expected,
    current,
    drift: round2(current - expected),
    after: round2(after),
    sameDayAmbiguous,
  };
}
