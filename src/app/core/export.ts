import { Account, BankRule, Category, Goal, RecurringRule, Transaction } from './models';
import { subcategoryLabel } from './category-tree';

/**
 * Экспорт данных: CSV для Excel и полный JSON-бэкап.
 * Скачивание — на клиенте, без сервера; файлы содержат только данные пользователя.
 */

export interface BackupInput {
  accounts: Account[];
  categories: Category[];
  transactions: Transaction[];
  recurring: RecurringRule[];
  goals: Goal[];
  /** Правила банка необязательны: старые бэкапы их не содержат. */
  bankRules?: BankRule[];
}

export interface Backup extends BackupInput {
  format: 'financial-planner-backup';
  version: 1;
  exportedAt: string;
}

export function buildBackup(input: BackupInput): Backup {
  return {
    format: 'financial-planner-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    ...input,
  };
}

const KIND_LABELS: Record<Transaction['kind'], string> = {
  income: 'Доход',
  expense: 'Расход',
  transfer: 'Перевод',
};

/** CSV с разделителем «;» и десятичной запятой — открывается в Excel без настроек. */
export function transactionsToCsv(input: {
  transactions: readonly Transaction[];
  categories: readonly Category[];
  accounts: readonly Account[];
}): string {
  const categories = new Map(input.categories.map((category) => [category.id, category]));
  const accounts = new Map(input.accounts.map((account) => [account.id, account]));

  const header = [
    'Дата',
    'Тип',
    'Сумма',
    'Счёт',
    'Счёт зачисления',
    'Категория',
    'Подкатегория',
    'Заметка',
    'Проведена',
  ];

  const rows = input.transactions.map((tx) => {
    const category = tx.categoryId ? categories.get(tx.categoryId) : undefined;
    const sub = subcategoryLabel(category?.subcategories, tx.subcategoryId);
    return [
      tx.date,
      KIND_LABELS[tx.kind],
      String(tx.amount).replace('.', ','),
      accounts.get(tx.accountId)?.name ?? '',
      tx.toAccountId ? (accounts.get(tx.toAccountId)?.name ?? '') : '',
      category?.name ?? '',
      sub,
      tx.note ?? '',
      tx.applied === false ? 'нет' : 'да',
    ];
  });

  return [header, ...rows].map((row) => row.map(csvCell).join(';')).join('\r\n');
}

function csvCell(value: string): string {
  if (!/[;"\r\n]/.test(value)) {
    return value;
  }
  return `"${value.replace(/"/g, '""')}"`;
}

/** Скачать текст как файл. */
export function downloadText(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
