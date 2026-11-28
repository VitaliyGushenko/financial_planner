import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { AuthService } from '../../core/auth.service';
import { AccountsService } from '../../core/accounts.service';
import { BankInboxService } from '../../core/bank-inbox.service';
import { BankRulesService } from '../../core/bank-rules.service';
import { BankSettingsService } from '../../core/bank-settings.service';
import { latestBankMark, reconcileAccount, BankMark, Reconciliation } from '../../core/bank-balance';
import { CategoriesService } from '../../core/categories.service';
import { CurrencyService } from '../../core/currency.service';
import { Account, AccountType, BankRule, Category, CategoryKind } from '../../core/models';
import { flattenSubcategories, findSubcategory, subcategoryLabel, FlatSubcategory } from '../../core/category-tree';
import { pickBankRule, planBulkCategorization, parseKeywordsInput } from '../../core/bank-rules';
import { round2 } from '../../core/money';
import { ThemeService } from '../../core/theme.service';
import { RemindersService } from '../../core/reminders.service';
import { GoalsService } from '../../core/goals.service';
import { RecurringService } from '../../core/recurring.service';
import { TransactionsService } from '../../core/transactions.service';
import { buildBackup, downloadText, transactionsToCsv, Backup, BackupInput } from '../../core/export';
import { ImportPlan, ParsedRow, parseBackupFile, parseTransactionsCsv, planImport } from '../../core/import';
import { BackupService, AutoBackupInfo } from '../../core/backup.service';
import { ToastService } from '../../ui/toast.service';
import { todayKey } from '../../core/day-key';
import { validatePasswordChange } from '../../core/password';
import { firebaseErrorMessage } from '../../core/firebase-error-map';
import { IconComponent, IconName } from '../../ui/icon.component';
import { CATEGORY_ICONS, categoryIconName } from '../../ui/category-icons';

type SettingsSection = 'profile' | 'accounts' | 'categories' | 'bank' | 'data' | 'look';

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

  // ----- Разделы настроек -----

  readonly settingsTabs: ReadonlyArray<{ id: SettingsSection; label: string }> = [
    { id: 'profile', label: 'Профиль' },
    { id: 'accounts', label: 'Счета' },
    { id: 'categories', label: 'Категории' },
    { id: 'bank', label: 'Банк' },
    { id: 'data', label: 'Данные' },
    { id: 'look', label: 'Оформление' },
  ];
  readonly settingsSection = signal<SettingsSection>('accounts');

  // ----- Сверка с банком и автобэкап -----

  readonly autoBackupInfo = signal<AutoBackupInfo | null>(this.backupService.autoInfo());

  readonly bankChecks = computed(() => {
    const transactions = this.transactionsService.transactions();
    return this.accounts().map((account) => {
      const mark = latestBankMark(transactions, account.id);
      const result = mark
        ? reconcileAccount(account.balance, mark, transactions, account.id)
        : null;
      return { account, mark, result };
    });
  });

  formatBankMark(at: Date): string {
    return new Intl.DateTimeFormat('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(at);
  }

  formatSavedAt(iso: string): string {
    return new Intl.DateTimeFormat('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));
  }

  async adjustToBank(account: Account, result: Reconciliation): Promise<void> {
    if (Math.abs(result.drift) < 0.01) {
      return;
    }
    const kind = result.drift > 0 ? 'expense' : 'income';
    const amount = Math.abs(result.drift);
    const prompt =
      result.drift > 0
        ? `В приложении на ${this.money(amount)} больше, чем должно быть. Создать расход «Сверка баланса»?`
        : `В приложении на ${this.money(amount)} меньше, чем должно быть. Создать доход «Сверка баланса»?`;
    if (!confirm(prompt)) {
      return;
    }
    const category =
      kind === 'expense'
        ? this.expenseCategories().find((item) => item.name === 'Прочее')
        : undefined;
    await this.transactionsService.add({
      kind,
      amount,
      accountId: account.id,
      categoryId: category?.id,
      date: todayKey(),
      note: 'Сверка баланса',
    });
    this.toast.show(`Баланс «${account.name}» выровнен`);
  }

  private backupSnapshot(): BackupInput {
    return {
      accounts: this.accountsService.accounts(),
      categories: this.categoriesService.categories(),
      transactions: this.transactionsService.transactions(),
      recurring: this.recurringService.rules(),
      goals: this.goalsService.goals(),
      bankRules: this.bankRulesService.rules(),
    };
  }

  createAutoBackupNow(): void {
    const info = this.backupService.saveAuto(this.backupSnapshot());
    this.autoBackupInfo.set(info);
    this.toast.show(
      info ? 'Автобэкап создан' : 'Не удалось сохранить автобэкап: слишком много данных',
    );
  }

  downloadAutoBackup(): void {
    const backup = this.backupService.autoBackup();
    if (!backup) {
      this.toast.show('Автобэкап ещё не создавался');
      return;
    }
    downloadText(
      `financial-planner-auto-${backup.exportedAt.slice(0, 10)}.json`,
      JSON.stringify(backup, null, 2),
      'application/json',
    );
  }

  async restoreAutoBackup(): Promise<void> {
    const backup = this.backupService.autoBackup();
    if (!backup) {
      this.toast.show('Автобэкап ещё не создавался');
      return;
    }
    if (!confirm('Восстановить данные из автобэкапа? Текущие данные будут заменены.')) {
      return;
    }
    const snapshot = this.backupSnapshot();
    await this.backupService.replaceAll(backup);
    this.toast.show('Данные восстановлены из автобэкапа', {
      action: { label: 'Отменить', run: () => this.backupService.replaceAll(snapshot) },
    });
  }

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
      bankRules: this.bankRulesService.rules(),
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
          bankRules: this.bankRulesService.rules(),
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

  /** Дерево подкатегорий: добавление и переименование прямо в списке. */
  readonly subDraft = signal('');
  readonly subAdding = signal<{ categoryId: string; parentId: string | null } | null>(null);
  readonly subEditing = signal<{ categoryId: string; subId: string } | null>(null);
  readonly subBudgetEditing = signal<{ categoryId: string; subId: string } | null>(null);
  readonly subBudgetDraft = signal('');
  readonly subMoving = signal<{ categoryId: string; subId: string } | null>(null);
  readonly subMoveTarget = signal('');
  readonly editingCategoryId = signal<string | null>(null);
  readonly categoryDraft = signal('');

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

  startEditCategory(category: Category): void {
    this.editingCategoryId.set(category.id);
    this.categoryDraft.set(category.name);
  }

  cancelCategoryEdit(): void {
    this.editingCategoryId.set(null);
    this.categoryDraft.set('');
  }

  async saveCategoryName(category: Category): Promise<void> {
    const name = this.categoryDraft().trim();
    if (name) {
      await this.categoriesService.rename(category.id, name);
    }
    this.cancelCategoryEdit();
  }

  flatSubs(category: Category): FlatSubcategory[] {
    return flattenSubcategories(category.subcategories);
  }

  startAddSub(category: Category, parentId: string | null): void {
    this.subEditing.set(null);
    this.cancelSubBudget();
    this.cancelMoveSub();
    this.subAdding.set({ categoryId: category.id, parentId });
    this.subDraft.set('');
  }

  startEditSub(category: Category, subId: string): void {
    const node = findSubcategory(category.subcategories, subId);
    if (!node) {
      return;
    }
    this.subAdding.set(null);
    this.cancelSubBudget();
    this.cancelMoveSub();
    this.subEditing.set({ categoryId: category.id, subId });
    this.subDraft.set(node.node.name);
  }

  cancelSubEdit(): void {
    this.subAdding.set(null);
    this.subEditing.set(null);
    this.subDraft.set('');
  }

  /** Отступ поля ввода: под тем узлом, куда добавляем/который правим. */
  subEditorIndent(category: Category): number {
    const editing = this.subEditing();
    if (editing?.categoryId === category.id) {
      const node = findSubcategory(category.subcategories, editing.subId);
      return 12 + (node?.depth ?? 0) * 18;
    }
    const adding = this.subAdding();
    if (adding?.categoryId === category.id && adding.parentId) {
      const parent = findSubcategory(category.subcategories, adding.parentId);
      return 12 + ((parent?.depth ?? 0) + 1) * 18;
    }
    return 12;
  }

  async saveSub(category: Category): Promise<void> {
    const name = this.subDraft().trim();
    if (!name) {
      return;
    }
    const editing = this.subEditing();
    if (editing?.categoryId === category.id) {
      await this.categoriesService.renameSubcategory(category.id, editing.subId, name);
    } else {
      const adding = this.subAdding();
      if (adding?.categoryId !== category.id) {
        return;
      }
      await this.categoriesService.addSubcategory(category.id, name, adding.parentId);
    }
    this.cancelSubEdit();
  }

  async removeSubcategory(category: Category, subId: string): Promise<void> {
    const node = findSubcategory(category.subcategories, subId);
    const nested = (node?.node.children?.length ?? 0) > 0;
    const question = nested
      ? `Удалить «${node?.node.name}» вместе со вложенными подкатегориями? Операции останутся без категории.`
      : `Удалить подкатегорию «${node?.node.name ?? ''}»?`;
    if (confirm(question)) {
      await this.categoriesService.removeSubcategory(category.id, subId);
    }
  }

  startEditSubBudget(category: Category, subId: string): void {
    const node = findSubcategory(category.subcategories, subId);
    if (!node) {
      return;
    }
    this.cancelSubEdit();
    this.cancelMoveSub();
    this.subBudgetEditing.set({ categoryId: category.id, subId });
    this.subBudgetDraft.set(node.node.budget ? String(node.node.budget) : '');
  }

  cancelSubBudget(): void {
    this.subBudgetEditing.set(null);
    this.subBudgetDraft.set('');
  }

  async saveSubBudget(category: Category): Promise<void> {
    const editing = this.subBudgetEditing();
    if (!editing || editing.categoryId !== category.id) {
      return;
    }
    const value = Number(this.subBudgetDraft().replace(',', '.'));
    const budget = Number.isFinite(value) && value > 0 ? value : null;
    await this.categoriesService.setSubcategoryBudget(category.id, editing.subId, budget);
    this.cancelSubBudget();
    this.toast.show(budget ? 'Лимит сохранён' : 'Лимит убран');
  }

  startMoveSub(category: Category, subId: string): void {
    const node = findSubcategory(category.subcategories, subId);
    if (!node) {
      return;
    }
    this.cancelSubEdit();
    this.cancelSubBudget();
    this.subMoving.set({ categoryId: category.id, subId });
    this.subMoveTarget.set(node.pathIds[node.pathIds.length - 2] ?? '');
  }

  cancelMoveSub(): void {
    this.subMoving.set(null);
    this.subMoveTarget.set('');
  }

  /** Куда можно переместить узел: всё, кроме него самого и его потомков. */
  moveOptions(category: Category, subId: string): Array<{ id: string; label: string }> {
    const options = [{ id: '', label: '— верхний уровень —' }];
    for (const flat of flattenSubcategories(category.subcategories)) {
      if (flat.pathIds.includes(subId)) {
        continue;
      }
      options.push({ id: flat.node.id, label: flat.fullPath });
    }
    return options;
  }

  async saveMoveSub(category: Category): Promise<void> {
    const moving = this.subMoving();
    if (!moving || moving.categoryId !== category.id) {
      return;
    }
    await this.categoriesService.moveSubcategory(
      category.id,
      moving.subId,
      this.subMoveTarget() || null,
    );
    this.cancelMoveSub();
    this.toast.show('Подкатегория перемещена');
  }

  subNodeIndent(category: Category, subId: string): number {
    const node = findSubcategory(category.subcategories, subId);
    return 12 + (node?.depth ?? 0) * 18;
  }

  subBudgetIndent(category: Category): number {
    const editing = this.subBudgetEditing();
    return editing ? this.subNodeIndent(category, editing.subId) : 12;
  }

  subMoveIndent(category: Category): number {
    const moving = this.subMoving();
    return moving ? this.subNodeIndent(category, moving.subId) : 12;
  }

  subMoveOptions(category: Category): Array<{ id: string; label: string }> {
    const moving = this.subMoving();
    return moving ? this.moveOptions(category, moving.subId) : [];
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

  /** Маски, которые указаны у нескольких счетов: операция попадёт на случайный. */
  readonly duplicateMasks = computed(() => {
    const counts = new Map<string, number>();
    for (const acc of this.accounts()) {
      if (acc.cardMask) {
        counts.set(acc.cardMask, (counts.get(acc.cardMask) ?? 0) + 1);
      }
    }
    return [...counts.entries()].filter(([, count]) => count > 1).map(([mask]) => mask);
  });

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

  ruleSubcategories(): FlatSubcategory[] {
    const category = this.ruleCategories().find((c) => c.id === this.ruleForm.categoryId);
    return flattenSubcategories(category?.subcategories);
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
    return subcategoryLabel(category?.subcategories, rule.subcategoryId);
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
