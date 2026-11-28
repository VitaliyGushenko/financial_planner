import { Injectable, inject } from '@angular/core';
import { Firestore, collection, doc, getDocs, writeBatch } from '@angular/fire/firestore';

import { AuthService } from './auth.service';
import { buildBackup, Backup, BackupInput } from './export';

type CollectionName = 'accounts' | 'categories' | 'transactions' | 'recurring' | 'goals' | 'bankRules';

const AUTO_KEY = 'financial-planner.auto-backup.v1';
const AUTO_PREV_KEY = 'financial-planner.auto-backup.prev.v1';
/** localStorage обычно ~5 МБ; оставляем запас. */
const MAX_BYTES = 4_500_000;

export interface AutoBackupInfo {
  savedAt: string;
  bytes: number;
  counts: {
    accounts: number;
    categories: number;
    transactions: number;
    recurring: number;
    goals: number;
    bankRules: number;
  };
}

interface StoredAutoBackup {
  savedAt: string;
  backup: Backup;
}

/**
 * Полное восстановление из JSON-бэкапа: коллекции заменяются целиком,
 * балансы берутся из файла (их не пересчитываем — они уже итоговые).
 *
 * Дополнительно хранит ежедневный автобэкап в localStorage: он защищает
 * от случайных удалений внутри приложения, но не от потери телефона.
 * Для внешней копии используйте «Скачать JSON».
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
    if (data.bankRules) {
      await this.replaceCollection('bankRules', data.bankRules, uid);
    }
  }

  /** Сохранить автобэкап; null — не поместился в localStorage. */
  saveAuto(data: BackupInput): AutoBackupInfo | null {
    if (typeof localStorage === 'undefined') {
      return null;
    }
    try {
      const backup = buildBackup(data);
      const payload: StoredAutoBackup = {
        savedAt: new Date().toISOString(),
        backup,
      };
      const text = JSON.stringify(payload);
      if (text.length > MAX_BYTES) {
        return null;
      }
      const current = localStorage.getItem(AUTO_KEY);
      if (current) {
        localStorage.setItem(AUTO_PREV_KEY, current);
      }
      localStorage.setItem(AUTO_KEY, text);
      return this.infoOf(payload, text.length);
    } catch {
      return null;
    }
  }

  /** Информация о последнем автобэкапе. */
  autoInfo(): AutoBackupInfo | null {
    const stored = this.readAuto(AUTO_KEY);
    if (!stored) {
      return null;
    }
    const text = localStorage.getItem(AUTO_KEY) ?? '';
    return this.infoOf(stored, text.length);
  }

  /** Последний автобэкап. */
  autoBackup(): Backup | null {
    return this.readAuto(AUTO_KEY)?.backup ?? null;
  }

  /** Предыдущий автобэкап — на случай, если последний неудачный. */
  previousAutoBackup(): Backup | null {
    return this.readAuto(AUTO_PREV_KEY)?.backup ?? null;
  }

  private readAuto(key: string): StoredAutoBackup | null {
    if (typeof localStorage === 'undefined') {
      return null;
    }
    try {
      const raw = localStorage.getItem(key);
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw) as StoredAutoBackup;
      if (!parsed?.backup || parsed.backup.format !== 'financial-planner-backup') {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  private infoOf(payload: StoredAutoBackup, bytes: number): AutoBackupInfo {
    const backup = payload.backup;
    return {
      savedAt: payload.savedAt,
      bytes,
      counts: {
        accounts: backup.accounts?.length ?? 0,
        categories: backup.categories?.length ?? 0,
        transactions: backup.transactions?.length ?? 0,
        recurring: backup.recurring?.length ?? 0,
        goals: backup.goals?.length ?? 0,
        bankRules: backup.bankRules?.length ?? 0,
      },
    };
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
