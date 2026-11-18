import { compareMonths } from './compare';
import { Category, Transaction } from './models';

const MONTH = '2026-11-18';

const CATEGORIES: Category[] = [
  { id: 'food', name: 'Продукты', kind: 'expense', subcategories: [], sortOrder: 0 },
  { id: 'fun', name: 'Развлечения', kind: 'expense', subcategories: [], sortOrder: 1 },
];

function tx(
  kind: 'income' | 'expense' | 'transfer',
  amount: number,
  date: string,
  categoryId?: string,
  applied?: boolean,
): Transaction {
  return { id: `${kind}-${date}-${amount}`, kind, amount, accountId: 'a1', categoryId, date, applied };
}

describe('compareMonths', () => {
  it('считает суммы и дельты к прошлому месяцу', () => {
    const result = compareMonths({
      categories: CATEGORIES,
      month: MONTH,
      transactions: [
        tx('income', 100_000, '2026-11-05'),
        tx('expense', 30_000, '2026-11-10', 'food'),
        tx('income', 80_000, '2026-10-05'),
        tx('expense', 20_000, '2026-10-10', 'food'),
      ],
    });

    expect(result.current.income).toBe(100_000);
    expect(result.current.expense).toBe(30_000);
    expect(result.previous.income).toBe(80_000);
    expect(result.previous.expense).toBe(20_000);
    expect(result.incomeDelta).toBe(20_000);
    expect(result.expenseDelta).toBe(10_000);
    expect(result.expensePercent).toBe(0.5);
  });

  it('не считает проценты, если в прошлом месяце было пусто', () => {
    const result = compareMonths({
      categories: CATEGORIES,
      month: MONTH,
      transactions: [tx('expense', 5_000, '2026-11-02', 'food')],
    });

    expect(result.expensePercent).toBeNull();
    expect(result.incomePercent).toBeNull();
  });

  it('показывает категории с ростом расходов', () => {
    const result = compareMonths({
      categories: CATEGORIES,
      month: MONTH,
      transactions: [
        tx('expense', 15_000, '2026-11-03', 'fun'),
        tx('expense', 9_000, '2026-11-04', 'food'),
        tx('expense', 5_000, '2026-10-03', 'fun'),
        tx('expense', 8_000, '2026-10-04', 'food'),
      ],
    });

    expect(result.growth.length).toBe(2);
    expect(result.growth[0].categoryId).toBe('fun');
    expect(result.growth[0].delta).toBe(10_000);
    expect(result.growth[1].delta).toBe(1_000);
  });

  it('игнорирует переводы, плановые операции и другие месяцы', () => {
    const result = compareMonths({
      categories: CATEGORIES,
      month: MONTH,
      transactions: [
        tx('expense', 1_000, '2026-11-05', 'food'),
        tx('expense', 9_000, '2026-11-06', 'food', false),
        tx('transfer', 50_000, '2026-11-07'),
        tx('expense', 7_000, '2026-09-05', 'food'),
      ],
    });

    expect(result.current.expense).toBe(1_000);
    expect(result.previous.expense).toBe(0);
  });
});
