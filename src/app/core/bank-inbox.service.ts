import { Injectable, computed } from '@angular/core';
import { Timestamp, writeBatch } from '@angular/fire/firestore';

import { BankInboxItem } from './models';
import { UserCollectionService } from './user-collection.service';

/** Пуши банка, которые companion-приложение не смогло превратить в операцию. */
@Injectable({ providedIn: 'root' })
export class BankInboxService extends UserCollectionService<BankInboxItem> {
  protected get collectionName(): string {
    return 'bankInbox';
  }

  readonly inbox = computed(() => [...this.items()].sort((a, b) => this.time(b) - this.time(a)));

  readonly count = computed(() => this.items().length);

  async remove(id: string): Promise<void> {
    if (!this.isReady) {
      return;
    }
    const batch = writeBatch(this.firestore);
    batch.delete(this.docRef(id));
    await batch.commit();
  }

  async clear(): Promise<void> {
    if (!this.isReady) {
      return;
    }
    const list = this.items();
    for (let start = 0; start < list.length; start += 80) {
      const batch = writeBatch(this.firestore);
      for (const item of list.slice(start, start + 80)) {
        batch.delete(this.docRef(item.id));
      }
      await batch.commit();
    }
  }

  private time(item: BankInboxItem): number {
    if (item.postedAt instanceof Timestamp) {
      return item.postedAt.toMillis();
    }
    if (item.createdAt instanceof Timestamp) {
      return item.createdAt.toMillis();
    }
    return 0;
  }
}
