/**
 * Работа с датами в виде ключей дня «YYYY-MM-DD».
 * Строки ISO сравниваются лексикографически — это и есть порядок дат,
 * поэтому вся проекция построена на строках: без часовых поясов и DST.
 */
export type DayKey = string;

const MS_PER_DAY = 86_400_000;

/** Date (локальная) → 'YYYY-MM-DD'. */
export function toDayKey(date: Date): DayKey {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/** 'YYYY-MM-DD' → Date (полдень UTC, чтобы не зависеть от пояса). */
export function fromDayKey(key: DayKey): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
}

/** Сегодняшний ключ дня. */
export function todayKey(): DayKey {
  return toDayKey(new Date());
}

export function isDayKey(value: unknown): value is DayKey {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function addDaysToKey(key: DayKey, days: number): DayKey {
  return toDayKey(new Date(fromDayKey(key).getTime() + days * MS_PER_DAY));
}

export function diffInDays(a: DayKey, b: DayKey): number {
  return Math.round((fromDayKey(a).getTime() - fromDayKey(b).getTime()) / MS_PER_DAY);
}

function daysInMonth(year: number, month1based: number): number {
  return new Date(Date.UTC(year, month1based, 0)).getUTCDate();
}

/** Прибавить месяцы с прижиманием дня: 31.01 + 1 мес → 28.02 (или 29.02). */
export function addMonthsToKey(key: DayKey, months: number): DayKey {
  const [y, m, d] = key.split('-').map(Number);
  const total = (y * 12 + (m - 1)) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12 + 12) % 12 + 1;
  const nd = Math.min(d, daysInMonth(ny, nm));
  return `${ny}-${String(nm).padStart(2, '0')}-${String(nd).padStart(2, '0')}`;
}

export function addYearsToKey(key: DayKey, years: number): DayKey {
  return addMonthsToKey(key, years * 12);
}

/** Ключи дней от from до to включительно (оба — ключи). */
export function eachDay(from: DayKey, to: DayKey): DayKey[] {
  const result: DayKey[] = [];
  for (let cur = from; cur <= to; cur = addDaysToKey(cur, 1)) {
    result.push(cur);
  }
  return result;
}

/** День недели ключа: 0 = понедельник … 6 = воскресенье. */
export function weekdayOf(key: DayKey): number {
  return (fromDayKey(key).getUTCDay() + 6) % 7;
}

/** Человеческая дата: «21.09.2026», опционально с месяцем словом — «21 сентября». */
export function formatDayKey(key: DayKey, withYear = true): string {
  const date = fromDayKey(key);
  const options: Intl.DateTimeFormatOptions = withYear
    ? { day: 'numeric', month: 'long', year: 'numeric' }
    : { day: 'numeric', month: 'long' };
  return date.toLocaleDateString('ru-RU', options).replace(/ г\.$/, '');
}

/** Коротко: «21.09.2026». */
export function formatDayKeyShort(key: DayKey): string {
  const [y, m, d] = key.split('-');
  return `${d}.${m}.${y}`;
}

/** «Сегодня», «Завтра», «Вчера», иначе — короткая дата. */
export function formatDayKeyRelative(key: DayKey, today: DayKey): string {
  const diff = diffInDays(key, today);
  if (diff === 0) return 'Сегодня';
  if (diff === 1) return 'Завтра';
  if (diff === -1) return 'Вчера';
  return formatDayKeyShort(key);
}

/** Русская форма числа: 1 день / 2 дня / 5 дней. */
export function pluralRu(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (last > 1 && last < 5) return few;
  if (last === 1) return one;
  return many;
}
