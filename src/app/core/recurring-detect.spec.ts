import { detectRecurring } from './recurring-detect';
import { Transaction } from './models';

function tx(date: string, amount: number, merchant = 'IVI'): Transaction {
  return {
    id: `${merchant}-${date}`,
    kind: 'expense',
    amount,
    accountId: 'card',
    date,
    merchant,
    source: 'bank',
  } as Transaction;
}

describe('detectRecurring', () => {
  it('находит три одинаковых месячных платежа', () => {
    const result = detectRecurring(
      [tx('2026-09-27', 4.99), tx('2026-10-27', 4.99), tx('2026-11-27', 5.49)],
      [],
      '2026-11-28',
    );
    expect(result.length).toBe(1);
    expect(result[0].amount).toBe(4.99);
    expect(result[0].occurrences).toBe(3);
    expect(result[0].nextDate).toBe('2026-12-27');
  });

  it('не предлагает разовые или нерегулярные траты', () => {
    expect(
      detectRecurring([tx('2026-09-01', 100), tx('2026-10-15', 500), tx('2026-11-27', 1000)], [], '2026-11-28'),
    ).toEqual([]);
    expect(detectRecurring([tx('2026-10-27', 10), tx('2026-11-27', 10)], [], '2026-11-28')).toEqual([]);
  });

  it('игнорирует переводы', () => {
    const transfer = (date: string) =>
      ({ ...tx(date, 100), kind: 'transfer', toAccountId: 'cash' }) as Transaction;
    expect(
      detectRecurring([transfer('2026-09-27'), transfer('2026-10-27'), transfer('2026-11-27')], [], '2026-11-28'),
    ).toEqual([]);
  });
});
