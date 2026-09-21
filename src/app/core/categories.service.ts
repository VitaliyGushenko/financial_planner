import { Injectable, computed } from '@angular/core';
import { addDoc, arrayRemove, arrayUnion, deleteDoc, updateDoc } from '@angular/fire/firestore';

import { Category, CategoryKind, Subcategory } from './models';
import { UserCollectionService } from './user-collection.service';

@Injectable({ providedIn: 'root' })
export class CategoriesService extends UserCollectionService<Category> {
  protected get collectionName(): string {
    return 'categories';
  }

  readonly categories = computed(() =>
    [...this.items()].sort((a, b) => a.kind.localeCompare(b.kind) || a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
  );

  readonly incomeCategories = computed(() => this.categories().filter((c) => c.kind === 'income'));
  readonly expenseCategories = computed(() => this.categories().filter((c) => c.kind === 'expense'));

  readonly byId = computed(() => new Map(this.categories().map((c) => [c.id, c])));

  categoriesOf(kind: CategoryKind): Category[] {
    return kind === 'income' ? this.incomeCategories() : this.expenseCategories();
  }

  async create(name: string, kind: CategoryKind): Promise<void> {
    if (!this.isReady || !name.trim()) {
      return;
    }
    const siblings = this.categoriesOf(kind);
    const maxOrder = siblings.reduce((max, c) => Math.max(max, c.sortOrder), -1);
    await addDoc(this.colRef(), {
      name: name.trim(),
      kind,
      subcategories: [],
      sortOrder: maxOrder + 1,
    });
  }

  async rename(id: string, name: string): Promise<void> {
    if (!this.isReady || !name.trim()) {
      return;
    }
    await updateDoc(this.docRef(id), { name: name.trim() });
  }

  async remove(id: string): Promise<void> {
    if (!this.isReady) {
      return;
    }
    await deleteDoc(this.docRef(id));
  }

  async addSubcategory(categoryId: string, name: string): Promise<void> {
    if (!this.isReady || !name.trim()) {
      return;
    }
    const sub: Subcategory = { id: genId(), name: name.trim() };
    await updateDoc(this.docRef(categoryId), { subcategories: arrayUnion(sub) });
  }

  async removeSubcategory(categoryId: string, subId: string): Promise<void> {
    if (!this.isReady) {
      return;
    }
    const category = this.byId().get(categoryId);
    const sub = category?.subcategories.find((s) => s.id === subId);
    if (!sub) {
      return;
    }
    await updateDoc(this.docRef(categoryId), { subcategories: arrayRemove(sub) });
  }
}

/** Локальный уникальный id для подкатегорий ( Firestore auto-id тоже подходит ). */
function genId(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 20; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}
