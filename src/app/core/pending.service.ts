import { Injectable, computed, inject } from '@angular/core';

import { CategoriesService } from './categories.service';
import { RecurringService } from './recurring.service';
import { TransactionsService } from './transactions.service';
import { todayKey } from './day-key';
import { PendingItem, collectPending } from './pending';

/** Платежи, ожидающие подтверждения (дата наступила, факт не подтверждён). */
@Injectable({ providedIn: 'root' })
export class PendingService {
  private readonly transactionsService = inject(TransactionsService);
  private readonly recurringService = inject(RecurringService);
  private readonly categoriesService = inject(CategoriesService);

  readonly items = computed<PendingItem[]>(() =>
    collectPending({
      transactions: this.transactionsService.transactions(),
      rules: this.recurringService.rules(),
      categories: this.categoriesService.categories(),
      today: todayKey(),
    }),
  );
}
