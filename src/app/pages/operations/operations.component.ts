import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';

import { AccountsService } from '../../core/accounts.service';
import { CategoriesService } from '../../core/categories.service';
import { CurrencyService } from '../../core/currency.service';
import { TransactionsService } from '../../core/transactions.service';
import { Category, OperationKind, Subcategory, Transaction } from '../../core/models';
import { todayKey } from '../../core/day-key';

@Component({
  selector: 'app-operations',
  imports: [FormsModule, DatePipe],
  templateUrl: './operations.component.html',
  styleUrl: './operations.component.less',
})
export class OperationsComponent {
  private readonly accountsService = inject(AccountsService);
  private readonly categoriesService = inject(CategoriesService);
  private readonly transactionsService = inject(TransactionsService);
  readonly curr = inject(CurrencyService);

  readonly kinds: OperationKind[] = ['expense', 'income', 'transfer'];
  readonly kindLabels: Record<OperationKind, string> = {
    expense: 'Расход',
    income: 'Доход',
    transfer: 'Перевод',
  };

  readonly accounts = this.accountsService.accounts;
  readonly todayMarker = todayKey();

  // ----- Форма -----
  form = {
    kind: 'expense' as OperationKind,
    amount: null as number | null,
    accountId: '',
    toAccountId: '',
    categoryId: '',
    subcategoryId: '',
    date: todayKey(),
    note: '',
  };
  editingId = signal<string | null>(null);

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

  readonly transactions = this.transactionsService.transactions;

  onKindChange(): void {
    this.form.categoryId = '';
    this.form.subcategoryId = '';
    if (this.form.kind === 'transfer') {
      this.form.categoryId = '';
    }
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
    const draft = {
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
    };
    this.formError.set('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async remove(tx: Transaction): Promise<void> {
    if (confirm('Удалить операцию? Баланс счёта будет скорректирован.')) {
      await this.transactionsService.remove(tx.id);
      if (this.editingId() === tx.id) {
        this.resetForm();
      }
    }
  }

  cancelEdit(): void {
    this.resetForm();
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
    return '';
  }

  private resetForm(): void {
    this.editingId.set(null);
    this.form = {
      kind: 'expense',
      amount: null,
      accountId: '',
      toAccountId: '',
      categoryId: '',
      subcategoryId: '',
      date: todayKey(),
      note: '',
    };
    this.formError.set('');
  }

  // ----- Отображение списка -----

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
