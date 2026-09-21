import { Component, computed, inject, signal } from '@angular/core';

import { AccountsService } from '../../core/accounts.service';
import { CurrencyService } from '../../core/currency.service';
import { TransactionsService } from '../../core/transactions.service';
import { ProjectionService } from '../../core/projection.service';
import { DayProjection, ProjectionEvent } from '../../core/projection';
import { DayKey, formatDayKeyShort, fromDayKey, todayKey, weekdayOf } from '../../core/day-key';

interface CalendarCell {
  key: DayKey;
  dayOfMonth: number;
  inMonth: boolean;
  weekend: boolean;
}

interface CalendarWeek {
  cells: CalendarCell[];
}

@Component({
  selector: 'app-calendar',
  imports: [],
  templateUrl: './calendar.component.html',
  styleUrl: './calendar.component.less',
})
export class CalendarComponent {
  private readonly projectionService = inject(ProjectionService);
  private readonly accountsService = inject(AccountsService);
  private readonly transactionsService = inject(TransactionsService);
  private readonly currency = inject(CurrencyService);

  readonly today = todayKey();
  readonly weekdayLabels = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

  /** Отображаемый месяц: «YYYY-MM». */
  readonly month = signal(this.currentMonthKey());
  readonly selected = signal(this.today);

  readonly monthTitle = computed(() => {
    const [y, m] = this.month().split('-').map(Number);
    return fromDayKey(`${y}-${String(m).padStart(2, '0')}-01`)
      .toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
  });

  readonly weeks = computed<CalendarWeek[]>(() => {
    const [year, month] = this.month().split('-').map(Number);
    const first = `${year}-${String(month).padStart(2, '0')}-01`;
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const lead = weekdayOf(first);
    const cells: CalendarCell[] = [];

    const push = (key: DayKey, inMonth: boolean) => {
      cells.push({
        key,
        dayOfMonth: Number(key.slice(8, 10)),
        inMonth,
        weekend: weekdayOf(key) >= 5,
      });
    };

    // Хвост предыдущего месяца.
    for (let i = lead - 1; i >= 0; i--) {
      push(shiftDay(first, -i - 1), false);
    }
    for (let d = 1; d <= daysInMonth; d++) {
      push(`${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`, true);
    }
    // Дополняем до полного количества недель.
    while (cells.length % 7 !== 0) {
      push(shiftDay(first, cells.length - lead), false);
    }

    const weeks: CalendarWeek[] = [];
    for (let i = 0; i < cells.length; i += 7) {
      weeks.push({ cells: cells.slice(i, i + 7) });
    }
    return weeks;
  });

  readonly projection = this.projectionService.projection;

  /** Данные выбранного дня, если попадает в горизонт проекции. */
  readonly selectedDay = computed<DayProjection | null>(() => this.projection().days.get(this.selected()) ?? null);

  readonly monthTotals = computed(() => {
    const [year, month] = this.month().split('-').map(Number);
    const prefix = `${year}-${String(month).padStart(2, '0')}`;
    let income = 0;
    let expense = 0;
    for (const key of this.projection().futureKeys) {
      if (!key.startsWith(prefix)) {
        continue;
      }
      for (const event of this.projection().days.get(key)?.events ?? []) {
        if (event.kind === 'income' && event.signedDelta > 0) {
          income += event.signedDelta;
        }
        if (event.kind === 'expense' && event.signedDelta < 0) {
          expense -= event.signedDelta;
        }
      }
    }
    return { income, expense };
  });

  prevMonth(): void {
    const [y, m] = this.month().split('-').map(Number);
    const nm = m === 1 ? 12 : m - 1;
    const ny = m === 1 ? y - 1 : y;
    this.month.set(`${ny}-${String(nm).padStart(2, '0')}`);
  }

  nextMonth(): void {
    const [y, m] = this.month().split('-').map(Number);
    const nm = m === 12 ? 1 : m + 1;
    const ny = m === 12 ? y + 1 : y;
    this.month.set(`${ny}-${String(nm).padStart(2, '0')}`);
  }

  goToday(): void {
    this.month.set(this.currentMonthKey());
    this.selected.set(this.today);
  }

  select(cell: CalendarCell): void {
    this.selected.set(cell.key);
    if (!cell.inMonth) {
      this.month.set(cell.key.slice(0, 7));
    }
  }

  eventsOf(key: DayKey): ProjectionEvent[] {
    return this.projection().days.get(key)?.events ?? [];
  }

  money(value: number | null | undefined): string {
    return value === null || value === undefined ? '—' : this.currency.format(value);
  }

  dayTitle(key: DayKey): string {
    if (key === this.today) {
      return 'Сегодня';
    }
    return formatDayKeyShort(key);
  }

  /** Записать планируемое событие как реальную операцию. */
  async recordEvent(day: DayProjection, eventId: string): Promise<void> {
    const event = day.events.find((e) => e.id === eventId);
    if (!event?.rule) {
      return;
    }
    await this.transactionsService.recordFromRule(
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
      day.key,
    );
  }

  accountBalance(accountId: string): string {
    return this.currency.format(this.accountsService.byId().get(accountId)?.balance ?? 0);
  }

  private currentMonthKey(): string {
    return this.today.slice(0, 7);
  }
}

function shiftDay(key: DayKey, days: number): DayKey {
  const base = fromDayKey(key).getTime() + days * 86_400_000;
  return new Date(base).toISOString().slice(0, 10);
}
