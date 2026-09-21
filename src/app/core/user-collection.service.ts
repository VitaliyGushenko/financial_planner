import { Injector, effect, inject, runInInjectionContext, signal } from '@angular/core';
import { Firestore, collection, collectionData, doc } from '@angular/fire/firestore';
import { Subscription } from 'rxjs';

import { AuthService } from './auth.service';

/**
 * База сервисов данных: живой слушатель подколлекции users/{uid}/{name}.
 * При выходе пользователя (или смене) слушатель пересоздаётся, кэш чистится.
 */
export abstract class UserCollectionService<T extends { id: string }> {
  protected readonly firestore = inject(Firestore);
  protected readonly auth = inject(AuthService);
  private readonly injector = inject(Injector);

  /** Сырой поток документов коллекции. */
  protected readonly items = signal<T[]>([]);

  private sub?: Subscription;
  private lastUid: string | null = null;

  protected abstract get collectionName(): string;

  constructor() {
    effect(() => {
      const uid = this.auth.user()?.uid ?? null;
      if (uid === this.lastUid) {
        return;
      }
      this.lastUid = uid;
      this.sub?.unsubscribe();
      this.items.set([]);
      if (uid) {
        this.sub = runInInjectionContext(this.injector, () =>
          collectionData(collection(this.firestore, 'users', uid, this.collectionName), { idField: 'id' }),
        ).subscribe((list) => this.items.set(list as T[]));
      }
    });
  }

  protected get uid(): string {
    const uid = this.auth.user()?.uid;
    if (!uid) {
      throw new Error('Пользователь не авторизован');
    }
    return uid;
  }

  protected get isReady(): boolean {
    return Boolean(this.auth.user()?.uid);
  }

  protected colRef() {
    return collection(this.firestore, 'users', this.uid, this.collectionName);
  }

  protected docRef(id: string) {
    return doc(this.firestore, 'users', this.uid, this.collectionName, id);
  }
}
