import { Firestore, doc, writeBatch } from '@angular/fire/firestore';

import { Category, Subcategory } from './models';

/**
 * Стартовые данные нового пользователя: два счёта и базовый набор
 * категорий с подкатегориями. Пишется одним batch при первом входе.
 */
export async function seedUserData(firestore: Firestore, uid: string): Promise<void> {
  const batch = writeBatch(firestore);
  const base = `users/${uid}`;

  batch.set(doc(firestore, `${base}/accounts/cash`), { name: 'Наличные', type: 'cash', balance: 0, sortOrder: 0 });
  batch.set(doc(firestore, `${base}/accounts/card`), { name: 'Карта', type: 'card', balance: 0, sortOrder: 1 });

  let order = 0;
  for (const category of DEFAULT_CATEGORIES) {
    batch.set(doc(firestore, `${base}/categories/${category.id}`), {
      name: category.name,
      kind: category.kind,
      subcategories: category.subcategories,
      sortOrder: order++,
    });
  }

  await batch.commit();
}

const INCOME_SUBS: Record<string, Subcategory[]> = {
  salary: [{ id: 'salary-main', name: 'Основная' }, { id: 'salary-bonus', name: 'Премия' }],
};

const EXPENSE_SUBS: Record<string, Subcategory[]> = {
  products: [{ id: 'products-super', name: 'Супермаркет' }, { id: 'products-delivery', name: 'Доставка' }],
  transport: [{ id: 'transport-fuel', name: 'Бензин' }, { id: 'transport-fare', name: 'Проезд' }, { id: 'transport-taxi', name: 'Такси' }],
  housing: [{ id: 'housing-rent', name: 'Аренда' }, { id: 'housing-utilities', name: 'Коммуналка' }, { id: 'housing-internet', name: 'Интернет' }],
  health: [{ id: 'health-meds', name: 'Лекарства' }, { id: 'health-doctor', name: 'Врачи' }],
};

export const DEFAULT_CATEGORIES: Category[] = [
  { id: 'salary', name: 'Зарплата', kind: 'income', subcategories: INCOME_SUBS['salary'], sortOrder: 0 },
  { id: 'avans', name: 'Аванс', kind: 'income', subcategories: [], sortOrder: 1 },
  { id: 'transfer-in', name: 'Перевод', kind: 'income', subcategories: [], sortOrder: 2 },
  { id: 'products', name: 'Продукты', kind: 'expense', subcategories: EXPENSE_SUBS['products'], sortOrder: 0 },
  { id: 'transport', name: 'Транспорт', kind: 'expense', subcategories: EXPENSE_SUBS['transport'], sortOrder: 1 },
  { id: 'housing', name: 'Жильё', kind: 'expense', subcategories: EXPENSE_SUBS['housing'], sortOrder: 2 },
  { id: 'communication', name: 'Связь', kind: 'expense', subcategories: [{ id: 'comm-mobile', name: 'Мобильная связь' }], sortOrder: 3 },
  { id: 'health', name: 'Здоровье', kind: 'expense', subcategories: EXPENSE_SUBS['health'], sortOrder: 4 },
  { id: 'clothes', name: 'Одежда', kind: 'expense', subcategories: [], sortOrder: 5 },
  { id: 'fun', name: 'Развлечения', kind: 'expense', subcategories: [], sortOrder: 6 },
  { id: 'other-expense', name: 'Прочее', kind: 'expense', subcategories: [], sortOrder: 7 },
];
