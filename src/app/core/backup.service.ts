import { Injectable, inject } from '@angular/core';
import { Firestore, collection, doc, getDocs, writeBatch } from '@angular/fire/firestore';

import { AuthService } from './auth.service';
import { BackupInput } from './export';

type CollectionName = 'accounts' | 'categories' | 'transactions' | 'recurring' | 'goals';

/**
 * Полное восстановление из JSON-бэкапа: коллекции заменяются целиком,
 * балансы берутся из файла (их не пересчитываем — они уже итоговые).
 */
@Injectable({ providedIn: 'root' })
export class BackupService {
  private readonly firestore = inject(Firestore);
  private readonly auth = inject(AuthService);

  async replaceAll(data: BackupInput): Promise<void> {
    const uid = this.auth.user()?.uid;
    if (!uid) {
      return;
    }
    await this.replaceCollection('accounts', data.accounts, uid);
    await this.replaceCollection('categories', data.categories, uid);
    await this.replaceCollection('transactions', data.transactions, uid);
    await this.replaceCollection('recurring', data.recurring, uid);
    await this.replaceCollection('goals', data.goals, uid);
  }

  private async replaceCollection<T extends { id: string }>(
    name: CollectionName,
    items: readonly T[],
    uid: string,
  ): Promise<void> {
    const col = collection(this.firestore, 'users', uid, name);
    const existing = await getDocs(col);

    // Firestore: не больше 500 операций на batch.
    for (let i = 0; i < existing.docs.length; i += 400) {
      const batch = writeBatch(this.firestore);
      for (const snapshot of existing.docs.slice(i, i + 400)) {
        batch.delete(snapshot.ref);
      }
      await batch.commit();
    }

    for (let i = 0; i < items.length; i += 400) {
      const batch = writeBatch(this.firestore);
      for (const item of items.slice(i, i + 400)) {
        const { id, ...rest } = item;
        batch.set(doc(this.firestore, 'users', uid, name, id), rest as Record<string, unknown>);
      }
      await batch.commit();
    }
  }
}
