import { DayKey } from './day-key';
import { round2 } from './money';
import { Category, Transaction } from './models';

/**
 * Бюджеты по категориям: лимит на месяц хранится в самой категории
 * (`budget`), факт считается по подтверждённым расходам месяца.
 * Переводы и плановые (неподтверждённые) операции не учитываются.
 */

export interface BudgetLine {
  categoryId: string;
  title: string;
  budget: number;
  spent: number;
  /** Осталось; отрицательное значение — перерасход. */
  remaining: number;
  /** 0…1+, больше единицы — перерасход. */
  progress: number;
  over: boolean;
}

export interface BudgetsResult {
  /** «YYYY-MM». */
  month: string;
  totalBudget: number;
  totalSpent: number;
  totalRemaining: number;
  /** Общий прогресс 0…1+. */
  progress: number;
  lines: BudgetLine[];
  overCount: number;
}

export interface BudgetsInput {
  categories: readonly Category[];
  transactions: readonly Transaction[];
  /** Любой день нужного месяца — берётся только «YYYY-MM». */
  month: DayKey;
}

export function buildBudgets(input: BudgetsInput): BudgetsResult {
  const prefix = input.month.slice(0, 7);
  const spentByCategory = new Map<string, number>();

  for (const tx of input.transactions) {
    if (tx.kind !== 'expense' || tx.applied === false || !tx.categoryId) {
      continue;
    }
    if (!tx.date.startsWith(prefix)) {
      continue;
    }
    spentByCategory.set(tx.categoryId, (spentByCategory.get(tx.categoryId) ?? 0) + tx.amount);
  }

  const lines: BudgetLine[] = [];
  for (const category of input.categories) {
    const budget = category.budget ?? 0;
    if (budget <= 0) {
      continue;
    }
    const spent = round2(spentByCategory.get(category.id) ?? 0);
    lines.push({
      categoryId: category.id,
      title: category.name,
      budget: round2(budget),
      spent,
      remaining: round2(budget - spent),
      progress: spent / budget,
      over: spent > budget,
    });
  }

  lines.sort((a, b) => b.progress - a.progress || a.title.localeCompare(b.title));

  const totalBudget = round2(lines.reduce((sum, line) => sum + line.budget, 0));
  const totalSpent = round2(lines.reduce((sum, line) => sum + line.spent, 0));

  return {
    month: prefix,
    totalBudget,
    totalSpent,
    totalRemaining: round2(totalBudget - totalSpent),
    progress: totalBudget > 0 ? totalSpent / totalBudget : 0,
    lines,
    overCount: lines.filter((line) => line.over).length,
  };
}
