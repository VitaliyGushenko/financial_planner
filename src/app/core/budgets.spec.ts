import { buildBudgets } from './budgets';
import { Category, Transaction } from './models';

const MONTH = '2026-11-18';

function category(id: string, name: string, budget?: number): Category {
  return { id, name, kind: 'expense', subcategories: [], sortOrder: 0, budget };
}

function expense(amount: number, categoryId: string, date = '2026-11-10', applied?: boolean): Transaction {
  return { id: `t${Math.random()}`, kind: 'expense', amount, accountId: 'a1', categoryId, date, applied };
}

describe('buildBudgets', () => {
  it('без лимитов — пустой результат', () => {
    const result = buildBudgets({
      categories: [category('food', 'Продукты')],
      transactions: [expense(1_000, 'food')],
      month: MONTH,
    });

    expect(result.lines).toEqual([]);
    expect(result.totalBudget).toBe(0);
    expect(result.overCount).toBe(0);
  });

  it('считает факт и остаток по категории', () => {
    const result = buildBudgets({
      categories: [category('food', 'Продукты', 30_000)],
      transactions: [expense(12_000, 'food'), expense(3_000, 'food')],
      month: MONTH,
    });

    expect(result.lines.length).toBe(1);
    expect(result.lines[0].spent).toBe(15_000);
    expect(result.lines[0].remaining).toBe(15_000);
    expect(result.lines[0].progress).toBe(0.5);
    expect(result.lines[0].over).toBeFalse();
  });

  it('помечает перерасход', () => {
    const result = buildBudgets({
      categories: [category('fun', 'Развлечения', 5_000)],
      transactions: [expense(7_000, 'fun')],
      month: MONTH,
    });

    expect(result.lines[0].over).toBeTrue();
    expect(result.lines[0].remaining).toBe(-2_000);
    expect(result.overCount).toBe(1);
  });

  it('не учитывает другие месяцы, плановые операции и доходы', () => {
    const result = buildBudgets({
      categories: [category('food', 'Продукты', 30_000)],
      transactions: [
        expense(1_000, 'food', '2026-10-31'),
        expense(2_000, 'food', '2026-11-05'),
        expense(9_000, 'food', '2026-11-06', false),
        {
          id: 'income',
          kind: 'income',
          amount: 50_000,
          accountId: 'a1',
          categoryId: 'food',
          date: '2026-11-07',
        },
      ],
      month: MONTH,
    });

    expect(result.lines[0].spent).toBe(2_000);
  });

  it('сортирует по заполненности и считает общий прогресс', () => {
    const result = buildBudgets({
      categories: [category('food', 'Продукты', 10_000), category('fun', 'Развлечения', 10_000)],
      transactions: [expense(2_000, 'food'), expense(8_000, 'fun')],
      month: MONTH,
    });

    expect(result.lines[0].categoryId).toBe('fun');
    expect(result.totalBudget).toBe(20_000);
    expect(result.totalSpent).toBe(10_000);
    expect(result.progress).toBe(0.5);
  });
});
