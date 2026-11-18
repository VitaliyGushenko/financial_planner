import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';

import { AccountsService } from '../../core/accounts.service';
import { CategoriesService } from '../../core/categories.service';
import { CurrencyService } from '../../core/currency.service';
import { GoalsService } from '../../core/goals.service';
import { PendingService } from '../../core/pending.service';
import { ProjectionService } from '../../core/projection.service';
import { TransactionsService } from '../../core/transactions.service';
import { ProjectionEvent } from '../../core/projection';
import { DayKey, formatDayKeyRelative, formatDayKeyShort, pluralRu, todayKey } from '../../core/day-key';
import { buildBudgets } from '../../core/budgets';
import { buildDigest } from '../../core/digest';
import { safeToSpend } from '../../core/safe-to-spend';
import { CountUpDirective } from '../../ui/count-up.directive';
import { IconComponent } from '../../ui/icon.component';

interface UpcomingDay {
  key: DayKey;
  label: string;
  balanceAfter: number;
  events: ProjectionEvent[];
}

@Component({
  selector: 'app-dashboard',
  imports: [RouterLink, CountUpDirective, IconComponent],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.less',
})
export class DashboardComponent {
  private readonly accountsService = inject(AccountsService);
  private readonly categoriesService = inject(CategoriesService);
  private readonly transactionsService = inject(TransactionsService);
  private readonly projectionService = inject(ProjectionService);
  private readonly pendingService = inject(PendingService);
  private readonly currency = inject(CurrencyService);
  private readonly goalsService = inject(GoalsService);

  readonly total = computed(() => this.currency.format(this.accountsService.total()));
  readonly moneyFn = (value: number) => this.currency.format(value);
  readonly accounts = this.accountsService.accounts;

  // ----- Онбординг: три шага, пока не пройдены все -----
  readonly transactionsCount = computed(() => this.transactionsService.real().length);
  readonly goalsCount = computed(() => this.goalsService.goals().length);
  readonly showOnboarding = computed(
    () =>
      this.accounts().length === 0 ||
      this.transactionsCount() === 0 ||
      this.goalsCount() === 0,
  );

  readonly projection = this.projectionService.projection;

  /** «Безопасно потратить сегодня» и контекст: минимум по прогнозу, дни до дохода. */
  readonly safe = computed(() => safeToSpend(this.projection(), 30));

  /** Бюджеты текущего месяца — компактная сводка в карточке пульса. */
  readonly budget = computed(() =>
    buildBudgets({
      categories: this.categoriesService.categories(),
      transactions: this.transactionsService.transactions(),
      month: todayKey(),
    }),
  );
  readonly budgetWidth = computed(() => Math.min(100, Math.max(0, this.budget().progress * 100)));

  readonly daysLabel = computed(() => {
    const days = this.safe().daysToIncome;
    return days === null ? '' : `${days} ${pluralRu(days, 'день', 'дня', 'дней')}`;
  });

  /** Спарклайн: 14 дней назад и 14 вперёд — видно, куда движется баланс. */
  private readonly spark = computed(() => {
    const projection = this.projection();
    const index = projection.keys.indexOf(projection.today);
    const keys = projection.keys.slice(Math.max(0, index - 14), index + 15);
    const values = keys.map((key) => projection.days.get(key)?.balance ?? 0);
    return sparkPath(values, 240, 64);
  });
  readonly sparkLine = computed(() => this.spark().line);
  readonly sparkArea = computed(() => this.spark().area);

  /** «Неделя в цифрах»: доходы/расходы, сравнение и топ-категория. */
  readonly digest = computed(() =>
    buildDigest({
      transactions: this.transactionsService.transactions(),
      categories: this.categoriesService.categories(),
      today: todayKey(),
    }),
  );
  readonly digestNet = computed(() => {
    const net = this.digest().net;
    const sign = net > 0 ? '+' : net < 0 ? '−' : '';
    return `${sign}${this.currency.format(Math.abs(net))}`;
  });
  readonly digestChange = computed(() => {
    const change = this.digest().expenseChange;
    return change === null ? null : Math.round(change * 100);
  });
  readonly digestChangeLabel = computed(() => {
    const change = this.digestChange();
    if (change === null || change === 0) {
      return null;
    }
    return `${change > 0 ? '+' : '−'}${Math.abs(change)}%`;
  });
  readonly digestChangeBad = computed(() => (this.digestChange() ?? 0) > 0);
  readonly digestChangeGood = computed(() => (this.digestChange() ?? 0) < 0);

  /** Даты хранятся строками «YYYY-MM-DD» — форматируем без LocaleId (DatePipe ломает NG0203). */
  readonly formatDay = formatDayKeyShort;

  /** Платежи, ожидающие подтверждения (редактируются на странице «Операции»). */
  readonly pending = this.pendingService.items;

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

  readonly recent = computed(() => this.transactionsService.real().slice(0, 6));

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
        ruleId: event.rule.id,
        kind: event.rule.kind,
        amount: event.rule.amount,
        accountId: event.rule.accountId,
        toAccountId: event.rule.toAccountId,
        categoryId: event.rule.categoryId,
        subcategoryId: event.rule.subcategoryId,
        note: event.rule.note || event.rule.title,
      },
      dateKey,
    );
  }
}

/** Точки спарклайна → путь линии и замкнутая область под ней. */
function sparkPath(values: number[], width: number, height: number): { line: string; area: string } {
  if (!values.length) {
    return { line: '', area: '' };
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = values.length > 1 ? width / (values.length - 1) : width;
  const points = values.map((value, index) => {
    const x = index * step;
    const y = height - 2 - ((value - min) / span) * (height - 6);
    return `${x.toFixed(1)} ${y.toFixed(1)}`;
  });
  const line = points.map((point, index) => `${index === 0 ? 'M' : 'L'}${point}`).join(' ');
  return { line, area: `${line} L${width} ${height} L0 ${height} Z` };
}
