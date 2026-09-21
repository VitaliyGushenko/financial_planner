import { Injectable, computed } from '@angular/core';
import { Timestamp, addDoc, deleteDoc, serverTimestamp, updateDoc } from '@angular/fire/firestore';

import { Goal } from './models';
import { DayKey } from './day-key';
import { UserCollectionService } from './user-collection.service';

export interface GoalDraft {
  title: string;
  amount: number;
  deadline: DayKey | null;
  note?: string;
}

@Injectable({ providedIn: 'root' })
export class GoalsService extends UserCollectionService<Goal> {
  protected get collectionName(): string {
    return 'goals';
  }

  /** Активные цели — от ближайшего срока (или новейшие). */
  readonly goals = computed(() =>
    [...this.items()]
      .filter((g) => g.status === 'active')
      .sort((a, b) => (a.deadline ?? '9999').localeCompare(b.deadline ?? '9999') || b.id.localeCompare(a.id)),
  );

  readonly doneGoals = computed(() => this.items().filter((g) => g.status === 'done'));

  async create(draft: GoalDraft): Promise<void> {
    if (!this.isReady) {
      return;
    }
    await addDoc(this.colRef(), {
      ...draft,
      title: draft.title.trim(),
      status: 'active',
      createdAt: serverTimestamp(),
    });
  }

  async markDone(id: string): Promise<void> {
    if (!this.isReady) {
      return;
    }
    await updateDoc(this.docRef(id), { status: 'done' });
  }

  async reopen(id: string): Promise<void> {
    if (!this.isReady) {
      return;
    }
    await updateDoc(this.docRef(id), { status: 'active' });
  }

  async remove(id: string): Promise<void> {
    if (!this.isReady) {
      return;
    }
    await deleteDoc(this.docRef(id));
  }

  createdOf(goal: Goal): Timestamp | null {
    return goal.createdAt instanceof Timestamp ? goal.createdAt : null;
  }
}
