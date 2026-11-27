import { BankRule, Transaction } from './models';

/**
 * Правила автоматической категоризации банковских операций.
 *
 * Уведомления банка приходят транслитом («OPLATA 62.46 BYN KARTA #1310 … OZON»),
 * поэтому сравнение идёт по нормализованной строке: верхний регистр, ё→е,
 * схлопнутые пробелы. Слова ищутся как подстроки — так «WILDBERRIES»
 * находится и в «WILDBERRIES>G MINSK>BLR».
 */

/** Нормализация текста для сравнения с ключевыми словами. */
export function normalizeForMatch(value: string | null | undefined): string {
  if (!value) {
    return '';
  }
  return value
    .toUpperCase()
    .replace(/Ё/g, 'Е')
    .replace(/[«»"'`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Совпадает ли правило с текстом. Отключённые и пустые правила не срабатывают. */
export function ruleMatches(rule: BankRule, text: string): boolean {
  if (rule.enabled === false) {
    return false;
  }
  const keywords = rule.keywords.map(normalizeForMatch).filter((word) => word.length > 0);
  if (!keywords.length) {
    return false;
  }
  const haystack = normalizeForMatch(text);
  if (!haystack) {
    return false;
  }
  return rule.match === 'all'
    ? keywords.every((word) => haystack.includes(word))
    : keywords.some((word) => haystack.includes(word));
}

/**
 * Самое приоритетное подходящее правило для текста и типа операции.
 * При равном приоритете выигрывает правило с большим числом слов (оно точнее).
 */
export function pickBankRule(
  rules: readonly BankRule[],
  text: string,
  kind: 'income' | 'expense',
): BankRule | null {
  const candidates = rules
    .filter((rule) => rule.kind === kind && rule.categoryId && ruleMatches(rule, text))
    .sort(
      (a, b) =>
        (b.priority ?? 0) - (a.priority ?? 0) ||
        b.keywords.length - a.keywords.length ||
        a.keywords.join(',').localeCompare(b.keywords.join(',')),
    );
  return candidates[0] ?? null;
}

/** Строка для поиска по операции: мерчант, заметка и исходный текст пуша. */
export function transactionHaystack(tx: Pick<Transaction, 'merchant' | 'note' | 'rawText'>): string {
  return [tx.merchant, tx.note, tx.rawText].filter(Boolean).join(' ');
}

export interface BulkAssignment {
  id: string;
  categoryId: string;
  subcategoryId?: string;
  ruleTitle: string;
}

/**
 * Какие операции без категории можно разметить правилами.
 * Переводы и непроведённые операции не трогаем.
 */
export function planBulkCategorization(
  transactions: readonly Transaction[],
  rules: readonly BankRule[],
): BulkAssignment[] {
  const result: BulkAssignment[] = [];
  for (const tx of transactions) {
    if (tx.applied === false || tx.kind === 'transfer' || tx.categoryId) {
      continue;
    }
    const rule = pickBankRule(rules, transactionHaystack(tx), tx.kind);
    if (!rule?.categoryId) {
      continue;
    }
    result.push({
      id: tx.id,
      categoryId: rule.categoryId,
      subcategoryId: rule.subcategoryId,
      ruleTitle: rule.keywords.join(', '),
    });
  }
  return result;
}

/**
 * Ключевое слово для правила из операции: мерчант, а если его нет — заметка.
 * Обрезаем длинные хвосты и служебные окончания.
 */
export function keywordFromTransaction(
  tx: Pick<Transaction, 'merchant' | 'note'>,
): string | null {
  const source = (tx.merchant || tx.note || '').trim();
  if (!source) {
    return null;
  }
  const cleaned = source
    .replace(/\s+/g, ' ')
    .replace(/[.,;:]+$/, '')
    .trim();
  if (!cleaned) {
    return null;
  }
  return cleaned.length > 40 ? cleaned.slice(0, 40).trim() : cleaned;
}

/** Разбор строки ключевых слов: «ozon, wildberries» → ['ozon', 'wildberries']. */
export function parseKeywordsInput(value: string): string[] {
  return value
    .split(/[,;\n]+/)
    .map((word) => word.trim())
    .filter((word) => word.length > 0);
}
