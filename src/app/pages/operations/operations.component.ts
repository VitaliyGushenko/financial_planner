import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { AccountsService } from '../../core/accounts.service';
import { BankRulesService } from '../../core/bank-rules.service';
import { keywordFromTransaction, planBulkCategorization } from '../../core/bank-rules';
import { CategoriesService } from '../../core/categories.service';
import { CurrencyService } from '../../core/currency.service';
import { PendingService } from '../../core/pending.service';
import { PendingItem } from '../../core/pending';
import { RecurringService, RecurringDraft, describeFrequency } from '../../core/recurring.service';
import { TransactionsService } from '../../core/transactions.service';
import { ModalComponent } from '../../ui/modal.component';
import { IconComponent } from '../../ui/icon.component';
import { categoryIconName } from '../../ui/category-icons';
import { ToastService } from '../../ui/toast.service';
import { VoiceInputComponent } from '../../ui/voice-input.component';
import { parseVoice, VoiceField } from '../../core/voice/parse-voice';
import { Category, CustomUnit, Frequency, OperationKind, RecurringRule, Subcategory, Transaction, TransactionDraft } from '../../core/models';
import { DayKey, formatDayKeyRelative, formatDayKeyShort, todayKey } from '../../core/day-key';
import { IconName } from '../../ui/icon.component';

/**
 * Объединённая страница операций: разовые операции и правила повторения.
 * В модалке создания галочка «Повторять регулярно» раскрывает поля периодичности —
 * тогда вместе с операцией создаётся правило.
 */
@Component({
  selector: 'app-operations',
  imports: [FormsModule, RouterLink, ModalComponent, VoiceInputComponent, IconComponent],
  templateUrl: './operations.component.html',
  styleUrl: './operations.component.less',
})
export class OperationsComponent {
  private readonly accountsService = inject(AccountsService);
  private readonly categoriesService = inject(CategoriesService);
  private readonly transactionsService = inject(TransactionsService);
  private readonly recurringService = inject(RecurringService);
  private readonly pendingService = inject(PendingService);
  private readonly bankRulesService = inject(BankRulesService);
  private readonly toast = inject(ToastService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly curr = inject(CurrencyService);

  constructor() {
    // Горячие клавиши приходят параметрами маршрута: «N» — новая операция, «/» — поиск.
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      const openNew = params.get('new') === '1';
      const focusSearch = params.get('focus') === 'search';
      const showUncategorized = params.get('uncategorized') === '1';
      if (!openNew && !focusSearch && !showUncategorized) {
        return;
      }
      if (openNew) {
        this.openForm();
      }
      if (showUncategorized) {
        this.uncategorizedOnly.set(true);
      }
      if (focusSearch) {
        setTimeout(() => document.querySelector<HTMLInputElement>('.search-field input')?.focus(), 80);
      }
      // Чистим параметры, чтобы тот же шорткат сработал повторно.
      void this.router.navigate([], { relativeTo: this.route, queryParams: {}, replaceUrl: true });
    });
  }

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
  /** Журнал показывает только подтверждённые операции (плановые ждут своего дня). */
  readonly transactions = this.transactionsService.real;
  readonly rules = this.recurringService.rules;

  /** Активный таб страницы: журнал операций или правила повторения. */
  readonly tab = signal<'journal' | 'recurring'>('journal');

  // ----- Поиск и фильтры журнала -----

  readonly query = signal('');
  readonly kindFilter = signal<'all' | OperationKind>('all');
  readonly accountFilter = signal('all');
  readonly monthFilter = signal('all');
  readonly filtersOpen = signal(false);
  /** Показывать только операции без категории (разметка после пушей банка). */
  readonly uncategorizedOnly = signal(false);
  /** Идёт применение правил к неразмеченным операциям. */
  readonly applyingRules = signal(false);
  /** Выбранные в журнале, но ещё не сохранённые категории. */
  readonly pendingCategory = signal<Record<string, { categoryId: string; subcategoryId: string }>>({});

  /** Сколько операций ещё не разнесено по категориям. */
  readonly uncategorizedCount = computed(
    () => this.transactions().filter((tx) => tx.kind !== 'transfer' && !tx.categoryId).length,
  );

  readonly months = computed(() => {
    const set = new Set<string>();
    for (const tx of this.transactions()) {
      set.add(tx.date.slice(0, 7));
    }
    return [...set].sort((a, b) => b.localeCompare(a));
  });

  readonly activeFilters = computed(() => {
    let count = 0;
    if (this.kindFilter() !== 'all') count += 1;
    if (this.accountFilter() !== 'all') count += 1;
    if (this.monthFilter() !== 'all') count += 1;
    return count;
  });

  readonly hasFilters = computed(
    () => this.query().trim() !== '' || this.activeFilters() > 0 || this.uncategorizedOnly(),
  );

  readonly filtered = computed(() => {
    const query = this.query().trim().toLowerCase();
    const kind = this.kindFilter();
    const accountId = this.accountFilter();
    const month = this.monthFilter();

    return this.transactions().filter((tx) => {
      if (kind !== 'all' && tx.kind !== kind) {
        return false;
      }
      if (this.uncategorizedOnly() && (tx.kind === 'transfer' || tx.categoryId)) {
        return false;
      }
      if (accountId !== 'all' && tx.accountId !== accountId && tx.toAccountId !== accountId) {
        return false;
      }
      if (month !== 'all' && !tx.date.startsWith(month)) {
        return false;
      }
      if (!query) {
        return true;
      }
      const haystack = [
        this.categoryName(tx),
        this.accountName(tx.accountId),
        this.accountName(tx.toAccountId),
        tx.note ?? '',
        String(tx.amount),
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(query);
    });
  });

  /** Журнал, сгруппированный по дням с итогами дня. */
  readonly groups = computed(() => {
    const map = new Map<DayKey, Transaction[]>();
    for (const tx of this.filtered()) {
      const list = map.get(tx.date) ?? [];
      list.push(tx);
      map.set(tx.date, list);
    }
    return [...map.entries()].map(([key, items]) => ({
      key,
      label: this.formatDay(key),
      income: items.filter((tx) => tx.kind === 'income').reduce((sum, tx) => sum + tx.amount, 0),
      expense: items.filter((tx) => tx.kind === 'expense').reduce((sum, tx) => sum + tx.amount, 0),
      items,
    }));
  });

  resetFilters(): void {
    this.query.set('');
    this.kindFilter.set('all');
    this.accountFilter.set('all');
    this.monthFilter.set('all');
    this.uncategorizedOnly.set(false);
  }

  /** Показываем журнал порциями по дням, чтобы длинная история не тормозила. */
  readonly visibleDays = signal(14);
  readonly visibleGroups = computed(() => this.groups().slice(0, this.visibleDays()));
  readonly hasMoreDays = computed(() => this.groups().length > this.visibleDays());

  showMoreDays(): void {
    this.visibleDays.update((count) => count + 14);
  }

  private readonly resetWindowOnFilter = effect(() => {
    // Любое изменение фильтров — начинаем показ с первого экрана.
    this.query();
    this.kindFilter();
    this.accountFilter();
    this.monthFilter();
    this.uncategorizedOnly();
    this.tab();
    untracked(() => this.visibleDays.set(14));
  });

  monthLabel(month: string): string {
    const [year, monthNumber] = month.split('-').map(Number);
    return new Date(Date.UTC(year, monthNumber - 1, 1))
      .toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })
      .replace(/ г\.$/, '');
  }

  /** Иконка категории операции (или запасная по типу). */
  iconOf(tx: Transaction): IconName {
    const category = tx.categoryId ? this.categoriesService.byId().get(tx.categoryId) : undefined;
    return categoryIconName(category?.icon, tx.kind);
  }

  // ----- Платежи, ожидающие подтверждения -----

  readonly pending = this.pendingService.items;
  private readonly pendingAmounts = signal<Record<string, number>>({});

  amountOf(item: PendingItem): number {
    return this.pendingAmounts()[item.id] ?? item.amount;
  }

  setAmount(item: PendingItem, raw: string): void {
    const value = Number(raw);
    this.pendingAmounts.update((map) => ({
      ...map,
      [item.id]: Number.isFinite(value) && value > 0 ? value : item.amount,
    }));
  }

  async confirmPending(item: PendingItem): Promise<void> {
    navigator.vibrate?.(12);
    const amount = this.amountOf(item);
    if (item.txId) {
      // Плановая разовая операция: фиксируем фактическую сумму.
      await this.transactionsService.confirm(item.txId, amount);
      return;
    }
    if (item.ruleId) {
      const rule = this.recurringService.byId().get(item.ruleId);
      if (!rule) {
        return;
      }
      await this.transactionsService.add({
        kind: rule.kind,
        amount,
        accountId: rule.accountId,
        toAccountId: rule.toAccountId,
        categoryId: rule.categoryId,
        subcategoryId: rule.subcategoryId,
        date: item.date,
        note: rule.note || rule.title,
        ruleId: rule.id,
      });
    }
  }

  /** Пропустить платёж правила / удалить плановую операцию. */
  async skipPending(item: PendingItem): Promise<void> {
    if (item.txId) {
      await this.transactionsService.remove(item.txId);
    } else if (item.ruleId) {
      await this.recurringService.skipOccurrence(item.ruleId, item.date);
    }
  }

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

  /** Открыто ли окно голосового ввода. */
  readonly voiceOpen = signal(false);
  /** Поля, заполненные из речи: подсвечиваем — их нужно проверить. */
  readonly voiceHints = signal<Partial<Record<VoiceField, boolean>>>({});
  readonly voiceNotice = signal('');

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
    navigator.vibrate?.(8);
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
    } else if (this.form.repeat) {
      // «Повторять регулярно»: создаём только правило. Первый платёж появится
      // в календаре, а в журнал попадёт после подтверждения на дашборде.
      await this.recurringService.create(this.buildRuleDraft());
      this.closeForm();
      return;
    } else {
      await this.transactionsService.add(draft);
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

  openVoice(): void {
    this.resetForm();
    this.voiceOpen.set(true);
  }

  closeVoice(): void {
    this.voiceOpen.set(false);
  }

  /**
   * Заполнить форму по фразе. Ничего не сохраняем: пользователь проверяет
   * подсвеченные поля и подтверждает кнопкой «Добавить».
   */
  applyVoice(text: string): void {
    const draft = parseVoice(text, {
      categories: this.categoriesService.categories(),
      accounts: this.accounts(),
      today: todayKey(),
    });

    this.resetForm();
    this.form = {
      kind: draft.kind,
      amount: draft.amount,
      accountId: draft.accountId,
      toAccountId: draft.toAccountId,
      categoryId: draft.categoryId,
      subcategoryId: draft.subcategoryId,
      date: draft.date,
      note: draft.note,
      repeat: false,
      frequency: 'monthly',
      every: 1,
      customUnit: 'months',
      endDate: '',
    };
    this.voiceHints.set(draft.hints);
    this.voiceNotice.set(
      draft.unresolved.length
        ? `Заполнено голосом. Проверьте поля и укажите: ${draft.unresolved.join(', ')}.`
        : 'Заполнено голосом. Проверьте поля перед сохранением.',
    );
    this.voiceOpen.set(false);
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
    this.voiceHints.set({});
    this.voiceNotice.set('');
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
    this.voiceHints.set({});
    this.voiceNotice.set('');
    this.formOpen.set(true);
  }

  async remove(tx: Transaction): Promise<void> {
    const snapshot: Transaction = { ...tx };
    await this.transactionsService.remove(tx.id);
    if (this.editingId() === tx.id) {
      this.closeForm();
    }
    this.toast.show('Операция удалена', {
      action: { label: 'Отменить', run: () => this.transactionsService.restore(snapshot) },
    });
  }

  async removeRule(rule: RecurringRule): Promise<void> {
    const snapshot: RecurringRule = { ...rule };
    await this.recurringService.remove(rule.id);
    if (this.editingRuleId() === rule.id) {
      this.closeForm();
    }
    this.toast.show(`Правило «${rule.title}» удалено`, {
      action: { label: 'Отменить', run: () => this.recurringService.restore(snapshot) },
    });
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
    this.voiceHints.set({});
    this.voiceNotice.set('');
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

  // ----- Разметка операций из банка -----

  /** Операция пришла из пуша банка (companion-приложение). */
  isBankOp(tx: Transaction): boolean {
    return tx.source === 'bank';
  }

  /** Мерчант из пуша — по нему создаётся правило. */
  bankMerchant(tx: Transaction): string {
    return (tx.merchant || tx.note || '').trim();
  }

  categoriesFor(tx: Transaction): Category[] {
    return tx.kind === 'income'
      ? this.categoriesService.incomeCategories()
      : this.categoriesService.expenseCategories();
  }

  /** Текущий несохранённый выбор для строки журнала. */
  pendingOf(txId: string): { categoryId: string; subcategoryId: string } {
    return this.pendingCategory()[txId] ?? { categoryId: '', subcategoryId: '' };
  }

  /** Подкатегории выбранной категории (пусто — подкатегорий нет). */
  pendingSubcategories(tx: Transaction): Subcategory[] {
    const categoryId = this.pendingOf(tx.id).categoryId;
    return this.categoriesFor(tx).find((cat) => cat.id === categoryId)?.subcategories ?? [];
  }

  setPendingCategory(tx: Transaction, categoryId: string): void {
    this.pendingCategory.update((map) => ({
      ...map,
      [tx.id]: { categoryId, subcategoryId: '' },
    }));
  }

  setPendingSubcategory(tx: Transaction, subcategoryId: string): void {
    this.pendingCategory.update((map) => ({
      ...map,
      [tx.id]: { categoryId: map[tx.id]?.categoryId ?? '', subcategoryId },
    }));
  }

  /**
   * Сохранить категорию и подкатегорию прямо в журнале, не трогая балансы.
   * После сохранения строка уходит из фильтра «Без категории».
   */
  async saveInlineCategory(tx: Transaction): Promise<void> {
    const pending = this.pendingCategory()[tx.id];
    if (!pending?.categoryId) {
      return;
    }
    await this.transactionsService.setCategory(
      tx.id,
      pending.categoryId,
      pending.subcategoryId || undefined,
    );
    this.pendingCategory.update((map) => {
      const next = { ...map };
      delete next[tx.id];
      return next;
    });
    navigator.vibrate?.(10);
    this.toast.show(`Категория: ${this.categoryLabelOf(pending.categoryId)}`, {
      action: {
        label: 'Правило',
        run: () => this.createRuleFor(tx, pending.categoryId, pending.subcategoryId || undefined),
      },
    });
  }

  /** Применить правила ко всем операциям без категории прямо из журнала. */
  async applyRulesToUncategorized(): Promise<void> {
    if (this.applyingRules()) {
      return;
    }
    this.applyingRules.set(true);
    try {
      const plan = planBulkCategorization(this.transactions(), this.bankRulesService.rules());
      if (!plan.length) {
        this.toast.show('Нет операций, подходящих под правила');
        return;
      }
      const count = await this.transactionsService.setCategoriesBulk(plan);
      this.toast.show(`Размечено операций: ${count}`);
    } finally {
      this.applyingRules.set(false);
    }
  }

  /** Запомнить мерчанта как правило автокатегоризации. */
  async createRuleFor(
    tx: Transaction,
    categoryId: string,
    subcategoryId?: string,
  ): Promise<void> {
    if (tx.kind === 'transfer') {
      return;
    }
    const keyword = keywordFromTransaction(tx);
    if (!keyword) {
      this.toast.show('У операции нет мерчанта — правило создать не из чего');
      return;
    }
    await this.bankRulesService.create({
      keywords: [keyword],
      kind: tx.kind,
      categoryId,
      subcategoryId,
      priority: 20,
      enabled: true,
    });
    navigator.vibrate?.(12);
    this.toast.show(`Правило: «${keyword}» → ${this.categoryLabelOf(categoryId)}`);
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
