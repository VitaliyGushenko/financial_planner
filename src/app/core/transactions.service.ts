import { Injectable, computed, inject } from '@angular/core';
import { Timestamp, doc, increment, serverTimestamp, setDoc, writeBatch } from '@angular/fire/firestore';

import { Transaction, TransactionDraft } from './models';
import { round2 } from './money';
import { todayKey } from './day-key';
import { UserCollectionService } from './user-collection.service';

/**
 * Разовые операции. Прошлые (и сегодняшние) при записи сразу меняют
 * балансы счетов; будущие — нет, они живут в проекции (календарь,
 * советчик) и попадают в балансы только после подтверждения пользователем
 * (карточка «Ожидают подтверждения» на дашборде).
 */
@Injectable({ providedIn: 'root' })
export class TransactionsService extends UserCollectionService<Transaction> {
  protected get collectionName(): string {
    return 'transactions';
  }

  /** Операции: свежие сверху (по дате, затем по времени создания). */
  readonly transactions = computed(() =>
    [...this.items()].sort((a, b) => b.date.localeCompare(a.date) || this.byCreated(b) - this.byCreated(a)),
  );

  /** Подтверждённые операции — то, что показывается в журнале. */
  readonly real = computed(() => this.transactions().filter((t) => t.applied !== false));

  constructor() {
    super();
  }

  async add(draft: TransactionDraft): Promise<void> {
    if (!this.isReady) {
      return;
    }
    const applied = draft.date <= todayKey();
    const ref = doc(this.colRef());
    const batch = writeBatch(this.firestore);
    batch.set(ref, { ...draft, applied, createdAt: serverTimestamp() });
    if (applied) {
      this.applyDeltas(batch, draft, +1);
    }
    await batch.commit();
  }

  async update(id: string, draft: TransactionDraft): Promise<void> {
    const old = this.items().find((t) => t.id === id);
    if (!old || !this.isReady) {
      return;
    }
    const applied = draft.date <= todayKey();
    const batch = writeBatch(this.firestore);
    batch.set(this.docRef(id), { ...draft, applied, createdAt: old.createdAt ?? serverTimestamp() });
    if (old.applied) {
      this.applyDeltas(batch, old, -1);
    }
    if (applied) {
      this.applyDeltas(batch, draft, +1);
    }
    await batch.commit();
  }

  async remove(id: string): Promise<void> {
    const old = this.items().find((t) => t.id === id);
    if (!old || !this.isReady) {
      return;
    }
    const batch = writeBatch(this.firestore);
    batch.delete(this.docRef(id));
    if (old.applied) {
      this.applyDeltas(batch, old, -1);
    }
    await batch.commit();
  }

  /** Создаёт операцию из вхождения повторяющегося правила (кнопка «Записать»/подтверждение). */
  async recordFromRule(
    rule: {
      ruleId?: string;
      kind: TransactionDraft['kind'];
      amount: number;
      accountId: string;
      toAccountId?: string;
      categoryId?: string;
      subcategoryId?: string;
      note?: string;
    },
    dateKey: string,
  ): Promise<void> {
    await this.add({
      kind: rule.kind,
      amount: rule.amount,
      accountId: rule.accountId,
      toAccountId: rule.toAccountId,
      categoryId: rule.categoryId,
      subcategoryId: rule.subcategoryId,
      date: dateKey,
      note: rule.note,
      ruleId: rule.ruleId,
    });
  }

  /**
   * Подтверждение плановой операции, чья дата наступила: фиксируем
   * фактическую сумму и доначисляем её к балансам счетов.
   */
  async confirm(txId: string, actualAmount: number): Promise<void> {
    const old = this.items().find((t) => t.id === txId);
    if (!old || old.applied || !this.isReady) {
      return;
    }
    const amount = round2(actualAmount);
    const batch = writeBatch(this.firestore);
    batch.update(this.docRef(txId), { amount, applied: true });
    this.applyDeltas(batch, { ...old, amount }, +1);
    await batch.commit();
  }

  /**
   * Влияние операции на балансы счетов. sign=1 — применить, sign=-1 — отменить.
   * Перевод двигает деньги между своими счетами (на общий баланс не влияет).
   */
  private applyDeltas(
    batch: ReturnType<typeof writeBatch>,
    tx: Pick<TransactionDraft, 'kind' | 'amount' | 'accountId' | 'toAccountId'>,
    sign: 1 | -1,
  ): void {
    if (tx.kind === 'transfer') {
      this.applyDelta(batch, tx.accountId, -sign * tx.amount);
      if (tx.toAccountId) {
        this.applyDelta(batch, tx.toAccountId, sign * tx.amount);
      }
      return;
    }
    const factor = tx.kind === 'income' ? 1 : -1;
    this.applyDelta(batch, tx.accountId, sign * factor * tx.amount);
  }

  private applyDelta(
    batch: ReturnType<typeof writeBatch>,
    accountId: string | undefined,
    delta: number,
  ): void {
    if (!accountId || !delta) {
      return;
    }
    batch.update(doc(this.firestore, 'users', this.uid, 'accounts', accountId), {
      balance: increment(round2(delta)),
    });
  }

  private byCreated(t: Transaction): number {
    return t.createdAt instanceof Timestamp ? t.createdAt.toMillis() : 0;
  }
}
