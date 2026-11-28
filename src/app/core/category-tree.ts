import { Subcategory } from './models';

/**
 * Работа с деревом подкатегорий.
 *
 * В Firestore подкатегории хранятся массивом внутри категории, а вложенность —
 * через `children`. Транзакции и правила ссылаются на id узла, поэтому
 * переименование/перемещение не ломает историю.
 */

export interface FlatSubcategory {
  node: Subcategory;
  /** 0 — прямая подкатегория категории, 1 — её ребёнок и т.д. */
  depth: number;
  pathIds: string[];
  pathNames: string[];
  /** Подпись для <option>: «— — Название» по глубине. */
  label: string;
  /** Полный путь без отступа: «Одежда / Обувь». */
  fullPath: string;
}

export function flattenSubcategories(
  subs: readonly Subcategory[] | undefined,
): FlatSubcategory[] {
  const out: FlatSubcategory[] = [];
  const walk = (
    list: readonly Subcategory[],
    depth: number,
    pathIds: string[],
    pathNames: string[],
  ): void => {
    for (const node of list) {
      const ids = [...pathIds, node.id];
      const names = [...pathNames, node.name];
      out.push({
        node,
        depth,
        pathIds: ids,
        pathNames: names,
        label: `${'— '.repeat(depth)}${node.name}`,
        fullPath: names.join(' / '),
      });
      if (node.children?.length) {
        walk(node.children, depth + 1, ids, names);
      }
    }
  };
  walk(subs ?? [], 0, [], []);
  return out;
}

/** Узел по id или undefined. */
export function findSubcategory(
  subs: readonly Subcategory[] | undefined,
  id: string | undefined,
): FlatSubcategory | undefined {
  if (!id) {
    return undefined;
  }
  return flattenSubcategories(subs).find((item) => item.node.id === id);
}

/** Полный путь узла: «Одежда / Обувь». */
export function subcategoryLabel(
  subs: readonly Subcategory[] | undefined,
  id: string | undefined,
  separator = ' / ',
): string {
  const found = findSubcategory(subs, id);
  return found ? found.pathNames.join(separator) : '';
}

/** Есть ли id среди потомков (или сам узел). */
export function isSubcategoryInTree(
  subs: readonly Subcategory[] | undefined,
  id: string,
): boolean {
  return flattenSubcategories(subs).some((item) => item.node.id === id);
}

/** Добавить узел под parentId (null — на верхний уровень подкатегорий). */
export function addSubcategoryNode(
  subs: readonly Subcategory[] | undefined,
  parentId: string | null,
  node: Subcategory,
): Subcategory[] {
  const list: Subcategory[] = [...(subs ?? [])];
  if (!parentId) {
    return [...list, node];
  }
  const add = (items: readonly Subcategory[]): { items: Subcategory[]; added: boolean } => {
    let added = false;
    const items2 = items.map((item) => {
      if (item.id === parentId) {
        added = true;
        return { ...item, children: [...(item.children ?? []), node] };
      }
      if (item.children?.length) {
        const nested = add(item.children);
        if (nested.added) {
          added = true;
          return { ...item, children: nested.items };
        }
      }
      return item;
    });
    return { items: items2, added };
  };
  const result = add(list);
  return result.added ? result.items : list;
}

export function renameSubcategoryNode(
  subs: readonly Subcategory[] | undefined,
  id: string,
  name: string,
): Subcategory[] {
  const rename = (items: readonly Subcategory[]): { items: Subcategory[]; renamed: boolean } => {
    let renamed = false;
    const items2 = items.map((item) => {
      let next: Subcategory = item;
      if (item.id === id) {
        next = { ...item, name };
        renamed = true;
      }
      if (item.children?.length) {
        const nested = rename(item.children);
        if (nested.renamed) {
          renamed = true;
          next = { ...next, children: nested.items };
        }
      }
      return next;
    });
    return { items: items2, renamed };
  };
  return rename(subs ?? []).items;
}

/** Удалить узел вместе с вложенными. */
export function removeSubcategoryNode(
  subs: readonly Subcategory[] | undefined,
  id: string,
): Subcategory[] {
  const out: Subcategory[] = [];
  for (const item of subs ?? []) {
    if (item.id === id) {
      continue;
    }
    const children = item.children ? removeSubcategoryNode(item.children, id) : [];
    const next: Subcategory = { id: item.id, name: item.name };
    if (children.length) {
      next.children = children;
    }
    out.push(next);
  }
  return out;
}

/** Переместить узел под другого родителя (null — на верхний уровень). */
export function moveSubcategoryNode(
  subs: readonly Subcategory[] | undefined,
  id: string,
  newParentId: string | null,
): Subcategory[] {
  const list = subs ?? [];
  const node = findSubcategory(list, id);
  if (!node) {
    return [...list];
  }
  if (newParentId) {
    const target = findSubcategory(list, newParentId);
    // Нельзя переместить в себя или в собственного потомка.
    if (!target || target.pathIds.includes(id)) {
      return [...list];
    }
  }
  if ((node.pathIds[node.pathIds.length - 2] ?? null) === newParentId) {
    return [...list];
  }
  const without = removeSubcategoryNode(list, id);
  return addSubcategoryNode(without, newParentId, node.node);
}

/** Изменить один узел дерева (иммутабельно). */
export function updateSubcategoryNode(
  subs: readonly Subcategory[] | undefined,
  id: string,
  update: (node: Subcategory) => Subcategory,
): Subcategory[] {
  const walk = (items: readonly Subcategory[]): { items: Subcategory[]; changed: boolean } => {
    let changed = false;
    const out = items.map((item) => {
      let next = item;
      if (item.id === id) {
        next = update(item);
        changed = true;
      }
      if (item.children?.length) {
        const nested = walk(item.children);
        if (nested.changed) {
          next = { ...next, children: nested.items };
          changed = true;
        }
      }
      return next;
    });
    return { items: changed ? out : (items as Subcategory[]), changed };
  };
  return walk(subs ?? []).items;
}

export type SubDropPosition = 'before' | 'after' | 'inside';

/** Переместить узел относительно другого: до, после или внутрь. */
export function moveSubcategoryRelative(
  subs: readonly Subcategory[] | undefined,
  id: string,
  targetId: string,
  position: SubDropPosition,
): Subcategory[] {
  const list = [...(subs ?? [])];
  if (id === targetId) {
    return list;
  }
  const node = findSubcategory(list, id);
  const target = findSubcategory(list, targetId);
  if (!node || !target) {
    return list;
  }
  // Нельзя перетащить узел в себя или в собственного потомка.
  if (target.pathIds.includes(id)) {
    return list;
  }
  const without = removeSubcategoryNode(list, id);
  if (position === 'inside') {
    return addSubcategoryNode(without, targetId, node.node);
  }
  const parentId = target.pathIds[target.pathIds.length - 2] ?? null;
  return insertRelative(without, parentId, targetId, position, node.node);
}

function insertRelative(
  subs: readonly Subcategory[],
  parentId: string | null,
  targetId: string,
  position: 'before' | 'after',
  node: Subcategory,
): Subcategory[] {
  if (parentId === null) {
    const index = subs.findIndex((item) => item.id === targetId);
    if (index < 0) {
      return [...subs];
    }
    const at = position === 'before' ? index : index + 1;
    return [...subs.slice(0, at), node, ...subs.slice(at)];
  }

  let inserted = false;
  const walk = (items: Subcategory[]): Subcategory[] => {
    const index = items.findIndex((item) => item.id === targetId);
    if (index >= 0) {
      const at = position === 'before' ? index : index + 1;
      inserted = true;
      return [...items.slice(0, at), node, ...items.slice(at)];
    }
    let changed = false;
    const out = items.map((item) => {
      if (inserted || !item.children?.length) {
        return item;
      }
      const children = walk(item.children);
      if (inserted) {
        changed = true;
        return { ...item, children };
      }
      return item;
    });
    return changed ? out : items;
  };

  const result = walk([...subs]);
  return inserted ? result : [...subs];
}

/** Найти узел по пути «Одежда / Обувь» (регистр не важен). */
export function findSubcategoryByPath(
  subs: readonly Subcategory[] | undefined,
  path: string,
): FlatSubcategory | undefined {
  const parts = path
    .split(/\s*(?:\/|·|>)\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (!parts.length) {
    return undefined;
  }
  let list: readonly Subcategory[] = subs ?? [];
  let current: Subcategory | undefined;
  for (const part of parts) {
    current = list.find((item) => item.name.toLowerCase() === part.toLowerCase());
    if (!current) {
      return undefined;
    }
    list = current.children ?? [];
  }
  return current ? findSubcategory(subs, current.id) : undefined;
}
