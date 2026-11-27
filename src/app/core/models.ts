import { Timestamp } from '@angular/fire/firestore';

/** Наличные или карта. */
export type AccountType = 'cash' | 'card';

/** Тип операции. */
export type OperationKind = 'income' | 'expense' | 'transfer';

/** Категории бывают только для доходов и расходов (переводы — между счетами). */
export type CategoryKind = 'income' | 'expense';

/** Готовая периодичность повторяющейся операции. */
export type Frequency = 'weekly' | 'monthly' | 'yearly' | 'custom';

/** Единица своего интервала. */
export type CustomUnit = 'days' | 'weeks' | 'months' | 'years';

/** Откуда появилась операция: вручную, из пуша банка, из импорта или из правила. */
export type TxSource = 'manual' | 'bank' | 'import' | 'recurring';

/**
 * Счёт пользователя (наличные, карта...).
 * balance — фактический остаток «сейчас»; все прошлые операции уже учтены в нём.
 */
export interface Account {
  id: string;
  name: string;
  type: AccountType;
  balance: number;
  sortOrder: number;
  /** Последние 4 цифры карты — по ним пуш банка привязывается к счёту. */
  cardMask?: string;
}

export interface Subcategory {
  id: string;
  name: string;
}

export interface Category {
  id: string;
  name: string;
  kind: CategoryKind;
  subcategories: Subcategory[];
  sortOrder: number;
  /** Месячный лимит расходов по категории; не задан — бюджет не ведётся. */
  budget?: number;
  /** Имя иконки из набора приложения (cart, car, home…). */
  icon?: string;
}

/**
 * Разовая операция. date — ключ дня «YYYY-MM-DD».
 * Будущие операции в балансы не входят и участвуют только в проекции;
 * applied = true означает, что операция подтверждена и изменяла балансы счетов.
 * ruleId — правило, из которого создана операция (для учёта подтверждений платежей).
 */
export interface Transaction {
  id: string;
  kind: OperationKind;
  amount: number;
  accountId: string;
  toAccountId?: string;
  categoryId?: string;
  subcategoryId?: string;
  date: string;
  note?: string;
  applied?: boolean;
  ruleId?: string;
  createdAt?: Timestamp | null;
  /** Источник записи; отсутствует — значит заведена вручную. */
  source?: TxSource;
  /** Ключ дедупликации для пушей банка. */
  sourceId?: string;
  /** Исходный текст уведомления банка. */
  rawText?: string;
  /** Мерчант/получатель из уведомления. */
  merchant?: string;
  /** Последние 4 цифры карты из уведомления. */
  cardMask?: string;
}

/** Данные формы операции без служебных полей. */
export interface TransactionDraft {
  kind: OperationKind;
  amount: number;
  accountId: string;
  toAccountId?: string;
  categoryId?: string;
  subcategoryId?: string;
  date: string;
  note?: string;
  ruleId?: string;
}

/** Правило повторяющейся операции (зарплата, аренда, подписка...). */
export interface RecurringRule {
  id: string;
  title: string;
  kind: Exclude<OperationKind, 'transfer'> | 'transfer';
  amount: number;
  accountId: string;
  toAccountId?: string;
  categoryId?: string;
  subcategoryId?: string;
  frequency: Frequency;
  /** Для frequency='custom': сколько единиц между вхождениями. */
  every: number;
  customUnit?: CustomUnit;
  /** Ключ дня первого вхождения «YYYY-MM-DD». */
  startDate: string;
  /** Ключ дня последнего вхождения или null — бессрочно. */
  endDate: string | null;
  /** Даты вхождений, которые пользователь пропустил (деньги не пришли). */
  skippedDates?: string[];
  note?: string;
  createdAt?: Timestamp | null;
}

/** Планируемая покупка (цель). */
export interface Goal {
  id: string;
  title: string;
  amount: number;
  /** Желаемый срок покупки (ключ дня) или null. */
  deadline: string | null;
  status: 'active' | 'done';
  note?: string;
  createdAt?: Timestamp | null;
}

export interface UserProfile {
  email: string;
  displayName: string;
  settings?: { currency?: string };
  createdAt?: Timestamp | Date;
}

/**
 * Правило автоматической категоризации операций из банка.
 * Совпадение ищется по мерчанту/заметке/исходному тексту уведомления.
 */
export interface BankRule {
  id: string;
  /** Ключевые слова в верхнем регистре; достаточно одного совпадения. */
  keywords: string[];
  /** 'any' — хотя бы одно слово, 'all' — все слова. */
  match?: 'any' | 'all';
  kind: CategoryKind;
  categoryId: string;
  subcategoryId?: string;
  /** Больше число — выше приоритет при нескольких совпадениях. */
  priority?: number;
  enabled: boolean;
  createdAt?: Timestamp | null;
}

/** Пуш банка, который не удалось превратить в операцию. */
export interface BankInboxItem {
  id: string;
  packageName: string;
  title?: string;
  text: string;
  postedAt?: Timestamp | null;
  reason: 'unparsed' | 'no-account' | 'no-category' | 'duplicate' | 'error';
  createdAt?: Timestamp | null;
}
