import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { AccountsService } from '../../core/accounts.service';
import { CategoriesService } from '../../core/categories.service';
import { CurrencyService } from '../../core/currency.service';
import { RecurringService, RecurringDraft, describeFrequency } from '../../core/recurring.service';
import { ModalComponent } from '../../ui/modal.component';
import { Category, CustomUnit, Frequency, OperationKind, RecurringRule, Subcategory } from '../../core/models';
import { DayKey, formatDayKeyRelative, todayKey } from '../../core/day-key';
import { occurrencesOfRule } from '../../core/projection';

@Component({
  selector: 'app-recurring',
  imports: [FormsModule, RouterLink, ModalComponent],
  templateUrl: './recurring.component.html',
  styleUrl: './recurring.component.less',
})
export class RecurringComponent {
  private readonly accountsService = inject(AccountsService);
  private readonly categoriesService = inject(CategoriesService);
  private readonly recurringService = inject(RecurringService);
  private readonly currency = inject(CurrencyService);
  readonly curr = this.currency;

  readonly todayMarker = todayKey();
  readonly kinds: OperationKind[] = ['expense', 'income', 'transfer'];
  readonly frequencies: Frequency[] = ['weekly', 'monthly', 'yearly', 'custom'];
  readonly frequencyLabels: Record<Frequency, string> = {
    weekly: 'Каждую неделю',
    monthly: 'Каждый месяц',
    yearly: 'Каждый год',
    custom: 'Свой интервал',
  };
  readonly units: CustomUnit[] = ['days', 'weeks', 'months', 'years'];
  readonly unitLabels: Record<CustomUnit, string> = {
    days: 'день/дня/дней',
    weeks: 'неделю/недели/недель',
    months: 'месяц/месяца/месяцев',
    years: 'год/года/лет',
  };

  readonly accounts = this.accountsService.accounts;

  form = {
    title: '',
    kind: 'expense' as OperationKind,
    amount: null as number | null,
    accountId: '',
    toAccountId: '',
    categoryId: '',
    subcategoryId: '',
    frequency: 'monthly' as Frequency,
    every: 1,
    customUnit: 'months' as CustomUnit,
    startDate: todayKey(),
    endDate: '',
    note: '',
  };
  editingId = signal<string | null>(null);
  /** Открыта ли модалка с формой (создание/редактирование). */
  readonly formOpen = signal(false);
  readonly formError = signal('');

  // Обычные методы, а не computed: form.kind — не сигнал, computed бы закэшировал список.
  formCategories(): Category[] {
    return this.form.kind === 'income'
      ? this.categoriesService.incomeCategories()
      : this.categoriesService.expenseCategories();
  }

  formSubcategories(): Subcategory[] {
    return this.formCategories().find((c) => c.id === this.form.categoryId)?.subcategories ?? [];
  }

  readonly rules = this.recurringService.rules;

  onKindChange(): void {
    this.form.categoryId = '';
    this.form.subcategoryId = '';
    this.formError.set('');
  }

  onCategoryChange(): void {
    this.form.subcategoryId = '';
  }

  async save(): Promise<void> {
    const error = this.validate();
    if (error) {
      this.formError.set(error);
      return;
    }
    const draft: RecurringDraft = {
      title: this.form.title.trim() || this.defaultTitle(),
      kind: this.form.kind,
      amount: Number(this.form.amount),
      accountId: this.form.accountId,
      toAccountId: this.form.kind === 'transfer' ? this.form.toAccountId : undefined,
      categoryId: this.form.kind === 'transfer' ? undefined : this.form.categoryId || undefined,
      subcategoryId: this.form.kind === 'transfer' ? undefined : this.form.subcategoryId || undefined,
      frequency: this.form.frequency,
      every: this.form.frequency === 'custom' ? Math.max(1, Number(this.form.every) || 1) : 1,
      customUnit: this.form.frequency === 'custom' ? this.form.customUnit : undefined,
      startDate: this.form.startDate,
      endDate: this.form.endDate || null,
      note: this.form.note.trim() || undefined,
    };
    const editing = this.editingId();
    if (editing) {
      await this.recurringService.update(editing, draft);
    } else {
      await this.recurringService.create(draft);
    }
    this.closeForm();
  }

  openForm(): void {
    this.resetForm();
    this.formOpen.set(true);
  }

  closeForm(): void {
    this.formOpen.set(false);
    this.resetForm();
  }

  edit(rule: RecurringRule): void {
    this.editingId.set(rule.id);
    this.form = {
      title: rule.title,
      kind: rule.kind,
      amount: rule.amount,
      accountId: rule.accountId,
      toAccountId: rule.toAccountId ?? '',
      categoryId: rule.categoryId ?? '',
      subcategoryId: rule.subcategoryId ?? '',
      frequency: rule.frequency,
      every: rule.every || 1,
      customUnit: rule.customUnit ?? 'months',
      startDate: rule.startDate,
      endDate: rule.endDate ?? '',
      note: rule.note ?? '',
    };
    this.formError.set('');
    this.formOpen.set(true);
  }

  async remove(rule: RecurringRule): Promise<void> {
    if (confirm(`Удалить правило «${rule.title}»?`)) {
      await this.recurringService.remove(rule.id);
      if (this.editingId() === rule.id) {
        this.closeForm();
      }
    }
  }

  cancelEdit(): void {
    this.resetForm();
  }

  frequencyOf(rule: RecurringRule): string {
    return describeFrequency(rule);
  }

  formatDay(key: DayKey): string {
    return formatDayKeyRelative(key, this.todayMarker);
  }

  /** Следующее вхождение после сегодня. */
  nextDate(rule: RecurringRule): DayKey | null {
    return this.recurringService.nextOccurrences(rule, this.todayMarker, 1)[0] ?? null;
  }

  accountName(id: string | undefined): string {
    return (id && this.accountsService.byId().get(id)?.name) || '—';
  }

  categoryName(rule: RecurringRule): string {
    const category = rule.categoryId ? this.categoriesService.byId().get(rule.categoryId) : undefined;
    if (!category) {
      return '';
    }
    const sub = category.subcategories.find((s) => s.id === rule.subcategoryId);
    return sub ? `${category.name} · ${sub.name}` : category.name;
  }

  private defaultTitle(): string {
    const category = this.categoriesService.byId().get(this.form.categoryId);
    return category?.name ?? (this.form.kind === 'income' ? 'Доход' : 'Расход');
  }

  private validate(): string {
    if (!this.form.amount || this.form.amount <= 0) {
      return 'Укажите сумму больше нуля.';
    }
    if (!this.form.accountId) {
      return 'Выберите счёт.';
    }
    if (this.form.kind === 'transfer' && (!this.form.toAccountId || this.form.toAccountId === this.form.accountId)) {
      return 'Выберите разные счета для перевода.';
    }
    if (this.form.kind !== 'transfer' && !this.form.categoryId) {
      return 'Выберите категорию.';
    }
    if (!this.form.startDate) {
      return 'Укажите дату первого платежа.';
    }
    if (this.form.endDate && this.form.endDate < this.form.startDate) {
      return 'Дата окончания раньше первого платежа.';
    }
    return '';
  }

  private resetForm(): void {
    this.editingId.set(null);
    this.form = {
      title: '',
      kind: 'expense',
      amount: null,
      accountId: '',
      toAccountId: '',
      categoryId: '',
      subcategoryId: '',
      frequency: 'monthly',
      every: 1,
      customUnit: 'months',
      startDate: todayKey(),
      endDate: '',
      note: '',
    };
    this.formError.set('');
  }

  money(value: number): string {
    return this.currency.format(value);
  }
}
