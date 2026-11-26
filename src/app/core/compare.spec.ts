import { availableComparisonMonths, compareMonths, compareTwoMonths } from './compare';
import { Category, Transaction } from './models';

const MONTH = '2026-11-18';

const CATEGORIES: Category[] = [
  {
    id: 'food',
    name: 'Продукты',
    kind: 'expense',
    subcategories: [
      { id: 'super', name: 'Супермаркет' },
      { id: 'market', name: 'Рынок' },
    ],
    sortOrder: 0,
    icon: 'cart',
  },
  { id: 'fun', name: 'Развлечения', kind: 'expense', subcategories: [], sortOrder: 1, icon: 'smile' },
  { id: 'salary', name: 'Зарплата', kind: 'income', subcategories: [], sortOrder: 0, icon: 'briefcase' },
  { id: 'freelance', name: 'Фриланс', kind: 'income', subcategories: [], sortOrder: 1, icon: 'wallet' },
];

function tx(
  kind: 'income' | 'expense' | 'transfer',
  amount: number,
  date: string,
  categoryId?: string,
  applied?: boolean,
  subcategoryId?: string,
): Transaction {
  return {
    id: `${kind}-${date}-${amount}`,
    kind,
    amount,
    accountId: 'a1',
    categoryId,
    subcategoryId,
    date,
    applied,
  };
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

describe('compareTwoMonths (детальное сравнение 2 любых месяцев)', () => {
  it('сравнивает все статьи расходов и доходов за произвольные 2 месяца с подкатегориями', () => {
    const result = compareTwoMonths({
      categories: CATEGORIES,
      monthA: '2026-08',
      monthB: '2026-11',
      transactions: [
        // Август (Месяц А)
        tx('income', 100_000, '2026-08-05', 'salary'),
        tx('income', 20_000, '2026-08-15', 'freelance'),
        tx('expense', 25_000, '2026-08-10', 'food', true, 'super'),
        tx('expense', 5_000, '2026-08-12', 'food', true, 'market'),
        tx('expense', 12_000, '2026-08-20', 'fun'),
        // Ноябрь (Месяц Б)
        tx('income', 110_000, '2026-11-05', 'salary'),
        tx('expense', 20_000, '2026-11-10', 'food', true, 'super'),
        tx('expense', 18_000, '2026-11-22', 'fun'),
      ],
    });

    expect(result.monthA).toBe('2026-08');
    expect(result.monthB).toBe('2026-11');
    expect(result.pointA.income).toBe(120_000);
    expect(result.pointB.income).toBe(110_000);
    expect(result.incomeDelta).toBe(-10_000);

    expect(result.pointA.expense).toBe(42_000);
    expect(result.pointB.expense).toBe(38_000);
    expect(result.expenseDelta).toBe(-4_000);

    // Проверка статей доходов (обе категории присутствуют, даже если в ноябре фриланс = 0)
    expect(result.incomeCategories.length).toBe(2);
    const freelance = result.incomeCategories.find((c) => c.categoryId === 'freelance')!;
    expect(freelance.monthA).toBe(20_000);
    expect(freelance.monthB).toBe(0);
    expect(freelance.delta).toBe(-20_000);
    expect(freelance.tone).toBe('bad');

    const salary = result.incomeCategories.find((c) => c.categoryId === 'salary')!;
    expect(salary.delta).toBe(10_000);
    expect(salary.tone).toBe('good');

    // Проверка статей расходов и подкатегорий
    expect(result.expenseCategories.length).toBe(2);
    const food = result.expenseCategories.find((c) => c.categoryId === 'food')!;
    expect(food.monthA).toBe(30_000);
    expect(food.monthB).toBe(20_000);
    expect(food.delta).toBe(-10_000);
    expect(food.tone).toBe('good'); // снижение расходов — позитивный тон
    expect(food.subcategories.length).toBe(2);
    expect(food.subcategories[0].title).toBe('Супермаркет');
    expect(food.subcategories[0].delta).toBe(-5_000);
  });

  it('возвращает список доступных месяцев включая исторические операции', () => {
    const months = availableComparisonMonths(
      [tx('expense', 1000, '2024-03-15', 'food')],
      '2026-11-18',
      3,
    );
    expect(months[0]).toBe('2026-11');
    expect(months).toContain('2024-03');
  });
});
