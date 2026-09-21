import { Component, computed, inject } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';

import { AccountsService } from '../../core/accounts.service';
import { CategoriesService } from '../../core/categories.service';
import { CurrencyService } from '../../core/currency.service';
import { ProjectionService } from '../../core/projection.service';
import { TransactionsService } from '../../core/transactions.service';
import { ProjectionEvent } from '../../core/projection';
import { DayKey, formatDayKeyRelative } from '../../core/day-key';

interface UpcomingDay {
  key: DayKey;
  label: string;
  balanceAfter: number;
  events: ProjectionEvent[];
}

@Component({
  selector: 'app-dashboard',
  imports: [RouterLink, DatePipe],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.less',
})
export class DashboardComponent {
  private readonly accountsService = inject(AccountsService);
  private readonly categoriesService = inject(CategoriesService);
  private readonly transactionsService = inject(TransactionsService);
  private readonly projectionService = inject(ProjectionService);
  private readonly currency = inject(CurrencyService);

  readonly total = computed(() => this.currency.format(this.accountsService.total()));
  readonly accounts = this.accountsService.accounts;

  readonly projection = this.projectionService.projection;

  /** Ближайшие 14 дней с событиями. */
  readonly upcoming = computed<UpcomingDay[]>(() => {
    const projection = this.projection();
    const limit = 14;
    const result: UpcomingDay[] = [];
    for (const key of projection.futureKeys.slice(1, limit + 1)) {
      const day = projection.days.get(key)!;
      if (!day.events.length) {
        continue;
      }
      result.push({
        key,
        label: formatDayKeyRelative(key, projection.today),
        balanceAfter: day.balance,
        events: day.events,
      });
    }
    return result;
  });

  /** Предупреждение о дефиците на горизонте. */
  readonly deficitWarning = computed(() => {
    const first = this.projection().firstDeficitDay;
    return first ? `Остаток уходит в минус ${formatDayKeyRelative(first, this.projection().today).toLowerCase()} — проверьте планирование` : '';
  });

  readonly recent = computed(() => this.transactionsService.transactions().slice(0, 6));

  accountName(id: string | undefined): string {
    return (id && this.accountsService.byId().get(id)?.name) || '—';
  }

  /** «Продукты · Супермаркет», «Перевод: Наличные → Карта» или «Доход/Расход». */
  txTitle(tx: { kind: string; accountId: string; toAccountId?: string; categoryId?: string; subcategoryId?: string; note?: string }): string {
    if (tx.kind === 'transfer') {
      return `Перевод: ${this.accountName(tx.accountId)} → ${this.accountName(tx.toAccountId)}`;
    }
    const category = tx.categoryId ? this.categoriesService.byId().get(tx.categoryId) : undefined;
    let label = category?.name ?? '';
    const sub = category?.subcategories.find((s) => s.id === tx.subcategoryId);
    if (sub) {
      label += ` · ${sub.name}`;
    }
    return label || (tx.kind === 'income' ? 'Доход' : 'Расход');
  }

  money(value: number): string {
    return this.currency.format(value);
  }

  signed(value: number, kind: string): string {
    return kind === 'income' ? `+${this.currency.format(value)}` : `−${this.currency.format(value)}`;
  }

  amountClass(kind: string): string {
    return kind === 'income' ? 'positive' : kind === 'expense' ? 'negative' : '';
  }

  /** Записать событие из повторяющегося правила как реальную операцию. */
  recordEvent(event: ProjectionEvent, dateKey: DayKey): void {
    if (!event.rule) {
      return;
    }
    void this.transactionsService.recordFromRule(
      {
        title: event.rule.title,
        kind: event.rule.kind,
        amount: event.rule.amount,
        accountId: event.rule.accountId,
        toAccountId: event.rule.toAccountId,
        categoryId: event.rule.categoryId,
        subcategoryId: event.rule.subcategoryId,
        note: event.rule.note,
      },
      dateKey,
    );
  }
}
