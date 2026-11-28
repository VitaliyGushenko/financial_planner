import { Component, DestroyRef, computed, effect, inject, signal, viewChild, ElementRef } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Chart, Plugin, registerables } from 'chart.js';

import { CategoriesService } from '../../core/categories.service';
import { CurrencyService } from '../../core/currency.service';
import { ProjectionService } from '../../core/projection.service';
import { TransactionsService } from '../../core/transactions.service';
import { ThemeService } from '../../core/theme.service';
import { StatsPeriod, balanceSeries, buildStats, fillMonths, lastMonths, periodRange } from '../../core/stats';
import { DayKey, addMonthsToKey, todayKey } from '../../core/day-key';
import { buildBudgets } from '../../core/budgets';
import { availableComparisonMonths, compareTwoMonths } from '../../core/compare';
import { CountUpDirective } from '../../ui/count-up.directive';
import { IconComponent, IconName } from '../../ui/icon.component';
import { categoryIconName } from '../../ui/category-icons';

Chart.register(...registerables);

const DONUT_PALETTE = [
  '#1a7f4b', '#7a5cd6', '#d64545', '#e8a13c', '#2f7fd1', '#c2478f',
  '#48a999', '#b0bf4a', '#8d6e63', '#5c6bc0', '#ef6c00', '#455a64',
];

/** Значение CSS-переменной — чтобы графики подхватывали тему. */
function cssVar(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const CHART_ANIMATION = REDUCED_MOTION ? false : { duration: 700, easing: 'easeOutQuart' as const };

@Component({
  selector: 'app-stats',
  imports: [FormsModule, CountUpDirective, IconComponent],
  templateUrl: './stats.component.html',
  styleUrl: './stats.component.less',
})
export class StatsComponent {
  private readonly transactionsService = inject(TransactionsService);
  private readonly categoriesService = inject(CategoriesService);
  private readonly projectionService = inject(ProjectionService);
  private readonly theme = inject(ThemeService);
  readonly currency = inject(CurrencyService);
  private readonly destroyRef = inject(DestroyRef);

  readonly today = todayKey();
  readonly periodOptions: { key: StatsPeriod; label: string }[] = [
    { key: 'month', label: 'Этот месяц' },
    { key: 'prev', label: 'Прошлый' },
    { key: 'quarter', label: '3 месяца' },
    { key: 'year', label: 'Год' },
    { key: 'custom', label: 'Свой' },
  ];
  readonly period = signal<StatsPeriod>('month');
  readonly customFrom = signal(todayKey().slice(0, 8) + '01');
  readonly customTo = signal(todayKey());

  // ----- Сравнение 2 выбранных месяцев (по умолчанию детальная таблица свёрнута) -----
  readonly currentMonthKey = this.today.slice(0, 7);
  readonly prevMonthKey = addMonthsToKey(`${this.currentMonthKey}-01`, -1).slice(0, 7);

  /** Месяц 1 (базовый, по умолчанию прошлый месяц). */
  readonly compareMonthA = signal<string>(this.prevMonthKey);
  /** Месяц 2 (сравниваемый, по умолчанию текущий месяц). */
  readonly compareMonthB = signal<string>(this.currentMonthKey);
  /** Свёрнуто по умолчанию, чтобы не сдвигать остальную аналитику. */
  readonly compareExpanded = signal<boolean>(false);

  readonly availableMonths = computed(() =>
    availableComparisonMonths(this.transactionsService.transactions(), this.today, 18),
  );

  readonly range = computed<{ from: DayKey; to: DayKey }>(() => {
    const p = this.period();
    if (p === 'custom') {
      const from = this.customFrom();
      const to = this.customTo();
      return from <= to ? { from, to } : { from: to, to: from };
    }
    return periodRange(p, this.today);
  });

  readonly stats = computed(() =>
    buildStats({
      transactions: this.transactionsService.transactions(),
      categories: this.categoriesService.categories(),
      from: this.range().from,
      to: this.range().to,
    }),
  );

  /** Доходы/расходы по месяцам за последние 12 месяцев. */
  readonly monthly = computed(() =>
    fillMonths(lastMonths(this.today, 12), this.transactionsService.transactions()),
  );

  /** Бюджеты по категориям на текущий месяц. */
  readonly budgets = computed(() =>
    buildBudgets({
      categories: this.categoriesService.categories(),
      transactions: this.transactionsService.transactions(),
      month: this.today,
    }),
  );

  budgetWidth(progress: number): number {
    return Math.min(100, Math.max(0, progress * 100));
  }

  /** Сравнение двух выбранных месяцев по всем статьям расходов и доходов. */
  readonly detailedComparison = computed(() =>
    compareTwoMonths({
      transactions: this.transactionsService.transactions(),
      categories: this.categoriesService.categories(),
      monthA: this.compareMonthA(),
      monthB: this.compareMonthB(),
    }),
  );

  /** Категории расходов, которые больше всего выросли (подорожали). */
  readonly topGrownExpenses = computed(() =>
    [...this.detailedComparison().expenseCategories]
      .filter((c) => c.delta > 0)
      .sort((a, b) => b.delta - a.delta)
      .slice(0, 3),
  );

  /** Категории расходов, которые больше всего снизились (подешевели). */
  readonly topReducedExpenses = computed(() =>
    [...this.detailedComparison().expenseCategories]
      .filter((c) => c.delta < 0)
      .sort((a, b) => a.delta - b.delta)
      .slice(0, 3),
  );

  /** Все статьи расходов для таблицы (по убыванию максимальной суммы). */
  readonly tableExpenses = computed(() =>
    [...this.detailedComparison().expenseCategories].sort(
      (a, b) => Math.max(b.monthA, b.monthB) - Math.max(a.monthA, a.monthB),
    ),
  );

  /** Все статьи доходов для таблицы (по убыванию максимальной суммы). */
  readonly tableIncomes = computed(() =>
    [...this.detailedComparison().incomeCategories].sort(
      (a, b) => Math.max(b.monthA, b.monthB) - Math.max(a.monthA, a.monthB),
    ),
  );

  toggleCompareExpanded(): void {
    this.compareExpanded.set(!this.compareExpanded());
  }

  percentLabel(value: number | null): string {
    if (value === null) {
      return '—';
    }
    const rounded = Math.round(Math.abs(value) * 100);
    if (rounded === 0) {
      return '0%';
    }
    return `${value > 0 ? '+' : '−'}${rounded}%`;
  }

  /** Компактное число для таблицы без повтора символа валюты в каждой колонке. */
  numOnly(value: number | null | undefined): string {
    if (value === null || value === undefined || Number.isNaN(value)) {
      return '—';
    }
    return value.toLocaleString('ru-RU', {
      minimumFractionDigits: value % 1 === 0 ? 0 : 2,
      maximumFractionDigits: 2,
    });
  }

  /** Разница со знаком для таблицы без дублирования символа валюты. */
  signedNumDelta(delta: number): string {
    if (delta === 0) {
      return '0';
    }
    return `${delta > 0 ? '+' : '−'}${this.numOnly(Math.abs(delta))}`;
  }

  budgetIcon(categoryId: string): IconName {
    return categoryIconName(this.categoriesService.byId().get(categoryId)?.icon, 'expense');
  }

  private readonly donutCanvas = viewChild<ElementRef<HTMLCanvasElement>>('donut');
  private readonly monthsCanvas = viewChild<ElementRef<HTMLCanvasElement>>('months');
  private readonly balanceCanvas = viewChild<ElementRef<HTMLCanvasElement>>('balance');

  private donutChart?: Chart<'doughnut'>;
  private monthsChart?: Chart;
  private balanceChart?: Chart;

  /** Перечитать цвета темы: Chart.js не подхватывает CSS-переменные сам. */
  private syncChartTheme(): void {
    this.theme.revision();
    Chart.defaults.color = cssVar('--muted', '#66717f');
  }

  constructor() {
    Chart.defaults.color = cssVar('--muted', '#66717f');
    Chart.defaults.font.family =
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

    effect(() => this.renderDonut());
    effect(() => this.renderMonths());
    effect(() => this.renderBalance());

    this.destroyRef.onDestroy(() => {
      this.donutChart?.destroy();
      this.monthsChart?.destroy();
      this.balanceChart?.destroy();
    });
  }

  setPeriod(key: StatsPeriod): void {
    this.period.set(key);
  }

  money(value: number | null | undefined): string {
    return value === null || value === undefined ? '—' : this.currency.format(value);
  }

  /** Форматтер для анимированных KPI. */
  readonly moneyFn = (value: number | null | undefined): string =>
    value === null || value === undefined ? '—' : this.currency.format(value);

  monthLabel(month: string): string {
    return fromMonthKey(month);
  }

  monthFullLabel(month: string): string {
    return fromMonthKeyFull(month);
  }

  private renderDonut(): void {
    this.syncChartTheme();
    const canvas = this.donutCanvas()?.nativeElement;
    if (!canvas) {
      return;
    }
    const data = this.stats()
      .byCategory.filter((c) => c.categoryId !== '__income__' && c.amount > 0);
    // Сумма рисуется на канвасе (а не HTML-слоем), чтобы тултип всегда был поверх.
    const centerTotal = this.currency.format(this.stats().expense);
    const centerPlugin: Plugin<'doughnut'> = {
      id: 'donutCenter',
      afterDatasetsDraw(chart) {
        const meta = chart.getDatasetMeta(0);
        if (!meta.data.length) {
          return;
        }
        const arc = meta.data[0] as unknown as { x: number; y: number; innerRadius?: number };
        const ctx = chart.ctx;
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = cssVar('--text', '#1d2530');

        // Подгоняем размер шрифта под внутренний радиус бублика, чтобы сумма не налезала на кольцо.
        const maxWidth = (arc.innerRadius ? arc.innerRadius * 2 : 120) * 0.84;
        let fontSize = 16;
        ctx.font = `800 ${fontSize}px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`;
        while (fontSize > 11 && ctx.measureText(centerTotal).width > maxWidth) {
          fontSize -= 1;
          ctx.font = `800 ${fontSize}px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`;
        }

        ctx.fillText(centerTotal, arc.x, arc.y - 8);
        ctx.fillStyle = cssVar('--muted', '#66717f');
        ctx.font = "12px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
        ctx.fillText('расходы', arc.x, arc.y + 12);
        ctx.restore();
      },
    };
    this.donutChart?.destroy();
    this.donutChart = new Chart<'doughnut'>(canvas, {
      type: 'doughnut',
      data: {
        labels: data.map((c) => c.title),
        datasets: [
          {
            data: data.map((c) => c.amount),
            backgroundColor: data.map((_, i) => DONUT_PALETTE[i % DONUT_PALETTE.length]),
            borderWidth: 2,
            borderColor: cssVar('--surface', '#ffffff'),
          },
        ],
      },
      options: {
        maintainAspectRatio: false,
        cutout: '70%',
        animation: REDUCED_MOTION
          ? false
          : { animateRotate: true, animateScale: true, duration: 800, easing: 'easeOutQuart' as const },
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 12, padding: 12 } },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const total = (ctx.dataset.data as number[]).reduce((s, v) => s + v, 0);
                const pct = total > 0 ? Math.round(((ctx.parsed as number) / total) * 100) : 0;
                return ` ${ctx.label}: ${this.currency.format(ctx.parsed as number)} (${pct}%)`;
              },
            },
          },
        },
      },
      plugins: [centerPlugin],
    });
  }

  private renderMonths(): void {
    this.syncChartTheme();
    const canvas = this.monthsCanvas()?.nativeElement;
    if (!canvas) {
      return;
    }
    const months = this.monthly();
    this.monthsChart?.destroy();
    this.monthsChart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: months.map((m) => this.monthLabel(m.month)),
        datasets: [
          {
            label: 'Доходы',
            data: months.map((m) => m.income),
            backgroundColor: cssVar('--income', '#1a7f4b'),
            borderRadius: 6,
          },
          {
            label: 'Расходы',
            data: months.map((m) => m.expense),
            backgroundColor: cssVar('--expense', '#d64545'),
            borderRadius: 6,
          },
        ],
      },
      options: {
        maintainAspectRatio: false,
        animation: CHART_ANIMATION,
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, padding: 12 } } },
        scales: {
          x: { grid: { display: false }, ticks: { maxTicksLimit: 6, maxRotation: 0, autoSkip: true } },
          y: { beginAtZero: true, ticks: { maxTicksLimit: 6 } },
        },
      },
    });
  }

  private renderBalance(): void {
    this.syncChartTheme();
    const canvas = this.balanceCanvas()?.nativeElement;
    if (!canvas) {
      return;
    }
    const series = balanceSeries(this.projectionService.projection());
    // Год в подписи обязателен: график переходит через декабрь/январь.
    const labels = series.labels.map(
      (k) => `${k.slice(8, 10)}.${k.slice(5, 7)}.${k.slice(2, 4)}`,
    );
    this.balanceChart?.destroy();
    this.balanceChart = new Chart(canvas, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Факт',
            data: series.fact,
            borderColor: cssVar('--primary', '#1a7f4b'),
            borderWidth: 2,
            pointRadius: 0,
            tension: 0.2,
          },
          {
            label: 'Прогноз',
            data: series.forecast,
            borderColor: cssVar('--transfer', '#7a5cd6'),
            borderWidth: 2,
            borderDash: [6, 4],
            pointRadius: 0,
            tension: 0.2,
          },
        ],
      },
      options: {
        maintainAspectRatio: false,
        animation: CHART_ANIMATION,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 12, padding: 12 } },
          tooltip: {
            callbacks: {
              label: (ctx) => ` ${ctx.dataset.label}: ${this.currency.format(ctx.parsed.y)}`,
            },
          },
        },
        scales: {
          x: { grid: { display: false }, ticks: { maxTicksLimit: 5, maxRotation: 0, autoSkip: true } },
          y: { ticks: { maxTicksLimit: 6 } },
        },
      },
    });
  }
}

function fromMonthKey(month: string): string {
  const [y, m] = month.split('-').map(Number);
  // Короткий формат «дек. 25» — длинные подписи наезжают друг на друга на телефоне.
  return new Date(Date.UTC(y, m - 1, 1))
    .toLocaleDateString('ru-RU', { month: 'short', year: '2-digit' })
    .replace(/ г\.$/, '');
}

function fromMonthKeyFull(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const str = new Date(Date.UTC(y, m - 1, 1))
    .toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })
    .replace(/ г\.$/, '');
  return str.charAt(0).toUpperCase() + str.slice(1);
}
