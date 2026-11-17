import { DEFAULT_CATEGORIES } from '../seed';
import { Account, Category } from '../models';
import { parseVoice, VoiceDraft } from './parse-voice';

const TODAY = '2026-11-17';

const ACCOUNTS: Account[] = [
  { id: 'cash', name: 'Наличные', type: 'cash', balance: 0, sortOrder: 0 },
  { id: 'card', name: 'Карта', type: 'card', balance: 0, sortOrder: 1 },
];

const CATEGORIES: Category[] = DEFAULT_CATEGORIES;

function parse(text: string): VoiceDraft {
  return parseVoice(text, { categories: CATEGORIES, accounts: ACCOUNTS, today: TODAY });
}

describe('parseVoice', () => {
  it('расход словами: сумма, категория и тип операции', () => {
    const draft = parse('потратил пятьсот рублей на продукты');

    expect(draft.kind).toBe('expense');
    expect(draft.amount).toBe(500);
    expect(draft.categoryId).toBe('products');
    expect(draft.date).toBe(TODAY);
    expect(draft.hints.kind).toBeTrue();
    expect(draft.hints.amount).toBeTrue();
    expect(draft.hints.category).toBeTrue();
    expect(draft.unresolved).toEqual([]);
  });

  it('понимает разговорные суммы и подкатегорию', () => {
    const draft = parse('купил бензин на две тысячи пятьсот');

    expect(draft.amount).toBe(2500);
    expect(draft.categoryId).toBe('transport');
    expect(draft.subcategoryId).toBe('transport-fuel');
  });

  it('доход: зарплата числом с «тысячами»', () => {
    const draft = parse('получил зарплату 120 тысяч');

    expect(draft.kind).toBe('income');
    expect(draft.amount).toBe(120_000);
    expect(draft.categoryId).toBe('salary');
  });

  it('премия попадает в подкатегорию «Премия»', () => {
    const draft = parse('получил премию 5000');

    expect(draft.kind).toBe('income');
    expect(draft.categoryId).toBe('salary');
    expect(draft.subcategoryId).toBe('salary-bonus');
  });

  it('«вчера» сдвигает дату и не мешает сумме', () => {
    const draft = parse('такси вчера 350');

    expect(draft.kind).toBe('expense');
    expect(draft.amount).toBe(350);
    expect(draft.date).toBe('2026-11-16');
    expect(draft.categoryId).toBe('transport');
    expect(draft.subcategoryId).toBe('transport-taxi');
    expect(draft.hints.date).toBeTrue();
  });

  it('дата «5 ноября» не превращается в сумму', () => {
    const draft = parse('купил продукты 5 ноября за 1500');

    expect(draft.amount).toBe(1500);
    expect(draft.date).toBe('2026-11-05');
  });

  it('тип операции выводится из категории, если глагола нет', () => {
    const draft = parse('продукты 1500');

    expect(draft.kind).toBe('expense');
    expect(draft.amount).toBe(1500);
    expect(draft.categoryId).toBe('products');
    expect(draft.hints.kind).toBeFalse();
  });

  it('перевод между своими счетами', () => {
    const draft = parse('перевёл с карты на наличку три тысячи');

    expect(draft.kind).toBe('transfer');
    expect(draft.amount).toBe(3000);
    expect(draft.accountId).toBe('card');
    expect(draft.toAccountId).toBe('cash');
    expect(draft.hints.account).toBeTrue();
    expect(draft.hints.toAccount).toBeTrue();
    expect(draft.categoryId).toBe('');
    expect(draft.unresolved).toEqual([]);
  });

  it('перевод, где назван только счёт зачисления', () => {
    const draft = parse('перевёл на наличку пятьсот');

    expect(draft.kind).toBe('transfer');
    expect(draft.accountId).toBe('card');
    expect(draft.toAccountId).toBe('cash');
    expect(draft.hints.toAccount).toBeTrue();
  });

  it('счёт по слову «наличкой»', () => {
    const draft = parse('наличкой 300 на кафе');

    expect(draft.amount).toBe(300);
    expect(draft.accountId).toBe('cash');
    expect(draft.hints.account).toBeTrue();
    expect(draft.categoryId).toBe('fun');
  });

  it('счёт по названию и предлогу «с»', () => {
    const draft = parse('с карты продукты 300');

    expect(draft.accountId).toBe('card');
    expect(draft.hints.account).toBeTrue();
  });

  it('копейки после рублей', () => {
    const draft = parse('потратил пятьсот рублей сорок копеек на продукты');
    expect(draft.amount).toBe(500.4);
  });

  it('копейки без слова «рублей» — число означает копейки', () => {
    expect(parse('потратил пятьсот сорок копеек на продукты').amount).toBe(5.4);
    expect(parse('потратил пятьдесят копеек на продукты').amount).toBe(0.5);
  });

  it('«с половиной» добавляет пятьдесят копеек', () => {
    expect(parse('потратил пять с половиной рублей на продукты').amount).toBe(5.5);
  });

  it('подсказывает, что не распознано', () => {
    const draft = parse('потратил на что-то');

    expect(draft.amount).toBeNull();
    expect(draft.categoryId).toBe('');
    expect(draft.unresolved).toEqual(['сумма', 'категория']);
  });

  it('пустая фраза не падает', () => {
    const draft = parse('   ');

    expect(draft.kind).toBe('expense');
    expect(draft.amount).toBeNull();
    expect(draft.date).toBe(TODAY);
    expect(draft.note).toBe('');
  });

  it('по умолчанию подставляет первый счёт, но не подсвечивает его', () => {
    const draft = parse('кофе 200');

    expect(draft.accountId).toBe('cash');
    expect(draft.hints.account).toBeFalse();
  });

  it('сохраняет исходную фразу в заметке', () => {
    const draft = parse('такси 350');
    expect(draft.note).toBe('такси 350');
  });
});
