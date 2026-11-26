import { Component, DestroyRef, computed, effect, inject, signal, viewChild, ElementRef } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Chart, Plugin, registerables } from 'chart.js';

import { CategoriesService } from '../../core/categories.service';
import { CurrencyService } from '../../core/currency.service';
import { ProjectionService } from '../../core/projection.service';
import { TransactionsService } from '../../core/transactions.service';
import { StatsPeriod, balanceSeries, buildStats, fillMonths, lastMonths, periodRange } from '../../core/stats';
import { DayKey, addMonthsToKey, todayKey } from '../../core/day-key';
import { buildBudgets } from '../../core/budgets';
import {
  CategoryComparisonItem,
  availableComparisonMonths,
  compareMonths,
  compareTwoMonths,
} from '../../core/compare';
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

export type CompareKindFilter = 'all' | 'expense' | 'income';
export type CompareSortKey = 'delta' | 'amount' | 'percent';
export type CompareViewMode = 'bars' | 'butterfly';

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
  private readonly currency = inject(CurrencyService);
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

  /** Переключатель бублика и топа категорий: расходы или доходы. */
  readonly structureKind = signal<'expense' | 'income'>('expense');

  // ----- Детальное сравнение 2 выбранных месяцев -----
  readonly currentMonthKey = this.today.slice(0, 7);
  readonly prevMonthKey = addMonthsToKey(`${this.currentMonthKey}-01`, -1).slice(0, 7);
  readonly yearAgoMonthKey = addMonthsToKey(`${this.currentMonthKey}-01`, -12).slice(0, 7);

  /** Базовый месяц (Месяц А — с чем сравниваем). */
  readonly compareMonthA = signal<string>(this.prevMonthKey);
  /** Целевой месяц (Месяц Б — который анализируем). */
  readonly compareMonthB = signal<string>(this.currentMonthKey);

  readonly compareFilter = signal<CompareKindFilter>('all');
  readonly compareSort = signal<CompareSortKey>('delta');
  readonly compareView = signal<CompareViewMode>('butterfly');
  readonly expandedCategories = signal<Set<string>>(new Set());

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

  /** Активный список категорий для бублика и топа (расходы или доходы). */
  readonly structureCategories = computed(() =>
    this.structureKind() === 'expense' ? this.stats().byCategory : this.stats().incomeByCategory,
  );

  readonly structureTotal = computed(() =>
    this.structureKind() === 'expense' ? this.stats().expense : this.stats().income,
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

  /** Сравнение с прошлым месяцем (базовое). */
  readonly comparison = computed(() =>
    compareMonths({
      transactions: this.transactionsService.transactions(),
      categories: this.categoriesService.categories(),
      month: this.today,
    }),
  );

  /** Полное сравнение двух произвольно выбранных месяцев по всем статьям доходов и расходов. */
  readonly detailedComparison = computed(() =>
    compareTwoMonths({
      transactions: this.transactionsService.transactions(),
      categories: this.categoriesService.categories(),
      monthA: this.compareMonthA(),
      monthB: this.compareMonthB(),
    }),
  );

  readonly sortedExpenseComparison = computed(() =>
    this.sortComparisonItems(this.detailedComparison().expenseCategories, this.compareSort()),
  );

  readonly sortedIncomeComparison = computed(() =>
    this.sortComparisonItems(this.detailedComparison().incomeCategories, this.compareSort()),
  );

  /** Умные авто-выводы по двум выбранным месяцам. */
  readonly compareInsights = computed(() => {
    const cmp = this.detailedComparison();
    const labelA = this.monthFullLabel(cmp.monthA);
    const labelB = this.monthFullLabel(cmp.monthB);
    const list: { tone: 'good' | 'bad' | 'neutral'; text: string }[] = [];

    if (cmp.expenseCategories.length === 0 && cmp.incomeCategories.length === 0) {
      return list;
    }

    if (cmp.netDelta > 0) {
      list.push({
        tone: 'good',
        text: `Чистое сальдо в ${labelB} выше на ${this.money(cmp.netDelta)} по сравнению с ${labelA}.`,
      });
    } else if (cmp.netDelta < 0) {
      list.push({
        tone: 'bad',
        text: `Сальдо в ${labelB} ниже на ${this.money(Math.abs(cmp.netDelta))}, чем в ${labelA}.`,
      });
    }

    const biggestGrowth = [...cmp.expenseCategories]
      .filter((c) => c.delta > 0)
      .sort((a, b) => b.delta - a.delta)[0];
    if (biggestGrowth) {
      list.push({
        tone: 'bad',
        text: `Сильнее всего вырос расход «${biggestGrowth.title}»: +${this.money(biggestGrowth.delta)} (${this.percentLabel(biggestGrowth.percent)}).`,
      });
    }

    const biggestDrop = [...cmp.expenseCategories]
      .filter((c) => c.delta < 0)
      .sort((a, b) => a.delta - b.delta)[0];
    if (biggestDrop) {
      list.push({
        tone: 'good',
        text: `Больше всего сэкономлено в «${biggestDrop.title}»: −${this.money(Math.abs(biggestDrop.delta))} (${this.percentLabel(biggestDrop.percent)}).`,
      });
    }

    return list;
  });

  private sortComparisonItems(
    items: readonly CategoryComparisonItem[],
    sortKey: CompareSortKey,
  ): CategoryComparisonItem[] {
    const copy = [...items];
    copy.sort((a, b) => {
      if (sortKey === 'amount') {
        return Math.max(b.monthA, b.monthB) - Math.max(a.monthA, a.monthB);
      }
      if (sortKey === 'percent') {
        const pa = a.percent === null ? (a.monthB > 0 ? 999 : 0) : Math.abs(a.percent);
        const pb = b.percent === null ? (b.monthB > 0 ? 999 : 0) : Math.abs(b.percent);
        return pb - pa || Math.abs(b.delta) - Math.abs(a.delta);
      }
      return Math.abs(b.delta) - Math.abs(a.delta) || Math.max(b.monthA, b.monthB) - Math.max(a.monthA, a.monthB);
    });
    return copy;
  }

  swapCompareMonths(): void {
    const a = this.compareMonthA();
    const b = this.compareMonthB();
    this.compareMonthA.set(b);
    this.compareMonthB.set(a);
  }

  setComparePreset(preset: 'prev' | 'yearAgo'): void {
    this.compareMonthB.set(this.currentMonthKey);
    this.compareMonthA.set(preset === 'prev' ? this.prevMonthKey : this.yearAgoMonthKey);
  }

  toggleCategoryExpand(key: string): void {
    const next = new Set(this.expandedCategories());
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    this.expandedCategories.set(next);
  }

  isCategoryExpanded(key: string): boolean {
    return this.expandedCategories().has(key);
  }

  percentLabel(value: number | null, monthA = 0, monthB = 0): string {
    if (value === null) {
      if (monthA === 0 && monthB > 0) {
        return 'Новое';
      }
      return '—';
    }
    const rounded = Math.round(Math.abs(value) * 100);
    if (rounded === 0) {
      return '0%';
    }
    return `${value > 0 ? '+' : '−'}${rounded}%`;
  }

  signedDelta(delta: number): string {
    if (delta === 0) {
      return '0';
    }
    return `${delta > 0 ? '+' : '−'}${this.money(Math.abs(delta))}`;
  }

  budgetIcon(categoryId: string): IconName {
    return categoryIconName(this.categoriesService.byId().get(categoryId)?.icon, 'expense');
  }

  itemIcon(item: { categoryId: string; icon?: string; kind: 'income' | 'expense' }): IconName {
    const icon = item.icon ?? this.categoriesService.byId().get(item.categoryId)?.icon;
    return categoryIconName(icon, item.kind);
  }

  categoryColor(index: number): string {
    return DONUT_PALETTE[index % DONUT_PALETTE.length];
  }

  private readonly donutCanvas = viewChild<ElementRef<HTMLCanvasElement>>('donut');
  private readonly monthsCanvas = viewChild<ElementRef<HTMLCanvasElement>>('months');
  private readonly balanceCanvas = viewChild<ElementRef<HTMLCanvasElement>>('balance');

  private donutChart?: Chart<'doughnut'>;
  private monthsChart?: Chart;
  private balanceChart?: Chart;

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
    const canvas = this.donutCanvas()?.nativeElement;
    if (!canvas) {
      return;
    }
    const kind = this.structureKind();
    const data = this.structureCategories().filter((c) => c.amount > 0);
    const totalSum = this.structureTotal();
    const centerTotal = this.currency.format(totalSum);
    const defaultSubtitle = kind === 'expense' ? 'расходы' : 'доходы';
    const formatMoney = (v: number) => this.currency.format(v);

    const centerPlugin: Plugin<'doughnut'> = {
      id: 'donutCenter',
      afterDatasetsDraw(chart) {
        const meta = chart.getDatasetMeta(0);
        if (!meta.data.length) {
          return;
        }
        const point = meta.data[0] as unknown as { x: number; y: number };
        const active = chart.getActiveElements();
        let mainText = centerTotal;
        let subText = defaultSubtitle;

        if (active.length > 0) {
          const idx = active[0].index;
          const item = data[idx];
          if (item) {
            mainText = formatMoney(item.amount);
            const pct = Math.round(item.share * 100);
            const shortTitle = item.title.length > 14 ? item.title.slice(0, 13) + '…' : item.title;
            subText = `${shortTitle} · ${pct}%`;
          }
        }

        const ctx = chart.ctx;
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = cssVar('--text', '#1d2530');
        ctx.font = "800 19px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
        ctx.fillText(mainText, point.x, point.y - 9);
        ctx.fillStyle = cssVar('--muted', '#66717f');
        ctx.font = "600 12px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
        ctx.fillText(subText, point.x, point.y + 13);
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
            hoverOffset: 8,
          },
        ],
      },
      options: {
        maintainAspectRatio: false,
        cutout: '66%',
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
    const canvas = this.balanceCanvas()?.nativeElement;
    if (!canvas) {
      return;
    }
    const series = balanceSeries(this.projectionService.projection());
    const labels = series.labels.map((k) => `${k.slice(8, 10)}.${k.slice(5, 7)}`);
    const ctx2d = canvas.getContext('2d');
    const factGrad = ctx2d ? ctx2d.createLinearGradient(0, 0, 0, 260) : undefined;
    if (factGrad) {
      factGrad.addColorStop(0, 'rgba(26, 127, 75, 0.28)');
      factGrad.addColorStop(1, 'rgba(26, 127, 75, 0.0)');
    }
    const forecastGrad = ctx2d ? ctx2d.createLinearGradient(0, 0, 0, 260) : undefined;
    if (forecastGrad) {
      forecastGrad.addColorStop(0, 'rgba(122, 92, 214, 0.22)');
      forecastGrad.addColorStop(1, 'rgba(122, 92, 214, 0.0)');
    }

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
            backgroundColor: factGrad,
            fill: true,
            borderWidth: 2.5,
            pointRadius: 0,
            pointHoverRadius: 5,
            tension: 0.25,
          },
          {
            label: 'Прогноз',
            data: series.forecast,
            borderColor: cssVar('--transfer', '#7a5cd6'),
            backgroundColor: forecastGrad,
            fill: true,
            borderWidth: 2.5,
            borderDash: [6, 4],
            pointRadius: 0,
            pointHoverRadius: 5,
            tension: 0.25,
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
