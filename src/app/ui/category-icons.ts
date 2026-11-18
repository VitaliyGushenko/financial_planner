import { IconName } from './icon.component';

export interface CategoryIconOption {
  name: IconName;
  label: string;
}

/** Набор иконок для категорий — тот же линейный стиль, что и в навигации. */
export const CATEGORY_ICONS: CategoryIconOption[] = [
  { name: 'cart', label: 'Корзина' },
  { name: 'car', label: 'Машина' },
  { name: 'home', label: 'Дом' },
  { name: 'phone', label: 'Связь' },
  { name: 'heart', label: 'Здоровье' },
  { name: 'shirt', label: 'Одежда' },
  { name: 'smile', label: 'Развлечения' },
  { name: 'coffee', label: 'Кафе' },
  { name: 'book', label: 'Образование' },
  { name: 'plane', label: 'Поездки' },
  { name: 'dumbbell', label: 'Спорт' },
  { name: 'wrench', label: 'Ремонт' },
  { name: 'baby', label: 'Дети' },
  { name: 'gift', label: 'Подарки' },
  { name: 'bank', label: 'Банк' },
  { name: 'briefcase', label: 'Работа' },
  { name: 'dots', label: 'Прочее' },
];

const ICON_NAMES = new Set<string>(CATEGORY_ICONS.map((icon) => icon.name));

export function isCategoryIcon(value: string | undefined): value is IconName {
  return !!value && ICON_NAMES.has(value);
}

/** Иконка категории или запасная по типу операции. */
export function categoryIconName(
  icon: string | undefined,
  kind: 'income' | 'expense' | 'transfer',
): IconName {
  if (isCategoryIcon(icon)) {
    return icon;
  }
  return kind === 'income' ? 'wallet' : kind === 'transfer' ? 'card' : 'receipt';
}
