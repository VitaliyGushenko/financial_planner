import { collectPending } from './pending';

const TODAY = '2026-09-21';

function base() {
  return {
    transactions: [],
    rules: [],
    categories: [
      { id: 'salary', name: 'Зарплата', kind: 'income' as const, subcategories: [], sortOrder: 0 },
      { id: 'products', name: 'Продукты', kind: 'expense' as const, subcategories: [], sortOrder: 0 },
    ],
    today: TODAY,
  };
}

describe('collectPending', () => {
  it('плановая операция с наступившей датой ожидает подтверждения', () => {
    const items = collectPending({
      ...base(),
      transactions: [
        { id: 't1', kind: 'expense', amount: 500, accountId: 'a1', categoryId: 'products', date: TODAY, applied: false },
      ],
    });
    expect(items.length).toBe(1);
    expect(items[0]).toEqual({
      id: 'tx:t1',
      kind: 'transaction',
      date: TODAY,
      title: 'Продукты',
      kindOf: 'expense',
      amount: 500,
      txId: 't1',
    });
  });

  it('подтверждённые и будущие операции не попадают в список', () => {
    const items = collectPending({
      ...base(),
      transactions: [
        { id: 't1', kind: 'expense', amount: 500, accountId: 'a1', date: '2026-09-20', applied: true },
        { id: 't2', kind: 'expense', amount: 500, accountId: 'a1', date: '2026-09-25', applied: false },
      ],
    });
    expect(items).toEqual([]);
  });

  it('наступившее вхождение правила ожидает подтверждения', () => {
    const items = collectPending({
      ...base(),
      rules: [
        {
          id: 'salary',
          title: 'Зарплата',
          kind: 'income',
          amount: 50000,
          accountId: 'a1',
          categoryId: 'salary',
          frequency: 'monthly',
          every: 1,
          startDate: '2026-09-15',
          endDate: null,
        },
      ],
    });
    expect(items.length).toBe(1);
    expect(items[0].title).toBe('Зарплата');
    expect(items[0].date).toBe('2026-09-15');
    expect(items[0].ruleId).toBe('salary');
  });

  it('вхождение с записанной операцией (ruleId + дата) уже не ждёт подтверждения', () => {
    const items = collectPending({
      ...base(),
      transactions: [
        {
          id: 't1',
          kind: 'income',
          amount: 52000,
          accountId: 'a1',
          categoryId: 'salary',
          date: '2026-09-15',
          applied: true,
          ruleId: 'salary',
        },
      ],
      rules: [
        {
          id: 'salary',
          title: 'Зарплата',
          kind: 'income',
          amount: 50000,
          accountId: 'a1',
          categoryId: 'salary',
          frequency: 'monthly',
          every: 1,
          startDate: '2026-09-15',
          endDate: null,
        },
      ],
    });
    expect(items).toEqual([]);
  });

  it('пропущенное вхождение (деньги не пришли) не ждёт подтверждения', () => {
    const items = collectPending({
      ...base(),
      rules: [
        {
          id: 'salary',
          title: 'Зарплата',
          kind: 'income',
          amount: 50000,
          accountId: 'a1',
          categoryId: 'salary',
          frequency: 'monthly',
          every: 1,
          startDate: '2026-09-15',
          endDate: null,
          skippedDates: ['2026-09-15'],
        },
      ],
    });
    expect(items).toEqual([]);
  });

  it('сортирует по дате: сначала самые просроченные', () => {
    const items = collectPending({
      ...base(),
      transactions: [
        { id: 't1', kind: 'expense', amount: 100, accountId: 'a1', date: '2026-09-21', applied: false },
        { id: 't2', kind: 'expense', amount: 200, accountId: 'a1', date: '2026-09-19', applied: false },
      ],
    });
    expect(items.map((i) => i.date)).toEqual(['2026-09-19', '2026-09-21']);
  });
});
