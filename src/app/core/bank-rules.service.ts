import { Injectable, computed } from '@angular/core';
import { addDoc, deleteDoc, deleteField, serverTimestamp, updateDoc } from '@angular/fire/firestore';

import { BankRule, CategoryKind } from './models';
import { UserCollectionService } from './user-collection.service';
import { normalizeForMatch } from './bank-rules';

export interface BankRuleDraft {
  keywords: string[];
  match?: 'any' | 'all';
  kind: CategoryKind;
  categoryId: string;
  subcategoryId?: string;
  priority?: number;
  enabled: boolean;
}

/** Правила автокатегоризации операций из пушей банка. */
@Injectable({ providedIn: 'root' })
export class BankRulesService extends UserCollectionService<BankRule> {
  protected get collectionName(): string {
    return 'bankRules';
  }

  readonly rules = computed(() =>
    [...this.items()].sort(
      (a, b) =>
        a.kind.localeCompare(b.kind) ||
        (b.priority ?? 0) - (a.priority ?? 0) ||
        a.keywords.join(',').localeCompare(b.keywords.join(',')),
    ),
  );

  readonly activeCount = computed(() => this.items().filter((rule) => rule.enabled !== false).length);

  async create(draft: BankRuleDraft): Promise<string | null> {
    if (!this.isReady) {
      return null;
    }
    const keywords = draft.keywords.map(normalizeForMatch).filter(Boolean);
    if (!keywords.length || !draft.categoryId) {
      return null;
    }
    const ref = await addDoc(this.colRef(), {
      keywords,
      match: draft.match ?? 'any',
      kind: draft.kind,
      categoryId: draft.categoryId,
      ...(draft.subcategoryId ? { subcategoryId: draft.subcategoryId } : {}),
      priority: draft.priority ?? 0,
      enabled: draft.enabled,
      createdAt: serverTimestamp(),
    });
    return ref.id;
  }

  async update(id: string, draft: BankRuleDraft): Promise<void> {
    if (!this.isReady) {
      return;
    }
    const keywords = draft.keywords.map(normalizeForMatch).filter(Boolean);
    if (!keywords.length || !draft.categoryId) {
      return;
    }
    await updateDoc(this.docRef(id), {
      keywords,
      match: draft.match ?? 'any',
      kind: draft.kind,
      categoryId: draft.categoryId,
      subcategoryId: draft.subcategoryId ?? deleteField(),
      priority: draft.priority ?? 0,
      enabled: draft.enabled,
    });
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    if (!this.isReady) {
      return;
    }
    await updateDoc(this.docRef(id), { enabled });
  }

  async remove(id: string): Promise<void> {
    if (!this.isReady) {
      return;
    }
    await deleteDoc(this.docRef(id));
  }
}
