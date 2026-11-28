import { Injectable, computed } from '@angular/core';
import { addDoc, deleteDoc, deleteField, updateDoc } from '@angular/fire/firestore';

import { Category, CategoryKind, Subcategory } from './models';
import { addSubcategoryNode, moveSubcategoryNode, moveSubcategoryRelative, removeSubcategoryNode, renameSubcategoryNode, updateSubcategoryNode, SubDropPosition } from './category-tree';
import { round2 } from './money';
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

  async create(name: string, kind: CategoryKind): Promise<string | null> {
    if (!this.isReady || !name.trim()) {
      return null;
    }
    const siblings = this.categoriesOf(kind);
    const maxOrder = siblings.reduce((max, c) => Math.max(max, c.sortOrder), -1);
    const ref = await addDoc(this.colRef(), {
      name: name.trim(),
      kind,
      subcategories: [],
      sortOrder: maxOrder + 1,
    });
    return ref.id;
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

  /** Месячный лимит по категории; null — убрать бюджет. */
  async setBudget(categoryId: string, budget: number | null): Promise<void> {
    if (!this.isReady) {
      return;
    }
    await updateDoc(this.docRef(categoryId), {
      budget: budget && budget > 0 ? round2(budget) : deleteField(),
    });
  }

  /** Иконка категории; null — без иконки. */
  async setIcon(categoryId: string, icon: string | null): Promise<void> {
    if (!this.isReady) {
      return;
    }
    await updateDoc(this.docRef(categoryId), { icon: icon ?? deleteField() });
  }

  async addSubcategory(
    categoryId: string,
    name: string,
    parentId: string | null = null,
  ): Promise<void> {
    if (!this.isReady || !name.trim()) {
      return;
    }
    const category = this.byId().get(categoryId);
    if (!category) {
      return;
    }
    const sub: Subcategory = { id: genId(), name: name.trim() };
    const subcategories = addSubcategoryNode(category.subcategories, parentId, sub);
    await updateDoc(this.docRef(categoryId), { subcategories });
  }

  async renameSubcategory(categoryId: string, subId: string, name: string): Promise<void> {
    if (!this.isReady || !name.trim()) {
      return;
    }
    const category = this.byId().get(categoryId);
    if (!category) {
      return;
    }
    const subcategories = renameSubcategoryNode(category.subcategories, subId, name.trim());
    await updateDoc(this.docRef(categoryId), { subcategories });
  }

  async removeSubcategory(categoryId: string, subId: string): Promise<void> {
    if (!this.isReady) {
      return;
    }
    const category = this.byId().get(categoryId);
    if (!category) {
      return;
    }
    const subcategories = removeSubcategoryNode(category.subcategories, subId);
    await updateDoc(this.docRef(categoryId), { subcategories });
  }

  /** Переместить подкатегорию (вместе с её детьми) к другому родителю. */
  async moveSubcategory(
    categoryId: string,
    subId: string,
    newParentId: string | null,
  ): Promise<void> {
    if (!this.isReady) {
      return;
    }
    const category = this.byId().get(categoryId);
    if (!category) {
      return;
    }
    const subcategories = moveSubcategoryNode(category.subcategories, subId, newParentId);
    await updateDoc(this.docRef(categoryId), { subcategories });
  }

  /** Переместить узел до/после другого или внутрь него (drag-and-drop). */
  async moveSubcategoryRelative(
    categoryId: string,
    subId: string,
    targetId: string,
    position: SubDropPosition,
  ): Promise<void> {
    if (!this.isReady) {
      return;
    }
    const category = this.byId().get(categoryId);
    if (!category) {
      return;
    }
    const subcategories = moveSubcategoryRelative(category.subcategories, subId, targetId, position);
    await updateDoc(this.docRef(categoryId), { subcategories });
  }

  /** Месячный лимит на подкатегории; null — убрать бюджет. */
  async setSubcategoryBudget(
    categoryId: string,
    subId: string,
    budget: number | null,
  ): Promise<void> {
    if (!this.isReady) {
      return;
    }
    const category = this.byId().get(categoryId);
    if (!category) {
      return;
    }
    const subcategories = updateSubcategoryNode(category.subcategories, subId, (node) => {
      const next = { ...node };
      if (budget && budget > 0) {
        next.budget = round2(budget);
      } else {
        delete next.budget;
      }
      return next;
    });
    await updateDoc(this.docRef(categoryId), { subcategories });
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
