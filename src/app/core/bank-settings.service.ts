import { Injectable, effect, inject, signal } from '@angular/core';
import { Firestore, deleteField, doc, getDoc, setDoc } from '@angular/fire/firestore';

import { AuthService } from './auth.service';

/** Настройки приёма операций из банка (общие для веба и Android-компаньона). */
export interface BankSettings {
  /** Счёт по умолчанию, если маска карты не совпала ни с одним счётом. */
  defaultAccountId?: string;
  /** Счёт наличных: снятие наличных можно оформлять переводом. */
  cashAccountId?: string;
}

/**
 * Один документ `users/{uid}/bankSettings/main`.
 * Его читает companion-приложение, поэтому настройка «основная карта»
 * работает без заполнения масок.
 */
@Injectable({ providedIn: 'root' })
export class BankSettingsService {
  private readonly firestore = inject(Firestore);
  private readonly auth = inject(AuthService);

  readonly settings = signal<BankSettings>({});
  private lastUid: string | null = null;

  constructor() {
    effect(() => {
      const uid = this.auth.user()?.uid ?? null;
      if (uid === this.lastUid) {
        return;
      }
      this.lastUid = uid;
      this.settings.set({});
      if (uid) {
        void this.load(uid);
      }
    });
  }

  private ref(uid: string) {
    return doc(this.firestore, 'users', uid, 'bankSettings', 'main');
  }

  private async load(uid: string): Promise<void> {
    try {
      const snapshot = await getDoc(this.ref(uid));
      if (uid === this.lastUid) {
        this.settings.set(snapshot.exists() ? (snapshot.data() as BankSettings) : {});
      }
    } catch {
      // нет доступа/сети — оставляем пустые настройки
    }
  }

  async save(patch: Partial<BankSettings>): Promise<void> {
    const uid = this.auth.user()?.uid;
    if (!uid) {
      return;
    }
    const data: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(patch)) {
      data[key] = value ? value : deleteField();
    }
    await setDoc(this.ref(uid), data, { merge: true });
    this.settings.update((current) => {
      const next: BankSettings = { ...current };
      for (const [key, value] of Object.entries(patch)) {
        if (value) {
          (next as Record<string, unknown>)[key] = value;
        } else {
          delete (next as Record<string, unknown>)[key];
        }
      }
      return next;
    });
  }
}
