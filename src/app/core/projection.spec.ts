import { Account, Category, RecurringRule, Transaction } from './models';
import { addMonthsToKey, addYearsToKey } from './day-key';
import { Projection, buildProjection, occurrencesOfRule } from './projection';

const TODAY = '2026-09-21';

function account(id: string, balance: number): Account {
  return { id, name: id, type: 'card', balance, sortOrder: 0 };
}

function tx(id: string, patch: Partial<Transaction> = {}): Transaction {
  return { id, kind: 'expense', amount: 100, accountId: 'a1', date: TODAY, ...patch };
}

function rule(id: string, patch: Partial<RecurringRule> = {}): RecurringRule {
  return {
    id,
    title: '',
    kind: 'income',
    amount: 500,
    accountId: 'a1',
    frequency: 'monthly',
    every: 1,
    startDate: TODAY,
    endDate: null,
    ...patch,
  };
}

const EMPTY_CATEGORIES: Category[] = [];

describe('day-key арифметика', () => {
  it('прижимает день месяца при переходе через короткий месяц', () => {
    expect(addMonthsToKey('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonthsToKey('2024-01-31', 1)).toBe('2024-02-29'); // високосный
    expect(addMonthsToKey('2026-05-15', 3)).toBe('2026-08-15');
  });

  it('прижимает 29 февраля при прибавлении лет', () => {
    expect(addYearsToKey('2024-02-29', 1)).toBe('2025-02-28');
    expect(addYearsToKey('2024-02-29', 4)).toBe('2028-02-29');
  });
});

describe('occurrencesOfRule', () => {
  it('каждую неделю: вхождения через 7 дней, старт строго внутри диапазона', () => {
    const weekly = rule('r', { frequency: 'weekly', startDate: '2026-09-01' });
    expect(occurrencesOfRule(weekly, '2026-09-21', '2026-10-10')).toEqual([
      '2026-09-22',
      '2026-09-29',
      '2026-10-06',
    ]);
  });

  it('каждый месяц сохраняет день месяца с прижиманием', () => {
    const monthly = rule('r', { startDate: '2026-01-31' });
    expect(occurrencesOfRule(monthly, '2026-01-01', '2026-04-30')).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
    ]);
  });

  it('свой интервал «каждые 10 дней»', () => {
    const custom = rule('r', { frequency: 'custom', every: 10, customUnit: 'days', startDate: '2026-09-01' });
    expect(occurrencesOfRule(custom, '2026-09-01', '2026-09-30')).toEqual([
      '2026-09-01',
      '2026-09-11',
      '2026-09-21',
    ]);
  });

  it('уважает endDate', () => {
    const bounded = rule('r', { frequency: 'weekly', startDate: '2026-09-01', endDate: '2026-09-25' });
    expect(occurrencesOfRule(bounded, '2026-09-21', '2026-10-31')).toEqual(['2026-09-22']);
  });
});

describe('buildProjection', () => {
  it('пример из жизни: 1000 сейчас + зарплата 500 завтра → 1500 на послезавтра', () => {
    const projection = buildProjection({
      accounts: [account('a1', 1000)],
      transactions: [],
      rules: [rule('salary', { amount: 500, frequency: 'weekly', startDate: '2026-09-22' })],
      categories: EMPTY_CATEGORIES,
      today: TODAY,
      horizonDays: 30,
    });

    expect(projection.totalNow).toBe(1000);
    expect(projection.days.get('2026-09-21')?.balance).toBe(1000);
    expect(projection.days.get('2026-09-22')?.balance).toBe(1500);
    expect(projection.days.get('2026-09-23')?.balance).toBe(1500);
    expect(projection.days.get('2026-09-22')?.events.length).toBe(1);
    expect(projection.days.get('2026-09-22')?.events[0].signedDelta).toBe(500);
  });

  it('прошлые операции не участвуют: факт уже зашит в балансах', () => {
    const projection = buildProjection({
      accounts: [account('a1', 1000)],
      transactions: [tx('t1', { date: '2026-09-20', amount: 300 })],
      rules: [],
      categories: EMPTY_CATEGORIES,
      today: TODAY,
      horizonDays: 10,
    });
    expect(projection.days.get(TODAY)?.balance).toBe(1000);
  });

  it('будущая разовая покупка учитывается один раз в свой день', () => {
    const projection = buildProjection({
      accounts: [account('a1', 1000)],
      transactions: [tx('t1', { date: '2026-09-25', amount: 1200 })],
      rules: [],
      categories: EMPTY_CATEGORIES,
      today: TODAY,
      horizonDays: 10,
    });
    expect(projection.days.get('2026-09-24')?.balance).toBe(1000);
    expect(projection.days.get('2026-09-25')?.balance).toBe(-200);
    expect(projection.days.get('2026-09-26')?.balance).toBe(-200);
    expect(projection.firstDeficitDay).toBe('2026-09-25');
  });

  it('перевод между счетами не меняет общий остаток', () => {
    const projection = buildProjection({
      accounts: [account('a1', 1000), account('a2', 200)],
      transactions: [
        tx('t1', { kind: 'transfer', amount: 700, accountId: 'a1', toAccountId: 'a2', date: '2026-09-23' }),
      ],
      rules: [],
      categories: EMPTY_CATEGORIES,
      today: TODAY,
      horizonDays: 10,
    });
    expect(projection.days.get('2026-09-22')?.balance).toBe(1200);
    expect(projection.days.get('2026-09-23')?.balance).toBe(1200);
  });

  it('итоговый остаток считается по всем счетам', () => {
    const projection = buildProjection({
      accounts: [account('a1', 1000), account('a2', 250.5)],
      transactions: [],
      rules: [],
      categories: EMPTY_CATEGORIES,
      today: TODAY,
      horizonDays: 5,
      pastDays: 0,
    });
    expect(projection.totalNow).toBe(1250.5);
    expect(projection.keys.length).toBe(6); // today + 5 дней
  });
});
