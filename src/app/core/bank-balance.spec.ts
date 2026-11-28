import { latestBankMark, parseBankBalance, parseBankDate, reconcileAccount } from './bank-balance';
import { Transaction } from './models';

function tx(overrides: Partial<Transaction> & Pick<Transaction, 'id' | 'kind' | 'amount' | 'accountId' | 'date'>): Transaction {
  return {
    source: 'bank',
    rawText: '',
    ...overrides,
  } as Transaction;
}

/** Firestore Timestamp в тестах: достаточно toDate(). */
function at(iso: string): Transaction['createdAt'] {
  return { toDate: () => new Date(iso) } as unknown as Transaction['createdAt'];
}

const OPLATA_RAW =
  'OPLATA 31.70 BYN KARTA #1310 DATA 27.11.2026 16:56:57 SHOP \'MATERIK\' >VITEBSK>BY OSTATOK 1937.12 BYN';

describe('bank-balance', () => {
  it('parses OSTATOK and the notification timestamp', () => {
    expect(parseBankBalance(OPLATA_RAW)).toBe(1937.12);
    expect(parseBankDate(OPLATA_RAW)?.dateKey).toBe('2026-11-27');
    expect(parseBankDate(OPLATA_RAW)?.at.getHours()).toBe(16);
    expect(parseBankBalance('без остатка')).toBeNull();
  });

  it('takes the latest notification with OSTATOK', () => {
    const items = [
      tx({
        id: 'old',
        kind: 'expense',
        amount: 10,
        accountId: 'card',
        date: '2026-11-01',
        rawText: "OPLATA 10.00 BYN KARTA #1310 DATA 01.11.2026 10:00:00 SHOP >MINSK>BY OSTATOK 100.00 BYN",
      }),
      tx({
        id: 'new',
        kind: 'expense',
        amount: 20,
        accountId: 'card',
        date: '2026-11-02',
        rawText: "OPLATA 20.00 BYN KARTA #1310 DATA 02.11.2026 12:00:00 SHOP >MINSK>BY OSTATOK 80.00 BYN",
      }),
    ];
    expect(latestBankMark(items, 'card')?.transactionId).toBe('new');
  });

  it('reconciles after the mark and ignores the mark itself', () => {
    const markTx = tx({
      id: 'mark',
      kind: 'expense',
      amount: 31.7,
      accountId: 'card',
      date: '2026-11-27',
      rawText: OPLATA_RAW,
      createdAt: at('2026-11-27T13:57:00Z'),
    });
    const later = tx({
      id: 'later',
      kind: 'expense',
      amount: 20,
      accountId: 'card',
      date: '2026-11-27',
      source: 'manual',
      createdAt: at('2026-11-27T14:10:00Z'),
    });
    const mark = latestBankMark([markTx, later], 'card');
    expect(mark).not.toBeNull();

    const result = reconcileAccount(1917.12, mark!, [markTx, later], 'card');
    // 1937.12 (OSTATOK) − 20.00 (позже) = 1917.12
    expect(result.after).toBe(-20);
    expect(result.expected).toBe(1917.12);
    expect(result.drift).toBe(0);
  });

  it('shows drift when the app balance does not match the bank', () => {
    const markTx = tx({
      id: 'mark',
      kind: 'expense',
      amount: 10,
      accountId: 'card',
      date: '2026-11-27',
      rawText: "OPLATA 10.00 BYN KARTA #1310 DATA 27.11.2026 10:00:00 SHOP >MINSK>BY OSTATOK 90.00 BYN",
      createdAt: at('2026-11-27T07:00:00Z'),
    });
    const mark = latestBankMark([markTx], 'card')!;
    const result = reconcileAccount(100, mark, [markTx], 'card');
    expect(result.expected).toBe(90);
    expect(result.drift).toBe(10);
  });

  it('accounts for transfers between own accounts', () => {
    const markTx = tx({
      id: 'mark',
      kind: 'expense',
      amount: 1,
      accountId: 'card',
      date: '2026-11-27',
      rawText: "OPLATA 1.00 BYN KARTA #1310 DATA 27.11.2026 10:00:00 SHOP >MINSK>BY OSTATOK 99.00 BYN",
      createdAt: at('2026-11-27T07:00:00Z'),
    });
    const transfer = tx({
      id: 'tr',
      kind: 'transfer',
      amount: 50,
      accountId: 'card',
      toAccountId: 'cash',
      date: '2026-11-28',
      source: 'manual',
    });
    const mark = latestBankMark([markTx], 'card')!;
    expect(reconcileAccount(49, mark, [markTx, transfer], 'card').drift).toBe(0);
    expect(reconcileAccount(149, mark, [markTx, transfer], 'cash').drift).toBe(0);
  });
});
