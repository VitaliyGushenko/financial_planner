import { buildProjection } from './projection';
import { safeToSpend } from './safe-to-spend';

const TODAY = '2026-11-18';

function projectionFor(
  balance: number,
  rules: Parameters<typeof buildProjection>[0]['rules'] = [],
  transactions: Parameters<typeof buildProjection>[0]['transactions'] = [],
  horizonDays = 60,
) {
  return buildProjection({
    accounts: [{ id: 'a1', name: 'Карта', type: 'card', balance, sortOrder: 0 }],
    transactions,
    rules,
    categories: [],
    today: TODAY,
    horizonDays,
  });
}

const rentRule = {
  id: 'rent',
  title: 'Аренда',
  kind: 'expense' as const,
  amount: 30_000,
  accountId: 'a1',
  frequency: 'monthly' as const,
  every: 1,
  startDate: '2026-11-23',
  endDate: null,
};

const salaryRule = {
  id: 'salary',
  title: 'Зарплата',
  kind: 'income' as const,
  amount: 50_000,
  accountId: 'a1',
  frequency: 'monthly' as const,
  every: 1,
  startDate: '2026-11-28',
  endDate: null,
};

describe('safeToSpend', () => {
  it('без планов можно потратить всё, что есть', () => {
    const result = safeToSpend(projectionFor(50_000));

    expect(result.amount).toBe(50_000);
    expect(result.minBalance).toBe(50_000);
    expect(result.minBalanceDate).toBe(TODAY);
    expect(result.nextIncomeDate).toBeNull();
    expect(result.daysToIncome).toBeNull();
  });

  it('вычитает ближайший платёж: 50 000 − аренда 30 000 = 20 000', () => {
    const result = safeToSpend(projectionFor(50_000, [rentRule]));

    expect(result.amount).toBe(20_000);
    expect(result.minBalance).toBe(20_000);
    expect(result.minBalanceDate).toBe('2026-11-23');
    expect(result.expenseAhead).toBe(30_000);
  });

  it('если платёж уводит в минус — тратить нельзя', () => {
    const result = safeToSpend(projectionFor(1_000, [rentRule]));

    expect(result.amount).toBe(0);
    expect(result.minBalance).toBe(-29_000);
  });

  it('подсказывает дни до ближайшего дохода', () => {
    const result = safeToSpend(projectionFor(10_000, [salaryRule]));

    expect(result.nextIncomeDate).toBe('2026-11-28');
    expect(result.daysToIncome).toBe(10);
    expect(result.incomeAhead).toBe(50_000);
  });

  it('не даёт потратить будущие доходы сегодня', () => {
    const result = safeToSpend(projectionFor(1_000, [salaryRule]));

    // На счетах сегодня 1 000 — больше потратить нельзя, даже если скоро зарплата.
    expect(result.amount).toBe(1_000);
    expect(result.daysToIncome).toBe(10);
  });

  it('учитывает резерв-подушку', () => {
    const result = safeToSpend(projectionFor(50_000, [rentRule]), 30, { reserve: 5_000 });

    expect(result.amount).toBe(15_000);
  });

  it('не видит платёж за пределами горизонта', () => {
    const farRent = { ...rentRule, startDate: '2026-12-25' };
    const result = safeToSpend(projectionFor(5_000, [farRent]), 30);

    expect(result.amount).toBe(5_000);
    expect(result.expenseAhead).toBe(0);
  });

  it('доход и расходы на горизонте считаются вместе', () => {
    // Зарплата 28.11 (+50 000), аренда 23.11 (−30 000): минимум = 50 000 − 30 000 = 20 000.
    const result = safeToSpend(projectionFor(50_000, [rentRule, salaryRule]));

    expect(result.minBalance).toBe(20_000);
    expect(result.amount).toBe(20_000);
    expect(result.incomeAhead).toBe(50_000);
    expect(result.expenseAhead).toBe(30_000);
  });
});
