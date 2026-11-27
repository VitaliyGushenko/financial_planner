import {
  keywordFromTransaction,
  normalizeForMatch,
  parseKeywordsInput,
  pickBankRule,
  planBulkCategorization,
  ruleMatches,
  transactionHaystack,
} from './bank-rules';
import { BankRule, Transaction } from './models';

const RULES: BankRule[] = [
  {
    id: 'r-ozon',
    keywords: ['OZON'],
    kind: 'expense',
    categoryId: 'market',
    enabled: true,
    priority: 10,
  },
  {
    id: 'r-uslug',
    keywords: ['OPLATA USLUG'],
    kind: 'expense',
    categoryId: 'utils',
    enabled: true,
    priority: 5,
  },
  {
    id: 'r-food',
    keywords: ['VESTA', 'FIX PRICE'],
    kind: 'expense',
    categoryId: 'food',
    enabled: true,
  },
  {
    id: 'r-salary',
    keywords: ['ZACHISLENIE'],
    kind: 'income',
    categoryId: 'salary',
    enabled: true,
  },
  {
    id: 'r-off',
    keywords: ['OZON'],
    kind: 'expense',
    categoryId: 'other',
    enabled: false,
  },
];

function tx(id: string, patch: Partial<Transaction> = {}): Transaction {
  return {
    id,
    kind: 'expense',
    amount: 10,
    accountId: 'a1',
    date: '2026-11-24',
    applied: true,
    ...patch,
  };
}

describe('bank-rules', () => {
  it('нормализует текст: регистр, ё и пробелы', () => {
    expect(normalizeForMatch('  оплата   Услуг  ')).toBe('ОПЛАТА УСЛУГ');
    expect(normalizeForMatch('Всё Ёлки')).toBe('ВСЕ ЕЛКИ');
    expect(normalizeForMatch(null)).toBe('');
  });

  it('находит ключевое слово внутри транслитерированного текста', () => {
    const text = 'OPLATA 9.66 BYN KARTA #1310 DATA 23.11.2026 OZON >MINSKIY R-N>BY OSTATOK 1246.65 BYN';
    const rule = pickBankRule(RULES, text, 'expense');
    expect(rule?.categoryId).toBe('market');
  });

  it('не применяет отключённые правила', () => {
    const rule = RULES.find((r) => r.id === 'r-off')!;
    expect(ruleMatches(rule, 'OZON')).toBeFalse();
  });

  it('различает доход и расход', () => {
    const income = 'ZACHISLENIE NA SCHET KARTA #7880 DATA 24.11.2026 SUMMA 1182.00 BYN';
    expect(pickBankRule(RULES, income, 'income')?.categoryId).toBe('salary');
    expect(pickBankRule(RULES, income, 'expense')).toBeNull();
  });

  it('выбирает правило с большим приоритетом', () => {
    const rules: BankRule[] = [
      { id: 'low', keywords: ['SHOP'], kind: 'expense', categoryId: 'a', enabled: true, priority: 1 },
      { id: 'high', keywords: ['SHOP'], kind: 'expense', categoryId: 'b', enabled: true, priority: 9 },
    ];
    expect(pickBankRule(rules, 'SHOP OAO VESTA', 'expense')?.categoryId).toBe('b');
  });

  it('режим all требует все слова', () => {
    const rule: BankRule = {
      id: 'all',
      keywords: ['BAPB', 'USLUG'],
      match: 'all',
      kind: 'expense',
      categoryId: 'utils',
      enabled: true,
    };
    expect(ruleMatches(rule, 'BAPB - OPLATA USLUG >MINSK')).toBeTrue();
    expect(ruleMatches(rule, 'BAPB - OPLATA')).toBeFalse();
  });

  it('планирует массовую разметку только для операций без категории', () => {
    const plan = planBulkCategorization(
      [
        tx('t1', { merchant: 'OZON' }),
        tx('t2', { merchant: 'OZON', categoryId: 'already' }),
        tx('t3', { merchant: 'OZON', applied: false }),
        tx('t4', { kind: 'transfer' }),
        tx('t5', { merchant: 'НЕИЗВЕСТНО' }),
      ],
      RULES,
    );
    expect(plan.length).toBe(1);
    expect(plan[0].id).toBe('t1');
    expect(plan[0].categoryId).toBe('market');
  });

  it('собирает ключевое слово из операции', () => {
    expect(keywordFromTransaction({ merchant: 'SHOP OAO VESTA BR.795/' })).toBe('SHOP OAO VESTA BR.795/');
    expect(keywordFromTransaction({ note: 'кофе' })).toBe('кофе');
    expect(keywordFromTransaction({})).toBeNull();
  });

  it('строит haystack из мерчанта, заметки и текста', () => {
    expect(transactionHaystack({ merchant: 'OZON', note: 'покупка', rawText: 'OPLATA' })).toBe(
      'OZON покупка OPLATA',
    );
  });

  it('разбирает ввод ключевых слов через запятую', () => {
    expect(parseKeywordsInput('ozon, wildberries; fix price\nvesta')).toEqual([
      'ozon',
      'wildberries',
      'fix price',
      'vesta',
    ]);
  });
});
