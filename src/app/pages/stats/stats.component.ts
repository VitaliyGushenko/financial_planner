import { Component, DestroyRef, computed, effect, inject, signal, viewChild, ElementRef } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Chart, registerables } from 'chart.js';

import { AccountsService } from '../../core/accounts.service';
import { CategoriesService } from '../../core/categories.service';
import { CurrencyService } from '../../core/currency.service';
import { ProjectionService } from '../../core/projection.service';
import { TransactionsService } from '../../core/transactions.service';
import { StatsPeriod, balanceSeries, buildStats, fillMonths, lastMonths, periodRange } from '../../core/stats';
import { DayKey, formatDayKeyShort, todayKey } from '../../core/day-key';

Chart.register(...registerables);

const DONUT_PALETTE = [
  '#1a7f4b', '#7a5cd6', '#d64545', '#e8a13c', '#2f7fd1', '#c2478f',
  '#48a999', '#b0bf4a', '#8d6e63', '#5c6bc0', '#ef6c00', '#455a64',
];

@Component({
  selector: 'app-stats',
  imports: [FormsModule],
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

  private readonly donutCanvas = viewChild<ElementRef<HTMLCanvasElement>>('donut');
  private readonly monthsCanvas = viewChild<ElementRef<HTMLCanvasElement>>('months');
  private readonly balanceCanvas = viewChild<ElementRef<HTMLCanvasElement>>('balance');

  private donutChart?: Chart;
  private monthsChart?: Chart;
  private balanceChart?: Chart;

  constructor() {
    Chart.defaults.color = '#66717f';
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

  monthLabel(month: string): string {
    return fromMonthKey(month);
  }

  private renderDonut(): void {
    const canvas = this.donutCanvas()?.nativeElement;
    if (!canvas) {
      return;
    }
    const data = this.stats()
      .byCategory.filter((c) => c.categoryId !== '__income__' && c.amount > 0);
    this.donutChart?.destroy();
    this.donutChart = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: data.map((c) => c.title),
        datasets: [
          {
            data: data.map((c) => c.amount),
            backgroundColor: data.map((_, i) => DONUT_PALETTE[i % DONUT_PALETTE.length]),
            borderWidth: 2,
            borderColor: '#ffffff',
          },
        ],
      },
      options: {
        maintainAspectRatio: false,
        cutout: '64%',
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
            backgroundColor: '#1a7f4b',
            borderRadius: 6,
          },
          {
            label: 'Расходы',
            data: months.map((m) => m.expense),
            backgroundColor: '#d64545',
            borderRadius: 6,
          },
        ],
      },
      options: {
        maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, padding: 12 } } },
        scales: {
          x: { grid: { display: false } },
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
    const labels = series.labels.map((k) => formatDayKeyShort(k));
    this.balanceChart?.destroy();
    this.balanceChart = new Chart(canvas, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Факт',
            data: series.fact,
            borderColor: '#1a7f4b',
            borderWidth: 2,
            pointRadius: 0,
            tension: 0.2,
          },
          {
            label: 'Прогноз',
            data: series.forecast,
            borderColor: '#7a5cd6',
            borderWidth: 2,
            borderDash: [6, 4],
            pointRadius: 0,
            tension: 0.2,
          },
        ],
      },
      options: {
        maintainAspectRatio: false,
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
          x: { grid: { display: false }, ticks: { maxTicksLimit: 8, maxRotation: 0 } },
          y: { ticks: { maxTicksLimit: 6 } },
        },
      },
    });
  }
}

function fromMonthKey(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
}
