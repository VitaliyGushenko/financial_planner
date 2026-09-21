import { Injectable, computed, inject } from '@angular/core';

import { AccountsService } from './accounts.service';
import { CategoriesService } from './categories.service';
import { RecurringService } from './recurring.service';
import { TransactionsService } from './transactions.service';
import { todayKey } from './day-key';
import { Projection, buildProjection } from './projection';

/** Общая проекция остатков: пересчитывается при любом изменении данных. */
@Injectable({ providedIn: 'root' })
export class ProjectionService {
  private readonly accountsService = inject(AccountsService);
  private readonly transactionsService = inject(TransactionsService);
  private readonly recurringService = inject(RecurringService);
  private readonly categoriesService = inject(CategoriesService);

  readonly projection = computed<Projection>(() =>
    buildProjection({
      accounts: this.accountsService.accounts(),
      transactions: this.transactionsService.transactions(),
      rules: this.recurringService.rules(),
      categories: this.categoriesService.categories(),
      today: todayKey(),
    }),
  );
}
