import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { AuthService } from '../../core/auth.service';
import { AccountsService } from '../../core/accounts.service';
import { BankInboxService } from '../../core/bank-inbox.service';
import { BankRulesService } from '../../core/bank-rules.service';
import { BankSettingsService } from '../../core/bank-settings.service';
import { CategoriesService } from '../../core/categories.service';
import { CurrencyService } from '../../core/currency.service';
import { Account, AccountType, BankRule, Category, CategoryKind, Subcategory } from '../../core/models';
import { pickBankRule, planBulkCategorization, parseKeywordsInput } from '../../core/bank-rules';
import { round2 } from '../../core/money';
import { ThemeService } from '../../core/theme.service';
import { RemindersService } from '../../core/reminders.service';
import { GoalsService } from '../../core/goals.service';
import { RecurringService } from '../../core/recurring.service';
import { TransactionsService } from '../../core/transactions.service';
import { buildBackup, downloadText, transactionsToCsv, Backup, BackupInput } from '../../core/export';
import { ImportPlan, ParsedRow, parseBackupFile, parseTransactionsCsv, planImport } from '../../core/import';
import { BackupService } from '../../core/backup.service';
import { ToastService } from '../../ui/toast.service';
import { todayKey } from '../../core/day-key';
import { validatePasswordChange } from '../../core/password';
import { firebaseErrorMessage } from '../../core/firebase-error-map';
import { IconComponent, IconName } from '../../ui/icon.component';
import { CATEGORY_ICONS, categoryIconName } from '../../ui/category-icons';

@Component({
  selector: 'app-settings',
  imports: [FormsModule, IconComponent, RouterLink],
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.less',
})
export class SettingsComponent {
  private readonly auth = inject(AuthService);
  private readonly accountsService = inject(AccountsService);
  private readonly categoriesService = inject(CategoriesService);
  private readonly transactionsService = inject(TransactionsService);
  private readonly recurringService = inject(RecurringService);
  private readonly goalsService = inject(GoalsService);
  private readonly backupService = inject(BackupService);
  private readonly bankRulesService = inject(BankRulesService);
  private readonly bankInboxService = inject(BankInboxService);
  private readonly bankSettingsService = inject(BankSettingsService);
  private readonly toast = inject(ToastService);
  readonly curr = inject(CurrencyService);
  readonly theme = inject(ThemeService);
  readonly reminders = inject(RemindersService);

  readonly accounts = this.accountsService.accounts;
  readonly total = computed(() => this.accountsService.total());
  readonly incomeCategories = this.categoriesService.incomeCategories;
  readonly expenseCategories = this.categoriesService.expenseCategories;

  // ----- Счета -----
  accountForm = { name: '', type: 'card' as AccountType, balance: null as number | null };
  readonly accountError = signal('');
  /** id счёта, который сейчас редактируется (баланс/название). */
  readonly editingAccountId = signal<string | null>(null);
  accountEdit = { name: '', balance: null as number | null, cardMask: '' };

  async addAccount(): Promise<void> {
    if (!this.accountForm.name.trim()) {
      this.accountError.set('Введите название счёта.');
      return;
    }
    await this.accountsService.create({
      name: this.accountForm.name,
      type: this.accountForm.type,
      balance: Number(this.accountForm.balance) || 0,
    });
    this.accountForm = { name: '', type: 'card', balance: null };
    this.accountError.set('');
  }

  startEditAccount(account: Account): void {
    this.editingAccountId.set(account.id);
    this.accountEdit = {
      name: account.name,
      balance: account.balance,
      cardMask: account.cardMask ?? '',
    };
  }

  async saveAccountEdit(): Promise<void> {
    const id = this.editingAccountId();
    if (!id) {
      return;
    }
    await this.accountsService.update(id, {
      name: this.accountEdit.name || 'Счёт',
      balance: round2(Number(this.accountEdit.balance) || 0),
      cardMask: this.accountEdit.cardMask.replace(/\D/g, '').slice(-4),
    });
    this.editingAccountId.set(null);
  }

  /** Сохранение маски карты прямо в строке счёта. */
  saveCardMask(account: Account, raw: string): void {
    const mask = raw.replace(/\D/g, '').slice(-4);
    if (mask === (account.cardMask ?? '')) {
      return;
    }
    void this.accountsService.update(account.id, { cardMask: mask });
    this.toast.show(mask ? `Карта *${mask} привязана к «${account.name}»` : 'Маска карты удалена');
  }

  /** Месячный лимит по категории; пустое значение — убрать бюджет. */
  saveBudget(category: Category, raw: string): void {
    const value = Number(raw);
    void this.categoriesService.setBudget(
      category.id,
      Number.isFinite(value) && value > 0 ? value : null,
    );
  }

  readonly categoryIcons = CATEGORY_ICONS;

  iconOf(category: Category): IconName {
    return categoryIconName(category.icon, category.kind);
  }

  saveIcon(category: Category, icon: string): void {
    void this.categoriesService.setIcon(category.id, icon || null);
  }

  /** CSV с операциями — открывается в Excel. */
  exportCsv(): void {
    const csv = transactionsToCsv({
      transactions: this.transactionsService.transactions(),
      categories: this.categoriesService.categories(),
      accounts: this.accountsService.accounts(),
    });
    // BOM — чтобы Excel понял UTF-8.
    downloadText(`operations-${todayKey()}.csv`, `\uFEFF${csv}`, 'text/csv;charset=utf-8');
  }

  /** Полный бэкап всех коллекций. */
  exportJson(): void {
    const backup = buildBackup({
      accounts: this.accountsService.accounts(),
      categories: this.categoriesService.categories(),
      transactions: this.transactionsService.transactions(),
      recurring: this.recurringService.rules(),
      goals: this.goalsService.goals(),
    });
    downloadText(
      `financial-planner-${todayKey()}.json`,
      JSON.stringify(backup, null, 2),
      'application/json',
    );
  }

  // ----- Импорт -----

  readonly importError = signal('');
  readonly importBusy = signal(false);
  readonly csvPreview = signal<{ fileName: string; rowsData: ParsedRow[]; plan: ImportPlan } | null>(null);
  readonly backupPreview = signal<{
    fileName: string;
    backup: Backup;
    counts: { accounts: number; categories: number; transactions: number; recurring: number; goals: number };
  } | null>(null);

  async onImportFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) {
      return;
    }

    this.cancelImport();
    const text = await file.text();

    if (file.name.toLowerCase().endsWith('.json')) {
      const { backup, error } = parseBackupFile(text);
      if (!backup) {
        this.importError.set(error ?? 'Не удалось прочитать файл.');
        return;
      }
      this.backupPreview.set({
        fileName: file.name,
        backup,
        counts: {
          accounts: backup.accounts.length,
          categories: backup.categories.length,
          transactions: backup.transactions.length,
          recurring: backup.recurring.length,
          goals: backup.goals.length,
        },
      });
      return;
    }

    const parsed = parseTransactionsCsv(text);
    if (!parsed.rows.length) {
      this.importError.set(parsed.errors[0] ?? 'В файле нет строк для импорта.');
      return;
    }
    this.csvPreview.set({
      fileName: file.name,
      rowsData: parsed.rows,
      plan: this.buildCsvPlan(parsed.rows),
    });
  }

  missingNames(plan: ImportPlan): string {
    return plan.missingCategories.map((item) => item.name).join(', ');
  }

  private buildCsvPlan(rows: ParsedRow[]): ImportPlan {
    return planImport({
      rows,
      accounts: this.accountsService.accounts(),
      categories: this.categoriesService.categories(),
      transactions: this.transactionsService.transactions(),
      today: todayKey(),
    });
  }

  cancelImport(): void {
    this.importError.set('');
    this.csvPreview.set(null);
    this.backupPreview.set(null);
  }

  async confirmImport(): Promise<void> {
    if (this.importBusy()) {
      return;
    }
    this.importBusy.set(true);
    this.importError.set('');

    try {
      const csv = this.csvPreview();
      const backup = this.backupPreview();

      if (csv) {
        let plan = csv.plan;
        const additions: Category[] = [];
        for (const missing of plan.missingCategories) {
          const id = await this.categoriesService.create(missing.name, missing.kind);
          if (id) {
            additions.push({
              id,
              name: missing.name,
              kind: missing.kind,
              subcategories: [],
              sortOrder: 999,
            });
          }
        }
        if (additions.length) {
          plan = planImport({
            rows: csv.rowsData,
            accounts: this.accountsService.accounts(),
            categories: [...this.categoriesService.categories(), ...additions],
            transactions: this.transactionsService.transactions(),
            today: todayKey(),
          });
        }

        const created = await this.transactionsService.importDrafts(plan.drafts);
        this.csvPreview.set(null);
        this.toast.show(
          `Импортировано операций: ${created.length}` +
            (plan.duplicates ? `, пропущено дубликатов: ${plan.duplicates}` : ''),
          { action: { label: 'Отменить', run: () => this.transactionsService.undoImport(created) } },
        );
        return;
      }

      if (backup) {
        const snapshot: BackupInput = {
          accounts: this.accountsService.accounts(),
          categories: this.categoriesService.categories(),
          transactions: this.transactionsService.transactions(),
          recurring: this.recurringService.rules(),
          goals: this.goalsService.goals(),
        };
        await this.backupService.replaceAll(backup.backup);
        this.backupPreview.set(null);
        this.toast.show('Данные восстановлены из бэкапа', {
          action: { label: 'Отменить', run: () => this.backupService.replaceAll(snapshot) },
        });
      }
    } catch (error) {
      this.importError.set(
        'Не удалось импортировать: ' + (error instanceof Error ? error.message : String(error)),
      );
    } finally {
      this.importBusy.set(false);
    }
  }

  /** Пустой шаблон CSV, чтобы заполнить в Excel. */
  downloadCsvTemplate(): void {
    const header = 'Дата;Тип;Сумма;Счёт;Счёт зачисления;Категория;Подкатегория;Заметка;Проведена';
    const sample = '2026-11-18;Расход;1500;Карта;;Продукты;Супермаркет;Пример строки;да';
    downloadText('operations-template.csv', `\uFEFF${header}\r\n${sample}\r\n`, 'text/csv;charset=utf-8');
  }

  async removeAccount(account: Account): Promise<void> {
    const note =
      account.balance !== 0
        ? `На счёте «${account.name}» остаток ${this.money(account.balance)}. Удалить счёт?`
        : `Удалить счёт «${account.name}»?`;
    if (confirm(note)) {
      await this.accountsService.remove(account.id);
    }
  }

  // ----- Категории -----

  newCategory: Record<CategoryKind, string> = { income: '', expense: '' };
  readonly subInputs = signal<Record<string, string>>({});

  /** Две секции категорий для шаблона. */
  readonly categorySections = computed(() => [
    { kind: 'expense' as CategoryKind, title: 'Категории расходов', list: this.expenseCategories },
    { kind: 'income' as CategoryKind, title: 'Категории доходов', list: this.incomeCategories },
  ]);

  async addCategory(kind: CategoryKind): Promise<void> {
    const name = this.newCategory[kind];
    await this.categoriesService.create(name, kind);
    this.newCategory = { ...this.newCategory, [kind]: '' };
  }

  async removeCategory(category: Category): Promise<void> {
    if (confirm(`Удалить категорию «${category.name}»? Операции с ней останутся без категории.`)) {
      await this.categoriesService.remove(category.id);
    }
  }

  async addSubcategory(category: Category): Promise<void> {
    const name = (this.subInputs()[category.id] ?? '').trim();
    if (!name) {
      return;
    }
    await this.categoriesService.addSubcategory(category.id, name);
    this.subInputs.update((map) => ({ ...map, [category.id]: '' }));
  }

  async removeSubcategory(category: Category, subId: string): Promise<void> {
    await this.categoriesService.removeSubcategory(category.id, subId);
  }

  subInput(category: Category): string {
    return this.subInputs()[category.id] ?? '';
  }

  setSubInput(category: Category, value: string): void {
    this.subInputs.update((map) => ({ ...map, [category.id]: value }));
  }

  // ----- Автозаполнение из банка -----

  readonly bankRules = this.bankRulesService.rules;
  readonly bankInbox = this.bankInboxService.inbox;
  readonly inboxCount = this.bankInboxService.count;
  readonly bankSettings = this.bankSettingsService.settings;

  /** Основной счёт для операций из банка: если карта одна, маски не нужны. */
  setDefaultAccount(accountId: string): void {
    void this.bankSettingsService.save({ defaultAccountId: accountId || undefined });
    const account = this.accounts().find((item) => item.id === accountId);
    this.toast.show(
      account ? `Операции из банка будут на «${account.name}»` : 'Основной счёт сброшен',
    );
  }

  /** Операции без категории — то, что осталось разметить вручную. */
  readonly uncategorizedCount = computed(
    () =>
      this.transactionsService
        .transactions()
        .filter((tx) => tx.applied !== false && tx.kind !== 'transfer' && !tx.categoryId).length,
  );

  ruleForm = {
    keywords: '',
    match: 'any' as 'any' | 'all',
    kind: 'expense' as CategoryKind,
    categoryId: '',
    subcategoryId: '',
    priority: 10,
    enabled: true,
  };
  readonly editingRuleId = signal<string | null>(null);
  readonly ruleError = signal('');
  readonly ruleTester = signal('');
  readonly applyingRules = signal(false);

  /** Результат проверки правила по образцу текста уведомления. */
  readonly testerResult = computed<{ tone: 'good' | 'bad'; text: string } | null>(() => {
    const text = this.ruleTester().trim();
    if (!text) {
      return null;
    }
    const rules = this.bankRules();
    const rule =
      pickBankRule(rules, text, 'expense') ??
      pickBankRule(rules, text, 'income');
    if (!rule) {
      return { tone: 'bad', text: 'Ни одно правило не сработало' };
    }
    const category = this.categoriesService.byId().get(rule.categoryId);
    return {
      tone: 'good',
      text: `Сработает правило «${rule.keywords.join(', ')}» → ${category?.name ?? 'категория удалена'}`,
    };
  });

  ruleCategories(): Category[] {
    return this.ruleForm.kind === 'income' ? this.incomeCategories() : this.expenseCategories();
  }

  ruleSubcategories(): Subcategory[] {
    return this.ruleCategories().find((c) => c.id === this.ruleForm.categoryId)?.subcategories ?? [];
  }

  onRuleKindChange(): void {
    this.ruleForm.categoryId = '';
    this.ruleForm.subcategoryId = '';
  }

  onRuleCategoryChange(): void {
    this.ruleForm.subcategoryId = '';
  }

  startNewRule(): void {
    this.editingRuleId.set(null);
    this.ruleError.set('');
    this.ruleForm = {
      keywords: '',
      match: 'any',
      kind: 'expense',
      categoryId: '',
      subcategoryId: '',
      priority: 10,
      enabled: true,
    };
  }

  startEditRule(rule: BankRule): void {
    this.editingRuleId.set(rule.id);
    this.ruleError.set('');
    this.ruleForm = {
      keywords: rule.keywords.join(', '),
      match: rule.match ?? 'any',
      kind: rule.kind,
      categoryId: rule.categoryId,
      subcategoryId: rule.subcategoryId ?? '',
      priority: rule.priority ?? 0,
      enabled: rule.enabled !== false,
    };
  }

  cancelRuleForm(): void {
    this.editingRuleId.set(null);
    this.ruleError.set('');
    this.ruleForm = { ...this.ruleForm, keywords: '', categoryId: '', subcategoryId: '' };
  }

  async saveRule(): Promise<void> {
    const keywords = parseKeywordsInput(this.ruleForm.keywords);
    if (!keywords.length) {
      this.ruleError.set('Добавьте хотя бы одно ключевое слово.');
      return;
    }
    if (!this.ruleForm.categoryId) {
      this.ruleError.set('Выберите категорию.');
      return;
    }
    const draft = {
      keywords,
      match: this.ruleForm.match,
      kind: this.ruleForm.kind,
      categoryId: this.ruleForm.categoryId,
      subcategoryId: this.ruleForm.subcategoryId || undefined,
      priority: Number(this.ruleForm.priority) || 0,
      enabled: this.ruleForm.enabled,
    };
    const editing = this.editingRuleId();
    if (editing) {
      await this.bankRulesService.update(editing, draft);
      this.toast.show('Правило обновлено');
    } else {
      await this.bankRulesService.create(draft);
      this.toast.show('Правило добавлено');
    }
    this.ruleError.set('');
    this.editingRuleId.set(null);
    this.ruleForm = { ...this.ruleForm, keywords: '', categoryId: '', subcategoryId: '' };
  }

  async removeRule(rule: BankRule): Promise<void> {
    if (confirm(`Удалить правило «${rule.keywords.join(', ')}»?`)) {
      await this.bankRulesService.remove(rule.id);
    }
  }

  toggleRule(rule: BankRule): void {
    void this.bankRulesService.setEnabled(rule.id, rule.enabled === false);
  }

  categoryLabelOf(categoryId: string | undefined): string {
    if (!categoryId) {
      return 'Без категории';
    }
    return this.categoriesService.byId().get(categoryId)?.name ?? 'Без категории';
  }

  ruleSubcategoryLabel(rule: BankRule): string {
    if (!rule.subcategoryId) {
      return '';
    }
    const category = this.categoriesService.byId().get(rule.categoryId);
    return category?.subcategories.find((sub) => sub.id === rule.subcategoryId)?.name ?? '';
  }

  /** Применить правила ко всем операциям без категории. */
  async applyRulesNow(): Promise<void> {
    if (this.applyingRules()) {
      return;
    }
    this.applyingRules.set(true);
    try {
      const plan = planBulkCategorization(
        this.transactionsService.transactions(),
        this.bankRules(),
      );
      if (!plan.length) {
        this.toast.show('Нечего размечать: подходящих операций без категории нет');
        return;
      }
      const count = await this.transactionsService.setCategoriesBulk(plan);
      this.toast.show(`Размечено операций: ${count}`);
    } finally {
      this.applyingRules.set(false);
    }
  }

  async removeInboxItem(id: string): Promise<void> {
    await this.bankInboxService.remove(id);
  }

  async clearInbox(): Promise<void> {
    if (confirm('Очистить входящие банка?')) {
      await this.bankInboxService.clear();
    }
  }

  formatInboxTime(item: { postedAt?: unknown; createdAt?: unknown }): string {
    const raw = (item.postedAt ?? item.createdAt) as { toDate?: () => Date } | null | undefined;
    const date = raw && typeof raw.toDate === 'function' ? raw.toDate() : null;
    if (!date) {
      return '';
    }
    return date.toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  // ----- Профиль -----

  displayName = '';
  currencyCode = 'RUB';
  readonly email = computed(() => this.auth.profile()?.email ?? '');
  readonly profileSaved = signal(false);
  private profileApplied = false;

  constructor() {
    // Профиль приходит асинхронно — заполняем поля, как только он загрузился.
    effect(() => {
      const profile = this.auth.profile();
      if (profile && !this.profileApplied) {
        this.profileApplied = true;
        this.displayName = profile.displayName ?? '';
        this.currencyCode = profile.settings?.currency ?? 'RUB';
      }
    });
  }

  async saveProfile(): Promise<void> {
    if (this.displayName.trim()) {
      await this.auth.updateDisplayName(this.displayName.trim());
    }
    await this.auth.updateCurrency(this.currencyCode);
    this.profileSaved.set(true);
    setTimeout(() => this.profileSaved.set(false), 2500);
  }

  // ----- Безопасность: смена пароля -----

  passwordForm = { current: '', next: '', repeat: '' };
  readonly passwordBusy = signal(false);
  readonly passwordError = signal('');
  readonly passwordNotice = signal('');

  async changePassword(): Promise<void> {
    if (this.passwordBusy()) {
      return;
    }
    this.passwordError.set('');
    this.passwordNotice.set('');

    const validation = validatePasswordChange(this.passwordForm);
    if (!validation.ok) {
      this.passwordError.set(validation.message);
      return;
    }

    this.passwordBusy.set(true);
    try {
      await this.auth.changePassword(this.passwordForm.current, this.passwordForm.next);
      this.passwordForm = { current: '', next: '', repeat: '' };
      this.passwordNotice.set('Пароль изменён.');
      this.toast.show('Пароль изменён');
    } catch (error) {
      // Firebase отдаёт код ошибки — переводим на понятный текст.
      this.passwordError.set(firebaseErrorMessage(error));
    } finally {
      this.passwordBusy.set(false);
    }
  }

  money(value: number): string {
    return this.curr.format(value);
  }

  logout(): void {
    void this.auth.logout();
  }
}
