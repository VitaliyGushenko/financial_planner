import { Injectable, computed } from '@angular/core';
import { Timestamp, addDoc, arrayUnion, deleteDoc, serverTimestamp, updateDoc } from '@angular/fire/firestore';

import { RecurringRule } from './models';
import { DayKey, pluralRu } from './day-key';
import { occurrencesOfRule } from './projection';
import { UserCollectionService } from './user-collection.service';

export interface RecurringDraft {
  title: string;
  kind: RecurringRule['kind'];
  amount: number;
  accountId: string;
  toAccountId?: string;
  categoryId?: string;
  subcategoryId?: string;
  frequency: RecurringRule['frequency'];
  every: number;
  customUnit?: RecurringRule['customUnit'];
  startDate: DayKey;
  endDate: DayKey | null;
  note?: string;
}

@Injectable({ providedIn: 'root' })
export class RecurringService extends UserCollectionService<RecurringRule> {
  protected get collectionName(): string {
    return 'recurring';
  }

  readonly rules = computed(() =>
    [...this.items()].sort((a, b) => a.startDate.localeCompare(b.startDate) || a.title.localeCompare(b.title)),
  );

  readonly byId = computed(() => new Map(this.rules().map((r) => [r.id, r])));

  async create(draft: RecurringDraft): Promise<void> {
    if (!this.isReady) {
      return;
    }
    await addDoc(this.colRef(), { ...draft, title: draft.title.trim(), createdAt: serverTimestamp() });
  }

  async update(id: string, draft: RecurringDraft): Promise<void> {
    if (!this.isReady) {
      return;
    }
    await updateDoc(this.docRef(id), { ...draft, title: draft.title.trim() });
  }

  async remove(id: string): Promise<void> {
    if (!this.isReady) {
      return;
    }
    await deleteDoc(this.docRef(id));
  }

  /** Отметить вхождение правила пропущенным: деньги не пришли, операция не нужна. */
  async skipOccurrence(ruleId: string, dateKey: DayKey): Promise<void> {
    if (!this.isReady) {
      return;
    }
    await updateDoc(this.docRef(ruleId), { skippedDates: arrayUnion(dateKey) });
  }

  /** Следующие n вхождений правила начиная строго после afterKey. */
  nextOccurrences(rule: RecurringRule, afterKey: DayKey, n = 2): DayKey[] {
    const horizon = addDaysSafe(afterKey, 3650);
    return occurrencesOfRule(rule, afterKey, horizon).slice(0, n);
  }

  createdOf(rule: RecurringRule): Timestamp | null {
    return rule.createdAt instanceof Timestamp ? rule.createdAt : null;
  }
}

function addDaysSafe(key: DayKey, days: number): DayKey {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d, 12) + days * 86_400_000);
  return date.toISOString().slice(0, 10);
}

/** Человеческое описание периодичности: «каждый месяц», «каждые 2 недели»… */
export function describeFrequency(rule: Pick<RecurringRule, 'frequency' | 'every' | 'customUnit'>): string {
  switch (rule.frequency) {
    case 'weekly':
      return 'каждую неделю';
    case 'monthly':
      return 'каждый месяц';
    case 'yearly':
      return 'каждый год';
    case 'custom': {
      const n = Math.max(1, rule.every || 1);
      if (n === 1) {
        switch (rule.customUnit) {
          case 'days': return 'каждый день';
          case 'weeks': return 'каждую неделю';
          case 'months': return 'каждый месяц';
          case 'years': return 'каждый год';
          default: return 'по своему интервалу';
        }
      }
      switch (rule.customUnit) {
        case 'days': return `каждые ${n} ${pluralRu(n, 'день', 'дня', 'дней')}`;
        case 'weeks': return `каждые ${n} ${pluralRu(n, 'неделю', 'недели', 'недель')}`;
        case 'months': return `каждые ${n} ${pluralRu(n, 'месяц', 'месяца', 'месяцев')}`;
        case 'years': return `каждые ${n} ${pluralRu(n, 'год', 'года', 'лет')}`;
        default: return `каждые ${n}`;
      }
    }
  }
}
