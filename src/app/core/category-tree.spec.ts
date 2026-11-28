import {
  addSubcategoryNode,
  findSubcategory,
  findSubcategoryByPath,
  flattenSubcategories,
  moveSubcategoryNode,
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
});
