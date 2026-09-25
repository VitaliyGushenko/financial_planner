import { Transaction } from './models';
import { balanceSeries, buildStats, fillMonths, lastMonths } from './stats';
import { buildProjection } from './projection';

const TODAY = '2026-09-21';

function tx(id: string, patch: Partial<Transaction> = {}): Transaction {
  return { id, kind: 'expense', amount: 100, accountId: 'a1', date: TODAY, applied: true, ...patch };
}

const CATEGORIES = [
  { id: 'products', name: 'Продукты', kind: 'expense' as const, subcategories: [], sortOrder: 0 },
  { id: 'transport', name: 'Транспорт', kind: 'expense' as const, subcategories: [], sortOrder: 1 },
  { id: 'salary', name: 'Зарплата', kind: 'income' as const, subcategories: [], sortOrder: 0 },
];

describe('buildStats', () => {
  it('считает доходы, расходы и сальдо за период', () => {
    const stats = buildStats({
      transactions: [
        tx('t1', { kind: 'income', amount: 50000, categoryId: 'salary' }),
        tx('t2', { amount: 3000, categoryId: 'products' }),
        tx('t3', { amount: 1200, categoryId: 'transport', date: '2026-09-10' }),
      ],
      categories: CATEGORIES,
      from: '2026-09-01',
      to: '2026-09-21',
    });
    expect(stats.income).toBe(50000);
    expect(stats.expense).toBe(4200);
    expect(stats.net).toBe(45800);
    expect(stats.daysCount).toBe(21);
    expect(stats.avgPerDay).toBe(200);
  });

  it('игнорирует операции вне периода и плановые (не подтверждённые)', () => {
    const stats = buildStats({
      transactions: [
        tx('t1', { amount: 3000, categoryId: 'products', date: '2026-08-15' }),
        tx('t2', { amount: 3000, categoryId: 'products', date: '2026-10-01' }),
        tx('t3', { amount: 3000, categoryId: 'products', applied: false }),
        tx('t4', { amount: 700, categoryId: 'products' }),
      ],
      categories: CATEGORIES,
      from: '2026-09-01',
      to: '2026-09-30',
    });
    expect(stats.expense).toBe(700);
  });

  it('переводы между своими счетами не считаются доходом или расходом', () => {
    const stats = buildStats({
      transactions: [
        tx('t1', { kind: 'transfer', amount: 5000, toAccountId: 'a2' }),
        tx('t2', { amount: 800, categoryId: 'products' }),
      ],
      categories: CATEGORIES,
      from: '2026-09-01',
      to: '2026-09-30',
    });
    expect(stats.income).toBe(0);
    expect(stats.expense).toBe(800);
    expect(stats.byCategory.find((c) => c.categoryId === 'products')?.amount).toBe(800);
  });

  it('группирует расходы по категориям с долями, по убыванию', () => {
    const stats = buildStats({
      transactions: [
        tx('t1', { amount: 1000, categoryId: 'products' }),
        tx('t2', { amount: 3000, categoryId: 'transport' }),
        tx('t3', { amount: 2000, categoryId: 'products' }),
      ],
      categories: CATEGORIES,
      from: '2026-09-01',
      to: '2026-09-30',
    });
    expect(stats.byCategory[0]).toEqual({
      categoryId: 'products',
      title: 'Продукты',
      amount: 3000,
      share: 0.5,
    });
    expect(stats.byCategory[1].title).toBe('Транспорт');
    expect(stats.byCategory[1].share).toBeCloseTo(0.5);
  });

  it('группирует по месяцам внутри периода', () => {
    const stats = buildStats({
      transactions: [
        tx('t1', { kind: 'income', amount: 1000, categoryId: 'salary', date: '2026-08-10' }),
        tx('t2', { amount: 400, categoryId: 'products', date: '2026-08-11' }),
        tx('t3', { amount: 600, categoryId: 'products', date: '2026-09-05' }),
      ],
      categories: CATEGORIES,
      from: '2026-08-01',
      to: '2026-09-30',
    });
    expect(stats.byMonth).toEqual([
      { month: '2026-08', income: 1000, expense: 400 },
      { month: '2026-09', income: 0, expense: 600 },
    ]);
  });
});

describe('lastMonths + fillMonths', () => {
  it('строит последние n месяцев включая текущий', () => {
    expect(lastMonths('2026-09-21', 3).map((m) => m.month)).toEqual([
      '2026-07',
      '2026-08',
      '2026-09',
    ]);
    expect(lastMonths('2026-01-21', 3).map((m) => m.month)).toEqual([
      '2025-11',
      '2025-12',
      '2026-01',
    ]);
  });

  it('заполняет месяцы суммами операций', () => {
    const months = fillMonths(lastMonths('2026-09-21', 2), [
      tx('t1', { kind: 'income', amount: 100, date: '2026-08-05' }),
      tx('t2', { amount: 40, date: '2026-08-06' }),
      tx('t3', { amount: 60, date: '2026-09-01' }),
      tx('t4', { amount: 10, date: '2026-06-01' }),
    ]);
    expect(months).toEqual([
      { month: '2026-08', income: 100, expense: 40 },
      { month: '2026-09', income: 0, expense: 60 },
    ]);
  });
});

describe('balanceSeries', () => {
  it('делит ряды на факт (до сегодня) и прогноз (с сегодня), соединяя в точке перехода', () => {
    const projection = buildProjection({
      accounts: [{ id: 'a1', name: 'Карта', type: 'card', balance: 1000, sortOrder: 0 }],
      transactions: [
        { id: 't1', kind: 'expense', amount: 300, accountId: 'a1', date: '2026-09-20', applied: true },
      ],
      rules: [
        {
          id: 'r1',
          title: 'Зарплата',
          kind: 'income',
          amount: 5000,
          accountId: 'a1',
          frequency: 'monthly',
          every: 1,
          startDate: '2026-09-25',
          endDate: null,
        },
      ],
      categories: [],
      today: TODAY,
      horizonDays: 5,
      pastDays: 5,
    });

    const series = balanceSeries(projection);
    expect(series.fact.filter((v) => v !== null).length).toBeGreaterThan(0);
    // Линии соединяются: первая непустая точка прогноза = последняя точка факта.
    const firstForecast = series.forecast.find((v): v is number => v !== null) ?? null;
    expect(firstForecast).toBe(series.fact.filter((v) => v !== null).pop() ?? null);
    const factValues = series.fact.filter((v): v is number => v !== null);
    expect(factValues[factValues.length - 1] ?? 0).toBe(1000); // сегодня: 1000
    const lastForecast = series.forecast.filter((v): v is number => v !== null).pop() ?? 0;
    expect(lastForecast).toBe(6000);
  });
});
