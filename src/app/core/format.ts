import { Timestamp } from '@angular/fire/firestore';

import { DayKey, formatDayKeyRelative, todayKey } from './day-key';

/** Число с разделителями: 123456 → «123 456». */
export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '—';
  }
  return value.toLocaleString('ru-RU');
}

/** Деньги: 12345.6 → «12 345,60 ₽» (целые — без копеек). */
export function formatMoney(amount: number | null | undefined, currency = 'RUB'): string {
  if (amount === null || amount === undefined || Number.isNaN(amount)) {
    return '—';
  }
  try {
    return amount.toLocaleString('ru-RU', {
      style: 'currency',
      currency,
      maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
    });
  } catch {
    return `${formatNumber(amount)} ${currency}`;
  }
}

/** Со знаком: +500 ₽ / −1 200 ₽ — для операций. */
export function formatSignedMoney(amount: number, kind: 'income' | 'expense'): string {
  const abs = formatMoney(Math.abs(amount));
  return kind === 'income' ? `+${abs}` : `−${abs}`;
}

/** Ключ дня → «Сегодня», «Завтра», «21.09.2026». */
export function formatDay(key: DayKey, today: DayKey = todayKey()): string {
  return formatDayKeyRelative(key, today);
}

/** Дата в значение для `<input type="date">` (yyyy-MM-dd). */
export function toDateInputValue(value: Timestamp | Date | null | undefined): string {
  const date = toDateOrNull(value);
  if (!date) {
    return '';
  }
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function toDateOrNull(value: Timestamp | Date | null | undefined): Date | null {
  if (!value) {
    return null;
  }
  return value instanceof Date ? value : value.toDate();
}
