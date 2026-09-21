import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { AccountsService } from '../../core/accounts.service';
import { CategoriesService } from '../../core/categories.service';
import { CurrencyService } from '../../core/currency.service';
import { GoalsService } from '../../core/goals.service';
import { ProjectionService } from '../../core/projection.service';
import { TransactionsService } from '../../core/transactions.service';
import { advisePurchase, PurchaseAdvice } from '../../core/advisor';
import { Category, Goal } from '../../core/models';
import { DayKey, formatDayKeyRelative, todayKey } from '../../core/day-key';

@Component({
  selector: 'app-planner',
  imports: [FormsModule],
  templateUrl: './planner.component.html',
  styleUrl: './planner.component.less',
})
export class PlannerComponent {
  private readonly goalsService = inject(GoalsService);
  private readonly projectionService = inject(ProjectionService);
  private readonly transactionsService = inject(TransactionsService);
  private readonly accountsService = inject(AccountsService);
  private readonly categoriesService = inject(CategoriesService);
  private readonly currency = inject(CurrencyService);
  readonly curr = this.currency;

  readonly todayMarker = todayKey();
  readonly accounts = this.accountsService.accounts;
  readonly expenseCategories = this.categoriesService.expenseCategories;

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

  // ----- Отметка покупки: списание со счёта + операция + закрытие цели -----

  /** Цель, для которой открыта форма отметки покупки. */
  readonly buyingGoalId = signal<string | null>(null);
  buyForm = { accountId: '', categoryId: '', date: todayKey() };
  readonly buyError = signal('');

  readonly buyingAccount = computed(() =>
    this.accounts().find((a) => a.id === this.buyForm.accountId) ?? null,
  );

  startBuying(goal: Goal): void {
    this.buyingGoalId.set(goal.id);
    this.buyForm = { accountId: '', categoryId: '', date: todayKey() };
    this.buyError.set('');
  }

  cancelBuying(): void {
    this.buyingGoalId.set(null);
    this.buyError.set('');
  }

  async confirmBuying(goal: Goal): Promise<void> {
    if (!this.buyForm.accountId) {
      this.buyError.set('Выберите счёт, с которого списать покупку.');
      return;
    }
    if (!this.buyForm.date || this.buyForm.date > this.todayMarker) {
      this.buyError.set('Дата покупки не может быть в будущем.');
      return;
    }
    // Реальная операция расхода: сама спишет с баланса счёта и появится в «Операциях».
    await this.transactionsService.add({
      kind: 'expense',
      amount: goal.amount,
      accountId: this.buyForm.accountId,
      categoryId: this.buyForm.categoryId || undefined,
      date: this.buyForm.date,
      note: `Покупка: ${goal.title}`,
    });
    await this.goalsService.markDone(goal.id);
    this.cancelBuying();
  }

  markDone(goalId: string): void {
    const goal = this.goals().find((g) => g.id === goalId);
    if (goal) {
      this.startBuying(goal);
    }
  }

  remove(goalId: string): void {
    if (confirm('Удалить цель?')) {
      void this.goalsService.remove(goalId);
    }
  }
}
