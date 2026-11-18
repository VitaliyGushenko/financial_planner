import { transactionsToCsv } from './export';
import { Account, Category, Transaction } from './models';

const ACCOUNTS: Account[] = [
  { id: 'a1', name: 'Карта', type: 'card', balance: 0, sortOrder: 0 },
  { id: 'a2', name: 'Наличные', type: 'cash', balance: 0, sortOrder: 1 },
];

const CATEGORIES: Category[] = [
  {
    id: 'food',
    name: 'Продукты',
    kind: 'expense',
    subcategories: [{ id: 'super', name: 'Супермаркет' }],
    sortOrder: 0,
  },
];

function tx(partial: Partial<Transaction> & Pick<Transaction, 'kind' | 'amount' | 'accountId' | 'date'>): Transaction {
  return { id: 't1', ...partial };
}

describe('transactionsToCsv', () => {
  it('пишет шапку и строку операции', () => {
    const csv = transactionsToCsv({
      accounts: ACCOUNTS,
      categories: CATEGORIES,
      transactions: [
        tx({
          kind: 'expense',
          amount: 1500.5,
          accountId: 'a1',
          categoryId: 'food',
          subcategoryId: 'super',
          date: '2026-11-18',
          note: 'Продукты на неделю',
        }),
      ],
    });

    const [header, row] = csv.split('\r\n');
    expect(header).toBe('Дата;Тип;Сумма;Счёт;Счёт зачисления;Категория;Подкатегория;Заметка;Проведена');
    expect(row).toBe('2026-11-18;Расход;1500,5;Карта;;Продукты;Супермаркет;Продукты на неделю;да');
  });

  it('экранирует точку с запятой и кавычки', () => {
    const csv = transactionsToCsv({
      accounts: ACCOUNTS,
      categories: CATEGORIES,
      transactions: [
        tx({
          kind: 'income',
          amount: 100,
          accountId: 'a2',
          date: '2026-11-01',
          note: 'Перевод; "срочный"',
          applied: false,
        }),
      ],
    });

    expect(csv).toContain('"Перевод; ""срочный"""');
    expect(csv).toContain(';нет');
  });

  it('подставляет названия счетов и счёта зачисления', () => {
    const csv = transactionsToCsv({
      accounts: ACCOUNTS,
      categories: [],
      transactions: [
        tx({
          kind: 'transfer',
          amount: 3000,
          accountId: 'a1',
          toAccountId: 'a2',
          date: '2026-11-02',
        }),
      ],
    });

    expect(csv).toContain('Перевод;3000;Карта;Наличные');
  });
});
