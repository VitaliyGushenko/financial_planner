import { DayKey } from './day-key';
import { flattenSubcategories } from './category-tree';
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

interface BudgetTarget {
  key: string;
  categoryId: string;
  title: string;
  budget: number;
  /** Для подкатегории — она сама и все потомки. */
  subIds?: Set<string>;
}

export function buildBudgets(input: BudgetsInput): BudgetsResult {
  const prefix = input.month.slice(0, 7);
  const spentByCategory = new Map<string, number>();
  const spentBySub = new Map<string, number>();

  for (const tx of input.transactions) {
    if (tx.kind !== 'expense' || tx.applied === false || !tx.categoryId) {
      continue;
    }
    if (!tx.date.startsWith(prefix)) {
      continue;
    }
    spentByCategory.set(tx.categoryId, (spentByCategory.get(tx.categoryId) ?? 0) + tx.amount);
    if (tx.subcategoryId) {
      spentBySub.set(tx.subcategoryId, (spentBySub.get(tx.subcategoryId) ?? 0) + tx.amount);
    }
  }

  const targets: BudgetTarget[] = [];
  for (const category of input.categories) {
    if ((category.budget ?? 0) > 0) {
      targets.push({
        key: category.id,
        categoryId: category.id,
        title: category.name,
        budget: category.budget ?? 0,
      });
    }
    for (const flat of flattenSubcategories(category.subcategories)) {
      const budget = flat.node.budget ?? 0;
      if (budget <= 0) {
        continue;
      }
      const subIds = new Set<string>([flat.node.id]);
      for (const child of flattenSubcategories(flat.node.children)) {
        subIds.add(child.node.id);
      }
      targets.push({
        key: `${category.id}/${flat.node.id}`,
        categoryId: category.id,
        title: `${category.name} / ${flat.fullPath}`,
        budget,
        subIds,
      });
    }
  }

  const lines: BudgetLine[] = [];
  for (const target of targets) {
    const spent = target.subIds
      ? round2([...target.subIds].reduce((sum, id) => sum + (spentBySub.get(id) ?? 0), 0))
      : round2(spentByCategory.get(target.categoryId) ?? 0);
    lines.push({
      categoryId: target.categoryId,
      title: target.title,
      budget: round2(target.budget),
      spent,
      remaining: round2(target.budget - spent),
      progress: spent / target.budget,
      over: spent > target.budget,
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
