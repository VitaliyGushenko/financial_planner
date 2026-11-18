import { DayKey, addDaysToKey, weekdayOf } from '../day-key';
import { round2 } from '../money';
import { Account, Category, OperationKind } from '../models';
import { findNumber, parseNumberAt, tokenize } from './number-words';

/**
 * Разбор фразы в черновик операции: «потратил пятьсот рублей на продукты вчера».
 *
 * Правила намеренно простые и предсказуемые: словари + синонимы + разбор чисел.
 * Ничего не сохраняется — результат только заполняет форму, пользователь
 * проверяет и подтверждает. Чистая функция, поэтому покрыта unit-тестами.
 */

/** Поля формы, которые удалось распознать (подсвечиваем их в форме). */
export type VoiceField = 'kind' | 'amount' | 'category' | 'account' | 'toAccount' | 'date';

export interface VoiceContext {
  categories: readonly Category[];
  accounts: readonly Account[];
  /** Сегодняшний ключ дня — чтобы «вчера» и «5 ноября» не зависели от часов. */
  today: DayKey;
}

export interface VoiceDraft {
  kind: OperationKind;
  amount: number | null;
  accountId: string;
  toAccountId: string;
  categoryId: string;
  subcategoryId: string;
  date: DayKey;
  /** Исходная фраза — сохраняем в заметку, чтобы было видно, откуда данные. */
  note: string;
  hints: Record<VoiceField, boolean>;
  /** Что не распознано — подсказка пользователю перед сохранением. */
  unresolved: string[];
}

const INCOME_WORDS = new Set([
  'получил',
  'получила',
  'получили',
  'пришло',
  'пришли',
  'зарплата',
  'зарплату',
  'зарплаты',
  'зарплатой',
  'зп',
  'аванс',
  'аванса',
  'премия',
  'премию',
  'доход',
  'зачислили',
  'начислили',
  'капнуло',
]);

const EXPENSE_WORDS = new Set([
  'потратил',
  'потратила',
  'потратили',
  'купил',
  'купила',
  'купили',
  'оплатил',
  'оплатила',
  'оплатили',
  'заплатил',
  'заплатила',
  'заплатили',
  'истратил',
  'истратила',
  'расход',
  'списалось',
  'списали',
  'скинул',
  'скинула',
]);

const TRANSFER_WORDS = new Set([
  'перевел',
  'перевела',
  'перевели',
  'перевод',
  'перевести',
  'перекинул',
  'перекинула',
  'перекинуть',
]);

const RELATIVE_DAYS = new Map<string, number>([
  ['сегодня', 0],
  ['вчера', -1],
  ['позавчера', -2],
  ['завтра', 1],
  ['послезавтра', 2],
]);

const MONTHS = new Map<string, number>([
  ['января', 1],
  ['февраля', 2],
  ['марта', 3],
  ['апреля', 4],
  ['мая', 5],
  ['июня', 6],
  ['июля', 7],
  ['августа', 8],
  ['сентября', 9],
  ['октября', 10],
  ['ноября', 11],
  ['декабря', 12],
]);

const ORDINAL_DAYS = new Map<string, number>([
  ['первого', 1],
  ['второго', 2],
  ['третьего', 3],
  ['четвертого', 4],
  ['пятого', 5],
  ['шестого', 6],
  ['седьмого', 7],
  ['восьмого', 8],
  ['девятого', 9],
  ['десятого', 10],
  ['одиннадцатого', 11],
  ['двенадцатого', 12],
  ['тринадцатого', 13],
  ['четырнадцатого', 14],
  ['пятнадцатого', 15],
  ['шестнадцатого', 16],
  ['семнадцатого', 17],
  ['восемнадцатого', 18],
  ['девятнадцатого', 19],
  ['двадцатого', 20],
  ['тридцатого', 30],
]);

const COMPOUND_ORDINALS = new Map<string, number>([
  ['двадцать первого', 21],
  ['двадцать второго', 22],
  ['двадцать третьего', 23],
  ['двадцать четвертого', 24],
  ['двадцать пятого', 25],
  ['двадцать шестого', 26],
  ['двадцать седьмого', 27],
  ['двадцать восьмого', 28],
  ['двадцать девятого', 29],
  ['тридцать первого', 31],
]);

const PLAIN_DAY = /^\d{1,2}$/u;

/** Дни недели: 0 — понедельник (как в weekdayOf). */
const WEEKDAYS = new Map<string, number>([
  ['понедельник', 0],
  ['вторник', 1],
  ['среда', 2],
  ['среду', 2],
  ['четверг', 3],
  ['пятница', 4],
  ['пятницу', 4],
  ['суббота', 5],
  ['субботу', 5],
  ['воскресенье', 6],
]);

/** Единицы для «через …» и «… назад», в днях. */
const RELATIVE_UNITS = new Map<string, number>([
  ['день', 1],
  ['дня', 1],
  ['дней', 1],
  ['неделя', 7],
  ['недели', 7],
  ['неделю', 7],
  ['недель', 7],
  ['месяц', 30],
  ['месяца', 30],
  ['месяцев', 30],
]);

/** «18.11» или «18.11.2026». */
const NUMERIC_DATE = /^(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?$/u;

const RUBLE_WORDS = new Set(['рубль', 'рубля', 'рублей', 'руб', 'р', 'рубчик', 'рубчика', 'рубчиков']);
const KOPECK_WORDS = new Set(['копейка', 'копейки', 'копеек', 'коп', 'копейку']);

const CASH_WORDS = new Set(['наличка', 'наличку', 'наличкой', 'наличные', 'наличных', 'наличными', 'нал', 'кэш', 'кэшем', 'кэша', 'налом']);
const CARD_WORDS = new Set(['карта', 'карту', 'карты', 'карте', 'картой', 'карточек', 'карточка', 'карточки', 'карточкой', 'пластик', 'пластиком', 'кредитка', 'кредитку', 'кредиткой']);

/** Синонимы → канонические названия категорий (как в seed.ts). */
const SYNONYMS: ReadonlyArray<readonly [phrase: string, category: string, subcategory?: string]> = [
  ['еда', 'Продукты'],
  ['продукты', 'Продукты'],
  ['продуктов', 'Продукты'],
  ['магазин', 'Продукты'],
  ['супермаркет', 'Продукты'],
  ['пятерочка', 'Продукты'],
  ['перекресток', 'Продукты'],
  ['ашан', 'Продукты'],
  ['лента', 'Продукты'],
  ['доставка', 'Продукты', 'Доставка'],
  ['заправка', 'Транспорт', 'Бензин'],
  ['бензин', 'Транспорт', 'Бензин'],
  ['бензина', 'Транспорт', 'Бензин'],
  ['азс', 'Транспорт', 'Бензин'],
  ['топливо', 'Транспорт', 'Бензин'],
  ['такси', 'Транспорт', 'Такси'],
  ['метро', 'Транспорт', 'Проезд'],
  ['автобус', 'Транспорт', 'Проезд'],
  ['проезд', 'Транспорт', 'Проезд'],
  ['маршрутка', 'Транспорт', 'Проезд'],
  ['транспорт', 'Транспорт'],
  ['аренда', 'Жильё', 'Аренда'],
  ['аренду', 'Жильё', 'Аренда'],
  ['квартира', 'Жильё', 'Аренда'],
  ['квартиру', 'Жильё', 'Аренда'],
  ['коммуналка', 'Жильё', 'Коммуналка'],
  ['коммуналку', 'Жильё', 'Коммуналка'],
  ['жкх', 'Жильё', 'Коммуналка'],
  ['интернет', 'Жильё', 'Интернет'],
  ['связь', 'Связь', 'Мобильная связь'],
  ['телефон', 'Связь', 'Мобильная связь'],
  ['мобилка', 'Связь', 'Мобильная связь'],
  ['симка', 'Связь', 'Мобильная связь'],
  ['аптека', 'Здоровье', 'Лекарства'],
  ['аптеку', 'Здоровье', 'Лекарства'],
  ['лекарства', 'Здоровье', 'Лекарства'],
  ['таблетки', 'Здоровье', 'Лекарства'],
  ['врач', 'Здоровье', 'Врачи'],
  ['доктор', 'Здоровье', 'Врачи'],
  ['поликлиника', 'Здоровье', 'Врачи'],
  ['стоматолог', 'Здоровье', 'Врачи'],
  ['одежда', 'Одежда'],
  ['одежду', 'Одежда'],
  ['кроссовки', 'Одежда'],
  ['футболка', 'Одежда'],
  ['куртка', 'Одежда'],
  ['обувь', 'Одежда'],
  ['кино', 'Развлечения'],
  ['кафе', 'Развлечения'],
  ['ресторан', 'Развлечения'],
  ['бар', 'Развлечения'],
  ['концерт', 'Развлечения'],
  ['подписка', 'Развлечения'],
  ['зарплата', 'Зарплата'],
  ['зарплату', 'Зарплата'],
  ['зп', 'Зарплата'],
  ['получка', 'Зарплата'],
  ['премия', 'Зарплата', 'Премия'],
  ['премию', 'Зарплата', 'Премия'],
  ['аванс', 'Аванс'],
  ['аванса', 'Аванс'],
];

/** Нижний регистр, без «ё» и пунктуации. */
function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

/**
 * Похожи ли слова: «карта»/«карты», «продукты»/«продукт», «жильё»/«жилья».
 * Сравниваем первые 4–5 букв — этого хватает для падежей и не склеивает
 * разные слова.
 */
function similar(a: string, b: string): boolean {
  if (!a || !b) {
    return false;
  }
  if (a === b) {
    return true;
  }
  const shortest = Math.min(a.length, b.length);
  if (shortest < 4) {
    return false;
  }
  const prefix = shortest <= 5 ? 4 : 5;
  return a.slice(0, prefix) === b.slice(0, prefix);
}

function blank(tokens: string[], start: number, end: number): void {
  for (let i = start; i < end && i < tokens.length; i++) {
    tokens[i] = '';
  }
}

function makeDayKey(year: number, month: number, day: number): DayKey | null {
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day < 1 || day > daysInMonth) {
    return null;
  }
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

interface DateMatch {
  date: DayKey | null;
  ranges: Array<[number, number]>;
}

function dayBefore(tokens: readonly string[], monthIndex: number): { day: number; from: number } | null {
  const prev = tokens[monthIndex - 1] ?? '';
  if (PLAIN_DAY.test(prev)) {
    return { day: Number(prev), from: monthIndex - 1 };
  }
  const ordinal = ORDINAL_DAYS.get(prev);
  if (ordinal !== undefined) {
    return { day: ordinal, from: monthIndex - 1 };
  }
  // «18-го ноября»: после токенизации это «18», «го», «ноября».
  const beforeSuffix = tokens[monthIndex - 2] ?? '';
  if (PLAIN_DAY.test(beforeSuffix) && (prev === 'го' || prev === 'ого')) {
    return { day: Number(beforeSuffix), from: monthIndex - 2 };
  }
  const compound = COMPOUND_ORDINALS.get(`${beforeSuffix} ${prev}`);
  if (compound !== undefined) {
    return { day: compound, from: monthIndex - 2 };
  }
  return null;
}

/** Дата из фразы: «вчера», «в пятницу», «5 ноября», «через неделю», «18.11». */
function extractDate(tokens: readonly string[], today: DayKey): DateMatch {
  // 1. «сегодня», «вчера», «позавчера», «завтра», «послезавтра».
  for (let i = 0; i < tokens.length; i++) {
    const delta = RELATIVE_DAYS.get(tokens[i]);
    if (delta !== undefined) {
      return { date: addDaysToKey(today, delta), ranges: [[i, i + 1]] };
    }
  }

  const [todayYear, todayMonth] = today.split('-').map(Number);

  // 2. «18.11», «18.11.2026».
  for (let i = 0; i < tokens.length; i++) {
    const numeric = NUMERIC_DATE.exec(tokens[i]);
    if (!numeric) {
      continue;
    }
    const rawYear = numeric[3] ? Number(numeric[3]) : todayYear;
    const year = rawYear < 100 ? 2000 + rawYear : rawYear;
    const key = makeDayKey(year, Number(numeric[2]), Number(numeric[1]));
    if (key) {
      return { date: key, ranges: [[i, i + 1]] };
    }
  }

  // 3. День недели: «в пятницу» — ближайшая пятница.
  for (let i = 0; i < tokens.length; i++) {
    const weekday = WEEKDAYS.get(tokens[i]);
    if (weekday === undefined) {
      continue;
    }
    const back = (weekdayOf(today) - weekday + 7) % 7;
    const delta = back === 0 ? 0 : back > 3 ? 7 - back : -back;
    const from = tokens[i - 1] === 'в' || tokens[i - 1] === 'во' ? i - 1 : i;
    return { date: addDaysToKey(today, delta), ranges: [[from, i + 1]] };
  }

  // 4. «три дня назад», «неделю назад», «месяц назад».
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] !== 'назад') {
      continue;
    }
    const unitIndex = i - 1;
    const unit = RELATIVE_UNITS.get(tokens[unitIndex] ?? '');
    if (unit === undefined) {
      continue;
    }
    let count = 1;
    let from = unitIndex;
    for (let j = Math.max(0, unitIndex - 3); j < unitIndex; j++) {
      const number = parseNumberAt(tokens, j);
      if (number && number.end === unitIndex) {
        count = number.value;
        from = j;
        break;
      }
    }
    return { date: addDaysToKey(today, -count * unit), ranges: [[from, i + 1]] };
  }

  // 5. «через неделю», «через три дня».
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] !== 'через') {
      continue;
    }
    const number = parseNumberAt(tokens, i + 1);
    const unitIndex = number ? number.end : i + 1;
    const unit = RELATIVE_UNITS.get(tokens[unitIndex] ?? '');
    if (unit === undefined) {
      continue;
    }
    const count = number?.value ?? 1;
    return { date: addDaysToKey(today, count * unit), ranges: [[i, unitIndex + 1]] };
  }

  // 6. «5 ноября», «двадцать пятого сентября», «18-го ноября».
  for (let i = 0; i < tokens.length; i++) {
    const month = MONTHS.get(tokens[i]);
    if (month === undefined) {
      continue;
    }
    const day = dayBefore(tokens, i);
    if (day) {
      const key = makeDayKey(todayYear, month, day.day);
      if (key) {
        return { date: key, ranges: [[day.from, i + 1]] };
      }
    }
  }

  // 7. «5 числа», «пятого», «двадцать первого».
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const next = tokens[i + 1] ?? '';
    const withChisla = next === 'числа';

    const compound = COMPOUND_ORDINALS.get(`${token} ${next}`);
    if (compound !== undefined) {
      const key = makeDayKey(todayYear, todayMonth, compound);
      if (key) {
        return { date: key, ranges: [[i, i + (withChisla ? 3 : 2)]] };
      }
    }

    const ordinal = ORDINAL_DAYS.get(token);
    if (ordinal !== undefined) {
      const key = makeDayKey(todayYear, todayMonth, ordinal);
      if (key) {
        return { date: key, ranges: [[i, i + (withChisla ? 2 : 1)]] };
      }
    }

    if (PLAIN_DAY.test(token) && (withChisla || next === 'го' || next === 'ого')) {
      const key = makeDayKey(todayYear, todayMonth, Number(token));
      if (key) {
        return { date: key, ranges: [[i, i + 2]] };
      }
    }
  }

  return { date: null, ranges: [] };
}

/** Сумма: число, копейки и «с половиной». */
function extractAmount(tokens: readonly string[]): number | null {
  const match = findNumber(tokens);
  if (!match) {
    return null;
  }

  const rest = tokens.slice(match.end);
  let index = 0;

  // «пятьсот сорок копеек» без слова «рублей» — число означает копейки.
  if (KOPECK_WORDS.has(rest[index] ?? '')) {
    return round2(match.value / 100);
  }

  let value = match.value;

  // «пять с половиной рублей» → 5.50.
  if (rest[index] === 'с' && rest[index + 1] === 'половиной') {
    value += 0.5;
    index += 2;
  }

  if (RUBLE_WORDS.has(rest[index] ?? '')) {
    index += 1;
  }

  const kopecks = parseNumberAt(rest, index);
  if (kopecks && kopecks.value > 0 && kopecks.value < 100) {
    const after = rest[kopecks.end] ?? '';
    if (KOPECK_WORDS.has(after)) {
      value = round2(value + kopecks.value / 100);
    }
  }

  return round2(value);
}

interface ResolvedCategory {
  categoryId: string;
  subcategoryId: string;
  kind: OperationKind;
}

/** Категория: сначала по названиям из настроек, потом по словарю синонимов. */
function extractCategory(tokens: readonly string[], ctx: VoiceContext, kind: OperationKind | null): ResolvedCategory | null {
  const pool = kind ? ctx.categories.filter((category) => category.kind === kind) : ctx.categories;

  for (const category of pool) {
    if (!tokens.some((token) => similar(normalizeName(token), normalizeName(category.name)))) {
      continue;
    }
    const sub = category.subcategories.find((item) =>
      tokens.some((token) => similar(normalizeName(token), normalizeName(item.name))),
    );
    return { categoryId: category.id, subcategoryId: sub?.id ?? '', kind: category.kind };
  }

  for (const [phrase, categoryName, subcategoryName] of SYNONYMS) {
    if (!tokens.includes(phrase)) {
      continue;
    }
    const category = pool.find((item) => similar(normalizeName(item.name), normalizeName(categoryName)));
    if (!category) {
      continue;
    }
    const sub = subcategoryName
      ? category.subcategories.find((item) => similar(normalizeName(item.name), normalizeName(subcategoryName)))
      : undefined;
    return { categoryId: category.id, subcategoryId: sub?.id ?? '', kind: category.kind };
  }

  return null;
}

interface AccountMatch {
  id: string;
  before: string;
}

/** Счета: по названию или по типу («карта», «наличка»). */
function findAccounts(tokens: readonly string[], accounts: readonly Account[]): AccountMatch[] {
  const matches: AccountMatch[] = [];
  const seen = new Set<string>();

  const add = (account: Account | undefined, before: string): void => {
    if (account && !seen.has(account.id)) {
      seen.add(account.id);
      matches.push({ id: account.id, before });
    }
  };

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token) {
      continue;
    }
    const before = tokens[i - 1] ?? '';
    const byName = accounts.find((account) => similar(normalizeName(account.name), normalizeName(token)));
    if (byName) {
      add(byName, before);
      continue;
    }
    if (CASH_WORDS.has(token)) {
      add(accounts.find((account) => account.type === 'cash'), before);
    } else if (CARD_WORDS.has(token)) {
      add(accounts.find((account) => account.type === 'card'), before);
    }
  }

  return matches;
}

/** Разобрать фразу в черновик операции. */
export function parseVoice(text: string, ctx: VoiceContext): VoiceDraft {
  const tokens = tokenize(text);
  const hints: Record<VoiceField, boolean> = {
    kind: false,
    amount: false,
    category: false,
    account: false,
    toAccount: false,
    date: false,
  };

  // 1. Тип операции — по глаголу/существительному.
  let detectedKind: OperationKind | null = null;
  for (const token of tokens) {
    if (TRANSFER_WORDS.has(token)) {
      detectedKind = 'transfer';
      break;
    }
    if (INCOME_WORDS.has(token)) {
      detectedKind = 'income';
      break;
    }
    if (EXPENSE_WORDS.has(token)) {
      detectedKind = 'expense';
      break;
    }
  }
  hints.kind = detectedKind !== null;

  // 2. Дата — до суммы, чтобы «5 ноября» не стало суммой 5.
  const { date, ranges } = extractDate(tokens, ctx.today);
  for (const [start, end] of ranges) {
    blank(tokens, start, end);
  }
  hints.date = date !== null;

  // 3. Сумма.
  const amount = extractAmount(tokens);
  hints.amount = amount !== null;

  // 4. Категория.
  const category = detectedKind === 'transfer' ? null : extractCategory(tokens, ctx, detectedKind);
  hints.category = category !== null;

  const kind: OperationKind = detectedKind ?? category?.kind ?? 'expense';

  // 5. Счета.
  const defaultAccountId = ctx.accounts[0]?.id ?? '';
  const accountMatches = findAccounts(tokens, ctx.accounts);
  let accountId = defaultAccountId;
  let toAccountId = '';

  if (kind === 'transfer') {
    if (accountMatches.length >= 2) {
      accountId = accountMatches[0].id;
      toAccountId = accountMatches[1].id;
      hints.account = true;
      hints.toAccount = true;
    } else if (accountMatches.length === 1) {
      const match = accountMatches[0];
      const isTarget = match.before === 'на' || match.before === 'в';
      if (isTarget) {
        toAccountId = match.id;
        const source = ctx.accounts.find((account) => account.id !== toAccountId);
        accountId = source?.id ?? '';
        hints.toAccount = true;
      } else {
        accountId = match.id;
        hints.account = true;
      }
    }
  } else if (accountMatches.length > 0) {
    accountId = accountMatches[0].id;
    hints.account = true;
  }

  const unresolved: string[] = [];
  if (amount === null) {
    unresolved.push('сумма');
  }
  if (kind === 'transfer') {
    if (!accountId || !toAccountId) {
      unresolved.push('счета перевода');
    }
  } else if (!category) {
    unresolved.push('категория');
  }

  return {
    kind,
    amount,
    accountId,
    toAccountId,
    categoryId: category?.categoryId ?? '',
    subcategoryId: category?.subcategoryId ?? '',
    date: date ?? ctx.today,
    note: text.trim(),
    hints,
    unresolved,
  };
}
