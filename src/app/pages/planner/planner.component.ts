import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { GoalsService } from '../../core/goals.service';
import { ProjectionService } from '../../core/projection.service';
import { CurrencyService } from '../../core/currency.service';
import { advisePurchase, PurchaseAdvice } from '../../core/advisor';
import { DayKey, formatDayKeyRelative } from '../../core/day-key';

@Component({
  selector: 'app-planner',
  imports: [FormsModule],
  templateUrl: './planner.component.html',
  styleUrl: './planner.component.less',
})
export class PlannerComponent {
  private readonly goalsService = inject(GoalsService);
  private readonly projectionService = inject(ProjectionService);
  private readonly currency = inject(CurrencyService);
  readonly curr = this.currency;

  // Быстрый расчёт «хочу купить».
  quick = {
    title: '',
    amount: null as number | null,
    deadline: '',
  };
  readonly quickError = signal('');
  // Обычный метод, а не computed: quick.amount — не сигнал, иначе подсказка не обновлялась бы при вводе.
  quickAdvice(): PurchaseAdvice | null {
    const amount = Number(this.quick.amount);
    if (!amount || amount <= 0) {
      return null;
    }
    return advisePurchase(this.projectionService.projection(), amount, {
      deadline: this.quick.deadline || null,
      currency: this.currency.currency(),
    });
  }

  readonly goals = this.goalsService.goals;
  readonly projection = this.projectionService.projection;

  /** Советчик по каждой активной цели. */
  readonly goalAdvices = computed<Map<string, PurchaseAdvice>>(() => {
    const projection = this.projectionService.projection();
    const map = new Map<string, PurchaseAdvice>();
    for (const goal of this.goals()) {
      map.set(
        goal.id,
        advisePurchase(projection, goal.amount, {
          deadline: goal.deadline,
          currency: this.currency.currency(),
        }),
      );
    }
    return map;
  });

  readonly deficitDays = computed<DayKey[]>(() => {
    const projection = this.projection();
    return projection.futureKeys.filter((k) => (projection.days.get(k)?.balance ?? 0) < 0);
  });

  addGoal(): void {
    const amount = Number(this.quick.amount);
    if (!this.quick.title.trim()) {
      this.quickError.set('Укажите название покупки.');
      return;
    }
    if (!amount || amount <= 0) {
      this.quickError.set('Укажите сумму больше нуля.');
      return;
    }
    void this.goalsService.create({
      title: this.quick.title,
      amount,
      deadline: this.quick.deadline || null,
    });
    this.quick = { title: '', amount: null, deadline: '' };
    this.quickError.set('');
  }

  adviceFor(goalId: string): PurchaseAdvice | null {
    return this.goalAdvices().get(goalId) ?? null;
  }

  dateLabel(key: DayKey | null): string {
    if (!key) {
      return '—';
    }
    const label = formatDayKeyRelative(key, this.projection().today);
    return label === 'Сегодня' || label === 'Завтра' || label === 'Вчера' ? label.toLowerCase() : label;
  }

  money(value: number | null | undefined): string {
    return value === null || value === undefined ? '—' : this.currency.format(value);
  }

  markDone(goalId: string): void {
    void this.goalsService.markDone(goalId);
  }

  remove(goalId: string): void {
    if (confirm('Удалить цель?')) {
      void this.goalsService.remove(goalId);
    }
  }
}
