import { advisePurchase } from './advisor';
import { buildProjection } from './projection';

const TODAY = '2026-09-21';

function projectionFor(
  balance: number,
  rules: Parameters<typeof buildProjection>[0]['rules'],
  transactions: Parameters<typeof buildProjection>[0]['transactions'] = [],
  horizonDays = 90,
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

describe('advisePurchase', () => {
  it('если денег уже хватает и трат нет — можно покупать сегодня', () => {
    const advice = advisePurchase(projectionFor(5000, []), 3000, {});
    expect(advice.canBuyNow).toBeTrue();
    expect(advice.recommendedDate).toBe(TODAY);
    expect(advice.tone).toBe('good');
  });

  it('подсказывает дату после зарплаты, если сегодня не хватает', () => {
    // Зарплата 50000 25-го каждого месяца, аренда 20000 1-го.
    const projection = projectionFor(5000, [
      {
        id: 'salary',
        title: 'Зарплата',
        kind: 'income',
        amount: 50000,
        accountId: 'a1',
        frequency: 'monthly',
        every: 1,
        startDate: '2026-09-25',
        endDate: null,
      },
      {
        id: 'rent',
        title: 'Аренда',
        kind: 'expense',
        amount: 20000,
        accountId: 'a1',
        frequency: 'monthly',
        every: 1,
        startDate: '2026-10-01',
        endDate: null,
      },
    ]);

    const advice = advisePurchase(projection, 30000, {});
    // 25.09 придёт зарплата (55000), но 01.10 уйдёт 20000 → после покупки минимум 5000 ≥ 0.
    expect(advice.recommendedDate).toBe('2026-09-25');
    expect(advice.canBuyNow).toBeFalse();
    expect(advice.minBalanceAfter).toBe(5000);
    expect(advice.tone).toBe('warn');
  });

  it('ждёт дату, когда покупка не топит остаток в минус', () => {
    const projection = projectionFor(1000, [
      {
        id: 'salary',
        title: 'Зарплата',
        kind: 'income',
        amount: 40000,
        accountId: 'a1',
        frequency: 'monthly',
        every: 1,
        startDate: '2026-10-05',
        endDate: null,
      },
    ]);

    const advice = advisePurchase(projection, 20000, {});
    expect(advice.recommendedDate).toBe('2026-10-05');
    expect(advice.earliestAffordable).toBe('2026-10-05');
  });

  it('сообщает, когда сумма за горизонт не набирается', () => {
    const advice = advisePurchase(projectionFor(1000, []), 999999, {});
    expect(advice.recommendedDate).toBeNull();
    expect(advice.earliestAffordable).toBeNull();
    expect(advice.tone).toBe('bad');
    expect(advice.message).toContain('не набирается');
  });

  it('различает «денег хватает сейчас» и «безопасно только позже»', () => {
    // Покупка 01.10 топит остаток в минус — значит, «доступно» раньше, чем «безопасно».
    const projection = projectionFor(30000, [
      {
        id: 'rent',
        title: 'Аренда',
        kind: 'expense',
        amount: 25000,
        accountId: 'a1',
        frequency: 'monthly',
        every: 1,
        startDate: '2026-10-01',
        endDate: null,
      },
      {
        id: 'salary',
        title: 'Зарплата',
        kind: 'income',
        amount: 60000,
        accountId: 'a1',
        frequency: 'monthly',
        every: 1,
        startDate: '2026-10-10',
        endDate: null,
      },
    ]);

    const advice = advisePurchase(projection, 20000, {});
    // Сумма набирается уже сегодня, но покупка сегодня → 01.10 остаток -15000.
    expect(advice.earliestAffordable).toBe(TODAY);
    expect(advice.recommendedDate).toBe('2026-10-10');
    expect(advice.canBuyNow).toBeFalse();
  });

  it('проверяет желаемый срок покупки', () => {
    const projection = projectionFor(1000, [
      {
        id: 'salary',
        title: 'Зарплата',
        kind: 'income',
        amount: 30000,
        accountId: 'a1',
        frequency: 'monthly',
        every: 1,
        startDate: '2026-10-25',
        endDate: null,
      },
    ]);

    const inTime = advisePurchase(projection, 15000, { deadline: '2026-11-01' });
    expect(inTime.recommendedDate).toBe('2026-10-25');
    expect(inTime.withinDeadline).toBeTrue();

    const late = advisePurchase(projection, 15000, { deadline: '2026-10-01' });
    expect(late.recommendedDate).toBe('2026-10-25');
    expect(late.withinDeadline).toBeFalse();
    expect(late.message).toContain('позже срока');
  });
});
