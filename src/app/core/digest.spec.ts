import { buildDigest } from './digest';
import { Category, Transaction } from './models';

const TODAY = '2026-11-18';

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

describe('buildDigest', () => {
  it('считает неделю и сравнивает с прошлой', () => {
    const digest = buildDigest({
      categories: CATEGORIES,
      today: TODAY,
      transactions: [
        tx('income', 100_000, '2026-11-16'),
        tx('expense', 2_000, '2026-11-17', 'food'),
        tx('expense', 1_500, '2026-11-10', 'food'),
      ],
    });

    expect(digest.from).toBe('2026-11-12');
    expect(digest.income).toBe(100_000);
    expect(digest.expense).toBe(2_000);
    expect(digest.net).toBe(98_000);
    expect(digest.previousExpense).toBe(1_500);
    expect(digest.expenseChange).toBe(0.33);
  });

  it('находит самую затратную категорию', () => {
    const digest = buildDigest({
      categories: CATEGORIES,
      today: TODAY,
      transactions: [
        tx('expense', 500, '2026-11-17', 'food'),
        tx('expense', 3_000, '2026-11-16', 'fun'),
      ],
    });

    expect(digest.topCategory?.categoryId).toBe('fun');
    expect(digest.topCategory?.amount).toBe(3_000);
  });

  it('не сравнивает, если прошлая неделя пустая', () => {
    const digest = buildDigest({
      categories: CATEGORIES,
      today: TODAY,
      transactions: [tx('expense', 700, '2026-11-17', 'food')],
    });

    expect(digest.expenseChange).toBeNull();
    expect(digest.previousExpense).toBe(0);
  });

  it('игнорирует переводы и плановые операции', () => {
    const digest = buildDigest({
      categories: CATEGORIES,
      today: TODAY,
      transactions: [
        tx('transfer', 10_000, '2026-11-17'),
        tx('expense', 900, '2026-11-17', 'food', false),
        tx('expense', 100, '2026-11-17', 'food'),
      ],
    });

    expect(digest.expense).toBe(100);
    expect(digest.income).toBe(0);
  });

  it('пустая неделя даёт нули', () => {
    const digest = buildDigest({ categories: CATEGORIES, today: TODAY, transactions: [] });

    expect(digest.expense).toBe(0);
    expect(digest.net).toBe(0);
    expect(digest.topCategory).toBeNull();
  });
});
