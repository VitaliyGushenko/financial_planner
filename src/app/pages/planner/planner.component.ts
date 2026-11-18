import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { AccountsService } from '../../core/accounts.service';
import { CategoriesService } from '../../core/categories.service';
import { CurrencyService } from '../../core/currency.service';
import { GoalsService } from '../../core/goals.service';
import { ProjectionService } from '../../core/projection.service';
import { TransactionsService } from '../../core/transactions.service';
import { RecurringService } from '../../core/recurring.service';
import { ModalComponent } from '../../ui/modal.component';
import { IconComponent } from '../../ui/icon.component';
import { advisePurchase, PurchaseAdvice } from '../../core/advisor';
import { buildProjection } from '../../core/projection';
import { round2 } from '../../core/money';
import { Category, Goal } from '../../core/models';
import { DayKey, diffInDays, formatDayKeyRelative, pluralRu, todayKey } from '../../core/day-key';

@Component({
  selector: 'app-planner',
  imports: [FormsModule, ModalComponent, IconComponent],
  templateUrl: './planner.component.html',
  styleUrl: './planner.component.less',
})
export class PlannerComponent {
  private readonly goalsService = inject(GoalsService);
  private readonly projectionService = inject(ProjectionService);
  private readonly transactionsService = inject(TransactionsService);
  private readonly accountsService = inject(AccountsService);
  private readonly categoriesService = inject(CategoriesService);
  private readonly recurringService = inject(RecurringService);
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
  /** Открыта ли модалка «Хочу купить». */
  readonly quickOpen = signal(false);
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

  // ----- «Что если»: экономия на будущих расходах -----

  /** Сколько процентов трат «урезаем» — 0…50. */
  readonly saving = signal(0);
  readonly whatIfGoalId = signal<string | null>(null);

  readonly whatIfGoal = computed<Goal | null>(() => {
    const goals = this.goals();
    if (!goals.length) {
      return null;
    }
    return goals.find((goal) => goal.id === this.whatIfGoalId()) ?? goals[0];
  });

  /** Проекция с уменьшенными будущими расходами (правила и плановые операции). */
  private readonly whatIfProjection = computed(() => {
    const factor = 1 - this.saving() / 100;
    const today = this.todayMarker;
    const transactions = this.transactionsService
      .transactions()
      .map((tx) =>
        tx.date > today && tx.kind === 'expense'
          ? { ...tx, amount: round2(tx.amount * factor) }
          : tx,
      );
    const rules = this.recurringService
      .rules()
      .map((rule) => (rule.kind === 'expense' ? { ...rule, amount: round2(rule.amount * factor) } : rule));

    return buildProjection({
      accounts: this.accountsService.accounts(),
      transactions,
      rules,
      categories: this.categoriesService.categories(),
      today,
    });
  });

  readonly whatIfAdvice = computed<PurchaseAdvice | null>(() => {
    const goal = this.whatIfGoal();
    if (!goal) {
      return null;
    }
    return advisePurchase(this.whatIfProjection(), goal.amount, {
      deadline: goal.deadline,
      currency: this.currency.currency(),
    });
  });

  /** На сколько дней раньше можно купить при текущей экономии. */
  readonly whatIfGain = computed<number | null>(() => {
    const goal = this.whatIfGoal();
    if (!goal) {
      return null;
    }
    const base = this.goalAdvices().get(goal.id)?.recommendedDate ?? null;
    const next = this.whatIfAdvice()?.recommendedDate ?? null;
    if (!base || !next) {
      return null;
    }
    return Math.max(0, diffInDays(base, next));
  });

  gainLabel(days: number): string {
    return `${days} ${pluralRu(days, 'день', 'дня', 'дней')}`;
  }

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
    this.quickOpen.set(false);
  }

  openQuick(): void {
    this.quick = { title: '', amount: null, deadline: '' };
    this.quickError.set('');
    this.quickOpen.set(true);
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

  /** Праздник после покупки: короткое конфетти. */
  readonly celebrate = signal(false);
  readonly confetti = Array.from({ length: 18 }, (_, index) => ({
    left: Math.round(4 + Math.random() * 92),
    delay: Math.round(Math.random() * 250),
    duration: 900 + Math.round(Math.random() * 500),
    color: ['#1a7f4b', '#7a5cd6', '#e8a13c', '#d64545', '#2f7fd1'][index % 5],
  }));

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
    this.celebrate.set(true);
    setTimeout(() => this.celebrate.set(false), 1600);
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
