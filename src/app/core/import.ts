import { Account, Category, CategoryKind, OperationKind, Transaction, TransactionDraft } from './models';
import { findSubcategoryByPath } from './category-tree';
import { DayKey } from './day-key';
import { round2 } from './money';
import { Backup } from './export';

/**
 * Импорт операций из CSV и восстановление из JSON-бэкапа.
 *
 * Разбор и сопоставление — чистые функции (тесты без Firebase); запись
 * в Firestore делает вызывающий код. CSV, который отдаёт наш экспорт,
 * читается «как есть»: `;`, запятая в суммах, BOM.
 */

export interface ParsedRow {
  /** Номер строки в файле (шапка — 1), чтобы показать ошибки. */
  line: number;
  date: string;
  kind: OperationKind;
  amount: number;
  accountName: string;
  toAccountName: string;
  categoryName: string;
  subcategoryName: string;
  note: string;
  applied: boolean;
}

export interface CsvParseResult {
  rows: ParsedRow[];
  errors: string[];
}

interface HeaderIndex {
  date?: number;
  kind?: number;
  amount?: number;
  account?: number;
  toAccount?: number;
  category?: number;
  subcategory?: number;
  note?: number;
  applied?: number;
}

/** Разобрать CSV-текст в строки. Разделитель определяется автоматически. */
export function parseTransactionsCsv(text: string): CsvParseResult {
  const clean = text.replace(/^\uFEFF/, '');
  const delimiter = detectDelimiter(clean);
  const cells = parseCsv(clean, delimiter);
  const errors: string[] = [];

  if (cells.length === 0) {
    return { rows: [], errors: ['Файл пустой.'] };
  }

  const header = cells[0].map((cell) => normalizeName(cell));
  const index = mapHeader(header);
  const required: Array<[keyof HeaderIndex, string]> = [
    ['date', 'Дата'],
    ['amount', 'Сумма'],
    ['account', 'Счёт'],
  ];
  for (const [key, label] of required) {
    if (index[key] === undefined) {
      errors.push(`В шапке нет колонки «${label}».`);
    }
  }
  if (errors.length) {
    return { rows: [], errors };
  }

  const rows: ParsedRow[] = [];
  for (let i = 1; i < cells.length; i++) {
    const line = i + 1;
    const row = cells[i];
    if (row.every((cell) => cell.trim() === '')) {
      continue;
    }

    const date = (row[index.date!] ?? '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      errors.push(`Строка ${line}: дата «${date}» не в формате ГГГГ-ММ-ДД.`);
      continue;
    }

    const rawAmount = (row[index.amount!] ?? '').trim().replace(/\s/g, '').replace(',', '.');
    const amount = Number(rawAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      errors.push(`Строка ${line}: сумма «${row[index.amount!] ?? ''}» не число.`);
      continue;
    }

    const accountName = (row[index.account!] ?? '').trim();
    if (!accountName) {
      errors.push(`Строка ${line}: не указан счёт.`);
      continue;
    }

    const kind = parseKind(row[index.kind ?? -1] ?? '');
    const appliedRaw = (row[index.applied ?? -1] ?? '').trim().toLowerCase();

    rows.push({
      line,
      date,
      kind,
      amount: round2(amount),
      accountName,
      toAccountName: (row[index.toAccount ?? -1] ?? '').trim(),
      categoryName: (row[index.category ?? -1] ?? '').trim(),
      subcategoryName: (row[index.subcategory ?? -1] ?? '').trim(),
      note: (row[index.note ?? -1] ?? '').trim(),
      applied: !['нет', 'no', 'false', '0'].includes(appliedRaw),
    });
  }

  return { rows, errors };
}

/** Разделитель по первой непустой строке: `;` побеждает, если встречается чаще. */
function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/).find((line) => line.trim() !== '') ?? '';
  const counts = [
    { char: ';', count: (firstLine.match(/;/g) ?? []).length },
    { char: ',', count: (firstLine.match(/,/g) ?? []).length },
    { char: '\t', count: (firstLine.match(/\t/g) ?? []).length },
  ];
  return counts.sort((a, b) => b.count - a.count)[0].char;
}

function parseCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      row.push(cell);
      cell = '';
    } else if (char === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (char !== '\r') {
      cell += char;
    }
  }

  row.push(cell);
  if (row.length > 1 || row[0].trim() !== '') {
    rows.push(row);
  }
  return rows;
}

function mapHeader(header: string[]): HeaderIndex {
  const aliases: Record<string, keyof HeaderIndex> = {
    дата: 'date',
    date: 'date',
    тип: 'kind',
    type: 'kind',
    сумма: 'amount',
    amount: 'amount',
    счёт: 'account',
    счет: 'account',
    account: 'account',
    'счёт зачисления': 'toAccount',
    'счет зачисления': 'toAccount',
    категория: 'category',
    подкатегория: 'subcategory',
    заметка: 'note',
    проведена: 'applied',
  };
  const index: HeaderIndex = {};
  header.forEach((cell, position) => {
    const key = aliases[cell];
    if (key && index[key] === undefined) {
      index[key] = position;
    }
  });
  return index;
}

function parseKind(value: string): OperationKind {
  const normalized = value.trim().toLowerCase();
  if (normalized.startsWith('доход') || normalized === 'income') {
    return 'income';
  }
  if (normalized.startsWith('перевод') || normalized === 'transfer') {
    return 'transfer';
  }
  return 'expense';
}

export function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');
}

export interface MissingCategory {
  name: string;
  kind: CategoryKind;
}

export interface ImportDraft extends TransactionDraft {
  /** Провести сразу (меняет балансы) или оставить плановой. */
  applied: boolean;
}

export interface ImportPlan {
  drafts: ImportDraft[];
  errors: string[];
  /** Сколько строк пропущено как дубликаты уже существующих операций. */
  duplicates: number;
  /** Категорий нет в справочнике — их нужно создать и разобрать файл заново. */
  missingCategories: MissingCategory[];
}

export interface PlanInput {
  rows: readonly ParsedRow[];
  accounts: readonly Account[];
  categories: readonly Category[];
  transactions: readonly Transaction[];
  today: DayKey;
}

/** Сопоставить строки CSV со счетами и категориями. */
export function planImport(input: PlanInput): ImportPlan {
  const accounts = new Map(input.accounts.map((account) => [normalizeName(account.name), account]));
  const categories = new Map(
    input.categories.map((category) => [`${category.kind}|${normalizeName(category.name)}`, category]),
  );
  const existing = new Set(
    input.transactions.map((tx) =>
      fingerprint(tx.date, tx.kind, tx.amount, tx.accountId, tx.note ?? ''),
    ),
  );

  const drafts: ImportDraft[] = [];
  const errors: string[] = [];
  const missing = new Map<string, MissingCategory>();
  let duplicates = 0;

  for (const row of input.rows) {
    const account = accounts.get(normalizeName(row.accountName));
    if (!account) {
      errors.push(`Строка ${row.line}: счёт «${row.accountName}» не найден.`);
      continue;
    }

    let toAccountId: string | undefined;
    if (row.kind === 'transfer') {
      const to = accounts.get(normalizeName(row.toAccountName));
      if (!to) {
        errors.push(`Строка ${row.line}: счёт зачисления «${row.toAccountName}» не найден.`);
        continue;
      }
      if (to.id === account.id) {
        errors.push(`Строка ${row.line}: счета перевода совпадают.`);
        continue;
      }
      toAccountId = to.id;
    }

    let categoryId: string | undefined;
    let subcategoryId: string | undefined;

    if (row.kind !== 'transfer' && row.categoryName) {
      const categoryKind: CategoryKind = row.kind === 'income' ? 'income' : 'expense';
      const key = `${categoryKind}|${normalizeName(row.categoryName)}`;
      const category = categories.get(key);
      if (!category) {
        // Строку импортируем после того, как категория будет создана.
        if (!missing.has(key)) {
          missing.set(key, { name: row.categoryName, kind: categoryKind });
        }
        continue;
      }
      categoryId = category.id;
      if (row.subcategoryName) {
        subcategoryId = findSubcategoryByPath(category.subcategories, row.subcategoryName)?.node.id;
      }
    }

    const print = fingerprint(row.date, row.kind, row.amount, account.id, row.note);
    if (existing.has(print)) {
      duplicates += 1;
      continue;
    }
    existing.add(print);

    drafts.push({
      kind: row.kind,
      amount: row.amount,
      accountId: account.id,
      toAccountId,
      categoryId,
      subcategoryId,
      date: row.date,
      note: row.note || undefined,
      applied: row.applied && row.date <= input.today,
    });
  }

  return {
    drafts,
    errors,
    duplicates,
    missingCategories: [...missing.values()],
  };
}

function fingerprint(date: string, kind: OperationKind, amount: number, accountId: string, note: string): string {
  return `${date}|${kind}|${round2(amount)}|${accountId}|${normalizeName(note)}`;
}

export interface BackupValidation {
  backup: Backup | null;
  error: string | null;
}

/** Проверить JSON-бэкап перед восстановлением. */
export function parseBackupFile(text: string): BackupValidation {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { backup: null, error: 'Файл не похож на JSON.' };
  }

  const backup = data as Partial<Backup> | null;
  if (!backup || backup.format !== 'financial-planner-backup') {
    return { backup: null, error: 'Это не файл бэкапа Планировщика.' };
  }
  if (
    !Array.isArray(backup.accounts) ||
    !Array.isArray(backup.categories) ||
    !Array.isArray(backup.transactions)
  ) {
    return { backup: null, error: 'В файле нет обязательных коллекций (счета, категории, операции).' };
  }
  return {
    backup: {
      format: 'financial-planner-backup',
      version: 1,
      exportedAt: backup.exportedAt ?? new Date().toISOString(),
      accounts: backup.accounts,
      categories: backup.categories,
      transactions: backup.transactions,
      recurring: Array.isArray(backup.recurring) ? backup.recurring : [],
      goals: Array.isArray(backup.goals) ? backup.goals : [],
    },
    error: null,
  };
}
