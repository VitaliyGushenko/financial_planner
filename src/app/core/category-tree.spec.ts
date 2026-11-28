import {
  addSubcategoryNode,
  findSubcategory,
  findSubcategoryByPath,
  flattenSubcategories,
  moveSubcategoryNode,
  moveSubcategoryRelative,
  removeSubcategoryNode,
  renameSubcategoryNode,
  subcategoryLabel,
} from './category-tree';
import { Subcategory } from './models';

function tree(): Subcategory[] {
  return [
    { id: 'food', name: 'Продукты' },
    {
      id: 'clothes',
      name: 'Одежда',
      children: [{ id: 'shoes', name: 'Обувь' }],
    },
  ];
}

describe('category-tree', () => {
  it('flattens nested nodes with depth and path', () => {
    const flat = flattenSubcategories(tree());
    expect(flat.map((item) => item.node.id)).toEqual(['food', 'clothes', 'shoes']);
    expect(flat.map((item) => item.depth)).toEqual([0, 0, 1]);
    expect(flat[2].fullPath).toBe('Одежда / Обувь');
    expect(flat[2].label).toBe('— Обувь');
  });

  it('finds a node and builds a label', () => {
    expect(findSubcategory(tree(), 'shoes')?.pathNames).toEqual(['Одежда', 'Обувь']);
    expect(subcategoryLabel(tree(), 'shoes')).toBe('Одежда / Обувь');
    expect(subcategoryLabel(tree(), 'missing')).toBe('');
  });

  it('adds a child at the requested level', () => {
    const next = addSubcategoryNode(tree(), 'clothes', { id: 'hats', name: 'Головные уборы' });
    expect(findSubcategory(next, 'hats')?.pathNames).toEqual(['Одежда', 'Головные уборы']);
    // Исходное дерево не мутируется.
    expect(findSubcategory(tree(), 'hats')).toBeUndefined();
  });

  it('renames a nested node', () => {
    const next = renameSubcategoryNode(tree(), 'shoes', 'Кроссовки');
    expect(findSubcategory(next, 'shoes')?.node.name).toBe('Кроссовки');
  });

  it('removes a node together with its children', () => {
    const next = removeSubcategoryNode(tree(), 'clothes');
    expect(flattenSubcategories(next).map((item) => item.node.id)).toEqual(['food']);
  });

  it('moves a node and forbids moving it into itself', () => {
    const moved = moveSubcategoryNode(tree(), 'shoes', 'food');
    expect(findSubcategory(moved, 'shoes')?.pathNames).toEqual(['Продукты', 'Обувь']);

    const unchanged = moveSubcategoryNode(tree(), 'clothes', 'shoes');
    expect(flattenSubcategories(unchanged).map((item) => item.node.id)).toEqual([
      'food',
      'clothes',
      'shoes',
    ]);
  });

  it('finds a node by a slash-separated path', () => {
    expect(findSubcategoryByPath(tree(), 'Одежда / Обувь')?.node.id).toBe('shoes');
    expect(findSubcategoryByPath(tree(), 'Одежда / Куртки')).toBeUndefined();
  });

  it('moves a node before, after and inside another', () => {
    const base = [
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B', children: [{ id: 'b1', name: 'B1' }] },
      { id: 'c', name: 'C' },
    ];

    expect(moveSubcategoryRelative(base, 'c', 'a', 'before').map((x) => x.id)).toEqual([
      'c',
      'a',
      'b',
    ]);
    expect(moveSubcategoryRelative(base, 'a', 'b', 'after').map((x) => x.id)).toEqual([
      'b',
      'a',
      'c',
    ]);

    const inside = moveSubcategoryRelative(base, 'a', 'b', 'inside');
    expect(inside.map((x) => x.id)).toEqual(['b', 'c']);
    expect(inside[0].children?.map((x) => x.id)).toEqual(['b1', 'a']);

    // Ребёнок переезжает на верхний уровень перед C, у B больше нет детей.
    const promoted = moveSubcategoryRelative(base, 'b1', 'c', 'before');
    expect(promoted.map((x) => x.id)).toEqual(['a', 'b', 'b1', 'c']);
    expect(promoted.find((x) => x.id === 'b')?.children).toBeUndefined();
  });

  it('не позволяет перетащить узел в собственного потомка', () => {
    const base = [
      { id: 'parent', name: 'Родитель', children: [{ id: 'child', name: 'Ребёнок' }] },
      { id: 'other', name: 'Другое' },
    ];
    expect(moveSubcategoryRelative(base, 'parent', 'child', 'inside')).toEqual(base);
    expect(moveSubcategoryRelative(base, 'parent', 'child', 'before')).toEqual(base);
  });
});
