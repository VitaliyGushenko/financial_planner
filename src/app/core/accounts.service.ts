import { Injectable, computed } from '@angular/core';
import { UpdateData, addDoc, deleteDoc, doc, increment, updateDoc } from '@angular/fire/firestore';

import { Account, AccountType } from './models';
import { round2 } from './money';
import { UserCollectionService } from './user-collection.service';

export interface AccountDraft {
  name: string;
  type: AccountType;
  balance: number;
}

@Injectable({ providedIn: 'root' })
export class AccountsService extends UserCollectionService<Account> {
  protected get collectionName(): string {
    return 'accounts';
  }

  /** Счета в порядке сортировки. */
  readonly accounts = computed(() =>
    [...this.items()].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
  );

  /** Суммарный остаток по всем счетам — «сколько денег сейчас». */
  readonly total = computed(() => round2(this.accounts().reduce((sum, a) => sum + (a.balance || 0), 0)));

  readonly byId = computed(() => new Map(this.accounts().map((a) => [a.id, a])));

  async create(draft: AccountDraft): Promise<void> {
    if (!this.isReady) {
      return;
    }
    const maxOrder = this.accounts().reduce((max, a) => Math.max(max, a.sortOrder), -1);
    await addDoc(this.colRef(), {
      name: draft.name.trim(),
      type: draft.type,
      balance: round2(draft.balance || 0),
      sortOrder: maxOrder + 1,
    });
  }

  async update(id: string, changes: Partial<Omit<Account, 'id'>>): Promise<void> {
    if (!this.isReady) {
      return;
    }
    const patch: UpdateData<Account> = {};
    if (changes.name !== undefined) {
      patch['name'] = changes.name.trim();
    }
    if (changes.type !== undefined) {
      patch['type'] = changes.type;
    }
    if (changes.balance !== undefined) {
      patch['balance'] = round2(changes.balance);
    }
    if (changes.sortOrder !== undefined) {
      patch['sortOrder'] = changes.sortOrder;
    }
    await updateDoc(this.docRef(id), patch);
  }

  async remove(id: string): Promise<void> {
    if (!this.isReady) {
      return;
    }
    await deleteDoc(this.docRef(id));
  }
}
