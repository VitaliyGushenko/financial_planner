import { round2 } from '../money';

/**
 * Числительные и суммы прописью: «пятьсот», «две тысячи пятьсот»,
 * «полторы тысячи», «120 тысяч», «2,5к».
 *
 * Распознавание речи возвращает сумму словами, поэтому её нужно
 * разобрать в число до заполнения формы. Функции чистые — тестируются
 * без браузера и микрофона.
 */

/** Найденное в тексте число: значение и границы в массиве токенов. */
export interface NumberMatch {
  value: number;
  /** Индекс первого токена числа. */
  start: number;
  /** Индекс сразу после последнего токена числа. */
  end: number;
}

const UNITS = new Map<string, number>([
  ['ноль', 0],
  ['нуль', 0],
  ['один', 1],
  ['одна', 1],
  ['одно', 1],
  ['одну', 1],
  ['два', 2],
  ['две', 2],
  ['двух', 2],
  ['три', 3],
  ['трех', 3],
  ['четыре', 4],
  ['четырех', 4],
  ['пять', 5],
  ['шесть', 6],
  ['семь', 7],
  ['восемь', 8],
  ['девять', 9],
  ['десять', 10],
  ['одиннадцать', 11],
  ['двенадцать', 12],
  ['тринадцать', 13],
  ['четырнадцать', 14],
  ['пятнадцать', 15],
  ['шестнадцать', 16],
  ['семнадцать', 17],
  ['восемнадцать', 18],
  ['девятнадцать', 19],
  ['двадцать', 20],
  ['тридцать', 30],
  ['сорок', 40],
  ['пятьдесят', 50],
  ['шестьдесят', 60],
  ['семьдесят', 70],
  ['восемьдесят', 80],
  ['девяносто', 90],
  ['сто', 100],
  ['двести', 200],
  ['триста', 300],
  ['четыреста', 400],
  ['пятьсот', 500],
  ['шестьсот', 600],
  ['семьсот', 700],
  ['восемьсот', 800],
  ['девятьсот', 900],
  // Разговорные «полтора рубля», «полсотни».
  ['полтора', 1.5],
  ['полторы', 1.5],
  ['полтораста', 150],
  ['полсотни', 50],
  ['полтинник', 50],
  ['полтос', 50],
]);

/** Множители: слово умножает накопленную группу (пять тысяч → 5000). */
const MULTIPLIERS = new Map<string, number>([
  ['тысяча', 1000],
  ['тысячи', 1000],
  ['тысяч', 1000],
  ['тыщу', 1000],
  ['тыща', 1000],
  ['тыщи', 1000],
  ['тыщ', 1000],
  ['тыс', 1000],
  ['косарь', 1000],
  ['косаря', 1000],
  ['косарей', 1000],
  ['штука', 1000],
  ['штуки', 1000],
  ['штук', 1000],
  ['штуку', 1000],
  ['сотня', 100],
  ['сотни', 100],
  ['сотен', 100],
  ['сотку', 100],
  ['сотка', 100],
  ['миллион', 1_000_000],
  ['миллиона', 1_000_000],
  ['миллионов', 1_000_000],
  ['млн', 1_000_000],
  ['лимон', 1_000_000],
  ['лимона', 1_000_000],
  ['миллиард', 1_000_000_000],
  ['млрд', 1_000_000_000],
]);

/** «120к», «2,5 тыс», «3 млн» — число с сокращением. */
const DIGIT_WITH_SUFFIX = /^(\d+(?:[.,]\d+)?)(к|тыс|тысяч|млн|млрд)$/u;
const PLAIN_DIGITS = /^\d+(?:[.,]\d+)?$/u;

/**
 * Текст → токены: строчные буквы, «ё» → «е», без пунктуации.
 * Десятичная запятая сохраняется: «2,5 тысячи» → ['2.5', 'тысячи'].
 */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/(\d),(\d)/g, '$1.$2')
    .split(/[^\p{L}\p{N}.]+/u)
    .map((token) => token.replace(/^\.+|\.+$/g, ''))
    .filter((token) => token.length > 0);
}

/** Разряд числа: 3 — сотни, 2 — десятки, 1 — единицы, 4 — «как есть» из цифр. */
function rankOf(value: number): number {
  if (value >= 100) {
    return 3;
  }
  if (value >= 20) {
    return 2;
  }
  return 1;
}

function valueOf(token: string): { value: number; rank: number } | null {
  const suffixed = DIGIT_WITH_SUFFIX.exec(token);
  if (suffixed) {
    const amount = parseFloat(suffixed[1].replace(',', '.'));
    const multiplier = suffixed[2];
    const factor = multiplier === 'млн' ? 1_000_000 : multiplier === 'млрд' ? 1_000_000_000 : 1000;
    return { value: amount * factor, rank: 4 };
  }
  if (PLAIN_DIGITS.test(token)) {
    return { value: parseFloat(token.replace(',', '.')), rank: 4 };
  }
  const value = UNITS.get(token);
  return value === undefined ? null : { value, rank: rankOf(value) };
}

/**
 * Разобрать число, начинающееся с токена `start`.
 * Возвращает null, если токен — не число.
 */
export function parseNumberAt(tokens: readonly string[], start: number): NumberMatch | null {
  let total = 0;
  let current = 0;
  let lastRank = 5;
  let lastMultiplier = 0;
  let end = start;
  let found = false;

  for (let i = start; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token) {
      break;
    }

    const multiplier = MULTIPLIERS.get(token);
    if (multiplier !== undefined) {
      // Множители идут по убыванию: «миллион двести тысяч» — можно,
      // «двести тысяч миллион» — уже другое число, останавливаемся.
      if (lastMultiplier !== 0 && multiplier >= lastMultiplier) {
        break;
      }
      current = current || 1;
      total += current * multiplier;
      current = 0;
      lastMultiplier = multiplier;
      lastRank = 5;
      end = i + 1;
      found = true;
      continue;
    }

    const parsed = valueOf(token);
    if (!parsed) {
      break;
    }
    // Разряды внутри группы убывают: «двести пятьдесят пять».
    if (found && parsed.rank >= lastRank) {
      break;
    }
    current += parsed.value;
    lastRank = parsed.rank;
    end = i + 1;
    found = true;
  }

  return found ? { value: round2(total + current), start, end } : null;
}

/** Первое число в тексте (нули пропускаем — сумма 0 в операции не бывает). */
export function findNumber(tokens: readonly string[]): NumberMatch | null {
  for (let i = 0; i < tokens.length; i++) {
    const match = parseNumberAt(tokens, i);
    if (match && match.value > 0) {
      return match;
    }
  }
  return null;
}

/** Число целиком из строки: «две тысячи пятьсот» → 2500. */
export function wordsToNumber(text: string): number | null {
  const tokens = tokenize(text);
  if (tokens.length === 0) {
    return null;
  }
  const match = parseNumberAt(tokens, 0);
  return match && match.end === tokens.length ? match.value : null;
}
