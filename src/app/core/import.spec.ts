import { parseBackupFile, parseTransactionsCsv, planImport } from './import';
import { Account, Category, Transaction } from './models';

const TODAY = '2026-11-18';

const ACCOUNTS: Account[] = [
  { id: 'card', name: 'Карта', type: 'card', balance: 0, sortOrder: 0 },
  { id: 'cash', name: 'Наличные', type: 'cash', balance: 0, sortOrder: 1 },
];

const CATEGORIES: Category[] = [
  {
    id: 'food',
    name: 'Продукты',
    kind: 'expense',
    subcategories: [{ id: 'super', name: 'Супермаркет' }],
    sortOrder: 0,
  },
  { id: 'salary', name: 'Зарплата', kind: 'income', subcategories: [], sortOrder: 1 },
];

const HEADER = 'Дата;Тип;Сумма;Счёт;Счёт зачисления;Категория;Подкатегория;Заметка;Проведена';

describe('parseTransactionsCsv', () => {
  it('читает файл из экспорта приложения', () => {
    const { rows, errors } = parseTransactionsCsv(
      `\uFEFF${HEADER}\r\n2026-11-18;Расход;1 500,50;Карта;;Продукты;Супермаркет;Продукты на неделю;да\r\n`,
    );

    expect(errors).toEqual([]);
    expect(rows.length).toBe(1);
    expect(rows[0]).toEqual({
      line: 2,
      date: '2026-11-18',
      kind: 'expense',
      amount: 1500.5,
      accountName: 'Карта',
      toAccountName: '',
      categoryName: 'Продукты',
      subcategoryName: 'Супермаркет',
      note: 'Продукты на неделю',
      applied: true,
    });
  });

  it('понимает запятую как разделитель и кавычки', () => {
    const { rows } = parseTransactionsCsv(
      'Дата,Тип,Сумма,Счёт,Заметка\n2026-11-01,Доход,1000,Наличные,"Перевод, срочный"',
    );

    expect(rows[0].note).toBe('Перевод, срочный');
    expect(rows[0].kind).toBe('income');
  });

  it('помечает плановую операцию', () => {
    const { rows } = parseTransactionsCsv(`${HEADER}\n2026-12-01;Расход;500;Карта;;; ;Аренда;нет`);

    expect(rows[0].applied).toBeFalse();
    expect(rows[0].kind).toBe('expense');
  });

  it('собирает ошибки по строкам', () => {
    const { rows, errors } = parseTransactionsCsv(
      `${HEADER}\n18.11.2026;Расход;100;Карта;;; ;;\n2026-11-18;Расход;abc;Карта;;; ;;`,
    );

    expect(rows.length).toBe(0);
    expect(errors.length).toBe(2);
    expect(errors[0]).toContain('Строка 2');
    expect(errors[1]).toContain('Строка 3');
  });

  it('сообщает, если нет обязательных колонок', () => {
    const { errors } = parseTransactionsCsv('Дата;Сумма\n2026-11-18;100');

    expect(errors.some((error) => error.includes('Счёт'))).toBeTrue();
  });
});

describe('planImport', () => {
  function parse(csv: string) {
    return parseTransactionsCsv(`${HEADER}\n${csv}`).rows;
  }

  it('сопоставляет счета и категории', () => {
    const plan = planImport({
      rows: parse('2026-11-18;Расход;1500;Карта;;Продукты;Супермаркет;Продукты;да'),
      accounts: ACCOUNTS,
      categories: CATEGORIES,
      transactions: [],
      today: TODAY,
    });

    expect(plan.errors).toEqual([]);
    expect(plan.drafts.length).toBe(1);
    const draft = plan.drafts[0];
    expect(draft.kind).toBe('expense');
    expect(draft.amount).toBe(1500);
    expect(draft.accountId).toBe('card');
    expect(draft.categoryId).toBe('food');
    expect(draft.subcategoryId).toBe('super');
    expect(draft.applied).toBeTrue();
  });

  it('перевод требует счёт зачисления', () => {
    const plan = planImport({
      rows: parse('2026-11-18;Перевод;3000;Карта;Наличные;;;;да'),
      accounts: ACCOUNTS,
      categories: CATEGORIES,
      transactions: [],
      today: TODAY,
    });

    expect(plan.drafts[0].toAccountId).toBe('cash');
  });

  it('будущая дата импортируется как плановая', () => {
    const plan = planImport({
      rows: parse('2026-12-01;Расход;500;Карта;;Продукты;;Аренда;да'),
      accounts: ACCOUNTS,
      categories: CATEGORIES,
      transactions: [],
      today: TODAY,
    });

    expect(plan.drafts[0].applied).toBeFalse();
  });

  it('пропускает дубликаты уже существующих операций', () => {
    const existing: Transaction[] = [
      {
        id: 't1',
        kind: 'expense',
        amount: 1500,
        accountId: 'card',
        categoryId: 'food',
        date: '2026-11-18',
        note: 'Продукты',
      },
    ];
    const plan = planImport({
      rows: parse('2026-11-18;Расход;1500;Карта;;Продукты;;Продукты;да'),
      accounts: ACCOUNTS,
      categories: CATEGORIES,
      transactions: existing,
      today: TODAY,
    });

    expect(plan.drafts.length).toBe(0);
    expect(plan.duplicates).toBe(1);
  });

  it('сообщает о неизвестной категории и пропускает строку', () => {
    const plan = planImport({
      rows: parse('2026-11-18;Расход;1500;Карта;;Такси;;Поездка;да'),
      accounts: ACCOUNTS,
      categories: CATEGORIES,
      transactions: [],
      today: TODAY,
    });

    expect(plan.drafts.length).toBe(0);
    expect(plan.missingCategories).toEqual([{ name: 'Такси', kind: 'expense' }]);
  });

  it('сообщает о неизвестном счёте', () => {
    const plan = planImport({
      rows: parse('2026-11-18;Расход;1500;Сбер;;Продукты;;;да'),
      accounts: ACCOUNTS,
      categories: CATEGORIES,
      transactions: [],
      today: TODAY,
    });

    expect(plan.errors[0]).toContain('Сбер');
  });
});

describe('parseBackupFile', () => {
  it('принимает бэкап приложения', () => {
    const { backup, error } = parseBackupFile(
      JSON.stringify({
        format: 'financial-planner-backup',
        version: 1,
        exportedAt: '2026-11-18T10:00:00.000Z',
        accounts: ACCOUNTS,
        categories: CATEGORIES,
        transactions: [],
        recurring: [],
        goals: [],
      }),
    );

    expect(error).toBeNull();
    expect(backup?.accounts.length).toBe(2);
  });

  it('отклоняет чужие файлы', () => {
    expect(parseBackupFile('{"foo":1}').error).toContain('не файл бэкапа');
    expect(parseBackupFile('не json').error).toContain('не похож на JSON');
  });
});
