import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';

import { AccountsService } from '../../core/accounts.service';
import { CategoriesService } from '../../core/categories.service';
import { CurrencyService } from '../../core/currency.service';
import { RecurringService, RecurringDraft, describeFrequency } from '../../core/recurring.service';
import { TransactionsService } from '../../core/transactions.service';
import { ModalComponent } from '../../ui/modal.component';
import { Category, CustomUnit, Frequency, OperationKind, RecurringRule, Subcategory, Transaction, TransactionDraft } from '../../core/models';
import { DayKey, formatDayKeyRelative, todayKey } from '../../core/day-key';

/**
 * Объединённая страница операций: разовые операции и правила повторения.
 * В модалке создания галочка «Повторять регулярно» раскрывает поля периодичности —
 * тогда вместе с операцией создаётся правило.
 */
@Component({
  selector: 'app-operations',
  imports: [FormsModule, DatePipe, RouterLink, ModalComponent],
  templateUrl: './operations.component.html',
  styleUrl: './operations.component.less',
})
export class OperationsComponent {
  private readonly accountsService = inject(AccountsService);
  private readonly categoriesService = inject(CategoriesService);
  private readonly transactionsService = inject(TransactionsService);
  private readonly recurringService = inject(RecurringService);
  readonly curr = inject(CurrencyService);

  readonly todayMarker = todayKey();
  readonly kinds: OperationKind[] = ['expense', 'income', 'transfer'];
  readonly kindLabels: Record<OperationKind, string> = {
    expense: 'Расход',
    income: 'Доход',
    transfer: 'Перевод',
  };
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
  readonly transactions = this.transactionsService.transactions;
  readonly rules = this.recurringService.rules;

  /** Активный таб страницы: журнал операций или правила повторения. */
  readonly tab = signal<'journal' | 'recurring'>('journal');

  form = {
    kind: 'expense' as OperationKind,
    amount: null as number | null,
    accountId: '',
    toAccountId: '',
    categoryId: '',
    subcategoryId: '',
    date: todayKey(),
    note: '',
    // ----- повторение -----
    repeat: false,
    frequency: 'monthly' as Frequency,
    every: 1,
    customUnit: 'months' as CustomUnit,
    endDate: '',
  };
  editingId = signal<string | null>(null);
  /** Редактируется правило повторения, а не операция. */
  editingRuleId = signal<string | null>(null);
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

  onKindChange(): void {
    this.form.categoryId = '';
    this.form.subcategoryId = '';
    this.formError.set('');
  }

  onCategoryChange(): void {
    this.form.subcategoryId = '';
  }

  async save(): Promise<void> {
    if (this.editingRuleId()) {
      await this.saveRuleOnly();
      return;
    }
    const error = this.validate();
    if (error) {
      this.formError.set(error);
      return;
    }
    const draft: TransactionDraft = {
      kind: this.form.kind,
      amount: Number(this.form.amount),
      accountId: this.form.accountId,
      toAccountId: this.form.kind === 'transfer' ? this.form.toAccountId : undefined,
      categoryId: this.form.kind === 'transfer' ? undefined : this.form.categoryId || undefined,
      subcategoryId: this.form.kind === 'transfer' ? undefined : this.form.subcategoryId || undefined,
      date: this.form.date,
      note: this.form.note.trim() || undefined,
    };
    const editing = this.editingId();
    if (editing) {
      await this.transactionsService.update(editing, draft);
    } else {
      await this.transactionsService.add(draft);
    }
    // Галочка «Повторять»: вместе с операцией создаём правило.
    if (!editing && this.form.repeat) {
      await this.recurringService.create(this.buildRuleDraft());
    }
    this.closeForm();
  }

  private async saveRuleOnly(): Promise<void> {
    const id = this.editingRuleId();
    if (!id) {
      return;
    }
    const error = this.validateRule();
    if (error) {
      this.formError.set(error);
      return;
    }
    await this.recurringService.update(id, this.buildRuleDraft());
    this.closeForm();
  }

  private buildRuleDraft(): RecurringDraft {
    const fallbackTitle =
      this.categoryLabelOf(this.form.kind === 'transfer' ? undefined : this.form.categoryId) ||
      this.kindLabels[this.form.kind];
    return {
      title: this.form.note.trim() || fallbackTitle,
      kind: this.form.kind,
      amount: Number(this.form.amount),
      accountId: this.form.accountId,
      toAccountId: this.form.kind === 'transfer' ? this.form.toAccountId : undefined,
      categoryId: this.form.kind === 'transfer' ? undefined : this.form.categoryId || undefined,
      subcategoryId: this.form.kind === 'transfer' ? undefined : this.form.subcategoryId || undefined,
      frequency: this.form.frequency,
      every: this.form.frequency === 'custom' ? Math.max(1, Number(this.form.every) || 1) : 1,
      customUnit: this.form.frequency === 'custom' ? this.form.customUnit : undefined,
      startDate: this.form.date,
      endDate: this.form.endDate || null,
      note: undefined,
    };
  }

  openForm(): void {
    this.resetForm();
    this.formOpen.set(true);
  }

  closeForm(): void {
    this.formOpen.set(false);
    this.resetForm();
  }

  edit(tx: Transaction): void {
    this.editingId.set(tx.id);
    this.form = {
      kind: tx.kind,
      amount: tx.amount,
      accountId: tx.accountId,
      toAccountId: tx.toAccountId ?? '',
      categoryId: tx.categoryId ?? '',
      subcategoryId: tx.subcategoryId ?? '',
      date: tx.date,
      note: tx.note ?? '',
      repeat: false,
      frequency: 'monthly',
      every: 1,
      customUnit: 'months',
      endDate: '',
    };
    this.formError.set('');
    this.formOpen.set(true);
  }

  editRule(rule: RecurringRule): void {
    this.editingRuleId.set(rule.id);
    this.form = {
      kind: rule.kind,
      amount: rule.amount,
      accountId: rule.accountId,
      toAccountId: rule.toAccountId ?? '',
      categoryId: rule.categoryId ?? '',
      subcategoryId: rule.subcategoryId ?? '',
      date: rule.startDate,
      note: rule.title,
      repeat: true,
      frequency: rule.frequency,
      every: rule.every || 1,
      customUnit: rule.customUnit ?? 'months',
      endDate: rule.endDate ?? '',
    };
    this.formError.set('');
    this.formOpen.set(true);
  }

  async remove(tx: Transaction): Promise<void> {
    if (confirm('Удалить операцию? Баланс счёта будет скорректирован.')) {
      await this.transactionsService.remove(tx.id);
      if (this.editingId() === tx.id) {
        this.closeForm();
      }
    }
  }

  async removeRule(rule: RecurringRule): Promise<void> {
    if (confirm(`Удалить правило «${rule.title}»?`)) {
      await this.recurringService.remove(rule.id);
      if (this.editingRuleId() === rule.id) {
        this.closeForm();
      }
    }
  }

  private validate(): string {
    if (!this.form.amount || this.form.amount <= 0) {
      return 'Укажите сумму больше нуля.';
    }
    if (!this.form.accountId) {
      return 'Выберите счёт.';
    }
    if (this.form.kind === 'transfer' && (!this.form.toAccountId || this.form.toAccountId === this.form.accountId)) {
      return 'Выберите счёт списания и счёт зачисления (разные).';
    }
    if (this.form.kind !== 'transfer' && !this.form.categoryId) {
      return 'Выберите категорию.';
    }
    if (!this.form.date) {
      return 'Укажите дату.';
    }
    if (this.form.repeat) {
      const ruleError = this.validateRule();
      if (ruleError) {
        return ruleError;
      }
    }
    return '';
  }

  private validateRule(): string {
    if (!this.form.accountId) {
      return 'Выберите счёт.';
    }
    if (this.form.kind === 'transfer' && (!this.form.toAccountId || this.form.toAccountId === this.form.accountId)) {
      return 'Выберите разные счета для перевода.';
    }
    if (this.form.kind !== 'transfer' && !this.form.categoryId) {
      return 'Выберите категорию.';
    }
    if (!this.form.date) {
      return 'Укажите дату первого платежа.';
    }
    if (this.form.endDate && this.form.endDate < this.form.date) {
      return '«Повторять до» раньше первого платежа.';
    }
    return '';
  }

  private resetForm(): void {
    this.editingId.set(null);
    this.editingRuleId.set(null);
    this.form = {
      kind: 'expense',
      amount: null,
      accountId: '',
      toAccountId: '',
      categoryId: '',
      subcategoryId: '',
      date: todayKey(),
      note: '',
      repeat: false,
      frequency: 'monthly',
      every: 1,
      customUnit: 'months',
      endDate: '',
    };
    this.formError.set('');
  }

  // ----- Отображение списков -----

  accountName(id: string | undefined): string {
    return (id && this.accountsService.byId().get(id)?.name) || '—';
  }

  categoryName(tx: Transaction): string {
    const category = tx.categoryId ? this.categoriesService.byId().get(tx.categoryId) : undefined;
    if (!category) {
      return this.kindLabels[tx.kind];
    }
    const sub = category.subcategories.find((s) => s.id === tx.subcategoryId);
    return sub ? `${category.name} · ${sub.name}` : category.name;
  }

  private categoryLabelOf(categoryId: string | undefined): string {
    if (!categoryId) {
      return '';
    }
    return this.categoriesService.byId().get(categoryId)?.name ?? '';
  }

  frequencyOf(rule: RecurringRule): string {
    return describeFrequency(rule);
  }

  nextDate(rule: RecurringRule): DayKey | null {
    return this.recurringService.nextOccurrences(rule, this.todayMarker, 1)[0] ?? null;
  }

  formatDay(key: DayKey): string {
    return formatDayKeyRelative(key, this.todayMarker);
  }

  ruleCategoryName(rule: RecurringRule): string {
    return this.categoryLabelOf(rule.categoryId);
  }

  signed(tx: Transaction): string {
    const value = this.curr.format(tx.amount);
    if (tx.kind === 'income') {
      return `+${value}`;
    }
    if (tx.kind === 'expense') {
      return `−${value}`;
    }
    return value;
  }

  money(value: number): string {
    return this.curr.format(value);
  }

  amountClass(kind: string): string {
    return kind === 'income' ? 'positive' : kind === 'expense' ? 'negative' : '';
  }
}
